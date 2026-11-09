import { Module } from '@nestjs/common';
import { ProgrammesController } from './programmes.controller';
import { ProgrammePackagesService } from './programme-packages.service';
/** M2 Programi i paketi – u WP1.1 samo učitavanje i validacija globalnih paketa iz datoteka; baza u WP1.3. */
@Module({ controllers: [ProgrammesController], providers: [ProgrammePackagesService], exports: [ProgrammePackagesService] })
export class ProgrammesModule {}
