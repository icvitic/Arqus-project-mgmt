import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Pohrana sadržaja dokumenata. Sada lokalni direktorij (DOCUMENTS_DIR, u produkciji Docker volumen);
 * isto sučelje dobit će S3-kompatibilnu izvedbu kad se odabere EU pružatelj (ADR-0010).
 * Ključ: <tenantId>/<uuid> – nikad iz korisničkog unosa, pa nema obilaska putanje.
 */
@Injectable()
export class DocumentStorage {
  private readonly root = resolve(process.env.DOCUMENTS_DIR ?? join(process.cwd(), 'data', 'documents'));
  private static readonly KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

  private path(key: string): string {
    if (!DocumentStorage.KEY.test(key)) throw new Error('Neispravan ključ pohrane');
    return join(this.root, key);
  }

  async put(tenantId: string, content: Buffer): Promise<string> {
    const key = `${tenantId}/${randomUUID()}`;
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true, mode: 0o700 });
    await writeFile(`${p}.tmp`, content, { mode: 0o600, flag: 'wx' });
    await rename(`${p}.tmp`, p);
    return key;
  }

  get(key: string): Promise<Buffer> { return readFile(this.path(key)); }

  /** Samo za čišćenje nakon neuspjele transakcije (verzije se inače nikad ne brišu). */
  async discard(key: string): Promise<void> { await rm(this.path(key), { force: true }); }
}
