import { Module } from '@nestjs/common';
import { OrganisationsService } from './organisations.service';
import { OrganisationsController } from './organisations.controller';
/** M4 Partneri: registar organizacija stanara. */
@Module({ providers: [OrganisationsService], controllers: [OrganisationsController], exports: [OrganisationsService] })
export class OrganisationsModule {}
