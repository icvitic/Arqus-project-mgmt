/** ZNS u sučelju (WP1.16a): grupiranje troškova osoblja i zadano razdoblje za novi zahtjev. */

export interface GroupableExpense { id: string; date: string; source: string; timesheetId: string | null; person: string | null; month: string | null; amount: number; recognised: number | null }
export interface ExpenseGroup<T extends GroupableExpense> {
  key: string;
  /** `personnel` – jedan timesheet (osoba i mjesec), retci po radnom paketu; `single` – jedan (ručni) trošak. */
  kind: 'personnel' | 'single';
  person: string | null; month: string | null; date: string;
  rows: T[];
  amount: number;
  /** Zbroj priznatih iznosa; null dok o troškovima nije odlučeno. */
  recognised: number | null;
}

/**
 * Troškovi osoblja nastaju odobrenjem timesheeta, po jedan za svaki radni paket. U prikazu se grupiraju po timesheetu
 * (osoba i mjesec) – pohranjena razina detalja ostaje ista; ručni troškovi ostaju pojedinačni. Poredak po datumu.
 */
export function groupExpenses<T extends GroupableExpense>(rows: T[]): ExpenseGroup<T>[] {
  const groups: ExpenseGroup<T>[] = [];
  const byTs = new Map<string, ExpenseGroup<T>>();
  for (const r of rows) {
    if (r.source === 'timesheet' && r.timesheetId) {
      let g = byTs.get(r.timesheetId);
      if (!g) { g = { key: r.timesheetId, kind: 'personnel', person: r.person, month: r.month, date: r.date, rows: [], amount: 0, recognised: null }; byTs.set(r.timesheetId, g); groups.push(g); }
      g.rows.push(r);
      g.amount += r.amount;
      if (r.recognised !== null) g.recognised = (g.recognised ?? 0) + r.recognised;
    } else {
      groups.push({ key: r.id, kind: 'single', person: null, month: null, date: r.date, rows: [r], amount: r.amount, recognised: r.recognised });
    }
  }
  return groups.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? (a.person ?? '').localeCompare(b.person ?? '', 'hr') : a.kind === 'personnel' ? -1 : 1));
}

/** Zadano razdoblje novog zahtjeva: najranije završeno razdoblje bez zahtjeva; ako nijedno nije završilo, najranije slobodno. */
export function defaultPeriod(free: { number: number; endDate: string }[], today: string): number | null {
  const sorted = [...free].sort((a, b) => a.number - b.number);
  return (sorted.find((r) => r.endDate < today) ?? sorted[0])?.number ?? null;
}

/** Današnji datum (GGGG-MM-DD) u lokalnoj zoni preglednika. */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
