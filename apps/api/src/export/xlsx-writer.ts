import { zipToBuffer } from './zip-writer';

/**
 * Minimalni XLSX pisač (Office Open XML / SpreadsheetML, ECMA-376) za izvoz troškova ZNS-a (WP1.16b), bez vanjskih
 * ovisnosti. Proizvodi radnu knjigu s više listova: tekst (dijeljeni nizovi), brojevi, datumi (serijski broj uz format
 * datuma), novac (dvije decimale), postotak, podebljani naslovi, zamrznuti redci zaglavlja, širine stupaca, spajanje
 * ćelija i automatski filtar. Sadržaj je deterministički (bez vremena izrade), pa dva izvoza istih podataka daju istu datoteku.
 */

export type CellStyle = 'text' | 'bold' | 'title' | 'warn' | 'header' | 'date' | 'month' | 'money' | 'moneyBold' | 'int' | 'hours' | 'percent' | 'wrap';
export type CellValue = string | number | null | undefined;
/** Ćelija: jednostavna vrijednost (tekst ili broj) ili vrijednost sa stilom. Datum: ISO `GGGG-MM-DD` uz stil `date`/`month`. */
export type Cell = CellValue | { v: CellValue; s?: CellStyle };

export interface Sheet {
  name: string;
  rows: Cell[][];
  /** Širine stupaca u znakovima. */
  widths?: number[];
  /** Broj zamrznutih redaka (zaglavlje ostaje vidljivo pri pomicanju). */
  freezeRows?: number;
  /** Raspon automatskog filtra, npr. `A4:N40`. */
  autoFilter?: string;
  /** Spojene ćelije, npr. `A1:E1`. */
  merges?: string[];
  /** WP1.17: padajući popis (provjera podataka) – raspon ćelija i izvor: popis `"DA,NE"` ili raspon `'Šifarnik'!$A$2:$A$9`. */
  validations?: { sqref: string; formula: string }[];
}

export interface Workbook { sheets: Sheet[]; title?: string; creator?: string }

/** Najveća duljina teksta u ćeliji (Excel). */
export const MAX_CELL_TEXT = 32_767;

// Indeksi u cellXfs (styles.xml) – redoslijed mora odgovarati popisu `xfs` niže.
const XF: Record<CellStyle, number> = { text: 0, bold: 1, title: 2, warn: 3, header: 4, date: 5, month: 6, money: 7, moneyBold: 8, int: 9, hours: 10, percent: 11, wrap: 12 };

/** XML: escape i uklanjanje znakova koji nisu dopušteni u XML 1.0 (kontrolni znakovi, nesparene surogatne polovice). */
export function xmlText(s: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '�');
  return clean.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Stupac → slova (0 → A, 25 → Z, 26 → AA). */
export function columnName(i: number): string {
  let s = ''; let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** ISO datum (GGGG-MM-DD) → Excelov serijski broj (sustav 1900, dani od 30. 12. 1899.). */
export function excelDate(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`Neispravan datum: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 + 25_569;
}

const isDateStyle = (s?: CellStyle) => s === 'date' || s === 'month';

class SharedStrings {
  private readonly index = new Map<string, number>();
  readonly list: string[] = [];
  count = 0;
  id(s: string): number {
    this.count++;
    let i = this.index.get(s);
    if (i === undefined) { i = this.list.length; this.list.push(s); this.index.set(s, i); }
    return i;
  }
}

function cellXml(ref: string, cell: Cell, sst: SharedStrings): string {
  const { v, s } = cell !== null && typeof cell === 'object' ? cell : { v: cell, s: undefined };
  const style = s ? ` s="${XF[s]}"` : '';
  if (v === null || v === undefined || v === '') return s ? `<c r="${ref}"${style}/>` : '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Ćelija ${ref}: broj nije konačan`);
    return `<c r="${ref}"${style}><v>${v}</v></c>`;
  }
  if (isDateStyle(s)) return `<c r="${ref}"${style}><v>${excelDate(v)}</v></c>`;
  const text = v.length > MAX_CELL_TEXT ? `${v.slice(0, MAX_CELL_TEXT - 1)}…` : v;
  return `<c r="${ref}"${style} t="s"><v>${sst.id(text)}</v></c>`;
}

function sheetXml(sheet: Sheet, sst: SharedStrings): string {
  const width = Math.max(1, ...sheet.rows.map((r) => r.length), sheet.widths?.length ?? 0);
  const lastRef = `${columnName(width - 1)}${Math.max(1, sheet.rows.length)}`;
  const freeze = sheet.freezeRows && sheet.freezeRows > 0
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sheet.freezeRows + 1}" sqref="A${sheet.freezeRows + 1}"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const cols = sheet.widths?.length ? `<cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(1, Math.min(w, 255))}" customWidth="1"/>`).join('')}</cols>` : '';
  const rows = sheet.rows.map((row, r) => {
    const cells = row.map((c, i) => cellXml(`${columnName(i)}${r + 1}`, c, sst)).join('');
    return cells ? `<row r="${r + 1}">${cells}</row>` : '';
  }).join('');
  const filter = sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : '';
  const merges = sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  // Popis je samo pomoć pri unosu (showErrorMessage="0"): korisnik smije upisati i vrijednost izvan popisa – provjerava je uvoz.
  const validations = sheet.validations?.length ? `<dataValidations count="${sheet.validations.length}">${sheet.validations.map((v) => `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="0" sqref="${v.sqref}"><formula1>${xmlText(v.formula)}</formula1></dataValidation>`).join('')}</dataValidations>` : '';
  // Redoslijed elemenata propisuje shema CT_Worksheet (Excel odbija datoteku s pogrešnim redoslijedom).
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${lastRef}"/>${freeze}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${filter}${merges}${validations}`
    + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/><numFmt numFmtId="166" formatCode="0.00"/><numFmt numFmtId="167" formatCode="mm.yyyy"/></numFmts>'
  + '<fonts count="4"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
  + '<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="12"/><color rgb="FFC00000"/><name val="Calibri"/><family val="2"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7ECF3"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF8899AA"/></bottom><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="13">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' // text
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' // bold
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' // title
  + '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' // warn (NACRT)
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' // header
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' // date
  + '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' // month
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' // money
  + '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' // moneyBold
  + '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' // int
  + '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' // hours
  + '<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' // percent
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' // wrap
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0"/></styleSheet>';

/** Naziv lista: najviše 31 znak, bez `[]:*?/\`, ne smije počinjati ni završavati apostrofom. */
export function sheetName(name: string): string {
  const s = name.replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31);
  return s || 'List';
}

/** Radna knjiga kao XLSX (ZIP) u memoriji. */
export async function buildXlsx(wb: Workbook): Promise<Buffer> {
  if (!wb.sheets.length) throw new Error('Radna knjiga mora imati barem jedan list');
  const names = wb.sheets.map((s) => sheetName(s.name));
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new Error('Nazivi listova moraju biti jedinstveni');
  const sst = new SharedStrings();
  const sheets = wb.sheets.map((s) => sheetXml(s, sst));
  const quoted = (n: string) => `'${n.replace(/'/g, "''")}'`;
  const filterNames = wb.sheets.map((s, i) => (s.autoFilter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xmlText(`${quoted(names[i]!)}!${s.autoFilter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}`)}</definedName>` : '')).join('');
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const files: { name: string; data: string }[] = [
    { name: '[Content_Types].xml', data: `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>' },
    { name: '_rels/.rels', data: `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>' },
    { name: 'docProps/core.xml', data: `${xml}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
      + `<dc:title>${xmlText(wb.title ?? '')}</dc:title><dc:creator>${xmlText(wb.creator ?? 'ArQus Projekti')}</dc:creator></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `${xml}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>ArQus Projekti</Application></Properties>` },
    { name: 'xl/workbook.xml', data: `${xml}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
      + '<bookViews><workbookView activeTab="0"/></bookViews><sheets>'
      + names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + `</sheets>${filterNames ? `<definedNames>${filterNames}</definedNames>` : ''}<calcPr calcId="191029"/></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + `<Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>` },
    ...sheets.map((data, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data })),
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/sharedStrings.xml', data: `${xml}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sst.count}" uniqueCount="${sst.list.length}">`
      + sst.list.map((s) => `<si><t${/^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : ''}>${xmlText(s)}</t></si>`).join('') + '</sst>' },
  ];
  // Stalno vrijeme izmjene zapisa: isti podaci → ista datoteka (usporedivi izvozi).
  return zipToBuffer(files.map((f) => ({ name: f.name, data: Buffer.from(f.data, 'utf8') })), new Date(2000, 0, 1));
}

/** Pomoćnici za ćelije. Novac u centima → euri (broj s dvije decimale u formatu). */
export const money = (cents: number | null | undefined, bold = false): Cell => (cents === null || cents === undefined ? null : { v: cents / 100, s: bold ? 'moneyBold' : 'money' });
export const dateCell = (iso: string | null | undefined): Cell => (iso ? { v: iso.slice(0, 10), s: 'date' } : null);
export const bold = (v: CellValue): Cell => ({ v, s: 'bold' });
export const header = (v: CellValue): Cell => ({ v, s: 'header' });
