import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateProgrammePackage } from '../src/validate.js';
import { computePartnerBudget } from '../src/budget.js';
import type { ProgrammePackage } from '../src/programme-package.js';

const here = dirname(fileURLToPath(import.meta.url));
const docsPaketi = join(here, '..', '..', '..', 'docs', 'domena', 'paketi');
const load = (f: string) => JSON.parse(readFileSync(join(docsPaketi, f), 'utf-8'));

describe('shema paketa programa', () => {
  it('kopija sheme u paketu jednaka je izvoru u docs/domena/paketi', () => {
    const src = load('schema.v1.json');
    const copy = JSON.parse(readFileSync(join(here, '..', 'src', 'schema', 'programme-package.v1.json'), 'utf-8'));
    expect(copy).toEqual(src);
  });
  it.each(['horizon-europe-2021-2027.v1.json', 'npoo-2021-2026.v1.json'])('%s je valjan', (f) => {
    const r = validateProgrammePackage(load(f));
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
  it('odbija paket bez meta.id i s nepoznatom osnovicom', () => {
    const bad = load('horizon-europe-2021-2027.v1.json');
    delete bad.meta.id;
    const r1 = validateProgrammePackage(bad);
    expect(r1.ok).toBe(false);
    const bad2 = load('horizon-europe-2021-2027.v1.json');
    bad2.costCategories.find((c: { code: string }) => c.code === 'E').calculation.baseCategories = ['X'];
    const r2 = validateProgrammePackage(bad2);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.issues[0]?.message).toMatch(/nepoznata osnovica/);
  });
});

describe('izračun proračuna partnera (HE)', () => {
  const he = load('horizon-europe-2021-2027.v1.json') as ProgrammePackage;
  it('neizravni 25 % na A + C, bez B; IA 70 % default, 100 % neprofitni', () => {
    const lines = { 'A.1': 40_000_000, 'B': 10_000_000, 'C.1': 2_000_000 }; // centi
    const r = computePartnerBudget(he, 'IA', lines);
    expect(r.directTotal).toBe(52_000_000);
    expect(r.indirect['E']).toBe(10_500_000); // 25 % × (40 M + 2 M)
    expect(r.total).toBe(62_500_000);
    expect(r.ratePercent).toBe(70);
    expect(r.requested).toBe(43_750_000);
    const np = computePartnerBudget(he, 'IA', lines, 'nonProfit');
    expect(np.requested).toBe(62_500_000);
  });
  it('odbija ručni unos neizravnih i nepoznatu šifru', () => {
    expect(() => computePartnerBudget(he, 'RIA', { E: 100 })).toThrow(/ne unose ručno/);
    expect(() => computePartnerBudget(he, 'RIA', { ZZZ: 100 })).toThrow(/Nepoznata kategorija/);
  });
  it('NPOO: upozorenje kad upravljanje prelazi 10 % i neizravni 15 % osoblja', () => {
    const npoo = load('npoo-2021-2026.v1.json') as ProgrammePackage;
    const r = computePartnerBudget(npoo, 'BESPOVRATNA', { OS: 10_000_000, UP: 2_000_000 });
    expect(r.indirect['NT']).toBe(1_500_000);
    expect(r.warnings.some((w) => w.startsWith('UP'))).toBe(true);
  });
});
