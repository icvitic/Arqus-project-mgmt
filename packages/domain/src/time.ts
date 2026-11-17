/**
 * „Danas” institucije (WP1.14b). Rokovi, krajevi razdoblja i „još N dana” računaju se po kalendarskom danu u vremenskoj
 * zoni institucije (postavka stanara `settings.timeZone`, zadano Europe/Zagreb), ne po UTC-u – inače su oko ponoći
 * za hrvatske korisnike pomaknuti za jedan dan. Čiste funkcije; `now` se uvijek može zadati (testovi).
 */

/** Zadana vremenska zona institucije. */
export const DEFAULT_TIME_ZONE = 'Europe/Zagreb';

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Je li naziv valjana IANA vremenska zona (npr. `Europe/Zagreb`). */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 64) return false;
  try { formatter(timeZone); return true; } catch { return false; }
}

/** Valjana zona ili zadana (neispravna postavka ne ruši izračun rokova). */
export const timeZoneOr = (timeZone: unknown): string => (isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE);

/** Kalendarski dan (`GGGG-MM-DD`) trenutka `instant` u zoni `timeZone`. */
export function dateIn(timeZone: string, instant: Date | string | number): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  const parts = Object.fromEntries(formatter(timeZoneOr(timeZone)).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Današnji kalendarski dan institucije (`GGGG-MM-DD`). */
export const todayIn = (timeZone: string = DEFAULT_TIME_ZONE, now: Date = new Date()): string => dateIn(timeZone, now);
