import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';
import { TenantContext } from '../common/tenant-context';
@Global()
@Module({ providers: [DbService, TenantContext], exports: [DbService, TenantContext] })
export class DbModule {}
