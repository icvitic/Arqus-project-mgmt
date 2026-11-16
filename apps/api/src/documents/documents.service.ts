import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { checkUpload, DOCUMENT_KINDS, sanitizeFileName, type DocumentEntity } from '@arqus/domain';
import type { Tx } from '../db/db.service';
import { deliverables, documents, documentVersions, expenses, proposals, reimbursementClaims, users, type DocumentRow } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { loadProject } from '../common/project-access';

export const ENTITIES = ['project', 'expense', 'deliverable', 'claim', 'proposal'] as const;
export const uploadMeta = z.object({
  entityType: z.enum(ENTITIES), entityId: z.string().uuid(), title: z.string().trim().min(1).max(300).optional(),
  kind: z.enum(Object.keys(DOCUMENT_KINDS) as [string, ...string[]]).default('other'), confidentiality: z.enum(['public', 'internal', 'confidential']).default('internal'),
  aiGenerated: z.enum(['true', 'false']).optional(), note: z.string().max(500).optional(),
});
export const versionMeta = z.object({ note: z.string().max(500).optional() });
export const listQuery = z.object({ entityType: z.enum(ENTITIES).optional(), entityId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), proposalId: z.string().uuid().optional() });
export const docPatch = z.object({ title: z.string().trim().min(1).max(300).optional(), kind: z.enum(Object.keys(DOCUMENT_KINDS) as [string, ...string[]]).optional(), confidentiality: z.enum(['public', 'internal', 'confidential']).optional(), aiGenerated: z.boolean().optional() }).strict();

export interface UploadedFile { originalname: string; size: number; buffer: Buffer }
interface Owner { projectId: string | null; proposalId: string | null; frozen: string | null }

/** M9: dokumenti s verzijama vezani uz projekt, trošak (dokaz), isporuku, ZNS ili prijavu. Sadržaj u DocumentStorage, metapodaci i hash u bazi. */
@Injectable()
export class DocumentsService {
  constructor(private readonly audit: AuditService) {}

  /** Vlasnik entiteta (projekt ili prijava) pod RLS-om; `frozen` = razlog zašto se dokumenti više ne mijenjaju. */
  private async owner(tx: Tx, type: DocumentEntity, id: string): Promise<Owner> {
    const closed = async (projectId: string) => { const p = await loadProject(tx, projectId); return ['closed', 'terminated', 'archived'].includes(p.status) ? `projekt je u statusu "${p.status}"` : null; };
    switch (type) {
      case 'project': return { projectId: id, proposalId: null, frozen: await closed(id) };
      case 'expense': {
        const e = (await tx.select({ projectId: expenses.projectId, status: expenses.status }).from(expenses).where(eq(expenses.id, id)))[0];
        if (!e) throw new NotFoundException('Trošak ne postoji');
        return { projectId: e.projectId, proposalId: null, frozen: ['claimed', 'accepted'].includes(e.status) ? 'trošak je u zahtjevu za nadoknadu – dokazi su zamrznuti' : await closed(e.projectId) };
      }
      case 'deliverable': {
        const d = (await tx.select({ projectId: deliverables.projectId }).from(deliverables).where(eq(deliverables.id, id)))[0];
        if (!d) throw new NotFoundException('Isporuka ne postoji');
        return { projectId: d.projectId, proposalId: null, frozen: await closed(d.projectId) };
      }
      case 'claim': {
        const c = (await tx.select({ projectId: reimbursementClaims.projectId }).from(reimbursementClaims).where(eq(reimbursementClaims.id, id)))[0];
        if (!c) throw new NotFoundException('Zahtjev za nadoknadu ne postoji');
        return { projectId: c.projectId, proposalId: null, frozen: await closed(c.projectId) };
      }
      case 'proposal': {
        const p = (await tx.select({ id: proposals.id, status: proposals.status }).from(proposals).where(and(eq(proposals.id, id), isNull(proposals.deletedAt))))[0];
        if (!p) throw new NotFoundException('Prijava ne postoji');
        return { projectId: null, proposalId: p.id, frozen: ['contracted', 'withdrawn', 'rejected'].includes(p.status) ? 'prijava je zaključena' : null };
      }
    }
  }

  private async row(tx: Tx, id: string): Promise<DocumentRow> {
    const d = (await tx.select().from(documents).where(and(eq(documents.id, id), isNull(documents.deletedAt))))[0];
    if (!d) throw new NotFoundException(`Dokument ${id} ne postoji`);
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
    const conds = [isNull(documents.deletedAt)];
    if (q.projectId) conds.push(eq(documents.projectId, q.projectId));
    if (q.proposalId) conds.push(eq(documents.proposalId, q.proposalId));
    if (q.entityType) conds.push(eq(documents.entityType, q.entityType));
    if (q.entityId) conds.push(eq(documents.entityId, q.entityId));
    const docs = await tx.select().from(documents).where(and(...conds)).orderBy(desc(documents.updatedAt));
    if (!docs.length) return [];
    const vers = await tx.select().from(documentVersions).where(inArray(documentVersions.documentId, docs.map((d) => d.id)));
    return docs.map((d) => {
      const v = vers.find((x) => x.documentId === d.id && x.version === d.currentVersion)!;
      return { ...this.view(d), current: { version: v.version, fileName: v.fileName, mimeType: v.mimeType, size: v.sizeBytes, sha256: v.sha256, createdAt: v.createdAt } };
    });
  }

  private view(d: DocumentRow) {
    return { id: d.id, title: d.title, kind: d.kind, confidentiality: d.confidentiality, aiGenerated: d.aiGenerated, entityType: d.entityType, entityId: d.entityId, projectId: d.projectId, proposalId: d.proposalId, currentVersion: d.currentVersion, updatedAt: d.updatedAt };
  }

  async get(tx: Tx, id: string) {
    const d = await this.row(tx, id);
    const vers = await tx.select({ v: documentVersions, by: users.displayName }).from(documentVersions).leftJoin(users, eq(users.id, documentVersions.createdBy))
      .where(eq(documentVersions.documentId, id)).orderBy(desc(documentVersions.version));
    return { ...this.view(d), versions: vers.map(({ v, by }) => ({ version: v.version, fileName: v.fileName, mimeType: v.mimeType, size: v.sizeBytes, sha256: v.sha256, note: v.note, createdAt: v.createdAt, createdBy: by })) };
  }

  async create(tx: Tx, tenantId: string, meta: z.infer<typeof uploadMeta>, file: { fileName: string; mime: string; sha256: string; size: number; storageKey: string }, actorId?: string) {
    const o = await this.owner(tx, meta.entityType, meta.entityId);
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
    const d = await this.row(tx, id);
    const o = await this.owner(tx, d.entityType, d.entityId);
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
    const d = await this.row(tx, id);
    const o = await this.owner(tx, d.entityType, d.entityId);
    if (o.frozen) throw new ConflictException(`Dokument se ne mijenja: ${o.frozen}`);
    await tx.update(documents).set({ ...patch, updatedAt: new Date(), updatedBy: actorId }).where(eq(documents.id, id));
    await this.audit.record(tx, { entity: 'document', entityId: id, action: 'update', diff: { before: { title: d.title, kind: d.kind, confidentiality: d.confidentiality }, after: patch } });
    return this.get(tx, id);
  }

  /** Logičko brisanje; sadržaj i verzije ostaju radi revizijskog traga. */
  async remove(tx: Tx, id: string, actorId?: string) {
    const d = await this.row(tx, id);
    const o = await this.owner(tx, d.entityType, d.entityId);
    if (o.frozen) throw new ConflictException(`Dokument se ne briše: ${o.frozen}`);
    await tx.update(documents).set({ deletedAt: new Date(), updatedBy: actorId }).where(eq(documents.id, id));
    await this.audit.record(tx, { entity: 'document', entityId: id, action: 'delete', diff: { before: { title: d.title } } });
    return { ok: true };
  }

  /** Verzija za preuzimanje (zadano trenutna); preuzimanje se bilježi u reviziju. */
  async version(tx: Tx, id: string, version?: number) {
    const d = await this.row(tx, id);
    const n = version ?? d.currentVersion;
    const v = (await tx.select().from(documentVersions).where(and(eq(documentVersions.documentId, id), eq(documentVersions.version, n))))[0];
    if (!v) throw new NotFoundException(`Verzija ${n} ne postoji`);
    await this.audit.record(tx, { entity: 'document', entityId: id, action: 'download', diff: { meta: { version: n } } });
    return v;
  }

  /** Broj aktivnih dokumenata po entitetu (za oznaku „dokaz priložen”). */
  async counts(tx: Tx, type: DocumentEntity, ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await tx.select({ id: documents.entityId, n: sql<number>`count(*)::int` }).from(documents)
      .where(and(eq(documents.entityType, type), inArray(documents.entityId, ids), isNull(documents.deletedAt))).groupBy(documents.entityId);
    return new Map(rows.map((r) => [r.id, r.n]));
  }
}
