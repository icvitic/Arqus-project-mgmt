import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';
import { PDF } from './access-fixture';

const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const PW = 'Plava-Staza-2027-x';

/**
 * WP1.14b – dorade prije pilota: zaštita od istovremenog prepisivanja, pregled revizije, četiri oka na timesheetovima,
 * voditelj vlastite prijave, valjanost paketa programa, „danas” u zoni institucije, jedinstvenost dodjela uloga.
 */
describe('Dorade prije pilota (WP1.14b, e2e)', () => {
  let app: INestApplication;
  const tag = randomUUID().slice(0, 8); const slug = `wp14b-${tag}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const owner = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const t: Record<string, string> = {}; const u: Record<string, string> = {};
  let tenantId = ''; let pid = ''; let self = ''; let wp = ''; let noAccount = '';

  const login = async (email: string, pw = PW) => (await http().post('/api/auth/login').send({ tenantSlug: slug, email, password: pw }).expect(201)).body.accessToken as string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), 'arqus-wp14b-'));
    await seedDemo({ url: ADMIN_URL, tenantSlug: slug, adminEmail: `a@${slug}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    t.admin = await login(`a@${slug}.hr`, 'Lozinka-123456');
    tenantId = (await owner.query<{ id: string }>('select id from tenants where slug = $1', [slug])).rows[0]!.id;
    const mk = async (key: string, displayName: string, roleCodes: string[]) => {
      u[key] = (await http().post('/api/users').set(auth(t.admin!)).send({ email: `${key}@${slug}.hr`, displayName, password: PW, roleCodes }).expect(201)).body.id;
    };
    await mk('ured', 'Ana Ured', ['project-office']); await mk('ured2', 'Iva Ured', ['project-office']); await mk('pm', 'Petra Voditeljica', []);
    await mk('fin', 'Maja Financije', ['finance']); await mk('lead', 'Luka Nositelj', []); await mk('lead2', 'Nina Nositeljica', []); await mk('auditor', 'Rea Revizorica', []);
    // Vlastita uloga stanara: samo čitanje revizije (bez personnel:read) – za provjeru skrivanja plaća.
    const role = (await owner.query<{ id: string }>(`insert into roles (tenant_id, code, name, permissions, scope) values ($1, 'revizor', 'Revizor', '{audit:read}', 'tenant') returning id`, [tenantId])).rows[0]!.id;
    await owner.query('insert into role_assignments (tenant_id, user_id, role_id) values ($1, $2, $3)', [tenantId, u.auditor, role]);
    for (const k of ['ured', 'ured2', 'pm', 'fin', 'lead', 'lead2', 'auditor']) t[k] = await login(`${k}@${slug}.hr`);

    const p = (await http().post('/api/projects').set(auth(t.ured!)).send({ acronym: 'TIHO', title: 'Projekt bez iznenađenja', packageId: 'horizon-europe-2021-2027', actionType: 'RIA', contractNo: `GA-${tag}`, startDate: '2027-01-01', durationMonths: 24, managerUserId: u.pm }).expect(201)).body;
    pid = p.id; self = p.partners[0].id;
    expect(p.deviations).toEqual([]);
    wp = (await http().post(`/api/projects/${pid}/work-packages`).set(auth(t.pm!)).send({ title: 'Rad', startMonth: 1, endMonth: 24 }).expect(201)).body.id;
    noAccount = (await http().post(`/api/projects/${pid}/team`).set(auth(t.fin!)).send({ fullName: 'Marko Bez Računa', annualCost: 3_600_000 }).expect(201)).body.id;
  }, 60_000);
  afterAll(async () => { vi.useRealTimers(); await app.close(); await owner.end(); });

  describe('1. bez tihog prepisivanja (revizija)', () => {
    it('proračun projekta: dvoje spremaju s istom revizijom – drugi dobiva 409 s imenom i vremenom, ništa se ne zapisuje', async () => {
      const loaded = (await http().get(`/api/projects/${pid}/budget`).set(auth(t.ured!)).expect(200)).body;
      expect(loaded.revision).toBe(0); // proračun još ne postoji
      const first = (await http().put(`/api/projects/${pid}/budget/lines`).set(auth(t.ured!)).send({ revision: 0, lines: [{ partnerId: self, categoryCode: 'A.1', amount: 1_000_000 }] }).expect(200)).body;
      expect(first.revision).toBeGreaterThan(0);
      const r = await http().put(`/api/projects/${pid}/budget/lines`).set(auth(t.pm!)).send({ revision: 0, lines: [{ partnerId: self, categoryCode: 'A.1', amount: 9_999_900 }] }).expect(409);
      expect(r.body).toMatchObject({ code: 'revision_conflict', conflict: { expected: 0, current: first.revision, updatedBy: { id: u.ured, displayName: 'Ana Ured' } } });
      expect(r.body.message).toMatch(/Proračun je u međuvremenu promijenio korisnik Ana Ured \(\d{2}\. ?\d{2}\. ?\d{4}\.?,? \d{2}:\d{2}\)/);
      expect(r.body.conflict.updatedAt).toBeTruthy();
      const now = (await http().get(`/api/projects/${pid}/budget`).set(auth(t.pm!)).expect(200)).body;
      expect(now.lines.map((l: { amount: number }) => l.amount)).toEqual([1_000_000]);
      // S aktualnom revizijom spremanje prolazi; bez revizije (API klijent koji je ne šalje) također.
      const ok = (await http().put(`/api/projects/${pid}/budget/lines`).set(auth(t.pm!)).send({ revision: now.revision, lines: [{ partnerId: self, categoryCode: 'A.1', amount: 2_000_000 }] }).expect(200)).body;
      expect(ok.revision).toBe(now.revision + 1);
      await http().put(`/api/projects/${pid}/budget/lines`).set(auth(t.pm!)).send({ lines: [{ partnerId: self, categoryCode: 'A.1', amount: 2_000_000 }, { partnerId: self, categoryCode: 'C.1', amount: 100_000 }] }).expect(200);
    });

    it('istovremena spremanja (stvarno paralelno): jedno prolazi, drugo 409', async () => {
      const { revision } = (await http().get(`/api/projects/${pid}/budget`).set(auth(t.ured!)).expect(200)).body;
      const [a, b] = await Promise.all([
        http().put(`/api/projects/${pid}/budget/lines`).set(auth(t.ured!)).send({ revision, lines: [{ partnerId: self, categoryCode: 'A.1', amount: 3_000_000 }] }),
        http().put(`/api/projects/${pid}/budget/lines`).set(auth(t.pm!)).send({ revision, lines: [{ partnerId: self, categoryCode: 'A.1', amount: 4_000_000 }] }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
    });

    it('osnovni podaci projekta i timesheet', async () => {
      const p = (await http().get(`/api/projects/${pid}`).set(auth(t.pm!)).expect(200)).body;
      await http().patch(`/api/projects/${pid}`).set(auth(t.ured!)).send({ revision: p.revision, title: 'Novi naslov projekta' }).expect(200);
      const c = await http().patch(`/api/projects/${pid}`).set(auth(t.pm!)).send({ revision: p.revision, title: 'Moj naslov' }).expect(409);
      expect(c.body.conflict.updatedBy.displayName).toBe('Ana Ured');
      expect((await http().get(`/api/projects/${pid}`).set(auth(t.pm!)).expect(200)).body.title).toBe('Novi naslov projekta');
      // Timesheet člana bez računa: voditelj i ured istovremeno upisuju prvi unos (revizija 0).
      const url = `/api/projects/${pid}/team/${noAccount}/timesheets/2027-02`;
      expect((await http().get(url).set(auth(t.pm!)).expect(200)).body.revision).toBe(0);
      await http().put(url).set(auth(t.pm!)).send({ revision: 0, entries: [{ day: 1, minutes: 480, workPackageId: wp }] }).expect(200);
      const r = await http().put(url).set(auth(t.ured!)).send({ revision: 0, entries: [{ day: 2, minutes: 60, workPackageId: wp }] }).expect(409);
      expect(r.body.conflict.updatedBy.displayName).toBe('Petra Voditeljica');
      expect((await http().get(url).set(auth(t.ured!)).expect(200)).body.entries).toEqual([{ day: 1, minutes: 480, workPackageId: wp }]);
    });
  });

  describe('3. četiri oka na timesheetovima', () => {
    it('voditelj unese i preda sate člana bez računa – sam ih ne može odobriti; ured može', async () => {
      const url = `/api/projects/${pid}/team/${noAccount}/timesheets/2027-02`;
      await http().post(`/api/projects/${pid}/transition`).set(auth(t.ured!)).send({ to: 'active' }).expect(201);
      await http().post(`${url}/submit`).set(auth(t.pm!)).expect(201);
      expect((await http().get(url).set(auth(t.pm!)).expect(200)).body.submittedBy).toBe(u.pm);
      const r = await http().post(`${url}/approve`).set(auth(t.pm!)).expect(403);
      expect(r.body.message).toMatch(/četiri oka/);
      await http().post(`${url}/approve`).set(auth(t.ured!)).expect(201);
      // Ured koji sam preda timesheet također ga ne odobrava – odobrava drugi korisnik s pravom odobravanja.
      const url2 = `/api/projects/${pid}/team/${noAccount}/timesheets/2027-03`;
      await http().put(url2).set(auth(t.ured!)).send({ entries: [{ day: 2, minutes: 240, workPackageId: wp }] }).expect(200);
      await http().post(`${url2}/submit`).set(auth(t.ured!)).expect(201);
      await http().post(`${url2}/approve`).set(auth(t.ured!)).expect(403);
      await http().post(`${url2}/approve`).set(auth(t.ured2!)).expect(201);
    });

    it('predan timesheet bez zabilježenog predavatelja (stariji od migracije) ne odobrava se: 409', async () => {
      const url = `/api/projects/${pid}/team/${noAccount}/timesheets/2027-04`;
      await http().put(url).set(auth(t.pm!)).send({ entries: [{ day: 1, minutes: 60, workPackageId: wp }] }).expect(200);
      await http().post(`${url}/submit`).set(auth(t.pm!)).expect(201);
      await owner.query(`update timesheets set submitted_by = null where team_member_id = $1 and month = '2027-04'`, [noAccount]);
      await http().post(`${url}/approve`).set(auth(t.ured!)).expect(409);
    });
  });

  describe('4. voditelj vlastite prijave', () => {
    let mine = ''; let other = '';
    it('ured otvara prijave i imenuje voditelje; voditelj vidi samo svoju', async () => {
      mine = (await http().post('/api/proposals').set(auth(t.ured!)).send({ packageId: 'horizon-europe-2021-2027', actionType: 'RIA', acronym: 'MOJA', title: 'Prijava voditelja', leadUserId: u.lead }).expect(201)).body.id;
      other = (await http().post('/api/proposals').set(auth(t.ured!)).send({ packageId: 'horizon-europe-2021-2027', actionType: 'RIA', acronym: 'TUĐA', title: 'Tuđa prijava', leadUserId: u.lead2 }).expect(201)).body.id;
      expect(((await http().get('/api/proposals').set(auth(t.lead!)).expect(200)).body as { id: string }[]).map((p) => p.id)).toEqual([mine]);
      expect((await http().get('/api/me').set(auth(t.lead!)).expect(200)).body.leadProposals).toEqual([mine]);
      await http().get(`/api/proposals/${mine}`).set(auth(t.lead!)).expect(200);
      // Tuđa prijava – kao da ne postoji (404), za svaku radnju.
      await http().get(`/api/proposals/${other}`).set(auth(t.lead!)).expect(404);
      await http().patch(`/api/proposals/${other}`).set(auth(t.lead!)).send({ title: 'Upad u tuđu prijavu' }).expect(404);
      await http().put(`/api/proposals/${other}/budget/lines`).set(auth(t.lead!)).send({ lines: [] }).expect(404);
      await http().post(`/api/proposals/${other}/transition`).set(auth(t.lead!)).send({ to: 'preparation' }).expect(404);
      await http().get(`/api/documents?proposalId=${other}`).set(auth(t.lead!)).expect(404);
      // Korisnik bez uloge koji nije voditelj ničega: nema prijava (403), referentni podaci nisu otvoreni.
      await http().get('/api/proposals').set(auth(t.pm!)).expect(403);
      await http().get(`/api/proposals/${mine}`).set(auth(t.pm!)).expect(404);
    });

    it('voditelj priprema vlastitu prijavu: osnovno, konzorcij, radni paketi, proračun, dokumenti, priprema i interna provjera', async () => {
      const org = (await http().post('/api/organisations').set(auth(t.ured!)).send({ name: `Partner ${tag}`, country: 'DE', type: 'university', nonProfit: true }).expect(201)).body.id;
      // Referentni podaci za zaslon prijave: organizacije i paket programa.
      expect(((await http().get('/api/organisations').set(auth(t.lead!)).expect(200)).body as { id: string }[]).some((o) => o.id === org)).toBe(true);
      await http().get('/api/programme-packages/horizon-europe-2021-2027').set(auth(t.lead!)).expect(200);
      let d = (await http().get(`/api/proposals/${mine}`).set(auth(t.lead!)).expect(200)).body;
      d = (await http().patch(`/api/proposals/${mine}`).set(auth(t.lead!)).send({ revision: d.revision, title: 'Prijava voditelja – nacrt 2', leadUserId: u.lead }).expect(200)).body;
      await http().patch(`/api/proposals/${mine}`).set(auth(t.lead!)).send({ leadUserId: u.lead2 }).expect(403); // voditelja mijenja ured
      await http().patch(`/api/proposals/${mine}`).set(auth(t.lead!)).send({ leadUserId: null }).expect(403);
      d = (await http().post(`/api/proposals/${mine}/members`).set(auth(t.lead!)).send({ organisationId: org, role: 'partner', confirmed: true }).expect(201)).body;
      d = (await http().post(`/api/proposals/${mine}/work-packages`).set(auth(t.lead!)).send({ title: 'Istraživanje', startMonth: 1, endMonth: 12 }).expect(201)).body;
      d = (await http().put(`/api/proposals/${mine}/budget/lines`).set(auth(t.lead!)).send({ revision: d.revision, lines: d.members.map((m: { id: string }) => ({ memberId: m.id, categoryCode: 'A.1', amount: 5_000_000 })) }).expect(200)).body;
      expect(d.budget.totals.total).toBeGreaterThan(0);
      // Istovremeno spremanje proračuna prijave: ured s ranijom revizijom dobiva 409.
      const c = await http().put(`/api/proposals/${mine}/budget/lines`).set(auth(t.ured!)).send({ revision: d.revision - 1, lines: [] }).expect(409);
      expect(c.body.conflict.updatedBy.displayName).toBe('Luka Nositelj');
      await http().post('/api/documents').set(auth(t.lead!)).field({ entityType: 'proposal', entityId: mine, title: 'Part B' }).attach('file', PDF, 'part-b.pdf').expect(201);
      expect((await http().get(`/api/documents?proposalId=${mine}`).set(auth(t.lead!)).expect(200)).body).toHaveLength(1);
      // Povjerljivi dokument prijave samo uz dozvolu institucije.
      await http().post('/api/documents').set(auth(t.lead!)).field({ entityType: 'proposal', entityId: mine, confidentiality: 'confidential' }).attach('file', PDF, 'tajno.pdf').expect(403);
      await http().post(`/api/proposals/${mine}/budget/lock`).set(auth(t.lead!)).expect(201);
      await http().post(`/api/proposals/${mine}/transition`).set(auth(t.lead!)).send({ to: 'preparation' }).expect(201);
      await http().post(`/api/proposals/${mine}/transition`).set(auth(t.lead!)).send({ to: 'internal_review' }).expect(201);
    });

    it('radnje institucije ostaju uredu: nova prijava, povlačenje, predaja, ishod, ugovaranje', async () => {
      await http().post('/api/proposals').set(auth(t.lead!)).send({ packageId: 'horizon-europe-2021-2027', actionType: 'RIA', acronym: 'NOVA', title: 'Nova prijava' }).expect(403);
      await http().post(`/api/proposals/${mine}/transition`).set(auth(t.lead!)).send({ to: 'withdrawn' }).expect(403);
      await http().post(`/api/proposals/${mine}/submit`).set(auth(t.lead!)).send({ portal: 'EU F&T', reference: 'X-1' }).expect(403);
      await http().post(`/api/proposals/${mine}/outcome`).set(auth(t.lead!)).send({ result: 'funded' }).expect(403);
      await http().post(`/api/proposals/${mine}/contract`).set(auth(t.lead!)).send({}).expect(403);
      // Portfelj: voditelj s ulogom na projektu vidi u prijavama samo vlastitu.
      await owner.query(`update proposals set lead_user_id = $1 where id = $2`, [u.pm, other]);
      const pf = (await http().get('/api/portfolio').set(auth(t.pm!)).expect(200)).body;
      expect(pf.pipeline.proposals.map((p: { id: string }) => p.id)).toEqual([other]);
      // Promjena voditelja vrijedi odmah (bez nove prijave): prijašnji voditelj više ne vidi prijavu.
      await http().get(`/api/proposals/${other}`).set(auth(t.lead2!)).expect(404);
    });
  });

  describe('5. valjanost paketa programa', () => {
    const pkg = (id: string, meta: Record<string, unknown>) => ({
      meta: { id, extends: 'npoo-2021-2026', programme: `Poziv ${id}`, version: '1.0.0', language: 'hr', ...meta },
      actionTypes: [], costCategories: [], reporting: { periodMonths: 6, submissionDeadlineDays: 30 },
    });
    const publish = async (body: unknown) => { const row = (await http().post('/api/programme-packages').set(auth(t.ured!)).send(body).expect(201)).body; await http().post(`/api/programme-packages/${row.id}/publish`).set(auth(t.ured!)).expect(201); };

    it('paket koji još ne vrijedi blokira projekt i prijavu (400); istekao paket se prihvaća uz odstupanja u odgovoru', async () => {
      await publish(pkg(`buduci-${tag}`, { validFrom: '2099-01-01' }));
      const r = await http().post('/api/projects').set(auth(t.ured!)).send({ acronym: 'RANO', title: 'Prerani projekt', packageId: `buduci-${tag}`, actionType: 'BESPOVRATNA' }).expect(400);
      expect(r.body.message).toMatch(/vrijedi tek od 01\. 01\. 2099\./);
      await http().post('/api/proposals').set(auth(t.ured!)).send({ packageId: `buduci-${tag}`, actionType: 'BESPOVRATNA', acronym: 'RANO', title: 'Prerana prijava' }).expect(400);

      await publish(pkg(`istekli-${tag}`, { validFrom: '2024-01-01', validTo: '2025-06-30' }));
      const p = (await http().post('/api/projects').set(auth(t.ured!)).send({ acronym: 'KASNO', title: 'Projekt na isteklom pozivu', packageId: `istekli-${tag}`, actionType: 'BESPOVRATNA', startDate: '2026-01-01', durationMonths: 24 }).expect(201)).body;
      expect(p.deviations.map((d: { key: string }) => d.key)).toEqual(['validity', 'rule:npoo-end-date']);
      expect(p.deviations[0].message).toMatch(/Početak projekta \(01\. 01\. 2026\.\) je izvan razdoblja valjanosti paketa/);
      // Odstupanja se računaju iznova: početak unutar valjanosti i kraj do 30. 6. 2026. → bez odstupanja.
      const fixed = (await http().patch(`/api/projects/${p.id}`).set(auth(t.ured!)).send({ startDate: '2025-01-01', durationMonths: 12 }).expect(200)).body;
      expect(fixed.deviations).toEqual([]);
      const pr = (await http().post('/api/proposals').set(auth(t.ured!)).send({ packageId: `istekli-${tag}`, actionType: 'BESPOVRATNA', acronym: 'KASNA', title: 'Prijava na isteklom pozivu' }).expect(201)).body;
      expect(pr.deviations).toEqual([expect.objectContaining({ key: 'validity', severity: 'warning', message: expect.stringMatching(/vrijedio je do 30\. 06\. 2025\./) })]);
    });

    it('zastario paket i dalje blokira', async () => {
      await publish(pkg(`zastarjeli-${tag}`, { validFrom: '2024-01-01' }));
      await owner.query(`update programme_packages set status = 'deprecated' where package_id = $1`, [`zastarjeli-${tag}`]);
      await http().post('/api/projects').set(auth(t.ured!)).send({ acronym: 'STARO', title: 'Projekt', packageId: `zastarjeli-${tag}`, actionType: 'BESPOVRATNA' }).expect(400);
    });
  });

  describe('6. „danas” u zoni institucije', () => {
    it('ZNS za razdoblje koje završava 30. 9.: u 23:30 po zagrebačkom vremenu rana predaja, u 00:30 više nije (u UTC-u je još 30. 9.)', async () => {
      const p = (await http().post('/api/projects').set(auth(t.ured!)).send({ acronym: 'PONOC', title: 'Projekt oko ponoći', packageId: 'horizon-europe-2021-2027', actionType: 'RIA', contractNo: `GA-P-${tag}`, startDate: '2026-04-01', durationMonths: 24 }).expect(201)).body;
      await http().post(`/api/projects/${p.id}/transition`).set(auth(t.ured!)).send({ to: 'active' }).expect(201);
      const rp = (await http().get(`/api/projects/${p.id}`).set(auth(t.ured!)).expect(200)).body.reportingPeriods[0];
      expect(rp.endDate).toBe('2027-09-30'); // HE: razdoblje 18 mjeseci
      const claim = (await http().post(`/api/projects/${p.id}/claims`).set(auth(t.fin!)).send({ period: 1 }).expect(201)).body.id;
      let token = '';
      const early = async () => (await http().get(`/api/projects/${p.id}/claims/${claim}`).set(auth(token)).expect(200)).body.checklist.early as boolean;
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2027-09-30T21:30:00Z')); // 23:30 u Zagrebu (CEST)
        token = await login(`fin@${slug}.hr`); // token i sesija u „pomaknutom” vremenu
        expect(await early()).toBe(true);
        vi.setSystemTime(new Date('2027-09-30T22:30:00Z')); // 00:30 1. 10. u Zagrebu, u UTC-u još 30. 9.
        expect(await early()).toBe(false);
        // Postavka institucije: druga zona (npr. UTC) – isti trenutak je još 30. 9.
        await owner.query(`update tenants set settings = settings || '{"timeZone":"UTC"}'::jsonb where id = $1`, [tenantId]);
        expect(await early()).toBe(true);
        await owner.query(`update tenants set settings = settings - 'timeZone' where id = $1`, [tenantId]);
        expect(await early()).toBe(false);
        const pf = (await http().get('/api/portfolio').set(auth(token)).expect(200)).body;
        expect(pf.today).toBe('2027-10-01');
      } finally { vi.useRealTimers(); }
    });
  });

  describe('7. jedinstvenost dodjela uloga', () => {
    it('ista uloga istom korisniku u istom opsegu samo jednom – i u bazi (institucija i projekt)', async () => {
      const dup = await http().post('/api/users').set(auth(t.admin!)).send({ email: `dvostruki@${slug}.hr`, displayName: 'Dvostruki', password: PW, roleCodes: ['finance', 'finance'] }).expect(201);
      expect(dup.body.id).toBeTruthy();
      const { rows } = await owner.query<{ n: number }>('select count(*)::int as n from role_assignments where user_id = $1', [dup.body.id]);
      expect(rows[0]!.n).toBe(1);
      const role = (await owner.query<{ id: string; role_id: string }>('select id, role_id from role_assignments where user_id = $1', [dup.body.id])).rows[0]!;
      await expect(owner.query('insert into role_assignments (tenant_id, user_id, role_id) values ($1, $2, $3)', [tenantId, dup.body.id, role.role_id])).rejects.toThrow(/role_assignments_scope_uq/);
      await owner.query('insert into role_assignments (tenant_id, user_id, role_id, project_id) values ($1, $2, $3, $4)', [tenantId, dup.body.id, role.role_id, pid]);
      await expect(owner.query('insert into role_assignments (tenant_id, user_id, role_id, project_id) values ($1, $2, $3, $4)', [tenantId, dup.body.id, role.role_id, pid])).rejects.toThrow(/role_assignments_scope_uq/);
    });
  });

  describe('2. pregled revizije', () => {
    it('samo uz audit:read; najnoviji prvi, filtri i keyset paginacija', async () => {
      await http().get('/api/audit').set(auth(t.pm!)).expect(403);
      await http().get('/api/audit').set(auth(t.fin!)).expect(403);
      const all = (await http().get('/api/audit?limit=5').set(auth(t.ured!)).expect(200)).body as { id: number; at: string }[];
      expect(all).toHaveLength(5);
      expect(all.map((e) => e.id)).toEqual([...all.map((e) => e.id)].sort((a, b) => b - a));
      const next = (await http().get(`/api/audit?limit=5&before=${all[4]!.id}`).set(auth(t.ured!)).expect(200)).body as { id: number }[];
      expect(next.every((e) => e.id < all[4]!.id)).toBe(true);
      const byUser = (await http().get(`/api/audit?actorId=${u.lead}&entity=proposal`).set(auth(t.ured!)).expect(200)).body as { actor: { displayName: string }; entity: string; action: string }[];
      expect(byUser.length).toBeGreaterThan(3);
      expect(byUser.every((e) => e.actor.displayName === 'Luka Nositelj' && e.entity === 'proposal')).toBe(true);
      expect(byUser.map((e) => e.action)).toEqual(expect.arrayContaining(['budget.replace', 'member.add', 'work_package.add', 'transition']));
      const one = (await http().get(`/api/audit?entity=project&entityId=${pid}&action=update`).set(auth(t.ured!)).expect(200)).body as { diff: { before: { title: string }; after: { title: string } } }[];
      expect(one[0]!.diff.before.title).toBe('Projekt bez iznenađenja'); expect(one[0]!.diff.after.title).toBe('Novi naslov projekta');
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zagreb' });
      expect(((await http().get(`/api/audit?from=${today}&to=${today}&limit=500`).set(auth(t.ured!)).expect(200)).body as unknown[]).length).toBeGreaterThan(10);
      expect((await http().get('/api/audit?from=2000-01-01&to=2000-01-02').set(auth(t.ured!)).expect(200)).body).toEqual([]);
      await http().get('/api/audit?from=17.11.2026').set(auth(t.ured!)).expect(400);
      const facets = (await http().get('/api/audit/facets').set(auth(t.ured!)).expect(200)).body;
      expect(facets.entities).toEqual(expect.arrayContaining(['project', 'proposal', 'timesheet', 'team_member']));
      expect(facets.actors.map((a: { displayName: string }) => a.displayName)).toEqual(expect.arrayContaining(['Ana Ured', 'Luka Nositelj']));
    });

    it('plaće samo uz personnel:read: revizor bez te dozvole vidi da je plaća promijenjena, ali ne iznos ni izvedene troškove osoblja', async () => {
      await http().patch(`/api/projects/${pid}/team/${noAccount}`).set(auth(t.fin!)).send({ annualCost: 3_900_000 }).expect(200);
      const q = `/api/audit?entity=team_member&entityId=${noAccount}`;
      const full = (await http().get(q).set(auth(t.ured!)).expect(200)).body as { action: string; diff: { before?: Record<string, unknown>; after: Record<string, unknown> }; redacted: boolean }[];
      const upd = full.find((e) => e.action === 'update')!;
      expect(upd.diff.before!.annualCostCents).toBe(3_600_000); expect(upd.diff.after.annualCostCents).toBe(3_900_000); expect(upd.redacted).toBe(false);
      expect(full.find((e) => e.action === 'create')!.diff.after.annualCostCents).toBe(3_600_000);
      const hidden = (await http().get(q).set(auth(t.auditor!)).expect(200)).body as typeof full;
      const h = hidden.find((e) => e.action === 'update')!;
      expect(h.diff.before!.annualCostCents).toBe('[skriveno]'); expect(h.diff.after.annualCostCents).toBe('[skriveno]'); expect(h.redacted).toBe(true);
      expect(JSON.stringify(hidden)).not.toMatch(/3600000|3900000/);
      // Odobrenje timesheeta: trošak osoblja po radnom paketu otkriva satnicu – skriven; sati ostaju vidljivi.
      const approvals = (await http().get('/api/audit?entity=timesheet&action=approve').set(auth(t.auditor!)).expect(200)).body as { diff: { meta: { expenses: { minutes: number; amount: unknown }[] } } }[];
      expect(approvals.length).toBeGreaterThan(0);
      expect(approvals.flatMap((a) => a.diff.meta.expenses).every((x) => x.amount === '[skriveno]' && x.minutes > 0)).toBe(true);
      const visible = (await http().get('/api/audit?entity=timesheet&action=approve').set(auth(t.ured!)).expect(200)).body as typeof approvals;
      expect(visible.flatMap((a) => a.diff.meta.expenses).every((x) => typeof x.amount === 'number')).toBe(true);
      // CSV izvoz revizora isto skriva.
      const csv = await http().get(`/api/audit/export.csv?entity=team_member&entityId=${noAccount}`).set(auth(t.auditor!)).expect(200);
      expect(csv.text).not.toMatch(/3600000|3900000/);
    });

    it('tajne se nikad ne upisuju ni ne prikazuju (lozinke, MFA, tokeni)', async () => {
      await http().post(`/api/users/${u.lead2}/reset-password`).set(auth(t.admin!)).send({ newPassword: 'Zuta-Lampa-Na-Stolu-9' }).expect(201);
      const { rows } = await owner.query<{ diff: unknown }>(`select diff from audit_entries where tenant_id = $1`, [tenantId]);
      const all = JSON.stringify(rows);
      expect(all).not.toMatch(/scrypt|Zuta-Lampa|Plava-Staza|mfa_secret|passwordHash|"password"/i);
      const users = (await http().get('/api/audit?entity=user&limit=500').set(auth(t.admin!)).expect(200)).body;
      expect(JSON.stringify(users)).not.toMatch(/scrypt|passwordHash|mfaSecret/i);
    });

    it('CSV izvoz filtriranog rezultata: UTF-8 s BOM-om, separator „;”, izvoz se revidira, čitanje ne', async () => {
      const count = async () => Number((await owner.query<{ n: number }>(`select count(*)::int as n from audit_entries where tenant_id = $1`, [tenantId])).rows[0]!.n);
      const before = await count();
      await http().get('/api/audit?limit=50').set(auth(t.ured!)).expect(200);
      await http().get('/api/audit/facets').set(auth(t.ured!)).expect(200);
      expect(await count()).toBe(before); // čitanje revizije se ne revidira
      const r = await http().get(`/api/audit/export.csv?entity=proposal&actorId=${u.lead}`).set(auth(t.ured!)).buffer(true)
        .parse((res, cb) => { const parts: Buffer[] = []; res.on('data', (c: Buffer) => parts.push(c)); res.on('end', () => cb(null, Buffer.concat(parts))); }).expect(200);
      expect(r.headers['content-type']).toMatch(/text\/csv; charset=utf-8/);
      expect(String(r.headers['content-disposition'])).toMatch(/attachment; filename="revizija_\d{4}-\d{2}-\d{2}\.csv"/);
      const body = r.body as Buffer;
      expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const lines = body.toString('utf8').replace(/^\uFEFF/, '').trim().split('\r\n');
      expect(lines[0]).toBe('id;vrijeme;korisnik;vrsta korisnika;entitet;id entiteta;radnja;prije;poslije;dodatno;IP adresa');
      expect(lines.length).toBeGreaterThan(4);
      expect(lines.slice(1).every((l) => l.includes(';Luka Nositelj;') && l.includes(';proposal;'))).toBe(true);
      expect(await count()).toBe(before + 1);
      const exp = (await http().get('/api/audit?entity=audit&action=export').set(auth(t.ured!)).expect(200)).body as { actor: { id: string }; diff: { meta: { filters: Record<string, string>; rows: number } } }[];
      expect(exp[0]).toMatchObject({ actor: { id: u.ured }, diff: { meta: { filters: { entity: 'proposal', actorId: u.lead }, rows: lines.length - 1 } } });
      await http().get('/api/audit/export.csv').set(auth(t.fin!)).expect(403);
    });
  });

  describe('dokumenti: radnje koje bi poslužitelj odbio ne nude se', () => {
    it('dokaz troška u predanom ZNS-u nosi razlog zamrzavanja; uklanjanje se odbija', async () => {
      const e = (await http().post(`/api/projects/${pid}/expenses`).set(auth(t.fin!)).send({ categoryCode: 'C.1', date: '2027-02-10', description: 'Putni trošak', amount: 12_000 }).expect(201)).body.id;
      const doc = (await http().post('/api/documents').set(auth(t.fin!)).field({ entityType: 'expense', entityId: e, kind: 'evidence' }).attach('file', PDF, 'racun.pdf').expect(201)).body;
      expect(doc.frozen).toBeNull();
      // Trošak ulazi u zahtjev (kao pri predaji ZNS-a) – dokazi se zamrzavaju.
      const claimId = (await http().post(`/api/projects/${pid}/claims`).set(auth(t.fin!)).send({ period: 1 }).expect(201)).body.id;
      await owner.query(`update expenses set status = 'claimed', claim_id = $1 where id = $2`, [claimId, e]);
      const list = (await http().get(`/api/documents?entityType=expense&entityId=${e}`).set(auth(t.fin!)).expect(200)).body as { id: string; frozen: string | null }[];
      expect(list[0]!.frozen).toMatch(/zamrznuti/);
      await http().delete(`/api/documents/${doc.id}`).set(auth(t.fin!)).expect(409);
    });
  });
});
