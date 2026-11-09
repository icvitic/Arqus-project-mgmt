import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, ilike, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '../db/db.service';
import { organisations, tenants, type Organisation } from '../db/schema';
import { AuditService } from '../audit/audit.service';

export const ORGANISATION_TYPES = ['university', 'faculty', 'institute', 'sme', 'large_enterprise', 'public_body', 'ngo', 'other'] as const;

export const organisationInput = z.object({
  name: z.string().trim().min(2).max(300),
  shortName: z.string().trim().max(50).optional(),
  country: z.string().trim().length(2).transform((c) => c.toUpperCase()),
  type: z.enum(ORGANISATION_TYPES).default('other'),
  identifiers: z.object({ pic: z.string().regex(/^\d{9}$/, 'PIC ima 9 znamenki').optional(), oib: z.string().regex(/^\d{11}$/, 'OIB ima 11 znamenki').optional(), vat: z.string().max(20).optional() }).default({}),
  nonProfit: z.boolean().default(false),
  website: z.string().url().optional(),
});
export const organisationPatch = organisationInput.partial();
export type OrganisationInput = z.infer<typeof organisationInput>;

const view = (o: Organisation) => ({
  id: o.id, name: o.name, shortName: o.shortName, country: o.country, type: o.type, identifiers: o.identifiers,
  nonProfit: o.nonProfit, isSelf: o.isSelf, website: o.website, createdAt: o.createdAt, updatedAt: o.updatedAt,
});
export type OrganisationView = ReturnType<typeof view>;

/** M4 Registar organizacija stanara (partneri, podugovaratelji). Stanar je i sam organizacija (`isSelf`). */
@Injectable()
export class OrganisationsService {
  constructor(private readonly audit: AuditService) {}

  async list(tx: Tx, q?: string): Promise<OrganisationView[]> {
    const rows = await tx.select().from(organisations)
      .where(and(isNull(organisations.deletedAt), q ? ilike(organisations.name, `%${q}%`) : undefined))
      .orderBy(organisations.name);
    return rows.map(view);
  }

  /** Dohvat pod RLS-om: tuđa organizacija je „nepostojeća” (404), ne „zabranjena”. */
  async getRow(tx: Tx, id: string): Promise<Organisation> {
    const row = (await tx.select().from(organisations).where(and(eq(organisations.id, id), isNull(organisations.deletedAt))))[0];
    if (!row) throw new NotFoundException(`Organizacija ${id} ne postoji`);
    return row;
  }

  async get(tx: Tx, id: string): Promise<OrganisationView> { return view(await this.getRow(tx, id)); }

  async create(tx: Tx, tenantId: string, input: OrganisationInput, actorId?: string): Promise<OrganisationView> {
    const [row] = await tx.insert(organisations).values({ tenantId, ...input, createdBy: actorId, updatedBy: actorId }).returning();
    await this.audit.record(tx, { entity: 'organisation', entityId: row!.id, action: 'create', diff: { after: view(row!) } });
    return view(row!);
  }

  async update(tx: Tx, id: string, patch: Partial<OrganisationInput>, actorId?: string): Promise<OrganisationView> {
    const before = await this.getRow(tx, id);
    const [row] = await tx.update(organisations).set({ ...patch, updatedAt: new Date(), updatedBy: actorId }).where(eq(organisations.id, id)).returning();
    await this.audit.record(tx, { entity: 'organisation', entityId: id, action: 'update', diff: { before: view(before), after: view(row!) } });
    return view(row!);
  }

  /** Vlastita organizacija stanara; stvara se iz podataka stanara pri prvoj potrebi. */
  async ensureSelf(tx: Tx, tenantId: string): Promise<Organisation> {
    const existing = (await tx.select().from(organisations).where(eq(organisations.isSelf, true)))[0];
    if (existing) return existing;
    const tenant = (await tx.select().from(tenants).where(eq(tenants.id, tenantId)))[0];
    if (!tenant) throw new NotFoundException('Stanar ne postoji');
    const [row] = await tx.insert(organisations).values({
      tenantId, name: tenant.name, country: 'HR', type: 'other', isSelf: true, nonProfit: true,
      identifiers: { pic: tenant.identifiers.pic, oib: tenant.identifiers.oib, vat: tenant.identifiers.vat },
    }).returning();
    await this.audit.record(tx, { entity: 'organisation', entityId: row!.id, action: 'create', actorType: 'system', diff: { after: view(row!), meta: { reason: 'self' } } });
    return row!;
  }
}
