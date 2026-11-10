import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { daysInMonth, minutesByWorkPackage, personnelCostCents, timesheetIssues } from '@arqus/domain';
import type { Tx } from '../db/db.service';
import { expenses, teamMembers, timesheetEntries, timesheets, users, workPackages, type Project } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { ProgrammePackagesService } from '../programmes/programme-packages.service';
import { TenantContext } from '../common/tenant-context';
import { hasPermission } from '../identity/permissions';
import { assertPartnerOnProject, loadProject } from '../common/project-access';
import { assertSpendable, projectEnd, selfPartner } from './finance-common';

export const memberInput = z.object({
  fullName: z.string().trim().min(2).max(200), userId: z.string().uuid().optional(), partnerId: z.string().uuid().optional(),
  role: z.string().max(100).optional(), annualCost: z.number().int().min(0).max(1_000_000_000),
});
export const memberPatch = memberInput.omit({ userId: true, partnerId: true }).partial().extend({ active: z.boolean().optional() }).strict();
export const timesheetInput = z.object({ entries: z.array(z.object({ day: z.number().int(), minutes: z.number().int(), workPackageId: z.string().uuid().nullable().optional() })).max(31 * 10) });
export const monthParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mjesec u obliku GGGG-MM');

/** Tim projekta i mjesečni timesheetovi; odobrenje timesheeta stvara troškove osoblja prema pravilu paketa. */
@Injectable()
export class TimesheetsService {
  constructor(private readonly audit: AuditService, private readonly packages: ProgrammePackagesService, private readonly ctx: TenantContext) {}

  async team(tx: Tx, projectId: string) {
    await loadProject(tx, projectId);
    const rows = await tx.select().from(teamMembers).where(eq(teamMembers.projectId, projectId)).orderBy(asc(teamMembers.fullName));
    return rows.map(({ tenantId: _t, createdBy: _c, updatedBy: _u, deletedAt: _d, annualCostCents, ...r }) => ({ ...r, annualCost: annualCostCents }));
  }

  async addMember(tx: Tx, tenantId: string, projectId: string, input: z.infer<typeof memberInput>, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    const partnerId = input.partnerId ?? (await selfPartner(tx, projectId)).id;
    await assertPartnerOnProject(tx, projectId, partnerId);
    if (input.userId && !(await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId))).length) throw new NotFoundException(`Korisnik ${input.userId} ne postoji`);
    const [row] = await tx.insert(teamMembers).values({ tenantId, projectId, partnerId, userId: input.userId ?? null, fullName: input.fullName, role: input.role ?? null, annualCostCents: input.annualCost, createdBy: actorId, updatedBy: actorId }).returning();
    await this.audit.record(tx, { entity: 'team_member', entityId: row!.id, action: 'create', diff: { after: { ...row, annualCostCents: '***' }, meta: { projectId } } });
    return { id: row!.id, fullName: row!.fullName, partnerId, userId: row!.userId, role: row!.role, annualCost: row!.annualCostCents, active: row!.active };
  }

  private async member(tx: Tx, projectId: string, memberId: string) {
    const m = (await tx.select().from(teamMembers).where(and(eq(teamMembers.id, memberId), eq(teamMembers.projectId, projectId))))[0];
    if (!m) throw new NotFoundException('Član tima ne postoji na projektu');
    return m;
  }

  /** Bez `timesheets:approve` korisnik smije uređivati samo vlastiti timesheet. */
  private assertOwnOrApprover(m: { userId: string | null }): void {
    const c = this.ctx.require();
    if (hasPermission(c.permissions, 'timesheets:approve')) return;
    if (!m.userId || m.userId !== c.userId) throw new ForbiddenException('Smiješ uređivati samo vlastiti timesheet');
  }

  private assertMonthInProject(p: Project, month: string): void {
    const end = projectEnd(p);
    if (!p.startDate || !end) throw new ConflictException('Projekt nema početak i trajanje');
    if (`${month}-${String(daysInMonth(month)).padStart(2, '0')}` < p.startDate || `${month}-01` > end) throw new BadRequestException(`Mjesec ${month} je izvan trajanja projekta (${p.startDate} – ${end})`);
  }

  async get(tx: Tx, projectId: string, memberId: string, month: string) {
    await loadProject(tx, projectId);
    const m = await this.member(tx, projectId, memberId);
    const ts = (await tx.select().from(timesheets).where(and(eq(timesheets.teamMemberId, memberId), eq(timesheets.month, month))))[0];
    const entries = ts ? await tx.select().from(timesheetEntries).where(eq(timesheetEntries.timesheetId, ts.id)).orderBy(asc(timesheetEntries.day)) : [];
    const list = entries.map((e) => ({ day: e.day, minutes: e.minutes, workPackageId: e.workPackageId }));
    return {
      teamMemberId: m.id, fullName: m.fullName, month, id: ts?.id ?? null, status: ts?.status ?? 'none', submittedAt: ts?.submittedAt ?? null, approvedAt: ts?.approvedAt ?? null,
      entries: list, totalMinutes: list.reduce((a, e) => a + e.minutes, 0), warnings: timesheetIssues(month, list).warnings,
    };
  }

  async save(tx: Tx, tenantId: string, projectId: string, memberId: string, month: string, input: z.infer<typeof timesheetInput>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    const m = await this.member(tx, projectId, memberId);
    this.assertOwnOrApprover(m);
    this.assertMonthInProject(p, month);
    const { errors } = timesheetIssues(month, input.entries);
    const wpIds = [...new Set(input.entries.map((e) => e.workPackageId).filter((x): x is string => !!x))];
    if (wpIds.length) {
      const found = await tx.select({ id: workPackages.id }).from(workPackages).where(and(eq(workPackages.projectId, projectId), inArray(workPackages.id, wpIds)));
      wpIds.filter((id) => !found.some((f) => f.id === id)).forEach((id) => errors.push(`radni paket ${id} nije na projektu`));
    }
    if (errors.length) throw new BadRequestException({ message: 'Timesheet nije valjan', issues: errors });
    let ts = (await tx.select().from(timesheets).where(and(eq(timesheets.teamMemberId, memberId), eq(timesheets.month, month))))[0];
    if (ts && ts.status !== 'draft') throw new ConflictException(`Timesheet je u statusu "${ts.status}" – vrati ga u nacrt za izmjene`);
    if (!ts) [ts] = await tx.insert(timesheets).values({ tenantId, projectId, teamMemberId: memberId, month, createdBy: actorId, updatedBy: actorId }).returning();
    await tx.delete(timesheetEntries).where(eq(timesheetEntries.timesheetId, ts!.id));
    const rows = input.entries.filter((e) => e.minutes > 0);
    if (rows.length) await tx.insert(timesheetEntries).values(rows.map((e) => ({ tenantId, timesheetId: ts!.id, day: e.day, minutes: e.minutes, workPackageId: e.workPackageId ?? null })));
    await tx.update(timesheets).set({ updatedAt: new Date(), updatedBy: actorId }).where(eq(timesheets.id, ts!.id));
    return this.get(tx, projectId, memberId, month);
  }

  private async load(tx: Tx, projectId: string, memberId: string, month: string) {
    const ts = (await tx.select().from(timesheets).where(and(eq(timesheets.projectId, projectId), eq(timesheets.teamMemberId, memberId), eq(timesheets.month, month))))[0];
    if (!ts) throw new NotFoundException('Timesheet ne postoji');
    return ts;
  }

  async submit(tx: Tx, projectId: string, memberId: string, month: string, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    this.assertOwnOrApprover(await this.member(tx, projectId, memberId));
    const ts = await this.load(tx, projectId, memberId, month);
    if (ts.status !== 'draft') throw new ConflictException(`Timesheet je u statusu "${ts.status}"`);
    await tx.update(timesheets).set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date(), updatedBy: actorId }).where(eq(timesheets.id, ts.id));
    await this.audit.record(tx, { entity: 'timesheet', entityId: ts.id, action: 'submit', diff: { meta: { month, memberId } } });
    return this.get(tx, projectId, memberId, month);
  }

  /** Odobrenje: trošak osoblja po radnom paketu = minute × stopa iz paketa (godišnji trošak / djelitelj). */
  async approve(tx: Tx, tenantId: string, projectId: string, memberId: string, month: string, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    assertSpendable(p);
    const m = await this.member(tx, projectId, memberId);
    const ts = await this.load(tx, projectId, memberId, month);
    if (ts.status !== 'submitted') throw new ConflictException(`Odobrava se samo predan timesheet (trenutno "${ts.status}")`);
    const pkg = await this.packages.get(tx, p.packageId, p.packageVersion);
    const category = pkg.personnelRule?.categoryCode;
    if (!category) throw new BadRequestException(`Paket ${p.packageId} nema personnelRule.categoryCode – trošak osoblja ne može se izračunati`);
    const entries = await tx.select().from(timesheetEntries).where(eq(timesheetEntries.timesheetId, ts.id));
    const byWp = minutesByWorkPackage(entries.map((e) => ({ day: e.day, minutes: e.minutes, workPackageId: e.workPackageId })));
    const date = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
    const end = projectEnd(p)!; const expenseDate = date > end ? end : date;
    const created: { workPackageId: string | null; minutes: number; amount: number }[] = [];
    for (const [wp, minutes] of byWp) {
      if (minutes <= 0) continue;
      const amount = personnelCostCents(pkg, m.annualCostCents, minutes);
      created.push({ workPackageId: wp, minutes, amount });
      await tx.insert(expenses).values({ tenantId, projectId, partnerId: m.partnerId, categoryCode: category, workPackageId: wp, date: expenseDate,
        description: `Rad: ${m.fullName}, ${month} (${(minutes / 60).toFixed(2)} h)`, amountCents: amount, source: 'timesheet', timesheetId: ts.id, createdBy: actorId, updatedBy: actorId });
    }
    await tx.update(timesheets).set({ status: 'approved', approvedAt: new Date(), approvedBy: actorId ?? null, updatedAt: new Date(), updatedBy: actorId }).where(eq(timesheets.id, ts.id));
    await this.audit.record(tx, { entity: 'timesheet', entityId: ts.id, action: 'approve', diff: { meta: { month, memberId, expenses: created } } });
    return { ...(await this.get(tx, projectId, memberId, month)), personnelCost: created };
  }

  /** Povrat u nacrt: iz predanog, ili iz odobrenog dok troškovi osoblja nisu u zahtjevu za nadoknadu (brišu se). */
  async reopen(tx: Tx, projectId: string, memberId: string, month: string, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    const ts = await this.load(tx, projectId, memberId, month);
    if (ts.status === 'locked') throw new ConflictException('Timesheet je u zahtjevu za nadoknadu i zaključan je');
    if (ts.status === 'draft') throw new ConflictException('Timesheet je već nacrt');
    if (ts.status === 'approved') await tx.delete(expenses).where(and(eq(expenses.timesheetId, ts.id), eq(expenses.status, 'recorded')));
    await tx.update(timesheets).set({ status: 'draft', submittedAt: null, approvedAt: null, approvedBy: null, updatedAt: new Date(), updatedBy: actorId }).where(eq(timesheets.id, ts.id));
    await this.audit.record(tx, { entity: 'timesheet', entityId: ts.id, action: 'reopen', diff: { before: { status: ts.status }, after: { status: 'draft' } } });
    return this.get(tx, projectId, memberId, month);
  }
}
