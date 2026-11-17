import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { addDays, buildCalendar, timeZoneOr, todayIn, type CalendarEvent } from '@arqus/domain';
import { DbService, type Tx } from '../db/db.service';
import { calendarTokens, tenants, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { IdentityService } from '../identity/identity.service';
import { PortfolioService, type Deadline } from '../portfolio/portfolio.service';
import { TenantContext, type RequestContext } from '../common/tenant-context';
import { mfaPolicyOf, mfaRequiredFor } from '../identity/mfa-policy';

/** Token: 32 bajta (256 bita) iz CSPRNG-a, base64url bez paddinga = 43 znaka. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');
/** Rokovi u feedu: od 180 dana unatrag do dvije godine unaprijed (stariji događaji nestaju iz kalendara klijenta). */
const PAST_DAYS = 180, FUTURE_DAYS = 730;
const KIND: Record<string, string> = {
  claim_due: 'Rok za ZNS i izvještaj', period_end: 'Kraj izvještajnog razdoblja', deliverable: 'Isporuka', milestone: 'Prekretnica',
  call_submission: 'Rok predaje poziva', call_internal: 'Interni rok poziva', proposal_internal: 'Interni rok prijave',
};

/**
 * WP1.18 – ograničenje dohvata kalendara po IP adresi (neprijavljena ruta): najviše `CALENDAR_RATE_MAX` (zadano 120) zahtjeva
 * u `CALENDAR_RATE_WINDOW_MINUTES` (zadano 10) minuta, za valjane i nevaljane tokene jednako, inače 429. U memoriji jedne
 * instance (kao ograničenje prijava i izvoza). Zadana granica dopušta da cijela institucija iza jedne NAT adrese osvježava
 * kalendare (klijenti osvježavaju svakih nekoliko sati); pogađanje tokena od 256 bita ionako nije izvedivo.
 */
@Injectable()
export class CalendarRateLimit {
  private readonly hits = new Map<string, { count: number; first: number }>();
  private readonly max = Math.max(1, Number(process.env.CALENDAR_RATE_MAX ?? 120) || 120);
  private readonly windowMs = Math.max(1, Number(process.env.CALENDAR_RATE_WINDOW_MINUTES ?? 10) || 10) * 60_000;
  take(ip: string | undefined): void {
    const key = ip ?? 'unknown'; const now = Date.now();
    let e = this.hits.get(key);
    if (e && now - e.first > this.windowMs) { this.hits.delete(key); e = undefined; }
    if (e && e.count >= this.max) throw new HttpException({ statusCode: 429, code: 'calendar_rate_limited', message: 'Previše zahtjeva – pokušaj kasnije' }, HttpStatus.TOO_MANY_REQUESTS);
    this.hits.set(key, e ? { ...e, count: e.count + 1 } : { count: 1, first: now });
    if (this.hits.size > 50_000) for (const k of [...this.hits.keys()].slice(0, 10_000)) this.hits.delete(k);
  }
}

/** Isti odgovor za nepoznat, opozvan, neispravan token i token neaktivnog korisnika (ne otkriva se ništa). */
const notFound = () => new NotFoundException('Kalendar ne postoji');

/**
 * WP1.18 – osobni kalendar rokova (iCalendar) dostupan tajnim tokenom u URL-u: kalendarski klijenti (Outlook, Google
 * Kalendar) ne šalju zaglavlje Authorization. Token se pokazuje jednom, u bazi je samo njegov SHA-256, novi token poništava
 * stari, a token prestaje vrijediti deaktivacijom ili brisanjem korisnika. Sadržaj: isti rokovi koje korisnik vidi na
 * portfelju (pristup po projektu, WP1.14) – naslovi i datumi, bez iznosa.
 */
@Injectable()
export class CalendarService {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly identity: IdentityService, private readonly portfolio: PortfolioService, private readonly ctx: TenantContext) {}

  async status(tx: Tx, userId: string) {
    const r = (await tx.select({ createdAt: calendarTokens.createdAt, lastUsedAt: calendarTokens.lastUsedAt }).from(calendarTokens).where(eq(calendarTokens.userId, userId)))[0];
    return { active: !!r, createdAt: r?.createdAt ?? null, lastUsedAt: r?.lastUsedAt ?? null };
  }

  /** Novi token (stari prestaje vrijediti). Token se vraća samo ovdje – u bazi i reviziji ga nema. */
  async generate(tx: Tx, tenantId: string, userId: string) {
    const token = randomBytes(32).toString('base64url');
    const had = (await this.status(tx, userId)).active;
    await tx.delete(calendarTokens).where(eq(calendarTokens.userId, userId));
    await tx.insert(calendarTokens).values({ tenantId, userId, tokenHash: hashToken(token) });
    await this.audit.record(tx, { entity: 'user', entityId: userId, action: had ? 'calendar.regenerate' : 'calendar.create' });
    return { token, path: `/api/calendar/${token}.ics`, ...(await this.status(tx, userId)) };
  }

  async revoke(tx: Tx, userId: string) {
    const r = await tx.delete(calendarTokens).where(eq(calendarTokens.userId, userId)).returning({ userId: calendarTokens.userId });
    if (r.length) await this.audit.record(tx, { entity: 'user', entityId: userId, action: 'calendar.revoke' });
    return this.status(tx, userId);
  }

  /** Neprijavljeni dohvat: `raw` je dio putanje (`<token>.ics`). */
  async feed(raw: string, now: Date = new Date()): Promise<string> {
    const token = raw.endsWith('.ics') ? raw.slice(0, -4) : raw;
    // Neispravan oblik prolazi isti put (hash i upit u bazi), da vrijeme odgovora ne razlikuje neispravan od nepoznatog tokena.
    const hash = hashToken(TOKEN_RE.test(token) ? token : `invalid:${token.slice(0, 200)}`);
    const owner = await this.db.withoutTenant(async (tx) => {
      await tx.execute(sql`select set_config('app.calendar_token_hash', ${hash}, true)`);
      return (await tx.select({ tenantId: calendarTokens.tenantId, userId: calendarTokens.userId }).from(calendarTokens).where(eq(calendarTokens.tokenHash, hash)))[0];
    });
    if (!owner || !TOKEN_RE.test(token)) throw notFound();
    return this.db.withTenant(owner.tenantId, async (tx) => {
      const u = (await tx.select({ id: users.id, mfaEnabled: users.mfaEnabled }).from(users).where(and(eq(users.id, owner.userId), eq(users.status, 'active'), isNull(users.deletedAt))))[0];
      if (!u) throw notFound();
      const t = (await tx.select({ settings: tenants.settings, name: tenants.name }).from(tenants).where(eq(tenants.id, owner.tenantId)))[0];
      const access = await this.identity.accessOf(tx, owner.tenantId, owner.userId);
      // Korisnik kojem je MFA obvezan, a nije ga postavio, ne dobiva podatke ni kroz kalendar (isto kao ograničeno stanje prijave).
      if (!u.mfaEnabled && mfaRequiredFor(mfaPolicyOf(t?.settings), access.tenant)) throw notFound();
      const rc: RequestContext = {
        tenantId: owner.tenantId, userId: owner.userId, permissions: new Set(access.tenant),
        projectPermissions: new Map(Object.entries(access.projects).map(([id, perms]) => [id, new Set(perms)])),
        leadProposals: new Set(access.leadProposals), timeZone: timeZoneOr(t?.settings?.timeZone),
      };
      const deadlines = await this.ctx.run(rc, () => this.portfolio.deadlines(tx, now));
      await tx.update(calendarTokens).set({ lastUsedAt: now }).where(eq(calendarTokens.userId, owner.userId));
      const today = todayIn(rc.timeZone, now);
      const from = addDays(today, -PAST_DAYS), to = addDays(today, FUTURE_DAYS);
      const events = deadlines.filter((d) => d.date >= from && d.date <= to).map(toEvent);
      return buildCalendar(events, { name: `ArQus – rokovi${t?.name ? ` (${t.name})` : ''}`, stamp: now, refresh: 'PT4H' });
    });
  }
}

/** Rok portfelja → događaj: oznaka projekta/poziva u naslovu, vrsta roka u opisu; UID iz stabilnog ključa roka. */
function toEvent(d: Deadline): CalendarEvent {
  const scope = d.acronym ?? d.scope;
  return {
    uid: `${d.key}@arqus-projekti`, date: d.date, ...(d.kind === 'call_submission' && d.at ? { at: d.at } : {}),
    summary: `${scope ? `[${scope}] ` : ''}${d.title}`,
    description: [KIND[d.kind] ?? d.kind, d.detail].filter(Boolean).join(' · '),
    categories: [KIND[d.kind] ?? d.kind],
  };
}
