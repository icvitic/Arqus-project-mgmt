import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { passwordIssues } from '@arqus/domain';
import { DbService, type Tx } from '../db/db.service';
import { tenants, users, roles, roleAssignments, sessions, type User } from '../db/schema';
import { hashPassword, verifyPassword } from './password';
import { TokenService } from './token.service';
import { AuditService } from '../audit/audit.service';
import { SYSTEM_ROLES } from './permissions';
import { LoginThrottle } from './login-throttle';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';
import { open, seal } from '../common/crypto-box';
import { ttlSeconds } from './ttl';

export interface LoginInput { tenantSlug: string; email: string; password: string; code?: string }
export interface CreateUserInput { email: string; displayName: string; password?: string; roleCodes?: string[] }
export interface UpdateUserInput { displayName?: string; status?: 'active' | 'disabled'; roleCodes?: string[] }
interface ClientInfo { ip?: string; userAgent?: string }

const publicUser = (u: User) => ({ id: u.id, tenantId: u.tenantId, email: u.email, displayName: u.displayName, status: u.status, mfaEnabled: u.mfaEnabled, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt });

/** 401 s oznakom da je potreban (ili neispravan) MFA kod – sučelje tada traži kod. */
const mfaRequired = (message: string) => new UnauthorizedException({ statusCode: 401, message, mfaRequired: true });

@Injectable()
export class IdentityService {
  private readonly ttl = ttlSeconds(process.env.AUTH_TOKEN_TTL ?? '8h');
  constructor(private readonly db: DbService, private readonly tokens: TokenService, private readonly audit: AuditService, private readonly throttle: LoginThrottle) {}

  /** Skup dozvola korisnika = unija dozvola svih dodijeljenih uloga (stanarskih i sistemskih). */
  async permissionsOf(tx: Tx, tenantId: string, userId: string): Promise<string[]> {
    const rows = await tx.select({ permissions: roles.permissions }).from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(and(eq(roleAssignments.tenantId, tenantId), eq(roleAssignments.userId, userId)));
    return [...new Set(rows.flatMap((r) => r.permissions))];
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
    if (!tenant) { this.throttle.failed(input.tenantSlug, input.email, ip); throw new UnauthorizedException('Pogrešni podaci za prijavu'); }

    type Outcome = { kind: 'ok'; user: User; permissions: string[]; sid: string } | { kind: 'bad'; userId: string | null; reason: string } | { kind: 'mfa'; message: string; userId: string; count: boolean };
    const outcome: Outcome = await this.db.withTenant(tenant.id, async (tx) => {
      const user = (await tx.select().from(users).where(and(eq(users.email, input.email.toLowerCase()), isNull(users.deletedAt))))[0];
      const ok = user && user.status === 'active' && (await verifyPassword(input.password, user.passwordHash));
      if (!ok) return { kind: 'bad', userId: user?.id ?? null, reason: 'password' };
      if (user.mfaEnabled && user.mfaSecretEnc) {
        if (!input.code) return { kind: 'mfa', message: 'Unesi kod iz aplikacije za autentikaciju', userId: user.id, count: false };
        const step = verifyTotp(open(user.mfaSecretEnc), input.code.trim(), { lastStep: user.mfaLastStep });
        if (step === null) return { kind: 'mfa', message: 'Neispravan ili već iskorišten kod', userId: user.id, count: true };
        await tx.update(users).set({ mfaLastStep: step }).where(eq(users.id, user.id));
      }
      const permissions = await this.permissionsOf(tx, tenant.id, user.id);
      const sid = randomUUID();
      await tx.insert(sessions).values({ id: sid, tenantId: tenant.id, userId: user.id, expiresAt: new Date(Date.now() + this.ttl * 1000), ip: ip ?? null, userAgent: client.userAgent?.slice(0, 300) ?? null });
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await this.audit.record(tx, { tenantId: tenant.id, entity: 'user', entityId: user.id, action: 'login.ok', actorType: 'user', actorId: user.id, diff: { meta: { sessionId: sid, mfa: user.mfaEnabled } } });
      return { kind: 'ok', user, permissions, sid };
    });

    if (outcome.kind !== 'ok') {
      const counted = outcome.kind === 'bad' || outcome.count;
      if (counted) {
        await this.db.withTenant(tenant.id, (tx) => this.audit.record(tx, { tenantId: tenant.id, entity: 'user', entityId: outcome.userId, action: outcome.kind === 'mfa' ? 'login.mfa_failed' : 'login.failed', actorType: 'system', diff: { meta: { email: input.email, ip } } }));
        this.throttle.failed(input.tenantSlug, input.email, ip);
      }
      if (outcome.kind === 'mfa') throw mfaRequired(outcome.message);
      throw new UnauthorizedException('Pogrešni podaci za prijavu');
    }
    this.throttle.succeeded(input.tenantSlug, input.email);
    const accessToken = await this.tokens.sign({ sub: outcome.user.id, tid: tenant.id, perms: outcome.permissions, sid: outcome.sid });
    return { accessToken, user: publicUser(outcome.user), permissions: outcome.permissions };
  }

  /** Aktivna sesija + aktivan korisnik → svježe dozvole (promjena uloga vrijedi odmah). Null = sesija ne vrijedi. */
  async sessionPermissions(tenantId: string, userId: string, sid: string): Promise<string[] | null> {
    return this.db.withTenant(tenantId, async (tx) => {
      const r = await tx.select({ id: sessions.id }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.id, sid), eq(sessions.userId, userId), isNull(sessions.revokedAt), sql`${sessions.expiresAt} > now()`, eq(users.status, 'active'), isNull(users.deletedAt)));
      return r.length ? this.permissionsOf(tx, tenantId, userId) : null;
    });
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
    return { user: publicUser(user), tenant: tenant ? { id: tenant.id, slug: tenant.slug, name: tenant.name, plan: tenant.plan } : null, permissions: await this.permissionsOf(tx, tenantId, userId) };
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

  async mfaDisable(tx: Tx, userId: string, code: string) {
    const u = await this.userRow(tx, userId);
    if (!u.mfaEnabled || !u.mfaSecretEnc) throw new ConflictException('MFA nije uključen');
    if (verifyTotp(open(u.mfaSecretEnc), code.trim(), { lastStep: u.mfaLastStep }) === null) throw new BadRequestException('Neispravan kod');
    await tx.update(users).set({ mfaEnabled: false, mfaSecretEnc: null, mfaPendingEnc: null, mfaLastStep: null, updatedAt: new Date() }).where(eq(users.id, userId));
    await this.audit.record(tx, { entity: 'user', entityId: userId, action: 'mfa.disable' });
    return { mfaEnabled: false };
  }

  // ---------- administracija korisnika ----------
  async listUsers(tx: Tx) {
    const list = await tx.select().from(users).where(isNull(users.deletedAt)).orderBy(users.displayName);
    const assigned = await tx.select({ userId: roleAssignments.userId, code: roles.code }).from(roleAssignments).innerJoin(roles, eq(roles.id, roleAssignments.roleId)).where(isNull(roleAssignments.projectId));
    return list.map((u) => ({ ...publicUser(u), roles: assigned.filter((a) => a.userId === u.id).map((a) => a.code) }));
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
    if (input.status === 'disabled') await this.revokeSessions(tx, id);
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

  async assignRoles(tx: Tx, tenantId: string, userId: string, codes: string[], actorId?: string): Promise<void> {
    const found = await tx.select({ id: roles.id, code: roles.code }).from(roles)
      .where(and(inArray(roles.code, codes), or(isNull(roles.tenantId), eq(roles.tenantId, tenantId))));
    const missing = codes.filter((c) => !found.some((f) => f.code === c));
    if (missing.length) throw new NotFoundException(`Nepoznate uloge: ${missing.join(', ')}`);
    await tx.insert(roleAssignments).values(found.map((r) => ({ tenantId, userId, roleId: r.id, createdBy: actorId })));
  }

  /** Sistemske uloge (tenant_id NULL) – idempotentno, izvodi se pod vlasničkom vezom pri pokretanju/seedu. */
  static async ensureSystemRoles(tx: Tx): Promise<void> {
    for (const r of SYSTEM_ROLES) {
      await tx.execute(sql`insert into roles (tenant_id, code, name, permissions, scope) values (null, ${r.code}, ${r.name}, ${sql.raw(`'{${r.permissions.join(',')}}'::text[]`)}, ${r.scope})
        on conflict (code) where tenant_id is null do update set name = excluded.name, permissions = excluded.permissions, scope = excluded.scope`);
    }
  }
}
