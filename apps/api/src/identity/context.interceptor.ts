import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContext, type RequestContext } from '../common/tenant-context';

/** Pokreće obradu zahtjeva unutar AsyncLocalStorage konteksta koji je AuthGuard pripremio. */
@Injectable()
export class ContextInterceptor implements NestInterceptor {
  constructor(private readonly ctx: TenantContext) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ arqusCtx?: RequestContext }>();
    if (!req.arqusCtx) return next.handle();
    return this.ctx.run(req.arqusCtx, () => next.handle());
  }
}
