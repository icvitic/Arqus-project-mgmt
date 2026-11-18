import { describe, it, expect, afterEach } from 'vitest';
import { buildMessage, encodeWords, smtpSend, SmtpError, type OutgoingMail, type SmtpConfig } from '../src/mail/smtp-client';
import { OTHER_CERT, OTHER_KEY, startFakeSmtp, TEST_CERT, type FakeServer } from './smtp-fake';

/** WP1.21 – vlastiti SMTP klijent protiv lažnog poslužitelja u procesu testa (uvijek se izvodi, bez Dockera). */
const mail = (over: Partial<OutgoingMail> = {}): OutgoingMail => ({
  from: { address: 'arqus@institucija.hr', name: 'ArQus Projekti' },
  to: { address: 'ana.horvat@institucija.hr', name: 'Ana Horvat' },
  subject: 'Pozivnica u ArQus Projekti – Sveučilište u Đakovu (čćžšđ ČĆŽŠĐ €)',
  text: 'Pozdrav, Ana!\n.\nRedak s točkom na početku:\n.točka\n',
  html: '<p>Pozdrav, Ana!</p>',
  ...over,
});

let servers: FakeServer[] = [];
const fake = async (...a: Parameters<typeof startFakeSmtp>) => { const s = await startFakeSmtp(...a); servers.push(s); return s; };
afterEach(async () => { await Promise.all(servers.map((s) => s.close())); servers = []; });

const cfg = (port: number, over: Partial<SmtpConfig> = {}): SmtpConfig => ({ host: 'localhost', port, security: 'starttls', ca: TEST_CERT, timeoutMs: 2000, retries: 2, retryDelaysMs: [10, 10, 10], heloName: 'arqus.test', ...over });
const fails = async (p: Promise<unknown>): Promise<SmtpError & { attempts?: number }> => {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(SmtpError); return e as SmtpError; }
  throw new Error('očekivana greška');
};
/** Dekodiranje RFC 2047 encoded-words (B) i spajanje presavijenih redaka zaglavlja. */
const decodeHeader = (v: string) => v.replace(/\r\n /g, '').replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, b: string) => `\u0001${b}`)
  .split('\u0001').filter(Boolean).map((b) => Buffer.from(b, 'base64')).reduce((a, x) => Buffer.concat([a, x]), Buffer.alloc(0)).toString('utf8');
const header = (data: string, name: string) => new RegExp(`^${name}: (.*(?:\\r\\n .*)*)`, 'm').exec(data)?.[1] ?? '';

describe('SMTP klijent (WP1.21) – lažni poslužitelj', () => {
  it('STARTTLS + AUTH PLAIN: TLS prije vjerodajnica, EHLO ponovljen, ispravna poruka (zaglavlja, base64, Message-ID, Date)', async () => {
    const s = await fake({ starttls: true, auth: ['PLAIN', 'LOGIN'], user: 'arqus', pass: 'tajna-€-lozinka' });
    const r = await smtpSend(cfg(s.port, { user: 'arqus', password: 'tajna-€-lozinka' }), mail({ date: new Date('2026-11-18T13:05:00Z') }));
    expect(r.attempts).toBe(1);
    const sess = s.sessions[0]!;
    const verbs = sess.commands.map((c) => `${c.tls ? 'T' : 'P'}:${c.line.split(' ')[0]}`);
    expect(verbs).toEqual(['P:EHLO', 'P:STARTTLS', 'T:EHLO', 'T:AUTH', 'T:MAIL', 'T:RCPT', 'T:DATA', 'T:QUIT']);
    expect(sess.commands[0]!.line).toBe('EHLO arqus.test');
    expect(sess.commands.find((c) => c.line.startsWith('MAIL'))!.line).toBe('MAIL FROM:<arqus@institucija.hr>');
    expect(sess.commands.find((c) => c.line.startsWith('RCPT'))!.line).toBe('RCPT TO:<ana.horvat@institucija.hr>');
    expect(sess.tlsAtData).toBe(true);
    const d = sess.data;
    expect(decodeHeader(header(d, 'Subject'))).toBe(mail().subject);
    expect(decodeHeader(header(d, 'From').replace(/ <.*>$/, ''))).toBe('ArQus Projekti');
    expect(header(d, 'From')).toMatch(/<arqus@institucija\.hr>$/);
    expect(header(d, 'To')).toMatch(/<ana\.horvat@institucija\.hr>$/);
    expect(header(d, 'Date')).toBe('Wed, 18 Nov 2026 13:05:00 +0000');
    expect(header(d, 'Message-ID')).toMatch(/^<[0-9a-f]{32}@institucija\.hr>$/);
    expect(header(d, 'MIME-Version')).toBe('1.0');
    expect(header(d, 'Content-Type')).toMatch(/^multipart\/alternative; boundary="arqus-[0-9a-f]+"$/);
    const parts = d.split(/--arqus-[0-9a-f]+/);
    const body = (type: string) => { const p = parts.find((x) => x.includes(`Content-Type: ${type}; charset=UTF-8`))!; return Buffer.from(p.split('\r\n\r\n')[1]!.replace(/\r\n/g, ''), 'base64').toString('utf8'); };
    expect(body('text/plain')).toBe(mail().text);
    expect(body('text/html')).toBe(mail().html);
    expect(d.split('\r\n').every((l) => l.length <= 998)).toBe(true);
  });

  it('AUTH LOGIN kad poslužitelj ne nudi PLAIN; krive vjerodajnice → trajna greška „auth” bez ponavljanja', async () => {
    const s = await fake({ starttls: true, auth: ['LOGIN'], user: 'u', pass: 'p' });
    await smtpSend(cfg(s.port, { user: 'u', password: 'p' }), mail());
    expect(s.sessions[0]!.commands.map((c) => c.line)).toContain('AUTH LOGIN');
    const e = await fails(smtpSend(cfg(s.port, { user: 'u', password: 'kriva' }), mail()));
    expect(e.cls).toBe('auth'); expect(e.temporary).toBe(false); expect(e.attempts).toBe(1);
    expect(s.sessions.at(-1)!.commands.some((c) => c.line.startsWith('MAIL'))).toBe(false);
  });

  it('implicitni TLS (465)', async () => {
    const s = await fake({ implicitTls: true });
    await smtpSend(cfg(s.port, { security: 'tls' }), mail());
    expect(s.sessions[0]!.commands.every((c) => c.tls)).toBe(true);
  });

  it('nepouzdan certifikat i krivo ime poslužitelja → „tls”, ništa se ne šalje', async () => {
    const s = await fake({ starttls: true, auth: ['PLAIN'], user: 'u', pass: 'p' });
    const untrusted = await fails(smtpSend(cfg(s.port, { ca: undefined, user: 'u', password: 'p' }), mail()));
    expect(untrusted.cls).toBe('tls'); expect(untrusted.temporary).toBe(false);
    const other = await fake({ starttls: true, cert: OTHER_CERT, key: OTHER_KEY });
    const mismatch = await fails(smtpSend(cfg(other.port, { ca: OTHER_CERT }), mail()));
    expect(mismatch.cls).toBe('tls');
    const implicit = await fake({ implicitTls: true, cert: OTHER_CERT, key: OTHER_KEY });
    expect((await fails(smtpSend(cfg(implicit.port, { security: 'tls', ca: OTHER_CERT }), mail()))).cls).toBe('tls');
    for (const srv of [s, other, implicit]) for (const sess of srv.sessions) expect(sess.commands.filter((c) => /^(AUTH|MAIL|RCPT|DATA)/.test(c.line))).toEqual([]);
  });

  it('bez STARTTLS-a nema slanja (nema pada na nešifriranu vezu); vjerodajnice se nikad ne šalju bez TLS-a', async () => {
    const s = await fake({ starttls: false, auth: ['PLAIN'], user: 'u', pass: 'p' });
    expect((await fails(smtpSend(cfg(s.port, { user: 'u', password: 'p' }), mail()))).cls).toBe('tls');
    expect((await fails(smtpSend(cfg(s.port, { security: 'none', user: 'u', password: 'p' }), mail()))).cls).toBe('auth');
    for (const sess of s.sessions) expect(sess.commands.filter((c) => /^(AUTH|MAIL)/.test(c.line))).toEqual([]);
    // Izričito nešifrirano (lokalni testni poslužitelj), bez vjerodajnica: radi.
    await smtpSend(cfg(s.port, { security: 'none' }), mail());
    expect(s.sessions.at(-1)!.data).toContain('Subject:');
  });

  it('ubacivanje naredbi uz STARTTLS (podaci prije TLS-a) → „protocol”', async () => {
    const s = await fake({ starttls: true, injectAfterStarttls: true });
    expect((await fails(smtpSend(cfg(s.port), mail()))).cls).toBe('protocol');
  });

  it('privremena greška (4xx) se ponavlja i uspije; trajna (5xx) se ne ponavlja; uporna privremena staje nakon ograničenog broja', async () => {
    const t = await fake({ failFirst: { cmd: 'RCPT', times: 1, reply: '451 4.3.0 pokušaj kasnije' } });
    expect((await smtpSend(cfg(t.port, { security: 'none' }), mail())).attempts).toBe(2);
    const g = await fake({ failFirst: { cmd: 'GREETING', times: 1, reply: '421 4.3.2 zauzeto' } });
    expect((await smtpSend(cfg(g.port, { security: 'none' }), mail())).attempts).toBe(2);
    const p = await fake({ replies: { RCPT: '550 5.1.1 nema pretinca' } });
    const perm = await fails(smtpSend(cfg(p.port, { security: 'none' }), mail()));
    expect(perm.cls).toBe('rejected'); expect(perm.attempts).toBe(1); expect(p.connections).toBe(1);
    const always = await fake({ replies: { END: '452 4.2.2 pretinac pun' } });
    const e = await fails(smtpSend(cfg(always.port, { security: 'none', retries: 2 }), mail()));
    expect(e.cls).toBe('temporary'); expect(e.temporary).toBe(true); expect(e.attempts).toBe(3); expect(always.connections).toBe(3);
  });

  it('šutljiv i spor poslužitelj → istek vremena (spajanje, pozdrav, svaka razmjena); odbijena veza → „connection”', async () => {
    const silent = await fake({ greeting: null });
    const t0 = Date.now();
    const e1 = await fails(smtpSend(cfg(silent.port, { security: 'none', timeoutMs: 300, retries: 0 }), mail()));
    expect(e1.cls).toBe('timeout'); expect(Date.now() - t0).toBeLessThan(2000);
    const slow = await fake({ delayEndMs: 1500 });
    expect((await fails(smtpSend(cfg(slow.port, { security: 'none', timeoutMs: 300, retries: 0 }), mail()))).cls).toBe('timeout');
    const mute = await fake({ replies: { MAIL: null } });
    expect((await fails(smtpSend(cfg(mute.port, { security: 'none', timeoutMs: 300, retries: 0 }), mail()))).cls).toBe('timeout');
    const closed = await fake(); const port = closed.port; await closed.close(); servers = servers.filter((x) => x !== closed);
    const e2 = await fails(smtpSend(cfg(port, { security: 'none', retries: 0 }), mail()));
    expect(e2.cls).toBe('connection'); expect(e2.temporary).toBe(true);
    const huge = await fake({ hugeEhlo: true });
    expect((await fails(smtpSend(cfg(huge.port, { security: 'none', retries: 0 }), mail()))).cls).toBe('protocol');
  });

  it('ubacivanje zaglavlja ili naredbi (CR, LF, NUL) odbija se PRIJE spajanja', async () => {
    const s = await fake();
    const bad: [string, Partial<OutgoingMail> | Partial<SmtpConfig>, 'mail' | 'cfg'][] = [
      ['primatelj s CRLF', { to: { address: 'ana@institucija.hr\r\nRCPT TO:<napadac@zlo.hr>' } }, 'mail'],
      ['primatelj s > i naredbom', { to: { address: 'ana@institucija.hr>\r\nDATA' } }, 'mail'],
      ['primatelj s NUL', { to: { address: 'ana@institucija.hr\0' } }, 'mail'],
      ['primatelj bez @', { to: { address: 'ana' } }, 'mail'],
      ['primatelj s razmakom', { to: { address: 'ana horvat@institucija.hr' } }, 'mail'],
      ['primatelj s uglatim zagradama', { to: { address: '<ana@institucija.hr>' } }, 'mail'],
      ['pošiljatelj s LF', { from: { address: 'a@b.hr\nBcc: x@y.hr' } }, 'mail'],
      ['naslov s LF', { subject: 'Naslov\nBcc: napadac@zlo.hr' }, 'mail'],
      ['naslov s CR', { subject: 'Naslov\rX: y' }, 'mail'],
      ['naslov s NUL', { subject: 'Naslov\0' }, 'mail'],
      ['ime primatelja s CRLF', { to: { address: 'ana@institucija.hr', name: 'Ana\r\nBcc: napadac@zlo.hr' } }, 'mail'],
      ['ime pošiljatelja s LF', { from: { address: 'arqus@institucija.hr', name: 'ArQus\nX: y' } }, 'mail'],
      ['Message-ID s CRLF', { messageId: '<a@b>\r\nBcc: x@y.hr' }, 'mail'],
      ['korisnik s CRLF', { user: 'u\r\nMAIL FROM:<x@y.hr>', password: 'p' }, 'cfg'],
      ['lozinka s LF', { user: 'u', password: 'p\nQUIT' }, 'cfg'],
      ['poslužitelj s CRLF', { host: 'localhost\r\n' }, 'cfg'],
      ['EHLO ime s razmakom', { heloName: 'a b' }, 'cfg'],
    ];
    for (const [what, over, kind] of bad) {
      const e = await fails(kind === 'mail' ? smtpSend(cfg(s.port, { security: 'none' }), mail(over as Partial<OutgoingMail>)) : smtpSend(cfg(s.port, { security: 'none', ...(over as Partial<SmtpConfig>) }), mail()));
      expect(e.cls, what).toBe('invalid');
    }
    expect(s.connections).toBe(0);
  });

  it('kodiranje naslova: dijelovi ≤ 75 znakova, UTF-8 znak nikad prelomljen, dekodirano jednako izvorniku', () => {
    const subject = `${'Đurđevac čćžšđ '.repeat(12)}🙂 kraj`;
    const enc = encodeWords(subject);
    for (const w of enc.split('\r\n ')) { expect(w.length).toBeLessThanOrEqual(75); expect(Buffer.from(w.slice(10, -2), 'base64').toString('utf8')).not.toContain('�'); }
    expect(decodeHeader(enc)).toBe(subject);
    const msg = buildMessage(mail({ subject }));
    expect(msg.split('\r\n').every((l) => l.length <= 998)).toBe(true);
    expect(msg.split('\r\n').some((l) => l.startsWith('.'))).toBe(false);
  });
});
