import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  addDays, callStatus, claimChecklist, dateIn, deriveWorkItems, packageDeviations, projectEndDate, proposalReadiness, monthEndDate,
  type CallDeadline, type ClaimFact, type FinanceFacts, type ManagerFacts, type MemberFacts, type PeriodFact, type ProgrammePackage, type ResponsibleFact, type WorkFacts,
} from '@arqus/domain';
import type { Tx } from '../db/db.service';
import {
  budgetLines, callTracking, calls, deliverables, expenses, milestones, projectBudgets, projects, proposalMembers, proposals, organisations,
  reimbursementClaims, reportingPeriods, risks, teamMembers, timesheetEntries, timesheets, workPackages, type ClaimStatus,
} from '../db/schema';
import { ProgrammePackagesService } from '../programmes/programme-packages.service';
import { IdentityService } from '../identity/identity.service';
import { TenantContext, tenantTimeZone, tenantToday } from '../common/tenant-context';
import { canInTenant, canOnProject, projectGrants, projectsWith } from '../common/access';
import { openSubjectRequestFacts } from '../privacy/subject-requests.service';
import { hasPermission, type Permission } from '../identity/permissions';
import {
  highRisksCount, OPEN_DELIVERABLE_STATUSES, OPEN_MILESTONE_STATUSES, OPEN_PROJECT_STATUSES, OPEN_TASK_STATUSES, OPEN_PROPOSAL_STATUSES, periodSubmitted, RUNNING_PROJECT_STATUSES,
  strandedCount, withoutEvidenceCount,
} from '../portfolio/facts';
import { SUBMISSION_KINDS } from '../portfolio/portfolio.service';

const DECIDED_OK: ClaimStatus[] = ['approved', 'partially_approved'];

/**
 * WP1.18 – „Moj rad”: činjenice za korisnika iz konteksta (WP1.14 model pristupa), izvođenje stavki u `@arqus/domain`
 * (`deriveWorkItems`). Ništa se ne sprema. Broj upita je ograničen i ne ovisi o broju projekata: svaki upit obuhvaća sve
 * relevantne projekte (`inArray`), upiti idu jedan za drugim na istoj transakciji. Jedina iznimka: jedan dohvat po
 * različitom paketu programa (odstupanja, pravila konzorcija), kao na portfelju.
 *
 * Uloga korisnika NA SVAKOM PROJEKTU:
 * - član tima: korisnik je povezan s aktivnim članom tima projekta u provedbi i smije voditi timesheet (`timesheets:write`);
 * - odobravatelj / voditelj / financije: dozvola (`timesheets:approve` / `projects:write` / `finance:write`) dodijeljena NA
 *   TOM PROJEKTU ili je korisnik imenovani voditelj projekta (i dozvolu ima). Dozvole na razini institucije (administrator,
 *   ured za projekte) ne pretvaraju svaki projekt institucije u osobnu obvezu – njihov pregled je portfelj. Iznimka:
 *   financijski ured (`finance:write` institucije bez `projects:write` institucije) dobiva stavke financija svih projekata.
 * - prijave: voditelj prijave (vlastite) ili izričita `proposals:write` institucije (ne kroz `*`);
 * - pozivi: izričita `calls:write` institucije; administrator: `users:write` institucije (MFA) i `privacy:manage`
 *   (otvoreni zahtjevi ispitanika, WP1.24).
 */
@Injectable()
export class MyWorkService {
  constructor(private readonly packages: ProgrammePackagesService, private readonly identity: IdentityService, private readonly ctx: TenantContext) {}

  async work(tx: Tx, now: Date = new Date()) {
    const facts = await this.facts(tx, now);
    return { today: facts.today, ...deriveWorkItems(facts) };
  }

  async facts(tx: Tx, now: Date = new Date()): Promise<WorkFacts> {
    const ctx = this.ctx.require();
    const userId = ctx.userId!;
    const today = tenantToday(now);
    const visible = projectsWith(ctx, 'projects:read');

    // 1) Projekti koje korisnik vidi (otvoreni) – jedan upit.
    const projRows = visible !== 'all' && !visible.length ? [] : await tx.select({
      id: projects.id, acronym: projects.acronym, status: projects.status, startDate: projects.startDate, durationMonths: projects.durationMonths,
      managerUserId: projects.managerUserId, packageId: projects.packageId, packageVersion: projects.packageVersion,
    }).from(projects).where(and(isNull(projects.deletedAt), inArray(projects.status, OPEN_PROJECT_STATUSES), visible === 'all' ? undefined : inArray(projects.id, visible)))
      .orderBy(asc(projects.acronym));

    const scoped = (projectId: string, p: Permission) => hasPermission(projectGrants(ctx, projectId), p);
    const financeOffice = canInTenant(ctx, 'finance:write') && !canInTenant(ctx, 'projects:write');
    const duty = (p: (typeof projRows)[number], perm: Permission, office = false) =>
      canOnProject(ctx, perm, p.id) && (scoped(p.id, perm) || p.managerUserId === userId || office);
    const running = projRows.filter((p) => RUNNING_PROJECT_STATUSES.includes(p.status));
    const approverIds = running.filter((p) => duty(p, 'timesheets:approve')).map((p) => p.id);
    const financeIds = projRows.filter((p) => p.status !== 'contracting' && duty(p, 'finance:write', financeOffice)).map((p) => p.id);
    const managerIds = projRows.filter((p) => duty(p, 'projects:write')).map((p) => p.id);
    const memberCandidates = running.filter((p) => canOnProject(ctx, 'timesheets:write', p.id)).map((p) => p.id);

    // 2) Član tima: vlastiti članovi tima, njihovi timesheetovi (s oznakom povrata iz revizije) i mjeseci pokriveni uvozom.
    const myMembers = memberCandidates.length ? await tx.select({ id: teamMembers.id, projectId: teamMembers.projectId, createdAt: teamMembers.createdAt })
      .from(teamMembers).where(and(eq(teamMembers.userId, userId), eq(teamMembers.active, true), inArray(teamMembers.projectId, memberCandidates))) : [];
    const memberIds = myMembers.map((m) => m.id);
    const myTs = memberIds.length ? await tx.select({
      memberId: timesheets.teamMemberId, month: timesheets.month, status: timesheets.status,
      minutes: sql<number>`coalesce((select sum(te.minutes) from timesheet_entries te where te.timesheet_id = "timesheets"."id"), 0)::int`,
      reopened: sql<boolean>`("timesheets"."status" = 'draft' and exists (select 1 from audit_entries a where a.entity = 'timesheet' and a.entity_id = "timesheets"."id"::text and a.action = 'reopen'))`,
    }).from(timesheets).where(inArray(timesheets.teamMemberId, memberIds)) : [];
    const covered = memberIds.length ? await tx.selectDistinct({ memberId: expenses.teamMemberId, month: sql<string>`to_char(${expenses.date}, 'YYYY-MM')` })
      .from(expenses).where(and(inArray(expenses.teamMemberId, memberIds), eq(expenses.source, 'historic_personnel'))) : [];
    const tz = tenantTimeZone();
    const members: MemberFacts[] = myMembers.map((m) => ({
      projectId: m.projectId, memberId: m.id, joined: dateIn(tz, m.createdAt),
      timesheets: myTs.filter((t) => t.memberId === m.id).map((t) => ({ month: t.month, status: t.status, minutes: t.minutes, reopened: t.reopened })),
      coveredMonths: covered.filter((c) => c.memberId === m.id).map((c) => c.month),
    }));

    // 3) Odobravatelj: predani timesheetovi na projektima na kojima korisnik odobrava (četiri oka primjenjuje domena).
    const approvals = approverIds.length ? await tx.select({ projectId: timesheets.projectId, memberId: timesheets.teamMemberId, fullName: teamMembers.fullName, month: timesheets.month, memberUserId: teamMembers.userId, submittedBy: timesheets.submittedBy })
      .from(timesheets).innerJoin(teamMembers, eq(teamMembers.id, timesheets.teamMemberId))
      .where(and(inArray(timesheets.projectId, approverIds), eq(timesheets.status, 'submitted'))).orderBy(asc(timesheets.month), asc(teamMembers.fullName)) : [];

    // 4) Brojke financija i voditelja – iste definicije kao portfelj (portfolio/facts.ts).
    const factIds = [...new Set([...financeIds, ...managerIds])];
    const counters = factIds.length ? await tx.select({ id: projects.id, highRisks: highRisksCount, noEvidence: withoutEvidenceCount(false), noVisibleEvidence: withoutEvidenceCount(true), stranded: strandedCount })
      .from(projects).where(inArray(projects.id, factIds)) : [];
    const periodRows = factIds.length ? await tx.select({ projectId: reportingPeriods.projectId, number: reportingPeriods.number, endDate: reportingPeriods.endDate, dueDate: reportingPeriods.dueDate, submitted: periodSubmitted })
      .from(reportingPeriods).where(inArray(reportingPeriods.projectId, factIds)).orderBy(asc(reportingPeriods.projectId), asc(reportingPeriods.number)) : [];
    const periodsOf = (id: string): PeriodFact[] => periodRows.filter((r) => r.projectId === id).map((r) => ({ number: r.number, endDate: r.endDate, dueDate: r.dueDate, submitted: !!r.submitted }));

    // 5) Financije: zahtjevi; za nacrte završenih razdoblja (i vraćene) broj otvorenih blokada istim popisom za provjeru kao ZNS.
    const claimRows = financeIds.length ? await tx.select({
      id: reimbursementClaims.id, projectId: reimbursementClaims.projectId, partnerId: reimbursementClaims.partnerId, status: reimbursementClaims.status,
      returned: sql<boolean>`(${reimbursementClaims.status} = 'draft' and ${reimbursementClaims.note} is not null)`, paid: sql<boolean>`(${reimbursementClaims.paidCents} is not null)`,
      period: reportingPeriods.number, startDate: reportingPeriods.startDate, endDate: reportingPeriods.endDate, dueDate: reportingPeriods.dueDate,
    }).from(reimbursementClaims).innerJoin(reportingPeriods, eq(reportingPeriods.id, reimbursementClaims.reportingPeriodId))
      .where(and(inArray(reimbursementClaims.projectId, financeIds), or(eq(reimbursementClaims.status, 'draft'), and(inArray(reimbursementClaims.status, DECIDED_OK), isNull(reimbursementClaims.paidCents)))))
      .orderBy(asc(reportingPeriods.number)) : [];
    const blockers = await this.claimBlockers(tx, claimRows.filter((c) => c.status === 'draft' && (c.returned || c.endDate < today)), today);
    const finance: FinanceFacts[] = financeIds.map((id) => {
      const c = counters.find((x) => x.id === id);
      const claims: ClaimFact[] = claimRows.filter((x) => x.projectId === id).map((x) => ({ id: x.id, period: x.period, periodEnd: x.endDate, dueDate: x.dueDate, status: x.status, returned: !!x.returned, paid: !!x.paid, blockers: blockers.get(x.id) ?? null }));
      return { projectId: id, withoutEvidence: (canOnProject(ctx, 'documents:confidential', id) ? c?.noEvidence : c?.noVisibleEvidence) ?? 0, stranded: c?.stranded ?? 0, periods: periodsOf(id), claims };
    });

    // 6) Voditelj: isporuke i prekretnice (otvorene), odstupanja od pravila programa (zadnja verzija proračuna).
    const mProjects = projRows.filter((p) => managerIds.includes(p.id));
    // WP1.22: uz svaku stavku i odgovorna osoba (ime, račun, aktivan) – voditelj vidi tko je drži; spoj, ne dodatni upit.
    const who = { rName: teamMembers.fullName, rUser: teamMembers.userId, rActive: teamMembers.active, rId: teamMembers.id };
    const delivs = managerIds.length ? await tx.select({ id: deliverables.id, projectId: deliverables.projectId, wp: workPackages.number, number: deliverables.number, title: deliverables.title, dueMonth: deliverables.dueMonth, ...who })
      .from(deliverables).innerJoin(workPackages, eq(workPackages.id, deliverables.workPackageId)).leftJoin(teamMembers, eq(teamMembers.id, deliverables.responsibleMemberId))
      .where(and(inArray(deliverables.projectId, managerIds), isNull(deliverables.deletedAt), inArray(deliverables.status, [...OPEN_DELIVERABLE_STATUSES]))) : [];
    const mss = managerIds.length ? await tx.select({ id: milestones.id, projectId: milestones.projectId, number: milestones.number, title: milestones.title, dueMonth: milestones.dueMonth, ...who })
      .from(milestones).leftJoin(teamMembers, eq(teamMembers.id, milestones.responsibleMemberId)).where(and(inArray(milestones.projectId, managerIds), isNull(milestones.deletedAt), inArray(milestones.status, [...OPEN_MILESTONE_STATUSES]))) : [];
    const lines = managerIds.length ? await tx.select({ projectId: projectBudgets.projectId, categoryCode: budgetLines.categoryCode, amount: budgetLines.amountCents })
      .from(budgetLines).innerJoin(projectBudgets, eq(projectBudgets.id, budgetLines.budgetId))
      .where(and(inArray(projectBudgets.projectId, managerIds), sql`${projectBudgets.version} = (select max(b2.version) from project_budgets b2 where b2.project_id = ${projectBudgets.projectId})`)) : [];
    const pkgCache = new Map<string, ProgrammePackage>();
    const pkg = async (id: string, version: string) => {
      const k = `${id}@${version}`;
      if (!pkgCache.has(k)) pkgCache.set(k, await this.packages.get(tx, id, version));
      return pkgCache.get(k)!;
    };
    const person = (r: { rId: string | null; rName: string | null; rUser: string | null; rActive: boolean | null }) => (r.rId ? { name: r.rName ?? '', userId: r.rUser, active: !!r.rActive } : null);
    const managers: ManagerFacts[] = [];
    for (const p of mProjects) {
      const end = projectEndDate(p.startDate, p.durationMonths);
      const deviations = packageDeviations(await pkg(p.packageId, p.packageVersion), { today, kind: 'project', startDate: p.startDate, endDate: end, budget: lines.filter((l) => l.projectId === p.id) });
      managers.push({
        projectId: p.id, financeLink: canOnProject(ctx, 'finance:read', p.id), highRisks: counters.find((x) => x.id === p.id)?.highRisks ?? 0, deviations: deviations.length,
        deliverables: p.startDate ? delivs.filter((d) => d.projectId === p.id).map((d) => ({ id: d.id, code: `D${d.wp}.${d.number}`, title: d.title, due: monthEndDate(p.startDate!, d.dueMonth), responsible: person(d) })) : [],
        milestones: p.startDate ? mss.filter((m) => m.projectId === p.id).map((m) => ({ id: m.id, code: `MS${m.number}`, title: m.title, due: monthEndDate(p.startDate!, m.dueMonth), responsible: person(m) })) : [],
        periods: periodsOf(p.id),
      });
    }

    // 7) Rizici kojima je korisnik nositelj (na projektima koje vidi).
    const ownRisks = projRows.length ? await tx.select({ projectId: risks.projectId, riskId: risks.id, number: risks.number, description: risks.description }).from(risks)
      .where(and(eq(risks.ownerUserId, userId), isNull(risks.deletedAt), inArray(risks.status, ['open', 'occurred']), inArray(risks.projectId, projRows.map((p) => p.id)))) : [];

    // 7b) WP1.22: stavke kojima je korisnik odgovorna osoba – isporuke, prekretnice i zadaci (otvoreni statusi istih definicija
    // kao portfelj, `portfolio/facts.ts`) na otvorenim projektima koje vidi, preko AKTIVNOG člana tima povezanog s korisnikom.
    // Jedan upit za sve projekte i sve tri vrste; rok = kraj mjeseca roka (zadatak: završnog mjeseca), hitnost u domeni.
    const projIds = projRows.map((p) => p.id);
    const respRows = projIds.length ? (await tx.execute<{ kind: 'deliverable' | 'milestone' | 'task'; id: string; project_id: string; code: string; title: string; month: number; status: string }>(sql`
      with mine as (select id from team_members where user_id = ${userId} and active and project_id = any(${`{${projIds.join(',')}}`}::uuid[]))
      select 'deliverable' as kind, d.id, d.project_id, 'D' || w.number || '.' || d.number as code, d.title, d.due_month as month, d.status from deliverables d join work_packages w on w.id = d.work_package_id
        where d.responsible_member_id in (select id from mine) and d.deleted_at is null and d.status = any(${`{${OPEN_DELIVERABLE_STATUSES.join(',')}}`}::text[])
      union all select 'milestone', m.id, m.project_id, 'MS' || m.number, m.title, m.due_month, m.status from milestones m
        where m.responsible_member_id in (select id from mine) and m.deleted_at is null and m.status = any(${`{${OPEN_MILESTONE_STATUSES.join(',')}}`}::text[])
      union all select 'task', t.id, t.project_id, 'T' || w.number || '.' || t.number, t.title, t.end_month, t.status from tasks t join work_packages w on w.id = t.work_package_id
        where t.responsible_member_id in (select id from mine) and t.deleted_at is null and t.status = any(${`{${OPEN_TASK_STATUSES.join(',')}}`}::text[])`)).rows : [];
    const startOf = new Map(projRows.map((p) => [p.id, p.startDate]));
    const responsible: ResponsibleFact[] = respRows.filter((r) => startOf.get(r.project_id)).map((r) => ({
      projectId: r.project_id, kind: r.kind, id: r.id, code: r.code, title: r.title, due: monthEndDate(startOf.get(r.project_id)!, Number(r.month)), status: r.status,
    }));

    // 8) Prijave s internim rokom do 30 dana unaprijed (i prošlim): vlastite (voditelj) ili sve uz izričitu proposals:write institucije.
    const allProposals = ctx.permissions.has('proposals:write');
    const own = [...(ctx.leadProposals ?? [])];
    const horizon = addDays(today, 30);
    const propRows = allProposals || own.length ? await tx.select({
      p: proposals, callOpensAt: calls.opensAt, callDeadlines: calls.deadlines, callCancelled: calls.cancelled,
      wps: sql<number>`(select count(*)::int from proposal_work_packages w where w.proposal_id = "proposals"."id")`,
      budget: sql<number>`(select coalesce(sum(l.amount_cents), 0)::bigint from proposal_budget_lines l where l.proposal_id = "proposals"."id")`,
    }).from(proposals).leftJoin(calls, eq(calls.id, proposals.callId))
      .where(and(isNull(proposals.deletedAt), inArray(proposals.status, OPEN_PROPOSAL_STATUSES), lte(proposals.internalDeadline, horizon), allProposals ? undefined : inArray(proposals.id, own))) : [];
    const pmembers = propRows.length ? await tx.select({ proposalId: proposalMembers.proposalId, country: organisations.country, confirmed: proposalMembers.confirmed })
      .from(proposalMembers).innerJoin(organisations, eq(organisations.id, proposalMembers.organisationId)).where(inArray(proposalMembers.proposalId, propRows.map((r) => r.p.id))) : [];
    const proposalFacts = [];
    for (const r of propRows) {
      const pk = await pkg(r.p.packageId, r.p.packageVersion);
      const readiness = proposalReadiness({
        members: pmembers.filter((m) => m.proposalId === r.p.id), minPartners: pk.consortiumRules?.minPartners, minCountries: pk.consortiumRules?.minCountries,
        workPackages: r.wps, budgetTotal: Number(r.budget), budgetLocked: r.p.budgetLocked, hasLead: !!r.p.leadUserId,
        callOpen: r.p.callId ? callStatus({ opensAt: r.callOpensAt, deadlines: (r.callDeadlines ?? []) as CallDeadline[], cancelled: !!r.callCancelled }, now, tz) === 'open' : null,
      });
      proposalFacts.push({ id: r.p.id, acronym: r.p.acronym, title: r.p.title, internalDeadline: r.p.internalDeadline!, openReadiness: readiness.filter((i) => !i.ok).length });
    }

    // 9) Praćeni pozivi bez odluke go / no-go (izričita calls:write institucije).
    const callRows = ctx.permissions.has('calls:write') ? await tx.select({ id: calls.id, code: calls.code, title: calls.title, deadlines: calls.deadlines, internal: callTracking.internalDeadline })
      .from(calls).innerJoin(callTracking, eq(callTracking.callId, calls.id))
      .where(and(isNull(calls.deletedAt), eq(calls.cancelled, false), or(isNull(callTracking.decision), eq(callTracking.decision, 'watch')))) : [];
    const callFacts = callRows.map((c) => {
      const subs = (c.deadlines as CallDeadline[]).filter((d) => SUBMISSION_KINDS.includes(d.kind)).map((d) => new Date(d.at)).filter((d) => !Number.isNaN(d.getTime()))
        .map((d) => dateIn(tz, d)).filter((d) => d >= today).sort();
      return { id: c.id, code: c.code, title: c.title, internalDeadline: c.internal, submission: subs[0] ?? null };
    });

    // 10) Administrator: računi bez obveznog MFA – isti izračun kao „Obvezna dvofaktorska prijava” u izborniku Korisnici.
    let mfaMissing: number | null = null;
    if (canInTenant(ctx, 'users:write')) {
      const s = await this.identity.securitySettings(tx, ctx.tenantId);
      mfaMissing = s.impact[s.requireMfa].withoutMfa;
    }

    // 11) WP1.24: otvoreni zahtjevi ispitanika – samo onome tko ih vodi (`privacy:manage`).
    const subjectRequests = canInTenant(ctx, 'privacy:manage') ? await openSubjectRequestFacts(tx) : [];

    return {
      today, userId,
      projects: projRows.map((p) => ({ id: p.id, acronym: p.acronym, startDate: p.startDate, endDate: projectEndDate(p.startDate, p.durationMonths) })),
      members, approvals, finance, managers, ownRisks, responsible, proposals: proposalFacts, calls: callFacts, mfaMissing, subjectRequests,
    };
  }

  /**
   * Otvorene blokade predaje za nacrte zahtjeva – istom funkcijom kao popis za provjeru na ZNS-u (`claimChecklist`), u dva
   * upita za sve zahtjeve (troškovi nacrta s brojem dokaza; timesheetovi članova tima partnera u mjesecima razdoblja).
   * Razdoblje je završilo, pa razlog rane predaje nije potreban; proračun daje samo upozorenja i ovdje se ne čita.
   */
  private async claimBlockers(tx: Tx, rows: { id: string; projectId: string; startDate: string; endDate: string }[], today: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!rows.length) return out;
    const ids = rows.map((r) => r.id);
    const ex = await tx.select({
      claimId: reimbursementClaims.id, id: expenses.id, date: expenses.date, description: expenses.description, amount: expenses.amountCents, categoryCode: expenses.categoryCode, source: expenses.source,
      docs: sql<number>`(select count(*)::int from documents d where d.entity_type = 'expense' and d.entity_id = "expenses"."id" and d.deleted_at is null)`,
      visibleDocs: sql<number>`(select count(*)::int from documents d where d.entity_type = 'expense' and d.entity_id = "expenses"."id" and d.deleted_at is null and d.confidentiality <> 'confidential')`,
    }).from(reimbursementClaims).innerJoin(reportingPeriods, eq(reportingPeriods.id, reimbursementClaims.reportingPeriodId))
      .innerJoin(expenses, and(eq(expenses.projectId, reimbursementClaims.projectId), eq(expenses.partnerId, reimbursementClaims.partnerId), eq(expenses.status, 'recorded'), isNull(expenses.claimId),
        sql`(${expenses.date} between ${reportingPeriods.startDate} and ${reportingPeriods.endDate} or ${expenses.id} = any(${reimbursementClaims.earlierExpenseIds}))`))
      .where(inArray(reimbursementClaims.id, ids));
    const ts = await tx.select({ claimId: reimbursementClaims.id, memberName: teamMembers.fullName, month: timesheets.month, status: timesheets.status, minutes: sql<number>`coalesce(sum(${timesheetEntries.minutes}), 0)::int` })
      .from(reimbursementClaims).innerJoin(reportingPeriods, eq(reportingPeriods.id, reimbursementClaims.reportingPeriodId))
      .innerJoin(teamMembers, and(eq(teamMembers.projectId, reimbursementClaims.projectId), eq(teamMembers.partnerId, reimbursementClaims.partnerId)))
      .innerJoin(timesheets, and(eq(timesheets.teamMemberId, teamMembers.id), sql`${timesheets.month} between to_char(${reportingPeriods.startDate}, 'YYYY-MM') and to_char(${reportingPeriods.endDate}, 'YYYY-MM')`))
      .leftJoin(timesheetEntries, eq(timesheetEntries.timesheetId, timesheets.id))
      .where(inArray(reimbursementClaims.id, ids)).groupBy(reimbursementClaims.id, teamMembers.fullName, timesheets.month, timesheets.status);
    const ctx = this.ctx.require();
    for (const r of rows) {
      const conf = canOnProject(ctx, 'documents:confidential', r.projectId);
      const items = ex.filter((e) => e.claimId === r.id).map((e) => ({ id: e.id, date: e.date, description: e.description, amount: e.amount, categoryCode: e.categoryCode, source: e.source, documents: conf ? e.docs : e.visibleDocs }));
      const check = claimChecklist({
        today, period: { startDate: r.startDate, endDate: r.endDate },
        expenses: items.filter((e) => e.date >= r.startDate), earlier: items.filter((e) => e.date < r.startDate),
        timesheets: ts.filter((t) => t.claimId === r.id), budget: [],
      });
      out.set(r.id, check.blocking.filter((b) => !b.ok).length);
    }
    return out;
  }
}
