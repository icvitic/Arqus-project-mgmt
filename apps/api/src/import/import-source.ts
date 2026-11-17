import { headerScore, IMPORT_SHEETS, matchHeaders, matchSheet, sheetDef, cellText, type HeaderMatch, type ImportCell, type ImportSheetDef, type ImportSheetKey } from '@arqus/domain';
import { readCsv } from './csv-reader';
import { IMPORT_LIMITS, ImportFileError } from './limits';
import { readXlsx, rejectCompoundFile, type SheetRow } from './xlsx-reader';

/**
 * WP1.17 – datoteka za uvoz → listovi predloška s prepoznatim stupcima. Listovi se prepoznaju po nazivu (hrvatski ili
 * engleski, bez obzira na velika slova i dijakritiku), stupci po nazivu u retku zaglavlja (prvi od prvih 15 redaka koji
 * odgovara stupcima lista – retci iznad, npr. naslov, se preskaču). Korisnik smije mijenjati redoslijed stupaca i dodavati
 * vlastite (zanemaruju se). CSV je jedan list: određuje ga izbor u sučelju, naziv datoteke ili zaglavlje.
 */
export interface SourceSheet {
  def: ImportSheetDef;
  /** Naziv lista u datoteci. */
  name: string;
  hidden: boolean;
  /** Redak zaglavlja (broj retka u Excelu) i prepoznati stupci; null ako zaglavlje nije pronađeno. */
  headerRow: number | null;
  match: HeaderMatch | null;
  /** Retci s podacima (ispod zaglavlja), s brojevima redaka kako ih korisnik vidi. */
  rows: SheetRow[];
}
export interface ImportSource {
  format: 'xlsx' | 'csv';
  sheets: SourceSheet[];
  /** Listovi koji nisu listovi predloška (zanemaruju se). */
  ignoredSheets: string[];
  warnings: string[];
  date1904: boolean;
  /** Greške na razini datoteke (npr. isti list dvaput). */
  errors: { sheet: string; message: string }[];
}

const HEADER_SCAN_ROWS = 15;

/** Redak zaglavlja: među prvih 15 redaka onaj s najviše prepoznatih stupaca (barem jedan obavezni ili dva stupca). */
function findHeader(def: ImportSheetDef, rows: SheetRow[]): { index: number; match: HeaderMatch } | null {
  let best: { index: number; match: HeaderMatch; score: number } | null = null;
  rows.slice(0, HEADER_SCAN_ROWS).forEach((r, index) => {
    const texts = r.cells.map((c) => (c ? cellText(c) : ''));
    const match = matchHeaders(def, texts);
    const score = match.columns.size;
    const requiredFound = def.columns.filter((c) => c.required && match.columns.has(c.key)).length;
    if ((score >= 2 || requiredFound >= 1) && (!best || score > best.score)) best = { index, match, score };
  });
  return best ? { index: (best as { index: number }).index, match: (best as { match: HeaderMatch }).match } : null;
}

function toSheet(def: ImportSheetDef, name: string, hidden: boolean, rows: SheetRow[]): SourceSheet {
  const h = findHeader(def, rows);
  if (!h) return { def, name, hidden, headerRow: null, match: null, rows: rows.filter((r) => r.cells.some((c) => c !== undefined)) };
  return { def, name, hidden, headerRow: rows[h.index]!.n, match: h.match, rows: rows.slice(h.index + 1) };
}

const hasText = (c: ImportCell | undefined) => !!c && !(c.t === 's' && !c.v.trim());

export function readImportSource(buf: Buffer, fileName: string, csvSheet?: ImportSheetKey | null): ImportSource {
  if (!buf.length) throw new ImportFileError('Datoteka je prazna.', 'import_file_invalid');
  if (buf.length > IMPORT_LIMITS.maxFileBytes) throw new ImportFileError(`Datoteka je prevelika (najviše ${IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB).`, 'import_file_too_large');
  const lower = fileName.toLowerCase();
  if (/\.xlsm$/.test(lower)) throw new ImportFileError('Datoteke s makronaredbama (.xlsm) uvoz ne prima. Spremi tablicu kao „Excelova radna knjiga (.xlsx)”.', 'import_file_xlsm');
  if (/\.xlsb$/.test(lower)) throw new ImportFileError('Binarne radne knjige (.xlsb) uvoz ne prima. Spremi tablicu kao „Excelova radna knjiga (.xlsx)”.', 'import_file_xlsb');
  if (/\.(ods|numbers)$/.test(lower)) throw new ImportFileError('Uvoz čita .xlsx i .csv. Spremi tablicu kao „Excelova radna knjiga (.xlsx)”.', 'import_file_invalid');
  rejectCompoundFile(buf);
  const isZip = buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
  if (isZip) return fromXlsx(buf);
  if (/\.xlsx$/.test(lower)) throw new ImportFileError('Datoteka ima nastavak .xlsx, ali nije radna knjiga Excela (sadržaj nije ZIP). Otvori je u Excelu ili LibreOfficeu i spremi ponovno kao .xlsx.', 'import_file_invalid');
  return fromCsv(buf, fileName, csvSheet ?? null);
}

function fromXlsx(buf: Buffer): ImportSource {
  const ignoredSheets: string[] = []; const errors: ImportSource['errors'] = [];
  const wb = readXlsx(buf, (name) => {
    const m = matchSheet(name);
    return !!m && m !== 'ignored';
  });
  const warnings = [...wb.warnings];
  const seen = new Map<ImportSheetKey, string>();
  const sheets: SourceSheet[] = [];
  for (const s of wb.sheets) {
    const m = matchSheet(s.name);
    if (m === 'ignored') continue;
    if (!m) { ignoredSheets.push(s.name); continue; }
    if (seen.has(m.key)) { errors.push({ sheet: s.name, message: `List „${s.name}” i list „${seen.get(m.key)}” su isti list predloška (${m.label}) – ostavi samo jedan.` }); continue; }
    seen.set(m.key, s.name);
    if (s.hidden) warnings.push(`List „${s.name}” je skriven, ali se uvozi jer nosi naziv lista predloška.`);
    sheets.push(toSheet(m, s.name, s.hidden, s.rows));
  }
  return { format: 'xlsx', sheets, ignoredSheets, warnings, date1904: wb.date1904, errors };
}

function fromCsv(buf: Buffer, fileName: string, csvSheet: ImportSheetKey | null): ImportSource {
  const { rows } = readCsv(buf);
  let def: ImportSheetDef | null = csvSheet ? sheetDef(csvSheet) : null;
  if (!def) {
    const byName = matchSheet(fileName.replace(/\.[^.]*$/, '').replace(/^.*[\\/]/, '').replace(/[_-]+/g, ' '));
    if (byName && byName !== 'ignored') def = byName;
  }
  if (!def) {
    // Po zaglavlju: list s najviše prepoznatih stupaca u prvih 15 redaka (svi obavezni stupci moraju biti prisutni).
    let best: { def: ImportSheetDef; score: number } | null = null;
    for (const d of IMPORT_SHEETS) for (const r of rows.slice(0, HEADER_SCAN_ROWS)) {
      const texts = r.cells.map((c) => (c ? cellText(c) : ''));
      const m = matchHeaders(d, texts);
      const score = headerScore(d, texts);
      if (!m.missing.length && score >= 2 && (!best || score > best.score)) best = { def: d, score };
    }
    def = best?.def ?? null;
  }
  if (!def) throw new ImportFileError('Nije prepoznato koji list predloška CSV datoteka sadrži. Odaberi list u sučelju ili nazovi datoteku prema listu (npr. troskovi.csv), i provjeri da prvi redak ima nazive stupaca iz predloška.', 'import_csv_sheet');
  const sheet = toSheet(def, `${def.label} (CSV)`, false, rows);
  return { format: 'csv', sheets: [sheet], ignoredSheets: [], warnings: [], date1904: false, errors: [] };
}

/** Je li redak prazan u stupcima koje list prepoznaje (vlastiti stupci korisnika ne čine redak nepraznim). */
export function isBlankRow(sheet: SourceSheet, row: SheetRow): boolean {
  if (!sheet.match) return !row.cells.some(hasText);
  return ![...sheet.match.columns.values()].some((i) => hasText(row.cells[i]));
}
