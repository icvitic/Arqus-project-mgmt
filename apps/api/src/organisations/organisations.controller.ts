import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { OrganisationsService, organisationInput, organisationPatch } from './organisations.service';
import { RequirePermission } from '../identity/auth.guard';
import { DbService } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';
import { parseBody } from '../common/validation';

@Controller('organisations')
export class OrganisationsController {
  constructor(private readonly orgs: OrganisationsService, private readonly db: DbService, private readonly ctx: TenantContext) {}

  @Get() @RequirePermission('organisations:read')
  list(@Query('q') q?: string) { return this.db.tx((tx) => this.orgs.list(tx, q)); }

  @Get(':id') @RequirePermission('organisations:read')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.db.tx((tx) => this.orgs.get(tx, id)); }

  @Post() @RequirePermission('organisations:write')
  create(@Body() body: unknown) {
    const input = parseBody(organisationInput, body); const c = this.ctx.require();
    return this.db.tx((tx) => this.orgs.create(tx, c.tenantId, input, c.userId));
  }

  @Patch(':id') @RequirePermission('organisations:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const patch = parseBody(organisationPatch, body); const c = this.ctx.require();
    return this.db.tx((tx) => this.orgs.update(tx, id, patch, c.userId));
  }
}
