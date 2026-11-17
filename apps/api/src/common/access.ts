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
  // WP1.14b: voditelj prijave čita referentne podatke koje zasloni prijave trebaju i radi s dokumentima vlastite prijave
  // (servis dokumenata zatim provjerava upravo tu prijavu).
  return !!ctx.leadProposals?.size && LEAD_ANY_SCOPE.includes(permission);
}
const LEAD_ANY_SCOPE: readonly Permission[] = ['organisations:read', 'packages:read', 'documents:read', 'documents:write'];

/** Projekti na kojima korisnik ima dozvolu: 'all' uz institucijsku dozvolu, inače popis id-jeva iz dodjela na projektu. */
export function projectsWith(ctx: RequestContext, permission: Permission): 'all' | string[] {
  if (hasPermission(ctx.permissions, permission)) return 'all';
  return [...ctx.projectPermissions].filter(([, set]) => hasPermission(set, permission)).map(([id]) => id);
}

/**
 * WP1.14b – voditelj prijave (`leadUserId`) smije na VLASTITOJ prijavi čitati i uređivati pripremu, bez uloge institucije.
 * Implicitne dozvole voditelja na njegovoj prijavi; sve ostalo (nova prijava, promjena voditelja, predaja, ishod,
 * ugovaranje, povjerljivi dokumenti) traži dozvolu na razini institucije.
 */
export const PROPOSAL_LEAD_PERMISSIONS: readonly Permission[] = ['proposals:read', 'proposals:write', 'documents:read', 'documents:write'];

export const isProposalLead = (ctx: RequestContext, proposalId: string): boolean => !!ctx.leadProposals?.has(proposalId);

/** Dozvola na prijavi: na razini institucije ili kao voditelj te prijave (samo dozvole voditelja). */
export function canOnProposal(ctx: RequestContext, permission: Permission, proposalId: string): boolean {
  return hasPermission(ctx.permissions, permission) || (isProposalLead(ctx, proposalId) && PROPOSAL_LEAD_PERMISSIONS.includes(permission));
}

/** Smije li korisnik uopće znati za prijavu (proposals:read institucije ili voditelj). */
export const canSeeProposal = (ctx: RequestContext, proposalId: string): boolean => canOnProposal(ctx, 'proposals:read', proposalId);

/** Kao `assertProjectPermission`, za prijavu: nevidljiva prijava → 404 (kao nepostojeća), vidljiva bez dozvole → 403. */
export function assertProposalPermission(ctx: RequestContext, proposalId: string, permission: Permission, notFound = `Prijava ${proposalId} ne postoji`): void {
  if (canOnProposal(ctx, permission, proposalId)) return;
  if (!canSeeProposal(ctx, proposalId)) throw new NotFoundException(notFound);
  throw new ForbiddenException(`Nedostaje dozvola ${permission} (na razini institucije)`);
}

/** Dozvola na razini institucije ili voditelj barem jedne prijave (popis prijava, referentni podaci za prijavu). */
export const canAnyProposal = (ctx: RequestContext, permission: Permission): boolean =>
  hasPermission(ctx.permissions, permission) || (!!ctx.leadProposals?.size && PROPOSAL_LEAD_PERMISSIONS.includes(permission));

/**
 * Baca 404 ako korisnik ne smije vidjeti projekt (poruka jednaka onoj za nepostojeći entitet), 403 ako ga vidi,
 * ali nema traženu dozvolu. `notFound` – poruka entiteta kroz koji je projekt razriješen (npr. „Dokument … ne postoji”).
 */
export function assertProjectPermission(ctx: RequestContext, projectId: string, permission: Permission, notFound = `Projekt ${projectId} ne postoji`): void {
  if (canOnProject(ctx, permission, projectId)) return;
  if (!canSeeProject(ctx, projectId)) throw new NotFoundException(notFound);
  throw new ForbiddenException(`Nedostaje dozvola ${permission} na ovom projektu`);
}
