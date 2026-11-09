import { Injectable } from '@nestjs/common';
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
}
