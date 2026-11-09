import { Module } from '@nestjs/common';
import { ProgrammesController } from './programmes.controller';
import { ProgrammePackagesService } from './programme-packages.service';
/** M2 Programi i paketi: paketi u bazi (globalni + stanarski), validacija, nasljeđivanje, objava. */
@Module({ controllers: [ProgrammesController], providers: [ProgrammePackagesService], exports: [ProgrammePackagesService] })
export class ProgrammesModule {}
