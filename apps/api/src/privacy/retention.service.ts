import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { timeZoneOr, todayIn } from '@arqus/domain';
import { DbService, type Tx } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { DocumentStorage } from '../documents/document-storage';
import { TenantContext, tenantToday } from '../common/tenant-context';
import {
  categoryOf, effectiveDays, effectiveProjectYears, privacySettingsOf, PROJECT_YEARS, RETENTION_CATEGORIES, type PrivacySettings, type PrivacySettingsInput, type RetentionKey,
} from './retention-policy';

type Row = Record<string, unknown>;
const rows = async <T = Row>(tx: Tx, q: ReturnType<typeof sql>): Promise<T[]> => (await tx.execute(q)).rows as T[];
const num = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

export interface CategoryResult { key: RetentionKey; days: number; cutoff: string; held: number; eligible: number; removed: number; keptForEvidence: number; stoppedEarly?: boolean }
export interface RetentionRunResult { tenantId: string; mode: 'scheduled' | 'dry'; claimed: boolean; runId: number | null; categories: CategoryResult[]; stoppedEarly: boolean }

/**
 * WP1.23 – posao čuvanja podataka (ograničenje pohrane, čl. 5(1)(e) GDPR-a). Jednom dnevno po instituciji briše ono čemu je
 * istekao rok (`retention-policy.ts`); probno izvođenje (`dry`) samo broji. Svaka kategorija briše u serijama (`batch`,
 * zadano 500) s gornjom granicom serija i trajanja – posao je ograničen u vremenu i nikad ne drži dugu transakciju.
 *
 * Nikad ne briše financijske zapise (timesheetove, troškove, zahtjeve, članove tima, proračun, projekte): ni jedna kategorija
 * ih ne dotiče, a revizijski zapis i obrisani dokumenti brišu se samo kroz funkcije u bazi (migracija 0032) koje same
 * provode donje granice i čuvaju sve što je dokaz projekta kojemu rok čuvanja još traje.
 *
 * Više instanci: zakazano izvođenje najprije umeće redak `retention_runs` (jedinstven po instituciji i danu) u zasebnoj
 * transakciji – tko ga umetne, taj radi (isti obrazac kao dnevni sažetak).
 */
@Injectable()
export class RetentionService {
  private readonly log = new Logger('Cuvanje');
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly storage: DocumentStorage, private readonly ctx: TenantContext) {}

  private async settingsOf(tx: Tx): Promise<{ s: PrivacySettings; raw: Record<string, unknown> }> {
    const raw = (await rows<{ settings: Record<string, unknown> }>(tx, sql`select settings from tenants where id = app_current_tenant()`))[0]?.settings ?? {};
    return { s: privacySettingsOf(raw), raw };
  }

  /** Jedno izvođenje za jednu instituciju. `dryRun` ništa ne briše. */
  async runTenant(tenantId: string, opts: { dryRun: boolean; mode?: 'scheduled' | 'dry'; day?: string; actorId?: string | null; batch?: number; maxBatches?: number; maxMs?: number; now?: Date } = { dryRun: true }): Promise<RetentionRunResult> {
    const mode = opts.mode ?? (opts.dryRun ? 'dry' : 'scheduled');
    if (mode === 'scheduled' && opts.dryRun) throw new Error('Zakazano izvođenje nije probno');
    const batch = Math.min(Math.max(opts.batch ?? (Number(process.env.RETENTION_BATCH) || 500), 1), 5000);
    const maxBatches = Math.max(opts.maxBatches ?? (Number(process.env.RETENTION_MAX_BATCHES) || 40), 1);
    const deadline = Date.now() + (opts.maxMs ?? Math.max(1, Number(process.env.RETENTION_RUN_MAX_MINUTES ?? 10) || 10) * 60_000);
    const day = opts.day ?? await this.db.withTenant(tenantId, async (tx) => todayIn(timeZoneOr((await rows<{ tz: string | null }>(tx, sql`select settings->>'timeZone' as tz from tenants where id = ${tenantId}`))[0]?.tz), opts.now ?? new Date()));
    const claimed = await this.db.withTenant(tenantId, async (tx) => (await rows<{ id: number }>(tx, sql`insert into retention_runs (tenant_id, day, mode, created_by)
      values (${tenantId}, ${day}, ${mode}, ${opts.actorId ?? null}) on conflict do nothing returning id`))[0]?.id ?? null);
    const res: RetentionRunResult = { tenantId, mode, claimed: claimed !== null, runId: claimed, categories: [], stoppedEarly: false };
    if (claimed === null) return res; // druga instanca (ili ranije izvođenje) je danas već radila
    try {
      const s = await this.db.withTenant(tenantId, async (tx) => (await this.settingsOf(tx)).s);
      for (const c of RETENTION_CATEGORIES) {
        const r = await this.category(tenantId, c.key, effectiveDays(s, c.key), { dryRun: opts.dryRun, batch, maxBatches, deadline });
        res.categories.push(r);
        if (r.stoppedEarly) res.stoppedEarly = true;
      }
      await this.db.withTenant(tenantId, (tx) => tx.execute(sql`update retention_runs set outcome = 'done', finished_at = now(),
        result = ${JSON.stringify({ categories: res.categories, stoppedEarly: res.stoppedEarly })}::jsonb where id = ${claimed}`));
      const removed = res.categories.reduce((a, x) => a + x.removed, 0);
      if (removed) this.log.log(`Čuvanje podataka (${tenantId}): uklonjeno ${removed} zapisa${res.stoppedEarly ? ' (prekinuto – granica serija ili vremena)' : ''}`);
    } catch (e) {
      await this.db.withTenant(tenantId, (tx) => tx.execute(sql`update retention_runs set outcome = 'failed', finished_at = now(),
        result = ${JSON.stringify({ categories: res.categories, error: e instanceof Error ? e.name : 'greška' })}::jsonb where id = ${claimed}`)).catch(() => undefined);
      throw e;
    }
    return res;
  }

  /** Jedna kategorija: broji, a izvan probnog izvođenja briše u serijama dok ima što ili do granice. */
  private async category(tenantId: string, key: RetentionKey, days: number, o: { dryRun: boolean; batch: number; maxBatches: number; deadline: number }): Promise<CategoryResult> {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const r: CategoryResult = { key, days, cutoff: cutoff.toISOString(), held: 0, eligible: 0, removed: 0, keptForEvidence: 0 };
    const stats = await this.db.withTenant(tenantId, (tx) => this.stats(tx, key, days, cutoff));
    Object.assign(r, stats);
    if (o.dryRun || r.eligible === 0) return r;
    for (let i = 0; i < o.maxBatches; i++) {
      if (Date.now() > o.deadline) { r.stoppedEarly = true; break; }
      const { removed, keys } = await this.db.withTenant(tenantId, (tx) => this.purgeBatch(tx, key, days, cutoff, o.batch));
      r.removed += removed;
      // Datoteke obrisanih dokumenata uklanjaju se tek nakon potvrde transakcije (neuspjeh = siroče, `documents verify`).
      for (const k of keys) await this.storage.discard(k);
      if (removed < o.batch) break;
      if (i === o.maxBatches - 1) r.stoppedEarly = true;
    }
    return r;
  }

  /** Brojevi kategorije (koliko se drži, koliko je isteklo, koliko se zadržava jer o tome nešto ovisi). */
  private async stats(tx: Tx, key: RetentionKey, days: number, cutoff: Date): Promise<Pick<CategoryResult, 'held' | 'eligible' | 'keptForEvidence'>> {
    const one = async (q: ReturnType<typeof sql>) => (await rows(tx, q))[0] ?? {};
    switch (key) {
      case 'sessions': { const x = await one(sql`select count(*) as held, count(*) filter (where expires_at < ${cutoff} or revoked_at < ${cutoff}) as eligible from sessions`); return { held: num(x.held), eligible: num(x.eligible), keptForEvidence: 0 }; }
      case 'accountTokens': { const x = await one(sql`select count(*) as held, count(*) filter (where expires_at < ${cutoff}) as eligible from account_tokens`); return { held: num(x.held), eligible: num(x.eligible), keptForEvidence: 0 }; }
      case 'mailDeliveries': { const x = await one(sql`select count(*) as held, count(*) filter (where created_at < ${cutoff}) as eligible from mail_deliveries`); return { held: num(x.held), eligible: num(x.eligible), keptForEvidence: 0 }; }
      case 'digestRuns': { const x = await one(sql`select count(*) as held, count(*) filter (where created_at < ${cutoff}) as eligible from digest_runs`); return { held: num(x.held), eligible: num(x.eligible), keptForEvidence: 0 }; }
      case 'subjectRequests': { const x = await one(sql`select count(*) as held, count(*) filter (where status = 'closed' and closed_on < ${cutoff}::date) as eligible from subject_requests`); return { held: num(x.held), eligible: num(x.eligible), keptForEvidence: 0 }; }
      case 'notificationsRead': case 'notificationsUnread': {
        const x = (await one(sql`select privacy_notifications_purge(${key === 'notificationsRead' ? days : 90}, ${key === 'notificationsUnread' ? days : 36500}, 0, true) as r`)).r as Row;
        return { held: num(x.held), eligible: num(key === 'notificationsRead' ? x.eligibleRead : x.eligibleUnread), keptForEvidence: 0 };
      }
      case 'deletedDocuments': {
        const x = (await one(sql`select privacy_documents_purge(${days}, 0, true) as r`)).r as Row;
        const held = (await one(sql`select count(*) as n from documents where deleted_at is not null`)).n;
        return { held: num(held), eligible: num(x.eligible), keptForEvidence: num(x.keptForEvidence) };
      }
      case 'loginFailures': case 'audit': {
        const x = (await one(sql`select privacy_audit_purge('general', 0, true) as r`)).r as Row;
        if (key === 'loginFailures') {
          const held = (await one(sql`select count(*) as n from audit_entries where entity = 'user' and action in ('login.failed', 'login.mfa_failed')`)).n;
          return { held: num(held), eligible: num(x.eligibleLogin), keptForEvidence: 0 };
        }
        return { held: num(x.held), eligible: num(x.eligibleGeneral), keptForEvidence: num(x.keptForEvidence) };
      }
    }
  }

  private async purgeBatch(tx: Tx, key: RetentionKey, days: number, cutoff: Date, batch: number): Promise<{ removed: number; keys: string[] }> {
    const del = async (q: ReturnType<typeof sql>) => ({ removed: (await tx.execute(q)).rowCount ?? 0, keys: [] as string[] });
    switch (key) {
      case 'sessions': return del(sql`delete from sessions where id in (select id from sessions where expires_at < ${cutoff} or revoked_at < ${cutoff} limit ${batch})`);
      case 'accountTokens': return del(sql`delete from account_tokens where id in (select id from account_tokens where expires_at < ${cutoff} limit ${batch})`);
      case 'mailDeliveries': return del(sql`delete from mail_deliveries where id in (select id from mail_deliveries where created_at < ${cutoff} order by id limit ${batch})`);
      case 'digestRuns': return del(sql`delete from digest_runs where ctid in (select ctid from digest_runs where created_at < ${cutoff} limit ${batch})`);
      case 'subjectRequests': return del(sql`delete from subject_requests where id in (select id from subject_requests where status = 'closed' and closed_on < ${cutoff}::date order by closed_on limit ${batch})`);
      case 'notificationsRead': case 'notificationsUnread': {
        const x = (await rows(tx, sql`select privacy_notifications_purge(${key === 'notificationsRead' ? days : 36500}, ${key === 'notificationsUnread' ? days : 36500}, ${batch}, false) as r`))[0]!.r as Row;
        return { removed: num(x.removedRead) + num(x.removedUnread), keys: [] };
      }
      case 'deletedDocuments': {
        const x = (await rows(tx, sql`select privacy_documents_purge(${days}, ${batch}, false) as r`))[0]!.r as Row;
        return { removed: num(x.removed), keys: (x.storageKeys as string[] | null) ?? [] };
      }
      case 'loginFailures': case 'audit': {
        // Funkcija u bazi sama čita rokove i donje granice iz postavke; `days` ovdje služi samo prikazu.
        const x = (await rows(tx, sql`select privacy_audit_purge(${key === 'loginFailures' ? 'login' : 'general'}, ${batch}, false) as r`))[0]!.r as Row;
        return { removed: key === 'loginFailures' ? num(x.removedLogin) : num(x.removed), keys: [] };
      }
    }
  }

  /** Zakazano izvođenje za sve institucije kojima je danas vrijeme (od `RETENTION_HOUR`, zadano 2:00, u zoni institucije). */
  async runDue(now: Date = new Date(), opts: { tenantIds?: string[] } = {}): Promise<RetentionRunResult[]> {
    const hour = Math.min(Math.max(Number(process.env.RETENTION_HOUR ?? 2) || 0, 0), 23);
    const all = await this.db.withoutTenant((tx) => rows<{ id: string; tz: string | null }>(tx, sql`select id, settings->>'timeZone' as tz from tenants where deleted_at is null`));
    const out: RetentionRunResult[] = [];
    for (const t of all) {
      if (opts.tenantIds && !opts.tenantIds.includes(t.id)) continue;
      const tz = timeZoneOr(t.tz);
      const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
      if (localHour < hour) continue;
      try { out.push(await this.runTenant(t.id, { dryRun: false, mode: 'scheduled', day: todayIn(tz, now), now })); } catch (e) { this.log.error(`Čuvanje podataka nije izvedeno (${t.id}): ${e instanceof Error ? e.message : String(e)}`); }
    }
    return out;
  }

  // ---------- zaslon „Rokovi čuvanja” ----------
  async overview(tx: Tx) {
    const { s } = await this.settingsOf(tx);
    const categories = [];
    for (const c of RETENTION_CATEGORIES) {
      const days = effectiveDays(s, c.key);
      const st = await this.stats(tx, c.key, days, new Date(Date.now() - days * 86_400_000));
      categories.push({ key: c.key, label: c.label, unit: c.unit, days, defaultDays: c.defaultDays, floorDays: c.floorDays, configurable: c.configurable,
        setByInstitution: c.configurable && s.retentionDays[c.key] !== undefined, basis: c.basis, ...st });
    }
    const runs = await rows(tx, sql`select id, day, mode, outcome, result, started_at as "startedAt", finished_at as "finishedAt", created_by as "createdBy"
      from retention_runs order by id desc limit 20`);
    const last = (mode: string) => { const r = runs.find((x) => x.mode === mode); return r ? { ...r, startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt) } : null; };
    const projects = await rows(tx, sql`select p.id, p.acronym, p.status, p.package_id as "packageId", project_retention_end(p.id) as "retentionEnd" from projects p where p.deleted_at is null order by p.acronym`);
    const today = tenantToday();
    const packages = [...new Set(projects.map((p) => String(p.packageId)))].sort();
    const kept = (await rows(tx, sql`select (select count(*) from users where status = 'closed') as closed, (select count(*) from team_members where anonymised_at is not null) as anonymised,
      (select count(*) from team_members m join users u on u.id = m.user_id where u.status = 'closed') as "closedMembers"`))[0]!;
    return {
      categories,
      projectYears: {
        defaultYears: PROJECT_YEARS.defaultYears, floorYears: PROJECT_YEARS.floorYears, institutionYears: s.projectYears.default ?? null,
        programmes: packages.map((p) => ({ packageId: p, ...effectiveProjectYears(s, p), set: s.projectYears.programmes[p] ?? null })),
      },
      projects: projects.map((p) => {
        const end = iso(p.retentionEnd);
        return { id: p.id, acronym: p.acronym, status: p.status, packageId: p.packageId, years: effectiveProjectYears(s, String(p.packageId)).years, retentionEnd: end,
          state: !end ? 'not_started' : end > today ? 'running' : 'ended' };
      }),
      kept: { closedAccounts: num(kept.closed), closedAccountMembers: num(kept.closedMembers), anonymisedMembers: num(kept.anonymised) },
      confirmed: { at: s.confirmedAt, by: s.confirmedBy },
      lastRun: last('scheduled'), lastDryRun: last('dry'),
      scheduler: { enabled: retentionSchedulerEnabled(), hour: Math.min(Math.max(Number(process.env.RETENTION_HOUR ?? 2) || 0, 0), 23) },
    };
  }

  /** Promjena rokova (revidirana: prije i poslije). Donje granice provodi validacija i, za dokazne kategorije, baza. */
  async update(tx: Tx, input: PrivacySettingsInput) {
    const c = this.ctx.require();
    await tx.execute(sql`select 1 from tenants where id = app_current_tenant() for update`);
    const { raw } = await this.settingsOf(tx);
    const before = (raw.privacy ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...before };
    if (input.retentionDays) {
      const cur = { ...((before.retentionDays ?? {}) as Record<string, number>) };
      for (const [k, v] of Object.entries(input.retentionDays)) { if (v === undefined) continue; if (!categoryOf(k as RetentionKey).configurable) continue; cur[k] = v; }
      next.retentionDays = cur;
    }
    if (input.projectYears) {
      const py = { ...((before.projectYears ?? {}) as { default?: number; programmes?: Record<string, number> }) };
      if (input.projectYears.default !== undefined) { if (input.projectYears.default === null) delete py.default; else py.default = input.projectYears.default; }
      if (input.projectYears.programmes) {
        const pr = { ...(py.programmes ?? {}) };
        for (const [k, v] of Object.entries(input.projectYears.programmes)) { if (v === null) delete pr[k]; else pr[k] = v; }
        py.programmes = pr;
      }
      next.projectYears = py;
    }
    if (input.confirm) { next.confirmedAt = new Date().toISOString(); next.confirmedBy = c.userId ?? null; }
    if (JSON.stringify(next) !== JSON.stringify(before)) {
      await tx.execute(sql`update tenants set settings = jsonb_set(settings, '{privacy}', ${JSON.stringify(next)}::jsonb, true), updated_at = now(), updated_by = ${c.userId ?? null} where id = app_current_tenant()`);
      await this.audit.record(tx, { entity: 'tenant', entityId: c.tenantId, action: 'privacy.retention.update', diff: { before: { privacy: before }, after: { privacy: next } } });
    }
    return this.overview(tx);
  }
}

/**
 * Raspored je uključen u produkciji (osim uz `RETENTION_ENABLED=0`), a izvan produkcije samo uz `RETENTION_ENABLED=1` –
 * nepovratno brisanje nikad se ne pokreće samo od sebe u testovima ili razvoju.
 */
export function retentionSchedulerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.RETENTION_ENABLED === '0') return false;
  return env.RETENTION_ENABLED === '1' || env.NODE_ENV === 'production';
}

/** Raspored posla čuvanja u procesu aplikacije – isti mehanizam kao dnevni sažetak; provjera svakih `RETENTION_TICK_MINUTES` (30). */
@Injectable()
export class RetentionScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Cuvanje');
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  constructor(private readonly retention: RetentionService) {}

  onApplicationBootstrap(): void {
    if (!retentionSchedulerEnabled()) return;
    const minutes = Math.max(5, Number(process.env.RETENTION_TICK_MINUTES ?? 30) || 30);
    this.timers.push(setTimeout(() => void this.tick(), 120_000).unref());
    this.timers.push(setInterval(() => void this.tick(), minutes * 60_000).unref());
    this.log.log(`Rokovi čuvanja: dnevno od ${process.env.RETENTION_HOUR ?? 2}:00 (zona institucije), provjera svakih ${minutes} min`);
  }

  onApplicationShutdown(): void { this.timers.forEach((t) => clearTimeout(t)); }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await this.retention.runDue(); } catch (e) { this.log.error(`Rokovi čuvanja: ${e instanceof Error ? e.message : String(e)}`); } finally { this.running = false; }
  }
}
