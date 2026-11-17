import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asciiSlug, assertSafeZipPath, safeFileName, UniqueNames, ZipWriter, zipToBuffer } from '../src/export/zip-writer';
import { readSheet, readZip } from './zip-reader';
import { buildXlsx, columnName, excelDate, money, sheetName, xmlText, type Workbook } from '../src/export/xlsx-writer';

/**
 * WP1.16b – ZIP i XLSX pisači. Čitač u testu je neovisan o pisaču: vlastito parsiranje središnjeg direktorija prema
 * APPNOTE, vlastiti CRC-32 (tablica), inflate iz zlib-a. Ako su dostupni, provjeravaju i Python `zipfile`/`openpyxl` i `unzip -t`.
 */

const hasPython = spawnSync('python3', ['--version']).status === 0;
const hasOpenpyxl = hasPython && spawnSync('python3', ['-c', 'import openpyxl']).status === 0;
const hasUnzip = spawnSync('unzip', ['-v']).status === 0;
const tmp = () => mkdtempSync(join(tmpdir(), 'arqus-zip-'));

describe('ZIP pisač', () => {
  const big = Buffer.concat([randomBytes(200_000), Buffer.alloc(300_000, 'ponavljanje čćđšž ')]); // > jedan deflate blok (64 KiB)
  const entries = [
    { name: 'sadrzaj.csv', data: Buffer.from('a;b\n1;2\n') },
    { name: 'dokazi/01_2026-03-12_Racun/Račun br. 12 – Šimić & Ćorić.pdf', data: Buffer.from('%PDF-1.7 čćđšž ČĆĐŠŽ') },
    { name: 'prazna.txt', data: Buffer.alloc(0) },
    { name: 'veliki/slucajni.bin', data: randomBytes(150_000) }, // ne sažima se → spremljeno (metoda 0)
    { name: 'veliki/mjesoviti.bin', data: big },
  ];

  it('neovisni čitač: nazivi (UTF-8 oznaka samo kad treba), CRC, veličine, sažimanje samo kad pomaže', async () => {
    const zip = await zipToBuffer(entries, new Date(2026, 10, 17, 10, 30, 0));
    const read = readZip(zip);
    expect(read.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (const [i, e] of read.entries()) expect(e.data.equals(entries[i]!.data)).toBe(true);
    expect(read.find((e) => e.name.startsWith('dokazi/'))!.flags & 0x800).toBe(0x800);
    expect(read.find((e) => e.name === 'sadrzaj.csv')!.flags & 0x800).toBe(0);
    expect(read.find((e) => e.name === 'veliki/slucajni.bin')!.method).toBe(0);
    expect(read.find((e) => e.name === 'veliki/mjesoviti.bin')!.method).toBe(8);
    // DOS vrijeme zapisa
    const d = zip.readUInt16LE(12); expect([(d >> 9) + 1980, (d >> 5) & 15, d & 31]).toEqual([2026, 11, 17]);
  });

  it.runIf(hasPython)('Python zipfile: testzip bez grešaka, isti nazivi i sadržaj', async () => {
    const dir = tmp(); const file = join(dir, 'a.zip');
    writeFileSync(file, await zipToBuffer(entries));
    const out = execFileSync('python3', ['-I', '-c', [
      'import sys, zipfile, hashlib, json', 'z = zipfile.ZipFile(sys.argv[1])', 'assert z.testzip() is None',
      'print(json.dumps([[i.filename, hashlib.sha256(z.read(i)).hexdigest()] for i in z.infolist()]))',
    ].join('\n'), file]).toString();
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    expect(JSON.parse(out)).toEqual(entries.map((e) => [e.name, sha(e.data)]));
  });

  it.runIf(hasUnzip)('unzip -t: arhiva je ispravna', async () => {
    const dir = tmp(); const file = join(dir, 'a.zip');
    writeFileSync(file, await zipToBuffer(entries));
    expect(execFileSync('unzip', ['-t', file]).toString()).toMatch(/No errors detected/);
  });

  it('strujanje: dijelovi se proizvode po zapisu, zbroj odgovara cijeloj arhivi', async () => {
    const z = new ZipWriter(new Date(2026, 0, 1));
    const parts: Buffer[] = [];
    for (const e of entries) { const chunk = await z.entry(e.name, e.data); parts.push(...chunk); expect(z.size).toBe(Buffer.concat(parts).length); }
    parts.push(z.finish());
    expect(readZip(Buffer.concat(parts)).length).toBe(entries.length);
    expect(() => z.finish()).toThrow(/zatvorena/);
  });

  it('odbija nesigurne i dvostruke nazive', async () => {
    for (const bad of ['/etc/passwd', '../x', 'a/../b', 'a//b', 'a\\b', 'C:x', 'a/./b', 'x\u0000y', '']) expect(() => assertSafeZipPath(bad), bad).toThrow();
    const z = new ZipWriter();
    await z.entry('Mapa/racun.pdf', Buffer.from('x'));
    await expect(z.entry('mapa/RACUN.pdf', Buffer.from('y'))).rejects.toThrow(/Dvostruki/);
  });

  it('nazivi: ASCII mape, sigurni nazivi datoteka, jedinstveni nazivi', () => {
    expect(asciiSlug('Marina Šimić – đak, Ćorić & Žužić')).toBe('Marina-Simic-dak-Coric-Zuzic');
    expect(asciiSlug('***')).toBe('x');
    expect(asciiSlug('a'.repeat(100), 10)).toBe('aaaaaaaaaa');
    expect(asciiSlug('Elaborat energetskog pregleda pilot-zgrade', 40)).toBe('Elaborat-energetskog-pregleda-pilot');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('..\\..\\Račun: 12/2026?.pdf')).toBe('2026.pdf');
    expect(safeFileName('Račun: br. 12*.pdf')).toBe('Račun br. 12.pdf');
    expect(safeFileName('CON.pdf')).toBe('_CON.pdf');
    expect(safeFileName('...')).toBe('datoteka');
    const long = safeFileName(`${'Dugačak naziv '.repeat(20)}.pdf`, 50);
    expect([...long].length).toBeLessThanOrEqual(50); expect(long.endsWith('.pdf')).toBe(true);
    const u = new UniqueNames();
    expect(u.take('d', 'racun.pdf')).toBe('d/racun.pdf');
    expect(u.take('d', 'Racun.pdf')).toBe('d/Racun (2).pdf');
    expect(u.take('d', 'racun.pdf')).toBe('d/racun (3).pdf');
    expect(u.take('e', 'racun.pdf')).toBe('e/racun.pdf');
  });
});

describe('XLSX pisač', () => {
  const longText = 'Opis '.repeat(2000) + 'kraj';
  const wb: Workbook = {
    title: 'Test <&> čćđšž',
    sheets: [
      { name: 'Sažetak', freezeRows: 2, widths: [30, 15], merges: ['A1:B1'], rows: [
        [{ v: 'NACRT – nije predano', s: 'warn' }],
        [{ v: 'Stavka', s: 'header' }, { v: 'Iznos (EUR)', s: 'header' }],
        ['Đurđica Šimić – „navodnici” & <oznake>', money(123_456_789)],
        ['nula', money(0)],
        ['veliki iznos', money(99_999_999_999)],
        ['datum', { v: '2026-03-01', s: 'date' }],
        ['mjesec', { v: '2026-02-01', s: 'month' }],
        ['stopa', { v: 0.85, s: 'percent' }],
        ['sati', { v: 7.25, s: 'hours' }],
        ['dugi tekst', longText],
        ['  razmaci  ', 'kontrolni\u0001znak'],
      ] },
      { name: 'Troškovi', freezeRows: 1, autoFilter: 'A1:C3', rows: [[{ v: 'A', s: 'header' }, { v: 'B', s: 'header' }, { v: 'C', s: 'header' }], [1, 2, 3], [4, null, 6]] },
    ],
  };

  it('pomoćne funkcije: stupci, datumi, nazivi listova, XML', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
    expect(excelDate('1900-03-01')).toBe(61); expect(excelDate('2026-01-01')).toBe(46023);
    expect(sheetName('Troškovi: [osoblje]/2026 – vrlo dugačak naziv lista')).toHaveLength(31);
    expect(xmlText('a<b&"c"\u0000\ud800')).toBe('a&lt;b&amp;&quot;c&quot;�');
  });

  it('struktura paketa i sadržaj ćelija (vlastiti čitač)', async () => {
    const x = await buildXlsx(wb);
    const files = new Map(readZip(x).map((e) => [e.name, e.data.toString('utf8')]));
    expect([...files.keys()].sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="Sažetak" sheetId="1" r:id="rId1"/>');
    expect(files.get('xl/workbook.xml')).toContain(`<definedName name="_xlnm._FilterDatabase" localSheetId="1" hidden="1">'Troškovi'!$A$1:$C$3</definedName>`);
    const s1 = readSheet(files, 1);
    expect(s1.get('A3')!.v).toBe('Đurđica Šimić – „navodnici” & <oznake>');
    expect(s1.get('B3')).toEqual({ s: '7', t: undefined, v: '1234567.89' });
    expect(s1.get('B4')!.v).toBe('0'); expect(s1.get('B5')!.v).toBe('999999999.99');
    expect(s1.get('B6')).toEqual({ s: '5', t: undefined, v: '46082' });
    expect(s1.get('B10')!.v.length).toBe(longText.length);
    expect(s1.get('B11')!.v).toBe('kontrolniznak');
    expect(files.get('xl/worksheets/sheet1.xml')).toContain('<pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/>');
    expect(files.get('xl/sharedStrings.xml')).toContain('<t xml:space="preserve">  razmaci  </t>');
    // Deterministično: isti ulaz → isti bajtovi.
    expect((await buildXlsx(wb)).equals(x)).toBe(true);
  });

  it('odbija prazne radne knjige, dvostruke nazive listova i nekonačne brojeve', async () => {
    await expect(buildXlsx({ sheets: [] })).rejects.toThrow();
    await expect(buildXlsx({ sheets: [{ name: 'A', rows: [] }, { name: 'a', rows: [] }] })).rejects.toThrow(/jedinstveni/);
    await expect(buildXlsx({ sheets: [{ name: 'A', rows: [[Number.NaN]] }] })).rejects.toThrow(/konačan/);
  });

  it.runIf(hasOpenpyxl)('openpyxl čita vrijednosti, tipove, formate, zamrznute retke i filtar', async () => {
    const dir = tmp(); const file = join(dir, 't.xlsx');
    writeFileSync(file, await buildXlsx(wb));
    const out = execFileSync('python3', ['-I', '-c', [
      'import sys, json, openpyxl', 'wb = openpyxl.load_workbook(sys.argv[1])', 's = wb["Sažetak"]; t = wb["Troškovi"]',
      'print(json.dumps({"sheets": wb.sheetnames, "a3": s["A3"].value, "b3": s["B3"].value, "fmt": s["B3"].number_format, "b5": s["B5"].value,',
      ' "date": s["B6"].value.isoformat(), "dfmt": s["B6"].number_format, "pct": s["B8"].value, "pfmt": s["B8"].number_format, "freeze": s.freeze_panes,',
      ' "filter": t.auto_filter.ref, "merged": [str(r) for r in s.merged_cells.ranges], "long": len(s["B10"].value), "bold": s["A2"].font.b, "width": s.column_dimensions["A"].width}))',
    ].join('\n'), file]).toString();
    expect(JSON.parse(out)).toEqual({
      sheets: ['Sažetak', 'Troškovi'], a3: 'Đurđica Šimić – „navodnici” & <oznake>', b3: 1234567.89, fmt: '#,##0.00', b5: 999999999.99,
      date: '2026-03-01T00:00:00', dfmt: 'dd.mm.yyyy', pct: 0.85, pfmt: '0.00%', freeze: 'A3', filter: 'A1:C3', merged: ['A1:B1'], long: longText.length, bold: true, width: 30,
    });
  });
});
