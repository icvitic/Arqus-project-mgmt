import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { IdentityService } from './identity.service';
import { IdentityController } from './identity.controller';
import { TokenService } from './token.service';
import { AuthGuard } from './auth.guard';
import { ContextInterceptor } from './context.interceptor';
import { LoginThrottle } from './login-throttle';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { AccountRateLimit } from '../common/rate-limit';

@Module({
  controllers: [IdentityController, AccountController],
  providers: [IdentityService, AccountService, AccountRateLimit, TokenService, LoginThrottle, { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_INTERCEPTOR, useClass: ContextInterceptor }],
  exports: [IdentityService, AccountService, TokenService],
})
export class IdentityModule {}
