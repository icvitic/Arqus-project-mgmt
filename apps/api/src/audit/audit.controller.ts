import { Controller, Get, Query } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { auditEntries } from '../db/schema';
import { RequirePermission } from '../identity/auth.guard';

@Controller('audit')
export class AuditController {
  constructor(private readonly db: DbService) {}
  @Get() @RequirePermission('audit:read')
  list(@Query('entity') entity?: string, @Query('limit') limit = '100') {
    return this.db.tx((tx) => {
      const q = tx.select().from(auditEntries).orderBy(desc(auditEntries.at)).limit(Math.min(+limit || 100, 500));
      return entity ? q.where(eq(auditEntries.entity, entity)) : q;
    });
  }
}
