/**
 * M10 Portfelj (WP1.15): pokazatelji za pregled svih projekata institucije. Čiste funkcije, bez baze –
 * napredak u vremenu i potrošnji, spajanje i poredak rokova, opterećenje ljudi kroz projekte (provjera dvostrukog financiranja).
 * Datumi su `GGGG-MM-DD` (kalendarski dan, UTC), rad u minutama, novac u centima.
 */
import type { ProgrammePackage } from './programme-package.js';
import { addDays, addMonths } from './project.js';

/** Razlika potrošnje i proteklog vremena (postotni bodovi) iznad koje se projekt označava. */
export const PROGRESS_THRESHOLD_PP = 20;
/** Dnevno ograničenje rada jedne osobe kroz sve projekte: puno radno vrijeme (8 h, Zakon o radu: 40 h tjedno). */
export const DAILY_HOURS_LIMIT = 8;
/** Prozor rokova na portfelju (dana unaprijed) i prozor za brojku „rokovi u idućih 30 dana”. */
export const DEADLINE_WINDOW_DAYS = 60;
export const DEADLINE_SOON_DAYS = 30;

const DAY = 86_400_000;
const dayNo = (iso: string): number => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
/** Broj dana od `from` do `to` (oba `GGGG-MM-DD`): isti dan = 0, sutra = 1, jučer = −1. */
export const daysBetween = (from: string, to: string): number => dayNo(to) - dayNo(from);
/** Današnji kalendarski dan (UTC) kao `GGGG-MM-DD`. */
export const isoToday = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/* ---------- napredak u vremenu ---------- */

export type TimeState = 'unknown' | 'not_started' | 'running' | 'finished';
export interface TimeProgress {
  state: TimeState;
  /** Tekući mjesec provedbe (1 = mjesec početka); 0 prije početka, trajanje nakon kraja. */
  month: number;
  durationMonths: number | null;
  /** Protekli udio trajanja u postocima (dani, uključujući današnji); null bez početka ili trajanja. */
  percent: number | null;
  endDate: string | null;
}

/** Zadnji dan projekta: početak + trajanje − 1 dan (kao u izvještajnim razdobljima i provjeri datuma troškova). */
export function projectEndDate(startDate: string | null | undefined, durationMonths: number | null | undefined): string | null {
  return startDate && durationMonths && durationMonths > 0 ? addDays(addMonths(startDate, durationMonths), -1) : null;
}

export function timeProgress(startDate: string | null | undefined, durationMonths: number | null | undefined, today: string): TimeProgress {
  const end = projectEndDate(startDate, durationMonths);
  if (!startDate || !end || !durationMonths) return { state: 'unknown', month: 0, durationMonths: durationMonths ?? null, percent: null, endDate: null };
  if (today < startDate) return { state: 'not_started', month: 0, durationMonths, percent: 0, endDate: end };
  if (today > end) return { state: 'finished', month: durationMonths, durationMonths, percent: 100, endDate: end };
  let month = 1;
  while (month < durationMonths && addMonths(startDate, month) <= today) month++;
  const percent = Math.round(((daysBetween(startDate, today) + 1) / (daysBetween(startDate, end) + 1)) * 100);
  return { state: 'running', month, durationMonths, percent, endDate: end };
}

/* ---------- napredak u potrošnji i signal ---------- */

/** Ostvareno / ugovoreno u postocima; null kad nema ugovorenog iznosa (nema proračuna – nema usporedbe). */
export function budgetPercent(planned: number, actual: number): number | null {
  return planned > 0 ? Math.round((actual / planned) * 100) : null;
}

export type ProgressSignal = 'none' | 'ok' | 'lagging' | 'ahead';

/**
 * Usporedba potrošnje s proteklim vremenom: „kasni” ako je potrošnja više od `threshold` postotnih bodova ispod
 * proteklog vremena, „prednjači” ako je toliko iznad. Bez proračuna ili poznatog trajanja signala nema.
 */
export function progressSignal(timePct: number | null, budgetPct: number | null, threshold = PROGRESS_THRESHOLD_PP): { signal: ProgressSignal; gap: number | null } {
  if (timePct === null || budgetPct === null) return { signal: 'none', gap: null };
  const gap = budgetPct - timePct;
  return { signal: gap < -threshold ? 'lagging' : gap > threshold ? 'ahead' : 'ok', gap };
}

/* ---------- rokovi ---------- */

export type PortfolioDeadlineKind = 'claim_due' | 'period_end' | 'deliverable' | 'milestone' | 'call_submission' | 'call_internal' | 'proposal_internal';

export interface DeadlineInput {
  kind: PortfolioDeadlineKind;
  /** Kalendarski dan roka (`GGGG-MM-DD`). */
  date: string;
  /** Ima li smisla rok prikazati i nakon što je prošao (neispunjena obveza); inače se prošli rok izostavlja. */
  overdueRelevant: boolean;
  title: string;
  /** Kome rok pripada (akronim projekta, oznaka poziva) – posljednji kriterij poretka. */
  scope?: string;
}
export type DeadlineItem<T extends DeadlineInput> = T & { days: number; overdue: boolean };

const KIND_ORDER: PortfolioDeadlineKind[] = ['claim_due', 'deliverable', 'milestone', 'period_end', 'proposal_internal', 'call_internal', 'call_submission'];

/**
 * Jedan popis rokova: najprije prošli rokovi neispunjenih obveza (najstariji prvi), zatim rokovi od danas do
 * `windowDays` dana unaprijed (najbliži prvi). Rok danas nije prošao (0 dana). Isti dan: po vrsti, naslovu i pripadnosti.
 */
export function mergeDeadlines<T extends DeadlineInput>(items: T[], today: string, windowDays = DEADLINE_WINDOW_DAYS): DeadlineItem<T>[] {
  const out: DeadlineItem<T>[] = [];
  for (const it of items) {
    const days = daysBetween(today, it.date);
    if (days < 0 ? !it.overdueRelevant : days > windowDays) continue;
    out.push({ ...it, days, overdue: days < 0 });
  }
  return out.sort((a, b) => a.days - b.days || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.title.localeCompare(b.title, 'hr') || (a.scope ?? '').localeCompare(b.scope ?? '', 'hr'));
}

/** Brojke za portfelj: rokovi od danas do `soonDays` dana i prošli rokovi neispunjenih obveza. */
export function deadlineCounts(items: DeadlineInput[], today: string, soonDays = DEADLINE_SOON_DAYS): { soon: number; overdue: number } {
  let soon = 0, overdue = 0;
  for (const it of items) {
    const d = daysBetween(today, it.date);
    if (d < 0) { if (it.overdueRelevant) overdue++; } else if (d <= soonDays) soon++;
  }
  return { soon, overdue };
}

/* ---------- opterećenje ljudi ---------- */

/**
 * Godišnji fond produktivnih sati iz pravila troška osoblja u paketu: za satnicu `maxUnitsPerYear` (ili djelitelj) sati,
 * za dnevnicu dani × sati po danu (HE: 215 × 8 = 1720 h). Metode bez godišnjeg fonda vraćaju null.
 */
export function annualProductiveHours(rule: ProgrammePackage['personnelRule'] | undefined): number | null {
  if (!rule) return null;
  const units = rule.maxUnitsPerYear ?? rule.divisor;
  if (!units) return null;
  if (rule.method === 'hourlyRate') return units;
  if (rule.method === 'dailyRate') return units * (rule.hoursPerDay ?? 8);
  return null;
}

/** Član tima na jednom projektu (osoba se kroz projekte prepoznaje po korisničkom računu, inače po imenu). */
export interface TeamMemberRef { memberId: string; projectId: string; userId: string | null; fullName: string; annualLimitHours: number | null }
/** Rad člana tima na jedan dan (zbroj kroz radne pakete). */
export interface WorkDay { memberId: string; date: string; minutes: number }

export interface PersonLoad {
  key: string;
  name: string;
  userId: string | null;
  projectIds: string[];
  /** Minute po mjesecu za zadane mjesece (redom). */
  months: { month: string; minutes: number }[];
  yearMinutes: number;
  /** Najstroži godišnji fond među paketima projekata na kojima osoba radi; null ako ga nijedan paket ne propisuje. */
  annualLimitHours: number | null;
  overAnnual: boolean;
  /** Dani s ukupno više od dnevnog ograničenja kroz sve projekte. */
  overDays: { date: string; minutes: number; projects: number }[];
}

export const normalizeName = (s: string): string => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('hr');

/**
 * Opterećenje po osobi kroz sve projekte. Članovi tima s istim korisničkim računom su ista osoba; član bez računa
 * pridružuje se osobi s računom istog imena, inače se osobe bez računa spajaju po imenu.
 */
export function personWorkload(members: TeamMemberRef[], days: WorkDay[], opts: { months: string[]; year: string; dailyLimitMinutes?: number }): PersonLoad[] {
  const dailyLimit = opts.dailyLimitMinutes ?? DAILY_HOURS_LIMIT * 60;
  const userByName = new Map<string, string>();
  for (const m of members) if (m.userId && !userByName.has(normalizeName(m.fullName))) userByName.set(normalizeName(m.fullName), m.userId);
  const keyOf = (m: TeamMemberRef) => {
    const u = m.userId ?? userByName.get(normalizeName(m.fullName));
    return u ? `u:${u}` : `n:${normalizeName(m.fullName)}`;
  };
  const people = new Map<string, { p: PersonLoad; perDay: Map<string, { minutes: number; projects: Set<string> }> }>();
  const memberKey = new Map<string, string>();
  for (const m of members) {
    const key = keyOf(m);
    memberKey.set(m.memberId, key);
    let e = people.get(key);
    if (!e) {
      e = { p: { key, name: m.fullName.trim(), userId: key.startsWith('u:') ? key.slice(2) : null, projectIds: [], months: opts.months.map((month) => ({ month, minutes: 0 })), yearMinutes: 0, annualLimitHours: null, overAnnual: false, overDays: [] }, perDay: new Map() };
      people.set(key, e);
    }
    if (m.userId && !e.p.userId) e.p.userId = m.userId;
    if (!e.p.projectIds.includes(m.projectId)) e.p.projectIds.push(m.projectId);
    if (m.annualLimitHours !== null && (e.p.annualLimitHours === null || m.annualLimitHours < e.p.annualLimitHours)) e.p.annualLimitHours = m.annualLimitHours;
  }
  const projectOf = new Map(members.map((m) => [m.memberId, m.projectId]));
  for (const d of days) {
    const key = memberKey.get(d.memberId);
    if (!key || d.minutes <= 0) continue;
    const e = people.get(key)!;
    const month = d.date.slice(0, 7);
    const slot = e.p.months.find((x) => x.month === month);
    if (slot) slot.minutes += d.minutes;
    if (d.date.startsWith(`${opts.year}-`)) e.p.yearMinutes += d.minutes;
    const day = e.perDay.get(d.date) ?? { minutes: 0, projects: new Set<string>() };
    day.minutes += d.minutes; day.projects.add(projectOf.get(d.memberId)!);
    e.perDay.set(d.date, day);
  }
  const out: PersonLoad[] = [];
  for (const { p, perDay } of people.values()) {
    p.overDays = [...perDay].filter(([, v]) => v.minutes > dailyLimit).map(([date, v]) => ({ date, minutes: v.minutes, projects: v.projects.size })).sort((a, b) => a.date.localeCompare(b.date));
    p.overAnnual = p.annualLimitHours !== null && p.yearMinutes > p.annualLimitHours * 60;
    out.push(p);
  }
  // Najprije osobe s upozorenjima, zatim po broju projekata i satima ove godine.
  const flags = (p: PersonLoad) => (p.overAnnual ? 2 : 0) + (p.overDays.length ? 1 : 0);
  return out.sort((a, b) => flags(b) - flags(a) || b.projectIds.length - a.projectIds.length || b.yearMinutes - a.yearMinutes || a.name.localeCompare(b.name, 'hr'));
}

/** Posljednjih `n` kalendarskih mjeseci zaključno s mjesecom dana `today` (najstariji prvi), `GGGG-MM`. */
export function lastMonths(today: string, n: number): string[] {
  const first = `${today.slice(0, 7)}-01`;
  return Array.from({ length: n }, (_, i) => addMonths(first, i - (n - 1)).slice(0, 7));
}

/* ---------- prijave ---------- */

/** Prijave koje su još „u tijeku” (nisu odbijene, povučene ni ugovorene u projekt). */
export const PIPELINE_STATUSES = ['idea', 'preparation', 'internal_review', 'submitted', 'in_evaluation', 'reserve', 'funded'] as const;

/** Uspješnost: financirane (uključujući ugovorene) prema financiranima i odbijenima; rezervna lista i povučene se ne broje. */
export function successRate(statuses: string[]): { funded: number; rejected: number; percent: number | null } {
  const funded = statuses.filter((s) => s === 'funded' || s === 'contracted').length;
  const rejected = statuses.filter((s) => s === 'rejected').length;
  return { funded, rejected, percent: funded + rejected ? Math.round((funded / (funded + rejected)) * 100) : null };
}
