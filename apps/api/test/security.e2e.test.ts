import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { securityHeaders } from '../src/common/security';
import { seedDemo } from '../src/db/seed';

const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';

describe('Sigurnost (e2e)', () => {
  let app: INestApplication;
  const slug = `sec-${randomUUID().slice(0, 8)}`;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    await seedDemo({ url: ADMIN_URL, tenantSlug: slug, adminEmail: `a@${slug}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.use(securityHeaders(true)); app.setGlobalPrefix('api'); await app.init();
  });
  afterAll(async () => { await app.close(); });
  const http = () => request(app.getHttpServer());

  it('sigurnosna zaglavlja i provjera spremnosti', async () => {
    const r = await http().get('/api/health/ready').expect(200);
    expect(r.body.status).toBe('ready');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(r.headers['strict-transport-security']).toMatch(/max-age=31536000/);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('nakon 10 neuspjelih prijava za isti račun → 429; ispravna lozinka također blokirana dok traje prozor; drugi račun radi', async () => {
    for (let i = 0; i < 10; i++) await http().post('/api/auth/login').send({ tenantSlug: slug, email: `a@${slug}.hr`, password: `kriva-${i}` }).expect(401);
    const blocked = await http().post('/api/auth/login').send({ tenantSlug: slug, email: `a@${slug}.hr`, password: 'Lozinka-123456' }).expect(429);
    expect(blocked.body.message).toMatch(/Previše neuspjelih pokušaja/);
    await http().post('/api/auth/login').send({ tenantSlug: slug, email: `drugi@${slug}.hr`, password: 'x' }).expect(401);
  });

  it('predugački ili neispravni podaci za prijavu → 400', async () => {
    await http().post('/api/auth/login').send({ tenantSlug: slug, email: 'x@y.hr', password: 'a'.repeat(600) }).expect(400);
    await http().post('/api/auth/login').send({ tenantSlug: slug, email: 123, password: 'a' }).expect(400);
  });
});
