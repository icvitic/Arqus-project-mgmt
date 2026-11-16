import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { callStatus, daysUntil, fitScore, nextDeadline, type CallDeadline } from '@arqus/domain';
import type { Tx } from '../db/db.service';
import { auditEntries, callTracking, calls, users, type CallRow } from '../db/schema';
import { AuditService } from '../audit/audit.service';

const deadline = z.object({ kind: z.enum(['submission', 'stage1', 'stage2', 'info_day', 'other']), at: z.string().datetime({ offset: true }), label: z.string().max(100).optional() });
export const callInput = z.object({
  code: z.string().trim().min(2).max(100), title: z.string().trim().min(3).max(500), summary: z.string().max(5000).optional(),
  programme: z.string().trim().min(2).max(200), funder: z.string().max(200).optional(), packageId: z.string().max(100).optional(),
  actionTypes: z.array(z.string().max(40)).max(20).default([]), budget: z.number().int().min(0).optional(), expectedGrants: z.number().int().min(1).optional(),
  opensAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), deadlines: z.array(deadline).max(10).default([]),
  url: z.string().url().max(1000).optional(), tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});
export const callPatch = callInput.partial().extend({ cancelled: z.boolean().optional() }).strict();
export const assessmentInput = z.object({ scores: z.object({ strategic: z.number().int(), capacity: z.number().int(), probability: z.number().int(), financial: z.number().int() }), comment: z.string().max(2000).optional() });
export const decisionInput = z.object({ decision: z.enum(['go', 'no_go', 'watch']), rationale: z.string().trim().max(2000).optional(), internalDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), ownerUserId: z.string().uuid().nullable().optional() });
export type CallInput = z.infer<typeof callInput>;

type Tracking = typeof callTracking.$inferSelect;
const view = (c: CallRow, t?: Tracking | null, now = new Date()) => {
  const deadlines = c.deadlines as CallDeadline[];
  const next = nextDeadline(deadlines, now);
  return {
    id: c.id, scope: c.tenantId ? 'tenant' as const : 'global' as const, code: c.code, title: c.title, summary: c.summary, programme: c.programme, funder: c.funder,
    packageId: c.packageId, actionTypes: c.actionTypes, budget: c.budgetCents, expectedGrants: c.expectedGrants, opensAt: c.opensAt, deadlines, url: c.url, tags: c.tags,
    status: callStatus({ opensAt: c.opensAt, deadlines, cancelled: c.cancelled }, now), nextDeadline: next, daysToNextDeadline: next ? daysUntil(next.at, now) : null,
    tracking: t ? {
      fitScores: t.fitScores, fitTotal: t.fitTotal, fitComment: t.fitComment, assessedAt: t.assessedAt, decision: t.decision, rationale: t.rationale,
      decidedAt: t.decidedAt, internalDeadline: t.internalDeadline, ownerUserId: t.ownerUserId,
    } : null,
  };
};
export type CallView = ReturnType<typeof view>;

/** M3 Radar poziva: pozivi (globalni + vlastiti), praćenje po instituciji, nadolazeći rokovi. */
@Injectable()
export class CallsService {
  constructor(private readonly audit: AuditService) {}

  async list(tx: Tx, filter: { status?: string; q?: string; tracked?: boolean } = {}) {
    const rows = await tx.select({ c: calls, t: callTracking }).from(calls).leftJoin(callTracking, eq(callTracking.callId, calls.id))
      .where(and(isNull(calls.deletedAt), filter.q ? or(ilike(calls.title, `%${filter.q}%`), ilike(calls.code, `%${filter.q}%`), ilike(calls.programme, `%${filter.q}%`)) : undefined))
      .orderBy(asc(calls.code));
    let list = rows.map((r) => view(r.c, r.t));
    if (filter.status) list = list.filter((c) => c.status === filter.status);
    if (filter.tracked) list = list.filter((c) => c.tracking?.decision && c.tracking.decision !== 'no_go');
    // Najprije pozivi s najbližim rokom, zatim bez rokova, zatvoreni na kraju.
    const rank = (c: CallView) => (c.status === 'closed' || c.status === 'cancelled' ? 2 : c.nextDeadline ? 0 : 1);
    return list.sort((a, b) => rank(a) - rank(b) || (a.nextDeadline && b.nextDeadline ? Date.parse(a.nextDeadline.at) - Date.parse(b.nextDeadline.at) : 0));
  }

  private async row(tx: Tx, id: string) {
    const r = (await tx.select({ c: calls, t: callTracking }).from(calls).leftJoin(callTracking, eq(callTracking.callId, calls.id)).where(and(eq(calls.id, id), isNull(calls.deletedAt))))[0];
    if (!r) throw new NotFoundException(`Poziv ${id} ne postoji`);
    return r;
  }

  async get(tx: Tx, id: string) {
    const r = await this.row(tx, id);
    const history = r.t ? await tx.select({ at: auditEntries.at, action: auditEntries.action, actorId: auditEntries.actorId, diff: auditEntries.diff, actor: users.displayName })
      .from(auditEntries).leftJoin(users, eq(users.id, auditEntries.actorId))
      .where(and(eq(auditEntries.entity, 'call_tracking'), eq(auditEntries.entityId, r.t.id))).orderBy(desc(auditEntries.at)).limit(50) : [];
    return { ...view(r.c, r.t), history: history.map((h) => ({ at: h.at, action: h.action, actor: h.actor, after: (h.diff as { after?: unknown } | null)?.after ?? null })) };
  }

  private toValues<T extends Partial<CallInput>>(i: T): Omit<T, 'budget'> & { budgetCents?: number } {
    const { budget, ...rest } = i;
    return { ...rest, ...(budget !== undefined ? { budgetCents: budget } : {}) };
  }

  async create(tx: Tx, tenantId: string, input: CallInput, actorId?: string) {
    if ((await tx.select({ id: calls.id }).from(calls).where(and(eq(calls.tenantId, tenantId), eq(calls.code, input.code)))).length) throw new ConflictException(`Poziv ${input.code} već postoji`);
    const [row] = await tx.insert(calls).values({ tenantId, ...this.toValues(input), createdBy: actorId, updatedBy: actorId }).returning();
    await this.audit.record(tx, { entity: 'call', entityId: row!.id, action: 'create', diff: { after: { code: row!.code, title: row!.title } } });
    return view(row!);
  }

  async update(tx: Tx, tenantId: string, id: string, patch: z.infer<typeof callPatch>, actorId?: string) {
    const { c } = await this.row(tx, id);
    if (c.tenantId !== tenantId) throw new ForbiddenException('Globalni poziv se ne mijenja – prati ga i ocijeni u svojoj instituciji');
    const [row] = await tx.update(calls).set({ ...this.toValues(patch), updatedAt: new Date(), updatedBy: actorId }).where(eq(calls.id, id)).returning();
    await this.audit.record(tx, { entity: 'call', entityId: id, action: patch.cancelled ? 'cancel' : 'update', diff: { after: patch } });
    return view(row!);
  }

  private async tracking(tx: Tx, tenantId: string, callId: string, actorId?: string): Promise<Tracking> {
    const t = (await tx.select().from(callTracking).where(eq(callTracking.callId, callId)))[0];
    if (t) return t;
    const [row] = await tx.insert(callTracking).values({ tenantId, callId, createdBy: actorId, updatedBy: actorId }).returning();
    return row!;
  }

  async assess(tx: Tx, tenantId: string, id: string, input: z.infer<typeof assessmentInput>, actorId?: string) {
    await this.row(tx, id);
    let score;
    try { score = fitScore(input.scores); } catch (e) { throw new BadRequestException((e as Error).message); }
    const t = await this.tracking(tx, tenantId, id, actorId);
    await tx.update(callTracking).set({ fitScores: input.scores, fitTotal: score.total, fitComment: input.comment ?? null, assessedBy: actorId ?? null, assessedAt: new Date(), updatedAt: new Date(), updatedBy: actorId }).where(eq(callTracking.id, t.id));
    await this.audit.record(tx, { entity: 'call_tracking', entityId: t.id, action: 'assess', diff: { after: { scores: input.scores, total: score.total, recommendation: score.recommendation, comment: input.comment } } });
    return { ...(await this.get(tx, id)), recommendation: score.recommendation };
  }

  async decide(tx: Tx, tenantId: string, id: string, input: z.infer<typeof decisionInput>, actorId?: string) {
    const { c } = await this.row(tx, id);
    const status = callStatus({ opensAt: c.opensAt, deadlines: c.deadlines as CallDeadline[], cancelled: c.cancelled });
    if (input.decision === 'go' && (status === 'closed' || status === 'cancelled')) throw new ConflictException(`Poziv je ${status === 'closed' ? 'zatvoren' : 'otkazan'} – odluka go nije moguća`);
    if (input.decision !== 'watch' && !input.rationale?.trim()) throw new BadRequestException('Odluka go ili no-go traži obrazloženje');
    if (input.ownerUserId && !(await tx.select({ id: users.id }).from(users).where(eq(users.id, input.ownerUserId))).length) throw new NotFoundException('Odgovorna osoba ne postoji');
    const t = await this.tracking(tx, tenantId, id, actorId);
    await tx.update(callTracking).set({
      decision: input.decision, rationale: input.rationale ?? null, decidedBy: actorId ?? null, decidedAt: new Date(),
      ...(input.internalDeadline !== undefined ? { internalDeadline: input.internalDeadline } : {}), ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
      updatedAt: new Date(), updatedBy: actorId,
    }).where(eq(callTracking.id, t.id));
    await this.audit.record(tx, { entity: 'call_tracking', entityId: t.id, action: `decision.${input.decision}`, diff: { before: { decision: t.decision }, after: { decision: input.decision, rationale: input.rationale, internalDeadline: input.internalDeadline } } });
    return this.get(tx, id);
  }

  /** Nadolazeći rokovi praćenih poziva (odluka go ili pratiti) i interni rokovi, sljedećih `days` dana. */
  async deadlines(tx: Tx, days = 60, now = new Date()) {
    const until = now.getTime() + days * 86_400_000;
    const list = await this.list(tx, { tracked: true });
    const items: { callId: string; code: string; title: string; kind: string; label: string; at: string; days: number; decision: string | null }[] = [];
    for (const c of list) {
      for (const d of c.deadlines) {
        const t = Date.parse(d.at);
        if (t > now.getTime() && t <= until) items.push({ callId: c.id, code: c.code, title: c.title, kind: d.kind, label: d.label ?? d.kind, at: d.at, days: daysUntil(d.at, now), decision: c.tracking?.decision ?? null });
      }
      const internal = c.tracking?.internalDeadline;
      if (internal) {
        const at = `${internal}T23:59:59Z`; const t = Date.parse(at);
        if (t > now.getTime() && t <= until) items.push({ callId: c.id, code: c.code, title: c.title, kind: 'internal', label: 'interni rok', at, days: daysUntil(at, now), decision: c.tracking?.decision ?? null });
      }
    }
    return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }
}
