import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { personnelCostCents, timesheetIssues, minutesByWorkPackage, daysInMonth } from '../src/finance.js';
import { validateProgrammePackage } from '../src/validate.js';
import type { ProgrammePackage } from '../src/programme-package.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (f: string) => JSON.parse(readFileSync(join(here, '..', '..', '..', 'docs', 'domena', 'paketi', f), 'utf-8')) as ProgrammePackage;
const he = load('horizon-europe-2021-2027.v1.json'); const npoo = load('npoo-2021-2026.v1.json');

describe('trošak osoblja iz timesheeta', () => {
  it('HE dnevnica: 60.200 €/god. ÷ 215 dana = 280 €/dan; 16 h = 2 dana = 560 €', () => {
    expect(personnelCostCents(he, 6_020_000, 16 * 60)).toBe(56_000);
  });
  it('NPOO satnica: 34.400 €/god. ÷ 1720 h = 20 €/h; 7 h 30 min = 150 €', () => {
    expect(personnelCostCents(npoo, 3_440_000, 450)).toBe(15_000);
  });
  it('bez pravila ili s nepodržanom metodom baca grešku', () => {
    expect(() => personnelCostCents({ ...he, personnelRule: undefined }, 100, 60)).toThrow(/nema pravilo/);
    expect(() => personnelCostCents({ ...he, personnelRule: { method: 'unitCost', divisor: 1 } }, 100, 60)).toThrow(/nije podržana/);
  });
  it('kategorija osoblja u paketima postoji i validira se', () => {
    expect(he.personnelRule?.categoryCode).toBe('A.1');
    expect(validateProgrammePackage(he).ok).toBe(true);
    const bad = validateProgrammePackage({ ...npoo, personnelRule: { ...npoo.personnelRule, categoryCode: 'NT' } });
    expect(bad.ok).toBe(false);
  });
});

describe('timesheet', () => {
  it('greške i upozorenja', () => {
    expect(daysInMonth('2027-02')).toBe(28);
    const r = timesheetIssues('2027-02', [
      { day: 1, minutes: 480 }, { day: 1, minutes: 180 }, // pon 11 h → upozorenje
      { day: 6, minutes: 120 }, // subota
      { day: 2, minutes: 1500 }, // > 24 h
      { day: 30, minutes: 60 }, // ne postoji
    ]);
    expect(r.errors).toEqual(['dan 30 ne postoji u mjesecu 2027-02', 'dan 2: više od 24 sata']);
    expect(r.warnings).toEqual(['dan 1: 11.0 h (više od 10 h)', 'dan 6: rad vikendom']);
  });
  it('minute po radnom paketu', () => {
    const m = minutesByWorkPackage([{ day: 1, minutes: 240, workPackageId: 'wp1' }, { day: 2, minutes: 120, workPackageId: 'wp1' }, { day: 2, minutes: 60 }]);
    expect(m.get('wp1')).toBe(360); expect(m.get(null)).toBe(60);
  });
});
