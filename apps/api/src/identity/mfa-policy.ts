import { hasPermission, type Permission } from './permissions';

/**
 * WP1.19 – obvezna dvofaktorska prijava (MFA) po postavci institucije (`tenants.settings.requireMfa`):
 * - `none` – nije obvezna (zadano za postojeće institucije, testove i demo);
 * - `privileged` – obvezna za korisnike koji NA RAZINI INSTITUCIJE imaju barem jednu od povlaštenih dozvola (ili `*`);
 * - `all` – obvezna za sve korisnike.
 * Korisnik kojem je MFA obvezan, a nije ga postavio, prijavljuje se u ograničeno stanje: smije samo vlastiti račun
 * (MFA, lozinka) i odjavu; sve ostalo → 403 `mfa_setup_required`. Provjera je pri svakom zahtjevu (AuthGuard) iz svježih
 * podataka, pa ni stari token ne zaobilazi obvezu.
 */
export const MFA_POLICIES = ['none', 'privileged', 'all'] as const;
export type MfaPolicy = (typeof MFA_POLICIES)[number];

/** Povlaštene dozvole (na razini institucije): upravljanje korisnicima i postavkama, plaće, revizija, financijske izmjene. */
export const PRIVILEGED_PERMISSIONS: readonly Permission[] = ['users:write', 'tenant:write', 'personnel:read', 'audit:read', 'finance:write'];

export const MFA_SETUP_REQUIRED = 'mfa_setup_required';

export const mfaPolicyOf = (settings: Record<string, unknown> | null | undefined): MfaPolicy => {
  const v = settings?.requireMfa;
  return (MFA_POLICIES as readonly unknown[]).includes(v) ? (v as MfaPolicy) : 'none';
};

/** Je li MFA obvezan korisniku s ovim dozvolama na razini institucije (uloge na projektu se ne broje). */
export function mfaRequiredFor(policy: MfaPolicy, tenantPermissions: Iterable<string>): boolean {
  if (policy === 'all') return true;
  if (policy === 'none') return false;
  const set = new Set(tenantPermissions);
  return PRIVILEGED_PERMISSIONS.some((p) => hasPermission(set, p));
}

export const MFA_SETUP_MESSAGE = 'Tvoja institucija zahtijeva dvofaktorsku prijavu (MFA) za tvoju ulogu. Postavi MFA u „Moj račun” – do tada su dostupni samo vlastiti račun i odjava.';
