import type { PartnerBudgetResult } from '@arqus/domain';
import { bold, dateCell, header, money, type Cell, type Sheet, type Workbook } from '../export/xlsx-writer';
import { esc, hrDate, PRINT_CSS, zagrebDate } from './timesheet-record';
import type { ClaimsService } from './claims.service';

/**
 * Sadržaj paketa ZNS-a za predaju (WP1.16b): radna knjiga troškova, kontrolna lista i manifest. Čiste funkcije nad
 * podacima koje je `ClaimExportService` pročitao u jednoj transakciji. Struktura je generička (kategorije troškova iz
 * paketa programa); obrasci pojedinih financijera (eFondovi, financijski izvještaj Horizon Europe) nisu dio paketa.
 * Generirane datoteke ne sadrže vrijeme izvoza (samo manifest), pa dva izvoza istih podataka daju iste datoteke.
 */

export type ClaimView = Awaited<ReturnType<ClaimsService['get']>>;
export type ClaimExpenseView = ClaimView['expenses'][number];

export interface ExportCategory { code: string; name: string; kind: string; ratePercent?: number }
export interface EvidenceRef { path: string | null; title: string; fileName: string | null; confidential: boolean; omitted: boolean }
export interface PersonnelRow {
  person: string; role: string | null; month: string; minutes: number; amount: number; recognised: number | null;
  /** Po radnom paketu (ključ: id ili ''): minute i iznos. */
  byWp: Map<string, { minutes: number; amount: number }>;
}

export interface ExportData {
  draft: boolean;
  claim: ClaimView;
  project: { acronym: string; title: string; contractNo: string | null; actionType: string; programme: string; packageId: string; packageVersion: string; funder: string | null };
  partnerName: string;
  /** Kategorije paketa u redoslijedu paketa: izravne (listovi) i neizravne. */
  categories: ExportCategory[];
  personnelRule: { method?: string; divisor?: number; hoursPerDay?: number } | null;
  canPersonnel: boolean;
  /** Radni paketi projekta (redoslijed po broju); `id` '' = bez radnog paketa. */
  workPackages: { id: string; code: string; title: string }[];
  expenseWp: Map<string, string | null>;
  /** Mapa dokaza po trošku i dokazi (putanja u paketu ili izostavljen povjerljivi). */
  expenseFolder: Map<string, string>;
  evidence: Map<string, EvidenceRef[]>;
  personnel: PersonnelRow[];
  /** Zbroj traženih i priznatih iznosa svih troškova zahtjeva (zbroj kao na listu Sažetak – vidljiv i bez personnel:read). */
  expenseTotal: number; recognisedTotal: number;
  /** Izračun priznatog (nakon odluke) – izravni i neizravni po kategoriji. */
  recognised: PartnerBudgetResult | null;
  openedAt: Date;
}

export const CLAIM_STATUS: Record<string, string> = { draft: 'nacrt', submitted: 'predan – čeka odluku', approved: 'odobren', partially_approved: 'djelomično odobren', rejected: 'odbijen' };
export const EXPENSE_STATUS: Record<string, string> = { recorded: 'evidentiran', claimed: 'u zahtjevu', accepted: 'prihvaćen', partially_accepted: 'djelomično priznat', rejected: 'odbijen' };
const DRAFT_TEXT = 'NACRT – zahtjev nije predan; iznosi i troškovi još se mogu promijeniti';
/** WP1.19: ćelija umjesto iznosa troška osoblja za izvoznika bez personnel:read. */
const HIDDEN_CELL: Cell = { v: 'skriveno', s: 'wrap' };
const HIDDEN_NOTE = 'Iznosi troškova osoblja po osobi, mjesecu i retku prikazuju se samo uz pristup podacima o osoblju (personnel:read); sati su vidljivi, a zbroj kategorije je na listu „Sažetak”.';

const periodText = (c: ClaimView) => `RP${c.period.number}: ${hrDate(c.period.startDate)} – ${hrDate(c.period.endDate)}`;
const decided = (c: ClaimView) => ['approved', 'partially_approved', 'rejected'].includes(c.status);

function summarySheet(d: ExportData): Sheet {
  const c = d.claim; const isDecided = decided(c) && d.recognised;
  const rows: Cell[][] = [];
  rows.push([{ v: `Zahtjev za nadoknadu sredstava – ${d.project.acronym}, RP${c.period.number}`, s: 'title' }]);
  rows.push([d.draft ? { v: DRAFT_TEXT, s: 'warn' } : { v: `Status: ${CLAIM_STATUS[c.status] ?? c.status}`, s: 'bold' }]);
  rows.push([]);
  const kv = (k: string, v: Cell) => rows.push([bold(k), v]);
  kv('Projekt', `${d.project.acronym} – ${d.project.title}`);
  kv('Broj ugovora', d.project.contractNo ?? '–');
  kv('Program (paket)', `${d.project.programme} · ${d.project.packageId} v${d.project.packageVersion}`);
  if (d.project.funder) kv('Financijer', d.project.funder);
  kv('Vrsta akcije', d.project.actionType);
  kv('Partner', d.partnerName);
  kv('Izvještajno razdoblje', periodText(c));
  kv('Početak razdoblja', dateCell(c.period.startDate));
  kv('Kraj razdoblja', dateCell(c.period.endDate));
  kv('Rok za predaju', dateCell(c.period.dueDate));
  kv('Status', CLAIM_STATUS[c.status] ?? c.status);
  kv('Nacrt otvoren', dateCell(zagrebDate(d.openedAt)));
  kv('Predan', c.submittedAt ? dateCell(zagrebDate(new Date(c.submittedAt))) : '–');
  if (c.earlyReason) kv('Razlog rane predaje', c.earlyReason);
  kv('Datum odluke', dateCell(c.decisionDate) ?? '–');
  kv('Isplaćeno (datum)', dateCell(c.paidAt) ?? '–');
  kv('Stopa financiranja', { v: c.totals.ratePercent / 100, s: 'percent' });
  const earlier = c.expenses.filter((e) => e.earlier).length;
  if (earlier) kv('Troškovi iz ranijih razdoblja', `${earlier} – izričito uključeni (označeni na listu „Troškovi”)`);
  rows.push([]);
  rows.push([header('Šifra'), header('Kategorija troška'), header('Traženo (EUR)'), header('Priznato (EUR)'), header('Nepriznato (EUR)')]);
  const line = (code: string, name: string, claimed: number, recognised: number | null, b = false): Cell[] =>
    [b ? bold(code) : code, b ? bold(name) : name, money(claimed, b), isDecided ? money(recognised ?? 0, b) : null, isDecided ? money(claimed - (recognised ?? 0), b) : null];
  const direct = d.categories.filter((x) => x.kind !== 'indirect');
  for (const cat of direct) rows.push(line(cat.code, cat.name, c.totals.byCategory[cat.code] ?? 0, d.recognised?.direct[cat.code] ?? 0));
  rows.push(line('', 'Izravni troškovi ukupno', c.totals.direct, d.recognised?.directTotal ?? null, true));
  for (const cat of d.categories.filter((x) => x.kind === 'indirect')) {
    rows.push(line(cat.code, `${cat.name}${cat.ratePercent !== undefined ? ` – ${cat.ratePercent} %` : ''}`, c.totals.indirectByCategory[cat.code] ?? 0, d.recognised?.indirect[cat.code] ?? 0));
  }
  rows.push(line('', 'Neizravni troškovi ukupno', c.totals.indirect, d.recognised?.indirectTotal ?? null, true));
  rows.push(line('', 'Ukupno prihvatljivi troškovi', c.totals.total, d.recognised?.total ?? null, true));
  rows.push([null, bold('Stopa financiranja'), { v: c.totals.ratePercent / 100, s: 'percent' }]);
  rows.push(line('', 'Traženi iznos (doprinos)', c.totals.requested, d.recognised?.requested ?? null, true));
  rows.push([null, bold('Odobreno (odluka financijera)'), money(c.approved)]);
  rows.push([null, bold('Isplaćeno'), money(c.paid)]);
  rows.push([]);
  rows.push([{ v: 'Iznosi u eurima. Izračun: izravni troškovi → neizravni po pravilu paketa → stopa financiranja (isti izračun kao u sustavu). Priznato i nepriznato nakon odluke financijera.', s: 'wrap' }]);
  return { name: 'Sažetak', rows, widths: [26, 54, 18, 18, 18], freezeRows: 2, merges: ['A1:E1', 'A2:E2', `A${rows.length}:E${rows.length}`] };
}

function expensesSheet(d: ExportData): Sheet {
  const c = d.claim; const isDecided = decided(c);
  const names = new Map(d.categories.map((x) => [x.code, x.name]));
  const wp = new Map(d.workPackages.map((w) => [w.id, w]));
  const rows: Cell[][] = [];
  rows.push([{ v: `Troškovi – ${d.project.acronym}, ${periodText(c)}`, s: 'title' }]);
  rows.push([d.draft ? { v: DRAFT_TEXT, s: 'warn' } : { v: `Status zahtjeva: ${CLAIM_STATUS[c.status] ?? c.status}`, s: 'bold' }]);
  const head = ['Rb.', 'Datum', 'Šifra', 'Kategorija', 'Radni paket', 'Opis', 'Dobavljač', 'Traženo (EUR)', 'Priznato (EUR)', 'Status', 'Razlog odluke', 'Razdoblje', 'Dokazi (datoteke)', 'Mapa u paketu'];
  rows.push(head.map(header));
  c.expenses.forEach((e, i) => {
    const wid = d.expenseWp.get(e.id); const w = wid ? wp.get(wid) : undefined;
    const ev = d.evidence.get(e.id) ?? [];
    rows.push([
      { v: i + 1, s: 'int' }, dateCell(e.date), e.categoryCode, names.get(e.categoryCode) ?? '', w ? `${w.code} ${w.title}` : '', e.description,
      e.source === 'timesheet' ? 'evidencija rada (timesheet)' : (e.supplier ?? ''), e.amountHidden ? HIDDEN_CELL : money(e.amount), isDecided ? (e.amountHidden ? HIDDEN_CELL : money(e.recognised ?? 0)) : null,
      EXPENSE_STATUS[e.status] ?? e.status, e.decisionReason ?? '', e.earlier ? 'ranije razdoblje' : `RP${c.period.number}`,
      e.source === 'timesheet' ? 'timesheet (evidencije-rada/)' : ev.length ? ev.map((x) => (x.omitted ? '[povjerljivi dokaz – izostavljen]' : x.fileName)).join('; ') : 'BEZ DOKAZA',
      d.expenseFolder.get(e.id) ?? '',
    ]);
  });
  const last = rows.length;
  rows.push([null, null, null, null, null, bold('Ukupno izravni troškovi'), null, money(d.expenseTotal, true), isDecided ? money(d.recognisedTotal, true) : null]);
  if (c.expenses.some((e) => e.amountHidden)) { rows.push([]); rows.push([null, null, null, null, null, { v: HIDDEN_NOTE, s: 'wrap' }]); }
  return { name: 'Troškovi', rows, widths: [5, 11, 7, 26, 22, 48, 28, 14, 14, 16, 34, 14, 40, 34], freezeRows: 3, autoFilter: `A3:N${Math.max(last, 3)}`, merges: ['A1:N1', 'A2:N2'] };
}

function personnelSheet(d: ExportData): Sheet {
  const c = d.claim; const isDecided = decided(c);
  const rule = d.personnelRule;
  const daily = rule?.method === 'dailyRate';
  const perDay = rule?.hoursPerDay ?? 8;
  const basis = !rule?.method ? 'pravilo paketa nije zadano'
    : daily ? `dnevnica = godišnji trošak / ${rule.divisor} dana; dan = ${perDay} h` : `satnica = godišnji trošak / ${rule.divisor} h`;
  const used = d.workPackages.filter((w) => d.personnel.some((p) => p.byWp.has(w.id)));
  const rows: Cell[][] = [];
  rows.push([{ v: `Troškovi osoblja po osobi i mjesecu – ${d.project.acronym}, ${periodText(c)}`, s: 'title' }]);
  rows.push([d.draft ? { v: DRAFT_TEXT, s: 'warn' } : { v: `Osnova (pravilo paketa): ${basis}`, s: 'bold' }]);
  const head = ['Osoba', 'Uloga', 'Mjesec', 'Sati', 'Jedinica', 'Količina', 'Osnova (pravilo paketa)', `Stopa (EUR/${daily ? 'dan' : 'h'})`, 'Iznos (EUR)', 'Priznato (EUR)',
    ...used.flatMap((w) => [`${w.code} h`, `${w.code} EUR`])];
  rows.push(head.map(header));
  for (const p of d.personnel) {
    const qty = daily ? p.minutes / 60 / perDay : p.minutes / 60;
    rows.push([
      p.person, p.role ?? '', { v: `${p.month}-01`, s: 'month' }, { v: p.minutes / 60, s: 'hours' }, daily ? 'dan' : 'sat', { v: Math.round(qty * 100) / 100, s: 'hours' }, basis,
      // WP1.19: bez personnel:read ni stopa ni iznosi (po osobi, mjesecu i radnom paketu) – samo sati.
      d.canPersonnel && qty > 0 ? { v: Math.round((p.amount / 100 / qty) * 100) / 100, s: 'money' } : null,
      d.canPersonnel ? money(p.amount) : HIDDEN_CELL, isDecided ? (d.canPersonnel ? money(p.recognised ?? 0) : HIDDEN_CELL) : null,
      ...used.flatMap((w) => { const x = p.byWp.get(w.id); return x ? [{ v: x.minutes / 60, s: 'hours' as const }, d.canPersonnel ? money(x.amount) : HIDDEN_CELL] : [null, null]; }),
    ]);
  }
  const sum = (f: (p: PersonnelRow) => number) => d.personnel.reduce((a, p) => a + f(p), 0);
  const total = (cents: number) => (d.canPersonnel ? money(cents, true) : HIDDEN_CELL);
  rows.push([bold('Ukupno'), null, null, { v: sum((p) => p.minutes) / 60, s: 'hours' }, null, null, null, null, total(sum((p) => p.amount)), isDecided ? total(sum((p) => p.recognised ?? 0)) : null,
    ...used.flatMap((w) => [{ v: sum((p) => p.byWp.get(w.id)?.minutes ?? 0) / 60, s: 'hours' as const }, total(sum((p) => p.byWp.get(w.id)?.amount ?? 0))])]);
  rows.push([]);
  if (!d.canPersonnel) rows.push([{ v: HIDDEN_NOTE, s: 'wrap' }]);
  if (!d.personnel.length) rows.push(['U zahtjevu nema troškova osoblja.']);
  const n = head.length;
  return { name: 'Troškovi osoblja', rows, widths: [24, 20, 10, 8, 8, 9, 36, 12, 14, 14, ...used.flatMap(() => [8, 12])], freezeRows: 3, merges: [`A1:${colName(n - 1)}1`, `A2:${colName(n - 1)}2`] };
}

const colName = (i: number) => { let s = ''; let n = i + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

export function claimWorkbook(d: ExportData): Workbook {
  return { title: `ZNS ${d.project.acronym} RP${d.claim.period.number}${d.draft ? ' (NACRT)' : ''}`, sheets: [summarySheet(d), expensesSheet(d), personnelSheet(d)] };
}

/* ---------- kontrolna lista ---------- */

interface SnapshotItem { key: string; ok: boolean; severity: string; title: string; details: string[] }
interface Submission { checkedOn?: string; early?: boolean; earlyReason?: string | null; acknowledgedWithoutEvidence?: { date: string; description: string; amount: number }[]; warnings?: { key: string; title: string; details: string[] }[]; items?: SnapshotItem[]; earlierExpenses?: string[] }

const eurText = (cents: number) => `${(cents / 100).toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
/** Iznos retka u kontrolnoj listi; trošak osoblja nikad s iznosom (WP1.19 – tekst je isti za svakog izvoznika). */
const rowAmount = (e: { amount: number | null; source?: string }) => (e.source === 'timesheet' || e.amount === null ? 'trošak osoblja' : eurText(e.amount));

export function checklistHtml(d: ExportData): string {
  const c = d.claim;
  const sub = (c.submission ?? null) as Submission | null;
  const live = c.checklist;
  const items: SnapshotItem[] = d.draft && live ? live.items : sub?.items ?? [];
  const mark = (i: SnapshotItem) => (i.ok ? (i.severity === 'warning' ? '!' : '✓') : i.severity === 'blocking' ? '✗' : '!');
  const cls = (i: SnapshotItem) => (i.ok ? (i.severity === 'warning' ? 'warn' : 'ok') : i.severity === 'blocking' ? 'bad' : 'warn');
  const list = items.length ? `<ul class="cl">${items.map((i) => `<li class="${cls(i)}"><span class="m">${mark(i)}</span> ${esc(i.title)}${i.severity === 'warning' && !i.ok ? ' <span class="muted">(upozorenje)</span>' : ''}${i.details.length ? `<ul>${i.details.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>`
    : '<p class="muted">Zahtjev je predan prije nego što je sustav spremao cijeli popis za provjeru; sve blokirajuće stavke bile su ispunjene (inače predaja nije moguća). Upozorenja zabilježena pri predaji navedena su niže.</p>';
  const ack = sub?.acknowledgedWithoutEvidence ?? [];
  const warnings = sub?.warnings ?? [];
  const earlier = c.expenses.filter((e) => e.earlier);
  const evidenceMissing = c.expenses.filter((e) => e.source === 'manual' && !(d.evidence.get(e.id) ?? []).length);
  const omitted = [...d.evidence.values()].flat().filter((x) => x.omitted).length;
  return `<!doctype html>
<html lang="hr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kontrolna lista – ${esc(d.project.acronym)} RP${c.period.number}</title>
<style>${PRINT_CSS}
  h2 { font-size: 10.5pt; margin: 4mm 0 1.5mm; }
  ul.cl { list-style: none; padding: 0; margin: 0; }
  ul.cl > li { padding: .8mm 0; }
  ul.cl ul { margin: .5mm 0 0 7mm; padding: 0; color: #333; }
  .m { display: inline-block; width: 5mm; font-weight: 700; }
  .ok .m { color: #1a7f37; } .bad .m, .bad { color: #b00020; } .warn .m { color: #9a6700; }
</style></head><body>
${d.draft ? '<div class="mark">NACRT</div>' : ''}
<h1>Kontrolna lista potpunosti – ZNS ${esc(d.project.acronym)}, RP${c.period.number}</h1>
${d.draft ? `<div class="draft">${esc(DRAFT_TEXT)}. Popis je stanje u trenutku izvoza.</div>` : ''}
<table class="meta"><tbody>
<tr><td>Projekt</td><td><b>${esc(d.project.acronym)}</b> – ${esc(d.project.title)}</td></tr>
<tr><td>Broj ugovora</td><td>${esc(d.project.contractNo ?? '–')}</td></tr>
<tr><td>Partner</td><td>${esc(d.partnerName)}</td></tr>
<tr><td>Razdoblje</td><td>${esc(periodText(c))} · rok ${hrDate(c.period.dueDate)}</td></tr>
<tr><td>Status</td><td>${esc(CLAIM_STATUS[c.status] ?? c.status)}${c.submittedAt ? ` · predan ${hrDate(new Date(c.submittedAt))}` : ''}${sub?.checkedOn ? ` · provjera ${hrDate(sub.checkedOn)}` : ''}</td></tr>
<tr><td>Traženi iznos</td><td>${esc(eurText(c.totals.requested))} (troškovi ${esc(eurText(c.totals.total))}, stopa ${c.totals.ratePercent} %)</td></tr>
</tbody></table>
<h2>${d.draft ? 'Popis za provjeru (trenutno stanje)' : 'Popis za provjeru pri predaji'}</h2>
${list}
${c.earlyReason || sub?.earlyReason ? `<h2>Rana predaja</h2><p>Zahtjev je predan prije kraja razdoblja. Razlog: <b>${esc(c.earlyReason ?? sub?.earlyReason ?? '')}</b></p>` : ''}
${ack.length ? `<h2>Troškovi bez dokaza – izričito potvrđeni pri predaji (${ack.length})</h2><ul>${ack.map((a) => `<li>${hrDate(a.date)} ${esc(a.description)} (${esc(eurText(a.amount))})</li>`).join('')}</ul>` : ''}
${d.draft && evidenceMissing.length ? `<h2>Ručno uneseni troškovi bez dokaza (${evidenceMissing.length})</h2><ul>${evidenceMissing.map((e) => `<li>${hrDate(e.date)} ${esc(e.description)} (${esc(rowAmount(e))})</li>`).join('')}</ul>` : ''}
${earlier.length ? `<h2>Troškovi iz ranijih razdoblja – izričito uključeni (${earlier.length})</h2><ul>${earlier.map((e) => `<li>${hrDate(e.date)} ${esc(e.description)} (${esc(rowAmount(e))})</li>`).join('')}</ul>` : ''}
${!d.draft && warnings.length ? `<h2>Upozorenja zabilježena pri predaji (${warnings.length})</h2><ul>${warnings.map((w) => `<li><b>${esc(w.title)}</b>${w.details.length ? `<ul>${w.details.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>` : ''}
${omitted ? `<h2>Povjerljivi dokazi</h2><p>${omitted} povjerljivi dokaz(a) nije uključen(o) u ovaj paket jer izvoznik nema dozvolu za povjerljive dokumente; navedeni su u manifestu (bez naziva).</p>` : ''}
<footer>Izvor: ArQus Projekti. Popis za provjeru: <i>docs/domena/zns-pravila.md</i>. Sadržaj paketa i kontrolni zbrojevi: <i>sadrzaj.csv</i>.</footer>
</body></html>
`;
}

/* ---------- manifest ---------- */

export interface ManifestFile { path: string; size: number; sha256: string; note?: string }
export interface ManifestOmitted { note: string }

/** WP1.19: zaštita od CSV injekcije (kao u izvozu revizije) – tekst koji počinje formulom dobiva apostrof; brojevi ostaju. */
const csvCell = (s: string | number) => {
  const t = typeof s === 'number' ? String(s) : /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** `sadrzaj.csv`: UTF-8 s BOM-om, razdjelnik `;` (hrvatski Excel). Retci `meta`, `datoteka` i `izostavljeno`; manifest ne sadrži vlastiti zbroj. */
export function manifestCsv(meta: [string, string][], files: ManifestFile[], omitted: ManifestOmitted[]): string {
  const lines = [['vrsta', 'putanja', 'velicina_bajta', 'sha256', 'napomena'].join(';')];
  for (const [k, v] of meta) lines.push(['meta', k, '', '', v].map(csvCell).join(';'));
  for (const f of files) lines.push(['datoteka', f.path, f.size, f.sha256, f.note ?? ''].map(csvCell).join(';'));
  for (const o of omitted) lines.push(['izostavljeno', '', '', '', o.note].map(csvCell).join(';'));
  return `\ufeff${lines.join('\r\n')}\r\n`;
}
