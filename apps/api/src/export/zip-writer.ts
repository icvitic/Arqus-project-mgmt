import { crc32, deflateRaw } from 'node:zlib';
import { promisify } from 'node:util';

/**
 * Minimalni ZIP pisač (PKWARE APPNOTE 6.3, bez ZIP64) za izvoz paketa ZNS-a (WP1.16b). Bez vanjskih ovisnosti:
 * deflate i CRC-32 iz Node `zlib`. Zapisi se proizvode jedan po jedan (`entry` vraća dijelove za slanje odmah),
 * pa se arhiva šalje u odgovor bez držanja cijele arhive u memoriji; u memoriji je samo trenutna datoteka.
 *
 * Ograničenja (namjerna, provjeravaju se): najviše 65 534 zapisa, svaka datoteka i cijela arhiva ispod 4 GiB
 * (izvoz ima vlastitu, znatno nižu granicu). Nazivi su UTF-8 (oznaka 11 kad naziv nije ASCII); sigurni nazivi
 * (bez apsolutnih putanja, `..`, `\`, kontrolnih znakova) i bez duplikata (i bez razlike u velikim/malim slovima).
 */
const deflate = promisify(deflateRaw);
const MAX = 0xffffffff;
const MAX_ENTRIES = 0xfffe;

export interface ZipEntryOptions {
  /** Zadano: deflate ako smanjuje datoteku, inače spremanje bez sažimanja. */
  compress?: boolean;
}

/** DOS vrijeme i datum (lokalno vrijeme poslužitelja, kao što ih čitaju alati za raspakiranje). */
export function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Provjera naziva zapisa: relativna putanja s `/`, bez praznih, `.` i `..` dijelova, kontrolnih znakova i `\`/`:`. */
export function assertSafeZipPath(name: string): void {
  // eslint-disable-next-line no-control-regex
  if (!name || name.startsWith('/') || /[\\:\u0000-\u001f\u007f]/.test(name)) throw new Error(`Nesiguran naziv u arhivi: ${JSON.stringify(name)}`);
  for (const part of name.split('/')) {
    if (!part || part === '.' || part === '..') throw new Error(`Nesiguran naziv u arhivi: ${JSON.stringify(name)}`);
    if (Buffer.byteLength(part, 'utf8') > 255) throw new Error(`Predug dio naziva u arhivi: ${JSON.stringify(part.slice(0, 40))}…`);
  }
  if (Buffer.byteLength(name, 'utf8') > 4000) throw new Error('Predug naziv u arhivi');
}

export class ZipWriter {
  private offset = 0;
  private readonly central: Buffer[] = [];
  private readonly seen = new Set<string>();
  private readonly stamp: { time: number; date: number };
  private finished = false;
  private entries = 0;

  constructor(mtime: Date = new Date()) { this.stamp = dosDateTime(mtime); }

  /** Broj bajtova koji su do sada proizvedeni. */
  get size(): number { return this.offset; }
  get count(): number { return this.entries; }

  /** Zapis jedne datoteke: vraća lokalno zaglavlje i (sažeti) sadržaj, spremne za slanje. */
  async entry(name: string, data: Buffer, opts: ZipEntryOptions = {}): Promise<Buffer[]> {
    if (this.finished) throw new Error('Arhiva je već zatvorena');
    assertSafeZipPath(name);
    const key = name.normalize('NFC').toLowerCase();
    if (this.seen.has(key)) throw new Error(`Dvostruki naziv u arhivi: ${name}`);
    if (this.entries >= MAX_ENTRIES) throw new Error('Previše datoteka za ZIP bez ZIP64');
    if (data.length >= MAX) throw new Error(`Datoteka ${name} je prevelika za ZIP bez ZIP64`);
    this.seen.add(key);

    const nameBuf = Buffer.from(name, 'utf8');
    const utf8 = /[^\x20-\x7e]/.test(name);
    const flags = utf8 ? 0x0800 : 0;
    const crc = crc32(data) >>> 0;
    let method = 0; let body = data;
    if (opts.compress !== false && data.length > 0) {
      const z = await deflate(data, { level: 6 });
      if (z.length < data.length) { method = 8; body = z; }
    }
    if (this.offset + 30 + nameBuf.length + body.length >= MAX) throw new Error('Arhiva je prevelika za ZIP bez ZIP64');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // potrebna verzija 2.0 (deflate)
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(this.stamp.time, 10);
    local.writeUInt16LE(this.stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE((3 << 8) | 20, 4); // izrađeno na: Unix, verzija 2.0 (dozvole u vanjskim atributima)
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(this.stamp.time, 12);
    cd.writeUInt16LE(this.stamp.date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // komentar
    cd.writeUInt16LE(0, 34); // disk
    cd.writeUInt16LE(0, 36); // unutarnji atributi
    cd.writeUInt32LE((0o100644 << 16) >>> 0, 38); // obična datoteka, rw-r--r--
    cd.writeUInt32LE(this.offset, 42);
    this.central.push(cd, nameBuf);
    this.entries++;

    this.offset += local.length + nameBuf.length + body.length;
    return [local, nameBuf, body];
  }

  /** Središnji direktorij i završni zapis; nakon toga arhiva je zatvorena. */
  finish(): Buffer {
    if (this.finished) throw new Error('Arhiva je već zatvorena');
    this.finished = true;
    const cd = Buffer.concat(this.central);
    if (this.offset + cd.length + 22 >= MAX) throw new Error('Arhiva je prevelika za ZIP bez ZIP64');
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.count, 8);
    end.writeUInt16LE(this.count, 10);
    end.writeUInt32LE(cd.length, 12);
    end.writeUInt32LE(this.offset, 16);
    end.writeUInt16LE(0, 20);
    this.offset += cd.length + end.length;
    return Buffer.concat([cd, end]);
  }
}

/** Cijela (mala) arhiva u memoriji – za XLSX i testove. Izvoz paketa koristi `ZipWriter` izravno (strujanje). */
export async function zipToBuffer(entries: { name: string; data: Buffer; compress?: boolean }[], mtime?: Date): Promise<Buffer> {
  const z = new ZipWriter(mtime);
  const parts: Buffer[] = [];
  for (const e of entries) parts.push(...(await z.entry(e.name, e.data, { compress: e.compress })));
  parts.push(z.finish());
  return Buffer.concat(parts);
}

/* ---------- sigurni i čitljivi nazivi ---------- */

const FOLD: Record<string, string> = { č: 'c', ć: 'c', đ: 'd', š: 's', ž: 'z', Č: 'C', Ć: 'C', Đ: 'D', Š: 'S', Ž: 'Z', ß: 'ss', Æ: 'AE', æ: 'ae', Ø: 'O', ø: 'o', Ł: 'L', ł: 'l' };

/** ASCII naziv za mape (npr. „Marina Šimić” → „Marina-Simic”): hrvatska slova bez dijakritika, ostalo `-`. */
export function asciiSlug(s: string, max = 60): string {
  const folded = [...s].map((ch) => FOLD[ch] ?? ch).join('').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const full = folded.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let slug = full.slice(0, max);
  // Rez na granici riječi kad je naziv predug (ako time ne ostane premalo).
  if (full.length > max && full[max] !== '-') { const cut = slug.lastIndexOf('-'); if (cut >= max / 2) slug = slug.slice(0, cut); }
  slug = slug.replace(/-+$/, '');
  return slug || 'x';
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Siguran naziv datoteke (zadržava UTF-8 slova): bez razdjelnika putanje i znakova koje Windows ne dopušta,
 * bez vodećih točaka i završnih točaka/razmaka, rezerviranih naziva (CON, NUL…), najviše `max` znakova uz ekstenziju.
 */
export function safeFileName(name: string, max = 120): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  let s = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '');
  if ([...s].length > max) {
    const dot = s.lastIndexOf('.'); const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : '';
    s = [...s.slice(0, s.length - ext.length)].slice(0, max - ext.length).join('').replace(/[. ]+$/, '') + ext;
  }
  if (RESERVED.test(s)) s = `_${s}`;
  return s || 'datoteka';
}

/** Jedinstveni nazivi unutar arhive (bez obzira na velika/mala slova): drugi „racun.pdf” postaje „racun (2).pdf”. */
export class UniqueNames {
  private readonly used = new Set<string>();
  take(dir: string, name: string): string {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name; const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 1; ; i++) {
      const candidate = `${dir ? `${dir}/` : ''}${i === 1 ? name : `${stem} (${i})${ext}`}`;
      const key = candidate.normalize('NFC').toLowerCase();
      if (!this.used.has(key)) { this.used.add(key); return candidate; }
    }
  }
}
