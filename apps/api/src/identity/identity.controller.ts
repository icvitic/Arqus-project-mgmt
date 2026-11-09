import { Body, Controller, Get, Post, BadRequestException } from '@nestjs/common';
import { IdentityService, type LoginInput, type CreateUserInput } from './identity.service';
import { Public, RequirePermission } from './auth.guard';
import { DbService } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';

@Controller()
export class IdentityController {
  constructor(private readonly identity: IdentityService, private readonly db: DbService, private readonly ctx: TenantContext) {}

  @Public() @Post('auth/login')
  login(@Body() body: LoginInput) {
    if (!body?.tenantSlug || !body?.email || !body?.password) throw new BadRequestException('tenantSlug, email i password su obvezni');
    return this.identity.login(body);
  }

  @Get('me')
  me() { const c = this.ctx.require(); return this.db.tx((tx) => this.identity.me(tx, c.tenantId, c.userId!)); }

  @Get('users') @RequirePermission('users:read')
  users() { return this.db.tx((tx) => this.identity.listUsers(tx)); }

  @Post('users') @RequirePermission('users:write')
  createUser(@Body() body: CreateUserInput) {
    if (!body?.email || !body?.displayName) throw new BadRequestException('email i displayName su obvezni');
    const c = this.ctx.require();
    return this.db.tx((tx) => this.identity.createUser(tx, c.tenantId, body, c.userId));
  }
}
