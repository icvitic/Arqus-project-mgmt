/**
 * WP1.18 – „Moj rad”: što čeka korisnika, izvedeno iz trenutnih podataka (bez spremljenog stanja koje bi se moglo razići).
 * Čista funkcija: servis skuplja činjenice pod modelom pristupa po projektu (WP1.14) i za svaki projekt određuje u kojoj je
 * ulozi korisnik (član tima, odobravatelj, financije, voditelj); ovdje se iz činjenica izvode stavke s rokom i hitnošću.
 * Nijedna stavka ne nosi iznos. Datumi su `GGGG-MM-DD` (kalendarski dan institucije), mjeseci `GGGG-MM`.
 */
import { DEADLINE_SOON_DAYS, daysBetween } from './portfolio.js';
import { daysInMonth } from './finance.js';

/** Hitnost: rok je prošao / rok je blizu / čeka (radnja bez blizog roka) / samo informacija. */
export type WorkUrgency = 'overdue' | 'due_soon' | 'waiting' | 'info';
/** U kojoj je ulozi korisnik dobio stavku. */
export type WorkRole = 'member' | 'owner' | 'responsible' | 'approver' | 'finance' | 'manager' | 'proposals' | 'calls' | 'admin';
export type WorkKind =
  | 'timesheet_current' | 'timesheet_missing' | 'timesheet_reopened' | 'timesheet_submitted' | 'risk_owned'
  | 'deliverable_responsible' | 'milestone_responsible' | 'task_responsible'
  | 'timesheet_to_approve'
  | 'expenses_without_evidence' | 'claim_draft' | 'claim_returned' | 'period_unclaimed' | 'expenses_stranded' | 'claim_unpaid'
  | 'deliverable_due' | 'milestone_due' | 'risks_high' | 'deviations' | 'report_next'
  | 'proposal_deadline' | 'call_decision' | 'mfa_missing';

export interface WorkItem {
  /** Stabilan ključ stavke (isti između dva učitavanja dok se činjenica ne promijeni). */
  key: string;
  kind: WorkKind;
  role: WorkRole;
  urgency: WorkUrgency;
  /** Rok (`GGGG-MM-DD`) ako postoji. */
  due: string | null;
  /** Dani do roka (danas = 0, jučer = −1); null bez roka. */
  days: number | null;
  title: string;
  detail?: string;
  /** Hash ruta sučelja na kojoj se stavka rješava (bez `#/`). */
  link: string;
  projectId?: string;
  acronym?: string;
  proposalId?: string;
  callId?: string;
  /** Broj stvari obuhvaćenih stavkom (troškovi bez dokaza, rizici…), gdje ima smisla. */
  count?: number;
}

/** Prozor „uskoro” za timesheet tekućeg mjeseca: zadnjih 5 dana mjeseca. Ostali rokovi: 30 dana (isto kao portfelj). */
export const TIMESHEET_SOON_DAYS = 5;
export const WORK_SOON_DAYS = DEADLINE_SOON_DAYS;

export type TimesheetState = 'draft' | 'submitted' | 'approved' | 'locked';
export interface WorkProject { id: string; acronym: string; startDate: string | null; endDate: string | null }
/** Korisnik je povezan s članom tima na projektu (`team_members.user_id`). */
export interface MemberFacts {
  projectId: string;
  memberId: string;
  /** Dan od kojega je član tima (stvaranje člana) – mjeseci prije se ne traže, osim ako za njih već postoji timesheet. */
  joined: string;
  timesheets: { month: string; status: TimesheetState; minutes: number; reopened: boolean }[];
  /** Mjeseci pokriveni troškom osoblja potraživanim prije ArQusa (uvoz) – za njih se timesheet ne traži. */
  coveredMonths: string[];
}
export interface ApprovalFact { projectId: string; memberId: string; fullName: string; month: string; memberUserId: string | null; submittedBy: string | null }
export interface PeriodFact { number: number; endDate: string; dueDate: string; submitted: boolean }
export interface ClaimFact { id: string; period: number; periodEnd: string; dueDate: string; status: string; returned: boolean; paid: boolean; blockers: number | null }
export interface FinanceFacts { projectId: string; withoutEvidence: number; stranded: number; periods: PeriodFact[]; claims: ClaimFact[] }
/** WP1.22: odgovorna osoba stavke kako je vidi voditelj (ime člana tima, povezani račun, je li član još aktivan). */
export interface ResponsiblePerson { name: string; userId: string | null; active: boolean }
export interface ManagerFacts {
  projectId: string;
  /** `responsible`: null = nije određena; izostavljeno = podatak nije poznat (tada opis ne govori o odgovornoj osobi). */
  deliverables: { id: string; code: string; title: string; due: string; responsible?: ResponsiblePerson | null }[];
  milestones: { id: string; code: string; title: string; due: string; responsible?: ResponsiblePerson | null }[];
  highRisks: number;
  deviations: number;
  periods: PeriodFact[];
  /** Vodi li poveznica roka izvještaja na karticu ZNS-a (korisnik vidi financije projekta). */
  financeLink: boolean;
}
export interface OwnRiskFact { projectId: string; riskId: string; number: number; description: string }
/**
 * WP1.22: otvorena stavka kojoj je korisnik odgovorna osoba (povezan s AKTIVNIM članom tima koji je određen kao odgovoran).
 * `due` – kraj mjeseca roka (isporuka, prekretnica) ili završnog mjeseca (zadatak); `status` za tekst i dopuštene korake.
 */
export interface ResponsibleFact { projectId: string; kind: 'deliverable' | 'milestone' | 'task'; id: string; code: string; title: string; due: string; status: string }
export interface ProposalFact { id: string; acronym: string; title: string; internalDeadline: string; openReadiness: number }
export interface CallFact { id: string; code: string; title: string; internalDeadline: string | null; submission: string | null }

export interface WorkFacts {
  today: string;
  userId: string;
  projects: WorkProject[];
  members: MemberFacts[];
  approvals: ApprovalFact[];
  finance: FinanceFacts[];
  managers: ManagerFacts[];
  ownRisks: OwnRiskFact[];
  /** WP1.22: stavke kojima je korisnik odgovorna osoba (otvorene; servis ih skuplja istim definicijama kao voditeljeve). */
  responsible?: ResponsibleFact[];
  proposals: ProposalFact[];
  calls: CallFact[];
  /** Administrator: broj aktivnih računa kojima je MFA obvezan, a nemaju ga; null = korisnik nije administrator. */
  mfaMissing: number | null;
}

export interface WorkSummary { overdue: number; dueSoon: number; waiting: number; info: number; /** Za značku u izborniku: prošli i bliski rokovi. */ attention: number }

const MONTHS = ['siječanj', 'veljača', 'ožujak', 'travanj', 'svibanj', 'lipanj', 'srpanj', 'kolovoz', 'rujan', 'listopad', 'studeni', 'prosinac'];
/** „studeni 2026.” */
export const monthName = (ym: string): string => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}.`;
const hrDate = (iso: string): string => `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}. ${iso.slice(0, 4)}.`;
const pl = (n: number, one: string, few: string, many: string): string => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};
const hoursText = (minutes: number): string => `${(Math.round((minutes / 60) * 10) / 10).toLocaleString('hr-HR')} h`;
/** Zadnji dan mjeseca `GGGG-MM`. */
export const monthEnd = (ym: string): string => `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`;
const nextMonth = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

/** Hitnost prema roku: prošao → overdue, do `soon` dana → due_soon, inače `otherwise`. */
export function urgencyFor(due: string | null, today: string, soon: number, otherwise: 'waiting' | 'info'): WorkUrgency {
  if (!due) return otherwise;
  const d = daysBetween(today, due);
  return d < 0 ? 'overdue' : d <= soon ? 'due_soon' : otherwise;
}

/** Rok poruke: „kasni 3 d” / „danas” / „rok 30. 11. 2026.”. */
const dueText = (due: string, today: string): string => {
  const d = daysBetween(today, due);
  return d < 0 ? `kasni ${-d} ${pl(-d, 'dan', 'dana', 'dana')} (rok ${hrDate(due)})` : d === 0 ? 'rok je danas' : `rok ${hrDate(due)} (za ${d} ${pl(d, 'dan', 'dana', 'dana')})`;
};

/**
 * Mjeseci za koje član tima vodi timesheet: od kasnijeg od početka projekta i dana pridruživanja do tekućeg mjeseca,
 * unutar trajanja projekta. Tekući mjesec je posljednji (ako je u trajanju).
 */
export function timesheetMonths(start: string | null, end: string | null, joined: string, today: string): string[] {
  if (!start || !end) return [];
  const from = (start > joined ? start : joined).slice(0, 7);
  const to = (end < today ? end : today).slice(0, 7);
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 240; m = nextMonth(m)) out.push(m);
  return out;
}

const ORDER: WorkUrgency[] = ['overdue', 'due_soon', 'waiting', 'info'];

/** Status stavke riječima (u rodu imenice) – za opis stavke odgovorne osobe. */
const STATUS_TEXT: Record<string, Record<string, string>> = {
  deliverable: { planned: 'planirana', in_progress: 'u izradi', rejected: 'odbijena – dorada' },
  task: { planned: 'planiran', in_progress: 'u tijeku' },
};
/** WP1.22: tko je odgovoran – da voditelj i odgovorna osoba ne pretpostave da stavku drži onaj drugi. */
export function whoText(r: ResponsiblePerson | null | undefined): string {
  if (!r) return 'odgovorna osoba nije određena';
  if (!r.active) return `odgovorna osoba ${r.name} više nije aktivna u timu – odredi drugu`;
  return `odgovorna osoba: ${r.name}${r.userId ? '' : ' (bez korisničkog računa)'}`;
}

/** Stavke „Moj rad” iz činjenica; poredak: hitnost, rok (najraniji prvi; bez roka na kraju), projekt, naslov. */
export function deriveWorkItems(f: WorkFacts): { items: WorkItem[]; summary: WorkSummary } {
  const { today } = f;
  const thisMonth = today.slice(0, 7);
  const projects = new Map(f.projects.map((p) => [p.id, p]));
  const items: WorkItem[] = [];
  const add = (it: Omit<WorkItem, 'days' | 'acronym'> & { days?: number | null }) => {
    const p = it.projectId ? projects.get(it.projectId) : undefined;
    items.push({ ...it, days: it.due ? daysBetween(today, it.due) : null, ...(p ? { acronym: p.acronym } : {}) });
  };
  const tsLink = (projectId: string, memberId: string, month: string) => `projekti/${projectId}/tim/${memberId}/${month}`;

  // ---------- član tima: vlastiti timesheetovi ----------
  for (const m of f.members) {
    const p = projects.get(m.projectId);
    if (!p) continue;
    const byMonth = new Map(m.timesheets.map((t) => [t.month, t]));
    const covered = new Set(m.coveredMonths);
    // Član koji ima timesheet iz mjeseca prije upisa u tim (npr. upisan naknadno) bio je u timu od tog mjeseca.
    const first = m.timesheets.map((t) => t.month).sort()[0];
    const joined = first && `${first}-01` < m.joined ? `${first}-01` : m.joined;
    for (const month of timesheetMonths(p.startDate, p.endDate, joined, today)) {
      if (covered.has(month)) continue;
      const ts = byMonth.get(month);
      const due = monthEnd(month);
      const link = tsLink(p.id, m.memberId, month);
      const key = `ts:${m.memberId}:${month}`;
      const current = month === thisMonth;
      if (ts?.status === 'approved' || ts?.status === 'locked') continue;
      if (ts?.status === 'submitted') {
        add({ key, kind: 'timesheet_submitted', role: 'member', urgency: 'waiting', due: null, title: `Timesheet za ${monthName(month)} čeka odobrenje`, detail: 'predan – odobrava ga voditelj projekta ili ured za projekte', link, projectId: p.id });
        continue;
      }
      if (ts?.reopened) {
        add({ key, kind: 'timesheet_reopened', role: 'member', urgency: urgencyFor(due, today, TIMESHEET_SOON_DAYS, 'waiting'), due, title: `Timesheet za ${monthName(month)} vraćen je na doradu`, detail: `ispravi i ponovno predaj · ${dueText(due, today)}`, link, projectId: p.id });
        continue;
      }
      const minutes = ts?.minutes ?? 0;
      if (current) {
        const daysLeft = daysBetween(today, due);
        const state = minutes === 0 ? 'nije započet' : daysLeft <= TIMESHEET_SOON_DAYS ? `spreman za predaju – ${hoursText(minutes)}` : `u tijeku – ${hoursText(minutes)}`;
        add({ key, kind: 'timesheet_current', role: 'member', urgency: urgencyFor(due, today, TIMESHEET_SOON_DAYS, 'waiting'), due, title: `Timesheet za ${monthName(month)}`, detail: `${state} · predaje se do kraja mjeseca`, link, projectId: p.id });
      } else {
        add({ key, kind: 'timesheet_missing', role: 'member', urgency: 'overdue', due, title: `Timesheet za ${monthName(month)} nije predan`, detail: minutes ? `u nacrtu (${hoursText(minutes)}) – predaj ga` : 'nije započet', link, projectId: p.id });
      }
    }
  }
  // ---------- WP1.22: odgovorna osoba – isporuke, prekretnice i zadaci koji kasne ili dospijevaju u 30 dana ----------
  // Isto pravilo hitnosti kao voditeljeve stavke; ista stvar se ne pojavljuje dvaput (voditelj koji je i odgovoran vidi
  // samo stavku odgovorne osobe).
  const mine = new Set<string>();
  for (const r of f.responsible ?? []) {
    if (!projects.has(r.projectId) || daysBetween(today, r.due) > WORK_SOON_DAYS) continue;
    mine.add(`${r.kind}:${r.id}`);
    const what = r.kind === 'deliverable' ? 'Isporuka' : r.kind === 'milestone' ? 'Prekretnica' : 'Zadatak';
    const hint = r.kind === 'milestone' ? 'ti si odgovorna osoba · postignuće potvrđuje voditelj projekta' : `ti si odgovorna osoba · ${STATUS_TEXT[r.kind]?.[r.status] ?? r.status}`;
    add({ key: `${r.kind}:${r.id}`, kind: `${r.kind}_responsible`, role: 'responsible', urgency: urgencyFor(r.due, today, WORK_SOON_DAYS, 'waiting'), due: r.due,
      title: `${what} ${r.code} ${r.title}`, detail: `${r.kind === 'task' ? dueText(r.due, today).replace(/^rok/, 'završava') : dueText(r.due, today)} · ${hint}`, link: `projekti/${r.projectId}/struktura`, projectId: r.projectId });
  }
  for (const r of f.ownRisks) {
    if (!projects.has(r.projectId)) continue;
    add({ key: `risk:${r.riskId}`, kind: 'risk_owned', role: 'owner', urgency: 'waiting', due: null, title: `Rizik R${r.number}: ${r.description}`, detail: 'ti si nositelj rizika – prati ga i ažuriraj mjere', link: `projekti/${r.projectId}/struktura`, projectId: r.projectId });
  }

  // ---------- odobravatelj: timesheetovi na odobrenju (četiri oka: ne vlastiti, ne oni koje sam predao) ----------
  for (const a of f.approvals) {
    if (!projects.has(a.projectId)) continue;
    if (a.memberUserId === f.userId || a.submittedBy === f.userId || !a.submittedBy) continue;
    add({ key: `approve:${a.memberId}:${a.month}`, kind: 'timesheet_to_approve', role: 'approver', urgency: 'waiting', due: null, title: `Odobri timesheet: ${a.fullName}, ${monthName(a.month)}`, detail: 'predan – čeka tvoje odobrenje', link: tsLink(a.projectId, a.memberId, a.month), projectId: a.projectId });
  }

  // ---------- financije ----------
  const financeProjects = new Set<string>();
  for (const x of f.finance) {
    const p = projects.get(x.projectId);
    if (!p) continue;
    financeProjects.add(p.id);
    const zns = `projekti/${p.id}/zns`;
    if (x.withoutEvidence > 0) {
      add({ key: `noevidence:${p.id}`, kind: 'expenses_without_evidence', role: 'finance', urgency: 'waiting', due: null, count: x.withoutEvidence,
        title: `${x.withoutEvidence} ${pl(x.withoutEvidence, 'ručno uneseni trošak nema', 'ručno unesena troška nemaju', 'ručno unesenih troškova nema')} dokaz`, detail: 'priloži račun ili drugi dokaz uz trošak', link: `projekti/${p.id}/troskovi`, projectId: p.id });
    }
    if (x.stranded > 0) {
      add({ key: `stranded:${p.id}`, kind: 'expenses_stranded', role: 'finance', urgency: 'waiting', due: null, count: x.stranded,
        title: `${x.stranded} ${pl(x.stranded, 'nepredan trošak', 'nepredana troška', 'nepredanih troškova')} iz ranijih razdoblja`, detail: 'uključi ga u nacrt ZNS-a sljedećeg razdoblja (izričitim odabirom)', link: zns, projectId: p.id });
    }
    const withDraft = new Set<number>();
    for (const c of x.claims) {
      const blockers = c.blockers === null ? '' : c.blockers === 0 ? 'popis za provjeru je prošao – spreman za predaju' : `${c.blockers} ${pl(c.blockers, 'stavka blokira', 'stavke blokiraju', 'stavki blokira')} predaju`;
      if (c.status === 'draft' && c.returned) {
        withDraft.add(c.period);
        add({ key: `claim:${c.id}`, kind: 'claim_returned', role: 'finance', urgency: urgencyFor(c.dueDate, today, WORK_SOON_DAYS, 'waiting'), due: c.dueDate, title: `ZNS za RP${c.period} vraćen je na dopunu`, detail: [blockers, 'razlog povrata je na zahtjevu'].filter(Boolean).join(' · '), link: zns, projectId: p.id });
      } else if (c.status === 'draft') {
        withDraft.add(c.period);
        if (c.periodEnd >= today) continue; // nacrt razdoblja koje još traje nije stavka za danas
        add({ key: `claim:${c.id}`, kind: 'claim_draft', role: 'finance', urgency: urgencyFor(c.dueDate, today, WORK_SOON_DAYS, 'waiting'), due: c.dueDate, title: `ZNS za RP${c.period} čeka predaju`, detail: [`razdoblje je završilo ${hrDate(c.periodEnd)}`, blockers].filter(Boolean).join(' · '), link: zns, projectId: p.id });
      } else if ((c.status === 'approved' || c.status === 'partially_approved') && !c.paid) {
        add({ key: `claim:${c.id}`, kind: 'claim_unpaid', role: 'finance', urgency: 'info', due: null, title: `ZNS za RP${c.period} je odlučen – isplata nije zabilježena`, detail: 'zabilježi isplatu kad sredstva stignu', link: zns, projectId: p.id });
      }
    }
    for (const r of x.periods) {
      if (r.submitted || r.endDate >= today || withDraft.has(r.number)) continue;
      add({ key: `period:${p.id}:${r.number}`, kind: 'period_unclaimed', role: 'finance', urgency: urgencyFor(r.dueDate, today, WORK_SOON_DAYS, 'waiting'), due: r.dueDate, title: `RP${r.number} je završilo, a ZNS nije otvoren`, detail: `razdoblje je završilo ${hrDate(r.endDate)} · ${dueText(r.dueDate, today)}`, link: zns, projectId: p.id });
    }
  }

  // ---------- voditelj projekta ----------
  for (const x of f.managers) {
    const p = projects.get(x.projectId);
    if (!p) continue;
    const struct = `projekti/${p.id}/struktura`;
    for (const d of x.deliverables) {
      if (daysBetween(today, d.due) > WORK_SOON_DAYS || mine.has(`deliverable:${d.id}`)) continue;
      add({ key: `deliverable:${d.id}`, kind: 'deliverable_due', role: 'manager', urgency: urgencyFor(d.due, today, WORK_SOON_DAYS, 'waiting'), due: d.due, title: `Isporuka ${d.code} ${d.title}`, detail: [dueText(d.due, today), d.responsible === undefined ? '' : whoText(d.responsible)].filter(Boolean).join(' · '), link: struct, projectId: p.id });
    }
    for (const m of x.milestones) {
      if (daysBetween(today, m.due) > WORK_SOON_DAYS || mine.has(`milestone:${m.id}`)) continue;
      add({ key: `milestone:${m.id}`, kind: 'milestone_due', role: 'manager', urgency: urgencyFor(m.due, today, WORK_SOON_DAYS, 'waiting'), due: m.due, title: `Prekretnica ${m.code} ${m.title}`, detail: [dueText(m.due, today), m.responsible === undefined ? '' : whoText(m.responsible)].filter(Boolean).join(' · '), link: struct, projectId: p.id });
    }
    if (x.highRisks > 0) {
      add({ key: `risks:${p.id}`, kind: 'risks_high', role: 'manager', urgency: 'waiting', due: null, count: x.highRisks, title: `${x.highRisks} ${pl(x.highRisks, 'visok otvoren rizik', 'visoka otvorena rizika', 'visokih otvorenih rizika')}`, detail: 'provjeri mjere ublažavanja', link: struct, projectId: p.id });
    }
    if (x.deviations > 0) {
      add({ key: `deviations:${p.id}`, kind: 'deviations', role: 'manager', urgency: 'waiting', due: null, count: x.deviations, title: `${x.deviations} ${pl(x.deviations, 'odstupanje', 'odstupanja', 'odstupanja')} od pravila programa`, detail: 'pojedinosti su na pregledu projekta', link: `projekti/${p.id}`, projectId: p.id });
    }
    // Sljedeći rok izvještaja – ako korisnik na projektu nije i u ulozi financija (tada razdoblja pokrivaju stavke ZNS-a).
    const next = x.periods.find((r) => !r.submitted);
    if (next && !financeProjects.has(p.id)) {
      add({ key: `report:${p.id}:${next.number}`, kind: 'report_next', role: 'manager', urgency: urgencyFor(next.dueDate, today, WORK_SOON_DAYS, 'info'), due: next.dueDate, title: `RP${next.number} – rok za zahtjev za nadoknadu i izvještaj`, detail: dueText(next.dueDate, today), link: x.financeLink ? `projekti/${p.id}/zns` : `projekti/${p.id}`, projectId: p.id });
    }
  }

  // ---------- prijave i pozivi ----------
  for (const pr of f.proposals) {
    if (daysBetween(today, pr.internalDeadline) > WORK_SOON_DAYS) continue;
    add({ key: `proposal:${pr.id}`, kind: 'proposal_deadline', role: 'proposals', urgency: urgencyFor(pr.internalDeadline, today, WORK_SOON_DAYS, 'waiting'), due: pr.internalDeadline, proposalId: pr.id,
      title: `Prijava ${pr.acronym}: interni rok`, detail: [dueText(pr.internalDeadline, today), pr.openReadiness ? `${pr.openReadiness} ${pl(pr.openReadiness, 'stavka spremnosti nije ispunjena', 'stavke spremnosti nisu ispunjene', 'stavki spremnosti nije ispunjeno')}` : 'sve stavke spremnosti su ispunjene'].join(' · '), link: `prijave/${pr.id}` });
  }
  for (const c of f.calls) {
    // Najbliži relevantan rok: interni (i kad je prošao, dok rok predaje traje) ili rok predaje.
    const candidates = [c.internalDeadline, c.submission].filter((d): d is string => !!d && daysBetween(today, d) <= WORK_SOON_DAYS && (d === c.internalDeadline ? !c.submission || c.submission >= today : d >= today));
    if (!candidates.length) continue;
    const due = candidates.sort()[0]!;
    add({ key: `call:${c.id}`, kind: 'call_decision', role: 'calls', urgency: urgencyFor(due, today, WORK_SOON_DAYS, 'waiting'), due, callId: c.id,
      title: `Poziv ${c.code}: nema odluke go / no-go`, detail: `${due === c.internalDeadline ? 'interni rok' : 'rok predaje'} · ${dueText(due, today)}`, link: `radar/${c.id}` });
  }

  // ---------- administrator ----------
  if (f.mfaMissing) {
    add({ key: 'mfa', kind: 'mfa_missing', role: 'admin', urgency: 'waiting', due: null, count: f.mfaMissing, title: `${f.mfaMissing} ${pl(f.mfaMissing, 'račun nema', 'računa nemaju', 'računa nema')} obveznu dvofaktorsku prijavu`, detail: 'ti korisnici do postavljanja MFA vide samo vlastiti račun', link: 'korisnici' });
  }

  items.sort((a, b) => ORDER.indexOf(a.urgency) - ORDER.indexOf(b.urgency) || (a.due ?? '9999').localeCompare(b.due ?? '9999')
    || (a.acronym ?? '').localeCompare(b.acronym ?? '', 'hr') || a.title.localeCompare(b.title, 'hr') || a.key.localeCompare(b.key));
  const summary: WorkSummary = { overdue: 0, dueSoon: 0, waiting: 0, info: 0, attention: 0 };
  for (const it of items) {
    if (it.urgency === 'overdue') summary.overdue++; else if (it.urgency === 'due_soon') summary.dueSoon++; else if (it.urgency === 'waiting') summary.waiting++; else summary.info++;
  }
  summary.attention = summary.overdue + summary.dueSoon;
  return { items, summary };
}

/* ---------- obavijesti (WP1.18): tekst iz vrste i podataka, isti za sučelje i budući dnevni sažetak e-poštom ---------- */

export type NotificationKind =
  | 'timesheet_approved' | 'timesheet_reopened'
  | 'claim_returned' | 'claim_decided' | 'claim_paid'
  | 'access_granted' | 'access_revoked'
  | 'project_manager' | 'proposal_lead'
  | 'import_applied' | 'import_undone'
  | 'responsible_assigned' | 'responsible_removed';

export interface NotificationData {
  acronym?: string;
  month?: string;
  period?: number;
  /** Ishod odluke o ZNS-u: approved / partially_approved / rejected. */
  outcome?: string;
  role?: string;
  /** Razlog koji primatelj ionako vidi na entitetu (npr. razlog povrata ZNS-a). */
  reason?: string;
  fileName?: string;
  /** WP1.22: stavka strukture (vrsta i oznaka s naslovom, npr. „D1.2 Izvještaj o anketi”). */
  item?: string;
  itemKind?: 'deliverable' | 'milestone' | 'task';
}

const ITEM_KIND: Record<string, string> = { deliverable: 'isporuku', milestone: 'prekretnicu', task: 'zadatak' };
const OUTCOME: Record<string, string> = { approved: 'odobren', partially_approved: 'djelomično odobren', rejected: 'odbijen' };
const ROLE: Record<string, string> = { 'project-manager': 'voditelj projekta', 'team-member': 'član tima', finance: 'financije', reader: 'čitatelj', 'project-office': 'ured za projekte', 'tenant-admin': 'administrator' };

/** Naslov i pojedinosti obavijesti (bez iznosa). `actor` – ime korisnika koji je radnju napravio (ako je poznat). */
export function notificationText(kind: NotificationKind, d: NotificationData, actor?: string | null): { title: string; detail?: string } {
  const who = actor ? `${actor}` : 'Netko';
  const on = d.acronym ? ` (${d.acronym})` : '';
  switch (kind) {
    case 'timesheet_approved': return { title: `Timesheet za ${monthName(d.month ?? '')} je odobren${on}`, detail: `${who} ga je odobrio/la.` };
    case 'timesheet_reopened': return { title: `Timesheet za ${monthName(d.month ?? '')} vraćen je na doradu${on}`, detail: d.reason ? `Razlog: ${d.reason}` : `${who} ga je vratio/la u nacrt – ispravi ga i ponovno predaj.` };
    case 'claim_returned': return { title: `ZNS za RP${d.period ?? '?'} vraćen je na dopunu${on}`, detail: d.reason ? `Razlog: ${d.reason}` : undefined };
    case 'claim_decided': return { title: `ZNS za RP${d.period ?? '?'} je ${OUTCOME[d.outcome ?? ''] ?? 'odlučen'}${on}`, detail: `Odluku je upisao/la ${who}.` };
    case 'claim_paid': return { title: `Isplata ZNS-a za RP${d.period ?? '?'} je zabilježena${on}`, detail: `Upisao/la ${who}.` };
    case 'access_granted': return { title: `Dobio/la si pristup projektu ${d.acronym ?? ''}`.trim(), detail: d.role ? `Uloga: ${ROLE[d.role] ?? d.role}.` : undefined };
    case 'access_revoked': return { title: `Uklonjen ti je pristup projektu ${d.acronym ?? ''}`.trim(), detail: d.role ? `Uloga: ${ROLE[d.role] ?? d.role}.` : undefined };
    case 'project_manager': return { title: `Imenovan/a si voditeljem projekta ${d.acronym ?? ''}`.trim(), detail: `Imenovao/la ${who}.` };
    case 'proposal_lead': return { title: `Imenovan/a si voditeljem prijave ${d.acronym ?? ''}`.trim(), detail: `Imenovao/la ${who}.` };
    case 'import_applied': return { title: `Na projekt ${d.acronym ?? ''} uvezeni su podaci iz Excela`.trim(), detail: `${who}${d.fileName ? ` · datoteka ${d.fileName}` : ''}.` };
    case 'responsible_assigned': return { title: `Odgovoran/na si za ${ITEM_KIND[d.itemKind ?? ''] ?? 'stavku'} ${d.item ?? ''}${on}`.replace(/\s+\(/, ' ('), detail: `Odredio/la ${who}. Stavka je u tvom „Moj rad” kad joj se približi rok.` };
    case 'responsible_removed': return { title: `Više nisi odgovoran/na za ${ITEM_KIND[d.itemKind ?? ''] ?? 'stavku'} ${d.item ?? ''}${on}`.replace(/\s+\(/, ' ('), detail: `Promijenio/la ${who}.` };
    case 'import_undone': return { title: `Uvoz iz Excela na projektu ${d.acronym ?? ''} je poništen`.trim(), detail: `${who}${d.fileName ? ` · datoteka ${d.fileName}` : ''}.` };
  }
}
