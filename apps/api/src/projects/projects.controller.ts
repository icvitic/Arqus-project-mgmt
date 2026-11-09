import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ProjectsService, projectInput, projectPatch, partnerAdd, transitionInput } from './projects.service';
import { RequirePermission } from '../identity/auth.guard';
import { DbService } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';
import { parseBody } from '../common/validation';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService, private readonly db: DbService, private readonly ctx: TenantContext) {}

  @Get() @RequirePermission('projects:read')
  list() { return this.db.tx((tx) => this.projects.list(tx)); }

  @Get(':id') @RequirePermission('projects:read')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.db.tx((tx) => this.projects.get(tx, id)); }

  @Post() @RequirePermission('projects:write')
  create(@Body() body: unknown) {
    const input = parseBody(projectInput, body); const c = this.ctx.require();
    return this.db.tx((tx) => this.projects.create(tx, c.tenantId, input, c.userId));
  }

  @Patch(':id') @RequirePermission('projects:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const patch = parseBody(projectPatch, body); const c = this.ctx.require();
    return this.db.tx((tx) => this.projects.update(tx, id, patch, c.userId));
  }

  @Post(':id/partners') @RequirePermission('projects:write')
  addPartner(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parseBody(partnerAdd, body); const c = this.ctx.require();
    return this.db.tx((tx) => this.projects.addPartner(tx, c.tenantId, id, input, c.userId));
  }

  @Delete(':id/partners/:partnerId') @RequirePermission('projects:write')
  removePartner(@Param('id', ParseUUIDPipe) id: string, @Param('partnerId', ParseUUIDPipe) partnerId: string) {
    return this.db.tx((tx) => this.projects.removePartner(tx, id, partnerId));
  }

  @Post(':id/transition') @RequirePermission('projects:write')
  transition(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { to } = parseBody(transitionInput, body); const c = this.ctx.require();
    return this.db.tx((tx) => this.projects.transition(tx, c.tenantId, id, to, c.userId));
  }
}
