import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { ProgrammesModule } from './programmes/programmes.module';
import { DbModule } from './db/db.module';
import { AuditModule } from './audit/audit.module';
import { IdentityModule } from './identity/identity.module';

/**
 * Korijenski modul. Svaki domenski modul (ADR-0002, domenski model odj. 1) živi u vlastitoj mapi
 * s vlastitim javnim sučeljem; međusobno komuniciraju samo kroz servise/događaje, ne kroz tuđe tablice.
 */
@Module({ imports: [DbModule, AuditModule, IdentityModule, HealthModule, ProgrammesModule] })
export class AppModule {}
