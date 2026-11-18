import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { MailContent } from '@arqus/domain';
import { DbService, type Tx } from '../db/db.service';
import { mailDeliveries, users, type MailKind } from '../db/schema';
import { MAIL_SETTINGS, MAIL_TRANSPORT, type MailSettings, type MailTransport } from './mail-config';
import { SmtpError } from './smtp-client';

export interface MailJob {
  tenantId: string;
  userId: string;
  kind: MailKind;
  to: { address: string; name?: string };
  content: MailContent;
}

/**
 * WP1.21 – slanje e-pošte iz aplikacije. Poruka se šalje IZVAN zahtjeva (red s ograničenim brojem istovremenih veza):
 * odgovor API-ja ne čeka relay i ne razlikuje se po ishodu. Sadržaj poruke (tijela nose tokene) nikad se ne sprema ni
 * zapisuje u dnevnik; sprema se samo zapis isporuke (primatelj-račun, vrsta, ishod, vrijeme, kratka oznaka greške).
 */
@Injectable()
export class MailService implements OnApplicationShutdown {
  private readonly log = new Logger('Posta');
  private readonly queue: { job: MailJob; done: (ok: boolean) => void }[] = [];
  private active = 0;
  private readonly inflight = new Set<Promise<boolean>>();

  constructor(@Inject(MAIL_SETTINGS) readonly settings: MailSettings, @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport, private readonly db: DbService) {}

  get enabled(): boolean { return this.settings.enabled; }

  /** Apsolutna poveznica na zaslon aplikacije (hash ruta) – samo iz `PUBLIC_URL`. */
  appLink(route: string): string {
    if (!this.settings.publicUrl) throw new Error('PUBLIC_URL nije postavljen');
    return `${this.settings.publicUrl}/#/${route.replace(/^#?\/?/, '')}`;
  }
  get baseUrl(): string {
    if (!this.settings.publicUrl) throw new Error('PUBLIC_URL nije postavljen');
    return `${this.settings.publicUrl}/`;
  }

  /** U red za slanje; vraća obećanje ishoda (true = predano relayu) koje nikad ne baca. Isključena pošta → false. */
  enqueue(job: MailJob): Promise<boolean> {
    if (!this.enabled) return Promise.resolve(false);
    const p = new Promise<boolean>((done) => { this.queue.push({ job, done }); this.pump(); });
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
    return p;
  }

  /** Čeka da se red isprazni (testovi, gašenje). */
  async idle(): Promise<void> { while (this.inflight.size) await Promise.all([...this.inflight]); }

  async onApplicationShutdown(): Promise<void> {
    const deadline = new Promise((r) => setTimeout(r, 10_000).unref());
    await Promise.race([this.idle(), deadline]);
  }

  private pump(): void {
    while (this.active < this.settings.maxConcurrency && this.queue.length) {
      const next = this.queue.shift()!;
      this.active++;
      void this.deliver(next.job).then(next.done, () => next.done(false)).finally(() => { this.active--; this.pump(); });
    }
  }

  private async deliver(job: MailJob): Promise<boolean> {
    let outcome: 'sent' | 'failed' = 'sent'; let errorClass: string | null = null; let attempts = 1;
    try {
      const r = await this.transport.send({ from: this.settings.from!, to: job.to, subject: job.content.subject, text: job.content.text, html: job.content.html });
      attempts = r.attempts;
    } catch (e) {
      outcome = 'failed';
      errorClass = e instanceof SmtpError ? e.cls : 'error';
      attempts = (e as { attempts?: number }).attempts ?? 1;
      // Bez adrese, naslova i sadržaja – samo vrsta, račun i oznaka greške.
      this.log.warn(`Isporuka nije uspjela: vrsta ${job.kind}, račun ${job.userId}, greška ${errorClass}`);
    }
    try {
      await this.db.withTenant(job.tenantId, (tx) => tx.insert(mailDeliveries).values({ tenantId: job.tenantId, userId: job.userId, kind: job.kind, outcome, errorClass, attempts }));
    } catch (e) {
      this.log.error(`Zapis isporuke nije spremljen: ${e instanceof Error ? e.name : 'greška'}`);
    }
    return outcome === 'sent';
  }

  /** Stanje za administratora: je li pošta uključena, pošiljatelj, javna adresa, zadnje isporuke (bez sadržaja), zbroj 7 dana. */
  async status(tx: Tx) {
    const recent = await tx.select({ id: mailDeliveries.id, kind: mailDeliveries.kind, outcome: mailDeliveries.outcome, errorClass: mailDeliveries.errorClass, attempts: mailDeliveries.attempts, createdAt: mailDeliveries.createdAt, userId: mailDeliveries.userId, displayName: users.displayName })
      .from(mailDeliveries).leftJoin(users, eq(users.id, mailDeliveries.userId)).orderBy(desc(mailDeliveries.id)).limit(20);
    const since = new Date(Date.now() - 7 * 86_400_000);
    const counts = await tx.select({ outcome: mailDeliveries.outcome, n: sql<number>`count(*)::int` }).from(mailDeliveries).where(and(gte(mailDeliveries.createdAt, since))).groupBy(mailDeliveries.outcome);
    return {
      enabled: this.enabled,
      from: this.settings.from?.address ?? null,
      publicUrl: this.settings.publicUrl,
      last7Days: { sent: counts.find((c) => c.outcome === 'sent')?.n ?? 0, failed: counts.find((c) => c.outcome === 'failed')?.n ?? 0 },
      recent,
    };
  }
}
