import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import type { ImportCell } from '@arqus/domain';
import { zipToBuffer } from '../src/export/zip-writer';
import { buildXlsx } from '../src/export/xlsx-writer';
import { readXlsx, isDateFormat, columnIndex } from '../src/import/xlsx-reader';
import { openZip } from '../src/import/zip-reader';
import { readCsv, detectSeparator } from '../src/import/csv-reader';
import { readImportSource } from '../src/import/import-source';
import { parseXml } from '../src/import/xml';
import { IMPORT_LIMITS } from '../src/import/limits';
import { importTemplate } from '../src/import/import-template';

/**
 * WP1.17 – čitač datoteka za uvoz: stvarne datoteke iz LibreOfficea i openpyxl-a (u repozitoriju, `fixtures/import`,
 * regenerira ih `generate-fixtures.sh`), izlaz vlastitog XLSX pisača, ručno složene datoteke za vrste ćelija koje ti
 * alati ne pišu, i neprijateljske datoteke s granicama (ZIP bomba, DTD/entiteti, lozinka, makronaredbe, .xls, preveliki sadržaj).
 * Datoteke koje je zapisao Microsoft Excel ovdje nisu dostupne (vidi docs/UVOZ-PROJEKTA.md).
 */
const FIX = join(__dirname, 'fixtures', 'import');
const fixture = (n: string) => readFileSync(join(FIX, n));
const all = () => true;
const trim = (r: unknown[]) => { const x = [...r]; while (x.length && x[x.length - 1] === null) x.pop(); return x; };
const values = (rows: { n: number; cells: (ImportCell | undefined)[] }[]) => rows.map((r) => [r.n, ...Array.from(r.cells, (c) => (c === undefined ? null : c.t === 'f' ? 'FORMULA' : c.v))]);

/** Minimalna radna knjiga od zadanih dijelova (bez pisača) – za vrste ćelija i neispravne datoteke. */
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
function workbook(opts: { sheet: string; sst?: string; styles?: string; wbPr?: string; sheets?: string; ct?: string; extra?: { name: string; data: string }[]; prefix?: string }) {
  const p = opts.prefix ? `${opts.prefix}:` : '';
  const xmlns = opts.prefix ? `xmlns:${opts.prefix}="${NS}"` : `xmlns="${NS}"`;
  const files = [
    { name: '[Content_Types].xml', data: opts.ct ?? '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>' },
    { name: '_rels/.rels', data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0"?><${p}workbook ${xmlns} xmlns:r="${REL}">${opts.wbPr ?? ''}<${p}sheets>${opts.sheets ?? `<${p}sheet name="Troškovi" sheetId="1" r:id="rId1"/>`}</${p}sheets></${p}workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="/xl/worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="${REL}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/worksheets/sheet1.xml', data: `<?xml version="1.0"?><${p}worksheet ${xmlns}><${p}sheetData>${opts.sheet}</${p}sheetData></${p}worksheet>` },
    ...(opts.sst !== undefined ? [{ name: 'xl/sharedStrings.xml', data: `<?xml version="1.0"?><sst xmlns="${NS}">${opts.sst}</sst>` }] : []),
    ...(opts.styles !== undefined ? [{ name: 'xl/styles.xml', data: `<?xml version="1.0"?><styleSheet xmlns="${NS}">${opts.styles}</styleSheet>` }] : []),
    ...(opts.extra ?? []),
  ];
  return zipToBuffer(files.map((f) => ({ name: f.name, data: Buffer.from(f.data, 'utf8') })), new Date(2000, 0, 1));
}
const read = (buf: Buffer) => readXlsx(buf, all).sheets[0]!.rows;

describe('Čitač XLSX – stvarne datoteke (LibreOffice, openpyxl)', () => {
  const expected = [
    [1, 'Opis', 'Datum', 'Iznos (EUR)', 'Kategorija', 'Radni paket', 'Dobavljač', 'Potraživano izvan sustava', 'Razdoblje / ZNS', 'Priznati iznos (EUR)', 'Razlog umanjenja', 'Dokaz (broj računa)', 'Moj stupac', 'Osoba'],
    [2, 'Elaborat energetskog pregleda', '2026-02-10', 1234.56, 'VU', 1, 'Energo-plan d.o.o.', 'DA', 'ZNS 1 – RP1', 1000, 'Priznato do iznosa iz ugovora', 'R-88/2026', 'x'],
    [3, 'Putovanje na sastanak', '15.3.2026.', '86,50', 'PUT', 'WP2', 'Putnički nalog 3/2026', 'da', 'ZNS 1 – RP1', null, null, 'PN-3/2026'],
    [4, 'Rad Ivane Kovač, veljača', '2026-02-28', 3000, 'OS', null, null, true, 'ZNS 1 – RP1', null, null, null, null, 'Ivana Kovač'],
    [5, 'Kalibracija senzora', '2026-08-05', '1.250,00', 'VU – Vanjske usluge', 2, 'Mjerna tehnika d.o.o.', 'NE', null, null, null, 'R-655/2026'],
    [6, '=formula koja je samo tekst', '2026-09-01', 10, 'PV'],
  ];
  for (const f of ['openpyxl-projekt.xlsx', 'libreoffice-projekt.xlsx']) {
    it(`${f}: listovi, skriveni list, tekst, brojevi, datumi s formatom, logička vrijednost, prazne ćelije i retci`, () => {
      const wb = readXlsx(fixture(f), all);
      expect(wb.date1904).toBe(false);
      expect(wb.sheets.map((s) => [s.name, s.hidden])).toEqual([['Radni paketi', false], ['Tim', false], ['Troškovi', false], ['Pomoćno', true]]);
      const exp = wb.sheets.find((s) => s.name === 'Troškovi')!.rows;
      expect(values(exp).map(trim)).toEqual(expected.map(trim));
      // Prazan redak 5 i naslov iznad zaglavlja na listu radnih paketa (spojene ćelije A1:D1 – vrijednost u prvoj).
      expect(values(wb.sheets[0]!.rows).map((r) => r[0])).toEqual([1, 2, 3, 4, 6]);
      expect(values(wb.sheets[0]!.rows)[0]).toEqual([1, 'Plan rada projekta (iz vlastite tablice)']);
      // Skriveni list se čita samo kad ga pozivatelj zatraži.
      expect(readXlsx(fixture(f), (_n, hidden) => !hidden).sheets.find((s) => s.name === 'Pomoćno')!.read).toBe(false);
    });
  }
  it('openpyxl: formula bez spremljene vrijednosti je posebna oznaka (ne izračunava se); LibreOffice sprema izračunatu vrijednost', () => {
    const cells = readXlsx(fixture('openpyxl-cells.xlsx'), all);
    expect(values(cells.sheets[0]!.rows)).toEqual([
      [1, 'tekst', 'broj', 'decimalni', 'logička', 'datum', 'formula', 'datum-vrijeme'],
      [2, 'Zagreb – šđčćž', 42, 1234.5, true, '2026-12-31', 'FORMULA', '2026-01-15'],
      [4, 'spojeno'],
    ]);
    // Sustav 1900: 1. 3. 1900. je serijski broj 61 (Excelov nepostojeći 29. 2. 1900. je dan 60); skriveni list s nazivom predloška.
    expect(cells.sheets[1]).toMatchObject({ name: 'Troškovi', hidden: true });
    expect(values(cells.sheets[1]!.rows)[1]).toEqual([2, '1900-03-01', 'VU', 1]);
  });
  for (const f of ['openpyxl-1904.xlsx', 'libreoffice-1904.xlsx']) {
    it(`${f}: sustav datuma 1904`, () => {
      const wb = readXlsx(fixture(f), all);
      expect(wb.date1904).toBe(true);
      expect(values(wb.sheets[0]!.rows)[1]).toEqual([2, '2026-03-02', 'VU', 100, 'Usluga']);
    });
  }
  it('CSV iz LibreOfficea (hrvatski jezik): separator ;, UTF-8, prepoznat list po zaglavlju', () => {
    const src = readImportSource(fixture('libreoffice-troskovi.csv'), 'libreoffice-troskovi.csv');
    expect(src).toMatchObject({ format: 'csv' });
    expect(src.sheets[0]!.def.key).toBe('expenses');
    expect(src.sheets[0]!.headerRow).toBe(1);
    expect(values(src.sheets[0]!.rows)[0]!.slice(0, 4)).toEqual([2, 'Elaborat energetskog pregleda', '10.02.2026', '1234,56']);
    expect(values(src.sheets[0]!.rows)[2]![7]).toBe('TOČNO');
  });
  it('listovi i stupci po nazivu: skriveni list s nazivom predloška se uvozi uz upozorenje, ostali se zanemaruju', () => {
    const src = readImportSource(fixture('openpyxl-projekt.xlsx'), 'x.xlsx');
    expect(src.sheets.map((s) => [s.def.key, s.headerRow])).toEqual([['workPackages', 2], ['team', 1], ['expenses', 1]]);
    expect(src.ignoredSheets).toEqual(['Pomoćno']);
    expect(src.sheets[0]!.match!.unknown).toEqual(['Interna napomena']);
    const cells = readImportSource(fixture('openpyxl-cells.xlsx'), 'x.xlsx');
    expect(cells.warnings).toEqual(['List „Troškovi” je skriven, ali se uvozi jer nosi naziv lista predloška.']);
    expect(cells.ignoredSheets).toEqual(['Vrste']);
  });
});

describe('Čitač XLSX – vlastiti pisač i ručno složene vrste ćelija', () => {
  it('izlaz vlastitog pisača (predložak, novac, datumi, posebni znakovi)', async () => {
    const buf = await buildXlsx({ sheets: [{ name: 'Troškovi', rows: [['Datum', 'Iznos', 'Opis'], [{ v: '2026-12-31', s: 'date' }, { v: 1234.56, s: 'money' }, 'A & B <c> "d" čćžšđ'], [{ v: '2026-02-01', s: 'month' }, 0, '  razmak ']] }] });
    expect(values(read(buf))).toEqual([[1, 'Datum', 'Iznos', 'Opis'], [2, '2026-12-31', 1234.56, 'A & B <c> "d" čćžšđ'], [3, '2026-02-01', 0, '  razmak ']]);
    const tpl = await buildXlsx(importTemplate({ project: { acronym: 'X', title: 'X', startDate: '2026-01-01', durationMonths: 12, status: 'active', packageLabel: 'NPOO' }, partners: [{ name: 'Inst', shortName: null, role: 'coordinator', orderNo: 1, isSelf: true }],
      categories: [{ code: 'VU', name: 'Vanjske usluge', personnel: false, timeRecording: true }], workPackages: [], deliverableTypes: [], disseminationLevels: [], team: null, personnel: false, allowed: ['expenses'] }));
    const src = readImportSource(tpl, 'predlozak.xlsx');
    expect(src.sheets.map((s) => s.def.key)).toEqual(['workPackages', 'deliverables', 'milestones', 'budget', 'team', 'expenses']);
    expect(src.sheets.every((s) => s.headerRow === 1 && s.match!.missing.length === 0)).toBe(true);
  });
  it('inlineStr, str (rezultat formule), b, e, d, obogaćeni tekst bez fonetike, ćelije bez oznake r', async () => {
    const buf = await workbook({
      sst: '<si><r><t>Obo</t></r><r><rPr><b/></rPr><t xml:space="preserve">gaćeno </t></r><rPh><t>FONETIKA</t></rPh></si><si><t></t></si>',
      sheet: '<row r="1"><c r="A1" t="inlineStr"><is><t>u ćeliji</t></is></c><c r="B1" t="str"><f>A1&amp;"x"</f><v>u ćelijix</v></c><c r="C1" t="b"><v>0</v></c><c r="D1" t="e"><f>1/0</f><v>#DIV/0!</v></c><c r="E1" t="d"><v>2026-05-04T00:00:00</v></c><c r="F1" t="s"><v>0</v></c><c r="G1" t="s"><v>1</v></c></row>'
        + '<row><c t="inlineStr"><is><t>bez r</t></is></c><c><v>7</v></c><c><f>SUM(1,2)</f></c></row>',
    });
    expect(read(buf).map((r) => [r.n, ...r.cells])).toEqual([
      [1, { t: 's', v: 'u ćeliji' }, { t: 's', v: 'u ćelijix' }, { t: 'b', v: false }, { t: 'e', v: '#DIV/0!' }, { t: 'd', v: '2026-05-04' }, { t: 's', v: 'Obogaćeno ' }],
      [2, { t: 's', v: 'bez r' }, { t: 'n', v: 7 }, { t: 'f' }],
    ]);
  });
  it('datumi: ugrađeni i vlastiti formati, sustav 1904 („true”), prefiks imenskog prostora (x:)', async () => {
    const styles = '<numFmts count="2"><numFmt numFmtId="170" formatCode="[$-41A]d\\.\\ mmmm\\ yyyy"/><numFmt numFmtId="171" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="170"/><xf numFmtId="171"/></cellXfs>';
    const sheet = '<x:row r="3"><x:c r="A3" s="1"><x:v>46387</x:v></x:c><x:c r="B3" s="2"><x:v>46387</x:v></x:c><x:c r="C3" s="3"><x:v>46387</x:v></x:c><x:c r="D3"><x:v>46387</x:v></x:c></x:row>';
    const b1900 = await workbook({ prefix: 'x', styles, sheet });
    expect(values(read(b1900))).toEqual([[3, '2026-12-31', '2026-12-31', 46387, 46387]]);
    const b1904 = await workbook({ styles, wbPr: '<workbookPr date1904="true"/>', sheet: sheet.replace(/x:/g, '') });
    expect(values(read(b1904))).toEqual([[3, '2031-01-01', '2031-01-01', 46387, 46387]]);
    expect(isDateFormat('dd.mm.yyyy')).toBe(true);
    expect(isDateFormat('[h]:mm')).toBe(true);
    expect(isDateFormat('#,##0.00 "kn"')).toBe(false);
    expect(isDateFormat('[Red]#,##0.00')).toBe(false);
    expect(isDateFormat('General')).toBe(false);
    expect(columnIndex('A1')).toBe(0); expect(columnIndex('AB12')).toBe(27); expect(columnIndex('XFD1')).toBe(16383);
  });
});

describe('Čitač – neprijateljske datoteke i granice', () => {
  const err = (fn: () => unknown) => { try { fn(); } catch (e) { return e as Error & { code?: string }; } throw new Error('očekivana greška'); };

  it('DTD, vanjski entiteti i nepoznati entiteti se odbijaju (XXE, širenje entiteta)', async () => {
    const xxe = await workbook({ sheet: '<row r="1"><c r="A1"><v>1</v></c></row>' });
    const patched = await workbook({ sheet: '<row r="1"><c r="A1" t="inlineStr"><is><t>&xxe;</t></is></c></row>' });
    expect(err(() => readXlsx(patched, all)).message).toMatch(/nepoznat entitet &xxe;.*vanjski entiteti nisu dopušteni/);
    expect(err(() => parseXml('<!DOCTYPE a [<!ENTITY b "c">]><a>&b;</a>', 'x', { open() {} })).message).toMatch(/DTD i deklaracije/);
    expect(err(() => parseXml('<a>'.repeat(IMPORT_LIMITS.maxXmlDepth + 1), 'x', { open() {} })).message).toMatch(/preduboko/);
    expect(err(() => parseXml('<a><b></a>', 'x', { open() {} })).message).toMatch(/nezatvoreni|zatvaranje/);
    expect(read(xxe)).toHaveLength(1);
    // Brojčane reference znakova i pet predefiniranih entiteta su dopušteni.
    const ok = await workbook({ sheet: '<row r="1"><c r="A1" t="inlineStr"><is><t>&lt;&amp;&#269;&#x107;&quot;&apos;&gt;</t></is></c></row>' });
    expect(read(ok)[0]!.cells[0]).toEqual({ t: 's', v: '<&čć"\'>' });
  });
  it('ZIP bomba: raspakirani sadržaj veći od deklariranog i deklarirana veličina iznad granice', async () => {
    const big = Buffer.alloc(30 * 1024 * 1024, 0x20);
    const zip = await zipToBuffer([{ name: 'xl/worksheets/sheet1.xml', data: big }]);
    expect(zip.length).toBeLessThan(200_000);
    expect(err(() => openZip(zip)).message).toMatch(/prevelik \(30 MB, najviše 25 MB\)/);
    // Lažna (mala) veličina u središnjem direktoriju: inflate staje na deklariranoj veličini.
    const small = await zipToBuffer([{ name: 'a.xml', data: Buffer.alloc(5 * 1024 * 1024, 0x20) }]);
    const cd = small.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    small.writeUInt32LE(100, cd + 24);
    expect(err(() => openZip(small).read('a.xml')).message).toMatch(/veći od deklarirane veličine \(moguća ZIP bomba\)/);
    // Zbroj deklariranih veličina iznad granice.
    const many = await zipToBuffer(Array.from({ length: 3 }, (_, i) => ({ name: `p${i}.xml`, data: Buffer.alloc(24 * 1024 * 1024, 0x20) })));
    expect(err(() => openZip(many)).message).toMatch(/nakon raspakiranja prevelika/);
  }, 30_000);
  it('broj zapisa, šifrirani zapis, ZIP64, CRC, duplikati, metoda sažimanja; naziv zapisa nikad nije putanja', async () => {
    const lots = await zipToBuffer(Array.from({ length: IMPORT_LIMITS.maxEntries + 1 }, (_, i) => ({ name: `f${i}`, data: Buffer.from('x') })));
    expect(err(() => openZip(lots)).message).toMatch(/1001 zapisa \(najviše 1000\)/);
    const base = await zipToBuffer([{ name: 'aa/x.xml', data: Buffer.from('<a/>') }]);
    const cd = base.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const enc = Buffer.from(base); enc.writeUInt16LE(enc.readUInt16LE(cd + 8) | 1, cd + 8);
    expect(err(() => openZip(enc))).toMatchObject({ code: 'import_file_encrypted' });
    const crc = Buffer.from(base); crc.writeUInt32LE((crc.readUInt32LE(cd + 16) ^ 1) >>> 0, cd + 16);
    crc.writeUInt32LE(crc.readUInt32LE(cd + 16), 14); // i lokalno zaglavlje
    expect(err(() => openZip(crc).read('aa/x.xml')).message).toMatch(/CRC-32/);
    const method = Buffer.from(base); method.writeUInt16LE(12, cd + 10);
    expect(err(() => openZip(method)).message).toMatch(/nepodržanu metodu sažimanja \(12\)/);
    // „../x.xml” je samo ključ u memoriji – ništa se ne zapisuje na disk, čitanje radi kao za bilo koji naziv.
    const trav = Buffer.from(base); trav.write('..', cd + 46, 'latin1'); trav.write('..', 30, 'latin1');
    expect(openZip(trav).read('../x.xml')!.toString()).toBe('<a/>');
    const dup = await zipToBuffer([{ name: 'A.xml', data: Buffer.from('1') }, { name: 'b.xml', data: Buffer.from('2') }]);
    const cd2 = dup.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    dup.write('a', cd2 + 46, 'latin1');
    expect(err(() => openZip(dup)).message).toMatch(/se ponavlja/);
    const z64 = Buffer.concat([Buffer.from([0x50, 0x4b, 0x06, 0x07]), Buffer.alloc(16), Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]);
    expect(err(() => openZip(z64)).message).toMatch(/ZIP64/);
    expect(err(() => openZip(Buffer.from('PK\x03\x04 oštećena datoteka bez središnjeg direktorija'))).message).toMatch(/nedostaje kraj ZIP arhive/);
  });
  it('.xls, šifrirani OOXML (lozinka), .xlsm (makronaredbe), .xlsb – jasna poruka', async () => {
    const cfb = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
    expect(err(() => readXlsx(cfb, all))).toMatchObject({ code: 'import_file_xls', message: expect.stringMatching(/Excel 97–2003 \(\.xls\).*spremi kao „Excelova radna knjiga \(\.xlsx\)”/) });
    expect(err(() => readXlsx(Buffer.concat([cfb, Buffer.from('EncryptionInfo', 'utf16le')]), all))).toMatchObject({ code: 'import_file_encrypted' });
    const xlsm = await workbook({ sheet: '', ct: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>' });
    expect(err(() => readXlsx(xlsm, all))).toMatchObject({ code: 'import_file_xlsm' });
    const vba = await workbook({ sheet: '', extra: [{ name: 'xl/vbaProject.bin', data: 'x' }] });
    expect(err(() => readXlsx(vba, all))).toMatchObject({ code: 'import_file_xlsm' });
    expect(err(() => readImportSource(Buffer.from('x'), 'a.xlsb'))).toMatchObject({ code: 'import_file_xlsb' });
    expect(err(() => readImportSource(Buffer.from('a;b'), 'tablica.ods')).message).toMatch(/čita \.xlsx i \.csv/);
  });
  it('granice sadržaja: broj redaka, duljina teksta, stupci iza granice se zanemaruju uz upozorenje; tekst „=…” ostaje tekst', async () => {
    const rows = Array.from({ length: IMPORT_LIMITS.maxRows + 1 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join('');
    const tall = await workbook({ sheet: rows });
    expect(err(() => readXlsx(tall, all)).message).toMatch(/više od 10000 redaka/);
    const long = await workbook({ sheet: `<row r="1"><c r="A1" t="inlineStr"><is><t>${'x'.repeat(IMPORT_LIMITS.maxCellChars + 1)}</t></is></c></row>` });
    expect(err(() => readXlsx(long, all)).message).toMatch(/dulji od 32767 znakova/);
    const wide = readXlsx(await workbook({ sheet: '<row r="1"><c r="A1"><v>1</v></c><c r="CW1"><v>2</v></c></row>' }), all);
    expect(wide.warnings).toEqual(['List „Troškovi”: stupci iza CV se zanemaruju.']);
    expect(values(wide.sheets[0]!.rows)).toEqual([[1, 1]]);
    const f = await workbook({ sheet: '<row r="1"><c r="A1" t="inlineStr"><is><t>=HYPERLINK("http://x")</t></is></c><c r="B1" t="s"><v>5</v></c></row>', sst: '<si><t>a</t></si>' });
    expect(err(() => readXlsx(f, all)).message).toMatch(/upućuje na nepostojeći tekst/);
    const g = await workbook({ sheet: '<row r="1"><c r="A1" t="inlineStr"><is><t>=HYPERLINK("http://x")</t></is></c></row>' });
    expect(read(g)[0]!.cells[0]).toEqual({ t: 's', v: '=HYPERLINK("http://x")' });
    const order = await workbook({ sheet: '<row r="2"/><row r="1"/>' });
    expect(err(() => readXlsx(order, all)).message).toMatch(/neispravan broj retka/);
  });
  it('CSV: BOM, separator ; , i tabulator, navodnici s prijelomom retka, broj retka iz datoteke, neispravan UTF-8', () => {
    const r = readCsv(Buffer.from('\ufeffDatum;Iznos;Opis\r\n01.02.2026.;"1.234,56";"Opis; s ""navodnicima""\r\nu dva retka"\r\n\r\n02.02.2026.;5;x\r\n', 'utf8'));
    expect(r.separator).toBe(';');
    expect(r.rows.map((x) => [x.n, ...x.cells.map((c) => (c && c.t === 's' ? c.v : null))])).toEqual([
      [1, 'Datum', 'Iznos', 'Opis'], [2, '01.02.2026.', '1.234,56', 'Opis; s "navodnicima"\r\nu dva retka'], [5, '02.02.2026.', '5', 'x'],
    ]);
    expect(detectSeparator('a,b,"c;d"\n1;2;3;4')).toBe(',');
    expect(detectSeparator('a\tb\tc')).toBe('\t');
    expect(err(() => readCsv(Buffer.from([0x44, 0x61, 0x74, 0x75, 0x6d, 0x3b, 0xe8, 0x0a]))).message).toMatch(/nije u kodiranju UTF-8/);
    expect(err(() => readCsv(Buffer.from('a;"b\n'))).message).toMatch(/navodnik nije zatvoren/);
    expect(err(() => readImportSource(Buffer.from('nešto;drugo\n1;2'), 'podaci.csv'))).toMatchObject({ code: 'import_csv_sheet' });
  });
  it('deflate bez sažimanja i dio koji nije u arhivi', async () => {
    const raw = await zipToBuffer([{ name: 'a.xml', data: Buffer.from('<a/>'), compress: false }]);
    expect(openZip(raw).read('a.xml')!.toString()).toBe('<a/>');
    expect(openZip(raw).read('b.xml')).toBeNull();
    expect(deflateRawSync(Buffer.from('x')).length).toBeGreaterThan(0);
  });
});
