import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { monthEndDate, riskLevel } from '@arqus/domain';
import type { Tx } from '../db/db.service';
import { deliverables, milestones, risks, tasks, users, workPackages, type Project } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { ProgrammePackagesService } from '../programmes/programme-packages.service';
import { assertPartnerOnProject, loadProject } from '../common/project-access';

const month = z.number().int().min(1).max(120);
const text = (max: number) => z.string().trim().min(2).max(max);
export const wpInput = z.object({ number: z.number().int().min(1).max(99).optional(), title: text(300), leadPartnerId: z.string().uuid().optional(), startMonth: month, endMonth: month, objectives: z.string().max(5000).optional() });
export const wpPatch = wpInput.omit({ number: true }).partial().strict();
export const taskInput = z.object({ title: text(300), leadPartnerId: z.string().uuid().optional(), startMonth: month, endMonth: month });
export const taskPatch = taskInput.partial().extend({ status: z.enum(['planned', 'in_progress', 'done', 'cancelled']).optional() }).strict();
export const deliverableInput = z.object({ title: text(300), type: z.string().min(1).max(20), dissemination: z.string().min(1).max(20), dueMonth: month, leadPartnerId: z.string().uuid().optional() });
export const deliverablePatch = deliverableInput.partial().extend({ status: z.enum(['planned', 'in_progress', 'submitted', 'accepted', 'rejected']).optional() }).strict();
export const milestoneInput = z.object({ title: text(300), dueMonth: month, verification: z.string().max(2000).optional() });
export const milestonePatch = milestoneInput.partial().extend({ status: z.enum(['planned', 'achieved', 'missed']).optional() }).strict();
const scale = z.number().int().min(1).max(3);
export const riskInput = z.object({ description: text(2000), likelihood: scale, impact: scale, mitigation: z.string().max(2000).optional(), ownerUserId: z.string().uuid().optional() });
export const riskPatch = riskInput.partial().extend({ status: z.enum(['open', 'mitigated', 'occurred', 'closed']).optional() }).strict();

type Row = Record<string, unknown> & { tenantId?: unknown; createdBy?: unknown; updatedBy?: unknown; deletedAt?: unknown };
const clean = <T extends Row>(r: T) => { const { tenantId: _t, createdBy: _c, updatedBy: _u, deletedAt: _d, ...rest } = r; return rest; };

/** M6 Provedba: radni paketi, zadaci, isporuke (D<wp>.<n>), prekretnice (MS<n>), rizici. */
@Injectable()
export class ImplementationService {
  constructor(private readonly audit: AuditService, private readonly packages: ProgrammePackagesService) {}

  private assertMonths(p: Project, start: number, end: number, what: string): void {
    if (end < start) throw new BadRequestException(`${what}: završni mjesec je prije početnog`);
    if (p.durationMonths && end > p.durationMonths) throw new BadRequestException(`${what}: mjesec ${end} je izvan trajanja projekta (${p.durationMonths} mj.)`);
  }

  private async nextNumber(tx: Tx, table: PgTable, numberCol: PgColumn, scope: SQL): Promise<number> {
    const [r] = await tx.select({ n: sql<number>`coalesce(max(${numberCol}), 0)::int + 1` }).from(table).where(scope) as [{ n: number }];
    return r.n;
  }

  private async wp(tx: Tx, projectId: string, wpId: string) {
    const w = (await tx.select().from(workPackages).where(and(eq(workPackages.id, wpId), eq(workPackages.projectId, projectId), isNull(workPackages.deletedAt))))[0];
    if (!w) throw new NotFoundException(`Radni paket ${wpId} ne postoji na projektu`);
    return w;
  }

  private async assertCodes(tx: Tx, p: Project, type?: string, dissemination?: string): Promise<void> {
    const pkg = await this.packages.get(tx, p.packageId, p.packageVersion);
    const types = pkg.deliverableTypes?.map((d) => d.code);
    const levels = pkg.disseminationLevels?.map((d) => d.code);
    if (type && types?.length && !types.includes(type)) throw new BadRequestException(`Vrsta isporuke "${type}" ne postoji u paketu (dopušteno: ${types.join(', ')})`);
    if (dissemination && levels?.length && !levels.includes(dissemination)) throw new BadRequestException(`Razina diseminacije "${dissemination}" ne postoji u paketu (dopušteno: ${levels.join(', ')})`);
  }

  async structure(tx: Tx, projectId: string) {
    const p = await loadProject(tx, projectId);
    const due = (m: number) => (p.startDate ? monthEndDate(p.startDate, m) : null);
    const [wps, ts, ds, ms, rs] = await Promise.all([
      tx.select().from(workPackages).where(and(eq(workPackages.projectId, projectId), isNull(workPackages.deletedAt))).orderBy(asc(workPackages.number)),
      tx.select().from(tasks).where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt))).orderBy(asc(tasks.number)),
      tx.select().from(deliverables).where(and(eq(deliverables.projectId, projectId), isNull(deliverables.deletedAt))).orderBy(asc(deliverables.number)),
      tx.select().from(milestones).where(and(eq(milestones.projectId, projectId), isNull(milestones.deletedAt))).orderBy(asc(milestones.number)),
      tx.select().from(risks).where(and(eq(risks.projectId, projectId), isNull(risks.deletedAt))).orderBy(asc(risks.number)),
    ]);
    return {
      projectId, startDate: p.startDate, durationMonths: p.durationMonths,
      workPackages: wps.map((w) => ({
        ...clean(w), code: `WP${w.number}`,
        tasks: ts.filter((t) => t.workPackageId === w.id).map((t) => ({ ...clean(t), code: `T${w.number}.${t.number}` })),
        deliverables: ds.filter((d) => d.workPackageId === w.id).map((d) => ({ ...clean(d), code: `D${w.number}.${d.number}`, dueDate: due(d.dueMonth) })),
      })),
      milestones: ms.map((m) => ({ ...clean(m), code: `MS${m.number}`, dueDate: due(m.dueMonth) })),
      risks: rs.map((r) => ({ ...clean(r), ...riskLevel(r.likelihood, r.impact) })).sort((a, b) => b.score - a.score),
    };
  }

  async createWp(tx: Tx, tenantId: string, projectId: string, input: z.infer<typeof wpInput>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    this.assertMonths(p, input.startMonth, input.endMonth, 'Radni paket');
    await assertPartnerOnProject(tx, projectId, input.leadPartnerId);
    const number = input.number ?? await this.nextNumber(tx, workPackages, workPackages.number, eq(workPackages.projectId, projectId));
    const [row] = await tx.insert(workPackages).values({ tenantId, projectId, ...input, number, createdBy: actorId, updatedBy: actorId }).returning();
    await this.audit.record(tx, { entity: 'work_package', entityId: row!.id, action: 'create', diff: { after: clean(row!), meta: { projectId } } });
    return { ...clean(row!), code: `WP${row!.number}` };
  }

  async updateWp(tx: Tx, projectId: string, wpId: string, patch: z.infer<typeof wpPatch>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    const before = await this.wp(tx, projectId, wpId);
    this.assertMonths(p, patch.startMonth ?? before.startMonth, patch.endMonth ?? before.endMonth, 'Radni paket');
    await assertPartnerOnProject(tx, projectId, patch.leadPartnerId);
    const [row] = await tx.update(workPackages).set({ ...patch, updatedAt: new Date(), updatedBy: actorId }).where(eq(workPackages.id, wpId)).returning();
    await this.audit.record(tx, { entity: 'work_package', entityId: wpId, action: 'update', diff: { before: clean(before), after: clean(row!) } });
    return { ...clean(row!), code: `WP${row!.number}` };
  }

  async deleteWp(tx: Tx, projectId: string, wpId: string) {
    await loadProject(tx, projectId, { editable: true });
    const before = await this.wp(tx, projectId, wpId);
    const [{ n }] = await tx.select({ n: sql<number>`(select count(*) from tasks where work_package_id = ${wpId}) + (select count(*) from deliverables where work_package_id = ${wpId})` }).from(sql`(select 1) x`) as [{ n: number }];
    if (Number(n) > 0) throw new ConflictException('Radni paket ima zadatke ili isporuke – najprije ih ukloni');
    await tx.delete(workPackages).where(eq(workPackages.id, wpId));
    await this.audit.record(tx, { entity: 'work_package', entityId: wpId, action: 'delete', diff: { before: clean(before) } });
    return { deleted: true };
  }

  async createTask(tx: Tx, tenantId: string, projectId: string, wpId: string, input: z.infer<typeof taskInput>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    const w = await this.wp(tx, projectId, wpId);
    this.assertMonths(p, input.startMonth, input.endMonth, 'Zadatak');
    if (input.startMonth < w.startMonth || input.endMonth > w.endMonth) throw new BadRequestException(`Zadatak mora biti unutar trajanja WP${w.number} (M${w.startMonth}–M${w.endMonth})`);
    await assertPartnerOnProject(tx, projectId, input.leadPartnerId);
    const number = await this.nextNumber(tx, tasks, tasks.number, eq(tasks.workPackageId, wpId));
    const [row] = await tx.insert(tasks).values({ tenantId, projectId, workPackageId: wpId, number, ...input, createdBy: actorId, updatedBy: actorId }).returning();
    await this.audit.record(tx, { entity: 'task', entityId: row!.id, action: 'create', diff: { after: clean(row!) } });
    return { ...clean(row!), code: `T${w.number}.${number}` };
  }

  async updateTask(tx: Tx, projectId: string, taskId: string, patch: z.infer<typeof taskPatch>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    const before = (await tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId))))[0];
    if (!before) throw new NotFoundException('Zadatak ne postoji na projektu');
    this.assertMonths(p, patch.startMonth ?? before.startMonth, patch.endMonth ?? before.endMonth, 'Zadatak');
    await assertPartnerOnProject(tx, projectId, patch.leadPartnerId);
    const [row] = await tx.update(tasks).set({ ...patch, updatedAt: new Date(), updatedBy: actorId }).where(eq(tasks.id, taskId)).returning();
    await this.audit.record(tx, { entity: 'task', entityId: taskId, action: 'update', diff: { before: clean(before), after: clean(row!) } });
    return clean(row!);
  }

  async createDeliverable(tx: Tx, tenantId: string, projectId: string, wpId: string, input: z.infer<typeof deliverableInput>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    const w = await this.wp(tx, projectId, wpId);
    this.assertMonths(p, input.dueMonth, input.dueMonth, 'Isporuka');
    await this.assertCodes(tx, p, input.type, input.dissemination);
    await assertPartnerOnProject(tx, projectId, input.leadPartnerId);
    const number = await this.nextNumber(tx, deliverables, deliverables.number, eq(deliverables.workPackageId, wpId));
    const [row] = await tx.insert(deliverables).values({ tenantId, projectId, workPackageId: wpId, number, ...input, createdBy: actorId, updatedBy: actorId }).returning();
    await this.audit.record(tx, { entity: 'deliverable', entityId: row!.id, action: 'create', diff: { after: clean(row!) } });
    return { ...clean(row!), code: `D${w.number}.${number}`, dueDate: p.startDate ? monthEndDate(p.startDate, row!.dueMonth) : null };
  }

  async updateDeliverable(tx: Tx, projectId: string, id: string, patch: z.infer<typeof deliverablePatch>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    const before = (await tx.select().from(deliverables).where(and(eq(deliverables.id, id), eq(deliverables.projectId, projectId))))[0];
    if (!before) throw new NotFoundException('Isporuka ne postoji na projektu');
    if (patch.dueMonth) this.assertMonths(p, patch.dueMonth, patch.dueMonth, 'Isporuka');
    await this.assertCodes(tx, p, patch.type, patch.dissemination);
    await assertPartnerOnProject(tx, projectId, patch.leadPartnerId);
    const submittedAt = patch.status === 'submitted' && before.status !== 'submitted' ? new Date() : undefined;
    const [row] = await tx.update(deliverables).set({ ...patch, ...(submittedAt ? { submittedAt } : {}), updatedAt: new Date(), updatedBy: actorId }).where(eq(deliverables.id, id)).returning();
    await this.audit.record(tx, { entity: 'deliverable', entityId: id, action: patch.status && patch.status !== before.status ? `status.${patch.status}` : 'update', diff: { before: clean(before), after: clean(row!) } });
    return clean(row!);
  }

  async createMilestone(tx: Tx, tenantId: string, projectId: string, input: z.infer<typeof milestoneInput>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    this.assertMonths(p, input.dueMonth, input.dueMonth, 'Prekretnica');
    const number = await this.nextNumber(tx, milestones, milestones.number, eq(milestones.projectId, projectId));
    const [row] = await tx.insert(milestones).values({ tenantId, projectId, number, ...input, createdBy: actorId, updatedBy: actorId }).returning();
    await this.audit.record(tx, { entity: 'milestone', entityId: row!.id, action: 'create', diff: { after: clean(row!) } });
    return { ...clean(row!), code: `MS${number}` };
  }

  async updateMilestone(tx: Tx, projectId: string, id: string, patch: z.infer<typeof milestonePatch>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    const before = (await tx.select().from(milestones).where(and(eq(milestones.id, id), eq(milestones.projectId, projectId))))[0];
    if (!before) throw new NotFoundException('Prekretnica ne postoji na projektu');
    if (patch.dueMonth) this.assertMonths(p, patch.dueMonth, patch.dueMonth, 'Prekretnica');
    const [row] = await tx.update(milestones).set({ ...patch, updatedAt: new Date(), updatedBy: actorId }).where(eq(milestones.id, id)).returning();
    await this.audit.record(tx, { entity: 'milestone', entityId: id, action: 'update', diff: { before: clean(before), after: clean(row!) } });
    return clean(row!);
  }

  private async assertUser(tx: Tx, userId?: string | null): Promise<void> {
    if (userId && !(await tx.select({ id: users.id }).from(users).where(eq(users.id, userId))).length) throw new NotFoundException(`Korisnik ${userId} ne postoji`);
  }

  async createRisk(tx: Tx, tenantId: string, projectId: string, input: z.infer<typeof riskInput>, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    await this.assertUser(tx, input.ownerUserId);
    const number = await this.nextNumber(tx, risks, risks.number, eq(risks.projectId, projectId));
    const [row] = await tx.insert(risks).values({ tenantId, projectId, number, ...input, createdBy: actorId, updatedBy: actorId }).returning();
    await this.audit.record(tx, { entity: 'risk', entityId: row!.id, action: 'create', diff: { after: clean(row!) } });
    return { ...clean(row!), ...riskLevel(row!.likelihood, row!.impact) };
  }

  async updateRisk(tx: Tx, projectId: string, id: string, patch: z.infer<typeof riskPatch>, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    const before = (await tx.select().from(risks).where(and(eq(risks.id, id), eq(risks.projectId, projectId))))[0];
    if (!before) throw new NotFoundException('Rizik ne postoji na projektu');
    await this.assertUser(tx, patch.ownerUserId);
    const [row] = await tx.update(risks).set({ ...patch, updatedAt: new Date(), updatedBy: actorId }).where(eq(risks.id, id)).returning();
    await this.audit.record(tx, { entity: 'risk', entityId: id, action: 'update', diff: { before: clean(before), after: clean(row!) } });
    return { ...clean(row!), ...riskLevel(row!.likelihood, row!.impact) };
  }
}
