import { excelSerialToIso, type ImportCell } from '@arqus/domain';
import { IMPORT_LIMITS, ImportFileError } from './limits';
import { openZip, type ZipArchive } from './zip-reader';
import { parseXml, xmlText } from './xml';

/**
 * WP1.17 – čitač radne knjige XLSX (Office Open XML, SpreadsheetML) bez vanjskih ovisnosti, za datoteke koje šalje
 * korisnik. Čita: dijeljene nizove (i obogaćeni tekst), tekst u ćeliji (`inlineStr`), spremljene vrijednosti formula
 * (formule se nikad ne izračunavaju; formula bez spremljene vrijednosti je posebna oznaka), brojeve, logičke vrijednosti,
 * greške formula, datume zapisane kao serijski broj uz format datuma (sustav 1900 s Excelovom greškom prijestupne 1900.
 * i sustav 1904) i ISO datume (`t="d"`). Prazne ćelije i retci su prazni; spojene ćelije – vrijednost je u prvoj ćeliji
 * (ostale su prazne, kako ih Excel i zapisuje). Skriveni listovi se čitaju samo kad ih pozivatelj zatraži po nazivu.
 * Tekst koji izgleda kao formula („=SUM(…)”) ostaje tekst.
 *
 * Odbija: .xls (stari binarni format), datoteke zaštićene lozinkom, .xlsm (makronaredbe) i .xlsb (binarni XLSX).
 */
export interface SheetRow { /** Broj retka kako ga korisnik vidi u Excelu. */ n: number; cells: (ImportCell | undefined)[] }
export interface ReadSheet { name: string; hidden: boolean; rows: SheetRow[] }
export interface ReadWorkbook {
  format: 'xlsx' | 'csv';
  /** Svi listovi radne knjige (redoslijed iz datoteke); `rows` samo za listove koje je pozivatelj tražio. */
  sheets: (ReadSheet & { read: boolean })[];
  date1904: boolean;
  warnings: string[];
}

const CFB = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const fileError = (msg: string, code = 'import_file_invalid') => new ImportFileError(msg, code);

/** Prepoznavanje binarnih Officeovih datoteka (OLE/CFB): šifrirani OOXML (lozinka) ili stari .xls. */
export function rejectCompoundFile(buf: Buffer): void {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(CFB)) return;
  if (buf.includes(Buffer.from('EncryptedPackage', 'utf16le')) || buf.includes(Buffer.from('EncryptionInfo', 'utf16le'))) {
    throw fileError('Datoteka je zaštićena lozinkom (šifrirana). Otvori je, ukloni lozinku (Datoteka → Informacije → Zaštiti radnu knjigu → Šifriraj lozinkom) i spremi kao .xlsx.', 'import_file_encrypted');
  }
  throw fileError('Datoteka je u starom formatu Excel 97–2003 (.xls), koji uvoz ne čita. Otvori je u Excelu ili LibreOfficeu i spremi kao „Excelova radna knjiga (.xlsx)”.', 'import_file_xls');
}

/** Ugrađeni formati brojeva koji su datumi/vremena (ECMA-376, 18.8.30). */
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** Je li vlastiti format broja datum: nakon uklanjanja teksta u navodnicima, znakova s `\`, `[…]` blokova (boja, valuta, vrijeme u satima) ostaje d, m, y, h ili s. */
export function isDateFormat(code: string): boolean {
  const s = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '').replace(/_.|\*./g, '');
  if (/general/i.test(s)) return false;
  return /[dmyhs]/i.test(s);
}

/** Putanja dijela iz odnosa (`Target`) – samo obrada niza u memoriji, nikad datotečni sustav. */
function resolvePart(baseDir: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : `${baseDir}${target}`).split('/');
  const out: string[] = [];
  for (const p of parts) { if (!p || p === '.') continue; if (p === '..') out.pop(); else out.push(p); }
  return out.join('/');
}
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '');
const relsOf = (path: string) => `${dirOf(path)}_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`;

function readRels(zip: ZipArchive, path: string): { id: string; type: string; target: string; external: boolean }[] {
  const b = zip.read(path);
  if (!b) return [];
  const out: { id: string; type: string; target: string; external: boolean }[] = [];
  parseXml(xmlText(b), path, { open: (name, a) => { if (name === 'Relationship') out.push({ id: a.Id ?? '', type: a.Type ?? '', target: a.Target ?? '', external: a.TargetMode === 'External' }); } });
  return out;
}

/** Stupac iz oznake ćelije (`AB12` → 27, 0 = A); -1 ako oznaka nije ispravna. */
export function columnIndex(ref: string): number {
  let n = 0; let i = 0;
  for (; i < ref.length; i++) { const c = ref.charCodeAt(i); if (c >= 65 && c <= 90) n = n * 26 + (c - 64); else if (c >= 97 && c <= 122) n = n * 26 + (c - 96); else break; }
  return i === 0 || i > 3 ? -1 : n - 1;
}

export function readXlsx(buf: Buffer, want: (name: string, hidden: boolean) => boolean, limits = IMPORT_LIMITS): ReadWorkbook {
  rejectCompoundFile(buf);
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) throw fileError('Datoteka nije radna knjiga .xlsx (ni .csv). Spremi tablicu kao „Excelova radna knjiga (.xlsx)” ili CSV (UTF-8).');
  const zip = openZip(buf, limits);
  const warnings: string[] = [];

  const ct = zip.read('[Content_Types].xml');
  if (!ct) throw fileError('Datoteka je ZIP, ali nije radna knjiga Excela (nedostaje [Content_Types].xml). Spremi tablicu kao .xlsx.');
  const ctText = xmlText(ct);
  if (/macroEnabled/i.test(ctText) || zip.names().some((n) => /vbaProject\.bin$/i.test(n))) {
    throw fileError('Datoteka sadrži makronaredbe (.xlsm), koje uvoz ne prima. Spremi je kao „Excelova radna knjiga (.xlsx)” bez makronaredbi.', 'import_file_xlsm');
  }

  const root = readRels(zip, '_rels/.rels');
  const office = root.find((r) => /\/officeDocument$/.test(r.type) && !r.external);
  const wbPath = office ? resolvePart('', office.target) : 'xl/workbook.xml';
  const wbBuf = zip.read(wbPath);
  if (!wbBuf) throw fileError('Datoteka nije radna knjiga Excela (nedostaje workbook.xml). Spremi tablicu kao .xlsx.');
  if (/\.bin$/i.test(wbPath)) throw fileError('Datoteka je binarna radna knjiga (.xlsb). Spremi je kao „Excelova radna knjiga (.xlsx)”.', 'import_file_xlsb');

  let date1904 = false;
  const declared: { name: string; hidden: boolean; rid: string }[] = [];
  parseXml(xmlText(wbBuf), wbPath, {
    open: (name, a) => {
      if (name === 'workbookPr') date1904 = a.date1904 === '1' || a.date1904 === 'true';
      if (name === 'sheet') declared.push({ name: a.name ?? '', hidden: a.state === 'hidden' || a.state === 'veryHidden', rid: a.id ?? '' });
    },
  });
  if (declared.length > limits.maxSheets) throw fileError(`Radna knjiga ima ${declared.length} listova (najviše ${limits.maxSheets}).`);
  const wbDir = dirOf(wbPath);
  const rels = readRels(zip, relsOf(wbPath));
  const relById = new Map(rels.map((r) => [r.id, r]));

  // Stilovi: koji indeksi stila (cellXfs) imaju format datuma.
  const stylesRel = rels.find((r) => /\/styles$/.test(r.type));
  const dateXf: boolean[] = [];
  const stylesBuf = stylesRel ? zip.read(resolvePart(wbDir, stylesRel.target)) : null;
  if (stylesBuf) {
    const custom = new Map<number, string>(); let inXfs = false;
    parseXml(xmlText(stylesBuf), 'styles.xml', {
      open: (name, a) => {
        if (name === 'numFmt') custom.set(Number(a.numFmtId), a.formatCode ?? '');
        else if (name === 'cellXfs') inXfs = true;
        else if (name === 'xf' && inXfs) {
          const id = Number(a.numFmtId ?? 0);
          dateXf.push(custom.has(id) ? isDateFormat(custom.get(id)!) : BUILTIN_DATE.has(id));
        }
      },
      close: (name) => { if (name === 'cellXfs') inXfs = false; },
    });
  }

  // Dijeljeni nizovi (čitaju se samo ako se čita barem jedan list).
  let sst: string[] | null = null;
  const sharedStrings = (): string[] => {
    if (sst) return sst;
    sst = [];
    const rel = rels.find((r) => /\/sharedStrings$/.test(r.type));
    const b = rel ? zip.read(resolvePart(wbDir, rel.target)) : null;
    if (!b) return sst;
    let cur: string[] | null = null; let inT = false; let phonetic = 0;
    const list = sst;
    parseXml(xmlText(b), 'sharedStrings.xml', {
      open: (name) => {
        if (name === 'si') cur = [];
        else if (name === 'rPh') phonetic++;
        else if (name === 't' && cur && !phonetic) inT = true;
      },
      close: (name) => {
        if (name === 't') inT = false;
        else if (name === 'rPh') phonetic--;
        else if (name === 'si' && cur) {
          if (list.length >= limits.maxSharedStrings) throw fileError(`Radna knjiga ima previše različitih tekstova (više od ${limits.maxSharedStrings}).`);
          list.push(cur.join('')); cur = null;
        }
      },
      text: (t) => { if (inT && cur) cur.push(t); },
    });
    return sst;
  };

  const sheets: ReadWorkbook['sheets'] = [];
  for (const d of declared) {
    if (!want(d.name, d.hidden)) { sheets.push({ name: d.name, hidden: d.hidden, rows: [], read: false }); continue; }
    const rel = relById.get(d.rid);
    if (!rel || !/\/worksheet$/.test(rel.type)) throw fileError(`List „${d.name}” nije tablica (npr. list s grafikonom) i ne može se uvesti. Kopiraj podatke na običan list.`);
    const path = resolvePart(wbDir, rel.target);
    const b = zip.read(path);
    if (!b) throw fileError(`List „${d.name}” nedostaje u datoteci (datoteka je oštećena).`);
    const { rows, ignoredColumns } = readSheet(xmlText(b), d.name, dateXf, date1904, sharedStrings, limits);
    if (ignoredColumns) warnings.push(`List „${d.name}”: stupci iza ${columnLetter(limits.maxColumns - 1)} se zanemaruju.`);
    sheets.push({ name: d.name, hidden: d.hidden, rows, read: true });
  }
  return { format: 'xlsx', sheets, date1904, warnings };
}

export function columnLetter(i: number): string {
  let s = ''; let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function readSheet(xml: string, sheet: string, dateXf: boolean[], date1904: boolean, sst: () => string[], limits: typeof IMPORT_LIMITS) {
  const rows: SheetRow[] = [];
  let row: SheetRow | null = null; let lastRow = 0; let nextCol = 0; let ignoredColumns = false;
  // Ćelija u izradi.
  let cell: { col: number; t: string; s: number; ref: string } | null = null;
  let v: string[] = []; let inV = false; let hasF = false; let inIs = 0; let inT = false; let phonetic = 0; let isText: string[] = [];
  let inData = false;
  const where = (ref: string) => `list „${sheet}”, ćelija ${ref}`;
  const finishRow = () => { if (row && row.cells.some((c) => c !== undefined)) rows.push(row); row = null; };

  parseXml(xml, `list ${sheet}`, {
    open: (name, a, selfClosing) => {
      if (name === 'sheetData') { inData = true; return; }
      if (!inData) return;
      if (name === 'row') {
        finishRow();
        const n = a.r ? Number(a.r) : lastRow + 1;
        if (!Number.isInteger(n) || n < 1 || n > limits.maxRowNumber || n <= lastRow) throw fileError(`Datoteka nije ispravna: ${where(`u retku ${a.r ?? '?'}`)} – neispravan broj retka.`);
        lastRow = n; nextCol = 0; row = { n, cells: [] };
        return;
      }
      if (name === 'c') {
        if (!row) { lastRow++; row = { n: lastRow, cells: [] }; }
        const col = a.r ? columnIndex(a.r) : nextCol;
        if (col < 0) throw fileError(`Datoteka nije ispravna: ${where(a.r ?? '?')} – neispravna oznaka ćelije.`);
        nextCol = col + 1;
        cell = { col, t: a.t ?? 'n', s: Number(a.s ?? 0), ref: a.r ?? `${columnLetter(col)}${row.n}` };
        v = []; hasF = false; isText = [];
        if (selfClosing) cell = null; // prazna ćelija (samo stil)
        return;
      }
      if (!cell) return;
      if (name === 'v') inV = true;
      else if (name === 'f') hasF = true;
      else if (name === 'is') inIs++;
      else if (name === 'rPh') phonetic++;
      else if (name === 't' && inIs && !phonetic) inT = true;
    },
    close: (name) => {
      if (name === 'sheetData') { finishRow(); inData = false; return; }
      if (!inData) return;
      if (name === 'v') inV = false;
      else if (name === 't') inT = false;
      else if (name === 'is') inIs--;
      else if (name === 'rPh') phonetic--;
      else if (name === 'row') finishRow();
      else if (name === 'c' && cell && row) {
        const value = toCell(cell, v.join(''), hasF, isText.join(''));
        if (value !== undefined) {
          if (cell.col >= limits.maxColumns) ignoredColumns = true;
          else {
            if (value.t === 's' && value.v.length > limits.maxCellChars) throw fileError(`${where(cell.ref)}: tekst je dulji od ${limits.maxCellChars} znakova.`);
            row.cells[cell.col] = value;
          }
        }
        if (rows.length >= limits.maxRows && row.cells.some((c) => c !== undefined)) throw fileError(`List „${sheet}” ima više od ${limits.maxRows} redaka s podacima. Podijeli podatke u više datoteka.`);
        cell = null;
      }
    },
    text: (t) => { if (inV) v.push(t); else if (inT) isText.push(t); },
  });
  finishRow();

  function toCell(c: { t: string; s: number; ref: string }, raw: string, formula: boolean, inline: string): ImportCell | undefined {
    switch (c.t) {
      case 's': {
        if (raw === '') return undefined;
        const i = Number(raw); const list = sst();
        if (!Number.isInteger(i) || i < 0 || i >= list.length) throw fileError(`Datoteka nije ispravna: ${where(c.ref)} upućuje na nepostojeći tekst.`);
        return list[i] === '' ? undefined : { t: 's', v: list[i]! };
      }
      case 'inlineStr': return inline === '' ? undefined : { t: 's', v: inline };
      case 'str': return raw === '' ? (formula ? { t: 'f' } : undefined) : { t: 's', v: raw };
      case 'b': return raw === '' ? (formula ? { t: 'f' } : undefined) : { t: 'b', v: raw.trim() === '1' || raw.trim().toLowerCase() === 'true' };
      case 'e': return { t: 'e', v: raw || '#GREŠKA' };
      case 'd': {
        if (raw === '') return formula ? { t: 'f' } : undefined;
        const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
        if (!m) throw fileError(`Datoteka nije ispravna: ${where(c.ref)} – neispravan datum „${raw.slice(0, 30)}”.`);
        return { t: 'd', v: m[1]! };
      }
      default: {
        if (raw.trim() === '') return formula ? { t: 'f' } : undefined;
        const n = Number(raw);
        if (!Number.isFinite(n)) throw fileError(`Datoteka nije ispravna: ${where(c.ref)} – neispravan broj „${raw.slice(0, 30)}”.`);
        if (dateXf[c.s]) { const iso = excelSerialToIso(n, date1904); if (iso) return { t: 'd', v: iso }; }
        return { t: 'n', v: n };
      }
    }
  }
  return { rows, ignoredColumns };
}
