import { Module } from '@nestjs/common';
import { ImplementationService } from './implementation.service';
import { ImplementationController } from './implementation.controller';
import { ProgrammesModule } from '../programmes/programmes.module';
/** M6 Provedba: struktura rada, isporuke, prekretnice, rizici. */
@Module({ imports: [ProgrammesModule], providers: [ImplementationService], controllers: [ImplementationController] })
export class ImplementationModule {}
