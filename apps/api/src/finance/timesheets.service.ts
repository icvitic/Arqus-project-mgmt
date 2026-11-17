import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { daysInMonth, minutesByWorkPackage, personnelCostCents, timesheetIssues } from '@arqus/domain';
import type { Tx } from '../db/db.service';
import { expenses, teamMembers, timesheetEntries, timesheets, users, workPackages, type Project } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { ProgrammePackagesService } from '../programmes/programme-packages.service';
import { TenantContext } from '../common/tenant-context';
import { assertPartnerOnProject, loadProject } from '../common/project-access';
import { canOnProject } from '../common/access';
import { ensureTeamMemberAccess } from '../identity/project-grants';
import { assertSpendable, projectEnd, selfPartner } from './finance-common';
import { loadTimesheetRecords, renderTimesheetRecord } from './timesheet-record';
import { assertRevision, bump, revisionField } from '../common/revision';

export const memberInput = z.object({
  fullName: z.string().trim().min(2).max(200), userId: z.string().uuid().optional(), partnerId: z.string().uuid().optional(),
  role: z.string().max(100).optional(),
  /** Godišnji trošak (plaća) – neobavezan; unosi ga i mijenja samo uloga s personnel:read na projektu (WP1.14). */
  annualCost: z.number().int().min(0).max(1_000_000_000).optional(),
});
export const memberPatch = memberInput.omit({ userId: true, partnerId: true }).partial().extend({ active: z.boolean().optional() }).strict();
const COST_DENIED = 'Godišnji trošak (plaću) unosi i mijenja samo uloga s pristupom podacima o osoblju (personnel:read)';
export const timesheetInput = z.object({
  entries: z.array(z.object({ day: z.number().int(), minutes: z.number().int(), workPackageId: z.string().uuid().nullable().optional() })).max(31 * 10),
  /** WP1.14b: revizija timesheeta koju je klijent učitao (0 = timesheet još ne postoji); razlika → 409, ništa se ne zapisuje. */
  revision: revisionField,
});
export const monthParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mjesec u obliku GGGG-MM');

/** Tim projekta i mjesečni timesheetovi; odobrenje timesheeta stvara troškove osoblja prema pravilu paketa. */
@Injectable()
export class TimesheetsService {
  constructor(private readonly audit: AuditService, private readonly packages: ProgrammePackagesService, private readonly ctx: TenantContext) {}

  /** Plaće: čitanje, unos i izmjena godišnjeg troška samo uz personnel:read na projektu (ASVS V8, WP1.14). */
  private seesCost(projectId: string): boolean { return canOnProject(this.ctx.require(), 'personnel:read', projectId); }

  private memberView(m: typeof teamMembers.$inferSelect, seeCost: boolean) {
    const { tenantId: _t, createdBy: _c, updatedBy: _u, deletedAt: _d, annualCostCents, ...r } = m;
    return { ...r, annualCost: seeCost ? annualCostCents : null, costSet: annualCostCents !== null };
  }

  async team(tx: Tx, projectId: string) {
    await loadProject(tx, projectId);
    const rows = await tx.select().from(teamMembers).where(eq(teamMembers.projectId, projectId)).orderBy(asc(teamMembers.fullName));
    const seeCost = this.seesCost(projectId);
    return rows.map((m) => this.memberView(m, seeCost));
  }

  async addMember(tx: Tx, tenantId: string, projectId: string, input: z.infer<typeof memberInput>, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    if (input.annualCost !== undefined && !this.seesCost(projectId)) throw new ForbiddenException(COST_DENIED);
    const partnerId = input.partnerId ?? (await selfPartner(tx, projectId)).id;
    await assertPartnerOnProject(tx, projectId, partnerId);
    if (input.userId && !(await tx.select({ id: users.id }).from(users).where(and(eq(users.id, input.userId), isNull(users.deletedAt)))).length) throw new NotFoundException(`Korisnik ${input.userId} ne postoji`);
    const [row] = await tx.insert(teamMembers).values({ tenantId, projectId, partnerId, userId: input.userId ?? null, fullName: input.fullName, role: input.role ?? null, annualCostCents: input.annualCost ?? null, createdBy: actorId, updatedBy: actorId }).returning();
    // Član tima s korisničkim računom dobiva pristup projektu (uloga člana tima), da može voditi vlastite timesheetove.
    if (input.userId) await ensureTeamMemberAccess(tx, this.audit, tenantId, projectId, input.userId, actorId);
    // Godišnji trošak se bilježi (tko je upisao koju plaću); pregled revizije ga prikazuje samo uz personnel:read (WP1.14b).
    await this.audit.record(tx, { entity: 'team_member', entityId: row!.id, action: 'create', diff: { after: row, meta: { projectId } } });
    return this.memberView(row!, this.seesCost(projectId));
  }

  async updateMember(tx: Tx, projectId: string, memberId: string, patch: z.infer<typeof memberPatch>, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    if (patch.annualCost !== undefined && !this.seesCost(projectId)) throw new ForbiddenException(COST_DENIED);
    const before = await this.member(tx, projectId, memberId);
    const { annualCost, ...rest } = patch;
    const [row] = await tx.update(teamMembers).set({ ...rest, ...(annualCost !== undefined ? { annualCostCents: annualCost } : {}), updatedAt: new Date(), updatedBy: actorId }).where(eq(teamMembers.id, before.id)).returning();
    await this.audit.record(tx, { entity: 'team_member', entityId: memberId, action: 'update', diff: {
      before: { fullName: before.fullName, role: before.role, active: before.active, ...(annualCost !== undefined ? { annualCostCents: before.annualCostCents } : {}) },
      after: { ...rest, ...(annualCost !== undefined ? { annualCostCents: annualCost } : {}) }, meta: { projectId } } });
    return this.memberView(row!, this.seesCost(projectId));
  }

  private async member(tx: Tx, projectId: string, memberId: string) {
    const m = (await tx.select().from(teamMembers).where(and(eq(teamMembers.id, memberId), eq(teamMembers.projectId, projectId))))[0];
    if (!m) throw new NotFoundException('Član tima ne postoji na projektu');
    return m;
  }

  /** Bez `timesheets:approve` na projektu korisnik smije uređivati samo vlastiti timesheet. */
  private assertOwnOrApprover(m: { userId: string | null; projectId: string }): void {
    const c = this.ctx.require();
    if (canOnProject(c, 'timesheets:approve', m.projectId)) return;
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
      submittedBy: ts?.submittedBy ?? null, revision: ts?.revision ?? 0, updatedAt: ts?.updatedAt ?? null,
      entries: list, totalMinutes: list.reduce((a, e) => a + e.minutes, 0), warnings: timesheetIssues(month, list).warnings,
    };
  }

  /** Mjesečna evidencija rada za ispis i potpis (isti dokument kao u paketu ZNS-a, WP1.16b); bez timesheeta – prazna evidencija. */
  async record(tx: Tx, projectId: string, memberId: string, month: string): Promise<string> {
    const p = await loadProject(tx, projectId);
    await this.member(tx, projectId, memberId);
    const pkg = await this.packages.get(tx, p.packageId, p.packageVersion);
    const [r] = await loadTimesheetRecords(tx, p, pkg.meta.programme, [{ memberId, month }]);
    return renderTimesheetRecord(r!);
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
    // WP1.19: istovremena prva spremanja istog timesheeta idu jedno za drugim (zaključan redak člana tima) – drugo dobiva
    // `revision_conflict`, ne generičku grešku jedinstvenosti.
    await tx.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.id, memberId)).for('no key update');
    let ts = (await tx.select().from(timesheets).where(and(eq(timesheets.teamMemberId, memberId), eq(timesheets.month, month))))[0];
    await assertRevision(tx, timesheets, ts?.id ?? null, input.revision, `Timesheet ${m.fullName} za ${month}`);
    if (errors.length) throw new BadRequestException({ message: 'Timesheet nije valjan', issues: errors });
    if (ts && ts.status !== 'draft') throw new ConflictException(`Timesheet je u statusu "${ts.status}" – vrati ga u nacrt za izmjene`);
    if (!ts) [ts] = await tx.insert(timesheets).values({ tenantId, projectId, teamMemberId: memberId, month, createdBy: actorId, updatedBy: actorId }).returning();
    await tx.delete(timesheetEntries).where(eq(timesheetEntries.timesheetId, ts!.id));
    const rows = input.entries.filter((e) => e.minutes > 0);
    if (rows.length) await tx.insert(timesheetEntries).values(rows.map((e) => ({ tenantId, timesheetId: ts!.id, day: e.day, minutes: e.minutes, workPackageId: e.workPackageId ?? null })));
    await tx.update(timesheets).set({ revision: bump(timesheets), updatedAt: new Date(), updatedBy: actorId }).where(eq(timesheets.id, ts!.id));
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
    await tx.update(timesheets).set({ status: 'submitted', submittedAt: new Date(), submittedBy: actorId ?? null, revision: bump(timesheets), updatedAt: new Date(), updatedBy: actorId }).where(eq(timesheets.id, ts.id));
    await this.audit.record(tx, { entity: 'timesheet', entityId: ts.id, action: 'submit', diff: { meta: { month, memberId } } });
    return this.get(tx, projectId, memberId, month);
  }

  /** Odobrenje: trošak osoblja po radnom paketu = minute × stopa iz paketa (godišnji trošak / djelitelj). */
  async approve(tx: Tx, tenantId: string, projectId: string, memberId: string, month: string, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    assertSpendable(p);
    const m = await this.member(tx, projectId, memberId);
    // Nitko ne odobrava vlastiti timesheet, bez obzira na ulogu (razdvajanje dužnosti).
    const me = this.ctx.require().userId;
    if (m.userId && m.userId === me) throw new ForbiddenException('Ne možeš odobriti vlastiti timesheet – odobrava ga voditelj projekta ili ured za projekte');
    const ts = await this.load(tx, projectId, memberId, month);
    if (ts.status !== 'submitted') throw new ConflictException(`Odobrava se samo predan timesheet (trenutno "${ts.status}")`);
    // WP1.14b – četiri oka: tko je predao timesheet, ne odobrava ga (i kad je unio sate za člana bez korisničkog računa).
    // Predan timesheet bez zabilježenog predavatelja (stariji od migracije 0023 bez revizijskog zapisa) ne odobrava se – vrati ga u nacrt i predaj ponovno.
    if (!ts.submittedBy) throw new ConflictException('Nije poznato tko je predao ovaj timesheet – vrati ga u nacrt i predaj ponovno, pa ga odobrava druga osoba');
    if (ts.submittedBy === me) throw new ForbiddenException('Ne možeš odobriti timesheet koji si sam predao – odobrava ga druga osoba s pravom odobravanja na projektu (četiri oka)');
    if (m.annualCostCents === null) throw new ConflictException(`Za člana tima ${m.fullName} nije upisan godišnji trošak – upisuje ga uloga s pristupom podacima o osoblju (financije, ured za projekte)`);
    const annualCostCents = m.annualCostCents;
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
      const amount = personnelCostCents(pkg, annualCostCents, minutes);
      created.push({ workPackageId: wp, minutes, amount });
      await tx.insert(expenses).values({ tenantId, projectId, partnerId: m.partnerId, categoryCode: category, workPackageId: wp, date: expenseDate,
        description: `Rad: ${m.fullName}, ${month} (${(minutes / 60).toFixed(2).replace('.', ',')} h)`, amountCents: amount, source: 'timesheet', timesheetId: ts.id, createdBy: actorId, updatedBy: actorId });
    }
    await tx.update(timesheets).set({ status: 'approved', approvedAt: new Date(), approvedBy: actorId ?? null, revision: bump(timesheets), updatedAt: new Date(), updatedBy: actorId }).where(eq(timesheets.id, ts.id));
    await this.audit.record(tx, { entity: 'timesheet', entityId: ts.id, action: 'approve', diff: { meta: { month, memberId, submittedBy: ts.submittedBy, expenses: created } } });
    // WP1.19: odobravatelj bez personnel:read (npr. voditelj projekta) dobiva sate po radnom paketu, ne iznos (satnica).
    const canSee = this.seesCost(projectId);
    return { ...(await this.get(tx, projectId, memberId, month)), personnelCost: created.map((x) => (canSee ? { ...x, amountHidden: false } : { ...x, amount: null, amountHidden: true })) };
  }

  /** Povrat u nacrt: iz predanog, ili iz odobrenog dok troškovi osoblja nisu u zahtjevu za nadoknadu (brišu se). */
  async reopen(tx: Tx, projectId: string, memberId: string, month: string, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    const ts = await this.load(tx, projectId, memberId, month);
    if (ts.status === 'locked') throw new ConflictException('Timesheet je u zahtjevu za nadoknadu i zaključan je');
    if (ts.status === 'draft') throw new ConflictException('Timesheet je već nacrt');
    if (ts.status === 'approved') await tx.delete(expenses).where(and(eq(expenses.timesheetId, ts.id), eq(expenses.status, 'recorded')));
    await tx.update(timesheets).set({ status: 'draft', submittedAt: null, submittedBy: null, approvedAt: null, approvedBy: null, revision: bump(timesheets), updatedAt: new Date(), updatedBy: actorId }).where(eq(timesheets.id, ts.id));
    await this.audit.record(tx, { entity: 'timesheet', entityId: ts.id, action: 'reopen', diff: { before: { status: ts.status }, after: { status: 'draft' } } });
    return this.get(tx, projectId, memberId, month);
  }
}
