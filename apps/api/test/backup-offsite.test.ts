import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { CHUNK, HEADER_LEN, createDecryptStream, createEncryptStream, keyFingerprint, parseBackupKey } from '../src/backup/backup-crypto';
import { checkOffsite, fetchLatest, parseBackupName, readStatus, syncOffsite, type RemoteObject, type RemoteStore } from '../src/backup/offsite';

/** WP1.20 – šifriranje kopija (AES-256-GCM u odsječcima) i sinkronizacija izvan poslužitelja s lažnim satom i spremištem. */
const KEY = randomBytes(32);
const collect = async (r: Readable) => { const p: Buffer[] = []; for await (const c of r) p.push(c as Buffer); return Buffer.concat(p); };
const enc = (plain: Buffer, key = KEY) => collect(Readable.from([plain]).pipe(createEncryptStream(key)));
const dec = (data: Buffer, key = KEY, pieces = 7777) => {
  const parts: Buffer[] = []; for (let i = 0; i < data.length; i += pieces) parts.push(data.subarray(i, i + pieces));
  return collect(Readable.from(parts.length ? parts : [Buffer.alloc(0)]).pipe(createDecryptStream(key)));
};

describe('šifriranje kopija', () => {
  it('povratno za rubne veličine (0, 1, točno odsječak, odsječak + 1, više odsječaka)', async () => {
    for (const n of [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK, 1_000_003]) {
      const plain = randomBytes(n);
      const e = await enc(plain);
      expect(e.subarray(0, 8).toString()).toBe('ARQUSBK1');
      const chunks = Math.max(1, Math.ceil(n / CHUNK));
      expect(e.length).toBe(HEADER_LEN + n + 16 * chunks);
      expect((await dec(e)).equals(plain)).toBe(true);
    }
  });

  it('isti sadržaj dvaput daje različit šifrat (nasumična sol)', async () => {
    const p = Buffer.from('ista kopija');
    expect((await enc(p)).equals(await enc(p))).toBe(false);
  });

  it('izmjena bilo kojeg bajta, skraćivanje, uklanjanje zadnjeg odsječka i zamjena zaglavlja se otkrivaju', async () => {
    const plain = randomBytes(2 * CHUNK + 500);
    const e = await enc(plain);
    for (const pos of [HEADER_LEN + 10, HEADER_LEN + CHUNK + 16 + 3, e.length - 1, 20 /* sol u zaglavlju */]) {
      const t = Buffer.from(e); t[pos] = t[pos]! ^ 1;
      await expect(dec(t)).rejects.toThrow(/cjelovitosti/);
    }
    // skraćeno na granici odsječka (zadnji odsječak uklonjen) – prethodni nije označen kao zadnji
    await expect(dec(e.subarray(0, HEADER_LEN + 2 * (CHUNK + 16)))).rejects.toThrow(/cjelovitosti/);
    await expect(dec(e.subarray(0, e.length - 5))).rejects.toThrow(/cjelovitosti|skraćena/);
    await expect(dec(e.subarray(0, 30))).rejects.toThrow(/skraćena/);
    // zaglavlje druge datoteke istim ključem
    const other = await enc(randomBytes(10));
    await expect(dec(Buffer.concat([other.subarray(0, HEADER_LEN), e.subarray(HEADER_LEN)]))).rejects.toThrow(/cjelovitosti/);
  });

  it('kriv ključ: jasna poruka s otiscima (ne ključevima)', async () => {
    const other = randomBytes(32);
    const e = await enc(Buffer.from('tajni podaci'));
    const err = await dec(e, other).catch((x: unknown) => x as Error);
    expect(err.message).toMatch(/drugim ključem/);
    expect(err.message).toContain(keyFingerprint(KEY));
    expect(err.message).not.toContain(KEY.toString('base64'));
    await expect(dec(Buffer.from('nije kopija nego obična datoteka iz drugog izvora, dovoljno duga za zaglavlje'))).rejects.toThrow(/nepoznato zaglavlje/);
  });

  it('ključ iz okruženja: točno 32 bajta u base64', () => {
    expect(parseBackupKey(KEY.toString('base64')).equals(KEY)).toBe(true);
    expect(() => parseBackupKey(undefined)).toThrow(/nije postavljen/);
    expect(() => parseBackupKey(randomBytes(16).toString('base64'))).toThrow(/32 bajta/);
    expect(() => parseBackupKey('ovo nije base64 !!!')).toThrow(/32 bajta/);
  });
});

/** Spremište u memoriji (S3 nad MinIO-m pokriva `backup-s3.test.ts`). */
class MemoryRemote implements RemoteStore {
  objects = new Map<string, { data: Buffer; lastModified: Date }>();
  failPut = false; puts = 0;
  constructor(private readonly now: () => Date) {}
  async *list(): AsyncGenerator<RemoteObject> { for (const [key, o] of this.objects) yield { key, size: o.data.length, lastModified: o.lastModified }; }
  async putFile(key: string, path: string): Promise<void> { this.puts++; if (this.failPut) throw new Error('S3 put: veza nije uspjela (ECONNREFUSED)'); this.objects.set(key, { data: readFileSync(path), lastModified: this.now() }); }
  async getStream(key: string) { const o = this.objects.get(key); return o ? { stream: Readable.from([o.data]), size: o.data.length } : null; }
  async delete(key: string): Promise<void> { this.objects.delete(key); }
}

describe('sinkronizacija izvan poslužitelja (lažni sat)', () => {
  let dir = ''; let state = ''; let clock = new Date(); let remote: MemoryRemote;
  const now = () => clock;
  const logs: string[] = []; const errors: string[] = [];
  const log = { info: (m: string) => logs.push(m), error: (m: string) => errors.push(m) };
  const run = () => syncOffsite({ dir, stateDir: state, remote, key: KEY, retentionDays: 30, now, log });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arqus-backups-')); state = mkdtempSync(join(tmpdir(), 'arqus-offsite-'));
    clock = new Date('2026-11-17T12:05:00Z'); remote = new MemoryRemote(now); logs.length = 0; errors.length = 0;
  });

  it('nazivi kopija', () => {
    expect(parseBackupName('arqus-20261117T120000Z.dump')).toEqual({ kind: 'dump', time: new Date('2026-11-17T12:00:00Z') });
    expect(parseBackupName('documents-20261117.tar.gz')).toEqual({ kind: 'documents', time: new Date('2026-11-17T00:00:00Z') });
    for (const n of ['arqus-20261117T120000Z.dump.tmp', 'prije-nadogradnje.dump', 'documents-2026111.tar.gz', 'offsite-status.json']) expect(parseBackupName(n)).toBeNull();
  });

  it('nova datoteka se šifrira i šalje; ponovno pokretanje ne šalje ništa; privremene datoteke uklonjene', async () => {
    const dump = randomBytes(200_000);
    writeFileSync(join(dir, 'arqus-20261117T120000Z.dump'), dump);
    writeFileSync(join(dir, 'documents-20261117.tar.gz'), Buffer.from('arhiva'));
    writeFileSync(join(dir, 'arqus-20261117T130000Z.dump.tmp'), Buffer.from('nedovršeno'));
    const s1 = await run();
    expect(s1).toMatchObject({ ok: true, uploaded: ['arqus-20261117T120000Z.dump', 'documents-20261117.tar.gz'], pruned: [], remote: { count: 2, latestDump: 'arqus-20261117T120000Z.dump', latestDocuments: 'documents-20261117.tar.gz' }, lastSuccessAt: clock.toISOString() });
    expect([...remote.objects.keys()].sort()).toEqual(['arqus-20261117T120000Z.dump.enc', 'documents-20261117.tar.gz.enc']);
    const stored = remote.objects.get('arqus-20261117T120000Z.dump.enc')!.data;
    expect(stored.includes(dump.subarray(0, 64))).toBe(false); // šifrirano
    expect((await dec(stored)).equals(dump)).toBe(true);
    expect(readdirSync(join(state, 'tmp'))).toEqual([]);
    clock = new Date('2026-11-17T12:20:00Z');
    const s2 = await run();
    expect(s2).toMatchObject({ ok: true, uploaded: [] });
    expect(remote.puts).toBe(2);
    expect((await readStatus(state))!.lastSuccessAt).toBe('2026-11-17T12:20:00.000Z');
  });

  it('čuvanje: brišu se udaljene kopije starije od razdoblja, nikad najnovija kopija baze i arhiva; starije lokalne se ne šalju', async () => {
    const put = (name: string) => remote.objects.set(`${name}.enc`, { data: Buffer.from('x'), lastModified: clock });
    put('arqus-20261001T000000Z.dump'); put('arqus-20261016T000000Z.dump'); put('documents-20261001.tar.gz'); put('drugo/nepoznato');
    writeFileSync(join(dir, 'arqus-20261010T000000Z.dump'), Buffer.from('stara lokalna'));
    let s = await run();
    // 30 dana prije 2026-11-17T12:05 = 2026-10-18T12:05; najnovija arhiva dokumenata (iz 1. 10.) ostaje jer je jedina
    expect(s.pruned.sort()).toEqual(['arqus-20261001T000000Z.dump']);
    expect(s.uploaded).toEqual([]);
    expect([...remote.objects.keys()].sort()).toEqual(['arqus-20261016T000000Z.dump.enc', 'documents-20261001.tar.gz.enc', 'drugo/nepoznato.enc']);
    // ako servis backup stane, zadnja kopija baze ostaje i nakon isteka razdoblja čuvanja
    clock = new Date('2027-03-01T00:00:00Z');
    s = await run();
    expect(s.pruned).toEqual([]);
    // nova kopija stigne → stara (sada ne najnovija) se briše
    writeFileSync(join(dir, 'arqus-20270301T000000Z.dump'), Buffer.from('nova'));
    s = await run();
    expect(s).toMatchObject({ uploaded: ['arqus-20270301T000000Z.dump'], pruned: ['arqus-20261016T000000Z.dump'] });
  });

  it('neuspjeh je glasan: greška u zapisu, ok=false, zadnja uspješna ostaje; status javlja problem i zastarjelost', async () => {
    writeFileSync(join(dir, 'arqus-20261117T120000Z.dump'), Buffer.from('a'));
    await run();
    clock = new Date('2026-11-17T13:05:00Z');
    writeFileSync(join(dir, 'arqus-20261117T130000Z.dump'), Buffer.from('b'));
    remote.failPut = true;
    const s = await run();
    expect(s).toMatchObject({ ok: false, lastSuccessAt: '2026-11-17T12:05:00.000Z', uploaded: [] });
    expect(s.error).toMatch(/ECONNREFUSED/);
    expect(errors.join('\n')).toMatch(/\[GREŠKA\] kopija izvan poslužitelja nije uspjela.*zadnja uspješna: 2026-11-17T12:05/);
    expect(readdirSync(join(state, 'tmp'))).toEqual([]);
    const c = await checkOffsite(state, 3, new Date('2026-11-17T13:06:00Z'));
    expect(c.ok).toBe(false);
    expect(c.problems[0]).toMatch(/nije uspjelo/);
    // oporavak
    remote.failPut = false;
    expect((await run()).ok).toBe(true);
    expect((await checkOffsite(state, 3, new Date('2026-11-17T14:00:00Z'))).ok).toBe(true);
    // tišina: nema novih uspješnih izvođenja ni novih kopija baze → nakon 3 h problem
    const stale = await checkOffsite(state, 3, new Date('2026-11-17T18:00:00Z'));
    expect(stale.ok).toBe(false);
    expect(stale.problems.join(' ')).toMatch(/starija od 3 h/);
  });

  it('status bez ijednog izvođenja je problem', async () => {
    const c = await checkOffsite(state, 3);
    expect(c).toMatchObject({ ok: false, status: null });
  });

  it('preuzimanje za obnovu: najnovija kopija baze (ili do zadanog trenutka) i arhiva dokumenata koja nije novija', async () => {
    for (const [n, body] of [['arqus-20261116T230000Z.dump', 'd1'], ['arqus-20261117T120000Z.dump', 'd2'], ['documents-20261116.tar.gz', 'a1'], ['documents-20261117.tar.gz', 'a2']] as const) writeFileSync(join(dir, n), body);
    await run();
    const out = mkdtempSync(join(tmpdir(), 'arqus-restore-'));
    const r = await fetchLatest({ remote, key: KEY, dir: out });
    expect(readFileSync(r.dump, 'utf8')).toBe('d2');
    expect(readFileSync(r.documents!, 'utf8')).toBe('a2');
    const r2 = await fetchLatest({ remote, key: KEY, dir: join(out, 'ranije'), at: new Date('2026-11-16T23:30:00Z') });
    expect(readFileSync(r2.dump, 'utf8')).toBe('d1');
    expect(readFileSync(r2.documents!, 'utf8')).toBe('a1');
    expect((await fetchLatest({ remote, key: KEY, dir: join(out, 'bez-dok'), documents: false })).documents).toBeNull();
    // izmijenjena udaljena kopija: obnova odbija, djelomična datoteka ne ostaje
    const o = remote.objects.get('arqus-20261117T120000Z.dump.enc')!; o.data = Buffer.from(o.data); o.data[o.data.length - 3] ^= 1;
    const bad = join(out, 'losa');
    await expect(fetchLatest({ remote, key: KEY, dir: bad })).rejects.toThrow(/cjelovitosti/);
    expect(existsSync(join(bad, 'arqus-20261117T120000Z.dump'))).toBe(false);
    expect(readdirSync(bad)).toEqual([]);
  });
});
