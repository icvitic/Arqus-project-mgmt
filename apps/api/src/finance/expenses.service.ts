import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ne, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { budgetLineIssues, computeProjectBudget, flattenCategories } from '@arqus/domain';
import type { Tx } from '../db/db.service';
import { budgetLines, expenses, organisations, projectBudgets, projectPartners, reimbursementClaims, reportingPeriods, workPackages, type Project } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { ProgrammePackagesService } from '../programmes/programme-packages.service';
import { loadProject } from '../common/project-access';
import { assertSpendable, projectEnd, selfPartner } from './finance-common';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const expenseInput = z.object({
  partnerId: z.string().uuid().optional(), categoryCode: z.string().min(1).max(20), workPackageId: z.string().uuid().nullable().optional(),
  date: isoDate, description: z.string().trim().min(2).max(500), supplier: z.string().max(200).optional(),
  amount: z.number().int().min(0).max(100_000_000_000), evidenceRef: z.string().max(200).optional(),
});
export const expensePatch = expenseInput.omit({ partnerId: true }).partial().strict();

const view = (e: typeof expenses.$inferSelect) => ({
  id: e.id, partnerId: e.partnerId, categoryCode: e.categoryCode, workPackageId: e.workPackageId, date: e.date, description: e.description,
  supplier: e.supplier, amount: e.amountCents, evidenceRef: e.evidenceRef, source: e.source, timesheetId: e.timesheetId, claimId: e.claimId, status: e.status,
});

/** Evidencija troškova (invarijante 3 i 6) i pregled ugovoreno vs. ostvareno. */
@Injectable()
export class ExpensesService {
  constructor(private readonly audit: AuditService, private readonly packages: ProgrammePackagesService) {}

  private async validate(tx: Tx, p: Project, partnerId: string, input: { categoryCode: string; workPackageId?: string | null; date: string; amount: number }) {
    const pkg = await this.packages.get(tx, p.packageId, p.packageVersion);
    const partners = await tx.select({ id: projectPartners.id }).from(projectPartners).where(eq(projectPartners.projectId, p.id));
    const issues = budgetLineIssues(pkg, [{ partnerId, categoryCode: input.categoryCode, amount: input.amount }], new Set(partners.map((x) => x.id)));
    if (pkg.personnelRule?.timeRecordingRequired && input.categoryCode === pkg.personnelRule.categoryCode) issues.push(`trošak osoblja (${input.categoryCode}) nastaje odobrenjem timesheeta, ne ručnim unosom`);
    const end = projectEnd(p);
    if (p.startDate && end && (input.date < p.startDate || input.date > end)) issues.push(`datum ${input.date} je izvan trajanja projekta (${p.startDate} – ${end})`);
    if (input.workPackageId && !(await tx.select({ id: workPackages.id }).from(workPackages).where(and(eq(workPackages.id, input.workPackageId), eq(workPackages.projectId, p.id)))).length) issues.push(`radni paket ${input.workPackageId} nije na projektu`);
    if (issues.length) throw new BadRequestException({ message: 'Trošak nije valjan', issues: issues.map((i) => i.replace(/^redak 1: /, '')) });
  }

  async list(tx: Tx, projectId: string, filter: { status?: string; period?: number } = {}) {
    await loadProject(tx, projectId);
    const conds: (SQL | undefined)[] = [eq(expenses.projectId, projectId), filter.status ? eq(expenses.status, filter.status as never) : undefined];
    let rows = await tx.select().from(expenses).where(and(...conds)).orderBy(desc(expenses.date), asc(expenses.createdAt));
    if (filter.period) {
      const rp = (await tx.select().from(reportingPeriods).where(and(eq(reportingPeriods.projectId, projectId), eq(reportingPeriods.number, filter.period))))[0];
      if (!rp) throw new NotFoundException(`Razdoblje RP${filter.period} ne postoji`);
      rows = rows.filter((e) => e.date >= rp.startDate && e.date <= rp.endDate);
    }
    return rows.map(view);
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

  /** Ugovoreno (zadnja verzija proračuna) vs. ostvareno (svi troškovi osim odbijenih), s neizravnima iz paketa; pregled ZNS-ova. */
  async overview(tx: Tx, projectId: string) {
    const p = await loadProject(tx, projectId);
    const pkg = await this.packages.get(tx, p.packageId, p.packageVersion);
    const partners = await tx.select({ id: projectPartners.id, beneficiaryType: projectPartners.beneficiaryType, name: organisations.name }).from(projectPartners)
      .innerJoin(organisations, eq(organisations.id, projectPartners.organisationId)).where(eq(projectPartners.projectId, projectId)).orderBy(asc(projectPartners.orderNo));
    const budget = (await tx.select().from(projectBudgets).where(eq(projectBudgets.projectId, projectId)).orderBy(desc(projectBudgets.version)).limit(1))[0];
    const planLines = budget ? await tx.select().from(budgetLines).where(eq(budgetLines.budgetId, budget.id)) : [];
    const actualRows = await tx.select().from(expenses).where(and(eq(expenses.projectId, projectId), ne(expenses.status, 'rejected')));
    const planned = computeProjectBudget(pkg, p.actionType, partners, planLines.map((l) => ({ partnerId: l.partnerId, categoryCode: l.categoryCode, amount: l.amountCents })));
    const actual = computeProjectBudget(pkg, p.actionType, partners, actualRows.map((e) => ({ partnerId: e.partnerId, categoryCode: e.categoryCode, amount: e.amountCents })));
    const sumBy = (rows: { categoryCode: string; amount: number }[], code: string) => rows.filter((r) => r.categoryCode === code).reduce((a, r) => a + r.amount, 0);
    const plan = planLines.map((l) => ({ categoryCode: l.categoryCode, amount: l.amountCents }));
    const act = actualRows.map((e) => ({ categoryCode: e.categoryCode, amount: e.amountCents }));
    const byCategory = flattenCategories(pkg.costCategories).filter((c) => c.kind !== 'indirect' && !(c.children && c.children.length)).map((c) => {
      const pl = sumBy(plan, c.code), ac = sumBy(act, c.code);
      return { code: c.code, name: c.name, planned: pl, actual: ac, remaining: pl - ac, percent: pl ? Math.round((ac / pl) * 100) : null };
    });
    const claims = await tx.select({ c: reimbursementClaims, number: reportingPeriods.number }).from(reimbursementClaims)
      .innerJoin(reportingPeriods, eq(reportingPeriods.id, reimbursementClaims.reportingPeriodId)).where(eq(reimbursementClaims.projectId, projectId)).orderBy(asc(reportingPeriods.number));
    return {
      projectId, budgetVersion: budget?.version ?? null, budgetStatus: budget?.status ?? 'none',
      planned: planned.totals, actual: actual.totals, byCategory,
      byPartner: partners.map((x, i) => ({ partnerId: x.id, name: x.name, planned: planned.partners[i]!.total, actual: actual.partners[i]!.total })),
      claims: claims.map(({ c, number }) => ({ id: c.id, period: number, partnerId: c.partnerId, status: c.status, requested: c.requestedCents, approved: c.approvedCents, paid: c.paidCents })),
    };
  }
}
