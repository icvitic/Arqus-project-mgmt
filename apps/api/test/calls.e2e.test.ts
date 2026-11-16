import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';

const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const dateIn = (n: number) => inDays(n).slice(0, 10);

describe('Radar poziva (e2e)', () => {
  let app: INestApplication; let A = ''; let B = '';
  const tag = randomUUID().slice(0, 8); const slugA = `ca-${tag}`, slugB = `cb-${tag}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (slug: string) => (await http().post('/api/auth/login').send({ tenantSlug: slug, email: `a@${slug}.hr`, password: 'Lozinka-123456' }).expect(201)).body.accessToken as string;
  let globalId = ''; let ownId = ''; let closedId = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugA, adminEmail: `a@${slugA}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugB, adminEmail: `a@${slugB}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
    const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
    globalId = (await admin.query(`insert into calls (tenant_id, code, title, programme, opens_at, deadlines, action_types) values (null, $1, 'Globalni HE poziv', 'Horizon Europe', $2, $3, '{RIA}') returning id`,
      [`HORIZON-TEST-${tag}`, dateIn(-10), JSON.stringify([{ kind: 'submission', at: inDays(30) }])])).rows[0].id;
    await admin.end();
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    A = await login(slugA); B = await login(slugB);
  });
  afterAll(async () => { await app.close(); });

  it('vlastiti poziv: unos, validacija roka, status iz datuma', async () => {
    await http().post('/api/calls').set(auth(A)).send({ code: 'X', title: 'Bez programa', programme: 'P', deadlines: [{ kind: 'submission', at: '2027-04-22 17:00' }] }).expect(400);
    const r = await http().post('/api/calls').set(auth(A)).send({
      code: `NPOO.C3.2-${tag}`, title: 'Istraživački kapaciteti za zeleni promet', programme: 'NPOO', packageId: 'npoo-2021-2026', actionTypes: ['BESPOVRATNA'],
      budget: 1_500_000_000, expectedGrants: 10, opensAt: dateIn(5), deadlines: [{ kind: 'info_day', at: inDays(10) }, { kind: 'submission', at: inDays(45) }], tags: ['promet'],
    }).expect(201);
    ownId = r.body.id;
    expect(r.body).toMatchObject({ scope: 'tenant', status: 'announced', daysToNextDeadline: 10 });
    expect(r.body.nextDeadline.kind).toBe('info_day');
    await http().post('/api/calls').set(auth(A)).send({ code: `NPOO.C3.2-${tag}`, title: 'Dupli', programme: 'NPOO' }).expect(409);
    closedId = (await http().post('/api/calls').set(auth(A)).send({ code: `STARI-${tag}`, title: 'Zatvoreni poziv', programme: 'HRZZ', deadlines: [{ kind: 'submission', at: inDays(-3) }] }).expect(201)).body.id;
  });

  it('popis: globalni i vlastiti, poredak po roku, zatvoreni na kraju, filtri', async () => {
    const list = (await http().get('/api/calls').set(auth(A)).expect(200)).body;
    const ids = list.map((c: { id: string }) => c.id);
    expect(ids.indexOf(ownId)).toBeLessThan(ids.indexOf(globalId)); // rok za 10 dana prije roka za 30
    expect(ids.indexOf(closedId)).toBeGreaterThan(ids.indexOf(globalId));
    expect(list.find((c: { id: string }) => c.id === globalId)).toMatchObject({ scope: 'global', status: 'open' });
    const open = (await http().get('/api/calls?status=closed').set(auth(A)).expect(200)).body;
    expect(open.map((c: { id: string }) => c.id)).toContain(closedId);
    const q = (await http().get('/api/calls?q=zeleni').set(auth(A)).expect(200)).body;
    expect(q.map((c: { id: string }) => c.id)).toEqual([ownId]);
  });

  it('globalni poziv se ne mijenja; vlastiti se otkazuje', async () => {
    await http().patch(`/api/calls/${globalId}`).set(auth(A)).send({ title: 'hak' }).expect(403);
    const c = await http().patch(`/api/calls/${closedId}`).set(auth(A)).send({ cancelled: true }).expect(200);
    expect(c.body.status).toBe('cancelled');
  });

  it('ocjena prikladnosti: postotak i preporuka; neispravna ocjena 400', async () => {
    await http().put(`/api/calls/${globalId}/assessment`).set(auth(A)).send({ scores: { strategic: 6, capacity: 3, probability: 3, financial: 3 } }).expect(400);
    const r = await http().put(`/api/calls/${globalId}/assessment`).set(auth(A)).send({ scores: { strategic: 5, capacity: 4, probability: 3, financial: 3 }, comment: 'dobro se uklapa' }).expect(200);
    expect(r.body.tracking.fitTotal).toBe(75);
    expect(r.body.recommendation).toBe('go');
  });

  it('odluka: go traži obrazloženje; go na zatvorenom pozivu 409; povijest odluka', async () => {
    await http().put(`/api/calls/${globalId}/decision`).set(auth(A)).send({ decision: 'go' }).expect(400);
    await http().put(`/api/calls/${closedId}/decision`).set(auth(A)).send({ decision: 'go', rationale: 'kasno' }).expect(409);
    await http().put(`/api/calls/${globalId}/decision`).set(auth(A)).send({ decision: 'watch' }).expect(200);
    const go = await http().put(`/api/calls/${globalId}/decision`).set(auth(A)).send({ decision: 'go', rationale: 'jak konzorcij, uklapa se u strategiju', internalDeadline: dateIn(20) }).expect(200);
    expect(go.body.tracking).toMatchObject({ decision: 'go', internalDeadline: dateIn(20) });
    expect(go.body.history.map((h: { action: string }) => h.action)).toEqual(['decision.go', 'decision.watch', 'assess']);
  });

  it('nadolazeći rokovi: samo praćeni pozivi, uključujući interni rok', async () => {
    const d = (await http().get('/api/calls/deadlines?days=60').set(auth(A)).expect(200)).body;
    expect(d.map((x: { kind: string }) => x.kind)).toEqual(['internal', 'submission']);
    expect(d.every((x: { callId: string }) => x.callId === globalId)).toBe(true);
  });

  it('izolacija: stanar B vidi globalni poziv bez ocjene i odluke stanara A; vlastiti poziv A je nevidljiv', async () => {
    const list = (await http().get('/api/calls').set(auth(B)).expect(200)).body;
    const ids = list.map((c: { id: string }) => c.id);
    expect(ids).toContain(globalId);
    expect(ids).not.toContain(ownId);
    expect(ids).not.toContain(closedId);
    expect(list.find((c: { id: string }) => c.id === globalId).tracking).toBeNull();
    await http().get(`/api/calls/${ownId}`).set(auth(B)).expect(404);
    await http().put(`/api/calls/${ownId}/decision`).set(auth(B)).send({ decision: 'watch' }).expect(404);
    const b = await http().put(`/api/calls/${globalId}/decision`).set(auth(B)).send({ decision: 'no_go', rationale: 'nije naše područje' }).expect(200);
    expect(b.body.tracking.decision).toBe('no_go');
    expect((await http().get(`/api/calls/${globalId}`).set(auth(A)).expect(200)).body.tracking.decision).toBe('go');
  });
});
