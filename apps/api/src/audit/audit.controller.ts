import { Controller, Get, Header, Query, Res, StreamableFile } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { Response } from 'express';
import { and, desc, eq, inArray, isNotNull, lt, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { DbService, type Tx } from '../db/db.service';
import { auditEntries, expenses, users } from '../db/schema';
import { RequirePermission } from '../identity/auth.guard';
import { TenantContext, tenantTimeZone } from '../common/tenant-context';
import { canInTenant } from '../common/access';
import { parseBody } from '../common/validation';
import { AuditService } from './audit.service';
import { ExportRateLimit } from '../common/rate-limit';
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
/** WP1.19: izvoz se struji u stranicama (keyset), bez cijelog rezultata u memoriji. */
const EXPORT_PAGE = 1_000;

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
  constructor(private readonly db: DbService, private readonly ctx: TenantContext, private readonly audit: AuditService, private readonly limit: ExportRateLimit) {}

  /** Opseg čitanja za korisnika iz konteksta: zona institucije i smije li vidjeti plaće (personnel:read institucije). */
  private scope() { const c = this.ctx.require(); return { tz: tenantTimeZone(), seesSalary: canInTenant(c, 'personnel:read') }; }

  /** Zapisi, najnoviji prvi. Za sljedeću stranicu `before=<id zadnjeg zapisa>`; manje od `limit` zapisa = kraj. */
  @Get() @RequirePermission('audit:read')
  list(@Query() q: unknown) {
    const query = parseBody(auditQuery, q);
    const scope = this.scope();
    return this.db.tx((tx) => this.entries(tx, query, Math.min(query.limit ?? 100, 500), scope));
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

  /**
   * CSV filtriranog rezultata (UTF-8 s BOM-om, separator `;`) – izvoz se upisuje u reviziju (s brojem redaka) prije slanja.
   * WP1.19: retci se čitaju i šalju u stranicama od 1.000 (keyset, kratke transakcije), pa ni 50.000 redaka nije u memoriji;
   * gornja granica id-ja određena je na početku (zapisi nastali tijekom slanja ne ulaze). Ograničenje izvoza po korisniku (429).
   */
  @Get('export.csv') @RequirePermission('audit:read')
  @Header('Content-Type', 'text/csv; charset=utf-8') @Header('X-Content-Type-Options', 'nosniff') @Header('Cache-Control', 'no-store')
  async exportCsv(@Query() q: unknown, @Res({ passthrough: true }) res: Response) {
    const c = this.ctx.require();
    this.limit.take('audit-csv', c.userId!);
    const { before: _b, limit: _l, ...query } = parseBody(auditQuery, q);
    const scope = this.scope();
    const tenantId = c.tenantId;
    const top = await this.db.tx(async (tx) => {
      const max = (await tx.select({ id: sql<string | null>`max(${auditEntries.id})` }).from(auditEntries))[0]?.id;
      const top = max === null || max === undefined ? 0 : Number(max);
      const counted = (await tx.select({ n: sql<number>`count(*)::int` }).from(sql`(select 1 from ${auditEntries} where ${and(...this.conditions(query, scope.tz), lte(auditEntries.id, top))} limit ${EXPORT_MAX + 1}) as x`))[0]?.n ?? 0;
      const rows = Math.min(counted, EXPORT_MAX);
      await this.audit.record(tx, { entity: 'audit', entityId: null, action: 'export', diff: { meta: { filters: query, rows, truncated: counted > EXPORT_MAX } } });
      return top;
    });
    const header = ['id', 'vrijeme', 'korisnik', 'vrsta korisnika', 'entitet', 'id entiteta', 'radnja', 'prije', 'poslije', 'dodatno', 'IP adresa'];
    const fmt = (d: Date) => d.toLocaleString('sv-SE', { timeZone: scope.tz }).replace(' ', 'T');
    const db = this.db;
    const entries = this.entries.bind(this);
    async function* chunks(): AsyncGenerator<Buffer> {
      yield Buffer.from('\uFEFF' + header.join(';') + '\r\n', 'utf8');
      let before = top + 1; let sent = 0;
      while (sent < EXPORT_MAX) {
        const size = Math.min(EXPORT_PAGE, EXPORT_MAX - sent);
        const page = await db.withTenant(tenantId, (tx) => entries(tx, { ...query, before }, size, scope));
        if (!page.length) break;
        const lines = page.map((r) => [r.id, fmt(new Date(r.at)), r.actor?.displayName ?? (r.actorType === 'system' ? 'sustav' : r.actorId ?? ''), r.actorType, r.entity, r.entityId, r.action, r.diff?.before, r.diff?.after, r.diff?.meta, r.ip].map(csvCell).join(';'));
        yield Buffer.from(lines.join('\r\n') + '\r\n', 'utf8');
        sent += page.length; before = page[page.length - 1]!.id;
        if (page.length < size) break;
      }
    }
    const stamp = new Date().toLocaleDateString('sv-SE', { timeZone: scope.tz });
    res.setHeader('Content-Disposition', `attachment; filename="revizija_${stamp}.csv"`);
    const file = new StreamableFile(Readable.from(chunks()), { type: 'text/csv; charset=utf-8' });
    // Greška usred slanja: prekid veze (nepotpuno preuzimanje je vidljivo), nikad tiho skraćen CSV.
    file.setErrorHandler((_err, response) => { (response as Response).destroy(); });
    return file;
  }

  /** Uvjeti filtra (zajednički za pregled, brojanje i izvoz). */
  private conditions(q: Omit<AuditQuery, 'limit'>, tz: string): (SQL | undefined)[] {
    return [
      // Razdoblje u kalendarskim danima institucije (od početka dana `from` do kraja dana `to`).
      q.from ? sql`${auditEntries.at} >= (${q.from}::date::timestamp at time zone ${tz})` : undefined,
      q.to ? sql`${auditEntries.at} < ((${q.to}::date + 1)::timestamp at time zone ${tz})` : undefined,
      q.actorId ? eq(auditEntries.actorId, q.actorId) : undefined,
      q.entity ? eq(auditEntries.entity, q.entity) : undefined,
      q.entityId ? eq(auditEntries.entityId, q.entityId) : undefined,
      q.action ? eq(auditEntries.action, q.action) : undefined,
      q.before ? lt(auditEntries.id, q.before) : undefined,
    ];
  }

  private async entries(tx: Tx, q: Omit<AuditQuery, 'limit'>, limit: number, scope: { tz: string; seesSalary: boolean }) {
    const rows = await tx.select({ e: auditEntries, actorName: users.displayName }).from(auditEntries).leftJoin(users, eq(users.id, auditEntries.actorId))
      .where(and(...this.conditions(q, scope.tz))).orderBy(desc(auditEntries.id)).limit(limit);
    const list = rows.map(({ e, actorName }) => ({ ...e, diff: e.diff ? scrubSecrets(e.diff) : null, actor: e.actorId ? { id: e.actorId, displayName: actorName ?? null } : null }));
    if (scope.seesSalary) return list.map((e) => ({ ...e, redacted: false }));
    const ids = expenseIdsIn(list);
    const personnel = ids.length ? new Set((await tx.select({ id: expenses.id }).from(expenses).where(and(inArray(expenses.id, ids), eq(expenses.source, 'timesheet')))).map((r) => r.id)) : new Set<string>();
    return list.map((e) => redactSalary(e, personnel));
  }
}
