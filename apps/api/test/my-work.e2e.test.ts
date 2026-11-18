import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { inviteUser } from './invite';
import { seedDemo } from '../src/db/seed';
import { buildXlsx, type Cell } from '../src/export/xlsx-writer';
import { readXlsx } from '../src/import/xlsx-reader';
import { buildAccessFixture, PDF, type AccessFixture } from './access-fixture';

/**
 * WP1.18 – „Moj rad”, obavijesti i osobni kalendar rokova. Postava pristupa (WP1.14): dva NPOO projekta od 1. 1. 2027.
 * (12 mjeseci, razdoblja od 3 mjeseca, rok 30 dana), „danas” = 15. 7. 2027. (zona Europe/Zagreb).
 * - pm: voditelj i član tima SAMO na A; tm: član tima SAMO na A; fin: financije institucije; rdr: uprava (čitatelj);
 * - office: ured za projekte (dodan ovdje); lead: voditelj prijave `mine`.
 */
const NOW = new Date('2027-07-15T10:00:00Z');
const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
process.env.CALENDAR_RATE_MAX = '60';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Item = { key: string; kind: string; role: string; urgency: string; due: string | null; projectId?: string; proposalId?: string; callId?: string; count?: number; title: string; detail?: string; link: string };

/** Minimalan čitač iCalendara za provjeru: odmotavanje redaka, VEVENT-i, vraćanje escape znakova. */
function parseIcs(text: string) {
  expect(text.includes('\n') && !/[^\r]\n/.test(text)).toBe(true); // samo CRLF
  for (const line of text.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
  const lines = text.replace(/\r\n[ \t]/g, '').split('\r\n').filter(Boolean);
  expect(lines[0]).toBe('BEGIN:VCALENDAR'); expect(lines[lines.length - 1]).toBe('END:VCALENDAR');
  const unescape = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
  const events: Record<string, string>[] = []; let cur: Record<string, string> | null = null;
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (l === 'END:VEVENT') { events.push(cur!); cur = null; continue; }
    if (!cur) continue;
    const i = l.indexOf(':'); const name = l.slice(0, i); const value = l.slice(i + 1);
    cur[name] = name === 'SUMMARY' || name === 'DESCRIPTION' ? unescape(value) : value;
  }
  return { lines, events };
}

describe('Moj rad, obavijesti i kalendar (WP1.18, e2e)', () => {
  let app: INestApplication; let f: AccessFixture;
  const tag = randomUUID().slice(0, 8);
  const pool = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const work = async (t: string) => (await http().get('/api/me/work').set(auth(t)).expect(200)).body as { today: string; items: Item[]; summary: Body };
  const notes = async (t: string, q = '') => (await http().get(`/api/me/notifications${q}`).set(auth(t)).expect(200)).body as { items: Body[]; unread: number; next: number | null };
  const sig = (items: Item[]) => items.map((i) => `${i.kind}|${i.urgency}|${i.due ?? ''}`).sort();
  let office = ''; let callId = ''; let tmMemberId = '';

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), 'arqus-mywork-'));
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    f = await buildAccessFixture(app, `mw-${tag}`, { proposals: true });
    tmMemberId = f.A.member;
    const admin = auth(f.tokens.admin);
    // A: ručni trošak bez dokaza u RP2 (bez ZNS-a).
    await http().post(`/api/projects/${f.A.id}/expenses`).set(admin).send({ categoryCode: 'PUT', date: '2027-05-03', description: 'Putni trošak', amount: 20_000 }).expect(201);
    // Ured za projekte; interni rokovi prijava (vlastita prijava voditelja `lead` i tuđa); praćeni poziv bez odluke go/no-go.
    await inviteUser(app, f.tokens.admin, { email: `office@mw-${tag}.hr`, displayName: 'Ured', roleCodes: ['project-office'] }, 'Plava-Staza-2027-x');
    office = (await http().post('/api/auth/login').send({ tenantSlug: `mw-${tag}`, email: `office@mw-${tag}.hr`, password: 'Plava-Staza-2027-x' }).expect(201)).body.accessToken;
    for (const [id, d] of [[f.proposals.mine, '2027-07-25'], [f.proposals.other, '2027-07-20']] as const) {
      const rev = (await http().get(`/api/proposals/${id}`).set(admin).expect(200)).body.revision;
      await http().patch(`/api/proposals/${id}`).set(admin).send({ internalDeadline: d, revision: rev }).expect(200);
    }
    callId = (await http().post('/api/calls').set(admin).send({ code: `MW-${tag}`, title: 'Poziv bez odluke', programme: 'NPOO', deadlines: [{ kind: 'submission', at: '2027-08-20T15:00:00Z' }] }).expect(201)).body.id;
    await http().put(`/api/calls/${callId}/decision`).set(admin).send({ decision: 'watch', internalDeadline: '2027-07-25' }).expect(200);
  }, 120_000);
  afterAll(async () => { vi.useRealTimers(); await app.close(); await pool.end(); });

  // ---------------- Moj rad ----------------

  it('član tima: tekući mjesec, ranije nepredani mjeseci, predan timesheet čeka; ništa s projekta B', async () => {
    const w = await work(f.tokens.tm);
    expect(w.today).toBe('2027-07-15');
    expect(sig(w.items)).toEqual(sig([
      ...['2027-01-31', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30'].map((due) => ({ kind: 'timesheet_missing', urgency: 'overdue', due })),
      { kind: 'timesheet_current', urgency: 'waiting', due: '2027-07-31' }, { kind: 'timesheet_submitted', urgency: 'waiting', due: null },
    ] as Item[]));
    expect(w.items[0]).toMatchObject({ kind: 'timesheet_missing', due: '2027-01-31', link: `projekti/${f.A.id}/tim/${tmMemberId}/2027-01`, role: 'member' });
    expect(w.summary).toEqual({ overdue: 5, dueSoon: 0, waiting: 2, info: 0, attention: 5 });
    expect(w.items.every((i) => i.projectId === f.A.id)).toBe(true);
    expect(JSON.stringify(w)).not.toContain(f.B.id);
  });

  it('voditelj: odobrenja (četiri oka), isporuka i prekretnica kasne, odstupanja, ZNS i razdoblje bez ZNS-a – brojke kao na portfelju', async () => {
    const w = await work(f.tokens.pm);
    const deviations = (await http().get(`/api/projects/${f.A.id}`).set(auth(f.tokens.pm)).expect(200)).body.deviations.length as number;
    const expected = [
      ...['2027-01-31', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30'].map((due) => ({ kind: 'timesheet_missing', urgency: 'overdue', due })),
      { kind: 'timesheet_current', urgency: 'waiting', due: '2027-07-31' }, { kind: 'timesheet_submitted', urgency: 'waiting', due: null },
      { kind: 'timesheet_to_approve', urgency: 'waiting', due: null },
      { kind: 'deliverable_due', urgency: 'overdue', due: '2027-06-30' }, { kind: 'milestone_due', urgency: 'overdue', due: '2027-06-30' },
      { kind: 'claim_draft', urgency: 'overdue', due: '2027-04-30' }, { kind: 'period_unclaimed', urgency: 'due_soon', due: '2027-07-30' },
      { kind: 'expenses_without_evidence', urgency: 'waiting', due: null },
      ...(deviations ? [{ kind: 'deviations', urgency: 'waiting', due: null }] : []),
    ] as Item[];
    expect(sig(w.items)).toEqual(sig(expected));
    // Četiri oka: na odobrenju je timesheet člana tima, ne voditeljev vlastiti (on ga je i predao).
    expect(w.items.filter((i) => i.kind === 'timesheet_to_approve').map((i) => i.title)).toEqual(['Odobri timesheet: Član tima A, veljača 2027.']);
    expect(w.items.find((i) => i.kind === 'claim_draft')!.detail).toMatch(/1 stavka blokira predaju/); // timesheetovi iz veljače čekaju odobrenje
    if (deviations) expect(w.items.find((i) => i.kind === 'deviations')!.count).toBe(deviations);
    // Iste činjenice kao na portfelju (portfolio/facts.ts): nijedna brojka se ne računa drugačije.
    const pf = (await http().get('/api/portfolio').set(auth(f.tokens.pm)).expect(200)).body;
    const att = pf.projects.find((p: Body) => p.id === f.A.id).attention;
    const n = (k: string, u?: string) => w.items.filter((i) => i.kind === k && (!u || i.urgency === u)).length;
    expect(att.timesheetsToApprove).toBe(n('timesheet_to_approve') + 1); // + vlastiti (predao ga je sam)
    expect(att.lateDeliverables).toBe(n('deliverable_due', 'overdue'));
    expect(att.unclaimedPeriods).toBe(n('claim_draft') + n('period_unclaimed'));
    expect(att.expensesWithoutEvidence).toBe(w.items.find((i) => i.kind === 'expenses_without_evidence')!.count);
    expect(att.highRisks).toBe(n('risks_high'));
    expect(JSON.stringify(w)).not.toContain(f.B.id);
    expect(JSON.stringify(w)).not.toMatch(/EUR|€/);
  });

  it('financije institucije: ZNS-ovi i razdoblja na svim projektima; isti brojevi kao portfelj; bez iznosa', async () => {
    const w = await work(f.tokens.fin);
    expect(sig(w.items)).toEqual(sig([
      { kind: 'claim_draft', urgency: 'overdue', due: '2027-04-30' }, { kind: 'claim_draft', urgency: 'overdue', due: '2027-04-30' },
      { kind: 'period_unclaimed', urgency: 'due_soon', due: '2027-07-30' }, { kind: 'period_unclaimed', urgency: 'due_soon', due: '2027-07-30' },
      { kind: 'expenses_without_evidence', urgency: 'waiting', due: null },
    ] as Item[]));
    const pf = (await http().get('/api/portfolio').set(auth(f.tokens.fin)).expect(200)).body;
    for (const id of [f.A.id, f.B.id]) {
      const att = pf.projects.find((p: Body) => p.id === id).attention;
      const mine = w.items.filter((i) => i.projectId === id);
      expect(att.unclaimedPeriods).toBe(mine.filter((i) => ['claim_draft', 'period_unclaimed', 'claim_returned'].includes(i.kind)).length);
      expect(att.expensesWithoutEvidence).toBe(mine.find((i) => i.kind === 'expenses_without_evidence')?.count ?? 0);
      expect(att.strandedExpenses).toBe(mine.find((i) => i.kind === 'expenses_stranded')?.count ?? 0);
    }
    expect(JSON.stringify(w)).not.toMatch(/EUR|€|200,00/);
  });

  it('ured za projekte: prijave s internim rokom i otvorenim stavkama spremnosti, poziv bez odluke; bez obveza svih projekata', async () => {
    const w = await work(office);
    expect(sig(w.items)).toEqual(sig([
      { kind: 'proposal_deadline', urgency: 'due_soon', due: '2027-07-20' }, { kind: 'proposal_deadline', urgency: 'due_soon', due: '2027-07-25' },
      { kind: 'call_decision', urgency: 'due_soon', due: '2027-07-25' },
    ] as Item[]));
    // Broj otvorenih stavki spremnosti = isti izračun kao na prijavi (proposalReadiness).
    for (const it of w.items.filter((i) => i.kind === 'proposal_deadline')) {
      const p = (await http().get(`/api/proposals/${it.proposalId}`).set(auth(office)).expect(200)).body;
      const open = p.readiness.filter((r: Body) => !r.ok).length;
      expect(it.detail).toContain(`${open} stavk`);
    }
    expect(w.items.find((i) => i.kind === 'call_decision')).toMatchObject({ callId, link: `radar/${callId}` });
  });

  it('voditelj prijave vidi samo vlastitu prijavu; administrator (`*`) samo ono što je osobno njegovo; uprava nema ništa na čekanju', async () => {
    const lead = await work(f.tokens.lead);
    expect(lead.items.map((i) => `${i.kind}|${i.proposalId}`)).toEqual([`proposal_deadline|${f.proposals.mine}`]);
    expect(JSON.stringify(lead)).not.toContain(f.proposals.other);
    // Administrator je voditelj tuđe prijave (otvorio ju je bez navođenja voditelja) – nema obveza svih projekata institucije.
    expect((await work(f.tokens.admin)).items.map((i) => `${i.kind}|${i.proposalId}`)).toEqual([`proposal_deadline|${f.proposals.other}`]);
    expect(await work(f.tokens.rdr)).toMatchObject({ items: [], summary: { overdue: 0, dueSoon: 0, waiting: 0, info: 0, attention: 0 } });
  });

  it('broj upita ne ovisi o broju projekata (voditelj i financije)', async () => {
    const count = async (t: string) => {
      const orig = Client.prototype.query; let n = 0;
      Client.prototype.query = function (this: Client, ...a: unknown[]) { n++; return (orig as (...x: unknown[]) => unknown).apply(this, a); } as typeof orig;
      try { await work(t); } finally { Client.prototype.query = orig; }
      return n;
    };
    const before = { pm: await count(f.tokens.pm), fin: await count(f.tokens.fin) };
    const admin = auth(f.tokens.admin);
    for (let i = 0; i < 3; i++) {
      const p = (await http().post('/api/projects').set(admin).send({ acronym: `QX${i}${tag.slice(0, 3)}`, title: 'Dodatni', packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA', contractNo: `UG-QX${i}-${tag}`, startDate: '2027-01-01', durationMonths: 12, managerUserId: f.users.pm }).expect(201)).body;
      const wp = (await http().post(`/api/projects/${p.id}/work-packages`).set(admin).send({ title: 'Rad', startMonth: 1, endMonth: 12 }).expect(201)).body.id;
      await http().post(`/api/projects/${p.id}/work-packages/${wp}/deliverables`).set(admin).send({ title: 'Izvještaj', type: 'ISP', dissemination: 'JAV', dueMonth: 6 }).expect(201);
      await http().post(`/api/projects/${p.id}/team`).set(admin).send({ fullName: 'Voditelj', userId: f.users.pm, annualCost: 1_000_000 }).expect(201);
      await http().post(`/api/projects/${p.id}/transition`).set(admin).send({ to: 'active' }).expect(201);
      await http().post(`/api/projects/${p.id}/claims`).set(admin).send({ period: 1 }).expect(201);
    }
    expect((await work(f.tokens.pm)).items.filter((i) => i.kind === 'deliverable_due').length).toBe(4);
    expect({ pm: await count(f.tokens.pm), fin: await count(f.tokens.fin) }).toEqual(before);
    console.warn(`WP1.18 /me/work: upita po zahtjevu (s provjerom sesije i transakcijom) – voditelj ${before.pm}, financije ${before.fin}`);
  });

  // ---------------- obavijesti ----------------

  it('događaji stvaraju obavijesti primatelju (nikad akteru), u istoj transakciji', async () => {
    const admin = auth(f.tokens.admin);
    // Već iz postave: tm je dodan u tim (pristup), pm je imenovan voditeljem A, lead je imenovan voditeljem prijave.
    expect((await notes(f.tokens.tm)).items.map((n) => n.kind)).toEqual(['access_granted']);
    expect((await notes(f.tokens.pm)).items.map((n) => n.kind)).toContain('project_manager');
    expect((await notes(f.tokens.lead)).items.map((n) => n.kind)).toEqual(['proposal_lead']);
    // Odobrenje i povrat timesheeta (voditelj) → član tima; s popisa voditelja nestaje stavka odobrenja.
    await http().post(`/api/projects/${f.A.id}/team/${tmMemberId}/timesheets/${f.month}/approve`).set(auth(f.tokens.pm)).expect(201);
    expect((await work(f.tokens.pm)).items.some((i) => i.kind === 'timesheet_to_approve')).toBe(false);
    expect((await notes(f.tokens.tm)).items[0]).toMatchObject({ kind: 'timesheet_approved', title: expect.stringMatching(/^Timesheet za veljača 2027\. je odobren/), actor: 'Korisnik pm', read: false, link: `projekti/${f.A.id}/tim/${tmMemberId}/${f.month}` });
    await http().post(`/api/projects/${f.A.id}/team/${tmMemberId}/timesheets/${f.month}/reopen`).set(auth(f.tokens.pm)).expect(201);
    expect((await notes(f.tokens.tm)).items[0]).toMatchObject({ kind: 'timesheet_reopened' });
    expect((await work(f.tokens.tm)).items.find((i) => i.due === '2027-02-28')).toMatchObject({ kind: 'timesheet_reopened', urgency: 'overdue' });
    // Pristup projektu dodijeljen i oduzet.
    const acc = (await http().post(`/api/projects/${f.A.id}/access`).set(admin).send({ userId: f.users.extra, roleCode: 'team-member' }).expect(201)).body;
    const assignment = acc.entries.find((e: Body) => e.userId === f.users.extra && e.scope === 'project').assignmentId;
    await http().delete(`/api/projects/${f.A.id}/access/${assignment}`).set(admin).expect(200);
    expect((await notes(f.tokens.extra)).items.map((n) => `${n.kind}|${n.title}`)).toEqual([`access_revoked|Uklonjen ti je pristup projektu PA${f.slug.slice(-4)}`, `access_granted|Dobio/la si pristup projektu PA${f.slug.slice(-4)}`]);
    // Imenovanje voditeljem: fin dobiva obavijest; administrator koji sam sebe imenuje – ne.
    let rev = (await http().get(`/api/projects/${f.B.id}`).set(admin).expect(200)).body.revision;
    await http().patch(`/api/projects/${f.B.id}`).set(admin).send({ managerUserId: (await http().get('/api/me').set(admin)).body.user.id, revision: rev }).expect(200);
    rev = (await http().get(`/api/projects/${f.B.id}`).set(admin).expect(200)).body.revision;
    await http().patch(`/api/projects/${f.B.id}`).set(admin).send({ managerUserId: f.users.fin, revision: rev }).expect(200);
    expect((await notes(f.tokens.fin)).items.map((n) => n.kind)).toEqual(['project_manager']);
    // ZNS: predaju financije, vraća/odlučuje/isplatu bilježi administrator → obavijesti onome tko je predao.
    const ex = (await http().post(`/api/projects/${f.B.id}/expenses`).set(admin).send({ categoryCode: 'VU', date: '2027-05-05', description: 'Usluga RP2', amount: 30_000 }).expect(201)).body.id;
    await http().post('/api/documents').set(admin).field({ entityType: 'expense', entityId: ex, title: 'Račun', kind: 'evidence' }).attach('file', PDF, 'racun.pdf').expect(201);
    const claim = (await http().post(`/api/projects/${f.B.id}/claims`).set(auth(f.tokens.fin)).send({ period: 2 }).expect(201)).body.id;
    await http().post(`/api/projects/${f.B.id}/claims/${claim}/submit`).set(auth(f.tokens.fin)).send({}).expect(201);
    await http().post(`/api/projects/${f.B.id}/claims/${claim}/decision`).set(admin).send({ decision: 'returned', note: 'Nedostaje potpis na računu' }).expect(201);
    expect((await work(f.tokens.fin)).items.find((i) => i.key === `claim:${claim}`)).toMatchObject({ kind: 'claim_returned' });
    await http().post(`/api/projects/${f.B.id}/claims/${claim}/submit`).set(auth(f.tokens.fin)).send({}).expect(201);
    const decided = (await http().post(`/api/projects/${f.B.id}/claims/${claim}/decision`).set(admin).send({ decision: 'decided' }).expect(201)).body;
    expect((await work(f.tokens.fin)).items.find((i) => i.key === `claim:${claim}`)).toMatchObject({ kind: 'claim_unpaid', urgency: 'info' });
    await http().post(`/api/projects/${f.B.id}/claims/${claim}/payment`).set(admin).send({ paidAmount: decided.approved, paidAt: '2027-07-15' }).expect(201);
    const finNotes = (await notes(f.tokens.fin)).items;
    expect(finNotes.map((n) => n.kind)).toEqual(['claim_paid', 'claim_decided', 'claim_returned', 'project_manager']);
    expect(finNotes[2]).toMatchObject({ detail: 'Razlog: Nedostaje potpis na računu', link: `projekti/${f.B.id}/zns` });
    expect(finNotes[1].title).toMatch(/^ZNS za RP2 je odobren/);
    expect(JSON.stringify(finNotes)).not.toMatch(/EUR|€|300|30\.000|30 000/);
    // Uvoz iz Excela (administrator) → voditelj projekta; poništavanje → voditelj (autor je akter).
    const tpl = await http().get(`/api/projects/${f.A.id}/import/template`).set(admin).buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); }).expect(200);
    const wb = readXlsx(tpl.body as Buffer, () => true);
    const heads = wb.sheets.find((s) => s.name === 'Prekretnice')!.rows[0]!.cells.map((c) => (c && c.t === 's' ? c.v : '')) as string[];
    const row = heads.map((h) => (h.startsWith('Naziv') ? 'Uvezena prekretnica' : h.startsWith('Mjesec') ? 9 : null)) as Cell[];
    const file = await buildXlsx({ sheets: [{ name: 'Prekretnice', rows: [heads, row] }] });
    const plan = (await http().post(`/api/projects/${f.A.id}/import/preview`).set(admin).attach('file', file, 'uvoz.xlsx').expect(201)).body;
    expect(plan.errors).toBe(0);
    const applied = (await http().post(`/api/projects/${f.A.id}/import/confirm`).set(admin).field({ sha256: plan.sha256, revision: String(plan.projectRevision), fingerprint: plan.fingerprint, acknowledgeWarnings: 'true' }).attach('file', file, 'uvoz.xlsx').expect(201)).body;
    await http().post(`/api/projects/${f.A.id}/imports/${applied.importId}/undo`).set(admin).expect(201);
    expect((await notes(f.tokens.pm)).items.slice(0, 2).map((n) => n.kind)).toEqual(['import_undone', 'import_applied']);
    // Akter nikad ne dobiva obavijest o vlastitoj radnji.
    expect((await notes(f.tokens.admin)).items).toEqual([]);
  }, 60_000);

  it('obavijesti čita samo primatelj: drugi korisnik istog stanara i korisnik drugog stanara ne dobivaju ništa', async () => {
    const tmItems = (await notes(f.tokens.tm)).items;
    const id = tmItems[0]!.id as number;
    expect(((await notes(f.tokens.rdr)).items.map((n) => n.id))).not.toContain(id);
    await http().post(`/api/me/notifications/${id}/read`).set(auth(f.tokens.rdr)).expect(404);
    const other = `mwo-${tag}`;
    await seedDemo({ url: ADMIN_URL, tenantSlug: other, adminEmail: `a@${other}.hr`, adminPassword: 'Lozinka-123456' });
    const ot = (await http().post('/api/auth/login').send({ tenantSlug: other, email: `a@${other}.hr`, password: 'Lozinka-123456' }).expect(201)).body.accessToken;
    expect(await notes(ot)).toEqual({ items: [], unread: 0, next: null });
    await http().post(`/api/me/notifications/${id}/read`).set(auth(ot)).expect(404);
    await http().post('/api/me/notifications/read-all').set(auth(ot)).expect(201);
    expect((await notes(f.tokens.tm)).items.find((n) => n.id === id)!.read).toBe(false); // tuđe „pročitaj sve” ne dira tm
    await http().post('/api/me/notifications/abc/read').set(auth(f.tokens.tm)).expect(400);
  });

  it('nepročitane, označavanje, keyset paginacija i brisanje starih pročitanih', async () => {
    const all = (await notes(f.tokens.tm)).items;
    expect(all.length).toBe(3);
    expect((await notes(f.tokens.tm)).unread).toBe(3);
    expect((await http().post(`/api/me/notifications/${all[1]!.id}/read`).set(auth(f.tokens.tm)).expect(201)).body).toEqual({ ok: true, unread: 2 });
    const p1 = await notes(f.tokens.tm, '?limit=2');
    expect(p1.items.map((n) => n.id)).toEqual([all[0]!.id, all[1]!.id]); expect(p1.next).toBe(all[1]!.id);
    const p2 = await notes(f.tokens.tm, `?limit=2&before=${p1.next}`);
    expect(p2.items.map((n) => n.id)).toEqual([all[2]!.id]); expect(p2.next).toBeNull();
    expect((await http().post('/api/me/notifications/read-all').set(auth(f.tokens.tm)).expect(201)).body).toEqual({ ok: true, unread: 0 });
    // Pročitana starija od 90 dana briše se pri sljedećem čitanju; ostale ostaju.
    await pool.query(`update notifications set read_at = '2027-01-01' where id = $1`, [all[2]!.id]);
    expect((await notes(f.tokens.tm)).items.map((n) => n.id)).toEqual([all[0]!.id, all[1]!.id]);
    expect((await pool.query('select count(*)::int as n from notifications where id = $1', [all[2]!.id])).rows[0].n).toBe(0);
  });

  // ---------------- kalendar ----------------

  it('kalendar: valjan token → iCalendar s rokovima vlastitih projekata; stabilni UID-ovi; bez iznosa; no-store', async () => {
    expect((await http().get('/api/me/calendar').set(auth(f.tokens.pm)).expect(200)).body).toMatchObject({ active: false });
    const gen = (await http().post('/api/me/calendar').set(auth(f.tokens.pm)).expect(201)).body;
    expect(gen.token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(gen.path).toBe(`/api/calendar/${gen.token}.ics`);
    expect((await pool.query('select token_hash from calendar_tokens where user_id = $1', [f.users.pm])).rows[0].token_hash).not.toContain(gen.token);
    const get = () => http().get(gen.path).expect(200);
    const r1 = await get(); const r2 = await get();
    expect(r1.headers['content-type']).toMatch(/^text\/calendar; charset=utf-8/);
    expect(r1.headers['cache-control']).toBe('no-store, private');
    const { events } = parseIcs(r1.text);
    const uids = events.map((e) => e.UID).sort();
    expect(parseIcs(r2.text).events.map((e) => e.UID).sort()).toEqual(uids);
    expect(uids).toContain(`deliverable-${f.A.deliverable}@arqus-projekti`);
    expect(uids).toContain(`milestone-${f.A.milestone}@arqus-projekti`);
    // 4 razdoblja × (kraj, rok ZNS-a) na A; ostalo su tri dodatna projekta kojima je voditelj (test broja upita).
    expect(events.filter((e) => e.UID!.startsWith('rp-') && e.SUMMARY!.startsWith(`[PA${f.slug.slice(-4)}]`))).toHaveLength(8);
    expect(uids.filter((u) => u.startsWith('rp-'))).toHaveLength(32);
    const d = events.find((e) => e.UID === `deliverable-${f.A.deliverable}@arqus-projekti`)!;
    expect(d).toMatchObject({ 'DTSTART;VALUE=DATE': '20270630', 'DTEND;VALUE=DATE': '20270701', SUMMARY: `[PA${f.slug.slice(-4)}] D1.1 Izvještaj` });
    expect(d.DTSTAMP).toMatch(/^\d{8}T\d{6}Z$/);
    // Samo projekt A (voditelj nema pristup B), bez rokova poziva i tuđih prijava.
    expect(r1.text).not.toContain(f.B.deliverable); expect(r1.text).not.toContain(`PB${f.slug.slice(-4)}`);
    expect(uids.some((u) => u.startsWith('call-') || u.startsWith('proposal-'))).toBe(false);
    expect(r1.text).not.toMatch(/EUR|€/);
    // Voditelj prijave: vlastiti interni rok, ne tuđi; ured: pozivi i sve prijave (rok s vremenom kao UTC).
    const lead = (await http().post('/api/me/calendar').set(auth(f.tokens.lead)).expect(201)).body;
    const leadUids = parseIcs((await http().get(lead.path).expect(200)).text).events.map((e) => e.UID);
    expect(leadUids).toEqual([`proposal-${f.proposals.mine}-internal@arqus-projekti`]);
    const off = (await http().post('/api/me/calendar').set(auth(office)).expect(201)).body;
    const offEvents = parseIcs((await http().get(off.path).expect(200)).text).events;
    expect(offEvents.find((e) => e.UID === `call-${callId}-submission@arqus-projekti`)).toMatchObject({ DTSTART: '20270820T150000Z' });
    expect(offEvents.some((e) => e.UID === `proposal-${f.proposals.other}-internal@arqus-projekti`)).toBe(true);
  });

  it('kalendar: nepoznat, neispravan i opozvan token – isti odgovor; novi token poništava stari; deaktivacija gasi token', async () => {
    const answer = async (path: string) => { const r = await http().get(path); return { status: r.status, body: r.text, type: r.headers['content-type'], cache: r.headers['cache-control'] }; };
    const unknown = await answer(`/api/calendar/${randomBytes(32).toString('base64url')}.ics`);
    expect(unknown.status).toBe(404);
    for (const p of ['/api/calendar/abc.ics', `/api/calendar/${'x'.repeat(300)}`, '/api/calendar/%00%27', `/api/calendar/${randomBytes(32).toString('base64url')}`]) expect(await answer(p)).toEqual(unknown);
    const first = (await http().post('/api/me/calendar').set(auth(f.tokens.tm)).expect(201)).body;
    await http().get(first.path).expect(200);
    const second = (await http().post('/api/me/calendar').set(auth(f.tokens.tm)).expect(201)).body;
    expect(await answer(first.path)).toEqual(unknown);
    await http().get(second.path).expect(200);
    expect((await http().delete('/api/me/calendar').set(auth(f.tokens.tm)).expect(200)).body).toMatchObject({ active: false });
    expect(await answer(second.path)).toEqual(unknown);
    // Deaktiviran korisnik: token prestaje vrijediti (i briše se).
    const rdr = (await http().post('/api/me/calendar').set(auth(f.tokens.rdr)).expect(201)).body;
    await http().get(rdr.path).expect(200);
    await http().patch(`/api/users/${f.users.rdr}`).set(auth(f.tokens.admin)).send({ status: 'disabled' }).expect(200);
    expect(await answer(rdr.path)).toEqual(unknown);
    expect((await pool.query('select count(*)::int as n from calendar_tokens where user_id = $1', [f.users.rdr])).rows[0].n).toBe(0);
  });

  it('obvezni MFA (ograničeno stanje) blokira nove rute; administrator vidi račune bez MFA u „Moj rad”', async () => {
    const { rows: [t] } = await pool.query<{ id: string }>('select id from tenants where slug = $1', [f.slug]);
    const pmCal = (await http().post('/api/me/calendar').set(auth(f.tokens.pm)).expect(201)).body;
    try {
      await pool.query(`update tenants set settings = settings || '{"requireMfa":"all"}' where id = $1`, [t!.id]);
      for (const [m, p] of [['get', '/api/me/work'], ['get', '/api/me/notifications'], ['post', '/api/me/notifications/read-all'], ['post', '/api/me/notifications/1/read'], ['get', '/api/me/calendar'], ['post', '/api/me/calendar'], ['delete', '/api/me/calendar']] as const) {
        const r = await (http() as unknown as Record<string, (u: string) => request.Test>)[m]!(p).set(auth(f.tokens.tm));
        expect([p, r.status, r.body.code]).toEqual([p, 403, 'mfa_setup_required']);
      }
      await http().get('/api/me').set(auth(f.tokens.tm)).expect(200);
      expect((await http().get(pmCal.path)).status).toBe(404); // ni kalendar dok MFA nije postavljen
      // Povlaštene uloge: administrator s MFA-om vidi koliko računa nema obvezni MFA (isti izračun kao postavka u izborniku Korisnici).
      await pool.query(`update tenants set settings = settings || '{"requireMfa":"privileged"}' where id = $1`, [t!.id]);
      const adminId = (await http().get('/api/me').set(auth(f.tokens.admin))).body.user.id as string;
      await pool.query('update users set mfa_enabled = true where id = $1', [adminId]);
      const impact = (await http().get('/api/tenant/security').set(auth(f.tokens.admin)).expect(200)).body.impact.privileged.withoutMfa as number;
      expect(impact).toBeGreaterThan(0);
      expect((await work(f.tokens.admin)).items.filter((i) => i.role === 'admin')).toEqual([expect.objectContaining({ kind: 'mfa_missing', count: impact, link: 'korisnici' })]);
      await pool.query('update users set mfa_enabled = false where id = $1', [adminId]);
    } finally {
      await pool.query(`update tenants set settings = settings || '{"requireMfa":"none"}' where id = $1`, [t!.id]);
    }
    await http().get(pmCal.path).expect(200);
  });

  it('kalendar: ograničenje po IP adresi (429 nakon granice, za valjane i nevaljane tokene)', async () => {
    let limited = 0;
    for (let i = 0; i < 70 && !limited; i++) if ((await http().get(`/api/calendar/${randomBytes(32).toString('base64url')}.ics`)).status === 429) limited = i;
    expect(limited).toBeGreaterThan(0);
  });
});
