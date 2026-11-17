import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { NotificationData, NotificationKind } from '@arqus/domain';
import type { Tx } from '../db/db.service';
import { notifications, roleAssignments, roles, users } from '../db/schema';
import { currentContext } from '../common/tenant-context';
import { hasPermission, type Permission } from '../identity/permissions';

/**
 * WP1.18 – upis obavijesti u ISTOJ transakciji kao događaj (ako se događaj poništi, nestaje i obavijest).
 * Slobodna funkcija nad transakcijom (kao `project-grants`), da je servisi mogu zvati bez novih ovisnosti.
 *
 * Pravila:
 * - nikad samom akteru (akter = korisnik iz konteksta zahtjeva);
 * - `requires` – dozvola koju primatelj u tom trenutku mora imati na projektu (inače obavijest ne nastaje: ne smije otkriti
 *   ništa što primatelj ne bi vidio otvaranjem projekta, npr. razlog povrata ZNS-a nekome tko više nema pristup financijama);
 * - bez iznosa; slobodan tekst samo kao `data.reason`, i to samo razlog koji je primatelju vidljiv na entitetu.
 */
export interface NotifyInput {
  userId: string | null | undefined;
  kind: NotificationKind;
  projectId?: string | null;
  proposalId?: string | null;
  data: NotificationData;
  link?: string | null;
  requires?: Permission;
}

export async function notify(tx: Tx, n: NotifyInput): Promise<boolean> {
  const actor = currentContext()?.userId ?? null;
  if (!n.userId || n.userId === actor) return false;
  if (n.requires && n.projectId && !(await recipientCan(tx, n.userId, n.projectId, n.requires))) return false;
  await tx.insert(notifications).values({
    tenantId: sql`app_current_tenant()`, userId: n.userId, kind: n.kind, actorId: actor, projectId: n.projectId ?? null, proposalId: n.proposalId ?? null,
    data: n.data as Record<string, unknown>, link: n.link ?? null,
  });
  return true;
}

/** Ima li (aktivan) korisnik dozvolu na projektu – uloga na razini institucije ili na tom projektu (isto pravilo kao `canOnProject`). */
export async function recipientCan(tx: Tx, userId: string, projectId: string, permission: Permission): Promise<boolean> {
  const rows = await tx.select({ permissions: roles.permissions }).from(roleAssignments).innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .innerJoin(users, eq(users.id, roleAssignments.userId))
    .where(and(eq(roleAssignments.userId, userId), or(isNull(roleAssignments.projectId), eq(roleAssignments.projectId, projectId)), isNull(roles.deletedAt), eq(users.status, 'active'), isNull(users.deletedAt)));
  return hasPermission(new Set(rows.flatMap((r) => r.permissions)), permission);
}
