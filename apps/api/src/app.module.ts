import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { PgErrorFilter } from './common/pg-error.filter';
import { ImplementationModule } from './implementation/implementation.module';
import { BudgetModule } from './budget/budget.module';
import { FinanceModule } from './finance/finance.module';
import { HealthModule } from './health/health.module';
import { ProgrammesModule } from './programmes/programmes.module';
import { DbModule } from './db/db.module';
import { AuditModule } from './audit/audit.module';
import { IdentityModule } from './identity/identity.module';
import { OrganisationsModule } from './organisations/organisations.module';
import { ProjectsModule } from './projects/projects.module';

/**
 * Korijenski modul. Svaki domenski modul (ADR-0002, domenski model odj. 1) živi u vlastitoj mapi
 * s vlastitim javnim sučeljem; međusobno komuniciraju samo kroz servise/događaje, ne kroz tuđe tablice.
 */
@Module({ imports: [DbModule, AuditModule, IdentityModule, HealthModule, ProgrammesModule, OrganisationsModule, ProjectsModule, ImplementationModule, BudgetModule, FinanceModule], providers: [{ provide: APP_FILTER, useClass: PgErrorFilter }] })
export class AppModule {}
