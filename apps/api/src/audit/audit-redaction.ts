/**
 * WP1.14b – što revizijski zapis smije sadržavati i pokazati.
 *
 * 1. Tajne (lozinke i njihovi hashevi, MFA tajne, tokeni, ključevi) nikad se ne upisuju: `scrubSecrets` se primjenjuje pri
 *    upisu (AuditService.record) i još jednom pri čitanju (obrana u dubinu za zapise nastale izvan aplikacije).
 * 2. Podaci o plaći – godišnji trošak člana tima i sve izvedeno iz njega (trošak osoblja iz odobrenog timesheeta, priznati
 *    iznos takvog troška) – vide se u pregledu revizije samo uz `personnel:read` na razini institucije (`redactSalary`).
 */

export const HIDDEN = '[skriveno]';

/** Ključevi koji nose tajne (bez obzira na razinu ugniježđenosti). */
const SECRET_KEY = /pass(word|wd)?|secret|token|hash|otp|mfa.*(enc|secret|pending)|api.?key|credential|private.?key/i;
/** Ključevi s godišnjim troškom (plaćom). */
const SALARY_KEY = /annual.?cost/i;
/** Iznosi u zapisima o troškovima osoblja. */
const AMOUNT_KEY = /^(amount|amountCents|recognised|recognisedCents)$/;

type Json = unknown;

function mapDeep(v: Json, fn: (key: string, value: Json) => Json | typeof SKIP): Json {
  if (Array.isArray(v)) return v.map((x) => mapDeep(x, fn));
  if (v && typeof v === 'object') {
    const out: Record<string, Json> = {};
    for (const [k, x] of Object.entries(v as Record<string, Json>)) {
      const r = fn(k, x);
      out[k] = r === SKIP ? mapDeep(x, fn) : r;
    }
    return out;
  }
  return v;
}
const SKIP = Symbol('skip');

/** Zamjenjuje vrijednosti ključeva s tajnama oznakom „[skriveno]” (ključ ostaje – vidi se da je promjena bila). */
export function scrubSecrets<T>(diff: T): T {
  return mapDeep(diff, (k) => (SECRET_KEY.test(k) && k !== 'sha256' ? HIDDEN : SKIP)) as T;
}

export interface RedactableEntry { entity: string; entityId: string | null; action: string; diff: { before?: Json; after?: Json; meta?: Record<string, Json> } | null }

/**
 * Skrivanje podataka o plaći za korisnika bez `personnel:read`. `personnelExpenseIds` – troškovi nastali iz timesheeta
 * (trošak osoblja): njihov iznos i priznati iznos otkrivaju satnicu.
 */
export function redactSalary<T extends RedactableEntry>(e: T, personnelExpenseIds: ReadonlySet<string>): T & { redacted: boolean } {
  if (!e.diff) return { ...e, redacted: false };
  let redacted = false;
  const hide = (): string => { redacted = true; return HIDDEN; };
  const personnelExpense = e.entity === 'expense' && (!!e.entityId && personnelExpenseIds.has(e.entityId)
    || [e.diff.before, e.diff.after].some((x) => ['timesheet', 'historic_personnel'].includes((x as { source?: string } | undefined)?.source ?? '')));
  const diff = mapDeep(e.diff, (k, v) => {
    if (SALARY_KEY.test(k)) return v === null || v === undefined ? v : hide();
    // Trošak osoblja iz odobrenog timesheeta (iznos po radnom paketu) i izmjene takvih troškova.
    if (AMOUNT_KEY.test(k) && typeof v === 'number' && (e.entity === 'timesheet' || personnelExpense)) return hide();
    return SKIP;
  }) as T['diff'];
  // Odluka o ZNS-u: umanjeni/odbijeni troškovi osoblja (stavke `reduced` s id-jem troška iz timesheeta).
  const meta = (diff as { meta?: { reduced?: { id?: string }[] } } | null)?.meta;
  if (e.entity === 'claim' && Array.isArray(meta?.reduced)) {
    meta.reduced = meta.reduced.map((r) => (r?.id && personnelExpenseIds.has(r.id)
      ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, AMOUNT_KEY.test(k) && typeof v === 'number' ? hide() : v]))
      : r));
  }
  return { ...e, diff, redacted };
}

/** Id-jevi troškova koje treba provjeriti (izvor troška) za skrivanje plaća. */
export function expenseIdsIn(entries: RedactableEntry[]): string[] {
  const ids = new Set<string>();
  for (const e of entries) {
    if (e.entity === 'expense' && e.entityId) ids.add(e.entityId);
    const reduced = (e.diff?.meta as { reduced?: { id?: string }[] } | undefined)?.reduced;
    if (e.entity === 'claim' && Array.isArray(reduced)) for (const r of reduced) if (r?.id) ids.add(r.id);
  }
  return [...ids].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
}
