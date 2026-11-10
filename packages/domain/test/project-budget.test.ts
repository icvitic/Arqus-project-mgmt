import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { budgetLineIssues, computeProjectBudget } from '../src/budget.js';
import { monthEndDate, riskLevel } from '../src/project.js';
import type { ProgrammePackage } from '../src/programme-package.js';

const here = dirname(fileURLToPath(import.meta.url));
const he = JSON.parse(readFileSync(join(here, '..', '..', '..', 'docs', 'domena', 'paketi', 'horizon-europe-2021-2027.v1.json'), 'utf-8')) as ProgrammePackage;

describe('proračun projekta (HE)', () => {
  const partners = [{ id: 'p1', beneficiaryType: 'nonProfit', name: 'Fakultet' }, { id: 'p2', beneficiaryType: 'default', name: 'MSP' }];
  it('zbraja retke po kategoriji (više radnih paketa) i primjenjuje stope po partneru', () => {
    const r = computeProjectBudget(he, 'IA', partners, [
      { partnerId: 'p1', categoryCode: 'A.1', amount: 20_000_000, workPackageId: 'wp1' },
      { partnerId: 'p1', categoryCode: 'A.1', amount: 10_000_000, workPackageId: 'wp2' },
      { partnerId: 'p1', categoryCode: 'B', amount: 5_000_000 },
      { partnerId: 'p2', categoryCode: 'C.3', amount: 4_000_000 },
    ]);
    expect(r.partners[0]).toMatchObject({ partnerId: 'p1', directTotal: 35_000_000, total: 42_500_000, ratePercent: 100, requested: 42_500_000 });
    expect(r.partners[1]).toMatchObject({ partnerId: 'p2', total: 5_000_000, ratePercent: 70, requested: 3_500_000 });
    expect(r.totals).toEqual({ direct: 39_000_000, indirect: 8_500_000, total: 47_500_000, requested: 46_000_000 });
  });
  it('partner bez redaka ima nulu; nepoznati partner baca grešku', () => {
    expect(computeProjectBudget(he, 'RIA', partners, []).totals.total).toBe(0);
    expect(() => computeProjectBudget(he, 'RIA', partners, [{ partnerId: 'x', categoryCode: 'B', amount: 1 }])).toThrow(/nije na projektu/);
  });
  it('budgetLineIssues odbija nadređenu kategoriju, neizravne, nepoznatog partnera i decimale', () => {
    const issues = budgetLineIssues(he, [
      { partnerId: 'p1', categoryCode: 'A', amount: 1 },
      { partnerId: 'p1', categoryCode: 'E', amount: 1 },
      { partnerId: 'zz', categoryCode: 'B', amount: 1 },
      { partnerId: 'p1', categoryCode: 'B', amount: 1.5 },
      { partnerId: 'p1', categoryCode: 'C.1', amount: 100 },
    ], new Set(['p1', 'p2']));
    expect(issues).toHaveLength(4);
    expect(issues[0]).toMatch(/"A"/);
  });
});

describe('rokovi i rizici', () => {
  it('mjesec M = zadnji dan M-tog mjeseca', () => {
    expect(monthEndDate('2027-01-01', 1)).toBe('2027-01-31');
    expect(monthEndDate('2027-01-01', 18)).toBe('2028-06-30');
    expect(monthEndDate('2027-03-15', 1)).toBe('2027-04-14');
  });
  it('razina rizika', () => {
    expect(riskLevel(3, 2)).toEqual({ score: 6, level: 'high' });
    expect(riskLevel(1, 3).level).toBe('medium');
    expect(riskLevel(1, 2).level).toBe('low');
  });
});
