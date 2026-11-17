import { and, asc, eq, inArray } from 'drizzle-orm';
import { daysInMonth } from '@arqus/domain';
import type { Tx } from '../db/db.service';
import { organisations, projectPartners, teamMembers, timesheetEntries, timesheets, users, workPackages, type Project } from '../db/schema';

/**
 * Mjesečna evidencija radnog vremena za potpis (WP1.16b) – isti dokument u paketu ZNS-a (`evidencije-rada/`) i u ispisu
 * pojedinog timesheeta na kartici „Tim i timesheetovi”. Samostalan HTML (bez skripti i vanjskih izvora) koji se ispisuje
 * na jednu stranicu A4: osoba, projekt, broj ugovora, mjesec, sati po danu i radnom paketu, zbrojevi, status i odobrenje,
 * crte za potpis zaposlenika i nadređenog.
 */

export interface TimesheetRecord {
  project: { acronym: string; title: string; contractNo: string | null; programme: string };
  organisation: string;
  person: { id: string; fullName: string; role: string | null };
  month: string;
  status: 'none' | 'draft' | 'submitted' | 'approved' | 'locked';
  submittedAt: Date | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  /** Radni paketi s upisanim satima u mjesecu (stupci), redoslijed po broju; `id` null = bez radnog paketa. */
  workPackages: { id: string | null; code: string; title: string }[];
  /** Minute po danu i radnom paketu (ključ: id radnog paketa ili '' za bez radnog paketa). */
  days: { day: number; minutes: Record<string, number>; total: number }[];
  totals: Record<string, number>;
  totalMinutes: number;
}

/** Evidencije za zadane parove (član tima, mjesec) projekta; član bez timesheeta za mjesec daje praznu evidenciju (status `none`). */
export async function loadTimesheetRecords(tx: Tx, project: Project, programme: string, keys: { memberId: string; month: string }[]): Promise<TimesheetRecord[]> {
  if (!keys.length) return [];
  const memberIds = [...new Set(keys.map((k) => k.memberId))];
  const months = [...new Set(keys.map((k) => k.month))];
  const members = await tx.select({ id: teamMembers.id, fullName: teamMembers.fullName, role: teamMembers.role, org: organisations.name }).from(teamMembers)
    .innerJoin(projectPartners, eq(projectPartners.id, teamMembers.partnerId)).innerJoin(organisations, eq(organisations.id, projectPartners.organisationId))
    .where(and(eq(teamMembers.projectId, project.id), inArray(teamMembers.id, memberIds)));
  const sheets = await tx.select().from(timesheets).where(and(eq(timesheets.projectId, project.id), inArray(timesheets.teamMemberId, memberIds), inArray(timesheets.month, months)));
  const entries = sheets.length ? await tx.select().from(timesheetEntries).where(inArray(timesheetEntries.timesheetId, sheets.map((s) => s.id))).orderBy(asc(timesheetEntries.day)) : [];
  const wps = await tx.select({ id: workPackages.id, number: workPackages.number, title: workPackages.title }).from(workPackages).where(eq(workPackages.projectId, project.id)).orderBy(asc(workPackages.number));
  const approverIds = [...new Set(sheets.map((s) => s.approvedBy).filter((x): x is string => !!x))];
  const approvers = approverIds.length ? await tx.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, approverIds)) : [];
  const out: TimesheetRecord[] = [];
  for (const k of keys) {
    const m = members.find((x) => x.id === k.memberId);
    if (!m) continue;
    const ts = sheets.find((s) => s.teamMemberId === k.memberId && s.month === k.month);
    const rows = ts ? entries.filter((e) => e.timesheetId === ts.id && e.minutes > 0) : [];
    const used = new Set(rows.map((e) => e.workPackageId ?? ''));
    const cols = [
      ...wps.filter((w) => used.has(w.id)).map((w) => ({ id: w.id as string | null, code: `WP${w.number}`, title: w.title })),
      ...(used.has('') ? [{ id: null, code: 'bez RP', title: 'Bez radnog paketa' }] : []),
    ];
    const days = Array.from({ length: daysInMonth(k.month) }, (_, i) => {
      const day = i + 1; const minutes: Record<string, number> = {};
      for (const e of rows.filter((x) => x.day === day)) minutes[e.workPackageId ?? ''] = (minutes[e.workPackageId ?? ''] ?? 0) + e.minutes;
      return { day, minutes, total: Object.values(minutes).reduce((a, x) => a + x, 0) };
    });
    const totals: Record<string, number> = {};
    for (const e of rows) totals[e.workPackageId ?? ''] = (totals[e.workPackageId ?? ''] ?? 0) + e.minutes;
    out.push({
      project: { acronym: project.acronym, title: project.title, contractNo: project.contractNo, programme },
      organisation: m.org, person: { id: m.id, fullName: m.fullName, role: m.role }, month: k.month,
      status: (ts?.status ?? 'none') as TimesheetRecord['status'], submittedAt: ts?.submittedAt ?? null, approvedAt: ts?.approvedAt ?? null,
      approvedBy: ts?.approvedBy ? (approvers.find((a) => a.id === ts.approvedBy)?.name ?? null) : null,
      workPackages: cols, days, totals, totalMinutes: rows.reduce((a, e) => a + e.minutes, 0),
    });
  }
  return out;
}

/* ---------- prikaz ---------- */

export const esc = (s: string | null | undefined): string => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const hrDate = (iso: string | Date | null | undefined): string => {
  if (!iso) return '–';
  const s = iso instanceof Date ? zagrebDate(iso) : iso.slice(0, 10);
  return `${s.slice(8, 10)}. ${s.slice(5, 7)}. ${s.slice(0, 4)}.`;
};
/** Kalendarski dan u zoni Europe/Zagreb (za datume odobrenja i predaje na dokumentima). */
export const zagrebDate = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export const hours = (minutes: number): string => (minutes ? String(Math.round((minutes / 60) * 100) / 100).replace('.', ',') : '');
const MONTHS = ['siječanj', 'veljača', 'ožujak', 'travanj', 'svibanj', 'lipanj', 'srpanj', 'kolovoz', 'rujan', 'listopad', 'studeni', 'prosinac'];
export const monthName = (ym: string): string => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}.`;
const WEEKDAYS = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'];
const STATUS: Record<TimesheetRecord['status'], string> = {
  none: 'nije unesen', draft: 'nacrt – nije predan', submitted: 'predan – čeka odobrenje', approved: 'odobren', locked: 'odobren i zaključan (u zahtjevu za nadoknadu)',
};

/** Zajednički stil dokumenata paketa (ispis na A4). */
export const PRINT_CSS = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; font-size: 9pt; color: #111; margin: 0; }
  @media screen { body { max-width: 210mm; margin: 12px auto; padding: 0 12mm; } }
  h1 { font-size: 13pt; margin: 0 0 2mm; }
  .draft { border: 2px solid #c00000; color: #c00000; font-weight: 700; padding: 1.5mm 3mm; margin: 0 0 3mm; text-align: center; letter-spacing: .5px; }
  .mark { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-size: 64pt; font-weight: 700; color: rgba(192, 0, 0, .08); transform: rotate(-24deg); pointer-events: none; z-index: 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #999; padding: .5mm 1.2mm; vertical-align: top; }
  th { background: #e7ecf3; font-weight: 600; text-align: left; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: #555; }
  .meta { margin: 0 0 3mm; }
  .meta td { border: none; padding: .3mm 2mm .3mm 0; }
  .meta td:first-child { color: #555; width: 32mm; }
  footer { margin-top: 3mm; font-size: 7.5pt; color: #555; }
`;

/**
 * Evidencija za ispis. `draftClaim` – dokument je dio paketa NACRTA zahtjeva (oznaka NACRT); timesheet koji nije odobren
 * dobiva oznaku „NIJE ODOBRENO”.
 */
export function renderTimesheetRecord(r: TimesheetRecord, opts: { draftClaim?: boolean; generatedBy?: string } = {}): string {
  const approved = r.status === 'approved' || r.status === 'locked';
  const cols = r.workPackages;
  const key = (c: { id: string | null }) => c.id ?? '';
  const narrow = cols.length > 6;
  const weekend = (d: number) => { const w = new Date(`${r.month}-${String(d).padStart(2, '0')}T00:00:00Z`).getUTCDay(); return w === 0 || w === 6; };
  const rows = r.days.map((d) => {
    const wd = new Date(`${r.month}-${String(d.day).padStart(2, '0')}T00:00:00Z`).getUTCDay();
    return `<tr${weekend(d.day) ? ' class="we"' : ''}><td class="num">${d.day}.</td><td>${WEEKDAYS[wd]}</td>${cols.map((c) => `<td class="num">${hours(d.minutes[key(c)] ?? 0)}</td>`).join('')}<td class="num"><b>${hours(d.total)}</b></td></tr>`;
  }).join('');
  const banner = [
    opts.draftClaim ? '<div class="draft">NACRT – zahtjev za nadoknadu još nije predan; evidencija se može promijeniti</div>' : '',
    !approved ? `<div class="draft">Timesheet nije odobren (${esc(STATUS[r.status])})</div>` : '',
  ].join('');
  return `<!doctype html>
<html lang="hr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evidencija rada – ${esc(r.person.fullName)} – ${esc(r.month)}</title>
<style>${PRINT_CSS}
  table.ts th, table.ts td { padding: .25mm 1mm; height: 4.45mm; font-size: ${narrow ? '7.5pt' : '8.5pt'}; }
  table.ts tr.we td { background: #f1f1f1; }
  table.ts tfoot td { font-weight: 700; background: #e7ecf3; }
  .legend { margin: 1.5mm 0 0; font-size: 7.5pt; color: #333; }
  .approval { margin: 2.5mm 0 0; }
  .sign { display: flex; gap: 10mm; margin-top: 7mm; }
  .sign div { flex: 1; }
  .sign .line { border-bottom: 1px solid #111; height: 9mm; }
  .sign small { color: #555; }
</style></head>
<body>
${opts.draftClaim ? '<div class="mark">NACRT</div>' : !approved ? '<div class="mark">NIJE ODOBRENO</div>' : ''}
<h1>Evidencija radnog vremena na projektu</h1>
${banner}
<table class="meta"><tbody>
<tr><td>Zaposlenik</td><td><b>${esc(r.person.fullName)}</b>${r.person.role ? ` · ${esc(r.person.role)}` : ''}</td><td>Mjesec</td><td><b>${esc(monthName(r.month))}</b></td></tr>
<tr><td>Projekt</td><td><b>${esc(r.project.acronym)}</b> – ${esc(r.project.title)}</td><td>Broj ugovora</td><td>${esc(r.project.contractNo ?? '–')}</td></tr>
<tr><td>Organizacija</td><td>${esc(r.organisation)}</td><td>Program</td><td>${esc(r.project.programme)}</td></tr>
</tbody></table>
<table class="ts">
<thead><tr><th class="num" style="width:9mm">Dan</th><th style="width:9mm"></th>${cols.map((c) => `<th class="num">${esc(c.code)}</th>`).join('')}<th class="num" style="width:16mm">Ukupno h</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="2">Ukupno</td>${cols.map((c) => `<td class="num">${hours(r.totals[key(c)] ?? 0)}</td>`).join('')}<td class="num">${hours(r.totalMinutes) || '0'}</td></tr></tfoot>
</table>
${cols.length ? `<p class="legend">${cols.map((c) => `<b>${esc(c.code)}</b> ${esc(c.title)}`).join(' · ')}</p>` : '<p class="legend">U mjesecu nema upisanih sati.</p>'}
<p class="approval">Ukupno sati na projektu: <b>${hours(r.totalMinutes) || '0'} h</b> · Status: <b>${esc(STATUS[r.status])}</b>${r.submittedAt ? ` · predano ${hrDate(r.submittedAt)}` : ''}${approved ? ` · odobrio/la: <b>${esc(r.approvedBy ?? '–')}</b>, ${hrDate(r.approvedAt)}` : ''}</p>
<div class="sign">
<div><div class="line"></div><small>Zaposlenik: ${esc(r.person.fullName)} – potpis i datum</small></div>
<div><div class="line"></div><small>Nadređeni / voditelj projekta – potpis i datum</small></div>
</div>
<footer>Izvor: ArQus Projekti${opts.generatedBy ? ` · ${esc(opts.generatedBy)}` : ''}. Sati iz mjesečnog timesheeta; trošak osoblja izračunat je prema pravilu programskog paketa.</footer>
</body></html>
`;
}
