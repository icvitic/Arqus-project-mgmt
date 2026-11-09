import { pgTable, uuid, text, timestamp, jsonb, boolean, bigserial, index, uniqueIndex, inet } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Zajednički stupci svakog agregata (domenski model, odj. 2). */
const audited = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};

/** M1 Stanar – granica izolacije podataka. RLS: stanar vidi samo vlastiti redak. */
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  identifiers: jsonb('identifiers').$type<{ oib?: string; pic?: string; vat?: string }>().notNull().default({}),
  defaultCurrency: text('default_currency').notNull().default('EUR'),
  language: text('language').notNull().default('hr'),
  plan: text('plan').notNull().default('institucija'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  ...audited,
});

export type UserStatus = 'invited' | 'active' | 'disabled';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash'),
  status: text('status').$type<UserStatus>().notNull().default('invited'),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...audited,
}, (t) => [uniqueIndex('users_tenant_email_uq').on(t.tenantId, t.email)]);

/** Uloga: sistemska (tenant_id NULL, vidljiva svima, samo za čitanje) ili stanarska. */
export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  permissions: text('permissions').array().notNull().default(sql`'{}'::text[]`),
  scope: text('scope').$type<'tenant' | 'project'>().notNull().default('tenant'),
  ...audited,
}, (t) => [uniqueIndex('roles_tenant_code_uq').on(t.tenantId, t.code).where(sql`tenant_id is not null`), uniqueIndex('roles_system_code_uq').on(t.code).where(sql`tenant_id is null`)]);

export const roleAssignments = pgTable('role_assignments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  roleId: uuid('role_id').notNull().references(() => roles.id),
  projectId: uuid('project_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [index('role_assignments_user_idx').on(t.tenantId, t.userId)]);

/** M11 Revizijski zapis – samo dodavanje (aplikacijska uloga nema UPDATE/DELETE). */
export const auditEntries = pgTable('audit_entries', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  actorType: text('actor_type').$type<'user' | 'system' | 'ai'>().notNull(),
  actorId: uuid('actor_id'),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  action: text('action').notNull(),
  diff: jsonb('diff').$type<{ before?: unknown; after?: unknown; meta?: Record<string, unknown> }>(),
  ip: inet('ip'),
  sessionId: text('session_id'),
}, (t) => [index('audit_tenant_at_idx').on(t.tenantId, t.at), index('audit_entity_idx').on(t.tenantId, t.entity, t.entityId)]);

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type AuditEntry = typeof auditEntries.$inferSelect;

/** M2 Paket programa u bazi: globalni (tenant_id NULL, održava Arqus) ili stanarski. Sadržaj = JSON validiran shemom v1. */
export type PackageStatus = 'draft' | 'published' | 'deprecated';
export const programmePackages = pgTable('programme_packages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  packageId: text('package_id').notNull(),
  version: text('version').notNull(),
  programme: text('programme').notNull(),
  funder: text('funder'),
  status: text('status').$type<PackageStatus>().notNull().default('draft'),
  extendsId: text('extends_id'),
  validFrom: text('valid_from').notNull(),
  validTo: text('valid_to'),
  content: jsonb('content').$type<Record<string, unknown>>().notNull(),
  checksum: text('checksum').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  ...audited,
}, (t) => [
  uniqueIndex('programme_packages_tenant_uq').on(t.tenantId, t.packageId, t.version).where(sql`tenant_id is not null`),
  uniqueIndex('programme_packages_global_uq').on(t.packageId, t.version).where(sql`tenant_id is null`),
  index('programme_packages_lookup_idx').on(t.packageId, t.status),
]);
export type ProgrammePackageRow = typeof programmePackages.$inferSelect;
