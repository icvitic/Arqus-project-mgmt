/** Mali, valjani PDF (jedna stranica, Helvetica) za demo dokaze i dokumente – bez vanjskih ovisnosti. */

/** PDF standardni font (WinAnsi) nema č, ć, đ – demo tekst prevodimo u ASCII. */
const ascii = (s: string): string => s
  .replace(/[čć]/g, 'c').replace(/[ČĆ]/g, 'C').replace(/đ/g, 'dj').replace(/Đ/g, 'Dj')
  .replace(/š/g, 's').replace(/Š/g, 'S').replace(/ž/g, 'z').replace(/Ž/g, 'Z')
  .replace(/[–—]/g, '-').replace(/[„“”]/g, '"').replace(/[^\x20-\x7e]/g, '?');
const esc = (s: string): string => ascii(s).replace(/[\\()]/g, (c) => `\\${c}`);

export function demoPdf(title: string, lines: string[]): Buffer {
  const text = [
    'BT', '/F1 16 Tf', '56 780 Td', `(${esc(title)}) Tj`, '/F1 10 Tf', '0 -22 Td',
    ...lines.flatMap((l) => [`(${esc(l)}) Tj`, '0 -15 Td']),
    '0 -15 Td', '/F1 8 Tf', '(Pokazni dokument - ArQus Projekti demo okruzenje. Nije stvarni racun ni ugovor.) Tj', 'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
