import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ProgrammePackagesService } from './programme-packages.service';
import { AnyScope, RequirePermission } from '../identity/auth.guard';
import { DbService } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';

/** Čitanje paketa treba svatko tko radi na projektu (kategorije, pravila); objava i izmjene su radnja institucije. */
@Controller('programme-packages')
export class ProgrammesController {
  constructor(private readonly packages: ProgrammePackagesService, private readonly db: DbService, private readonly ctx: TenantContext) {}

  @Get() @AnyScope('packages:read')
  list(@Query('status') status?: string) { return this.db.tx((tx) => this.packages.list(tx, { status })); }

  @Post('validate') @RequirePermission('packages:read')
  validate(@Body() body: unknown) { return this.db.tx((tx) => this.packages.validate(tx, body)); }

  @Post() @RequirePermission('packages:write')
  create(@Body() body: unknown) { const c = this.ctx.require(); return this.db.tx((tx) => this.packages.create(tx, c.tenantId, body, c.userId)); }

  @Post(':rowId/publish') @RequirePermission('packages:write')
  publish(@Param('rowId', ParseUUIDPipe) rowId: string) { const c = this.ctx.require(); return this.db.tx((tx) => this.packages.publish(tx, c.tenantId, rowId, c.userId)); }

  @Get('rows/:rowId') @AnyScope('packages:read')
  raw(@Param('rowId', ParseUUIDPipe) rowId: string) { return this.db.tx((tx) => this.packages.raw(tx, rowId)); }

  @Delete('rows/:rowId') @RequirePermission('packages:write')
  remove(@Param('rowId', ParseUUIDPipe) rowId: string) { const c = this.ctx.require(); return this.db.tx((tx) => this.packages.removeDraft(tx, c.tenantId, rowId)); }

  @Get(':packageId') @AnyScope('packages:read')
  get(@Param('packageId') packageId: string, @Query('version') version?: string) { return this.db.tx((tx) => this.packages.get(tx, packageId, version)); }
}
