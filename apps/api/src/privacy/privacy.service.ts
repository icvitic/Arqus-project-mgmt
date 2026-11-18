import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { DbService, type Tx } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { TenantContext, tenantToday } from '../common/tenant-context';
import { canInTenant } from '../common/access';
import { readVersion } from '../health/health.controller';
import { asciiSlug, ZipWriter } from '../export/zip-writer';
import { candidateMembers, categoryCounts, collectSubject, resolveSubject, type SubjectMember, type SubjectRef } from './subject-data';
import { subjectJson, subjectReadme, subjectWorkbook, type ExportMeta } from './subject-render';

type Row = Record<string, unknown>;
const rows = async <T = Row>(tx: Tx, q: ReturnType<typeof sql>): Promise<T[]> => (await tx.execute(q)).rows as T[];
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Zamjenska e-adresa zatvorenog računa (domena `.invalid` po RFC 2606 – nikad ne prima poštu, ne može biti prava adresa). */
export const closedEmail = (userId: string) => `zatvoren-${userId}@racun.invalid`;

export interface AnonymisePreview {
  member: { id: string; fullName: string; project: string; projectId: string; projectStatus: string; partner: string; linkedToAccount: boolean; anonymised: boolean };
  pseudonym: string;
  retention: { end: string | null; running: boolean; reason: string };
  changes: {
    teamMember: { field: string; before: string | null; after: string | null }[];
    expenses: { id: string; date: string; status: string; before: string; after: string }[];
  };
  unchanged: { timesheets: number; minutes: number; personnelExpenses: number; responsibilities: number };
  flagged: { where: string; ref: string; text: string }[];
  documents: { id: string; title: string; fileName: string; uploadedAt: string | null }[];
  fingerprint: string;
}

/**
 * WP1.23 – prava ispitanika u proizvodu: izvoz podataka jedne osobe (administrator i samoposluga), zatvaranje računa osobe
 * koja je otišla i anonimizacija zapisa člana tima nakon isteka roka čuvanja projekta. Sve radnje traže `privacy:manage`
 * (osim samoposluge), revidiraju se bez sadržaja i ne mijenjaju iznose, sate ni strukturu financijskog zapisa.
 */
@Injectable()
export class PrivacyService {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly ctx: TenantContext) {}

  private institution = async (tx: Tx) => (await rows<{ name: string }>(tx, sql`select name from tenants where id = app_current_tenant()`))[0]?.name ?? '';

  // ---------- pretraga i pregled osobe ----------
  async subject(tx: Tx, ref: SubjectRef) {
    const s = await resolveSubject(tx, ref);
    const withAmounts = canInTenant(this.ctx.require(), 'personnel:read');
    const data = await collectSubject(tx, s, withAmounts);
    const candidates = await candidateMembers(tx, s);
    const retention = new Map<string, string | null>();
    for (const m of s.members) retention.set(m.id, iso((await rows(tx, sql`select project_retention_end(${m.projectId}::uuid) as d`))[0]?.d));
    const today = tenantToday();
    return {
      user: s.user, withAmounts,
      members: s.members.map((m) => ({ ...this.publicMember(m, withAmounts), linked: s.linkedMemberIds.includes(m.id), retentionEnd: retention.get(m.id) ?? null,
        retentionRunning: !retention.get(m.id) || retention.get(m.id)! > today })),
      candidates: candidates.map((m) => this.publicMember(m, false)),
      counts: categoryCounts(data),
      documents: data.categories.documents,
    };
  }

  private publicMember(m: SubjectMember, withAmounts: boolean) {
    return { id: m.id, fullName: m.fullName, project: m.acronym, projectId: m.projectId, projectStatus: m.projectStatus, partner: m.partner, role: m.role,
      userId: m.userId, active: m.active, anonymised: !!m.anonymisedAt, annualCostCents: withAmounts ? m.annualCostCents : null };
  }

  // ---------- izvoz ----------
  /**
   * Izvoz u ZIP (JSON + XLSX + čitljiv sažetak). Iznosi plaća samo ako onaj tko izvozi ima `personnel:read` na razini
   * institucije – isto pravilo za administratora i samoposlugu (osoba vidi vlastiti trošak samo s tom dozvolom, kao u sučelju).
   * Revizija bilježi tko, za koga i s iznosima ili bez – nikad sadržaj.
   */
  async export(ref: SubjectRef | 'self'): Promise<{ fileName: string; stream: Readable }> {
    const c = this.ctx.require();
    const self = ref === 'self';
    const now = new Date();
    const withAmounts = canInTenant(c, 'personnel:read');
    const built = await this.db.tx(async (tx) => {
      const s = await resolveSubject(tx, self ? { userId: c.userId!, memberIds: [] } : ref);
      const data = await collectSubject(tx, s, withAmounts);
      const exporter = (await rows<{ name: string; email: string }>(tx, sql`select display_name as name, email from users where id = ${c.userId}`))[0];
      const meta: ExportMeta = { institution: await this.institution(tx), generatedAt: now, generatedBy: exporter ? `${exporter.name} <${exporter.email}>` : 'sustav', selfService: self, appVersion: readVersion() };
      await this.audit.record(tx, { entity: 'privacy', entityId: s.user?.id ?? s.members[0]?.id ?? null, action: self ? 'export.self' : 'export', diff: { meta: {
        subjectUserId: s.user?.id ?? null, memberIds: s.members.map((m) => m.id), withAmounts, selfService: self,
      } } });
      return { s, data, meta };
    });
    const { s, data, meta } = built;
    const files: { name: string; data: Buffer }[] = [
      { name: 'procitaj-me.html', data: subjectReadme(s, data, meta) },
      { name: 'podaci.json', data: subjectJson(s, data, meta) },
      { name: 'podaci.xlsx', data: await subjectWorkbook(s, data, meta) },
    ];
    const label = asciiSlug(s.user?.displayName ?? s.members[0]?.fullName ?? 'osoba', 40);
    const fileName = `Osobni-podaci_${label}_${tenantToday(now)}.zip`;
    async function* chunks(): AsyncGenerator<Buffer> {
      const zip = new ZipWriter(now);
      for (const f of files) for (const part of await zip.entry(f.name, f.data)) yield part;
      yield zip.finish();
    }
    return { fileName, stream: Readable.from(chunks(), { objectMode: false }) };
  }

  // ---------- zatvaranje računa ----------
  /**
   * Zatvaranje računa osobe koja je otišla (nepovratno). Odmah nestaju: lozinka, MFA tajna, sesije (s IP-om i preglednikom),
   * pozivnice i poveznice, kalendar, obavijesti, zapisi sažetka i isporuke pošte, uloge; e-adresa se zamjenjuje adresom na
   * `.invalid`, pa se račun ne može naći ni prijaviti. Ostaju: id, ime i prezime (ime je na odobrenim timesheetovima,
   * odlukama i revizijskom zapisu – dokaz za zahtjeve koje financijer može provjeravati godinama), vrijeme i tko je zatvorio,
   * te zapisi člana tima povezani s računom (anonimiziraju se zasebno, nakon roka čuvanja projekta). Ponovljeno = bez promjene.
   */
  async close(tx: Tx, userId: string, input: { confirmation: string; reason: string }) {
    const c = this.ctx.require();
    const u = (await rows(tx, sql`select id, display_name as "displayName", status, closed_at as "closedAt" from users where id = ${userId}`))[0];
    if (!u) throw new NotFoundException('Korisnik ne postoji');
    if (u.status === 'closed') return { id: userId, status: 'closed', closedAt: iso(u.closedAt), alreadyClosed: true };
    if (userId === c.userId) throw new ForbiddenException('Ne možeš zatvoriti vlastiti račun');
    if (input.confirmation.trim() !== String(u.displayName).trim()) throw new BadRequestException({ statusCode: 400, code: 'confirmation_mismatch', message: 'Za potvrdu upiši ime i prezime korisnika točno kako je prikazano' });
    const admins = await rows<{ id: string }>(tx, sql`select distinct u.id from role_assignments ra join roles r on r.id = ra.role_id join users u on u.id = ra.user_id
      where r.code = 'tenant-admin' and ra.project_id is null and u.status = 'active' and u.deleted_at is null`);
    if (admins.some((a) => a.id === userId) && admins.length === 1) throw new ConflictException('Ovo je jedini aktivni administrator – najprije dodijeli ulogu administratora drugom korisniku');

    const count = async (q: ReturnType<typeof sql>) => (await tx.execute(q)).rowCount ?? 0;
    const removed = {
      sessions: await count(sql`delete from sessions where user_id = ${userId}`),
      accountTokens: await count(sql`delete from account_tokens where user_id = ${userId}`),
      calendar: await count(sql`delete from calendar_tokens where user_id = ${userId}`),
      digestRuns: await count(sql`delete from digest_runs where user_id = ${userId}`),
      mailDeliveries: await count(sql`delete from mail_deliveries where user_id = ${userId}`),
      roles: await count(sql`delete from role_assignments where user_id = ${userId}`),
      notifications: 0,
    };
    // Obavijesti briše samo vlasnik (RLS po `app.user_id`) – kontekst se za brisanje postavlja na osobu i odmah vraća.
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    removed.notifications = await count(sql`delete from notifications where user_id = ${userId}`);
    await tx.execute(sql`select set_config('app.user_id', ${c.userId ?? ''}, true)`);
    const now = new Date();
    await tx.execute(sql`update users set status = 'closed', email = ${closedEmail(userId)}, password_hash = null, mfa_enabled = false, mfa_secret_enc = null,
      mfa_pending_enc = null, mfa_last_step = null, digest_enabled = false, last_login_at = null, password_changed_at = null,
      closed_at = ${now}, closed_by = ${c.userId ?? null}, updated_at = ${now}, updated_by = ${c.userId ?? null} where id = ${userId}`);
    await this.audit.record(tx, { entity: 'user', entityId: userId, action: 'close', diff: { before: { status: u.status }, after: { status: 'closed' }, meta: { reason: input.reason, removed } } });
    return { id: userId, status: 'closed', closedAt: now.toISOString(), alreadyClosed: false, removed };
  }

  // ---------- anonimizacija ----------
  async anonymisePreview(tx: Tx, memberId: string): Promise<AnonymisePreview> {
    const m = (await rows(tx, sql`select m.id, m.full_name as "fullName", m.role, m.user_id as "userId", m.anonymised_at as "anonymisedAt", m.project_id as "projectId",
      p.acronym, p.status as "projectStatus", o.name as partner from team_members m join projects p on p.id = m.project_id
      join project_partners pp on pp.id = m.partner_id join organisations o on o.id = pp.organisation_id where m.id = ${memberId}`))[0];
    if (!m) throw new NotFoundException('Zapis člana tima ne postoji');
    const name = String(m.fullName); const projectId = String(m.projectId);
    const end = iso((await rows(tx, sql`select project_retention_end(${projectId}::uuid) as d`))[0]?.d);
    const today = tenantToday();
    const running = !end || end > today;
    const reason = !end ? (['closed', 'terminated', 'archived'].includes(String(m.projectStatus))
      ? 'Rok čuvanja još nije počeo: projekt ima predan zahtjev za nadoknadu o kojem nije odlučeno ili mu se ne može odrediti kraj.'
      : 'Rok čuvanja još nije počeo: projekt nije zatvoren, raskinut ni arhiviran.')
      : running ? `Rok čuvanja projekta traje do ${end}.` : `Rok čuvanja projekta istekao je ${end}.`;
    const n = (await rows<{ n: number }>(tx, sql`select count(*)::int as n from team_members where project_id = ${projectId} and pseudonym is not null`))[0]!.n;
    let pseudonym = '';
    for (let i = n + 1; ; i++) {
      pseudonym = `Bivši član tima ${i}`;
      const taken = await rows(tx, sql`select 1 from team_members where project_id = ${projectId} and (pseudonym = ${pseudonym} or full_name = ${pseudonym})`);
      if (!taken.length) break;
    }
    const anonymised = !!m.anonymisedAt;
    if (anonymised) pseudonym = name;
    const personnel = await rows(tx, sql`select e.id, e.date, e.status, e.description from expenses e left join timesheets t on t.id = e.timesheet_id
      where e.source in ('timesheet', 'historic_personnel') and (t.team_member_id = ${memberId} or e.team_member_id = ${memberId}) order by e.date, e.id`);
    const expenses = anonymised ? [] : personnel.filter((e) => String(e.description).includes(name))
      .map((e) => ({ id: String(e.id), date: String(e.date), status: String(e.status), before: String(e.description), after: String(e.description).split(name).join(pseudonym) }));
    const tsAgg = (await rows<{ n: number; minutes: number }>(tx, sql`select count(distinct t.id)::int as n, coalesce(sum(e.minutes), 0)::int as minutes
      from timesheets t left join timesheet_entries e on e.timesheet_id = t.id where t.team_member_id = ${memberId}`))[0]!;
    const resp = (await rows<{ n: number }>(tx, sql`select ((select count(*) from deliverables where responsible_member_id = ${memberId})
      + (select count(*) from milestones where responsible_member_id = ${memberId}) + (select count(*) from tasks where responsible_member_id = ${memberId}))::int as n`))[0]!.n;
    const like = `%${name.replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
    const flagged = anonymised ? [] : await rows<{ where: string; ref: string; text: string }>(tx, sql`
      select 'rizik' as "where", 'R' || number as ref, left(concat_ws(' · ', description, mitigation), 200) as text from risks where project_id = ${projectId} and (description ilike ${like} or mitigation ilike ${like})
      union all select 'radni paket', 'WP' || number, left(concat_ws(' · ', title, objectives), 200) from work_packages where project_id = ${projectId} and (title ilike ${like} or objectives ilike ${like})
      union all select 'isporuka', 'D' || number, left(title, 200) from deliverables where project_id = ${projectId} and title ilike ${like}
      union all select 'prekretnica', 'M' || number, left(concat_ws(' · ', title, verification), 200) from milestones where project_id = ${projectId} and (title ilike ${like} or verification ilike ${like})
      union all select 'zadatak', 'T' || number, left(title, 200) from tasks where project_id = ${projectId} and title ilike ${like}
      union all select 'trošak', to_char(date, 'YYYY-MM-DD') || ' ' || category_code, left(concat_ws(' · ', description, supplier, external_claim), 200) from expenses
        where project_id = ${projectId} and source not in ('timesheet', 'historic_personnel') and (description ilike ${like} or supplier ilike ${like} or external_claim ilike ${like})
      union all select 'zahtjev za nadoknadu', 'RP' || rp.number, left(concat_ws(' · ', c.note, c.payment_note, c.early_reason, case when c.submission::text ilike ${like} or c.decision::text ilike ${like} then 'snimka predaje ili odluke sadrži ime' end), 200)
        from reimbursement_claims c join reporting_periods rp on rp.id = c.reporting_period_id where c.project_id = ${projectId}
        and (c.note ilike ${like} or c.payment_note ilike ${like} or c.early_reason ilike ${like} or c.submission::text ilike ${like} or c.decision::text ilike ${like})
      union all select 'stavka proračuna', category_code, left(description, 200) from budget_lines bl where bl.budget_id in (select id from project_budgets where project_id = ${projectId}) and description ilike ${like}
      union all select 'dokument', d.title, left(concat_ws(' · ', d.title, v.file_name, v.note), 200) from documents d join document_versions v on v.document_id = d.id
        where d.project_id = ${projectId} and d.deleted_at is null and (d.title ilike ${like} or v.file_name ilike ${like} or v.note ilike ${like})`);
    const documents = m.userId && !anonymised ? (await rows(tx, sql`select distinct on (d.id) d.id, d.title, v.file_name as "fileName", v.created_at as "uploadedAt" from documents d
      join document_versions v on v.document_id = d.id where d.project_id = ${projectId} and d.deleted_at is null and v.created_by = ${m.userId} order by d.id, v.version desc`))
      .map((d) => ({ id: String(d.id), title: String(d.title), fileName: String(d.fileName), uploadedAt: iso(d.uploadedAt) })) : [];
    const teamMember = anonymised ? [] : [
      { field: 'ime i prezime', before: name, after: pseudonym },
      ...(m.role ? [{ field: 'uloga u timu', before: String(m.role), after: null }] : []),
      ...(m.userId ? [{ field: 'veza s korisničkim računom', before: 'povezan', after: 'prekinuta' }] : []),
    ];
    const body = { memberId, pseudonym, teamMember, expenses: expenses.map((e) => [e.id, e.after]) };
    return {
      member: { id: memberId, fullName: name, project: String(m.acronym), projectId, projectStatus: String(m.projectStatus), partner: String(m.partner), linkedToAccount: !!m.userId, anonymised },
      pseudonym, retention: { end, running, reason },
      changes: { teamMember, expenses },
      unchanged: { timesheets: tsAgg.n, minutes: tsAgg.minutes, personnelExpenses: personnel.length, responsibilities: resp },
      flagged, documents, fingerprint: sha256(JSON.stringify(body)),
    };
  }

  /**
   * Anonimizacija zapisa člana tima (nepovratno): ime → pseudonim stabilan unutar projekta, uloga obrisana, veza s računom
   * prekinuta, ime u opisu njegovih troškova osoblja zamijenjeno pseudonimom (kroz jedini dopušteni put okidača nepromjenjivosti).
   * Iznosi, sati, statusi, zahtjevi i struktura ostaju. Odbija se dok traje rok čuvanja projekta, osim uz zabilježen razlog;
   * traži upisano ime osobe i otisak pregleda (pregled = učinak). Slobodni tekst koji spominje ime samo se navodi.
   */
  async anonymise(tx: Tx, memberId: string, input: { confirmation: string; fingerprint: string; reason?: string | null }) {
    const c = this.ctx.require();
    await tx.execute(sql`select 1 from team_members where id = ${memberId} for update`);
    const p = await this.anonymisePreview(tx, memberId);
    if (p.member.anonymised) throw new ConflictException('Zapis člana tima je već anonimiziran');
    if (p.fingerprint !== input.fingerprint) throw new ConflictException({ statusCode: 409, code: 'preview_changed', message: 'Podaci su se promijenili od pregleda – otvori pregled ponovno' });
    if (input.confirmation.trim() !== p.member.fullName.trim()) throw new BadRequestException({ statusCode: 400, code: 'confirmation_mismatch', message: 'Za potvrdu upiši ime i prezime točno kako je prikazano' });
    const reason = input.reason?.trim() || null;
    if (p.retention.running && (!reason || reason.length < 10)) {
      throw new ConflictException({ statusCode: 409, code: 'retention_running', retentionEnd: p.retention.end, message: `${p.retention.reason} Anonimizacija prije isteka roka traži zabilježen razlog (najmanje 10 znakova).` });
    }
    const now = new Date();
    await tx.execute(sql`update team_members set full_name = ${p.pseudonym}, pseudonym = ${p.pseudonym}, role = null, user_id = null,
      anonymised_at = ${now}, anonymised_by = ${c.userId ?? null}, updated_at = ${now}, updated_by = ${c.userId ?? null} where id = ${memberId}`);
    await tx.execute(sql`select set_config('app.privacy_anonymise', ${memberId}, true), set_config('app.privacy_anonymise_name', ${p.member.fullName}, true), set_config('app.privacy_actor', ${c.userId ?? ''}, true)`);
    for (const e of p.changes.expenses) {
      await tx.execute(sql`update expenses set description = replace(description, ${p.member.fullName}, ${p.pseudonym}) where id = ${e.id}`);
    }
    await tx.execute(sql`select set_config('app.privacy_anonymise', '', true), set_config('app.privacy_anonymise_name', '', true), set_config('app.privacy_actor', '', true)`);
    await this.audit.record(tx, { entity: 'team_member', entityId: memberId, action: 'anonymise', diff: { meta: {
      pseudonym: p.pseudonym, projectId: p.member.projectId, retentionEnd: p.retention.end, beforeRetentionEnd: p.retention.running, reason,
      expensesUpdated: p.changes.expenses.length, flagged: p.flagged.length, documentsToReview: p.documents.length, accountLinkCut: p.member.linkedToAccount,
    } } });
    return { id: memberId, pseudonym: p.pseudonym, anonymisedAt: now.toISOString(), expensesUpdated: p.changes.expenses.length, flagged: p.flagged, documents: p.documents };
  }
}
