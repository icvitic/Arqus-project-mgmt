import type { ProgrammePackage } from './programme-package.js';

/** M7 Financije: trošak osoblja iz timesheeta, upozorenja za evidenciju rada, razdoblja ZNS-a. Iznosi u centima, rad u minutama. */

export interface TimesheetEntryInput { day: number; minutes: number; workPackageId?: string | null }

/**
 * Trošak osoblja prema pravilu paketa (invarijanta 4: izveden, ne unosi se):
 * - `hourlyRate`: godišnji trošak / djelitelj (npr. 1720 sati) × sati
 * - `dailyRate`: godišnji trošak / djelitelj (npr. 215 dana) × dani, dani = sati / sati po danu (zadano 8)
 */
export function personnelCostCents(pkg: ProgrammePackage, annualCostCents: number, minutes: number): number {
  const rule = pkg.personnelRule;
  if (!rule?.method || !rule.divisor) throw new Error(`Paket ${pkg.meta.id} nema pravilo izračuna troška osoblja (personnelRule.method/divisor)`);
  if (!Number.isInteger(annualCostCents) || annualCostCents < 0) throw new Error('Godišnji trošak mora biti nenegativan cijeli broj centi');
  if (rule.method === 'hourlyRate') return Math.round((annualCostCents * minutes) / (60 * rule.divisor));
  if (rule.method === 'dailyRate') return Math.round((annualCostCents * minutes) / (60 * (rule.hoursPerDay ?? 8) * rule.divisor));
  throw new Error(`Metoda "${rule.method}" još nije podržana za izračun iz timesheeta`);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Provjera unosa timesheeta: greške (dan izvan mjeseca, > 24 h dnevno) i upozorenja (> 10 h dnevno, rad vikendom). */
export function timesheetIssues(month: string, entries: TimesheetEntryInput[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = []; const warnings: string[] = [];
  const dim = daysInMonth(month); const perDay = new Map<number, number>();
  for (const e of entries) {
    if (!Number.isInteger(e.day) || e.day < 1 || e.day > dim) { errors.push(`dan ${e.day} ne postoji u mjesecu ${month}`); continue; }
    if (!Number.isInteger(e.minutes) || e.minutes < 0) { errors.push(`dan ${e.day}: minute moraju biti nenegativan cijeli broj`); continue; }
    perDay.set(e.day, (perDay.get(e.day) ?? 0) + e.minutes);
  }
  for (const [day, total] of [...perDay].sort((a, b) => a[0] - b[0])) {
    if (total > 24 * 60) errors.push(`dan ${day}: više od 24 sata`);
    else if (total > 10 * 60) warnings.push(`dan ${day}: ${(total / 60).toFixed(1)} h (više od 10 h)`);
    const wd = new Date(`${month}-${String(day).padStart(2, '0')}T00:00:00Z`).getUTCDay();
    if (total > 0 && (wd === 0 || wd === 6)) warnings.push(`dan ${day}: rad vikendom`);
  }
  return { errors, warnings };
}

/** Zbroj minuta po radnom paketu (null = bez WP-a) – osnova za troškove osoblja po WP-u. */
export function minutesByWorkPackage(entries: TimesheetEntryInput[]): Map<string | null, number> {
  const m = new Map<string | null, number>();
  for (const e of entries) m.set(e.workPackageId ?? null, (m.get(e.workPackageId ?? null) ?? 0) + e.minutes);
  return m;
}

export const isDateWithin = (date: string, from: string, to: string) => date >= from && date <= to;
