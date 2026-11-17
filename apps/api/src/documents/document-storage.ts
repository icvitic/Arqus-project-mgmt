import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { S3ResponseError, S3UnavailableError } from '../storage/s3-client';
import { backendFromEnv, type DocumentBackend, type ObjectInfo, type StorageKind } from './storage-backends';

/** Ključ pohrane: `<tenantId>/<uuid>` – uvijek ga generira poslužitelj, nikad iz korisničkog unosa. */
export const STORAGE_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
const assertKey = (key: string) => { if (!STORAGE_KEY.test(key)) throw new Error('Neispravan ključ pohrane'); };

/** Sadržaj ne odgovara zapisu u bazi: nedostaje ili se razlikuje (veličina ili SHA-256). */
export class DocumentIntegrityError extends Error {
  constructor(readonly reason: 'missing' | 'mismatch') { super(reason === 'missing' ? 'datoteka nedostaje u pohrani' : 'sadržaj se ne slaže s pohranjenim SHA-256'); }
}

export const STORAGE_UNAVAILABLE = 'Pohrana dokumenata trenutno nije dostupna – pokušaj ponovno za nekoliko minuta. Ako se ponavlja, obavijesti administratora.';

/** SHA-256 i veličina toka bez držanja sadržaja u memoriji. */
export async function hashStream(stream: Readable): Promise<{ sha256: string; size: number }> {
  const h = createHash('sha256'); let size = 0;
  for await (const chunk of stream) { const b = chunk as Buffer; h.update(b); size += b.length; }
  return { sha256: h.digest('hex'), size };
}

/**
 * Pohrana sadržaja dokumenata (ADR-0010): lokalni direktorij (`DOCUMENTS_DIR`) ili S3-kompatibilna pohrana
 * (`DOCUMENTS_STORAGE=s3`, WP1.20) – izvedbe u `storage-backends.ts`. Ovaj sloj daje ključeve, provjeru cjelovitosti
 * i jednoliko ponašanje kad pohrana nije dostupna: zahtjev završava s 503 i kratkom porukom (bez konfiguracije),
 * a pojedinosti idu u zapis poslužitelja (bez tajni).
 */
@Injectable()
export class DocumentStorage {
  private readonly log = new Logger('DocumentStorage');
  readonly backend: DocumentBackend;
  private readyCache?: { at: number; result: Promise<boolean> };

  constructor() { this.backend = backendFromEnv(process.env); }

  get kind(): StorageKind { return this.backend.kind; }

  private async guard<T>(op: string, key: string, fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (e) {
      if (e instanceof S3UnavailableError || e instanceof S3ResponseError || isIoError(e)) {
        this.log.error(`Pohrana (${this.kind}) ${op} ${key}: ${(e as Error).message}`);
        throw new ServiceUnavailableException(STORAGE_UNAVAILABLE);
      }
      throw e;
    }
  }

  async put(tenantId: string, content: Buffer): Promise<string> {
    const key = `${tenantId}/${randomUUID()}`;
    assertKey(key);
    await this.guard('put', key, () => this.backend.put(key, content));
    return key;
  }

  /** Cijeli sadržaj (bez provjere hasha – za provjeru `readVerified`). */
  async get(key: string): Promise<Buffer> {
    assertKey(key);
    return this.guard('get', key, async () => {
      const o = await this.backend.getStream(key);
      if (!o) throw new DocumentIntegrityError('missing');
      const parts: Buffer[] = [];
      for await (const c of o.stream) parts.push(c as Buffer);
      return Buffer.concat(parts);
    });
  }

  /**
   * Sadržaj s provjerom veličine i SHA-256 prije nego što ijedan bajt ode korisniku. Dokument je najviše 25 MB, pa je
   * u memoriji najviše jedna takva datoteka; tok se prekida čim veličina premaši očekivanu.
   */
  async readVerified(key: string, sha256: string, size: number): Promise<Buffer> {
    assertKey(key);
    return this.guard('get', key, async () => {
      const o = await this.backend.getStream(key);
      if (!o) throw new DocumentIntegrityError('missing');
      if (Number.isFinite(o.size) && o.size !== size) { o.stream.destroy(); throw new DocumentIntegrityError('mismatch'); }
      const parts: Buffer[] = []; let n = 0;
      for await (const c of o.stream) { n += (c as Buffer).length; if (n > size) { o.stream.destroy(); throw new DocumentIntegrityError('mismatch'); } parts.push(c as Buffer); }
      const content = Buffer.concat(parts);
      if (content.length !== size || createHash('sha256').update(content).digest('hex') !== sha256) throw new DocumentIntegrityError('mismatch');
      return content;
    });
  }

  /** Provjera cjelovitosti strujanjem (bez sadržaja u memoriji). */
  async verify(key: string, sha256: string, size: number): Promise<'ok' | 'missing' | 'mismatch'> {
    assertKey(key);
    return this.guard('verify', key, async () => {
      const o = await this.backend.getStream(key);
      if (!o) return 'missing';
      if (Number.isFinite(o.size) && o.size !== size) { o.stream.destroy(); return 'mismatch'; }
      const h = await hashStream(o.stream);
      return h.size === size && h.sha256 === sha256 ? 'ok' : 'mismatch';
    });
  }

  async stream(key: string): Promise<{ stream: Readable; size: number } | null> { assertKey(key); return this.guard('get', key, () => this.backend.getStream(key)); }

  /** Samo za čišćenje nakon neuspjele transakcije (verzije se inače nikad ne brišu). */
  async discard(key: string): Promise<void> {
    assertKey(key);
    try { await this.backend.delete(key); } catch (e) { this.log.error(`Pohrana (${this.kind}) discard ${key}: ${(e as Error).message} – ostaje siroče (documents verify)`); }
  }

  /** Brisanje svih objekata institucije (samo demo reset). */
  async removeTenant(tenantId: string): Promise<number> {
    if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw new Error('Neispravan id stanara');
    const keys: string[] = [];
    for await (const o of this.backend.list(`${tenantId}/`)) keys.push(o.key);
    for (const k of keys) await this.backend.delete(k);
    return keys.length;
  }

  list(prefix?: string): AsyncIterable<ObjectInfo> { return this.backend.list(prefix); }

  /**
   * Spremnost: je li pohrana dostupna. Rezultat se pamti 10 s, da javna ruta spremnosti ne može svakim zahtjevom
   * izazvati zahtjev prema pružatelju pohrane.
   */
  ready(): Promise<boolean> {
    const now = Date.now();
    if (this.readyCache && now - this.readyCache.at < 10_000) return this.readyCache.result;
    const result = this.backend.check().then(() => true, (e: unknown) => { this.log.error(`Pohrana (${this.kind}) nije dostupna: ${(e as Error).message}`); return false; });
    this.readyCache = { at: now, result };
    return result;
  }
}

function isIoError(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && ['EACCES', 'EIO', 'ENOSPC', 'EROFS', 'EMFILE', 'ENFILE', 'EPERM', 'ENOTDIR'].includes(code);
}
