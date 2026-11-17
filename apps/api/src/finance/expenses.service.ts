import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { computeProjectBudget, diffTotals, effectiveAmount, expenseRuleIssues, flattenCategories } from '@arqus/domain';
import type { Tx } from '../db/db.service';
import { budgetLines, expenses, organisations, projectBudgets, projectPartners, reimbursementClaims, reportingPeriods, teamMembers, timesheets, workPackages, type Project } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { ProgrammePackagesService } from '../programmes/programme-packages.service';
import { loadProject } from '../common/project-access';
import { currentContext } from '../common/tenant-context';
import { canOnProject } from '../common/access';
import { assertSpendable, notSelectedInDraft, projectEnd, selfPartner, strandedExpense } from './finance-common';
import { hidesAmount, seesPersonnelAmounts } from '../common/personnel';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const expenseInput = z.object({
  partnerId: z.string().uuid().optional(), categoryCode: z.string().min(1).max(20), workPackageId: z.string().uuid().nullable().optional(),
  date: isoDate, description: z.string().trim().min(2).max(500), supplier: z.string().max(200).optional(),
  amount: z.number().int().min(0).max(100_000_000_000), evidenceRef: z.string().max(200).optional(),
});
export const expensePatch = expenseInput.omit({ partnerId: true }).partial().strict();

/** Broj aktivnih dokumenata (dokaza) uz trošak; RLS vrijedi i u podupitu. Povjerljivi se broje samo korisniku koji ih smije vidjeti (WP1.14). */
export const evidenceCount = (includeConfidential: boolean) => includeConfidential
  ? sql<number>`(select count(*)::int from documents d where d.entity_type = 'expense' and d.entity_id = "expenses"."id" and d.deleted_at is null)`
  : sql<number>`(select count(*)::int from documents d where d.entity_type = 'expense' and d.entity_id = "expenses"."id" and d.deleted_at is null and d.confidentiality <> 'confidential')`;
/** Smije li korisnik iz konteksta vidjeti povjerljive dokumente projekta. */
export const seesConfidential = (projectId: string): boolean => { const c = currentContext(); return !c || canOnProject(c, 'documents:confidential', projectId); };
/**
 * Trošak za prikaz; `person`/`month`/`workPackage` služe grupiranju troškova osoblja (osoba i mjesec → retci po radnom paketu).
 * WP1.19: `canSeePersonnel = false` – iznos i priznati iznos troška osoblja su `null`, `amountHidden: true` (sati ostaju u opisu).
 */
const view = (e: typeof expenses.$inferSelect, documents = 0, extra: { person?: string | null; month?: string | null; wp?: number | null } = {}, canSeePersonnel = true) => {
  const hidden = hidesAmount(e.source, canSeePersonnel);
  return {
    id: e.id, partnerId: e.partnerId, categoryCode: e.categoryCode, workPackageId: e.workPackageId, date: e.date, description: e.description,
    supplier: e.supplier, amount: hidden ? null : e.amountCents, recognised: hidden ? null : e.recognisedCents, amountHidden: hidden,
    decisionReason: e.decisionReason, evidenceRef: e.evidenceRef, source: e.source,
    timesheetId: e.timesheetId, claimId: e.claimId, status: e.status, documents,
    // WP1.17: trošak potraživan izvan sustava (ZNS predan prije ArQusa) – oznaka zahtjeva i član tima troška osoblja iz ranijeg razdoblja.
    historic: e.status === 'historic', externalClaim: e.externalClaim, teamMemberId: e.teamMemberId, imported: !!e.importId,
    person: extra.person ?? null, month: extra.month ?? null, workPackage: extra.wp ? `WP${extra.wp}` : null,
  };
};

/** Evidencija troškova (invarijante 3 i 6) i pregled ugovoreno vs. ostvareno. */
@Injectable()
export class ExpensesService {
  constructor(private readonly audit: AuditService, private readonly packages: ProgrammePackagesService) {}

  /** Pravila troška su ista za ručni unos i uvoz iz Excela (WP1.17): `expenseRuleIssues` u domeni. */
  private async validate(tx: Tx, p: Project, partnerId: string, input: { categoryCode: string; workPackageId?: string | null; date: string; amount: number }) {
    const pkg = await this.packages.get(tx, p.packageId, p.packageVersion);
    const partners = await tx.select({ id: projectPartners.id }).from(projectPartners).where(eq(projectPartners.projectId, p.id));
    const wps = input.workPackageId ? await tx.select({ id: workPackages.id }).from(workPackages).where(and(eq(workPackages.id, input.workPackageId), eq(workPackages.projectId, p.id))) : [];
    const issues = expenseRuleIssues(pkg, { partnerIds: new Set(partners.map((x) => x.id)), workPackageIds: new Set(wps.map((w) => w.id)), projectStart: p.startDate, projectEnd: projectEnd(p) }, { partnerId, ...input });
    if (issues.length) throw new BadRequestException({ message: 'Trošak nije valjan', issues });
  }

  async list(tx: Tx, projectId: string, filter: { status?: string; period?: number } = {}) {
    await loadProject(tx, projectId);
    const conds: (SQL | undefined)[] = [eq(expenses.projectId, projectId), filter.status ? eq(expenses.status, filter.status as never) : undefined];
    const historicMember = alias(teamMembers, 'historic_member');
    let rows = (await tx.select({ e: expenses, docs: evidenceCount(seesConfidential(projectId)), person: teamMembers.fullName, historicPerson: historicMember.fullName, month: timesheets.month, wp: workPackages.number }).from(expenses)
      .leftJoin(timesheets, eq(timesheets.id, expenses.timesheetId)).leftJoin(teamMembers, eq(teamMembers.id, timesheets.teamMemberId)).leftJoin(workPackages, eq(workPackages.id, expenses.workPackageId))
      .leftJoin(historicMember, eq(historicMember.id, expenses.teamMemberId))
      .where(and(...conds)).orderBy(desc(expenses.date), asc(expenses.createdAt))).map((r) => Object.assign(r.e, { docs: r.docs, extra: {
        person: r.person ?? r.historicPerson, month: r.month ?? (r.e.source === 'historic_personnel' ? r.e.date.slice(0, 7) : null), wp: r.wp } }));
    if (filter.period) {
      const rp = (await tx.select().from(reportingPeriods).where(and(eq(reportingPeriods.projectId, projectId), eq(reportingPeriods.number, filter.period))))[0];
      if (!rp) throw new NotFoundException(`Razdoblje RP${filter.period} ne postoji`);
      rows = rows.filter((e) => e.date >= rp.startDate && e.date <= rp.endDate);
    }
    const canSee = seesPersonnelAmounts(projectId);
    return rows.map((e) => view(e, e.docs, e.extra, canSee));
  }

  async create(tx: Tx, tenantId: string, projectId: string, input: z.infer<typeof expenseInput>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    assertSpendable(p);
    const partnerId = input.partnerId ?? (await selfPartner(tx, projectId)).id;
    await this.validate(tx, p, partnerId, input);
    const [row] = await tx.insert(expenses).values({ tenantId, projectId, partnerId, categoryCode: input.categoryCode, workPackageId: input.workPackageId ?? null, date: input.date,
      description: input.description, supplier: input.supplier ?? null, amountCents: input.amount, evidenceRef: input.evidenceRef ?? null, createdBy: actorId, updatedBy: actorId }).returning();
    await this.audit.record(tx, { entity: 'expense', entityId: row!.id, action: 'create', diff: { after: view(row!) } });
    return view(row!);
  }

  private async editable(tx: Tx, projectId: string, id: string) {
    const e = (await tx.select().from(expenses).where(and(eq(expenses.id, id), eq(expenses.projectId, projectId))))[0];
    if (!e) throw new NotFoundException('Trošak ne postoji na projektu');
    if (e.status === 'historic') throw new ConflictException('Trošak potraživan izvan sustava (uvezen iz Excela) se ne mijenja – ako je uvoz pogrešan, poništi ga na kartici „Uvoz”');
    if (e.status !== 'recorded') throw new ConflictException(`Trošak u statusu "${e.status}" se ne mijenja (ispravak: storno i novi zapis)`);
    if (e.source !== 'manual') throw new ConflictException('Trošak osoblja mijenja se kroz timesheet');
    return e;
  }

  async update(tx: Tx, projectId: string, id: string, patch: z.infer<typeof expensePatch>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    const before = await this.editable(tx, projectId, id);
    await this.validate(tx, p, before.partnerId, { categoryCode: patch.categoryCode ?? before.categoryCode, workPackageId: patch.workPackageId === undefined ? before.workPackageId : patch.workPackageId, date: patch.date ?? before.date, amount: patch.amount ?? before.amountCents });
    const { amount, ...rest } = patch;
    const [row] = await tx.update(expenses).set({ ...rest, ...(amount !== undefined ? { amountCents: amount } : {}), updatedAt: new Date(), updatedBy: actorId }).where(eq(expenses.id, id)).returning();
    await this.audit.record(tx, { entity: 'expense', entityId: id, action: 'update', diff: { before: view(before), after: view(row!) } });
    return view(row!);
  }

  async remove(tx: Tx, projectId: string, id: string) {
    await loadProject(tx, projectId, { editable: true });
    const before = await this.editable(tx, projectId, id);
    await tx.delete(expenses).where(eq(expenses.id, id));
    await this.audit.record(tx, { entity: 'expense', entityId: id, action: 'delete', diff: { before: view(before) } });
    return { deleted: true };
  }

  /**
   * Ugovoreno (zadnja verzija proračuna) vs. ostvareno, s neizravnima iz paketa; pregled ZNS-ova.
   * Ostvareno (jedna definicija, `docs/domena/zns-pravila.md`): prije odluke traženi iznos troška, nakon odluke priznati
   * (odbijen = 0). Nepriznato = isti izračun s traženim iznosima − ostvareno.
   */
  async overview(tx: Tx, projectId: string) {
    const p = await loadProject(tx, projectId);
    const pkg = await this.packages.get(tx, p.packageId, p.packageVersion);
    const partners = await tx.select({ id: projectPartners.id, beneficiaryType: projectPartners.beneficiaryType, name: organisations.name }).from(projectPartners)
      .innerJoin(organisations, eq(organisations.id, projectPartners.organisationId)).where(eq(projectPartners.projectId, projectId)).orderBy(asc(projectPartners.orderNo));
    const budget = (await tx.select().from(projectBudgets).where(eq(projectBudgets.projectId, projectId)).orderBy(desc(projectBudgets.version)).limit(1))[0];
    const planLines = budget ? await tx.select().from(budgetLines).where(eq(budgetLines.budgetId, budget.id)) : [];
    const actualRows = await tx.select().from(expenses).where(eq(expenses.projectId, projectId));
    const planned = computeProjectBudget(pkg, p.actionType, partners, planLines.map((l) => ({ partnerId: l.partnerId, categoryCode: l.categoryCode, amount: l.amountCents })));
    const actual = computeProjectBudget(pkg, p.actionType, partners, actualRows.map((e) => ({ partnerId: e.partnerId, categoryCode: e.categoryCode, amount: effectiveAmount({ amount: e.amountCents, recognised: e.recognisedCents }) })));
    const claimedBasis = computeProjectBudget(pkg, p.actionType, partners, actualRows.map((e) => ({ partnerId: e.partnerId, categoryCode: e.categoryCode, amount: e.amountCents })));
    const sumBy = (rows: { categoryCode: string; amount: number }[], code: string) => rows.filter((r) => r.categoryCode === code).reduce((a, r) => a + r.amount, 0);
    const plan = planLines.map((l) => ({ categoryCode: l.categoryCode, amount: l.amountCents }));
    const act = actualRows.map((e) => ({ categoryCode: e.categoryCode, amount: effectiveAmount({ amount: e.amountCents, recognised: e.recognisedCents }) }));
    const claimedRows = actualRows.map((e) => ({ categoryCode: e.categoryCode, amount: e.amountCents }));
    const byCategory = flattenCategories(pkg.costCategories).filter((c) => c.kind !== 'indirect' && !(c.children && c.children.length)).map((c) => {
      const pl = sumBy(plan, c.code), ac = sumBy(act, c.code);
      return { code: c.code, name: c.name, planned: pl, actual: ac, unrecognised: sumBy(claimedRows, c.code) - ac, remaining: pl - ac, percent: pl ? Math.round((ac / pl) * 100) : null };
    });
    const claims = await tx.select({ c: reimbursementClaims, number: reportingPeriods.number }).from(reimbursementClaims)
      .innerJoin(reportingPeriods, eq(reportingPeriods.id, reimbursementClaims.reportingPeriodId)).where(eq(reimbursementClaims.projectId, projectId)).orderBy(asc(reportingPeriods.number));
    // WP1.16b: nepredani troškovi iz ranijih razdoblja (datirani u već predanom razdoblju, nisu odabrani ni u jednom nacrtu).
    // WP1.19: bez personnel:read iznos ne uključuje troškove osoblja (jedan nepredan trošak osoblja otkrio bi satnicu).
    const canSee = seesPersonnelAmounts(projectId);
    const stranded = (await tx.select({ n: sql<number>`count(*)::int`,
      amount: canSee ? sql<string>`coalesce(sum(${expenses.amountCents}), 0)` : sql<string>`coalesce(sum(${expenses.amountCents}) filter (where ${expenses.source} <> 'timesheet'), 0)`,
      personnel: sql<number>`(count(*) filter (where ${expenses.source} = 'timesheet'))::int` }).from(expenses)
      .where(and(eq(expenses.projectId, projectId), strandedExpense(), notSelectedInDraft())))[0];
    return {
      projectId, budgetVersion: budget?.version ?? null, budgetStatus: budget?.status ?? 'none',
      strandedExpenses: { count: stranded?.n ?? 0, amount: Number(stranded?.amount ?? 0), personnelAmountHidden: !canSee && (stranded?.personnel ?? 0) > 0 },
      planned: planned.totals, actual: actual.totals, unrecognised: diffTotals(claimedBasis.totals, actual.totals), byCategory,
      byPartner: partners.map((x, i) => ({ partnerId: x.id, name: x.name, planned: planned.partners[i]!.total, actual: actual.partners[i]!.total, unrecognised: claimedBasis.partners[i]!.total - actual.partners[i]!.total })),
      claims: claims.map(({ c, number }) => ({ id: c.id, period: number, partnerId: c.partnerId, status: c.status, requested: c.requestedCents, approved: c.approvedCents, paid: c.paidCents })),
    };
  }
}
