import { IMPORT_SHEETS, type ImportSheetKey } from '@arqus/domain';
import { columnName, header, type Cell, type Sheet, type Workbook } from '../export/xlsx-writer';
import { IMPORT_LIMITS } from './limits';

/**
 * WP1.17 – predložak radne knjige za uvoz postojećeg projekta, izrađen za konkretan projekt (vlastitim XLSX pisačem):
 * list „Upute”, listovi s podacima (zaglavlje u prvom retku) i list „Šifarnik” s vrijednostima projekta – partneri,
 * kategorije troškova paketa u koje se unosi, radni paketi koji već postoje, vrste isporuka, razine diseminacije i (uz
 * pristup podacima o osoblju) članovi tima – da korisnik bira umjesto da pogađa. Stupci partnera, kategorije, radnog paketa
 * i „Potraživano izvan sustava” imaju padajući popis (samo pomoć: uvoz i dalje provjerava svaku vrijednost).
 */
export interface TemplateContext {
  project: { acronym: string; title: string; startDate: string | null; durationMonths: number | null; status: string; packageLabel: string };
  partners: { name: string; shortName: string | null; role: string; orderNo: number; isSelf: boolean }[];
  categories: { code: string; name: string; personnel: boolean; timeRecording: boolean }[];
  workPackages: { number: number; title: string; startMonth: number; endMonth: number }[];
  deliverableTypes: { code: string; name: string }[];
  disseminationLevels: { code: string; name: string }[];
  team: { fullName: string; partner: string }[] | null;
  /** Smije li korisnik uvoziti godišnji trošak i troškove osoblja iz ranijih razdoblja (personnel:read). */
  personnel: boolean;
  /** Listovi koje korisnik smije uvesti (prema dozvolama na projektu). */
  allowed: ImportSheetKey[];
}

const DATA_ROWS = 2000;
const partnerLabel = (p: { name: string; shortName: string | null }) => p.shortName || p.name;
const STATUS: Record<string, string> = { contracting: 'u ugovaranju', active: 'aktivan', suspended: 'obustavljen', closing: 'u završetku' };

/** Stupci lista u predlošku (godišnji trošak samo uz pristup podacima o osoblju). */
export const templateColumns = (key: ImportSheetKey, personnel: boolean) => IMPORT_SHEETS.find((s) => s.key === key)!.columns.filter((c) => personnel || !c.personnel);

export function importTemplate(ctx: TemplateContext, data: Partial<Record<ImportSheetKey, Cell[][]>> = {}): Workbook {
  const ref = (col: number, n: number) => `'Šifarnik'!$${columnName(col)}$2:$${columnName(col)}$${Math.max(2, n + 1)}`;
  const nPartners = ctx.partners.length; const enterable = ctx.categories;
  const sheets: Sheet[] = [instructions(ctx)];

  for (const def of IMPORT_SHEETS) {
    const cols = templateColumns(def.key, ctx.personnel);
    const rows: Cell[][] = [cols.map((c) => header(`${c.label}${c.required ? ' *' : ''}`))];
    if (data[def.key]) rows.push(...data[def.key]!);
    const validations: { sqref: string; formula: string }[] = [];
    const at = (key: string) => cols.findIndex((c) => c.key === key);
    const range = (i: number) => `${columnName(i)}2:${columnName(i)}${DATA_ROWS + 1}`;
    for (const key of ['partner', 'lead']) if (at(key) >= 0 && nPartners) validations.push({ sqref: range(at(key)), formula: ref(0, nPartners) });
    if (at('category') >= 0 && enterable.length) validations.push({ sqref: range(at('category')), formula: ref(4, enterable.length) });
    if (at('historic') >= 0) validations.push({ sqref: range(at('historic')), formula: '"DA,NE"' });
    if (def.key === 'deliverables') {
      if (ctx.deliverableTypes.length) validations.push({ sqref: range(at('type')), formula: ref(12, ctx.deliverableTypes.length) });
      if (ctx.disseminationLevels.length) validations.push({ sqref: range(at('dissemination')), formula: ref(15, ctx.disseminationLevels.length) });
    }
    if (def.key === 'expenses' && ctx.team?.length && at('person') >= 0) validations.push({ sqref: range(at('person')), formula: ref(18, ctx.team.length) });
    sheets.push({ name: def.label, rows, freezeRows: 1, widths: cols.map((c) => Math.max(12, Math.min(40, c.label.length + 6))), validations });
  }
  sheets.push(reference(ctx));
  return { sheets, title: `Uvoz projekta ${ctx.project.acronym}`, creator: 'ArQus Projekti' };
}

function instructions(ctx: TemplateContext): Sheet {
  const p = ctx.project;
  const rows: Cell[][] = [];
  const line = (v: string, s?: 'bold' | 'title' | 'wrap' | 'warn') => rows.push([s ? { v, s } : { v, s: 'wrap' }]);
  line(`Uvoz postojećeg projekta – ${p.acronym}`, 'title');
  line(`${p.title} · ${p.packageLabel} · ${STATUS[p.status] ?? p.status}${p.startDate ? ` · početak ${p.startDate.slice(8, 10)}.${p.startDate.slice(5, 7)}.${p.startDate.slice(0, 4)}.` : ''}${p.durationMonths ? ` · ${p.durationMonths} mj.` : ''}`);
  rows.push([]);
  line('Kako se koristi', 'bold');
  for (const s of [
    '1. Popuni listove koji ti trebaju; prazan list se preskače. Podatke smiješ zalijepiti iz vlastitih tablica.',
    '2. Stupci se prepoznaju po nazivu u prvom retku (redoslijed nije važan, vlastite stupce smiješ dodati – zanemaruju se). Obavezni stupci su označeni zvjezdicom.',
    '3. Vrijednosti partnera, kategorija, radnih paketa, vrsta isporuka i razina diseminacije uzmi s lista „Šifarnik” (padajući popis u ćeliji).',
    '4. U ArQusu na projektu otvori karticu „Uvoz”, učitaj datoteku i pregledaj što će se stvoriti. Ništa se ne sprema dok ne potvrdiš.',
    '5. Greške su navedene po listu, retku i stupcu (broj retka kao u Excelu). Ispravi ih u datoteci i učitaj je ponovno.',
    '6. Potvrda primjenjuje sve ili ništa. Uvoz se poslije može poništiti dok na uvezenim podacima ništa nije izgrađeno.',
  ]) line(s);
  rows.push([]);
  line('Formati', 'bold');
  for (const s of [
    'Iznosi u eurima: 1.234,56 ili 1234.56 (najviše dvije decimale). Datumi: 31.12.2026. ili 2026-12-31 (ili ćelija s formatom datuma).',
    'Mjeseci projekta: 1 = prvi mjesec projekta (smije i M1). Radni paket: broj (1 ili WP1). DA/NE: da, ne, x.',
    'Formule se ne izračunavaju – uvozi se vrijednost koju je Excel ili LibreOffice spremio. Datoteka .xlsx (ne .xls, .xlsm ni s lozinkom) ili CSV UTF-8 po listu.',
    `Granice: datoteka do ${IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB, do ${IMPORT_LIMITS.maxRows.toLocaleString('hr-HR')} redaka po listu, prvih ${IMPORT_LIMITS.maxColumns} stupaca.`,
  ]) line(s);
  rows.push([]);
  line('Troškovi koji su već potraživani prije ArQusa', 'bold');
  for (const s of [
    'Za trošak koji je već bio u zahtjevu za nadoknadu (ZNS) predanom prije uvođenja ArQusa upiši DA u stupac „Potraživano izvan sustava”. Takav trošak ulazi u „ostvareno” (s priznatim iznosom ako ga upišeš), ali se ne nudi ni u jednom novom ZNS-u i jasno je označen kao povijesni.',
    'Uz DA možeš upisati razdoblje ili oznaku zahtjeva, priznati iznos (prazno = priznat u cijelosti) i razlog umanjenja (obavezan kad je priznato manje od traženog).',
    'Trošak osoblja iz ranijih razdoblja upisuje se kao jedan redak po osobi i mjesecu: kategorija troškova osoblja, osoba (član tima), datum u tom mjesecu, iznos i DA. Troškovi osoblja koji nisu potraživani nastaju samo iz odobrenih timesheetova.',
    'Trošak bez DA je obični evidentirani trošak i ulazi u sljedeći ZNS po uobičajenim pravilima.',
  ]) line(s);
  if (!ctx.personnel) line('Napomena: nemaš pristup podacima o osoblju – predložak nema stupac godišnjeg troška, a troškove osoblja iz ranijih razdoblja uvozi financijska služba ili ured za projekte.', 'warn');
  rows.push([]);
  for (const def of IMPORT_SHEETS) {
    const allowed = ctx.allowed.includes(def.key);
    line(`List „${def.label}”${allowed ? '' : ' – nemaš dozvolu za uvoz ovog lista na projektu'}`, 'bold');
    line(def.help);
    for (const c of templateColumns(def.key, ctx.personnel)) rows.push([{ v: `${c.label}${c.required ? ' *' : ''}`, s: 'text' }, { v: c.help, s: 'wrap' }]);
    rows.push([]);
  }
  return { name: 'Upute', rows, widths: [34, 110] };
}

function reference(ctx: TemplateContext): Sheet {
  const cols: { title: string[]; rows: Cell[][] }[] = [
    { title: ['Partner', 'Puni naziv', 'Uloga'], rows: ctx.partners.map((p) => [partnerLabel(p), p.name, `${p.orderNo}. ${p.role}${p.isSelf ? ' (vlastita institucija)' : ''}`]) },
    { title: ['Šifra kategorije', 'Kategorija', 'Napomena'], rows: ctx.categories.map((c) => [c.code, c.name, c.personnel && c.timeRecording ? 'trošak osoblja: samo iz timesheeta ili kao potraživan izvan sustava' : '']) },
    { title: ['Radni paket', 'Naziv', 'Mjeseci'], rows: ctx.workPackages.map((w) => [`WP${w.number}`, w.title, `M${w.startMonth}–M${w.endMonth}`]) },
    { title: ['Vrsta isporuke', 'Naziv'], rows: ctx.deliverableTypes.map((d) => [d.code, d.name]) },
    { title: ['Razina diseminacije', 'Naziv'], rows: ctx.disseminationLevels.map((d) => [d.code, d.name]) },
    { title: ['Član tima', 'Partner'], rows: (ctx.team ?? []).map((t) => [t.fullName, t.partner]) },
  ];
  // Skupine jedna do druge s praznim stupcem između: A–C, E–G, I–K, M–N, P–Q, S–T (rasponi padajućih popisa).
  const starts = [0, 4, 8, 12, 15, 18];
  const height = Math.max(1, ...cols.map((c) => c.rows.length));
  const rows: Cell[][] = Array.from({ length: height + 1 }, () => []);
  cols.forEach((g, gi) => {
    g.title.forEach((t, i) => { rows[0]![starts[gi]! + i] = header(t); });
    g.rows.forEach((r, ri) => r.forEach((v, i) => { rows[ri + 1]![starts[gi]! + i] = v; }));
  });
  return { name: 'Šifarnik', rows, freezeRows: 1, widths: [16, 34, 26, 3, 12, 34, 30, 3, 10, 34, 12, 3, 12, 30, 3, 12, 30, 3, 26, 16] };
}
