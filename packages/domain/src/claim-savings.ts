import { daysBetween } from './portfolio.js';

/**
 * M7 Financije – mjerenje pripreme ZNS-a (WP1.16b). Čiste funkcije, bez baze.
 *
 * Sustav mjeri proteklo vrijeme i aktivnost, ne sate rada. Zato su mjere dvije vrste (`docs/domena/zns-pravila.md`):
 * - **automatske** (iz vremenskih oznaka i revizijskog zapisa, bez unosa): dani od kraja razdoblja do predaje, dani od
 *   otvaranja nacrta do predaje, broj povrata na dopunu, broj troškova, dokaza i timesheetova u zahtjevu;
 * - **prijavljene**: sati utrošeni na pripremu (neobavezan unos pri predaji) uz polaznu mjeru institucije
 *   „sati po ZNS-u prije ArQusa”. Ušteda = (polazna mjera − prosjek prijavljenih sati) / polazna mjera.
 */

/** Cilj iz uvjeta za fazu 2: ušteda ≥ 30 % vremena pripreme ZNS-a. */
export const SAVING_TARGET_PERCENT = 30;

export interface PreparationInput {
  /** Zadnji dan izvještajnog razdoblja (GGGG-MM-DD). */
  periodEnd: string;
  /** Otvaranje nacrta zahtjeva (ISO datum ili vrijeme). */
  openedAt: string;
  /** (Zadnja) predaja zahtjeva (ISO datum ili vrijeme). */
  submittedAt: string;
  returns: number;
  expenses: number;
  evidenceFiles: number;
  timesheets: number;
  earlierExpenses?: number;
}

export interface PreparationMeasures {
  /** Dani od kraja razdoblja do predaje (negativno = predan prije kraja razdoblja). */
  daysAfterPeriodEnd: number;
  /** Dani od otvaranja nacrta do (zadnje) predaje; isti dan = 0. */
  daysInPreparation: number;
  /** Broj povrata na dopunu. */
  returns: number;
  expenses: number;
  evidenceFiles: number;
  timesheets: number;
  earlierExpenses: number;
}

/** Automatske mjere jednog predanog zahtjeva. Datumi se uspoređuju kao kalendarski dani (UTC). */
export function preparationMeasures(i: PreparationInput): PreparationMeasures {
  const submitted = i.submittedAt.slice(0, 10);
  return {
    daysAfterPeriodEnd: daysBetween(i.periodEnd.slice(0, 10), submitted),
    daysInPreparation: Math.max(0, daysBetween(i.openedAt.slice(0, 10), submitted)),
    returns: i.returns, expenses: i.expenses, evidenceFiles: i.evidenceFiles, timesheets: i.timesheets, earlierExpenses: i.earlierExpenses ?? 0,
  };
}

export interface SavingsClaim {
  measures: PreparationMeasures;
  /** Prijavljeno vrijeme pripreme u minutama; null = nije upisano. */
  reportedMinutes: number | null;
}

export interface ClaimSavings {
  /** `ok` – postoji polazna mjera i barem jedan zahtjev s prijavljenim satima. */
  status: 'ok' | 'no_baseline' | 'no_reports';
  /** Što treba upisati da izvještaj pokaže uštedu. */
  missing: ('baseline' | 'hours')[];
  baselineHours: number | null;
  /** Predani zahtjevi (svi statusi osim nacrta). */
  submittedClaims: number;
  /** Predani zahtjevi s upisanim satima pripreme – osnova izračuna. */
  reportedClaims: number;
  averageHours: number | null;
  /** Polazna mjera − prosjek (sati po zahtjevu); negativno = priprema traje dulje nego prije. */
  savingHours: number | null;
  /** Ušteda u postocima (jedna decimala); negativno = priprema traje dulje nego prije. */
  savingPercent: number | null;
  targetPercent: number;
  meetsTarget: boolean | null;
  /** Automatske mjere (svi predani zahtjevi) kao popratne brojke. */
  automatic: {
    claims: number;
    averageDaysAfterPeriodEnd: number;
    averageDaysInPreparation: number;
    returns: number;
    claimsReturned: number;
    averageExpenses: number;
    averageEvidenceFiles: number;
    averageTimesheets: number;
  } | null;
}

const round = (n: number, d: number): number => { const f = 10 ** d; return Math.round(n * f) / f; };
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);

/**
 * Ušteda na pripremi ZNS-a: prosjek prijavljenih sati po zahtjevu prema polaznoj mjeri institucije.
 * Polazna mjera mora biti veća od 0 (inače se smatra neupisanom). Zahtjev s prijavljenih 0 sati ulazi u prosjek.
 */
export function claimSavings(baselineHours: number | null | undefined, claims: SavingsClaim[]): ClaimSavings {
  const baseline = typeof baselineHours === 'number' && Number.isFinite(baselineHours) && baselineHours > 0 ? baselineHours : null;
  const reported = claims.filter((c) => typeof c.reportedMinutes === 'number' && Number.isFinite(c.reportedMinutes) && c.reportedMinutes >= 0);
  const missing: ClaimSavings['missing'] = [];
  if (baseline === null) missing.push('baseline');
  if (!reported.length) missing.push('hours');
  const averageHours = reported.length ? round(avg(reported.map((c) => c.reportedMinutes! / 60)), 2) : null;
  const ok = baseline !== null && averageHours !== null;
  const savingHours = ok ? round(baseline - averageHours, 2) : null;
  const savingPercent = ok ? round(((baseline - averageHours) / baseline) * 100, 1) : null;
  const m = claims.map((c) => c.measures);
  return {
    status: ok ? 'ok' : baseline === null ? 'no_baseline' : 'no_reports',
    missing,
    baselineHours: baseline,
    submittedClaims: claims.length,
    reportedClaims: reported.length,
    averageHours,
    savingHours,
    savingPercent,
    targetPercent: SAVING_TARGET_PERCENT,
    meetsTarget: savingPercent === null ? null : savingPercent >= SAVING_TARGET_PERCENT,
    automatic: m.length ? {
      claims: m.length,
      averageDaysAfterPeriodEnd: round(avg(m.map((x) => x.daysAfterPeriodEnd)), 1),
      averageDaysInPreparation: round(avg(m.map((x) => x.daysInPreparation)), 1),
      returns: m.reduce((a, x) => a + x.returns, 0),
      claimsReturned: m.filter((x) => x.returns > 0).length,
      averageExpenses: round(avg(m.map((x) => x.expenses)), 1),
      averageEvidenceFiles: round(avg(m.map((x) => x.evidenceFiles)), 1),
      averageTimesheets: round(avg(m.map((x) => x.timesheets)), 1),
    } : null,
  };
}

/** Sati (do dvije decimale) → minute za pohranu; null/undefined ostaje null. Baca grešku za negativne ili nebrojčane vrijednosti. */
export function hoursToMinutes(hours: number | null | undefined): number | null {
  if (hours === null || hours === undefined) return null;
  if (!Number.isFinite(hours) || hours < 0) throw new Error('Sati moraju biti nenegativan broj');
  return Math.round(hours * 60);
}
