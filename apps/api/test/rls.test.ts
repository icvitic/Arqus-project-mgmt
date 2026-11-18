import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';

/** Dokaz izolacije stanara na razini baze (ADR-0002): stanar A ne vidi i ne može pisati podatke stanara B. */
describe('Row-Level Security po stanaru', () => {
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const app = new Pool({ connectionString: APP_URL, max: 2 });
  const A = randomUUID(), B = randomUUID();
  const tag = randomUUID().slice(0, 8);

  beforeAll(async () => {
    await admin.query(`insert into tenants (id, slug, name) values ($1, $2, 'A'), ($3, $4, 'B')`, [A, `rls-a-${tag}`, B, `rls-b-${tag}`]);
    await admin.query(`insert into users (tenant_id, email, display_name) values ($1, 'a@a', 'A1'), ($1, 'a2@a', 'A2'), ($2, 'b@b', 'B1')`, [A, B]);
    await admin.query(`insert into audit_entries (tenant_id, actor_type, entity, action) values ($1, 'system', 'test', 'seed')`, [A]);
  });
  afterAll(async () => { await app.end(); await admin.end(); });

  async function asTenant<T>(tenantId: string | null, fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query('begin');
      if (tenantId) await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      const r = await fn((sql, params) => c.query(sql, params));
      await c.query('rollback');
      return r;
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  }

  it('aplikacijska uloga nema BYPASSRLS ni superuser', async () => {
    const { rows } = await app.query(`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`);
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('stanar A vidi samo svoje korisnike i svoj revizijski zapis', async () => {
    const r = await asTenant(A, async (q) => ({
      users: (await q(`select email from users where tenant_id in ($1,$2) order by email`, [A, B])).rows.map((x) => x.email),
      audit: (await q(`select count(*)::int as n from audit_entries where tenant_id in ($1,$2)`, [A, B])).rows[0]?.n,
      tenants: (await q(`select slug from tenants where id in ($1,$2)`, [A, B])).rows.length,
    }));
    expect(r.users).toEqual(['a2@a', 'a@a']);
    expect(r.audit).toBe(1);
    expect(r.tenants).toBe(1);
  });

  it('bez konteksta stanara nema redaka korisnika (fail-closed)', async () => {
    const n = await asTenant(null, async (q) => (await q(`select count(*)::int as n from users`)).rows[0]?.n);
    expect(n).toBe(0);
  });

  it('stanar A ne može unijeti ni promijeniti podatke stanara B', async () => {
    await expect(asTenant(A, (q) => q(`insert into users (tenant_id, email, display_name) values ($1, 'x@b', 'X')`, [B]))).rejects.toThrow(/row-level security/);
    const updated = await asTenant(A, async (q) => (await q(`update users set display_name = 'hak' where tenant_id = $1 returning id`, [B])).rows.length);
    expect(updated).toBe(0);
  });

  it('revizijski zapis je samo za dodavanje', async () => {
    await expect(asTenant(A, (q) => q(`update audit_entries set action = 'x' where tenant_id = $1`, [A]))).rejects.toThrow(/permission denied/);
    await expect(asTenant(A, (q) => q(`delete from audit_entries where tenant_id = $1`, [A]))).rejects.toThrow(/permission denied/);
  });

  it('sistemske uloge (tenant_id NULL) vidljive su stanaru, ali ih ne može mijenjati', async () => {
    await admin.query(`insert into roles (tenant_id, code, name, permissions) values (null, 'rls-sys-${tag}', 'Sys', '{"x:read"}') on conflict do nothing`);
    const seen = await asTenant(A, async (q) => (await q(`select code from roles where code = $1`, [`rls-sys-${tag}`])).rows.length);
    expect(seen).toBe(1);
    const changed = await asTenant(A, async (q) => (await q(`update roles set name = 'hak' where code = $1 returning id`, [`rls-sys-${tag}`])).rows.length);
    expect(changed).toBe(0);
  });
});

describe('RLS: programme_packages', () => {
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const app = new Pool({ connectionString: APP_URL, max: 1 });
  const A = randomUUID(), B = randomUUID(); const tag = randomUUID().slice(0, 8);
  beforeAll(async () => {
    await admin.query(`insert into tenants (id, slug, name) values ($1, $2, 'A'), ($3, $4, 'B')`, [A, `pk-a-${tag}`, B, `pk-b-${tag}`]);
    await admin.query(`insert into programme_packages (tenant_id, package_id, version, programme, valid_from, content, checksum) values
      (null, $1, '1.0.0', 'G', '2026-01-01', '{}', 'g'), ($2, $3, '1.0.0', 'A', '2026-01-01', '{}', 'a'), ($4, $5, '1.0.0', 'B', '2026-01-01', '{}', 'b')`,
      [`glob-${tag}`, A, `ten-a-${tag}`, B, `ten-b-${tag}`]);
  });
  afterAll(async () => { await app.end(); await admin.end(); });
  it('stanar vidi globalne i vlastite pakete, ne tuđe; globalne ne može mijenjati', async () => {
    const c = await app.connect();
    try {
      await c.query('begin'); await c.query(`select set_config('app.tenant_id', $1, true)`, [A]);
      const seen = (await c.query(`select package_id from programme_packages where package_id like $1 order by 1`, [`%-${tag}`])).rows.map((r) => r.package_id);
      expect(seen).toEqual([`glob-${tag}`, `ten-a-${tag}`]);
      const upd = await c.query(`update programme_packages set programme = 'hak' where package_id = $1 returning id`, [`glob-${tag}`]);
      expect(upd.rows.length).toBe(0);
      await expect(c.query(`insert into programme_packages (tenant_id, package_id, version, programme, valid_from, content, checksum) values (null, 'x-${tag}', '1', 'x', '2026-01-01', '{}', 'x')`)).rejects.toThrow(/row-level security/);
      await c.query('rollback');
    } finally { c.release(); }
  });
});

describe('RLS: svaka tablica i kompozitni strani ključevi', () => {
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const app = new Pool({ connectionString: APP_URL, max: 1 });
  afterAll(async () => { await app.end(); await admin.end(); });

  it('svaka tablica u shemi public ima uključen i prisilan (FORCE) RLS', async () => {
    const { rows } = await admin.query(`select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by 1`);
    const missing = rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity).map((r) => r.relname);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(missing).toEqual([]);
  });

  it('stanar A ne može dodati organizaciju stanara B kao partnera ni kad zna njezin id', async () => {
    const A = randomUUID(), B = randomUUID(), tag = randomUUID().slice(0, 8);
    await admin.query(`insert into tenants (id, slug, name) values ($1, $2, 'A'), ($3, $4, 'B')`, [A, `fk-a-${tag}`, B, `fk-b-${tag}`]);
    const pkg = (await admin.query(`insert into programme_packages (tenant_id, package_id, version, programme, valid_from, content, checksum) values (null, $1, '1.0.0', 'G', '2026-01-01', '{}', 'x') returning id`, [`fk-${tag}`])).rows[0].id;
    const orgB = (await admin.query(`insert into organisations (tenant_id, name, country) values ($1, 'Tuđa', 'HR') returning id`, [B])).rows[0].id;
    const projA = (await admin.query(`insert into projects (tenant_id, acronym, title, package_row_id, package_id, package_version, action_type) values ($1, 'P', 'Projekt', $2, $3, '1.0.0', 'RIA') returning id`, [A, pkg, `fk-${tag}`])).rows[0].id;
    const c = await app.connect();
    try {
      await c.query('begin'); await c.query(`select set_config('app.tenant_id', $1, true)`, [A]);
      await expect(c.query(`insert into project_partners (tenant_id, project_id, organisation_id, order_no) values ($1, $2, $3, 1)`, [A, projA, orgB])).rejects.toThrow(/foreign key/);
      await c.query('rollback');
    } finally { c.release(); }
  });
});

describe('RLS: obavijesti po korisniku i tokeni kalendara (WP1.18)', () => {
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const app = new Pool({ connectionString: APP_URL, max: 1 });
  const A = randomUUID(), B = randomUUID(), tag = randomUUID().slice(0, 8);
  let u1 = '', u2 = '', ub = '';
  beforeAll(async () => {
    await admin.query(`insert into tenants (id, slug, name) values ($1, $2, 'A'), ($3, $4, 'B')`, [A, `nt-a-${tag}`, B, `nt-b-${tag}`]);
    u1 = (await admin.query(`insert into users (tenant_id, email, display_name) values ($1, 'u1@a', 'U1') returning id`, [A])).rows[0].id;
    u2 = (await admin.query(`insert into users (tenant_id, email, display_name) values ($1, 'u2@a', 'U2') returning id`, [A])).rows[0].id;
    ub = (await admin.query(`insert into users (tenant_id, email, display_name) values ($1, 'ub@b', 'UB') returning id`, [B])).rows[0].id;
    await admin.query(`insert into notifications (tenant_id, user_id, kind) values ($1, $2, 'access_granted'), ($3, $4, 'access_granted')`, [A, u1, B, ub]);
    await admin.query(`insert into calendar_tokens (tenant_id, user_id, token_hash) values ($1, $2, $3), ($4, $5, $6)`, [A, u1, `hash-a-${tag}`, B, ub, `hash-b-${tag}`]);
  });
  afterAll(async () => { await app.end(); await admin.end(); });
  const run = async <T>(fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>, settings: Record<string, string>): Promise<T> => {
    const c = await app.connect();
    try {
      await c.query('begin');
      for (const [k, v] of Object.entries(settings)) await c.query(`select set_config($1, $2, true)`, [k, v]);
      return await fn((sql, p) => c.query(sql, p));
    } finally { await c.query('rollback'); c.release(); }
  };

  it('obavijest čita samo vlasnik: bez app.user_id ništa, drugi korisnik ništa, drugi stanar ništa; upis za drugog korisnika istog stanara smije', async () => {
    const count = (s: Record<string, string>) => run(async (q) => (await q(`select count(*)::int as n from notifications where user_id in ($1, $2, $3)`, [u1, u2, ub])).rows[0]!.n, s);
    expect(await count({ 'app.tenant_id': A })).toBe(0);
    expect(await count({ 'app.tenant_id': A, 'app.user_id': u2 })).toBe(0);
    expect(await count({ 'app.tenant_id': A, 'app.user_id': u1 })).toBe(1);
    expect(await count({ 'app.tenant_id': B, 'app.user_id': u1 })).toBe(0);
    expect(await run(async (q) => (await q(`update notifications set read_at = now() where user_id = $1 returning id`, [u1])).rows.length, { 'app.tenant_id': A, 'app.user_id': u2 })).toBe(0);
    expect(await run(async (q) => (await q(`delete from notifications where user_id = $1 returning id`, [u1])).rows.length, { 'app.tenant_id': A, 'app.user_id': u2 })).toBe(0);
    await run((q) => q(`insert into notifications (tenant_id, user_id, kind) values ($1, $2, 'x')`, [A, u2]), { 'app.tenant_id': A, 'app.user_id': u1 });
    await expect(run((q) => q(`insert into notifications (tenant_id, user_id, kind) values ($1, $2, 'x')`, [B, ub]), { 'app.tenant_id': A })).rejects.toThrow(/row-level security/);
    // Sadržaj je nepromjenjiv: aplikacija smije mijenjati samo read_at.
    await expect(run((q) => q(`update notifications set kind = 'hak' where user_id = $1`, [u1]), { 'app.tenant_id': A, 'app.user_id': u1 })).rejects.toThrow(/permission denied/);
  });

  it('token kalendara: bez stanara vidljiv samo redak čiji je hash postavljen u transakciji (nema nabrajanja)', async () => {
    const rows = (s: Record<string, string>) => run(async (q) => (await q(`select token_hash from calendar_tokens where token_hash like $1 order by 1`, [`hash-%-${tag}`])).rows.map((r) => r.token_hash), s);
    expect(await rows({})).toEqual([]);
    expect(await rows({ 'app.calendar_token_hash': `hash-b-${tag}` })).toEqual([`hash-b-${tag}`]);
    expect(await rows({ 'app.tenant_id': A })).toEqual([`hash-a-${tag}`]);
    expect(await run(async (q) => (await q(`delete from calendar_tokens where token_hash = $1 returning user_id`, [`hash-b-${tag}`])).rows.length, { 'app.calendar_token_hash': `hash-b-${tag}` })).toBe(0);
  });
});

describe('RLS: tokeni računa, isporuke e-pošte i dnevni sažetak (WP1.21)', () => {
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const app = new Pool({ connectionString: APP_URL, max: 1 });
  const A = randomUUID(), B = randomUUID(), tag = randomUUID().slice(0, 8);
  let ua = '', ub = '';
  beforeAll(async () => {
    await admin.query(`insert into tenants (id, slug, name) values ($1, $2, 'A'), ($3, $4, 'B')`, [A, `at-a-${tag}`, B, `at-b-${tag}`]);
    ua = (await admin.query(`insert into users (tenant_id, email, display_name) values ($1, 'ua@a', 'UA') returning id`, [A])).rows[0].id;
    ub = (await admin.query(`insert into users (tenant_id, email, display_name) values ($1, 'ub@b', 'UB') returning id`, [B])).rows[0].id;
    await admin.query(`insert into account_tokens (tenant_id, user_id, kind, token_hash, delivery, expires_at) values ($1, $2, 'invite', $3, 'link', now() + interval '1 day'), ($4, $5, 'reset', $6, 'mail', now() + interval '1 hour')`, [A, ua, `acc-a-${tag}`, B, ub, `acc-b-${tag}`]);
    await admin.query(`insert into mail_deliveries (tenant_id, user_id, kind, outcome) values ($1, $2, 'invite', 'sent'), ($3, $4, 'reset', 'failed')`, [A, ua, B, ub]);
    await admin.query(`insert into digest_runs (tenant_id, user_id, day) values ($1, $2, '2026-11-18'), ($3, $4, '2026-11-18')`, [A, ua, B, ub]);
  });
  afterAll(async () => { await app.end(); await admin.end(); });
  const run = async <T>(fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>, settings: Record<string, string>): Promise<T> => {
    const c = await app.connect();
    try {
      await c.query('begin');
      for (const [k, v] of Object.entries(settings)) await c.query(`select set_config($1, $2, true)`, [k, v]);
      return await fn((sql, p) => c.query(sql, p));
    } finally { await c.query('rollback'); c.release(); }
  };

  it('token računa: bez stanara vidljiv samo redak čiji je hash postavljen; bez stanara se ne briše; stanar vidi samo svoje', async () => {
    const rows = (s: Record<string, string>) => run(async (q) => (await q(`select token_hash from account_tokens where token_hash like $1 order by 1`, [`acc-%-${tag}`])).rows.map((r) => r.token_hash), s);
    expect(await rows({})).toEqual([]);
    expect(await rows({ 'app.account_token_hash': `acc-b-${tag}` })).toEqual([`acc-b-${tag}`]);
    expect(await rows({ 'app.tenant_id': A })).toEqual([`acc-a-${tag}`]);
    expect(await rows({ 'app.tenant_id': A, 'app.account_token_hash': `acc-b-${tag}` })).toEqual([`acc-a-${tag}`]);
    expect(await run(async (q) => (await q(`delete from account_tokens where token_hash = $1 returning user_id`, [`acc-b-${tag}`])).rows.length, { 'app.account_token_hash': `acc-b-${tag}` })).toBe(0);
    expect(await run(async (q) => (await q(`delete from account_tokens where token_hash = $1 returning user_id`, [`acc-b-${tag}`])).rows.length, { 'app.tenant_id': A })).toBe(0);
    // Aplikacija tokene ne mijenja (samo stvara i briše).
    await expect(run((q) => q(`update account_tokens set expires_at = now() + interval '10 years' where token_hash = $1`, [`acc-a-${tag}`]), { 'app.tenant_id': A })).rejects.toThrow(/permission denied/);
    await expect(run((q) => q(`insert into account_tokens (tenant_id, user_id, kind, token_hash, delivery, expires_at) values ($1, $2, 'reset', 'x', 'link', now())`, [B, ub]), { 'app.tenant_id': A })).rejects.toThrow(/row-level security/);
  });

  it('isporuke i sažetak: samo vlastiti stanar; isporuke se ne mijenjaju; sažetku se mijenja samo ishod', async () => {
    expect(await run(async (q) => (await q(`select kind from mail_deliveries where user_id in ($1, $2)`, [ua, ub])).rows.map((r) => r.kind), { 'app.tenant_id': A })).toEqual(['invite']);
    expect(await run(async (q) => (await q(`select count(*)::int as n from mail_deliveries where user_id in ($1, $2)`, [ua, ub])).rows[0]!.n, {})).toBe(0);
    await expect(run((q) => q(`update mail_deliveries set outcome = 'sent' where user_id = $1`, [ua]), { 'app.tenant_id': A })).rejects.toThrow(/permission denied/);
    expect(await run(async (q) => (await q(`select count(*)::int as n from digest_runs where user_id in ($1, $2)`, [ua, ub])).rows[0]!.n, { 'app.tenant_id': A })).toBe(1);
    // Isti korisnik i dan drugi put: jedinstven indeks (temelj jednokratnosti sažetka).
    expect(await run(async (q) => (await q(`insert into digest_runs (tenant_id, user_id, day) values ($1, $2, '2026-11-18') on conflict do nothing returning day`, [A, ua])).rows.length, { 'app.tenant_id': A })).toBe(0);
    await expect(run((q) => q(`update digest_runs set day = '2026-11-19' where user_id = $1`, [ua]), { 'app.tenant_id': A })).rejects.toThrow(/permission denied/);
  });
});
