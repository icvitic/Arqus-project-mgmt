import { createServer, type Server, type Socket } from 'node:net';
import { createServer as createTlsServer, TLSSocket } from 'node:tls';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * WP1.21 – lažni SMTP poslužitelj za testove klijenta (u procesu testa). Ključ i certifikat u `test/fixtures/smtp-*.{key,crt}`
 * su SAMO za testove (samopotpisani, CN=localhost odnosno other.example; nisu tajna).
 */
export const TEST_CERT = readFileSync(join(__dirname, 'fixtures', 'smtp-test.crt'));
export const TEST_KEY = readFileSync(join(__dirname, 'fixtures', 'smtp-test.key'));
export const OTHER_CERT = readFileSync(join(__dirname, 'fixtures', 'smtp-other.crt'));
export const OTHER_KEY = readFileSync(join(__dirname, 'fixtures', 'smtp-other.key'));

export interface FakeScript {
  /** Implicitni TLS od prvog bajta (port 465). */
  implicitTls?: boolean;
  cert?: Buffer; key?: Buffer;
  /** null = nikad ne pozdravi (šuti). */
  greeting?: string | null;
  starttls?: boolean;
  /** Nakon `220` na STARTTLS u istom paketu pošalji još jedan redak (ubacivanje naredbi). */
  injectAfterStarttls?: boolean;
  /** Mehanizmi u EHLO (`AUTH PLAIN LOGIN`); prazno = bez AUTH. */
  auth?: string[];
  user?: string; pass?: string;
  /** Zamjenski odgovori po naredbi; `null` = ne odgovori nikad. Ključ: EHLO, MAIL, RCPT, DATA, END (kraj podataka), AUTH. */
  replies?: Partial<Record<'EHLO' | 'MAIL' | 'RCPT' | 'DATA' | 'END' | 'AUTH', string | null>>;
  /** Odgovor samo za prvih `times` sesija (privremena greška pa uspjeh). */
  failFirst?: { cmd: 'MAIL' | 'RCPT' | 'END' | 'GREETING'; times: number; reply: string };
  /** Odgovor na kraj podataka nakon `ms` milisekundi (spori poslužitelj). */
  delayEndMs?: number;
  /** Ogroman odgovor na EHLO. */
  hugeEhlo?: boolean;
}

export interface FakeSession { commands: { line: string; tls: boolean }[]; data: string; tlsAtData: boolean }

export interface FakeServer { port: number; sessions: FakeSession[]; connections: number; close(): Promise<void> }

export async function startFakeSmtp(script: FakeScript = {}): Promise<FakeServer> {
  const sessions: FakeSession[] = [];
  const state = { connections: 0 };
  const cert = script.cert ?? TEST_CERT; const key = script.key ?? TEST_KEY;
  const handle = (raw: Socket | TLSSocket, initiallyTls: boolean) => {
    state.connections++;
    const sessionNo = sessions.length;
    const s: FakeSession = { commands: [], data: '', tlsAtData: false };
    sessions.push(s);
    let sock: Socket | TLSSocket = raw; let tls = initiallyTls; let buf = ''; let inData = false; let authStep: 'user' | 'pass' | null = null; let loginUser = '';
    const failing = (cmd: string) => script.failFirst && script.failFirst.cmd === cmd && sessionNo < script.failFirst.times;
    const send = (line: string | null | undefined) => { if (line !== null && line !== undefined) sock.write(`${line}\r\n`); };
    const ehlo = () => {
      if (script.replies?.EHLO !== undefined) return send(script.replies.EHLO);
      if (script.hugeEhlo) return send(`250-${'x'.repeat(100_000)}\r\n250 OK`);
      const ext = ['250-fake.local pozdrav', '250-8BITMIME', ...(script.starttls && !tls ? ['250-STARTTLS'] : []), ...(script.auth?.length ? [`250-AUTH ${script.auth.join(' ')}`] : []), '250 SIZE 10000000'];
      sock.write(ext.join('\r\n') + '\r\n');
    };
    const onLine = (line: string) => {
      if (inData) {
        if (line === '.') {
          inData = false;
          const reply = failing('END') ? script.failFirst!.reply : script.replies?.END !== undefined ? script.replies.END : '250 2.0.0 primljeno';
          if (script.delayEndMs) setTimeout(() => send(reply), script.delayEndMs); else send(reply);
        } else s.data += `${line}\r\n`;
        return;
      }
      s.commands.push({ line, tls });
      if (authStep === 'user') { loginUser = Buffer.from(line, 'base64').toString(); authStep = 'pass'; return send('334 UGFzc3dvcmQ6'); }
      if (authStep === 'pass') { authStep = null; return send(loginUser === script.user && Buffer.from(line, 'base64').toString() === script.pass ? '235 2.7.0 OK' : '535 5.7.8 krivo'); }
      const verb = line.split(' ')[0]!.toUpperCase();
      if (verb === 'EHLO') return ehlo();
      if (verb === 'STARTTLS') {
        if (!script.starttls || tls) return send('502 nema');
        sock.removeAllListeners('data');
        sock.write(script.injectAfterStarttls ? '220 kreni\r\n250 ubaceno\r\n' : '220 kreni\r\n');
        const secure = new TLSSocket(sock as Socket, { isServer: true, key, cert });
        sock = secure; tls = true; buf = '';
        attach();
        return;
      }
      if (verb === 'AUTH') {
        if (script.replies?.AUTH !== undefined) return send(script.replies.AUTH);
        const [, mech, arg] = line.split(' ');
        if (mech === 'PLAIN') { const [, u, p] = Buffer.from(arg ?? '', 'base64').toString().split('\0'); return send(u === script.user && p === script.pass ? '235 2.7.0 OK' : '535 5.7.8 krivo'); }
        if (mech === 'LOGIN') { authStep = 'user'; return send('334 VXNlcm5hbWU6'); }
        return send('504 mehanizam');
      }
      if (verb === 'MAIL') return send(failing('MAIL') ? script.failFirst!.reply : script.replies?.MAIL !== undefined ? script.replies.MAIL : '250 OK');
      if (verb === 'RCPT') return send(failing('RCPT') ? script.failFirst!.reply : script.replies?.RCPT !== undefined ? script.replies.RCPT : '250 OK');
      if (verb === 'DATA') { const r = script.replies?.DATA !== undefined ? script.replies.DATA : '354 kraj s <CRLF>.<CRLF>'; if (r?.startsWith('354')) { inData = true; s.tlsAtData = tls; } return send(r); }
      if (verb === 'QUIT') { send('221 bok'); sock.end(); return; }
      send('500 nepoznato');
    };
    const attach = () => {
      sock.on('data', (chunk: Buffer) => {
        buf += chunk.toString('latin1');
        for (let i = buf.indexOf('\r\n'); i >= 0; i = buf.indexOf('\r\n')) { const line = buf.slice(0, i); buf = buf.slice(i + 2); onLine(line); }
      });
      sock.on('error', () => undefined);
    };
    attach();
    if (failing('GREETING')) { send(script.failFirst!.reply); sock.end(); return; }
    if (script.greeting !== null) send(script.greeting ?? '220 fake.local ESMTP spreman');
  };
  const server: Server = script.implicitTls
    ? createTlsServer({ key, cert }, (sk) => handle(sk, true))
    : createServer((sk) => handle(sk, false));
  const open = new Set<Socket>();
  server.on('connection', (c: Socket) => { open.add(c); c.on('close', () => open.delete(c)); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return {
    port, sessions, get connections() { return state.connections; },
    close: () => new Promise<void>((r) => { for (const c of open) c.destroy(); server.close(() => r()); }),
  };
}
