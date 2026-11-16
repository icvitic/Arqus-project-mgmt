import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { fetchFtResults, importFtCalls } from './ft-import';

/** Periodični uvoz s F&T-a u procesu aplikacije: uključen s FT_IMPORT_INTERVAL_HOURS > 0 (treba DATABASE_MIGRATE_URL). */
@Injectable()
export class FtImportScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('UvozFT');
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  onApplicationBootstrap(): void {
    const hours = Number(process.env.FT_IMPORT_INTERVAL_HOURS ?? 0);
    const url = process.env.DATABASE_MIGRATE_URL;
    if (!(hours > 0) || !url) return;
    this.timers.push(setTimeout(() => void this.run(url), 60_000).unref());
    this.timers.push(setInterval(() => void this.run(url), hours * 3_600_000).unref());
    this.log.log(`Uvoz poziva s F&T-a svakih ${hours} h`);
  }

  onApplicationShutdown(): void { this.timers.forEach((t) => clearTimeout(t)); }

  private async run(url: string): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await importFtCalls(url, await fetchFtResults());
      this.log.log(`F&T: dohvaćeno ${r.fetched}, novih ${r.inserted}, osvježeno ${r.updated}, ručnih zadržano ${r.keptManual}, isteklih preskočeno ${r.skipped.expired}`);
    } catch (e) { this.log.error(`Uvoz s F&T-a nije uspio: ${e instanceof Error ? e.message : String(e)}`); } finally { this.running = false; }
  }
}
