import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, constants, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { S3Client, s3ConfigFromEnv, s3Configured } from '../storage/s3-client';

/**
 * Izvedbe pohrane sadržaja dokumenata iza jednog ugovora (ADR-0010, WP1.20): lokalni direktorij i S3-kompatibilna pohrana.
 * Odabir: `DOCUMENTS_STORAGE=local|s3` (zadano `local`). Ključeve generira poslužitelj (`<tenantId>/<uuid>`); ovdje se
 * ključ samo provjerava i preslikava (lokalno u putanju ispod korijena, u S3 u ključ objekta s prefiksom).
 *
 * Jamstva obje izvedbe (provjerava ih zajednički skup testova `test/storage-contract.test.ts`):
 * - zapis je atomičan – objekt je vidljiv tek cijeli (lokalno privremena datoteka + rename, S3 PUT je atomičan
 *   i potpisan SHA-256 tijela pa poslužitelj odbija oštećen prijenos);
 * - čitanje kao tok, s veličinom; nepostojeći objekt je `null` (ne greška);
 * - popis svih objekata (za provjeru i prijenos), brisanje samo za čišćenje neuspjelog prijenosa i demo.
 */

export type StorageKind = 'local' | 's3';
export interface ObjectInfo { key: string; size: number; lastModified: Date }

export interface DocumentBackend {
  readonly kind: StorageKind;
  put(key: string, content: Buffer): Promise<void>;
  getStream(key: string): Promise<{ stream: Readable; size: number } | null>;
  head(key: string): Promise<{ size: number; lastModified: Date } | null>;
  delete(key: string): Promise<void>;
  /** Svi objekti čiji ključ počinje s `prefix` (redoslijed nije zajamčen). */
  list(prefix?: string): AsyncIterable<ObjectInfo>;
  /** Dostupnost za spremnost: baca ako pohrana nije dostupna. */
  check(): Promise<void>;
}

export class LocalBackend implements DocumentBackend {
  readonly kind = 'local' as const;
  readonly root: string;
  constructor(root?: string) { this.root = resolve(root ?? process.env.DOCUMENTS_DIR ?? join(process.cwd(), 'data', 'documents')); }

  private path(key: string): string {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('Neispravan ključ pohrane');
    return p;
  }

  async put(key: string, content: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true, mode: 0o700 });
    const tmp = `${p}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, content, { mode: 0o600, flag: 'wx' });
      await rename(tmp, p);
    } catch (e) { await rm(tmp, { force: true }); throw e; }
  }

  async getStream(key: string): Promise<{ stream: Readable; size: number } | null> {
    const h = await this.head(key);
    if (!h) return null;
    return { stream: createReadStream(this.path(key)), size: h.size };
  }

  async head(key: string): Promise<{ size: number; lastModified: Date } | null> {
    try { const s = await stat(this.path(key)); return s.isFile() ? { size: s.size, lastModified: s.mtime } : null; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }

  async delete(key: string): Promise<void> { await rm(this.path(key), { force: true }); }

  async *list(prefix = ''): AsyncGenerator<ObjectInfo> {
    const walk = async function* (dir: string): AsyncGenerator<string> {
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) yield* walk(p); else if (e.isFile()) yield p;
      }
    };
    for await (const p of walk(this.root)) {
      const key = relative(this.root, p).split(sep).join('/');
      if (!key.startsWith(prefix)) continue;
      const s = await stat(p).catch(() => null);
      if (s) yield { key, size: s.size, lastModified: s.mtime };
    }
  }

  async check(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await access(this.root, constants.R_OK | constants.W_OK);
  }
}

export class S3Backend implements DocumentBackend {
  readonly kind = 's3' as const;
  constructor(readonly client: S3Client) {}
  async put(key: string, content: Buffer): Promise<void> { await this.client.put(key, content); }
  getStream(key: string) { return this.client.getStream(key); }
  async head(key: string) { const h = await this.client.head(key); return h ? { size: h.size, lastModified: h.lastModified } : null; }
  delete(key: string) { return this.client.delete(key); }
  async *list(prefix = ''): AsyncGenerator<ObjectInfo> { for await (const o of this.client.list(prefix)) yield { key: o.key, size: o.size, lastModified: o.lastModified }; }
  check() { return this.client.check(); }
}

/** Izvedba po nazivu; `s3Prefix` odabire skup varijabli (`DOCUMENTS_S3_` ili `DOCUMENTS_MIRROR_S3_` za drugi bucket). */
export function createBackend(kind: StorageKind, env: NodeJS.ProcessEnv = process.env, s3Prefix = 'DOCUMENTS_S3_'): DocumentBackend {
  if (kind === 'local') return new LocalBackend(env.DOCUMENTS_DIR);
  return new S3Backend(new S3Client(s3ConfigFromEnv(env, s3Prefix)));
}

export function storageKindFromEnv(env: NodeJS.ProcessEnv = process.env): StorageKind {
  const v = (env.DOCUMENTS_STORAGE ?? '').trim().toLowerCase() || 'local';
  if (v !== 'local' && v !== 's3') throw new Error(`DOCUMENTS_STORAGE mora biti "local" ili "s3" (sada "${v}")`);
  if (v === 'local' && s3Configured(env, 'DOCUMENTS_S3_') && env.NODE_ENV === 'production') {
    console.warn('Upozorenje: DOCUMENTS_S3_* je postavljen, ali DOCUMENTS_STORAGE nije "s3" – dokumenti se spremaju lokalno.');
  }
  return v;
}

export const backendFromEnv = (env: NodeJS.ProcessEnv = process.env): DocumentBackend => createBackend(storageKindFromEnv(env), env);
