import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { MyDataController, PrivacyController, PublicPrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { RetentionScheduler, RetentionService } from './retention.service';
import { SubjectRequestsService } from './subject-requests.service';

/** WP1.23 – osobni podaci u proizvodu: prava ispitanika (izvoz, zatvaranje računa, anonimizacija) i rokovi čuvanja; WP1.24 – evidencija zahtjeva ispitanika. */
@Module({ imports: [DocumentsModule], providers: [PrivacyService, RetentionService, RetentionScheduler, SubjectRequestsService], controllers: [PrivacyController, MyDataController, PublicPrivacyController], exports: [RetentionService] })
export class PrivacyModule {}
