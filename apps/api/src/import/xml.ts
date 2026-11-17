import { IMPORT_LIMITS, ImportFileError } from './limits';

/**
 * WP1.17 – minimalni XML tokenizator za dijelove radne knjige (SpreadsheetML). Namjerno uzak:
 * - DTD (`<!DOCTYPE`) i deklaracije entiteta se odbijaju – nema vanjskih entiteta, nema širenja entiteta (XXE, „billion laughs”);
 * - prepoznaje samo pet predefiniranih entiteta i brojčane reference znakova; svaki drugi entitet je greška;
 * - prefiks imenskog prostora se odbacuje (`x:row` → `row`), pa radi i za radne knjige koje koriste prefikse;
 * - komentari i upute za obradu se preskaču, CDATA je tekst;
 * - linearan prolaz kroz tekst, granica dubine ugniježđenja.
 * Rezultat su događaji (otvoren element s atributima, zatvoren element, tekst) – bez stabla u memoriji.
 */
export interface XmlHandler {
  open(name: string, attrs: Record<string, string>, selfClosing: boolean): void;
  close?(name: string): void;
  text?(text: string): void;
}

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const bad = (part: string, msg: string) => new ImportFileError(`Dio radne knjige „${part}” nije ispravan XML: ${msg}.`, 'import_file_invalid');

const local = (name: string): string => { const i = name.indexOf(':'); return i >= 0 ? name.slice(i + 1) : name; };

export function decodeEntities(s: string, part = 'xml'): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{0,30});|&/g, (_m, e: string | undefined) => {
    if (e === undefined) throw bad(part, 'znak & bez entiteta');
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw bad(part, 'neispravna referenca znaka');
      return String.fromCodePoint(code);
    }
    const v = NAMED[e];
    if (v === undefined) throw bad(part, `nepoznat entitet &${e.slice(0, 20)}; (vanjski entiteti nisu dopušteni)`);
    return v;
  });
}

/** XML iz bajtova: UTF-8 (s BOM-om ili bez), UTF-16 uz BOM. */
export function xmlText(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2)); b.swap16(); return b.toString('utf16le'); }
  const s = buf.toString('utf8');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function parseXml(xml: string, part: string, h: XmlHandler): void {
  const n = xml.length; let i = 0; let depth = 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { if (h.text && xml.slice(i).trim()) h.text(decodeEntities(xml.slice(i), part)); break; }
    if (lt > i && h.text) h.text(decodeEntities(xml.slice(i, lt), part));
    const c = xml.charCodeAt(lt + 1);
    if (c === 63 /* ? */) { const e = xml.indexOf('?>', lt + 2); if (e < 0) throw bad(part, 'nezatvorena uputa za obradu'); i = e + 2; continue; }
    if (c === 33 /* ! */) {
      if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt + 4); if (e < 0) throw bad(part, 'nezatvoren komentar'); i = e + 3; continue; }
      if (xml.startsWith('<![CDATA[', lt)) { const e = xml.indexOf(']]>', lt + 9); if (e < 0) throw bad(part, 'nezatvoren CDATA'); if (h.text) h.text(xml.slice(lt + 9, e)); i = e + 3; continue; }
      throw bad(part, 'DTD i deklaracije (<!DOCTYPE, <!ENTITY) nisu dopušteni');
    }
    // Kraj oznake: prvi '>' izvan navodnika.
    let j = lt + 1; let quote = 0;
    for (; j < n; j++) {
      const ch = xml.charCodeAt(j);
      if (quote) { if (ch === quote) quote = 0; } else if (ch === 34 || ch === 39) quote = ch; else if (ch === 62) break;
    }
    if (j >= n) throw bad(part, 'nezatvorena oznaka');
    const tag = xml.slice(lt + 1, j);
    i = j + 1;
    if (tag[0] === '/') {
      depth--;
      if (depth < 0) throw bad(part, 'zatvaranje elementa koji nije otvoren');
      h.close?.(local(tag.slice(1).trim()));
      continue;
    }
    const selfClosing = tag.endsWith('/');
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const sp = body.search(/\s/);
    const name = local(sp < 0 ? body : body.slice(0, sp));
    if (!name) throw bad(part, 'element bez naziva');
    const attrs: Record<string, string> = {};
    if (sp >= 0) {
      const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let m: RegExpExecArray | null;
      const rest = body.slice(sp);
      while ((m = re.exec(rest))) attrs[local(m[1]!)] = decodeEntities(m[2] ?? m[3] ?? '', part);
    }
    if (!selfClosing) { depth++; if (depth > IMPORT_LIMITS.maxXmlDepth) throw bad(part, 'preduboko ugniježđeni elementi'); }
    h.open(name, attrs, selfClosing);
    if (selfClosing) h.close?.(name);
  }
  if (depth !== 0) throw bad(part, 'nezatvoreni elementi (datoteka je nepotpuna)');
}
