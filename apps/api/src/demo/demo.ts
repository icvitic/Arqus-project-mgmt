/**
 * Demo okruženje (WP1.13): stanar s realnim podacima za demonstraciju i njegovo vraćanje na početno stanje.
 *
 * - Pod VLASNIČKOM vezom radi samo ono što radi i `seedDemo`: sistemske uloge, redak stanara i prvi administrator.
 *   Stanar dobiva oznaku `settings.demo = true`; bez nje naredba odbija dirati stanara (zaštita stvarne institucije).
 * - Sve ostalo ide kroz API koji se diže u istom procesu pod APLIKACIJSKOM ulogom (RLS), kao različiti demo korisnici.
 * - Reset briše ISKLJUČIVO retke s `tenant_id` demo stanara (i njegove datoteke dokumenata); globalni retci se ne diraju.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { backendFromEnv, LocalBackend } from '../documents/storage-backends';
import { passwordIssues } from '@arqus/domain';
import * as schema from '../db/schema';
import { importGlobalPackages } from '../db/seed';
import { IdentityService } from '../identity/identity.service';
import { hashPassword } from '../identity/password';
import { buildDemo, DEMO_DEFAULT_PASSWORD, DEMO_TENANT_NAME, DEMO_USERS, demoEmail, type DemoSummary } from './scenario';

export interface DemoOptions {
  /** Vlasnička veza (migracije) – samo za stanara, prvog administratora i reset. */
  ownerUrl: string;
  /** Aplikacijska veza (arqus_app, bez BYPASSRLS) – za sve poslovne podatke. */
  appUrl: string;
  slug?: string;
  tenantName?: string;
  password?: string;
  /** Obriši postojećeg demo stanara i stvori ga ponovno. */
  reset?: boolean;
  /** „Danas” za relativne datume (testovi). */
  today?: Date;
  importPackages?: boolean;
  log?: (message: string) => void;
}

export interface DemoResult {
  status: 'created' | 'exists';
  tenantId: string;
  slug: string;
  password: string;
  users: { email: string; displayName: string; roleLabel: string; note: string }[];
  summary?: DemoSummary;
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
const UUID = /^[0-9a-f-]{36}$/;

type Db = NodePgDatabase<typeof schema>;

async function findTenant(db: Db, slug: string) {
  return (await db.select({ id: schema.tenants.id, settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.slug, slug)))[0];
}

/** Briše sve retke stanara (svaka tablica sa stupcem tenant_id) i sam redak stanara. Vlasnička veza (superuser). */
async function deleteTenant(db: Db, tenantId: string): Promise<void> {
  if (!UUID.test(tenantId)) throw new Error('Neispravan id stanara');
  await db.transaction(async (tx) => {
    // Okidači (npr. nepromjenjivost prihvaćenih troškova) i provjere stranih ključeva ne vrijede samo u ovoj transakciji;
    // zato se briše IZRIČITO svaka tablica stanara, filtrirano po tenant_id.
    await tx.execute(sql`set local session_replication_role = replica`);
    const tables = await tx.execute<{ table_name: string }>(sql`select c.table_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'tenant_id' and t.table_type = 'BASE TABLE' and c.table_name <> 'tenants'`);
    for (const { table_name } of tables.rows) await tx.execute(sql`delete from ${sql.identifier(table_name)} where tenant_id = ${tenantId}`);
    await tx.execute(sql`delete from tenants where id = ${tenantId}`);
  });
  // Sadržaj dokumenata: svi objekti `<tenantId>/` u pohrani koju koristi aplikacija (lokalno ili S3, WP1.20).
  const backend = backendFromEnv(process.env);
  if (backend instanceof LocalBackend) await rm(join(backend.root, tenantId), { recursive: true, force: true });
  else { for await (const o of backend.list(`${tenantId}/`)) await backend.delete(o.key); }
}

/** Stanar s oznakom demo i prvi administrator (kao `seedDemo`, ali s upitima ograničenima na ovog stanara). */
async function bootstrapTenant(db: Db, slug: string, name: string, password: string): Promise<string> {
  return db.transaction(async (tx) => {
    await IdentityService.ensureSystemRoles(tx);
    const [tenant] = await tx.insert(schema.tenants).values({ slug, name, settings: { demo: true, complete: false } }).returning();
    await tx.execute(sql`select set_config('app.tenant_id', ${tenant!.id}, true)`);
    const admin = DEMO_USERS.find((u) => u.key === 'admin')!;
    const [user] = await tx.insert(schema.users).values({ tenantId: tenant!.id, email: demoEmail(admin.local, slug), displayName: admin.displayName, passwordHash: await hashPassword(password), passwordChangedAt: new Date(), status: 'active' }).returning();
    const role = (await tx.select().from(schema.roles).where(and(eq(schema.roles.code, 'tenant-admin'), isNull(schema.roles.tenantId))))[0];
    if (!role) throw new Error('Sistemska uloga tenant-admin ne postoji');
    await tx.insert(schema.roleAssignments).values({ tenantId: tenant!.id, userId: user!.id, roleId: role.id });
    return tenant!.id;
  });
}

/** API u istom procesu (aplikacijska uloga), na slučajnom portu samo na loopbacku. */
async function withInProcessApi<T>(appUrl: string, fn: (base: string, app: NestExpressApplication) => Promise<T>): Promise<T> {
  const saved = { db: process.env.DATABASE_URL, ft: process.env.FT_IMPORT_INTERVAL_HOURS, mail: process.env.MAIL_TRANSPORT };
  process.env.DATABASE_URL = appUrl;
  process.env.FT_IMPORT_INTERVAL_HOURS = '0'; // seeder ne pokreće periodični uvoz poziva
  // WP1.21: API seedera ne šalje e-poštu ni kad je instalacija ima (demo računi se ne pozivaju porukom, a token pozivnice
  // seeder dobiva samo bez pošte) – postavka vrijedi samo za ovaj proces naredbe `demo`, ne za poslužitelj.
  process.env.MAIL_TRANSPORT = 'off';
  const { AppModule } = await import('../app.module');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, logger: ['error', 'warn'] });
  try {
    app.useBodyParser('json', { limit: '1mb' });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    return await fn(`http://127.0.0.1:${address.port}`, app);
  } finally {
    await app.close();
    for (const [k, v] of [['DATABASE_URL', saved.db], ['FT_IMPORT_INTERVAL_HOURS', saved.ft], ['MAIL_TRANSPORT', saved.mail]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

/**
 * WP1.23 – zaslon „Rokovi čuvanja” sa stvarnim brojevima: sesije nastale punjenjem (prijave demo korisnika, sve odjavljene)
 * pomiču se (samo u OVOM demo stanaru, vlasničkom vezom) 45 dana u prošlost, pa im je rok (30 dana) istekao; zakazano
 * izvođenje posla čuvanja – isti kod kao u produkciji, ograničen na demo stanara – stvarno ih ukloni i zapiše što je uklonilo.
 * Obavijesti se ne diraju (demo pokazuje nepročitane i pročitane obavijesti).
 */
async function demoRetentionRun(db: Db, app: NestExpressApplication, tenantId: string, log: (m: string) => void): Promise<void> {
  if (!UUID.test(tenantId)) throw new Error('Neispravan id stanara');
  const demo = (await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)))[0];
  if (demo?.settings?.demo !== true) throw new Error('Posao čuvanja u demo naredbi radi samo nad demo stanarom');
  await db.execute(sql`update sessions set created_at = created_at - interval '45 days', expires_at = expires_at - interval '45 days',
    revoked_at = revoked_at - interval '45 days' where tenant_id = ${tenantId}`);
  const { RetentionService } = await import('../privacy/retention.service');
  const r = await app.get(RetentionService).runTenant(tenantId, { dryRun: false, mode: 'scheduled' });
  log(`rokovi čuvanja: zakazano izvođenje uklonilo ${r.categories.reduce((a, c) => a + c.removed, 0)} zapisa (odjavljene sesije iz punjenja)`);
}

export async function runDemo(opts: DemoOptions): Promise<DemoResult> {
  const slug = opts.slug ?? 'demo';
  const password = opts.password ?? DEMO_DEFAULT_PASSWORD;
  const log = opts.log ?? (() => undefined);
  if (!SLUG.test(slug)) throw new Error(`Neispravna oznaka stanara "${slug}" (mala slova, brojke i crtice)`);
  for (const u of DEMO_USERS) {
    const issues = passwordIssues(password, { email: demoEmail(u.local, slug), displayName: u.displayName, tenantSlug: slug });
    if (issues.length) throw new Error(`Demo lozinka ne zadovoljava pravila (${u.local}): ${issues.join('; ')}`);
  }
  const users = DEMO_USERS.map((u) => ({ email: demoEmail(u.local, slug), displayName: u.displayName, roleLabel: u.roleLabel, note: u.note }));

  if (opts.importPackages !== false) await importGlobalPackages(opts.ownerUrl);
  const pool = new Pool({ connectionString: opts.ownerUrl, max: 1 });
  const db = drizzle(pool, { schema });
  try {
    const existing = await findTenant(db, slug);
    if (existing) {
      if (existing.settings?.demo !== true) throw new Error(`Stanar "${slug}" postoji i NIJE demo stanar – naredba ga ne dira. Odaberi drugu oznaku (--slug).`);
      if (existing.settings?.complete === true && !opts.reset) {
        log(`Demo stanar "${slug}" već postoji – ništa se ne mijenja (za svježe podatke: --reset).`);
        return { status: 'exists', tenantId: existing.id, slug, password, users };
      }
      log(existing.settings?.complete === true ? `Brišem demo stanara "${slug}"…` : `Demo stanar "${slug}" je nedovršen (prekinuto punjenje) – brišem ga i punim ponovno…`);
      await deleteTenant(db, existing.id);
    }
    const tenantId = await bootstrapTenant(db, slug, opts.tenantName ?? DEMO_TENANT_NAME, password);
    log(`Stanar "${slug}" stvoren; punim podatke kroz API…`);
    const summary = await withInProcessApi(opts.appUrl, async (base, app) => {
      const s = await buildDemo({ base, slug, password, today: opts.today ?? new Date(), log });
      await demoRetentionRun(db, app, tenantId, log);
      return s;
    });
    await db.execute(sql`update tenants set settings = settings || ${JSON.stringify({ demo: true, complete: true, seededAt: new Date().toISOString() })}::jsonb where id = ${tenantId}`);
    return { status: 'created', tenantId, slug, password, users, summary };
  } finally {
    await pool.end();
  }
}
