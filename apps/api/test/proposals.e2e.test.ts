import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';

const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

describe('Prijave (e2e)', () => {
  let app: INestApplication; let A = ''; let B = '';
  const tag = randomUUID().slice(0, 8); const slugA = `pa-${tag}`, slugB = `pb-${tag}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (slug: string) => (await http().post('/api/auth/login').send({ tenantSlug: slug, email: `a@${slug}.hr`, password: 'Lozinka-123456' }).expect(201)).body.accessToken as string;
  let callId = ''; let pid = ''; let partnerOrg = ''; let selfMember = ''; let partnerMember = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugA, adminEmail: `a@${slugA}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugB, adminEmail: `a@${slugB}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    A = await login(slugA); B = await login(slugB);
    callId = (await http().post('/api/calls').set(auth(A)).send({ code: `NPOO.P-${tag}`, title: 'Zeleni promet', programme: 'NPOO', packageId: 'npoo-2021-2026', actionTypes: ['BESPOVRATNA'], deadlines: [{ kind: 'submission', at: inDays(40) }] }).expect(201)).body.id;
    partnerOrg = (await http().post('/api/organisations').set(auth(A)).send({ name: `Promet Lab ${tag} d.o.o.`, country: 'HR', type: 'sme' }).expect(201)).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('otvaranje iz radara traži odluku go; paket i vrsta akcije iz poziva', async () => {
    await http().post(`/api/calls/${callId}/proposal`).set(auth(A)).send({ acronym: 'ZELP', title: 'Zeleni promet u gradu' }).expect(409);
    await http().put(`/api/calls/${callId}/decision`).set(auth(A)).send({ decision: 'go', rationale: 'strateški važno' }).expect(200);
    const r = await http().post(`/api/calls/${callId}/proposal`).set(auth(A)).send({ acronym: 'ZELP', title: 'Zeleni promet u gradu', durationMonths: 24 }).expect(201);
    pid = r.body.id;
    expect(r.body).toMatchObject({ status: 'idea', actionType: 'BESPOVRATNA', package: { id: 'npoo-2021-2026' }, call: { id: callId, status: 'open' } });
    expect(r.body.members).toHaveLength(1);
    selfMember = r.body.members[0].id;
    expect(r.body.members[0]).toMatchObject({ isSelf: true, role: 'coordinator', confirmed: true });
    await http().post(`/api/calls/${callId}/proposal`).set(auth(A)).send({ acronym: 'ZELP2', title: 'Druga prijava' }).expect(409);
    await http().post('/api/proposals').set(auth(A)).send({ packageId: 'npoo-2021-2026', actionType: 'RIA', acronym: 'XX', title: 'Kriva akcija' }).expect(400);
  });

  it('konzorcij, struktura rada, proračun i spremnost', async () => {
    let d = (await http().get(`/api/proposals/${pid}`).set(auth(A)).expect(200)).body;
    expect(d.ready).toBe(false);
    d = (await http().post(`/api/proposals/${pid}/members`).set(auth(A)).send({ organisationId: partnerOrg }).expect(201)).body;
    partnerMember = d.members.find((x: { isSelf: boolean }) => !x.isSelf).id;
    await http().post(`/api/proposals/${pid}/members`).set(auth(A)).send({ organisationId: partnerOrg }).expect(409);
    await http().delete(`/api/proposals/${pid}/members/${selfMember}`).set(auth(A)).expect(409);
    await http().post(`/api/proposals/${pid}/work-packages`).set(auth(A)).send({ title: 'Predug', startMonth: 1, endMonth: 30 }).expect(400);
    await http().post(`/api/proposals/${pid}/work-packages`).set(auth(A)).send({ title: 'Upravljanje', leadMemberId: selfMember, startMonth: 1, endMonth: 24, personMonths: 6 }).expect(201);
    d = (await http().post(`/api/proposals/${pid}/work-packages`).set(auth(A)).send({ title: 'Pilot', leadMemberId: partnerMember, startMonth: 3, endMonth: 20, personMonths: 18 }).expect(201)).body;
    expect(d.workPackages.map((w: { code: string }) => w.code)).toEqual(['WP1', 'WP2']);
    await http().put(`/api/proposals/${pid}/budget/lines`).set(auth(A)).send({ revision: d.revision, lines: [{ memberId: selfMember, categoryCode: 'NEPOSTOJI', amount: 1 }] }).expect(400);
    d = (await http().put(`/api/proposals/${pid}/budget/lines`).set(auth(A)).send({ revision: d.revision, lines: [
      { memberId: selfMember, categoryCode: 'OS', amount: 6_000_000 }, { memberId: partnerMember, categoryCode: 'OS', amount: 4_000_000 }, { memberId: partnerMember, categoryCode: 'PUT', amount: 500_000 },
    ] }).expect(200)).body;
    expect(d.budget.totals.total).toBeGreaterThanOrEqual(10_500_000);
    const notOk = d.readiness.filter((r: { ok: boolean }) => !r.ok).map((r: { key: string }) => r.key);
    expect(notOk).toEqual(expect.arrayContaining(['confirmed', 'budget_locked']));
    await http().patch(`/api/proposals/${pid}/members/${partnerMember}`).set(auth(A)).send({ confirmed: true }).expect(200);
    d = (await http().post(`/api/proposals/${pid}/budget/lock`).set(auth(A)).expect(201)).body;
    expect(d.ready).toBe(true);
    await http().put(`/api/proposals/${pid}/budget/lines`).set(auth(A)).send({ revision: d.revision, lines: [] }).expect(409);
    d = (await http().post(`/api/proposals/${pid}/budget/unlock`).set(auth(A)).expect(201)).body;
    expect(d.budget).toMatchObject({ version: 2, locked: false });
    d = (await http().post(`/api/proposals/${pid}/budget/lock`).set(auth(A)).expect(201)).body;
    expect(d.budget).toMatchObject({ version: 2, locked: true });
  });

  it('životni ciklus: predaja, ishod, ugovaranje u projekt', async () => {
    await http().post(`/api/proposals/${pid}/submit`).set(auth(A)).send({ portal: 'eFondovi', reference: 'REF-1' }).expect(409);
    await http().post(`/api/proposals/${pid}/transition`).set(auth(A)).send({ to: 'in_evaluation' }).expect(409);
    await http().post(`/api/proposals/${pid}/transition`).set(auth(A)).send({ to: 'preparation' }).expect(201);
    await http().post(`/api/proposals/${pid}/transition`).set(auth(A)).send({ to: 'internal_review' }).expect(201);
    await http().post(`/api/proposals/${pid}/members`).set(auth(A)).send({ organisationId: partnerOrg }).expect(409); // zaključano za uređivanje
    let d = (await http().post(`/api/proposals/${pid}/submit`).set(auth(A)).send({ portal: 'eFondovi', reference: `REF-${tag}` }).expect(201)).body;
    expect(d.status).toBe('submitted');
    expect(d.submission).toMatchObject({ portal: 'eFondovi', budgetVersion: 2, total: d.budget.totals.total });
    await http().post(`/api/proposals/${pid}/contract`).set(auth(A)).send({}).expect(409);
    await http().post(`/api/proposals/${pid}/transition`).set(auth(A)).send({ to: 'in_evaluation' }).expect(201);
    d = (await http().post(`/api/proposals/${pid}/outcome`).set(auth(A)).send({ result: 'funded', score: '87/100' }).expect(201)).body;
    expect(d).toMatchObject({ status: 'funded', outcome: { result: 'funded', score: '87/100' } });
    // WP1.14: nositelj prijave bez uloge institucije ugovaranjem postaje voditelj (samo) novog projekta.
    const lead = (await http().post('/api/users').set(auth(A)).send({ email: `nositelj@${slugA}.hr`, displayName: 'Nositelj prijave', password: 'Plava-Staza-2027-x', roleCodes: [] }).expect(201)).body.id;
    await http().patch(`/api/proposals/${pid}`).set(auth(A)).send({ revision: d.revision, leadUserId: lead }).expect(200);
    const c = (await http().post(`/api/proposals/${pid}/contract`).set(auth(A)).send({ contractNo: `NPOO-${tag}`, startDate: '2027-01-01' }).expect(201)).body;
    expect(c.proposal).toMatchObject({ status: 'contracted', projectId: c.projectId });
    const leadToken = (await http().post('/api/auth/login').send({ tenantSlug: slugA, email: `nositelj@${slugA}.hr`, password: 'Plava-Staza-2027-x' }).expect(201)).body.accessToken;
    expect((await http().get('/api/projects').set(auth(leadToken)).expect(200)).body.map((p: { id: string }) => p.id)).toEqual([c.projectId]);
    // WP1.14b: nositelj prijave čita vlastitu prijavu i bez uloge institucije (prije: 403 – prijave su bile samo na razini institucije).
    await http().get(`/api/proposals/${pid}`).set(auth(leadToken)).expect(200);
    const proj = (await http().get(`/api/projects/${c.projectId}`).set(auth(A)).expect(200)).body;
    expect(proj).toMatchObject({ acronym: 'ZELP', contractNo: `NPOO-${tag}`, durationMonths: 24, sourceProposalId: pid });
    expect(proj.partners).toHaveLength(2);
    const st = (await http().get(`/api/projects/${c.projectId}/structure`).set(auth(A)).expect(200)).body;
    expect(st.workPackages ?? st).toHaveLength(2);
    const b = (await http().get(`/api/projects/${c.projectId}/budget`).set(auth(A)).expect(200)).body;
    expect(b.totals.total).toBe(d.budget.totals.total);
    await http().post(`/api/proposals/${pid}/contract`).set(auth(A)).send({}).expect(409);
    const list = (await http().get('/api/proposals').set(auth(A)).expect(200)).body;
    expect(list.find((p: { id: string }) => p.id === pid)).toMatchObject({ status: 'contracted', callCode: `NPOO.P-${tag}` });
  });

  it('izolacija između organizacija', async () => {
    await http().get(`/api/proposals/${pid}`).set(auth(B)).expect(404);
    expect((await http().get('/api/proposals').set(auth(B)).expect(200)).body).toEqual([]);
    await http().post(`/api/calls/${callId}/proposal`).set(auth(B)).send({ acronym: 'HACK', title: 'Tuđi poziv' }).expect(404);
  });
});
