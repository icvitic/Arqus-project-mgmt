import { Module } from '@nestjs/common';
import { BudgetService } from './budget.service';
import { BudgetController } from './budget.controller';
import { ProgrammesModule } from '../programmes/programmes.module';
/** M7 Financije – proračun projekta (WP1.7). Troškovi, timesheetovi i ZNS u WP1.8. */
@Module({ imports: [ProgrammesModule], providers: [BudgetService], controllers: [BudgetController], exports: [BudgetService] })
export class BudgetModule {}
