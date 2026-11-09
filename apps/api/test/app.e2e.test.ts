import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';
import { randomUUID } from 'node:crypto';

describe('API (e2e)', () => {
  let app: INestApplication;
  let token = '';
  const slug = `pk-${randomUUID().slice(0, 8)}`;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    await seedDemo({ url: process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test', tenantSlug: slug, adminEmail: `a@${slug}.hr`, adminPassword: 'Lozinka-12345' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ tenantSlug: slug, email: `a@${slug}.hr`, password: 'Lozinka-12345' }).expect(201);
    token = login.body.accessToken;
  });
  afterAll(async () => { await app.close(); });

  it('GET /api/health vraća status ok i verziju', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('GET /api/programme-packages vraća globalne HE i NPOO pakete', async () => {
    const res = await request(app.getHttpServer()).get('/api/programme-packages').set('Authorization', `Bearer ${token}`).expect(200);
    const ids = [...new Set(res.body.filter((p: { scope: string }) => p.scope === 'global').map((p: { packageId: string }) => p.packageId))].sort();
    expect(ids).toEqual(expect.arrayContaining(['horizon-europe-2021-2027', 'npoo-2021-2026']));
    expect(res.body.every((p: { status: string }) => p.status === 'published' || p.status === 'draft')).toBe(true);
  });
  it('GET /api/programme-packages/:id vraća paket, nepoznati id 404', async () => {
    const res = await request(app.getHttpServer()).get('/api/programme-packages/horizon-europe-2021-2027').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.costCategories.length).toBeGreaterThan(3);
    await request(app.getHttpServer()).get('/api/programme-packages/nema').set('Authorization', `Bearer ${token}`).expect(404);
  });
});
