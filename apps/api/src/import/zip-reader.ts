import { crc32, inflateRawSync } from 'node:zlib';
import { IMPORT_LIMITS, ImportFileError } from './limits';

/**
 * WP1.17 – čitač ZIP-a za datoteke koje šalje korisnik (XLSX je ZIP). Bez vanjskih ovisnosti (inflate i CRC-32 iz Node
 * `zlib`) i bez ikakvog rada s datotečnim sustavom: nazivi zapisa služe samo kao ključevi u memoriji. Obrana od ZIP bombe:
 * granica broja zapisa, deklarirane veličine svakog zapisa i svih zajedno, a inflate stvarno staje na deklariranoj
 * veličini (`maxOutputLength`) – lažna veličina u zaglavlju ne može izazvati veći izlaz. Nakon raspakiranja provjeravaju se
 * duljina i CRC-32. Zapisi se raspakiraju tek kad ih čitač zatraži (samo dijelovi radne knjige koji su potrebni).
 *
 * Odbija se: ZIP64, arhiva na više diskova, šifrirani zapisi (lozinka), metode sažimanja osim „stored” i „deflate”,
 * duplikati naziva (bez obzira na velika i mala slova – nazivi dijelova OOXML-a nisu osjetljivi na njih).
 */
interface EntryMeta { name: string; method: number; flags: number; crc: number; compressedSize: number; size: number; localOffset: number }

export interface ZipArchive {
  names(): string[];
  has(name: string): boolean;
  /** Raspakirani sadržaj zapisa (null ako ne postoji). */
  read(name: string): Buffer | null;
}

const EOCD = 0x06054b50, CEN = 0x02014b50, LOC = 0x04034b50, ZIP64_LOCATOR = 0x07064b50;
const bad = (msg: string) => new ImportFileError(`Datoteka nije ispravna radna knjiga: ${msg}.`, 'import_file_invalid');

export function openZip(buf: Buffer, limits = IMPORT_LIMITS): ZipArchive {
  if (buf.length < 22) throw bad('premala je za ZIP (XLSX)');
  // Kraj središnjeg direktorija: zadnji potpis za koji duljina komentara točno dolazi do kraja datoteke.
  let eocd = -1;
  for (let p = buf.length - 22; p >= Math.max(0, buf.length - 22 - 0xffff); p--) {
    if (buf.readUInt32LE(p) === EOCD && p + 22 + buf.readUInt16LE(p + 20) === buf.length) { eocd = p; break; }
  }
  if (eocd < 0) throw bad('nedostaje kraj ZIP arhive (datoteka je oštećena ili nepotpuno prenesena)');
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_LOCATOR) throw bad('ZIP64 arhive nisu podržane');
  const disk = buf.readUInt16LE(eocd + 4), cdDisk = buf.readUInt16LE(eocd + 6);
  const onDisk = buf.readUInt16LE(eocd + 8), count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12), cdOffset = buf.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || onDisk !== count) throw bad('arhive na više dijelova nisu podržane');
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw bad('ZIP64 arhive nisu podržane');
  if (count > limits.maxEntries) throw bad(`arhiva ima ${count} zapisa (najviše ${limits.maxEntries})`);
  if (cdOffset + cdSize > eocd) throw bad('središnji direktorij je izvan arhive');

  const entries = new Map<string, EntryMeta>();
  let total = 0; let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== CEN) throw bad('oštećen središnji direktorij');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nlen + xlen + clen > eocd) throw bad('oštećen središnji direktorij');
    const name = buf.subarray(p + 46, p + 46 + nlen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    p += 46 + nlen + xlen + clen;
    if (flags & 0x1) throw new ImportFileError('Datoteka je zaštićena lozinkom (šifrirana). Ukloni lozinku (Datoteka → Informacije → Zaštiti radnu knjigu) i spremi kao .xlsx.', 'import_file_encrypted');
    if (name.endsWith('/')) continue; // mapa
    if (method !== 0 && method !== 8) throw bad(`zapis „${name.slice(0, 60)}” koristi nepodržanu metodu sažimanja (${method})`);
    if (compressedSize === 0xffffffff || size === 0xffffffff) throw bad('ZIP64 arhive nisu podržane');
    if (size > limits.maxEntryBytes) throw new ImportFileError(`Dio radne knjige „${name.slice(0, 60)}” je nakon raspakiranja prevelik (${mb(size)}, najviše ${mb(limits.maxEntryBytes)}). Podijeli podatke u više datoteka.`, 'import_file_too_large');
    total += size;
    if (total > limits.maxTotalBytes) throw new ImportFileError(`Radna knjiga je nakon raspakiranja prevelika (više od ${mb(limits.maxTotalBytes)}). Podijeli podatke u više datoteka.`, 'import_file_too_large');
    const key = name.toLowerCase();
    if (entries.has(key)) throw bad(`zapis „${name.slice(0, 60)}” se ponavlja`);
    entries.set(key, { name, method, flags, crc, compressedSize, size, localOffset });
  }

  return {
    names: () => [...entries.values()].map((e) => e.name),
    has: (name) => entries.has(name.toLowerCase()),
    read(name) {
      const e = entries.get(name.toLowerCase());
      if (!e) return null;
      if (e.localOffset + 30 > cdOffset || buf.readUInt32LE(e.localOffset) !== LOC) throw bad(`oštećeno zaglavlje zapisa „${e.name.slice(0, 60)}”`);
      const start = e.localOffset + 30 + buf.readUInt16LE(e.localOffset + 26) + buf.readUInt16LE(e.localOffset + 28);
      if (start + e.compressedSize > cdOffset) throw bad(`zapis „${e.name.slice(0, 60)}” je izvan arhive`);
      const raw = buf.subarray(start, start + e.compressedSize);
      let out: Buffer;
      if (e.method === 0) out = Buffer.from(raw);
      else {
        try { out = inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) }); } catch (err) {
          const tooBig = (err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError;
          throw bad(tooBig ? `zapis „${e.name.slice(0, 60)}” je veći od deklarirane veličine (moguća ZIP bomba)` : `zapis „${e.name.slice(0, 60)}” se ne može raspakirati`);
        }
      }
      if (out.length !== e.size) throw bad(`veličina zapisa „${e.name.slice(0, 60)}” ne odgovara zaglavlju`);
      if (crc32(out) >>> 0 !== e.crc >>> 0) throw bad(`provjera CRC-32 zapisa „${e.name.slice(0, 60)}” nije uspjela (datoteka je oštećena)`);
      return out;
    },
  };
}

function mb(n: number): string { return `${(n / 1024 / 1024).toLocaleString('hr-HR', { maximumFractionDigits: 1 })} MB`; }
