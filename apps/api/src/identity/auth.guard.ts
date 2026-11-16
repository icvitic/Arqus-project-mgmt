import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TokenService } from './token.service';
import { TenantContext } from '../common/tenant-context';
import { hasPermission, type Permission } from './permissions';
import { IdentityService } from './identity.service';

export const PUBLIC_KEY = 'arqus:public';
export const PERMISSION_KEY = 'arqus:permission';
/** Ruta bez prijave (health, login). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Ruta traži dozvolu; bez dekoratora dovoljna je valjana prijava. */
export const RequirePermission = (p: Permission) => SetMetadata(PERMISSION_KEY, p);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService, private readonly ctx: TenantContext, private readonly reflector: Reflector, private readonly identity: IdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const req = context.switchToHttp().getRequest<Request & { arqusCtx?: unknown }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Nedostaje token');
    let claims;
    try { claims = await this.tokens.verify(token); } catch { throw new UnauthorizedException('Token nije valjan ili je istekao'); }
    // Sesija mora postojati i ne smije biti opozvana; dozvole se čitaju svježe iz uloga (ne iz tokena).
    const fresh = await this.identity.sessionPermissions(claims.tid, claims.sub, claims.sid);
    if (!fresh) throw new UnauthorizedException('Sesija je istekla ili je opozvana – prijavi se ponovno');
    const permissions = new Set(fresh);
    const required = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, targets);
    if (required && !hasPermission(permissions, required)) throw new ForbiddenException(`Nedostaje dozvola ${required}`);
    // Kontekst se postavlja u interceptoru (ContextInterceptor) jer guard ne obavija izvršenje handlera.
    req.arqusCtx = { tenantId: claims.tid, userId: claims.sub, permissions, ip: req.ip, sessionId: claims.sid };
    return true;
  }
}
