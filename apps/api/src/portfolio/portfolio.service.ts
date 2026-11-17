import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import {
  annualProductiveHours, budgetPercent, claimSavings, computeProjectBudget, preparationMeasures, daysBetween, deadlineCounts, dateIn, lastMonths, mergeDeadlines, monthEndDate,
  PIPELINE_STATUSES, personWorkload, progressSignal, successRate, timeProgress, DAILY_HOURS_LIMIT, PROGRESS_THRESHOLD_PP,
  type CallDeadline, type DeadlineInput, type ProgrammePackage, type TeamMemberRef, type WorkDay,
} from '@arqus/domain';
import type { Tx } from '../db/db.service';
import {
  budgetLines, callTracking, calls, deliverables, expenses, milestones, organisations, programmePackages, projectBudgets, projectPartners, projects,
  proposalBudgetLines, proposalMembers, proposals, reimbursementClaims, reportingPeriods, teamMembers, tenants, timesheetEntries, timesheets, workPackages,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { ProgrammePackagesService } from '../programmes/programme-packages.service';
import { TenantContext, tenantTimeZone, tenantToday } from '../common/tenant-context';
import { canInTenant, canOnProject, projectsWith } from '../common/access';
import {
  highRisksCount, OPEN_DELIVERABLE_STATUSES, OPEN_MILESTONE_STATUSES, OPEN_PROJECT_STATUSES as OPEN, OPEN_PROPOSAL_STATUSES as OPEN_PROPOSAL, periodSubmitted, RUNNING_PROJECT_STATUSES as RUNNING,
  strandedCount, timesheetsToApproveCount, withoutEvidenceCount,
} from './facts';

const STATUS_ORDER = ['active', 'suspended', 'closing', 'contracting', 'closed', 'terminated'];
export const SUBMISSION_KINDS = ['submission', 'stage1', 'stage2'];

/** Rok portfelja; `key` – stabilan identifikator roka (WP1.18: UID događaja u osobnom kalendaru). */
export type Deadline = DeadlineInput & { key: string; link: string; projectId?: string; acronym?: string; callId?: string; proposalId?: string; at?: string; detail?: string };
type Lines = { partnerId: string; categoryCode: string; amount: number }[];

/**
 * M10 Portfelj (WP1.15): pregled svih projekata institucije u jednom zahtjevu. Samo čitanje, bez vlastitih tablica –
 * izvedeni model čita tablice projekata, financija, radara i prijava (ADR-0002: iznimka za izvještajni prikaz) i
 * vraća samo ono što korisnik smije vidjeti (WP1.14): sve uz `portfolio:read` institucije, inače projekte s dodjelom,
 * iznose samo gdje ima `finance:read`, bez opterećenja ljudi, a prijave i pozive samo uz dozvolu institucije.
 * Upiti se izvršavaju jedan za drugim na istoj transakciji (bez Promise.all na istom klijentu).
 */
@Injectable()
export class PortfolioService {
  constructor(private readonly packages: ProgrammePackagesService, private readonly ctx: TenantContext, private readonly audit: AuditService) {}

  /** Polazna mjera institucije: sati pripreme jednog ZNS-a prije ArQusa (`tenants.settings.claimBaselineHours`). */
  private async baseline(tx: Tx): Promise<number | null> {
    const t = (await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, this.ctx.require().tenantId)))[0];
    const v = t?.settings?.claimBaselineHours;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  }

  /**
   * „Ušteda na ZNS-u” (WP1.16b): za predane zahtjeve svih projekata institucije prosjek prijavljenih sati pripreme prema
   * polaznoj mjeri, uz automatske mjere (dani do predaje, povrati, broj troškova, dokaza i timesheetova). Samo uz
   * `portfolio:read` institucije (ruta) – izvještaj obuhvaća sve projekte. Izračun: `claimSavings` u @arqus/domain.
   */
  async claimSavings(tx: Tx) {
    const ctx = this.ctx.require();
    const baselineHours = await this.baseline(tx);
    const rows = await tx.select({
      id: reimbursementClaims.id, projectId: projects.id, acronym: projects.acronym, period: reportingPeriods.number, periodStart: reportingPeriods.startDate, periodEnd: reportingPeriods.endDate,
      status: reimbursementClaims.status, createdAt: reimbursementClaims.createdAt, submittedAt: reimbursementClaims.submittedAt, minutes: reimbursementClaims.preparationMinutes,
      expenses: sql<number>`(select count(*)::int from expenses e where e.claim_id = "reimbursement_claims"."id")`,
      earlier: sql<number>`(select count(*)::int from expenses e where e.claim_id = "reimbursement_claims"."id" and e.date < "reporting_periods"."start_date")`,
      timesheets: sql<number>`(select count(distinct e.timesheet_id)::int from expenses e where e.claim_id = "reimbursement_claims"."id")`,
      evidence: sql<number>`(select count(*)::int from documents d join expenses e on e.id = d.entity_id where d.entity_type = 'expense' and d.deleted_at is null and e.claim_id = "reimbursement_claims"."id")`,
    }).from(reimbursementClaims).innerJoin(reportingPeriods, eq(reportingPeriods.id, reimbursementClaims.reportingPeriodId)).innerJoin(projects, eq(projects.id, reimbursementClaims.projectId))
      .where(and(ne(reimbursementClaims.status, 'draft'), isNotNull(reimbursementClaims.submittedAt), isNull(projects.deletedAt)))
      .orderBy(desc(reimbursementClaims.submittedAt));
    const returns = await this.audit.countByEntity(tx, 'claim', rows.map((r) => r.id), 'decision.returned');
    const claims = rows.map((r) => {
      const measures = preparationMeasures({ periodEnd: r.periodEnd, openedAt: r.createdAt.toISOString(), submittedAt: r.submittedAt!.toISOString(), returns: returns.get(r.id) ?? 0, expenses: r.expenses, evidenceFiles: r.evidence, timesheets: r.timesheets, earlierExpenses: r.earlier });
      return { id: r.id, projectId: r.projectId, acronym: r.acronym, period: r.period, status: r.status, submittedAt: r.submittedAt, reportedHours: r.minutes === null ? null : Math.round((r.minutes / 60) * 100) / 100, reportedMinutes: r.minutes, measures };
    });
    return { ...claimSavings(baselineHours, claims), canEditBaseline: canInTenant(ctx, 'tenant:write'), claims: claims.map(({ reportedMinutes: _m, ...c }) => c) };
  }

  /** Upis polazne mjere (sati po ZNS-u prije ArQusa) – postavka institucije, `tenant:write` (ured za projekte, administrator). */
  async setBaseline(tx: Tx, hours: number | null, actorId?: string) {
    const ctx = this.ctx.require();
    const before = await this.baseline(tx);
    if (hours === null) await tx.execute(sql`update tenants set settings = settings - 'claimBaselineHours', updated_at = now() where id = ${ctx.tenantId}`);
    else await tx.execute(sql`update tenants set settings = settings || ${JSON.stringify({ claimBaselineHours: hours })}::jsonb, updated_at = now() where id = ${ctx.tenantId}`);
    await this.audit.record(tx, { entity: 'tenant', entityId: ctx.tenantId, action: 'settings.update', diff: { before: { claimBaselineHours: before }, after: { claimBaselineHours: hours }, meta: { actorId } } });
    return this.claimSavings(tx);
  }

  async overview(tx: Tx, opts: { days: number; now?: Date }) {
    return (await this.build(tx, opts)).view;
  }

  /**
   * WP1.18: svi rokovi koje korisnik smije vidjeti (bez prozora; prošli i budući), za osobni kalendar. Ista pravila pristupa
   * i isti izvori kao popis rokova na portfelju; novac i opterećenje ljudi se ne računaju.
   */
  async deadlines(tx: Tx, now?: Date): Promise<Deadline[]> {
    return (await this.build(tx, { days: 365, now, deadlinesOnly: true })).deadlines;
  }

  private async build(tx: Tx, opts: { days: number; now?: Date; deadlinesOnly?: boolean }) {
    const ctx = this.ctx.require();
    const today = tenantToday(opts.now ?? new Date()); // WP1.14b: kalendarski dan institucije (Europe/Zagreb), ne UTC
    const full = canInTenant(ctx, 'portfolio:read');
    // WP1.14b: voditelj prijave bez dozvole institucije vidi u pregledu prijava samo vlastite prijave.
    const ownProposals = full || canInTenant(ctx, 'proposals:read') ? null : [...(ctx.leadProposals ?? [])];
    const visible = full ? 'all' : projectsWith(ctx, 'projects:read');
    const access = {
      full,
      people: full || (canInTenant(ctx, 'projects:read') && canInTenant(ctx, 'timesheets:read')),
      pipeline: full || canInTenant(ctx, 'proposals:read') || !!ownProposals?.length,
      calls: full || canInTenant(ctx, 'calls:read'),
    };
    const seesFinance = (id: string) => full || canOnProject(ctx, 'finance:read', id);
    const seesTimesheets = (id: string) => full || canOnProject(ctx, 'timesheets:read', id);
    const seesConfidential = (id: string) => canOnProject(ctx, 'documents:confidential', id);

    // ---------- projekti ----------
    const projRows = visible !== 'all' && !visible.length ? [] : await tx.select({ p: projects, programme: programmePackages.programme }).from(projects)
      .innerJoin(programmePackages, eq(programmePackages.id, projects.packageRowId))
      .where(and(isNull(projects.deletedAt), ne(projects.status, 'archived'), visible === 'all' ? undefined : inArray(projects.id, visible)));
    const ids = projRows.map((r) => r.p.id);
    const pkgCache = new Map<string, ProgrammePackage>();
    const pkg = async (id: string, version: string) => {
      const k = `${id}@${version}`;
      if (!pkgCache.has(k)) pkgCache.set(k, await this.packages.get(tx, id, version));
      return pkgCache.get(k)!;
    };
    if (!opts.deadlinesOnly) for (const { p } of projRows) await pkg(p.packageId, p.packageVersion);

    const finIds = opts.deadlinesOnly ? [] : ids.filter(seesFinance);
    const partners = finIds.length ? await tx.select({ id: projectPartners.id, projectId: projectPartners.projectId, beneficiaryType: projectPartners.beneficiaryType, isSelf: organisations.isSelf })
      .from(projectPartners).innerJoin(organisations, eq(organisations.id, projectPartners.organisationId)).where(inArray(projectPartners.projectId, ids)).orderBy(asc(projectPartners.orderNo)) : [];
    // Ugovoreno: zadnja verzija proračuna (kao „Ugovoreno / ostvareno” na projektu). Ostvareno: prije odluke traženi iznos troška,
    // nakon odluke priznati (odbijen = 0); nepriznato = isti izračun s traženim iznosima − ostvareno (`docs/domena/zns-pravila.md`).
    const planned = finIds.length ? await tx.select({ projectId: projectBudgets.projectId, partnerId: budgetLines.partnerId, categoryCode: budgetLines.categoryCode, amount: sql<string>`sum(${budgetLines.amountCents})` })
      .from(budgetLines).innerJoin(projectBudgets, eq(projectBudgets.id, budgetLines.budgetId))
      .where(and(inArray(projectBudgets.projectId, finIds), sql`${projectBudgets.version} = (select max(b2.version) from project_budgets b2 where b2.project_id = ${projectBudgets.projectId})`))
      .groupBy(projectBudgets.projectId, budgetLines.partnerId, budgetLines.categoryCode) : [];
    const expenseSums = finIds.length ? await tx.select({ projectId: expenses.projectId, partnerId: expenses.partnerId, categoryCode: expenses.categoryCode,
      amount: sql<string>`sum(coalesce(${expenses.recognisedCents}, ${expenses.amountCents}))`, claimed: sql<string>`sum(${expenses.amountCents})` })
      .from(expenses).where(inArray(expenses.projectId, finIds))
      .groupBy(expenses.projectId, expenses.partnerId, expenses.categoryCode) : [];
    const actual = expenseSums.map((r) => ({ projectId: r.projectId, partnerId: r.partnerId, categoryCode: r.categoryCode, amount: r.amount }));
    const claimedBasis = expenseSums.map((r) => ({ projectId: r.projectId, partnerId: r.partnerId, categoryCode: r.categoryCode, amount: r.claimed }));
    const periods = ids.length ? await tx.select({
      id: reportingPeriods.id, projectId: reportingPeriods.projectId, number: reportingPeriods.number, endDate: reportingPeriods.endDate, dueDate: reportingPeriods.dueDate,
      // Predan ZNS vlastite organizacije za razdoblje (sve osim nacrta). WP1.17: razdoblje s troškovima vlastite organizacije
      // potraživanim izvan sustava (ZNS predan prije ArQusa, uvezen iz Excela) također je predano – nije „razdoblje bez ZNS-a”.
      submitted: periodSubmitted,
    }).from(reportingPeriods).where(inArray(reportingPeriods.projectId, ids)).orderBy(asc(reportingPeriods.projectId), asc(reportingPeriods.number)) : [];
    const delivs = ids.length ? await tx.select({ id: deliverables.id, projectId: deliverables.projectId, wp: workPackages.number, number: deliverables.number, title: deliverables.title, dueMonth: deliverables.dueMonth })
      .from(deliverables).innerJoin(workPackages, eq(workPackages.id, deliverables.workPackageId))
      .where(and(inArray(deliverables.projectId, ids), isNull(deliverables.deletedAt), inArray(deliverables.status, [...OPEN_DELIVERABLE_STATUSES]))) : [];
    const mss = ids.length ? await tx.select({ id: milestones.id, projectId: milestones.projectId, number: milestones.number, title: milestones.title, dueMonth: milestones.dueMonth })
      .from(milestones).where(and(inArray(milestones.projectId, ids), isNull(milestones.deletedAt), inArray(milestones.status, [...OPEN_MILESTONE_STATUSES]))) : [];
    const counters = ids.length && !opts.deadlinesOnly ? await tx.select({
      id: projects.id,
      highRisks: highRisksCount,
      toApprove: timesheetsToApproveCount,
      // Ručno uneseni troškovi bez dokaza; povjerljiv dokaz broji se samo tko ga smije vidjeti (WP1.14). Definicije: ./facts.ts.
      noEvidence: withoutEvidenceCount(false),
      noVisibleEvidence: withoutEvidenceCount(true),
      // WP1.16b: nepredani troškovi iz ranijih razdoblja (razdoblje već predano, trošak nije odabran ni u jednom nacrtu).
      stranded: strandedCount,
    }).from(projects).where(inArray(projects.id, ids)) : [];

    const deadlines: Deadline[] = [];
    let plannedTotal = 0, plannedOwn = 0, requestedTotal = 0, requestedOwn = 0, spentOwn = 0, spentTotal = 0, unrecognisedOwn = 0, unrecognisedTotal = 0, financeProjects = 0;
    const projectViews = projRows.map(({ p, programme }) => {
      const pk = pkgCache.get(`${p.packageId}@${p.packageVersion}`)!;
      const open = OPEN.includes(p.status);
      const time = timeProgress(p.startDate, p.durationMonths, today);
      const tab = (t: string) => `projekti/${p.id}/${t}`;

      let budget = null;
      if (!opts.deadlinesOnly && seesFinance(p.id)) {
        const parts = partners.filter((x) => x.projectId === p.id);
        const lines = (rows: typeof planned): Lines => rows.filter((r) => r.projectId === p.id).map((r) => ({ partnerId: r.partnerId, categoryCode: r.categoryCode, amount: Number(r.amount) }));
        const pl = computeProjectBudget(pk, p.actionType, parts, lines(planned));
        const ac = computeProjectBudget(pk, p.actionType, parts, lines(actual));
        const cl = computeProjectBudget(pk, p.actionType, parts, lines(claimedBasis));
        const selfIdx = parts.findIndex((x) => x.isSelf);
        const own = (r: typeof pl) => (selfIdx >= 0 ? r.partners[selfIdx]! : { total: 0, requested: 0 });
        const percent = budgetPercent(own(pl).total, own(ac).total);
        budget = {
          planned: own(pl).total, actual: own(ac).total, unrecognised: own(cl).total - own(ac).total, requested: own(pl).requested, percent,
          ...progressSignal(time.percent, percent),
          projectPlanned: pl.totals.total, projectActual: ac.totals.total, projectUnrecognised: cl.totals.total - ac.totals.total, projectRequested: pl.totals.requested,
        };
        if (RUNNING.includes(p.status)) {
          financeProjects++;
          plannedTotal += pl.totals.total; requestedTotal += pl.totals.requested; spentTotal += ac.totals.total;
          plannedOwn += own(pl).total; requestedOwn += own(pl).requested; spentOwn += own(ac).total;
          unrecognisedTotal += cl.totals.total - ac.totals.total; unrecognisedOwn += own(cl).total - own(ac).total;
        }
      }

      const rps = periods.filter((r) => r.projectId === p.id);
      const owed = rps.filter((r) => !r.submitted);
      const next = owed[0];
      const late = delivs.filter((d) => d.projectId === p.id && p.startDate && monthEndDate(p.startDate, d.dueMonth) < today).length;
      const c = counters.find((x) => x.id === p.id);
      if (open) {
        const reportLink = seesFinance(p.id) ? tab('zns') : `projekti/${p.id}`;
        for (const r of owed) {
          deadlines.push({ key: `rp-${r.id}-end`, kind: 'period_end', date: r.endDate, overdueRelevant: false, title: `RP${r.number} – kraj izvještajnog razdoblja`, link: `projekti/${p.id}`, projectId: p.id, acronym: p.acronym, scope: p.acronym });
          deadlines.push({ key: `rp-${r.id}-due`, kind: 'claim_due', date: r.dueDate, overdueRelevant: true, title: `RP${r.number} – rok za zahtjev za nadoknadu i izvještaj`, link: reportLink, projectId: p.id, acronym: p.acronym, scope: p.acronym });
        }
        if (p.startDate) {
          for (const d of delivs.filter((x) => x.projectId === p.id)) deadlines.push({ key: `deliverable-${d.id}`, kind: 'deliverable', date: monthEndDate(p.startDate, d.dueMonth), overdueRelevant: true, title: `D${d.wp}.${d.number} ${d.title}`, link: tab('struktura'), projectId: p.id, acronym: p.acronym, scope: p.acronym });
          for (const m of mss.filter((x) => x.projectId === p.id)) deadlines.push({ key: `milestone-${m.id}`, kind: 'milestone', date: monthEndDate(p.startDate, m.dueMonth), overdueRelevant: true, title: `MS${m.number} ${m.title}`, link: tab('struktura'), projectId: p.id, acronym: p.acronym, scope: p.acronym });
        }
      }
      return {
        id: p.id, acronym: p.acronym, title: p.title, programme, packageId: p.packageId, actionType: p.actionType, role: p.role, status: p.status,
        startDate: p.startDate, durationMonths: p.durationMonths, endDate: time.endDate,
        time: { state: time.state, month: time.month, percent: time.percent },
        budget,
        nextReport: next ? { period: next.number, endDate: next.endDate, dueDate: next.dueDate, days: daysBetween(today, next.dueDate), overdue: next.dueDate < today } : null,
        attention: open ? {
          lateDeliverables: late,
          highRisks: c?.highRisks ?? 0,
          timesheetsToApprove: seesTimesheets(p.id) ? (c?.toApprove ?? 0) : null,
          expensesWithoutEvidence: seesFinance(p.id) ? ((seesConfidential(p.id) ? c?.noEvidence : c?.noVisibleEvidence) ?? 0) : null,
          unclaimedPeriods: seesFinance(p.id) ? rps.filter((r) => !r.submitted && r.endDate < today).length : null,
          strandedExpenses: seesFinance(p.id) ? (c?.stranded ?? 0) : null,
        } : null,
      };
    }).sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.acronym.localeCompare(b.acronym, 'hr'));

    // ---------- radar: rokovi praćenih poziva (go / pratimo) ----------
    if (access.calls) {
      const tracked = await tx.select({ id: calls.id, code: calls.code, title: calls.title, deadlines: calls.deadlines, decision: callTracking.decision, internal: callTracking.internalDeadline })
        .from(calls).innerJoin(callTracking, eq(callTracking.callId, calls.id))
        .where(and(isNull(calls.deletedAt), eq(calls.cancelled, false), inArray(callTracking.decision, ['go', 'watch'])));
      for (const c of tracked) {
        const detail = c.decision === 'go' ? 'odluka go' : 'pratimo';
        const seen = new Map<string, number>();
        for (const d of (c.deadlines as CallDeadline[]).filter((x) => SUBMISSION_KINDS.includes(x.kind))) {
          const at = new Date(d.at);
          if (Number.isNaN(at.getTime())) continue;
          const n = (seen.get(d.kind) ?? 0) + 1; seen.set(d.kind, n);
          deadlines.push({ key: `call-${c.id}-${d.kind}${n > 1 ? `-${n}` : ''}`, kind: 'call_submission', date: dateIn(tenantTimeZone(), at), at: d.at, overdueRelevant: false, title: c.title, detail: `${d.label ?? 'rok predaje'} · ${detail}`, link: `radar/${c.id}`, callId: c.id, scope: c.code });
        }
        if (c.internal) deadlines.push({ key: `call-${c.id}-internal`, kind: 'call_internal', date: c.internal, overdueRelevant: false, title: c.title, detail, link: `radar/${c.id}`, callId: c.id, scope: c.code });
      }
    }

    // ---------- prijave ----------
    let pipeline = null; let success = null; let byStatus: { status: string; count: number; requested: number; requestedOwn: number }[] | null = null;
    if (access.pipeline) {
      const rows = await tx.select({ p: proposals, callCode: calls.code }).from(proposals).leftJoin(calls, eq(calls.id, proposals.callId))
        .where(and(isNull(proposals.deletedAt), ownProposals ? inArray(proposals.id, ownProposals) : undefined));
      const pids = rows.map((r) => r.p.id);
      const members = pids.length && !opts.deadlinesOnly ? await tx.select({ id: proposalMembers.id, proposalId: proposalMembers.proposalId, beneficiaryType: proposalMembers.beneficiaryType, isSelf: organisations.isSelf })
        .from(proposalMembers).innerJoin(organisations, eq(organisations.id, proposalMembers.organisationId)).where(inArray(proposalMembers.proposalId, pids)).orderBy(asc(proposalMembers.orderNo)) : [];
      const plines = pids.length && !opts.deadlinesOnly ? await tx.select({ proposalId: proposalBudgetLines.proposalId, memberId: proposalBudgetLines.memberId, categoryCode: proposalBudgetLines.categoryCode, amount: sql<string>`sum(${proposalBudgetLines.amountCents})` })
        .from(proposalBudgetLines).where(inArray(proposalBudgetLines.proposalId, pids)).groupBy(proposalBudgetLines.proposalId, proposalBudgetLines.memberId, proposalBudgetLines.categoryCode) : [];
      if (!opts.deadlinesOnly) for (const { p } of rows) await pkg(p.packageId, p.packageVersion);
      const list = rows.map(({ p, callCode }) => {
        const ms = members.filter((m) => m.proposalId === p.id);
        let requested = 0, requestedOwn = 0;
        try {
          const b = computeProjectBudget(pkgCache.get(`${p.packageId}@${p.packageVersion}`)!, p.actionType, ms, plines.filter((l) => l.proposalId === p.id).map((l) => ({ partnerId: l.memberId, categoryCode: l.categoryCode, amount: Number(l.amount) })));
          requested = b.totals.requested;
          const i = ms.findIndex((m) => m.isSelf); requestedOwn = i >= 0 ? b.partners[i]!.requested : 0;
        } catch { /* proračun prijave koji ne odgovara paketu ne ruši portfelj */ }
        if (OPEN_PROPOSAL.includes(p.status) && p.internalDeadline) deadlines.push({ key: `proposal-${p.id}-internal`, kind: 'proposal_internal', date: p.internalDeadline, overdueRelevant: true, title: p.title, link: `prijave/${p.id}`, proposalId: p.id, scope: p.acronym });
        return { id: p.id, acronym: p.acronym, title: p.title, status: p.status, callCode, internalDeadline: p.internalDeadline, requested, requestedOwn };
      });
      const order = [...PIPELINE_STATUSES, 'contracted', 'rejected', 'withdrawn'] as string[];
      byStatus = order.map((status) => {
        const xs = list.filter((x) => x.status === status);
        return { status, count: xs.length, requested: xs.reduce((a, x) => a + x.requested, 0), requestedOwn: xs.reduce((a, x) => a + x.requestedOwn, 0) };
      }).filter((s) => s.count > 0);
      success = successRate(list.map((x) => x.status));
      const open = list.filter((x) => (PIPELINE_STATUSES as readonly string[]).includes(x.status));
      pipeline = {
        open: open.length, requested: open.reduce((a, x) => a + x.requested, 0), requestedOwn: open.reduce((a, x) => a + x.requestedOwn, 0), byStatus,
        proposals: open.sort((a, b) => (a.internalDeadline ?? '9999').localeCompare(b.internalDeadline ?? '9999') || order.indexOf(a.status) - order.indexOf(b.status) || a.acronym.localeCompare(b.acronym, 'hr'))
          .map((x) => ({ ...x, days: x.internalDeadline ? daysBetween(today, x.internalDeadline) : null })),
      };
    }

    // ---------- opterećenje ljudi ----------
    let people = null;
    if (access.people && ids.length && !opts.deadlinesOnly) {
      const months = lastMonths(today, 6);
      const year = today.slice(0, 4);
      const from = [months[0]!, `${year}-01`].sort()[0]!;
      const mem = await tx.select({ id: teamMembers.id, projectId: teamMembers.projectId, userId: teamMembers.userId, fullName: teamMembers.fullName }).from(teamMembers).where(inArray(teamMembers.projectId, ids));
      const limitOf = new Map(projRows.map(({ p }) => [p.id, annualProductiveHours(pkgCache.get(`${p.packageId}@${p.packageVersion}`)!.personnelRule)]));
      const refs: TeamMemberRef[] = mem.map((m) => ({ memberId: m.id, projectId: m.projectId, userId: m.userId, fullName: m.fullName, annualLimitHours: limitOf.get(m.projectId) ?? null }));
      // Predani, odobreni i zaključani timesheetovi (nacrt još nije prijavljen rad).
      const dayRows = await tx.select({ memberId: timesheets.teamMemberId, month: timesheets.month, day: timesheetEntries.day, minutes: sql<number>`sum(${timesheetEntries.minutes})::int` })
        .from(timesheetEntries).innerJoin(timesheets, eq(timesheets.id, timesheetEntries.timesheetId))
        .where(and(inArray(timesheets.projectId, ids), ne(timesheets.status, 'draft'), sql`${timesheets.month} >= ${from}`))
        .groupBy(timesheets.teamMemberId, timesheets.month, timesheetEntries.day);
      const days: WorkDay[] = dayRows.map((r) => ({ memberId: r.memberId, date: `${r.month}-${String(r.day).padStart(2, '0')}`, minutes: r.minutes }));
      const acr = new Map(projRows.map(({ p }) => [p.id, p.acronym]));
      const persons = personWorkload(refs, days, { months, year })
        .filter((x) => x.yearMinutes > 0 || x.months.some((m) => m.minutes > 0))
        .map((x) => ({ ...x, projects: x.projectIds.map((id) => ({ id, acronym: acr.get(id) ?? '' })) }));
      people = { months, year, dailyLimitHours: DAILY_HOURS_LIMIT, persons };
    }

    const counts = deadlineCounts(deadlines, today);
    const running = projectViews.filter((p) => RUNNING.includes(p.status));
    const view = {
      today, days: opts.days, thresholdPp: PROGRESS_THRESHOLD_PP,
      access: { ...access, finance: finIds.length === ids.length ? (ids.length ? 'all' : 'none') : finIds.length ? 'partial' : 'none' },
      summary: {
        projects: projectViews.length,
        activeProjects: running.length,
        money: financeProjects ? {
          projects: financeProjects, planned: plannedOwn, requested: requestedOwn, spent: spentOwn, spentPercent: budgetPercent(plannedOwn, spentOwn), unrecognised: unrecognisedOwn,
          projectPlanned: plannedTotal, projectRequested: requestedTotal, projectSpent: spentTotal, projectUnrecognised: unrecognisedTotal,
        } : null,
        deadlinesSoon: counts.soon, overdue: counts.overdue,
        attention: {
          lagging: projectViews.filter((p) => p.budget?.signal === 'lagging').length,
          ahead: projectViews.filter((p) => p.budget?.signal === 'ahead').length,
        },
        pipeline: pipeline ? { open: pipeline.open, requested: pipeline.requested, requestedOwn: pipeline.requestedOwn, byStatus } : null,
        successRate: success,
      },
      projects: projectViews,
      deadlines: mergeDeadlines(deadlines, today, opts.days),
      people,
      pipeline,
    };
    return { view, deadlines };
  }
}

