import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalBackend, S3Backend, type DocumentBackend } from '../src/documents/storage-backends';
import { hashStream } from '../src/documents/document-storage';
import { S3Client } from '../src/storage/s3-client';
import { s3Enabled, testClient, testS3Config, uniquePrefix } from './s3-env';

/**
 * WP1.20 – jedan ugovor pohrane dokumenata, ista provjera za obje izvedbe: lokalni direktorij (uvijek) i S3 nad MinIO-m
 * (uz TEST_S3_ENDPOINT, inače vidljivo preskočeno).
 */
function contract(name: string, make: () => Promise<DocumentBackend>) {
  describe(`ugovor pohrane: ${name}`, () => {
    let b: DocumentBackend;
    const tenant = randomUUID();
    const key = () => `${tenant}/${randomUUID()}`;
    beforeAll(async () => { b = await make(); });

    it('zapis, čitanje kao tok, veličina i head', async () => {
      const k = key(); const content = randomBytes(300_000);
      await b.put(k, content);
      const h = await b.head(k);
      expect(h!.size).toBe(content.length);
      expect(h!.lastModified.getTime()).toBeGreaterThan(Date.now() - 600_000);
      const o = await b.getStream(k);
      expect(o!.size).toBe(content.length);
      const got = await hashStream(o!.stream);
      expect(got).toEqual({ sha256: createHash('sha256').update(content).digest('hex'), size: content.length });
    });

    it('prazna datoteka i nepostojeći ključ (null, ne greška)', async () => {
      const k = key();
      await b.put(k, Buffer.alloc(0));
      expect((await b.head(k))!.size).toBe(0);
      expect((await hashStream((await b.getStream(k))!.stream)).size).toBe(0);
      expect(await b.head(key())).toBeNull();
      expect(await b.getStream(key())).toBeNull();
    });

    it('brisanje (i ponovljeno brisanje nepostojećeg) bez greške', async () => {
      const k = key();
      await b.put(k, Buffer.from('za brisanje'));
      await b.delete(k);
      expect(await b.head(k)).toBeNull();
      await b.delete(k);
    });

    it('popis po prefiksu vraća sve objekte s veličinama (više od jedne stranice u S3 nije potrebno za ugovor – vidi test klijenta)', async () => {
      const t2 = randomUUID();
      const keys = [`${t2}/${randomUUID()}`, `${t2}/${randomUUID()}`, `${t2}/${randomUUID()}`];
      for (const [i, k] of keys.entries()) await b.put(k, Buffer.alloc(i + 1, 1));
      const listed = [];
      for await (const o of b.list(`${t2}/`)) listed.push(o);
      expect(listed.map((o) => o.key).sort()).toEqual([...keys].sort());
      expect(listed.find((o) => o.key === keys[2])!.size).toBe(3);
      const all = new Set<string>(); for await (const o of b.list()) all.add(o.key);
      for (const k of keys) expect(all.has(k)).toBe(true);
    });

    it('istovremeni zapisi različitih ključeva i ponovni zapis istog ključa (zadnji cijeli sadržaj, nikad djelomičan)', async () => {
      const ks = Array.from({ length: 8 }, key);
      await Promise.all(ks.map((k, i) => b.put(k, Buffer.alloc(10_000 + i, i))));
      for (const [i, k] of ks.entries()) expect((await b.head(k))!.size).toBe(10_000 + i);
      const k = ks[0]!; const big = randomBytes(1_000_000);
      await b.put(k, big);
      expect((await hashStream((await b.getStream(k))!.stream)).sha256).toBe(createHash('sha256').update(big).digest('hex'));
    });

    it('dostupnost (spremnost)', async () => { await b.check(); });
  });
}

const localRoot = mkdtempSync(join(tmpdir(), 'arqus-contract-'));
contract('lokalni direktorij', async () => new LocalBackend(localRoot));

describe('lokalni direktorij – posebnosti', () => {
  it('bez privremenih datoteka nakon zapisa; ključ ne izlazi iz korijena', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arqus-contract-l-'));
    const b = new LocalBackend(root); const t = randomUUID();
    await b.put(`${t}/${randomUUID()}`, Buffer.from('x'));
    expect(readdirSync(join(root, t)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    await expect(b.put('../izvan', Buffer.from('x'))).rejects.toThrow(/Neispravan ključ/);
  });
});

if (s3Enabled) {
  contract('S3 (MinIO)', async () => new S3Backend(await testClient(uniquePrefix('ugovor'))));
  describe('S3 (MinIO) – posebnosti', () => {
    it('popis kroz više stranica (nastavak) i prefiks ključeva odvaja instalacije u istom bucketu', async () => {
      const a = await testClient(uniquePrefix('a')); const other = new S3Client(testS3Config(uniquePrefix('b')));
      for (let i = 0; i < 7; i++) await a.put(`k${i}`, Buffer.from(String(i)));
      await other.put('tudji', Buffer.from('x'));
      const keys = []; for await (const o of a.list('', { pageSize: 2 })) keys.push(o.key);
      expect(keys.sort()).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6']);
    });
    it('nedostupan poslužitelj: jasna greška brzo, ne visi', async () => {
      const b = new S3Backend(new S3Client({ ...testS3Config('x/'), endpoint: 'http://127.0.0.1:1', timeoutMs: 1000, retries: 1 }));
      const t0 = Date.now();
      await expect(b.check()).rejects.toThrow(/veza nije uspjela|nema odgovora/);
      await expect(b.put(`${randomUUID()}/${randomUUID()}`, Buffer.from('x'))).rejects.toThrow(/S3 put/);
      expect(Date.now() - t0).toBeLessThan(5000);
    });
    it('pogrešne vjerodajnice: 403 bez ponavljanja, poruka bez tajne', async () => {
      const b = new S3Client({ ...testS3Config('x/'), secretAccessKey: 'pogresna-tajna-xyz' });
      const e = await b.head('nesto').then(() => null, (x: unknown) => x as Error);
      // HEAD nema tijelo: kôd je HTTP403
      expect(e?.message).toMatch(/403/);
      expect(e?.message).not.toContain('pogresna-tajna-xyz');
      const e2 = await b.put('nesto', Buffer.from('x')).then(() => null, (x: unknown) => x as Error);
      expect(e2?.message).toMatch(/SignatureDoesNotMatch|InvalidAccessKeyId|AccessDenied/);
    });
  });
} else {
  describe.skip('ugovor pohrane: S3 (MinIO) – PRESKOČENO, TEST_S3_ENDPOINT nije postavljen', () => { it('preskočeno', () => undefined); });
}
