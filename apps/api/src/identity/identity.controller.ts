import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { IdentityService } from './identity.service';
import { Authenticated, ProjectPermission, Public, RequirePermission } from './auth.guard';
import { DbService } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';
import { parseBody } from '../common/validation';

const str = (max: number) => z.string().min(1).max(max);
const loginInput = z.object({ tenantSlug: str(100), email: str(320), password: str(500), code: z.string().max(10).optional() });
const createUserInput = z.object({ email: z.string().email().max(320), displayName: z.string().trim().min(2).max(200), password: z.string().max(500).optional(), roleCodes: z.array(z.string().max(60)).max(20).optional() });
const updateUserInput = z.object({ displayName: z.string().trim().min(2).max(200).optional(), status: z.enum(['active', 'disabled']).optional(), roleCodes: z.array(z.string().max(60)).max(20).optional() }).strict();
const passwordInput = z.object({ currentPassword: str(500), newPassword: str(500) });
const codeInput = z.object({ code: z.string().regex(/^\d{6}$/, 'kod ima 6 znamenki') });
const resetInput = z.object({ newPassword: str(500) });
const grantInput = z.object({ userId: z.string().uuid(), roleCode: z.string().min(1).max(60) }).strict();

@Controller()
export class IdentityController {
  constructor(private readonly identity: IdentityService, private readonly db: DbService, private readonly ctx: TenantContext) {}

  @Public() @Post('auth/login')
  login(@Body() body: unknown, @Req() req: Request) {
    const input = parseBody(loginInput, body);
    return this.identity.login(input, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Authenticated() @Post('auth/logout')
  logout() { const c = this.ctx.require(); return this.db.tx((tx) => this.identity.logout(tx, c.userId!, c.sessionId!)); }

  @Authenticated() @Get('me')
  me() { const c = this.ctx.require(); return this.db.tx((tx) => this.identity.me(tx, c.tenantId, c.userId!)); }

  @Authenticated() @Post('me/password')
  changePassword(@Body() body: unknown) {
    const i = parseBody(passwordInput, body); const c = this.ctx.require();
    return this.db.tx((tx) => this.identity.changePassword(tx, c.tenantId, c.userId!, c.sessionId!, i.currentPassword, i.newPassword));
  }

  @Authenticated() @Post('me/mfa/setup')
  mfaSetup() { const c = this.ctx.require(); return this.db.tx((tx) => this.identity.mfaSetup(tx, c.userId!)); }

  @Authenticated() @Post('me/mfa/enable')
  mfaEnable(@Body() body: unknown) { const { code } = parseBody(codeInput, body); const c = this.ctx.require(); return this.db.tx((tx) => this.identity.mfaEnable(tx, c.userId!, c.sessionId!, code)); }

  @Authenticated() @Post('me/mfa/disable')
  mfaDisable(@Body() body: unknown) { const { code } = parseBody(codeInput, body); const c = this.ctx.require(); return this.db.tx((tx) => this.identity.mfaDisable(tx, c.userId!, code)); }

  @Get('users') @RequirePermission('users:read')
  users() { return this.db.tx((tx) => this.identity.listUsers(tx)); }

  @Get('roles') @RequirePermission('roles:read')
  roles() { return this.db.tx((tx) => this.identity.listRoles(tx)); }

  @Post('users') @RequirePermission('users:write')
  createUser(@Body() body: unknown) {
    const i = parseBody(createUserInput, body); const c = this.ctx.require();
    return this.db.tx((tx) => this.identity.createUser(tx, c.tenantId, i, c.userId));
  }

  @Patch('users/:id') @RequirePermission('users:write')
  updateUser(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const i = parseBody(updateUserInput, body); const c = this.ctx.require();
    return this.db.tx((tx) => this.identity.updateUser(tx, c.tenantId, id, i, c.userId!));
  }

  @Post('users/:id/reset-password') @RequirePermission('users:write')
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { newPassword } = parseBody(resetInput, body); const c = this.ctx.require();
    return this.db.tx((tx) => this.identity.resetPassword(tx, c.tenantId, id, newPassword, c.userId!));
  }

  @Post('users/:id/reset-mfa') @RequirePermission('users:write')
  resetMfa(@Param('id', ParseUUIDPipe) id: string) { const c = this.ctx.require(); return this.db.tx((tx) => this.identity.resetMfa(tx, id, c.userId!)); }

  // Pristup projektu (WP1.14): guard traži vidljiv projekt; servis traži users:write (institucija) ili projects:write na projektu.
  @Get('projects/:id/access') @ProjectPermission('projects:read')
  projectAccess(@Param('id', ParseUUIDPipe) id: string) { return this.db.tx((tx) => this.identity.projectAccess(tx, id)); }

  @Post('projects/:id/access') @ProjectPermission('projects:read')
  grant(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const i = parseBody(grantInput, body); const c = this.ctx.require();
    return this.db.tx((tx) => this.identity.grantOnProject(tx, c.tenantId, id, i, c.userId));
  }

  @Delete('projects/:id/access/:assignmentId') @ProjectPermission('projects:read')
  revoke(@Param('id', ParseUUIDPipe) id: string, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.db.tx((tx) => this.identity.revokeOnProject(tx, id, assignmentId));
  }
}
