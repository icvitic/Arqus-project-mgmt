import { describe, it, expect } from 'vitest';
import {
  IMPORT_SHEETS, matchHeaders, matchSheet, normalizeHeader, parseNumberText, parseMoney, parseDate, parseBool, parseInteger, parseText, excelSerialToIso, cellText,
  monthRangeIssue, deliverableCodeIssues, expenseRuleIssues, historicIssues, isPersonnelCategory, sheetDef, MONTH_PREFIX, WP_PREFIX, type ProgrammePackage,
} from '../src/index.js';

/** WP1.17 – prepoznavanje listova i stupaca, čitanje vrijednosti (hrvatski i ISO zapis) i pravila koja dijele ručni unos i uvoz. */
const pkg = {
  meta: { id: 'npoo-test' },
  costCategories: [
    { code: 'OS', name: 'Troškovi osoblja', kind: 'direct' }, { code: 'VU', name: 'Vanjske usluge', kind: 'direct' },
    { code: 'NT', name: 'Neizravni', kind: 'indirect', calculation: { baseCategories: ['OS'], ratePercent: 7 } },
  ],
  personnelRule: { method: 'hourlyRate', categoryCode: 'OS', divisor: 1720, timeRecordingRequired: true },
  deliverableTypes: [{ code: 'ISP', name: 'Izvještaj' }], disseminationLevels: [{ code: 'JAV', name: 'Javno' }],
} as unknown as ProgrammePackage;

describe('listovi i stupci po nazivu', () => {
  it('normalizacija: velika slova, dijakritika, razmaci, zagrade i zvjezdica', () => {
    expect(normalizeHeader('  Iznos (EUR) * ')).toBe('iznos');
    expect(normalizeHeader('Potraživano  izvan\nsustava')).toBe('potrazivano izvan sustava');
    expect(normalizeHeader('ĐURĐICA – Šifra')).toBe('durdica sifra');
    expect(normalizeHeader('E-adresa korisnika')).toBe('e adresa korisnika');
  });
  it('listovi: hrvatski i engleski nazivi, upute i šifarnik se zanemaruju, nepoznati list je null', () => {
    expect((matchSheet('TROSKOVI') as { key: string }).key).toBe('expenses');
    expect((matchSheet('Costs') as { key: string }).key).toBe('expenses');
    expect((matchSheet('Radni Paketi') as { key: string }).key).toBe('workPackages');
    expect((matchSheet('Proračun') as { key: string }).key).toBe('budget');
    expect(matchSheet('Šifarnik')).toBe('ignored');
    expect(matchSheet('Upute')).toBe('ignored');
    expect(matchSheet('Moj list')).toBeNull();
  });
  it('stupci: redoslijed nije važan, vlastiti stupci se zanemaruju, obavezni koji nedostaju i duplikati se prijavljuju', () => {
    const m = matchHeaders(sheetDef('expenses'), ['Moja bilješka', 'IZNOS (eur)', 'datum', '', 'Category', 'Amount', 'Potrazivano izvan sustava']);
    expect([...m.columns]).toEqual([['amount', 1], ['date', 2], ['category', 4], ['historic', 6]]);
    expect(m.headers.get('amount')).toBe('IZNOS (eur)');
    expect(m.unknown).toEqual(['Moja bilješka']);
    expect(m.duplicates).toEqual(['Amount']);
    expect(m.missing).toEqual([]);
    expect(matchHeaders(sheetDef('team'), ['Uloga']).missing.map((c) => c.label)).toEqual(['Ime i prezime']);
  });
  it('nazivi stupaca su jednoznačni unutar svakog lista (nijedan naziv ne pripada dvama stupcima)', () => {
    for (const s of IMPORT_SHEETS) {
      const seen = new Map<string, string>();
      for (const c of s.columns) for (const n of [c.label, ...c.aliases].map(normalizeHeader)) {
        expect(seen.get(n) ?? c.key, `${s.label}: „${n}”`).toBe(c.key);
        seen.set(n, c.key);
      }
    }
  });
});

describe('vrijednosti ćelija', () => {
  it('brojevi u hrvatskom i engleskom zapisu', () => {
    const cases: [string, number | null][] = [
      ['1.234,56', 1234.56], ['1234,56', 1234.56], ['1 234,56 €', 1234.56], ['1234.56', 1234.56], ['1,234.56', 1234.56], ['20.000', 20000], ['1.000.000', 1000000],
      ['1,234,567', 1234567], ['0,5', 0.5], ['-12,5', -12.5], ['12 EUR', 12], ['1.2.3', null], ['abc', null], ['', null], ['1.234,5,6', null], ['12,34.5', null],
    ];
    for (const [s, v] of cases) expect(parseNumberText(s), s).toBe(v);
  });
  it('iznosi: centi, najviše dvije decimale, nenegativni, s ćelije broja ili teksta', () => {
    expect(parseMoney({ t: 'n', v: 1234.56 })).toEqual({ ok: true, value: 123456 });
    expect(parseMoney({ t: 'n', v: 0.1 + 0.2 })).toEqual({ ok: true, value: 30 });
    expect(parseMoney({ t: 's', v: '1.234,5' })).toEqual({ ok: true, value: 123450 });
    expect(parseMoney({ t: 's', v: '12,345' })).toMatchObject({ ok: false, message: expect.stringMatching(/više od dvije decimale/) });
    expect(parseMoney({ t: 'n', v: -1 })).toMatchObject({ ok: false, message: expect.stringMatching(/negativan/) });
    expect(parseMoney({ t: 's', v: 'sto eura' })).toMatchObject({ ok: false });
    expect(parseMoney({ t: 'f' })).toMatchObject({ ok: false, message: expect.stringMatching(/formulu bez spremljene vrijednosti/) });
    expect(parseMoney({ t: 'e', v: '#REF!' })).toMatchObject({ ok: false, message: expect.stringMatching(/grešku formule \(#REF!\)/) });
    expect(parseMoney({ t: 'n', v: 2e9 })).toMatchObject({ ok: false, message: expect.stringMatching(/prevelik/) });
  });
  it('datumi: hrvatski zapis s točkom, ISO, ćelija datuma, serijski broj bez formata; kosa crta se odbija kao nejednoznačna', () => {
    expect(parseDate({ t: 's', v: '31.12.2026.' })).toEqual({ ok: true, value: '2026-12-31' });
    expect(parseDate({ t: 's', v: '1. 3. 2026' })).toEqual({ ok: true, value: '2026-03-01' });
    expect(parseDate({ t: 's', v: '2026-12-31' })).toEqual({ ok: true, value: '2026-12-31' });
    expect(parseDate({ t: 's', v: '2026-12-31T10:00:00Z' })).toEqual({ ok: true, value: '2026-12-31' });
    expect(parseDate({ t: 'd', v: '2026-02-10' })).toEqual({ ok: true, value: '2026-02-10' });
    expect(parseDate({ t: 'n', v: 46387 })).toEqual({ ok: true, value: '2026-12-31' });
    expect(parseDate({ t: 'n', v: 46387 }, true)).toEqual({ ok: true, value: '2031-01-01' });
    expect(parseDate({ t: 's', v: '29.02.2026.' })).toMatchObject({ ok: false, message: 'datum ne postoji' });
    expect(parseDate({ t: 's', v: '02/10/2026' })).toMatchObject({ ok: false, message: expect.stringMatching(/kosom crtom nije jednoznačan/) });
    expect(parseDate({ t: 'n', v: 12 })).toMatchObject({ ok: false });
    expect(parseDate({ t: 'b', v: true })).toMatchObject({ ok: false });
  });
  it('Excelov serijski broj: sustav 1900 s nepostojećim 29. 2. 1900. i sustav 1904', () => {
    expect(excelSerialToIso(1)).toBe('1900-01-01');
    expect(excelSerialToIso(59)).toBe('1900-02-28');
    expect(excelSerialToIso(60)).toBeNull();
    expect(excelSerialToIso(61)).toBe('1900-03-01');
    expect(excelSerialToIso(45658)).toBe('2025-01-01');
    expect(excelSerialToIso(45658.75)).toBe('2025-01-01');
    expect(excelSerialToIso(1, true)).toBe('1904-01-02');
    expect(excelSerialToIso(44196, true)).toBe('2025-01-01');
    expect(excelSerialToIso(0)).toBeNull();
    expect(excelSerialToIso(Number.NaN)).toBeNull();
  });
  it('DA/NE, cijeli brojevi s prefiksom, tekst', () => {
    for (const v of ['DA', 'da', 'x', 'Yes', 'TRUE', 'TOČNO', '1', '✓']) expect(parseBool({ t: 's', v }), v).toEqual({ ok: true, value: true });
    for (const v of ['NE', 'no', 'false', 'NETOČNO', '0']) expect(parseBool({ t: 's', v }), v).toEqual({ ok: true, value: false });
    expect(parseBool({ t: 'b', v: true })).toEqual({ ok: true, value: true });
    expect(parseBool({ t: 's', v: 'možda' })).toMatchObject({ ok: false, message: 'upiši DA ili NE' });
    expect(parseInteger({ t: 's', v: 'M12' }, MONTH_PREFIX)).toEqual({ ok: true, value: 12 });
    expect(parseInteger({ t: 's', v: 'mj. 3' }, MONTH_PREFIX)).toEqual({ ok: true, value: 3 });
    expect(parseInteger({ t: 's', v: 'WP 2' }, WP_PREFIX)).toEqual({ ok: true, value: 2 });
    expect(parseInteger({ t: 'n', v: 2.5 })).toMatchObject({ ok: false });
    expect(parseInteger({ t: 's', v: 'M12' })).toMatchObject({ ok: false });
    expect(parseText({ t: 'n', v: 42 })).toEqual({ ok: true, value: '42' });
    expect(parseText({ t: 's', v: '  =SUM(A1)  ' })).toEqual({ ok: true, value: '=SUM(A1)' });
    expect(cellText({ t: 'd', v: '2026-03-01' })).toBe('01.03.2026.');
    expect(cellText({ t: 'n', v: 12.5 })).toBe('12,5');
  });
});

describe('pravila zajednička ručnom unosu i uvozu', () => {
  const ctx = { partnerIds: new Set(['p1']), workPackageIds: new Set(['w1']), projectStart: '2026-01-01', projectEnd: '2027-12-31' };
  it('trošak: kategorija, partner, datum, radni paket, trošak osoblja samo iz timesheeta – osim potraživanog izvan sustava', () => {
    expect(expenseRuleIssues(pkg, ctx, { partnerId: 'p1', categoryCode: 'VU', date: '2026-05-01', amount: 100, workPackageId: 'w1' })).toEqual([]);
    expect(expenseRuleIssues(pkg, ctx, { partnerId: 'p2', categoryCode: 'NT', date: '2028-01-01', amount: 100, workPackageId: 'w9' })).toEqual([
      'partner p2 nije na projektu', 'u kategoriju "NT" ne unose se iznosi (dopušteno: OS, VU)', 'datum 2028-01-01 je izvan trajanja projekta (2026-01-01 – 2027-12-31)', 'radni paket w9 nije na projektu',
    ]);
    expect(expenseRuleIssues(pkg, ctx, { partnerId: 'p1', categoryCode: 'OS', date: '2026-05-01', amount: 100 })).toEqual(['trošak osoblja (OS) nastaje odobrenjem timesheeta, ne ručnim unosom']);
    expect(expenseRuleIssues(pkg, ctx, { partnerId: 'p1', categoryCode: 'OS', date: '2026-05-01', amount: 100 }, { historicPersonnel: true })).toEqual([]);
    expect(isPersonnelCategory(pkg, 'OS')).toBe(true);
    expect(isPersonnelCategory(pkg, 'VU')).toBe(false);
  });
  it('potraživano izvan sustava: priznato ne veće od traženog, umanjenje uz razlog', () => {
    expect(historicIssues({ amount: 100, recognised: null, reason: null })).toEqual([]);
    expect(historicIssues({ amount: 100, recognised: 100, reason: null })).toEqual([]);
    expect(historicIssues({ amount: 100, recognised: 150, reason: null })).toEqual(['priznati iznos je veći od traženog']);
    expect(historicIssues({ amount: 100, recognised: 80, reason: 'ok' })).toEqual(['razlog je obavezan kad je priznati iznos manji od traženog (najmanje 5 znakova)']);
    expect(historicIssues({ amount: 100, recognised: 0, reason: 'Nije priznato' })).toEqual([]);
  });
  it('mjeseci i šifre isporuka', () => {
    expect(monthRangeIssue(24, 1, 24, 'WP1')).toBeNull();
    expect(monthRangeIssue(24, 5, 2, 'WP1')).toBe('WP1: završni mjesec je prije početnog');
    expect(monthRangeIssue(24, 1, 25, 'WP1')).toBe('WP1: mjesec 25 je izvan trajanja projekta (24 mj.)');
    expect(monthRangeIssue(null, 1, 300, 'WP1')).toBeNull();
    expect(deliverableCodeIssues(pkg, 'ISP', 'JAV')).toEqual([]);
    expect(deliverableCodeIssues(pkg, 'X', 'Y')).toEqual(['Vrsta isporuke "X" ne postoji u paketu (dopušteno: ISP)', 'Razina diseminacije "Y" ne postoji u paketu (dopušteno: JAV)']);
  });
});
