import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProgrammePackage } from '../src/programme-package.js';
import { evaluateRule, packageAvailabilityIssue, packageDeviations } from '../src/package-rules.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (f: string) => JSON.parse(readFileSync(join(here, '..', '..', '..', 'docs', 'domena', 'paketi', f), 'utf8')) as ProgrammePackage;
const npoo = load('npoo-2021-2026.v1.json');
const he = load('horizon-europe-2021-2027.v1.json');

describe('dostupnost paketa za novi projekt/prijavu (WP1.14b)', () => {
  it('zastario i paket koji još ne vrijedi blokiraju; istekao ne blokira', () => {
    expect(packageAvailabilityIssue(npoo, 'deprecated', '2026-01-01')).toMatch(/zastario/);
    expect(packageAvailabilityIssue({ meta: { ...npoo.meta, validFrom: '2027-01-01' } }, 'published', '2026-12-31')).toMatch(/vrijedi tek od 01\. 01\. 2027\./);
    expect(packageAvailabilityIssue({ meta: { ...npoo.meta, validFrom: '2027-01-01' } }, 'published', '2027-01-01')).toBeNull();
    expect(packageAvailabilityIssue(npoo, 'published', '2028-01-01')).toBeNull();
  });
});

describe('pravila validations', () => {
  const facts = { today: '2026-01-10', kind: 'project' as const, startDate: '2026-01-01', endDate: '2027-12-31' };
  it('datum kraja projekta (NPOO, RRF)', () => {
    expect(evaluateRule('project.endDate > 2026-06-30', npoo, facts)).toBe(true);
    expect(evaluateRule('project.endDate > 2026-06-30', npoo, { ...facts, endDate: '2026-06-30' })).toBe(false);
    expect(evaluateRule('project.endDate > 2026-06-30', npoo, { ...facts, endDate: null })).toBeNull();
    expect(evaluateRule('project.endDate > 2026-06-30', npoo, { ...facts, kind: 'proposal' })).toBeNull();
  });
  it('udio kategorije u izravnim troškovima', () => {
    const budget = [{ categoryCode: 'OS', amount: 800_000 }, { categoryCode: 'UP', amount: 200_000 }];
    expect(evaluateRule('sum(UP) > 0.10 * sum(direct)', npoo, { ...facts, budget })).toBe(true);
    expect(evaluateRule('sum(UP) > 0.10 * sum(direct)', npoo, { ...facts, budget: [{ categoryCode: 'OS', amount: 900_000 }, { categoryCode: 'UP', amount: 100_000 }] })).toBe(false);
    expect(evaluateRule('sum(UP) > 0.10 * sum(direct)', npoo, facts)).toBeNull(); // bez proračuna
    // nepoznata kategorija → nije provjerljivo
    expect(evaluateRule('sum(ZZZ) > 0', he, { ...facts, budget })).toBeNull();
  });
  it('neprovjerljiva pravila se preskaču (nikad lažno odstupanje)', () => {
    expect(evaluateRule('manualEntry(E)', he, facts)).toBeNull();
    expect(evaluateRule('personDaysPerYear(person) > 215', he, facts)).toBeNull();
    expect(evaluateRule('expense.vatIncluded && beneficiary.vatRecoverable', npoo, facts)).toBeNull();
    expect(evaluateRule('package.extends == null', npoo, facts)).toBe(true);
  });
});

describe('odstupanja od pravila programa', () => {
  it('projekt NPOO-a koji traje iza 30. 6. 2026. – pravilo programa; početak u valjanosti', () => {
    const d = packageDeviations(npoo, { today: '2026-11-17', kind: 'project', startDate: '2025-11-01', endDate: '2027-10-31', budget: [] });
    expect(d.map((x) => x.key)).toEqual(['rule:npoo-end-date']);
    expect(d[0]!.severity).toBe('error');
  });
  it('projekt koji počinje nakon isteka paketa', () => {
    const d = packageDeviations(npoo, { today: '2026-11-17', kind: 'project', startDate: '2027-01-01', endDate: '2027-12-31' });
    expect(d.map((x) => x.key)).toEqual(['validity', 'rule:npoo-end-date']);
    expect(d[0]!.message).toMatch(/izvan razdoblja valjanosti paketa npoo-2021-2026 \(01\. 01\. 2021\. – 31\. 08\. 2026\.\)/);
  });
  it('projekt Obzora koji traje iza 2027. nije odstupanje (valjanost se odnosi na početak)', () => {
    expect(packageDeviations(he, { today: '2027-06-01', kind: 'project', startDate: '2027-06-01', endDate: '2031-05-31', budget: [{ categoryCode: 'A.1', amount: 1_000_000 }] })).toEqual([]);
  });
  it('projekt bez početka i otvorena prijava uspoređuju se s današnjim danom; info pravila se ne prikazuju', () => {
    expect(packageDeviations(npoo, { today: '2026-11-17', kind: 'project' }).map((x) => x.key)).toEqual(['validity']);
    expect(packageDeviations(npoo, { today: '2026-11-17', kind: 'proposal', open: true }).map((x) => x.key)).toEqual(['validity']);
    expect(packageDeviations(npoo, { today: '2026-11-17', kind: 'proposal', open: false })).toEqual([]);
    expect(packageDeviations(npoo, { today: '2026-05-01', kind: 'proposal', open: true })).toEqual([]);
    expect(packageDeviations(npoo, { today: '2026-05-01', kind: 'proposal', open: true, internalDeadline: '2026-09-15' }).map((x) => x.key)).toEqual(['validity']);
  });
});
