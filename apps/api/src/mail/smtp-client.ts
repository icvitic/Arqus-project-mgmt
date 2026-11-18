import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { randomBytes } from 'node:crypto';

/**
 * WP1.21 – minimalni SMTP klijent za predaju pošte JEDNOM konfiguriranom relayu (RFC 5321 / 6409 / 3207 / 4954), bez
 * vanjskih ovisnosti (kao S3 SigV4, ZIP i XLSX u ovom projektu). Opseg je namjerno uzak:
 * - implicitni TLS (465) ili STARTTLS (587); TLS ≥ 1.2 i provjera certifikata i imena poslužitelja UVIJEK; nešifrirana
 *   veza samo izričitom postavkom `none` (lokalni testni poslužitelj) i tada se vjerodajnice nikad ne šalju;
 * - EHLO, STARTTLS, AUTH PLAIN i LOGIN, jedan primatelj po poruci, tekst UTF-8 i HTML kao alternativa (base64), zaglavlja
 *   kodirana po RFC 2047, Message-ID i Date;
 * - vremensko ograničenje na spajanje i na SVAKU razmjenu; najviše `maxReplyBytes` po odgovoru;
 * - ograničen broj ponovnih pokušaja samo za privremene greške (4xx, prekid veze, istek vremena).
 * Zaglavlja i omotnica ne mogu se ubaciti: CR, LF i NUL u bilo čemu što ide u zaglavlje ili naredbu odbijaju se PRIJE
 * spajanja, adrese su ograničene na ASCII oblik `lokalni@domena`, a imena i naslov uvijek se kodiraju (base64 encoded-word).
 */

export type SmtpSecurity = 'tls' | 'starttls' | 'none';
export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  user?: string;
  password?: string;
  /** Ime u EHLO (zadano `localhost`). */
  heloName?: string;
  /** Istek spajanja i svake razmjene (ms). */
  timeoutMs?: number;
  /** Dodatni CA certifikat(i) u PEM-u (npr. vlastiti CA relaya); sistemski CA-ovi ostaju. */
  ca?: string | Buffer;
  /** Ponovni pokušaji za privremene greške (zadano 2) i razmaci (ms). */
  retries?: number;
  retryDelaysMs?: number[];
  maxReplyBytes?: number;
}
export interface MailAddress { address: string; name?: string }
export interface OutgoingMail { from: MailAddress; to: MailAddress; subject: string; text: string; html: string; date?: Date; messageId?: string }

/** Kratka oznaka greške – jedino što se o neuspjehu sprema (bez teksta odgovora poslužitelja). */
export type SmtpErrorClass = 'invalid' | 'timeout' | 'connection' | 'tls' | 'auth' | 'rejected' | 'temporary' | 'protocol';
export class SmtpError extends Error {
  constructor(readonly cls: SmtpErrorClass, readonly temporary: boolean, message: string) { super(message); this.name = 'SmtpError'; }
}

const UNSAFE = /[\r\n\0]/;
/** Adresa: ASCII `lokalni@domena` (bez komentara, navodnika, uglatih zagrada i razmaka), najviše 254 znaka. */
const ADDRESS = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Odbija CR, LF i NUL (ubacivanje zaglavlja ili naredbe). */
export function assertHeaderSafe(value: string, what: string): void {
  if (typeof value !== 'string' || UNSAFE.test(value)) throw new SmtpError('invalid', false, `${what}: nedopušteni znak (CR, LF ili NUL)`);
}

export function assertAddress(address: string, what: string): void {
  assertHeaderSafe(address, what);
  if (address.length > 254 || !ADDRESS.test(address)) throw new SmtpError('invalid', false, `${what}: neispravna e-adresa`);
}

/** RFC 2047 encoded-word (base64), dijelovi ≤ 75 znakova, granica nikad usred UTF-8 znaka; dijelovi odvojeni CRLF + razmak. */
export function encodeWords(value: string): string {
  const words: string[] = [];
  let cur: number[] = [];
  const flush = () => { if (cur.length) words.push(`=?UTF-8?B?${Buffer.from(cur).toString('base64')}?=`); cur = []; };
  for (const ch of value) {
    const bytes = [...Buffer.from(ch, 'utf8')];
    if (cur.length + bytes.length > 45) flush(); // 45 B → 60 znakova base64 + 12 = 72 ≤ 75
    cur.push(...bytes);
  }
  flush();
  return words.join('\r\n ') || '=?UTF-8?B??=';
}

const formatAddress = (a: MailAddress) => (a.name ? `${encodeWords(a.name)} <${a.address}>` : `<${a.address}>`);
const base64Lines = (s: string) => (Buffer.from(s, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
/** RFC 5322 datum u UTC-u (`Wed, 18 Nov 2026 14:05:00 +0000`). */
export const rfc5322Date = (d: Date) => d.toUTCString().replace(/GMT$/, '+0000');

/** Provjera poruke (sve prije spajanja). */
export function validateMail(m: OutgoingMail): void {
  assertAddress(m.from.address, 'Pošiljatelj');
  assertAddress(m.to.address, 'Primatelj');
  if (m.from.name !== undefined) assertHeaderSafe(m.from.name, 'Ime pošiljatelja');
  if (m.to.name !== undefined) assertHeaderSafe(m.to.name, 'Ime primatelja');
  assertHeaderSafe(m.subject, 'Naslov');
  if (m.messageId !== undefined) { assertHeaderSafe(m.messageId, 'Message-ID'); if (!/^<[\x21-\x7e]{3,250}>$/.test(m.messageId) || /[<>].*[<>].*[<>]/.test(m.messageId)) throw new SmtpError('invalid', false, 'Message-ID: neispravan'); }
}

/** Cijela poruka (RFC 5322 + MIME multipart/alternative), retci CRLF; tijela u base64 (nema dugih redaka ni točke na početku). */
export function buildMessage(m: OutgoingMail): string {
  validateMail(m);
  const domain = m.from.address.split('@')[1]!;
  const boundary = `arqus-${randomBytes(12).toString('hex')}`;
  const headers = [
    `Date: ${rfc5322Date(m.date ?? new Date())}`,
    `From: ${formatAddress(m.from)}`,
    `To: ${formatAddress(m.to)}`,
    `Subject: ${encodeWords(m.subject)}`,
    `Message-ID: ${m.messageId ?? `<${randomBytes(16).toString('hex')}@${domain}>`}`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type: string, body: string) => [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', base64Lines(body)].join('\r\n');
  return [...headers, '', part('text/plain', m.text), part('text/html', m.html), `--${boundary}--`, ''].join('\r\n');
}

/** Dot-stuffing (RFC 5321, 4.5.2) i završetak DATA. */
const dataPayload = (msg: string) => `${msg.replace(/\r\n\./g, '\r\n..').replace(/^\./, '..')}${msg.endsWith('\r\n') ? '' : '\r\n'}.\r\n`;

interface Reply { code: number; lines: string[] }

/** Jedna SMTP veza: čitanje odgovora s istekom vremena i ograničenjem veličine, naredbe, STARTTLS. */
class Connection {
  private buf = '';
  private waiter: { resolve: (r: Reply) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null;
  private failure: Error | null = null;
  secure: boolean;

  constructor(private socket: Socket | TLSSocket, secure: boolean, private readonly timeoutMs: number, private readonly maxReply: number) {
    this.secure = secure;
    this.attach();
  }

  private attach(): void {
    this.socket.on('data', this.onData);
    this.socket.on('error', this.onError);
    this.socket.on('close', this.onClose);
  }
  private detach(): void {
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
  }

  private onData = (chunk: Buffer | string) => {
    this.buf += typeof chunk === 'string' ? chunk : chunk.toString('latin1'); // odgovori su ASCII; latin1 ne lomi bajtove
    if (this.buf.length > this.maxReply) { this.fail(new SmtpError('protocol', false, 'Odgovor poslužitelja je prevelik')); return; }
    this.tryResolve();
  };
  private onError = (e: Error) => this.fail(classifySocketError(e));
  private onClose = () => this.fail(new SmtpError('connection', true, 'Poslužitelj je zatvorio vezu'));

  private fail(e: Error): void {
    this.failure ??= e;
    if (this.waiter) { clearTimeout(this.waiter.timer); const w = this.waiter; this.waiter = null; w.reject(this.failure); }
  }

  private tryResolve(): void {
    if (!this.waiter) return;
    const lines: string[] = [];
    let rest = this.buf;
    for (;;) {
      const i = rest.indexOf('\r\n');
      if (i < 0) return; // odgovor još nije cijel
      const line = rest.slice(0, i); rest = rest.slice(i + 2);
      if (!/^\d{3}([ -]|$)/.test(line)) { this.fail(new SmtpError('protocol', false, 'Neispravan odgovor poslužitelja')); return; }
      lines.push(line);
      if (line.length === 3 || line[3] === ' ') {
        const code = Number(line.slice(0, 3));
        if (lines.some((l) => Number(l.slice(0, 3)) !== code)) { this.fail(new SmtpError('protocol', false, 'Neispravan višeredni odgovor')); return; }
        this.buf = rest;
        clearTimeout(this.waiter.timer); const w = this.waiter; this.waiter = null;
        w.resolve({ code, lines: lines.map((l) => l.slice(4)) });
        return;
      }
    }
  }

  read(): Promise<Reply> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new SmtpError('timeout', true, 'Poslužitelj ne odgovara (istek vremena)')), this.timeoutMs);
      this.waiter = { resolve, reject, timer };
      this.tryResolve();
    });
  }

  /** Naredba (bez CR/LF – provjereno prije) i očekivani kodovi odgovora. */
  async cmd(line: string, expect: number[], phase: 'auth' | 'mail' | 'other' = 'other', logLine?: string): Promise<Reply> {
    if (UNSAFE.test(line)) throw new SmtpError('invalid', false, `Nedopušteni znak u naredbi ${logLine ?? ''}`.trim());
    this.socket.write(`${line}\r\n`);
    return this.expect(await this.read(), expect, phase);
  }

  expect(r: Reply, expect: number[], phase: 'auth' | 'mail' | 'other' = 'other'): Reply {
    if (expect.includes(r.code)) return r;
    if (r.code >= 400 && r.code < 500) throw new SmtpError('temporary', true, `Privremena greška poslužitelja (${r.code})`);
    if (phase === 'auth' && r.code >= 500) throw new SmtpError('auth', false, `Prijava na poslužitelj nije uspjela (${r.code})`);
    if (r.code >= 500) throw new SmtpError('rejected', false, `Poslužitelj je odbio poruku (${r.code})`);
    throw new SmtpError('protocol', false, `Neočekivan odgovor poslužitelja (${r.code})`);
  }

  write(data: string): void { this.socket.write(data); }

  /** STARTTLS: ostatak nešifriranog međuspremnika nakon 220 znači ubacivanje naredbi (RFC 3207, 6) → prekid. */
  async upgrade(host: string, ca: string | Buffer | undefined): Promise<void> {
    if (this.buf.length) throw new SmtpError('protocol', false, 'Poslužitelj je poslao podatke prije TLS-a');
    this.detach();
    const plain = this.socket;
    this.socket = await secureSocket({ socket: plain as Socket, host, ca, timeoutMs: this.timeoutMs });
    this.secure = true;
    this.attach();
  }

  close(): void { this.detach(); this.socket.on('error', () => undefined); this.socket.destroy(); }
  async quit(): Promise<void> {
    try { this.socket.write('QUIT\r\n'); await Promise.race([this.read(), new Promise((r) => setTimeout(r, 1000))]); } catch { /* svejedno zatvaramo */ }
    this.close();
  }
}

function classifySocketError(e: Error & { code?: string }): SmtpError {
  if (e instanceof SmtpError) return e;
  const code = e.code ?? '';
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|ERR_SSL|HOSTNAME|ALTNAME/.test(code) || /certificate|SSL|TLS/i.test(e.message)) return new SmtpError('tls', false, 'TLS veza nije uspostavljena (certifikat ili protokol)');
  return new SmtpError('connection', true, `Veza s poslužiteljem nije uspjela${code ? ` (${code})` : ''}`);
}

function secureSocket(o: { socket?: Socket; host: string; port?: number; ca?: string | Buffer; timeoutMs: number }): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const servername = /^[\d.]+$|:/.test(o.host) ? undefined : o.host; // SNI samo za imena, ne za IP adrese
    const s = tlsConnect({ ...(o.socket ? { socket: o.socket } : { host: o.host, port: o.port }), servername, ca: o.ca, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
    const timer = setTimeout(() => { s.destroy(); reject(new SmtpError('timeout', true, 'TLS veza nije uspostavljena na vrijeme')); }, o.timeoutMs);
    s.once('secureConnect', () => {
      clearTimeout(timer);
      // rejectUnauthorized već odbija nepouzdan certifikat i krivo ime; ovo je obrana u dubinu.
      if (!s.authorized) { s.destroy(); reject(new SmtpError('tls', false, 'Certifikat poslužitelja nije pouzdan')); return; }
      resolve(s);
    });
    s.once('error', (e) => { clearTimeout(timer); s.destroy(); const c = classifySocketError(e); reject(c.cls === 'connection' && !o.socket ? c : new SmtpError(c.cls === 'timeout' ? 'timeout' : 'tls', c.cls === 'timeout', c.message)); });
  });
}

function plainSocket(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = netConnect({ host, port });
    const timer = setTimeout(() => { s.destroy(); reject(new SmtpError('timeout', true, 'Spajanje na poslužitelj nije uspjelo na vrijeme')); }, timeoutMs);
    s.once('connect', () => { clearTimeout(timer); s.removeAllListeners('error'); resolve(s); });
    s.once('error', (e) => { clearTimeout(timer); reject(classifySocketError(e)); });
  });
}

/** Jedan pokušaj predaje poruke. */
async function attempt(cfg: SmtpConfig, mail: OutgoingMail, message: string): Promise<void> {
  const timeoutMs = cfg.timeoutMs ?? 15_000;
  const maxReply = cfg.maxReplyBytes ?? 64 * 1024;
  const socket = cfg.security === 'tls'
    ? await secureSocket({ host: cfg.host, port: cfg.port, ca: cfg.ca, timeoutMs })
    : await plainSocket(cfg.host, cfg.port, timeoutMs);
  const c = new Connection(socket, cfg.security === 'tls', timeoutMs, maxReply);
  try {
    c.expect(await c.read(), [220]);
    const helo = cfg.heloName ?? 'localhost';
    let ehlo = await c.cmd(`EHLO ${helo}`, [250]);
    if (cfg.security === 'starttls') {
      // Bez STARTTLS-a nema slanja (nema tihog pada na nešifriranu vezu).
      if (!ehlo.lines.some((l) => /^STARTTLS\b/i.test(l))) throw new SmtpError('tls', false, 'Poslužitelj ne nudi STARTTLS');
      await c.cmd('STARTTLS', [220]);
      await c.upgrade(cfg.host, cfg.ca);
      ehlo = await c.cmd(`EHLO ${helo}`, [250]); // RFC 3207: nakon TLS-a sve se zaboravlja i ponovno pita
    }
    if (cfg.user) {
      if (!c.secure) throw new SmtpError('auth', false, 'Vjerodajnice se ne šalju nešifriranom vezom');
      const auth = ehlo.lines.find((l) => /^AUTH[ =]/i.test(l))?.slice(5).toUpperCase().split(/\s+/) ?? [];
      const user = cfg.user, pass = cfg.password ?? '';
      if (auth.includes('PLAIN')) {
        await c.cmd(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`, 'utf8').toString('base64')}`, [235], 'auth', 'AUTH PLAIN');
      } else if (auth.includes('LOGIN')) {
        await c.cmd('AUTH LOGIN', [334], 'auth');
        await c.cmd(Buffer.from(user, 'utf8').toString('base64'), [334], 'auth', 'AUTH LOGIN (korisnik)');
        await c.cmd(Buffer.from(pass, 'utf8').toString('base64'), [235], 'auth', 'AUTH LOGIN (lozinka)');
      } else throw new SmtpError('auth', false, 'Poslužitelj ne nudi AUTH PLAIN ni LOGIN');
    }
    await c.cmd(`MAIL FROM:<${mail.from.address}>`, [250], 'mail');
    await c.cmd(`RCPT TO:<${mail.to.address}>`, [250, 251], 'mail');
    await c.cmd('DATA', [354], 'mail');
    c.write(dataPayload(message));
    c.expect(await c.read(), [250], 'mail');
    await c.quit();
  } catch (e) {
    c.close();
    throw e instanceof SmtpError ? e : classifySocketError(e as Error);
  }
}

/** Provjera postavki koje ne ovise o poruci (host, port, vjerodajnice) – prije spajanja. */
export function validateConfig(cfg: SmtpConfig): void {
  assertHeaderSafe(cfg.host, 'SMTP poslužitelj');
  if (!/^[A-Za-z0-9.-]+$|^\[?[0-9a-fA-F:.]+\]?$/.test(cfg.host)) throw new SmtpError('invalid', false, 'SMTP poslužitelj: neispravno ime');
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) throw new SmtpError('invalid', false, 'SMTP port: neispravan');
  if (!['tls', 'starttls', 'none'].includes(cfg.security)) throw new SmtpError('invalid', false, 'SMTP sigurnost: tls, starttls ili none');
  assertHeaderSafe(cfg.heloName ?? 'localhost', 'EHLO ime');
  if (!/^[A-Za-z0-9.-]+$/.test(cfg.heloName ?? 'localhost')) throw new SmtpError('invalid', false, 'EHLO ime: neispravno');
  if (cfg.user !== undefined) assertHeaderSafe(cfg.user, 'SMTP korisnik');
  if (cfg.password !== undefined) assertHeaderSafe(cfg.password, 'SMTP lozinka');
}

/**
 * Predaja jedne poruke jednom primatelju. Sve provjere (adrese, zaglavlja, postavke) prije spajanja; privremene greške
 * (4xx, prekid veze, istek vremena) ponavljaju se najviše `retries` puta, trajne (5xx, TLS, prijava, neispravan ulaz) nikad.
 */
export async function smtpSend(cfg: SmtpConfig, mail: OutgoingMail): Promise<{ attempts: number }> {
  validateConfig(cfg);
  const message = buildMessage(mail);
  const retries = Math.max(0, Math.min(5, cfg.retries ?? 2));
  const delays = cfg.retryDelaysMs ?? [2_000, 8_000, 20_000];
  for (let n = 0; ; n++) {
    try {
      await attempt(cfg, mail, message);
      return { attempts: n + 1 };
    } catch (e) {
      const err = e instanceof SmtpError ? e : classifySocketError(e as Error);
      if (!err.temporary || n >= retries) { (err as SmtpError & { attempts?: number }).attempts = n + 1; throw err; }
      await new Promise((r) => setTimeout(r, delays[Math.min(n, delays.length - 1)] ?? 1000));
    }
  }
}
