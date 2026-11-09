import { describe, it, expect } from 'vitest';
import { addMonths, addDays, generateReportingPeriods, transitionIssues } from '../src/project.js';

describe('datumi', () => {
  it('addMonths ograničava dan na kraj mjeseca, addDays prelazi godine', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2027-11-15', 3)).toBe('2028-02-15');
    expect(addDays('2029-12-31', 60)).toBe('2030-03-01');
  });
});

describe('izvještajna razdoblja', () => {
  it('HE: 36 mj., razdoblja od 18 mj., rok 60 dana', () => {
    expect(generateReportingPeriods('2027-01-01', 36, 18, 60)).toEqual([
      { number: 1, startDate: '2027-01-01', endDate: '2028-06-30', dueDate: '2028-08-29' },
      { number: 2, startDate: '2028-07-01', endDate: '2029-12-31', dueDate: '2030-03-01' },
    ]);
  });
  it('NPOO: 7 mj., tromjesečja, zadnje razdoblje skraćeno', () => {
    const p = generateReportingPeriods('2027-01-01', 7, 3, 30);
    expect(p.map((x) => [x.startDate, x.endDate])).toEqual([['2027-01-01', '2027-03-31'], ['2027-04-01', '2027-06-30'], ['2027-07-01', '2027-07-31']]);
    expect(p[2]!.dueDate).toBe('2027-08-30');
  });
  it('početak usred mjeseca', () => {
    const p = generateReportingPeriods('2027-03-15', 12, 6, 30);
    expect(p.map((x) => x.endDate)).toEqual(['2027-09-14', '2028-03-14']);
  });
});

describe('prijelazi statusa projekta', () => {
  const ok = { contractNo: '101234567', startDate: '2027-01-01', durationMonths: 36, packageStatus: 'published', partnerCount: 2 };
  it('aktivacija uz sve preduvjete je dopuštena', () => { expect(transitionIssues('contracting', 'active', ok)).toEqual([]); });
  it('aktivacija bez ugovora i s neobjavljenim paketom vraća razloge', () => {
    const r = transitionIssues('contracting', 'active', { ...ok, contractNo: '', packageStatus: 'draft' });
    expect(r).toHaveLength(2);
    expect(r.join(' ')).toMatch(/broj ugovora/);
    expect(r.join(' ')).toMatch(/nije objavljen/);
  });
  it('nedopušteni prijelazi', () => {
    expect(transitionIssues('active', 'closed', ok)[0]).toMatch(/nije dopušten/);
    expect(transitionIssues('archived', 'active', ok)).toHaveLength(1);
    expect(transitionIssues('suspended', 'active', ok)).toEqual([]);
  });
});
