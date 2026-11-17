import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkOffsite, fetchLatest, s3Remote, syncOffsite } from '../src/backup/offsite';
import { S3Client } from '../src/storage/s3-client';
import { s3Enabled, S3_SKIP_MESSAGE, testClient, testS3Config, uniquePrefix } from './s3-env';

/** WP1.20 – kopije izvan poslužitelja nad stvarnim S3 (MinIO): šifrirano slanje, čuvanje, preuzimanje i dešifriranje, neuspjeh. */
describe.skipIf(!s3Enabled)('kopije izvan poslužitelja nad S3 (MinIO)', () => {
  const key = randomBytes(32);
  const quiet = { info: () => undefined, error: () => undefined };

  it('sinkronizacija → ponovna (ništa novo) → čuvanje → preuzimanje i dešifriranje za obnovu', async () => {
    const client = await testClient(uniquePrefix('kopije'));
    const remote = s3Remote(client);
    const dir = mkdtempSync(join(tmpdir(), 'arqus-bk-')); const state = mkdtempSync(join(tmpdir(), 'arqus-bk-state-'));
    const dumpOld = randomBytes(50_000); const dump = randomBytes(1_500_000); const docs = randomBytes(300_000);
    writeFileSync(join(dir, 'arqus-20261001T000000Z.dump'), dumpOld);
    writeFileSync(join(dir, 'arqus-20261117T120000Z.dump'), dump);
    writeFileSync(join(dir, 'documents-20261117.tar.gz'), docs);
    let clock = new Date('2026-10-01T00:30:00Z');
    let s = await syncOffsite({ dir, stateDir: state, remote, key, retentionDays: 30, now: () => clock, log: quiet });
    expect(s.ok).toBe(true);
    expect(s.uploaded.sort()).toEqual(['arqus-20261001T000000Z.dump', 'arqus-20261117T120000Z.dump', 'documents-20261117.tar.gz']);
    const listed = []; for await (const o of client.list('')) listed.push(o);
    expect(listed.map((o) => o.key).sort()).toEqual(['arqus-20261001T000000Z.dump.enc', 'arqus-20261117T120000Z.dump.enc', 'documents-20261117.tar.gz.enc']);
    // u bucketu je šifrat (zaglavlje ARQUSBK1, bez otvorenog teksta)
    const g = await client.getStream('arqus-20261117T120000Z.dump.enc');
    const parts: Buffer[] = []; for await (const p of g!.stream) parts.push(p as Buffer);
    const stored = Buffer.concat(parts);
    expect(stored.subarray(0, 8).toString()).toBe('ARQUSBK1');
    expect(stored.includes(dump.subarray(1000, 1064))).toBe(false);

    clock = new Date('2026-11-17T12:10:00Z');
    s = await syncOffsite({ dir, stateDir: state, remote, key, retentionDays: 30, now: () => clock, log: quiet });
    expect(s).toMatchObject({ ok: true, uploaded: [], pruned: ['arqus-20261001T000000Z.dump'], remote: { count: 2, latestDump: 'arqus-20261117T120000Z.dump', latestDocuments: 'documents-20261117.tar.gz' } });
    expect((await checkOffsite(state, 3, new Date('2026-11-17T12:30:00Z'))).ok).toBe(true);

    const out = mkdtempSync(join(tmpdir(), 'arqus-bk-restore-'));
    const r = await fetchLatest({ remote, key, dir: out });
    expect(readFileSync(r.dump).equals(dump)).toBe(true);
    expect(readFileSync(r.documents!).equals(docs)).toBe(true);
    // kriv ključ: jasna greška
    await expect(fetchLatest({ remote, key: randomBytes(32), dir: join(out, 'kriv') })).rejects.toThrow(/drugim ključem/);
    // izmijenjen objekt u bucketu: obnova odbija
    const t = Buffer.from(stored); t[t.length - 100] ^= 1;
    await client.put('arqus-20261117T120000Z.dump.enc', t);
    await expect(fetchLatest({ remote, key, dir: join(out, 'izmijenjeno') })).rejects.toThrow(/cjelovitosti/);
  });

  it('nedostupan S3: izvođenje neuspješno (ok=false, greška), stanje to pokazuje', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arqus-bk-')); const state = mkdtempSync(join(tmpdir(), 'arqus-bk-state-'));
    writeFileSync(join(dir, 'arqus-20261117T120000Z.dump'), Buffer.from('x'));
    const errors: string[] = [];
    const remote = s3Remote(new S3Client({ ...testS3Config('x/'), endpoint: 'http://127.0.0.1:1', timeoutMs: 1000, retries: 1 }));
    const s = await syncOffsite({ dir, stateDir: state, remote, key, retentionDays: 30, log: { info: () => undefined, error: (m) => errors.push(m) } });
    expect(s.ok).toBe(false);
    expect(errors[0]).toMatch(/\[GREŠKA\].*S3 list: veza nije uspjela/);
    const c = await checkOffsite(state, 3);
    expect(c.ok).toBe(false);
    expect(c.problems.join(' ')).toMatch(/nije uspjelo/);
  });
});

if (!s3Enabled) describe('kopije izvan poslužitelja nad S3 (MinIO)', () => { it.skip(S3_SKIP_MESSAGE, () => undefined); });
