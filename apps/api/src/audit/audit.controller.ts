import { Controller, Get, Header, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { and, desc, eq, inArray, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { DbService, type Tx } from '../db/db.service';
import { auditEntries, expenses, users } from '../db/schema';
import { RequirePermission } from '../identity/auth.guard';
import { TenantContext, tenantTimeZone } from '../common/tenant-context';
import { canInTenant } from '../common/access';
import { parseBody } from '../common/validation';
import { AuditService } from './audit.service';
import { expenseIdsIn, redactSalary, scrubSecrets } from './audit-redaction';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'datum u obliku GGGG-MM-DD');
/** Filtri pregleda revizije (WP1.14b). `before` – id zadnjeg prikazanog zapisa (keyset paginacija, najnoviji prvi). */
export const auditQuery = z.object({
  from: isoDate.optional(), to: isoDate.optional(),
  actorId: z.string().uuid().optional(),
  entity: z.string().trim().min(1).max(60).optional(),
  entityId: z.string().trim().min(1).max(100).optional(),
  action: z.string().trim().min(1).max(100).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
}).strict();
type AuditQuery = z.infer<typeof auditQuery>;

/** Najviše redaka u jednom CSV izvozu (filtrirani rezultat). */
const EXPORT_MAX = 50_000;

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  // Zaštita od CSV injekcije u tabličnim kalkulatorima: ćelija koja počinje formulom dobiva apostrof.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * M11 Revizijski zapis – pregled i izvoz (WP1.14b). Radnja institucije (`audit:read`: administrator, ured za projekte).
 * Čitanje revizije se ne revidira; izvoz u CSV se revidira. Podaci o plaći (godišnji trošak i iz njega izvedeni troškovi
 * osoblja) prikazuju se samo uz `personnel:read` institucije; tajne se nikad ne prikazuju (`audit-redaction.ts`).
 */
@Controller('audit')
export class AuditController {
  constructor(private readonly db: DbService, private readonly ctx: TenantContext, private readonly audit: AuditService) {}

  /** Zapisi, najnoviji prvi. Za sljedeću stranicu `before=<id zadnjeg zapisa>`; manje od `limit` zapisa = kraj. */
  @Get() @RequirePermission('audit:read')
  list(@Query() q: unknown) {
    const query = parseBody(auditQuery, q);
    return this.db.tx((tx) => this.entries(tx, query, Math.min(query.limit ?? 100, 500)));
  }

  /** Vrijednosti za filtre: vrste entiteta, radnje i korisnici koji se pojavljuju u reviziji institucije. */
  @Get('facets') @RequirePermission('audit:read')
  facets() {
    return this.db.tx(async (tx) => {
      const entities = (await tx.selectDistinct({ v: auditEntries.entity }).from(auditEntries).orderBy(auditEntries.entity)).map((r) => r.v);
      const actions = (await tx.selectDistinct({ v: auditEntries.action }).from(auditEntries).orderBy(auditEntries.action)).map((r) => r.v);
      const actors = await tx.selectDistinct({ id: users.id, displayName: users.displayName }).from(auditEntries).innerJoin(users, eq(users.id, auditEntries.actorId))
        .where(isNotNull(auditEntries.actorId)).orderBy(users.displayName);
      return { entities, actions, actors };
    });
  }

  /** CSV filtriranog rezultata (UTF-8 s BOM-om, separator `;`) – izvoz se upisuje u reviziju. */
  @Get('export.csv') @RequirePermission('audit:read')
  @Header('Content-Type', 'text/csv; charset=utf-8') @Header('X-Content-Type-Options', 'nosniff') @Header('Cache-Control', 'no-store')
  async exportCsv(@Query() q: unknown, @Res({ passthrough: true }) res: Response) {
    const { before: _b, limit: _l, ...query } = parseBody(auditQuery, q);
    const rows = await this.db.tx(async (tx) => {
      const list = await this.entries(tx, query, EXPORT_MAX);
      await this.audit.record(tx, { entity: 'audit', entityId: null, action: 'export', diff: { meta: { filters: query, rows: list.length, truncated: list.length >= EXPORT_MAX } } });
      return list;
    });
    const tz = tenantTimeZone();
    const header = ['id', 'vrijeme', 'korisnik', 'vrsta korisnika', 'entitet', 'id entiteta', 'radnja', 'prije', 'poslije', 'dodatno', 'IP adresa'];
    const fmt = (d: Date) => d.toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T');
    const lines = rows.map((r) => [r.id, fmt(new Date(r.at)), r.actor?.displayName ?? (r.actorType === 'system' ? 'sustav' : r.actorId ?? ''), r.actorType, r.entity, r.entityId, r.action, r.diff?.before, r.diff?.after, r.diff?.meta, r.ip].map(csvCell).join(';'));
    const body = '\uFEFF' + [header.join(';'), ...lines].join('\r\n') + '\r\n';
    const stamp = new Date().toLocaleDateString('sv-SE', { timeZone: tz });
    res.setHeader('Content-Disposition', `attachment; filename="revizija_${stamp}.csv"`);
    return new StreamableFile(Buffer.from(body, 'utf8'), { type: 'text/csv; charset=utf-8' });
  }

  private async entries(tx: Tx, q: Omit<AuditQuery, 'limit'>, limit: number) {
    const tz = tenantTimeZone();
    const conds: (SQL | undefined)[] = [
      // Razdoblje u kalendarskim danima institucije (od početka dana `from` do kraja dana `to`).
      q.from ? sql`${auditEntries.at} >= (${q.from}::date::timestamp at time zone ${tz})` : undefined,
      q.to ? sql`${auditEntries.at} < ((${q.to}::date + 1)::timestamp at time zone ${tz})` : undefined,
      q.actorId ? eq(auditEntries.actorId, q.actorId) : undefined,
      q.entity ? eq(auditEntries.entity, q.entity) : undefined,
      q.entityId ? eq(auditEntries.entityId, q.entityId) : undefined,
      q.action ? eq(auditEntries.action, q.action) : undefined,
      q.before ? lt(auditEntries.id, q.before) : undefined,
    ];
    const rows = await tx.select({ e: auditEntries, actorName: users.displayName }).from(auditEntries).leftJoin(users, eq(users.id, auditEntries.actorId))
      .where(and(...conds)).orderBy(desc(auditEntries.id)).limit(limit);
    const seesSalary = canInTenant(this.ctx.require(), 'personnel:read');
    const list = rows.map(({ e, actorName }) => ({ ...e, diff: e.diff ? scrubSecrets(e.diff) : null, actor: e.actorId ? { id: e.actorId, displayName: actorName ?? null } : null }));
    if (seesSalary) return list.map((e) => ({ ...e, redacted: false }));
    const ids = expenseIdsIn(list);
    const personnel = ids.length ? new Set((await tx.select({ id: expenses.id }).from(expenses).where(and(inArray(expenses.id, ids), eq(expenses.source, 'timesheet')))).map((r) => r.id)) : new Set<string>();
    return list.map((e) => redactSalary(e, personnel));
  }
}
