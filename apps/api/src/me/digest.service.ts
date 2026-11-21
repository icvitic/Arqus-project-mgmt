import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { digestMail, digestSlot, selectDigest, timeZoneOr } from '@arqus/domain';
import { DbService, type Tx } from '../db/db.service';
import { digestRuns, tenants, users, type DigestOutcome } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { IdentityService } from '../identity/identity.service';
import { mfaPolicyOf, mfaRequiredFor } from '../identity/mfa-policy';
import { MailService } from '../mail/mail.service';
import { TenantContext, type RequestContext } from '../common/tenant-context';
import { MyWorkService } from './my-work.service';
import { NotificationsService } from './notifications.service';

export interface DigestRunResult { tenants: number; claimed: number; sent: number; empty: number; skipped: number; failed: number; stoppedEarly: boolean }

/**
 * WP1.21 – dnevni sažetak e-poštom (specifikacija iz WP1.18, `docs/domena/moj-rad-i-obavijesti.md` odj. 4).
 *
 * - Kada: radnim danom (pon–pet u zoni institucije) od `DIGEST_HOUR` (zadano 7:00) do 12:00 – raspored provjerava svakih
 *   nekoliko minuta, pa sažetak ode i kad je aplikacija u 7:00 bila ugašena (ali ne popodne).
 * - Kome: aktivnim korisnicima koji ga nisu isključili (Moj račun), osim onih koji se ne mogu prijaviti (pozvan, deaktiviran,
 *   obvezni MFA nije postavljen).
 * - Što: iste stavke kao „Moj rad” (isti `MyWorkService` pod istim pravilima pristupa, izračunato za tog korisnika) i
 *   nepročitane obavijesti od prethodnog sažetka; samo ako nešto kasni, dospijeva uskoro ili je obavijest nova. Bez iznosa.
 * - Najviše jednom po korisniku i danu: prije slanja se u ZASEBNOJ transakciji umeće redak (`digest_runs`, jedinstven
 *   indeks stanar+korisnik+dan; `ON CONFLICT DO NOTHING`) – tko ga umetne, taj šalje; ponovno pokretanje i druga instanca
 *   isti dan ne šalju ništa. Pad procesa između umetanja i slanja znači da sažetak tog dana izostane (nikad dvaput).
 * - Neuspjeh jednog pretinca ne zaustavlja ostale; trajanje izvođenja je ograničeno (`DIGEST_RUN_MAX_MINUTES`), a broj
 *   istovremenih SMTP veza ograničava red e-pošte (`MAIL_MAX_CONNECTIONS`).
 */
@Injectable()
export class DigestService {
  private readonly log = new Logger('Sazetak');
  constructor(
    private readonly db: DbService, private readonly mail: MailService, private readonly identity: IdentityService, private readonly work: MyWorkService,
    private readonly notes: NotificationsService, private readonly ctx: TenantContext, private readonly audit: AuditService,
  ) {}

  async setting(tx: Tx, userId: string) {
    const u = (await tx.select({ enabled: users.digestEnabled }).from(users).where(eq(users.id, userId)))[0];
    return { enabled: u?.enabled ?? false, mailEnabled: this.mail.enabled, hour: this.mail.settings.digestHour };
  }

  /** Uključivanje/isključivanje vlastitog sažetka – vrijedi odmah (sljedeće izvođenje čita postavku iz baze). */
  async setEnabled(tx: Tx, userId: string, enabled: boolean) {
    const before = await this.setting(tx, userId);
    if (before.enabled !== enabled) {
      await tx.update(users).set({ digestEnabled: enabled, updatedAt: new Date(), updatedBy: userId }).where(eq(users.id, userId));
      await this.audit.record(tx, { entity: 'user', entityId: userId, action: 'digest.update', diff: { before: { digestEnabled: before.enabled }, after: { digestEnabled: enabled } } });
    }
    return this.setting(tx, userId);
  }

  /** Jedno izvođenje za sve institucije kojima je sada vrijeme sažetka. */
  async run(now: Date = new Date(), opts: { maxMs?: number; tenantIds?: string[] } = {}): Promise<DigestRunResult> {
    const maxMs = opts.maxMs ?? Math.max(1, Number(process.env.DIGEST_RUN_MAX_MINUTES ?? 20) || 20) * 60_000;
    const res: DigestRunResult = { tenants: 0, claimed: 0, sent: 0, empty: 0, skipped: 0, failed: 0, stoppedEarly: false };
    if (!this.mail.enabled) return res;
    const deadline = Date.now() + maxMs;
    // `tenantIds` ograničava izvođenje na zadane institucije (testovi dijele bazu s drugim institucijama).
    const all = await this.db.withoutTenant((tx) => tx.select({ id: tenants.id, name: tenants.name, settings: tenants.settings }).from(tenants)
      .where(and(isNull(tenants.deletedAt), opts.tenantIds ? inArray(tenants.id, opts.tenantIds) : undefined)));
    const pending: Promise<void>[] = [];
    for (const t of all) {
      const timeZone = timeZoneOr(t.settings?.timeZone);
      const slot = digestSlot(now, timeZone, this.mail.settings.digestHour);
      if (!slot.due) continue;
      res.tenants++;
      const recipients = await this.db.withTenant(t.id, (tx) => tx.select({ id: users.id, email: users.email, displayName: users.displayName, mfaEnabled: users.mfaEnabled })
        .from(users).where(and(eq(users.status, 'active'), isNull(users.deletedAt), eq(users.digestEnabled, true), sql`${users.passwordHash} is not null`)));
      for (const u of recipients) {
        if (Date.now() > deadline) { res.stoppedEarly = true; break; }
        try {
          const claimed = await this.db.withTenant(t.id, async (tx) => (await tx.insert(digestRuns).values({ tenantId: t.id, userId: u.id, day: slot.day }).onConflictDoNothing().returning({ day: digestRuns.day })).length > 0);
          if (!claimed) continue;
          res.claimed++;
          const content = await this.compose(t.id, t.name, timeZone, t.settings, u, slot.day, now);
          if (content === 'skipped' || content === null) {
            const outcome: DigestOutcome = content === 'skipped' ? 'skipped' : 'empty';
            res[outcome === 'skipped' ? 'skipped' : 'empty']++;
            await this.finish(t.id, u.id, slot.day, outcome);
            continue;
          }
          pending.push(this.mail.enqueue({ tenantId: t.id, userId: u.id, kind: 'digest', to: { address: u.email, name: u.displayName }, content })
            .then(async (ok) => { res[ok ? 'sent' : 'failed']++; await this.finish(t.id, u.id, slot.day, ok ? 'sent' : 'failed'); }));
        } catch (e) {
          // Jedan korisnik (podaci, pretinac) ne zaustavlja ostale.
          res.failed++;
          this.log.warn(`Sažetak za račun ${u.id} nije pripremljen: ${e instanceof Error ? e.name : 'greška'}`);
          await this.finish(t.id, u.id, slot.day, 'failed').catch(() => undefined);
        }
      }
      if (res.stoppedEarly) break;
    }
    await Promise.all(pending);
    if (res.claimed) this.log.log(`Dnevni sažetak: institucija ${res.tenants}, poslano ${res.sent}, bez sadržaja ${res.empty}, preskočeno ${res.skipped}, neuspjelo ${res.failed}${res.stoppedEarly ? ' (prekinuto – vremensko ograničenje)' : ''}`);
    return res;
  }

  private async finish(tenantId: string, userId: string, day: string, outcome: DigestOutcome): Promise<void> {
    await this.db.withTenant(tenantId, (tx) => tx.update(digestRuns).set({ outcome, finishedAt: new Date() }).where(and(eq(digestRuns.userId, userId), eq(digestRuns.day, day))));
  }

  /** Sadržaj za jednog korisnika pod njegovim dozvolama (kao zahtjev tog korisnika); `skipped` ako se ne može prijaviti. */
  private async compose(tenantId: string, institution: string, timeZone: string, settings: Record<string, unknown> | null, u: { id: string; displayName: string; mfaEnabled: boolean }, day: string, now: Date) {
    return this.db.withTenant(tenantId, async (tx) => {
      const access = await this.identity.accessOf(tx, tenantId, u.id);
      if (!u.mfaEnabled && mfaRequiredFor(mfaPolicyOf(settings), access.tenant)) return 'skipped' as const;
      const rc: RequestContext = {
        tenantId, userId: u.id, permissions: new Set(access.tenant),
        projectPermissions: new Map(Object.entries(access.projects).map(([id, perms]) => [id, new Set(perms)])),
        leadProposals: new Set(access.leadProposals), timeZone,
        proposalGrants: new Map(Object.entries(access.proposalGrants).map(([id, perms]) => [id, new Set(perms)])),
      };
      const work = await this.ctx.run(rc, () => this.work.work(tx, now));
      const prev = (await tx.select({ at: digestRuns.createdAt }).from(digestRuns)
        .where(and(eq(digestRuns.userId, u.id), lt(digestRuns.day, day), eq(digestRuns.outcome, 'sent'))).orderBy(desc(digestRuns.day)).limit(1))[0]?.at ?? null;
      const notes = await this.notes.unreadSince(tx, u.id, prev);
      const selection = selectDigest(work.items, notes, prev);
      if (!selection) return null;
      return digestMail({ institution, recipientName: u.displayName, selection, appUrl: this.mail.settings.publicUrl!, today: day });
    });
  }
}

/**
 * Raspored sažetka u procesu aplikacije – isti mehanizam kao dnevni uvoz poziva (`FtImportScheduler`): uključen kad je
 * e-pošta uključena (i `DIGEST_ENABLED` nije `0`), provjera svakih `DIGEST_TICK_MINUTES` (zadano 5) minuta.
 */
@Injectable()
export class DigestScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Sazetak');
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  constructor(private readonly digest: DigestService, private readonly mail: MailService) {}

  onApplicationBootstrap(): void {
    if (!this.mail.enabled || process.env.DIGEST_ENABLED === '0') return;
    const minutes = Math.max(1, Number(process.env.DIGEST_TICK_MINUTES ?? 5) || 5);
    this.timers.push(setTimeout(() => void this.tick(), 60_000).unref());
    this.timers.push(setInterval(() => void this.tick(), minutes * 60_000).unref());
    this.log.log(`Dnevni sažetak: radnim danom od ${this.mail.settings.digestHour}:00 (zona institucije), provjera svakih ${minutes} min`);
  }

  onApplicationShutdown(): void { this.timers.forEach((t) => clearTimeout(t)); }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await this.digest.run(); } catch (e) { this.log.error(`Sažetak nije izveden: ${e instanceof Error ? e.message : String(e)}`); } finally { this.running = false; }
  }
}
