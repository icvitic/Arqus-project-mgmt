import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { MAX_DOCUMENT_BYTES } from '@arqus/domain';
import { DocumentsService, docPatch, listQuery, uploadMeta, versionMeta, type UploadedFile as File } from './documents.service';
import { DocumentStorage } from './document-storage';
import { ResolvesProject } from '../identity/auth.guard';
import { DbService, type Tx } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';
import { parseBody } from '../common/validation';

const uuid = new ParseUUIDPipe();
const upload = FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 10, fieldSize: 4096 } });
const disposition = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

@Controller('documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService, private readonly storage: DocumentStorage, private readonly db: DbService, private readonly ctx: TenantContext) {}
  private run<T>(fn: (tx: Tx, tenantId: string, userId?: string) => Promise<T>) { const c = this.ctx.require(); return this.db.tx((tx) => fn(tx, c.tenantId, c.userId)); }

  /** Sadržaj se zapisuje prije transakcije; ako transakcija ne uspije, datoteka se uklanja. */
  private async stored<T>(file: File | undefined, fn: (f: { fileName: string; mime: string; sha256: string; size: number; storageKey: string }, tx: Tx, tenantId: string, userId?: string) => Promise<T>) {
    const info = this.docs.inspect(file);
    const c = this.ctx.require();
    const storageKey = await this.storage.put(c.tenantId, file!.buffer);
    try { return await this.db.tx((tx) => fn({ ...info, size: file!.size, storageKey }, tx, c.tenantId, c.userId)); } catch (e) { await this.storage.discard(storageKey); throw e; }
  }

  @Get() @ResolvesProject('documents:read') list(@Query() q: unknown) { const i = parseBody(listQuery, q); return this.run((tx) => this.docs.list(tx, i)); }
  @Get(':id') @ResolvesProject('documents:read') get(@Param('id', uuid) id: string) { return this.run((tx) => this.docs.get(tx, id)); }

  @Post() @ResolvesProject('documents:write') @UseInterceptors(upload)
  create(@UploadedFile() file: File | undefined, @Body() b: unknown) {
    const meta = parseBody(uploadMeta, b);
    return this.stored(file, (f, tx, t, u) => this.docs.create(tx, t, meta, f, u));
  }

  @Post(':id/versions') @ResolvesProject('documents:write') @UseInterceptors(upload)
  addVersion(@Param('id', uuid) id: string, @UploadedFile() file: File | undefined, @Body() b: unknown) {
    const { note } = parseBody(versionMeta, b ?? {});
    return this.stored(file, (f, tx, t, u) => this.docs.addVersion(tx, t, id, note, f, u));
  }

  @Patch(':id') @ResolvesProject('documents:write') update(@Param('id', uuid) id: string, @Body() b: unknown) { const i = parseBody(docPatch, b); return this.run((tx, _t, u) => this.docs.update(tx, id, i, u)); }
  @Delete(':id') @ResolvesProject('documents:write') remove(@Param('id', uuid) id: string) { return this.run((tx, _t, u) => this.docs.remove(tx, id, u)); }

  @Get(':id/download') @ResolvesProject('documents:read')
  download(@Param('id', uuid) id: string, @Res({ passthrough: true }) res: Response) { return this.send(id, undefined, res); }
  @Get(':id/versions/:n/download') @ResolvesProject('documents:read')
  downloadVersion(@Param('id', uuid) id: string, @Param('n', ParseIntPipe) n: number, @Res({ passthrough: true }) res: Response) { return this.send(id, n, res); }

  /** Uvijek kao privitak (nikad prikaz u pregledniku); provjera hasha otkriva oštećenje ili izmjenu u pohrani. */
  private async send(id: string, n: number | undefined, res: Response) {
    const v = await this.run((tx) => this.docs.version(tx, id, n));
    const content = await this.storage.get(v.storageKey);
    if (createHash('sha256').update(content).digest('hex') !== v.sha256) throw new BadRequestException('Provjera cjelovitosti datoteke nije uspjela – obavijesti administratora');
    res.setHeader('X-Document-Sha256', v.sha256);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(content, { type: v.mimeType, disposition: disposition(v.fileName), length: content.length });
  }
}
