import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { TimesheetsService, memberInput, memberPatch, timesheetInput, monthParam } from './timesheets.service';
import { ExpensesService, expenseInput, expensePatch } from './expenses.service';
import { ClaimsService, claimInput, correctionInput, decisionInput, earlierInput, paymentInput, preparationInput, previewInput, submitInput } from './claims.service';
import { ClaimExportService } from './claim-export.service';
import { ProjectPermission } from '../identity/auth.guard';
import { DbService, type Tx } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';
import { parseBody } from '../common/validation';

const uuid = new ParseUUIDPipe();
const disposition = (name: string, kind = 'attachment') => `${kind}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

@Controller('projects/:id')
export class FinanceController {
  constructor(private readonly ts: TimesheetsService, private readonly ex: ExpensesService, private readonly cl: ClaimsService, private readonly exporter: ClaimExportService, private readonly db: DbService, private readonly ctx: TenantContext) {}
  private run<T>(fn: (tx: Tx, tenantId: string, userId?: string) => Promise<T>) { const c = this.ctx.require(); return this.db.tx((tx) => fn(tx, c.tenantId, c.userId)); }
  private month(m: string) { return parseBody(monthParam, m); }

  // Tim i timesheetovi
  @Get('team') @ProjectPermission('timesheets:read') team(@Param('id', uuid) id: string) { return this.run((tx) => this.ts.team(tx, id)); }
  @Post('team') @ProjectPermission('finance:write') addMember(@Param('id', uuid) id: string, @Body() b: unknown) { const i = parseBody(memberInput, b); return this.run((tx, t, u) => this.ts.addMember(tx, t, id, i, u)); }
  @Patch('team/:mid') @ProjectPermission('finance:write') updateMember(@Param('id', uuid) id: string, @Param('mid', uuid) mid: string, @Body() b: unknown) { const i = parseBody(memberPatch, b); return this.run((tx, _t, u) => this.ts.updateMember(tx, id, mid, i, u)); }
  @Get('team/:mid/timesheets/:month') @ProjectPermission('timesheets:read') getTs(@Param('id', uuid) id: string, @Param('mid', uuid) mid: string, @Param('month') m: string) { const month = this.month(m); return this.run((tx) => this.ts.get(tx, id, mid, month)); }
  @Put('team/:mid/timesheets/:month') @ProjectPermission('timesheets:write') saveTs(@Param('id', uuid) id: string, @Param('mid', uuid) mid: string, @Param('month') m: string, @Body() b: unknown) { const month = this.month(m); const i = parseBody(timesheetInput, b); return this.run((tx, t, u) => this.ts.save(tx, t, id, mid, month, i, u)); }
  @Post('team/:mid/timesheets/:month/submit') @ProjectPermission('timesheets:write') submitTs(@Param('id', uuid) id: string, @Param('mid', uuid) mid: string, @Param('month') m: string) { const month = this.month(m); return this.run((tx, _t, u) => this.ts.submit(tx, id, mid, month, u)); }
  @Post('team/:mid/timesheets/:month/approve') @ProjectPermission('timesheets:approve') approveTs(@Param('id', uuid) id: string, @Param('mid', uuid) mid: string, @Param('month') m: string) { const month = this.month(m); return this.run((tx, t, u) => this.ts.approve(tx, t, id, mid, month, u)); }
  /** WP1.16b: mjesečna evidencija rada za ispis i potpis (samostalan HTML, isti kao u paketu ZNS-a). */
  @Get('team/:mid/timesheets/:month/record') @ProjectPermission('timesheets:read') @Header('Content-Type', 'text/html; charset=utf-8') @Header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'") @Header('X-Content-Type-Options', 'nosniff')
  recordTs(@Param('id', uuid) id: string, @Param('mid', uuid) mid: string, @Param('month') m: string) { const month = this.month(m); return this.run((tx) => this.ts.record(tx, id, mid, month)); }
  @Post('team/:mid/timesheets/:month/reopen') @ProjectPermission('timesheets:approve') reopenTs(@Param('id', uuid) id: string, @Param('mid', uuid) mid: string, @Param('month') m: string) { const month = this.month(m); return this.run((tx, _t, u) => this.ts.reopen(tx, id, mid, month, u)); }

  // Troškovi i pregled
  @Get('expenses') @ProjectPermission('finance:read') expenses(@Param('id', uuid) id: string, @Query('status') status?: string, @Query('period') period?: string) { return this.run((tx) => this.ex.list(tx, id, { status, period: period ? Number(period) : undefined })); }
  @Post('expenses') @ProjectPermission('finance:write') createExpense(@Param('id', uuid) id: string, @Body() b: unknown) { const i = parseBody(expenseInput, b); return this.run((tx, t, u) => this.ex.create(tx, t, id, i, u)); }
  @Patch('expenses/:eid') @ProjectPermission('finance:write') updateExpense(@Param('id', uuid) id: string, @Param('eid', uuid) eid: string, @Body() b: unknown) { const i = parseBody(expensePatch, b); return this.run((tx, _t, u) => this.ex.update(tx, id, eid, i, u)); }
  @Delete('expenses/:eid') @ProjectPermission('finance:write') deleteExpense(@Param('id', uuid) id: string, @Param('eid', uuid) eid: string) { return this.run((tx) => this.ex.remove(tx, id, eid)); }
  @Get('finance') @ProjectPermission('finance:read') overview(@Param('id', uuid) id: string) { return this.run((tx) => this.ex.overview(tx, id)); }

  // Zahtjevi za nadoknadu
  @Get('claims') @ProjectPermission('finance:read') claims(@Param('id', uuid) id: string) { return this.run((tx) => this.cl.list(tx, id)); }
  @Post('claims') @ProjectPermission('finance:write') createClaim(@Param('id', uuid) id: string, @Body() b: unknown) { const i = parseBody(claimInput, b); return this.run((tx, t, u) => this.cl.create(tx, t, id, i, u)); }
  @Get('claims/:cid') @ProjectPermission('finance:read') claim(@Param('id', uuid) id: string, @Param('cid', uuid) cid: string) { return this.run((tx) => this.cl.get(tx, id, cid)); }
  @Post('claims/:cid/submit') @ProjectPermission('finance:write') submitClaim(@Param('id', uuid) id: string, @Param('cid', uuid) cid: string, @Body() b: unknown) { const i = parseBody(submitInput, b); return this.run((tx, _t, u) => this.cl.submit(tx, id, cid, i, u)); }
  @Post('claims/:cid/decision') @ProjectPermission('finance:write') decide(@Param('id', uuid) id: string, @Param('cid', uuid) cid: string, @Body() b: unknown) { const i = parseBody(decisionInput, b); return this.run((tx, _t, u) => this.cl.decide(tx, id, cid, i, u)); }
  @Post('claims/:cid/decision/preview') @ProjectPermission('finance:write') previewDecision(@Param('id', uuid) id: string, @Param('cid', uuid) cid: string, @Body() b: unknown) { const i = parseBody(previewInput, b); return this.run((tx) => this.cl.previewDecision(tx, id, cid, i)); }
  @Post('claims/:cid/decision/correction') @ProjectPermission('finance:write') correctDecision(@Param('id', uuid) id: string, @Param('cid', uuid) cid: string, @Body() b: unknown) { const i = parseBody(correctionInput, b); return this.run((tx, _t, u) => this.cl.correct(tx, id, cid, i, u)); }
  /** WP1.16b: izričit odabir troškova iz ranijih razdoblja u nacrtu. */
  @Put('claims/:cid/earlier-expenses') @ProjectPermission('finance:write') selectEarlier(@Param('id', uuid) id: string, @Param('cid', uuid) cid: string, @Body() b: unknown) { const i = parseBody(earlierInput, b); return this.run((tx, _t, u) => this.cl.selectEarlier(tx, id, cid, i, u)); }
  /** WP1.16b: sati utrošeni na pripremu predanog zahtjeva (naknadni upis ili ispravak). */
  @Put('claims/:cid/preparation-hours') @ProjectPermission('finance:write') preparation(@Param('id', uuid) id: string, @Param('cid', uuid) cid: string, @Body() b: unknown) { const i = parseBody(preparationInput, b); return this.run((tx, _t, u) => this.cl.setPreparation(tx, id, cid, i, u)); }
  /**
   * WP1.16b: paket ZNS-a za predaju (ZIP): troškovi (XLSX), evidencije rada, dokazi, kontrolna lista, manifest.
   * Podaci se čitaju i dokazi provjeravaju prije slanja; ZIP se zatim struji bez otvorene transakcije.
   */
  @Get('claims/:cid/export') @ProjectPermission('finance:read')
  async exportClaim(@Param('id', uuid) id: string, @Param('cid', uuid) cid: string, @Res({ passthrough: true }) res: Response) {
    const { fileName, stream } = await this.exporter.export(id, cid);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const file = new StreamableFile(stream, { type: 'application/zip', disposition: disposition(fileName) });
    // Greška usred slanja: prekid veze (klijent vidi neuspjelo preuzimanje), nikad tiho skraćen ZIP.
    file.setErrorHandler((_err, response) => { (response as Response).destroy(); });
    return file;
  }
  @Post('claims/:cid/payment') @ProjectPermission('finance:write') pay(@Param('id', uuid) id: string, @Param('cid', uuid) cid: string, @Body() b: unknown) { const i = parseBody(paymentInput, b); return this.run((tx, _t, u) => this.cl.pay(tx, id, cid, i, u)); }
}
