import type { ProgrammePackage } from './programme-package.js';
import { budgetLineIssues } from './budget.js';

/**
 * WP1.17 – uvoz postojećeg projekta iz Excela. Čiste funkcije: opis listova i stupaca predloška, prepoznavanje listova i
 * stupaca po nazivu (bez obzira na velika/mala slova, dijakritičke znakove, razmake i redoslijed; hrvatski i engleski
 * nazivi), čitanje vrijednosti ćelija (hrvatski i ISO zapis brojeva i datuma) i pravila koja dijele ručni unos i uvoz.
 * Datoteku čita API (`apps/api/src/import`); ovdje nema ničega što ovisi o formatu datoteke.
 */

export type ImportSheetKey = 'workPackages' | 'deliverables' | 'milestones' | 'budget' | 'team' | 'expenses';
export type ImportPermission = 'projects:write' | 'finance:write';
export type ColumnKind = 'text' | 'int' | 'money' | 'date' | 'bool' | 'month';

export interface ImportColumn {
  key: string;
  /** Naziv stupca u predlošku. */
  label: string;
  /** Dodatni prepoznati nazivi (hrvatski i engleski). */
  aliases: string[];
  kind: ColumnKind;
  required?: boolean;
  /** Uputa u predlošku (list „Upute”). */
  help: string;
  /** Stupac koji traži pristup podacima o osoblju (personnel:read). */
  personnel?: boolean;
}

export interface ImportSheetDef {
  key: ImportSheetKey;
  /** Naziv lista u predlošku. */
  label: string;
  aliases: string[];
  /** Dozvola na projektu koja je potrebna za uvoz lista. */
  permission: ImportPermission;
  columns: ImportColumn[];
  help: string;
}

const partnerCol: ImportColumn = { key: 'partner', label: 'Partner', aliases: ['partner', 'organizacija', 'korisnik sredstava', 'beneficiary', 'organisation', 'organization'], kind: 'text', help: 'Naziv ili kratica partnera s lista „Šifarnik” (prazno = vlastita institucija).' };
const wpCol = (required: boolean): ImportColumn => ({ key: 'workPackage', label: 'Radni paket', aliases: ['radni paket', 'wp', 'rp', 'work package', 'broj radnog paketa'], kind: 'text', required, help: `Broj radnog paketa (npr. 1 ili WP1) – postojećeg ili s lista „Radni paketi”${required ? '' : ' (neobavezno)'}.` });
const categoryCol: ImportColumn = { key: 'category', label: 'Kategorija', aliases: ['kategorija', 'sifra kategorije', 'sifra', 'kategorija troska', 'category', 'cost category', 'category code', 'code'], kind: 'text', required: true, help: 'Šifra kategorije troška iz paketa programa (list „Šifarnik”), npr. VU.' };

/** Listovi predloška u redoslijedu primjene (radni paketi prije isporuka i proračuna, tim prije troškova osoblja). */
export const IMPORT_SHEETS: readonly ImportSheetDef[] = [
  {
    key: 'workPackages', label: 'Radni paketi', aliases: ['radni paketi', 'radni paket', 'work packages', 'work package', 'wp', 'wps'], permission: 'projects:write',
    help: 'Radni paketi projekta. Postojeći radni paket s istim brojem i istim podacima se preskače.',
    columns: [
      { key: 'number', label: 'Broj', aliases: ['broj', 'br', 'rb', 'redni broj', 'number', 'no', 'wp number'], kind: 'int', help: 'Broj radnog paketa (1, 2, …); prazno = sljedeći slobodni.' },
      { key: 'title', label: 'Naziv', aliases: ['naziv', 'naslov', 'naziv radnog paketa', 'title', 'name'], kind: 'text', required: true, help: 'Naziv radnog paketa.' },
      { key: 'startMonth', label: 'Početni mjesec', aliases: ['pocetni mjesec', 'pocetak', 'od mjeseca', 'start month', 'start'], kind: 'month', required: true, help: 'Mjesec projekta u kojem počinje (1 = prvi mjesec projekta; može i M1).' },
      { key: 'endMonth', label: 'Završni mjesec', aliases: ['zavrsni mjesec', 'kraj', 'do mjeseca', 'end month', 'end'], kind: 'month', required: true, help: 'Mjesec projekta u kojem završava.' },
      { ...partnerCol, key: 'lead', label: 'Nositelj', aliases: ['nositelj', 'vodeci partner', 'lead', 'lead partner', 'lead beneficiary'], help: 'Partner nositelj (naziv ili kratica; neobavezno).' },
      { key: 'objectives', label: 'Ciljevi', aliases: ['ciljevi', 'cilj', 'opis', 'objectives', 'description'], kind: 'text', help: 'Ciljevi ili kratki opis (neobavezno).' },
    ],
  },
  {
    key: 'deliverables', label: 'Isporuke', aliases: ['isporuke', 'isporuka', 'deliverables', 'deliverable'], permission: 'projects:write',
    help: 'Isporuke po radnim paketima (broj isporuke D<WP>.<n> dodjeljuje se sam).',
    columns: [
      wpCol(true),
      { key: 'title', label: 'Naziv', aliases: ['naziv', 'naslov', 'naziv isporuke', 'title', 'name'], kind: 'text', required: true, help: 'Naziv isporuke.' },
      { key: 'type', label: 'Vrsta', aliases: ['vrsta', 'tip', 'vrsta isporuke', 'type'], kind: 'text', required: true, help: 'Šifra vrste isporuke iz paketa (list „Šifarnik”).' },
      { key: 'dissemination', label: 'Razina diseminacije', aliases: ['razina diseminacije', 'diseminacija', 'razina', 'dissemination', 'dissemination level'], kind: 'text', required: true, help: 'Šifra razine diseminacije iz paketa (list „Šifarnik”).' },
      { key: 'dueMonth', label: 'Mjesec isporuke', aliases: ['mjesec isporuke', 'mjesec', 'rok', 'rok mjesec', 'due month', 'month', 'due'], kind: 'month', required: true, help: 'Mjesec projekta u kojem je isporuka dospjela.' },
      { ...partnerCol, key: 'lead', label: 'Nositelj', aliases: ['nositelj', 'vodeci partner', 'lead', 'lead partner', 'lead beneficiary'], help: 'Partner nositelj (neobavezno).' },
    ],
  },
  {
    key: 'milestones', label: 'Prekretnice', aliases: ['prekretnice', 'prekretnica', 'miljokazi', 'milestones', 'milestone'], permission: 'projects:write',
    help: 'Prekretnice projekta (broj MS<n> dodjeljuje se sam).',
    columns: [
      { key: 'title', label: 'Naziv', aliases: ['naziv', 'naslov', 'naziv prekretnice', 'title', 'name'], kind: 'text', required: true, help: 'Naziv prekretnice.' },
      { key: 'dueMonth', label: 'Mjesec', aliases: ['mjesec', 'rok', 'mjesec prekretnice', 'due month', 'month', 'due'], kind: 'month', required: true, help: 'Mjesec projekta.' },
      { key: 'verification', label: 'Način provjere', aliases: ['nacin provjere', 'provjera', 'verifikacija', 'verification', 'means of verification'], kind: 'text', help: 'Kako se provjerava ostvarenje (neobavezno).' },
    ],
  },
  {
    key: 'budget', label: 'Proračun', aliases: ['proracun', 'budget', 'proracun projekta'], permission: 'finance:write',
    help: 'Ugovoreni proračun: jedan redak po partneru i kategoriji (i po želji radnom paketu). Zamjenjuje cijeli nacrt proračuna; zaključan proračun se ne mijenja.',
    columns: [
      partnerCol,
      categoryCol,
      wpCol(false),
      { key: 'amount', label: 'Iznos (EUR)', aliases: ['iznos', 'amount', 'planirano', 'ugovoreno', 'planned'], kind: 'money', required: true, help: 'Iznos u eurima (1.234,56 ili 1234.56).' },
      { key: 'description', label: 'Opis', aliases: ['opis', 'napomena', 'description', 'note'], kind: 'text', help: 'Napomena (neobavezno).' },
    ],
  },
  {
    key: 'team', label: 'Tim', aliases: ['tim', 'clanovi tima', 'tim projekta', 'team', 'team members'], permission: 'finance:write',
    help: 'Članovi tima. Postojeći član istog imena kod istog partnera se preskače.',
    columns: [
      { key: 'fullName', label: 'Ime i prezime', aliases: ['ime i prezime', 'osoba', 'ime', 'clan tima', 'full name', 'name', 'person'], kind: 'text', required: true, help: 'Ime i prezime.' },
      { key: 'role', label: 'Uloga', aliases: ['uloga', 'funkcija', 'radno mjesto', 'role', 'position'], kind: 'text', help: 'Uloga na projektu (neobavezno).' },
      partnerCol,
      { key: 'email', label: 'E-adresa korisnika', aliases: ['e adresa korisnika', 'e adresa', 'email', 'e mail', 'korisnicki racun', 'user email', 'user'], kind: 'text', help: 'E-adresa postojećeg korisnika ArQusa (neobavezno; povezuje osobu s računom za vlastite timesheetove).' },
      { key: 'annualCost', label: 'Godišnji trošak (EUR)', aliases: ['godisnji trosak', 'godisnja bruto placa', 'godisnja placa', 'annual cost', 'annual salary', 'yearly cost'], kind: 'money', personnel: true, help: 'Godišnji trošak osobe (plaća) – samo uz pristup podacima o osoblju.' },
    ],
  },
  {
    key: 'expenses', label: 'Troškovi', aliases: ['troskovi', 'trosak', 'evidencija troskova', 'expenses', 'costs'], permission: 'finance:write',
    help: 'Troškovi. Stupac „Potraživano izvan sustava” = DA za troškove koji su već bili u zahtjevu za nadoknadu predanom prije ArQusa.',
    columns: [
      { key: 'date', label: 'Datum', aliases: ['datum', 'datum troska', 'datum racuna', 'date'], kind: 'date', required: true, help: 'Datum troška (31.12.2026. ili 2026-12-31).' },
      partnerCol,
      categoryCol,
      wpCol(false),
      { key: 'description', label: 'Opis', aliases: ['opis', 'opis troska', 'description'], kind: 'text', help: 'Opis troška (obavezan, osim za trošak osoblja iz ranijeg razdoblja).' },
      { key: 'supplier', label: 'Dobavljač', aliases: ['dobavljac', 'izdavatelj racuna', 'izdavatelj', 'supplier', 'vendor'], kind: 'text', help: 'Dobavljač (neobavezno).' },
      { key: 'amount', label: 'Iznos (EUR)', aliases: ['iznos', 'amount', 'trazeni iznos'], kind: 'money', required: true, help: 'Iznos u eurima.' },
      { key: 'evidenceRef', label: 'Dokaz (broj računa)', aliases: ['dokaz', 'broj racuna', 'racun', 'oznaka dokaza', 'evidence', 'invoice', 'invoice number', 'evidence reference'], kind: 'text', help: 'Oznaka dokaza, npr. broj računa (neobavezno).' },
      { key: 'historic', label: 'Potraživano izvan sustava', aliases: ['potrazivano izvan sustava', 'vec potrazivano', 'potrazivano', 'ranije potrazivano', 'claimed outside', 'already claimed', 'claimed'], kind: 'bool', help: 'DA = trošak je već bio u zahtjevu za nadoknadu predanom prije ArQusa (ne ulazi u nove ZNS-ove). Prazno ili NE = obični trošak.' },
      { key: 'externalClaim', label: 'Razdoblje / ZNS', aliases: ['razdoblje zns', 'razdoblje', 'zns', 'zahtjev', 'claim period', 'claim'], kind: 'text', help: 'Za potraživane troškove: oznaka razdoblja ili zahtjeva (npr. „ZNS 1 – RP1”; neobavezno).' },
      { key: 'recognised', label: 'Priznati iznos (EUR)', aliases: ['priznati iznos', 'priznato', 'odobreno', 'recognised amount', 'recognized amount', 'approved amount'], kind: 'money', help: 'Za potraživane troškove: iznos koji je financijer priznao (prazno = priznat u cijelosti ili odluka još nije stigla).' },
      { key: 'reason', label: 'Razlog umanjenja', aliases: ['razlog umanjenja', 'razlog', 'reason', 'reduction reason'], kind: 'text', help: 'Za potraživane troškove s umanjenim priznatim iznosom: razlog (obavezan uz umanjenje).' },
      { key: 'person', label: 'Osoba', aliases: ['osoba', 'clan tima', 'ime i prezime', 'person', 'team member'], kind: 'text', help: 'Za trošak osoblja iz ranijeg razdoblja: član tima (s lista „Tim” ili postojeći).' },
    ],
  },
];

/** Listovi koje predložak sadrži, a uvoz ih ne čita (ne prijavljuju se kao nepoznati). */
export const IMPORT_IGNORED_SHEETS = ['upute', 'sifarnik', 'instructions', 'reference', 'codes'];

/** Naziv lista ili stupca za usporedbu: mala slova, bez dijakritike, bez sadržaja u zagradama, zvjezdica i interpunkcije. */
export function normalizeHeader(s: string): string {
  return s.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export const sheetDef = (key: ImportSheetKey): ImportSheetDef => IMPORT_SHEETS.find((s) => s.key === key)!;

/** List predloška prema nazivu lista u datoteci; `null` = nepoznat list, `'ignored'` = list uputa ili šifarnika. */
export function matchSheet(name: string): ImportSheetDef | 'ignored' | null {
  const n = normalizeHeader(name);
  if (IMPORT_IGNORED_SHEETS.includes(n)) return 'ignored';
  return IMPORT_SHEETS.find((s) => s.aliases.includes(n) || normalizeHeader(s.label) === n) ?? null;
}

const namesOf = (c: ImportColumn): string[] => [normalizeHeader(c.label), ...c.aliases.map(normalizeHeader)];

export interface HeaderMatch {
  /** Ključ stupca → indeks stupca u retku (0 = A). */
  columns: Map<string, number>;
  /** Naziv stupca kako ga je korisnik napisao (za poruke). */
  headers: Map<string, string>;
  /** Stupci koji se ne prepoznaju (zanemaruju se – korisnik smije dodati vlastite). */
  unknown: string[];
  /** Obavezni stupci koji nedostaju. */
  missing: ImportColumn[];
  /** Isti stupac dvaput. */
  duplicates: string[];
}

/** Prepoznavanje stupaca iz retka zaglavlja po nazivu, ne po položaju. */
export function matchHeaders(def: ImportSheetDef, header: readonly string[]): HeaderMatch {
  const columns = new Map<string, number>(); const headers = new Map<string, string>(); const unknown: string[] = []; const duplicates: string[] = [];
  header.forEach((raw, i) => {
    const text = raw.trim();
    if (!text) return;
    const n = normalizeHeader(text);
    const col = def.columns.find((c) => namesOf(c).includes(n));
    if (!col) { unknown.push(text); return; }
    if (columns.has(col.key)) { duplicates.push(text); return; }
    columns.set(col.key, i); headers.set(col.key, text);
  });
  return { columns, headers, unknown, duplicates, missing: def.columns.filter((c) => c.required && !columns.has(c.key)) };
}

/** Koliko naziva iz retka odgovara stupcima lista (za pronalazak retka zaglavlja i lista u CSV-u). */
export const headerScore = (def: ImportSheetDef, header: readonly string[]): number => matchHeaders(def, header).columns.size;

/* ---------- vrijednosti ćelija ---------- */

/** Ćelija kako je pročita čitač: tekst, broj, logička vrijednost, datum (ISO), greška formule ili formula bez spremljene vrijednosti. */
export type ImportCell =
  | { t: 's'; v: string } | { t: 'n'; v: number } | { t: 'b'; v: boolean } | { t: 'd'; v: string } | { t: 'e'; v: string } | { t: 'f' };

/** Prikaz vrijednosti ćelije u poruci (kako ju je korisnik vidio). */
export function cellText(c: ImportCell | undefined): string {
  if (!c) return '';
  switch (c.t) {
    case 's': return c.v;
    case 'n': return String(c.v).replace('.', ',');
    case 'b': return c.v ? 'DA' : 'NE';
    case 'd': return `${c.v.slice(8, 10)}.${c.v.slice(5, 7)}.${c.v.slice(0, 4)}.`;
    case 'e': return c.v;
    case 'f': return '(formula bez vrijednosti)';
  }
}

export const isEmptyCell = (c: ImportCell | undefined): boolean => !c || (c.t === 's' && !c.v.trim());

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
const FORMULA = 'ćelija ima formulu bez spremljene vrijednosti – otvori datoteku u Excelu ili LibreOfficeu i spremi je ponovno (uvoz ne izračunava formule)';
const commonFail = (c: ImportCell): Parsed<never> | null =>
  c.t === 'f' ? fail(FORMULA) : c.t === 'e' ? fail(`ćelija sadrži grešku formule (${c.v}) – ispravi formulu ili upiši vrijednost`) : null;

/** Tekst: brojevi i datumi pretvaraju se u tekst kako bi ih korisnik upisao. */
export function parseText(c: ImportCell): Parsed<string> {
  const f = commonFail(c); if (f) return f;
  if (c.t === 'n') return { ok: true, value: String(c.v) };
  return { ok: true, value: cellText(c).trim() };
}

/**
 * Broj iz teksta u hrvatskom ili engleskom zapisu: „1.234,56”, „1234,56”, „1 234,56 €”, „1234.56”, „1,234.56”, „20.000” (tisuće).
 * Kad su prisutni i točka i zarez, decimalni je onaj zadnji; sam zarez je decimalni (osim više zareza – tisuće).
 */
export function parseNumberText(input: string): number | null {
  let s = input.replace(/[\s\u00a0\u202f]|\u20ac|eur/gi, '');
  if (!s) return null;
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const neg = s.startsWith('-'); if (neg) s = s.slice(1);
  const lastDot = s.lastIndexOf('.'); const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ','; const th = dec === '.' ? ',' : '.';
    if (s.indexOf(dec) !== s.lastIndexOf(dec)) return null;
    const [int, frac] = s.split(dec) as [string, string];
    if (!new RegExp(`^\\d{1,3}(\\${th}\\d{3})*$`).test(int)) return null;
    s = `${int.split(th).join('')}.${frac}`;
  } else if (lastComma >= 0) {
    s = s.indexOf(',') !== lastComma ? (/^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : '') : s.replace(',', '.');
  } else if (lastDot >= 0 && s.indexOf('.') !== lastDot) {
    s = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : '';
  } else if (/^\d{1,3}\.\d{3}$/.test(s)) {
    s = s.replace('.', ''); // „20.000” – hrvatski zapis tisuća
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/** Iznos u eurima → centi (cijeli broj, najviše dvije decimale, nenegativan, do 1 mlrd. EUR). */
export function parseMoney(c: ImportCell): Parsed<number> {
  const f = commonFail(c); if (f) return f;
  let n: number | null;
  if (c.t === 'n') n = c.v;
  else if (c.t === 's') n = parseNumberText(c.v);
  else return fail('očekuje se iznos u eurima (npr. 1.234,56)');
  if (n === null) return fail('nije prepoznat iznos – upiši broj, npr. 1.234,56 ili 1234.56');
  if (n < 0) return fail('iznos ne smije biti negativan (ispravak se uvozi kao zaseban trošak u sustavu, ne negativnim iznosom)');
  const cents = n * 100; const rounded = Math.round(cents);
  if (Math.abs(cents - rounded) > 1e-6 * Math.max(1, Math.abs(cents))) return fail('iznos ima više od dvije decimale – zaokruži na cente');
  if (rounded > 100_000_000_000) return fail('iznos je prevelik (najviše 1.000.000.000,00 EUR)');
  return { ok: true, value: rounded };
}

/** Prefiks mjeseca projekta („M3”, „mj. 3”) i radnog paketa („WP2”, „RP 2”). */
export const MONTH_PREFIX = /^(?:mjesec|mj\.?|m)\s*/i;
export const WP_PREFIX = /^(?:radni paket|wp|rp)\s*/i;

/** Cijeli broj (redni broj, mjesec projekta); `prefix` – dopušteni prefiks ispred broja (npr. „M3”). */
export function parseInteger(c: ImportCell, prefix?: RegExp): Parsed<number> {
  const f = commonFail(c); if (f) return f;
  let n: number | null = null;
  if (c.t === 'n') n = c.v;
  else if (c.t === 's') {
    const s = prefix ? c.v.trim().replace(prefix, '') : c.v.trim();
    n = /^\d{1,9}$/.test(s) ? Number(s) : null;
  }
  if (n === null || !Number.isInteger(n)) return fail('očekuje se cijeli broj');
  return { ok: true, value: n };
}

const realDate = (y: number, m: number, d: number): string | null => {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/**
 * Excelov serijski broj datuma → ISO. Sustav 1900: dan 1 = 1. 1. 1900., uz Excelovu namjernu grešku – nepostojeći
 * 29. 2. 1900. (dan 60); za dane ≥ 61 pomak je zato dan manje. Sustav 1904 (stari Mac): dan 0 = 1. 1. 1904.
 * Vrijeme u danu (decimalni dio) se zanemaruje. Dan 60 u sustavu 1900 nije datum (null).
 */
export function excelSerialToIso(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const day = Math.floor(serial);
  let ms: number;
  if (date1904) ms = Date.UTC(1904, 0, 1) + day * 86_400_000;
  else {
    if (day === 60) return null;
    ms = Date.UTC(1899, 11, 31) + (day < 60 ? day : day - 1) * 86_400_000;
  }
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Datum: ćelija datuma, „31.12.2026.”, „31. 12. 2026”, ISO „2026-12-31”; broj bez formata datuma kao Excelov serijski broj.
 * Zapis s kosom crtom („02/10/2026”) se odbija: u engleskom zapisu je mjesec prvi, u europskom dan – nije jednoznačan.
 */
export function parseDate(c: ImportCell, date1904 = false): Parsed<string> {
  const f = commonFail(c); if (f) return f;
  if (c.t === 'd') return { ok: true, value: c.v };
  if (c.t === 'n') {
    const iso = Number.isInteger(c.v) && c.v > 20_000 && c.v < 80_000 ? excelSerialToIso(c.v, date1904) : null;
    return iso ? { ok: true, value: iso } : fail('očekuje se datum (npr. 31.12.2026.) – broj nije prepoznat kao datum');
  }
  if (c.t !== 's') return fail('očekuje se datum (npr. 31.12.2026.)');
  const s = c.v.trim();
  if (/^\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{2,4}$/.test(s)) return fail('datum s kosom crtom nije jednoznačan (dan/mjesec ili mjesec/dan) – upiši 31.12.2026. ili 2026-12-31');
  let m = /^(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})\.?$/.exec(s);
  if (m) { const iso = realDate(Number(m[3]), Number(m[2]), Number(m[1])); return iso ? { ok: true, value: iso } : fail('datum ne postoji'); }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (m) { const iso = realDate(Number(m[1]), Number(m[2]), Number(m[3])); return iso ? { ok: true, value: iso } : fail('datum ne postoji'); }
  return fail('nije prepoznat datum – upiši npr. 31.12.2026. ili 2026-12-31');
}

/** DA/NE: da, ne, x, yes, no, true, false, 1, 0, ✓; prazno = NE. */
export function parseBool(c: ImportCell): Parsed<boolean> {
  const f = commonFail(c); if (f) return f;
  if (c.t === 'b') return { ok: true, value: c.v };
  if (c.t === 'n' && (c.v === 0 || c.v === 1)) return { ok: true, value: c.v === 1 };
  const s = normalizeHeader(cellText(c));
  // „TOČNO”/„NETOČNO” – logičke vrijednosti u hrvatskom LibreOfficeu i Excelu (npr. u CSV-u).
  if (['da', 'd', 'x', 'yes', 'y', 'true', 'tocno', 'istina', '1', 'potrazivano'].includes(s) || cellText(c).trim() === '✓') return { ok: true, value: true };
  if (['ne', 'n', 'no', 'false', 'netocno', 'laz', '0', ''].includes(s)) return { ok: true, value: false };
  return fail('upiši DA ili NE');
}

/* ---------- pravila koja dijele ručni unos i uvoz ---------- */

/** Raspon mjeseci radnog paketa, zadatka, isporuke ili prekretnice unutar trajanja projekta. */
export function monthRangeIssue(durationMonths: number | null, start: number, end: number, what: string): string | null {
  if (end < start) return `${what}: završni mjesec je prije početnog`;
  if (durationMonths && end > durationMonths) return `${what}: mjesec ${end} je izvan trajanja projekta (${durationMonths} mj.)`;
  return null;
}

/** Šifre vrste isporuke i razine diseminacije iz paketa programa. */
export function deliverableCodeIssues(pkg: ProgrammePackage, type?: string, dissemination?: string): string[] {
  const types = pkg.deliverableTypes?.map((d) => d.code);
  const levels = pkg.disseminationLevels?.map((d) => d.code);
  const out: string[] = [];
  if (type && types?.length && !types.includes(type)) out.push(`Vrsta isporuke "${type}" ne postoji u paketu (dopušteno: ${types.join(', ')})`);
  if (dissemination && levels?.length && !levels.includes(dissemination)) out.push(`Razina diseminacije "${dissemination}" ne postoji u paketu (dopušteno: ${levels.join(', ')})`);
  return out;
}

export interface ExpenseRuleContext {
  partnerIds: ReadonlySet<string>;
  workPackageIds: ReadonlySet<string>;
  /** Početak i kraj projekta (ISO) ili null ako trajanje nije poznato. */
  projectStart: string | null;
  projectEnd: string | null;
}
export interface ExpenseRuleInput { partnerId: string; categoryCode: string; workPackageId?: string | null; date: string; amount: number }

/**
 * Pravila troška (invarijante 3 i 6) – ista za ručni unos (`ExpensesService`) i uvoz: kategorija u koju se smije unositi,
 * partner na projektu, iznos u centima, datum unutar trajanja projekta, radni paket projekta, trošak osoblja samo iz
 * timesheeta. `historicPersonnel` – trošak osoblja iz ranijeg razdoblja koji je već potraživan izvan sustava (WP1.17):
 * jedina iznimka od pravila „trošak osoblja nastaje odobrenjem timesheeta”.
 */
export function expenseRuleIssues(pkg: ProgrammePackage, ctx: ExpenseRuleContext, input: ExpenseRuleInput, opts: { historicPersonnel?: boolean } = {}): string[] {
  const issues = budgetLineIssues(pkg, [{ partnerId: input.partnerId, categoryCode: input.categoryCode, amount: input.amount }], ctx.partnerIds).map((i) => i.replace(/^redak 1: /, ''));
  if (pkg.personnelRule?.timeRecordingRequired && input.categoryCode === pkg.personnelRule.categoryCode && !opts.historicPersonnel) {
    issues.push(`trošak osoblja (${input.categoryCode}) nastaje odobrenjem timesheeta, ne ručnim unosom`);
  }
  if (ctx.projectStart && ctx.projectEnd && (input.date < ctx.projectStart || input.date > ctx.projectEnd)) issues.push(`datum ${input.date} je izvan trajanja projekta (${ctx.projectStart} – ${ctx.projectEnd})`);
  if (input.workPackageId && !ctx.workPackageIds.has(input.workPackageId)) issues.push(`radni paket ${input.workPackageId} nije na projektu`);
  return issues;
}

/** Je li kategorija trošak osoblja paketa (za troškove osoblja iz ranijih razdoblja). */
export const isPersonnelCategory = (pkg: ProgrammePackage, code: string): boolean => !!pkg.personnelRule?.categoryCode && pkg.personnelRule.categoryCode === code;

/**
 * Trošak potraživan izvan sustava (WP1.17): priznati iznos (prazno = cijeli traženi) ne smije biti veći od traženog,
 * a umanjenje traži razlog (isto pravilo kao odluka o ZNS-u u sustavu).
 */
export function historicIssues(input: { amount: number; recognised: number | null; reason: string | null }, minReason = 5): string[] {
  const out: string[] = [];
  if (input.recognised !== null && input.recognised > input.amount) out.push('priznati iznos je veći od traženog');
  if (input.recognised !== null && input.recognised < input.amount && (input.reason ?? '').trim().length < minReason) out.push('razlog je obavezan kad je priznati iznos manji od traženog (najmanje 5 znakova)');
  return out;
}
