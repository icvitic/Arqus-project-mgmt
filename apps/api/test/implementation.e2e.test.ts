import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';

const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';

describe('Provedba i proračun (e2e)', () => {
  let app: INestApplication; let A = ''; let B = '';
  const tag = randomUUID().slice(0, 8); const slugA = `ia-${tag}`, slugB = `ib-${tag}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (slug: string) => (await http().post('/api/auth/login').send({ tenantSlug: slug, email: `a@${slug}.hr`, password: 'Lozinka-123456' }).expect(201)).body.accessToken as string;
  const pozivId = `npoo-ia-${tag}`;
  let pid = ''; let self = ''; let msp = ''; let wp1 = ''; let wp2 = ''; let d11 = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugA, tenantName: 'Institut A', adminEmail: `a@${slugA}.hr`, adminPassword: 'Lozinka-123456' });
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugB, adminEmail: `a@${slugB}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    A = await login(slugA); B = await login(slugB);
    const org = await http().post('/api/organisations').set(auth(A)).send({ name: 'Mobility Labs d.o.o.', country: 'HR', type: 'sme' }).expect(201);
    const pkg = await http().post('/api/programme-packages').set(auth(A)).send({
      meta: { id: pozivId, extends: 'npoo-2021-2026', programme: 'NPOO – poziv', version: '1.0.0', validFrom: '2026-10-01', language: 'hr' },
      actionTypes: [], costCategories: [], reporting: { periodMonths: 6, submissionDeadlineDays: 30 },
    }).expect(201);
    await http().post(`/api/programme-packages/${pkg.body.id}/publish`).set(auth(A)).expect(201);
    const p = await http().post('/api/projects').set(auth(A)).send({ acronym: 'DIGIPROM', title: 'Digitalni promet', packageId: pozivId, actionType: 'BESPOVRATNA', contractNo: `UG-${tag}`, startDate: '2027-01-01', durationMonths: 24, partners: [{ organisationId: org.body.id }] }).expect(201);
    pid = p.body.id;
    self = p.body.partners.find((x: { isSelf: boolean }) => x.isSelf).id;
    msp = p.body.partners.find((x: { isSelf: boolean }) => !x.isSelf).id;
  });
  afterAll(async () => { await app.close(); });

  it('radni paketi: automatski brojevi, mjeseci unutar trajanja projekta, voditelj mora biti partner', async () => {
    const r1 = await http().post(`/api/projects/${pid}/work-packages`).set(auth(A)).send({ title: 'Upravljanje projektom', startMonth: 1, endMonth: 24, leadPartnerId: self }).expect(201);
    expect(r1.body.code).toBe('WP1'); wp1 = r1.body.id;
    const r2 = await http().post(`/api/projects/${pid}/work-packages`).set(auth(A)).send({ title: 'Razvoj platforme', startMonth: 3, endMonth: 20, leadPartnerId: msp }).expect(201);
    expect(r2.body.code).toBe('WP2'); wp2 = r2.body.id;
    const out = await http().post(`/api/projects/${pid}/work-packages`).set(auth(A)).send({ title: 'Izvan trajanja', startMonth: 1, endMonth: 30 }).expect(400);
    expect(out.body.message).toMatch(/izvan trajanja/);
    await http().post(`/api/projects/${pid}/work-packages`).set(auth(A)).send({ title: 'Krivi voditelj', startMonth: 1, endMonth: 2, leadPartnerId: randomUUID() }).expect(404);
    await http().post(`/api/projects/${pid}/work-packages`).set(auth(A)).send({ number: 1, title: 'Dupli broj', startMonth: 1, endMonth: 2 }).expect(409);
  });

  it('zadaci unutar trajanja WP-a; isporuke s vrstom i razinom iz paketa; rok = kraj mjeseca', async () => {
    const t = await http().post(`/api/projects/${pid}/work-packages/${wp2}/tasks`).set(auth(A)).send({ title: 'Analiza zahtjeva', startMonth: 3, endMonth: 6 }).expect(201);
    expect(t.body.code).toBe('T2.1');
    await http().post(`/api/projects/${pid}/work-packages/${wp2}/tasks`).set(auth(A)).send({ title: 'Prerano', startMonth: 1, endMonth: 4 }).expect(400);
    const bad = await http().post(`/api/projects/${pid}/work-packages/${wp1}/deliverables`).set(auth(A)).send({ title: 'Plan', type: 'R', dissemination: 'PU', dueMonth: 6 }).expect(400);
    expect(bad.body.message).toMatch(/ISP, POK/);
    const d = await http().post(`/api/projects/${pid}/work-packages/${wp1}/deliverables`).set(auth(A)).send({ title: 'Plan upravljanja projektom', type: 'ISP', dissemination: 'INT', dueMonth: 3, leadPartnerId: self }).expect(201);
    expect(d.body).toMatchObject({ code: 'D1.1', dueDate: '2027-03-31', status: 'planned' });
    d11 = d.body.id;
    const sub = await http().patch(`/api/projects/${pid}/deliverables/${d11}`).set(auth(A)).send({ status: 'submitted' }).expect(200);
    expect(sub.body.submittedAt).toBeTruthy();
  });

  it('prekretnice i rizici (ocjena i razina), struktura vraća sve ugniježđeno', async () => {
    const ms = await http().post(`/api/projects/${pid}/milestones`).set(auth(A)).send({ title: 'Prototip platforme', dueMonth: 12, verification: 'demonstracija' }).expect(201);
    expect(ms.body.code).toBe('MS1');
    await http().post(`/api/projects/${pid}/risks`).set(auth(A)).send({ description: 'Kašnjenje nabave opreme', likelihood: 2, impact: 3, mitigation: 'rani natječaj' }).expect(201);
    await http().post(`/api/projects/${pid}/risks`).set(auth(A)).send({ description: 'Odlazak ključne osobe', likelihood: 1, impact: 2 }).expect(201);
    await http().post(`/api/projects/${pid}/risks`).set(auth(A)).send({ description: 'Neispravna skala', likelihood: 4, impact: 1 }).expect(400);
    const s = await http().get(`/api/projects/${pid}/structure`).set(auth(A)).expect(200);
    expect(s.body.workPackages.map((w: { code: string }) => w.code)).toEqual(['WP1', 'WP2']);
    expect(s.body.workPackages[1].tasks[0].code).toBe('T2.1');
    expect(s.body.workPackages[0].deliverables[0]).toMatchObject({ code: 'D1.1', status: 'submitted' });
    expect(s.body.milestones[0].dueDate).toBe('2027-12-31');
    expect(s.body.risks.map((r: { level: string }) => r.level)).toEqual(['high', 'low']);
    expect(s.body.workPackages[0].tenantId).toBeUndefined();
  });

  it('brisanje WP-a s isporukama → 409; uklanjanje partnera koji vodi WP → 409 (ograničenje baze)', async () => {
    await http().delete(`/api/projects/${pid}/work-packages/${wp1}`).set(auth(A)).expect(409);
    const r = await http().delete(`/api/projects/${pid}/partners/${msp}`).set(auth(A)).expect(409);
    expect(r.body.message).toMatch(/povezan/);
  });

  it('proračun: retci po partneru, kategoriji i WP-u; neizravni 15 % osoblja; upozorenje za upravljanje > 10 %', async () => {
    const empty = await http().get(`/api/projects/${pid}/budget`).set(auth(A)).expect(200);
    expect(empty.body.status).toBe('none');
    const res = await http().put(`/api/projects/${pid}/budget/lines`).set(auth(A)).send({ lines: [
      { partnerId: self, categoryCode: 'OS', workPackageId: wp1, amount: 4_000_000 },
      { partnerId: self, categoryCode: 'OS', workPackageId: wp2, amount: 6_000_000 },
      { partnerId: self, categoryCode: 'UP', amount: 2_000_000 },
      { partnerId: msp, categoryCode: 'VU', workPackageId: wp2, amount: 5_000_000 },
    ] }).expect(200);
    expect(res.body).toMatchObject({ version: 1, status: 'draft' });
    const s = res.body.partners.find((p: { partnerId: string }) => p.partnerId === self);
    expect(s).toMatchObject({ directTotal: 12_000_000, indirectTotal: 1_500_000, total: 13_500_000, requested: 13_500_000 });
    expect(res.body.totals).toEqual({ direct: 17_000_000, indirect: 1_500_000, total: 18_500_000, requested: 18_500_000 });
    expect(res.body.warnings.join(' ')).toMatch(/UP/);
  });

  it('proračun odbija neizravne, nepoznatu kategoriju, tuđeg partnera i tuđi WP (400 s popisom)', async () => {
    const r = await http().put(`/api/projects/${pid}/budget/lines`).set(auth(A)).send({ lines: [
      { partnerId: self, categoryCode: 'NT', amount: 1 },
      { partnerId: self, categoryCode: 'XX', amount: 1 },
      { partnerId: randomUUID(), categoryCode: 'OS', amount: 1 },
      { partnerId: self, categoryCode: 'OS', amount: 1, workPackageId: randomUUID() },
    ] }).expect(400);
    expect(r.body.issues).toHaveLength(4);
    await http().put(`/api/projects/${pid}/budget/lines`).set(auth(A)).send({ lines: [{ partnerId: self, categoryCode: 'OS', amount: 1.5 }] }).expect(400);
  });

  it('aktivacija zaključava proračun v1; nakon toga izmjene → 409', async () => {
    await http().post(`/api/projects/${pid}/transition`).set(auth(A)).send({ to: 'active' }).expect(201);
    const b = await http().get(`/api/projects/${pid}/budget`).set(auth(A)).expect(200);
    expect(b.body.status).toBe('locked');
    expect(b.body.totals.total).toBe(18_500_000);
    await http().put(`/api/projects/${pid}/budget/lines`).set(auth(A)).send({ lines: [] }).expect(409);
    await http().patch(`/api/projects/${pid}/deliverables/${d11}`).set(auth(A)).send({ status: 'accepted' }).expect(200);
  });

  it('izolacija: stanar B ne vidi strukturu ni proračun i ne može ih mijenjati (404)', async () => {
    await http().get(`/api/projects/${pid}/structure`).set(auth(B)).expect(404);
    await http().get(`/api/projects/${pid}/budget`).set(auth(B)).expect(404);
    await http().post(`/api/projects/${pid}/milestones`).set(auth(B)).send({ title: 'Upad', dueMonth: 1 }).expect(404);
    await http().patch(`/api/projects/${pid}/deliverables/${d11}`).set(auth(B)).send({ status: 'rejected' }).expect(404);
  });

  it('revizijski zapis bilježi strukturu i proračun', async () => {
    const audit = await http().get('/api/audit?limit=200').set(auth(A)).expect(200);
    const pairs = audit.body.map((a: { entity: string; action: string }) => `${a.entity}:${a.action}`);
    expect(pairs).toEqual(expect.arrayContaining(['work_package:create', 'deliverable:status.submitted', 'risk:create', 'project_budget:lines.replace']));
  });
});
