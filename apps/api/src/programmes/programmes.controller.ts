import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ProgrammePackagesService } from './programme-packages.service';
import { RequirePermission } from '../identity/auth.guard';
import { DbService } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';

@Controller('programme-packages')
export class ProgrammesController {
  constructor(private readonly packages: ProgrammePackagesService, private readonly db: DbService, private readonly ctx: TenantContext) {}

  @Get() @RequirePermission('packages:read')
  list(@Query('status') status?: string) { return this.db.tx((tx) => this.packages.list(tx, { status })); }

  @Post('validate') @RequirePermission('packages:read')
  validate(@Body() body: unknown) { return this.db.tx((tx) => this.packages.validate(tx, body)); }

  @Post() @RequirePermission('packages:write')
  create(@Body() body: unknown) { const c = this.ctx.require(); return this.db.tx((tx) => this.packages.create(tx, c.tenantId, body, c.userId)); }

  @Post(':rowId/publish') @RequirePermission('packages:write')
  publish(@Param('rowId') rowId: string) { const c = this.ctx.require(); return this.db.tx((tx) => this.packages.publish(tx, c.tenantId, rowId, c.userId)); }

  @Get(':packageId') @RequirePermission('packages:read')
  get(@Param('packageId') packageId: string, @Query('version') version?: string) { return this.db.tx((tx) => this.packages.get(tx, packageId, version)); }
}
