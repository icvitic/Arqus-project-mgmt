import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { ExportRateLimit } from '../common/rate-limit';
@Global()
@Module({ providers: [AuditService, ExportRateLimit], controllers: [AuditController], exports: [AuditService, ExportRateLimit] })
export class AuditModule {}
