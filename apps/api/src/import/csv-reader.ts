import { IMPORT_LIMITS, ImportFileError } from './limits';
import type { SheetRow } from './xlsx-reader';

/**
 * WP1.17 – CSV kao zamjena za jedan list: UTF-8 (s BOM-om ili bez), separator `;` (hrvatski Excel), `,` ili tabulator –
 * prepoznaje se iz retka zaglavlja (izvan navodnika). Navodnici po RFC 4180 (`""` unutar navodnika, prijelom retka
 * unutar navodnika). Sve vrijednosti su tekst; brojeve i datume u hrvatskom zapisu čitaju pravila stupaca. Broj retka je
 * redak u datoteci u kojem zapis počinje (kao u Excelu kad se CSV otvori).
 */
export function readCsv(buf: Buffer, limits = IMPORT_LIMITS): { rows: SheetRow[]; separator: string } {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch {
    throw new ImportFileError('CSV datoteka nije u kodiranju UTF-8. U Excelu odaberi Spremi kao → „CSV UTF-8 (razdvojeno zarezima)”, u LibreOfficeu skup znakova „Unicode (UTF-8)”.', 'import_file_encoding');
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.includes('\u0000')) throw new ImportFileError('Datoteka nije tekstualna CSV datoteka (sadrži binarne znakove). Spremi tablicu kao .xlsx ili CSV UTF-8.', 'import_file_invalid');
  const separator = detectSeparator(text);
  const rows: SheetRow[] = [];
  let line = 1; let start = 1; let field = ''; let cells: string[] = []; let quoted = false; let i = 0; let fieldQuoted = false;
  const push = () => {
    cells.push(fieldQuoted ? field : field.trim());
    field = ''; fieldQuoted = false;
  };
  const endRecord = () => {
    push();
    if (cells.some((c) => c !== '')) {
      if (rows.length >= limits.maxRows) throw new ImportFileError(`CSV datoteka ima više od ${limits.maxRows} redaka s podacima. Podijeli podatke u više datoteka.`, 'import_file_too_large');
      if (cells.some((c) => c.length > limits.maxCellChars)) throw new ImportFileError(`CSV, redak ${start}: tekst u polju je dulji od ${limits.maxCellChars} znakova.`, 'import_file_invalid');
      rows.push({ n: start, cells: cells.slice(0, limits.maxColumns).map((c) => (c === '' ? undefined : { t: 's' as const, v: c })) });
    }
    cells = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      if (ch === '\n') line++;
      field += ch; i++; continue;
    }
    if (ch === '"' && field.trim() === '') { quoted = true; fieldQuoted = true; field = ''; i++; continue; }
    if (ch === separator) { push(); i++; continue; }
    if (ch === '\r' || ch === '\n') {
      endRecord();
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++; line++; start = line; continue;
    }
    field += ch; i++;
  }
  if (quoted) throw new ImportFileError(`CSV, redak ${start}: navodnik nije zatvoren.`, 'import_file_invalid');
  if (field !== '' || cells.length) endRecord();
  return { rows, separator };
}

/** Separator iz prvog retka koji nije prazan: najčešći od `;`, `,` i tabulatora izvan navodnika (izjednačeno: `;`). */
export function detectSeparator(text: string): string {
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 };
  let quoted = false; let seen = false;
  for (let i = 0; i < text.length && i < 64 * 1024; i++) {
    const ch = text[i]!;
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) { if (seen) break; continue; }
    else if (!quoted && ch in counts) counts[ch]!++;
    if (ch.trim()) seen = true;
  }
  return counts['\t']! > counts[';']! && counts['\t']! > counts[',']! ? '\t' : counts[',']! > counts[';']! ? ',' : ';';
}
