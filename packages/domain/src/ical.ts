/**
 * WP1.18 – osobni kalendar rokova u obliku iCalendar (RFC 5545). Čiste funkcije bez ovisnosti: CRLF, presavijanje
 * redaka na 75 okteta (bez prelamanja UTF-8 znaka), escape teksta, stabilni UID-ovi (ažuriranje zamjenjuje događaj),
 * cjelodnevni događaji za rokove bez vremena i događaj s vremenom (UTC) za rok s vremenom.
 */
import { addDays } from './project.js';

export interface CalendarEvent {
  /** Stabilan, jedinstven identifikator (isti pri svakom dohvatu dok događaj postoji). */
  uid: string;
  /** Kalendarski dan roka `GGGG-MM-DD` (cjelodnevni događaj). */
  date: string;
  /** Trenutak roka (ISO 8601 s vremenskom zonom) – događaj s vremenom umjesto cjelodnevnog. */
  at?: string;
  summary: string;
  description?: string;
  categories?: string[];
}

/** Escape vrijednosti tipa TEXT (RFC 5545, 3.3.11): `\` `;` `,` i prijelom retka. */
export function icalText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Presavijanje retka (RFC 5545, 3.1): najviše 75 okteta po retku, nastavak počinje razmakom. Granica se nikad ne
 * postavlja usred višebajtnog UTF-8 znaka.
 */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = ''; let bytes = 0; let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { out.push(cur); cur = ''; bytes = 0; limit = 74; } // nastavak: 1 oktet je vodeći razmak
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const compactDate = (iso: string): string => iso.slice(0, 10).replace(/-/g, '');
/** UTC trenutak u obliku `GGGGMMDDTHHMMSSZ`. */
export const icalUtc = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export interface CalendarOptions {
  /** Naziv kalendara u klijentu (X-WR-CALNAME). */
  name: string;
  /** DTSTAMP svih događaja (trenutak izrade feeda). */
  stamp: Date;
  prodId?: string;
  /** Preporučeni interval osvježavanja (ISO 8601 trajanje), npr. `PT4H`. */
  refresh?: string;
}

/** Cijeli iCalendar dokument (CRLF, presavijeni retci, završava s CRLF). */
export function buildCalendar(events: CalendarEvent[], opts: CalendarOptions): string {
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${opts.prodId ?? '-//Arqus Solutions//ArQus Projekti//HR'}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icalText(opts.name)}`];
  if (opts.refresh) lines.push(`REFRESH-INTERVAL;VALUE=DURATION:${opts.refresh}`, `X-PUBLISHED-TTL:${opts.refresh}`);
  const stamp = icalUtc(opts.stamp);
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${icalText(e.uid)}`, `DTSTAMP:${stamp}`);
    const at = e.at ? new Date(e.at) : null;
    if (at && !Number.isNaN(at.getTime())) {
      lines.push(`DTSTART:${icalUtc(at)}`, `DTEND:${icalUtc(at)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(e.date)}`, `DTEND;VALUE=DATE:${compactDate(addDays(e.date.slice(0, 10), 1))}`);
    }
    lines.push(`SUMMARY:${icalText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${icalText(e.description)}`);
    if (e.categories?.length) lines.push(`CATEGORIES:${e.categories.map(icalText).join(',')}`);
    lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
