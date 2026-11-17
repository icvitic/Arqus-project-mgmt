import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';

const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const PDF1 = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
const PDF2 = Buffer.from('%PDF-1.7\n2 0 obj << /Ispravak true >> endobj\n%%EOF\n');

describe('Dokumenti (e2e)', () => {
  let app: INestApplication; let A = ''; let B = '';
  const tag = randomUUID().slice(0, 8); const slugA = `da-${tag}`, slugB = `db-${tag}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (slug: string) => (await http().post('/api/auth/login').send({ tenantSlug: slug, email: `a@${slug}.hr`, password: 'Lozinka-123456' }).expect(201)).body.accessToken as string;
  let pid = ''; let expenseId = ''; let docId = ''; let projectDoc = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), 'arqus-docs-'));
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugA, adminEmail: `a@${slugA}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugB, adminEmail: `a@${slugB}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    A = await login(slugA); B = await login(slugB);
    const p = await http().post('/api/projects').set(auth(A)).send({ acronym: 'DOKPROJ', title: 'Dokumenti', packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA', contractNo: `UG-D-${tag}`, startDate: '2027-01-01', durationMonths: 12 }).expect(201);
    pid = p.body.id;
    await http().post(`/api/projects/${pid}/work-packages`).set(auth(A)).send({ title: 'Rad', startMonth: 1, endMonth: 12 }).expect(201);
    await http().put(`/api/projects/${pid}/budget/lines`).set(auth(A)).send({ revision: 0, lines: [{ partnerId: p.body.partners[0].id, categoryCode: 'VU', amount: 1_000_000 }] }).expect(200);
    await http().post(`/api/projects/${pid}/transition`).set(auth(A)).send({ to: 'active' }).expect(201);
    expenseId = (await http().post(`/api/projects/${pid}/expenses`).set(auth(A)).send({ categoryCode: 'VU', date: '2027-02-01', description: 'Usluga prijevoda', amount: 50_000 }).expect(201)).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('učitavanje dokaza uz trošak: provjera vrste, hash, hrvatski naziv', async () => {
    await http().post('/api/documents').set(auth(A)).field('entityType', 'expense').field('entityId', expenseId).attach('file', Buffer.from('<html>'), 'racun.pdf').expect(400);
    await http().post('/api/documents').set(auth(A)).field('entityType', 'expense').field('entityId', expenseId).attach('file', Buffer.from('<svg/>'), 'slika.svg').expect(400);
    await http().post('/api/documents').set(auth(A)).field('entityType', 'expense').field('entityId', expenseId).expect(400); // bez datoteke
    await http().post('/api/documents').set(auth(A)).field('entityType', 'expense').field('entityId', randomUUID()).attach('file', PDF1, 'r.pdf').expect(404);
    const r = await http().post('/api/documents').set(auth(A)).field('entityType', 'expense').field('entityId', expenseId).field('kind', 'evidence').attach('file', PDF1, 'Račun 12-2027 čćžšđ.pdf').expect(201);
    docId = r.body.id;
    expect(r.body).toMatchObject({ title: 'Račun 12-2027 čćžšđ', kind: 'evidence', projectId: pid, currentVersion: 1 });
    expect(r.body.versions[0]).toMatchObject({ version: 1, fileName: 'Račun 12-2027 čćžšđ.pdf', mimeType: 'application/pdf', size: PDF1.length, sha256: createHash('sha256').update(PDF1).digest('hex') });
    const ex = (await http().get(`/api/projects/${pid}/expenses`).set(auth(A)).expect(200)).body;
    expect(ex.find((e: { id: string }) => e.id === expenseId).documents).toBe(1);
  });

  it('verzije, preuzimanje, popis po projektu', async () => {
    await http().post(`/api/documents/${docId}/versions`).set(auth(A)).attach('file', PDF1, 'isti.pdf').expect(409);
    const v2 = await http().post(`/api/documents/${docId}/versions`).set(auth(A)).field('note', 'ispravljen račun').attach('file', PDF2, 'Račun ispravak.pdf').expect(201);
    expect(v2.body.currentVersion).toBe(2);
    expect(v2.body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    const dl = await http().get(`/api/documents/${docId}/download`).set(auth(A)).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(Buffer.compare(dl.body as Buffer, PDF2)).toBe(0);
    expect(dl.headers['content-disposition']).toMatch(/^attachment; filename="Ra_un ispravak.pdf"; filename\*=UTF-8''Ra%C4%8Dun%20ispravak\.pdf$/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    await http().get(`/api/documents/${docId}/versions/1/download`).set(auth(A)).expect(200);
    await http().get(`/api/documents/${docId}/versions/9/download`).set(auth(A)).expect(404);
    projectDoc = (await http().post('/api/documents').set(auth(A)).field('entityType', 'project').field('entityId', pid).field('kind', 'contract').field('title', 'Ugovor o dodjeli').attach('file', PDF1, 'ugovor.pdf').expect(201)).body.id;
    const list = (await http().get(`/api/documents?projectId=${pid}`).set(auth(A)).expect(200)).body;
    expect(list.map((d: { id: string }) => d.id).sort()).toEqual([docId, projectDoc].sort());
    expect(list.find((d: { id: string }) => d.id === docId).current).toMatchObject({ version: 2, fileName: 'Račun ispravak.pdf' });
    await http().get('/api/documents').set(auth(A)).expect(400);
  });

  it('dokazi se zamrzavaju predajom ZNS-a; ZNS pokazuje troškove bez dokaza', async () => {
    const e2 = (await http().post(`/api/projects/${pid}/expenses`).set(auth(A)).send({ categoryCode: 'VU', date: '2027-03-01', description: 'Bez računa', amount: 10_000 }).expect(201)).body.id;
    const c = (await http().post(`/api/projects/${pid}/claims`).set(auth(A)).send({ period: 1 }).expect(201)).body;
    expect(c.missingEvidence).toBe(1);
    expect(c.expenses.find((e: { id: string }) => e.id === e2).documents).toBe(0);
    // Razdoblje još traje (2027.) – rana predaja s razlogom; trošak bez dokaza izričito potvrđen (WP1.16a).
    await http().post(`/api/projects/${pid}/claims/${c.id}/submit`).set(auth(A)).send({ earlyReason: 'Provjera zamrzavanja dokaza', acknowledgeWithoutEvidence: [e2] }).expect(201);
    await http().post(`/api/documents/${docId}/versions`).set(auth(A)).attach('file', Buffer.from('%PDF-1.7\n3'), 'novi.pdf').expect(409);
    await http().delete(`/api/documents/${docId}`).set(auth(A)).expect(409);
    await http().post('/api/documents').set(auth(A)).field('entityType', 'expense').field('entityId', e2).attach('file', PDF1, 'kasno.pdf').expect(409);
    // dokument projekta i dalje se može obrisati (logički)
    await http().delete(`/api/documents/${projectDoc}`).set(auth(A)).expect(200);
    await http().get(`/api/documents/${projectDoc}`).set(auth(A)).expect(404);
  });

  it('izolacija i nepromjenjivost verzija u bazi', async () => {
    await http().get(`/api/documents/${docId}`).set(auth(B)).expect(404);
    await http().get(`/api/documents/${docId}/download`).set(auth(B)).expect(404);
    expect((await http().get(`/api/documents?projectId=${pid}`).set(auth(B)).expect(200)).body).toEqual([]);
    await http().post('/api/documents').set(auth(B)).field('entityType', 'project').field('entityId', pid).attach('file', PDF1, 'x.pdf').expect(404);
    const app2 = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await expect(app2.query('update document_versions set sha256 = $1', ['x'])).rejects.toThrow(/permission denied/);
    await expect(app2.query('delete from document_versions')).rejects.toThrow(/permission denied/);
    await app2.end();
  });

  it('prevelika datoteka → 413', async () => {
    const big = join(process.env.DOCUMENTS_DIR!, 'big.pdf');
    writeFileSync(big, Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(25 * 1024 * 1024)]));
    await http().post('/api/documents').set(auth(A)).field('entityType', 'project').field('entityId', pid).attach('file', big).expect(413);
  });
});
