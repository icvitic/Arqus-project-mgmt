import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { hasPermission, type Permission } from '../identity/permissions';
import type { RequestContext } from './tenant-context';

/**
 * Središnja provjera pristupa po projektu (WP1.14). Pravilo: radnja na projektu dopuštena je ako korisnik ima traženu
 * dozvolu NA RAZINI INSTITUCIJE ili NA TOM PROJEKTU. Projekt koji korisnik ne smije vidjeti (nema `projects:read` ni na
 * jednoj razini) ponaša se kao nepostojeći – 404, isto kao projekt drugog stanara (ne otkriva se postojanje).
 * Koriste je AuthGuard (rute s projektom u putanji) i servisi koji projekt razrješavaju iz entiteta (dokumenti).
 */
const NONE: ReadonlySet<string> = new Set();

export const projectGrants = (ctx: RequestContext, projectId: string): ReadonlySet<string> => ctx.projectPermissions.get(projectId) ?? NONE;

/** Dozvola na razini institucije (za radnje institucije: novi projekt, korisnici, paketi, radar, prijave…). */
export const canInTenant = (ctx: RequestContext, permission: Permission): boolean => hasPermission(ctx.permissions, permission);

/** Dozvola na određenom projektu (institucijska ili dodijeljena na tom projektu). */
export function canOnProject(ctx: RequestContext, permission: Permission, projectId: string): boolean {
  return hasPermission(ctx.permissions, permission) || hasPermission(projectGrants(ctx, projectId), permission);
}

/** Smije li korisnik uopće znati za projekt. */
export const canSeeProject = (ctx: RequestContext, projectId: string): boolean => canOnProject(ctx, 'projects:read', projectId);

/** Dozvola na razini institucije ili na barem jednom projektu (popisi koji se zatim filtriraju, referentni podaci). */
export function canAnywhere(ctx: RequestContext, permission: Permission): boolean {
  if (hasPermission(ctx.permissions, permission)) return true;
  for (const set of ctx.projectPermissions.values()) if (hasPermission(set, permission)) return true;
  return false;
}

/** Projekti na kojima korisnik ima dozvolu: 'all' uz institucijsku dozvolu, inače popis id-jeva iz dodjela na projektu. */
export function projectsWith(ctx: RequestContext, permission: Permission): 'all' | string[] {
  if (hasPermission(ctx.permissions, permission)) return 'all';
  return [...ctx.projectPermissions].filter(([, set]) => hasPermission(set, permission)).map(([id]) => id);
}

/**
 * Baca 404 ako korisnik ne smije vidjeti projekt (poruka jednaka onoj za nepostojeći entitet), 403 ako ga vidi,
 * ali nema traženu dozvolu. `notFound` – poruka entiteta kroz koji je projekt razriješen (npr. „Dokument … ne postoji”).
 */
export function assertProjectPermission(ctx: RequestContext, projectId: string, permission: Permission, notFound = `Projekt ${projectId} ne postoji`): void {
  if (canOnProject(ctx, permission, projectId)) return;
  if (!canSeeProject(ctx, projectId)) throw new NotFoundException(notFound);
  throw new ForbiddenException(`Nedostaje dozvola ${permission} na ovom projektu`);
}
