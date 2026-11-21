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
import { addDays, todayIn } from '@arqus/domain';
import { AppModule } from '../src/app.module';
import { buildAccessFixture, PDF, type AccessFixture } from './access-fixture';

/**
 * WP1.26 – suradnici na prijavi. Postava (`access-fixture` s prijavama): `lead` bez ikakve uloge vodi prijavu `mine`;
 * `other` vodi administrator. `extra` nema nijednu ulogu; `tm` je član tima samo na projektu A (bez proposals:read);
 * `pm` je voditelj samo projekta A; `fin` ima ulogu financija institucije (bez proposals:read).
 */
const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Suradnici na prijavi (WP1.26, e2e)', () => {
  let app: INestApplication; let f: AccessFixture; let other: AccessFixture;
  const tag = randomUUID().slice(0, 8);
  const pool = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const P = () => `/api/proposals/${f.proposals.mine}`;
  const collabs = async (t: string, id = f.proposals.mine) => (await http().get(`/api/proposals/${id}/collaborators`).set(auth(t)).expect(200)).body as Body;
  const proposal = async (t: string) => (await http().get(P()).set(auth(t)).expect(200)).body as Body;
  const entryOf = async (userId: string) => ((await collabs(f.tokens.lead)).entries as Body[]).find((e) => e.userId === userId)!;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), 'arqus-collab-'));
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    f = await buildAccessFixture(app, `pc-${tag}`, { proposals: true });
    other = await buildAccessFixture(app, `po-${tag}`);
  }, 180_000);
  afterAll(async () => { await app.close(); await pool.end(); });

  it('voditelj prijave dodaje suradnike (uređivanje, čitanje); sebe, dvaput, korisnika druge institucije i nepoznatog ne može', async () => {
    const lead = auth(f.tokens.lead);
    const before = await collabs(f.tokens.lead);
    expect(before.canManage).toBe(true);
    expect(before.entries).toEqual([]);
    expect((before.users as Body[]).map((u) => u.id)).toEqual(expect.arrayContaining([f.users.extra, f.users.tm]));
    expect((before.users as Body[]).some((u) => u.id === f.users.lead)).toBe(false);

    const added = (await http().post(`${P()}/collaborators`).set(lead).send({ userId: f.users.extra }).expect(201)).body as Body;
    expect(added.entries).toMatchObject([{ userId: f.users.extra, access: 'edit', email: `extra@${f.slug}.hr` }]);
    await http().post(`${P()}/collaborators`).set(lead).send({ userId: f.users.tm, access: 'read' }).expect(201);

    await http().post(`${P()}/collaborators`).set(lead).send({ userId: f.users.extra }).expect(409);
    await http().post(`${P()}/collaborators`).set(lead).send({ userId: f.users.lead }).expect(409);
    await http().post(`${P()}/collaborators`).set(lead).send({ userId: other.users.extra }).expect(404);
    await http().post(`${P()}/collaborators`).set(lead).send({ userId: randomUUID() }).expect(404);
    await http().post(`${P()}/collaborators`).set(lead).send({ userId: f.users.fin, access: 'admin' }).expect(400);
    await http().post(`${P()}/collaborators`).set(lead).send({ userId: f.users.fin, extra: 1 }).expect(400);

    const n = (await http().get('/api/me/notifications?limit=20').set(auth(f.tokens.extra)).expect(200)).body.items as Body[];
    expect(n.find((x) => x.kind === 'proposal_collaborator')).toBeTruthy();
    const audit = await pool.query(`select action, diff from audit_entries where entity = 'proposal' and entity_id = $1 and action like 'collaborator.%' order by id`, [f.proposals.mine]);
    expect(audit.rows.map((r) => r.action)).toEqual(['collaborator.add', 'collaborator.add']);
  });

  it('suradnik s pravom uređivanja radi na pripremi kao voditelj, ali je ne vodi (proračun se ne zaključava, status, suradnici)', async () => {
    const ex = auth(f.tokens.extra);
    expect(((await http().get('/api/proposals').set(ex).expect(200)).body as Body[]).map((p) => p.id)).toEqual([f.proposals.mine]);
    const p = await proposal(f.tokens.extra);
    await http().patch(P()).set(ex).send({ title: 'Prijava koju piše suradnik', revision: p.revision }).expect(200);
    await http().patch(P()).set(ex).send({ leadUserId: f.users.extra, revision: p.revision + 1 }).expect(403);
    await http().post(`${P()}/work-packages`).set(ex).send({ title: 'Upravljanje', startMonth: 1, endMonth: 12 }).expect(201);
    await http().get('/api/organisations').set(ex).expect(200);
    await http().post('/api/documents').set(ex).field({ entityType: 'proposal', entityId: f.proposals.mine, title: 'Nacrt opisa' }).attach('file', PDF, 'opis.pdf').expect(201);

    await http().post(`${P()}/budget/lock`).set(ex).expect(403);
    await http().post(`${P()}/transition`).set(ex).send({ to: 'preparation' }).expect(403);
    await http().post(`${P()}/collaborators`).set(ex).send({ userId: f.users.fin }).expect(403);
    const tmEntry = await entryOf(f.users.tm);
    await http().patch(`${P()}/collaborators/${tmEntry.id}`).set(ex).send({ access: 'edit' }).expect(403);
    await http().delete(`${P()}/collaborators/${tmEntry.id}`).set(ex).expect(403);

    // Suradnik vidi tko još radi na prijavi, bez e-adresa i bez popisa korisnika institucije.
    const seen = await collabs(f.tokens.extra);
    expect(seen.canManage).toBe(false);
    expect(seen.users).toEqual([]);
    expect((seen.entries as Body[]).every((e) => !('email' in e))).toBe(true);

    // Tuđa prijava i dalje ne postoji.
    await http().get(`/api/proposals/${f.proposals.other}`).set(ex).expect(404);
    await http().get(`/api/proposals/${f.proposals.other}/collaborators`).set(ex).expect(404);
    await http().get(`/api/documents?proposalId=${f.proposals.other}`).set(ex).expect(404);
  });

  it('suradnik samo za čitanje čita prijavu i dokumente, ništa ne mijenja', async () => {
    const tm = auth(f.tokens.tm);
    const p = await proposal(f.tokens.tm);
    expect(p.title).toBe('Prijava koju piše suradnik');
    await http().patch(P()).set(tm).send({ title: 'Ne smije', revision: p.revision }).expect(403);
    await http().post(`${P()}/work-packages`).set(tm).send({ title: 'Ne smije', startMonth: 1, endMonth: 2 }).expect(403);
    await http().put(`${P()}/budget/lines`).set(tm).send({ revision: p.revision, lines: [] }).expect(403);
    const docs = (await http().get(`/api/documents?proposalId=${f.proposals.mine}`).set(tm).expect(200)).body as Body[];
    expect(docs.length).toBeGreaterThan(0);
    await http().post('/api/documents').set(tm).field({ entityType: 'proposal', entityId: f.proposals.mine, title: 'Ne smije' }).attach('file', PDF, 'x.pdf').expect(403);
    // Uloga na projektu i dalje vrijedi samo na projektu – suradnja ne otvara druge prijave.
    expect(((await http().get('/api/proposals').set(tm).expect(200)).body as Body[]).map((x) => x.id)).toEqual([f.proposals.mine]);
  });

  it('promjena razine i uklanjanje vrijede odmah; suradnik sam napušta prijavu', async () => {
    const lead = auth(f.tokens.lead);
    const tmEntry = await entryOf(f.users.tm);
    await http().patch(`${P()}/collaborators/${tmEntry.id}`).set(lead).send({ access: 'edit' }).expect(200);
    const p = await proposal(f.tokens.tm);
    await http().patch(P()).set(auth(f.tokens.tm)).send({ durationMonths: 24, revision: p.revision }).expect(200);
    await http().patch(`${P()}/collaborators/${randomUUID()}`).set(lead).send({ access: 'read' }).expect(404);

    const exEntry = await entryOf(f.users.extra);
    await http().delete(`${P()}/collaborators/${exEntry.id}`).set(lead).expect(200);
    await http().get(P()).set(auth(f.tokens.extra)).expect(404);
    await http().get('/api/proposals').set(auth(f.tokens.extra)).expect(403);
    const n = (await http().get('/api/me/notifications?limit=20').set(auth(f.tokens.extra)).expect(200)).body.items as Body[];
    expect(n.find((x) => x.kind === 'proposal_collaborator_removed')).toBeTruthy();

    const left = (await http().delete(`${P()}/collaborators/${tmEntry.id}`).set(auth(f.tokens.tm)).expect(200)).body as Body;
    expect(left).toEqual({ proposalId: f.proposals.mine, left: true });
    await http().get(P()).set(auth(f.tokens.tm)).expect(404);
    const audit = await pool.query(`select action from audit_entries where entity = 'proposal' and entity_id = $1 and action like 'collaborator.%' order by id`, [f.proposals.mine]);
    expect(audit.rows.map((r) => r.action)).toEqual(['collaborator.add', 'collaborator.add', 'collaborator.update', 'collaborator.remove', 'collaborator.leave']);
  });

  it('ured za projekte upravlja suradnicima svake prijave; zaključena prijava ne dobiva nove; korisnik bez pristupa dobiva 404', async () => {
    const admin = auth(f.tokens.admin);
    await http().post(`/api/proposals/${f.proposals.other}/collaborators`).set(admin).send({ userId: f.users.extra, access: 'read' }).expect(201);
    await http().get(`/api/proposals/${f.proposals.other}`).set(auth(f.tokens.extra)).expect(200);
    await http().get(`${P()}/collaborators`).set(auth(f.tokens.pm)).expect(404);
    await http().post(`${P()}/collaborators`).set(auth(f.tokens.pm)).send({ userId: f.users.extra }).expect(404);

    const closed = (await http().post('/api/proposals').set(admin).send({ packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA', acronym: `PZ${tag.slice(0, 4)}`, title: 'Povučena prijava' }).expect(201)).body as Body;
    await http().post(`/api/proposals/${closed.id}/transition`).set(admin).send({ to: 'withdrawn' }).expect(201);
    await http().post(`/api/proposals/${closed.id}/collaborators`).set(admin).send({ userId: f.users.extra }).expect(409);
    expect((await collabs(f.tokens.admin, closed.id)).users).toEqual([]);
  });

  it('suradnik s pravom uređivanja vidi interni rok prijave u „Moj rad”; suradnik za čitanje ne', async () => {
    const lead = auth(f.tokens.lead);
    const today = todayIn('Europe/Zagreb', new Date());
    const p = await proposal(f.tokens.lead);
    await http().patch(P()).set(lead).send({ internalDeadline: addDays(today, 10), revision: p.revision }).expect(200);
    await http().post(`${P()}/collaborators`).set(lead).send({ userId: f.users.extra, access: 'edit' }).expect(201);
    await http().post(`${P()}/collaborators`).set(lead).send({ userId: f.users.tm, access: 'read' }).expect(201);
    const items = async (t: string) => ((await http().get('/api/me/work').set(auth(t)).expect(200)).body.items as Body[]).filter((i) => i.kind === 'proposal_deadline').map((i) => i.proposalId);
    expect(await items(f.tokens.extra)).toEqual([f.proposals.mine]);
    expect(await items(f.tokens.tm)).toEqual([]);
  });

  it('zatvaranje računa briše suradnju; izvoz podataka osobe je navodi', async () => {
    const admin = auth(f.tokens.admin);
    const roles = async () => ((await http().post('/api/privacy/subject').set(admin).send({ userId: f.users.fin }).expect(201)).body as Body).counts.roles as number;
    const before = await roles();
    await http().post(`${P()}/collaborators`).set(auth(f.tokens.lead)).send({ userId: f.users.fin, access: 'read' }).expect(201);
    expect(await roles()).toBe(before + 1);
    await http().post(`/api/privacy/users/${f.users.fin}/close`).set(admin).send({ confirmation: 'Korisnik fin', reason: 'Otišla s ustanove' }).expect(201);
    const left = await pool.query('select count(*)::int as n from proposal_collaborators where user_id = $1', [f.users.fin]);
    expect(left.rows[0].n).toBe(0);
  });
});
