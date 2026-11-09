import { Controller, Get, Param } from '@nestjs/common';
import { ProgrammePackagesService } from './programme-packages.service';
import { RequirePermission } from '../identity/auth.guard';

@RequirePermission('packages:read')
@Controller('programme-packages')
export class ProgrammesController {
  constructor(private readonly packages: ProgrammePackagesService) {}
  @Get() list() { return this.packages.list(); }
  @Get('rejected') rejected() { return this.packages.rejectedPackages(); }
  @Get(':id') get(@Param('id') id: string) { return this.packages.get(id); }
}
