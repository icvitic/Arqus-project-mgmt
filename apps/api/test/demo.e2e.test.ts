import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';
import { runDemo } from '../src/demo/demo';
import { DEMO_DEFAULT_PASSWORD, DEMO_USERS } from '../src/demo/scenario';

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
    expect(r.summary).toMatchObject({ projects: ['ZELENI-LAB', 'BLUESENSE'], calls: 6 });

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
    expect(projects.map((p) => p.status)).toEqual(['active', 'active']);
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
    expect((await http().get(`/api/documents?projectId=${npoo.id}`).set(as('office')).expect(200)).body.length).toBeGreaterThanOrEqual(6);

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

    // WP1.15 portfelj (uprava): svaki signal ima primjer u demo podacima.
    const pf = (await http().get('/api/portfolio').set(as('board')).expect(200)).body;
    const row = (acr: string) => pf.projects.find((x: Row) => x.acronym === acr);
    expect(pf.access.full).toBe(true);
    expect(row('ZELENI-LAB').budget.signal).toBe('lagging'); // oprema još nije nabavljena
    expect(row('BLUESENSE').budget.signal).toBe('ok');
    expect(row('BLUESENSE').attention).toMatchObject({ timesheetsToApprove: 1, expensesWithoutEvidence: 1 });
    expect(row('BLUESENSE').attention.lateDeliverables).toBeGreaterThanOrEqual(1);
    expect(row('ZELENI-LAB').attention).toMatchObject({ lateDeliverables: 1, unclaimedPeriods: 1, expensesWithoutEvidence: 1 });
    expect(row('ZELENI-LAB').attention.highRisks + row('BLUESENSE').attention.highRisks).toBeGreaterThanOrEqual(2);
    const marina = pf.people.persons.find((x: Row) => x.name === 'Marina Šimić');
    expect(marina.projects).toHaveLength(2);
    expect(marina.overDays).toEqual([expect.objectContaining({ minutes: 600, projects: 2 })]);
    expect(pf.people.persons.filter((x: Row) => (x.overDays as unknown[]).length)).toHaveLength(1);
    expect(pf.summary.successRate).toEqual({ funded: 1, rejected: 1, percent: 50 });
    expect(pf.summary.overdue).toBeGreaterThanOrEqual(2);
    expect(pf.deadlines.some((d: Row) => d.kind === 'claim_due' && !d.overdue)).toBe(true);
    // Voditeljica BLUESENSE vidi samo svoj projekt, bez ljudi i prijava.
    const pmPf = (await http().get('/api/portfolio').set(as('pm')).expect(200)).body;
    expect(pmPf.projects.map((x: Row) => x.acronym)).toEqual(['BLUESENSE']); expect(pmPf.people).toBeNull(); expect(pmPf.pipeline).toBeNull();
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
});
