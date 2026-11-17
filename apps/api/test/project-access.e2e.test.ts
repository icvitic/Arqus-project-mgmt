import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { buildAccessFixture, PDF, type AccessFixture } from './access-fixture';

/**
 * WP1.14 – pristup po projektu: „voditelj projekta A ne vidi projekt B” u svim modulima.
 * Korisnici: pm (voditelj samo na A), tm (član tima samo na A), fin (financije – institucija), rdr (čitatelj – institucija).
 */
describe('Pristup po projektu (WP1.14, e2e)', () => {
  let app: INestApplication; let f: AccessFixture;
  const tag = randomUUID().slice(0, 8);
  const http = () => request(app.getHttpServer());
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const ids = (body: { id: string }[]) => body.map((x) => x.id).sort();

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), 'arqus-access-'));
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    f = await buildAccessFixture(app, `pa-${tag}`);
  }, 60_000);
  afterAll(async () => { await app.close(); });

  it('/me i dodjele: voditelj i član tima nemaju dozvola institucije, imaju ih samo na A (dodijeljene imenovanjem i dodavanjem u tim)', async () => {
    const pm = (await http().get('/api/me').set(as(f.tokens.pm)).expect(200)).body;
    expect(pm.permissions).toEqual([]);
    expect(Object.keys(pm.projectPermissions)).toEqual([f.A.id]);
    expect(pm.projectPermissions[f.A.id]).toEqual(expect.arrayContaining(['projects:write', 'timesheets:approve', 'documents:confidential']));
    expect(pm.projectPermissions[f.A.id]).not.toContain('personnel:read');
    const tm = (await http().get('/api/me').set(as(f.tokens.tm)).expect(200)).body;
    expect(Object.keys(tm.projectPermissions)).toEqual([f.A.id]);
    expect(tm.projectPermissions[f.A.id]).not.toContain('documents:confidential');
    const fin = (await http().get('/api/me').set(as(f.tokens.fin)).expect(200)).body;
    expect(fin.permissions).toEqual(expect.arrayContaining(['finance:write', 'personnel:read', 'documents:write', 'documents:confidential']));
    expect(fin.projectPermissions).toEqual({});
    const users = (await http().get('/api/users').set(as(f.tokens.admin)).expect(200)).body as { id: string; roles: string[]; projectRoles: { code: string; projectId: string }[] }[];
    expect(users.find((u) => u.id === f.users.pm)).toMatchObject({ roles: [], projectRoles: [expect.objectContaining({ code: 'project-manager', projectId: f.A.id })] });
    expect(users.find((u) => u.id === f.users.tm)).toMatchObject({ roles: [], projectRoles: [expect.objectContaining({ code: 'team-member', projectId: f.A.id })] });
  });

  it('popisi: projekti i dokumenti samo s pristupom; institucijske uloge vide sve', async () => {
    expect(ids((await http().get('/api/projects').set(as(f.tokens.pm)).expect(200)).body)).toEqual([f.A.id]);
    expect(ids((await http().get('/api/projects').set(as(f.tokens.tm)).expect(200)).body)).toEqual([f.A.id]);
    for (const t of [f.tokens.fin, f.tokens.rdr, f.tokens.admin]) {
      expect(ids((await http().get('/api/projects').set(as(t)).expect(200)).body)).toEqual(expect.arrayContaining([f.A.id, f.B.id]));
    }
    expect((await http().get('/api/projects').set(as(f.tokens.extra)).expect(403)).body.message).toMatch(/projects:read/);
    await http().get(`/api/documents?projectId=${f.B.id}`).set(as(f.tokens.pm)).expect(404);
    await http().get(`/api/documents?projectId=${f.B.id}`).set(as(f.tokens.tm)).expect(404);
    await http().get(`/api/documents?entityType=expense&entityId=${f.B.expense}`).set(as(f.tokens.pm)).expect(404);
    await http().get(`/api/documents?entityType=claim&entityId=${f.B.claim}`).set(as(f.tokens.pm)).expect(404);
    // Tuđi id u kombinaciji s vlastitim projektom ne prolazi tiho.
    await http().get(`/api/documents?projectId=${f.A.id}&entityType=expense&entityId=${f.B.expense}`).set(as(f.tokens.pm)).expect(404);
    await http().get(`/api/documents?entityType=deliverable&entityId=${f.B.deliverable}`).set(as(f.tokens.pm)).expect(404);
    await http().get(`/api/documents?projectId=${f.A.id}`).set(as(f.tokens.rdr)).expect(403); // čitatelj nema documents:read
  });

  it('voditelj samo na A: svi moduli projekta B → 404 (kao nepostojeći), projekt A radi', async () => {
    const t = as(f.tokens.pm); const B = f.B;
    for (const path of ['', '/structure', '/budget', '/team', `/team/${B.member}/timesheets/${f.month}`, '/expenses', '/finance', '/claims', `/claims/${B.claim}`, '/access']) {
      await http().get(`/api/projects/${B.id}${path}`).set(t).expect(404);
      await http().get(`/api/projects/${f.A.id}${path === `/team/${B.member}/timesheets/${f.month}` ? `/team/${f.A.member}/timesheets/${f.month}` : path === `/claims/${B.claim}` ? `/claims/${f.A.claim}` : path}`).set(t).expect(200);
    }
    await http().patch(`/api/projects/${B.id}`).set(t).send({ title: 'Preuzeto' }).expect(404);
    await http().post(`/api/projects/${B.id}/work-packages`).set(t).send({ title: 'Upad', startMonth: 1, endMonth: 2 }).expect(404);
    await http().patch(`/api/projects/${B.id}/tasks/${B.task}`).set(t).send({ status: 'done' }).expect(404);
    await http().patch(`/api/projects/${B.id}/risks/${B.risk}`).set(t).send({ status: 'closed' }).expect(404);
    await http().put(`/api/projects/${B.id}/budget/lines`).set(t).send({ lines: [] }).expect(404);
    await http().post(`/api/projects/${B.id}/expenses`).set(t).send({ categoryCode: 'VU', date: '2027-02-01', description: 'Upad', amount: 1 }).expect(404);
    await http().post(`/api/projects/${B.id}/claims/${B.claim}/submit`).set(t).expect(404);
    await http().post(`/api/projects/${B.id}/team/${B.member}/timesheets/${f.month}/approve`).set(t).expect(404);
    await http().post(`/api/projects/${B.id}/transition`).set(t).send({ to: 'suspended' }).expect(404);
    // Id-jevi projekta B kroz putanju projekta A: entitet mora pripadati projektu iz putanje.
    await http().patch(`/api/projects/${f.A.id}/tasks/${B.task}`).set(t).send({ status: 'done' }).expect(404);
    await http().patch(`/api/projects/${f.A.id}/expenses/${B.expense}`).set(t).send({ amount: 1 }).expect(404);
    await http().get(`/api/projects/${f.A.id}/claims/${B.claim}`).set(t).expect(404);
    await http().get(`/api/projects/${f.A.id}/team/${B.member}/timesheets/${f.month}`).set(t).expect(404);
    await http().post(`/api/projects/${f.A.id}/team/${B.member}/timesheets/${f.month}/approve`).set(t).expect(404);
    await http().patch(`/api/projects/${f.A.id}/team/${B.member}`).set(t).send({ fullName: 'Preimenovan' }).expect(404);
    // Id-jevi projekta B u tijelu zahtjeva.
    await http().post(`/api/projects/${f.A.id}/team`).set(t).send({ fullName: 'Tuđi partner', partnerId: B.self }).expect(404);
    await http().post(`/api/projects/${f.A.id}/claims`).set(t).send({ period: 2, partnerId: B.self }).expect(404);
    expect((await http().post(`/api/projects/${f.A.id}/expenses`).set(t).send({ categoryCode: 'VU', workPackageId: B.wp, date: '2027-02-01', description: 'Krivi WP', amount: 1 }).expect(400)).body.issues.join(' ')).toMatch(/nije na projektu/);
    await http().put(`/api/projects/${f.A.id}/team/${f.A.pmMember}/timesheets/2027-03`).set(t).send({ revision: 0, entries: [{ day: 1, minutes: 60, workPackageId: B.wp }] }).expect(400);
    // Projekt A: voditelj radi strukturu, troškove i timesheetove.
    await http().post(`/api/projects/${f.A.id}/work-packages`).set(t).send({ title: 'Diseminacija', startMonth: 1, endMonth: 12 }).expect(201);
    await http().post(`/api/projects/${f.A.id}/expenses`).set(t).send({ categoryCode: 'VU', date: '2027-03-01', description: 'Prijevod', amount: 10_000 }).expect(201);
  });

  it('dokumenti projekta B: izravan pristup, preuzimanje, nova verzija, izmjena i prijenos → 404', async () => {
    for (const tok of [f.tokens.pm, f.tokens.tm]) {
      const t = as(tok);
      await http().get(`/api/documents/${f.B.doc}`).set(t).expect(404);
      await http().get(`/api/documents/${f.B.doc}/download`).set(t).expect(404);
      await http().get(`/api/documents/${f.B.doc}/versions/1/download`).set(t).expect(404);
      await http().patch(`/api/documents/${f.B.doc}`).set(t).send({ title: 'x' }).expect(404);
      await http().delete(`/api/documents/${f.B.doc}`).set(t).expect(404);
      await http().post(`/api/documents/${f.B.doc}/versions`).set(t).attach('file', Buffer.from('%PDF-1.7\nv2\n%%EOF\n'), 'v2.pdf').expect(404);
      for (const [entityType, entityId] of [['project', f.B.id], ['expense', f.B.expense], ['deliverable', f.B.deliverable], ['claim', f.B.claim]]) {
        await http().post('/api/documents').set(t).field('entityType', entityType!).field('entityId', entityId!).attach('file', PDF, 'upad.pdf').expect(404);
      }
    }
  });

  it('povjerljivi dokumenti: voditelj i financije ih vide; član tima i bez dozvole – nema ih u popisu ni u brojanju, izravno 404', async () => {
    const titles = async (tok: string) => ((await http().get(`/api/documents?projectId=${f.A.id}`).set(as(tok)).expect(200)).body as { id: string }[]).map((d) => d.id);
    expect(await titles(f.tokens.pm)).toEqual(expect.arrayContaining([f.A.doc, f.A.confidentialDoc, f.A.evidence]));
    expect(await titles(f.tokens.fin)).toEqual(expect.arrayContaining([f.A.confidentialDoc, f.A.evidence]));
    const tmDocs = await titles(f.tokens.tm);
    expect(tmDocs).toContain(f.A.doc); expect(tmDocs).not.toContain(f.A.confidentialDoc); expect(tmDocs).not.toContain(f.A.evidence);
    expect((await http().get(`/api/documents?entityType=expense&entityId=${f.A.expense}`).set(as(f.tokens.tm)).expect(200)).body).toEqual([]);
    await http().get(`/api/documents/${f.A.confidentialDoc}`).set(as(f.tokens.tm)).expect(404);
    await http().get(`/api/documents/${f.A.confidentialDoc}/download`).set(as(f.tokens.tm)).expect(404);
    await http().get(`/api/documents/${f.A.confidentialDoc}`).set(as(f.tokens.pm)).expect(200);
    await http().get(`/api/documents/${f.A.confidentialDoc}/download`).set(as(f.tokens.fin)).expect(200);
    // Brojanje dokaza uz trošak (troškovi, ZNS) ne odaje povjerljive dokumente.
    const evidence = async (tok: string) => ((await http().get(`/api/projects/${f.A.id}/expenses`).set(as(tok)).expect(200)).body as { id: string; documents: number }[]).find((e) => e.id === f.A.expense)!.documents;
    expect(await evidence(f.tokens.pm)).toBe(1); expect(await evidence(f.tokens.rdr)).toBe(0);
    const claimFor = async (tok: string) => (await http().get(`/api/projects/${f.A.id}/claims/${f.A.claim}`).set(as(tok)).expect(200)).body;
    const rdrMissing = (await claimFor(f.tokens.rdr)).missingEvidence; const pmMissing = (await claimFor(f.tokens.pm)).missingEvidence;
    expect(rdrMissing).toBe(pmMissing + 1); // trošak s povjerljivim dokazom čitatelju (bez documents:confidential) izgleda kao trošak bez dokaza
    // Član tima nema uvid u financije projekta (iz troškova osoblja mogle bi se izračunati tuđe satnice).
    for (const path of ['/expenses', '/finance', '/budget', '/claims', `/claims/${f.A.claim}`]) await http().get(`/api/projects/${f.A.id}${path}`).set(as(f.tokens.tm)).expect(403);
    // Član tima smije priložiti dokument, ali ne i označiti ga povjerljivim; ne može otkriti povjerljivi skidanjem oznake.
    await http().post('/api/documents').set(as(f.tokens.tm)).field('entityType', 'project').field('entityId', f.A.id).field('confidentiality', 'confidential').attach('file', PDF, 'tajno.pdf').expect(403);
    const own = (await http().post('/api/documents').set(as(f.tokens.tm)).field('entityType', 'project').field('entityId', f.A.id).attach('file', PDF, 'zapisnik.pdf').expect(201)).body.id;
    await http().patch(`/api/documents/${own}`).set(as(f.tokens.tm)).send({ confidentiality: 'confidential' }).expect(403);
    await http().patch(`/api/documents/${f.A.confidentialDoc}`).set(as(f.tokens.tm)).send({ confidentiality: 'internal' }).expect(404);
  });

  it('član tima samo na A: čita projekt, vodi samo vlastiti timesheet, ne mijenja strukturu ni financije; B → 404', async () => {
    const t = as(f.tokens.tm);
    await http().get(`/api/projects/${f.A.id}/structure`).set(t).expect(200);
    await http().post(`/api/projects/${f.A.id}/work-packages`).set(t).send({ title: 'X', startMonth: 1, endMonth: 2 }).expect(403);
    await http().put(`/api/projects/${f.A.id}/budget/lines`).set(t).send({ lines: [] }).expect(403);
    await http().post(`/api/projects/${f.A.id}/expenses`).set(t).send({ categoryCode: 'VU', date: '2027-02-01', description: 'X', amount: 1 }).expect(403);
    await http().post(`/api/projects/${f.A.id}/team`).set(t).send({ fullName: 'X' }).expect(403);
    await http().put(`/api/projects/${f.A.id}/team/${f.A.pmMember}/timesheets/2027-03`).set(t).send({ revision: 0, entries: [] }).expect(403); // tuđi
    await http().put(`/api/projects/${f.A.id}/team/${f.A.member}/timesheets/2027-03`).set(t).send({ revision: 0, entries: [{ day: 1, minutes: 60 }] }).expect(200); // vlastiti
    await http().post(`/api/projects/${f.A.id}/team/${f.A.member}/timesheets/${f.month}/approve`).set(t).expect(403);
    await http().get(`/api/projects/${f.A.id}/access`).set(t).expect(403);
    for (const path of ['', '/structure', '/team', '/expenses', '/claims']) await http().get(`/api/projects/${f.B.id}${path}`).set(t).expect(404);
    await http().put(`/api/projects/${f.B.id}/team/${f.B.member}/timesheets/2027-03`).set(t).send({ entries: [] }).expect(404);
  });

  it('plaće: vide ih i upisuju samo uloge s personnel:read; voditelj bez nje dodaje člana bez troška, financije ga upisuju', async () => {
    const cost = async (tok: string, pid: string) => ((await http().get(`/api/projects/${pid}/team`).set(as(tok)).expect(200)).body as { id: string; annualCost: number | null; costSet: boolean }[]);
    expect((await cost(f.tokens.pm, f.A.id)).every((m) => m.annualCost === null && m.costSet)).toBe(true);
    expect((await cost(f.tokens.tm, f.A.id)).every((m) => m.annualCost === null)).toBe(true);
    expect((await cost(f.tokens.fin, f.B.id)).every((m) => (m.annualCost ?? 0) > 0)).toBe(true);
    await http().get(`/api/projects/${f.A.id}/team`).set(as(f.tokens.rdr)).expect(403); // čitatelj nema timesheets:read
    await http().post(`/api/projects/${f.A.id}/team`).set(as(f.tokens.pm)).send({ fullName: 'Nova osoba', annualCost: 4_000_000 }).expect(403);
    const added = (await http().post(`/api/projects/${f.A.id}/team`).set(as(f.tokens.pm)).send({ fullName: 'Nova osoba', userId: f.users.extra }).expect(201)).body;
    expect(added).toMatchObject({ annualCost: null, costSet: false });
    await http().patch(`/api/projects/${f.A.id}/team/${added.id}`).set(as(f.tokens.pm)).send({ annualCost: 1 }).expect(403);
    await http().patch(`/api/projects/${f.A.id}/team/${added.id}`).set(as(f.tokens.pm)).send({ role: 'asistentica' }).expect(200);
    // Bez upisanog troška timesheet se ne može odobriti (trošak osoblja ne bi bio točan).
    const extra = as(f.tokens.extra); // dodavanjem u tim dobio je ulogu člana tima na A
    expect(ids((await http().get('/api/projects').set(extra).expect(200)).body)).toEqual([f.A.id]);
    await http().put(`/api/projects/${f.A.id}/team/${added.id}/timesheets/${f.month}`).set(extra).send({ revision: 0, entries: [{ day: 3, minutes: 120 }] }).expect(200);
    await http().post(`/api/projects/${f.A.id}/team/${added.id}/timesheets/${f.month}/submit`).set(extra).expect(201);
    expect((await http().post(`/api/projects/${f.A.id}/team/${added.id}/timesheets/${f.month}/approve`).set(as(f.tokens.pm)).expect(409)).body.message).toMatch(/godišnji trošak/);
    const upd = (await http().patch(`/api/projects/${f.A.id}/team/${added.id}`).set(as(f.tokens.fin)).send({ annualCost: 3_440_000 }).expect(200)).body;
    expect(upd).toMatchObject({ annualCost: 3_440_000, costSet: true });
    await http().post(`/api/projects/${f.A.id}/team/${added.id}/timesheets/${f.month}/approve`).set(as(f.tokens.pm)).expect(201);
    // Financije: unos s troškom na bilo kojem projektu.
    await http().post(`/api/projects/${f.B.id}/team`).set(as(f.tokens.fin)).send({ fullName: 'Računovodstvo B', annualCost: 3_000_000 }).expect(201);
  });

  it('nema samoodobrenja: voditelj ne odobrava vlastiti timesheet, odobrava tuđi; administrator odobrava voditeljev', async () => {
    expect((await http().post(`/api/projects/${f.A.id}/team/${f.A.pmMember}/timesheets/${f.month}/approve`).set(as(f.tokens.pm)).expect(403)).body.message).toMatch(/vlastiti/);
    await http().post(`/api/projects/${f.A.id}/team/${f.A.member}/timesheets/${f.month}/approve`).set(as(f.tokens.pm)).expect(201);
    await http().post(`/api/projects/${f.A.id}/team/${f.A.pmMember}/timesheets/${f.month}/approve`).set(as(f.tokens.admin)).expect(201);
  });

  it('financije (institucija): troškovi i dokazi na svim projektima, plaće vidljive; bez strukture, odobrenja i upravljanja pristupom', async () => {
    const t = as(f.tokens.fin);
    const e = (await http().post(`/api/projects/${f.B.id}/expenses`).set(t).send({ categoryCode: 'VU', date: '2027-03-05', description: 'Račun B', amount: 20_000 }).expect(201)).body.id;
    await http().post('/api/documents').set(t).field('entityType', 'expense').field('entityId', e).field('kind', 'evidence').attach('file', PDF, 'racun-b.pdf').expect(201);
    await http().get(`/api/projects/${f.A.id}/finance`).set(t).expect(200);
    await http().post(`/api/projects/${f.A.id}/work-packages`).set(t).send({ title: 'X', startMonth: 1, endMonth: 2 }).expect(403);
    await http().post(`/api/projects/${f.B.id}/team/${f.B.member}/timesheets/${f.month}/approve`).set(t).expect(403);
    await http().get(`/api/projects/${f.A.id}/access`).set(t).expect(403);
    await http().post('/api/projects').set(t).send({}).expect(403);
  });

  it('čitatelj (institucija): čita projekte i financije svih projekata, ništa ne mijenja', async () => {
    const t = as(f.tokens.rdr);
    for (const pid of [f.A.id, f.B.id]) {
      await http().get(`/api/projects/${pid}`).set(t).expect(200);
      await http().get(`/api/projects/${pid}/budget`).set(t).expect(200);
      await http().get(`/api/projects/${pid}/expenses`).set(t).expect(200);
      await http().get(`/api/projects/${pid}/finance`).set(t).expect(200);
    }
    await http().patch(`/api/projects/${f.A.id}`).set(t).send({ title: 'Čitatelj' }).expect(403);
    await http().post(`/api/projects/${f.A.id}/expenses`).set(t).send({ categoryCode: 'VU', date: '2027-02-01', description: 'X', amount: 1 }).expect(403);
    await http().get(`/api/documents/${f.A.doc}`).set(t).expect(403);
    await http().get('/api/proposals').set(t).expect(200);
  });

  it('radnje institucije traže dozvolu institucije – uloga na projektu ne dostaje', async () => {
    const t = as(f.tokens.pm);
    await http().post('/api/projects').set(t).send({ acronym: 'NOVI', title: 'Novi projekt', packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA' }).expect(403);
    for (const path of ['/api/proposals', '/api/users', '/api/roles', '/api/calls', '/api/audit']) await http().get(path).set(t).expect(403);
    await http().post('/api/organisations').set(t).send({ name: 'Org', country: 'HR' }).expect(403);
    await http().post('/api/programme-packages/validate').set(t).send({}).expect(403);
    // Referentni podaci za rad na projektu (partneri, paket) dostupni su uz dodjelu na projektu.
    await http().get('/api/organisations').set(t).expect(200);
    await http().get('/api/programme-packages/npoo-2021-2026').set(t).expect(200);
    await http().get('/api/organisations').set(as(f.tokens.extra)).expect(200); // extra je u međuvremenu član tima na A
  });

  it('upravljanje pristupom: voditelj dodjeljuje uloge na svom projektu bez eskalacije; administrator svugdje; opoziv vrijedi odmah', async () => {
    const pm = as(f.tokens.pm); const admin = as(f.tokens.admin);
    const list = (await http().get(`/api/projects/${f.A.id}/access`).set(pm).expect(200)).body;
    expect(list.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: f.users.pm, roleCode: 'project-manager', scope: 'project' }),
      expect.objectContaining({ userId: f.users.fin, roleCode: 'finance', scope: 'tenant', assignmentId: null }),
    ]));
    expect(list.roles.find((r: { code: string }) => r.code === 'tenant-admin').grantable).toBe(false);
    expect(list.roles.find((r: { code: string }) => r.code === 'team-member').grantable).toBe(true);
    await http().post(`/api/projects/${f.A.id}/access`).set(pm).send({ userId: f.users.rdr, roleCode: 'tenant-admin' }).expect(403);
    await http().post(`/api/projects/${f.A.id}/access`).set(pm).send({ userId: f.users.rdr, roleCode: 'finance' }).expect(403); // personnel:read nema ni sam
    await http().post(`/api/projects/${f.A.id}/access`).set(pm).send({ userId: f.users.pm, roleCode: 'project-office' }).expect(403); // ni sebi
    await http().post(`/api/projects/${f.B.id}/access`).set(pm).send({ userId: f.users.rdr, roleCode: 'team-member' }).expect(404);
    await http().post(`/api/projects/${f.A.id}/access`).set(pm).send({ userId: f.users.rdr, roleCode: 'team-member' }).expect(201);
    await http().post(`/api/projects/${f.A.id}/access`).set(pm).send({ userId: f.users.rdr, roleCode: 'team-member' }).expect(409);
    await http().post(`/api/projects/${f.A.id}/access`).set(pm).send({ userId: randomUUID(), roleCode: 'team-member' }).expect(404);
    // Administrator dodjeljuje na B; čitatelj je i dalje institucijski čitatelj, uz to član tima na A.
    const granted = (await http().post(`/api/projects/${f.B.id}/access`).set(admin).send({ userId: f.users.tm, roleCode: 'team-member' }).expect(201)).body;
    expect(ids((await http().get('/api/projects').set(as(f.tokens.tm)).expect(200)).body)).toEqual([f.A.id, f.B.id].sort());
    const tmOnB = granted.entries.find((e: { userId: string; scope: string }) => e.userId === f.users.tm && e.scope === 'project');
    await http().delete(`/api/projects/${f.B.id}/access/${tmOnB.assignmentId}`).set(admin).expect(200);
    await http().get(`/api/projects/${f.B.id}`).set(as(f.tokens.tm)).expect(404);
    // Dodjela s jednog projekta ne može se opozvati kroz putanju drugog projekta.
    const pmGrant = list.entries.find((e: { userId: string; scope: string }) => e.userId === f.users.pm && e.scope === 'project');
    await http().delete(`/api/projects/${f.B.id}/access/${pmGrant.assignmentId}`).set(admin).expect(404);
    // Opoziv voditeljeve dodjele: već idući zahtjev (isti token) više ne vidi projekt A.
    await http().get(`/api/projects/${f.A.id}`).set(pm).expect(200);
    await http().delete(`/api/projects/${f.A.id}/access/${pmGrant.assignmentId}`).set(admin).expect(200);
    await http().get(`/api/projects/${f.A.id}`).set(pm).expect(404);
    expect((await http().get('/api/projects').set(pm).expect(403)).body.message).toMatch(/projects:read/);
    expect((await http().get('/api/me').set(pm).expect(200)).body.projectPermissions).toEqual({});
    // Ponovna dodjela vraća pristup.
    await http().post(`/api/projects/${f.A.id}/access`).set(admin).send({ userId: f.users.pm, roleCode: 'project-manager' }).expect(201);
    await http().get(`/api/projects/${f.A.id}`).set(pm).expect(200);
    // Uloga na projektu ne utječe na zaštitu zadnjeg administratora institucije.
    const me = (await http().get('/api/me').set(admin).expect(200)).body.user.id;
    await http().patch(`/api/users/${me}`).set(admin).send({ roleCodes: ['project-office'] }).expect(409);
  });

  it('novi voditelj: imenovanje pri stvaranju i promjeni voditelja daje ulogu na projektu (ne onome tko već ima projects:write institucije)', async () => {
    const admin = as(f.tokens.admin);
    const p = (await http().post('/api/projects').set(admin).send({ acronym: `PC${tag.slice(0, 4)}`, title: 'Projekt C', packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA', managerUserId: f.users.extra }).expect(201)).body;
    expect(Object.keys((await http().get('/api/me').set(as(f.tokens.extra)).expect(200)).body.projectPermissions)).toContain(p.id);
    const rev = async () => (await http().get(`/api/projects/${p.id}`).set(admin).expect(200)).body.revision as number;
    await http().patch(`/api/projects/${p.id}`).set(admin).send({ revision: await rev(), managerUserId: f.users.tm }).expect(200);
    expect((await http().get('/api/me').set(as(f.tokens.tm)).expect(200)).body.projectPermissions[p.id]).toContain('projects:write');
    const me = (await http().get('/api/me').set(admin).expect(200)).body.user.id;
    await http().patch(`/api/projects/${p.id}`).set(admin).send({ revision: await rev(), managerUserId: me }).expect(200);
    const users = (await http().get('/api/users').set(admin).expect(200)).body as { id: string; projectRoles: { projectId: string }[] }[];
    expect(users.find((u) => u.id === me)!.projectRoles.filter((r) => r.projectId === p.id)).toEqual([]);
  });
});
