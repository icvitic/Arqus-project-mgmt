import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import type { ImportSheetKey } from '@arqus/domain';
import { ProjectPermission } from '../identity/auth.guard';
import { DbService, type Tx } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';
import { parseBody } from '../common/validation';
import { ExportRateLimit } from '../common/rate-limit';
import { IMPORT_LIMITS, ImportFileError } from './limits';
import { ProjectImportService } from './project-import.service';

const uuid = new ParseUUIDPipe();
const upload = FileInterceptor('file', { limits: { fileSize: IMPORT_LIMITS.maxFileBytes, files: 1, fields: 10, fieldSize: 4096 } });
const disposition = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
const SHEETS = ['workPackages', 'deliverables', 'milestones', 'budget', 'team', 'expenses'] as const;
const sheetList = z.string().max(200).optional().transform((s, ctx) => {
  const list = (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  for (const x of list) if (!(SHEETS as readonly string[]).includes(x)) { ctx.addIssue({ code: 'custom', message: `nepoznat list "${x.slice(0, 30)}"` }); return z.NEVER; }
  return [...new Set(list)] as ImportSheetKey[];
});
const previewInput = z.object({ skip: sheetList, csvSheet: z.enum(SHEETS).optional() }).strict();
const confirmInput = previewInput.extend({
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, 'SHA-256 datoteke iz pregleda (64 heksadekadska znaka)'),
  /** Revizija projekta iz pregleda (obavezna, WP1.19). */
  revision: z.coerce.number({ error: 'Nedostaje revizija projekta (revision) iz pregleda' }).int().min(0).max(2_147_483_647),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/, 'otisak plana iz pregleda'),
  acknowledgeWarnings: z.enum(['true', 'false', '1', '0']).optional().transform((v) => v === 'true' || v === '1'),
}).strict();
interface File { buffer: Buffer; originalname: string; size: number }

/**
 * WP1.17 – uvoz postojećeg projekta iz Excela. Sve rute su projektne (`@ProjectPermission('projects:read')`: nevidljiv
 * projekt → 404); dozvole pisanja provjerava servis po listu (struktura `projects:write`, proračun, tim i troškovi
 * `finance:write`, godišnji trošak i troškovi osoblja iz ranijih razdoblja još i `personnel:read`), a pregled i potvrda
 * traže barem jednu dozvolu pisanja. Pregled i potvrda čitaju neprijateljsku datoteku – ograničeni po korisniku kao skupi izvozi.
 */
@Controller('projects/:id')
export class ProjectImportController {
  constructor(private readonly imports: ProjectImportService, private readonly db: DbService, private readonly ctx: TenantContext, private readonly limit: ExportRateLimit) {}
  private run<T>(fn: (tx: Tx, tenantId: string, userId?: string) => Promise<T>) { const c = this.ctx.require(); return this.db.tx((tx) => fn(tx, c.tenantId, c.userId)); }
  private file(f: File | undefined): File {
    if (!f?.buffer) throw new BadRequestException({ code: 'import_file_missing', message: 'Datoteka nije priložena (polje "file").' });
    return f;
  }
  /** Greška čitanja datoteke je 400 s porukom za korisnika (što čitač nije razumio). */
  private async reading<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (e) {
      if (e instanceof ImportFileError) throw new BadRequestException({ code: e.code, message: e.message });
      throw e;
    }
  }

  @Get('import/template') @ProjectPermission('projects:read')
  async template(@Param('id', uuid) id: string, @Res({ passthrough: true }) res: Response) {
    const { fileName, data } = await this.run((tx) => this.imports.template(tx, id));
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(data, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: disposition(fileName), length: data.length });
  }

  @Post('import/preview') @ProjectPermission('projects:read') @UseInterceptors(upload)
  preview(@Param('id', uuid) id: string, @UploadedFile() f: File | undefined, @Body() b: unknown) {
    const c = this.ctx.require();
    this.imports.assertMayImport(id);
    const input = parseBody(previewInput, b ?? {});
    const file = this.file(f);
    this.limit.take('project-import', c.userId!, 'uvoza', 'import_rate_limited');
    return this.reading(() => this.run((tx) => this.imports.previewFile(tx, id, file, { skip: input.skip ?? [], csvSheet: input.csvSheet ?? null })));
  }

  @Post('import/confirm') @ProjectPermission('projects:read') @UseInterceptors(upload)
  confirm(@Param('id', uuid) id: string, @UploadedFile() f: File | undefined, @Body() b: unknown) {
    const c = this.ctx.require();
    this.imports.assertMayImport(id);
    const input = parseBody(confirmInput, b ?? {});
    const file = this.file(f);
    this.limit.take('project-import', c.userId!, 'uvoza', 'import_rate_limited');
    return this.reading(() => this.run((tx, t, u) => this.imports.confirm(tx, t, id, file, { ...input, skip: input.skip ?? [], csvSheet: input.csvSheet ?? null }, u)));
  }

  @Get('imports') @ProjectPermission('projects:read')
  history(@Param('id', uuid) id: string) { return this.run((tx) => this.imports.history(tx, id)); }

  @Post('imports/:importId/undo') @ProjectPermission('projects:read')
  undo(@Param('id', uuid) id: string, @Param('importId', uuid) importId: string) { return this.run((tx, _t, u) => this.imports.undo(tx, id, importId, u)); }
}
