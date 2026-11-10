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
  open: 'otvoren', mitigated: 'ublažen', occurred: 'nastupio', recorded: 'evidentiran', claimed: 'u zahtjevu',
};
export const label = (s: string): string => PROJECT_STATUS[s] ?? GENERIC_STATUS[s] ?? s;
