import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { IdentityService } from './identity.service';
import { IdentityController } from './identity.controller';
import { TokenService } from './token.service';
import { AuthGuard } from './auth.guard';
import { ContextInterceptor } from './context.interceptor';
import { LoginThrottle } from './login-throttle';

@Module({
  controllers: [IdentityController],
  providers: [IdentityService, TokenService, LoginThrottle, { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_INTERCEPTOR, useClass: ContextInterceptor }],
  exports: [IdentityService, TokenService],
})
export class IdentityModule {}
