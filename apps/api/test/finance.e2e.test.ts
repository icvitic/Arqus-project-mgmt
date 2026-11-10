import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';

const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';

describe('Financije: timesheetovi, troškovi, ZNS (e2e)', () => {
  let app: INestApplication; let A = ''; let B = ''; let worker = '';
  const tag = randomUUID().slice(0, 8); const slugA = `fa-${tag}`, slugB = `fb-${tag}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (slug: string, email = `a@${slug}.hr`, pw = 'Lozinka-123456') => (await http().post('/api/auth/login').send({ tenantSlug: slug, email, password: pw }).expect(201)).body.accessToken as string;
  const pozivId = `npoo-fin-${tag}`;
  let pid = ''; let self = ''; let wp1 = ''; let ivana = ''; let marko = ''; let workerUserId = ''; let claim1 = ''; let manualExpense = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugA, adminEmail: `a@${slugA}.hr`, adminPassword: 'Lozinka-123456' });
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugB, adminEmail: `a@${slugB}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    A = await login(slugA); B = await login(slugB);
    const u = await http().post('/api/users').set(auth(A)).send({ email: `ivana@${slugA}.hr`, displayName: 'Ivana', password: 'Radnica-123456', roleCodes: ['team-member'] }).expect(201);
    workerUserId = u.body.id; worker = await login(slugA, `ivana@${slugA}.hr`, 'Radnica-123456');
    const pkg = await http().post('/api/programme-packages').set(auth(A)).send({
      meta: { id: pozivId, extends: 'npoo-2021-2026', programme: 'NPOO – poziv', version: '1.0.0', validFrom: '2026-10-01', language: 'hr' },
      actionTypes: [], costCategories: [], reporting: { periodMonths: 6, submissionDeadlineDays: 30 },
    }).expect(201);
    await http().post(`/api/programme-packages/${pkg.body.id}/publish`).set(auth(A)).expect(201);
    const p = await http().post('/api/projects').set(auth(A)).send({ acronym: 'FINPROJ', title: 'Financijski tok', packageId: pozivId, actionType: 'BESPOVRATNA', contractNo: `UG-F-${tag}`, startDate: '2027-01-01', durationMonths: 12 }).expect(201);
    pid = p.body.id; self = p.body.partners[0].id;
    wp1 = (await http().post(`/api/projects/${pid}/work-packages`).set(auth(A)).send({ title: 'Istraživanje', startMonth: 1, endMonth: 12 }).expect(201)).body.id;
    await http().put(`/api/projects/${pid}/budget/lines`).set(auth(A)).send({ lines: [{ partnerId: self, categoryCode: 'OS', amount: 2_000_000 }, { partnerId: self, categoryCode: 'VU', amount: 1_000_000 }] }).expect(200);
  });
  afterAll(async () => { await app.close(); });

  it('troškovi prije aktivacije → 409; tim: član s korisnikom i bez', async () => {
    await http().post(`/api/projects/${pid}/expenses`).set(auth(A)).send({ categoryCode: 'VU', date: '2027-02-01', description: 'Usluga', amount: 100 }).expect(409);
    ivana = (await http().post(`/api/projects/${pid}/team`).set(auth(A)).send({ fullName: 'Ivana Horvat', userId: workerUserId, role: 'istraživačica', annualCost: 3_440_000 }).expect(201)).body.id;
    marko = (await http().post(`/api/projects/${pid}/team`).set(auth(A)).send({ fullName: 'Marko Kovač', annualCost: 5_160_000 }).expect(201)).body.id;
    await http().post(`/api/projects/${pid}/transition`).set(auth(A)).send({ to: 'active' }).expect(201);
    const team = await http().get(`/api/projects/${pid}/team`).set(auth(A)).expect(200);
    expect(team.body).toHaveLength(2);
  });

  it('timesheet: djelatnica uređuje svoj, ne tuđi; greške 400, upozorenja vraćena; izvan trajanja 400', async () => {
    const own = await http().put(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02`).set(auth(worker)).send({ entries: [
      { day: 1, minutes: 480, workPackageId: wp1 }, { day: 2, minutes: 420, workPackageId: wp1 }, { day: 6, minutes: 120 },
    ] }).expect(200);
    expect(own.body).toMatchObject({ status: 'draft', totalMinutes: 1020 });
    expect(own.body.warnings).toEqual(['dan 6: rad vikendom']);
    await http().put(`/api/projects/${pid}/team/${marko}/timesheets/2027-02`).set(auth(worker)).send({ entries: [{ day: 1, minutes: 60 }] }).expect(403);
    const bad = await http().put(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02`).set(auth(worker)).send({ entries: [{ day: 30, minutes: 60 }] }).expect(400);
    expect(bad.body.issues[0]).toMatch(/ne postoji/);
    await http().put(`/api/projects/${pid}/team/${ivana}/timesheets/2028-02`).set(auth(worker)).send({ entries: [] }).expect(400);
    await http().get(`/api/projects/${pid}/team/${ivana}/timesheets/2027-13`).set(auth(A)).expect(400);
  });

  it('predaja (djelatnica) i odobrenje (voditelj, ne djelatnica): trošak osoblja po WP-u iz satnice paketa', async () => {
    await http().post(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02/submit`).set(auth(worker)).expect(201);
    await http().put(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02`).set(auth(worker)).send({ entries: [] }).expect(409);
    await http().post(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02/approve`).set(auth(worker)).expect(403);
    const ok = await http().post(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02/approve`).set(auth(A)).expect(201);
    expect(ok.body.status).toBe('approved');
    // 34.400 €/god ÷ 1720 h = 20 €/h: WP1 15 h = 300 €, bez WP-a 2 h = 40 €
    expect(ok.body.personnelCost.map((x: { amount: number }) => x.amount).sort()).toEqual([30_000, 4_000].sort());
    const ex = await http().get(`/api/projects/${pid}/expenses`).set(auth(A)).expect(200);
    const ts = ex.body.filter((e: { source: string }) => e.source === 'timesheet');
    expect(ts).toHaveLength(2);
    expect(ts[0]).toMatchObject({ categoryCode: 'OS', date: '2027-02-28', status: 'recorded' });
  });

  it('ručni troškovi: osoblje ručno 400, izvan trajanja 400, ispravan 201; izmjena i brisanje dok je evidentiran', async () => {
    const os = await http().post(`/api/projects/${pid}/expenses`).set(auth(A)).send({ categoryCode: 'OS', date: '2027-03-01', description: 'Plaća', amount: 100 }).expect(400);
    expect(os.body.issues[0]).toMatch(/timesheeta/);
    await http().post(`/api/projects/${pid}/expenses`).set(auth(A)).send({ categoryCode: 'VU', date: '2028-03-01', description: 'Kasno', amount: 100 }).expect(400);
    const e = await http().post(`/api/projects/${pid}/expenses`).set(auth(A)).send({ categoryCode: 'VU', workPackageId: wp1, date: '2027-03-15', description: 'Anketa', supplier: 'Agencija d.o.o.', amount: 250_000, evidenceRef: 'R-17/2027' }).expect(201);
    manualExpense = e.body.id;
    const upd = await http().patch(`/api/projects/${pid}/expenses/${manualExpense}`).set(auth(A)).send({ amount: 200_000 }).expect(200);
    expect(upd.body.amount).toBe(200_000);
    const tmp = await http().post(`/api/projects/${pid}/expenses`).set(auth(A)).send({ categoryCode: 'PUT', date: '2027-04-02', description: 'Put', amount: 30_000 }).expect(201);
    await http().delete(`/api/projects/${pid}/expenses/${tmp.body.id}`).set(auth(A)).expect(200);
    await http().post(`/api/projects/${pid}/expenses`).set(auth(A)).send({ categoryCode: 'PUT', date: '2027-08-10', description: 'Put RP2', amount: 50_000 }).expect(201);
  });

  it('ZNS za RP1: nacrt prikazuje prihvatljive troškove i izračun (neizravni 15 % osoblja); dupli ZNS 409', async () => {
    const c = await http().post(`/api/projects/${pid}/claims`).set(auth(A)).send({ period: 1 }).expect(201);
    claim1 = c.body.id;
    expect(c.body.status).toBe('draft');
    expect(c.body.expenses).toHaveLength(3); // 2 osoblje + anketa; put iz RP2 nije u razdoblju
    expect(c.body.totals).toMatchObject({ direct: 234_000, indirect: 5_100, total: 239_100, requested: 239_100 });
    await http().post(`/api/projects/${pid}/claims`).set(auth(A)).send({ period: 1 }).expect(409);
  });

  it('predaja ZNS-a pridružuje troškove i zaključava timesheet; izmjene nakon toga 409', async () => {
    const s = await http().post(`/api/projects/${pid}/claims/${claim1}/submit`).set(auth(A)).expect(201);
    expect(s.body).toMatchObject({ status: 'submitted', requested: 239_100 });
    await http().patch(`/api/projects/${pid}/expenses/${manualExpense}`).set(auth(A)).send({ amount: 1 }).expect(409);
    const ts = await http().get(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02`).set(auth(A)).expect(200);
    expect(ts.body.status).toBe('locked');
    await http().post(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02/reopen`).set(auth(A)).expect(409);
  });

  it('povrat na dopunu vraća troškove i timesheet; ponovna predaja i djelomično odobrenje; isplata', async () => {
    const r = await http().post(`/api/projects/${pid}/claims/${claim1}/decision`).set(auth(A)).send({ decision: 'returned', note: 'Nedostaje račun' }).expect(201);
    expect(r.body.status).toBe('draft');
    expect((await http().get(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02`).set(auth(A))).body.status).toBe('approved');
    await http().post(`/api/projects/${pid}/claims/${claim1}/submit`).set(auth(A)).expect(201);
    await http().post(`/api/projects/${pid}/claims/${claim1}/decision`).set(auth(A)).send({ decision: 'partially_approved', approvedAmount: 300_000 }).expect(400);
    const d = await http().post(`/api/projects/${pid}/claims/${claim1}/decision`).set(auth(A)).send({ decision: 'partially_approved', approvedAmount: 220_000 }).expect(201);
    expect(d.body).toMatchObject({ status: 'partially_approved', approved: 220_000 });
    expect(d.body.expenses.every((e: { status: string }) => e.status === 'accepted')).toBe(true);
    await http().post(`/api/projects/${pid}/claims/${claim1}/payment`).set(auth(A)).send({ paidAmount: 230_000, paidAt: '2027-09-15' }).expect(400);
    const paid = await http().post(`/api/projects/${pid}/claims/${claim1}/payment`).set(auth(A)).send({ paidAmount: 220_000, paidAt: '2027-09-15' }).expect(201);
    expect(paid.body.paid).toBe(220_000);
  });

  it('prihvaćeni trošak je nepromjenjiv i na razini baze (okidač)', async () => {
    await http().delete(`/api/projects/${pid}/expenses/${manualExpense}`).set(auth(A)).expect(409);
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test', max: 1 });
    const c = await pool.connect();
    try {
      const tid = (await c.query(`select tenant_id from expenses where id = $1`, [manualExpense]).catch(() => ({ rows: [] }))).rows[0]?.tenant_id;
      await c.query('begin');
      const me = await http().get('/api/me').set(auth(A)); await c.query(`select set_config('app.tenant_id', $1, true)`, [tid ?? me.body.tenant.id]);
      await expect(c.query(`update expenses set amount_cents = 1 where id = $1`, [manualExpense])).rejects.toThrow(/nepromjenjiv/);
      await c.query('rollback');
    } finally { c.release(); await pool.end(); }
  });

  it('pregled ugovoreno vs. ostvareno po kategoriji i ZNS-ovi', async () => {
    const o = await http().get(`/api/projects/${pid}/finance`).set(auth(A)).expect(200);
    expect(o.body.budgetStatus).toBe('locked');
    const os = o.body.byCategory.find((c: { code: string }) => c.code === 'OS');
    expect(os).toMatchObject({ planned: 2_000_000, actual: 34_000, remaining: 1_966_000, percent: 2 });
    expect(o.body.byCategory.find((c: { code: string }) => c.code === 'VU')).toMatchObject({ planned: 1_000_000, actual: 200_000, percent: 20 });
    expect(o.body.actual.direct).toBe(284_000); // 34.000 + 200.000 + put RP2 50.000
    expect(o.body.claims).toEqual([expect.objectContaining({ period: 1, status: 'partially_approved', requested: 239_100, approved: 220_000, paid: 220_000 })]);
  });

  it('izolacija: stanar B nema pristup timu, troškovima, ZNS-ovima ni pregledu', async () => {
    await http().get(`/api/projects/${pid}/team`).set(auth(B)).expect(404);
    await http().get(`/api/projects/${pid}/expenses`).set(auth(B)).expect(404);
    await http().get(`/api/projects/${pid}/claims/${claim1}`).set(auth(B)).expect(404);
    await http().get(`/api/projects/${pid}/finance`).set(auth(B)).expect(404);
    await http().post(`/api/projects/${pid}/expenses`).set(auth(B)).send({ categoryCode: 'VU', date: '2027-03-01', description: 'Upad', amount: 1 }).expect(404);
  });
});
