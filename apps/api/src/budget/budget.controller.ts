import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { BudgetService, budgetLinesInput } from './budget.service';
import { RequirePermission } from '../identity/auth.guard';
import { DbService } from '../db/db.service';
import { TenantContext } from '../common/tenant-context';
import { parseBody } from '../common/validation';

@Controller('projects/:id/budget')
export class BudgetController {
  constructor(private readonly budget: BudgetService, private readonly db: DbService, private readonly ctx: TenantContext) {}
  @Get() @RequirePermission('finance:read')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.db.tx((tx) => this.budget.get(tx, id)); }
  @Put('lines') @RequirePermission('finance:write')
  replace(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parseBody(budgetLinesInput, body); const c = this.ctx.require();
    return this.db.tx((tx) => this.budget.replaceLines(tx, c.tenantId, id, input, c.userId));
  }
}
