import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { notificationText, type NotificationData, type NotificationKind } from '@arqus/domain';
import type { Tx } from '../db/db.service';
import { notifications, users } from '../db/schema';

/** Pročitane obavijesti starije od ovoliko dana brišu se (pri čitanju popisa vlasnika). Nepročitane se ne brišu. */
export const NOTIFICATION_RETENTION_DAYS = Math.max(1, Number(process.env.NOTIFICATION_RETENTION_DAYS ?? 90) || 90);
export const NOTIFICATION_PAGE = 20;

/**
 * WP1.18 – vlastite obavijesti korisnika. Dvostruka zaštita da korisnik čita samo svoje retke: svaki upit filtrira po
 * `user_id`, a RLS (migracija 0027) iste retke otkriva samo kad je u transakciji postavljen `app.user_id` tog korisnika –
 * upit koji bi zaboravio filtar ili se izvršio bez postavke ne vraća ništa.
 */
@Injectable()
export class NotificationsService {
  private async asOwner(tx: Tx, userId: string): Promise<void> {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
  }

  /** Najnovije prve, keyset paginacija (`before` = id zadnje dohvaćene), broj nepročitanih. Usput briše stare pročitane. */
  async list(tx: Tx, userId: string, opts: { before?: number; limit?: number } = {}) {
    await this.asOwner(tx, userId);
    await this.prune(tx, userId);
    const limit = Math.min(Math.max(opts.limit ?? NOTIFICATION_PAGE, 1), 100);
    const rows = await tx.select({ n: notifications, actor: users.displayName }).from(notifications).leftJoin(users, eq(users.id, notifications.actorId))
      .where(and(eq(notifications.userId, userId), opts.before ? lt(notifications.id, opts.before) : undefined))
      .orderBy(desc(notifications.id)).limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      items: page.map(({ n, actor }) => {
        const text = notificationText(n.kind as NotificationKind, n.data as NotificationData, actor);
        return { id: n.id, kind: n.kind, title: text.title, detail: text.detail ?? null, link: n.link, projectId: n.projectId, proposalId: n.proposalId, actor: actor ?? null, createdAt: n.createdAt, read: !!n.readAt };
      }),
      unread: await this.unread(tx, userId),
      next: rows.length > limit ? page[page.length - 1]!.n.id : null,
    };
  }

  async unread(tx: Tx, userId: string): Promise<number> {
    await this.asOwner(tx, userId);
    return (await tx.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))))[0]?.n ?? 0;
  }

  async markRead(tx: Tx, userId: string, id: number) {
    await this.asOwner(tx, userId);
    const found = await tx.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
    if (!found.length) throw new NotFoundException('Obavijest ne postoji');
    await tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { ok: true, unread: await this.unread(tx, userId) };
  }

  async markAllRead(tx: Tx, userId: string) {
    await this.asOwner(tx, userId);
    await tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { ok: true, unread: 0 };
  }

  /** Brisanje pročitanih obavijesti starijih od `NOTIFICATION_RETENTION_DAYS` (samo vlastitih). */
  async prune(tx: Tx, userId: string, now: Date = new Date()): Promise<number> {
    await this.asOwner(tx, userId);
    const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000);
    const r = await tx.delete(notifications).where(and(eq(notifications.userId, userId), lt(notifications.readAt, cutoff))).returning({ id: notifications.id });
    return r.length;
  }
}
