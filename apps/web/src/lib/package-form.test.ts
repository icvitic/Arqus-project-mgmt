import { describe, it, expect } from 'vitest';
import { buildChildPackage, initialForm, slugify, bumpMinor } from './package-form';
import type { PackageContent } from './types';

const npoo: PackageContent = {
  meta: { id: 'npoo-2021-2026', programme: 'NPOO', version: '1.0.0', validFrom: '2021-01-01', language: 'hr' },
  actionTypes: [{ code: 'BESPOVRATNA', name: 'Bespovratna', fundingRates: [{ beneficiaryType: 'default', ratePercent: 100 }] }],
  costCategories: [{ code: 'OS', name: 'Osoblje', kind: 'direct' }, { code: 'VU', name: 'Usluge', kind: 'direct' }, { code: 'NT', name: 'Neizravni', kind: 'indirect', calculation: { ratePercent: 15, baseCategories: ['OS'] } }],
  personnelRule: { method: 'hourlyRate', divisor: 1720, categoryCode: 'OS' },
  reporting: { periodMonths: 3, submissionDeadlineDays: 30 },
};

describe('paket po pozivu iz obrasca', () => {
  it('slug i povećanje verzije', () => {
    expect(slugify('NPOO.C3.2.R2-I1.05')).toBe('npoo-c3-2-r2-i1-05');
    expect(slugify('  Poziv – Šumarstvo & đaci ')).toBe('poziv-sumarstvo-daci');
    expect(bumpMinor('1.2.3')).toBe('1.3.0');
  });
  it('početno stanje preuzima pravila roditelja; izmjene ulaze u JSON', () => {
    const f = initialForm(npoo);
    expect(f.indirect.NT).toEqual({ rate: '15', base: ['OS'] });
    expect(f.rates.BESPOVRATNA?.default).toBe('100');
    const pkg = buildChildPackage(npoo, { ...f, id: 'npoo-c3', programme: 'NPOO – C3', validFrom: '2026-10-01', periodMonths: '6', indirect: { NT: { rate: '7', base: ['OS', 'VU'] } },
      rates: { BESPOVRATNA: { default: '85' } }, extraCategories: [{ code: 'IST', name: 'Istraživačka oprema' }, { code: '', name: '' }], sourceUrl: 'https://example.hr/upute.pdf' });
    expect(pkg.meta).toMatchObject({ id: 'npoo-c3', extends: 'npoo-2021-2026', version: '1.0.0', sources: ['https://example.hr/upute.pdf'] });
    expect(pkg.costCategories).toEqual([
      { code: 'NT', name: 'Neizravni', kind: 'indirect', calculation: { ratePercent: 7, baseCategories: ['OS', 'VU'] } },
      { code: 'IST', name: 'Istraživačka oprema', kind: 'direct' },
    ]);
    expect(pkg.actionTypes[0]!.fundingRates).toEqual([{ beneficiaryType: 'default', ratePercent: 85 }]);
    expect(pkg.reporting).toEqual({ periodMonths: 6, submissionDeadlineDays: 30 });
  });
  it('nova verzija preuzima izvorni sadržaj postojećeg paketa', () => {
    const existing = buildChildPackage(npoo, { ...initialForm(npoo), id: 'npoo-c3', programme: 'NPOO – C3', validFrom: '2026-10-01', indirect: { NT: { rate: '7', base: ['OS'] } }, extraCategories: [{ code: 'IST', name: 'Oprema' }] });
    const f = initialForm(npoo, existing);
    expect(f).toMatchObject({ id: 'npoo-c3', version: '1.1.0', indirect: { NT: { rate: '7', base: ['OS'] } }, extraCategories: [{ code: 'IST', name: 'Oprema' }] });
  });
});
