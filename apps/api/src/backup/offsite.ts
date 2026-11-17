import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createDecryptStream, createEncryptStream, keyFingerprint } from './backup-crypto';
import type { S3Client } from '../storage/s3-client';

/**
 * Kopije izvan poslužitelja (WP1.20, ADR-0012). Servis `backup` piše `arqus-<UTC>.dump` (svaki sat) i
 * `documents-<datum>.tar.gz` (dnevno, samo uz lokalnu pohranu dokumenata) u volumen `backups`; ova sinkronizacija
 * svaku novu datoteku šifrira NA POSLUŽITELJU (`backup-crypto.ts`), šalje u S3 kao `<naziv>.enc`, briše udaljene
 * kopije starije od razdoblja čuvanja (nikad najnoviju kopiju baze ni najnoviju arhivu dokumenata) i zapisuje stanje
 * u `offsite-status.json`. Neuspjeh: zapis na razini greške, izlazni kod ≠ 0, stanje `ok: false`; `backup status`
 * (provjera zdravlja servisa `offsite`) javlja i predugo vrijeme od zadnje uspješne kopije.
 */

export interface RemoteObject { key: string; size: number; lastModified: Date }
export interface RemoteStore {
  list(): AsyncIterable<RemoteObject>;
  putFile(key: string, path: string, size: number, sha256: string): Promise<void>;
  getStream(key: string): Promise<{ stream: Readable; size: number } | null>;
  delete(key: string): Promise<void>;
}

export function s3Remote(client: S3Client): RemoteStore {
  return {
    list: () => client.list(''),
    putFile: async (key, path, size, sha256) => { await client.put(key, { path, size, sha256 }); },
    getStream: (key) => client.getStream(key),
    delete: (key) => client.delete(key),
  };
}

const NAME = /^(?:arqus-(\d{8})T(\d{6})Z\.dump|documents-(\d{8})\.tar\.gz)$/;
export type BackupKind = 'dump' | 'documents';

/** Vrsta i vrijeme kopije iz naziva (deterministično; ne ovisi o satu pružatelja). */
export function parseBackupName(name: string): { kind: BackupKind; time: Date } | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const d = m[1] ?? m[3]!; const t = m[2] ?? '000000';
  const time = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`);
  return Number.isNaN(time.getTime()) ? null : { kind: m[1] ? 'dump' : 'documents', time };
}

export interface OffsiteStatus {
  lastRunAt: string;
  ok: boolean;
  /** Zadnje izvođenje bez greške (sve nove datoteke poslane). */
  lastSuccessAt: string | null;
  error?: string;
  uploaded: string[];
  pruned: string[];
  remote: { count: number; latestDump: string | null; latestDocuments: string | null };
  keyFingerprint: string;
}

export interface SyncOptions {
  /** Volumen s kopijama (`/backups`). */
  dir: string;
  /** Direktorij za stanje i privremene šifrirane datoteke (`/data/offsite`). */
  stateDir: string;
  remote: RemoteStore;
  key: Buffer;
  retentionDays: number;
  now?: () => Date;
  log?: { info: (m: string) => void; error: (m: string) => void };
}

export const STATUS_FILE = 'offsite-status.json';

export async function readStatus(stateDir: string): Promise<OffsiteStatus | null> {
  try { return JSON.parse(await readFile(join(stateDir, STATUS_FILE), 'utf8')) as OffsiteStatus; } catch { return null; }
}

async function writeStatus(stateDir: string, s: OffsiteStatus): Promise<void> {
  const tmp = join(stateDir, `${STATUS_FILE}.${randomUUID()}.tmp`);
  await writeFile(tmp, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o644 });
  await rename(tmp, join(stateDir, STATUS_FILE));
}

/** Šifrira datoteku u `out` (privremeno ime pa preimenovanje); vraća veličinu i SHA-256 šifrata. */
export async function encryptFile(input: string, out: string, key: Buffer): Promise<{ size: number; sha256: string }> {
  const h = createHash('sha256'); let size = 0;
  const tap = new Transform({ transform(c: Buffer, _e, cb) { h.update(c); size += c.length; cb(null, c); } });
  const tmp = `${out}.${randomUUID()}.tmp`;
  try { await pipeline(createReadStream(input), createEncryptStream(key), tap, createWriteStream(tmp, { mode: 0o600 })); await rename(tmp, out); }
  catch (e) { await rm(tmp, { force: true }); throw e; }
  return { size, sha256: h.digest('hex') };
}

/** Dešifrira tok u `out`; izlazna datoteka nastaje tek ako je provjerena cijela kopija. */
export async function decryptToFile(src: Readable, out: string, key: Buffer): Promise<void> {
  const tmp = `${out}.${randomUUID()}.tmp`;
  try { await pipeline(src, createDecryptStream(key), createWriteStream(tmp, { mode: 0o600 })); await rename(tmp, out); }
  catch (e) { await rm(tmp, { force: true }); throw e; }
}

const latestOf = (names: string[], kind: BackupKind) => names.map((n) => ({ n, p: parseBackupName(n) })).filter((x) => x.p?.kind === kind)
  .sort((a, b) => b.p!.time.getTime() - a.p!.time.getTime())[0]?.n ?? null;

export async function syncOffsite(o: SyncOptions): Promise<OffsiteStatus> {
  const now = o.now ?? (() => new Date());
  const log = o.log ?? { info: () => undefined, error: () => undefined };
  const started = now();
  const prev = await readStatus(o.stateDir);
  const status: OffsiteStatus = { lastRunAt: started.toISOString(), ok: false, lastSuccessAt: prev?.lastSuccessAt ?? null, uploaded: [], pruned: [], remote: prev?.remote ?? { count: 0, latestDump: null, latestDocuments: null }, keyFingerprint: keyFingerprint(o.key) };
  const cutoff = started.getTime() - o.retentionDays * 24 * 3600 * 1000;
  const tmpDir = join(o.stateDir, 'tmp');
  try {
    await mkdir(tmpDir, { recursive: true, mode: 0o700 });
    const remote = new Map<string, RemoteObject>();
    for await (const r of o.remote.list()) remote.set(r.key, r);
    // Nove datoteke, najnovije prvo (kod zastoja najprije stiže najsvježija kopija); starije od razdoblja čuvanja se ne šalju.
    const local = (await readdir(o.dir)).map((n) => ({ n, p: parseBackupName(n) }))
      .filter((x): x is { n: string; p: { kind: BackupKind; time: Date } } => !!x.p && x.p.time.getTime() >= cutoff && !remote.has(`${x.n}.enc`))
      .sort((a, b) => b.p.time.getTime() - a.p.time.getTime());
    for (const { n } of local) {
      const enc = join(tmpDir, `${n}.enc`);
      try {
        const { size, sha256 } = await encryptFile(join(o.dir, n), enc, o.key);
        await o.remote.putFile(`${n}.enc`, enc, size, sha256);
        remote.set(`${n}.enc`, { key: `${n}.enc`, size, lastModified: now() });
        status.uploaded.push(n);
        log.info(`izvan poslužitelja: ${n}.enc (${(size / 1024 / 1024).toFixed(1)} MB)`);
      } finally { await rm(enc, { force: true }); }
    }
    // Čuvanje: briše se samo ono što prepoznajemo po nazivu, nikad najnovija kopija baze ni najnovija arhiva dokumenata.
    const names = [...remote.keys()].filter((k) => k.endsWith('.enc')).map((k) => k.slice(0, -4)).filter((n) => parseBackupName(n));
    const keep = new Set([latestOf(names, 'dump'), latestOf(names, 'documents')].filter((x): x is string => !!x));
    for (const n of names) {
      if (keep.has(n) || parseBackupName(n)!.time.getTime() >= cutoff) continue;
      await o.remote.delete(`${n}.enc`);
      remote.delete(`${n}.enc`);
      status.pruned.push(n);
    }
    const left = [...remote.keys()].filter((k) => k.endsWith('.enc')).map((k) => k.slice(0, -4));
    status.remote = { count: left.length, latestDump: latestOf(left, 'dump'), latestDocuments: latestOf(left, 'documents') };
    status.ok = true;
    status.lastSuccessAt = now().toISOString();
    log.info(`izvan poslužitelja: poslano ${status.uploaded.length}, obrisano ${status.pruned.length}, udaljeno ${status.remote.count}; najnovija kopija baze ${status.remote.latestDump ?? '–'}`);
  } catch (e) {
    status.error = (e as Error).message;
    log.error(`[GREŠKA] kopija izvan poslužitelja nije uspjela: ${status.error} (zadnja uspješna: ${status.lastSuccessAt ?? 'nikad'})`);
  }
  await writeStatus(o.stateDir, status).catch((e: unknown) => log.error(`[GREŠKA] stanje kopije izvan poslužitelja nije zapisano: ${(e as Error).message}`));
  return status;
}

/**
 * Provjera stanja za nadzor: problem ako nema stanja, zadnje izvođenje nije uspjelo, zadnja uspješna sinkronizacija
 * ili najnovija kopija baze izvan poslužitelja stariji su od `maxAgeHours`.
 */
export async function checkOffsite(stateDir: string, maxAgeHours: number, now: Date = new Date()): Promise<{ ok: boolean; problems: string[]; status: OffsiteStatus | null }> {
  const s = await readStatus(stateDir);
  if (!s) return { ok: false, problems: ['kopija izvan poslužitelja još nije napravljena (nema offsite-status.json)'], status: null };
  const problems: string[] = [];
  const age = (iso: string | null) => (iso ? (now.getTime() - new Date(iso).getTime()) / 3600000 : Infinity);
  if (!s.ok) problems.push(`zadnje izvođenje (${s.lastRunAt}) nije uspjelo: ${s.error ?? 'nepoznato'}`);
  if (age(s.lastSuccessAt) > maxAgeHours) problems.push(`zadnja uspješna sinkronizacija ${s.lastSuccessAt ?? 'nikad'} – starija od ${maxAgeHours} h`);
  const latest = s.remote.latestDump ? parseBackupName(s.remote.latestDump)?.time.toISOString() ?? null : null;
  if (age(latest) > maxAgeHours) problems.push(`najnovija kopija baze izvan poslužitelja ${s.remote.latestDump ?? 'ne postoji'} – starija od ${maxAgeHours} h (radi li servis backup?)`);
  return { ok: problems.length === 0, problems, status: s };
}

/**
 * Obnova: preuzima i dešifrira najnoviju kopiju baze (ili najnoviju do `at`) i najnoviju arhivu dokumenata koja nije
 * novija od te kopije baze. Vraća putanje dešifriranih datoteka.
 */
export async function fetchLatest(o: { remote: RemoteStore; key: Buffer; dir: string; at?: Date; documents?: boolean; log?: (m: string) => void }): Promise<{ dump: string; documents: string | null }> {
  const names: string[] = [];
  for await (const r of o.remote.list()) if (r.key.endsWith('.enc') && parseBackupName(r.key.slice(0, -4))) names.push(r.key.slice(0, -4));
  const limit = o.at?.getTime() ?? Infinity;
  const dump = latestOf(names.filter((n) => parseBackupName(n)!.time.getTime() <= limit), 'dump');
  if (!dump) throw new Error('U bucketu nema kopije baze (arqus-*.dump.enc)' + (o.at ? ` do ${o.at.toISOString()}` : ''));
  const dumpTime = parseBackupName(dump)!.time.getTime();
  // Uz DOCUMENTS_STORAGE=s3 arhiva dokumenata nije potrebna (dokumenti su u bucketu) – `documents: false`.
  const documents = o.documents === false ? null : latestOf(names.filter((n) => parseBackupName(n)!.time.getTime() <= dumpTime), 'documents');
  await mkdir(o.dir, { recursive: true });
  const out: { dump: string; documents: string | null } = { dump: join(o.dir, dump), documents: documents ? join(o.dir, documents) : null };
  for (const n of [dump, documents].filter((x): x is string => !!x)) {
    const g = await o.remote.getStream(`${n}.enc`);
    if (!g) throw new Error(`${n}.enc je nestao iz bucketa tijekom preuzimanja`);
    await decryptToFile(g.stream, join(o.dir, n), o.key);
    o.log?.(`preuzeto i provjereno: ${n} (${((await stat(join(o.dir, n))).size / 1024 / 1024).toFixed(1)} MB)`);
  }
  return out;
}
