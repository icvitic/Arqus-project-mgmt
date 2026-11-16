import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CallsService, assessmentInput, callInput, callPatch, decisionInput } from './calls.service';
import { RequirePermission } from '../identity/auth.guard';
import { DbService, type Tx } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';
import { parseBody } from '../common/validation';

@Controller('calls')
export class CallsController {
  constructor(private readonly calls: CallsService, private readonly db: DbService, private readonly ctx: TenantContext) {}
  private run<T>(fn: (tx: Tx, tenantId: string, userId?: string) => Promise<T>) { const c = this.ctx.require(); return this.db.tx((tx) => fn(tx, c.tenantId, c.userId)); }

  @Get() @RequirePermission('calls:read')
  list(@Query('status') status?: string, @Query('q') q?: string, @Query('tracked') tracked?: string, @Query('programme') programme?: string, @Query('scope') scope?: string, @Query('mine') mine?: string) {
    return this.run((tx) => this.calls.list(tx, { status, q, tracked: tracked === 'true', programme, scope, mine: mine === 'true' }));
  }

  @Get('programmes') @RequirePermission('calls:read')
  programmes() { return this.run((tx) => this.calls.programmes(tx)); }

  @Get('sources') @RequirePermission('calls:read')
  sources() { return this.run((tx) => this.calls.sources(tx)); }

  @Get('deadlines') @RequirePermission('calls:read')
  deadlines(@Query('days') days?: string) { return this.run((tx) => this.calls.deadlines(tx, Math.min(Math.max(Number(days) || 60, 1), 365))); }

  @Get(':id') @RequirePermission('calls:read')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.run((tx) => this.calls.get(tx, id)); }

  @Post() @RequirePermission('calls:write')
  create(@Body() b: unknown) { const i = parseBody(callInput, b); return this.run((tx, t, u) => this.calls.create(tx, t, i, u)); }

  @Patch(':id') @RequirePermission('calls:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { const i = parseBody(callPatch, b); return this.run((tx, t, u) => this.calls.update(tx, t, id, i, u)); }

  @Put(':id/assessment') @RequirePermission('calls:write')
  assess(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { const i = parseBody(assessmentInput, b); return this.run((tx, t, u) => this.calls.assess(tx, t, id, i, u)); }

  @Put(':id/decision') @RequirePermission('calls:write')
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { const i = parseBody(decisionInput, b); return this.run((tx, t, u) => this.calls.decide(tx, t, id, i, u)); }
}
