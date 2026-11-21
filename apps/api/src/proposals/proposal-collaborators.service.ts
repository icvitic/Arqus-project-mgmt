import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '../db/db.service';
import { proposalCollaborators, proposals, users, type Proposal } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { canLeadProposal, canSeeProposal } from '../common/access';
import { currentContext } from '../common/tenant-context';
import { notify } from '../notifications/notify';

export const collaboratorInput = z.object({ userId: z.string().uuid(), access: z.enum(['edit', 'read']).default('edit') }).strict();
export const collaboratorPatch = z.object({ access: z.enum(['edit', 'read']) }).strict();

/** Zaključena prijava ne dobiva nove suradnike (postojeći je i dalje čitaju, a voditelj ih može ukloniti). */
const CLOSED: readonly string[] = ['contracted', 'withdrawn', 'rejected'];

/**
 * WP1.26 – suradnici na prijavi. Voditelj prijave ili ured za projekte (`proposals:write` institucije) dodaje korisnike
 * institucije koji rade na pripremi, s razinom `edit` (kao voditelj, bez vođenja prijave) ili `read` (samo čitanje).
 * Pristup vrijedi od idućeg zahtjeva (dozvole se čitaju svježe), samo na toj prijavi; suradnik sam može napustiti prijavu.
 */
@Injectable()
export class ProposalCollaboratorsService {
  constructor(private readonly audit: AuditService) {}

  private async proposal(tx: Tx, id: string): Promise<Proposal> {
    const ctx = currentContext();
    if (ctx?.userId && !canSeeProposal(ctx, id)) throw new NotFoundException(`Prijava ${id} ne postoji`);
    const p = (await tx.select().from(proposals).where(and(eq(proposals.id, id), isNull(proposals.deletedAt))))[0];
    if (!p) throw new NotFoundException(`Prijava ${id} ne postoji`);
    return p;
  }

  private canManage(id: string): boolean {
    const ctx = currentContext();
    return !ctx?.userId || canLeadProposal(ctx, id);
  }

  private assertManage(id: string): void {
    if (!this.canManage(id)) throw new ForbiddenException('Suradnike na prijavi određuje voditelj prijave ili ured za projekte');
  }

  /** Suradnici prijave; e-adrese i popis korisnika za dodavanje samo onome tko suradnike određuje. */
  async list(tx: Tx, id: string) {
    const p = await this.proposal(tx, id);
    const manage = this.canManage(id);
    const open = !CLOSED.includes(p.status);
    const rows = await tx.select({ id: proposalCollaborators.id, userId: users.id, displayName: users.displayName, email: users.email, status: users.status, access: proposalCollaborators.access, createdAt: proposalCollaborators.createdAt })
      .from(proposalCollaborators).innerJoin(users, eq(users.id, proposalCollaborators.userId))
      .where(eq(proposalCollaborators.proposalId, id)).orderBy(asc(users.displayName));
    const taken = new Set([...rows.map((r) => r.userId), ...(p.leadUserId ? [p.leadUserId] : [])]);
    const people = manage && open
      ? (await tx.select({ id: users.id, displayName: users.displayName, email: users.email }).from(users)
        .where(and(isNull(users.deletedAt), notInArray(users.status, ['disabled', 'closed']))).orderBy(asc(users.displayName))).filter((u) => !taken.has(u.id))
      : [];
    return {
      proposalId: id, leadUserId: p.leadUserId, canManage: manage, open,
      entries: rows.map((r) => ({ id: r.id, userId: r.userId, displayName: r.displayName, ...(manage ? { email: r.email } : {}), status: r.status, access: r.access, createdAt: r.createdAt })),
      users: people,
    };
  }

  async add(tx: Tx, tenantId: string, id: string, input: z.infer<typeof collaboratorInput>, actorId?: string) {
    const p = await this.proposal(tx, id);
    this.assertManage(id);
    if (CLOSED.includes(p.status)) throw new ConflictException('Zaključenoj prijavi se ne dodaju suradnici');
    const u = (await tx.select({ id: users.id, status: users.status }).from(users).where(and(eq(users.id, input.userId), isNull(users.deletedAt))))[0];
    if (!u) throw new NotFoundException('Korisnik ne postoji');
    if (u.status === 'disabled' || u.status === 'closed') throw new ConflictException('Korisnik nije aktivan');
    if (u.id === p.leadUserId) throw new ConflictException('Voditelj prijave već ima pristup prijavi');
    const [row] = await tx.insert(proposalCollaborators).values({ tenantId, proposalId: id, userId: u.id, access: input.access, createdBy: actorId ?? null }).onConflictDoNothing().returning();
    if (!row) throw new ConflictException('Korisnik je već suradnik na prijavi');
    await this.audit.record(tx, { entity: 'proposal', entityId: id, action: 'collaborator.add', diff: { after: { userId: u.id, access: input.access } } });
    await notify(tx, { userId: u.id, kind: 'proposal_collaborator', proposalId: id, data: { acronym: p.acronym, access: input.access }, link: `prijave/${id}` });
    return this.list(tx, id);
  }

  async update(tx: Tx, id: string, collaboratorId: string, input: z.infer<typeof collaboratorPatch>) {
    const p = await this.proposal(tx, id);
    this.assertManage(id);
    const row = (await tx.select().from(proposalCollaborators).where(and(eq(proposalCollaborators.id, collaboratorId), eq(proposalCollaborators.proposalId, id))))[0];
    if (!row) throw new NotFoundException('Suradnik ne postoji na prijavi');
    if (row.access !== input.access) {
      await tx.update(proposalCollaborators).set({ access: input.access }).where(eq(proposalCollaborators.id, row.id));
      await this.audit.record(tx, { entity: 'proposal', entityId: id, action: 'collaborator.update', diff: { before: { userId: row.userId, access: row.access }, after: { userId: row.userId, access: input.access } } });
      await notify(tx, { userId: row.userId, kind: 'proposal_collaborator', proposalId: id, data: { acronym: p.acronym, access: input.access }, link: `prijave/${id}` });
    }
    return this.list(tx, id);
  }

  /** Uklanja voditelj ili ured; suradnik sam može napustiti prijavu (tada mu se popis više ne vraća – nema pristup). */
  async remove(tx: Tx, id: string, collaboratorId: string) {
    const p = await this.proposal(tx, id);
    const row = (await tx.select().from(proposalCollaborators).where(and(eq(proposalCollaborators.id, collaboratorId), eq(proposalCollaborators.proposalId, id))))[0];
    if (!row) throw new NotFoundException('Suradnik ne postoji na prijavi');
    const self = row.userId === currentContext()?.userId;
    if (!self) this.assertManage(id);
    await tx.delete(proposalCollaborators).where(eq(proposalCollaborators.id, row.id));
    await this.audit.record(tx, { entity: 'proposal', entityId: id, action: self ? 'collaborator.leave' : 'collaborator.remove', diff: { before: { userId: row.userId, access: row.access } } });
    await notify(tx, { userId: row.userId, kind: 'proposal_collaborator_removed', proposalId: id, data: { acronym: p.acronym }, link: null });
    if (self && !canSeeProposalAfterLeaving(id)) return { proposalId: id, left: true as const };
    return this.list(tx, id);
  }
}

/** Nakon izlaska korisnik prijavu vidi samo ako ima drugi put (institucija, voditelj) – kontekst još nosi staru dodjelu. */
function canSeeProposalAfterLeaving(id: string): boolean {
  const ctx = currentContext();
  if (!ctx) return true;
  const rest = new Map(ctx.proposalGrants ?? []);
  rest.delete(id);
  return canSeeProposal({ ...ctx, proposalGrants: rest }, id);
}
