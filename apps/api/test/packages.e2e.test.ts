import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';

const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';

describe('Paketi programa u bazi (e2e)', () => {
  let app: INestApplication; let tokenA = ''; let tokenB = '';
  const tag = randomUUID().slice(0, 8); const slugA = `pa-${tag}`, slugB = `pb-${tag}`;
  const pozivId = `npoo-poziv-${tag}`;
  const poziv = {
    meta: { id: pozivId, extends: 'npoo-2021-2026', programme: 'NPOO – testni poziv', version: '1.0.0', validFrom: '2026-10-01', language: 'hr' },
    actionTypes: [], costCategories: [{ code: 'NT', name: 'Neizravni 7 %', kind: 'indirect', calculation: { ratePercent: 7 } }],
    reporting: { periodMonths: 6, submissionDeadlineDays: 30 },
  };
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (slug: string, pw: string) => (await http().post('/api/auth/login').send({ tenantSlug: slug, email: `a@${slug}.hr`, password: pw }).expect(201)).body.accessToken as string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugA, adminEmail: `a@${slugA}.hr`, adminPassword: 'Lozinka-A-1234' });
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugB, adminEmail: `a@${slugB}.hr`, adminPassword: 'Lozinka-B-1234', importPackages: false });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    tokenA = await login(slugA, 'Lozinka-A-1234'); tokenB = await login(slugB, 'Lozinka-B-1234');
  });
  afterAll(async () => { await app.close(); });

  it('GET /:packageId vraća globalni HE paket; nepoznata verzija 404', async () => {
    const res = await http().get('/api/programme-packages/horizon-europe-2021-2027').set('Authorization', `Bearer ${tokenA}`).expect(200);
    expect(res.body.meta.id).toBe('horizon-europe-2021-2027');
    expect(res.body._row.scope).toBe('global');
    await http().get('/api/programme-packages/horizon-europe-2021-2027?version=9.9.9').set('Authorization', `Bearer ${tokenA}`).expect(404);
  });

  it('POST /validate: valjan paket po pozivu s extends → ok; nepostojeći roditelj → issues', async () => {
    const ok = await http().post('/api/programme-packages/validate').set('Authorization', `Bearer ${tokenA}`).send(poziv).expect(201);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.resolved.costCategories.find((c: { code: string }) => c.code === 'NT').calculation.baseCategories).toEqual(['OS']);
    const bad = await http().post('/api/programme-packages/validate').set('Authorization', `Bearer ${tokenA}`).send({ ...poziv, meta: { ...poziv.meta, extends: 'nema-takvog' } }).expect(201);
    expect(bad.body.ok).toBe(false);
    expect(bad.body.issues[0].path).toBe('/meta/extends');
  });

  it('stanar A stvara paket po pozivu (nacrt), objavljuje ga; dupli unos 409; stanar B ga ne vidi', async () => {
    const created = await http().post('/api/programme-packages').set('Authorization', `Bearer ${tokenA}`).send(poziv).expect(201);
    expect(created.body.status).toBe('draft'); expect(created.body.scope).toBe('tenant');
    await http().post('/api/programme-packages').set('Authorization', `Bearer ${tokenA}`).send(poziv).expect(409);
    const published = await http().post(`/api/programme-packages/${created.body.id}/publish`).set('Authorization', `Bearer ${tokenA}`).expect(201);
    expect(published.body.status).toBe('published');
    await http().post(`/api/programme-packages/${created.body.id}/publish`).set('Authorization', `Bearer ${tokenA}`).expect(409);
    const resolved = await http().get(`/api/programme-packages/${pozivId}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
    expect(resolved.body.actionTypes.map((a: { code: string }) => a.code)).toContain('BESPOVRATNA');
    expect(resolved.body.reporting.periodMonths).toBe(6);
    await http().get(`/api/programme-packages/${pozivId}`).set('Authorization', `Bearer ${tokenB}`).expect(404);
    const listB = await http().get('/api/programme-packages').set('Authorization', `Bearer ${tokenB}`).expect(200);
    expect(listB.body.every((p: { scope: string }) => p.scope === 'global')).toBe(true);
    await http().post(`/api/programme-packages/${created.body.id}/publish`).set('Authorization', `Bearer ${tokenB}`).expect(404);
  });

  it('izvorni sadržaj retka, brisanje nacrta (objavljeni 409), ured za projekte smije uređivati pakete', async () => {
    const list = (await http().get('/api/programme-packages').set(auth(tokenA)).expect(200)).body;
    const pub = list.find((p: { packageId: string }) => p.packageId === pozivId);
    const raw = (await http().get(`/api/programme-packages/rows/${pub.id}`).set(auth(tokenA)).expect(200)).body;
    expect(raw.content.meta.extends).toBe('npoo-2021-2026');
    expect(raw.content.costCategories).toHaveLength(1); // nerazriješen: samo razlike
    await http().delete(`/api/programme-packages/rows/${pub.id}`).set(auth(tokenA)).expect(409);
    const v2 = await http().post('/api/programme-packages').set(auth(tokenA)).send({ ...poziv, meta: { ...poziv.meta, version: '1.1.0' } }).expect(201);
    await http().get(`/api/programme-packages/rows/${v2.body.id}`).set(auth(tokenB)).expect(404);
    await http().delete(`/api/programme-packages/rows/${v2.body.id}`).set(auth(tokenB)).expect(404);
    await http().delete(`/api/programme-packages/rows/${v2.body.id}`).set(auth(tokenA)).expect(200);
    const office = await http().post('/api/users').set(auth(tokenA)).send({ email: `ured@${slugA}.hr`, displayName: 'Ured za projekte', password: 'zelena-kava-u-podne-27', roleCodes: ['project-office'] }).expect(201);
    const t = (await http().post('/api/auth/login').send({ tenantSlug: slugA, email: `ured@${slugA}.hr`, password: 'zelena-kava-u-podne-27' }).expect(201)).body.accessToken;
    await http().post('/api/programme-packages').set(auth(t)).send({ ...poziv, meta: { ...poziv.meta, version: '1.2.0' } }).expect(201);
    expect(office.body.roles).toEqual(['project-office']);
  });

  it('neispravan paket → 400 s popisom problema', async () => {
    const res = await http().post('/api/programme-packages').set('Authorization', `Bearer ${tokenA}`).send({ meta: { id: 'x' } }).expect(400);
    expect(res.body.issues?.length ?? 0).toBeGreaterThan(0);
  });
});
