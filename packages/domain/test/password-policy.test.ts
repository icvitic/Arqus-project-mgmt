import { describe, it, expect } from 'vitest';
import { passwordIssues } from '../src/password-policy.js';

describe('politika lozinki', () => {
  it('prihvaća dugačke lozinke bez pravila sastava', () => {
    expect(passwordIssues('konj baterija spajalica')).toEqual([]);
    expect(passwordIssues('Tajna-lozinka-2027')).toEqual([]);
    expect(passwordIssues('zeleni-tramvaj-u-sumi')).toEqual([]);
  });
  it('odbija kratke, česte, ponavljanja i nizove', () => {
    expect(passwordIssues('Kratka1!')[0]).toMatch(/12 znakova/);
    expect(passwordIssues('administrator')).toContainEqual(expect.stringMatching(/prečesta/));
    expect(passwordIssues('password1234')).toContainEqual(expect.stringMatching(/prečesta/));
    expect(passwordIssues('Lozinka-123456')).toContainEqual(expect.stringMatching(/prečesta/));
    expect(passwordIssues('aaaaaaaaaaaaaa')).toContainEqual(expect.stringMatching(/istog znaka/));
    expect(passwordIssues('123456789012')).toContainEqual(expect.stringMatching(/niz/));
    expect(passwordIssues('abababababab')).toContainEqual(expect.stringMatching(/različitih/));
  });
  it('odbija osobne podatke', () => {
    expect(passwordIssues('ivana.horvat-2027', { email: 'ivana.horvat@fpz.hr' })).toContainEqual(expect.stringMatching(/e-adresu/));
    expect(passwordIssues('moja-institucija-fpzzg', { tenantSlug: 'fpzzg' })).toContainEqual(expect.stringMatching(/institucije/));
  });
});
