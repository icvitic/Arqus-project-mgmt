/**
 * WP1.21 – poruke e-pošte i pravila dnevnog sažetka. Čiste funkcije bez ovisnosti: API ih samo popunjava i šalje.
 *
 * Pravila svih poruka: hrvatski, čitljive bez slika (tekst + jednostavan HTML s istim sadržajem), navode instituciju,
 * kažu što učiniti ako primatelj poruku nije očekivao, ne sadrže osobne podatke osim imena primatelja. Poveznica s tokenom
 * pojavljuje se samo kao poveznica (nigdje drugdje u poruci). Naslov je uvijek jedan redak bez kontrolnih znakova.
 */
import type { WorkItem } from './my-work.js';
import { dateIn, timeZoneOr } from './time.js';

export interface MailContent { subject: string; text: string; html: string }

/** Kontrolni znakovi (uključujući CR, LF, NUL, U+2028/2029) – nikad u zaglavlju poruke. */
const CONTROL = new RegExp(`[\\x00-\\x1f\\x7f\\x85${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

/** Jedan redak bez kontrolnih znakova i višestrukih razmaka, najviše `max` znakova (za naslov i ime u zaglavlju). */
export function oneLine(s: string, max = 200): string {
  const flat = s.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Escape za HTML tekst i vrijednosti atributa. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Datum `GGGG-MM-DD` → `18. 11. 2026.` */
export function hrDay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}. ${Number(m)}. ${y}.`;
}

/** Trenutak u zoni institucije → `18. 11. 2026. u 14:05`. */
export function hrDateTime(instant: Date, timeZone: string): string {
  const tz = timeZoneOr(timeZone);
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);
  return `${hrDay(dateIn(tz, instant))} u ${hm}`;
}

interface Base { institution: string; recipientName: string }

/** Blokovi poruke: odlomci teksta i poveznice; iz istog opisa slažu se tekst i HTML (isti sadržaj). */
type Block = { p: string } | { link: string; label?: string } | { list: string[] } | { small: string };

function render(subject: string, blocks: Block[]): MailContent {
  const text = blocks.map((b) => ('p' in b ? b.p : 'link' in b ? b.link : 'list' in b ? b.list.map((x) => `- ${x}`).join('\n') : b.small)).join('\n\n');
  const html = [
    '<!doctype html><html lang="hr"><head><meta charset="utf-8"><title>' + escapeHtml(subject) + '</title></head>',
    '<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;max-width:640px">',
    ...blocks.map((b) => ('p' in b ? `<p>${escapeHtml(b.p).replace(/\n/g, '<br>')}</p>`
      : 'link' in b ? `<p><a href="${escapeHtml(b.link)}">${escapeHtml(b.label ?? b.link)}</a></p>`
        : 'list' in b ? `<ul>${b.list.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
          : `<p style="color:#6b7280;font-size:13px">${escapeHtml(b.small).replace(/\n/g, '<br>')}</p>`)),
    '</body></html>',
  ].join('\n');
  return { subject: oneLine(subject), text: `${text}\n`, html };
}

const greeting = (name: string) => `Pozdrav, ${oneLine(name, 120)}!`;
const footer = (institution: string) => ({ small: `Ovu poruku poslao je sustav ArQus Projekti institucije ${oneLine(institution, 160)}. Poruka je automatska – na nju ne treba odgovarati.` });

/** Pozivnica: korisnik bira vlastitu lozinku na poveznici (`link` sadrži jednokratni token). */
export function invitationMail(i: Base & { link: string; validHours: number }): MailContent {
  const inst = oneLine(i.institution, 160);
  const valid = i.validHours % 24 === 0 ? `${i.validHours / 24} ${i.validHours / 24 === 1 ? 'dan' : 'dana'}` : `${i.validHours} h`;
  return render(`Pozivnica u ArQus Projekti – ${inst}`, [
    { p: greeting(i.recipientName) },
    { p: `Za tebe je otvoren račun u sustavu ArQus Projekti (institucija: ${inst}). Da bi počeo/la raditi, na poveznici odaberi vlastitu lozinku:` },
    { link: i.link, label: 'Odaberi lozinku i prijavi se' },
    { p: `Poveznica vrijedi ${valid} i može se upotrijebiti samo jednom. Lozinku nitko drugi ne zna – ni administrator.` },
    { p: 'Ako nisi očekivao/la ovu poruku, zanemari je: bez odabrane lozinke račun se ne može koristiti. Ako misliš da je riječ o pogrešci, javi se administratoru svoje institucije.' },
    footer(inst),
  ]);
}

/** Poveznica za novu lozinku (korisnik ju je zatražio sam ili ju je izdao administrator). */
export function passwordResetMail(i: Base & { link: string; validMinutes: number; byAdministrator: boolean }): MailContent {
  const inst = oneLine(i.institution, 160);
  const valid = i.validMinutes % 60 === 0 ? `${i.validMinutes / 60} h` : `${i.validMinutes} min`;
  return render(`Nova lozinka za ArQus Projekti – ${inst}`, [
    { p: greeting(i.recipientName) },
    { p: i.byAdministrator
      ? `Administrator institucije ${inst} izdao je poveznicu na kojoj možeš odabrati novu lozinku za ArQus Projekti:`
      : `Zatražena je nova lozinka za tvoj račun u sustavu ArQus Projekti (institucija: ${inst}). Novu lozinku odaberi na poveznici:` },
    { link: i.link, label: 'Odaberi novu lozinku' },
    { p: `Poveznica vrijedi ${valid} i može se upotrijebiti samo jednom. Nakon promjene odjavljuješ se sa svih uređaja; dvofaktorska prijava (ako je imaš) ostaje uključena.` },
    { p: 'Ako nisi zatražio/la novu lozinku, zanemari ovu poruku – dosadašnja lozinka i dalje vrijedi. Ako se poruka ponavlja, javi se administratoru svoje institucije.' },
    footer(inst),
  ]);
}

/** Obavijest nakon postavljanja nove lozinke poveznicom. */
export function passwordChangedMail(i: Base & { when: Date; timeZone: string; loginUrl: string }): MailContent {
  const inst = oneLine(i.institution, 160);
  return render(`Lozinka je promijenjena – ArQus Projekti (${inst})`, [
    { p: greeting(i.recipientName) },
    { p: `Lozinka tvog računa u sustavu ArQus Projekti (institucija: ${inst}) promijenjena je ${hrDateTime(i.when, i.timeZone)}. Odjavljen/a si sa svih uređaja.` },
    { p: 'Ako si lozinku promijenio/la ti, ne trebaš ništa učiniti. Ako nisi, odmah se javi administratoru svoje institucije.' },
    { link: i.loginUrl, label: 'Prijava u ArQus Projekti' },
    footer(inst),
  ]);
}

/** Probna poruka administratoru (provjera postavki e-pošte). */
export function testMail(i: Base & { when: Date; timeZone: string }): MailContent {
  const inst = oneLine(i.institution, 160);
  return render(`Probna poruka – ArQus Projekti (${inst})`, [
    { p: greeting(i.recipientName) },
    { p: `Ovo je probna poruka koju si ${hrDateTime(i.when, i.timeZone)} poslao/la sam/a sebi iz izbornika Korisnici. Ako je čitaš, slanje e-pošte radi.` },
    { p: 'Ako nisi ti poslao/la ovu poruku, javi se administratoru svoje institucije.' },
    footer(inst),
  ]);
}

/* ---------- dnevni sažetak (WP1.18 specifikacija, WP1.21 izvedba) ---------- */

/** Koliko stavki „kasni”/„uskoro” i novih obavijesti najviše ide u sažetak (ostatak: „i još N”). */
export const DIGEST_MAX_ITEMS = 15;
export const DIGEST_MAX_NOTIFICATIONS = 10;

/**
 * Radni dan bez kalendara blagdana: ponedjeljak–petak. Sažetak na državni blagdan nije štetan (iste stavke kao i dan
 * prije), a pogrešno preskočen radni dan bio bi; kalendar blagdana ovisi o zemlji i instituciji – nije u opsegu.
 */
export function isWorkingDay(isoDate: string): boolean {
  const dow = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
}

/** Sat (0–23) trenutka u zoni institucije. */
export function hourIn(timeZone: string, instant: Date): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: timeZoneOr(timeZone), hour: '2-digit', hourCycle: 'h23' }).format(instant);
  return Number(h);
}

/**
 * Je li sada vrijeme za sažetak u instituciji: radni dan (u zoni institucije), od `hour` sati do `hour + windowHours`
 * (sažetak koji zbog prekida rada nije otišao ujutro ne šalje se popodne). Vraća i dan institucije – ključ jednokratnosti.
 */
export function digestSlot(now: Date, timeZone: string, hour = 7, windowHours = 5): { day: string; due: boolean } {
  const day = dateIn(timeZoneOr(timeZone), now);
  const h = hourIn(timeZone, now);
  return { day, due: isWorkingDay(day) && h >= hour && h < Math.min(24, hour + windowHours) };
}

export interface DigestNotification { title: string; createdAt: Date | string; read: boolean }
export interface DigestSelection { overdue: WorkItem[]; dueSoon: WorkItem[]; waiting: number; notifications: { title: string }[] }

/**
 * Što ide u sažetak: stavke „kasni” i „uskoro” iz „Moj rad” (isti `deriveWorkItems`), broj stavki „čeka” i nepročitane
 * obavijesti nastale nakon prethodnog sažetka (`since`; bez prethodnog – sve nepročitane). Ako nema nijedne stavke
 * „kasni”/„uskoro” ni nove obavijesti → `null` (ne šalje se ništa).
 */
export function selectDigest(items: WorkItem[], notifications: DigestNotification[], since: Date | null): DigestSelection | null {
  const byDays = (a: WorkItem, b: WorkItem) => (a.days ?? 0) - (b.days ?? 0) || a.title.localeCompare(b.title, 'hr');
  const overdue = items.filter((i) => i.urgency === 'overdue').sort(byDays);
  const dueSoon = items.filter((i) => i.urgency === 'due_soon').sort(byDays);
  const waiting = items.filter((i) => i.urgency === 'waiting').length;
  const fresh = notifications.filter((n) => !n.read && (!since || new Date(n.createdAt).getTime() > since.getTime()))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  if (!overdue.length && !dueSoon.length && !fresh.length) return null;
  return { overdue, dueSoon, waiting, notifications: fresh.map((n) => ({ title: n.title })) };
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

/** Naslov sažetka: `ArQus: 2 kasni, 1 uskoro, 3 nove obavijesti` (dijelovi s nulom se izostavljaju). */
export function digestSubject(s: DigestSelection): string {
  const parts = [
    s.overdue.length ? `${s.overdue.length} kasni` : '',
    s.dueSoon.length ? `${s.dueSoon.length} uskoro` : '',
    s.notifications.length ? `${s.notifications.length} ${plural(s.notifications.length, 'nova obavijest', 'nove obavijesti', 'novih obavijesti')}` : '',
  ].filter(Boolean);
  return `ArQus: ${parts.join(', ')}`;
}

/**
 * Tijelo sažetka. `appUrl` – javna adresa instalacije (`PUBLIC_URL`); poveznice vode na zaslone aplikacije, bez tokena i
 * bez ičega što prijavljuje korisnika. Stavke: naslov, oznaka projekta i rok; obavijesti samo naslovom (pojedinosti
 * obavijesti nose imena drugih korisnika i razloge – vide se u aplikaciji). Nijedan iznos.
 */
export function digestMail(i: Base & { selection: DigestSelection; appUrl: string; today: string }): MailContent {
  const inst = oneLine(i.institution, 160);
  const s = i.selection;
  const app = i.appUrl.replace(/\/+$/, '');
  // Pojedinosti stavke već sadrže rok („kasni 3 dana (rok …)”); bez pojedinosti navodi se rok.
  const line = (w: WorkItem) => oneLine(`${w.acronym ? `[${w.acronym}] ` : ''}${w.title}${w.detail ? ` – ${w.detail}` : w.due ? ` – rok ${hrDay(w.due)}` : ''}`, 300);
  const listed = [...s.overdue.map((w) => ({ w, tag: 'kasni' })), ...s.dueSoon.map((w) => ({ w, tag: 'uskoro' }))];
  const shown = listed.slice(0, DIGEST_MAX_ITEMS);
  const blocks: Block[] = [{ p: greeting(i.recipientName) }, { p: `Ovo te čeka u sustavu ArQus Projekti (${inst}) na dan ${hrDay(i.today)}` }];
  const over = shown.filter((x) => x.tag === 'kasni').map((x) => line(x.w));
  const soon = shown.filter((x) => x.tag === 'uskoro').map((x) => line(x.w));
  if (over.length) blocks.push({ p: `Kasni (${s.overdue.length}):` }, { list: over });
  if (soon.length) blocks.push({ p: `Uskoro (${s.dueSoon.length}):` }, { list: soon });
  if (listed.length > shown.length) blocks.push({ p: `… i još ${listed.length - shown.length} u „Moj rad”.` });
  if (s.waiting) blocks.push({ p: `Čeka bez bliskog roka: ${s.waiting} ${plural(s.waiting, 'stavka', 'stavke', 'stavki')}.` });
  if (s.notifications.length) {
    const notes = s.notifications.slice(0, DIGEST_MAX_NOTIFICATIONS).map((n) => oneLine(n.title, 300));
    blocks.push({ p: `Nove obavijesti (${s.notifications.length}):` }, { list: notes });
    if (s.notifications.length > notes.length) blocks.push({ p: `… i još ${s.notifications.length - notes.length} u aplikaciji.` });
  }
  blocks.push(
    { link: `${app}/#/moj-rad`, label: 'Otvori „Moj rad”' },
    { small: 'Sažetak se šalje radnim danom ujutro samo kad nešto kasni, dospijeva uskoro ili imaš novu obavijest. Isključuješ ga u aplikaciji: Moj račun → Dnevni sažetak e-poštom.' },
    footer(inst),
  );
  return render(digestSubject(s), blocks);
}
