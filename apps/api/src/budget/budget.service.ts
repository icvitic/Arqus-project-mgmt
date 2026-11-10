import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { budgetLineIssues, computeProjectBudget } from '@arqus/domain';
import type { Tx } from '../db/db.service';
import { budgetLines, organisations, projectBudgets, projectPartners, workPackages } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { ProgrammePackagesService } from '../programmes/programme-packages.service';
import { loadProject } from '../common/project-access';

export const budgetLinesInput = z.object({
  lines: z.array(z.object({
    partnerId: z.string().uuid(),
    categoryCode: z.string().min(1).max(20),
    workPackageId: z.string().uuid().nullable().optional(),
    amount: z.number().int().min(0).max(100_000_000_000), // centi, do 1 mlrd. EUR
    description: z.string().max(500).optional(),
  })).max(2000),
});
export type BudgetLinesInput = z.infer<typeof budgetLinesInput>;

/** M7 Proračun projekta: retci partner × kategorija (× radni paket); izračun neizravnih i doprinosa iz paketa (invarijanta 4). */
@Injectable()
export class BudgetService {
  constructor(private readonly audit: AuditService, private readonly packages: ProgrammePackagesService) {}

  private async current(tx: Tx, projectId: string) {
    return (await tx.select().from(projectBudgets).where(eq(projectBudgets.projectId, projectId)).orderBy(desc(projectBudgets.version)).limit(1))[0];
  }

  private async partners(tx: Tx, projectId: string) {
    return tx.select({ id: projectPartners.id, beneficiaryType: projectPartners.beneficiaryType, name: organisations.name, role: projectPartners.role })
      .from(projectPartners).innerJoin(organisations, eq(organisations.id, projectPartners.organisationId))
      .where(eq(projectPartners.projectId, projectId)).orderBy(asc(projectPartners.orderNo));
  }

  async get(tx: Tx, projectId: string) {
    const p = await loadProject(tx, projectId);
    const pkg = await this.packages.get(tx, p.packageId, p.packageVersion);
    const budget = await this.current(tx, projectId);
    const partners = await this.partners(tx, projectId);
    const lines = budget ? await tx.select().from(budgetLines).where(eq(budgetLines.budgetId, budget.id)).orderBy(asc(budgetLines.createdAt)) : [];
    const computed = computeProjectBudget(pkg, p.actionType, partners, lines.map((l) => ({ partnerId: l.partnerId, categoryCode: l.categoryCode, amount: l.amountCents, workPackageId: l.workPackageId })));
    return {
      projectId, currency: 'EUR', unit: 'cent',
      version: budget?.version ?? null, status: budget?.status ?? 'none', lockedAt: budget?.lockedAt ?? null,
      categories: pkg.costCategories.map((c) => ({ code: c.code, name: c.name, kind: c.kind, children: c.children?.map((k) => ({ code: k.code, name: k.name, kind: k.kind })) })),
      lines: lines.map((l) => ({ id: l.id, partnerId: l.partnerId, categoryCode: l.categoryCode, workPackageId: l.workPackageId, amount: l.amountCents, description: l.description })),
      partners: computed.partners.map((r) => ({ ...r, role: partners.find((x) => x.id === r.partnerId)?.role })),
      totals: computed.totals, warnings: computed.warnings,
    };
  }

  /** Zamjena svih redaka nacrta proračuna (tablični unos). Zaključan proračun mijenja se samo amandmanom. */
  async replaceLines(tx: Tx, tenantId: string, projectId: string, input: BudgetLinesInput, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    const pkg = await this.packages.get(tx, p.packageId, p.packageVersion);
    let budget = await this.current(tx, projectId);
    if (budget?.status === 'locked') throw new ConflictException(`Proračun v${budget.version} je zaključan – izmjene samo amandmanom`);
    const partners = await this.partners(tx, projectId);
    const issues = budgetLineIssues(pkg, input.lines.map((l) => ({ ...l })), new Set(partners.map((x) => x.id)));
    const wpIds = [...new Set(input.lines.map((l) => l.workPackageId).filter((x): x is string => !!x))];
    if (wpIds.length) {
      const found = await tx.select({ id: workPackages.id }).from(workPackages).where(eq(workPackages.projectId, projectId));
      wpIds.filter((id) => !found.some((f) => f.id === id)).forEach((id) => issues.push(`radni paket ${id} nije na projektu`));
    }
    if (issues.length) throw new BadRequestException({ message: 'Proračun nije valjan', issues });
    if (!budget) [budget] = await tx.insert(projectBudgets).values({ tenantId, projectId, version: 1, createdBy: actorId, updatedBy: actorId }).returning();
    const before = await this.get(tx, projectId);
    await tx.delete(budgetLines).where(eq(budgetLines.budgetId, budget!.id));
    if (input.lines.length) {
      await tx.insert(budgetLines).values(input.lines.map((l) => ({
        tenantId, budgetId: budget!.id, partnerId: l.partnerId, categoryCode: l.categoryCode, workPackageId: l.workPackageId ?? null,
        amountCents: l.amount, description: l.description ?? null, createdBy: actorId,
      })));
    }
    await tx.update(projectBudgets).set({ updatedAt: new Date(), updatedBy: actorId }).where(and(eq(projectBudgets.id, budget!.id)));
    const after = await this.get(tx, projectId);
    await this.audit.record(tx, { entity: 'project_budget', entityId: budget!.id, action: 'lines.replace', diff: { before: before.totals, after: after.totals, meta: { projectId, version: budget!.version, lines: input.lines.length } } });
    return after;
  }
}
