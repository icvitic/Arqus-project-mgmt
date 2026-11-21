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
import { addCalendarMonths, addDays, todayIn } from '@arqus/domain';
import { AppModule } from '../src/app.module';
import { inviteUser } from './invite';
import { seedDemo } from '../src/db/seed';
import { readZip } from './zip-reader';
import { RetentionService } from '../src/privacy/retention.service';

/**
 * WP1.24 – evidencija zahtjeva ispitanika (e2e): upis, rok od mjesec dana (i produljenje), ispravak, zatvaranje i ponovno
 * otvaranje, stavka u „Moj rad”, revizija bez imena podnositelja, izvoz podataka osobe, rok čuvanja i izolacija institucija.
 */
const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
type Json = Record<string, unknown>;
interface Req { id: string; number: number; ref: string; receivedOn: string; kind: string; requesterName: string; subjectUser: { id: string; displayName: string; status: string } | null; baseDueOn: string; dueOn: string;
  daysLeft: number | null; status: string; state: string; outcome: string | null; closedOn: string | null; outcomeNote: string | null; revision: number; extension: { informedOn: string; reason: string; late: boolean } | null }

describe('Evidencija zahtjeva ispitanika (WP1.24, e2e)', () => {
  let app: INestApplication; let retention: RetentionService;
  const tag = randomUUID().slice(0, 8); const slug = `zi-${tag}`; const other = `zio-${tag}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const PW = 'Plava-Staza-2027-x';
  const login = async (s: string, email: string, pw = PW) => (await http().post('/api/auth/login').send({ tenantSlug: s, email, password: pw }).expect(201)).body.accessToken as string;
  const owner = new Pool({ connectionString: ADMIN_URL, max: 2 });
  const t: Record<string, string> = {}; const id: Record<string, string> = {};
  let tenantId = '';
  const today = todayIn('Europe/Zagreb');
  const SECRET_NAME = 'Zrinka Tajnović'; const SECRET_TEXT = 'traži kopiju svih evidencija rada iz 2024';
  const base = (over: Json = {}) => ({ receivedOn: today, kind: 'access', channel: 'email', requesterName: SECRET_NAME, requesterContact: 'zrinka@primjer.hr', description: SECRET_TEXT, ...over });
  const create = async (over: Json = {}, token = t.admin!) => (await http().post('/api/privacy/requests').set(auth(token)).send(base(over)).expect(201)).body as Req;
  const list = async (token = t.admin!) => (await http().get('/api/privacy/requests').set(auth(token)).expect(200)).body as { today: string; items: Req[]; summary: Record<string, number> };
  const work = async (token: string) => (await http().get('/api/me/work').set(auth(token)).expect(200)).body as { items: { key: string; kind: string; role: string; urgency: string; due: string | null; title: string; detail?: string; link: string }[] };

  beforeAll(async () => {
    process.env.DATABASE_URL = APP_URL;
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), 'arqus-zi-'));
    await seedDemo({ url: ADMIN_URL, tenantSlug: slug, adminEmail: `a@${slug}.hr`, adminPassword: 'Lozinka-123456' });
    await seedDemo({ url: ADMIN_URL, tenantSlug: other, adminEmail: `a@${other}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    retention = app.get(RetentionService);
    t.admin = await login(slug, `a@${slug}.hr`, 'Lozinka-123456');
    t.other = await login(other, `a@${other}.hr`, 'Lozinka-123456');
    tenantId = (await owner.query<{ id: string }>('select id from tenants where slug = $1', [slug])).rows[0]!.id;
    id.ana = (await inviteUser(app, t.admin, { email: `ana@${slug}.hr`, displayName: 'Ana Anić', roleCodes: ['reader'] }, PW)).id;
    id.ured = (await inviteUser(app, t.admin, { email: `ured@${slug}.hr`, displayName: 'Uredska Osoba', roleCodes: ['project-office'] }, PW)).id;
    t.ana = await login(slug, `ana@${slug}.hr`); t.ured = await login(slug, `ured@${slug}.hr`);
    id.foreign = (await owner.query<{ id: string }>(`select u.id from users u join tenants x on x.id = u.tenant_id where x.slug = $1 limit 1`, [other])).rows[0]!.id;
  });
  afterAll(async () => { await app.close(); await owner.end(); });

  it('samo privacy:manage: ured za projekte i čitatelj dobivaju 403 na svakoj ruti', async () => {
    const r = randomUUID();
    for (const token of [t.ana!, t.ured!]) {
      await http().get('/api/privacy/requests').set(auth(token)).expect(403);
      await http().post('/api/privacy/requests').set(auth(token)).send(base()).expect(403);
      await http().put(`/api/privacy/requests/${r}`).set(auth(token)).send({ ...base(), revision: 1 }).expect(403);
      for (const a of ['extend', 'extend/cancel', 'close', 'reopen']) await http().post(`/api/privacy/requests/${r}/${a}`).set(auth(token)).send({ revision: 1 }).expect(403);
    }
    await http().get('/api/privacy/requests').expect(401);
  });

  it('upis: rok je mjesec dana od zaprimanja, redni broj raste, zahtjev je otvoren', async () => {
    const a = await create({ receivedOn: addDays(today, -3) });
    expect(a).toMatchObject({ number: 1, ref: 'ZI-1', status: 'open', outcome: null, closedOn: null, extension: null, revision: 1, subjectUser: null });
    expect(a.dueOn).toBe(addCalendarMonths(addDays(today, -3), 1));
    expect(a.baseDueOn).toBe(a.dueOn);
    expect(a.daysLeft).toBeGreaterThan(20);
    const b = await create({ kind: 'erasure', subjectUserId: id.ana });
    expect(b).toMatchObject({ number: 2, ref: 'ZI-2', subjectUser: { id: id.ana, displayName: 'Ana Anić', email: `ana@${slug}.hr`, status: 'active' } });
    id.a = a.id; id.b = b.id;
    const l = await list();
    expect(l.items.map((i) => i.ref)).toEqual(['ZI-1', 'ZI-2']); // otvoreni po roku
    expect(l.summary).toMatchObject({ open: 2, overdue: 0, closed: 0 });
  });

  it('upis odbija: budući i prerani dan zaprimanja, nepoznat i tuđi račun, nepoznatu vrstu, višak polja, nepostojeći datum', async () => {
    const bad = async (over: Json) => (await http().post('/api/privacy/requests').set(auth(t.admin!)).send(base(over)).expect(400)).body as { issues: { path: string }[] };
    expect((await bad({ receivedOn: addDays(today, 1) })).issues[0]!.path).toBe('/receivedOn');
    expect((await bad({ receivedOn: '2018-05-24' })).issues[0]!.path).toBe('/receivedOn');
    expect((await bad({ receivedOn: '2026-02-30' })).issues[0]!.path).toBe('/receivedOn');
    expect((await bad({ subjectUserId: randomUUID() })).issues[0]!.path).toBe('/subjectUserId');
    expect((await bad({ subjectUserId: id.foreign })).issues[0]!.path).toBe('/subjectUserId'); // račun druge institucije
    expect((await bad({ identityVerifiedOn: addDays(today, -10) })).issues[0]!.path).toBe('/identityVerifiedOn');
    await bad({ kind: 'nesto' }); await bad({ channel: 'fax' }); await bad({ requesterName: 'x' }); await bad({ dueOn: '2030-01-01' }); await bad({ status: 'closed' });
    expect((await list()).items).toHaveLength(2);
  });

  it('istovremeni upisi dobivaju različite redne brojeve', async () => {
    const made = await Promise.all([1, 2, 3, 4].map((n) => create({ requesterName: `Istovremeni ${n}`, receivedOn: addDays(today, -1) })));
    expect(made.map((m) => m.number).sort((x, y) => x - y)).toEqual([3, 4, 5, 6]);
    id.c = made[0]!.id;
  });

  it('ispravak traži reviziju, čuva tuđu izmjenu (409) i ponovno računa rok iz novog dana zaprimanja', async () => {
    await http().put(`/api/privacy/requests/${id.a}`).set(auth(t.admin!)).send(base()).expect(400); // bez revizije
    const received = addDays(today, -12);
    const u = (await http().put(`/api/privacy/requests/${id.a}`).set(auth(t.admin!)).send({ ...base({ receivedOn: received, identityVerifiedOn: addDays(today, -10), kind: 'rectification' }), revision: 1 }).expect(200)).body as Req;
    expect(u).toMatchObject({ revision: 2, kind: 'rectification', receivedOn: received, dueOn: addCalendarMonths(received, 1) });
    const c = (await http().put(`/api/privacy/requests/${id.a}`).set(auth(t.admin!)).send({ ...base(), revision: 1 }).expect(409)).body as { code: string };
    expect(c.code).toBe('revision_conflict');
    await http().put(`/api/privacy/requests/${randomUUID()}`).set(auth(t.admin!)).send({ ...base(), revision: 1 }).expect(404);
  });

  it('produljenje: tri mjeseca od zaprimanja, zakašnjela obavijest je označena, poništavanje vraća osnovni rok', async () => {
    const r = (await list()).items.find((i) => i.id === id.a)!;
    await http().post(`/api/privacy/requests/${id.a}/extend`).set(auth(t.admin!)).send({ informedOn: today, reason: 'kratko', revision: r.revision }).expect(400);
    await http().post(`/api/privacy/requests/${id.a}/extend`).set(auth(t.admin!)).send({ informedOn: addDays(r.receivedOn, -1), reason: 'Zahtjev obuhvaća velik broj zapisa', revision: r.revision }).expect(400);
    const e = (await http().post(`/api/privacy/requests/${id.a}/extend`).set(auth(t.admin!)).send({ informedOn: today, reason: 'Zahtjev obuhvaća velik broj zapisa', revision: r.revision }).expect(201)).body as Req;
    expect(e.dueOn).toBe(addCalendarMonths(r.receivedOn, 3));
    expect(e.baseDueOn).toBe(addCalendarMonths(r.receivedOn, 1));
    expect(e.extension).toEqual({ informedOn: today, reason: 'Zahtjev obuhvaća velik broj zapisa', late: false });
    // Dan zaprimanja se ne može pomaknuti iza dana obavijesti o produljenju.
    const x = (await create({ receivedOn: addDays(today, -5) }));
    const xe = (await http().post(`/api/privacy/requests/${x.id}/extend`).set(auth(t.admin!)).send({ informedOn: addDays(today, -4), reason: 'Složen zahtjev, više projekata', revision: x.revision }).expect(201)).body as Req;
    await http().put(`/api/privacy/requests/${x.id}`).set(auth(t.admin!)).send({ ...base({ receivedOn: today }), revision: xe.revision }).expect(400);
    const cancelled = (await http().post(`/api/privacy/requests/${id.a}/extend/cancel`).set(auth(t.admin!)).send({ revision: e.revision }).expect(201)).body as Req;
    expect(cancelled).toMatchObject({ extension: null, dueOn: e.baseDueOn });
    await http().post(`/api/privacy/requests/${id.a}/extend/cancel`).set(auth(t.admin!)).send({ revision: cancelled.revision }).expect(409);
    id.x = x.id;
  });

  it('zakašnjela obavijest o produljenju i prekoračen rok: stanje „kasni”, stavka u „Moj rad” administratora bez imena podnositelja', async () => {
    // Zahtjev zaprimljen prije 40 dana (vlasničkom vezom ne treba – API prima prošli dan zaprimanja).
    const received = addDays(today, -40);
    const late = await create({ receivedOn: received, requesterName: 'Kasni Podnositelj' });
    expect(late.state).toBe('overdue'); expect(late.daysLeft).toBeLessThan(0);
    const ext = (await http().post(`/api/privacy/requests/${late.id}/extend`).set(auth(t.admin!)).send({ informedOn: addDays(today, -2), reason: 'Obavijest poslana nakon osnovnog roka', revision: late.revision }).expect(201)).body as Req;
    expect(ext.extension!.late).toBe(true); expect(ext.state).toBe('open');
    await http().post(`/api/privacy/requests/${late.id}/extend/cancel`).set(auth(t.admin!)).send({ revision: ext.revision }).expect(201);
    id.late = late.id;

    const l = await list();
    expect(l.items[0]).toMatchObject({ id: late.id, state: 'overdue' }); // najraniji rok prvi
    expect(l.summary.overdue).toBe(1);
    const items = (await work(t.admin!)).items.filter((i) => i.kind === 'subject_request');
    expect(items).toHaveLength(l.summary.open);
    expect(items[0]).toMatchObject({ key: `subject-request:${late.id}`, role: 'admin', urgency: 'overdue', due: addCalendarMonths(received, 1), link: 'osobni-podaci/zahtjevi' });
    expect(items[0]!.title).toBe(`Zahtjev ispitanika ${late.ref}: pristup podacima (čl. 15)`);
    const text = JSON.stringify(items);
    expect(text).not.toContain('Kasni Podnositelj'); expect(text).not.toContain(SECRET_NAME); expect(text).not.toContain(SECRET_TEXT);
    // Tko zahtjeve ne vodi, ne vidi ih ni u „Moj rad”.
    for (const token of [t.ana!, t.ured!]) expect((await work(token)).items.filter((i) => i.kind === 'subject_request')).toEqual([]);
  });

  it('zatvaranje: ishod i dan odgovora; odbijanje traži obrazloženje; zatvoren se ne mijenja; ponovno otvaranje vraća rok', async () => {
    const r = (await list()).items.find((i) => i.id === id.late)!;
    const close = (body: Json) => http().post(`/api/privacy/requests/${id.late}/close`).set(auth(t.admin!)).send({ revision: r.revision, ...body });
    await close({ closedOn: today, outcome: 'refused' }).expect(400); // bez obrazloženja
    await close({ closedOn: addDays(today, 1), outcome: 'fulfilled' }).expect(400);
    await close({ closedOn: addDays(r.receivedOn, -1), outcome: 'fulfilled' }).expect(400);
    await close({ closedOn: today, outcome: 'nesto' }).expect(400);
    const c = (await close({ closedOn: today, outcome: 'refused', note: 'Podaci su dio dokaza predanog zahtjeva za nadoknadu' }).expect(201)).body as Req;
    expect(c).toMatchObject({ status: 'closed', state: 'closed_late', outcome: 'refused', closedOn: today, daysLeft: null });
    await http().put(`/api/privacy/requests/${id.late}`).set(auth(t.admin!)).send({ ...base(), revision: c.revision }).expect(409);
    await http().post(`/api/privacy/requests/${id.late}/extend`).set(auth(t.admin!)).send({ informedOn: today, reason: 'Prekasno za produljenje', revision: c.revision }).expect(409);
    await http().post(`/api/privacy/requests/${id.late}/close`).set(auth(t.admin!)).send({ closedOn: today, outcome: 'fulfilled', revision: c.revision }).expect(409);
    expect((await work(t.admin!)).items.some((i) => i.key === `subject-request:${id.late}`)).toBe(false);
    const l = await list();
    expect(l.summary).toMatchObject({ closed: 1, closedLate: 1, overdue: 0 });
    expect(l.items[l.items.length - 1]!.id).toBe(id.late); // zatvoreni iza otvorenih
    const o = (await http().post(`/api/privacy/requests/${id.late}/reopen`).set(auth(t.admin!)).send({ revision: c.revision }).expect(201)).body as Req;
    expect(o).toMatchObject({ status: 'open', outcome: null, closedOn: null, outcomeNote: null, dueOn: r.dueOn, state: 'overdue' });
    await http().post(`/api/privacy/requests/${id.late}/reopen`).set(auth(t.admin!)).send({ revision: o.revision }).expect(409);
    // U roku zatvoren zahtjev: stanje „zatvoren”.
    const b = (await list()).items.find((i) => i.id === id.b)!;
    const cb = (await http().post(`/api/privacy/requests/${id.b}/close`).set(auth(t.admin!)).send({ closedOn: today, outcome: 'fulfilled', revision: b.revision }).expect(201)).body as Req;
    expect(cb).toMatchObject({ state: 'closed', outcome: 'fulfilled', outcomeNote: null });
  });

  it('revizijski zapis bilježi svaku radnju, ali nikad ime podnositelja, kontakt ni slobodni tekst', async () => {
    const rows = (await owner.query<{ action: string; diff: unknown }>(`select action, diff from audit_entries where tenant_id = $1 and entity = 'subject_request' order by id`, [tenantId])).rows;
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['create', 'update', 'extend', 'extend.cancel', 'close', 'reopen']) expect(actions.has(a)).toBe(true);
    const text = JSON.stringify(rows);
    for (const secret of [SECRET_NAME, 'Kasni Podnositelj', 'zrinka@primjer.hr', SECRET_TEXT, 'velik broj zapisa', 'dio dokaza predanog']) expect(text).not.toContain(secret);
    expect(rows.find((r) => r.action === 'create')!.diff).toMatchObject({ meta: { number: 1, kind: 'access' } });
  });

  it('izvoz podataka osobe sadrži zahtjeve povezane s njezinim računom – i samo njih', async () => {
    const r = await http().get(`/api/privacy/export?userId=${id.ana}`).set(auth(t.admin!)).buffer(true)
      .parse((res, cb) => { const parts: Buffer[] = []; res.on('data', (c: Buffer) => parts.push(c)); res.on('end', () => cb(null, Buffer.concat(parts))); }).expect(200);
    const files = new Map(readZip(r.body as Buffer).map((e) => [e.name, e.data]));
    const json = JSON.parse(files.get('podaci.json')!.toString('utf8')) as { categories: Record<string, Json[]> };
    expect(json.categories.subjectRequests).toEqual([expect.objectContaining({ ref: 'ZI-2', kind: 'erasure', status: 'closed', outcome: 'fulfilled', closedOn: today })]);
    expect(JSON.stringify(json.categories.subjectRequests)).not.toContain('Kasni Podnositelj');
    const subject = (await http().post('/api/privacy/subject').set(auth(t.admin!)).send({ userId: id.ana }).expect(201)).body as { counts: Record<string, number> };
    expect(subject.counts.subjectRequests).toBe(1);
  });

  it('zatvaranje računa ne briše zahtjev te osobe (dokaz postupanja ostaje do svog roka)', async () => {
    await http().post(`/api/privacy/users/${id.ana}/close`).set(auth(t.admin!)).send({ confirmation: 'Ana Anić', reason: 'Zahtjev za brisanje ZI-2' }).expect(201);
    const b = (await list()).items.find((i) => i.id === id.b)!;
    expect(b).toMatchObject({ status: 'closed', subjectUser: { id: id.ana, status: 'closed' } });
  });

  it('druga institucija ne vidi zahtjeve i ne može ih mijenjati (404), brojevi su po instituciji', async () => {
    expect((await list(t.other!)).items).toEqual([]);
    await http().put(`/api/privacy/requests/${id.a}`).set(auth(t.other!)).send({ ...base(), revision: 1 }).expect(404);
    for (const a of ['extend/cancel', 'reopen']) await http().post(`/api/privacy/requests/${id.a}/${a}`).set(auth(t.other!)).send({ revision: 1 }).expect(404);
    await http().post(`/api/privacy/requests/${id.a}/close`).set(auth(t.other!)).send({ closedOn: today, outcome: 'fulfilled', revision: 1 }).expect(404);
    expect((await create({}, t.other!)).number).toBe(1);
  });

  it('rok čuvanja: zatvoren zahtjev stariji od roka briše posao čuvanja; otvoren i svjež ostaju; otvoren se ne briše ni izravno', async () => {
    // Zatvoren prije 6 godina (vlasničkom vezom – API ne prima takav dan zatvaranja bez isto tako starog zaprimanja).
    const old = await create({ receivedOn: '2019-03-01', requesterName: 'Stari Zahtjev' });
    await http().post(`/api/privacy/requests/${old.id}/close`).set(auth(t.admin!)).send({ closedOn: '2019-03-20', outcome: 'fulfilled', revision: old.revision }).expect(201);
    const stale = await create({ receivedOn: '2019-03-01', requesterName: 'Stari Otvoreni' }); // otvoren, jako star
    const overview = (await http().get('/api/privacy/retention').set(auth(t.admin!)).expect(200)).body as { categories: { key: string; days: number; defaultDays: number; floorDays: number; held: number; eligible: number; configurable: boolean }[] };
    const cat = overview.categories.find((c) => c.key === 'subjectRequests')!;
    expect(cat).toMatchObject({ days: 1825, defaultDays: 1825, floorDays: 365, eligible: 1, configurable: true });
    await http().put('/api/privacy/retention').set(auth(t.admin!)).send({ retentionDays: { subjectRequests: 364 } }).expect(400); // ispod donje granice
    const before = (await list()).items.length;
    const dry = await retention.runTenant(tenantId, { dryRun: true });
    expect(dry.categories.find((c) => c.key === 'subjectRequests')).toMatchObject({ eligible: 1, removed: 0 });
    expect((await list()).items).toHaveLength(before);
    const run = await retention.runTenant(tenantId, { dryRun: false, mode: 'scheduled', day: '2099-01-01' });
    expect(run.categories.find((c) => c.key === 'subjectRequests')).toMatchObject({ eligible: 1, removed: 1 });
    const after = (await list()).items;
    expect(after).toHaveLength(before - 1);
    expect(after.some((i) => i.id === old.id)).toBe(false);
    expect(after.some((i) => i.id === stale.id)).toBe(true); // otvoren ostaje bez obzira na starost
    expect(after.some((i) => i.id === id.b)).toBe(true); // danas zatvoren ostaje
    await expect(owner.query('delete from subject_requests where id = $1', [stale.id])).rejects.toThrow(/Otvoren zahtjev ispitanika se ne briše/);
  });

  it('baza odbija nedosljedan zapis (zatvoren bez ishoda, rok prije zaprimanja, produljenje bez razloga)', async () => {
    const ins = (cols: string, vals: string) => owner.query(`insert into subject_requests (tenant_id, number, received_on, kind, channel, requester_name, due_on${cols}) values ($1, 9000 + floor(random() * 100000)::int, '2026-01-10', 'access', 'email', 'X Y', '2026-02-10'${vals})`, [tenantId]);
    await expect(ins(`, status`, `, 'closed'`)).rejects.toThrow(/subject_requests_status_ck/);
    await expect(ins(`, extension_informed_on`, `, '2026-01-20'`)).rejects.toThrow(/subject_requests_dates_ck/);
    await expect(owner.query(`insert into subject_requests (tenant_id, number, received_on, kind, channel, requester_name, due_on) values ($1, 99999, '2026-01-10', 'access', 'email', 'X Y', '2026-01-10')`, [tenantId])).rejects.toThrow(/subject_requests_dates_ck/);
    await expect(owner.query(`insert into subject_requests (tenant_id, number, received_on, kind, channel, requester_name, due_on, subject_user_id) values ($1, 99998, '2026-01-10', 'access', 'email', 'X Y', '2026-02-10', $2)`, [tenantId, id.foreign])).rejects.toThrow(/subject_requests_user_fk/);
  });
});
