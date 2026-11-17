import { describe, it, expect } from 'vitest';
import { claimSavings, hoursToMinutes, preparationMeasures, SAVING_TARGET_PERCENT, type SavingsClaim } from '../src/claim-savings.js';

const measures = (over: Partial<Parameters<typeof preparationMeasures>[0]> = {}) => preparationMeasures({
  periodEnd: '2027-06-30', openedAt: '2027-07-02T08:00:00Z', submittedAt: '2027-07-12T15:30:00Z', returns: 0, expenses: 10, evidenceFiles: 6, timesheets: 4, ...over,
});
const claim = (reportedMinutes: number | null, over: Partial<Parameters<typeof preparationMeasures>[0]> = {}): SavingsClaim => ({ measures: measures(over), reportedMinutes });

describe('automatske mjere pripreme ZNS-a', () => {
  it('dani od kraja razdoblja i od otvaranja nacrta do predaje (kalendarski dani)', () => {
    expect(measures()).toEqual({ daysAfterPeriodEnd: 12, daysInPreparation: 10, returns: 0, expenses: 10, evidenceFiles: 6, timesheets: 4, earlierExpenses: 0 });
  });
  it('rana predaja daje negativan broj dana; nacrt otvoren i predan isti dan = 0', () => {
    const m = measures({ openedAt: '2027-06-20T09:00:00Z', submittedAt: '2027-06-20T17:00:00Z' });
    expect(m.daysAfterPeriodEnd).toBe(-10); expect(m.daysInPreparation).toBe(0);
  });
});

describe('ušteda na ZNS-u', () => {
  it('bez polazne mjere: objašnjava što nedostaje, bez postotka', () => {
    const s = claimSavings(null, [claim(600)]);
    expect(s).toMatchObject({ status: 'no_baseline', missing: ['baseline'], savingPercent: null, meetsTarget: null, reportedClaims: 1, averageHours: 10 });
    expect(claimSavings(0, [claim(600)]).status).toBe('no_baseline');
    expect(claimSavings(Number.NaN, [claim(600)]).missing).toEqual(['baseline']);
  });
  it('bez prijavljenih sati: status no_reports, automatske mjere i dalje postoje', () => {
    const s = claimSavings(40, [claim(null), claim(null, { returns: 1 })]);
    expect(s).toMatchObject({ status: 'no_reports', missing: ['hours'], submittedClaims: 2, reportedClaims: 0, averageHours: null, savingPercent: null });
    expect(s.automatic).toMatchObject({ claims: 2, returns: 1, claimsReturned: 1, averageDaysAfterPeriodEnd: 12 });
  });
  it('bez ičega: oba nedostaju, bez automatskih mjera', () => {
    expect(claimSavings(undefined, [])).toMatchObject({ status: 'no_baseline', missing: ['baseline', 'hours'], submittedClaims: 0, automatic: null });
  });
  it('prosjek prijavljenih sati prema polaznoj mjeri; zahtjevi bez unosa ne ulaze u prosjek', () => {
    const s = claimSavings(40, [claim(24 * 60), claim(30 * 60), claim(null)]);
    expect(s).toMatchObject({ status: 'ok', missing: [], reportedClaims: 2, submittedClaims: 3, averageHours: 27, savingHours: 13, savingPercent: 32.5, meetsTarget: true, targetPercent: SAVING_TARGET_PERCENT });
  });
  it('nula prijavljenih sati je valjan unos (100 % uštede)', () => {
    expect(claimSavings(12, [claim(0)])).toMatchObject({ status: 'ok', averageHours: 0, savingPercent: 100, meetsTarget: true });
  });
  it('negativna ušteda kad priprema traje dulje nego prije', () => {
    expect(claimSavings(10, [claim(13 * 60)])).toMatchObject({ savingHours: -3, savingPercent: -30, meetsTarget: false });
  });
  it('ispod cilja od 30 %', () => {
    expect(claimSavings(40, [claim(30 * 60)])).toMatchObject({ savingPercent: 25, meetsTarget: false });
  });
  it('sati u minute', () => {
    expect(hoursToMinutes(7.5)).toBe(450); expect(hoursToMinutes(null)).toBeNull(); expect(hoursToMinutes(0.33)).toBe(20);
    expect(() => hoursToMinutes(-1)).toThrow();
  });
});
