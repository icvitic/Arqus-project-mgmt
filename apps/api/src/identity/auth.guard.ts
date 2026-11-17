import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TokenService } from './token.service';
import { hasPermission, type Permission } from './permissions';
import { IdentityService } from './identity.service';
import { assertProjectPermission, canAnywhere } from '../common/access';
import type { RequestContext } from '../common/tenant-context';

/**
 * Razvrstavanje ruta (WP1.14). SVAKA ruta mora imati točno jednu oznaku; ruta bez oznake se odbija (403),
 * a test pokrivenosti ruta (test/route-coverage.e2e.test.ts) pada ako se pojavi neoznačena ruta.
 *
 * - `@Public()`                    – bez prijave (health, prijava).
 * - `@Authenticated()`             – samo valjana prijava (vlastiti račun, /me).
 * - `@RequirePermission(p)`        – radnja institucije: dozvola NA RAZINI INSTITUCIJE (novi projekt, korisnici, paketi, radar, prijave).
 * - `@ProjectPermission(p, param)` – ruta s projektom u putanji: dozvola na razini institucije ILI na tom projektu;
 *                                    projekt bez pristupa → 404, vidljiv projekt bez dozvole → 403.
 * - `@ResolvesProject(p)`          – entitet projekta bez projekta u putanji (dokumenti): guard traži dozvolu u bilo kojem
 *                                    opsegu, servis razrješava vlasnika i provjerava pristup upravo tom projektu.
 * - `@AnyScope(p)`                 – popisi i referentni podaci: dozvola na razini institucije ili na barem jednom projektu;
 *                                    servis vraća samo ono što korisnik smije vidjeti (npr. /projects).
 */
export const PUBLIC_KEY = 'arqus:public';
export const AUTHENTICATED_KEY = 'arqus:authenticated';
export const PERMISSION_KEY = 'arqus:permission';
export const PROJECT_PERMISSION_KEY = 'arqus:project-permission';
export const RESOLVES_PROJECT_KEY = 'arqus:resolves-project';
export const ANY_SCOPE_KEY = 'arqus:any-scope';

export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const Authenticated = () => SetMetadata(AUTHENTICATED_KEY, true);
export const RequirePermission = (p: Permission) => SetMetadata(PERMISSION_KEY, p);
export const ProjectPermission = (p: Permission, param = 'id') => SetMetadata(PROJECT_PERMISSION_KEY, { permission: p, param });
export const ResolvesProject = (p: Permission) => SetMetadata(RESOLVES_PROJECT_KEY, p);
export const AnyScope = (p: Permission) => SetMetadata(ANY_SCOPE_KEY, p);

export type RouteAccess =
  | { kind: 'public' } | { kind: 'authenticated' }
  | { kind: 'tenant'; permission: Permission }
  | { kind: 'project'; permission: Permission; param: string }
  | { kind: 'resolves-project'; permission: Permission }
  | { kind: 'any-scope'; permission: Permission };

/** Oznaka rute (metoda ima prednost pred klasom). Više oznaka ili nijedna → greška razvrstavanja. */
export function routeAccess(reflector: Reflector, targets: Parameters<Reflector['getAllAndOverride']>[1]): RouteAccess | { kind: 'invalid'; reason: string } {
  const found: RouteAccess[] = [];
  if (reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) found.push({ kind: 'public' });
  if (reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets)) found.push({ kind: 'authenticated' });
  const tenant = reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, targets);
  if (tenant) found.push({ kind: 'tenant', permission: tenant });
  const project = reflector.getAllAndOverride<{ permission: Permission; param: string } | undefined>(PROJECT_PERMISSION_KEY, targets);
  if (project) found.push({ kind: 'project', ...project });
  const resolves = reflector.getAllAndOverride<Permission | undefined>(RESOLVES_PROJECT_KEY, targets);
  if (resolves) found.push({ kind: 'resolves-project', permission: resolves });
  const any = reflector.getAllAndOverride<Permission | undefined>(ANY_SCOPE_KEY, targets);
  if (any) found.push({ kind: 'any-scope', permission: any });
  if (found.length !== 1) return { kind: 'invalid', reason: found.length ? `više oznaka: ${found.map((f) => f.kind).join(', ')}` : 'ruta nije razvrstana' };
  return found[0]!;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService, private readonly reflector: Reflector, private readonly identity: IdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = routeAccess(this.reflector, [context.getHandler(), context.getClass()]);
    if (access.kind === 'public') return true;
    // Sigurno prema zadanome: ruta bez (jednoznačne) oznake ne izvršava se ni za koga.
    if (access.kind === 'invalid') throw new ForbiddenException(`Ruta nije razvrstana za autorizaciju (${access.reason})`);
    const req = context.switchToHttp().getRequest<Request & { arqusCtx?: RequestContext }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Nedostaje token');
    let claims;
    try { claims = await this.tokens.verify(token); } catch { throw new UnauthorizedException('Token nije valjan ili je istekao'); }
    // Sesija mora postojati i ne smije biti opozvana; dozvole se čitaju svježe iz uloga (ne iz tokena) – opoziv vrijedi odmah.
    const fresh = await this.identity.sessionAccess(claims.tid, claims.sub, claims.sid);
    if (!fresh) throw new UnauthorizedException('Sesija je istekla ili je opozvana – prijavi se ponovno');
    const ctx: RequestContext = {
      tenantId: claims.tid, userId: claims.sub, ip: req.ip, sessionId: claims.sid,
      permissions: new Set(fresh.tenant),
      projectPermissions: new Map(Object.entries(fresh.projects).map(([id, perms]) => [id, new Set(perms)])),
    };
    switch (access.kind) {
      case 'tenant':
        if (!hasPermission(ctx.permissions, access.permission)) throw new ForbiddenException(`Nedostaje dozvola ${access.permission} (na razini institucije)`);
        break;
      case 'project': {
        const projectId = (req.params as Record<string, string | undefined>)[access.param];
        if (!projectId) throw new ForbiddenException('Ruta nema parametar projekta');
        assertProjectPermission(ctx, projectId, access.permission);
        break;
      }
      case 'resolves-project': case 'any-scope':
        if (!canAnywhere(ctx, access.permission)) throw new ForbiddenException(`Nedostaje dozvola ${access.permission}`);
        break;
      case 'authenticated': break;
    }
    // Kontekst se postavlja u interceptoru (ContextInterceptor) jer guard ne obavija izvršenje handlera.
    req.arqusCtx = ctx;
    return true;
  }
}
