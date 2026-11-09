import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolvePackage, mergePackages } from '../src/merge.js';
import { validateProgrammePackage } from '../src/validate.js';
import { computePartnerBudget } from '../src/budget.js';
import type { ProgrammePackage } from '../src/programme-package.js';

const here = dirname(fileURLToPath(import.meta.url));
const npoo = JSON.parse(readFileSync(join(here, '..', '..', '..', 'docs', 'domena', 'paketi', 'npoo-2021-2026.v1.json'), 'utf-8')) as ProgrammePackage;

/** Paket po pozivu: nasljeđuje NPOO, mijenja stopu neizravnih i dodaje kategoriju. */
const poziv: ProgrammePackage = {
  meta: { id: 'npoo-c3-2-r2-i1-05', extends: 'npoo-2021-2026', programme: 'NPOO – poziv C3.2.R2-I1.05', version: '1.0.0', validFrom: '2026-10-01', validTo: '2027-06-30', language: 'hr' },
  actionTypes: [],
  costCategories: [
    { code: 'NT', name: 'Neizravni troškovi (7 % osoblja)', kind: 'indirect', calculation: { ratePercent: 7 } },
    { code: 'IST', name: 'Istraživačka oprema', kind: 'direct' },
  ],
  reporting: { periodMonths: 6, submissionDeadlineDays: 30 },
};

describe('nasljeđivanje paketa (extends)', () => {
  it('razriješeni paket po pozivu je valjan, naslijedio je roditelja i primijenio razlike', () => {
    const r = resolvePackage(poziv, (id) => (id === 'npoo-2021-2026' ? npoo : undefined));
    expect(r.meta.id).toBe('npoo-c3-2-r2-i1-05');
    expect(r.meta.extends).toBe('npoo-2021-2026');
    expect(r.actionTypes.map((a) => a.code)).toContain('BESPOVRATNA');
    const nt = r.costCategories.find((c) => c.code === 'NT')!;
    expect(nt.calculation?.ratePercent).toBe(7);
    expect(nt.calculation?.baseCategories).toEqual(['OS']); // naslijeđena osnovica
    expect(r.costCategories.some((c) => c.code === 'IST')).toBe(true);
    expect(r.reporting.periodMonths).toBe(6);
    expect(r.reporting.finalReportDeadlineDays).toBe(npoo.reporting.finalReportDeadlineDays);
    const v = validateProgrammePackage(r);
    expect(v.ok, JSON.stringify(v)).toBe(true);
    expect(computePartnerBudget(r, 'BESPOVRATNA', { OS: 10_000_000, IST: 500_000 }).indirect['NT']).toBe(700_000);
  });
  it('otkriva nepostojećeg roditelja i kružno nasljeđivanje', () => {
    expect(() => resolvePackage(poziv, () => undefined)).toThrow(/nije pronađen/);
    const a = { ...poziv, meta: { ...poziv.meta, id: 'a', extends: 'b' } };
    const b = { ...poziv, meta: { ...poziv.meta, id: 'b', extends: 'a' } };
    expect(() => resolvePackage(a, (id) => (id === 'b' ? b : id === 'a' ? a : undefined))).toThrow(/Kružno/);
  });
  it('mergePackages ne briše stavke roditelja', () => {
    const m = mergePackages(npoo, poziv);
    expect(m.costCategories.length).toBe(npoo.costCategories.length + 1);
  });
});
