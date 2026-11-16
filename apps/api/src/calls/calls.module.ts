import { Module } from '@nestjs/common';
import { CallsService } from './calls.service';
import { CallsController } from './calls.controller';
import { FtImportScheduler } from './ft-import.scheduler';
/** M3 Radar poziva (WP1.4). */
@Module({ providers: [CallsService, FtImportScheduler], controllers: [CallsController], exports: [CallsService] })
export class CallsModule {}
