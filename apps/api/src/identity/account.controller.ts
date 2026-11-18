import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Public, RequirePermission } from './auth.guard';
import { AccountService } from './account.service';
import { DbService } from '../db/db.service';
import { MailService } from '../mail/mail.service';
import { parseBody } from '../common/validation';

/** WP1.21: novi korisnik bez lozinke (`.strict()` – polje `password` se odbija: lozinku bira samo korisnik). */
const createUserInput = z.object({ email: z.string().email().max(320), displayName: z.string().trim().min(2).max(200), roleCodes: z.array(z.string().max(60)).max(20).optional() }).strict();
const forgotInput = z.object({ tenantSlug: z.string().min(1).max(100), email: z.string().min(1).max(320) }).strict();
/** Token kao niz do 500 znakova – oblik se provjerava u servisu, istim putem kao nepoznat token (isti odgovor). */
const tokenField = z.string().max(500);
const inspectInput = z.object({ token: tokenField, kind: z.enum(['invite', 'reset']) }).strict();
const acceptInput = z.object({ token: tokenField, password: z.string().min(1).max(500) }).strict();

const client = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

/**
 * WP1.21 – računi bez dijeljenja lozinki. Upravljanje pozivnicama traži istu dozvolu kao upravljanje korisnicima
 * (`users:write`). Četiri JAVNE rute (bez prijave) – svaka s ograničenjem (`AccountRateLimit`) i jednoobraznim odgovorom;
 * token uvijek u TIJELU zahtjeva (u sučelju je u fragmentu URL-a `#/pozivnica/<token>`, koji preglednik ne šalje
 * poslužitelju), nikad u putanji ili upitu.
 */
@Controller()
export class AccountController {
  constructor(private readonly account: AccountService, private readonly mail: MailService, private readonly db: DbService) {}

  @Post('users') @RequirePermission('users:write')
  createUser(@Body() body: unknown) { return this.account.createAndInvite(parseBody(createUserInput, body)); }

  @Post('users/:id/invitation') @RequirePermission('users:write')
  resendInvitation(@Param('id', ParseUUIDPipe) id: string) { return this.account.resendInvitation(id); }

  @Delete('users/:id/invitation') @RequirePermission('users:write')
  cancelInvitation(@Param('id', ParseUUIDPipe) id: string) { return this.account.cancelInvitation(id); }

  @Post('users/:id/password-link') @RequirePermission('users:write')
  passwordLink(@Param('id', ParseUUIDPipe) id: string) { return this.account.issuePasswordLink(id); }

  /** Stanje e-pošte i zadnje isporuke (bez sadržaja) – čita tko vidi korisnike. */
  @Get('tenant/mail') @RequirePermission('users:read')
  mailStatus() { return this.db.tx((tx) => this.mail.status(tx)); }

  @Post('tenant/mail/test') @RequirePermission('users:write')
  mailTest() { return this.account.sendTestMail(); }

  // ---------- javne rute ----------

  @Public() @Post('auth/password/forgot') @HttpCode(202)
  forgot(@Body() body: unknown, @Req() req: Request) { return this.account.forgot(parseBody(forgotInput, body), client(req)); }

  @Public() @Post('auth/token/inspect')
  inspect(@Body() body: unknown, @Req() req: Request) { const i = parseBody(inspectInput, body); return this.account.inspect(i.token, i.kind, client(req)); }

  @Public() @Post('auth/invitation/accept')
  accept(@Body() body: unknown, @Req() req: Request) { const i = parseBody(acceptInput, body); return this.account.acceptInvitation(i.token, i.password, client(req)); }

  @Public() @Post('auth/password/reset')
  reset(@Body() body: unknown, @Req() req: Request) { const i = parseBody(acceptInput, body); return this.account.resetPassword(i.token, i.password, client(req)); }
}
