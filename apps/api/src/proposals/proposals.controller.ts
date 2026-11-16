import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import * as S from './proposals.service';
import { ProposalsService } from './proposals.service';
import { RequirePermission } from '../identity/auth.guard';
import { DbService, type Tx } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';
import { parseBody } from '../common/validation';

const uuid = new ParseUUIDPipe();

@Controller()
export class ProposalsController {
  constructor(private readonly p: ProposalsService, private readonly db: DbService, private readonly ctx: TenantContext) {}
  private run<T>(fn: (tx: Tx, tenantId: string, userId?: string) => Promise<T>) { const c = this.ctx.require(); return this.db.tx((tx) => fn(tx, c.tenantId, c.userId)); }

  @Get('proposals') @RequirePermission('proposals:read') list() { return this.run((tx) => this.p.list(tx)); }
  @Get('proposals/:id') @RequirePermission('proposals:read') get(@Param('id', uuid) id: string) { return this.run((tx) => this.p.get(tx, id)); }
  @Post('proposals') @RequirePermission('proposals:write') create(@Body() b: unknown) { const i = parseBody(S.proposalInput, b); return this.run((tx, t, u) => this.p.create(tx, t, i, u)); }
  @Post('calls/:callId/proposal') @RequirePermission('proposals:write') fromCall(@Param('callId', uuid) callId: string, @Body() b: unknown) { const i = parseBody(S.fromCallInput, b); return this.run((tx, t, u) => this.p.createFromCall(tx, t, callId, i, u)); }
  @Patch('proposals/:id') @RequirePermission('proposals:write') update(@Param('id', uuid) id: string, @Body() b: unknown) { const i = parseBody(S.proposalPatch, b); return this.run((tx, _t, u) => this.p.update(tx, id, i, u)); }
  @Post('proposals/:id/members') @RequirePermission('proposals:write') addMember(@Param('id', uuid) id: string, @Body() b: unknown) { const i = parseBody(S.memberInput, b); return this.run((tx, t, u) => this.p.addMember(tx, t, id, i, u)); }
  @Patch('proposals/:id/members/:mid') @RequirePermission('proposals:write') updateMember(@Param('id', uuid) id: string, @Param('mid', uuid) mid: string, @Body() b: unknown) { const i = parseBody(S.memberPatch, b); return this.run((tx) => this.p.updateMember(tx, id, mid, i)); }
  @Delete('proposals/:id/members/:mid') @RequirePermission('proposals:write') removeMember(@Param('id', uuid) id: string, @Param('mid', uuid) mid: string) { return this.run((tx) => this.p.removeMember(tx, id, mid)); }
  @Post('proposals/:id/work-packages') @RequirePermission('proposals:write') addWp(@Param('id', uuid) id: string, @Body() b: unknown) { const i = parseBody(S.wpInput, b); return this.run((tx, t) => this.p.addWorkPackage(tx, t, id, i)); }
  @Delete('proposals/:id/work-packages/:wpId') @RequirePermission('proposals:write') removeWp(@Param('id', uuid) id: string, @Param('wpId', uuid) wpId: string) { return this.run((tx) => this.p.removeWorkPackage(tx, id, wpId)); }
  @Put('proposals/:id/budget/lines') @RequirePermission('proposals:write') budget(@Param('id', uuid) id: string, @Body() b: unknown) { const i = parseBody(S.budgetInput, b); return this.run((tx, t, u) => this.p.replaceBudget(tx, t, id, i, u)); }
  @Post('proposals/:id/budget/lock') @RequirePermission('proposals:write') lock(@Param('id', uuid) id: string) { return this.run((tx, _t, u) => this.p.lockBudget(tx, id, true, u)); }
  @Post('proposals/:id/budget/unlock') @RequirePermission('proposals:write') unlock(@Param('id', uuid) id: string) { return this.run((tx, _t, u) => this.p.lockBudget(tx, id, false, u)); }
  @Post('proposals/:id/transition') @RequirePermission('proposals:write') transition(@Param('id', uuid) id: string, @Body() b: unknown) { const { to } = parseBody(S.transitionInput, b); return this.run((tx, _t, u) => this.p.transition(tx, id, to, u)); }
  @Post('proposals/:id/submit') @RequirePermission('proposals:write') submit(@Param('id', uuid) id: string, @Body() b: unknown) { const i = parseBody(S.submitInput, b); return this.run((tx, _t, u) => this.p.submit(tx, id, i, u)); }
  @Post('proposals/:id/outcome') @RequirePermission('proposals:write') outcome(@Param('id', uuid) id: string, @Body() b: unknown) { const i = parseBody(S.outcomeInput, b); return this.run((tx, _t, u) => this.p.setOutcome(tx, id, i, u)); }
  @Post('proposals/:id/contract') @RequirePermission('projects:write') contract(@Param('id', uuid) id: string, @Body() b: unknown) { const i = parseBody(S.contractInput, b); return this.run((tx, t, u) => this.p.contract(tx, t, id, i, u)); }
}
