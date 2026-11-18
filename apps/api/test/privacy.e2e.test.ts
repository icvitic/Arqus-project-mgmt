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
import { readSheet, readZip } from './zip-reader';
import { EXPORT_CATEGORIES } from '../src/privacy/subject-data';

/**
 * WP1.23 – prava ispitanika (e2e): izvoz podataka osobe (administrator, bez prava na plaće, samoposluga), zatvaranje
 * računa, anonimizacija nakon roka čuvanja i jedini put brisanja revizijskog zapisa. Sve nepovratne radnje izvode se samo
 * nad vlastitim fiksnim podacima ovog testa (vlastite institucije).
 *
 * Fiksni podaci: projekt NPOO od 1. 1. 2015. (12 mjeseci); Ana Anić (račun, voditeljica projekta i članica tima s plaćom)
 * i Ivan Horvat (član bez računa – „druga osoba” koja se ne smije pojaviti u Aninu izvozu); zahtjev za RP1 predan, odlučen
 * i isplaćen; isplata se u fiksnim podacima pomiče na 2016. (vlasničkom vezom) da rok čuvanja može isteći.
 */
const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
const PDF = (s: string) => Buffer.from(`%PDF-1.7\n% ${s}\n1 0 obj << >> endobj\n%%EOF\n`);
type Json = Record<string, unknown>;

describe('Prava ispitanika: izvoz, zatvaranje računa, anonimizacija (WP1.23, e2e)', () => {
  let app: INestApplication;
  const tag = randomUUID().slice(0, 8); const slug = `pv-${tag}`; const other = `pvo-${tag}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const PW = 'Plava-Staza-2027-x';
  const login = async (s: string, email: string, pw = PW) => (await http().post('/api/auth/login').send({ tenantSlug: s, email, password: pw }).expect(201)).body.accessToken as string;
  const owner = new Pool({ connectionString: ADMIN_URL, max: 2 });
  const appPool = new Pool({ connectionString: APP_URL, max: 2 });
  const t: Record<string, string> = {};
  const id: Record<string, string> = {};
  let tenantId = ''; let otherTenantId = ''; let calendarToken = ''; let resetToken = '';

  const download = (url: string, token: string) => http().get(url).set(auth(token)).buffer(true)
    .parse((res, cb) => { const parts: Buffer[] = []; res.on('data', (c: Buffer) => parts.push(c)); res.on('end', () => cb(null, Buffer.concat(parts))); });
  const unpack = (zip: Buffer) => new Map(readZip(zip).map((e) => [e.name, e.data]));
  const exportFor = async (token: string, q: string) => {
    const r = await download(`/api/privacy/export?${q}`, token).expect(200);
    expect(r.headers['content-type']).toBe('application/zip');
    expect(String(r.headers['cache-control'])).toContain('no-store');
    const files = unpack(r.body as Buffer);
    return { files, json: JSON.parse(files.get('podaci.json')!.toString('utf8')) as { meta: Json; categories: Record<string, Json[]> }, all: [...files.values()].map((b) => b.toString('utf8')).join('\n') + xlsxText(files.get('podaci.xlsx')!) };
  };
  /** Sav tekst iz radne knjige (dijeljeni nizovi), da provjera trećih osoba pokrije i XLSX. */
  const xlsxText = (b: Buffer) => [...readZip(b)].map((e) => e.data.toString('utf8')).join('\n');
  const asApp = async <T>(tenant: string | null, fn: (q: (s: string, p?: unknown[]) => Promise<{ rows: Json[]; rowCount: number | null }>) => Promise<T>): Promise<T> => {
    const c = await appPool.connect();
    try {
      await c.query('begin');
      if (tenant) await c.query(`select set_config('app.tenant_id', $1, true)`, [tenant]);
      const r = await fn((s, p) => c.query(s, p) as never);
      await c.query('commit');
      return r;
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  };
  const evidence = async () => (await owner.query(`select
      (select json_agg(row_to_json(x) order by x.id) from (select id, team_member_id, month, status, approved_by, submitted_by from timesheets where project_id = $1) x) as timesheets,
      (select json_agg(row_to_json(x) order by x.id) from (select e.* from timesheet_entries e join timesheets t on t.id = e.timesheet_id where t.project_id = $1) x) as entries,
      (select json_agg(row_to_json(x) order by x.id) from (select id, amount_cents, recognised_cents, status, claim_id, category_code, date, timesheet_id from expenses where project_id = $1) x) as expenses,
      (select json_agg(row_to_json(x) order by x.id) from (select id, status, totals, requested_cents, approved_cents, paid_cents, submission, decision from reimbursement_claims where project_id = $1) x) as claims`, [id.project])).rows[0];

  beforeAll(async () => {
    process.env.DATABASE_URL = APP_URL;
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), 'arqus-privacy-'));
    process.env.EXPORT_RATE_MAX = '12';
    await seedDemo({ url: ADMIN_URL, tenantSlug: slug, adminEmail: `a@${slug}.hr`, adminPassword: 'Lozinka-123456' });
    await seedDemo({ url: ADMIN_URL, tenantSlug: other, adminEmail: `a@${other}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    t.admin = await login(slug, `a@${slug}.hr`, 'Lozinka-123456');
    t.other = await login(other, `a@${other}.hr`, 'Lozinka-123456');
    tenantId = (await owner.query<{ id: string }>('select id from tenants where slug = $1', [slug])).rows[0]!.id;
    otherTenantId = (await owner.query<{ id: string }>('select id from tenants where slug = $1', [other])).rows[0]!.id;
    // Operater zaštite podataka BEZ prava na plaće (stanarska uloga; ruta za uloge ne postoji, pa vlasničkom vezom).
    await owner.query(`insert into roles (tenant_id, code, name, permissions) values ($1, 'zastita-podataka', 'Zaštita podataka', '{privacy:manage,users:read}')`, [tenantId]);
    id.ana = (await inviteUser(app, t.admin, { email: `ana@${slug}.hr`, displayName: 'Ana Anić' }, PW)).id;
    id.ured = (await inviteUser(app, t.admin, { email: `ured@${slug}.hr`, displayName: 'Uredska Osoba', roleCodes: ['project-office'] }, PW)).id;
    id.officer = (await inviteUser(app, t.admin, { email: `dpo@${slug}.hr`, displayName: 'Službenica Zaštite', roleCodes: ['zastita-podataka'] }, PW)).id;
    id.plain = (await inviteUser(app, t.admin, { email: `obican@${slug}.hr`, displayName: 'Obični Korisnik', roleCodes: ['reader'] }, PW)).id;
    t.ana = await login(slug, `ana@${slug}.hr`); t.ured = await login(slug, `ured@${slug}.hr`); t.officer = await login(slug, `dpo@${slug}.hr`); t.plain = await login(slug, `obican@${slug}.hr`);

    const p = (await http().post('/api/projects').set(auth(t.admin)).send({ acronym: 'PRIV-15', title: 'Projekt za zaštitu podataka', packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA', contractNo: `UG-${tag}`, startDate: '2015-01-01', durationMonths: 12, managerUserId: id.ana }).expect(201)).body;
    id.project = p.id; const self = p.partners[0].id;
    id.project2 = (await http().post('/api/projects').set(auth(t.admin)).send({ acronym: 'DRUGI-15', title: 'Drugi projekt', packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA', startDate: '2015-01-01', durationMonths: 12 }).expect(201)).body.id;
    const wp = (await http().post(`/api/projects/${id.project}/work-packages`).set(auth(t.admin)).send({ title: 'Istraživanje', startMonth: 1, endMonth: 12 }).expect(201)).body.id;
    await http().put(`/api/projects/${id.project}/budget/lines`).set(auth(t.admin)).send({ revision: 0, lines: [{ partnerId: self, categoryCode: 'OS', amount: 9_000_000 }, { partnerId: self, categoryCode: 'PUT', amount: 300_000 }] }).expect(200);
    id.anaMember = (await http().post(`/api/projects/${id.project}/team`).set(auth(t.admin)).send({ fullName: 'Ana Anić', userId: id.ana, role: 'istraživačica', annualCost: 4_200_000 }).expect(201)).body.id;
    id.ivanMember = (await http().post(`/api/projects/${id.project}/team`).set(auth(t.admin)).send({ fullName: 'Ivan Horvat', role: 'tehničar', annualCost: 3_000_000 }).expect(201)).body.id;
    // Ista osoba (bez računa) na drugom projektu – sustav je samo predlaže, ne pripisuje.
    id.anaOther = (await http().post(`/api/projects/${id.project2}/team`).set(auth(t.admin)).send({ fullName: 'Ana Anić' }).expect(201)).body.id;
    await http().post(`/api/projects/${id.project}/transition`).set(auth(t.admin)).send({ to: 'active' }).expect(201);
    await http().post(`/api/projects/${id.project}/milestones`).set(auth(t.admin)).send({ title: 'Prototip', dueMonth: 6, responsibleMemberId: id.anaMember }).expect(201);
    await http().post(`/api/projects/${id.project}/risks`).set(auth(t.admin)).send({ description: 'Kašnjenje opreme', likelihood: 2, impact: 2, ownerUserId: id.ana }).expect(201);
    // Ana: timesheet predaje administrator, odobrava ured. Ivan: predaje administrator, odobrava Ana (voditeljica – četiri oka).
    const ts = async (member: string, approver: string, entries: unknown[]) => {
      await http().put(`/api/projects/${id.project}/team/${member}/timesheets/2015-02`).set(auth(t.admin)).send({ revision: 0, entries }).expect(200);
      await http().post(`/api/projects/${id.project}/team/${member}/timesheets/2015-02/submit`).set(auth(t.admin)).expect(201);
      await http().post(`/api/projects/${id.project}/team/${member}/timesheets/2015-02/approve`).set(auth(approver)).expect(201);
    };
    await ts(id.anaMember, t.ured, [{ day: 3, minutes: 480, workPackageId: wp }, { day: 4, minutes: 300, workPackageId: wp }]);
    await ts(id.ivanMember, t.ana, [{ day: 5, minutes: 420, workPackageId: wp }]);
    await http().post(`/api/projects/${id.project}/expenses`).set(auth(t.admin)).send({ categoryCode: 'PUT', date: '2015-02-20', description: 'Putni nalog – Ana Anić, Split', amount: 45_000 }).expect(201);
    id.claim = (await http().post(`/api/projects/${id.project}/claims`).set(auth(t.admin)).send({ period: 1 }).expect(201)).body.id;
    const c0 = (await http().get(`/api/projects/${id.project}/claims/${id.claim}`).set(auth(t.admin)).expect(200)).body;
    const ack = c0.checklist.items.find((i: { key: string }) => i.key === 'evidence')?.expenseIds ?? [];
    await http().post(`/api/projects/${id.project}/claims/${id.claim}/submit`).set(auth(t.admin)).send({ acknowledgeWithoutEvidence: ack }).expect(201);
    await http().post(`/api/projects/${id.project}/claims/${id.claim}/decision`).set(auth(t.ured)).send({ decision: 'decided' }).expect(201);
    const decided = (await http().get(`/api/projects/${id.project}/claims/${id.claim}`).set(auth(t.admin)).expect(200)).body;
    await http().post(`/api/projects/${id.project}/claims/${id.claim}/payment`).set(auth(t.ured)).send({ paidAmount: decided.approvedCents ?? decided.totals?.requested ?? 0, paidAt: decided.decisionDate }).expect(201);
    // Dokument koji je prenijela Ana, kalendar, poveznica za novu lozinku, poziv koji prati, prijava koju vodi.
    await http().post('/api/documents').set(auth(t.ana)).field({ entityType: 'project', entityId: id.project, kind: 'other' }).attach('file', PDF('izvjesce'), 'izvjesce-o-radu.pdf').expect(201);
    calendarToken = (await http().post('/api/me/calendar').set(auth(t.ana)).expect(201)).body.token;
    resetToken = (await http().post(`/api/users/${id.ana}/password-link`).set(auth(t.admin)).expect(201)).body.token;
    const call = (await http().post('/api/calls').set(auth(t.admin)).send({ code: `PRIV-${tag}`, title: 'Poziv za praćenje', programme: 'NPOO' }).expect(201)).body.id;
    await http().put(`/api/calls/${call}/decision`).set(auth(t.admin)).send({ decision: 'watch', ownerUserId: id.ana }).expect(200);
    await http().post('/api/proposals').set(auth(t.admin)).send({ packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA', acronym: 'ANA-PR', title: 'Prijava koju vodi Ana', leadUserId: id.ana }).expect(201);
    // Zapis isporuke pošte i sažetka (bez SMTP-a u testu) – vlasničkom vezom, kao da ih je stvorio posao pošte.
    await owner.query(`insert into mail_deliveries (tenant_id, user_id, kind, outcome) values ($1, $2, 'digest', 'sent')`, [tenantId, id.ana]);
    await owner.query(`insert into digest_runs (tenant_id, user_id, day, outcome) values ($1, $2, '2026-01-05', 'sent')`, [tenantId, id.ana]);
  }, 120_000);
  afterAll(async () => { await app.close(); await owner.end(); await appPool.end(); });

  it('pretraga predlaže, a ne pripisuje: zapis bez računa istog imena je samo kandidat', async () => {
    const found = (await http().get('/api/privacy/people?q=Anić').set(auth(t.admin)).expect(200)).body;
    expect(found.users.map((u: Json) => u.id)).toContain(id.ana);
    const s = (await http().post('/api/privacy/subject').set(auth(t.admin)).send({ userId: id.ana }).expect(201)).body;
    expect(s.members.map((m: Json) => m.id)).toEqual([id.anaMember]);
    expect(s.candidates.map((m: Json) => m.id)).toEqual([id.anaOther]);
    // Zapis povezan s drugim računom ne može se pripisati; zapis druge institucije ne postoji.
    const uredMember = (await http().post(`/api/projects/${id.project2}/team`).set(auth(t.admin)).send({ fullName: 'Uredska Osoba', userId: id.ured }).expect(201)).body.id;
    await http().post('/api/privacy/subject').set(auth(t.admin)).send({ userId: id.ana, memberIds: [uredMember] }).expect(409);
    await http().post('/api/privacy/subject').set(auth(t.other)).send({ userId: id.ana }).expect(404);
    await http().post('/api/privacy/subject').set(auth(t.other)).send({ memberIds: [id.anaMember] }).expect(404);
    await http().post('/api/privacy/subject').set(auth(t.plain)).send({ userId: id.ana }).expect(403);
  });

  it('izvoz administratora: svaka kategorija evidencije prisutna, s iznosima; ništa o drugoj osobi', async () => {
    const { files, json, all } = await exportFor(t.admin, `userId=${id.ana}&memberIds=${id.anaOther}`);
    expect([...files.keys()].sort()).toEqual(['podaci.json', 'podaci.xlsx', 'procitaj-me.html']);
    expect(json.meta.withAmounts).toBe(true);
    const empty = EXPORT_CATEGORIES.filter((k) => !json.categories[k]?.length);
    expect(empty).toEqual([]);
    expect(json.categories.teamMemberships!.find((m) => m.project === 'PRIV-15')!.annualCostCents).toBe(4_200_000);
    expect(json.categories.personnelCosts!.every((e) => typeof e.amountCents === 'number')).toBe(true);
    expect(json.categories.timesheets![0]).toMatchObject({ month: '2015-02', totalMinutes: 780, approvedBy: 'Uredska Osoba' });
    // Druga osoba istog projekta: ni ime, ni id zapisa, ni sati, ni iznos (Ana je odobrila njegov timesheet – to je
    // zapis u kojem je akter, bez sadržaja). Odobravateljeva e-adresa i lozinke/tokeni nikad.
    for (const s of ['Ivan Horvat', id.ivanMember, '3000000', `ured@${slug}.hr`, 'passwordHash', 'mfaSecret', 'tokenHash', calendarToken, resetToken]) expect(all, s).not.toContain(s);
    const actorOnly = json.categories.audit!.filter((a) => a.role === 'akter');
    expect(actorOnly.some((a) => a.entity === 'timesheet' && a.action === 'approve')).toBe(true);
    expect(actorOnly.every((a) => a.diff === undefined && a.entityId === undefined)).toBe(true);
    // Zapis kojemu je Ana predmet, a napravio ga je administrator: akter je „drugi korisnik”, bez IP-a; id-jevi trećih osoba skriveni.
    const created = json.categories.audit!.find((a) => a.entity === 'team_member' && a.action === 'create')!;
    expect(created).toMatchObject({ actor: 'drugi korisnik', ip: null, role: 'predmet' });
    expect(JSON.stringify(created.diff)).toContain('[treća osoba]');
    expect(JSON.stringify(created.diff)).toContain('Ana Anić');
    // Čitljiv sažetak i radna knjiga (neovisan čitač).
    expect(files.get('procitaj-me.html')!.toString('utf8')).toContain('<b>su uključeni</b>');
    const x = new Map(readZip(files.get('podaci.xlsx')!).map((e) => [e.name, e.data.toString('utf8')]));
    expect([...readSheet(x, 1).values()].some((c) => c.v.startsWith('Podaci o osobi – Ana Anić'))).toBe(true);
  });

  it('izvoz bez prava na plaće: bez iznosa i to izričito kaže; revizija bez sadržaja', async () => {
    const { json, files, all } = await exportFor(t.officer, `userId=${id.ana}`);
    expect(json.meta.withAmounts).toBe(false);
    expect(json.categories.teamMemberships!.every((m) => m.annualCostCents === null)).toBe(true);
    expect(json.categories.personnelCosts!.every((e) => e.amountCents === null && e.recognisedCents === null)).toBe(true);
    expect(all).not.toContain('4200000');
    expect(files.get('procitaj-me.html')!.toString('utf8')).toContain('<b>nisu uključeni</b>');
    const { rows } = await owner.query(`select actor_id, diff from audit_entries where tenant_id = $1 and entity = 'privacy' and action = 'export' order by id`, [tenantId]);
    expect(rows.map((r) => [r.actor_id, r.diff.meta.withAmounts])).toEqual([[expect.any(String), true], [id.officer, false]]);
    expect(rows[1]!.diff.meta).toMatchObject({ subjectUserId: id.ana, memberIds: [id.anaMember], selfService: false });
    for (const r of rows) expect(JSON.stringify(r.diff)).not.toMatch(/Anić|ana@|4200000|2015-02/);
  });

  it('samoposluga: vlastiti podaci bez iznosa (kao u sučelju) uz uputu na instituciju; nikad tuđi', async () => {
    const r = await download('/api/me/privacy-export', t.ana).expect(200);
    const files = unpack(r.body as Buffer);
    const json = JSON.parse(files.get('podaci.json')!.toString('utf8'));
    expect(json.meta).toMatchObject({ selfService: true, withAmounts: false });
    expect(json.subject.account.email).toBe(`ana@${slug}.hr`);
    expect(files.get('procitaj-me.html')!.toString('utf8')).toContain('Potpuni izvoz s iznosima možeš zatražiti od institucije');
    expect(JSON.stringify(json)).not.toContain('Ivan Horvat');
    // Korisnik bez privacy:manage ne izvozi tuđe podatke.
    await download(`/api/privacy/export?userId=${id.ana}`, t.ana).expect(403);
    await download(`/api/privacy/export?userId=${id.ana}`, t.other).expect(404);
    await download('/api/privacy/export?userId=nije-uuid', t.admin).expect(400);
  });

  it('zatvaranje računa: potvrda, nitko ne zatvara sebe; zatim nema prijave ni jednim putem; dokazi nepromijenjeni; ponavljanje bez promjene', async () => {
    const before = await evidence();
    // Prije zatvaranja: sesija i kalendar rade (odbijanje poslije dolazi od zatvaranja).
    await http().get('/api/me').set(auth(t.ana)).expect(200);
    await http().get(`/api/calendar/${calendarToken}.ics`).expect(200);
    await http().post(`/api/privacy/users/${id.ana}/close`).set(auth(t.admin)).send({ confirmation: 'Ana', reason: 'Otišla s instituta' }).expect(400);
    await http().post(`/api/privacy/users/${id.officer}/close`).set(auth(t.officer)).send({ confirmation: 'Službenica Zaštite', reason: 'test vlastitog' }).expect(403);
    await http().post(`/api/privacy/users/${id.ana}/close`).set(auth(t.plain)).send({ confirmation: 'Ana Anić', reason: 'Otišla s instituta' }).expect(403);
    await http().post(`/api/privacy/users/${id.ana}/close`).set(auth(t.other)).send({ confirmation: 'Ana Anić', reason: 'Otišla s instituta' }).expect(404);
    const r = (await http().post(`/api/privacy/users/${id.ana}/close`).set(auth(t.admin)).send({ confirmation: 'Ana Anić', reason: 'Otišla s instituta' }).expect(201)).body;
    expect(r).toMatchObject({ status: 'closed', alreadyClosed: false });
    expect(r.removed.sessions).toBeGreaterThan(0); expect(r.removed.calendar).toBe(1); expect(r.removed.accountTokens).toBe(1); expect(r.removed.roles).toBeGreaterThan(0);
    // Nijedan put prijave: lozinka, postojeća sesija, kalendar, poveznica za novu lozinku, zaboravljena lozinka, reaktivacija.
    await http().post('/api/auth/login').send({ tenantSlug: slug, email: `ana@${slug}.hr`, password: PW }).expect(401);
    await http().get('/api/me').set(auth(t.ana)).expect(401);
    await http().get(`/api/calendar/${calendarToken}.ics`).expect(404);
    await http().post('/api/auth/password/reset').send({ token: resetToken, password: 'Nova-Lozinka-2028-z' }).expect(400);
    await http().post('/api/auth/password/forgot').send({ tenantSlug: slug, email: `ana@${slug}.hr` }).expect(202);
    await new Promise((res) => setTimeout(res, 300));
    expect((await owner.query('select count(*)::int as n from account_tokens where user_id = $1', [id.ana])).rows[0].n).toBe(0);
    await http().patch(`/api/users/${id.ana}`).set(auth(t.admin)).send({ status: 'active' }).expect(409);
    await http().post(`/api/users/${id.ana}/invitation`).set(auth(t.admin)).expect(409);
    await http().post(`/api/projects/${id.project}/access`).set(auth(t.admin)).send({ userId: id.ana, roleCode: 'team-member' }).expect(404);
    const u = (await owner.query('select email, password_hash, mfa_secret_enc, display_name, status, digest_enabled from users where id = $1', [id.ana])).rows[0];
    expect(u).toEqual({ email: `zatvoren-${id.ana}@racun.invalid`, password_hash: null, mfa_secret_enc: null, display_name: 'Ana Anić', status: 'closed', digest_enabled: false });
    for (const tbl of ['sessions', 'calendar_tokens', 'notifications', 'mail_deliveries', 'digest_runs', 'role_assignments']) {
      expect((await owner.query(`select count(*)::int as n from ${tbl} where user_id = $1`, [id.ana])).rows[0].n, tbl).toBe(0);
    }
    // E-adresa je ponovno slobodna (nova osoba istog imena dobiva novi račun, ne stari).
    expect(await evidence()).toEqual(before);
    // Ponavljanje: bez promjene i bez novog zapisa.
    expect((await http().post(`/api/privacy/users/${id.ana}/close`).set(auth(t.admin)).send({ confirmation: 'x', reason: 'ponovno' }).expect(201)).body.alreadyClosed).toBe(true);
    expect((await owner.query(`select count(*)::int as n from audit_entries where entity = 'user' and entity_id = $1 and action = 'close'`, [id.ana])).rows[0].n).toBe(1);
    // Izvoz zatvorene osobe i dalje radi (podaci institucije o njoj postoje).
    const { json } = await exportFor(t.admin, `userId=${id.ana}`);
    expect(json.categories.account![0]).toMatchObject({ status: 'closed', email: `zatvoren-${id.ana}@racun.invalid` });
  });

  it('anonimizacija: dok traje rok čuvanja odbija se bez razloga (s datumom); pregled = učinak; zbrojevi i paket ZNS-a isti osim imena', async () => {
    // Rok: projekt aktivan → rok nije počeo.
    let p = (await http().post(`/api/privacy/members/${id.anaMember}/anonymise/preview`).set(auth(t.admin)).expect(201)).body;
    expect(p.retention).toMatchObject({ end: null, running: true });
    await http().post(`/api/privacy/members/${id.anaMember}/anonymise`).set(auth(t.admin)).send({ confirmation: 'Ana Anić', fingerprint: p.fingerprint }).expect(409);
    // Zatvaranje projekta; isplata u fiksnim podacima 2016. Rok po paketu programa: 50 godina → traje (s datumom).
    for (const to of ['closing', 'closed']) await http().post(`/api/projects/${id.project}/transition`).set(auth(t.admin)).send({ to }).expect(201);
    await owner.query(`update reimbursement_claims set decision_date = '2016-02-01', paid_at = '2016-03-01' where id = $1`, [id.claim]);
    await http().put('/api/privacy/retention').set(auth(t.admin)).send({ projectYears: { programmes: { 'npoo-2021-2026': 2 } } }).expect(400); // ispod donje granice
    await http().put('/api/privacy/retention').set(auth(t.admin)).send({ projectYears: { programmes: { 'npoo-2021-2026': 50 } } }).expect(200);
    p = (await http().post(`/api/privacy/members/${id.anaMember}/anonymise/preview`).set(auth(t.admin)).expect(201)).body;
    expect(p.retention).toMatchObject({ end: '2066-03-01', running: true });
    const refused = await http().post(`/api/privacy/members/${id.anaMember}/anonymise`).set(auth(t.admin)).send({ confirmation: 'Ana Anić', fingerprint: p.fingerprint }).expect(409);
    expect(refused.body).toMatchObject({ code: 'retention_running', retentionEnd: '2066-03-01' });
    expect(refused.body.message).toContain('2066-03-01');
    // Rok 3 godine (najmanje) → istekao 2019.
    await http().put('/api/privacy/retention').set(auth(t.admin)).send({ projectYears: { programmes: { 'npoo-2021-2026': 3 } } }).expect(200);
    p = (await http().post(`/api/privacy/members/${id.anaMember}/anonymise/preview`).set(auth(t.admin)).expect(201)).body;
    expect(p.retention).toMatchObject({ end: '2019-03-01', running: false });
    expect(p.pseudonym).toBe('Bivši član tima 1');
    expect(p.changes.teamMember.map((c: Json) => c.field)).toEqual(['ime i prezime', 'uloga u timu', 'veza s korisničkim računom']);
    expect(p.changes.expenses.length).toBeGreaterThan(0);
    expect(p.changes.expenses.every((e: Json) => String(e.after).includes('Bivši član tima 1') && !String(e.after).includes('Ana Anić'))).toBe(true);
    // Slobodni tekst koji spominje ime (putni nalog, snimka predaje) samo se navodi; Anin dokument je za pregled.
    expect(p.flagged.map((f: Json) => f.where)).toContain('trošak');
    expect(p.documents.map((d: Json) => d.fileName)).toEqual(['izvjesce-o-radu.pdf']);

    const before = await evidence();
    const claimBefore = (await http().get(`/api/projects/${id.project}/claims/${id.claim}`).set(auth(t.admin)).expect(200)).body;
    const pkgBefore = unpack((await download(`/api/projects/${id.project}/claims/${id.claim}/export`, t.admin).expect(200)).body as Buffer);
    await http().post(`/api/privacy/members/${id.anaMember}/anonymise`).set(auth(t.admin)).send({ confirmation: 'Ana', fingerprint: p.fingerprint }).expect(400);
    await http().post(`/api/privacy/members/${id.anaMember}/anonymise`).set(auth(t.admin)).send({ confirmation: 'Ana Anić', fingerprint: 'a'.repeat(64) }).expect(409);
    await http().post(`/api/privacy/members/${id.anaMember}/anonymise`).set(auth(t.plain)).send({ confirmation: 'Ana Anić', fingerprint: p.fingerprint }).expect(403);
    await http().post(`/api/privacy/members/${id.anaMember}/anonymise`).set(auth(t.other)).send({ confirmation: 'Ana Anić', fingerprint: p.fingerprint }).expect(404);
    const done = (await http().post(`/api/privacy/members/${id.anaMember}/anonymise`).set(auth(t.admin)).send({ confirmation: 'Ana Anić', fingerprint: p.fingerprint }).expect(201)).body;
    expect(done).toMatchObject({ pseudonym: 'Bivši član tima 1', expensesUpdated: p.changes.expenses.length });

    // Pregled = učinak.
    const m = (await owner.query('select full_name, role, user_id, pseudonym, annual_cost_cents from team_members where id = $1', [id.anaMember])).rows[0];
    expect(m).toEqual({ full_name: 'Bivši član tima 1', role: null, user_id: null, pseudonym: 'Bivši član tima 1', annual_cost_cents: '4200000' });
    for (const e of p.changes.expenses) expect((await owner.query('select description from expenses where id = $1', [e.id])).rows[0].description).toBe(e.after);
    // Zbrojevi, sati, iznosi, statusi i zahtjevi jednaki (opis nije u snimci dokaza).
    expect(await evidence()).toEqual(before);
    const claimAfter = (await http().get(`/api/projects/${id.project}/claims/${id.claim}`).set(auth(t.admin)).expect(200)).body;
    expect(claimAfter.totals).toEqual(claimBefore.totals);
    expect(claimAfter.expenses.map((e: Json) => [e.id, e.amount, e.recognised, e.status])).toEqual(claimBefore.expenses.map((e: Json) => [e.id, e.amount, e.recognised, e.status]));
    // Paket ZNS-a: iste datoteke i isti sadržaj radne knjige uz zamjenu imena pseudonimom (naziv evidencije rada prati ime).
    const pkgAfter = unpack((await download(`/api/projects/${id.project}/claims/${id.claim}/export`, t.admin).expect(200)).body as Buffer);
    const rename = (n: string) => n.replace('Ana-Anic', 'Bivsi-clan-tima-1');
    expect([...pkgAfter.keys()].sort()).toEqual([...pkgBefore.keys()].map(rename).sort());
    // Radna knjiga: svaka brojčana ćelija (iznosi, sati, stope, datumi) na istom mjestu jednaka; u tekstu je ime u opisu troška
    // osoblja zamijenjeno, uloga obrisana, a putni nalog koji spominje ime ostaje kakav je bio (naveden za pregled, ne mijenja se).
    const sheets = (files: Map<string, Buffer>) => readZip(files.get('troskovi.xlsx')!).filter((e) => /sheet\d+\.xml/.test(e.name)).map((e) => e.data.toString('utf8'));
    const numbers = (files: Map<string, Buffer>) => sheets(files).map((x) => [...x.matchAll(/<c r="([A-Z]+\d+)"(?: s="\d+")?><v>([^<]*)<\/v><\/c>/g)].map((m) => `${m[1]}=${m[2]}`).join(';'));
    expect(numbers(pkgAfter)).toEqual(numbers(pkgBefore));
    const strings = (files: Map<string, Buffer>) => readZip(files.get('troskovi.xlsx')!).find((e) => e.name === 'xl/sharedStrings.xml')!.data.toString('utf8');
    expect(strings(pkgBefore)).toContain('Rad: Ana Anić, 2015-02');
    expect(strings(pkgAfter)).toContain('Rad: Bivši član tima 1, 2015-02');
    expect(strings(pkgAfter)).not.toContain('Rad: Ana Anić');
    expect(strings(pkgAfter)).toContain('Putni nalog – Ana Anić, Split');
    const rec = [...pkgBefore.keys()].find((k) => k.includes('Ana-Anic'))!;
    expect(pkgAfter.get(rename(rec))!.toString('utf8')).toBe(pkgBefore.get(rec)!.toString('utf8').split('Ana Anić').join('Bivši član tima 1').replace(' · istraživačica', ''));
    // Revizija anonimizacije ne ponavlja ime; okidač je zabilježio svaku zamjenu u odlučenom trošku.
    const a = (await owner.query(`select diff from audit_entries where entity = 'team_member' and entity_id = $1 and action = 'anonymise'`, [id.anaMember])).rows[0];
    expect(JSON.stringify(a.diff)).not.toContain('Ana');
    expect(a.diff.meta).toMatchObject({ pseudonym: 'Bivši član tima 1', beforeRetentionEnd: false, accountLinkCut: true });
    expect((await owner.query(`select count(*)::int as n from audit_entries where tenant_id = $1 and action = 'description.anonymise'`, [tenantId])).rows[0].n).toBeGreaterThan(0);
    // Ponovno: odbija se; preimenovanje anonimiziranog zapisa odbija i aplikacija i baza.
    await http().post(`/api/privacy/members/${id.anaMember}/anonymise`).set(auth(t.admin)).send({ confirmation: 'Bivši član tima 1', fingerprint: p.fingerprint }).expect(409);
    await expect(asApp(tenantId, (q) => q(`update team_members set full_name = 'Ana Anić' where id = $1`, [id.anaMember]))).rejects.toThrow(/team_members_anonymised_ck/);
  });

  it('anonimizacija prije isteka roka uz zabilježen razlog; nepromjenjivost odlučenih troškova i dalje vrijedi', async () => {
    await http().put('/api/privacy/retention').set(auth(t.admin)).send({ projectYears: { programmes: { 'npoo-2021-2026': 50 } } }).expect(200);
    const p = (await http().post(`/api/privacy/members/${id.ivanMember}/anonymise/preview`).set(auth(t.admin)).expect(201)).body;
    expect(p.retention.running).toBe(true);
    expect(p.pseudonym).toBe('Bivši član tima 2');
    await http().post(`/api/privacy/members/${id.ivanMember}/anonymise`).set(auth(t.admin)).send({ confirmation: 'Ivan Horvat', fingerprint: p.fingerprint, reason: 'kratko' }).expect(409);
    await http().post(`/api/privacy/members/${id.ivanMember}/anonymise`).set(auth(t.admin)).send({ confirmation: 'Ivan Horvat', fingerprint: p.fingerprint, reason: 'Zahtjev ispitanika, odobrio službenik za zaštitu podataka' }).expect(201);
    const meta = (await owner.query(`select diff from audit_entries where entity = 'team_member' and entity_id = $1 and action = 'anonymise'`, [id.ivanMember])).rows[0].diff.meta;
    expect(meta).toMatchObject({ beforeRetentionEnd: true, retentionEnd: '2066-03-01', reason: 'Zahtjev ispitanika, odobrio službenik za zaštitu podataka' });
    // Okidač nepromjenjivosti: obična izmjena odlučenog troška se odbija; najava anonimizacije ne otvara ništa osim zamjene imena.
    const decided = (await owner.query(`select e.id, e.description from expenses e join timesheets t on t.id = e.timesheet_id where t.team_member_id = $1 and e.status = 'accepted' limit 1`, [id.ivanMember])).rows[0];
    await expect(asApp(tenantId, (q) => q('update expenses set amount_cents = amount_cents + 1 where id = $1', [decided.id]))).rejects.toThrow(/nepromjenjiv/);
    await expect(asApp(tenantId, (q) => q('update expenses set description = $2 where id = $1', [decided.id, 'nešto drugo']))).rejects.toThrow(/nepromjenjiv/);
    await expect(asApp(tenantId, async (q) => {
      await q(`select set_config('app.privacy_anonymise', $1, true), set_config('app.privacy_anonymise_name', 'Bivši član tima 2', true)`, [id.ivanMember]);
      return q('update expenses set description = $2, amount_cents = amount_cents where id = $1', [decided.id, 'Rad: X']);
    })).rejects.toThrow(/nepromjenjiv/);
    // Najava za člana koji NIJE anonimiziran ne otvara ništa.
    const other = (await owner.query(`select e.id from expenses e where e.project_id = $1 and e.status = 'accepted' and e.source = 'manual' limit 1`, [id.project])).rows[0];
    await expect(asApp(tenantId, async (q) => {
      await q(`select set_config('app.privacy_anonymise', $1, true), set_config('app.privacy_anonymise_name', 'Ana Anić', true)`, [id.anaOther]);
      return q(`update expenses set description = replace(description, 'Ana Anić', 'X') where id = $1`, [other.id]);
    })).rejects.toThrow(/nepromjenjiv/);
  });

  it('revizijski zapis: aplikacija ga ne mijenja ni ne briše; vlasnik ni izravno; jedini put je funkcija s donjim granicama i čuva dokaze', async () => {
    await expect(asApp(tenantId, (q) => q(`update audit_entries set action = 'x' where tenant_id = $1`, [tenantId]))).rejects.toThrow(/permission denied/);
    await expect(asApp(tenantId, (q) => q(`delete from audit_entries where tenant_id = $1`, [tenantId]))).rejects.toThrow(/permission denied/);
    await expect(asApp(tenantId, async (q) => { await q(`select set_config('arqus.audit_purge', 'on', true)`); return q(`delete from audit_entries where tenant_id = $1`, [tenantId]); })).rejects.toThrow(/permission denied/);
    await expect(owner.query(`delete from audit_entries where tenant_id = $1`, [tenantId])).rejects.toThrow(/samo za dodavanje/);
    await expect(owner.query(`update audit_entries set action = 'x' where tenant_id = $1`, [tenantId])).rejects.toThrow(/samo za dodavanje/);
    await expect(owner.query(`truncate audit_entries`)).rejects.toThrow(/ne prazni/);
    await expect(asApp(null, (q) => q(`select privacy_audit_purge('general', 100, false)`))).rejects.toThrow(/nema stanara/);
    // Zapisi u prošlosti (vlasnik smije samo DODATI): neuspjele prijave 100 i 400 dana, ostali 4, 6 i 12 godina.
    const ins = async (tenant: string, action: string, entity: string, daysAgo: number) => (await owner.query<{ id: string }>(
      `insert into audit_entries (tenant_id, actor_type, entity, action, at) values ($1, 'system', $2, $3, now() - make_interval(days => $4)) returning id`, [tenant, entity, action, daysAgo])).rows[0]!.id;
    const e = {
      login100: await ins(tenantId, 'login.failed', 'user', 100), login400: await ins(tenantId, 'login.failed', 'user', 400),
      y4: await ins(tenantId, 'probe', 'probe', 4 * 365), y6: await ins(tenantId, 'probe', 'probe', 6 * 365), y12: await ins(tenantId, 'probe', 'probe', 12 * 365),
      foreign: await ins(otherTenantId, 'probe', 'probe', 12 * 365),
    };
    const exists = async (x: string) => (await owner.query('select 1 from audit_entries where id = $1', [x])).rows.length === 1;
    // Postavka ispod donjih granica (izravnim upisom, mimo validacije) ne mijenja ništa: granice su u funkciji.
    await owner.query(`update tenants set settings = jsonb_set(settings, '{privacy}', '{"retentionDays": {"audit": 1, "loginFailures": 1}}'::jsonb, true) where id = $1`, [tenantId]);
    // Projekt kojemu rok traje (50 godina) nastao je danas – dokazni horizont je danas, pa ne čuva stare zapise; zato se
    // drugom projektu vlasnički pomiče vrijeme nastanka 13 godina unatrag: sada je i zapis od 12 godina dokaz.
    await owner.query(`update projects set created_at = now() - interval '13 years' where id = $1`, [id.project2]);
    const dry = await asApp(tenantId, async (q) => (await q(`select privacy_audit_purge('general', 100, true) as r`)).rows[0]!.r as Json);
    expect(dry).toMatchObject({ removed: 0, auditDays: 1825, loginDays: 90 });
    expect(Number(dry.keptForEvidence)).toBeGreaterThanOrEqual(2);
    await asApp(tenantId, (q) => q(`select privacy_audit_purge('login', 100, false), privacy_audit_purge('general', 100, false)`));
    expect([await exists(e.login100), await exists(e.login400), await exists(e.y4), await exists(e.y6), await exists(e.y12), await exists(e.foreign)]).toEqual([false, false, true, true, true, true]);
    // Kad nijedan projekt ne čuva taj period (drugi projekt vraćen), zapis stariji od 5 godina se briše; 4 godine ostaje.
    await owner.query(`update projects set created_at = now() where id = $1`, [id.project2]);
    await asApp(tenantId, (q) => q(`select privacy_audit_purge('general', 100, false)`));
    expect([await exists(e.y4), await exists(e.y6), await exists(e.y12), await exists(e.foreign)]).toEqual([true, false, false, true]);
    expect((await owner.query(`select count(*)::int as n from audit_entries where tenant_id = $1 and action = 'audit.purge'`, [tenantId])).rows[0].n).toBe(2);
    // Funkcija ne prima ništa izvan svojeg pravila.
    await expect(asApp(tenantId, (q) => q(`select privacy_audit_purge('sve', 100, false)`))).rejects.toThrow(/vrsta/);
    await owner.query(`update tenants set settings = settings - 'privacy' where id = $1`, [tenantId]);
  });

  it('ograničenje izvoza po korisniku (429) i bez predmemoriranja', async () => {
    let status = 200; let n = 0;
    while (status === 200 && n < 20) { status = (await download(`/api/privacy/export?userId=${id.ured}`, t.officer)).status; n++; }
    expect(status).toBe(429);
    expect(n).toBeLessThanOrEqual(12);
  });
});
