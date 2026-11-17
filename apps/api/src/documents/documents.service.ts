import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { checkUpload, DOCUMENT_KINDS, sanitizeFileName, type DocumentEntity } from '@arqus/domain';
import type { Tx } from '../db/db.service';
import { deliverables, documents, documentVersions, expenses, projects, proposals, reimbursementClaims, users, type DocumentRow } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { loadProject } from '../common/project-access';
import { TenantContext, type RequestContext } from '../common/tenant-context';
import { assertProjectPermission, canInTenant, canOnProject, canOnProposal, canSeeProposal } from '../common/access';

export const ENTITIES = ['project', 'expense', 'deliverable', 'claim', 'proposal'] as const;
export const uploadMeta = z.object({
  entityType: z.enum(ENTITIES), entityId: z.string().uuid(), title: z.string().trim().min(1).max(300).optional(),
  kind: z.enum(Object.keys(DOCUMENT_KINDS) as [string, ...string[]]).default('other'), confidentiality: z.enum(['public', 'internal', 'confidential']).default('internal'),
  aiGenerated: z.enum(['true', 'false']).optional(), note: z.string().max(500).optional(),
});
export const versionMeta = z.object({ note: z.string().max(500).optional() });
export const listQuery = z.object({ entityType: z.enum(ENTITIES).optional(), entityId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), proposalId: z.string().uuid().optional() });
export const docPatch = z.object({ title: z.string().trim().min(1).max(300).optional(), kind: z.enum(Object.keys(DOCUMENT_KINDS) as [string, ...string[]]).optional(), confidentiality: z.enum(['public', 'internal', 'confidential']).optional(), aiGenerated: z.boolean().optional() }).strict();

const FROZEN_EXPENSE: readonly string[] = ['claimed', 'accepted', 'partially_accepted', 'rejected'];
const CLOSED_PROJECT: readonly string[] = ['closed', 'terminated', 'archived'];
const CLOSED_PROPOSAL: readonly string[] = ['contracted', 'withdrawn', 'rejected'];

export interface UploadedFile { originalname: string; size: number; buffer: Buffer }
interface Owner { projectId: string | null; proposalId: string | null; frozen: string | null }
type Op = 'read' | 'write';
type Scope = { projectId: string | null; proposalId: string | null };

/**
 * M9: dokumenti s verzijama vezani uz projekt, trošak (dokaz), isporuku, ZNS ili prijavu. Sadržaj u DocumentStorage, metapodaci i hash u bazi.
 * Pristup (WP1.14): projekt u putanji ne postoji, pa se za svaki zahtjev razrješava vlasnik (projekt ili prijava) i provjerava
 * dozvola upravo na tom projektu; bez pristupa → 404 s istom porukom kao za nepostojeći entitet. Povjerljivi dokumenti
 * (`confidential`) vidljivi su samo uz `documents:confidential` na tom opsegu – inače ih nema ni u popisu ni u brojanju.
 */
@Injectable()
export class DocumentsService {
  constructor(private readonly audit: AuditService, private readonly ctx: TenantContext) {}

  /**
   * Projekt: dozvola na projektu. Prijava: documents:* i proposals:* na razini institucije ili voditelj te prijave
   * (WP1.14b – voditelj čita i prilaže dokumente vlastite prijave; povjerljive samo uz dozvolu institucije).
   */
  private authorize(c: RequestContext, scope: Scope, op: Op, notFound: string): void {
    if (scope.projectId) return assertProjectPermission(c, scope.projectId, op === 'read' ? 'documents:read' : 'documents:write', notFound);
    const proposalId = scope.proposalId ?? '';
    if (!canSeeProposal(c, proposalId)) throw new NotFoundException(notFound);
    const ok = op === 'read' ? canOnProposal(c, 'documents:read', proposalId) : canOnProposal(c, 'documents:write', proposalId) && canOnProposal(c, 'proposals:write', proposalId);
    if (!ok) throw new ForbiddenException(`Nedostaje dozvola za ${op === 'read' ? 'čitanje' : 'izmjenu'} dokumenata prijave`);
  }

  private canConfidential(c: RequestContext, scope: Scope): boolean {
    return scope.projectId ? canOnProject(c, 'documents:confidential', scope.projectId) : canInTenant(c, 'documents:confidential');
  }

  private assertMayMarkConfidential(c: RequestContext, scope: Scope, confidentiality: string | undefined): void {
    if (confidentiality === 'confidential' && !this.canConfidential(c, scope)) throw new ForbiddenException('Povjerljive dokumente označava samo uloga s dozvolom documents:confidential');
  }

  /**
   * Vlasnik entiteta (projekt ili prijava) pod RLS-om, s provjerom pristupa PRIJE bilo kakve druge informacije;
   * `frozen` = razlog zašto se dokumenti više ne mijenjaju.
   */
  private async owner(tx: Tx, type: DocumentEntity, id: string, op: Op): Promise<Owner> {
    const c = this.ctx.require();
    const closed = async (projectId: string) => { const p = await loadProject(tx, projectId); return CLOSED_PROJECT.includes(p.status) ? `projekt je u statusu "${p.status}"` : null; };
    const ofProject = async (projectId: string, notFound: string, frozen?: string | null): Promise<Owner> => {
      this.authorize(c, { projectId, proposalId: null }, op, notFound);
      return { projectId, proposalId: null, frozen: frozen ?? (await closed(projectId)) };
    };
    switch (type) {
      case 'project': return ofProject(id, `Projekt ${id} ne postoji`);
      case 'expense': {
        const e = (await tx.select({ projectId: expenses.projectId, status: expenses.status }).from(expenses).where(eq(expenses.id, id)))[0];
        if (!e) throw new NotFoundException('Trošak ne postoji');
        return ofProject(e.projectId, 'Trošak ne postoji', FROZEN_EXPENSE.includes(e.status) ? 'trošak je u zahtjevu za nadoknadu – dokazi su zamrznuti' : null);
      }
      case 'deliverable': {
        const d = (await tx.select({ projectId: deliverables.projectId }).from(deliverables).where(eq(deliverables.id, id)))[0];
        if (!d) throw new NotFoundException('Isporuka ne postoji');
        return ofProject(d.projectId, 'Isporuka ne postoji');
      }
      case 'claim': {
        const r = (await tx.select({ projectId: reimbursementClaims.projectId }).from(reimbursementClaims).where(eq(reimbursementClaims.id, id)))[0];
        if (!r) throw new NotFoundException('Zahtjev za nadoknadu ne postoji');
        return ofProject(r.projectId, 'Zahtjev za nadoknadu ne postoji');
      }
      case 'proposal': {
        const p = (await tx.select({ id: proposals.id, status: proposals.status }).from(proposals).where(and(eq(proposals.id, id), isNull(proposals.deletedAt))))[0];
        if (!p) throw new NotFoundException('Prijava ne postoji');
        this.authorize(c, { projectId: null, proposalId: p.id }, op, 'Prijava ne postoji');
        return { projectId: null, proposalId: p.id, frozen: CLOSED_PROPOSAL.includes(p.status) ? 'prijava je zaključena' : null };
      }
    }
  }

  /** Dokument s provjerom pristupa vlasniku i povjerljivosti; bez pristupa 404 kao da ne postoji. */
  private async row(tx: Tx, id: string, op: Op): Promise<DocumentRow> {
    const d = (await tx.select().from(documents).where(and(eq(documents.id, id), isNull(documents.deletedAt))))[0];
    const notFound = `Dokument ${id} ne postoji`;
    if (!d) throw new NotFoundException(notFound);
    const c = this.ctx.require();
    this.authorize(c, d, op, notFound);
    if (d.confidentiality === 'confidential' && !this.canConfidential(c, d)) throw new NotFoundException(notFound);
    return d;
  }

  /** Provjera i hash prije pohrane; baca 400 s razlogom. */
  inspect(file: UploadedFile | undefined): { fileName: string; mime: string; sha256: string } {
    if (!file) throw new BadRequestException('Nedostaje datoteka (polje "file")');
    const fileName = sanitizeFileName(Buffer.from(file.originalname, 'latin1').toString('utf8'));
    const r = checkUpload(fileName, file.size, file.buffer.subarray(0, 4096));
    if (!r.ok) throw new BadRequestException(r.error);
    return { fileName, mime: r.mime, sha256: createHash('sha256').update(file.buffer).digest('hex') };
  }

  async list(tx: Tx, q: z.infer<typeof listQuery>) {
    if (!q.projectId && !q.proposalId && !(q.entityType && q.entityId)) throw new BadRequestException('Navedi projectId, proposalId ili entityType + entityId');
    // Svaki navedeni opseg mora biti dopušten (uvjeti se zbrajaju, ali tuđi id u upitu nikad ne prolazi tiho).
    const c = this.ctx.require();
    if (q.projectId) this.authorize(c, { projectId: q.projectId, proposalId: null }, 'read', `Projekt ${q.projectId} ne postoji`);
    if (q.proposalId) {
      const exists = (await tx.select({ id: proposals.id }).from(proposals).where(and(eq(proposals.id, q.proposalId), isNull(proposals.deletedAt)))).length;
      if (!exists) throw new NotFoundException('Prijava ne postoji');
      this.authorize(c, { projectId: null, proposalId: q.proposalId }, 'read', 'Prijava ne postoji');
    }
    if (q.entityType && q.entityId) await this.owner(tx, q.entityType, q.entityId, 'read');
    const conds = [isNull(documents.deletedAt)];
    if (q.projectId) conds.push(eq(documents.projectId, q.projectId));
    if (q.proposalId) conds.push(eq(documents.proposalId, q.proposalId));
    if (q.entityType) conds.push(eq(documents.entityType, q.entityType));
    if (q.entityId) conds.push(eq(documents.entityId, q.entityId));
    const docs = (await tx.select().from(documents).where(and(...conds)).orderBy(desc(documents.updatedAt)))
      .filter((d) => d.confidentiality !== 'confidential' || this.canConfidential(c, d));
    if (!docs.length) return [];
    const vers = await tx.select().from(documentVersions).where(inArray(documentVersions.documentId, docs.map((d) => d.id)));
    const frozen = await this.frozenReasons(tx, docs);
    return docs.map((d) => {
      const v = vers.find((x) => x.documentId === d.id && x.version === d.currentVersion)!;
      return { ...this.view(d), frozen: frozen.get(d.id) ?? null, current: { version: v.version, fileName: v.fileName, mimeType: v.mimeType, size: v.sizeBytes, sha256: v.sha256, createdAt: v.createdAt } };
    });
  }

  /**
   * WP1.14b: razlog zbog kojeg se dokument više ne mijenja (ista pravila kao `owner().frozen`), da sučelje ne nudi radnje koje
   * bi poslužitelj odbio (uklanjanje dokaza troška u predanom ZNS-u, izmjene na zatvorenom projektu ili zaključenoj prijavi).
   */
  private async frozenReasons(tx: Tx, docs: DocumentRow[]): Promise<Map<string, string | null>> {
    const expenseIds = docs.filter((d) => d.entityType === 'expense').map((d) => d.entityId);
    const projectIds = [...new Set(docs.map((d) => d.projectId).filter((x): x is string => !!x))];
    const proposalIds = [...new Set(docs.map((d) => d.proposalId).filter((x): x is string => !!x))];
    const ex = expenseIds.length ? new Map((await tx.select({ id: expenses.id, status: expenses.status }).from(expenses).where(inArray(expenses.id, expenseIds))).map((r) => [r.id, r.status])) : new Map<string, string>();
    const pr = projectIds.length ? new Map((await tx.select({ id: projects.id, status: projects.status }).from(projects).where(inArray(projects.id, projectIds))).map((r) => [r.id, r.status])) : new Map<string, string>();
    const po = proposalIds.length ? new Map((await tx.select({ id: proposals.id, status: proposals.status }).from(proposals).where(inArray(proposals.id, proposalIds))).map((r) => [r.id, r.status])) : new Map<string, string>();
    return new Map(docs.map((d) => {
      const e = d.entityType === 'expense' ? ex.get(d.entityId) : undefined;
      const p = d.projectId ? pr.get(d.projectId) : undefined;
      const q = d.proposalId ? po.get(d.proposalId) : undefined;
      const reason = e && FROZEN_EXPENSE.includes(e) ? 'trošak je u zahtjevu za nadoknadu – dokazi su zamrznuti'
        : p && CLOSED_PROJECT.includes(p) ? `projekt je u statusu "${p}"`
        : q && CLOSED_PROPOSAL.includes(q) ? 'prijava je zaključena' : null;
      return [d.id, reason];
    }));
  }

  private view(d: DocumentRow) {
    return { id: d.id, title: d.title, kind: d.kind, confidentiality: d.confidentiality, aiGenerated: d.aiGenerated, entityType: d.entityType, entityId: d.entityId, projectId: d.projectId, proposalId: d.proposalId, currentVersion: d.currentVersion, updatedAt: d.updatedAt };
  }

  async get(tx: Tx, id: string) {
    const d = await this.row(tx, id, 'read');
    const vers = await tx.select({ v: documentVersions, by: users.displayName }).from(documentVersions).leftJoin(users, eq(users.id, documentVersions.createdBy))
      .where(eq(documentVersions.documentId, id)).orderBy(desc(documentVersions.version));
    const frozen = (await this.frozenReasons(tx, [d])).get(d.id) ?? null;
    return { ...this.view(d), frozen, versions: vers.map(({ v, by }) => ({ version: v.version, fileName: v.fileName, mimeType: v.mimeType, size: v.sizeBytes, sha256: v.sha256, note: v.note, createdAt: v.createdAt, createdBy: by })) };
  }

  async create(tx: Tx, tenantId: string, meta: z.infer<typeof uploadMeta>, file: { fileName: string; mime: string; sha256: string; size: number; storageKey: string }, actorId?: string) {
    const o = await this.owner(tx, meta.entityType, meta.entityId, 'write');
    this.assertMayMarkConfidential(this.ctx.require(), o, meta.confidentiality);
    if (o.frozen) throw new ConflictException(`Dokument se ne može dodati: ${o.frozen}`);
    const [d] = await tx.insert(documents).values({
      tenantId, projectId: o.projectId, proposalId: o.proposalId, entityType: meta.entityType, entityId: meta.entityId, title: meta.title ?? file.fileName.replace(/\.[^.]+$/, ''),
      kind: meta.kind, confidentiality: meta.confidentiality, aiGenerated: meta.aiGenerated === 'true', createdBy: actorId, updatedBy: actorId,
    }).returning();
    await tx.insert(documentVersions).values({ tenantId, documentId: d!.id, version: 1, storageKey: file.storageKey, fileName: file.fileName, mimeType: file.mime, sizeBytes: file.size, sha256: file.sha256, note: meta.note ?? null, createdBy: actorId });
    await this.audit.record(tx, { entity: 'document', entityId: d!.id, action: 'create', diff: { after: { title: d!.title, entityType: meta.entityType, entityId: meta.entityId, fileName: file.fileName, sha256: file.sha256 } } });
    return this.get(tx, d!.id);
  }

  async addVersion(tx: Tx, tenantId: string, id: string, note: string | undefined, file: { fileName: string; mime: string; sha256: string; size: number; storageKey: string }, actorId?: string) {
    const d = await this.row(tx, id, 'write');
    const o = await this.owner(tx, d.entityType, d.entityId, 'write');
    if (o.frozen) throw new ConflictException(`Nova verzija nije moguća: ${o.frozen}`);
    const last = (await tx.select().from(documentVersions).where(eq(documentVersions.documentId, id)).orderBy(desc(documentVersions.version)).limit(1))[0]!;
    if (last.sha256 === file.sha256) throw new ConflictException('Datoteka je jednaka trenutnoj verziji');
    const version = d.currentVersion + 1;
    await tx.insert(documentVersions).values({ tenantId, documentId: id, version, storageKey: file.storageKey, fileName: file.fileName, mimeType: file.mime, sizeBytes: file.size, sha256: file.sha256, note: note ?? null, createdBy: actorId });
    await tx.update(documents).set({ currentVersion: version, updatedAt: new Date(), updatedBy: actorId }).where(eq(documents.id, id));
    await this.audit.record(tx, { entity: 'document', entityId: id, action: 'version.add', diff: { after: { version, fileName: file.fileName, sha256: file.sha256 } } });
    return this.get(tx, id);
  }

  async update(tx: Tx, id: string, patch: z.infer<typeof docPatch>, actorId?: string) {
    const d = await this.row(tx, id, 'write');
    const o = await this.owner(tx, d.entityType, d.entityId, 'write');
    this.assertMayMarkConfidential(this.ctx.require(), o, patch.confidentiality);
    if (o.frozen) throw new ConflictException(`Dokument se ne mijenja: ${o.frozen}`);
    await tx.update(documents).set({ ...patch, updatedAt: new Date(), updatedBy: actorId }).where(eq(documents.id, id));
    await this.audit.record(tx, { entity: 'document', entityId: id, action: 'update', diff: { before: { title: d.title, kind: d.kind, confidentiality: d.confidentiality }, after: patch } });
    return this.get(tx, id);
  }

  /** Logičko brisanje; sadržaj i verzije ostaju radi revizijskog traga. */
  async remove(tx: Tx, id: string, actorId?: string) {
    const d = await this.row(tx, id, 'write');
    const o = await this.owner(tx, d.entityType, d.entityId, 'write');
    if (o.frozen) throw new ConflictException(`Dokument se ne briše: ${o.frozen}`);
    await tx.update(documents).set({ deletedAt: new Date(), updatedBy: actorId }).where(eq(documents.id, id));
    await this.audit.record(tx, { entity: 'document', entityId: id, action: 'delete', diff: { before: { title: d.title } } });
    return { ok: true };
  }

  /** Verzija za preuzimanje (zadano trenutna); preuzimanje se bilježi u reviziju. */
  async version(tx: Tx, id: string, version?: number) {
    const d = await this.row(tx, id, 'read');
    const n = version ?? d.currentVersion;
    const v = (await tx.select().from(documentVersions).where(and(eq(documentVersions.documentId, id), eq(documentVersions.version, n))))[0];
    if (!v) throw new NotFoundException(`Verzija ${n} ne postoji`);
    await this.audit.record(tx, { entity: 'document', entityId: id, action: 'download', diff: { meta: { version: n } } });
    return v;
  }

  /** Broj aktivnih dokumenata po entitetu (za oznaku „dokaz priložen”); povjerljivi se broje samo uz `includeConfidential`. */
  async counts(tx: Tx, type: DocumentEntity, ids: string[], includeConfidential = false): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await tx.select({ id: documents.entityId, n: sql<number>`count(*)::int` }).from(documents)
      .where(and(eq(documents.entityType, type), inArray(documents.entityId, ids), isNull(documents.deletedAt), includeConfidential ? undefined : ne(documents.confidentiality, 'confidential'))).groupBy(documents.entityId);
    return new Map(rows.map((r) => [r.id, r.n]));
  }
}
