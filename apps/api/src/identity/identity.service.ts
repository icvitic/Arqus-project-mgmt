import { Injectable, UnauthorizedException, ConflictException, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DbService, type Tx } from '../db/db.service';
import { tenants, users, roles, roleAssignments, type User } from '../db/schema';
import { hashPassword, verifyPassword } from './password';
import { TokenService } from './token.service';
import { AuditService } from '../audit/audit.service';
import { SYSTEM_ROLES } from './permissions';
import { LoginThrottle } from './login-throttle';

export interface LoginInput { tenantSlug: string; email: string; password: string }
export interface CreateUserInput { email: string; displayName: string; password?: string; roleCodes?: string[] }

const publicUser = (u: User) => ({ id: u.id, tenantId: u.tenantId, email: u.email, displayName: u.displayName, status: u.status, mfaEnabled: u.mfaEnabled, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt });

@Injectable()
export class IdentityService {
  constructor(private readonly db: DbService, private readonly tokens: TokenService, private readonly audit: AuditService, private readonly throttle: LoginThrottle) {}

  /** Skup dozvola korisnika = unija dozvola svih dodijeljenih uloga (stanarskih i sistemskih). */
  async permissionsOf(tx: Tx, tenantId: string, userId: string): Promise<string[]> {
    const rows = await tx.select({ permissions: roles.permissions }).from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(and(eq(roleAssignments.tenantId, tenantId), eq(roleAssignments.userId, userId)));
    return [...new Set(rows.flatMap((r) => r.permissions))];
  }

  async login(input: LoginInput, ip?: string): Promise<{ accessToken: string; user: ReturnType<typeof publicUser>; permissions: string[] }> {
    this.throttle.assertAllowed(input.tenantSlug, input.email, ip);
    const tenant = await this.db.withoutTenant(async (tx) =>
      (await tx.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.slug, input.tenantSlug), isNull(tenants.deletedAt))))[0]);
    if (!tenant) { this.throttle.failed(input.tenantSlug, input.email, ip); throw new UnauthorizedException('Pogrešni podaci za prijavu'); }

    // Neuspjeh se bilježi u ZASEBNOJ transakciji: iznimka bi poništila zapis u istoj transakciji.
    const outcome = await this.db.withTenant(tenant.id, async (tx) => {
      const user = (await tx.select().from(users).where(and(eq(users.email, input.email.toLowerCase()), isNull(users.deletedAt))))[0];
      const ok = user && user.status === 'active' && (await verifyPassword(input.password, user.passwordHash));
      if (!ok) return { ok: false as const, userId: user?.id ?? null };
      const permissions = await this.permissionsOf(tx, tenant.id, user.id);
      const sid = randomUUID();
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await this.audit.record(tx, { tenantId: tenant.id, entity: 'user', entityId: user.id, action: 'login.ok', actorType: 'user', actorId: user.id, diff: { meta: { sessionId: sid } } });
      return { ok: true as const, user, permissions, sid };
    });
    if (!outcome.ok) {
      await this.db.withTenant(tenant.id, (tx) =>
        this.audit.record(tx, { tenantId: tenant.id, entity: 'user', entityId: outcome.userId, action: 'login.failed', actorType: 'system', diff: { meta: { email: input.email, ip } } }));
      this.throttle.failed(input.tenantSlug, input.email, ip);
      throw new UnauthorizedException('Pogrešni podaci za prijavu');
    }
    this.throttle.succeeded(input.tenantSlug, input.email);
    const accessToken = await this.tokens.sign({ sub: outcome.user.id, tid: tenant.id, perms: outcome.permissions, sid: outcome.sid });
    return { accessToken, user: publicUser(outcome.user), permissions: outcome.permissions };
  }

  async me(tx: Tx, tenantId: string, userId: string) {
    const user = (await tx.select().from(users).where(eq(users.id, userId)))[0];
    if (!user) throw new NotFoundException();
    const tenant = (await tx.select().from(tenants).where(eq(tenants.id, tenantId)))[0];
    return { user: publicUser(user), tenant: tenant ? { id: tenant.id, slug: tenant.slug, name: tenant.name, plan: tenant.plan } : null, permissions: await this.permissionsOf(tx, tenantId, userId) };
  }

  async listUsers(tx: Tx) {
    return (await tx.select().from(users).where(isNull(users.deletedAt)).orderBy(users.displayName)).map(publicUser);
  }

  async createUser(tx: Tx, tenantId: string, input: CreateUserInput, actorId?: string) {
    const email = input.email.toLowerCase();
    const exists = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (exists.length) throw new ConflictException('Korisnik s tom e-adresom već postoji');
    const [user] = await tx.insert(users).values({
      tenantId, email, displayName: input.displayName,
      passwordHash: input.password ? await hashPassword(input.password) : null,
      status: input.password ? 'active' : 'invited', createdBy: actorId, updatedBy: actorId,
    }).returning();
    if (!user) throw new Error('Unos korisnika nije uspio');
    if (input.roleCodes?.length) await this.assignRoles(tx, tenantId, user.id, input.roleCodes, actorId);
    await this.audit.record(tx, { tenantId, entity: 'user', entityId: user.id, action: 'create', diff: { after: publicUser(user), meta: { roles: input.roleCodes ?? [] } } });
    return publicUser(user);
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
