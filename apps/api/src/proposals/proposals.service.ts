import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { currentContext } from '../common/tenant-context';
import { canInTenant } from '../common/access';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  budgetLineIssues, callStatus, computeProjectBudget, isProposalEditable, isReady, OUTCOME_FROM, PROPOSAL_TRANSITIONS, proposalReadiness,
  type CallDeadline, type ProposalStatus,
} from '@arqus/domain';
import type { Tx } from '../db/db.service';
import { budgetLines, callTracking, calls, organisations, projectBudgets, projects, proposalBudgetLines, proposalMembers, proposalWorkPackages, proposals, users, workPackages, type Proposal } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { ProgrammePackagesService } from '../programmes/programme-packages.service';
import { OrganisationsService } from '../organisations/organisations.service';
import { ProjectsService } from '../projects/projects.service';

const ROLES = ['coordinator', 'partner', 'associated', 'third_party'] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const proposalInput = z.object({
  packageId: z.string().min(1), packageVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(), actionType: z.string().min(1),
  acronym: z.string().trim().min(2).max(40), title: z.string().trim().min(3).max(500), role: z.enum(['coordinator', 'partner']).default('coordinator'),
  durationMonths: z.number().int().min(1).max(120).default(36), internalDeadline: isoDate.optional(), leadUserId: z.string().uuid().optional(),
});
export const fromCallInput = proposalInput.omit({ packageId: true, packageVersion: true }).extend({ actionType: z.string().min(1).optional() });
export const proposalPatch = z.object({ acronym: z.string().trim().min(2).max(40).optional(), title: z.string().trim().min(3).max(500).optional(), durationMonths: z.number().int().min(1).max(120).optional(), internalDeadline: isoDate.nullable().optional(), leadUserId: z.string().uuid().nullable().optional() }).strict();
export const memberInput = z.object({ organisationId: z.string().uuid(), role: z.enum(ROLES).default('partner'), confirmed: z.boolean().default(false) });
export const memberPatch = z.object({ role: z.enum(ROLES).optional(), confirmed: z.boolean().optional() }).strict();
export const wpInput = z.object({ title: z.string().trim().min(2).max(300), leadMemberId: z.string().uuid().optional(), startMonth: z.number().int().min(1), endMonth: z.number().int().min(1), personMonths: z.number().int().min(0).max(10000).default(0) });
export const budgetInput = z.object({ lines: z.array(z.object({ memberId: z.string().uuid(), categoryCode: z.string().min(1).max(20), amount: z.number().int().min(0).max(100_000_000_000) })).max(2000) });
export const transitionInput = z.object({ to: z.enum(['preparation', 'internal_review', 'in_evaluation', 'withdrawn']) });
export const submitInput = z.object({ portal: z.string().trim().min(2).max(100), reference: z.string().trim().min(1).max(100), submittedAt: z.string().datetime({ offset: true }).optional() });
export const outcomeInput = z.object({ result: z.enum(['funded', 'reserve', 'rejected']), score: z.string().max(50).optional(), note: z.string().max(2000).optional() });
export const contractInput = z.object({ contractNo: z.string().trim().min(1).max(60).optional(), startDate: isoDate.optional() });

/** M5 Prijava: konzorcij, struktura rada, proračun po paketu, spremnost, predaja, ishod i ugovaranje u projekt (ADR-0006). */
@Injectable()
export class ProposalsService {
  constructor(private readonly audit: AuditService, private readonly packages: ProgrammePackagesService, private readonly orgs: OrganisationsService, private readonly projects: ProjectsService) {}

  private async row(tx: Tx, id: string): Promise<Proposal> {
    const p = (await tx.select().from(proposals).where(and(eq(proposals.id, id), isNull(proposals.deletedAt))))[0];
    if (!p) throw new NotFoundException(`Prijava ${id} ne postoji`);
    return p;
  }
  private editable(p: Proposal): void {
    if (!isProposalEditable(p.status as ProposalStatus)) throw new ConflictException('Prijava se mijenja samo u statusu ideja ili u pripremi');
  }
  private async members(tx: Tx, id: string) {
    return tx.select({ m: proposalMembers, org: organisations }).from(proposalMembers).innerJoin(organisations, eq(organisations.id, proposalMembers.organisationId))
      .where(eq(proposalMembers.proposalId, id)).orderBy(asc(proposalMembers.orderNo));
  }

  async list(tx: Tx) {
    const rows = await tx.select({ p: proposals, callCode: calls.code, members: sql<number>`(select count(*)::int from proposal_members m where m.proposal_id = ${proposals.id})` })
      .from(proposals).leftJoin(calls, eq(calls.id, proposals.callId)).where(isNull(proposals.deletedAt)).orderBy(desc(proposals.createdAt));
    return rows.map(({ p, callCode, members }) => ({ id: p.id, acronym: p.acronym, title: p.title, status: p.status, role: p.role, callId: p.callId, callCode, packageId: p.packageId, actionType: p.actionType, internalDeadline: p.internalDeadline, members, projectId: p.projectId, requested: (p.submission as { requested?: number } | null)?.requested ?? null }));
  }

  async get(tx: Tx, id: string) {
    const p = await this.row(tx, id);
    const pkg = await this.packages.get(tx, p.packageId, p.packageVersion);
    const ms = await this.members(tx, id);
    const wps = await tx.select().from(proposalWorkPackages).where(eq(proposalWorkPackages.proposalId, id)).orderBy(asc(proposalWorkPackages.number));
    const lines = await tx.select().from(proposalBudgetLines).where(eq(proposalBudgetLines.proposalId, id));
    const budget = computeProjectBudget(pkg, p.actionType, ms.map(({ m, org }) => ({ id: m.id, beneficiaryType: m.beneficiaryType, name: org.name })), lines.map((l) => ({ partnerId: l.memberId, categoryCode: l.categoryCode, amount: l.amountCents })));
    const call = p.callId ? (await tx.select().from(calls).where(eq(calls.id, p.callId)))[0] : undefined;
    const callOpen = call ? callStatus({ opensAt: call.opensAt, deadlines: call.deadlines as CallDeadline[], cancelled: call.cancelled }) === 'open' : null;
    const readiness = proposalReadiness({
      members: ms.map(({ m, org }) => ({ country: org.country, confirmed: m.confirmed })), minPartners: pkg.consortiumRules?.minPartners, minCountries: pkg.consortiumRules?.minCountries,
      workPackages: wps.length, budgetTotal: budget.totals.total, budgetLocked: p.budgetLocked, hasLead: !!p.leadUserId, callOpen,
    });
    return {
      id: p.id, acronym: p.acronym, title: p.title, status: p.status, role: p.role, actionType: p.actionType, durationMonths: p.durationMonths, internalDeadline: p.internalDeadline, leadUserId: p.leadUserId,
      package: { rowId: p.packageRowId, id: p.packageId, version: p.packageVersion },
      call: call ? { id: call.id, code: call.code, title: call.title, deadlines: call.deadlines, status: callStatus({ opensAt: call.opensAt, deadlines: call.deadlines as CallDeadline[], cancelled: call.cancelled }) } : null,
      members: ms.map(({ m, org }) => ({ id: m.id, organisationId: org.id, name: org.name, country: org.country, isSelf: org.isSelf, role: m.role, beneficiaryType: m.beneficiaryType, confirmed: m.confirmed, orderNo: m.orderNo })),
      workPackages: wps.map((w) => ({ id: w.id, code: `WP${w.number}`, number: w.number, title: w.title, leadMemberId: w.leadMemberId, startMonth: w.startMonth, endMonth: w.endMonth, personMonths: w.personMonths })),
      budget: { version: p.budgetVersion, locked: p.budgetLocked, categories: pkg.costCategories.map((c) => ({ code: c.code, name: c.name, kind: c.kind, children: c.children?.map((k) => ({ code: k.code, name: k.name, kind: k.kind })) })), lines: lines.map((l) => ({ memberId: l.memberId, categoryCode: l.categoryCode, amount: l.amountCents })), partners: budget.partners, totals: budget.totals, warnings: budget.warnings },
      readiness, ready: isReady(readiness), submission: p.submission, outcome: p.outcome, projectId: p.projectId,
    };
  }

  private beneficiaryType(pkg: Awaited<ReturnType<ProgrammePackagesService['get']>>, actionType: string, nonProfit: boolean): string {
    const a = pkg.actionTypes.find((x) => x.code === actionType);
    return nonProfit && a?.fundingRates.some((r) => r.beneficiaryType === 'nonProfit') ? 'nonProfit' : 'default';
  }

  async create(tx: Tx, tenantId: string, input: z.infer<typeof proposalInput>, actorId?: string, callId?: string) {
    const pkg = await this.packages.get(tx, input.packageId, input.packageVersion);
    if (pkg._row.status === 'deprecated') throw new BadRequestException('Paket je zastario');
    if (!pkg.actionTypes.some((a) => a.code === input.actionType)) throw new BadRequestException(`Vrsta akcije "${input.actionType}" ne postoji u paketu (dostupno: ${pkg.actionTypes.map((a) => a.code).join(', ')})`);
    if (input.leadUserId && !(await tx.select({ id: users.id }).from(users).where(eq(users.id, input.leadUserId))).length) throw new NotFoundException('Voditelj ne postoji');
    const self = await this.orgs.ensureSelf(tx, tenantId);
    const [p] = await tx.insert(proposals).values({
      tenantId, callId: callId ?? null, packageRowId: pkg._row.id, packageId: pkg._row.packageId, packageVersion: pkg._row.version, actionType: input.actionType,
      acronym: input.acronym, title: input.title, role: input.role, durationMonths: input.durationMonths, internalDeadline: input.internalDeadline ?? null, leadUserId: input.leadUserId ?? actorId ?? null,
      createdBy: actorId, updatedBy: actorId,
    }).returning();
    await tx.insert(proposalMembers).values({ tenantId, proposalId: p!.id, organisationId: self.id, role: input.role === 'coordinator' ? 'coordinator' : 'partner', beneficiaryType: this.beneficiaryType(pkg, input.actionType, self.nonProfit), confirmed: true, orderNo: input.role === 'coordinator' ? 1 : 2, createdBy: actorId });
    await this.audit.record(tx, { entity: 'proposal', entityId: p!.id, action: 'create', diff: { after: { acronym: p!.acronym, callId, packageId: p!.packageId } } });
    return this.get(tx, p!.id);
  }

  /** Iz odluke „go” na radaru: paket i vrsta akcije iz poziva; jedna aktivna prijava po pozivu. */
  async createFromCall(tx: Tx, tenantId: string, callId: string, input: z.infer<typeof fromCallInput>, actorId?: string) {
    const call = (await tx.select().from(calls).where(and(eq(calls.id, callId), isNull(calls.deletedAt))))[0];
    if (!call) throw new NotFoundException('Poziv ne postoji');
    const t = (await tx.select().from(callTracking).where(eq(callTracking.callId, callId)))[0];
    if (t?.decision !== 'go') throw new ConflictException('Prijava se otvara nakon odluke „go” za poziv');
    if (!call.packageId) throw new ConflictException('Poziv nema paket programa – dodaj ga na pozivu ili otvori prijavu izravno');
    const existing = await tx.select({ id: proposals.id }).from(proposals).where(and(eq(proposals.callId, callId), isNull(proposals.deletedAt), sql`${proposals.status} not in ('withdrawn','rejected')`));
    if (existing.length) throw new ConflictException('Za ovaj poziv već postoji prijava');
    const actionType = input.actionType ?? call.actionTypes[0];
    if (!actionType) throw new BadRequestException('Navedi vrstu akcije');
    return this.create(tx, tenantId, { ...input, actionType, packageId: call.packageId }, actorId, callId);
  }

  async update(tx: Tx, id: string, patch: z.infer<typeof proposalPatch>, actorId?: string) {
    const p = await this.row(tx, id);
    if (['contracted', 'withdrawn', 'rejected'].includes(p.status)) throw new ConflictException('Zaključena prijava se ne mijenja');
    if (patch.durationMonths !== undefined) this.editable(p);
    if (patch.leadUserId && !(await tx.select({ id: users.id }).from(users).where(eq(users.id, patch.leadUserId))).length) throw new NotFoundException('Voditelj ne postoji');
    await tx.update(proposals).set({ ...patch, updatedAt: new Date(), updatedBy: actorId }).where(eq(proposals.id, id));
    await this.audit.record(tx, { entity: 'proposal', entityId: id, action: 'update', diff: { after: patch } });
    return this.get(tx, id);
  }

  async addMember(tx: Tx, tenantId: string, id: string, input: z.infer<typeof memberInput>, actorId?: string) {
    const p = await this.row(tx, id); this.editable(p);
    const org = await this.orgs.getRow(tx, input.organisationId);
    if (input.role === 'coordinator' && (await tx.select({ id: proposalMembers.id }).from(proposalMembers).where(and(eq(proposalMembers.proposalId, id), eq(proposalMembers.role, 'coordinator')))).length) throw new ConflictException('Prijava već ima koordinatora');
    const pkg = await this.packages.get(tx, p.packageId, p.packageVersion);
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${proposalMembers.orderNo}), 0)::int + 1` }).from(proposalMembers).where(eq(proposalMembers.proposalId, id)) as [{ next: number }];
    await tx.insert(proposalMembers).values({ tenantId, proposalId: id, organisationId: org.id, role: input.role, beneficiaryType: this.beneficiaryType(pkg, p.actionType, org.nonProfit), confirmed: input.confirmed, orderNo: input.role === 'coordinator' ? 1 : next, createdBy: actorId });
    await this.audit.record(tx, { entity: 'proposal', entityId: id, action: 'member.add', diff: { after: { organisation: org.name, role: input.role } } });
    return this.get(tx, id);
  }

  async updateMember(tx: Tx, id: string, memberId: string, patch: z.infer<typeof memberPatch>) {
    const p = await this.row(tx, id); this.editable(p);
    const r = await tx.update(proposalMembers).set(patch).where(and(eq(proposalMembers.id, memberId), eq(proposalMembers.proposalId, id))).returning();
    if (!r.length) throw new NotFoundException('Član ne postoji na prijavi');
    await this.audit.record(tx, { entity: 'proposal', entityId: id, action: 'member.update', diff: { after: { memberId, ...patch } } });
    return this.get(tx, id);
  }

  async removeMember(tx: Tx, id: string, memberId: string) {
    const p = await this.row(tx, id); this.editable(p);
    const m = (await this.members(tx, id)).find((x) => x.m.id === memberId);
    if (!m) throw new NotFoundException('Član ne postoji na prijavi');
    if (m.org.isSelf) throw new ConflictException('Vlastita organizacija se ne uklanja s prijave');
    await tx.delete(proposalMembers).where(eq(proposalMembers.id, memberId));
    await this.audit.record(tx, { entity: 'proposal', entityId: id, action: 'member.remove', diff: { before: { organisation: m.org.name } } });
    return this.get(tx, id);
  }

  async addWorkPackage(tx: Tx, tenantId: string, id: string, input: z.infer<typeof wpInput>) {
    const p = await this.row(tx, id); this.editable(p);
    if (input.endMonth < input.startMonth || input.endMonth > p.durationMonths) throw new BadRequestException(`Mjeseci radnog paketa moraju biti unutar trajanja prijave (1–${p.durationMonths})`);
    if (input.leadMemberId && !(await this.members(tx, id)).some((x) => x.m.id === input.leadMemberId)) throw new NotFoundException('Voditelj radnog paketa nije član konzorcija');
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${proposalWorkPackages.number}), 0)::int + 1` }).from(proposalWorkPackages).where(eq(proposalWorkPackages.proposalId, id)) as [{ next: number }];
    await tx.insert(proposalWorkPackages).values({ tenantId, proposalId: id, number: next, ...input, leadMemberId: input.leadMemberId ?? null });
    return this.get(tx, id);
  }

  async removeWorkPackage(tx: Tx, id: string, wpId: string) {
    const p = await this.row(tx, id); this.editable(p);
    await tx.delete(proposalWorkPackages).where(and(eq(proposalWorkPackages.id, wpId), eq(proposalWorkPackages.proposalId, id)));
    return this.get(tx, id);
  }

  async replaceBudget(tx: Tx, tenantId: string, id: string, input: z.infer<typeof budgetInput>, _actorId?: string) {
    const p = await this.row(tx, id); this.editable(p);
    if (p.budgetLocked) throw new ConflictException(`Proračun v${p.budgetVersion} je zaključan – otključaj ga (nova verzija) za izmjene`);
    const pkg = await this.packages.get(tx, p.packageId, p.packageVersion);
    const ms = await this.members(tx, id);
    const issues = budgetLineIssues(pkg, input.lines.map((l) => ({ partnerId: l.memberId, categoryCode: l.categoryCode, amount: l.amount })), new Set(ms.map((x) => x.m.id)));
    if (issues.length) throw new BadRequestException({ message: 'Proračun nije valjan', issues: issues.map((i) => i.replace('partner', 'član konzorcija')) });
    await tx.delete(proposalBudgetLines).where(eq(proposalBudgetLines.proposalId, id));
    if (input.lines.length) await tx.insert(proposalBudgetLines).values(input.lines.filter((l) => l.amount > 0).map((l) => ({ tenantId, proposalId: id, memberId: l.memberId, categoryCode: l.categoryCode, amountCents: l.amount })));
    const after = await this.get(tx, id);
    await this.audit.record(tx, { entity: 'proposal', entityId: id, action: 'budget.replace', diff: { after: after.budget.totals, meta: { version: p.budgetVersion } } });
    return after;
  }

  async lockBudget(tx: Tx, id: string, lock: boolean, actorId?: string) {
    const p = await this.row(tx, id); this.editable(p);
    if (lock === p.budgetLocked) throw new ConflictException(lock ? 'Proračun je već zaključan' : 'Proračun nije zaključan');
    await tx.update(proposals).set({ budgetLocked: lock, budgetVersion: lock ? p.budgetVersion : p.budgetVersion + 1, updatedAt: new Date(), updatedBy: actorId }).where(eq(proposals.id, id));
    await this.audit.record(tx, { entity: 'proposal', entityId: id, action: lock ? 'budget.lock' : 'budget.unlock', diff: { meta: { version: lock ? p.budgetVersion : p.budgetVersion + 1 } } });
    return this.get(tx, id);
  }

  async transition(tx: Tx, id: string, to: ProposalStatus, actorId?: string) {
    const p = await this.row(tx, id);
    if (!PROPOSAL_TRANSITIONS[p.status as ProposalStatus].includes(to)) throw new ConflictException(`Prijelaz ${p.status} → ${to} nije dopušten`);
    await tx.update(proposals).set({ status: to, updatedAt: new Date(), updatedBy: actorId }).where(eq(proposals.id, id));
    await this.audit.record(tx, { entity: 'proposal', entityId: id, action: 'transition', diff: { before: { status: p.status }, after: { status: to } } });
    return this.get(tx, id);
  }

  /** Predaja: samo iz interne provjere i uz ispunjenu spremnost; snima proračun u trenutku predaje. */
  async submit(tx: Tx, id: string, input: z.infer<typeof submitInput>, actorId?: string) {
    const p = await this.row(tx, id);
    if (p.status !== 'internal_review') throw new ConflictException('Predaje se prijava koja je prošla internu provjeru');
    const d = await this.get(tx, id);
    if (!d.ready) throw new ConflictException({ message: 'Prijava nije spremna za predaju', issues: d.readiness.filter((r) => !r.ok).map((r) => r.label) });
    const submission = { portal: input.portal, reference: input.reference, at: input.submittedAt ?? new Date().toISOString(), by: actorId ?? null, budgetVersion: p.budgetVersion, requested: d.budget.totals.requested, total: d.budget.totals.total, lines: d.budget.lines };
    await tx.update(proposals).set({ status: 'submitted', submission, updatedAt: new Date(), updatedBy: actorId }).where(eq(proposals.id, id));
    await this.audit.record(tx, { entity: 'proposal', entityId: id, action: 'submit', diff: { after: { portal: input.portal, reference: input.reference, requested: submission.requested } } });
    return this.get(tx, id);
  }

  async setOutcome(tx: Tx, id: string, input: z.infer<typeof outcomeInput>, actorId?: string) {
    const p = await this.row(tx, id);
    if (!OUTCOME_FROM.includes(p.status as ProposalStatus)) throw new ConflictException('Ishod se upisuje za predanu prijavu');
    if (p.status === 'reserve' && input.result === 'reserve') throw new ConflictException('Prijava je već na rezervnoj listi');
    await tx.update(proposals).set({ status: input.result, outcome: { result: input.result, score: input.score, note: input.note, at: new Date().toISOString() }, updatedAt: new Date(), updatedBy: actorId }).where(eq(proposals.id, id));
    await this.audit.record(tx, { entity: 'proposal', entityId: id, action: `outcome.${input.result}`, diff: { after: input } });
    return this.get(tx, id);
  }

  /** Ugovaranje (ADR-0006): projekt s partnerima, radnim paketima i proračunom v1 (nacrt) kopiranim iz prijave; prijava postaje arhiv. */
  async contract(tx: Tx, tenantId: string, id: string, input: z.infer<typeof contractInput>, actorId?: string) {
    // Ruta traži projects:write na razini institucije; prijava je također podatak institucije (WP1.14).
    const ctx = currentContext();
    if (ctx && !canInTenant(ctx, 'proposals:read')) throw new ForbiddenException('Nedostaje dozvola proposals:read (na razini institucije)');
    const p = await this.row(tx, id);
    if (p.status !== 'funded') throw new ConflictException('Ugovara se samo financirana prijava');
    const d = await this.get(tx, id);
    const project = await this.projects.create(tx, tenantId, {
      acronym: p.acronym, title: p.title, packageId: p.packageId, packageVersion: p.packageVersion, actionType: p.actionType, role: p.role,
      durationMonths: p.durationMonths, ...(input.contractNo ? { contractNo: input.contractNo } : {}), ...(input.startDate ? { startDate: input.startDate } : {}),
      ...(p.leadUserId ? { managerUserId: p.leadUserId } : {}),
      partners: d.members.filter((m) => !m.isSelf).map((m) => ({ organisationId: m.organisationId, role: m.role, beneficiaryType: m.beneficiaryType })),
    }, actorId);
    const partnerOf = new Map(d.members.map((m) => [m.id, project.partners.find((x) => x.organisationId === m.organisationId)!.id]));
    for (const w of d.workPackages) {
      await tx.insert(workPackages).values({ tenantId, projectId: project.id, number: w.number, title: w.title, leadPartnerId: w.leadMemberId ? partnerOf.get(w.leadMemberId) ?? null : null, startMonth: w.startMonth, endMonth: w.endMonth, createdBy: actorId, updatedBy: actorId });
    }
    const [budget] = await tx.insert(projectBudgets).values({ tenantId, projectId: project.id, version: 1, createdBy: actorId, updatedBy: actorId }).returning();
    if (d.budget.lines.length) await tx.insert(budgetLines).values(d.budget.lines.map((l) => ({ tenantId, budgetId: budget!.id, partnerId: partnerOf.get(l.memberId)!, categoryCode: l.categoryCode, amountCents: l.amount, createdBy: actorId })));
    await tx.update(projects).set({ sourceProposalId: id }).where(eq(projects.id, project.id));
    await tx.update(proposals).set({ status: 'contracted', projectId: project.id, updatedAt: new Date(), updatedBy: actorId }).where(eq(proposals.id, id));
    await this.audit.record(tx, { entity: 'proposal', entityId: id, action: 'contract', diff: { after: { projectId: project.id, budgetTotal: d.budget.totals.total } } });
    return { proposal: await this.get(tx, id), projectId: project.id };
  }
}
