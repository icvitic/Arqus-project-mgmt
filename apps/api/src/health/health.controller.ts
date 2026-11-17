import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Public } from '../identity/auth.guard';

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
  constructor(private readonly db: DbService) {}

  /** Spremnost za promet: baza dostupna (za provjeru zdravlja kontejnera i load balancera). */
  @Get('ready')
  async ready(): Promise<{ status: 'ready' }> {
    try { await this.db.db.execute(sql`select 1`); return { status: 'ready' }; }
    catch { throw new ServiceUnavailableException('Baza nije dostupna'); }
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
