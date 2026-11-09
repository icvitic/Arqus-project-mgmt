/** Životni ciklus projekta (domenski model, odj. 3) i izvještajna razdoblja (M8). Čiste funkcije, bez baze. */

export type ProjectStatus = 'contracting' | 'active' | 'suspended' | 'closing' | 'closed' | 'terminated' | 'archived';
export type ProjectRole = 'coordinator' | 'partner';
export type PartnerRole = 'coordinator' | 'partner' | 'associated' | 'third_party';

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  contracting: 'u ugovaranju', active: 'aktivan', suspended: 'obustavljen', closing: 'u završetku',
  closed: 'zatvoren', terminated: 'prekinut', archived: 'arhiviran',
};

export const PROJECT_TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  contracting: ['active', 'terminated'],
  active: ['suspended', 'closing', 'terminated'],
  suspended: ['active', 'terminated'],
  closing: ['closed', 'active'],
  closed: ['archived'],
  terminated: ['archived'],
  archived: [],
};

export interface ProjectFacts {
  contractNo?: string | null;
  startDate?: string | null;
  durationMonths?: number | null;
  packageStatus: string;
  partnerCount: number;
}

/** Razlozi zbog kojih prijelaz nije dopušten; prazan niz = dopušteno. */
export function transitionIssues(from: ProjectStatus, to: ProjectStatus, facts: ProjectFacts): string[] {
  if (!PROJECT_TRANSITIONS[from].includes(to)) {
    return [`prijelaz ${PROJECT_STATUS_LABELS[from]} → ${PROJECT_STATUS_LABELS[to]} nije dopušten`];
  }
  const issues: string[] = [];
  if (from === 'contracting' && to === 'active') {
    if (!facts.contractNo?.trim()) issues.push('nedostaje broj ugovora');
    if (!facts.startDate) issues.push('nedostaje datum početka');
    if (!facts.durationMonths || facts.durationMonths < 1) issues.push('nedostaje trajanje u mjesecima');
    if (facts.packageStatus !== 'published') issues.push('paket programa nije objavljen – projekt se aktivira samo uz objavljenu verziju paketa');
    if (facts.partnerCount < 1) issues.push('projekt nema nijednog partnera');
  }
  return issues;
}

/** Dodaje mjesece datumu YYYY-MM-DD (UTC), dan se ograničava na zadnji dan ciljnog mjeseca. */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const total = (y * 12 + (m - 1)) + months;
  const ty = Math.floor(total / 12), tm = total % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ty, tm, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const t = Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export interface ReportingPeriodPlan { number: number; startDate: string; endDate: string; dueDate: string }

/**
 * Izvještajna razdoblja iz pravila paketa: uzastopna razdoblja od `periodMonths` mjeseci od početka projekta,
 * zadnje skraćeno do kraja projekta; rok predaje = kraj razdoblja + `deadlineDays`.
 */
export function generateReportingPeriods(startDate: string, durationMonths: number, periodMonths: number, deadlineDays: number): ReportingPeriodPlan[] {
  if (durationMonths < 1 || periodMonths < 1) throw new Error('Trajanje i duljina razdoblja moraju biti ≥ 1 mjesec');
  const projectEnd = addDays(addMonths(startDate, durationMonths), -1);
  const out: ReportingPeriodPlan[] = [];
  for (let m = 0, n = 1; m < durationMonths; m += periodMonths, n++) {
    const s = addMonths(startDate, m);
    const nextStart = addMonths(startDate, Math.min(m + periodMonths, durationMonths));
    const e = m + periodMonths >= durationMonths ? projectEnd : addDays(nextStart, -1);
    out.push({ number: n, startDate: s, endDate: e, dueDate: addDays(e, deadlineDays) });
  }
  return out;
}
