import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { inviteUser } from './invite';
import { seedDemo } from '../src/db/seed';
import { RetentionService, retentionSchedulerEnabled } from '../src/privacy/retention.service';
import { DocumentStorage } from '../src/documents/document-storage';

/**
 * WP1.23 – posao čuvanja podataka (e2e). Za svaku kategoriju fiksni podaci imaju zapis tik unutar i tik izvan roka
 * (vlasnička veza – samo umetanje s vremenom u prošlosti, u vlastitoj instituciji testa). Provjerava: probno izvođenje ne
 * briše ništa; zakazano briše točno istekle; dvije istovremene instance rade posao jednom; serije su ograničene; ništa
 * o čemu ovisi zapis koji se čuva (dokaz troška u zahtjevu) i nijedan financijski zapis ne nestaje ni uz najkraće postavke.
 */
const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
const PDF = (s: string) => Buffer.from(`%PDF-1.7\n% ${s}\n1 0 obj << >> endobj\n%%EOF\n`);
type Json = Record<string, unknown>;

describe('Rokovi čuvanja i posao čuvanja podataka (WP1.23, e2e)', () => {
  let app: INestApplication; let retention: RetentionService;
  const tag = randomUUID().slice(0, 8); const slug = `rt-${tag}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const owner = new Pool({ connectionString: ADMIN_URL, max: 2 });
  const appPool = new Pool({ connectionString: APP_URL, max: 2 });
  let admin = ''; let tenantId = ''; let userId = ''; let pid = '';
  const row: Record<string, string> = {};
  let docOut: { id: string; key: string; sha: string; size: number } = { id: '', key: '', sha: '', size: 0 };
  let docIn = ''; let docEvidence = '';

  const q1 = async (sql: string, p: unknown[] = []) => (await owner.query(sql, p)).rows[0] as Json;
  const exists = async (table: string, idValue: string, col = 'id') => (await owner.query(`select 1 from ${table} where ${col} = $1 and tenant_id = $2`, [idValue, tenantId])).rows.length === 1;
  const financial = async () => q1(`select (select count(*) from timesheets where tenant_id = $1)::int as ts, (select count(*) from timesheet_entries where tenant_id = $1)::int as entries,
    (select count(*) from expenses where tenant_id = $1)::int as expenses, (select count(*) from reimbursement_claims where tenant_id = $1)::int as claims,
    (select count(*) from team_members where tenant_id = $1)::int as members, (select count(*) from budget_lines where tenant_id = $1)::int as budget,
    (select count(*) from projects where tenant_id = $1)::int as projects`, [tenantId]);

  beforeAll(async () => {
    process.env.DATABASE_URL = APP_URL;
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), 'arqus-retention-'));
    await seedDemo({ url: ADMIN_URL, tenantSlug: slug, adminEmail: `a@${slug}.hr`, adminPassword: 'Lozinka-123456' });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    retention = app.get(RetentionService);
    admin = (await http().post('/api/auth/login').send({ tenantSlug: slug, email: `a@${slug}.hr`, password: 'Lozinka-123456' }).expect(201)).body.accessToken;
    tenantId = String((await q1('select id from tenants where slug = $1', [slug])).id);
    userId = (await inviteUser(app, admin, { email: `k@${slug}.hr`, displayName: 'Korisnica Čuvanja', roleCodes: ['reader'] }, 'Plava-Staza-2027-x')).id;
    const days = (n: number) => `now() - interval '${n} days'`;
    // Sesije (30 dana nakon isteka ili odjave).
    for (const [k, sql] of [['sIn', `${days(29)}, null`], ['sOut', `${days(31)}, null`], ['sRevokedOut', `now() + interval '1 day', ${days(31)}`], ['sLive', `now() + interval '1 day', null`]] as const) {
      row[k] = randomUUID();
      await owner.query(`insert into sessions (id, tenant_id, user_id, expires_at, revoked_at, ip, user_agent) values ($1, $2, $3, ${sql}, '10.0.0.1', 'test')`, [row[k], tenantId, userId]);
    }
    // Istekli tokeni (7 dana nakon isteka).
    for (const [k, d] of [['tIn', 6], ['tOut', 8]] as const) row[k] = String((await q1(`insert into account_tokens (tenant_id, user_id, kind, token_hash, delivery, expires_at) values ($1, $2, 'reset', $3, 'link', ${days(d)}) returning id`, [tenantId, userId, randomUUID()])).id);
    // Isporuka pošte (180 dana), sažetak (90 dana).
    for (const [k, d] of [['mIn', 179], ['mOut', 181]] as const) row[k] = String((await q1(`insert into mail_deliveries (tenant_id, user_id, kind, outcome, created_at) values ($1, $2, 'digest', 'sent', ${days(d)}) returning id`, [tenantId, userId])).id);
    for (const [k, d] of [['dIn', 89], ['dOut', 91]] as const) { row[k] = `2020-01-${String(d - 80).padStart(2, '0')}`; await owner.query(`insert into digest_runs (tenant_id, user_id, day, outcome, created_at) values ($1, $2, $3, 'sent', ${days(d)})`, [tenantId, userId, row[k]]); }
    // Obavijesti: pročitane 90 dana, nepročitane 365 dana.
    for (const [k, read, created] of [['nReadIn', 89, 100], ['nReadOut', 91, 100], ['nUnreadIn', null, 364], ['nUnreadOut', null, 366]] as const) {
      row[k] = String((await q1(`insert into notifications (tenant_id, user_id, kind, created_at, read_at) values ($1, $2, 'access_granted', ${days(created)}, ${read === null ? 'null' : days(read)}) returning id`, [tenantId, userId])).id);
    }
    // Revizijski zapis: neuspjele prijave (365 dana) i ostali (3650 dana).
    for (const [k, action, entity, d] of [['aLoginIn', 'login.failed', 'user', 364], ['aLoginOut', 'login.failed', 'user', 366], ['aIn', 'probe', 'probe', 3649], ['aOut', 'probe', 'probe', 3651]] as const) {
      row[k] = String((await q1(`insert into audit_entries (tenant_id, actor_type, entity, action, at) values ($1, 'system', $2, $3, ${days(d)}) returning id`, [tenantId, entity, action])).id);
    }
    // Projekt s timesheetom i zahtjevom; dokumenti obrisani prije 179 i 181 dana i dokaz troška u predanom zahtjevu.
    const p = (await http().post('/api/projects').set(auth(admin)).send({ acronym: 'CUV', title: 'Čuvanje', packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA', contractNo: `UG-${tag}`, startDate: '2025-01-01', durationMonths: 12 }).expect(201)).body;
    pid = p.id; const self = p.partners[0].id;
    await http().put(`/api/projects/${pid}/budget/lines`).set(auth(admin)).send({ revision: 0, lines: [{ partnerId: self, categoryCode: 'PUT', amount: 300_000 }] }).expect(200);
    await http().post(`/api/projects/${pid}/team`).set(auth(admin)).send({ fullName: 'Član Tima', annualCost: 3_000_000 }).expect(201);
    await http().post(`/api/projects/${pid}/transition`).set(auth(admin)).send({ to: 'active' }).expect(201);
    const exp = (await http().post(`/api/projects/${pid}/expenses`).set(auth(admin)).send({ categoryCode: 'PUT', date: '2025-02-10', description: 'Putovanje', amount: 10_000 }).expect(201)).body.id;
    const upload = async (entityType: string, entityId: string, s: string) => (await http().post('/api/documents').set(auth(admin)).field({ entityType, entityId, kind: 'other' }).attach('file', PDF(s), `${s}.pdf`).expect(201)).body;
    const out = await upload('project', pid, 'stari'); docIn = (await upload('project', pid, 'noviji')).id; docEvidence = (await upload('expense', exp, 'dokaz')).id;
    const v = (await q1('select storage_key, sha256, size_bytes from document_versions where document_id = $1', [out.id]));
    docOut = { id: out.id, key: String(v.storage_key), sha: String(v.sha256), size: Number(v.size_bytes) };
    const claim = (await http().post(`/api/projects/${pid}/claims`).set(auth(admin)).send({ period: 1 }).expect(201)).body.id;
    await http().post(`/api/projects/${pid}/claims/${claim}/submit`).set(auth(admin)).send({ acknowledgeWithoutEvidence: [] }).expect(201);
    // Vlasnički: vrijeme brisanja u prošlosti (dokaz u predanom zahtjevu sučelje ne bi ni dalo obrisati – dodatna obrana).
    await owner.query(`update documents set deleted_at = ${days(181)} where id = $1`, [docOut.id]);
    await owner.query(`update documents set deleted_at = ${days(179)} where id = $1`, [docIn]);
    await owner.query(`update documents set deleted_at = ${days(400)} where id = $1`, [docEvidence]);
  }, 90_000);
  afterAll(async () => { await app.close(); await owner.end(); await appPool.end(); });

  it('raspored se nikad ne pokreće sam u testovima i razvoju; u produkciji da (osim RETENTION_ENABLED=0)', () => {
    expect(retentionSchedulerEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(retentionSchedulerEnabled({})).toBe(false);
    expect(retentionSchedulerEnabled({ NODE_ENV: 'production' })).toBe(true);
    expect(retentionSchedulerEnabled({ NODE_ENV: 'production', RETENTION_ENABLED: '0' })).toBe(false);
    expect(retentionSchedulerEnabled({ RETENTION_ENABLED: '1' })).toBe(true);
  });

  it('probno izvođenje broji točno istekle i ne briše ništa; zaslon pokazuje istinu', async () => {
    const fin = await financial();
    const r = (await http().post('/api/privacy/retention/dry-run').set(auth(admin)).expect(201)).body;
    const by = Object.fromEntries(r.categories.map((c: Json) => [c.key, c]));
    expect(r.mode).toBe('dry');
    expect(by.sessions).toMatchObject({ eligible: 2, removed: 0 });
    expect(by.accountTokens).toMatchObject({ eligible: 1, removed: 0 });
    expect(by.mailDeliveries).toMatchObject({ eligible: 1, removed: 0 });
    expect(by.digestRuns).toMatchObject({ eligible: 1, removed: 0 });
    expect(by.notificationsRead).toMatchObject({ eligible: 1, removed: 0 });
    expect(by.notificationsUnread).toMatchObject({ eligible: 1, removed: 0 });
    expect(by.deletedDocuments).toMatchObject({ eligible: 1, keptForEvidence: 1, removed: 0, held: 3 });
    expect(by.loginFailures).toMatchObject({ eligible: 1, removed: 0 });
    expect(by.audit).toMatchObject({ eligible: 1, removed: 0 });
    for (const k of Object.keys(row).filter((x) => x.startsWith('s'))) expect(await exists('sessions', row[k]!), k).toBe(true);
    expect(await exists('audit_entries', row.aOut!)).toBe(true);
    expect(await exists('documents', docOut.id)).toBe(true);
    expect(await financial()).toEqual(fin);
    const o = (await http().get('/api/privacy/retention').set(auth(admin)).expect(200)).body;
    expect(o.lastDryRun).toMatchObject({ mode: 'dry', outcome: 'done' });
    expect(o.lastRun).toBeNull();
    expect(o.categories.find((c: Json) => c.key === 'audit')).toMatchObject({ days: 3650, defaultDays: 3650, floorDays: 1825, configurable: true, setByInstitution: false });
    expect(o.projects.find((x: Json) => x.acronym === 'CUV')).toMatchObject({ state: 'not_started', retentionEnd: null, years: 10 });
    expect(o.projectYears).toMatchObject({ defaultYears: 10, floorYears: 3, institutionYears: null });
    expect(o.confirmed).toEqual({ at: null, by: null });
  });

  it('dvije istovremene instance: posao se radi jednom; istekli zapisi nestaju, oni tik unutar roka ostaju', async () => {
    const fin = await financial();
    const day = '2026-11-18';
    const [a, b] = await Promise.all([
      retention.runTenant(tenantId, { dryRun: false, mode: 'scheduled', day }),
      retention.runTenant(tenantId, { dryRun: false, mode: 'scheduled', day }),
    ]);
    expect([a.claimed, b.claimed].sort()).toEqual([false, true]);
    const done = a.claimed ? a : b;
    expect(Object.fromEntries(done.categories.map((c) => [c.key, c.removed]))).toEqual({
      sessions: 2, accountTokens: 1, mailDeliveries: 1, digestRuns: 1, notificationsRead: 1, notificationsUnread: 1, deletedDocuments: 1, loginFailures: 1, audit: 1,
    });
    expect([await exists('sessions', row.sIn!), await exists('sessions', row.sLive!), await exists('sessions', row.sOut!), await exists('sessions', row.sRevokedOut!)]).toEqual([true, true, false, false]);
    expect([await exists('account_tokens', row.tIn!), await exists('account_tokens', row.tOut!)]).toEqual([true, false]);
    expect([await exists('mail_deliveries', row.mIn!), await exists('mail_deliveries', row.mOut!)]).toEqual([true, false]);
    expect([await exists('digest_runs', row.dIn!, 'day::text'), await exists('digest_runs', row.dOut!, 'day::text')]).toEqual([true, false]);
    expect([await exists('notifications', row.nReadIn!), await exists('notifications', row.nReadOut!), await exists('notifications', row.nUnreadIn!), await exists('notifications', row.nUnreadOut!)]).toEqual([true, false, true, false]);
    expect([await exists('audit_entries', row.aLoginIn!), await exists('audit_entries', row.aLoginOut!), await exists('audit_entries', row.aIn!), await exists('audit_entries', row.aOut!)]).toEqual([true, false, true, false]);
    // Dokumenti: istekli obrisan zajedno s datotekom; noviji ostaje; dokaz troška u predanom zahtjevu ostaje (rok projekta traje).
    expect([await exists('documents', docOut.id), await exists('documents', docIn), await exists('documents', docEvidence)]).toEqual([false, true, true]);
    expect(await exists('document_versions', docOut.id, 'document_id')).toBe(false);
    expect(await app.get(DocumentStorage).verify(docOut.key, docOut.sha, docOut.size)).toBe('missing');
    expect(await financial()).toEqual(fin);
    // Isti dan: ni treća instanca ne radi ništa.
    expect((await retention.runTenant(tenantId, { dryRun: false, mode: 'scheduled', day })).claimed).toBe(false);
    const o = (await http().get('/api/privacy/retention').set(auth(admin)).expect(200)).body;
    expect(o.lastRun).toMatchObject({ mode: 'scheduled', outcome: 'done', day });
    expect((await owner.query(`select count(*)::int as n from audit_entries where tenant_id = $1 and action in ('audit.purge', 'documents.purge')`, [tenantId])).rows[0].n).toBe(3);
  });

  it('ni jedna kombinacija postavki ne briše financijske dokaze ni dokaz koji se čuva; ispod donje granice 400', async () => {
    await http().put('/api/privacy/retention').set(auth(admin)).send({ retentionDays: { audit: 30 } }).expect(400);
    await http().put('/api/privacy/retention').set(auth(admin)).send({ retentionDays: { sessions: 1 } }).expect(400);
    await http().put('/api/privacy/retention').set(auth(admin)).send({ retentionDays: { accountTokens: 30 } }).expect(400); // nije promjenjiva
    await http().put('/api/privacy/retention').set(auth(admin)).send({ projectYears: { default: 0 } }).expect(400);
    const fin = await financial();
    // Izravan upis najkraćih mogućih vrijednosti mimo validacije – baza i posao i dalje drže donje granice.
    await owner.query(`update tenants set settings = jsonb_set(settings, '{privacy}', '{"retentionDays": {"sessions": 0, "mailDeliveries": 0, "notificationsRead": 0, "notificationsUnread": 0, "deletedDocuments": 0, "loginFailures": 0, "audit": 0}, "projectYears": {"default": 0, "programmes": {"npoo-2021-2026": 0}}}'::jsonb, true) where id = $1`, [tenantId]);
    const r = await retention.runTenant(tenantId, { dryRun: false, mode: 'scheduled', day: '2026-11-19' });
    expect(r.claimed).toBe(true);
    expect(Object.fromEntries(r.categories.map((c) => [c.key, c.days]))).toMatchObject({ sessions: 7, mailDeliveries: 30, deletedDocuments: 30, loginFailures: 90, audit: 1825 });
    expect(await exists('documents', docEvidence)).toBe(true);
    expect(await financial()).toEqual(fin);
    await owner.query(`update tenants set settings = settings - 'privacy' where id = $1`, [tenantId]);
  });

  it('serije su ograničene (broj i veličina) i izvođenje to javlja', async () => {
    for (let i = 0; i < 5; i++) await owner.query(`insert into mail_deliveries (tenant_id, user_id, kind, outcome, created_at) values ($1, $2, 'digest', 'sent', now() - interval '400 days')`, [tenantId, userId]);
    const r = await retention.runTenant(tenantId, { dryRun: false, mode: 'scheduled', day: '2026-11-20', batch: 2, maxBatches: 1 });
    const mail = r.categories.find((c) => c.key === 'mailDeliveries')!;
    expect(mail).toMatchObject({ eligible: 5, removed: 2, stoppedEarly: true });
    expect(r.stoppedEarly).toBe(true);
    const next = await retention.runTenant(tenantId, { dryRun: false, mode: 'scheduled', day: '2026-11-21', batch: 2, maxBatches: 5 });
    expect(next.categories.find((c) => c.key === 'mailDeliveries')!.removed).toBe(3);
  });

  it('promjena rokova je revidirana (prije i poslije), potvrda bilježi tko i kada; institucija vidi samo svoja izvođenja', async () => {
    const o = (await http().put('/api/privacy/retention').set(auth(admin)).send({ retentionDays: { mailDeliveries: 60 }, projectYears: { default: 11, programmes: { 'npoo-2021-2026': 12 } }, confirm: true }).expect(200)).body;
    expect(o.categories.find((c: Json) => c.key === 'mailDeliveries')).toMatchObject({ days: 60, setByInstitution: true });
    expect(o.projectYears.programmes.find((p: Json) => p.packageId === 'npoo-2021-2026')).toMatchObject({ years: 12, source: 'programme' });
    expect(o.confirmed.at).toEqual(expect.any(String));
    const a = (await owner.query(`select actor_id, diff from audit_entries where tenant_id = $1 and action = 'privacy.retention.update' order by id desc limit 1`, [tenantId])).rows[0];
    expect(a.diff.before.privacy).toEqual({});
    expect(a.diff.after.privacy).toMatchObject({ retentionDays: { mailDeliveries: 60 }, projectYears: { default: 11, programmes: { 'npoo-2021-2026': 12 } } });
    const other = randomUUID();
    const c = await appPool.connect();
    try {
      await c.query('begin'); await c.query(`select set_config('app.tenant_id', $1, true)`, [other]);
      expect((await c.query('select count(*)::int as n from retention_runs where tenant_id = $1', [tenantId])).rows[0].n).toBe(0);
      await expect(c.query(`insert into retention_runs (tenant_id, day, mode) values ($1, '2026-01-01', 'dry')`, [tenantId])).rejects.toThrow(/row-level security/);
    } finally { await c.query('rollback'); c.release(); }
  });
});
