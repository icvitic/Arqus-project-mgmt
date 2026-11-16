import { Module } from '@nestjs/common';
import { CallsService } from './calls.service';
import { CallsController } from './calls.controller';
/** M3 Radar poziva (WP1.4). */
@Module({ providers: [CallsService], controllers: [CallsController], exports: [CallsService] })
export class CallsModule {}
