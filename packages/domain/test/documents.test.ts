import { describe, it, expect } from 'vitest';
import { checkUpload, sanitizeFileName, formatBytes, MAX_DOCUMENT_BYTES } from '../src/documents';

const pdf = new TextEncoder().encode('%PDF-1.7\n');
describe('dokumenti', () => {
  it('prihvaća PDF s ispravnim potpisom', () => {
    expect(checkUpload('racun.PDF', 9, pdf)).toEqual({ ok: true, mime: 'application/pdf' });
  });
  it('odbija lažnu ekstenziju, nedopuštene vrste, prazne i prevelike datoteke', () => {
    expect(checkUpload('racun.pdf', 10, new TextEncoder().encode('<html>'))).toMatchObject({ ok: false, error: expect.stringContaining('ne odgovara') });
    expect(checkUpload('slika.svg', 10, new TextEncoder().encode('<svg>'))).toMatchObject({ ok: false });
    expect(checkUpload('alat.exe', 10, new Uint8Array([0x4d, 0x5a]))).toMatchObject({ ok: false });
    expect(checkUpload('bez-ekstenzije', 10, pdf)).toMatchObject({ ok: false });
    expect(checkUpload('a.pdf', 0, pdf)).toMatchObject({ ok: false, error: 'Datoteka je prazna' });
    expect(checkUpload('a.pdf', MAX_DOCUMENT_BYTES + 1, pdf)).toMatchObject({ ok: false });
    expect(checkUpload('a.txt', 3, new Uint8Array([0x61, 0, 0x62]))).toMatchObject({ ok: false });
  });
  it('Office (zip) i tekst', () => {
    expect(checkUpload('plan.xlsx', 4, new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toMatchObject({ ok: true });
    expect(checkUpload('popis.csv', 5, new TextEncoder().encode('a;b\n1'))).toMatchObject({ ok: true, mime: 'text/csv' });
  });
  it('čisti naziv datoteke', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\x\\Račun 12/2026.pdf')).toBe('2026.pdf');
    expect(sanitizeFileName('  ugovor "final"\u0000.pdf ')).toBe('ugovor final.pdf');
    expect(sanitizeFileName('...')).toBe('datoteka');
    expect(sanitizeFileName(`${'a'.repeat(300)}.pdf`)).toHaveLength(200);
    expect(sanitizeFileName(`${'a'.repeat(300)}.pdf`).endsWith('.pdf')).toBe(true);
  });
  it('veličina', () => { expect(formatBytes(512)).toBe('512 B'); expect(formatBytes(1536)).toBe('1,5 KB'); expect(formatBytes(3 * 1024 * 1024)).toBe('3,0 MB'); });
});
