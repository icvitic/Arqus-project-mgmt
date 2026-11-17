import { Module } from '@nestjs/common';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';
import { ProgrammesModule } from '../programmes/programmes.module';
/** M10 Portfelj (WP1.15): pregled svih projekata, rokova, ljudi i prijava institucije – samo čitanje. */
@Module({ imports: [ProgrammesModule], providers: [PortfolioService], controllers: [PortfolioController] })
export class PortfolioModule {}
