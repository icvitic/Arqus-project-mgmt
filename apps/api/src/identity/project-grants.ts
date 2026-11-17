import { NotFoundException } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { Tx } from '../db/db.service';
import { projects, roleAssignments, roles, users } from '../db/schema';
import type { AuditService } from '../audit/audit.service';
import { hasPermission } from './permissions';
import { notify } from '../notifications/notify';

/**
 * Dodjele uloga na projektu (WP1.14). Slobodne funkcije nad transakcijom – koriste ih stvaranje projekta, ugovaranje
 * prijave, dodavanje člana tima i upravljanje pristupom (IdentityService). Sve pod RLS-om stanara.
 */

const MANAGER_REASON = 'voditelj projekta';

/** Akronim projekta za tekst obavijesti. */
export async function acronymOf(tx: Tx, projectId: string): Promise<string | undefined> {
  return (await tx.select({ acronym: projects.acronym }).from(projects).where(eq(projects.id, projectId)))[0]?.acronym;
}

/** Uloga vidljiva stanaru (sistemska ili vlastita) po kodu. */
export async function findRole(tx: Tx, tenantId: string, code: string) {
  const r = (await tx.select().from(roles).where(and(eq(roles.code, code), isNull(roles.deletedAt), or(isNull(roles.tenantId), eq(roles.tenantId, tenantId)))))[0];
  if (!r) throw new NotFoundException(`Uloga ${code} ne postoji`);
  return r;
}

/** Dozvole korisnika na razini institucije (uloge bez projekta). */
export async function tenantPermissionsOf(tx: Tx, userId: string): Promise<Set<string>> {
  const rows = await tx.select({ permissions: roles.permissions }).from(roleAssignments).innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(and(eq(roleAssignments.userId, userId), isNull(roleAssignments.projectId)));
  return new Set(rows.flatMap((r) => r.permissions));
}

/** Kodovi uloga koje korisnik ima dodijeljene na projektu. */
export async function projectRoleCodesOf(tx: Tx, userId: string, projectId: string): Promise<string[]> {
  const rows = await tx.select({ code: roles.code }).from(roleAssignments).innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(and(eq(roleAssignments.userId, userId), eq(roleAssignments.projectId, projectId)));
  return rows.map((r) => r.code);
}

/** Dodjela uloge na projektu; postojeća ista dodjela se ne ponavlja (vraća null). */
export async function grantProjectRole(tx: Tx, audit: AuditService, a: { tenantId: string; userId: string; projectId: string; roleCode: string; actorId?: string; reason: string }) {
  const user = (await tx.select({ id: users.id }).from(users).where(and(eq(users.id, a.userId), isNull(users.deletedAt))))[0];
  if (!user) throw new NotFoundException(`Korisnik ${a.userId} ne postoji`);
  const role = await findRole(tx, a.tenantId, a.roleCode);
  const dup = await tx.select({ id: roleAssignments.id }).from(roleAssignments)
    .where(and(eq(roleAssignments.userId, a.userId), eq(roleAssignments.roleId, role.id), eq(roleAssignments.projectId, a.projectId)));
  if (dup.length) return null;
  const [row] = await tx.insert(roleAssignments).values({ tenantId: a.tenantId, userId: a.userId, roleId: role.id, projectId: a.projectId, createdBy: a.actorId ?? null }).returning();
  await audit.record(tx, { entity: 'role_assignment', entityId: row!.id, action: 'grant', diff: { after: { userId: a.userId, role: a.roleCode, projectId: a.projectId }, meta: { reason: a.reason } } });
  // WP1.18: obavijest o novom pristupu (imenovani voditelj dobiva zasebnu obavijest „imenovan si voditeljem”).
  if (a.reason !== MANAGER_REASON) await notify(tx, { userId: a.userId, kind: 'access_granted', projectId: a.projectId, data: { acronym: await acronymOf(tx, a.projectId), role: a.roleCode }, link: `projekti/${a.projectId}` });
  return row!;
}

/** Voditelj imenovan pri stvaranju/ugovaranju dobiva ulogu voditelja na projektu, osim ako već ima projects:write na razini institucije. */
export async function ensureManagerAccess(tx: Tx, audit: AuditService, tenantId: string, projectId: string, userId: string, actorId?: string): Promise<void> {
  // WP1.18: imenovanje voditeljem (stvaranje projekta, ugovaranje prijave, promjena voditelja) – obavijest imenovanome.
  await notify(tx, { userId, kind: 'project_manager', projectId, data: { acronym: await acronymOf(tx, projectId) }, link: `projekti/${projectId}` });
  if (hasPermission(await tenantPermissionsOf(tx, userId), 'projects:write')) return;
  if ((await projectRoleCodesOf(tx, userId, projectId)).includes('project-manager')) return;
  await grantProjectRole(tx, audit, { tenantId, userId, projectId, roleCode: 'project-manager', actorId, reason: MANAGER_REASON });
}

/**
 * Član tima povezan s korisničkim računom dobiva ulogu člana tima na projektu ako tamo još nema dodjelu (i ako mu ona išta dodaje).
 * Vraća novu dodjelu (ili null) – uvoz iz Excela (WP1.17) je pamti da je poništavanje uvoza može ukloniti.
 */
export async function ensureTeamMemberAccess(tx: Tx, audit: AuditService, tenantId: string, projectId: string, userId: string, actorId?: string) {
  if ((await projectRoleCodesOf(tx, userId, projectId)).length) return null;
  const role = await findRole(tx, tenantId, 'team-member');
  const tenantPerms = await tenantPermissionsOf(tx, userId);
  if (role.permissions.every((p) => hasPermission(tenantPerms, p as never))) return null;
  return grantProjectRole(tx, audit, { tenantId, userId, projectId, roleCode: 'team-member', actorId, reason: 'član tima' });
}
