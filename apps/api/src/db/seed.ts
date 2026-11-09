import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, sql } from 'drizzle-orm';
import * as schema from './schema';
import { IdentityService } from '../identity/identity.service';
import { hashPassword } from '../identity/password';

/** Pod vlasničkom vezom: sistemske uloge + (ako ne postoji) demo stanar s administratorom. */
export async function seedDemo(opts: { url?: string; tenantSlug?: string; tenantName?: string; adminEmail?: string; adminPassword?: string } = {}) {
  const url = opts.url ?? process.env.DATABASE_MIGRATE_URL ?? 'postgres://arqus:arqus@127.0.0.1:5432/arqus';
  const tenantSlug = opts.tenantSlug ?? process.env.SEED_TENANT_SLUG ?? 'demo';
  const tenantName = opts.tenantName ?? process.env.SEED_TENANT_NAME ?? 'Demo institucija';
  const adminEmail = (opts.adminEmail ?? process.env.SEED_ADMIN_EMAIL ?? 'admin@demo.local').toLowerCase();
  const adminPassword = opts.adminPassword ?? process.env.SEED_ADMIN_PASSWORD ?? 'Demo-lozinka-1';
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
      let admin = (await tx.select().from(schema.users).where(eq(schema.users.email, adminEmail)))[0];
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
