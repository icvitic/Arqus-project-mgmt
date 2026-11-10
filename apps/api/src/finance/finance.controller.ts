import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { TimesheetsService, memberInput, timesheetInput, monthParam } from './timesheets.service';
import { ExpensesService, expenseInput, expensePatch } from './expenses.service';
import { ClaimsService, claimInput, decisionInput, paymentInput } from './claims.service';
import { RequirePermission } from '../identity/auth.guard';
import { DbService, type Tx } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';
import { parseBody } from '../common/validation';

const uuid = new ParseUUIDPipe();

@Controller('projects/:id')
export class FinanceController {
  constructor(private readonly ts: TimesheetsService, private readonly ex: ExpensesService, private readonly cl: ClaimsService, private readonly db: DbService, private readonly ctx: TenantContext) {}
  private run<T>(fn: (tx: Tx, tenantId: string, userId?: string) => Promise<T>) { const c = this.ctx.require(); return this.db.tx((tx) => fn(tx, c.tenantId, c.userId)); }
  private month(m: string) { return parseBody(monthParam, m); }

  // Tim i timesheetovi
  @Get('team') @RequirePermission('timesheets:read') team(@Param('id', uuid) id: string) { return this.run((tx) => this.ts.team(tx, id)); }
  @Post('team') @RequirePermission('finance:write') addMember(@Param('id', uuid) id: string, @Body() b: unknown) { const i = parseBody(memberInput, b); return this.run((tx, t, u) => this.ts.addMember(tx, t, id, i, u)); }
  @Get('team/:mid/timesheets/:month') @RequirePermission('timesheets:read') getTs(@Param('id', uuid) id: string, @Param('mid', uuid) mid: string, @Param('month') m: string) { const month = this.month(m); return this.run((tx) => this.ts.get(tx, id, mid, month)); }
  @Put('team/:mid/timesheets/:month') @RequirePermission('timesheets:write') saveTs(@Param('id', uuid) id: string, @Param('mid', uuid) mid: string, @Param('month') m: string, @Body() b: unknown) { const month = this.month(m); const i = parseBody(timesheetInput, b); return this.run((tx, t, u) => this.ts.save(tx, t, id, mid, month, i, u)); }
  @Post('team/:mid/timesheets/:month/submit') @RequirePermission('timesheets:write') submitTs(@Param('id', uuid) id: string, @Param('mid', uuid) mid: string, @Param('month') m: string) { const month = this.month(m); return this.run((tx, _t, u) => this.ts.submit(tx, id, mid, month, u)); }
  @Post('team/:mid/timesheets/:month/approve') @RequirePermission('timesheets:approve') approveTs(@Param('id', uuid) id: string, @Param('mid', uuid) mid: string, @Param('month') m: string) { const month = this.month(m); return this.run((tx, t, u) => this.ts.approve(tx, t, id, mid, month, u)); }
  @Post('team/:mid/timesheets/:month/reopen') @RequirePermission('timesheets:approve') reopenTs(@Param('id', uuid) id: string, @Param('mid', uuid) mid: string, @Param('month') m: string) { const month = this.month(m); return this.run((tx, _t, u) => this.ts.reopen(tx, id, mid, month, u)); }

  // Troškovi i pregled
  @Get('expenses') @RequirePermission('finance:read') expenses(@Param('id', uuid) id: string, @Query('status') status?: string, @Query('period') period?: string) { return this.run((tx) => this.ex.list(tx, id, { status, period: period ? Number(period) : undefined })); }
  @Post('expenses') @RequirePermission('finance:write') createExpense(@Param('id', uuid) id: string, @Body() b: unknown) { const i = parseBody(expenseInput, b); return this.run((tx, t, u) => this.ex.create(tx, t, id, i, u)); }
  @Patch('expenses/:eid') @RequirePermission('finance:write') updateExpense(@Param('id', uuid) id: string, @Param('eid', uuid) eid: string, @Body() b: unknown) { const i = parseBody(expensePatch, b); return this.run((tx, _t, u) => this.ex.update(tx, id, eid, i, u)); }
  @Delete('expenses/:eid') @RequirePermission('finance:write') deleteExpense(@Param('id', uuid) id: string, @Param('eid', uuid) eid: string) { return this.run((tx) => this.ex.remove(tx, id, eid)); }
  @Get('finance') @RequirePermission('finance:read') overview(@Param('id', uuid) id: string) { return this.run((tx) => this.ex.overview(tx, id)); }

  // Zahtjevi za nadoknadu
  @Get('claims') @RequirePermission('finance:read') claims(@Param('id', uuid) id: string) { return this.run((tx) => this.cl.list(tx, id)); }
  @Post('claims') @RequirePermission('finance:write') createClaim(@Param('id', uuid) id: string, @Body() b: unknown) { const i = parseBody(claimInput, b); return this.run((tx, t, u) => this.cl.create(tx, t, id, i, u)); }
  @Get('claims/:cid') @RequirePermission('finance:read') claim(@Param('id', uuid) id: string, @Param('cid', uuid) cid: string) { return this.run((tx) => this.cl.get(tx, id, cid)); }
  @Post('claims/:cid/submit') @RequirePermission('finance:write') submitClaim(@Param('id', uuid) id: string, @Param('cid', uuid) cid: string) { return this.run((tx, _t, u) => this.cl.submit(tx, id, cid, u)); }
  @Post('claims/:cid/decision') @RequirePermission('finance:write') decide(@Param('id', uuid) id: string, @Param('cid', uuid) cid: string, @Body() b: unknown) { const i = parseBody(decisionInput, b); return this.run((tx, _t, u) => this.cl.decide(tx, id, cid, i, u)); }
  @Post('claims/:cid/payment') @RequirePermission('finance:write') pay(@Param('id', uuid) id: string, @Param('cid', uuid) cid: string, @Body() b: unknown) { const i = parseBody(paymentInput, b); return this.run((tx, _t, u) => this.cl.pay(tx, id, cid, i, u)); }
}
