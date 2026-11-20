import { z } from 'zod';

/**
 * WP1.23 – rokovi čuvanja po vrsti podatka (`docs/gdpr/EVIDENCIJA-OBRADE.md`, odj. 3). Svaka kategorija ima ZADANI rok
 * (oznaka „zadano – institucija treba potvrditi”, nije pravni savjet), DONJU GRANICU ispod koje je postavka ne može
 * spustiti (sigurnost ili dokazna vrijednost) i oznaku smije li je institucija mijenjati. Donje granice za revizijski zapis,
 * zapise neuspjelih prijava, obrisane dokumente i rok čuvanja projekta provodi i baza (funkcije u migraciji 0032) – postavka
 * u `tenants.settings` ih ne može zaobići ni izravnim upisom.
 */
export const RETENTION_CATEGORIES = [
  { key: 'sessions', label: 'Sesije prijave (IP adresa, preglednik)', unit: 'dana nakon isteka ili odjave', defaultDays: 30, floorDays: 7, configurable: true,
    basis: 'Istraga sigurnosnog incidenta u prvim tjednima; prijave i odjave ostaju u revizijskom zapisu.' },
  { key: 'accountTokens', label: 'Istekle pozivnice i poveznice za novu lozinku', unit: 'dana nakon isteka', defaultDays: 7, floorDays: 1, configurable: false,
    basis: 'Istekao token više ne vrijedi; zadržava se kratko da administrator vidi da je pozivnica istekla.' },
  { key: 'mailDeliveries', label: 'Zapis isporuke e-pošte (bez sadržaja)', unit: 'dana', defaultDays: 180, floorDays: 30, configurable: true,
    basis: 'Administrator iz njega vidi da pošta ne prolazi; nakon toga nema svrhu.' },
  { key: 'digestRuns', label: 'Zapis dnevnog sažetka (dan i ishod)', unit: 'dana', defaultDays: 90, floorDays: 14, configurable: false,
    basis: 'Sprječava dvostruko slanje istog dana i određuje „nove” obavijesti; starije nema svrhu.' },
  { key: 'notificationsRead', label: 'Pročitane obavijesti', unit: 'dana nakon čitanja', defaultDays: 90, floorDays: 7, configurable: true,
    basis: 'Obavijest je pročitana; događaj ostaje na entitetu i u revizijskom zapisu.' },
  { key: 'notificationsUnread', label: 'Nepročitane obavijesti', unit: 'dana', defaultDays: 365, floorDays: 90, configurable: true,
    basis: 'Obavijest koju godinu dana nitko nije otvorio više nije obavijest.' },
  { key: 'deletedDocuments', label: 'Obrisani dokumenti (datoteke i verzije)', unit: 'dana nakon brisanja', defaultDays: 180, floorDays: 30, configurable: true,
    basis: 'Razdoblje za ispravak greške. Dokaz troška u zahtjevu i dokument zahtjeva brišu se tek po isteku roka čuvanja projekta.' },
  { key: 'loginFailures', label: 'Revizijski zapisi neuspjelih prijava (IP adresa)', unit: 'dana', defaultDays: 365, floorDays: 90, configurable: true,
    basis: 'Otkrivanje pogađanja lozinki kroz dulje razdoblje; donju granicu provodi baza.' },
  { key: 'audit', label: 'Revizijski zapis (ostali zapisi)', unit: 'dana', defaultDays: 3650, floorDays: 1825, configurable: true,
    basis: 'Dokaz tko je što napravio. Zapis se ne briše dok traje rok čuvanja ijednog projekta koji je tada postojao; donju granicu provodi baza.' },
  { key: 'subjectRequests', label: 'Zatvoreni zahtjevi ispitanika (evidencija)', unit: 'dana nakon zatvaranja', defaultDays: 1825, floorDays: 365, configurable: true,
    basis: 'Dokaz da je institucija na zahtjev odgovorila u roku (odgovornost, čl. 5(2) GDPR-a). Otvoren zahtjev se ne briše.' },
] as const;

export type RetentionKey = (typeof RETENTION_CATEGORIES)[number]['key'];
export const CONFIGURABLE_KEYS = RETENTION_CATEGORIES.filter((c) => c.configurable).map((c) => c.key);
export const categoryOf = (key: RetentionKey) => RETENTION_CATEGORIES.find((c) => c.key === key)!;

/** Rok čuvanja projekta u godinama (od kraja projekta ili posljednje isplate / odluke, što je kasnije). */
export const PROJECT_YEARS = { defaultYears: 10, floorYears: 3, maxYears: 50 } as const;

export interface PrivacySettings {
  retentionDays: Partial<Record<RetentionKey, number>>;
  projectYears: { default?: number; programmes: Record<string, number> };
  confirmedAt: string | null;
  confirmedBy: string | null;
}

/** Postavka iz `tenants.settings.privacy` (nepoznato ili neispravno = zadano). */
export function privacySettingsOf(settings: Record<string, unknown> | null | undefined): PrivacySettings {
  const raw = (settings?.privacy ?? {}) as Record<string, unknown>;
  const days = (raw.retentionDays ?? {}) as Record<string, unknown>;
  const years = (raw.projectYears ?? {}) as Record<string, unknown>;
  const retentionDays: Partial<Record<RetentionKey, number>> = {};
  for (const c of RETENTION_CATEGORIES) if (Number.isInteger(days[c.key])) retentionDays[c.key] = days[c.key] as number;
  const programmes: Record<string, number> = {};
  for (const [k, v] of Object.entries((years.programmes ?? {}) as Record<string, unknown>)) if (Number.isInteger(v)) programmes[k] = v as number;
  return {
    retentionDays, projectYears: { ...(Number.isInteger(years.default) ? { default: years.default as number } : {}), programmes },
    confirmedAt: typeof raw.confirmedAt === 'string' ? raw.confirmedAt : null, confirmedBy: typeof raw.confirmedBy === 'string' ? raw.confirmedBy : null,
  };
}

/** Rok koji vrijedi: postavka (samo za promjenjive kategorije) ili zadano, nikad ispod donje granice. */
export function effectiveDays(s: PrivacySettings, key: RetentionKey): number {
  const c = categoryOf(key);
  const set = c.configurable ? s.retentionDays[key] : undefined;
  return Math.max(c.floorDays, set ?? c.defaultDays);
}

export function effectiveProjectYears(s: PrivacySettings, packageId: string): { years: number; source: 'programme' | 'institution' | 'default' } {
  const p = s.projectYears.programmes[packageId];
  if (p !== undefined) return { years: clampYears(p), source: 'programme' };
  if (s.projectYears.default !== undefined) return { years: clampYears(s.projectYears.default), source: 'institution' };
  return { years: PROJECT_YEARS.defaultYears, source: 'default' };
}
const clampYears = (y: number) => Math.min(PROJECT_YEARS.maxYears, Math.max(PROJECT_YEARS.floorYears, y));

const daysField = (key: RetentionKey) => { const c = categoryOf(key); return z.number().int().min(c.floorDays, `najmanje ${c.floorDays} dana`).max(36_500); };
const yearsField = z.number().int().min(PROJECT_YEARS.floorYears, `najmanje ${PROJECT_YEARS.floorYears} godine`).max(PROJECT_YEARS.maxYears);

/** Ulaz za promjenu rokova: samo promjenjive kategorije, vrijednosti od donje granice naviše. */
export const privacySettingsInput = z.object({
  retentionDays: z.object(Object.fromEntries(CONFIGURABLE_KEYS.map((k) => [k, daysField(k).optional()])) as Record<RetentionKey, z.ZodOptional<z.ZodNumber>>).strict().optional(),
  projectYears: z.object({
    default: yearsField.nullable().optional(),
    programmes: z.record(z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/), yearsField.nullable()).optional(),
  }).strict().optional(),
  /** Institucija potvrđuje da je rokove provjerila (zadani rokovi nisu pravni savjet). */
  confirm: z.boolean().optional(),
}).strict();
export type PrivacySettingsInput = z.infer<typeof privacySettingsInput>;
