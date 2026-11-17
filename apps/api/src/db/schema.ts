import { pgTable, uuid, text, timestamp, jsonb, boolean, bigserial, bigint, index, uniqueIndex, inet, integer, date, unique, foreignKey, check } from 'drizzle-orm/pg-core';
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
  mfaSecretEnc: text('mfa_secret_enc'),
  mfaPendingEnc: text('mfa_pending_enc'),
  mfaLastStep: bigint('mfa_last_step', { mode: 'number' }),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...audited,
}, (t) => [uniqueIndex('users_tenant_email_uq').on(t.tenantId, t.email), unique('users_tenant_id_uq').on(t.tenantId, t.id)]);

/** Sesija prijave (id = `sid` u JWT-u). Provjerava se pri svakom zahtjevu: opoziv i deaktivacija vrijede odmah (ASVS V3.3). */
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ip: inet('ip'),
  userAgent: text('user_agent'),
}, (t) => [
  index('sessions_user_idx').on(t.tenantId, t.userId),
  foreignKey({ name: 'sessions_user_fk', columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }).onDelete('cascade'),
]);

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
  /** NULL = uloga na razini institucije (svi projekti); inače uloga vrijedi samo na tom projektu (WP1.14). */
  projectId: uuid('project_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  index('role_assignments_user_idx').on(t.tenantId, t.userId),
  index('role_assignments_project_idx').on(t.tenantId, t.projectId),
  foreignKey({ name: 'role_assignments_project_fk', columns: [t.tenantId, t.projectId], foreignColumns: [projects.tenantId, projects.id] }).onDelete('cascade'),
]);

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
  unique('project_partners_tenant_id_uq').on(t.tenantId, t.id),
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
  unique('reporting_periods_tenant_id_uq').on(t.tenantId, t.id),
  uniqueIndex('reporting_periods_uq').on(t.projectId, t.number),
  foreignKey({ name: 'reporting_periods_project_fk', columns: [t.tenantId, t.projectId], foreignColumns: [projects.tenantId, projects.id] }).onDelete('cascade'),
]);

/* ---------- M6 Provedba: radni paketi, zadaci, isporuke, prekretnice, rizici ---------- */
const projectFk = (name: string, t: { tenantId: unknown; projectId: unknown }) =>
  foreignKey({ name, columns: [t.tenantId as never, t.projectId as never], foreignColumns: [projects.tenantId, projects.id] }).onDelete('cascade');
const partnerFk = (name: string, t: { tenantId: unknown; leadPartnerId: unknown }) =>
  foreignKey({ name, columns: [t.tenantId as never, t.leadPartnerId as never], foreignColumns: [projectPartners.tenantId, projectPartners.id] });

export const workPackages = pgTable('work_packages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  leadPartnerId: uuid('lead_partner_id'),
  startMonth: integer('start_month').notNull(),
  endMonth: integer('end_month').notNull(),
  objectives: text('objectives'),
  ...audited,
}, (t) => [
  unique('work_packages_tenant_id_uq').on(t.tenantId, t.id),
  uniqueIndex('work_packages_number_uq').on(t.projectId, t.number),
  projectFk('work_packages_project_fk', t), partnerFk('work_packages_lead_fk', t),
  check('work_packages_months_ck', sql`start_month >= 1 and end_month >= start_month`),
]);

const wpFk = (name: string, t: { tenantId: unknown; workPackageId: unknown }) =>
  foreignKey({ name, columns: [t.tenantId as never, t.workPackageId as never], foreignColumns: [workPackages.tenantId, workPackages.id] });

export type TaskStatus = 'planned' | 'in_progress' | 'done' | 'cancelled';
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  projectId: uuid('project_id').notNull(),
  workPackageId: uuid('work_package_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  leadPartnerId: uuid('lead_partner_id'),
  startMonth: integer('start_month').notNull(),
  endMonth: integer('end_month').notNull(),
  status: text('status').$type<TaskStatus>().notNull().default('planned'),
  ...audited,
}, (t) => [
  uniqueIndex('tasks_number_uq').on(t.workPackageId, t.number),
  projectFk('tasks_project_fk', t), wpFk('tasks_wp_fk', t), partnerFk('tasks_lead_fk', t),
  check('tasks_months_ck', sql`start_month >= 1 and end_month >= start_month`),
]);

export type DeliverableStatus = 'planned' | 'in_progress' | 'submitted' | 'accepted' | 'rejected';
export const deliverables = pgTable('deliverables', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  projectId: uuid('project_id').notNull(),
  workPackageId: uuid('work_package_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  type: text('type').notNull(),
  dissemination: text('dissemination').notNull(),
  dueMonth: integer('due_month').notNull(),
  leadPartnerId: uuid('lead_partner_id'),
  status: text('status').$type<DeliverableStatus>().notNull().default('planned'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  ...audited,
}, (t) => [
  uniqueIndex('deliverables_number_uq').on(t.workPackageId, t.number),
  index('deliverables_due_idx').on(t.tenantId, t.dueMonth),
  projectFk('deliverables_project_fk', t), wpFk('deliverables_wp_fk', t), partnerFk('deliverables_lead_fk', t),
  check('deliverables_month_ck', sql`due_month >= 1`),
]);

export type MilestoneStatus = 'planned' | 'achieved' | 'missed';
export const milestones = pgTable('milestones', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  dueMonth: integer('due_month').notNull(),
  verification: text('verification'),
  status: text('status').$type<MilestoneStatus>().notNull().default('planned'),
  ...audited,
}, (t) => [uniqueIndex('milestones_number_uq').on(t.projectId, t.number), projectFk('milestones_project_fk', t), check('milestones_month_ck', sql`due_month >= 1`)]);

export type RiskStatus = 'open' | 'mitigated' | 'occurred' | 'closed';
export const risks = pgTable('risks', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  description: text('description').notNull(),
  likelihood: integer('likelihood').notNull(),
  impact: integer('impact').notNull(),
  mitigation: text('mitigation'),
  ownerUserId: uuid('owner_user_id'),
  status: text('status').$type<RiskStatus>().notNull().default('open'),
  ...audited,
}, (t) => [
  uniqueIndex('risks_number_uq').on(t.projectId, t.number), projectFk('risks_project_fk', t),
  foreignKey({ name: 'risks_owner_fk', columns: [t.tenantId, t.ownerUserId], foreignColumns: [users.tenantId, users.id] }),
  check('risks_scale_ck', sql`likelihood between 1 and 3 and impact between 1 and 3`),
]);

/* ---------- M7 Proračun projekta (verzioniran; v1 se zaključava aktivacijom, kasnije verzije amandmanom) ---------- */
export type BudgetStatus = 'draft' | 'locked';
export const projectBudgets = pgTable('project_budgets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  projectId: uuid('project_id').notNull(),
  version: integer('version').notNull(),
  status: text('status').$type<BudgetStatus>().notNull().default('draft'),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  ...audited,
}, (t) => [unique('project_budgets_tenant_id_uq').on(t.tenantId, t.id), uniqueIndex('project_budgets_version_uq').on(t.projectId, t.version), projectFk('project_budgets_project_fk', t)]);

export const budgetLines = pgTable('budget_lines', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  budgetId: uuid('budget_id').notNull(),
  partnerId: uuid('partner_id').notNull(),
  categoryCode: text('category_code').notNull(),
  workPackageId: uuid('work_package_id'),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  index('budget_lines_budget_idx').on(t.budgetId),
  foreignKey({ name: 'budget_lines_budget_fk', columns: [t.tenantId, t.budgetId], foreignColumns: [projectBudgets.tenantId, projectBudgets.id] }).onDelete('cascade'),
  foreignKey({ name: 'budget_lines_partner_fk', columns: [t.tenantId, t.partnerId], foreignColumns: [projectPartners.tenantId, projectPartners.id] }),
  wpFk('budget_lines_wp_fk', t),
  check('budget_lines_amount_ck', sql`amount_cents >= 0`),
]);

/* ---------- M7 Financije: tim, timesheetovi, troškovi, zahtjevi za nadoknadu (ZNS) ---------- */
export const teamMembers = pgTable('team_members', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  projectId: uuid('project_id').notNull(),
  partnerId: uuid('partner_id').notNull(),
  userId: uuid('user_id'),
  fullName: text('full_name').notNull(),
  role: text('role'),
  /** Godišnji trošak (plaća); NULL dok ga ne upiše uloga s personnel:read (WP1.14). */
  annualCostCents: bigint('annual_cost_cents', { mode: 'number' }),
  active: boolean('active').notNull().default(true),
  ...audited,
}, (t) => [
  unique('team_members_tenant_id_uq').on(t.tenantId, t.id),
  uniqueIndex('team_members_user_uq').on(t.projectId, t.userId).where(sql`user_id is not null`),
  projectFk('team_members_project_fk', t),
  foreignKey({ name: 'team_members_partner_fk', columns: [t.tenantId, t.partnerId], foreignColumns: [projectPartners.tenantId, projectPartners.id] }),
  foreignKey({ name: 'team_members_user_fk', columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }),
  check('team_members_cost_ck', sql`annual_cost_cents >= 0`),
]);

export type TimesheetStatus = 'draft' | 'submitted' | 'approved' | 'locked';
export const timesheets = pgTable('timesheets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  projectId: uuid('project_id').notNull(),
  teamMemberId: uuid('team_member_id').notNull(),
  month: text('month').notNull(),
  status: text('status').$type<TimesheetStatus>().notNull().default('draft'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: uuid('approved_by'),
  ...audited,
}, (t) => [
  unique('timesheets_tenant_id_uq').on(t.tenantId, t.id),
  uniqueIndex('timesheets_member_month_uq').on(t.teamMemberId, t.month),
  projectFk('timesheets_project_fk', t),
  foreignKey({ name: 'timesheets_member_fk', columns: [t.tenantId, t.teamMemberId], foreignColumns: [teamMembers.tenantId, teamMembers.id] }),
  check('timesheets_month_ck', sql`month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
]);

export const timesheetEntries = pgTable('timesheet_entries', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  timesheetId: uuid('timesheet_id').notNull(),
  day: integer('day').notNull(),
  workPackageId: uuid('work_package_id'),
  minutes: integer('minutes').notNull(),
}, (t) => [
  index('timesheet_entries_ts_idx').on(t.timesheetId),
  foreignKey({ name: 'timesheet_entries_ts_fk', columns: [t.tenantId, t.timesheetId], foreignColumns: [timesheets.tenantId, timesheets.id] }).onDelete('cascade'),
  wpFk('timesheet_entries_wp_fk', t),
  check('timesheet_entries_ck', sql`day between 1 and 31 and minutes between 0 and 1440`),
]);

export type ClaimStatus = 'draft' | 'submitted' | 'approved' | 'partially_approved' | 'rejected';
export const reimbursementClaims = pgTable('reimbursement_claims', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  projectId: uuid('project_id').notNull(),
  reportingPeriodId: uuid('reporting_period_id').notNull(),
  partnerId: uuid('partner_id').notNull(),
  status: text('status').$type<ClaimStatus>().notNull().default('draft'),
  totals: jsonb('totals').$type<Record<string, unknown>>(),
  requestedCents: bigint('requested_cents', { mode: 'number' }),
  approvedCents: bigint('approved_cents', { mode: 'number' }),
  paidCents: bigint('paid_cents', { mode: 'number' }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  paidAt: date('paid_at', { mode: 'string' }),
  note: text('note'),
  /** WP1.16a: razlog predaje prije kraja razdoblja (obavezan za ranu predaju). */
  earlyReason: text('early_reason'),
  /** WP1.16a: snimka pri predaji – upozorenja popisa za provjeru i potvrđeni troškovi bez dokaza. */
  submission: jsonb('submission').$type<Record<string, unknown>>(),
  /** WP1.16a: datum odluke financijera (ne vrijeme unosa) i izračun priznatog iznosa uz iznos financijera. */
  decisionDate: date('decision_date', { mode: 'string' }),
  decision: jsonb('decision').$type<Record<string, unknown>>(),
  paymentNote: text('payment_note'),
  ...audited,
}, (t) => [
  unique('reimbursement_claims_tenant_id_uq').on(t.tenantId, t.id),
  uniqueIndex('reimbursement_claims_period_partner_uq').on(t.reportingPeriodId, t.partnerId),
  projectFk('reimbursement_claims_project_fk', t),
  foreignKey({ name: 'reimbursement_claims_period_fk', columns: [t.tenantId, t.reportingPeriodId], foreignColumns: [reportingPeriods.tenantId, reportingPeriods.id] }),
  foreignKey({ name: 'reimbursement_claims_partner_fk', columns: [t.tenantId, t.partnerId], foreignColumns: [projectPartners.tenantId, projectPartners.id] }),
]);

export type ExpenseStatus = 'recorded' | 'claimed' | 'accepted' | 'partially_accepted' | 'rejected';
export const expenses = pgTable('expenses', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  projectId: uuid('project_id').notNull(),
  partnerId: uuid('partner_id').notNull(),
  categoryCode: text('category_code').notNull(),
  workPackageId: uuid('work_package_id'),
  date: date('date', { mode: 'string' }).notNull(),
  description: text('description').notNull(),
  supplier: text('supplier'),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  evidenceRef: text('evidence_ref'),
  source: text('source').$type<'manual' | 'timesheet'>().notNull().default('manual'),
  timesheetId: uuid('timesheet_id'),
  claimId: uuid('claim_id'),
  status: text('status').$type<ExpenseStatus>().notNull().default('recorded'),
  /** WP1.16a: priznati iznos iz odluke o ZNS-u (null dok odluke nema; odbijen = 0) i razlog umanjenja ili odbijanja. */
  recognisedCents: bigint('recognised_cents', { mode: 'number' }),
  decisionReason: text('decision_reason'),
  ...audited,
}, (t) => [
  index('expenses_project_date_idx').on(t.projectId, t.date),
  projectFk('expenses_project_fk', t),
  foreignKey({ name: 'expenses_partner_fk', columns: [t.tenantId, t.partnerId], foreignColumns: [projectPartners.tenantId, projectPartners.id] }),
  wpFk('expenses_wp_fk', t),
  foreignKey({ name: 'expenses_timesheet_fk', columns: [t.tenantId, t.timesheetId], foreignColumns: [timesheets.tenantId, timesheets.id] }).onDelete('cascade'),
  foreignKey({ name: 'expenses_claim_fk', columns: [t.tenantId, t.claimId], foreignColumns: [reimbursementClaims.tenantId, reimbursementClaims.id] }),
  check('expenses_amount_ck', sql`amount_cents >= 0`),
  check('expenses_claim_status_ck', sql`(status = 'recorded') = (claim_id is null)`),
  // Priznati iznos postoji točno kad je o trošku odlučeno, i odgovara statusu (cijeli / umanjen / 0).
  check('expenses_decision_ck', sql`(status in ('accepted', 'partially_accepted', 'rejected')) = (recognised_cents is not null)
    and (recognised_cents is null or recognised_cents between 0 and amount_cents)
    and (status <> 'accepted' or recognised_cents = amount_cents)
    and (status <> 'rejected' or recognised_cents = 0)
    and (status <> 'partially_accepted' or (recognised_cents > 0 and recognised_cents < amount_cents))`),
]);

/* ---------- M3 Radar poziva ---------- */
/** Poziv: globalni (tenant_id NULL, uvoz iz javnih izvora) ili vlastiti stanara (ručni unos). Rokovi u JSON-u (vrsta, vrijeme s vremenskom zonom). */
export const calls = pgTable('calls', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  code: text('code').notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
  programme: text('programme').notNull(),
  funder: text('funder'),
  packageId: text('package_id'),
  actionTypes: text('action_types').array().notNull().default(sql`'{}'::text[]`),
  budgetCents: bigint('budget_cents', { mode: 'number' }),
  expectedGrants: integer('expected_grants'),
  opensAt: date('opens_at', { mode: 'string' }),
  deadlines: jsonb('deadlines').$type<{ kind: string; at: string; label?: string }[]>().notNull().default([]),
  url: text('url'),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  cancelled: boolean('cancelled').notNull().default(false),
  /** Izvor globalnog poziva: ručni unos ili uvoz s portala EU Funding & Tenders (osvježava se, ručni se ne prepisuju). */
  source: text('source').$type<'manual' | 'ft'>().notNull().default('manual'),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  ...audited,
}, (t) => [
  check('calls_source_ck', sql`source in ('manual','ft')`),
  uniqueIndex('calls_tenant_code_uq').on(t.tenantId, t.code).where(sql`tenant_id is not null`),
  uniqueIndex('calls_global_code_uq').on(t.code).where(sql`tenant_id is null`),
]);

/** Praćenje poziva u instituciji: ocjena prikladnosti, odluka go/no-go, interni rok, odgovorna osoba. Povijest promjena u reviziji. */
export type CallDecision = 'go' | 'no_go' | 'watch';
export const callTracking = pgTable('call_tracking', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  callId: uuid('call_id').notNull().references(() => calls.id, { onDelete: 'cascade' }),
  fitScores: jsonb('fit_scores').$type<Record<string, number>>(),
  fitTotal: integer('fit_total'),
  fitComment: text('fit_comment'),
  assessedBy: uuid('assessed_by'),
  assessedAt: timestamp('assessed_at', { withTimezone: true }),
  decision: text('decision').$type<CallDecision>(),
  rationale: text('rationale'),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  internalDeadline: date('internal_deadline', { mode: 'string' }),
  ownerUserId: uuid('owner_user_id'),
  ...audited,
}, (t) => [
  uniqueIndex('call_tracking_uq').on(t.tenantId, t.callId),
  foreignKey({ name: 'call_tracking_owner_fk', columns: [t.tenantId, t.ownerUserId], foreignColumns: [users.tenantId, users.id] }),
  check('call_tracking_fit_ck', sql`fit_total is null or fit_total between 0 and 100`),
]);

export type CallRow = typeof calls.$inferSelect;

/* ---------- M5 Prijava (ADR-0006: zaseban agregat; ugovaranje kopira u projekt) ---------- */
export type ProposalStatusCol = 'idea' | 'preparation' | 'internal_review' | 'submitted' | 'in_evaluation' | 'funded' | 'reserve' | 'rejected' | 'withdrawn' | 'contracted';
export const proposals = pgTable('proposals', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  callId: uuid('call_id').references(() => calls.id),
  packageRowId: uuid('package_row_id').notNull().references(() => programmePackages.id),
  packageId: text('package_id').notNull(),
  packageVersion: text('package_version').notNull(),
  actionType: text('action_type').notNull(),
  acronym: text('acronym').notNull(),
  title: text('title').notNull(),
  role: text('role').$type<'coordinator' | 'partner'>().notNull().default('coordinator'),
  leadUserId: uuid('lead_user_id'),
  status: text('status').$type<ProposalStatusCol>().notNull().default('idea'),
  durationMonths: integer('duration_months').notNull().default(36),
  internalDeadline: date('internal_deadline', { mode: 'string' }),
  budgetVersion: integer('budget_version').notNull().default(1),
  budgetLocked: boolean('budget_locked').notNull().default(false),
  submission: jsonb('submission').$type<Record<string, unknown>>(),
  outcome: jsonb('outcome').$type<{ result: string; score?: string; note?: string; at: string }>(),
  projectId: uuid('project_id'),
  ...audited,
}, (t) => [
  unique('proposals_tenant_id_uq').on(t.tenantId, t.id),
  index('proposals_status_idx').on(t.tenantId, t.status),
  foreignKey({ name: 'proposals_lead_fk', columns: [t.tenantId, t.leadUserId], foreignColumns: [users.tenantId, users.id] }),
  foreignKey({ name: 'proposals_project_fk', columns: [t.tenantId, t.projectId], foreignColumns: [projects.tenantId, projects.id] }),
  check('proposals_duration_ck', sql`duration_months between 1 and 120`),
]);

const proposalFk = (name: string, t: { tenantId: unknown; proposalId: unknown }) =>
  foreignKey({ name, columns: [t.tenantId as never, t.proposalId as never], foreignColumns: [proposals.tenantId, proposals.id] }).onDelete('cascade');

export const proposalMembers = pgTable('proposal_members', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  proposalId: uuid('proposal_id').notNull(),
  organisationId: uuid('organisation_id').notNull(),
  role: text('role').$type<'coordinator' | 'partner' | 'associated' | 'third_party'>().notNull().default('partner'),
  beneficiaryType: text('beneficiary_type').notNull().default('default'),
  confirmed: boolean('confirmed').notNull().default(false),
  orderNo: integer('order_no').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  unique('proposal_members_tenant_id_uq').on(t.tenantId, t.id),
  uniqueIndex('proposal_members_uq').on(t.proposalId, t.organisationId),
  proposalFk('proposal_members_proposal_fk', t),
  foreignKey({ name: 'proposal_members_org_fk', columns: [t.tenantId, t.organisationId], foreignColumns: [organisations.tenantId, organisations.id] }),
]);

export const proposalWorkPackages = pgTable('proposal_work_packages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  proposalId: uuid('proposal_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  leadMemberId: uuid('lead_member_id'),
  startMonth: integer('start_month').notNull(),
  endMonth: integer('end_month').notNull(),
  personMonths: integer('person_months').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('proposal_wp_number_uq').on(t.proposalId, t.number),
  proposalFk('proposal_wp_proposal_fk', t),
  foreignKey({ name: 'proposal_wp_lead_fk', columns: [t.tenantId, t.leadMemberId], foreignColumns: [proposalMembers.tenantId, proposalMembers.id] }),
  check('proposal_wp_months_ck', sql`start_month >= 1 and end_month >= start_month and person_months >= 0`),
]);

export const proposalBudgetLines = pgTable('proposal_budget_lines', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  proposalId: uuid('proposal_id').notNull(),
  memberId: uuid('member_id').notNull(),
  categoryCode: text('category_code').notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('proposal_budget_lines_idx').on(t.proposalId),
  proposalFk('proposal_budget_proposal_fk', t),
  foreignKey({ name: 'proposal_budget_member_fk', columns: [t.tenantId, t.memberId], foreignColumns: [proposalMembers.tenantId, proposalMembers.id] }).onDelete('cascade'),
  check('proposal_budget_amount_ck', sql`amount_cents >= 0`),
]);

/** M9 Dokumenti: logički dokument vezan uz entitet projekta ili prijave; verzije su nepromjenjive (samo INSERT za aplikaciju). */
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  projectId: uuid('project_id'),
  proposalId: uuid('proposal_id'),
  entityType: text('entity_type').$type<'project' | 'expense' | 'deliverable' | 'claim' | 'proposal'>().notNull(),
  entityId: uuid('entity_id').notNull(),
  title: text('title').notNull(),
  kind: text('kind').notNull().default('other'),
  confidentiality: text('confidentiality').$type<'public' | 'internal' | 'confidential'>().notNull().default('internal'),
  aiGenerated: boolean('ai_generated').notNull().default(false),
  currentVersion: integer('current_version').notNull().default(1),
  ...audited,
}, (t) => [
  unique('documents_tenant_id_uq').on(t.tenantId, t.id),
  index('documents_entity_idx').on(t.entityType, t.entityId),
  index('documents_project_idx').on(t.projectId),
  foreignKey({ name: 'documents_project_fk', columns: [t.tenantId, t.projectId], foreignColumns: [projects.tenantId, projects.id] }).onDelete('cascade'),
  foreignKey({ name: 'documents_proposal_fk', columns: [t.tenantId, t.proposalId], foreignColumns: [proposals.tenantId, proposals.id] }).onDelete('cascade'),
  check('documents_owner_ck', sql`(project_id is not null) <> (proposal_id is not null)`),
  check('documents_conf_ck', sql`confidentiality in ('public','internal','confidential')`),
]);

export const documentVersions = pgTable('document_versions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  documentId: uuid('document_id').notNull(),
  version: integer('version').notNull(),
  storageKey: text('storage_key').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (t) => [
  uniqueIndex('document_versions_doc_ver_uq').on(t.documentId, t.version),
  foreignKey({ name: 'document_versions_doc_fk', columns: [t.tenantId, t.documentId], foreignColumns: [documents.tenantId, documents.id] }).onDelete('cascade'),
  check('document_versions_size_ck', sql`size_bytes > 0`),
]);
export type DocumentRow = typeof documents.$inferSelect;
export type Proposal = typeof proposals.$inferSelect;
export type WorkPackage = typeof workPackages.$inferSelect;
export type Deliverable = typeof deliverables.$inferSelect;
export type Organisation = typeof organisations.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectPartner = typeof projectPartners.$inferSelect;
export type ReportingPeriod = typeof reportingPeriods.$inferSelect;
