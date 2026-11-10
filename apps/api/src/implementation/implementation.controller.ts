import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import * as S from './implementation.service';
import { ImplementationService } from './implementation.service';
import { RequirePermission } from '../identity/auth.guard';
import { DbService } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';
import { parseBody } from '../common/validation';

const uuid = new ParseUUIDPipe();

@Controller('projects/:id')
export class ImplementationController {
  constructor(private readonly impl: ImplementationService, private readonly db: DbService, private readonly ctx: TenantContext) {}
  private run<T>(fn: (tenantId: string, userId: string | undefined) => (tx: Parameters<Parameters<DbService['tx']>[0]>[0]) => Promise<T>) {
    const c = this.ctx.require(); return this.db.tx(fn(c.tenantId, c.userId));
  }

  @Get('structure') @RequirePermission('projects:read')
  structure(@Param('id', uuid) id: string) { return this.db.tx((tx) => this.impl.structure(tx, id)); }

  @Post('work-packages') @RequirePermission('projects:write')
  createWp(@Param('id', uuid) id: string, @Body() b: unknown) { const i = parseBody(S.wpInput, b); return this.run((t, u) => (tx) => this.impl.createWp(tx, t, id, i, u)); }
  @Patch('work-packages/:wpId') @RequirePermission('projects:write')
  updateWp(@Param('id', uuid) id: string, @Param('wpId', uuid) wpId: string, @Body() b: unknown) { const i = parseBody(S.wpPatch, b); return this.run((_t, u) => (tx) => this.impl.updateWp(tx, id, wpId, i, u)); }
  @Delete('work-packages/:wpId') @RequirePermission('projects:write')
  deleteWp(@Param('id', uuid) id: string, @Param('wpId', uuid) wpId: string) { return this.db.tx((tx) => this.impl.deleteWp(tx, id, wpId)); }

  @Post('work-packages/:wpId/tasks') @RequirePermission('projects:write')
  createTask(@Param('id', uuid) id: string, @Param('wpId', uuid) wpId: string, @Body() b: unknown) { const i = parseBody(S.taskInput, b); return this.run((t, u) => (tx) => this.impl.createTask(tx, t, id, wpId, i, u)); }
  @Patch('tasks/:taskId') @RequirePermission('projects:write')
  updateTask(@Param('id', uuid) id: string, @Param('taskId', uuid) taskId: string, @Body() b: unknown) { const i = parseBody(S.taskPatch, b); return this.run((_t, u) => (tx) => this.impl.updateTask(tx, id, taskId, i, u)); }

  @Post('work-packages/:wpId/deliverables') @RequirePermission('projects:write')
  createDeliverable(@Param('id', uuid) id: string, @Param('wpId', uuid) wpId: string, @Body() b: unknown) { const i = parseBody(S.deliverableInput, b); return this.run((t, u) => (tx) => this.impl.createDeliverable(tx, t, id, wpId, i, u)); }
  @Patch('deliverables/:did') @RequirePermission('projects:write')
  updateDeliverable(@Param('id', uuid) id: string, @Param('did', uuid) did: string, @Body() b: unknown) { const i = parseBody(S.deliverablePatch, b); return this.run((_t, u) => (tx) => this.impl.updateDeliverable(tx, id, did, i, u)); }

  @Post('milestones') @RequirePermission('projects:write')
  createMilestone(@Param('id', uuid) id: string, @Body() b: unknown) { const i = parseBody(S.milestoneInput, b); return this.run((t, u) => (tx) => this.impl.createMilestone(tx, t, id, i, u)); }
  @Patch('milestones/:mid') @RequirePermission('projects:write')
  updateMilestone(@Param('id', uuid) id: string, @Param('mid', uuid) mid: string, @Body() b: unknown) { const i = parseBody(S.milestonePatch, b); return this.run((_t, u) => (tx) => this.impl.updateMilestone(tx, id, mid, i, u)); }

  @Post('risks') @RequirePermission('projects:write')
  createRisk(@Param('id', uuid) id: string, @Body() b: unknown) { const i = parseBody(S.riskInput, b); return this.run((t, u) => (tx) => this.impl.createRisk(tx, t, id, i, u)); }
  @Patch('risks/:rid') @RequirePermission('projects:write')
  updateRisk(@Param('id', uuid) id: string, @Param('rid', uuid) rid: string, @Body() b: unknown) { const i = parseBody(S.riskPatch, b); return this.run((_t, u) => (tx) => this.impl.updateRisk(tx, id, rid, i, u)); }
}
