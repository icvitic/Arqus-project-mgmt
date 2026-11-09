import { pgTable, uuid, text, timestamp, jsonb, boolean, bigserial, index, uniqueIndex, inet, integer, date, unique, foreignKey } from 'drizzle-orm/pg-core';
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
}, (t) => [uniqueIndex('users_tenant_email_uq').on(t.tenantId, t.email), unique('users_tenant_id_uq').on(t.tenantId, t.id)]);

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

/*
 * M4 Partneri i M6 Projekt. Kompozitni strani ključevi (tenant_id, id) sprječavaju da redak jednog stanara
 * pokazuje na redak drugog: provjere stranih ključeva u PostgreSQL-u zaobilaze RLS, pa sama RLS politika to ne bi spriječila.
 */
export type OrganisationType = 'university' | 'faculty' | 'institute' | 'sme' | 'large_enterprise' | 'public_body' | 'ngo' | 'other';

export const organisations = pgTable('organisations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  shortName: text('short_name'),
  country: text('country').notNull(),
  type: text('type').$type<OrganisationType>().notNull().default('other'),
  identifiers: jsonb('identifiers').$type<{ pic?: string; oib?: string; vat?: string }>().notNull().default({}),
  nonProfit: boolean('non_profit').notNull().default(false),
  isSelf: boolean('is_self').notNull().default(false),
  website: text('website'),
  ...audited,
}, (t) => [
  unique('organisations_tenant_id_uq').on(t.tenantId, t.id),
  uniqueIndex('organisations_self_uq').on(t.tenantId).where(sql`is_self`),
  index('organisations_name_idx').on(t.tenantId, t.name),
]);

export type ProjectStatusCol = 'contracting' | 'active' | 'suspended' | 'closing' | 'closed' | 'terminated' | 'archived';

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  acronym: text('acronym').notNull(),
  title: text('title').notNull(),
  packageRowId: uuid('package_row_id').notNull().references(() => programmePackages.id),
  packageId: text('package_id').notNull(),
  packageVersion: text('package_version').notNull(),
  actionType: text('action_type').notNull(),
  role: text('role').$type<'coordinator' | 'partner'>().notNull().default('coordinator'),
  status: text('status').$type<ProjectStatusCol>().notNull().default('contracting'),
  contractNo: text('contract_no'),
  startDate: date('start_date', { mode: 'string' }),
  durationMonths: integer('duration_months'),
  managerUserId: uuid('manager_user_id'),
  sourceProposalId: uuid('source_proposal_id'),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  ...audited,
}, (t) => [
  unique('projects_tenant_id_uq').on(t.tenantId, t.id),
  uniqueIndex('projects_contract_uq').on(t.tenantId, t.contractNo).where(sql`contract_no is not null`),
  index('projects_status_idx').on(t.tenantId, t.status),
  foreignKey({ name: 'projects_manager_fk', columns: [t.tenantId, t.managerUserId], foreignColumns: [users.tenantId, users.id] }),
]);

export const projectPartners = pgTable('project_partners', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  projectId: uuid('project_id').notNull(),
  organisationId: uuid('organisation_id').notNull(),
  role: text('role').$type<'coordinator' | 'partner' | 'associated' | 'third_party'>().notNull().default('partner'),
  beneficiaryType: text('beneficiary_type').notNull().default('default'),
  orderNo: integer('order_no').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  uniqueIndex('project_partners_uq').on(t.projectId, t.organisationId),
  foreignKey({ name: 'project_partners_project_fk', columns: [t.tenantId, t.projectId], foreignColumns: [projects.tenantId, projects.id] }).onDelete('cascade'),
  foreignKey({ name: 'project_partners_org_fk', columns: [t.tenantId, t.organisationId], foreignColumns: [organisations.tenantId, organisations.id] }),
]);

export const reportingPeriods = pgTable('reporting_periods', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('reporting_periods_uq').on(t.projectId, t.number),
  foreignKey({ name: 'reporting_periods_project_fk', columns: [t.tenantId, t.projectId], foreignColumns: [projects.tenantId, projects.id] }).onDelete('cascade'),
]);

export type Organisation = typeof organisations.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectPartner = typeof projectPartners.$inferSelect;
export type ReportingPeriod = typeof reportingPeriods.$inferSelect;
