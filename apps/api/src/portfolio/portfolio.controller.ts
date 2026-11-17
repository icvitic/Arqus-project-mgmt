import { Controller, Get, Query } from '@nestjs/common';
import { DEADLINE_WINDOW_DAYS } from '@arqus/domain';
import { PortfolioService } from './portfolio.service';
import { AnyScope } from '../identity/auth.guard';
import { DbService } from '../db/db.service';

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService, private readonly db: DbService) {}

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
}
