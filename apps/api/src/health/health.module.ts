import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PublicInfoController } from './public-info.controller';
import { DocumentsModule } from '../documents/documents.module';
@Module({ imports: [DocumentsModule], controllers: [HealthController, PublicInfoController] })
export class HealthModule {}
