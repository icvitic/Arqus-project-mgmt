import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { deliverableCodeIssues, monthEndDate, monthRangeIssue, responsibleMayChange, riskLevel, type ResponsibleItemKind } from '@arqus/domain';
import type { Tx } from '../db/db.service';
import { deliverables, milestones, risks, tasks, teamMembers, users, workPackages, type Project } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { ProgrammePackagesService } from '../programmes/programme-packages.service';
import { assertPartnerOnProject, loadProject } from '../common/project-access';
import { TenantContext } from '../common/tenant-context';
import { canOnProject } from '../common/access';
import { notify } from '../notifications/notify';

const month = z.number().int().min(1).max(120);
const text = (max: number) => z.string().trim().min(2).max(max);
/** WP1.22: odgovorna osoba – član tima istog projekta; null je uklanja. */
const responsible = z.string().uuid().nullable().optional();
export const wpInput = z.object({ number: z.number().int().min(1).max(99).optional(), title: text(300), leadPartnerId: z.string().uuid().optional(), startMonth: month, endMonth: month, objectives: z.string().max(5000).optional() });
export const wpPatch = wpInput.omit({ number: true }).partial().strict();
export const taskInput = z.object({ title: text(300), leadPartnerId: z.string().uuid().optional(), startMonth: month, endMonth: month, responsibleMemberId: responsible });
export const taskPatch = taskInput.partial().extend({ status: z.enum(['planned', 'in_progress', 'done', 'cancelled']).optional() }).strict();
export const deliverableInput = z.object({ title: text(300), type: z.string().min(1).max(20), dissemination: z.string().min(1).max(20), dueMonth: month, leadPartnerId: z.string().uuid().optional(), responsibleMemberId: responsible });
export const deliverablePatch = deliverableInput.partial().extend({ status: z.enum(['planned', 'in_progress', 'submitted', 'accepted', 'rejected']).optional() }).strict();
export const milestoneInput = z.object({ title: text(300), dueMonth: month, verification: z.string().max(2000).optional(), responsibleMemberId: responsible });
export const milestonePatch = milestoneInput.partial().extend({ status: z.enum(['planned', 'achieved', 'missed']).optional() }).strict();
const scale = z.number().int().min(1).max(3);
export const riskInput = z.object({ description: text(2000), likelihood: scale, impact: scale, mitigation: z.string().max(2000).optional(), ownerUserId: z.string().uuid().optional() });
export const riskPatch = riskInput.partial().extend({ status: z.enum(['open', 'mitigated', 'occurred', 'closed']).optional() }).strict();
/**
 * WP1.22: promjena statusa vlastite stavke (odgovorna osoba bez `projects:write`). Samo status – ništa drugo (strogo:
 * naslov, rokovi, dodjela i ostala polja daju 400); dopušteni prijelazi u domeni (`RESPONSIBLE_TRANSITIONS`).
 */
export const deliverableProgress = z.object({ status: z.enum(['planned', 'in_progress', 'submitted', 'accepted', 'rejected']) }).strict();
export const taskProgress = z.object({ status: z.enum(['planned', 'in_progress', 'done', 'cancelled']) }).strict();

/**
 * Promjena statusa vrijedi samo s onog statusa nad kojim je provjereno pravo: ako ga je netko u međuvremenu promijenio
 * (npr. voditelj je isporuku prihvatio dok je odgovorna osoba slala „predana”), izmjena se odbija umjesto da prepiše tuđu.
 */
const statusMoved = () => new ConflictException({ statusCode: 409, code: 'status_changed', message: 'Status je u međuvremenu promijenjen – osvježi prikaz i pokušaj ponovno' });

type Row = Record<string, unknown> & { tenantId?: unknown; createdBy?: unknown; updatedBy?: unknown; deletedAt?: unknown };
const clean = <T extends Row>(r: T) => { const { tenantId: _t, createdBy: _c, updatedBy: _u, deletedAt: _d, ...rest } = r; return rest; };

/** M6 Provedba: radni paketi, zadaci, isporuke (D<wp>.<n>), prekretnice (MS<n>), rizici. */
@Injectable()
export class ImplementationService {
  constructor(private readonly audit: AuditService, private readonly packages: ProgrammePackagesService, private readonly ctx: TenantContext) {}

  /**
   * WP1.22: odgovorna osoba mora biti AKTIVAN član tima ovog projekta (član drugog projekta ili stanara → 400; drugi stanar je
   * ionako nevidljiv kroz RLS, a stranac ključ (stanar, projekt, član) to jamči i u bazi). Vraća člana (ime, račun) ili null.
   */
  private async responsibleMember(tx: Tx, projectId: string, memberId: string | null | undefined) {
    if (!memberId) return null;
    const m = (await tx.select({ id: teamMembers.id, userId: teamMembers.userId, fullName: teamMembers.fullName, active: teamMembers.active }).from(teamMembers)
      .where(and(eq(teamMembers.id, memberId), eq(teamMembers.projectId, projectId))))[0];
    if (!m) throw new BadRequestException('Odgovorna osoba mora biti član tima ovog projekta');
    if (!m.active) throw new BadRequestException(`${m.fullName} više nije aktivan/na član tima – odaberi aktivnog člana`);
    return m;
  }

  /**
   * WP1.22: obavijesti o promjeni odgovorne osobe – u istoj transakciji, nikad akteru, samo primatelju koji vidi projekt
   * (`notify`, `requires: projects:read`). Član tima bez korisničkog računa ne dobiva ništa.
   */
  private async notifyResponsibility(tx: Tx, p: Project, itemKind: ResponsibleItemKind, item: string, before: string | null, after: string | null) {
    if ((before ?? null) === (after ?? null)) return;
    const ids = [before, after].filter((x): x is string => !!x);
    const rows = ids.length ? await tx.select({ id: teamMembers.id, userId: teamMembers.userId }).from(teamMembers).where(and(eq(teamMembers.projectId, p.id), sql`${teamMembers.id} = any(${`{${ids.join(',')}}`}::uuid[])`)) : [];
    const userOf = (id: string | null) => rows.find((r) => r.id === id)?.userId ?? null;
    const data = { acronym: p.acronym, item: item.slice(0, 200), itemKind };
    const link = `projekti/${p.id}/struktura`;
    const oldUser = userOf(before), newUser = userOf(after);
    if (oldUser && oldUser !== newUser) await notify(tx, { userId: oldUser, kind: 'responsible_removed', projectId: p.id, data, link, requires: 'projects:read' });
    if (newUser && newUser !== oldUser) await notify(tx, { userId: newUser, kind: 'responsible_assigned', projectId: p.id, data, link, requires: 'projects:read' });
  }

  /**
   * WP1.22: smije li korisnik promijeniti status stavke kroz rutu „napredak”: s `projects:write` na projektu svaki status
   * (kao PATCH), inače samo odgovorna osoba (povezana s AKTIVNIM članom tima određenim za stavku) i samo dopušteni prijelaz.
   * Projekt koji korisnik ne vidi je 404 već na čuvaru rute; vidljiv bez prava je 403.
   */
  private async assertMayProgress(tx: Tx, kind: ResponsibleItemKind, projectId: string, memberId: string | null, from: string, to: string): Promise<'manager' | 'responsible'> {
    const c = this.ctx.require();
    if (canOnProject(c, 'projects:write', projectId)) return 'manager';
    const m = memberId ? (await tx.select({ userId: teamMembers.userId, active: teamMembers.active }).from(teamMembers).where(and(eq(teamMembers.id, memberId), eq(teamMembers.projectId, projectId))))[0] : undefined;
    if (!m || !m.active || !m.userId || m.userId !== c.userId) throw new ForbiddenException('Status mijenja voditelj projekta ili odgovorna osoba stavke');
    if (!responsibleMayChange(kind, from, to)) throw new ForbiddenException(`Odgovorna osoba ne mijenja status „${from}” u „${to}” – to radi voditelj projekta`);
    return 'responsible';
  }

  /** Pravila mjeseci i šifara isporuka dijele ručni unos i uvoz iz Excela (WP1.17, domena `project-import`). */
  private assertMonths(p: Project, start: number, end: number, what: string): void {
    const issue = monthRangeIssue(p.durationMonths, start, end, what);
    if (issue) throw new BadRequestException(issue);
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
    const issues = deliverableCodeIssues(pkg, type, dissemination);
    if (issues.length) throw new BadRequestException(issues[0]);
  }

  async structure(tx: Tx, projectId: string) {
    const p = await loadProject(tx, projectId);
    const due = (m: number) => (p.startDate ? monthEndDate(p.startDate, m) : null);
    // Upiti jedan za drugim: jedna transakcija = jedan klijent baze, istovremeni upiti na njemu prestaju raditi u pg 9 (WP1.14b).
    const wps = await tx.select().from(workPackages).where(and(eq(workPackages.projectId, projectId), isNull(workPackages.deletedAt))).orderBy(asc(workPackages.number));
    const ts = await tx.select().from(tasks).where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt))).orderBy(asc(tasks.number));
    const ds = await tx.select().from(deliverables).where(and(eq(deliverables.projectId, projectId), isNull(deliverables.deletedAt))).orderBy(asc(deliverables.number));
    const ms = await tx.select().from(milestones).where(and(eq(milestones.projectId, projectId), isNull(milestones.deletedAt))).orderBy(asc(milestones.number));
    const rs = await tx.select().from(risks).where(and(eq(risks.projectId, projectId), isNull(risks.deletedAt))).orderBy(asc(risks.number));
    // WP1.22: odgovorne osobe (ime, aktivan, je li to korisnik sam); popis članova za odabir samo onome tko smije uređivati.
    const team = await tx.select({ id: teamMembers.id, fullName: teamMembers.fullName, active: teamMembers.active, userId: teamMembers.userId }).from(teamMembers)
      .where(eq(teamMembers.projectId, projectId)).orderBy(asc(teamMembers.fullName));
    const c = this.ctx.get();
    const who = (id: string | null) => { const m = id ? team.find((t) => t.id === id) : undefined; return m ? { memberId: m.id, name: m.fullName, active: m.active, mine: !!c?.userId && m.userId === c.userId } : null; };
    const mayEdit = !!c && canOnProject(c, 'projects:write', projectId);
    return {
      team: mayEdit ? team.map((t) => ({ id: t.id, name: t.fullName, active: t.active })) : undefined,
      projectId, startDate: p.startDate, durationMonths: p.durationMonths,
      workPackages: wps.map((w) => ({
        ...clean(w), code: `WP${w.number}`,
        tasks: ts.filter((t) => t.workPackageId === w.id).map((t) => ({ ...clean(t), code: `T${w.number}.${t.number}`, endDate: due(t.endMonth), responsible: who(t.responsibleMemberId) })),
        deliverables: ds.filter((d) => d.workPackageId === w.id).map((d) => ({ ...clean(d), code: `D${w.number}.${d.number}`, dueDate: due(d.dueMonth), responsible: who(d.responsibleMemberId) })),
      })),
      milestones: ms.map((m) => ({ ...clean(m), code: `MS${m.number}`, dueDate: due(m.dueMonth), responsible: who(m.responsibleMemberId) })),
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
    await this.responsibleMember(tx, projectId, input.responsibleMemberId);
    const number = await this.nextNumber(tx, tasks, tasks.number, eq(tasks.workPackageId, wpId));
    const [row] = await tx.insert(tasks).values({ tenantId, projectId, workPackageId: wpId, number, ...input, createdBy: actorId, updatedBy: actorId }).returning();
    await this.audit.record(tx, { entity: 'task', entityId: row!.id, action: 'create', diff: { after: clean(row!) } });
    await this.notifyResponsibility(tx, p, 'task', `T${w.number}.${number} ${row!.title}`, null, row!.responsibleMemberId);
    return { ...clean(row!), code: `T${w.number}.${number}` };
  }

  async updateTask(tx: Tx, projectId: string, taskId: string, patch: z.infer<typeof taskPatch>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    const before = (await tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId))))[0];
    if (!before) throw new NotFoundException('Zadatak ne postoji na projektu');
    this.assertMonths(p, patch.startMonth ?? before.startMonth, patch.endMonth ?? before.endMonth, 'Zadatak');
    await assertPartnerOnProject(tx, projectId, patch.leadPartnerId);
    if (patch.responsibleMemberId !== undefined && patch.responsibleMemberId !== before.responsibleMemberId) await this.responsibleMember(tx, projectId, patch.responsibleMemberId);
    const [row] = await tx.update(tasks).set({ ...patch, updatedAt: new Date(), updatedBy: actorId }).where(eq(tasks.id, taskId)).returning();
    await this.audit.record(tx, { entity: 'task', entityId: taskId, action: 'update', diff: { before: clean(before), after: clean(row!) } });
    await this.notifyResponsibility(tx, p, 'task', `${await this.taskCode(tx, row!)} ${row!.title}`, before.responsibleMemberId, row!.responsibleMemberId);
    return clean(row!);
  }

  async createDeliverable(tx: Tx, tenantId: string, projectId: string, wpId: string, input: z.infer<typeof deliverableInput>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    const w = await this.wp(tx, projectId, wpId);
    this.assertMonths(p, input.dueMonth, input.dueMonth, 'Isporuka');
    await this.assertCodes(tx, p, input.type, input.dissemination);
    await assertPartnerOnProject(tx, projectId, input.leadPartnerId);
    await this.responsibleMember(tx, projectId, input.responsibleMemberId);
    const number = await this.nextNumber(tx, deliverables, deliverables.number, eq(deliverables.workPackageId, wpId));
    const [row] = await tx.insert(deliverables).values({ tenantId, projectId, workPackageId: wpId, number, ...input, createdBy: actorId, updatedBy: actorId }).returning();
    await this.audit.record(tx, { entity: 'deliverable', entityId: row!.id, action: 'create', diff: { after: clean(row!) } });
    await this.notifyResponsibility(tx, p, 'deliverable', `D${w.number}.${number} ${row!.title}`, null, row!.responsibleMemberId);
    return { ...clean(row!), code: `D${w.number}.${number}`, dueDate: p.startDate ? monthEndDate(p.startDate, row!.dueMonth) : null };
  }

  async updateDeliverable(tx: Tx, projectId: string, id: string, patch: z.infer<typeof deliverablePatch>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    const before = (await tx.select().from(deliverables).where(and(eq(deliverables.id, id), eq(deliverables.projectId, projectId))))[0];
    if (!before) throw new NotFoundException('Isporuka ne postoji na projektu');
    if (patch.dueMonth) this.assertMonths(p, patch.dueMonth, patch.dueMonth, 'Isporuka');
    await this.assertCodes(tx, p, patch.type, patch.dissemination);
    await assertPartnerOnProject(tx, projectId, patch.leadPartnerId);
    if (patch.responsibleMemberId !== undefined && patch.responsibleMemberId !== before.responsibleMemberId) await this.responsibleMember(tx, projectId, patch.responsibleMemberId);
    const submittedAt = patch.status === 'submitted' && before.status !== 'submitted' ? new Date() : undefined;
    const [row] = await tx.update(deliverables).set({ ...patch, ...(submittedAt ? { submittedAt } : {}), updatedAt: new Date(), updatedBy: actorId }).where(eq(deliverables.id, id)).returning();
    await this.audit.record(tx, { entity: 'deliverable', entityId: id, action: patch.status && patch.status !== before.status ? `status.${patch.status}` : 'update', diff: { before: clean(before), after: clean(row!) } });
    await this.notifyResponsibility(tx, p, 'deliverable', `${await this.deliverableCode(tx, row!)} ${row!.title}`, before.responsibleMemberId, row!.responsibleMemberId);
    return clean(row!);
  }

  private async deliverableCode(tx: Tx, d: { workPackageId: string; number: number }): Promise<string> {
    const [w] = await tx.select({ n: workPackages.number }).from(workPackages).where(eq(workPackages.id, d.workPackageId));
    return `D${w?.n ?? '?'}.${d.number}`;
  }

  private async taskCode(tx: Tx, t: { workPackageId: string; number: number }): Promise<string> {
    const [w] = await tx.select({ n: workPackages.number }).from(workPackages).where(eq(workPackages.id, t.workPackageId));
    return `T${w?.n ?? '?'}.${t.number}`;
  }

  /** WP1.22: status isporuke – voditelj (projects:write) ili odgovorna osoba u dopuštenom podskupu (`assertMayProgress`). */
  async progressDeliverable(tx: Tx, projectId: string, id: string, input: z.infer<typeof deliverableProgress>, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    const before = (await tx.select().from(deliverables).where(and(eq(deliverables.id, id), eq(deliverables.projectId, projectId), isNull(deliverables.deletedAt))))[0];
    if (!before) throw new NotFoundException('Isporuka ne postoji na projektu');
    if (before.status === input.status) return clean(before);
    const by = await this.assertMayProgress(tx, 'deliverable', projectId, before.responsibleMemberId, before.status, input.status);
    const submittedAt = input.status === 'submitted' ? new Date() : undefined;
    const [row] = await tx.update(deliverables).set({ status: input.status, ...(submittedAt ? { submittedAt } : {}), updatedAt: new Date(), updatedBy: actorId }).where(and(eq(deliverables.id, id), eq(deliverables.status, before.status))).returning();
    if (!row) throw statusMoved();
    await this.audit.record(tx, { entity: 'deliverable', entityId: id, action: `status.${input.status}`, diff: { before: { status: before.status }, after: { status: row!.status }, meta: { projectId, by } } });
    return clean(row!);
  }

  /** WP1.22: status zadatka – voditelj ili odgovorna osoba u dopuštenom podskupu. */
  async progressTask(tx: Tx, projectId: string, taskId: string, input: z.infer<typeof taskProgress>, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    const before = (await tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt))))[0];
    if (!before) throw new NotFoundException('Zadatak ne postoji na projektu');
    if (before.status === input.status) return clean(before);
    const by = await this.assertMayProgress(tx, 'task', projectId, before.responsibleMemberId, before.status, input.status);
    const [row] = await tx.update(tasks).set({ status: input.status, updatedAt: new Date(), updatedBy: actorId }).where(and(eq(tasks.id, taskId), eq(tasks.status, before.status))).returning();
    if (!row) throw statusMoved();
    await this.audit.record(tx, { entity: 'task', entityId: taskId, action: `status.${input.status}`, diff: { before: { status: before.status }, after: { status: row!.status }, meta: { projectId, by } } });
    return clean(row!);
  }

  async createMilestone(tx: Tx, tenantId: string, projectId: string, input: z.infer<typeof milestoneInput>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    this.assertMonths(p, input.dueMonth, input.dueMonth, 'Prekretnica');
    await this.responsibleMember(tx, projectId, input.responsibleMemberId);
    const number = await this.nextNumber(tx, milestones, milestones.number, eq(milestones.projectId, projectId));
    const [row] = await tx.insert(milestones).values({ tenantId, projectId, number, ...input, createdBy: actorId, updatedBy: actorId }).returning();
    await this.audit.record(tx, { entity: 'milestone', entityId: row!.id, action: 'create', diff: { after: clean(row!) } });
    await this.notifyResponsibility(tx, p, 'milestone', `MS${number} ${row!.title}`, null, row!.responsibleMemberId);
    return { ...clean(row!), code: `MS${number}` };
  }

  async updateMilestone(tx: Tx, projectId: string, id: string, patch: z.infer<typeof milestonePatch>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    const before = (await tx.select().from(milestones).where(and(eq(milestones.id, id), eq(milestones.projectId, projectId))))[0];
    if (!before) throw new NotFoundException('Prekretnica ne postoji na projektu');
    if (patch.dueMonth) this.assertMonths(p, patch.dueMonth, patch.dueMonth, 'Prekretnica');
    if (patch.responsibleMemberId !== undefined && patch.responsibleMemberId !== before.responsibleMemberId) await this.responsibleMember(tx, projectId, patch.responsibleMemberId);
    const [row] = await tx.update(milestones).set({ ...patch, updatedAt: new Date(), updatedBy: actorId }).where(eq(milestones.id, id)).returning();
    await this.audit.record(tx, { entity: 'milestone', entityId: id, action: 'update', diff: { before: clean(before), after: clean(row!) } });
    await this.notifyResponsibility(tx, p, 'milestone', `MS${row!.number} ${row!.title}`, before.responsibleMemberId, row!.responsibleMemberId);
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
