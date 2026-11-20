/**
 * WP1.24 – evidencija zahtjeva ispitanika (čl. 12(3) GDPR-a): vrste zahtjeva, ishodi i izračun roka za odgovor.
 *
 * **Rok.** Odgovor u roku od mjesec dana od zaprimanja; rok se može produljiti za najviše dva daljnja mjeseca, o čemu se
 * ispitanika obavještava unutar prvog mjeseca. Mjesec se računa kalendarski (Uredba 1182/71, čl. 3): rok istječe na dan
 * koji brojem odgovara danu zaprimanja, a ako takvog dana u mjesecu nema, posljednjeg dana tog mjeseca.
 * Rok koji padne na subotu, nedjelju ili blagdan sustav NE pomiče na idući radni dan – prikazani rok je zato isti ili
 * raniji od pravnog, nikad kasniji. Kada rok počinje teći (npr. nakon utvrđivanja identiteta) procjenjuje institucija;
 * sustav računa od upisanog dana zaprimanja.
 */
import { daysBetween } from './portfolio.js';

export const SUBJECT_REQUEST_KINDS = ['access', 'rectification', 'erasure', 'restriction', 'portability', 'objection', 'other'] as const;
export type SubjectRequestKind = (typeof SUBJECT_REQUEST_KINDS)[number];
export const SUBJECT_REQUEST_KIND_LABELS: Record<SubjectRequestKind, string> = {
  access: 'pristup podacima (čl. 15)', rectification: 'ispravak (čl. 16)', erasure: 'brisanje (čl. 17)', restriction: 'ograničenje obrade (čl. 18)',
  portability: 'prenosivost (čl. 20)', objection: 'prigovor (čl. 21)', other: 'drugo',
};

export const SUBJECT_REQUEST_CHANNELS = ['email', 'post', 'in_person', 'other'] as const;
export type SubjectRequestChannel = (typeof SUBJECT_REQUEST_CHANNELS)[number];
export const SUBJECT_REQUEST_CHANNEL_LABELS: Record<SubjectRequestChannel, string> = { email: 'e-pošta', post: 'pošta', in_person: 'osobno', other: 'drugo' };

export const SUBJECT_REQUEST_OUTCOMES = ['fulfilled', 'partly_fulfilled', 'refused', 'withdrawn'] as const;
export type SubjectRequestOutcome = (typeof SUBJECT_REQUEST_OUTCOMES)[number];
export const SUBJECT_REQUEST_OUTCOME_LABELS: Record<SubjectRequestOutcome, string> = {
  fulfilled: 'udovoljeno', partly_fulfilled: 'djelomično udovoljeno', refused: 'odbijeno (s obrazloženjem)', withdrawn: 'povučen',
};

/** Osnovni rok u mjesecima i najdulje produljenje (čl. 12(3)). */
export const SUBJECT_REQUEST_MONTHS = 1;
export const SUBJECT_REQUEST_EXTENSION_MONTHS = 2;
/** „Uskoro” za zahtjev ispitanika u „Moj rad”: zadnjih 10 dana roka (rok je ukupno mjesec dana). */
export const SUBJECT_REQUEST_SOON_DAYS = 10;

/** Dan koji je `months` kalendarskih mjeseci nakon `isoDate`; ako mjesec nema taj dan, njegov posljednji dan. */
export function addCalendarMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12), tm = (total % 12) + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${String(ty).padStart(4, '0')}-${String(tm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Rok za odgovor: mjesec dana od zaprimanja, uz produljenje tri mjeseca od zaprimanja. */
export function subjectRequestDue(receivedOn: string, extended: boolean): string {
  return addCalendarMonths(receivedOn, SUBJECT_REQUEST_MONTHS + (extended ? SUBJECT_REQUEST_EXTENSION_MONTHS : 0));
}

/**
 * Je li obavijest o produljenju zakašnjela: ispitanik mora biti obaviješten unutar prvog mjeseca (osnovnog roka).
 * Sustav zakašnjelo produljenje ne odbija (institucija ga je mogla priopćiti na vrijeme, a upisati kasnije) – samo ga označava.
 */
export const extensionIsLate = (receivedOn: string, informedOn: string): boolean => informedOn > subjectRequestDue(receivedOn, false);

export type SubjectRequestState = 'overdue' | 'due_soon' | 'open' | 'closed_late' | 'closed';
/** Stanje zahtjeva prema roku: otvoren (kasni / uskoro / u roku) ili zatvoren (u roku / nakon roka). */
export function subjectRequestState(r: { dueOn: string; closedOn: string | null }, today: string): SubjectRequestState {
  if (r.closedOn) return r.closedOn > r.dueOn ? 'closed_late' : 'closed';
  const d = daysBetween(today, r.dueOn);
  return d < 0 ? 'overdue' : d <= SUBJECT_REQUEST_SOON_DAYS ? 'due_soon' : 'open';
}

/** Oznaka zahtjeva: `ZI-7` (redni broj unutar institucije). */
export const subjectRequestRef = (number: number): string => `ZI-${number}`;
