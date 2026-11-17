import { BadRequestException, Controller, Delete, Get, Header, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Authenticated, Public } from '../identity/auth.guard';
import { DbService } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';
import { MyWorkService } from './my-work.service';
import { NotificationsService } from './notifications.service';
import { CalendarRateLimit, CalendarService } from './calendar.service';

const idParam = (raw: string): number => {
  if (!/^\d{1,15}$/.test(raw)) throw new BadRequestException('Neispravan id obavijesti');
  return Number(raw);
};

/**
 * WP1.18 – rute „o meni”: prijavljeni korisnik o sebi (`@Authenticated`). Nisu u popisu rute dostupnih u ograničenom stanju
 * (obvezni MFA nije postavljen) – tada daju 403 `mfa_setup_required` kao i sve ostale. Sadržaj se uvijek računa za korisnika
 * iz sesije; nijedna ruta ne prima id drugog korisnika.
 */
@Controller('me')
export class MeController {
  constructor(private readonly work: MyWorkService, private readonly notes: NotificationsService, private readonly calendar: CalendarService, private readonly db: DbService, private readonly ctx: TenantContext) {}
  private me() { return this.ctx.require().userId!; }

  /** „Moj rad”: što čeka korisnika (izvedeno iz trenutnih podataka, bez iznosa). */
  @Authenticated() @Get('work')
  myWork() { return this.db.tx((tx) => this.work.work(tx)); }

  @Authenticated() @Get('notifications')
  notifications(@Query('before') before?: string, @Query('limit') limit?: string) {
    const b = before ? idParam(before) : undefined;
    const l = limit && /^\d{1,3}$/.test(limit) ? Number(limit) : undefined;
    return this.db.tx((tx) => this.notes.list(tx, this.me(), { before: b, limit: l }));
  }

  @Authenticated() @Post('notifications/read-all')
  readAll() { return this.db.tx((tx) => this.notes.markAllRead(tx, this.me())); }

  @Authenticated() @Post('notifications/:nid/read')
  read(@Param('nid') nid: string) { const id = idParam(nid); return this.db.tx((tx) => this.notes.markRead(tx, this.me(), id)); }

  /** Osobni kalendar rokova: stanje (postoji li poveznica), nova poveznica (token se pokazuje samo sada), opoziv. */
  @Authenticated() @Get('calendar')
  calendarStatus() { return this.db.tx((tx) => this.calendar.status(tx, this.me())); }

  @Authenticated() @Post('calendar') @Header('Cache-Control', 'no-store')
  calendarCreate() { const c = this.ctx.require(); return this.db.tx((tx) => this.calendar.generate(tx, c.tenantId, c.userId!)); }

  @Authenticated() @Delete('calendar')
  calendarRevoke() { return this.db.tx((tx) => this.calendar.revoke(tx, this.me())); }
}

/**
 * WP1.18 – JEDINA nova neprijavljena ruta: osobni kalendar rokova po tajnom tokenu u URL-u (klijenti kalendara ne šalju
 * zaglavlje Authorization). Samo čitanje; ograničenje po IP adresi; isti 404 za nepoznat, opozvan i neispravan token;
 * bez predmemoriranja (`no-store`) i bez indeksiranja.
 */
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService, private readonly limit: CalendarRateLimit) {}

  @Public() @Get(':token')
  async feed(@Param('token') token: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
    this.limit.take(req.ip);
    const body = await this.calendar.feed(token);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="arqus-rokovi.ics"');
    return body;
  }
}
