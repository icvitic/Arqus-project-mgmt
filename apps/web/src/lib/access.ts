import type { Me } from './types';

/**
 * Provjere pristupa u sučelju (WP1.14) – zrcale pravila API-ja (apps/api/src/common/access.ts).
 * `me.permissions` su dozvole na razini institucije (vrijede za sve projekte), `me.projectPermissions` dozvole po projektu.
 */
const has = (set: readonly string[] | undefined, p: string) => !!set && (set.includes('*') || set.includes(p));

/** Radnja institucije (novi projekt, korisnici, paketi, radar, prijave). */
export const can = (me: Me, p: string): boolean => has(me.permissions, p);

/** Radnja na projektu: dozvola na razini institucije ili na tom projektu. */
export const canOn = (me: Me, p: string, projectId: string): boolean => has(me.permissions, p) || has(me.projectPermissions?.[projectId], p);

/** Dozvola u bilo kojem opsegu (izbornik, popisi koji se filtriraju na poslužitelju). */
export const canAny = (me: Me, p: string): boolean => has(me.permissions, p) || Object.values(me.projectPermissions ?? {}).some((s) => has(s, p));

/** Upravljanje pristupom projektu: administrator korisnika ili projects:write na projektu. */
export const canManageAccess = (me: Me, projectId: string): boolean => can(me, 'users:write') || canOn(me, 'projects:write', projectId);
