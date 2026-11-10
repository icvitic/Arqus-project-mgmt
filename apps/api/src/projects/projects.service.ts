import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { generateReportingPeriods, transitionIssues, type ProjectStatus, type ProgrammePackage } from '@arqus/domain';
import type { Tx } from '../db/db.service';
import { organisations, projectBudgets, projectPartners, projects, reportingPeriods, users, type Organisation, type Project } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { OrganisationsService } from '../organisations/organisations.service';
import { ProgrammePackagesService } from '../programmes/programme-packages.service';

const PARTNER_ROLES = ['coordinator', 'partner', 'associated', 'third_party'] as const;
const STATUSES = ['contracting', 'active', 'suspended', 'closing', 'closed', 'terminated', 'archived'] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'datum u obliku GGGG-MM-DD');

const partnerInput = z.object({
  organisationId: z.string().uuid(),
  role: z.enum(PARTNER_ROLES).default('partner'),
  beneficiaryType: z.string().min(1).max(40).optional(),
});
export const projectInput = z.object({
  acronym: z.string().trim().min(2).max(40),
  title: z.string().trim().min(3).max(500),
  packageId: z.string().min(1),
  packageVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  actionType: z.string().min(1),
  role: z.enum(['coordinator', 'partner']).default('coordinator'),
  contractNo: z.string().trim().min(1).max(60).optional(),
  startDate: isoDate.optional(),
  durationMonths: z.number().int().min(1).max(120).optional(),
  managerUserId: z.string().uuid().optional(),
  partners: z.array(partnerInput).max(100).default([]),
});
export const projectPatch = z.object({
  title: z.string().trim().min(3).max(500).optional(),
  contractNo: z.string().trim().min(1).max(60).nullable().optional(),
  startDate: isoDate.nullable().optional(),
  durationMonths: z.number().int().min(1).max(120).nullable().optional(),
  managerUserId: z.string().uuid().nullable().optional(),
}).strict();
export const partnerAdd = partnerInput;
export const transitionInput = z.object({ to: z.enum(STATUSES) });
export type ProjectInput = z.infer<typeof projectInput>;
export type ProjectPatch = z.infer<typeof projectPatch>;
export type PartnerInput = z.infer<typeof partnerInput>;

const projectView = (p: Project) => ({
  id: p.id, acronym: p.acronym, title: p.title, status: p.status, role: p.role, actionType: p.actionType,
  package: { rowId: p.packageRowId, id: p.packageId, version: p.packageVersion },
  contractNo: p.contractNo, startDate: p.startDate, durationMonths: p.durationMonths, managerUserId: p.managerUserId,
  sourceProposalId: p.sourceProposalId, activatedAt: p.activatedAt, createdAt: p.createdAt, updatedAt: p.updatedAt,
});

/** M6 Projekt: stvaranje (izravni unos; ugovaranje iz prijave dolazi s M5), partneri, prijelazi statusa, izvještajna razdoblja. */
@Injectable()
export class ProjectsService {
  constructor(private readonly audit: AuditService, private readonly orgs: OrganisationsService, private readonly packages: ProgrammePackagesService) {}

  async list(tx: Tx) {
    const rows = await tx.select({ p: projects, partnerCount: sql<number>`(select count(*)::int from project_partners pp where pp.project_id = ${projects.id})` })
      .from(projects).where(isNull(projects.deletedAt)).orderBy(desc(projects.createdAt));
    return rows.map((r) => ({ ...projectView(r.p), partnerCount: r.partnerCount }));
  }

  private async getRow(tx: Tx, id: string): Promise<Project> {
    const row = (await tx.select().from(projects).where(and(eq(projects.id, id), isNull(projects.deletedAt))))[0];
    if (!row) throw new NotFoundException(`Projekt ${id} ne postoji`);
    return row;
  }

  async get(tx: Tx, id: string) {
    const p = await this.getRow(tx, id);
    const partners = await tx.select({ pp: projectPartners, org: organisations }).from(projectPartners)
      .innerJoin(organisations, eq(organisations.id, projectPartners.organisationId))
      .where(eq(projectPartners.projectId, id)).orderBy(asc(projectPartners.orderNo));
    const periods = await tx.select().from(reportingPeriods).where(eq(reportingPeriods.projectId, id)).orderBy(asc(reportingPeriods.number));
    return {
      ...projectView(p),
      partners: partners.map(({ pp, org }) => ({ id: pp.id, organisationId: org.id, name: org.name, country: org.country, isSelf: org.isSelf, role: pp.role, beneficiaryType: pp.beneficiaryType, orderNo: pp.orderNo })),
      reportingPeriods: periods.map((r) => ({ number: r.number, startDate: r.startDate, endDate: r.endDate, dueDate: r.dueDate })),
    };
  }

  /** Paket mora biti vidljiv stanaru (globalni ili vlastiti) i ne smije biti zastario; vrsta akcije mora postojati u paketu. */
  private async resolvePackage(tx: Tx, packageId: string, version: string | undefined, actionType: string) {
    const pkg = await this.packages.get(tx, packageId, version);
    if (pkg._row.status === 'deprecated') throw new BadRequestException(`Paket ${packageId} v${pkg._row.version} je zastario`);
    const action = pkg.actionTypes.find((a) => a.code === actionType);
    if (!action) throw new BadRequestException(`Vrsta akcije "${actionType}" ne postoji u paketu ${packageId} (dostupno: ${pkg.actionTypes.map((a) => a.code).join(', ')})`);
    return { pkg, action };
  }

  private beneficiaryTypeFor(pkg: ProgrammePackage, actionType: string, org: Organisation, requested?: string): string {
    const action = pkg.actionTypes.find((a) => a.code === actionType)!;
    const allowed = new Set(['default', ...action.fundingRates.map((r) => r.beneficiaryType)]);
    if (requested) {
      if (!allowed.has(requested)) throw new BadRequestException(`Vrsta korisnika "${requested}" ne postoji za akciju ${actionType} (dostupno: ${[...allowed].join(', ')})`);
      return requested;
    }
    return org.nonProfit && allowed.has('nonProfit') ? 'nonProfit' : 'default';
  }

  private async assertManager(tx: Tx, userId: string | null | undefined): Promise<void> {
    if (!userId) return;
    const u = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!u.length) throw new NotFoundException(`Korisnik ${userId} ne postoji`);
  }

  private async assertContractNoFree(tx: Tx, contractNo: string | null | undefined, exceptId?: string): Promise<void> {
    if (!contractNo) return;
    const dup = await tx.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.contractNo, contractNo), exceptId ? ne(projects.id, exceptId) : undefined));
    if (dup.length) throw new ConflictException(`Broj ugovora ${contractNo} već je upisan na drugom projektu`);
  }

  async create(tx: Tx, tenantId: string, input: ProjectInput, actorId?: string) {
    const { pkg } = await this.resolvePackage(tx, input.packageId, input.packageVersion, input.actionType);
    await this.assertManager(tx, input.managerUserId);
    await this.assertContractNoFree(tx, input.contractNo);
    const self = await this.orgs.ensureSelf(tx, tenantId);
    const [p] = await tx.insert(projects).values({
      tenantId, acronym: input.acronym, title: input.title, packageRowId: pkg._row.id, packageId: pkg._row.packageId, packageVersion: pkg._row.version,
      actionType: input.actionType, role: input.role, contractNo: input.contractNo ?? null, startDate: input.startDate ?? null,
      durationMonths: input.durationMonths ?? null, managerUserId: input.managerUserId ?? null, createdBy: actorId, updatedBy: actorId,
    }).returning();
    const project = p!;
    await tx.insert(projectPartners).values({
      tenantId, projectId: project.id, organisationId: self.id, role: input.role === 'coordinator' ? 'coordinator' : 'partner',
      beneficiaryType: this.beneficiaryTypeFor(pkg, input.actionType, self), orderNo: input.role === 'coordinator' ? 1 : 2, createdBy: actorId,
    });
    for (const partner of input.partners.filter((x) => x.organisationId !== self.id)) await this.insertPartner(tx, tenantId, project, pkg, partner, actorId);
    await this.audit.record(tx, { entity: 'project', entityId: project.id, action: 'create', diff: { after: projectView(project), meta: { partners: input.partners.length + 1 } } });
    return this.get(tx, project.id);
  }

  private async insertPartner(tx: Tx, tenantId: string, project: Project, pkg: ProgrammePackage, input: PartnerInput, actorId?: string) {
    const org = await this.orgs.getRow(tx, input.organisationId); // 404 za tuđu organizaciju
    const exists = await tx.select({ id: projectPartners.id }).from(projectPartners)
      .where(and(eq(projectPartners.projectId, project.id), eq(projectPartners.organisationId, org.id)));
    if (exists.length) throw new ConflictException(`${org.name} je već partner na projektu`);
    if (input.role === 'coordinator') {
      const coord = await tx.select({ id: projectPartners.id }).from(projectPartners).where(and(eq(projectPartners.projectId, project.id), eq(projectPartners.role, 'coordinator')));
      if (coord.length) throw new ConflictException('Projekt već ima koordinatora');
    }
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${projectPartners.orderNo}), 0)::int + 1` }).from(projectPartners).where(eq(projectPartners.projectId, project.id)) as [{ next: number }];
    const [row] = await tx.insert(projectPartners).values({
      tenantId, projectId: project.id, organisationId: org.id, role: input.role,
      beneficiaryType: this.beneficiaryTypeFor(pkg, project.actionType, org, input.beneficiaryType), orderNo: input.role === 'coordinator' ? 1 : next, createdBy: actorId,
    }).returning();
    return row!;
  }

  async addPartner(tx: Tx, tenantId: string, projectId: string, input: PartnerInput, actorId?: string) {
    const project = await this.getRow(tx, projectId);
    if (project.status !== 'contracting') throw new ConflictException('Partneri se mijenjaju samo u ugovaranju; kasnije kroz amandman');
    const { pkg } = await this.resolvePackage(tx, project.packageId, project.packageVersion, project.actionType);
    const row = await this.insertPartner(tx, tenantId, project, pkg, input, actorId);
    await this.audit.record(tx, { entity: 'project', entityId: projectId, action: 'partner.add', diff: { after: row } });
    return this.get(tx, projectId);
  }

  async removePartner(tx: Tx, projectId: string, partnerId: string) {
    const project = await this.getRow(tx, projectId);
    if (project.status !== 'contracting') throw new ConflictException('Partneri se mijenjaju samo u ugovaranju; kasnije kroz amandman');
    const row = (await tx.select({ pp: projectPartners, org: organisations }).from(projectPartners)
      .innerJoin(organisations, eq(organisations.id, projectPartners.organisationId))
      .where(and(eq(projectPartners.id, partnerId), eq(projectPartners.projectId, projectId))))[0];
    if (!row) throw new NotFoundException('Partner ne postoji na projektu');
    if (row.org.isSelf) throw new ConflictException('Vlastita organizacija ne može se ukloniti s projekta');
    await tx.delete(projectPartners).where(eq(projectPartners.id, partnerId));
    await this.audit.record(tx, { entity: 'project', entityId: projectId, action: 'partner.remove', diff: { before: row.pp } });
    return this.get(tx, projectId);
  }

  async update(tx: Tx, id: string, patch: ProjectPatch, actorId?: string) {
    const before = await this.getRow(tx, id);
    const terminal = ['closed', 'terminated', 'archived'].includes(before.status);
    if (terminal) throw new ConflictException(`Projekt u statusu "${before.status}" se ne mijenja`);
    if (before.status !== 'contracting' && (patch.startDate !== undefined || patch.durationMonths !== undefined)) {
      throw new ConflictException('Početak i trajanje mijenjaju se nakon aktivacije samo amandmanom');
    }
    await this.assertManager(tx, patch.managerUserId);
    await this.assertContractNoFree(tx, patch.contractNo, id);
    const [after] = await tx.update(projects).set({ ...patch, updatedAt: new Date(), updatedBy: actorId }).where(eq(projects.id, id)).returning();
    await this.audit.record(tx, { entity: 'project', entityId: id, action: 'update', diff: { before: projectView(before), after: projectView(after!) } });
    return this.get(tx, id);
  }

  async transition(tx: Tx, tenantId: string, id: string, to: ProjectStatus, actorId?: string) {
    const p = await this.getRow(tx, id);
    const pkg = await this.packages.get(tx, p.packageId, p.packageVersion);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(projectPartners).where(eq(projectPartners.projectId, id)) as [{ n: number }];
    const issues = transitionIssues(p.status, to, { contractNo: p.contractNo, startDate: p.startDate, durationMonths: p.durationMonths, packageStatus: pkg._row.status, partnerCount: n });
    if (issues.length) throw new ConflictException({ message: 'Prijelaz statusa nije moguć', issues });
    const set: Partial<Project> = { status: to, updatedAt: new Date(), updatedBy: actorId ?? null };
    if (p.status === 'contracting' && to === 'active') {
      const plan = generateReportingPeriods(p.startDate!, p.durationMonths!, pkg.reporting.periodMonths, pkg.reporting.submissionDeadlineDays);
      await tx.insert(reportingPeriods).values(plan.map((r) => ({ tenantId, projectId: id, ...r })));
      // Ugovoreni proračun v1 zaključava se aktivacijom; kasnije verzije samo amandmanom.
      await tx.update(projectBudgets).set({ status: 'locked', lockedAt: new Date(), updatedAt: new Date(), updatedBy: actorId ?? null }).where(and(eq(projectBudgets.projectId, id), eq(projectBudgets.status, 'draft')));
      set.activatedAt = new Date();
    }
    await tx.update(projects).set(set).where(eq(projects.id, id));
    await this.audit.record(tx, { entity: 'project', entityId: id, action: 'transition', diff: { before: { status: p.status }, after: { status: to } } });
    return this.get(tx, id);
  }
}
