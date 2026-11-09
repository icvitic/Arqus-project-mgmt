import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('API (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('GET /api/health vraća status ok i verziju', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('GET /api/programme-packages vraća HE i NPOO pakete, bez odbijenih', async () => {
    const res = await request(app.getHttpServer()).get('/api/programme-packages').expect(200);
    const ids = res.body.map((p: { id: string }) => p.id).sort();
    expect(ids).toEqual(['horizon-europe-2021-2027', 'npoo-2021-2026']);
    const rej = await request(app.getHttpServer()).get('/api/programme-packages/rejected').expect(200);
    expect(rej.body).toEqual([]);
  });
  it('GET /api/programme-packages/:id vraća paket, nepoznati id 404', async () => {
    const res = await request(app.getHttpServer()).get('/api/programme-packages/horizon-europe-2021-2027').expect(200);
    expect(res.body.costCategories.length).toBeGreaterThan(3);
    await request(app.getHttpServer()).get('/api/programme-packages/nema').expect(404);
  });
});
