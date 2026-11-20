import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Authenticated, Public, RequirePermission } from '../identity/auth.guard';
import { DbService } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';
import { ExportRateLimit } from '../common/rate-limit';
import { parseBody } from '../common/validation';
import { PrivacyService } from './privacy.service';
import { RetentionService } from './retention.service';
import { searchPeople, type SubjectRef } from './subject-data';
import { privacySettingsInput } from './retention-policy';
import {
  subjectRequestCloseInput, subjectRequestCreateInput, subjectRequestExtendInput, subjectRequestRevisionInput, subjectRequestUpdateInput, SubjectRequestsService,
} from './subject-requests.service';

const uuid = z.string().uuid();
const subjectInput = z.object({ userId: uuid.nullable().optional(), memberIds: z.array(uuid).max(200).default([]) }).strict();
const closeInput = z.object({ confirmation: z.string().min(1).max(300), reason: z.string().trim().min(5, 'razlog ima najmanje 5 znakova').max(1000) }).strict();
const anonymiseInput = z.object({ confirmation: z.string().min(1).max(300), fingerprint: z.string().regex(/^[0-9a-f]{64}$/), reason: z.string().trim().max(1000).nullable().optional() }).strict();
const disposition = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** Upit izvoza: `userId` i/ili `memberIds` (zarezom odvojeni UUID-ovi) – GET, jer preuzimanje u sučelju ide kroz `downloadFile`. */
function subjectFromQuery(userId?: string, memberIds?: string): SubjectRef {
  const ids = (memberIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const parsed = subjectInput.safeParse({ userId: userId || null, memberIds: ids });
  if (!parsed.success) throw new BadRequestException('Neispravan odabir osobe (userId, memberIds)');
  return { userId: parsed.data.userId ?? null, memberIds: parsed.data.memberIds };
}

function zipResponse(res: Response, fileName: string, stream: NodeJS.ReadableStream): StreamableFile {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store, private');
  const file = new StreamableFile(stream as never, { type: 'application/zip', disposition: disposition(fileName) });
  file.setErrorHandler((_err, response) => { (response as Response).destroy(); });
  return file;
}

/**
 * WP1.23 – prava ispitanika i rokovi čuvanja. Sve rute institucije traže `privacy:manage` (samo administrator, `*`);
 * izvoz je ograničen po korisniku (`ExportRateLimit`), struji se i ne predmemorira (`no-store`).
 */
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService, private readonly retention: RetentionService, private readonly requests: SubjectRequestsService, private readonly db: DbService, private readonly ctx: TenantContext, private readonly limit: ExportRateLimit) {}

  @Get('people') @RequirePermission('privacy:manage')
  people(@Query('q') q?: string) {
    const term = (q ?? '').trim();
    if (term.length < 2 || term.length > 100) throw new BadRequestException('Upiši barem 2 znaka imena ili e-adrese');
    return this.db.tx((tx) => searchPeople(tx, term));
  }

  @Post('subject') @RequirePermission('privacy:manage')
  subject(@Body() body: unknown) {
    const i = parseBody(subjectInput, body);
    return this.db.tx((tx) => this.privacy.subject(tx, { userId: i.userId ?? null, memberIds: i.memberIds }));
  }

  @Get('export') @RequirePermission('privacy:manage')
  async export(@Query('userId') userId: string | undefined, @Query('memberIds') memberIds: string | undefined, @Res({ passthrough: true }) res: Response) {
    const ref = subjectFromQuery(userId, memberIds);
    this.limit.take('privacy-export', this.ctx.require().userId!);
    const { fileName, stream } = await this.privacy.export(ref);
    return zipResponse(res, fileName, stream);
  }

  @Post('users/:id/close') @RequirePermission('privacy:manage')
  close(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const i = parseBody(closeInput, body);
    return this.db.tx((tx) => this.privacy.close(tx, id, i));
  }

  @Post('members/:mid/anonymise/preview') @RequirePermission('privacy:manage')
  anonymisePreview(@Param('mid', ParseUUIDPipe) mid: string) { return this.db.tx((tx) => this.privacy.anonymisePreview(tx, mid)); }

  @Post('members/:mid/anonymise') @RequirePermission('privacy:manage')
  anonymise(@Param('mid', ParseUUIDPipe) mid: string, @Body() body: unknown) {
    const i = parseBody(anonymiseInput, body);
    return this.db.tx((tx) => this.privacy.anonymise(tx, mid, i));
  }

  @Get('retention') @RequirePermission('privacy:manage')
  retentionOverview() { return this.db.tx((tx) => this.retention.overview(tx)); }

  @Put('retention') @RequirePermission('privacy:manage')
  retentionUpdate(@Body() body: unknown) { const i = parseBody(privacySettingsInput, body); return this.db.tx((tx) => this.retention.update(tx, i)); }

  /** Probno izvođenje: isto brojanje kao posao, ništa se ne briše; rezultat se sprema kao „probno”. */
  @Post('retention/dry-run') @RequirePermission('privacy:manage')
  retentionDryRun() {
    const c = this.ctx.require();
    return this.retention.runTenant(c.tenantId, { dryRun: true, actorId: c.userId ?? null });
  }

  // ---------- WP1.24: evidencija zahtjeva ispitanika (rok od mjesec dana, čl. 12(3)) ----------
  @Get('requests') @RequirePermission('privacy:manage')
  requestList() { return this.db.tx((tx) => this.requests.list(tx)); }

  @Post('requests') @RequirePermission('privacy:manage')
  requestCreate(@Body() body: unknown) { const i = parseBody(subjectRequestCreateInput, body); return this.db.tx((tx) => this.requests.create(tx, i)); }

  @Put('requests/:requestId') @RequirePermission('privacy:manage')
  requestUpdate(@Param('requestId', ParseUUIDPipe) id: string, @Body() body: unknown) { const i = parseBody(subjectRequestUpdateInput, body); return this.db.tx((tx) => this.requests.update(tx, id, i)); }

  @Post('requests/:requestId/extend') @RequirePermission('privacy:manage')
  requestExtend(@Param('requestId', ParseUUIDPipe) id: string, @Body() body: unknown) { const i = parseBody(subjectRequestExtendInput, body); return this.db.tx((tx) => this.requests.extend(tx, id, i)); }

  @Post('requests/:requestId/extend/cancel') @RequirePermission('privacy:manage')
  requestCancelExtension(@Param('requestId', ParseUUIDPipe) id: string, @Body() body: unknown) { const i = parseBody(subjectRequestRevisionInput, body); return this.db.tx((tx) => this.requests.cancelExtension(tx, id, i)); }

  @Post('requests/:requestId/close') @RequirePermission('privacy:manage')
  requestClose(@Param('requestId', ParseUUIDPipe) id: string, @Body() body: unknown) { const i = parseBody(subjectRequestCloseInput, body); return this.db.tx((tx) => this.requests.close(tx, id, i)); }

  @Post('requests/:requestId/reopen') @RequirePermission('privacy:manage')
  requestReopen(@Param('requestId', ParseUUIDPipe) id: string, @Body() body: unknown) { const i = parseBody(subjectRequestRevisionInput, body); return this.db.tx((tx) => this.requests.reopen(tx, id, i)); }
}

/** Samoposluga: korisnik preuzima vlastite podatke (Moj račun) – bez id-ja u putanji, uvijek osoba iz sesije. */
@Controller('me')
export class MyDataController {
  constructor(private readonly privacy: PrivacyService, private readonly ctx: TenantContext, private readonly limit: ExportRateLimit) {}

  @Get('privacy-export') @Authenticated()
  async export(@Res({ passthrough: true }) res: Response) {
    this.limit.take('privacy-export-self', this.ctx.require().userId!);
    const { fileName, stream } = await this.privacy.export('self');
    return zipResponse(res, fileName, stream);
  }
}

/**
 * WP1.23 – javni podaci za stranicu „Privatnost” (bez prijave): kontakt za pitanja o osobnim podacima koji postavlja
 * instalacija (`PRIVACY_CONTACT`) – ne izmišlja se. Bez kontakta vraća null.
 */
export function privacyContact(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = (env.PRIVACY_CONTACT ?? '').trim();
  return v ? v.slice(0, 300) : null;
}

@Controller('public')
export class PublicPrivacyController {
  @Public() @Get('privacy')
  info(): { contact: string | null } { return { contact: privacyContact() }; }
}
