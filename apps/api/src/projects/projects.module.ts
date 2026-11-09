import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { OrganisationsModule } from '../organisations/organisations.module';
import { ProgrammesModule } from '../programmes/programmes.module';
/** M6 Projekt i provedba (WP1.6: projekt, partneri, status, izvještajna razdoblja). */
@Module({ imports: [OrganisationsModule, ProgrammesModule], providers: [ProjectsService], controllers: [ProjectsController], exports: [ProjectsService] })
export class ProjectsModule {}
