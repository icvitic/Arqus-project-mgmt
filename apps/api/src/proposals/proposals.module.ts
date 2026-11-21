import { Module } from '@nestjs/common';
import { ProposalsService } from './proposals.service';
import { ProposalsController } from './proposals.controller';
import { ProposalCollaboratorsService } from './proposal-collaborators.service';
import { ProgrammesModule } from '../programmes/programmes.module';
import { OrganisationsModule } from '../organisations/organisations.module';
import { ProjectsModule } from '../projects/projects.module';
/** M5 Prijava (WP1.5); suradnici na prijavi (WP1.26). */
@Module({ imports: [ProgrammesModule, OrganisationsModule, ProjectsModule], providers: [ProposalsService, ProposalCollaboratorsService], controllers: [ProposalsController] })
export class ProposalsModule {}
