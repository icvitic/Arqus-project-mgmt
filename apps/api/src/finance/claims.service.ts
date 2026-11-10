import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { computePartnerBudget } from '@arqus/domain';
import type { Tx } from '../db/db.service';
import { expenses, projectPartners, reimbursementClaims, reportingPeriods, timesheets } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { ProgrammePackagesService } from '../programmes/programme-packages.service';
import { assertPartnerOnProject, loadProject } from '../common/project-access';
import { selfPartner } from './finance-common';

export const claimInput = z.object({ period: z.number().int().min(1), partnerId: z.string().uuid().optional() });
export const decisionInput = z.object({ decision: z.enum(['approved', 'partially_approved', 'rejected', 'returned']), approvedAmount: z.number().int().min(0).optional(), note: z.string().max(2000).optional() });
export const paymentInput = z.object({ paidAmount: z.number().int().min(0), paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** Zahtjev za nadoknadu (ZNS / financial statement) po izvještajnom razdoblju i partneru. */
@Injectable()
export class ClaimsService {
  constructor(private readonly audit: AuditService, private readonly packages: ProgrammePackagesService) {}

  private async claim(tx: Tx, projectId: string, id: string) {
    const r = (await tx.select({ c: reimbursementClaims, rp: reportingPeriods }).from(reimbursementClaims)
      .innerJoin(reportingPeriods, eq(reportingPeriods.id, reimbursementClaims.reportingPeriodId))
      .where(and(eq(reimbursementClaims.id, id), eq(reimbursementClaims.projectId, projectId))))[0];
    if (!r) throw new NotFoundException('Zahtjev za nadoknadu ne postoji na projektu');
    return r;
  }

  /** Troškovi koji ulaze u zahtjev: u nacrtu prihvatljivi (evidentirani, partner, datum u razdoblju, nisu u drugom zahtjevu), inače pridruženi. */
  private async claimExpenses(tx: Tx, c: typeof reimbursementClaims.$inferSelect, rp: typeof reportingPeriods.$inferSelect) {
    if (c.status !== 'draft') return tx.select().from(expenses).where(eq(expenses.claimId, c.id)).orderBy(asc(expenses.date));
    const rows = await tx.select().from(expenses).where(and(eq(expenses.projectId, c.projectId), eq(expenses.partnerId, c.partnerId), eq(expenses.status, 'recorded'), isNull(expenses.claimId))).orderBy(asc(expenses.date));
    return rows.filter((e) => e.date >= rp.startDate && e.date <= rp.endDate);
  }

  private async totals(tx: Tx, projectId: string, partnerId: string, rows: { categoryCode: string; amountCents: number }[]) {
    const p = await loadProject(tx, projectId);
    const pkg = await this.packages.get(tx, p.packageId, p.packageVersion);
    const partner = (await tx.select({ bt: projectPartners.beneficiaryType }).from(projectPartners).where(eq(projectPartners.id, partnerId)))[0]!;
    const lines: Record<string, number> = {};
    for (const r of rows) lines[r.categoryCode] = (lines[r.categoryCode] ?? 0) + r.amountCents;
    return computePartnerBudget(pkg, p.actionType, lines, partner.bt);
  }

  async get(tx: Tx, projectId: string, id: string) {
    const { c, rp } = await this.claim(tx, projectId, id);
    const rows = await this.claimExpenses(tx, c, rp);
    const t = c.status === 'draft' ? await this.totals(tx, projectId, c.partnerId, rows) : (c.totals as unknown as Awaited<ReturnType<ClaimsService['totals']>>);
    return {
      id: c.id, projectId, period: { number: rp.number, startDate: rp.startDate, endDate: rp.endDate, dueDate: rp.dueDate }, partnerId: c.partnerId, status: c.status,
      expenses: rows.map((e) => ({ id: e.id, date: e.date, categoryCode: e.categoryCode, description: e.description, amount: e.amountCents, source: e.source, status: e.status })),
      totals: { direct: t.directTotal, indirect: t.indirectTotal, total: t.total, ratePercent: t.ratePercent, requested: t.requested, byCategory: t.direct, indirectByCategory: t.indirect },
      requested: c.requestedCents, approved: c.approvedCents, paid: c.paidCents, submittedAt: c.submittedAt, decidedAt: c.decidedAt, paidAt: c.paidAt, note: c.note,
    };
  }

  async list(tx: Tx, projectId: string) {
    await loadProject(tx, projectId);
    const rows = await tx.select({ id: reimbursementClaims.id }).from(reimbursementClaims).innerJoin(reportingPeriods, eq(reportingPeriods.id, reimbursementClaims.reportingPeriodId))
      .where(eq(reimbursementClaims.projectId, projectId)).orderBy(asc(reportingPeriods.number));
    return Promise.all(rows.map((r) => this.get(tx, projectId, r.id)));
  }

  async create(tx: Tx, tenantId: string, projectId: string, input: z.infer<typeof claimInput>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    if (p.status === 'contracting') throw new ConflictException('Projekt još nije aktivan');
    const rp = (await tx.select().from(reportingPeriods).where(and(eq(reportingPeriods.projectId, projectId), eq(reportingPeriods.number, input.period))))[0];
    if (!rp) throw new NotFoundException(`Razdoblje RP${input.period} ne postoji`);
    const partnerId = input.partnerId ?? (await selfPartner(tx, projectId)).id;
    await assertPartnerOnProject(tx, projectId, partnerId);
    const [row] = await tx.insert(reimbursementClaims).values({ tenantId, projectId, reportingPeriodId: rp.id, partnerId, createdBy: actorId, updatedBy: actorId }).returning();
    await this.audit.record(tx, { entity: 'claim', entityId: row!.id, action: 'create', diff: { meta: { period: rp.number, partnerId } } });
    return this.get(tx, projectId, row!.id);
  }

  /** Predaja: pridružuje prihvatljive troškove (invarijanta 6: trošak u najviše jednom zahtjevu), zaključava timesheetove, snima izračun. */
  async submit(tx: Tx, projectId: string, id: string, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    const { c, rp } = await this.claim(tx, projectId, id);
    if (c.status !== 'draft') throw new ConflictException(`Zahtjev je u statusu "${c.status}"`);
    const rows = await this.claimExpenses(tx, c, rp);
    if (!rows.length) throw new ConflictException('Nema troškova u razdoblju za ovaj zahtjev');
    const ids = rows.map((e) => e.id);
    await tx.update(expenses).set({ claimId: c.id, status: 'claimed', updatedAt: new Date(), updatedBy: actorId }).where(inArray(expenses.id, ids));
    const tsIds = [...new Set(rows.map((e) => e.timesheetId).filter((x): x is string => !!x))];
    if (tsIds.length) await tx.update(timesheets).set({ status: 'locked', updatedAt: new Date() }).where(inArray(timesheets.id, tsIds));
    const t = await this.totals(tx, projectId, c.partnerId, rows);
    await tx.update(reimbursementClaims).set({ status: 'submitted', totals: t as unknown as Record<string, unknown>, requestedCents: t.requested, submittedAt: new Date(), updatedAt: new Date(), updatedBy: actorId }).where(eq(reimbursementClaims.id, c.id));
    await this.audit.record(tx, { entity: 'claim', entityId: c.id, action: 'submit', diff: { after: { requested: t.requested, expenses: ids.length } } });
    return this.get(tx, projectId, id);
  }

  async decide(tx: Tx, projectId: string, id: string, input: z.infer<typeof decisionInput>, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    const { c } = await this.claim(tx, projectId, id);
    if (c.status !== 'submitted') throw new ConflictException(`Odluka se donosi samo za predan zahtjev (trenutno "${c.status}")`);
    const now = new Date();
    if (input.decision === 'returned') {
      const rows = await tx.select({ id: expenses.id, ts: expenses.timesheetId }).from(expenses).where(eq(expenses.claimId, c.id));
      await tx.update(expenses).set({ claimId: null, status: 'recorded', updatedAt: now, updatedBy: actorId }).where(eq(expenses.claimId, c.id));
      const tsIds = [...new Set(rows.map((r) => r.ts).filter((x): x is string => !!x))];
      if (tsIds.length) await tx.update(timesheets).set({ status: 'approved', updatedAt: now }).where(inArray(timesheets.id, tsIds));
      await tx.update(reimbursementClaims).set({ status: 'draft', totals: null, requestedCents: null, submittedAt: null, note: input.note ?? null, updatedAt: now, updatedBy: actorId }).where(eq(reimbursementClaims.id, c.id));
    } else {
      let approved: number | null = null;
      if (input.decision === 'approved') approved = c.requestedCents;
      if (input.decision === 'partially_approved') {
        if (input.approvedAmount === undefined || input.approvedAmount >= (c.requestedCents ?? 0)) throw new BadRequestException('Djelomično odobrenje traži approvedAmount manji od traženog iznosa');
        approved = input.approvedAmount;
      }
      if (input.decision === 'rejected') approved = 0;
      await tx.update(expenses).set({ status: input.decision === 'rejected' ? 'rejected' : 'accepted', updatedAt: now, updatedBy: actorId }).where(eq(expenses.claimId, c.id));
      await tx.update(reimbursementClaims).set({ status: input.decision, approvedCents: approved, decidedAt: now, note: input.note ?? null, updatedAt: now, updatedBy: actorId }).where(eq(reimbursementClaims.id, c.id));
    }
    await this.audit.record(tx, { entity: 'claim', entityId: c.id, action: `decision.${input.decision}`, diff: { meta: { approvedAmount: input.approvedAmount, note: input.note } } });
    return this.get(tx, projectId, id);
  }

  async pay(tx: Tx, projectId: string, id: string, input: z.infer<typeof paymentInput>, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    const { c } = await this.claim(tx, projectId, id);
    if (!['approved', 'partially_approved'].includes(c.status)) throw new ConflictException('Isplata se bilježi samo za odobren zahtjev');
    if (input.paidAmount > (c.approvedCents ?? 0)) throw new BadRequestException('Isplaćeni iznos veći je od odobrenog');
    await tx.update(reimbursementClaims).set({ paidCents: input.paidAmount, paidAt: input.paidAt, updatedAt: new Date(), updatedBy: actorId }).where(eq(reimbursementClaims.id, c.id));
    await this.audit.record(tx, { entity: 'claim', entityId: c.id, action: 'payment', diff: { after: input } });
    return this.get(tx, projectId, id);
  }
}
