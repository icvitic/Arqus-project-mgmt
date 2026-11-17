import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';
import { LocalBackend, S3Backend } from '../src/documents/storage-backends';
import { loadVersions, migrateDocuments, verifyDocuments, verifyProblems } from '../src/documents/documents-ops';
import { S3Client } from '../src/storage/s3-client';
import { readZip } from './zip-reader';
import { s3Enabled, s3Env, S3_SKIP_MESSAGE, testClient, uniquePrefix } from './s3-env';

/**
 * WP1.20 – dokumenti kroz API s DOCUMENTS_STORAGE=s3 nad stvarnim MinIO-m: prijenos, preuzimanje, verzije, paket ZNS-a
 * (strujanje i provjera SHA-256), oštećen i obrisan objekt, nedostupna pohrana (503, spremnost) te `documents verify`
 * i `documents migrate` u oba smjera. Bez TEST_S3_ENDPOINT cijela datoteka je vidljivo preskočena.
 */
const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
const PDF = (s: string) => Buffer.from(`%PDF-1.7\n% ${s}\n1 0 obj << >> endobj\n%%EOF\n`);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe.skipIf(!s3Enabled)('Dokumenti u S3 pohrani (WP1.20, e2e nad MinIO-m)', () => {
  let app: INestApplication; let token = ''; let tenantId = ''; let pid = ''; let expenseId = ''; let docId = ''; let doc2 = ''; let doc3 = '';
  const tag = randomUUID().slice(0, 8); const slug = `s3-${tag}`;
  const prefix = uniquePrefix('api');
  let s3: S3Client;
  const owner = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const download = (url: string, srv = app) => request(srv.getHttpServer()).get(url).set(auth()).buffer(true)
    .parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  const keyOf = async (id: string, version = 1) => (await owner.query<{ storage_key: string }>('select storage_key from document_versions where document_id = $1 and version = $2', [id, version])).rows[0]!.storage_key;
  const upload = async (entityType: string, entityId: string, name: string, content: Buffer) =>
    (await http().post('/api/documents').set(auth()).field({ entityType, entityId, kind: 'evidence' }).attach('file', content, name).expect(201)).body.id as string;
  const makeApp = async (env: Record<string, string>) => {
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.assign(process.env, env);
    try {
      const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const a = m.createNestApplication({ logger: false }); a.setGlobalPrefix('api'); await a.init();
      return a;
    } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = APP_URL;
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), 'arqus-s3-nekoristeno-'));
    s3 = await testClient(prefix);
    await seedDemo({ url: ADMIN_URL, tenantSlug: slug, adminEmail: `a@${slug}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
    tenantId = (await owner.query<{ id: string }>('select id from tenants where slug = $1', [slug])).rows[0]!.id;
    app = await makeApp({ DOCUMENTS_STORAGE: 's3', ...s3Env(prefix) });
    token = (await http().post('/api/auth/login').send({ tenantSlug: slug, email: `a@${slug}.hr`, password: 'Lozinka-123456' }).expect(201)).body.accessToken;
    const p = await http().post('/api/projects').set(auth()).send({ acronym: 'S3PROJ', title: 'S3 pohrana', packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA', contractNo: `UG-S3-${tag}`, startDate: '2027-01-01', durationMonths: 12 }).expect(201);
    pid = p.body.id;
    await http().put(`/api/projects/${pid}/budget/lines`).set(auth()).send({ revision: 0, lines: [{ partnerId: p.body.partners[0].id, categoryCode: 'VU', amount: 1_000_000 }] }).expect(200);
    await http().post(`/api/projects/${pid}/transition`).set(auth()).send({ to: 'active' }).expect(201);
    expenseId = (await http().post(`/api/projects/${pid}/expenses`).set(auth()).send({ categoryCode: 'VU', date: '2027-02-01', description: 'Usluga', amount: 50_000 }).expect(201)).body.id;
  });
  afterAll(async () => { await app?.close(); await owner.end(); });

  it('prijenos ide u S3 (ključ <tenantId>/<uuid> pod prefiksom), preuzimanje i verzije provjeravaju SHA-256', async () => {
    docId = await upload('expense', expenseId, 'Račun.pdf', PDF('v1'));
    const key = await keyOf(docId);
    expect(key).toMatch(new RegExp(`^${tenantId}/[0-9a-f-]{36}$`));
    expect((await s3.head(key))!.size).toBe(PDF('v1').length);
    await http().post(`/api/documents/${docId}/versions`).set(auth()).attach('file', PDF('v2'), 'Račun v2.pdf').expect(201);
    const dl = await download(`/api/documents/${docId}/download`).expect(200);
    expect((dl.body as Buffer).equals(PDF('v2'))).toBe(true);
    expect(dl.headers['x-document-sha256']).toBe(sha(PDF('v2')));
    expect((await download(`/api/documents/${docId}/versions/1/download`).expect(200)).body.equals(PDF('v1'))).toBe(true);
    // ista datoteka kao trenutna verzija: 409, a već poslan objekt se uklanja (nema siročeta)
    const before = []; for await (const o of s3.list(`${tenantId}/`)) before.push(o.key);
    await http().post(`/api/documents/${docId}/versions`).set(auth()).attach('file', PDF('v2'), 'isti.pdf').expect(409);
    const after = []; for await (const o of s3.list(`${tenantId}/`)) after.push(o.key);
    expect(after.sort()).toEqual(before.sort());
  });

  it('spremnost javlja dostupnu pohranu bez konfiguracije', async () => {
    const r = await http().get('/api/health/ready').expect(200);
    expect(r.body).toEqual({ status: 'ready', checks: { database: 'ok', storage: 'ok' } });
  });

  it('paket ZNS-a struji dokaze iz S3 s provjerom; oštećen dokaz → 409 prije prvog bajta i revizijski zapis', async () => {
    doc2 = await upload('expense', expenseId, 'Ponuda.pdf', PDF('ponuda'));
    const c = (await http().post(`/api/projects/${pid}/claims`).set(auth()).send({ period: 1 }).expect(201)).body;
    const zip = await download(`/api/projects/${pid}/claims/${c.id}/export`).expect(200);
    const files = new Map(readZip(zip.body as Buffer).map((e) => [e.name, e.data]));
    const evidence = [...files.entries()].filter(([n]) => n.startsWith('dokazi/'));
    expect(evidence.map(([, d]) => sha(d)).sort()).toEqual([sha(PDF('v2')), sha(PDF('ponuda'))].sort());
    const key = await keyOf(doc2);
    await s3.put(key, Buffer.concat([PDF('ponuda'), Buffer.from('x')]));
    const bad = await http().get(`/api/projects/${pid}/claims/${c.id}/export`).set(auth()).expect(409);
    expect(bad.body.message).toMatch(/sadržaj se ne slaže s pohranjenim SHA-256/);
    await download(`/api/documents/${doc2}/download`).expect(400);
    await s3.put(key, PDF('ponuda'));
    await download(`/api/projects/${pid}/claims/${c.id}/export`).expect(200);
  });

  it('obrisan objekt: preuzimanje 500 s jasnom porukom, paket 409 „datoteka nedostaje”', async () => {
    doc3 = await upload('project', pid, 'Ugovor.pdf', PDF('ugovor'));
    await s3.delete(await keyOf(doc3));
    const r = await download(`/api/documents/${doc3}/download`).expect(500);
    expect(JSON.parse((r.body as Buffer).toString()).message).toMatch(/nedostaje u pohrani/);
  });

  it('nedostupna pohrana: 503 brzo (bez visenja), spremnost 503 bez konfiguracije u odgovoru', async () => {
    const down = await makeApp({ DOCUMENTS_STORAGE: 's3', ...s3Env(prefix), DOCUMENTS_S3_ENDPOINT: 'http://127.0.0.1:1', DOCUMENTS_S3_TIMEOUT_MS: '1000', DOCUMENTS_S3_RETRIES: '1' });
    try {
      const t0 = Date.now();
      const up = await request(down.getHttpServer()).post('/api/documents').set(auth()).field({ entityType: 'project', entityId: pid }).attach('file', PDF('x'), 'x.pdf').expect(503);
      expect(up.body.message).toMatch(/Pohrana dokumenata trenutno nije dostupna/);
      await download(`/api/documents/${docId}/download`, down).expect(503);
      const ready = await request(down.getHttpServer()).get('/api/health/ready').expect(503);
      expect(ready.body.message).toBe('Pohrana dokumenata nije dostupna');
      const text = JSON.stringify([up.body, ready.body]);
      for (const leak of ['127.0.0.1', 'arqus-test', prefix, 'arqus-test-secret']) expect(text).not.toContain(leak);
      expect(Date.now() - t0).toBeLessThan(10_000);
      // ništa nije zapisano u bazu
      expect((await owner.query('select count(*)::int as n from documents where tenant_id = $1', [tenantId])).rows[0].n).toBe(3);
    } finally { await down.close(); }
  });

  it('documents verify: nedostaje, oštećeno, siroče; nakon popravka čisto', async () => {
    const storage = new S3Backend(s3);
    const versions = () => loadVersions(ADMIN_URL, { tenantIds: [tenantId] });
    const orphan = `${tenantId}/${randomUUID()}`;
    await s3.put(orphan, Buffer.from('siroče'));
    const k1 = await keyOf(docId, 1);
    await s3.put(k1, Buffer.from(PDF('v1').toString().replace('v1', 'X1'))); // ista veličina, drugi sadržaj
    let r = await verifyDocuments(storage, versions, { orphanGraceMs: 0 });
    expect(r.checked).toBe(4);
    expect(r.missing.map((m) => m.documentId)).toEqual([doc3]);
    expect(r.corrupted.map((c) => `${c.documentId} v${c.version}`)).toEqual([`${docId} v1`]);
    expect(r.orphaned.map((o) => o.key)).toEqual([orphan]);
    expect(verifyProblems(r)).toBe(3);
    // brza provjera (samo veličina) ne vidi zamjenu iste veličine – zato je zadana puna provjera
    expect((await verifyDocuments(storage, versions, { quick: true, orphanGraceMs: 0 })).corrupted).toEqual([]);
    // svjež objekt bez verzije (prijenos u tijeku) nije problem
    expect((await verifyDocuments(storage, versions)).recent.map((o) => o.key)).toEqual([orphan]);
    await s3.put(k1, PDF('v1'));
    await s3.put(await keyOf(doc3), PDF('ugovor'));
    await s3.delete(orphan);
    r = await verifyDocuments(storage, versions, { orphanGraceMs: 0 });
    expect(verifyProblems(r)).toBe(0);
    expect(r.ok).toBe(4);
  });

  it('documents migrate S3 → lokalno → drugi bucket: provjera hasha, idempotentno, nastavljivo, izvor netaknut, sukob se ne prepisuje', async () => {
    const source = new S3Backend(s3);
    const refs = await loadVersions(ADMIN_URL, { tenantIds: [tenantId] });
    const local = new LocalBackend(mkdtempSync(join(tmpdir(), 'arqus-migrate-')));
    // oštećenje u izvoru se ne kopira
    const k2 = await keyOf(doc2);
    await s3.put(k2, PDF('pokvareno!'));
    let r = await migrateDocuments(source, local, refs);
    expect(r).toMatchObject({ total: 4, copied: 3, skipped: 0 });
    expect(r.failed.map((f) => [f.ref.documentId, f.reason])).toEqual([[doc2, expect.stringMatching(/oštećeno u izvoru/)]]);
    await s3.put(k2, PDF('ponuda'));
    // nastavak: preskače već kopirane (s provjerom hasha), kopira ostatak
    r = await migrateDocuments(source, local, refs);
    expect(r).toMatchObject({ copied: 1, skipped: 3, failed: [] });
    expect(verifyProblems(await verifyDocuments(local, async () => refs, { orphanGraceMs: 0 }))).toBe(0);
    // izvor je netaknut
    expect(verifyProblems(await verifyDocuments(source, async () => refs, { orphanGraceMs: 0 }))).toBe(0);
    // natrag u drugi S3 prefiks (npr. drugi bucket), uz sukob: drugačiji sadržaj u odredištu se ne prepisuje
    const mirror = new S3Backend(await testClient(uniquePrefix('zrcalo')));
    await mirror.put(refs[0]!.key, Buffer.from('nešto drugo'));
    r = await migrateDocuments(local, mirror, refs);
    expect(r).toMatchObject({ copied: 3, skipped: 0 });
    expect(r.failed).toEqual([{ ref: refs[0], reason: expect.stringMatching(/drugačiji sadržaj/) }]);
    const g = await mirror.getStream(refs[0]!.key);
    const parts: Buffer[] = []; for await (const p of g!.stream) parts.push(p as Buffer);
    expect(Buffer.concat(parts).toString()).toBe('nešto drugo');
  });

  it('aplikacija nakon prijelaza na lokalnu pohranu čita prenesene dokumente', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arqus-migrate-app-'));
    await migrateDocuments(new S3Backend(s3), new LocalBackend(dir), await loadVersions(ADMIN_URL, { tenantIds: [tenantId] }));
    const localApp = await makeApp({ DOCUMENTS_STORAGE: 'local', DOCUMENTS_DIR: dir });
    try {
      expect((await download(`/api/documents/${docId}/download`, localApp).expect(200)).body.equals(PDF('v2'))).toBe(true);
      expect((await download(`/api/documents/${doc3}/download`, localApp).expect(200)).body.equals(PDF('ugovor'))).toBe(true);
    } finally { await localApp.close(); }
  });

  it('nepoznata vrijednost DOCUMENTS_STORAGE ili nepotpuna S3 konfiguracija: aplikacija se ne pokreće (jasna poruka bez tajni)', async () => {
    await expect(makeApp({ DOCUMENTS_STORAGE: 'ftp' })).rejects.toThrow(/DOCUMENTS_STORAGE mora biti/);
    await expect(makeApp({ DOCUMENTS_STORAGE: 's3', DOCUMENTS_S3_ENDPOINT: '', DOCUMENTS_S3_SECRET_ACCESS_KEY: 'tajna-123' })).rejects.toThrow(/nedostaje: DOCUMENTS_S3_ENDPOINT/);
  });
});

if (!s3Enabled) describe('Dokumenti u S3 pohrani (WP1.20)', () => { it.skip(S3_SKIP_MESSAGE, () => undefined); });
