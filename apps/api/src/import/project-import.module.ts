import { Module } from '@nestjs/common';
import { ProgrammesModule } from '../programmes/programmes.module';
import { ProjectImportService } from './project-import.service';
import { ProjectImportController } from './project-import.controller';
/** WP1.17 – uvoz postojećeg projekta iz Excela (predložak, pregled, potvrda, povijest, poništavanje). */
@Module({ imports: [ProgrammesModule], providers: [ProjectImportService], controllers: [ProjectImportController] })
export class ProjectImportModule {}
