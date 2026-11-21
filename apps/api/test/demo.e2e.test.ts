import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';
import { runDemo } from '../src/demo/demo';
import { DEMO_DEFAULT_PASSWORD, DEMO_INVITED, DEMO_USERS } from '../src/demo/scenario';
import { DEMO_IMPORT_FILE, demoImportWorkbook } from '../src/demo/import-example';

const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';

type Row = Record<string, unknown> & { id: string };

describe('Demo okruženje (WP1.13)', () => {
  let app: INestApplication;
  const tag = randomUUID().slice(0, 8);
  const slug = `demo-${tag}`; const other = `nd-${tag}`;
  const pw = DEMO_DEFAULT_PASSWORD;
  const http = () => request(app.getHttpServer());
  const login = async (s: string, email: string, password: string) => (await http().post('/api/auth/login').send({ tenantSlug: s, email, password }).expect(201)).body.accessToken as string;
  let firstTenantId = ''; let otherOrg = '';
  const pool = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const tenantRows = async (tenantId: string) => {
    const { rows } = await pool.query<{ table_name: string }>(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id'`);
    let n = 0;
    for (const r of rows) n += Number((await pool.query(`select count(*)::int as n from "${r.table_name}" where tenant_id = $1`, [tenantId])).rows[0].n);
    return n;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = APP_URL;
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), 'arqus-demo-'));
    // Drugi (ne-demo) stanar s vlastitim podacima – reset ga ne smije dirati.
    await seedDemo({ url: ADMIN_URL, tenantSlug: other, adminEmail: `a@${other}.hr`, adminPassword: 'Lozinka-123456' });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    const t = await login(other, `a@${other}.hr`, 'Lozinka-123456');
    otherOrg = (await http().post('/api/organisations').set({ Authorization: `Bearer ${t}` }).send({ name: 'Tuđa organizacija', country: 'AT' }).expect(201)).body.id;
  });
  afterAll(async () => { await app.close(); await pool.end(); });

  it('puni demo instituciju kroz API: korisnici, radar, prijave, projekti, timesheetovi, troškovi, dokazi, ZNS', async () => {
    const r = await runDemo({ ownerUrl: ADMIN_URL, appUrl: APP_URL, slug, importPackages: false });
    expect(r.status).toBe('created'); firstTenantId = r.tenantId;
    expect(r.summary).toMatchObject({ projects: ['ZELENI-LAB', 'BLUESENSE', 'DIGI-ARHIV'], calls: 6 });

    // Svi demo računi mogu se prijaviti demo lozinkom.
    const tokens: Record<string, string> = {};
    for (const u of DEMO_USERS) tokens[u.key] = await login(slug, `${u.local}@${slug}.local`, pw);
    const as = (k: string) => ({ Authorization: `Bearer ${tokens[k]}` });
    const users = (await http().get('/api/users').set(as('admin')).expect(200)).body as { email: string; roles: string[]; projectRoles: { code: string; acronym: string }[] }[];
    // WP1.14: uloge institucije samo za administratora, ured, financije i upravu; voditelji i član tima imaju ulogu na projektu.
    expect(new Set(users.flatMap((u) => u.roles))).toEqual(new Set(['tenant-admin', 'project-office', 'finance', 'reader']));
    const scoped = (local: string) => users.find((u) => u.email === `${local}@${slug}.local`)!;
    expect(scoped('voditelj').roles).toEqual([]); expect(scoped('voditelj').projectRoles.map((r) => `${r.code}@${r.acronym}`)).toEqual(['project-manager@BLUESENSE']);
    expect(scoped('voditelj2').projectRoles.map((r) => `${r.code}@${r.acronym}`)).toEqual(['project-manager@ZELENI-LAB']);
    expect(scoped('clan').projectRoles.map((r) => `${r.code}@${r.acronym}`)).toEqual(['team-member@BLUESENSE']);
    // WP1.21: računi su nastali kroz pozivnice (prihvaćene s demo lozinkom); jedan račun ostaje pozvan i ne može se prijaviti.
    const invited = users.find((u) => u.email === `${DEMO_INVITED.local}@${slug}.local`) as unknown as { status: string; invitation: { delivery: string } | null };
    expect(invited.status).toBe('invited'); expect(invited.invitation?.delivery).toBe('link');
    await http().post('/api/auth/login').send({ tenantSlug: slug, email: `${DEMO_INVITED.local}@${slug}.local`, password: pw }).expect(401);
    const accepted = (await http().get('/api/audit?action=invite.accept&limit=50').set(as('admin')).expect(200)).body as unknown[];
    expect(accepted).toHaveLength(DEMO_USERS.length - 1);

    // Organizacije: vlastita + 6 partnera iz različitih država.
    const orgs = (await http().get('/api/organisations').set(as('office')).expect(200)).body as { country: string; isSelf: boolean; name: string }[];
    expect(orgs.find((o) => o.isSelf)?.name).toBe('Pokazno sveučilište');
    expect(new Set(orgs.map((o) => o.country)).size).toBeGreaterThanOrEqual(5);

    // Radar: odluke go / pratimo / no-go i nadolazeći rokovi.
    const calls = (await http().get('/api/calls?mine=true').set(as('office')).expect(200)).body as { tracking: { decision: string; fitTotal: number | null } | null }[];
    expect(new Set(calls.map((c) => c.tracking?.decision).filter(Boolean))).toEqual(new Set(['go', 'watch', 'no_go']));
    const deadlines = (await http().get('/api/calls/deadlines').set(as('office')).expect(200)).body as { kind: string }[];
    expect(deadlines.length).toBeGreaterThanOrEqual(4);
    expect(deadlines.some((d) => d.kind === 'internal')).toBe(true);

    // Prijave: jedna ugovorena u projekt, jedna u pripremi s otvorenim stavkama spremnosti.
    const proposals = (await http().get('/api/proposals').set(as('office')).expect(200)).body as Row[];
    const contracted = proposals.find((p) => p.status === 'contracted')!;
    expect(contracted.projectId).toBeTruthy();
    const prep = (await http().get(`/api/proposals/${proposals.find((p) => p.status === 'preparation')!.id}`).set(as('office')).expect(200)).body;
    expect(prep.ready).toBe(false);
    expect(prep.readiness.filter((i: { ok: boolean }) => !i.ok).map((i: { key: string }) => i.key).sort()).toEqual(['budget_locked', 'confirmed']);
    expect(prep.members.length).toBeGreaterThanOrEqual(4); expect(prep.workPackages.length).toBeGreaterThan(0); expect(prep.budget.totals.total).toBeGreaterThan(0);

    const projects = (await http().get('/api/projects').set(as('office')).expect(200)).body as Row[];
    expect(projects.map((p) => p.status)).toEqual(['active', 'active', 'active']);
    const he = projects.find((p) => p.acronym === 'BLUESENSE')!; const npoo = projects.find((p) => p.acronym === 'ZELENI-LAB')!;
    expect(npoo.id).toBe(contracted.projectId);

    // HE: partneri, struktura, zaključan proračun, tim, timesheetovi (jedan čeka odobrenje), troškovi s dokazima i jedan bez.
    const heDetail = (await http().get(`/api/projects/${he.id}`).set(as('office')).expect(200)).body;
    expect(heDetail.partners).toHaveLength(5);
    const st = (await http().get(`/api/projects/${he.id}/structure`).set(as('pm')).expect(200)).body;
    expect(st.workPackages).toHaveLength(5);
    expect(st.workPackages.flatMap((w: { tasks: unknown[] }) => w.tasks).length).toBeGreaterThan(5);
    expect(st.workPackages.flatMap((w: { deliverables: { status: string }[] }) => w.deliverables).some((d: { status: string }) => d.status === 'accepted')).toBe(true);
    expect(st.milestones.length).toBeGreaterThan(0); expect(st.risks.length).toBeGreaterThan(0);
    expect((await http().get(`/api/projects/${he.id}/budget`).set(as('office')).expect(200)).body.status).toBe('locked');
    const team = (await http().get(`/api/projects/${he.id}/team`).set(as('finance')).expect(200)).body as { id: string; fullName: string; annualCost: number }[];
    expect(team).toHaveLength(4); expect(team.every((t) => t.annualCost > 0)).toBe(true);
    const luka = team.find((t) => t.fullName === 'Luka Novak')!;
    const { rows: tsRows } = await pool.query<{ status: string; n: number }>(`select status, count(*)::int as n from timesheets where project_id = $1 group by status`, [he.id]);
    const ts = Object.fromEntries(tsRows.map((x) => [x.status, x.n]));
    expect(ts.submitted).toBe(1); expect(ts.approved).toBeGreaterThanOrEqual(20);
    const submittedMonth = (await pool.query<{ month: string }>(`select month from timesheets where project_id = $1 and status = 'submitted'`, [he.id])).rows[0]!.month;
    expect((await http().get(`/api/projects/${he.id}/team/${luka.id}/timesheets/${submittedMonth}`).set(as('member')).expect(200)).body.status).toBe('submitted');
    const heExp = (await http().get(`/api/projects/${he.id}/expenses`).set(as('finance')).expect(200)).body as { source: string; documents: number }[];
    const manual = heExp.filter((e) => e.source === 'manual');
    expect(manual.filter((e) => e.documents > 0).length).toBeGreaterThanOrEqual(3);
    expect(manual.filter((e) => e.documents === 0)).toHaveLength(1);
    expect(heExp.some((e) => e.source === 'timesheet')).toBe(true);

    // NPOO: razdoblja od 6 mjeseci (paket po pozivu), ZNS 1 predan → odluka → isplata, ZNS 2 nacrt s upozorenjem o dokazu.
    const nDetail = (await http().get(`/api/projects/${npoo.id}`).set(as('office')).expect(200)).body;
    const rp1 = nDetail.reportingPeriods[0];
    expect(Number(rp1.endDate.slice(5, 7)) - Number(rp1.startDate.slice(5, 7)) + (rp1.endDate.slice(0, 4) === rp1.startDate.slice(0, 4) ? 0 : 12)).toBe(5);
    expect(rp1.endDate < new Date().toISOString().slice(0, 10)).toBe(true);
    const claims = (await http().get(`/api/projects/${npoo.id}/claims`).set(as('finance')).expect(200)).body as Row[];
    expect(claims.map((c) => c.status)).toEqual(['partially_approved', 'draft']);
    expect(claims[0]!.submittedAt).toBeTruthy(); expect(claims[0]!.paid).toBe(claims[0]!.approved); expect(claims[0]!.missingEvidence).toBe(0);
    expect(claims[1]!.missingEvidence).toBe(1);
    // WP1.16a: odluka po trošku – jedan umanjen, jedan odbijen, s razlozima; priznato < zatraženo; isplaćen priznati iznos.
    type DemoExp = { status: string; amount: number; recognised: number | null; decisionReason: string | null };
    const c1 = claims[0] as unknown as { expenses: DemoExp[]; requested: number; approved: number; recognised: { requested: number }; unrecognised: { total: number }; decisionDate: string };
    expect(c1.expenses.filter((e) => e.status === 'partially_accepted')).toEqual([expect.objectContaining({ amount: 1_180_000, recognised: 1_050_000, decisionReason: expect.stringMatching(/ugovora/) })]);
    expect(c1.expenses.filter((e) => e.status === 'rejected')).toEqual([expect.objectContaining({ amount: 86_500, recognised: 0, decisionReason: expect.stringMatching(/izvješće/) })]);
    expect(c1.approved).toBe(c1.recognised.requested); expect(c1.approved).toBeLessThan(c1.requested);
    expect(c1.requested - c1.approved).toBe(216_500); expect(c1.unrecognised.total).toBe(216_500);
    // ZNS 2 (razdoblje završilo) u nacrtu: stvarne otvorene stavke – timesheet čeka odobrenje, trošak bez dokaza.
    const c2 = claims[1] as unknown as { checklist: { canSubmit: boolean; blocking: { key: string; details: string[] }[] } };
    expect(c2.checklist.canSubmit).toBe(false);
    expect(c2.checklist.blocking.map((b) => b.key)).toEqual(['timesheets_approved', 'evidence']);
    // WP1.18: i Marinin timesheet za isti mjesec (unio ga je ured) čeka odobrenje voditelja Josipa.
    expect(c2.checklist.blocking[0]!.details).toEqual([expect.stringMatching(/^Josip Barić, \d{4}-\d{2} \(čeka odobrenje/), expect.stringMatching(/^Marina Šimić, \d{4}-\d{2} \(čeka odobrenje/)]);
    expect((await http().get(`/api/documents?projectId=${npoo.id}`).set(as('office')).expect(200)).body.length).toBeGreaterThanOrEqual(6);
    // WP1.16b: kasno evidentiran račun za RP1 – nacrt ZNS-a 2 ga nudi (nije uključen dok ga priprematelj ne odabere); sati pripreme ZNS-a 1.
    const c2b = claims[1] as unknown as { earlierCandidates: { description: string; period: number; selected: boolean }[]; expenses: { description: string }[] };
    expect(c2b.earlierCandidates).toEqual([expect.objectContaining({ description: 'Najam termovizijske kamere za pilot-mjerenje', period: 1, selected: false })]);
    expect(c2b.expenses.some((e) => e.description.startsWith('Najam termovizijske'))).toBe(false);
    expect((claims[0] as unknown as { preparation: { hours: number; measures: { returns: number; expenses: number } } }).preparation).toMatchObject({ hours: 18, measures: { returns: 0 } });
    // Paket za predaju ZNS-a 1: ZIP s radnom knjigom, evidencijama rada i dokazima.
    const pkgRes = await http().get(`/api/projects/${npoo.id}/claims/${claims[0]!.id}/export`).set(as('finance')).buffer(true)
      .parse((res, cb) => { const parts: Buffer[] = []; res.on('data', (c: Buffer) => parts.push(c)); res.on('end', () => cb(null, Buffer.concat(parts))); }).expect(200);
    expect(String(pkgRes.headers['content-disposition'])).toMatch(/ZNS_ZELENI-LAB_RP1_\d{4}-\d{2}-\d{2}\.zip/);
    expect((pkgRes.body as Buffer).subarray(0, 2).toString()).toBe('PK');

    // WP1.14: voditelj vidi samo svoj projekt; tuđi projekt je 404; član tima ne vidi plaće ni povjerljive dokumente.
    expect(((await http().get('/api/projects').set(as('pm')).expect(200)).body as Row[]).map((p) => p.acronym)).toEqual(['BLUESENSE']);
    expect(((await http().get('/api/projects').set(as('pm2')).expect(200)).body as Row[]).map((p) => p.acronym)).toEqual(['ZELENI-LAB']);
    expect(((await http().get('/api/projects').set(as('member')).expect(200)).body as Row[]).map((p) => p.acronym)).toEqual(['BLUESENSE']);
    await http().get(`/api/projects/${npoo.id}`).set(as('pm')).expect(404);
    await http().get(`/api/projects/${he.id}/team`).set(as('pm2')).expect(404);
    const confidentialTitle = 'Odluka o plaćama projektnog tima';
    const heDocs = (as2: string) => http().get(`/api/documents?projectId=${he.id}`).set(as(as2)).expect(200).then((r) => (r.body as { title: string }[]).map((d) => d.title));
    expect(await heDocs('pm')).toContain(confidentialTitle); expect(await heDocs('finance')).toContain(confidentialTitle);
    expect(await heDocs('member')).not.toContain(confidentialTitle);
    expect(((await http().get(`/api/projects/${he.id}/team`).set(as('member')).expect(200)).body as { annualCost: number | null }[]).every((t) => t.annualCost === null)).toBe(true);

    // WP1.19: troškovi osoblja – voditeljica (bez personnel:read) i uprava vide sate, ne iznose; financije i ured vide sve.
    // Demo institucija ne traži MFA (frictionless demonstracija).
    const heExpenses = (who: string) => http().get(`/api/projects/${he.id}/expenses`).set(as(who)).expect(200).then((r) => (r.body as { source: string; amount: number | null; amountHidden: boolean }[]).filter((e) => e.source === 'timesheet'));
    for (const who of ['pm', 'board']) { const rows = await heExpenses(who); expect(rows.length).toBeGreaterThan(0); expect(rows.every((e) => e.amount === null && e.amountHidden)).toBe(true); }
    for (const who of ['finance', 'office']) expect((await heExpenses(who)).every((e) => typeof e.amount === 'number' && !e.amountHidden)).toBe(true);
    expect((await http().get('/api/me').set(as('office')).expect(200)).body.mfa).toMatchObject({ policy: 'none', setupRequired: false });

    // WP1.15 portfelj (uprava): svaki signal ima primjer u demo podacima.
    const pf = (await http().get('/api/portfolio').set(as('board')).expect(200)).body;
    const row = (acr: string) => pf.projects.find((x: Row) => x.acronym === acr);
    expect(pf.access.full).toBe(true);
    expect(row('ZELENI-LAB').budget.signal).toBe('lagging'); // oprema još nije nabavljena
    expect(row('BLUESENSE').budget.signal).toBe('ok');
    expect(row('BLUESENSE').attention).toMatchObject({ timesheetsToApprove: 1, expensesWithoutEvidence: 1 });
    expect(row('BLUESENSE').attention.lateDeliverables).toBeGreaterThanOrEqual(1);
    expect(row('ZELENI-LAB').attention).toMatchObject({ lateDeliverables: 1, unclaimedPeriods: 1, expensesWithoutEvidence: 1, strandedExpenses: 1 });
    expect(row('BLUESENSE').attention.strandedExpenses).toBe(0);
    // WP1.16b: „Ušteda na ZNS-u” – polazna mjera 30 h, ZNS 1 pripremljen za 18 h → 40 %.
    const savings = (await http().get('/api/portfolio/claim-savings').set(as('board')).expect(200)).body;
    expect(savings).toMatchObject({ status: 'ok', baselineHours: 30, reportedClaims: 1, submittedClaims: 1, averageHours: 18, savingPercent: 40, meetsTarget: true, canEditBaseline: false });
    expect(row('ZELENI-LAB').attention.highRisks + row('BLUESENSE').attention.highRisks).toBeGreaterThanOrEqual(2);
    const marina = pf.people.persons.find((x: Row) => x.name === 'Marina Šimić');
    expect(marina.projects).toHaveLength(2);
    expect(marina.overDays).toEqual([expect.objectContaining({ minutes: 600, projects: 2 })]);
    expect(pf.people.persons.filter((x: Row) => (x.overDays as unknown[]).length)).toHaveLength(1);
    expect(pf.summary.successRate).toEqual({ funded: 1, rejected: 1, percent: 50 });
    expect(pf.summary.overdue).toBeGreaterThanOrEqual(2);
    expect(pf.deadlines.some((d: Row) => d.kind === 'claim_due' && !d.overdue)).toBe(true);
    // Voditeljica BLUESENSE vidi samo svoj projekt, bez ljudi; od prijava samo vlastitu (WP1.14b: voditeljica je prijave AQUAREST).
    const pmPf = (await http().get('/api/portfolio').set(as('pm')).expect(200)).body;
    expect(pmPf.projects.map((x: Row) => x.acronym)).toEqual(['BLUESENSE']); expect(pmPf.people).toBeNull();
    expect(pmPf.pipeline.proposals.map((x: Row) => x.acronym)).toEqual(['AQUAREST']);

    // WP1.14b: voditeljica prijave bez uloge institucije otvara i priprema vlastitu prijavu; tuđa prijava je 404.
    const pmProposals = (await http().get('/api/proposals').set(as('pm')).expect(200)).body as Row[];
    expect(pmProposals.map((p) => p.acronym)).toEqual(['AQUAREST']);
    expect((await http().get(`/api/proposals/${pmProposals[0]!.id}`).set(as('pm')).expect(200)).body.budget.totals.total).toBeGreaterThan(0);
    await http().get(`/api/proposals/${contracted.id}`).set(as('pm')).expect(404);
    await http().get('/api/proposals').set(as('member')).expect(403);
    // WP1.14b – četiri oka: nijedan odobren timesheet nije odobrila osoba koja ga je predala.
    const { rows: [self4] } = await pool.query<{ n: number }>(`select count(*)::int as n from timesheets t join projects p on p.id = t.project_id where p.tenant_id = $1 and t.approved_by is not null and (t.submitted_by is null or t.submitted_by = t.approved_by)`, [firstTenantId]);
    expect(self4!.n).toBe(0);
    // WP1.14b – odstupanja od pravila programa: namjerni primjer na NPOO projektu (RRF – završetak nakon 30. 6. 2026.), ostalo bez odstupanja.
    expect(nDetail.deviations.map((d: { key: string }) => d.key)).toEqual(['rule:npoo-end-date']);
    expect(heDetail.deviations).toEqual([]);
    expect(prep.deviations).toEqual([]);
    // WP1.18 – „Moj rad”: svaki demo račun ima smislen popis (bez iznosa), uprava i administrator nemaju ništa alarmantno.
    type W = { items: { kind: string; title: string; detail?: string; acronym?: string; urgency: string }[]; summary: { attention: number } };
    const mw = async (k: string) => (await http().get('/api/me/work').set(as(k)).expect(200)).body as W;
    const kinds = (w: W) => w.items.map((i) => i.kind);
    const memberW = await mw('member');
    expect(kinds(memberW)).toEqual(expect.arrayContaining(['timesheet_current', 'timesheet_submitted', 'risk_owned']));
    expect(memberW.items.every((i) => i.acronym === 'BLUESENSE')).toBe(true);
    // WP1.22: Luka je odgovorna osoba za isporuku tekućeg mjeseca (uskoro); voditeljica vidi isporuku koja kasni i tko je drži.
    expect(memberW.items.filter((i) => i.kind === 'deliverable_responsible').map((i) => `${i.title}|${i.urgency}`)).toEqual([expect.stringMatching(/Izvještaj o laboratorijskom testiranju prototipa\|due_soon$/)]);
    const pmW = await mw('pm');
    expect(pmW.items.find((i) => i.kind === 'deliverable_due' && /Arhitektura podatkovne platforme/.test(i.title))).toMatchObject({ urgency: 'overdue', detail: expect.stringMatching(/odgovorna osoba: Ivana Marić \(bez korisničkog računa\)$/) });
    expect(pmW.items.find((i) => i.kind === 'deliverable_due' && /laboratorijskom testiranju/.test(i.title))!.detail).toMatch(/odgovorna osoba: Luka Novak$/);
    expect(kinds(pmW)).toEqual(expect.arrayContaining(['timesheet_to_approve', 'deliverable_due', 'risks_high', 'proposal_deadline', 'expenses_without_evidence', 'risk_owned']));
    expect(pmW.items.filter((i) => i.kind === 'timesheet_to_approve').map((i) => i.title)).toEqual([expect.stringMatching(/^Odobri timesheet: Luka Novak/)]);
    expect(pmW.items.some((i) => i.acronym === 'ZELENI-LAB')).toBe(false);
    const pm2W = await mw('pm2');
    expect(kinds(pm2W)).toEqual(expect.arrayContaining(['timesheet_to_approve', 'deliverable_due', 'milestone_due', 'deviations', 'claim_draft', 'expenses_without_evidence', 'expenses_stranded', 'timesheet_submitted']));
    expect(pm2W.items.filter((i) => i.kind === 'timesheet_to_approve').map((i) => i.title)).toEqual([expect.stringMatching(/^Odobri timesheet: Marina Šimić/)]); // ne vlastiti
    expect(pm2W.items.find((i) => i.kind === 'claim_draft')!.detail).toMatch(/2 stavke blokiraju predaju/);
    const finW = await mw('finance');
    expect(kinds(finW)).toEqual(expect.arrayContaining(['claim_draft', 'expenses_without_evidence', 'expenses_stranded']));
    const officeW = await mw('office');
    expect(kinds(officeW).sort()).toEqual(['call_decision', 'proposal_deadline', 'risk_owned']); // ured je i nositeljica jednog rizika BLUESENSE
    expect(officeW.items.find((i) => i.kind === 'proposal_deadline')!.detail).toMatch(/2 stavke spremnosti nisu ispunjene/);
    expect((await mw('board')).items).toEqual([]);
    // WP1.24: administrator u „Moj rad” vidi otvoren zahtjev ispitanika kojem rok uskoro istječe – bez imena podnositelja.
    const adminW = await mw('admin');
    expect(adminW.items).toEqual([expect.objectContaining({ kind: 'subject_request', role: 'admin', urgency: 'due_soon', link: 'osobni-podaci/zahtjevi', title: 'Zahtjev ispitanika ZI-1: pristup podacima (čl. 15)' })]);
    expect(JSON.stringify(adminW)).not.toMatch(/Babić/);
    const reqs = (await http().get('/api/privacy/requests').set(as('admin')).expect(200)).body as { items: Row[]; summary: Row };
    expect(reqs.summary).toMatchObject({ open: 1, overdue: 0, dueSoon: 1, closed: 1, closedLate: 0 });
    expect(reqs.items.map((r) => `${r.ref}|${r.state}`)).toEqual(['ZI-1|due_soon', 'ZI-2|closed']);
    for (const k of ['member', 'pm', 'pm2', 'finance', 'office']) expect(JSON.stringify(await mw(k))).not.toMatch(/EUR|€/);
    // WP1.18 – obavijesti iz stvarnih tokova seedera; nepročitane su najnovije tri.
    type N = { items: { kind: string; read: boolean }[]; unread: number };
    const nt = async (k: string) => (await http().get('/api/me/notifications?limit=100').set(as(k)).expect(200)).body as N;
    const memberN = await nt('member');
    expect(new Set(memberN.items.map((n) => n.kind))).toEqual(new Set(['timesheet_approved', 'access_granted', 'responsible_assigned'])); // WP1.22: isporuka i zadatak
    expect(memberN.unread).toBe(3);
    expect((await nt('pm')).items.map((n) => n.kind)).toEqual(expect.arrayContaining(['project_manager', 'proposal_lead', 'timesheet_approved']));
    expect((await nt('pm2')).items.map((n) => n.kind)).toEqual(expect.arrayContaining(['project_manager', 'proposal_lead', 'timesheet_approved']));
    expect((await nt('finance')).items.map((n) => n.kind).sort()).toEqual(['claim_decided', 'claim_paid']);
    for (const k of ['admin', 'office', 'board']) expect((await nt(k)).items).toEqual([]);
    // WP1.23: istraživačica koja odlazi (Lea Babić) – administrator vidi njezin račun i zapis člana tima u „Osobni podaci”;
    // zaslon „Rokovi čuvanja” ima stvarne brojeve: zakazano izvođenje je uklonilo odjavljene sesije iz punjenja, probno je zapisano.
    const leaver = (await http().post('/api/privacy/subject').set(as('admin')).send({ userId: users.find((u) => u.email === `istrazivacica@${slug}.local`)!.id }).expect(201)).body;
    expect(leaver.members.map((m: Row) => m.project)).toEqual(['ZELENI-LAB']);
    expect(leaver.counts.timesheets).toBe(3); expect(leaver.counts.personnelCosts).toBeGreaterThan(0);
    const ret = (await http().get('/api/privacy/retention').set(as('admin')).expect(200)).body;
    expect(ret.lastRun).toMatchObject({ mode: 'scheduled', outcome: 'done' });
    expect(ret.lastRun.result.categories.find((c: Row) => c.key === 'sessions').removed).toBeGreaterThan(0);
    expect(ret.lastDryRun).toMatchObject({ mode: 'dry', outcome: 'done' });
    expect(ret.categories.find((c: Row) => c.key === 'audit').held).toBeGreaterThan(100);

    // WP1.14b – revizija: povijest odluka i promjena; promjena plaće s iznosom vidljiva administratoru.
    const audit = (await http().get('/api/audit?entity=team_member&action=update').set(as('admin')).expect(200)).body as { diff: { after: { annualCostCents?: unknown } } }[];
    expect(audit[0]!.diff.after.annualCostCents).toBe(4_680_000);
    expect(((await http().get('/api/audit/facets').set(as('office')).expect(200)).body.entities as string[])).toEqual(expect.arrayContaining(['proposal', 'timesheet', 'claim', 'project', 'call_tracking']));
  }, 120_000);

  it('drugo pokretanje ne mijenja ništa (idempotentno)', async () => {
    const before = await tenantRows(firstTenantId);
    const r = await runDemo({ ownerUrl: ADMIN_URL, appUrl: APP_URL, slug, importPackages: false });
    expect(r).toMatchObject({ status: 'exists', tenantId: firstTenantId });
    expect(await tenantRows(firstTenantId)).toBe(before);
  }, 60_000);

  it('reset briše i ponovno stvara samo demo stanara; drugi stanar ostaje netaknut; ne-demo stanar se odbija', async () => {
    const { rows: [otherTenant] } = await pool.query<{ id: string }>('select id from tenants where slug = $1', [other]);
    const otherBefore = await tenantRows(otherTenant!.id);
    const { rows: [{ n: globalCalls }] } = await pool.query<{ n: number }>('select count(*)::int as n from calls where tenant_id is null');
    expect(existsSync(join(process.env.DOCUMENTS_DIR!, firstTenantId))).toBe(true);

    const r = await runDemo({ ownerUrl: ADMIN_URL, appUrl: APP_URL, slug, reset: true, importPackages: false });
    expect(r.status).toBe('created'); expect(r.tenantId).not.toBe(firstTenantId);
    expect(await tenantRows(firstTenantId)).toBe(0);
    expect(existsSync(join(process.env.DOCUMENTS_DIR!, firstTenantId))).toBe(false);
    expect(readdirSync(join(process.env.DOCUMENTS_DIR!, r.tenantId)).length).toBeGreaterThan(0);
    expect(await tenantRows(otherTenant!.id)).toBe(otherBefore);
    expect((await pool.query('select count(*)::int as n from calls where tenant_id is null')).rows[0].n).toBe(globalCalls);
    const t = await login(other, `a@${other}.hr`, 'Lozinka-123456');
    await http().get(`/api/organisations/${otherOrg}`).set({ Authorization: `Bearer ${t}` }).expect(200);

    const afterLogin = await tenantRows(otherTenant!.id); // prijava dodaje sesiju i revizijski zapis
    await expect(runDemo({ ownerUrl: ADMIN_URL, appUrl: APP_URL, slug: other, reset: true, importPackages: false })).rejects.toThrow(/NIJE demo stanar/);
    expect(await tenantRows(otherTenant!.id)).toBe(afterLogin);
  }, 120_000);

  it('WP1.17: primjer radne knjige u docs/primjeri je aktualan i uvozi se u DIGI-ARHIV (pregled + potvrda) za nekoliko sekundi', async () => {
    const committed = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'primjeri', DEMO_IMPORT_FILE));
    expect(committed.equals(await demoImportWorkbook()), 'docs/primjeri nije aktualan – pokreni pnpm --filter @arqus/api demo:import-example').toBe(true);
    const office = await login(slug, `ured@${slug}.local`, pw);
    const as = { Authorization: `Bearer ${office}` };
    const digi = ((await http().get('/api/projects').set(as).expect(200)).body as Row[]).find((p) => p.acronym === 'DIGI-ARHIV')!;
    expect((await http().get(`/api/projects/${digi.id}/structure`).set(as).expect(200)).body.workPackages).toEqual([]);
    expect((await http().get(`/api/projects/${digi.id}/imports`).set(as).expect(200)).body).toEqual([]);
    const started = Date.now();
    const plan = (await http().post(`/api/projects/${digi.id}/import/preview`).set(as).attach('file', committed, DEMO_IMPORT_FILE).expect(201)).body;
    expect(plan.errors).toBe(0);
    expect(plan.warnings).toBe(0);
    expect(Object.fromEntries(plan.sheets.map((s: { key: string; created: number }) => [s.key, s.created]))).toEqual({ workPackages: 3, deliverables: 2, milestones: 1, budget: 7, team: 3, expenses: 19 });
    await http().post(`/api/projects/${digi.id}/import/confirm`).set(as).field({ sha256: plan.sha256, revision: String(plan.projectRevision), fingerprint: plan.fingerprint }).attach('file', committed, DEMO_IMPORT_FILE).expect(201);
    const ms = Date.now() - started;
    expect(ms).toBeLessThan(10_000);
    console.warn(`WP1.17 demo: pregled i potvrda uvoza ${DEMO_IMPORT_FILE} – ${ms} ms`);
    const fin = (await http().get(`/api/projects/${digi.id}/finance`).set(as).expect(200)).body;
    // Ostvareno: RP1 potraživano izvan sustava (osoblje 13.380 EUR, usluga priznata 11.900, oprema 18.600, put 640,50, promidžba 1.150) + RP2 (6.200 + 210,40 + 480).
    expect(fin.byCategory.find((c: { code: string }) => c.code === 'VU')).toMatchObject({ actual: 1_810_000, unrecognised: 50_000 });
    expect(fin.byCategory.find((c: { code: string }) => c.code === 'OS').actual).toBe(1_338_000);
    expect(fin.planned.total).toBeGreaterThan(fin.actual.total);
    const pf = (await http().get('/api/portfolio').set(as).expect(200)).body;
    const row = pf.projects.find((x: Row) => x.acronym === 'DIGI-ARHIV');
    expect(row.budget.projectActual).toBe(fin.actual.total);
    expect(row.attention).toMatchObject({ unclaimedPeriods: 0, expensesWithoutEvidence: 3, strandedExpenses: 0 });
  }, 60_000);
});
