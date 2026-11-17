import type { ProgrammePackage } from './programme-package.js';
import { flattenCategories } from './programme-package.js';
import { computePartnerBudget, type PartnerBudgetResult } from './budget.js';

/**
 * M7 Financije – pravila zahtjeva za nadoknadu (ZNS, WP1.16a). Čiste funkcije: popis za provjeru prije predaje,
 * odluka po trošku i izračun priznatog iznosa. Iznosi u centima, datumi ISO (GGGG-MM-DD).
 *
 * Definicije (`docs/domena/zns-pravila.md`):
 * - ostvareno = trošak prije odluke s traženim iznosom, nakon odluke s priznatim; odbijen = 0
 * - priznato = zbroj priznatih iznosa (→ neizravni po pravilu paketa → stopa financiranja)
 * - nepriznato = razlika traženog i priznatog (s neizravnima)
 */

/** Najmanja duljina obrazloženja (razlog rane predaje, razlog umanjenja, napomena uz razliku). */
export const MIN_REASON_LENGTH = 5;
const hasText = (s: string | null | undefined): boolean => (s ?? '').trim().length >= MIN_REASON_LENGTH;

/* ---------- ostvareno / priznato / nepriznato ---------- */

export type ExpenseDecisionStatus = 'accepted' | 'partially_accepted' | 'rejected';
export const DECIDED_EXPENSE_STATUSES: readonly ExpenseDecisionStatus[] = ['accepted', 'partially_accepted', 'rejected'];

/** Iznos koji se računa kao ostvaren: priznati nakon odluke (odbijen = 0), inače traženi. */
export const effectiveAmount = (e: { amount: number; recognised?: number | null }): number => e.recognised ?? e.amount;

export interface MoneyTotals { direct: number; indirect: number; total: number; requested: number }
const totalsOf = (r: PartnerBudgetResult): MoneyTotals => ({ direct: r.directTotal, indirect: r.indirectTotal, total: r.total, requested: r.requested });
export const diffTotals = (a: MoneyTotals, b: MoneyTotals): MoneyTotals => ({ direct: a.direct - b.direct, indirect: a.indirect - b.indirect, total: a.total - b.total, requested: a.requested - b.requested });

export interface ClaimLine { categoryCode: string; amount: number; recognised?: number | null }

const linesOf = (rows: { categoryCode: string; value: number }[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.categoryCode] = (out[r.categoryCode] ?? 0) + r.value;
  return out;
};

/**
 * Traženo i priznato za jedan zahtjev istim izračunom kao proračun (izravni → neizravni po paketu → stopa financiranja).
 * Nepriznato = traženo − priznato (neizravni se ne zaokružuju zasebno po trošku, nego iz zbroja – kao i u zahtjevu).
 */
export function claimTotals(pkg: ProgrammePackage, actionCode: string, beneficiaryType: string, rows: ClaimLine[]) {
  const claimed = computePartnerBudget(pkg, actionCode, linesOf(rows.map((r) => ({ categoryCode: r.categoryCode, value: r.amount }))), beneficiaryType);
  const recognised = computePartnerBudget(pkg, actionCode, linesOf(rows.map((r) => ({ categoryCode: r.categoryCode, value: effectiveAmount(r) }))), beneficiaryType);
  return { claimed, recognised, unrecognised: diffTotals(totalsOf(claimed), totalsOf(recognised)) };
}

/* ---------- popis za provjeru prije predaje ---------- */

export type ChecklistKey = 'period_ended' | 'has_expenses' | 'timesheets_approved' | 'evidence' | 'dates_in_period' | 'earlier_periods' | 'budget';
export interface ChecklistItem {
  key: ChecklistKey;
  ok: boolean;
  /** `blocking` – predaja nije moguća dok se ne riješi; `warning` – prikazuje se i sprema uz predaju. */
  severity: 'blocking' | 'warning';
  title: string;
  details: string[];
  /** Kako korisnik može riješiti stavku pri predaji: obrazloženjem rane predaje, potvrdom troškova bez dokaza ili odabirom troškova iz ranijih razdoblja. */
  resolution?: 'early_reason' | 'acknowledge' | 'select_earlier';
  /** Za `acknowledge`: troškovi koje treba potvrditi. */
  expenseIds?: string[];
}

export interface ChecklistExpense { id: string; date: string; description: string; amount: number; categoryCode: string; source: 'manual' | 'timesheet' | string; documents: number }
/** Nepredan trošak iz ranijeg razdoblja (WP1.16b): datiran u razdoblju čiji je ZNS već predan. */
export interface ChecklistEarlierExpense { date: string; description: string; amount: number; period: number }
export interface ChecklistTimesheet { memberName: string; month: string; status: string; minutes: number }
export interface ChecklistBudgetRow { categoryCode: string; name?: string; planned: number; claimedBefore: number }

export interface ClaimChecklistInput {
  today: string;
  period: { startDate: string; endDate: string };
  expenses: ChecklistExpense[];
  /** Timesheetovi članova tima partnera za mjesece unutar razdoblja. */
  timesheets: ChecklistTimesheet[];
  /** Ugovoreno po kategoriji i već zatraženo/priznato u ranijim zahtjevima istog partnera (ostvareno). */
  budget: ChecklistBudgetRow[];
  earlyReason?: string | null;
  acknowledgedWithoutEvidence?: readonly string[];
  /**
   * WP1.16b – troškovi iz ranijih razdoblja koje je priprematelj izričito uključio (datirani prije početka razdoblja).
   * Ulaze u broj troškova, provjeru dokaza i proračun; provjera „unutar razdoblja” vrijedi samo za ostale troškove.
   */
  earlier?: ChecklistExpense[];
  /** Nepredani troškovi iz ranijih razdoblja koji NISU uključeni – upozorenje da se ne zaborave. */
  earlierNotSelected?: ChecklistEarlierExpense[];
}

export interface ClaimChecklist { items: ChecklistItem[]; canSubmit: boolean; early: boolean; blocking: ChecklistItem[]; warnings: ChecklistItem[] }

const eurText = (cents: number): string => `${(cents / 100).toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
const hrDate = (iso: string): string => `${iso.slice(8, 10)}. ${iso.slice(5, 7)}. ${iso.slice(0, 4)}.`;
/** Hrvatska množina: 1 trošak, 2–4 troška, 5+ (i 11–14) troškova. */
const pl = (n: number, one: string, few: string, many: string): string => { const d = n % 10, h = n % 100; return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many; };
const TS_STATUS: Record<string, string> = { draft: 'nacrt', submitted: 'čeka odobrenje' };

/** Mjeseci (GGGG-MM) koje razdoblje obuhvaća barem jednim danom. */
export function monthsInPeriod(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let [y, m] = startDate.slice(0, 7).split('-').map(Number) as [number, number];
  const end = endDate.slice(0, 7);
  for (let i = 0; i < 1200; i++) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    if (ym > end) break;
    out.push(ym);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * Popis za provjeru prije predaje ZNS-a. Blokirajuće stavke sprječavaju predaju (osim onih koje korisnik riješi
 * obrazloženjem rane predaje ili potvrdom troškova bez dokaza); upozorenja se prikazuju i spremaju uz predaju.
 * Razdoblje je završilo tek kad je datum kraja prošao (na sam zadnji dan razdoblja predaja je rana).
 */
export function claimChecklist(input: ClaimChecklistInput): ClaimChecklist {
  const { today, period } = input;
  const items: ChecklistItem[] = [];
  const ended = today > period.endDate;
  const early = !ended;
  if (ended) items.push({ key: 'period_ended', ok: true, severity: 'blocking', title: `Razdoblje je završilo ${hrDate(period.endDate)}`, details: [] });
  else if (hasText(input.earlyReason)) items.push({ key: 'period_ended', ok: true, severity: 'warning', title: 'Rana predaja – razdoblje još traje', details: [`Razdoblje završava ${hrDate(period.endDate)}.`, `Razlog: ${input.earlyReason!.trim()}`], resolution: 'early_reason' });
  else items.push({ key: 'period_ended', ok: false, severity: 'blocking', title: `Razdoblje još traje (do ${hrDate(period.endDate)})`, details: ['Predaja je moguća nakon kraja razdoblja ili ranije uz upisan razlog rane predaje.'], resolution: 'early_reason' });

  const earlier = input.earlier ?? [];
  const all = [...input.expenses, ...earlier];
  items.push(all.length
    ? { key: 'has_expenses', ok: true, severity: 'blocking', title: `${all.length} ${pl(all.length, 'trošak', 'troška', 'troškova')} u zahtjevu${earlier.length ? ` (od toga ${earlier.length} iz ranijih razdoblja)` : ''}`, details: [] }
    : { key: 'has_expenses', ok: false, severity: 'blocking', title: 'Nema troškova u razdoblju', details: [] });

  const open = input.timesheets.filter((t) => (t.status === 'draft' || t.status === 'submitted') && t.minutes > 0)
    .sort((a, b) => a.month.localeCompare(b.month) || a.memberName.localeCompare(b.memberName, 'hr'));
  items.push(open.length
    ? { key: 'timesheets_approved', ok: false, severity: 'blocking', title: `${open.length} ${pl(open.length, 'timesheet nije odobren', 'timesheeta nisu odobrena', 'timesheetova nije odobreno')} – trošak osoblja nedostaje`, details: open.map((t) => `${t.memberName}, ${t.month} (${TS_STATUS[t.status] ?? t.status}, ${(t.minutes / 60).toLocaleString('hr-HR', { maximumFractionDigits: 1 })} h)`) }
    : { key: 'timesheets_approved', ok: true, severity: 'blocking', title: 'Svi timesheetovi u razdoblju su odobreni', details: [] });

  const missing = all.filter((e) => e.source === 'manual' && !e.documents);
  const ack = new Set(input.acknowledgedWithoutEvidence ?? []);
  const unack = missing.filter((e) => !ack.has(e.id));
  const missingDetails = missing.map((e) => `${hrDate(e.date)} ${e.description} (${eurText(e.amount)})`);
  if (!missing.length) items.push({ key: 'evidence', ok: true, severity: 'blocking', title: 'Svi ručno uneseni troškovi imaju dokaz', details: [] });
  else if (!unack.length) items.push({ key: 'evidence', ok: true, severity: 'warning', title: `${missing.length} ${pl(missing.length, 'trošak', 'troška', 'troškova')} bez dokaza – potvrđeno pri predaji`, details: missingDetails, resolution: 'acknowledge', expenseIds: missing.map((e) => e.id) });
  else items.push({ key: 'evidence', ok: false, severity: 'blocking', title: `${missing.length} ${pl(missing.length, 'ručno uneseni trošak nema', 'ručno unesena troška nemaju', 'ručno unesenih troškova nema')} dokaz`, details: missingDetails, resolution: 'acknowledge', expenseIds: missing.map((e) => e.id) });

  const outside = input.expenses.filter((e) => e.date < period.startDate || e.date > period.endDate);
  items.push(outside.length
    ? { key: 'dates_in_period', ok: false, severity: 'blocking', title: `${outside.length} ${pl(outside.length, 'trošak', 'troška', 'troškova')} izvan razdoblja`, details: outside.map((e) => `${hrDate(e.date)} ${e.description}`) }
    : { key: 'dates_in_period', ok: true, severity: 'blocking', title: earlier.length ? 'Svi ostali troškovi su unutar razdoblja' : 'Svi troškovi su unutar razdoblja', details: [] });

  // Troškovi iz ranijih razdoblja (WP1.16b): uključeni samo izričitim odabirom; neuključeni se navode da se ne zaborave.
  const notSelected = input.earlierNotSelected ?? [];
  if (earlier.length || notSelected.length) {
    const parts: string[] = [];
    if (earlier.length) parts.push(`${earlier.length} ${pl(earlier.length, 'trošak', 'troška', 'troškova')} iz ranijih razdoblja ${pl(earlier.length, 'uključen', 'uključena', 'uključeno')} izričitim odabirom`);
    if (notSelected.length) parts.push(`${notSelected.length} ${pl(notSelected.length, 'nepredan trošak', 'nepredana troška', 'nepredanih troškova')} iz ranijih razdoblja nije ${pl(notSelected.length, 'uključen', 'uključena', 'uključeno')}`);
    items.push({
      key: 'earlier_periods', ok: notSelected.length === 0, severity: 'warning', title: parts.join('; '), resolution: 'select_earlier',
      details: [
        ...earlier.map((e) => `uključeno: ${hrDate(e.date)} ${e.description} (${eurText(e.amount)})`),
        ...notSelected.map((e) => `nije uključeno: ${hrDate(e.date)} ${e.description} (${eurText(e.amount)}, RP${e.period})`),
      ],
    });
  }

  const now = new Map<string, number>();
  for (const e of all) now.set(e.categoryCode, (now.get(e.categoryCode) ?? 0) + e.amount);
  const budgetByCode = new Map(input.budget.map((b) => [b.categoryCode, b]));
  const over: string[] = [];
  for (const code of [...new Set([...budgetByCode.keys(), ...now.keys()])].sort()) {
    const b = budgetByCode.get(code);
    const planned = b?.planned ?? 0; const cumulative = (b?.claimedBefore ?? 0) + (now.get(code) ?? 0);
    if ((now.get(code) ?? 0) > 0 && cumulative > planned) {
      over.push(`${code}${b?.name ? ` ${b.name}` : ''}: ukupno ${eurText(cumulative)} uz ugovoreno ${eurText(planned)} (prekoračenje ${eurText(cumulative - planned)})`);
    }
  }
  items.push(over.length
    ? { key: 'budget', ok: false, severity: 'warning', title: `${over.length} ${pl(over.length, 'kategorija prelazi', 'kategorije prelaze', 'kategorija prelazi')} ugovoreni proračun (kumulativno)`, details: over }
    : { key: 'budget', ok: true, severity: 'warning', title: 'Kumulativno traženo je unutar proračuna po kategorijama', details: [] });

  const blocking = items.filter((i) => !i.ok && i.severity === 'blocking');
  const warnings = items.filter((i) => i.severity === 'warning' && (!i.ok || i.resolution));
  return { items, canSubmit: blocking.length === 0, early, blocking, warnings };
}

/* ---------- odluka po trošku ---------- */

export interface DecisionExpense { id: string; categoryCode: string; amount: number }
export interface ExpenseDecisionInput { id: string; recognised: number; reason?: string | null }
export interface ClaimDecisionInput {
  expenses: DecisionExpense[];
  /** Odluke po trošku; trošak koji nije naveden priznaje se u cijelosti. */
  decisions: ExpenseDecisionInput[];
  /** Traženi iznos predanog zahtjeva (snimljen pri predaji). */
  requested: number;
  /** Ukupni iznos iz odluke financijera (neobavezno); ako se razlikuje od izračunatog, traži se napomena. */
  funderTotal?: number | null;
  note?: string | null;
}
export interface ExpenseDecision { id: string; amount: number; recognised: number; status: ExpenseDecisionStatus; reason: string | null }
export type ClaimOutcome = 'approved' | 'partially_approved' | 'rejected';
export interface ClaimDecisionResult {
  expenses: ExpenseDecision[];
  claimed: MoneyTotals;
  recognised: MoneyTotals;
  unrecognised: MoneyTotals;
  ratePercent: number;
  /** Izračunati priznati iznos (doprinos) – isti izračun kao traženi iznos zahtjeva. */
  computed: number;
  funderTotal: number | null;
  /** Odobreni iznos: iznos financijera ako je upisan, inače izračunati. */
  approved: number;
  /** Iznos financijera − izračunati (0 bez iznosa financijera). */
  difference: number;
  outcome: ClaimOutcome;
  errors: string[];
}

export const expenseDecisionStatus = (amount: number, recognised: number): ExpenseDecisionStatus =>
  recognised >= amount ? 'accepted' : recognised <= 0 ? 'rejected' : 'partially_accepted';

/**
 * Odluka o ZNS-u po trošku: priznati iznos (zadano cijeli), razlog kod umanjenja ili odbijanja, priznati ukupni iznos
 * istim izračunom kao zahtjev, usporedba s iznosom financijera i ishod (odobren / djelomično odobren / odbijen).
 */
export function claimDecision(pkg: ProgrammePackage, actionCode: string, beneficiaryType: string, input: ClaimDecisionInput): ClaimDecisionResult {
  const errors: string[] = [];
  const byId = new Map(input.expenses.map((e) => [e.id, e]));
  const given = new Map<string, ExpenseDecisionInput>();
  for (const d of input.decisions) {
    const e = byId.get(d.id);
    if (!e) { errors.push(`trošak ${d.id} nije u zahtjevu`); continue; }
    if (given.has(d.id)) { errors.push(`trošak ${d.id} je naveden više puta`); continue; }
    if (!Number.isInteger(d.recognised) || d.recognised < 0) errors.push(`trošak ${d.id}: priznati iznos mora biti nenegativan cijeli broj centi`);
    else if (d.recognised > e.amount) errors.push(`trošak ${d.id}: priznati iznos (${eurText(d.recognised)}) veći je od traženog (${eurText(e.amount)})`);
    else if (d.recognised < e.amount && !hasText(d.reason)) errors.push(`trošak ${d.id}: razlog je obavezan kad se trošak umanjuje ili odbija`);
    given.set(d.id, d);
  }
  const decided: ExpenseDecision[] = input.expenses.map((e) => {
    const d = given.get(e.id);
    const recognised = d && Number.isInteger(d.recognised) ? Math.max(0, Math.min(d.recognised, e.amount)) : e.amount;
    return { id: e.id, amount: e.amount, recognised, status: expenseDecisionStatus(e.amount, recognised), reason: recognised < e.amount ? (d?.reason ?? '').trim() || null : null };
  });
  const t = claimTotals(pkg, actionCode, beneficiaryType, decided.map((d) => ({ categoryCode: byId.get(d.id)!.categoryCode, amount: d.amount, recognised: d.recognised })));
  const computed = t.recognised.requested;
  const funderTotal = input.funderTotal ?? null;
  if (funderTotal !== null && (!Number.isInteger(funderTotal) || funderTotal < 0)) errors.push('iznos iz odluke mora biti nenegativan cijeli broj centi');
  const approved = funderTotal ?? computed;
  const difference = funderTotal === null ? 0 : funderTotal - computed;
  if (difference !== 0 && !hasText(input.note)) errors.push(`iznos iz odluke (${eurText(approved)}) razlikuje se od izračunatog priznatog iznosa (${eurText(computed)}) za ${eurText(difference)} – upiši napomenu`);
  const allFull = decided.every((d) => d.status === 'accepted');
  const outcome: ClaimOutcome = approved <= 0 ? 'rejected' : allFull && approved >= input.requested ? 'approved' : 'partially_approved';
  return {
    expenses: decided, claimed: totalsOf(t.claimed), recognised: totalsOf(t.recognised), unrecognised: t.unrecognised, ratePercent: t.recognised.ratePercent,
    computed, funderTotal, approved, difference, outcome, errors,
  };
}

/* ---------- isplata ---------- */

/** Provjera isplate: datum ne prije odluke i ne u budućnosti; razlika prema odobrenom traži napomenu. */
export function paymentIssues(input: { paidAt: string; paidAmount: number; decisionDate: string | null; approved: number | null; today: string; note?: string | null }): string[] {
  const issues: string[] = [];
  if (!Number.isInteger(input.paidAmount) || input.paidAmount < 0) issues.push('isplaćeni iznos mora biti nenegativan cijeli broj centi');
  if (input.decisionDate && input.paidAt < input.decisionDate) issues.push(`datum isplate (${hrDate(input.paidAt)}) je prije datuma odluke (${hrDate(input.decisionDate)})`);
  if (input.paidAt > input.today) issues.push(`datum isplate (${hrDate(input.paidAt)}) je u budućnosti`);
  const diff = input.paidAmount - (input.approved ?? 0);
  if (diff !== 0 && !hasText(input.note)) issues.push(`isplaćeno (${eurText(input.paidAmount)}) razlikuje se od odobrenog (${eurText(input.approved ?? 0)}) za ${eurText(diff)} – upiši napomenu`);
  return issues;
}

/** Naziv kategorije iz paketa (za popis provjere). */
export function categoryNames(pkg: ProgrammePackage): Map<string, string> {
  return new Map(flattenCategories(pkg.costCategories).map((c) => [c.code, c.name]));
}
