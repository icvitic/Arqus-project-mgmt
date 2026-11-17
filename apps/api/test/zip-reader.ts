import { expect } from 'vitest';
import { inflateRawSync } from 'node:zlib';

/**
 * Neovisni čitač ZIP-a i XLSX-a za testove (WP1.16b): vlastito parsiranje središnjeg direktorija prema APPNOTE,
 * vlastiti CRC-32 (tablica), inflate iz zlib-a; XLSX – dijeljeni nizovi i ćelije lista.
 */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer): number => { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

interface Entry { name: string; flags: number; method: number; crc: number; data: Buffer; offset: number }
/** Neovisni čitač ZIP-a: EOCD → središnji direktorij → lokalna zaglavlja → sadržaj (provjera CRC-a i veličina). */
export function readZip(zip: Buffer): Entry[] {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('nema EOCD');
  const count = zip.readUInt16LE(eocd + 10); const cdSize = zip.readUInt32LE(eocd + 12); const cdOffset = zip.readUInt32LE(eocd + 16);
  expect(cdOffset + cdSize).toBe(eocd);
  const out: Entry[] = []; let p = cdOffset;
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const flags = zip.readUInt16LE(p + 8); const method = zip.readUInt16LE(p + 10); const c = zip.readUInt32LE(p + 16);
    const csize = zip.readUInt32LE(p + 20); const usize = zip.readUInt32LE(p + 24); const nlen = zip.readUInt16LE(p + 28); const xlen = zip.readUInt16LE(p + 30); const clen = zip.readUInt16LE(p + 32);
    const offset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nlen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    expect(zip.readUInt32LE(offset)).toBe(0x04034b50);
    expect(zip.readUInt16LE(offset + 6)).toBe(flags); expect(zip.readUInt16LE(offset + 8)).toBe(method); expect(zip.readUInt32LE(offset + 14)).toBe(c);
    const lnlen = zip.readUInt16LE(offset + 26); const lxlen = zip.readUInt16LE(offset + 28);
    expect(zip.subarray(offset + 30, offset + 30 + lnlen).toString(flags & 0x800 ? 'utf8' : 'latin1')).toBe(name);
    const raw = zip.subarray(offset + 30 + lnlen + lxlen, offset + 30 + lnlen + lxlen + csize);
    const data = method === 8 ? inflateRawSync(raw) : method === 0 ? Buffer.from(raw) : (() => { throw new Error(`metoda ${method}`); })();
    expect(data.length).toBe(usize);
    expect(crc(data)).toBe(c);
    out.push({ name, flags, method, crc: c, data, offset });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}


/** Mini-čitač XLSX-a: dijeljeni nizovi + ćelije lista (za provjeru bez vanjskih alata). */
export function readSheet(files: Map<string, string>, n: number): Map<string, { t?: string; s?: string; v: string }> {
  const sst = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si><t(?: xml:space="preserve")?>([\s\S]*?)<\/t><\/si>/g)].map((m) => m[1]!
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  const out = new Map<string, { t?: string; s?: string; v: string }>();
  for (const m of files.get(`xl/worksheets/sheet${n}.xml`)!.matchAll(/<c r="([A-Z]+\d+)"(?: s="(\d+)")?(?: t="(\w+)")?>(?:<v>([^<]*)<\/v>)?<\/c>/g)) {
    out.set(m[1]!, { s: m[2], t: m[3], v: m[3] === 's' ? sst[Number(m[4])]! : m[4]! });
  }
  return out;
}

