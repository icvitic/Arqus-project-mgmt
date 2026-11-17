/** Formatiranje i parsiranje za hrvatsko sučelje. Novac je u API-ju uvijek u centima. */
const eurFmt = new Intl.NumberFormat('hr-HR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const eur = (cents: number | null | undefined): string => (cents === null || cents === undefined ? '–' : eurFmt.format(cents / 100));

/** "1.234,56" / "20.000" / "1234.56" / "1234" → centi; točka s tri znamenke iza = tisuće; prazno → 0; neispravno → null. */
export function parseEur(input: string): number | null {
  const s = input.trim().replace(/\s|€/g, '');
  if (!s) return 0;
  let norm = s;
  if (s.includes(',')) norm = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) norm = s.replace(/\./g, ''); // "20.000" i "1.000.000" su tisuće (hrvatski zapis)
  if (!/^\d+(\.\d{1,2})?$/.test(norm)) return null;
  return Math.round(parseFloat(norm) * 100);
}

export const centsToInput = (cents: number): string => (cents ? (cents / 100).toFixed(2).replace('.', ',') : '');

export const date = (iso: string | null | undefined): string => {
  if (!iso) return '–';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}. ${m}. ${y}.`;
};

/** ISO vrijeme → "22. 04. 2027. 17:00" u lokalnoj zoni preglednika. */
export const dateTime = (iso: string | null | undefined): string => {
  if (!iso) return '–';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}. ${p(d.getMonth() + 1)}. ${d.getFullYear()}. ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Sati u obliku "7,5" ili "7.5" → minute; prazno → 0; neispravno → null. */
export function parseHours(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (!s) return 0;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 60);
}
export const minutesToHours = (m: number): string => (m ? String(Math.round((m / 60) * 100) / 100).replace('.', ',') : '');

export const PROJECT_STATUS: Record<string, string> = {
  contracting: 'u ugovaranju', active: 'aktivan', suspended: 'obustavljen', closing: 'u završetku', closed: 'zatvoren', terminated: 'prekinut', archived: 'arhiviran',
};
export const TRANSITIONS: Record<string, string[]> = {
  contracting: ['active', 'terminated'], active: ['suspended', 'closing', 'terminated'], suspended: ['active', 'terminated'],
  closing: ['closed', 'active'], closed: ['archived'], terminated: ['archived'], archived: [],
};
export const GENERIC_STATUS: Record<string, string> = {
  draft: 'nacrt', submitted: 'predan', approved: 'odobren', locked: 'zaključan', none: 'nema', partially_approved: 'djelomično odobren', rejected: 'odbijen',
  planned: 'planirano', in_progress: 'u izradi', accepted: 'prihvaćeno', done: 'gotovo', cancelled: 'otkazano', achieved: 'ostvareno', missed: 'propušteno',
  open: 'otvoren', mitigated: 'ublažen', occurred: 'nastupio', recorded: 'evidentiran', claimed: 'u zahtjevu', partially_accepted: 'djelomično priznat', invited: 'pozvan', disabled: 'deaktiviran', published: 'objavljen', deprecated: 'zastario', announced: 'najavljen', go: 'go', no_go: 'no-go', watch: 'pratimo',
  idea: 'ideja', preparation: 'u pripremi', internal_review: 'interna provjera', in_evaluation: 'u evaluaciji', funded: 'financirana', reserve: 'rezervna lista', withdrawn: 'povučena', contracted: 'ugovorena',
};
/**
 * WP1.14b: oznaka statusa u rodu imenice uz koju stoji. Zadano muški rod (projekt, proračun, ZNS, timesheet, trošak);
 * `'f'` za imenice ženskog roda – prijava, isporuka, prekretnica („predana”, „odbijena”, „ostvarena”).
 */
export type Gender = 'm' | 'f';
const FEMININE: Record<string, string> = {
  submitted: 'predana', approved: 'odobrena', partially_approved: 'djelomično odobrena', rejected: 'odbijena', accepted: 'prihvaćena', locked: 'zaključana',
  planned: 'planirana', achieved: 'ostvarena', missed: 'propuštena', open: 'otvorena', closed: 'zatvorena', cancelled: 'otkazana', done: 'gotova',
};
export const label = (s: string, gender: Gender = 'm'): string => (gender === 'f' ? FEMININE[s] : undefined) ?? PROJECT_STATUS[s] ?? GENERIC_STATUS[s] ?? s;

/** Hrvatska množina: 1 isporuka, 2–4 isporuke, 5+ (i 11–14) isporuka. */
export function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
}
/** Minute → sati s najviše jednom decimalom ("7,5"). */
export const hours = (minutes: number): string => (minutes / 60).toLocaleString('hr-HR', { maximumFractionDigits: 1 });
const MONTHS = ['sij.', 'velj.', 'ožu.', 'tra.', 'svi.', 'lip.', 'srp.', 'kol.', 'ruj.', 'lis.', 'stu.', 'pro.'];
/** "2027-02" → "velj. 2027." (kratko: "velj."). */
export const monthLabel = (ym: string, short = false): string => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym}${short ? '' : ` ${ym.slice(0, 4)}.`}`;
