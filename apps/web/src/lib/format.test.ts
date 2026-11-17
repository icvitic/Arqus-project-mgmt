import { describe, it, expect } from 'vitest';
import { parseEur, eur, parseHours, minutesToHours, centsToInput, date, plural, hours, monthLabel } from './format';

describe('format', () => {
  it('parseEur prihvaća hrvatski i engleski zapis', () => {
    expect(parseEur('1.234,56')).toBe(123456);
    expect(parseEur('1234.5')).toBe(123450);
    expect(parseEur('1.000.000')).toBe(100000000);
    expect(parseEur('20.000')).toBe(2000000);
    expect(parseEur('20.5')).toBe(2050);
    expect(parseEur('34.400')).toBe(3440000);
    expect(parseEur(' 20 000 € ')).toBe(2000000);
    expect(parseEur('')).toBe(0);
    expect(parseEur('12,345')).toBeNull();
    expect(parseEur('abc')).toBeNull();
  });
  it('eur i povratni unos', () => {
    expect(eur(123456).replace(/\s/g, ' ')).toMatch(/1\.234,56/);
    expect(centsToInput(123450)).toBe('1234,50');
    expect(centsToInput(0)).toBe('');
  });
  it('sati ↔ minute i datum', () => {
    expect(parseHours('7,5')).toBe(450);
    expect(parseHours('')).toBe(0);
    expect(parseHours('25.123')).toBeNull();
    expect(minutesToHours(450)).toBe('7,5');
    expect(date('2027-03-31')).toBe('31. 03. 2027.');
  });
  it('množina, sati i mjeseci (portfelj)', () => {
    expect([1, 2, 4, 5, 11, 12, 21, 22, 25, 111].map((n) => plural(n, 'isporuka', 'isporuke', 'isporuka.'))).toEqual(['isporuka', 'isporuke', 'isporuke', 'isporuka.', 'isporuka.', 'isporuka.', 'isporuka', 'isporuke', 'isporuka.', 'isporuka.']);
    expect(hours(450)).toBe('7,5'); expect(hours(480)).toBe('8');
    expect(monthLabel('2027-02')).toBe('velj. 2027.'); expect(monthLabel('2027-12', true)).toBe('pro.');
  });
});
