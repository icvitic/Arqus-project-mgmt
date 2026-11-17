import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { DEADLINE_WINDOW_DAYS } from '@arqus/domain';
import { PortfolioService } from './portfolio.service';
import { AnyScope, RequirePermission } from '../identity/auth.guard';
import { DbService } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';
import { parseBody } from '../common/validation';

/** Polazna mjera: sati pripreme jednog ZNS-a prije ArQusa (null briše postavku). */
const baselineInput = z.object({ hours: z.number().gt(0).max(10_000).nullable() }).strict();

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService, private readonly db: DbService, private readonly ctx: TenantContext) {}

  /**
   * Portfelj institucije (WP1.15). Dostupan svakome tko vidi barem jedan projekt; sadržaj je ograničen na ono što
   * korisnik smije vidjeti (servis). `days` – prozor rokova unaprijed (1–365, zadano 60).
   */
  @Get() @AnyScope('projects:read')
  overview(@Query('days') days?: string) {
    const n = Number(days);
    const window = Number.isInteger(n) && n >= 1 ? Math.min(n, 365) : DEADLINE_WINDOW_DAYS;
    return this.db.tx((tx) => this.portfolio.overview(tx, { days: window }));
  }

  /** „Ušteda na ZNS-u” (WP1.16b): izvještaj za cijelu instituciju – samo uz `portfolio:read` na razini institucije. */
  @Get('claim-savings') @RequirePermission('portfolio:read')
  claimSavings() { return this.db.tx((tx) => this.portfolio.claimSavings(tx)); }

  /** Polazna mjera „sati po ZNS-u prije ArQusa” – postavka institucije (`tenant:write`: ured za projekte, administrator). */
  @Put('claim-savings/baseline') @RequirePermission('tenant:write')
  setBaseline(@Body() b: unknown) {
    const { hours } = parseBody(baselineInput, b); const c = this.ctx.require();
    return this.db.tx((tx) => this.portfolio.setBaseline(tx, hours, c.userId));
  }
}
