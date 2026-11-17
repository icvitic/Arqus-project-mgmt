import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { and, eq, sql } from 'drizzle-orm';
import { passwordIssues } from '@arqus/domain';
import * as schema from './schema';
import { IdentityService } from '../identity/identity.service';
import { hashPassword } from '../identity/password';
import { ProgrammePackagesService } from '../programmes/programme-packages.service';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Pod vlasničkom vezom: sistemske uloge + (ako ne postoji) demo stanar s administratorom. */
function defaultPackagesDir(): string | undefined {
  for (const p of [process.env.ARQUS_PACKAGES_DIR, join(process.cwd(), 'docs', 'domena', 'paketi'), join(process.cwd(), '..', '..', 'docs', 'domena', 'paketi'), join(__dirname, '..', '..', '..', '..', 'docs', 'domena', 'paketi')]) {
    if (p && existsSync(p)) return p;
  }
  return undefined;
}

/** Uvoz globalnih paketa programa iz mape (vlasnička veza). */
export async function importGlobalPackages(url: string, dir = defaultPackagesDir()) {
  if (!dir) throw new Error('Mapa s paketima programa nije pronađena (ARQUS_PACKAGES_DIR)');
  const pool = new Pool({ connectionString: url, max: 1 });
  try { return await drizzle(pool, { schema }).transaction((tx) => ProgrammePackagesService.importDir(tx, dir)); }
  finally { await pool.end(); }
}

/** Zadane vrijednosti razvojnog seeda (`pnpm db:seed`); lokalno pokretanje i e2e u pregledniku. */
export const SEED_DEFAULTS = { tenantSlug: 'razvoj', tenantName: 'Razvojna institucija', adminEmail: 'admin@razvoj.local', adminPassword: 'Zeleni-Kamen-2026' } as const;

export async function seedDemo(opts: { url?: string; tenantSlug?: string; tenantName?: string; adminEmail?: string; adminPassword?: string; importPackages?: boolean } = {}) {
  const url = opts.url ?? process.env.DATABASE_MIGRATE_URL ?? 'postgres://arqus:arqus@127.0.0.1:5432/arqus';
  // WP1.14b: zadana oznaka razvojne institucije ne smije se poklapati s demo institucijom (`demo` – `cli demo`), a zadana
  // lozinka mora zadovoljiti politiku lozinki (ista provjera kao pri stvaranju korisnika kroz API).
  const tenantSlug = opts.tenantSlug ?? process.env.SEED_TENANT_SLUG ?? SEED_DEFAULTS.tenantSlug;
  const tenantName = opts.tenantName ?? process.env.SEED_TENANT_NAME ?? SEED_DEFAULTS.tenantName;
  const adminEmail = (opts.adminEmail ?? process.env.SEED_ADMIN_EMAIL ?? SEED_DEFAULTS.adminEmail).toLowerCase();
  const adminPassword = opts.adminPassword ?? process.env.SEED_ADMIN_PASSWORD ?? SEED_DEFAULTS.adminPassword;
  // Lozinka iz okruženja (SEED_ADMIN_PASSWORD) ili zadana prolazi istu provjeru kao lozinka zadana kroz API; testovi koji je
  // zadaju izravno (`opts.adminPassword`) koriste namjerno kratke lozinke i ne provjeravaju se.
  if (opts.adminPassword === undefined) {
    const issues = passwordIssues(adminPassword, { email: adminEmail, displayName: 'Administrator', tenantSlug });
    if (issues.length) throw new Error(`Lozinka administratora (SEED_ADMIN_PASSWORD) ne zadovoljava pravila: ${issues.join('; ')}`);
  }
  if (opts.importPackages !== false) await importGlobalPackages(url);
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool, { schema });
  try {
    const result = await db.transaction(async (tx) => {
      await IdentityService.ensureSystemRoles(tx);
      let tenant = (await tx.select().from(schema.tenants).where(eq(schema.tenants.slug, tenantSlug)))[0];
      if (!tenant) {
        [tenant] = await tx.insert(schema.tenants).values({ slug: tenantSlug, name: tenantName }).returning();
      }
      if (!tenant) throw new Error('Stanar nije stvoren');
      await tx.execute(sql`select set_config('app.tenant_id', ${tenant.id}, true)`);
      // Vlasnička veza zaobilazi RLS – administrator se uvijek traži unutar ovog stanara (ista e-adresa u drugom stanaru je drugi korisnik).
      let admin = (await tx.select().from(schema.users).where(and(eq(schema.users.tenantId, tenant.id), eq(schema.users.email, adminEmail))))[0];
      if (!admin) {
        [admin] = await tx.insert(schema.users).values({ tenantId: tenant.id, email: adminEmail, displayName: 'Administrator', passwordHash: await hashPassword(adminPassword), status: 'active' }).returning();
        const role = (await tx.select().from(schema.roles).where(eq(schema.roles.code, 'tenant-admin')))[0];
        if (!admin || !role) throw new Error('Seed nije uspio');
        await tx.insert(schema.roleAssignments).values({ tenantId: tenant.id, userId: admin.id, roleId: role.id });
      }
      return { tenantId: tenant.id, adminId: admin.id };
    });
    return { ...result, tenantSlug, adminEmail, adminPassword };
  } finally {
    await pool.end();
  }
}
