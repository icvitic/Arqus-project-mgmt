import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { createHmac, randomUUID } from 'node:crypto';
import { passwordIssues, timeZoneOr } from '@arqus/domain';
import { DbService, type Tx } from '../db/db.service';
import { calendarTokens, projects, proposals, tenants, users, roles, roleAssignments, sessions, type User } from '../db/schema';
import { hashPassword, verifyPassword, verifyPasswordOrBurn } from './password';
import { TokenService } from './token.service';
import { AuditService } from '../audit/audit.service';
import { hasPermission, SYSTEM_ROLES } from './permissions';
import { TenantContext, type RequestContext } from '../common/tenant-context';
import { canInTenant, canOnProject, projectGrants } from '../common/access';
import { loadProject } from '../common/project-access';
import { acronymOf, findRole, grantProjectRole } from './project-grants';
import { notify } from '../notifications/notify';
import { LoginThrottle } from './login-throttle';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';
import { open, seal } from '../common/crypto-box';
import { ttlSeconds } from './ttl';
import { MFA_POLICIES, mfaPolicyOf, mfaRequiredFor, PRIVILEGED_PERMISSIONS, type MfaPolicy } from './mfa-policy';

export interface LoginInput { tenantSlug: string; email: string; password: string; code?: string }
export interface CreateUserInput { email: string; displayName: string; password?: string; roleCodes?: string[] }
export interface UpdateUserInput { displayName?: string; status?: 'active' | 'disabled'; roleCodes?: string[] }
interface ClientInfo { ip?: string; userAgent?: string }
/** Dozvole korisnika (WP1.14): na razini institucije i po projektu (id projekta → dozvole); WP1.14b: prijave kojima je voditelj. */
export interface UserAccess { tenant: string[]; projects: Record<string, string[]>; leadProposals: string[] }

const publicUser = (u: User) => ({ id: u.id, tenantId: u.tenantId, email: u.email, displayName: u.displayName, status: u.status, mfaEnabled: u.mfaEnabled, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt });

/**
 * WP1.19: nepovratni otisak upisane e-adrese za zapis neuspjele prijave na nepoznati račun – HMAC-SHA256 s tajnom
 * poslužitelja (nije u bazi), skraćen na 16 heksadekadskih znakova. Isti unos daje isti otisak (ponovljeni pokušaji se
 * mogu povezati), a iz zapisa se upisani tekst ne može dobiti.
 */
export function inputFingerprint(tenantSlug: string, email: string): string {
  const key = process.env.AUTH_JWT_SECRET ?? 'dev-only-secret-change-me-0123456789';
  return createHmac('sha256', `arqus-login-input|${key}`).update(`${tenantSlug.trim().toLowerCase()}|${email.trim().toLowerCase()}`).digest('hex').slice(0, 16);
}

/** 401 s oznakom da je potreban (ili neispravan) MFA kod – sučelje tada traži kod. */
const mfaRequired = (message: string) => new UnauthorizedException({ statusCode: 401, message, mfaRequired: true });

@Injectable()
export class IdentityService {
  private readonly ttl = ttlSeconds(process.env.AUTH_TOKEN_TTL ?? '8h');
  constructor(private readonly db: DbService, private readonly tokens: TokenService, private readonly audit: AuditService, private readonly throttle: LoginThrottle, private readonly ctx: TenantContext) {}

  /**
   * Dozvole korisnika (WP1.14): uloge bez projekta daju dozvole na razini institucije (svi projekti),
   * uloge dodijeljene na projektu samo na tom projektu. Računa se svježe pri svakom zahtjevu (ne iz tokena).
   */
  async accessOf(tx: Tx, tenantId: string, userId: string): Promise<UserAccess> {
    const rows = await tx.select({ projectId: roleAssignments.projectId, permissions: roles.permissions }).from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(and(eq(roleAssignments.tenantId, tenantId), eq(roleAssignments.userId, userId), isNull(roles.deletedAt)));
    const tenant = new Set<string>(); const byProject = new Map<string, Set<string>>();
    for (const r of rows) {
      const target = r.projectId ? (byProject.get(r.projectId) ?? byProject.set(r.projectId, new Set()).get(r.projectId)!) : tenant;
      for (const p of r.permissions) target.add(p);
    }
    // WP1.14b: voditelj prijave radi na vlastitoj prijavi i bez uloge institucije (zaključene prijave se i dalje čitaju).
    const leads = await tx.select({ id: proposals.id }).from(proposals).where(and(eq(proposals.tenantId, tenantId), eq(proposals.leadUserId, userId), isNull(proposals.deletedAt)));
    return { tenant: [...tenant], projects: Object.fromEntries([...byProject].map(([id, set]) => [id, [...set]])), leadProposals: leads.map((l) => l.id) };
  }

  /** Dozvole na razini institucije. */
  async permissionsOf(tx: Tx, tenantId: string, userId: string): Promise<string[]> {
    return (await this.accessOf(tx, tenantId, userId)).tenant;
  }

  private checkPolicy(password: string, ctx: { email?: string; displayName?: string; tenantSlug?: string }): void {
    const issues = passwordIssues(password, ctx);
    if (issues.length) throw new BadRequestException({ message: 'Lozinka ne zadovoljava pravila', issues });
  }

  async login(input: LoginInput, client: ClientInfo = {}) {
    const ip = client.ip;
    this.throttle.assertAllowed(input.tenantSlug, input.email, ip);
    const tenant = await this.db.withoutTenant(async (tx) =>
      (await tx.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.slug, input.tenantSlug), isNull(tenants.deletedAt))))[0]);
    if (!tenant) {
      await verifyPasswordOrBurn(input.password, null); // jednako vrijeme odgovora kao za postojeću instituciju
      this.throttle.failed(input.tenantSlug, input.email, ip); throw new UnauthorizedException('Pogrešni podaci za prijavu');
    }

    type Outcome = { kind: 'ok'; user: User; access: UserAccess; sid: string; mfaSetupRequired: boolean } | { kind: 'bad'; userId: string | null; reason: string } | { kind: 'mfa'; message: string; userId: string; count: boolean };
    const outcome: Outcome = await this.db.withTenant(tenant.id, async (tx) => {
      const user = (await tx.select().from(users).where(and(eq(users.email, input.email.toLowerCase()), isNull(users.deletedAt))))[0];
      // Uvijek jedan scrypt (i za nepostojeći ili neaktivan račun) – vrijeme odgovora ne otkriva postoji li račun (WP1.19).
      const passwordOk = await verifyPasswordOrBurn(input.password, user?.passwordHash);
      const ok = user && user.status === 'active' && passwordOk;
      if (!ok) return { kind: 'bad', userId: user?.id ?? null, reason: 'password' };
      if (user.mfaEnabled && user.mfaSecretEnc) {
        if (!input.code) return { kind: 'mfa', message: 'Unesi kod iz aplikacije za autentikaciju', userId: user.id, count: false };
        const step = verifyTotp(open(user.mfaSecretEnc), input.code.trim(), { lastStep: user.mfaLastStep });
        if (step === null) return { kind: 'mfa', message: 'Neispravan ili već iskorišten kod', userId: user.id, count: true };
        await tx.update(users).set({ mfaLastStep: step }).where(eq(users.id, user.id));
      }
      const access = await this.accessOf(tx, tenant.id, user.id);
      const mfa = this.mfaState(await this.tenantSettings(tx, tenant.id), access.tenant, user.mfaEnabled);
      const sid = randomUUID();
      await tx.insert(sessions).values({ id: sid, tenantId: tenant.id, userId: user.id, expiresAt: new Date(Date.now() + this.ttl * 1000), ip: ip ?? null, userAgent: client.userAgent?.slice(0, 300) ?? null });
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await this.audit.record(tx, { tenantId: tenant.id, entity: 'user', entityId: user.id, action: 'login.ok', actorType: 'user', actorId: user.id, diff: { meta: { sessionId: sid, mfa: user.mfaEnabled, ...(mfa.setupRequired ? { mfaSetupRequired: true } : {}) } } });
      return { kind: 'ok', user, access, sid, mfaSetupRequired: mfa.setupRequired };
    });

    if (outcome.kind !== 'ok') {
      const counted = outcome.kind === 'bad' || outcome.count;
      if (counted) {
        // WP1.19: zapis ne sadrži upisani tekst (u polje e-adrese ponekad se upiše lozinka). Postojeći račun → njegov id
        // (entityId i meta.account); nepoznata e-adresa → samo nepovratni otisak (HMAC s tajnom poslužitelja, skraćen) za
        // povezivanje ponovljenih pokušaja s istim unosom.
        const meta = outcome.userId ? { account: outcome.userId, ip } : { account: null, input: inputFingerprint(input.tenantSlug, input.email), ip };
        await this.db.withTenant(tenant.id, (tx) => this.audit.record(tx, { tenantId: tenant.id, entity: 'user', entityId: outcome.userId, action: outcome.kind === 'mfa' ? 'login.mfa_failed' : 'login.failed', actorType: 'system', diff: { meta } }));
        this.throttle.failed(input.tenantSlug, input.email, ip);
      }
      if (outcome.kind === 'mfa') throw mfaRequired(outcome.message);
      throw new UnauthorizedException('Pogrešni podaci za prijavu');
    }
    this.throttle.succeeded(input.tenantSlug, input.email);
    // `perms` u tokenu je samo informativan; ovlaštenje se uvijek računa svježe iz uloga (AuthGuard).
    const accessToken = await this.tokens.sign({ sub: outcome.user.id, tid: tenant.id, perms: outcome.access.tenant, sid: outcome.sid });
    // WP1.19: `mfaSetupRequired` – prijava je uspjela, ali je sesija u ograničenom stanju dok korisnik ne postavi MFA.
    return { accessToken, user: publicUser(outcome.user), permissions: outcome.access.tenant, projectPermissions: outcome.access.projects, leadProposals: outcome.access.leadProposals, mfaSetupRequired: outcome.mfaSetupRequired };
  }

  /** Aktivna sesija + aktivan korisnik → svježe dozvole (promjena i opoziv uloga vrijede odmah). Null = sesija ne vrijedi. */
  async sessionAccess(tenantId: string, userId: string, sid: string): Promise<(UserAccess & { timeZone: string; mfaEnabled: boolean; mfaPolicy: MfaPolicy }) | null> {
    return this.db.withTenant(tenantId, async (tx) => {
      const r = await tx.select({ id: sessions.id, mfaEnabled: users.mfaEnabled }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.id, sid), eq(sessions.userId, userId), isNull(sessions.revokedAt), sql`${sessions.expiresAt} > now()`, eq(users.status, 'active'), isNull(users.deletedAt)));
      if (!r.length) return null;
      const t = (await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)))[0];
      return { ...(await this.accessOf(tx, tenantId, userId)), timeZone: timeZoneOr(t?.settings?.timeZone), mfaEnabled: r[0]!.mfaEnabled, mfaPolicy: mfaPolicyOf(t?.settings) };
    });
  }

  /** WP1.19: stanje MFA korisnika prema postavci institucije (za /me, prijavu i sučelje). */
  private mfaState(settings: Record<string, unknown> | null | undefined, tenantPermissions: string[], mfaEnabled: boolean) {
    const policy = mfaPolicyOf(settings);
    const required = mfaRequiredFor(policy, tenantPermissions);
    return { policy, required, enabled: mfaEnabled, setupRequired: required && !mfaEnabled };
  }

  private async tenantSettings(tx: Tx, tenantId: string): Promise<Record<string, unknown>> {
    return (await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)))[0]?.settings ?? {};
  }

  // ---------- sigurnosne postavke institucije (WP1.19) ----------
  /** Postavka obveznog MFA i broj korisnika na koje se odnosi (aktivni; bez MFA = bit će u ograničenom stanju). */
  async securitySettings(tx: Tx, tenantId: string) {
    const settings = await this.tenantSettings(tx, tenantId);
    const active = await tx.select({ id: users.id, mfaEnabled: users.mfaEnabled }).from(users).where(and(isNull(users.deletedAt), eq(users.status, 'active')));
    const grants = await tx.select({ userId: roleAssignments.userId, permissions: roles.permissions }).from(roleAssignments).innerJoin(roles, eq(roles.id, roleAssignments.roleId)).where(isNull(roleAssignments.projectId));
    const permsOf = (id: string) => grants.filter((g) => g.userId === id).flatMap((g) => g.permissions);
    const count = (policy: MfaPolicy) => {
      const req = active.filter((u) => mfaRequiredFor(policy, permsOf(u.id)));
      return { required: req.length, withoutMfa: req.filter((u) => !u.mfaEnabled).length };
    };
    return {
      requireMfa: mfaPolicyOf(settings), privilegedPermissions: PRIVILEGED_PERMISSIONS,
      impact: Object.fromEntries(MFA_POLICIES.map((p) => [p, count(p)])) as Record<MfaPolicy, { required: number; withoutMfa: number }>,
    };
  }

  /**
   * Promjena obveznog MFA – radnja institucije (`users:write`, samo administrator), revidirana. Tko postrožuje postavku
   * tako da se odnosi i na njega, mora prije toga sam imati MFA (inače bi se odmah zaključao u ograničeno stanje).
   */
  async setSecuritySettings(tx: Tx, tenantId: string, userId: string, requireMfa: MfaPolicy) {
    const settings = await this.tenantSettings(tx, tenantId);
    const before = mfaPolicyOf(settings);
    const me = await this.userRow(tx, userId);
    if (!me.mfaEnabled && mfaRequiredFor(requireMfa, (await this.accessOf(tx, tenantId, userId)).tenant)) {
      throw new ConflictException('Najprije uključi MFA na vlastitom računu (Moj račun) – nova postavka odnosi se i na tebe');
    }
    if (before !== requireMfa) {
      await tx.execute(sql`update tenants set settings = settings || ${JSON.stringify({ requireMfa })}::jsonb, updated_at = now() where id = ${tenantId}`);
      await this.audit.record(tx, { entity: 'tenant', entityId: tenantId, action: 'security.update', diff: { before: { requireMfa: before }, after: { requireMfa } } });
    }
    return this.securitySettings(tx, tenantId);
  }

  async logout(tx: Tx, userId: string, sid: string) {
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, sid), eq(sessions.userId, userId)));
    await this.audit.record(tx, { entity: 'user', entityId: userId, action: 'logout', diff: { meta: { sessionId: sid } } });
    return { ok: true };
  }

  private async revokeSessions(tx: Tx, userId: string, exceptSid?: string): Promise<void> {
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), exceptSid ? ne(sessions.id, exceptSid) : undefined));
  }

  async me(tx: Tx, tenantId: string, userId: string) {
    const user = (await tx.select().from(users).where(eq(users.id, userId)))[0];
    if (!user) throw new NotFoundException();
    const tenant = (await tx.select().from(tenants).where(eq(tenants.id, tenantId)))[0];
    const access = await this.accessOf(tx, tenantId, userId);
    return { user: publicUser(user), tenant: tenant ? { id: tenant.id, slug: tenant.slug, name: tenant.name, plan: tenant.plan, timeZone: timeZoneOr(tenant.settings?.timeZone) } : null, permissions: access.tenant, projectPermissions: access.projects, leadProposals: access.leadProposals,
      mfa: this.mfaState(tenant?.settings, access.tenant, user.mfaEnabled) };
  }

  private async userRow(tx: Tx, id: string): Promise<User> {
    const u = (await tx.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))))[0];
    if (!u) throw new NotFoundException(`Korisnik ${id} ne postoji`);
    return u;
  }

  private async tenantSlug(tx: Tx, tenantId: string): Promise<string | undefined> {
    return (await tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId)))[0]?.slug;
  }

  // ---------- vlastiti račun ----------
  async changePassword(tx: Tx, tenantId: string, userId: string, sid: string, current: string, next: string) {
    const u = await this.userRow(tx, userId);
    if (!(await verifyPassword(current, u.passwordHash))) throw new BadRequestException('Trenutna lozinka nije ispravna');
    this.checkPolicy(next, { email: u.email, displayName: u.displayName, tenantSlug: await this.tenantSlug(tx, tenantId) });
    await tx.update(users).set({ passwordHash: await hashPassword(next), passwordChangedAt: new Date(), updatedAt: new Date(), updatedBy: userId }).where(eq(users.id, userId));
    await this.revokeSessions(tx, userId, sid);
    await this.audit.record(tx, { entity: 'user', entityId: userId, action: 'password.change' });
    return { ok: true };
  }

  async mfaSetup(tx: Tx, userId: string) {
    const u = await this.userRow(tx, userId);
    if (u.mfaEnabled) throw new ConflictException('MFA je već uključen – isključi ga prije ponovnog postavljanja');
    const secret = generateTotpSecret();
    await tx.update(users).set({ mfaPendingEnc: seal(secret) }).where(eq(users.id, userId));
    return { secret, otpauthUri: otpauthUri(secret, u.email) };
  }

  async mfaEnable(tx: Tx, userId: string, sid: string, code: string) {
    const u = await this.userRow(tx, userId);
    if (!u.mfaPendingEnc) throw new ConflictException('Najprije pokreni postavljanje MFA');
    const secret = open(u.mfaPendingEnc);
    const step = verifyTotp(secret, code.trim());
    if (step === null) throw new BadRequestException('Neispravan kod – provjeri vrijeme na uređaju i pokušaj ponovno');
    await tx.update(users).set({ mfaEnabled: true, mfaSecretEnc: seal(secret), mfaPendingEnc: null, mfaLastStep: step, updatedAt: new Date() }).where(eq(users.id, userId));
    await this.revokeSessions(tx, userId, sid);
    await this.audit.record(tx, { entity: 'user', entityId: userId, action: 'mfa.enable' });
    return { mfaEnabled: true };
  }

  async mfaDisable(tx: Tx, tenantId: string, userId: string, sid: string, code: string) {
    const u = await this.userRow(tx, userId);
    if (!u.mfaEnabled || !u.mfaSecretEnc) throw new ConflictException('MFA nije uključen');
    if (mfaRequiredFor(mfaPolicyOf(await this.tenantSettings(tx, tenantId)), (await this.accessOf(tx, tenantId, userId)).tenant)) {
      throw new ConflictException('Institucija zahtijeva MFA za tvoju ulogu – ne može se isključiti');
    }
    if (verifyTotp(open(u.mfaSecretEnc), code.trim(), { lastStep: u.mfaLastStep }) === null) throw new BadRequestException('Neispravan kod');
    await tx.update(users).set({ mfaEnabled: false, mfaSecretEnc: null, mfaPendingEnc: null, mfaLastStep: null, updatedAt: new Date() }).where(eq(users.id, userId));
    // WP1.19: promjena drugog faktora odjavljuje ostale uređaje (kao promjena lozinke i uključivanje MFA).
    await this.revokeSessions(tx, userId, sid);
    await this.audit.record(tx, { entity: 'user', entityId: userId, action: 'mfa.disable' });
    return { mfaEnabled: false };
  }

  // ---------- administracija korisnika ----------
  async listUsers(tx: Tx) {
    const list = await tx.select().from(users).where(isNull(users.deletedAt)).orderBy(users.displayName);
    const assigned = await tx.select({ id: roleAssignments.id, userId: roleAssignments.userId, code: roles.code, projectId: roleAssignments.projectId, acronym: projects.acronym, permissions: roles.permissions })
      .from(roleAssignments).innerJoin(roles, eq(roles.id, roleAssignments.roleId)).leftJoin(projects, eq(projects.id, roleAssignments.projectId)).orderBy(projects.acronym);
    const policy = mfaPolicyOf((await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, sql`app_current_tenant()`)))[0]?.settings);
    return list.map((u) => ({
      ...publicUser(u),
      /** WP1.19: je li korisniku MFA obvezan prema postavci institucije (bez MFA je u ograničenom stanju). */
      mfaRequired: mfaRequiredFor(policy, assigned.filter((a) => a.userId === u.id && !a.projectId).flatMap((a) => a.permissions)),
      /** Uloge na razini institucije (vrijede za sve projekte). */
      roles: assigned.filter((a) => a.userId === u.id && !a.projectId).map((a) => a.code),
      /** Uloge dodijeljene na pojedinom projektu. */
      projectRoles: assigned.filter((a) => a.userId === u.id && a.projectId).map((a) => ({ assignmentId: a.id, code: a.code, projectId: a.projectId!, acronym: a.acronym })),
    }));
  }

  async listRoles(tx: Tx) {
    return (await tx.select().from(roles).where(isNull(roles.deletedAt)).orderBy(roles.name)).map((r) => ({ code: r.code, name: r.name, scope: r.scope, permissions: r.permissions, system: r.tenantId === null }));
  }

  async createUser(tx: Tx, tenantId: string, input: CreateUserInput, actorId?: string) {
    const email = input.email.toLowerCase();
    if (input.password) this.checkPolicy(input.password, { email, displayName: input.displayName, tenantSlug: await this.tenantSlug(tx, tenantId) });
    const exists = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (exists.length) throw new ConflictException('Korisnik s tom e-adresom već postoji');
    const [user] = await tx.insert(users).values({
      tenantId, email, displayName: input.displayName,
      passwordHash: input.password ? await hashPassword(input.password) : null, passwordChangedAt: input.password ? new Date() : null,
      status: input.password ? 'active' : 'invited', createdBy: actorId, updatedBy: actorId,
    }).returning();
    if (!user) throw new Error('Unos korisnika nije uspio');
    if (input.roleCodes?.length) await this.assignRoles(tx, tenantId, user.id, input.roleCodes, actorId);
    await this.audit.record(tx, { tenantId, entity: 'user', entityId: user.id, action: 'create', diff: { after: publicUser(user), meta: { roles: input.roleCodes ?? [] } } });
    return { ...publicUser(user), roles: input.roleCodes ?? [] };
  }

  /** Mora ostati barem jedan aktivan administrator stanara (zaštita od zaključavanja). */
  private async assertNotLastAdmin(tx: Tx, userId: string): Promise<void> {
    const admins = await tx.select({ id: users.id }).from(roleAssignments).innerJoin(roles, eq(roles.id, roleAssignments.roleId)).innerJoin(users, eq(users.id, roleAssignments.userId))
      .where(and(eq(roles.code, 'tenant-admin'), eq(users.status, 'active'), isNull(users.deletedAt), isNull(roleAssignments.projectId)));
    const ids = new Set(admins.map((a) => a.id));
    if (ids.has(userId) && ids.size === 1) throw new ConflictException('Ovo je jedini aktivni administrator – najprije dodijeli ulogu administratora drugom korisniku');
  }

  async updateUser(tx: Tx, tenantId: string, id: string, input: UpdateUserInput, actorId: string) {
    const before = await this.userRow(tx, id);
    const current = (await this.listUsers(tx)).find((u) => u.id === id)!.roles;
    if (input.status === 'disabled') {
      if (id === actorId) throw new ForbiddenException('Ne možeš deaktivirati vlastiti račun');
      await this.assertNotLastAdmin(tx, id);
    }
    if (input.roleCodes && current.includes('tenant-admin') && !input.roleCodes.includes('tenant-admin')) await this.assertNotLastAdmin(tx, id);
    if (input.status === 'active' && !before.passwordHash) throw new ConflictException('Korisnik nema lozinku – postavi je prije aktivacije');
    await tx.update(users).set({ ...(input.displayName ? { displayName: input.displayName } : {}), ...(input.status ? { status: input.status } : {}), updatedAt: new Date(), updatedBy: actorId }).where(eq(users.id, id));
    if (input.roleCodes) {
      const tenantRoleIds = (await tx.select({ id: roleAssignments.id }).from(roleAssignments).where(and(eq(roleAssignments.userId, id), isNull(roleAssignments.projectId)))).map((r) => r.id);
      if (tenantRoleIds.length) await tx.delete(roleAssignments).where(inArray(roleAssignments.id, tenantRoleIds));
      if (input.roleCodes.length) await this.assignRoles(tx, tenantId, id, input.roleCodes, actorId);
    }
    // WP1.18: deaktivacija gasi i tajnu poveznicu osobnog kalendara (ponovna aktivacija je ne vraća – korisnik stvara novu).
    if (input.status === 'disabled') { await this.revokeSessions(tx, id); await tx.delete(calendarTokens).where(eq(calendarTokens.userId, id)); }
    await this.audit.record(tx, { entity: 'user', entityId: id, action: 'update', diff: { before: { displayName: before.displayName, status: before.status, roles: current }, after: input } });
    return (await this.listUsers(tx)).find((u) => u.id === id)!;
  }

  async resetPassword(tx: Tx, tenantId: string, id: string, newPassword: string, actorId: string) {
    const u = await this.userRow(tx, id);
    this.checkPolicy(newPassword, { email: u.email, displayName: u.displayName, tenantSlug: await this.tenantSlug(tx, tenantId) });
    await tx.update(users).set({ passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date(), status: u.status === 'invited' ? 'active' : u.status, updatedAt: new Date(), updatedBy: actorId }).where(eq(users.id, id));
    await this.revokeSessions(tx, id);
    await this.audit.record(tx, { entity: 'user', entityId: id, action: 'password.reset' });
    return { ok: true };
  }

  async resetMfa(tx: Tx, id: string, actorId: string) {
    await this.userRow(tx, id);
    await tx.update(users).set({ mfaEnabled: false, mfaSecretEnc: null, mfaPendingEnc: null, mfaLastStep: null, updatedAt: new Date(), updatedBy: actorId }).where(eq(users.id, id));
    await this.revokeSessions(tx, id);
    await this.audit.record(tx, { entity: 'user', entityId: id, action: 'mfa.reset' });
    return { ok: true };
  }

  async assignRoles(tx: Tx, tenantId: string, userId: string, requested: string[], actorId?: string): Promise<void> {
    const codes = [...new Set(requested)]; // ista uloga dvaput u zahtjevu = jedna dodjela (WP1.14b: jedinstvenost i u bazi)
    const found = await tx.select({ id: roles.id, code: roles.code }).from(roles)
      .where(and(inArray(roles.code, codes), or(isNull(roles.tenantId), eq(roles.tenantId, tenantId))));
    const missing = codes.filter((c) => !found.some((f) => f.code === c));
    if (missing.length) throw new NotFoundException(`Nepoznate uloge: ${missing.join(', ')}`);
    await tx.insert(roleAssignments).values(found.map((r) => ({ tenantId, userId, roleId: r.id, createdBy: actorId })));
  }

  // ---------- pristup projektu (WP1.14) ----------
  /** Upravljati pristupom projektu smije administrator korisnika (users:write) ili tko ima projects:write na tom projektu. */
  private canManageAccess(c: RequestContext, projectId: string): boolean {
    return canInTenant(c, 'users:write') || canOnProject(c, 'projects:write', projectId);
  }

  /** Bez users:write korisnik smije dodijeliti/oduzeti samo ulogu čije sve dozvole i sam ima na tom projektu (nema eskalacije). */
  private missingRights(c: RequestContext, projectId: string, rolePermissions: string[]): string[] {
    if (canInTenant(c, 'users:write')) return [];
    return rolePermissions.filter((p) => (p === '*' ? !(c.permissions.has('*') || projectGrants(c, projectId).has('*')) : !canOnProject(c, p as never, projectId)));
  }

  private assertWithinOwnRights(c: RequestContext, projectId: string, rolePermissions: string[]): void {
    const missing = this.missingRights(c, projectId, rolePermissions);
    if (missing.length) throw new ForbiddenException(`Ne možeš dodijeliti ili oduzeti ulogu s dozvolama koje sam nemaš na projektu: ${missing.join(', ')}`);
  }

  async projectAccess(tx: Tx, projectId: string) {
    const c = this.ctx.require();
    await loadProject(tx, projectId);
    if (!this.canManageAccess(c, projectId)) throw new ForbiddenException('Pristupom projektu upravlja voditelj projekta ili administrator');
    const rows = await tx.select({ id: roleAssignments.id, userId: users.id, displayName: users.displayName, email: users.email, status: users.status, projectId: roleAssignments.projectId, code: roles.code, name: roles.name, permissions: roles.permissions })
      .from(roleAssignments).innerJoin(roles, eq(roles.id, roleAssignments.roleId)).innerJoin(users, eq(users.id, roleAssignments.userId))
      .where(and(isNull(users.deletedAt), or(eq(roleAssignments.projectId, projectId), isNull(roleAssignments.projectId)))).orderBy(users.displayName);
    // Uloge institucije koje daju pristup svim projektima (projects:read) + sve dodjele na ovom projektu.
    const entries = rows.filter((r) => r.projectId === projectId || hasPermission(new Set(r.permissions), 'projects:read')).map((r) => ({
      assignmentId: r.projectId ? r.id : null, userId: r.userId, displayName: r.displayName, email: r.email, status: r.status,
      roleCode: r.code, roleName: r.name, scope: r.projectId ? 'project' as const : 'tenant' as const,
      revocable: !!r.projectId && this.missingRights(c, projectId, r.permissions).length === 0,
    }));
    const people = await tx.select({ id: users.id, displayName: users.displayName, email: users.email }).from(users).where(and(isNull(users.deletedAt), ne(users.status, 'disabled'))).orderBy(users.displayName);
    const roleList = (await this.listRoles(tx)).map((r) => ({ code: r.code, name: r.name, scope: r.scope, grantable: this.missingRights(c, projectId, r.permissions).length === 0 }));
    return { projectId, entries, users: people, roles: roleList };
  }


  async grantOnProject(tx: Tx, tenantId: string, projectId: string, input: { userId: string; roleCode: string }, actorId?: string) {
    const c = this.ctx.require();
    await loadProject(tx, projectId);
    if (!this.canManageAccess(c, projectId)) throw new ForbiddenException('Pristupom projektu upravlja voditelj projekta ili administrator');
    const role = await findRole(tx, tenantId, input.roleCode);
    this.assertWithinOwnRights(c, projectId, role.permissions);
    const row = await grantProjectRole(tx, this.audit, { tenantId, userId: input.userId, projectId, roleCode: input.roleCode, actorId, reason: 'upravljanje pristupom' });
    if (!row) throw new ConflictException('Korisnik već ima tu ulogu na projektu');
    return this.projectAccess(tx, projectId);
  }

  async revokeOnProject(tx: Tx, projectId: string, assignmentId: string) {
    const c = this.ctx.require();
    await loadProject(tx, projectId);
    if (!this.canManageAccess(c, projectId)) throw new ForbiddenException('Pristupom projektu upravlja voditelj projekta ili administrator');
    const row = (await tx.select({ id: roleAssignments.id, userId: roleAssignments.userId, code: roles.code, permissions: roles.permissions }).from(roleAssignments).innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(and(eq(roleAssignments.id, assignmentId), eq(roleAssignments.projectId, projectId))))[0];
    if (!row) throw new NotFoundException('Dodjela ne postoji na projektu');
    this.assertWithinOwnRights(c, projectId, row.permissions);
    await tx.delete(roleAssignments).where(eq(roleAssignments.id, row.id));
    await this.audit.record(tx, { entity: 'role_assignment', entityId: row.id, action: 'revoke', diff: { before: { userId: row.userId, role: row.code, projectId } } });
    await notify(tx, { userId: row.userId, kind: 'access_revoked', projectId, data: { acronym: await acronymOf(tx, projectId), role: row.code } });
    return this.projectAccess(tx, projectId);
  }

  /** Sistemske uloge (tenant_id NULL) – idempotentno, izvodi se pod vlasničkom vezom pri pokretanju/seedu. */
  static async ensureSystemRoles(tx: Tx): Promise<void> {
    for (const r of SYSTEM_ROLES) {
      await tx.execute(sql`insert into roles (tenant_id, code, name, permissions, scope) values (null, ${r.code}, ${r.name}, ${sql.raw(`'{${r.permissions.join(',')}}'::text[]`)}, ${r.scope})
        on conflict (code) where tenant_id is null do update set name = excluded.name, permissions = excluded.permissions, scope = excluded.scope`);
    }
  }
}
