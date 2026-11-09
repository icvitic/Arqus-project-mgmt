import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';

const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';

describe('Identitet (e2e)', () => {
  let app: INestApplication;
  const tag = randomUUID().slice(0, 8);
  const slugA = `fpz-${tag}`, slugB = `irb-${tag}`;
  let tokenA = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugA, tenantName: 'FPZ test', adminEmail: `admin@${slugA}.hr`, adminPassword: 'Tajna-lozinka-1' });
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugB, tenantName: 'IRB test', adminEmail: `admin@${slugB}.hr`, adminPassword: 'Tajna-lozinka-2' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
  });
  afterAll(async () => { await app.close(); });

  const http = () => request(app.getHttpServer());

  it('zaštićene rute bez tokena → 401; health je javan', async () => {
    await http().get('/api/me').expect(401);
    await http().get('/api/programme-packages').expect(401);
    await http().get('/api/health').expect(200);
  });

  it('pogrešna lozinka → 401 i zapis login.failed; ispravna → token', async () => {
    await http().post('/api/auth/login').send({ tenantSlug: slugA, email: `admin@${slugA}.hr`, password: 'kriva' }).expect(401);
    const res = await http().post('/api/auth/login').send({ tenantSlug: slugA, email: `admin@${slugA}.hr`, password: 'Tajna-lozinka-1' }).expect(201);
    tokenA = res.body.accessToken;
    expect(tokenA).toMatch(/^eyJ/);
    expect(res.body.permissions).toEqual(['*']);
  });

  it('GET /api/me vraća korisnika, stanara i dozvole', async () => {
    const res = await http().get('/api/me').set('Authorization', `Bearer ${tokenA}`).expect(200);
    expect(res.body.tenant.slug).toBe(slugA);
    expect(res.body.user.email).toBe(`admin@${slugA}.hr`);
  });

  it('admin stvara korisnika s ulogom reader; popis korisnika sadrži samo vlastiti stanar', async () => {
    const created = await http().post('/api/users').set('Authorization', `Bearer ${tokenA}`)
      .send({ email: `uprava@${slugA}.hr`, displayName: 'Uprava', password: 'Citatelj-1234', roleCodes: ['reader'] }).expect(201);
    expect(created.body.status).toBe('active');
    const list = await http().get('/api/users').set('Authorization', `Bearer ${tokenA}`).expect(200);
    const emails = list.body.map((u: { email: string }) => u.email);
    expect(emails).toContain(`uprava@${slugA}.hr`);
    expect(emails.every((e: string) => e.endsWith(`${slugA}.hr`))).toBe(true);
    await http().post('/api/users').set('Authorization', `Bearer ${tokenA}`).send({ email: `uprava@${slugA}.hr`, displayName: 'Dupli' }).expect(409);
  });

  it('korisnik bez dozvole users:read dobiva 403, ali vidi pakete programa', async () => {
    const login = await http().post('/api/auth/login').send({ tenantSlug: slugA, email: `uprava@${slugA}.hr`, password: 'Citatelj-1234' }).expect(201);
    await http().get('/api/users').set('Authorization', `Bearer ${login.body.accessToken}`).expect(403);
    await http().get('/api/audit').set('Authorization', `Bearer ${login.body.accessToken}`).expect(403);
    await http().get('/api/programme-packages').set('Authorization', `Bearer ${login.body.accessToken}`).expect(200);
  });

  it('revizijski zapis sadrži login.failed, login.ok i create korisnika; stanar B ne vidi zapise stanara A', async () => {
    const audit = await http().get('/api/audit').set('Authorization', `Bearer ${tokenA}`).expect(200);
    const actions = audit.body.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['login.failed', 'login.ok', 'create']));
    const loginB = await http().post('/api/auth/login').send({ tenantSlug: slugB, email: `admin@${slugB}.hr`, password: 'Tajna-lozinka-2' }).expect(201);
    const auditB = await http().get('/api/audit').set('Authorization', `Bearer ${loginB.body.accessToken}`).expect(200);
    expect(auditB.body.every((a: { tenantId: string }) => a.tenantId === loginB.body.user.tenantId)).toBe(true);
    expect(auditB.body.some((a: { action: string }) => a.action === 'create')).toBe(false);
    const usersB = await http().get('/api/users').set('Authorization', `Bearer ${loginB.body.accessToken}`).expect(200);
    expect(usersB.body.map((u: { email: string }) => u.email)).toEqual([`admin@${slugB}.hr`]);
  });
});
