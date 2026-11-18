import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '../db/db.service';
import { HIDDEN, redactSalary, scrubSecrets } from '../audit/audit-redaction';

/**
 * WP1.23 – podaci jedne osobe (pravo na pristup i prenosivost, čl. 15 i 20 GDPR-a).
 *
 * **Tko je osoba.** Korisnički račun (`userId`) i/ili zapisi člana tima koji su joj IZRIČITO pripisani. Zapis člana tima
 * povezan s računom (`team_members.user_id`) pripada osobi automatski (veza postoji u podacima). Zapis bez računa sustav
 * NE pripisuje po imenu – pretraga ga samo predlaže, a operater ga označava; zapis povezan s DRUGIM računom ne može se
 * pripisati (409). Tako izvoz nikad ne spaja dvije osobe istog imena bez ljudske odluke.
 *
 * **Pravilo isključivanja trećih osoba.** U izvozu je ono što je O osobi ili što je osoba UNIJELA kao svoj zapis:
 * - vlastiti zapisi (račun, sesije, članstva, timesheetovi i sati, troškovi osoblja, odgovornosti, obavijesti…);
 * - ime osobe koja je odobrila njezin timesheet (dio njezina zapisa, kao na potpisanoj evidenciji rada) – i ništa drugo o toj osobi;
 * - nikad sati, iznosi, imena ni zapisi drugih članova tima istog projekta;
 * - revizijski zapis: (A) zapisi kojima je osoba PREDMET (njezin račun, njezini zapisi člana tima i timesheetovi, radnje
 *   zaštite podataka o njoj) – s promjenama, ali bez identiteta drugog aktera (samo „drugi korisnik”, bez IP-a) i bez
 *   vrijednosti koje identificiraju treće osobe (ključevi tipa `…By`, `userId`, `account`, `email`, `ip` koji nisu njezini);
 *   (B) zapisi u kojima je osoba AKTER na tuđem zapisu – samo vrijeme, radnja, vrsta zapisa i njezina IP adresa, bez
 *   sadržaja promjene i bez id-ja zapisa (sadržaj je o drugoj osobi).
 * **Plaće.** Godišnji trošak i iz njega izvedeni iznosi (trošak osoblja, priznati iznos) samo ako onaj tko izvozi ima
 * `personnel:read` na razini institucije; inače su iznosi `null` i izvoz to izričito navodi.
 */
export interface SubjectRef { userId: string | null; memberIds: string[] }

export interface SubjectMember {
  id: string; projectId: string; acronym: string; projectTitle: string; projectStatus: string; packageId: string; partner: string; fullName: string;
  role: string | null; userId: string | null; active: boolean; annualCostCents: number | null; anonymisedAt: string | null; pseudonym: string | null; createdAt: string;
}
export interface SubjectUser { id: string; email: string; displayName: string; status: string; mfaEnabled: boolean; lastLoginAt: string | null; createdAt: string; passwordChangedAt: string | null; digestEnabled: boolean; closedAt: string | null }
export interface ResolvedSubject { user: SubjectUser | null; members: SubjectMember[]; linkedMemberIds: string[] }

type Row = Record<string, unknown>;
const rows = async <T = Row>(tx: Tx, q: ReturnType<typeof sql>): Promise<T[]> => (await tx.execute(q)).rows as T[];
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
const uuidList = (ids: string[]) => sql`array[${sql.join(ids.length ? ids.map((i) => sql`${i}`) : [sql`null`], sql`, `)}]::uuid[]`;

const MEMBER_SELECT = sql`select m.id, m.project_id as "projectId", p.acronym, p.title as "projectTitle", p.status as "projectStatus", p.package_id as "packageId",
  o.name as partner, m.full_name as "fullName", m.role, m.user_id as "userId", m.active, m.annual_cost_cents as "annualCostCents",
  m.anonymised_at as "anonymisedAt", m.pseudonym, m.created_at as "createdAt"
  from team_members m join projects p on p.id = m.project_id join project_partners pp on pp.id = m.partner_id join organisations o on o.id = pp.organisation_id`;

const memberOf = (r: Row): SubjectMember => ({ ...(r as unknown as SubjectMember), annualCostCents: r.annualCostCents === null ? null : Number(r.annualCostCents), anonymisedAt: iso(r.anonymisedAt), createdAt: iso(r.createdAt)! });

/** Razrješava osobu: račun + automatski povezani zapisi člana tima + izričito označeni zapisi bez računa. */
export async function resolveSubject(tx: Tx, ref: SubjectRef): Promise<ResolvedSubject> {
  if (!ref.userId && !ref.memberIds.length) throw new BadRequestException('Odaberi korisnički račun ili barem jedan zapis člana tima');
  let user: SubjectUser | null = null;
  if (ref.userId) {
    const u = (await rows(tx, sql`select id, email, display_name as "displayName", status, mfa_enabled as "mfaEnabled", last_login_at as "lastLoginAt", created_at as "createdAt",
      password_changed_at as "passwordChangedAt", digest_enabled as "digestEnabled", closed_at as "closedAt" from users where id = ${ref.userId}`))[0];
    if (!u) throw new NotFoundException('Korisnik ne postoji');
    user = { ...(u as unknown as SubjectUser), lastLoginAt: iso(u.lastLoginAt), createdAt: iso(u.createdAt)!, passwordChangedAt: iso(u.passwordChangedAt), closedAt: iso(u.closedAt) };
  }
  const linked = ref.userId ? (await rows(tx, sql`${MEMBER_SELECT} where m.user_id = ${ref.userId} order by p.acronym`)).map(memberOf) : [];
  const explicitIds = [...new Set(ref.memberIds)].filter((id) => !linked.some((m) => m.id === id));
  const explicit = explicitIds.length ? (await rows(tx, sql`${MEMBER_SELECT} where m.id = any(${uuidList(explicitIds)}) order by p.acronym`)).map(memberOf) : [];
  if (explicit.length !== explicitIds.length) throw new NotFoundException('Zapis člana tima ne postoji');
  const foreign = explicit.filter((m) => m.userId && m.userId !== ref.userId);
  if (foreign.length) throw new ConflictException('Zapis člana tima povezan je s drugim korisničkim računom – ne može se pripisati ovoj osobi');
  return { user, members: [...linked, ...explicit], linkedMemberIds: linked.map((m) => m.id) };
}

/** Kandidati za pretragu: računi i zapisi člana tima po imenu ili e-adresi (samo prijedlog – pripisuje operater). */
export async function searchPeople(tx: Tx, q: string) {
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const users = await rows(tx, sql`select id, email, display_name as "displayName", status, closed_at as "closedAt" from users
    where (display_name ilike ${like} or email ilike ${like}) order by display_name limit 25`);
  const members = (await rows(tx, sql`${MEMBER_SELECT} left join users u on u.id = m.user_id
    where (m.full_name ilike ${like} or u.display_name ilike ${like} or u.email ilike ${like}) order by m.full_name, p.acronym limit 50`)).map(memberOf);
  return { users: users.map((u) => ({ ...u, closedAt: iso(u.closedAt) })), members };
}

/** Normalizirano ime za prijedlog kandidata (bez dijakritike, razmaka i velikih slova) – nikad za automatsko pripisivanje. */
export const normName = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();

/** Zapisi člana tima bez računa čije ime odgovara imenu osobe – prijedlog za operatera. */
export async function candidateMembers(tx: Tx, subject: ResolvedSubject): Promise<SubjectMember[]> {
  const names = new Set([subject.user?.displayName, ...subject.members.map((m) => m.fullName)].filter((x): x is string => !!x).map(normName));
  if (!names.size) return [];
  const all = (await rows(tx, sql`${MEMBER_SELECT} where m.user_id is null and m.anonymised_at is null order by p.acronym`)).map(memberOf);
  return all.filter((m) => names.has(normName(m.fullName)) && !subject.members.some((x) => x.id === m.id));
}

export const EXPORT_CATEGORIES = [
  'account', 'roles', 'sessions', 'accountTokens', 'calendar', 'notifications', 'mailDeliveries', 'digestRuns',
  'teamMemberships', 'timesheets', 'personnelCosts', 'responsibilities', 'risks', 'projectsManaged', 'proposalsLed', 'callTracking',
  'documents', 'audit',
] as const;
export type ExportCategory = (typeof EXPORT_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<ExportCategory, string> = {
  account: 'Korisnički račun', roles: 'Uloge i pristup', sessions: 'Sesije prijave', accountTokens: 'Pozivnice i poveznice za novu lozinku', calendar: 'Osobni kalendar rokova',
  notifications: 'Obavijesti', mailDeliveries: 'Isporuka e-pošte', digestRuns: 'Dnevni sažetak', teamMemberships: 'Članstva u timovima projekata',
  timesheets: 'Timesheetovi (evidencija rada)', personnelCosts: 'Troškovi osoblja', responsibilities: 'Odgovornosti (isporuke, prekretnice, zadaci)',
  risks: 'Rizici kojima je osoba vlasnik', projectsManaged: 'Projekti koje osoba vodi', proposalsLed: 'Prijave koje osoba vodi', callTracking: 'Praćenje poziva',
  documents: 'Dokumenti koje je osoba prenijela', audit: 'Revizijski zapis',
};

export interface SubjectExport {
  withAmounts: boolean;
  categories: Record<ExportCategory, Row[]>;
  /** Skraćeno (revizijski zapis iznad granice). */
  truncated: Partial<Record<ExportCategory, boolean>>;
}

const AUDIT_MAX = 20_000;
export const THIRD = '[treća osoba]';
/** Ključevi revizijskog zapisa koji identificiraju (moguće) treću osobu. */
const THIRD_PARTY_KEY = /(^|_)(by|ip|email|account|actor(id)?|user(id)?|sessionid|approver|owner(userid)?|manager(userid)?|lead(userid)?)$|By$|UserId$/i;

/** Uklanja vrijednosti trećih osoba iz promjene u zapisu kojemu je osoba predmet (ključ ostaje, vidi se da je bilo). */
export function scrubThirdParty(diff: unknown, own: ReadonlySet<string>): unknown {
  if (Array.isArray(diff)) return diff.map((x) => scrubThirdParty(x, own));
  if (diff && typeof diff === 'object') {
    const out: Row = {};
    for (const [k, v] of Object.entries(diff as Row)) {
      if (THIRD_PARTY_KEY.test(k) && v !== null && v !== undefined && !(typeof v === 'string' && own.has(v.toLowerCase()))) out[k] = THIRD;
      else out[k] = scrubThirdParty(v, own);
    }
    return out;
  }
  return diff;
}

/** Svi podaci o osobi po kategorijama (jedna transakcija, upiti jedan za drugim). */
export async function collectSubject(tx: Tx, s: ResolvedSubject, withAmounts: boolean): Promise<SubjectExport> {
  const uid = s.user?.id ?? null;
  const mids = s.members.map((m) => m.id);
  const c = Object.fromEntries(EXPORT_CATEGORIES.map((k) => [k, [] as Row[]])) as Record<ExportCategory, Row[]>;
  const truncated: SubjectExport['truncated'] = {};
  const amount = (v: unknown) => (withAmounts && v !== null && v !== undefined ? Number(v) : null);

  if (s.user) {
    c.account = [{ email: s.user.email, displayName: s.user.displayName, status: s.user.status, mfaEnabled: s.user.mfaEnabled, createdAt: s.user.createdAt,
      lastLoginAt: s.user.lastLoginAt, passwordChangedAt: s.user.passwordChangedAt, digestEnabled: s.user.digestEnabled, closedAt: s.user.closedAt }];
    c.roles = await rows(tx, sql`select r.code as role, r.name, p.acronym as project, ra.created_at as "assignedAt" from role_assignments ra join roles r on r.id = ra.role_id
      left join projects p on p.id = ra.project_id where ra.user_id = ${uid} order by ra.created_at`);
    c.sessions = await rows(tx, sql`select created_at as "createdAt", expires_at as "expiresAt", revoked_at as "revokedAt", host(ip) as ip, user_agent as "userAgent"
      from sessions where user_id = ${uid} order by created_at`);
    c.accountTokens = await rows(tx, sql`select kind, delivery, created_at as "createdAt", expires_at as "expiresAt" from account_tokens where user_id = ${uid} order by created_at`);
    c.calendar = await rows(tx, sql`select created_at as "createdAt", last_used_at as "lastUsedAt" from calendar_tokens where user_id = ${uid}`);
    // Obavijesti čita samo vlasnik (RLS po `app.user_id`) – za izvoz se kontekst postavlja na osobu i odmah vraća.
    const prevUser = (await rows<{ v: string | null }>(tx, sql`select current_setting('app.user_id', true) as v`))[0]?.v ?? '';
    await tx.execute(sql`select set_config('app.user_id', ${uid}, true)`);
    c.notifications = await rows(tx, sql`select kind, data, link, created_at as "createdAt", read_at as "readAt" from notifications where user_id = ${uid} order by id`);
    await tx.execute(sql`select set_config('app.user_id', ${prevUser ?? ''}, true)`);
    c.mailDeliveries = await rows(tx, sql`select kind, outcome, error_class as "errorClass", attempts, created_at as "createdAt" from mail_deliveries where user_id = ${uid} order by id`);
    c.digestRuns = await rows(tx, sql`select day, outcome, created_at as "createdAt" from digest_runs where user_id = ${uid} order by day`);
    c.risks = await rows(tx, sql`select p.acronym as project, r.number, r.description, r.likelihood, r.impact, r.mitigation, r.status from risks r join projects p on p.id = r.project_id
      where r.owner_user_id = ${uid} order by p.acronym, r.number`);
    c.projectsManaged = await rows(tx, sql`select acronym, title, status, start_date as "startDate", duration_months as "durationMonths" from projects where manager_user_id = ${uid} order by acronym`);
    c.proposalsLed = await rows(tx, sql`select acronym, title, status, internal_deadline as "internalDeadline", created_at as "createdAt" from proposals where lead_user_id = ${uid} order by created_at`);
    c.callTracking = await rows(tx, sql`select cl.code as call, cl.title, ct.decision, ct.internal_deadline as "internalDeadline",
      (ct.owner_user_id = ${uid}) as owner, (ct.assessed_by = ${uid}) as assessed, (ct.decided_by = ${uid}) as decided
      from call_tracking ct join calls cl on cl.id = ct.call_id where ${uid} in (ct.owner_user_id, ct.assessed_by, ct.decided_by) order by cl.code`);
    c.documents = await rows(tx, sql`select d.title, d.kind, d.confidentiality, d.entity_type as "entityType", coalesce(p.acronym, pr.acronym) as project, v.version, v.file_name as "fileName",
      v.mime_type as "mimeType", v.size_bytes as "sizeBytes", v.sha256, v.created_at as "uploadedAt", (d.deleted_at is not null) as deleted
      from document_versions v join documents d on d.id = v.document_id left join projects p on p.id = d.project_id left join proposals pr on pr.id = d.proposal_id
      where v.created_by = ${uid} order by v.created_at`);
  }

  if (mids.length) {
    c.teamMemberships = s.members.map((m) => ({ project: m.acronym, projectTitle: m.projectTitle, partner: m.partner, fullName: m.fullName, role: m.role, active: m.active,
      annualCostCents: amount(m.annualCostCents), linkedToAccount: !!m.userId, anonymised: !!m.anonymisedAt, createdAt: m.createdAt }));
    const ts = await rows(tx, sql`select t.id, p.acronym as project, m.full_name as "fullName", t.month, t.status, t.submitted_at as "submittedAt", t.approved_at as "approvedAt",
      approver.display_name as "approvedBy", (t.submitted_by = ${uid}) as "submittedBySelf"
      from timesheets t join team_members m on m.id = t.team_member_id join projects p on p.id = t.project_id left join users approver on approver.id = t.approved_by
      where t.team_member_id = any(${uuidList(mids)}) order by p.acronym, t.month`);
    const entries = ts.length ? await rows(tx, sql`select e.timesheet_id as "timesheetId", e.day, e.minutes, w.number as wp from timesheet_entries e
      left join work_packages w on w.id = e.work_package_id where e.timesheet_id = any(${uuidList(ts.map((t) => String(t.id)))}) order by e.timesheet_id, e.day`) : [];
    c.timesheets = ts.map((t) => {
      const own = entries.filter((e) => e.timesheetId === t.id);
      return { project: t.project, month: t.month, status: t.status, submittedAt: iso(t.submittedAt), approvedAt: iso(t.approvedAt), approvedBy: t.approvedBy ?? null,
        totalMinutes: own.reduce((a, e) => a + Number(e.minutes), 0), entries: own.map((e) => ({ day: e.day, minutes: e.minutes, workPackage: e.wp === null ? null : `WP${e.wp}` })) };
    });
    const pc = await rows(tx, sql`select e.id, p.acronym as project, e.date, e.category_code as category, e.description, e.amount_cents as amount, e.recognised_cents as recognised,
      e.status, e.source, rp.number as period, e.external_claim as "externalClaim"
      from expenses e join projects p on p.id = e.project_id left join timesheets t on t.id = e.timesheet_id
      left join reimbursement_claims rc on rc.id = e.claim_id left join reporting_periods rp on rp.id = rc.reporting_period_id
      where e.source in ('timesheet', 'historic_personnel') and (t.team_member_id = any(${uuidList(mids)}) or e.team_member_id = any(${uuidList(mids)})) order by p.acronym, e.date`);
    c.personnelCosts = pc.map((e) => ({ project: e.project, date: e.date, category: e.category, description: e.description, source: e.source, status: e.status,
      claimPeriod: e.period === null ? null : `RP${e.period}`, externalClaim: e.externalClaim, amountCents: amount(e.amount), recognisedCents: amount(e.recognised) }));
    c.responsibilities = await rows(tx, sql`select 'deliverable' as kind, p.acronym as project, 'D' || w.number || '.' || d.number as code, d.title, d.status from deliverables d
        join projects p on p.id = d.project_id join work_packages w on w.id = d.work_package_id where d.responsible_member_id = any(${uuidList(mids)})
      union all select 'milestone', p.acronym, 'M' || ms.number, ms.title, ms.status from milestones ms join projects p on p.id = ms.project_id where ms.responsible_member_id = any(${uuidList(mids)})
      union all select 'task', p.acronym, 'T' || w.number || '.' || tk.number, tk.title, tk.status from tasks tk join projects p on p.id = tk.project_id
        join work_packages w on w.id = tk.work_package_id where tk.responsible_member_id = any(${uuidList(mids)})
      order by 2, 1, 3`);
  }

  // Revizijski zapis: (A) osoba je predmet, (B) osoba je akter na tuđem zapisu (pravilo u komentaru modula).
  const tsIds = mids.length ? (await rows<{ id: string }>(tx, sql`select id from timesheets where team_member_id = any(${uuidList(mids)})`)).map((r) => r.id) : [];
  const subjectIds = [uid, ...mids].filter((x): x is string => !!x);
  const audit = await rows(tx, sql`select id, at, actor_type as "actorType", actor_id as "actorId", entity, entity_id as "entityId", action, diff, host(ip) as ip
    from audit_entries where
      ${uid ? sql`actor_id = ${uid} or` : sql``}
      (entity in ('user', 'team_member', 'privacy') and entity_id = any(${sql`array[${sql.join(subjectIds.length ? subjectIds.map((i) => sql`${i}`) : [sql`null`], sql`, `)}]::text[]`}))
      or (entity = 'timesheet' and entity_id = any(${sql`array[${sql.join(tsIds.length ? tsIds.map((i) => sql`${i}`) : [sql`null`], sql`, `)}]::text[]`}))
    order by id limit ${AUDIT_MAX + 1}`);
  if (audit.length > AUDIT_MAX) { truncated.audit = true; audit.length = AUDIT_MAX; }
  const personnelIds = new Set<string>();
  if (!withAmounts) {
    const ids = audit.filter((a) => a.entity === 'expense' && a.entityId).map((a) => String(a.entityId)).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    if (ids.length) for (const r of await rows<{ id: string }>(tx, sql`select id from expenses where id = any(${uuidList(ids)}) and source in ('timesheet', 'historic_personnel')`)) personnelIds.add(r.id);
  }
  const own = new Set([uid, s.user?.email, ...mids].filter((x): x is string => !!x).map((x) => x.toLowerCase()));
  const subjectSet = new Set(subjectIds); const tsSet = new Set(tsIds);
  c.audit = audit.map((a) => {
    const entityId = a.entityId === null ? null : String(a.entityId);
    const isSubject = (['user', 'team_member', 'privacy'].includes(String(a.entity)) && !!entityId && subjectSet.has(entityId)) || (a.entity === 'timesheet' && !!entityId && tsSet.has(entityId));
    const selfActor = !!uid && a.actorId === uid;
    const actor = selfActor ? 'osoba' : a.actorType === 'system' ? 'sustav' : 'drugi korisnik';
    if (!isSubject) return { at: iso(a.at), action: a.action, entity: a.entity, actor, ip: selfActor ? a.ip : null, role: 'akter' };
    let diff: unknown = a.diff ? scrubSecrets(a.diff) : null;
    if (diff && !withAmounts) {
      diff = redactSalary({ entity: String(a.entity), entityId, action: String(a.action), diff: diff as never }, personnelIds).diff;
      diff = hideAmountsDeep(diff);
    }
    diff = diff ? scrubThirdParty(diff, own) : null;
    return { at: iso(a.at), action: a.action, entity: a.entity, actor, ip: selfActor ? a.ip : null, role: 'predmet', diff };
  });
  return { withAmounts, categories: c, truncated };
}

/** Bez prava na plaće: iznosi u promjenama zapisa o osobi (trošak člana tima, troškovi iz odobrenja timesheeta) se skrivaju. */
function hideAmountsDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(hideAmountsDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Row).map(([k, x]) => [k, /^(amount|amountCents|recognised|recognisedCents|annualCost|annualCostCents|cost)$/i.test(k) && typeof x === 'number' ? HIDDEN : hideAmountsDeep(x)]));
  return v;
}

/** Broj zapisa po kategoriji (pregled prije izvoza; bez sadržaja). */
export const categoryCounts = (e: SubjectExport): Record<ExportCategory, number> =>
  Object.fromEntries(EXPORT_CATEGORIES.map((k) => [k, e.categories[k].length])) as Record<ExportCategory, number>;
