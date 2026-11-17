import type { Cell } from '../export/xlsx-writer';
import { buildXlsx } from '../export/xlsx-writer';
import { importTemplate, templateColumns, type TemplateContext } from '../import/import-template';
import type { ImportSheetKey } from '@arqus/domain';

/**
 * WP1.17 – demo uvoza postojećeg projekta. Treći demo projekt (DIGI-ARHIV) je u ArQusu tek otvoren (osnovni podaci,
 * partneri, aktiviran), a sve ostalo je u Excelu: radni paketi, proračun, tim i troškovi – i troškovi prvog razdoblja koji
 * su već potraživani u ZNS-u predanom prije ArQusa. Primjer radne knjige (`docs/primjeri/uvoz-projekta-DIGI-ARHIV.xlsx`)
 * izrađuje ovaj modul vlastitim XLSX pisačem i predloškom uvoza (skripta `pnpm --filter @arqus/api demo:import-example`);
 * test provjerava da je datoteka u repozitoriju jednaka izrađenoj. Datumi su fiksni (projekt počinje 1. 3. 2026.), jer se
 * ista datoteka prilaže demonstraciji.
 */
export const DEMO_IMPORT_PROJECT = {
  acronym: 'DIGI-ARHIV',
  title: 'Digitalizacija arhivske građe i otvoreni repozitorij sveučilišne knjižnice',
  contractNo: 'NPOO.C3.2.R3-I2.07.0211',
  startDate: '2026-03-01',
  durationMonths: 24,
} as const;
export const DEMO_IMPORT_FILE = 'uvoz-projekta-DIGI-ARHIV.xlsx';

const SELF = 'PSU'; const AGENCY = 'RAVP';
const ctx: TemplateContext = {
  project: { acronym: DEMO_IMPORT_PROJECT.acronym, title: DEMO_IMPORT_PROJECT.title, startDate: DEMO_IMPORT_PROJECT.startDate, durationMonths: DEMO_IMPORT_PROJECT.durationMonths, status: 'active', packageLabel: 'NPOO – Zeleni i digitalni prijelaz visokih učilišta (pokazni poziv)' },
  partners: [
    { name: 'Pokazno sveučilište', shortName: SELF, role: 'coordinator', orderNo: 1, isSelf: true },
    { name: 'Razvojna agencija Velebitsko primorje', shortName: AGENCY, role: 'partner', orderNo: 2, isSelf: false },
  ],
  categories: [
    ['OS', 'Troškovi osoblja'], ['VU', 'Vanjske usluge'], ['OP', 'Oprema'], ['RAD', 'Radovi / infrastruktura'], ['PUT', 'Putovanja'], ['UP', 'Upravljanje projektom i administracija'], ['PV', 'Promidžba i vidljivost'],
  ].map(([code, name]) => ({ code: code!, name: name!, personnel: code === 'OS', timeRecording: true })),
  workPackages: [],
  deliverableTypes: [{ code: 'ISP', name: 'Izvještaj / dokument' }, { code: 'POK', name: 'Pokazni objekt / oprema u funkciji' }],
  disseminationLevels: [{ code: 'JAV', name: 'Javno' }, { code: 'INT', name: 'Interno' }],
  team: null,
  personnel: true,
  allowed: ['workPackages', 'deliverables', 'milestones', 'budget', 'team', 'expenses'],
};

const date = (iso: string): Cell => ({ v: iso, s: 'date' });
const eur = (n: number): Cell => ({ v: n, s: 'money' });
const RP1 = 'ZNS 1 – RP1 (eFondovi, prije ArQusa)';

/** Retci po listu, stupci kao u predlošku (redoslijed stupaca predloška). */
const rows: Record<ImportSheetKey, Record<string, Cell>[]> = {
  workPackages: [
    { number: 1, title: 'Upravljanje projektom', startMonth: 1, endMonth: 24, lead: SELF, objectives: 'Koordinacija, izvještavanje prema posredničkom tijelu, upravljanje rizicima.' },
    { number: 2, title: 'Digitalizacija arhivske građe', startMonth: 1, endMonth: 18, lead: SELF, objectives: 'Skeniranje, obrada i opis 40.000 stranica rukopisne i tiskane građe.' },
    { number: 3, title: 'Otvoreni repozitorij i promidžba', startMonth: 4, endMonth: 24, lead: AGENCY, objectives: 'Javno dostupan repozitorij, info-dani i radionice za lokalnu zajednicu.' },
  ],
  deliverables: [
    { workPackage: 'WP2', title: 'Plan digitalizacije i metapodatkovni standard', type: 'ISP', dissemination: 'JAV', dueMonth: 3, lead: SELF },
    { workPackage: 'WP3', title: 'Javno dostupan repozitorij digitalizirane građe', type: 'POK', dissemination: 'JAV', dueMonth: 18, lead: AGENCY },
  ],
  milestones: [{ title: 'Prvih 10.000 digitaliziranih stranica', dueMonth: 9, verification: 'Izvještaj iz repozitorija s brojem objavljenih stranica' }],
  budget: [
    { partner: SELF, category: 'OS', amount: eur(72_000) }, { partner: SELF, category: 'VU', workPackage: 'WP2', amount: eur(30_000) }, { partner: SELF, category: 'OP', workPackage: 'WP2', amount: eur(45_000) },
    { partner: SELF, category: 'PUT', amount: eur(4_000) }, { partner: SELF, category: 'PV', amount: eur(3_000) },
    { partner: AGENCY, category: 'OS', amount: eur(18_000) }, { partner: AGENCY, category: 'PV', workPackage: 'WP3', amount: eur(6_000) },
  ],
  team: [
    { fullName: 'dr. sc. Lana Perković', role: 'voditeljica projekta', partner: SELF, annualCost: eur(42_000) },
    { fullName: 'Tin Marić', role: 'stručni suradnik za digitalizaciju', partner: SELF, annualCost: eur(30_000) },
    { fullName: 'Iva Kralj', role: 'koordinatorica promidžbe', partner: AGENCY, annualCost: eur(26_000) },
  ],
  expenses: [
    // RP1 (ožujak – kolovoz 2026.): potraživano u ZNS-u 1 predanom prije ArQusa; troškovi osoblja po osobi i mjesecu.
    ...['03', '04', '05', '06', '07', '08'].flatMap((m) => [
      { date: date(`2026-${m}-${m === '04' || m === '06' ? '30' : '31'}`), partner: SELF, category: 'OS', workPackage: 'WP2', amount: eur(1_250), historic: 'DA', externalClaim: RP1, person: 'dr. sc. Lana Perković' },
      { date: date(`2026-${m}-${m === '04' || m === '06' ? '30' : '31'}`), partner: SELF, category: 'OS', workPackage: 'WP2', amount: eur(980), historic: 'DA', externalClaim: RP1, person: 'Tin Marić' },
    ]),
    { date: date('2026-04-15'), partner: SELF, category: 'VU', workPackage: 'WP2', description: 'Usluga skeniranja – 1. faza (12.000 stranica)', supplier: 'Arhiv-skener d.o.o.', amount: eur(12_400), evidenceRef: 'R-118/2026', historic: 'DA', externalClaim: RP1, recognised: eur(11_900), reason: 'Priznato prema jediničnoj cijeni iz ugovora (0,99 EUR po stranici)' },
    { date: date('2026-05-20'), partner: SELF, category: 'OP', workPackage: 'WP2', description: 'Planetarni skener za knjige i rukopise', supplier: 'Digitalna oprema d.o.o.', amount: eur(18_600), evidenceRef: 'R-204/2026', historic: 'DA', externalClaim: RP1 },
    { date: date('2026-06-11'), partner: SELF, category: 'PUT', workPackage: 'WP1', description: 'Radionica o metapodacima, Ljubljana (2 osobe)', supplier: 'Putni nalozi 11/2026 i 12/2026', amount: eur(640.5), evidenceRef: 'PN-11-12/2026', historic: 'DA', externalClaim: RP1 },
    { date: date('2026-07-08'), partner: SELF, category: 'PV', workPackage: 'WP1', description: 'Plakati, ploča i web-stranica projekta', supplier: 'Studio Kvadrat d.o.o.', amount: eur(1_150), evidenceRef: 'R-287/2026', historic: 'DA', externalClaim: RP1 },
    // RP2 (od rujna 2026.): obični troškovi – ulaze u ZNS 2 po uobičajenim pravilima.
    { date: date('2026-09-30'), partner: SELF, category: 'VU', workPackage: 'WP2', description: 'Usluga skeniranja – 2. faza (rujan)', supplier: 'Arhiv-skener d.o.o.', amount: eur(6_200), evidenceRef: 'R-402/2026', historic: 'NE' },
    { date: date('2026-10-14'), partner: SELF, category: 'PUT', workPackage: 'WP1', description: 'Sastanak partnera u Gospiću', supplier: 'Putni nalog 19/2026', amount: eur(210.4), evidenceRef: 'PN-19/2026', historic: 'NE' },
    { date: date('2026-10-22'), partner: AGENCY, category: 'PV', workPackage: 'WP3', description: 'Info-dan o repozitoriju u Gospiću', supplier: 'Dom kulture Gospić', amount: eur(480), evidenceRef: 'R-77/2026', historic: 'NE' },
  ],
};

/** Primjer ispunjene radne knjige za demo (deterministična: ista datoteka pri svakoj izradi). */
export function demoImportWorkbook(): Promise<Buffer> {
  const data = Object.fromEntries((Object.keys(rows) as ImportSheetKey[]).map((key) => {
    const cols = templateColumns(key, true);
    return [key, rows[key].map((r) => cols.map((c) => r[c.key] ?? null))];
  })) as Record<ImportSheetKey, Cell[][]>;
  return buildXlsx(importTemplate(ctx, data));
}
