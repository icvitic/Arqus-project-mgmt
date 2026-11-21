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
  // (servis dokumenata zatim provjerava upravo tu prijavu). WP1.26: isto suradnik na prijavi, u granicama svoje razine.
  if (PROPOSAL_REFERENCE.includes(permission)) return !!ctx.leadProposals?.size || !!ctx.proposalGrants?.size;
  return PROPOSAL_DOCUMENTS.includes(permission) && canAnyProposal(ctx, permission);
}
const PROPOSAL_REFERENCE: readonly Permission[] = ['organisations:read', 'packages:read'];
const PROPOSAL_DOCUMENTS: readonly Permission[] = ['documents:read', 'documents:write'];

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

/**
 * WP1.26 – suradnik na prijavi: `edit` ima iste dozvole kao voditelj na toj prijavi, `read` samo čita prijavu i njezine
 * dokumente. Radnje koje vode prijavu (zaključavanje proračuna, prijelazi, upravljanje suradnicima) ostaju voditelju i
 * uredu – provjerava ih servis (`canLeadProposal`).
 */
export const COLLABORATOR_PERMISSIONS: Readonly<Record<'edit' | 'read', readonly Permission[]>> = {
  edit: PROPOSAL_LEAD_PERMISSIONS,
  read: ['proposals:read', 'documents:read'],
};

export const isProposalLead = (ctx: RequestContext, proposalId: string): boolean => !!ctx.leadProposals?.has(proposalId);

/** Dozvola koju korisnik ima na prijavi kao voditelj ili suradnik (bez dozvola institucije). */
function proposalGrant(ctx: RequestContext, permission: Permission, proposalId: string): boolean {
  return (isProposalLead(ctx, proposalId) && PROPOSAL_LEAD_PERMISSIONS.includes(permission)) || !!ctx.proposalGrants?.get(proposalId)?.has(permission);
}

/** Dozvola na prijavi: na razini institucije, kao voditelj te prijave (samo dozvole voditelja) ili kao suradnik na njoj. */
export function canOnProposal(ctx: RequestContext, permission: Permission, proposalId: string): boolean {
  return hasPermission(ctx.permissions, permission) || proposalGrant(ctx, permission, proposalId);
}

/** Vodi li korisnik prijavu: `proposals:write` institucije ili voditelj te prijave (ne suradnik). */
export const canLeadProposal = (ctx: RequestContext, proposalId: string): boolean => hasPermission(ctx.permissions, 'proposals:write') || isProposalLead(ctx, proposalId);

/** Prijave na kojima korisnik ima dozvolu kao voditelj ili suradnik (za popise kad nema dozvolu institucije). */
export function ownProposals(ctx: RequestContext, permission: Permission = 'proposals:read'): string[] {
  const ids = new Set(PROPOSAL_LEAD_PERMISSIONS.includes(permission) ? ctx.leadProposals ?? [] : []);
  for (const [id, set] of ctx.proposalGrants ?? []) if (set.has(permission)) ids.add(id);
  return [...ids];
}

/** Smije li korisnik uopće znati za prijavu (proposals:read institucije, voditelj ili suradnik). */
export const canSeeProposal = (ctx: RequestContext, proposalId: string): boolean => canOnProposal(ctx, 'proposals:read', proposalId);

/** Kao `assertProjectPermission`, za prijavu: nevidljiva prijava → 404 (kao nepostojeća), vidljiva bez dozvole → 403. */
export function assertProposalPermission(ctx: RequestContext, proposalId: string, permission: Permission, notFound = `Prijava ${proposalId} ne postoji`): void {
  if (canOnProposal(ctx, permission, proposalId)) return;
  if (!canSeeProposal(ctx, proposalId)) throw new NotFoundException(notFound);
  throw new ForbiddenException(`Nedostaje dozvola ${permission} (na razini institucije)`);
}

/** Dozvola na razini institucije ili voditelj/suradnik barem jedne prijave (popis prijava, referentni podaci za prijavu). */
export const canAnyProposal = (ctx: RequestContext, permission: Permission): boolean =>
  hasPermission(ctx.permissions, permission) || ownProposals(ctx, permission).length > 0;

/**
 * Baca 404 ako korisnik ne smije vidjeti projekt (poruka jednaka onoj za nepostojeći entitet), 403 ako ga vidi,
 * ali nema traženu dozvolu. `notFound` – poruka entiteta kroz koji je projekt razriješen (npr. „Dokument … ne postoji”).
 */
export function assertProjectPermission(ctx: RequestContext, projectId: string, permission: Permission, notFound = `Projekt ${projectId} ne postoji`): void {
  if (canOnProject(ctx, permission, projectId)) return;
  if (!canSeeProject(ctx, projectId)) throw new NotFoundException(notFound);
  throw new ForbiddenException(`Nedostaje dozvola ${permission} na ovom projektu`);
}
