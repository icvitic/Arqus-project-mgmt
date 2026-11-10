import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';

const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';

describe('Projekti (e2e)', () => {
  let app: INestApplication; let A = ''; let B = '';
  const tag = randomUUID().slice(0, 8); const slugA = `pra-${tag}`, slugB = `prb-${tag}`;
  const pozivId = `npoo-pr-${tag}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (slug: string) => (await http().post('/api/auth/login').send({ tenantSlug: slug, email: `a@${slug}.hr`, password: 'Lozinka-123456' }).expect(201)).body.accessToken as string;
  let polimi = ''; let heProject = ''; let npooProject = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugA, tenantName: 'Fakultet A', adminEmail: `a@${slugA}.hr`, adminPassword: 'Lozinka-123456' });
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugB, adminEmail: `a@${slugB}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    A = await login(slugA); B = await login(slugB);
    // objavljeni paket po pozivu (NPOO, tromjesečna razdoblja → ovdje 6 mj.)
    const pkg = await http().post('/api/programme-packages').set(auth(A)).send({
      meta: { id: pozivId, extends: 'npoo-2021-2026', programme: 'NPOO – poziv', version: '1.0.0', validFrom: '2026-10-01', language: 'hr' },
      actionTypes: [], costCategories: [], reporting: { periodMonths: 6, submissionDeadlineDays: 30 },
    }).expect(201);
    await http().post(`/api/programme-packages/${pkg.body.id}/publish`).set(auth(A)).expect(201);
  });
  afterAll(async () => { await app.close(); });

  it('organizacija: stvaranje, validacija (PIC 9 znamenki), pretraga', async () => {
    await http().post('/api/organisations').set(auth(A)).send({ name: 'X', country: 'ITA' }).expect(400);
    const bad = await http().post('/api/organisations').set(auth(A)).send({ name: 'Politecnico di Milano', country: 'it', identifiers: { pic: '123' } }).expect(400);
    expect(bad.body.issues[0].path).toBe('/identifiers/pic');
    const res = await http().post('/api/organisations').set(auth(A)).send({ name: 'Politecnico di Milano', country: 'it', type: 'university', nonProfit: true, identifiers: { pic: '999993953' } }).expect(201);
    expect(res.body.country).toBe('IT');
    polimi = res.body.id;
    const found = await http().get('/api/organisations?q=polit').set(auth(A)).expect(200);
    expect(found.body.map((o: { id: string }) => o.id)).toContain(polimi);
  });

  it('HE projekt (IA): vlastita organizacija dodana automatski, neprofitni partner dobiva stopu nonProfit', async () => {
    const res = await http().post('/api/projects').set(auth(A)).send({
      acronym: 'AILOG', title: 'AI za logistiku bez emisija', packageId: 'horizon-europe-2021-2027', actionType: 'IA',
      partners: [{ organisationId: polimi }],
    }).expect(201);
    heProject = res.body.id;
    expect(res.body.status).toBe('contracting');
    expect(res.body.package).toMatchObject({ id: 'horizon-europe-2021-2027', version: '1.0.0' });
    expect(res.body.partners).toHaveLength(2);
    const self = res.body.partners.find((p: { isSelf: boolean }) => p.isSelf);
    expect(self).toMatchObject({ role: 'coordinator', orderNo: 1, name: 'Fakultet A', beneficiaryType: 'nonProfit' });
    expect(res.body.partners.find((p: { organisationId: string }) => p.organisationId === polimi).beneficiaryType).toBe('nonProfit');
  });

  it('nepostojeća vrsta akcije → 400; nepoznati paket → 404', async () => {
    const r = await http().post('/api/projects').set(auth(A)).send({ acronym: 'X1', title: 'Xxx', packageId: 'horizon-europe-2021-2027', actionType: 'ZZZ' }).expect(400);
    expect(r.body.message).toMatch(/RIA, IA, CSA/);
    await http().post('/api/projects').set(auth(A)).send({ acronym: 'X2', title: 'Xxx', packageId: 'nema', actionType: 'RIA' }).expect(404);
  });

  it('aktivacija HE projekta bez ugovora i trajanja → 409 s razlozima (HE paket je objavljen)', async () => {
    const r = await http().post(`/api/projects/${heProject}/transition`).set(auth(A)).send({ to: 'active' }).expect(409);
    expect(r.body.issues.join(' ')).toMatch(/broj ugovora/);
    expect(r.body.issues.join(' ')).not.toMatch(/nije objavljen/);
  });

  it('projekt na neobjavljenom (nacrt) paketu se ne može aktivirati', async () => {
    const draftId = `nacrt-${tag}`;
    await http().post('/api/programme-packages').set(auth(A)).send({ meta: { id: draftId, extends: 'npoo-2021-2026', programme: 'Nacrt', version: '1.0.0', validFrom: '2026-10-01', language: 'hr' }, actionTypes: [], costCategories: [], reporting: { periodMonths: 6, submissionDeadlineDays: 30 } }).expect(201);
    const pr = await http().post('/api/projects').set(auth(A)).send({ acronym: 'NACRT', title: 'Na nacrtu', packageId: draftId, actionType: 'BESPOVRATNA', contractNo: `N-${tag}`, startDate: '2027-01-01', durationMonths: 6 }).expect(201);
    const r = await http().post(`/api/projects/${pr.body.id}/transition`).set(auth(A)).send({ to: 'active' }).expect(409);
    expect(r.body.issues).toEqual([expect.stringMatching(/nije objavljen/)]);
  });

  it('NPOO projekt na objavljenom paketu po pozivu: aktivacija generira izvještajna razdoblja iz paketa', async () => {
    const res = await http().post('/api/projects').set(auth(A)).send({ acronym: 'ZELPROM', title: 'Zeleni promet', packageId: pozivId, actionType: 'BESPOVRATNA', contractNo: 'NPOO.C3.2.R2-I1.05.0001', startDate: '2027-01-01', durationMonths: 7 }).expect(201);
    npooProject = res.body.id;
    await http().post('/api/projects').set(auth(A)).send({ acronym: 'DUP', title: 'Dupli ugovor', packageId: pozivId, actionType: 'BESPOVRATNA', contractNo: 'NPOO.C3.2.R2-I1.05.0001' }).expect(409);
    const act = await http().post(`/api/projects/${npooProject}/transition`).set(auth(A)).send({ to: 'active' }).expect(201);
    expect(act.body.status).toBe('active');
    expect(act.body.reportingPeriods).toEqual([
      { number: 1, startDate: '2027-01-01', endDate: '2027-06-30', dueDate: '2027-07-30' },
      { number: 2, startDate: '2027-07-01', endDate: '2027-07-31', dueDate: '2027-08-30' },
    ]);
  });

  it('nakon aktivacije: početak i partneri se ne mijenjaju (amandman), naslov da; nedopušteni prijelazi 409', async () => {
    await http().patch(`/api/projects/${npooProject}`).set(auth(A)).send({ startDate: '2027-02-01' }).expect(409);
    await http().post(`/api/projects/${npooProject}/partners`).set(auth(A)).send({ organisationId: polimi }).expect(409);
    const upd = await http().patch(`/api/projects/${npooProject}`).set(auth(A)).send({ title: 'Zeleni promet 2' }).expect(200);
    expect(upd.body.title).toBe('Zeleni promet 2');
    await http().patch(`/api/projects/${npooProject}`).set(auth(A)).send({ status: 'closed' }).expect(400);
    await http().post(`/api/projects/${npooProject}/transition`).set(auth(A)).send({ to: 'closed' }).expect(409);
    await http().post(`/api/projects/${npooProject}/transition`).set(auth(A)).send({ to: 'suspended' }).expect(201);
    const back = await http().post(`/api/projects/${npooProject}/transition`).set(auth(A)).send({ to: 'active' }).expect(201);
    expect(back.body.reportingPeriods).toHaveLength(2); // ponovna aktivacija ne generira razdoblja
  });

  it('partneri u ugovaranju: dupli 409, uklanjanje vlastite organizacije 409, uklanjanje partnera 200', async () => {
    await http().post(`/api/projects/${heProject}/partners`).set(auth(A)).send({ organisationId: polimi }).expect(409);
    const p = await http().get(`/api/projects/${heProject}`).set(auth(A)).expect(200);
    const self = p.body.partners.find((x: { isSelf: boolean }) => x.isSelf);
    const other = p.body.partners.find((x: { isSelf: boolean }) => !x.isSelf);
    await http().delete(`/api/projects/${heProject}/partners/${self.id}`).set(auth(A)).expect(409);
    const after = await http().delete(`/api/projects/${heProject}/partners/${other.id}`).set(auth(A)).expect(200);
    expect(after.body.partners).toHaveLength(1);
  });

  it('izolacija: stanar B ne vidi projekte ni organizacije A i ne može ih koristiti', async () => {
    await http().get(`/api/projects/${heProject}`).set(auth(B)).expect(404);
    expect((await http().get('/api/projects').set(auth(B)).expect(200)).body).toEqual([]);
    await http().get(`/api/organisations/${polimi}`).set(auth(B)).expect(404);
    await http().post('/api/projects').set(auth(B)).send({ acronym: 'B1', title: 'Projekt B', packageId: pozivId, actionType: 'BESPOVRATNA' }).expect(404);
    const pb = await http().post('/api/projects').set(auth(B)).send({ acronym: 'B2', title: 'Projekt B', packageId: 'horizon-europe-2021-2027', actionType: 'RIA' }).expect(201);
    await http().post(`/api/projects/${pb.body.id}/partners`).set(auth(B)).send({ organisationId: polimi }).expect(404);
    await http().post(`/api/projects/${heProject}/transition`).set(auth(B)).send({ to: 'terminated' }).expect(404);
  });

  it('revizijski zapis bilježi stvaranje, partnere i prijelaze projekta', async () => {
    const audit = await http().get('/api/audit?entity=project').set(auth(A)).expect(200);
    const actions = audit.body.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['create', 'update', 'transition', 'partner.remove']));
  });
});
