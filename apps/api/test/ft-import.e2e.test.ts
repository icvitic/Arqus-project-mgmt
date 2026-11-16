import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { FtResult } from '@arqus/domain';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';
import { fetchFtResults, importFtCalls } from '../src/calls/ft-import';

const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const T = (code: string, deadline: string, over: Record<string, string[]> = {}): FtResult => ({ metadata: {
  identifier: [code], callIdentifier: [code.split('-').slice(0, -1).join('-')], title: [`Tema ${code}`], frameworkProgramme: ['43108390'],
  typesOfAction: ['HORIZON Innovation Actions'], deadlineModel: ['single-stage'], startDate: ['2026-10-01T00:00:00.000+0000'], deadlineDate: [deadline], ...over,
} });

describe('Uvoz poziva s F&T (e2e)', () => {
  let app: INestApplication; let A = '';
  const tag = randomUUID().slice(0, 8).toUpperCase(); const slug = `ft-${tag.toLowerCase()}`;
  const he = `HORIZON-T${tag}-2027-01-01`; const life = `LIFE-T${tag}-2027-SAP`; const manual = `HORIZON-T${tag}-2027-01-02`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    await seedDemo({ url: ADMIN_URL, tenantSlug: slug, adminEmail: `a@${slug}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
    const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
    await admin.query(`insert into calls (tenant_id, code, title, programme) values (null, $1, 'Ručno uneseni globalni', 'Horizon Europe')`, [manual]);
    await admin.end();
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    A = (await http().post('/api/auth/login').send({ tenantSlug: slug, email: `a@${slug}.hr`, password: 'Lozinka-123456' }).expect(201)).body.accessToken;
  });
  afterAll(async () => { await app.close(); });

  it('prvi uvoz: novi globalni pozivi, ručni se ne prepisuju, istekli preskočeni', async () => {
    const r = await importFtCalls(ADMIN_URL, [
      T(he, '2027-09-16T17:00:00.000+0000'), T(life, '2027-10-01T17:00:00.000+0000', { frameworkProgramme: ['43252405'], typesOfAction: ['LIFE Standard Action Projects'] }),
      T(manual, '2027-09-16T17:00:00.000+0000'), T(`HORIZON-T${tag}-2023-OLD`, '2023-09-21T17:00:00.000+0000'),
    ], new Date('2026-11-16T00:00:00Z'));
    expect(r).toMatchObject({ fetched: 4, inserted: 2, updated: 0, keptManual: 1, skipped: { expired: 1 } });
    const list = (await http().get(`/api/calls?q=T${tag}`).set(auth(A)).expect(200)).body;
    const c = list.find((x: { code: string }) => x.code === he);
    expect(c).toMatchObject({ scope: 'global', source: 'ft', programme: 'Horizon Europe', packageId: 'horizon-europe-2021-2027', actionTypes: ['IA'], status: 'open' });
    expect(c.deadlines[0].at).toBe('2027-09-16T15:00:00.000Z');
    expect(c.url).toContain('/topic-details/');
    expect(list.find((x: { code: string }) => x.code === manual)).toMatchObject({ source: 'manual', title: 'Ručno uneseni globalni' });
    const lifeOnly = (await http().get(`/api/calls?q=T${tag}&programme=LIFE`).set(auth(A)).expect(200)).body;
    expect(lifeOnly.map((x: { code: string }) => x.code)).toEqual([life]);
  });

  it('praćenje institucije ostaje nakon ponovnog uvoza koji mijenja rok; filtar „moji”, programi i stanje izvora', async () => {
    const id = (await http().get(`/api/calls?q=${he}`).set(auth(A)).expect(200)).body[0].id;
    await http().put(`/api/calls/${id}/decision`).set(auth(A)).send({ decision: 'go', rationale: 'uklapa se' }).expect(200);
    const r = await importFtCalls(ADMIN_URL, [T(he, '2027-10-07T17:00:00.000+0000', { title: ['Tema – izmijenjeni naslov'] })], new Date('2026-11-16T00:00:00Z'));
    expect(r).toMatchObject({ inserted: 0, updated: 1 });
    const d = (await http().get(`/api/calls/${id}`).set(auth(A)).expect(200)).body;
    expect(d).toMatchObject({ title: 'Tema – izmijenjeni naslov', tracking: { decision: 'go' } });
    expect(d.deadlines[0].at).toBe('2027-10-07T15:00:00.000Z');
    const mine = (await http().get(`/api/calls?mine=true&q=T${tag}`).set(auth(A)).expect(200)).body;
    expect(mine.map((x: { code: string }) => x.code)).toEqual([he]);
    const progs = (await http().get('/api/calls/programmes').set(auth(A)).expect(200)).body;
    expect(progs.map((p: { programme: string }) => p.programme)).toEqual(expect.arrayContaining(['Horizon Europe', 'LIFE']));
    const src = (await http().get('/api/calls/sources').set(auth(A)).expect(200)).body;
    expect(src.ft.count).toBeGreaterThanOrEqual(2);
    expect(Date.parse(src.ft.lastSync)).toBeGreaterThan(Date.now() - 60_000);
  });

  it('dohvat: stranice do ukupnog broja, ponovni pokušaj na 503, greška nakon tri pokušaja', async () => {
    const calls: number[] = []; let failOnce = true;
    const fake = (async (url: string) => {
      const n = Number(new URL(url).searchParams.get('pageNumber')); calls.push(n);
      if (n === 2 && failOnce) { failOnce = false; return new Response('busy', { status: 503 }); }
      const size = n < 3 ? 100 : 50;
      return Response.json({ totalResults: 250, results: Array.from({ length: size }, (_, i) => T(`X-${n}-${i}`, '2027-01-01T17:00:00.000+0000')) });
    }) as unknown as typeof fetch;
    const orig = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) => orig(fn, 0)) as typeof setTimeout; // bez čekanja u testu
    try {
      expect(await fetchFtResults(fake)).toHaveLength(250);
      expect(calls).toEqual([1, 2, 2, 3]);
      await expect(fetchFtResults((async () => new Response('x', { status: 503 })) as unknown as typeof fetch)).rejects.toThrow(/HTTP 503/);
    } finally { globalThis.setTimeout = orig; }
  });
});
