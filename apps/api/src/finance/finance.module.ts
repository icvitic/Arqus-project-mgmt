import { Module } from '@nestjs/common';
import { TimesheetsService } from './timesheets.service';
import { ExpensesService } from './expenses.service';
import { ClaimsService } from './claims.service';
import { FinanceController } from './finance.controller';
import { ProgrammesModule } from '../programmes/programmes.module';
import { DocumentsModule } from '../documents/documents.module';
import { ClaimExportService } from './claim-export.service';
/** M7 Financije (WP1.8): tim, timesheetovi, troškovi, zahtjevi za nadoknadu, ugovoreno vs. ostvareno. */
@Module({ imports: [ProgrammesModule, DocumentsModule], providers: [TimesheetsService, ExpensesService, ClaimsService, ClaimExportService], controllers: [FinanceController] })
export class FinanceModule {}
