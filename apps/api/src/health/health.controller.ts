import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Public } from '../identity/auth.guard';
import { DocumentStorage } from '../documents/document-storage';

/** Verzija aplikacije (APP_VERSION ili datoteka VERSION) – zdravlje i manifest paketa ZNS-a. */
export function readVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  for (const p of [join(__dirname, '..', '..', '..', '..', 'VERSION'), join(process.cwd(), 'VERSION'), join(process.cwd(), '..', 'VERSION'), join(process.cwd(), '..', '..', 'VERSION')]) {
    try { return readFileSync(p, 'utf-8').trim(); } catch { /* sljedeća lokacija */ }
  }
  return 'unknown';
}

@Public()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();
  constructor(private readonly db: DbService, private readonly storage: DocumentStorage) {}

  /**
   * Spremnost za promet: baza i pohrana dokumenata dostupne (provjera zdravlja kontejnera i load balancera).
   * WP1.20: pohrana (lokalni direktorij ili S3) se provjerava kratkim zahtjevom, rezultat se pamti 10 s; odgovor ne
   * otkriva konfiguraciju (vrstu pohrane, adresu, bucket) – pojedinosti greške su samo u zapisu poslužitelja.
   */
  @Get('ready')
  async ready(): Promise<{ status: 'ready'; checks: { database: 'ok'; storage: 'ok' } }> {
    try { await this.db.db.execute(sql`select 1`); } catch { throw new ServiceUnavailableException('Baza nije dostupna'); }
    if (!(await this.storage.ready())) throw new ServiceUnavailableException('Pohrana dokumenata nije dostupna');
    return { status: 'ready', checks: { database: 'ok', storage: 'ok' } };
  }

  /**
   * Živost procesa. WP1.19: javna ruta u produkciji ne otkriva verziju ni vrijeme rada (olakšava odabir poznatih ranjivosti);
   * izvan produkcije (razvoj, testovi) ih vraća. Verzija je u manifestu paketa ZNS-a i u `docs/STATUS.md`.
   */
  @Get()
  get(): { status: 'ok'; version?: string; uptimeSeconds?: number; time: string } {
    if (process.env.NODE_ENV === 'production') return { status: 'ok', time: new Date().toISOString() };
    return { status: 'ok', version: readVersion(), uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000), time: new Date().toISOString() };
  }
}
