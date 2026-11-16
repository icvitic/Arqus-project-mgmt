import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { DocumentStorage } from './document-storage';
/** M9 Dokumenti. */
@Module({ providers: [DocumentsService, DocumentStorage], controllers: [DocumentsController], exports: [DocumentsService] })
export class DocumentsModule {}
