import { Module } from '@nestjs/common';
import { ProgrammesModule } from '../programmes/programmes.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { IdentityModule } from '../identity/identity.module';
import { MyWorkService } from './my-work.service';
import { NotificationsService } from './notifications.service';
import { CalendarRateLimit, CalendarService } from './calendar.service';
import { CalendarController, MeController } from './me.controller';
import { DigestScheduler, DigestService } from './digest.service';

/** WP1.18 – „Moj rad”, obavijesti i osobni kalendar rokova (samo čitanje tuđih modula kroz njihove servise i zajedničke definicije). */
@Module({ imports: [ProgrammesModule, PortfolioModule, IdentityModule], providers: [MyWorkService, NotificationsService, CalendarService, CalendarRateLimit, DigestService, DigestScheduler], controllers: [MeController, CalendarController], exports: [DigestService] })
export class MeModule {}
