import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { auditEntries } from '../db/schema';
import type { Tx } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';

export interface AuditInput {
  tenantId?: string; entity: string; entityId?: string | null; action: string;
  diff?: { before?: unknown; after?: unknown; meta?: Record<string, unknown> };
  actorType?: 'user' | 'system' | 'ai'; actorId?: string | null;
}

/** Zapis u reviziju unutar iste transakcije kao poslovna promjena (ADR-0003). */
@Injectable()
export class AuditService {
  constructor(private readonly ctx: TenantContext) {}
  async record(tx: Tx, input: AuditInput): Promise<void> {
    const c = this.ctx.get();
    const tenantId = input.tenantId ?? c?.tenantId;
    if (!tenantId) throw new Error('Revizijski zapis bez stanara');
    await tx.insert(auditEntries).values({
      tenantId, entity: input.entity, entityId: input.entityId ?? null, action: input.action, diff: input.diff ?? null,
      actorType: input.actorType ?? (c?.userId ? 'user' : 'system'), actorId: input.actorId ?? c?.userId ?? null,
      ip: c?.ip ?? null, sessionId: c?.sessionId ?? null,
    });
  }

  /** Broj zapisa iste radnje po entitetu (npr. povrati ZNS-a na dopunu) – za mjerenje pripreme (WP1.16b). */
  async countByEntity(tx: Tx, entity: string, entityIds: string[], action: string): Promise<Map<string, number>> {
    if (!entityIds.length) return new Map();
    const rows = await tx.select({ id: auditEntries.entityId, n: sql<number>`count(*)::int` }).from(auditEntries)
      .where(and(eq(auditEntries.entity, entity), eq(auditEntries.action, action), inArray(auditEntries.entityId, entityIds))).groupBy(auditEntries.entityId);
    return new Map(rows.map((r) => [r.id ?? '', r.n]));
  }
}
