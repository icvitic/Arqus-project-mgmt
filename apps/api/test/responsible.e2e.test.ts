import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { responsibleMayChange } from '@arqus/domain';
import { AppModule } from '../src/app.module';
import { DigestService } from '../src/me/digest.service';
import { MAIL_SETTINGS, MAIL_TRANSPORT, type MailSettings } from '../src/mail/mail-config';
import type { OutgoingMail } from '../src/mail/smtp-client';
import { buildAccessFixture, type AccessFixture } from './access-fixture';

/**
 * WP1.22 – odgovorne osobe na isporukama, prekretnicama i zadacima. Postava pristupa (WP1.14, `access-fixture`): projekti
 * A i B od 1. 1. 2027. (12 mjeseci), „danas” = 15. 7. 2027. (Europe/Zagreb).
 * - pm: voditelj SAMO na A (projects:write na A); tm: član tima SAMO na A, odgovorna osoba; extra: drugi član tima A
 *   (nije odgovoran); rdr: uprava (projects:read institucije, bez projects:write); admin: administrator.
 * Isporuke na A: D1.1 (rok M6 = 30. 6. – kasni, iz postave), D1.2 (M7 = 31. 7. – uskoro, odgovoran tm), D1.3 (M9 – izvan
 * 30 dana, odgovoran tm); zadatak T1.1 (M1–M6, odgovoran tm); prekretnica MS1 (M6, odgovoran tm).
 */
const NOW = new Date('2027-07-15T10:00:00Z');
const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Item = { key: string; kind: string; role: string; urgency: string; due: string | null; projectId?: string; title: string; detail?: string; link: string };

describe('Odgovorne osobe (WP1.22, e2e)', () => {
  let app: INestApplication; let f: AccessFixture; let other: AccessFixture;
  const tag = randomUUID().slice(0, 8);
  const pool = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const work = async (t: string) => (await http().get('/api/me/work').set(auth(t)).expect(200)).body as { items: Item[]; summary: Body };
  const notes = async (t: string) => (await http().get('/api/me/notifications?limit=50').set(auth(t)).expect(200)).body as { items: Body[] };
  const structure = async (t: string, id = f.A.id) => (await http().get(`/api/projects/${id}/structure`).set(auth(t)).expect(200)).body as Body;
  let extraMember = ''; let d12 = ''; let d13 = '';
  const P = () => `/api/projects/${f.A.id}`;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), 'arqus-resp-'));
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    f = await buildAccessFixture(app, `rs-${tag}`);
    other = await buildAccessFixture(app, `ro-${tag}`);
    const admin = auth(f.tokens.admin);
    extraMember = (await http().post(`${P()}/team`).set(admin).send({ fullName: 'Drugi član A', userId: f.users.extra, annualCost: 2_000_000 }).expect(201)).body.id;
    d12 = (await http().post(`${P()}/work-packages/${f.A.wp}/deliverables`).set(admin).send({ title: 'Izvještaj o anketi', type: 'ISP', dissemination: 'JAV', dueMonth: 7 }).expect(201)).body.id;
    d13 = (await http().post(`${P()}/work-packages/${f.A.wp}/deliverables`).set(admin).send({ title: 'Kasniji izvještaj', type: 'ISP', dissemination: 'JAV', dueMonth: 9, responsibleMemberId: f.A.member }).expect(201)).body.id;
  }, 180_000);
  afterAll(async () => { vi.useRealTimers(); await app.close(); await pool.end(); });

  it('određivanje: voditelj (projects:write) određuje i uklanja člana tima istog projekta; drugi projekt, drugi stanar, nepoznat i neaktivan član → 400', async () => {
    const pm = auth(f.tokens.pm);
    await http().patch(`${P()}/deliverables/${d12}`).set(pm).send({ responsibleMemberId: f.A.member }).expect(200);
    await http().patch(`${P()}/tasks/${f.A.task}`).set(pm).send({ responsibleMemberId: f.A.member }).expect(200);
    await http().patch(`${P()}/milestones/${f.A.milestone}`).set(pm).send({ responsibleMemberId: f.A.member }).expect(200);
    const s = await structure(f.tokens.tm);
    const d = s.workPackages[0].deliverables.find((x: Body) => x.id === d12);
    expect(d.responsible).toEqual({ memberId: f.A.member, name: 'Član tima A', active: true, mine: true });
    expect(s.workPackages[0].tasks[0].responsible).toMatchObject({ name: 'Član tima A', mine: true });
    expect(s.milestones[0].responsible).toMatchObject({ name: 'Član tima A', mine: true });
    expect(s.team).toBeUndefined(); // popis članova za odabir samo onome tko uređuje strukturu
    expect((await structure(f.tokens.pm)).team.map((t: Body) => t.name)).toContain('Drugi član A');
    expect((await structure(f.tokens.pm)).workPackages[0].deliverables.find((x: Body) => x.id === d12).responsible.mine).toBe(false);
    // Član tima projekta B, član drugog stanara, nepoznat id → 400; ništa se ne mijenja.
    for (const id of [f.B.member, other.A.member, randomUUID()]) {
      await http().patch(`${P()}/deliverables/${d12}`).set(pm).send({ responsibleMemberId: id }).expect(400);
      await http().post(`${P()}/work-packages/${f.A.wp}/tasks`).set(pm).send({ title: 'Novi', startMonth: 1, endMonth: 2, responsibleMemberId: id }).expect(400);
    }
    // Baza jamči isto i bez aplikacije: član drugog projekta ne prolazi strani ključ (stanar, projekt, član).
    await expect(pool.query('update deliverables set responsible_member_id = $1 where id = $2', [f.B.member, d12])).rejects.toThrow(/deliverables_responsible_fk/);
    // Neaktivan član se ne može odrediti.
    const gone = (await http().post(`${P()}/team`).set(auth(f.tokens.admin)).send({ fullName: 'Bivši član' }).expect(201)).body.id;
    await http().patch(`${P()}/team/${gone}`).set(auth(f.tokens.admin)).send({ active: false }).expect(200);
    expect((await http().patch(`${P()}/milestones/${f.A.milestone}`).set(pm).send({ responsibleMemberId: gone }).expect(400)).body.message).toMatch(/više nije aktivan/);
    expect((await structure(f.tokens.tm)).workPackages[0].deliverables.find((x: Body) => x.id === d12).responsibleMemberId).toBe(f.A.member);
    // Bez projects:write (član tima, uprava) – 403; projekt B za voditelja A – 404; tuđi stanar – 404.
    await http().patch(`${P()}/deliverables/${d12}`).set(auth(f.tokens.tm)).send({ responsibleMemberId: null }).expect(403);
    await http().patch(`${P()}/deliverables/${d12}`).set(auth(f.tokens.rdr)).send({ responsibleMemberId: null }).expect(403);
    await http().patch(`/api/projects/${f.B.id}/deliverables/${f.B.deliverable}`).set(pm).send({ responsibleMemberId: f.B.member }).expect(404);
    await http().patch(`${P()}/deliverables/${d12}`).set(auth(other.tokens.admin)).send({ responsibleMemberId: null }).expect(404);
    // Uklanjanje (null) i ponovno određivanje.
    await http().patch(`${P()}/deliverables/${d12}`).set(pm).send({ responsibleMemberId: null }).expect(200);
    expect((await structure(f.tokens.pm)).workPackages[0].deliverables.find((x: Body) => x.id === d12).responsible).toBeNull();
    await http().patch(`${P()}/deliverables/${d12}`).set(pm).send({ responsibleMemberId: f.A.member }).expect(200);
  });

  it('obavijesti: „odgovoran si” i „više nisi odgovoran” – u istoj transakciji, nikad akteru, samo primatelju koji vidi projekt', async () => {
    const pm = auth(f.tokens.pm);
    const kinds = async (t: string) => (await notes(t)).items.filter((n) => String(n.kind).startsWith('responsible_')).map((n) => `${n.kind}|${n.title}`);
    // Iz prethodnog testa: tm je određen za D1.2 (dvaput – uklonjen pa ponovno), T1.1 i MS1; iz postave za D1.3 (akter administrator).
    const tm = await kinds(f.tokens.tm);
    expect(tm).toEqual(expect.arrayContaining([
      expect.stringMatching(/^responsible_assigned\|Odgovoran\/na si za isporuku D\d\.2 Izvještaj o anketi \(PA/),
      expect.stringMatching(/^responsible_removed\|Više nisi odgovoran\/na za isporuku D\d\.2 Izvještaj o anketi/),
      expect.stringMatching(/^responsible_assigned\|Odgovoran\/na si za zadatak T\d\.1 Zadatak/),
      expect.stringMatching(/^responsible_assigned\|Odgovoran\/na si za prekretnicu MS1 Prekretnica/),
      expect.stringMatching(/^responsible_assigned\|Odgovoran\/na si za isporuku D\d\.3 Kasniji izvještaj/),
    ]));
    expect(tm.filter((x) => /D\d\.2/.test(x) && x.startsWith('responsible_assigned'))).toHaveLength(2);
    expect(await kinds(f.tokens.pm)).toEqual([]); // akter ne dobiva ništa
    // Promjena odgovorne osobe: stara dobiva „više nisi”, nova „odgovoran si”; voditelj koji sebe odredi – ništa.
    await http().patch(`${P()}/deliverables/${d13}`).set(pm).send({ responsibleMemberId: extraMember }).expect(200);
    expect((await kinds(f.tokens.tm))[0]).toMatch(/^responsible_removed\|.*D\d\.3 Kasniji izvještaj/);
    expect((await kinds(f.tokens.extra))[0]).toMatch(/^responsible_assigned\|.*D\d\.3 Kasniji izvještaj/);
    await http().patch(`${P()}/deliverables/${d13}`).set(pm).send({ responsibleMemberId: f.A.pmMember }).expect(200);
    expect(await kinds(f.tokens.pm)).toEqual([]);
    // Primatelj bez pristupa projektu (uloga člana tima oduzeta) ne dobiva obavijest.
    const access = (await http().get(`${P()}/access`).set(auth(f.tokens.admin)).expect(200)).body as { entries: Body[] };
    const extraGrant = access.entries.find((u) => u.userId === f.users.extra && u.assignmentId)!;
    await http().delete(`${P()}/access/${extraGrant.assignmentId}`).set(auth(f.tokens.admin)).expect(200);
    const before = (await kinds(f.tokens.extra)).length;
    await http().patch(`${P()}/deliverables/${d13}`).set(pm).send({ responsibleMemberId: extraMember }).expect(200);
    expect((await pool.query(`select count(*)::int as n from notifications where user_id = $1 and kind like 'responsible_%'`, [f.users.extra])).rows[0].n).toBe(before);
    await http().patch(`${P()}/deliverables/${d13}`).set(pm).send({ responsibleMemberId: f.A.member }).expect(200);
    await http().post(`${P()}/access`).set(auth(f.tokens.admin)).send({ userId: f.users.extra, roleCode: 'team-member' }).expect(201);
    // Neuspjela izmjena (400) ne ostavlja obavijest.
    const n0 = (await pool.query(`select count(*)::int as n from notifications where kind like 'responsible_%'`)).rows[0].n;
    await http().patch(`${P()}/deliverables/${d12}`).set(pm).send({ responsibleMemberId: extraMember, dueMonth: 999 }).expect(400);
    expect((await pool.query(`select count(*)::int as n from notifications where kind like 'responsible_%'`)).rows[0].n).toBe(n0);
  });

  it('odgovorna osoba mijenja status vlastite isporuke samo u radnom dijelu životnog ciklusa – svaki prijelaz na poslužitelju', async () => {
    const pm = auth(f.tokens.pm); const tm = auth(f.tokens.tm);
    const ALL = ['planned', 'in_progress', 'submitted', 'accepted', 'rejected'];
    const bad: string[] = [];
    for (const from of ALL) for (const to of ALL) {
      if (from === to) continue;
      // Polazni status postavlja voditelj (prihvaćena tek nakon predane).
      if (from === 'accepted') await http().patch(`${P()}/deliverables/${d12}`).set(pm).send({ status: 'submitted' }).expect(200);
      await http().patch(`${P()}/deliverables/${d12}`).set(pm).send({ status: from }).expect(200);
      const res = await http().post(`${P()}/deliverables/${d12}/progress`).set(tm).send({ status: to });
      const expected = responsibleMayChange('deliverable', from, to) ? 201 : 403;
      if (res.status !== expected) bad.push(`${from}→${to}: ${res.status} (očekivano ${expected})`);
      const now = (await structure(f.tokens.pm)).workPackages[0].deliverables.find((x: Body) => x.id === d12).status;
      if (now !== (expected === 201 ? to : from)) bad.push(`${from}→${to}: status ${now}`);
    }
    expect(bad).toEqual([]);
    // Samo status: naslov, rok, odgovorna osoba ili bilo koje drugo polje u tijelu → 400 (ništa se ne mijenja).
    await http().patch(`${P()}/deliverables/${d12}`).set(pm).send({ status: 'planned' }).expect(200);
    for (const extra of [{ title: 'Drugi naslov' }, { dueMonth: 8 }, { responsibleMemberId: null }, { leadPartnerId: f.A.self }, { submittedAt: '2027-01-01' }]) {
      await http().post(`${P()}/deliverables/${d12}/progress`).set(tm).send({ status: 'in_progress', ...extra }).expect(400);
    }
    // Isti PATCH (uređivanje strukture) ostaje zabranjen odgovornoj osobi: naslov, rok, dodjela, status.
    for (const body of [{ title: 'Drugi naslov' }, { dueMonth: 8 }, { responsibleMemberId: extraMember }, { status: 'in_progress' }]) {
      await http().patch(`${P()}/deliverables/${d12}`).set(tm).send(body).expect(403);
    }
    const d = (await structure(f.tokens.pm)).workPackages[0].deliverables.find((x: Body) => x.id === d12);
    expect(d).toMatchObject({ title: 'Izvještaj o anketi', dueMonth: 7, status: 'planned', responsibleMemberId: f.A.member });
    // Predaja bilježi vrijeme predaje i reviziju s oznakom tko je promijenio.
    await http().post(`${P()}/deliverables/${d12}/progress`).set(tm).send({ status: 'submitted' }).expect(201);
    const audit = await pool.query(`select action, diff from audit_entries where entity = 'deliverable' and entity_id = $1 order by id desc limit 1`, [d12]);
    expect(audit.rows[0]).toMatchObject({ action: 'status.submitted', diff: { meta: { by: 'responsible' } } });
    await http().patch(`${P()}/deliverables/${d12}`).set(pm).send({ status: 'in_progress' }).expect(200);
    // Nije odgovoran: drugi član tima (403), uprava (vidi projekt, nema prava – 403), voditelj (projects:write) smije sve.
    await http().post(`${P()}/deliverables/${d12}/progress`).set(auth(f.tokens.extra)).send({ status: 'submitted' }).expect(403);
    await http().post(`${P()}/deliverables/${d12}/progress`).set(auth(f.tokens.rdr)).send({ status: 'submitted' }).expect(403);
    await http().post(`${P()}/deliverables/${f.A.deliverable}/progress`).set(tm).send({ status: 'in_progress' }).expect(403); // isporuka bez odgovorne osobe
    await http().post(`${P()}/deliverables/${d12}/progress`).set(pm).send({ status: 'accepted' }).expect(201);
    await http().patch(`${P()}/deliverables/${d12}`).set(pm).send({ status: 'in_progress' }).expect(200);
    // Projekt B (tuđi za člana tima A) i drugi stanar → 404; nepoznata isporuka → 404.
    await http().post(`/api/projects/${f.B.id}/deliverables/${f.B.deliverable}/progress`).set(tm).send({ status: 'in_progress' }).expect(404);
    await http().post(`${P()}/deliverables/${d12}/progress`).set(auth(other.tokens.tm)).send({ status: 'submitted' }).expect(404);
    await http().post(`${P()}/deliverables/${randomUUID()}/progress`).set(tm).send({ status: 'submitted' }).expect(404);
  });

  it('zadatak: planiran ↔ u tijeku → gotov; otkazivanje i ponovno otvaranje ostaju voditelju; prekretnica nema prijelaza za odgovornu osobu', async () => {
    const pm = auth(f.tokens.pm); const tm = auth(f.tokens.tm);
    const ALL = ['planned', 'in_progress', 'done', 'cancelled'];
    const bad: string[] = [];
    for (const from of ALL) for (const to of ALL) {
      if (from === to) continue;
      await http().patch(`${P()}/tasks/${f.A.task}`).set(pm).send({ status: from }).expect(200);
      const res = await http().post(`${P()}/tasks/${f.A.task}/progress`).set(tm).send({ status: to });
      const expected = responsibleMayChange('task', from, to) ? 201 : 403;
      if (res.status !== expected) bad.push(`${from}→${to}: ${res.status} (očekivano ${expected})`);
    }
    expect(bad).toEqual([]);
    await http().patch(`${P()}/tasks/${f.A.task}`).set(pm).send({ status: 'planned' }).expect(200);
    for (const extra of [{ title: 'X' }, { endMonth: 12 }, { responsibleMemberId: null }]) await http().post(`${P()}/tasks/${f.A.task}/progress`).set(tm).send({ status: 'in_progress', ...extra }).expect(400);
    for (const body of [{ title: 'Drugi' }, { endMonth: 12 }, { status: 'in_progress' }, { responsibleMemberId: null }]) await http().patch(`${P()}/tasks/${f.A.task}`).set(tm).send(body).expect(403);
    await http().post(`/api/projects/${f.B.id}/tasks/${f.B.task}/progress`).set(tm).send({ status: 'in_progress' }).expect(404);
    // Prekretnica: odgovorna osoba ne mijenja ništa (postignuće je ocjena voditelja); ruta napretka ne postoji.
    await http().patch(`${P()}/milestones/${f.A.milestone}`).set(tm).send({ status: 'achieved' }).expect(403);
    await http().post(`${P()}/milestones/${f.A.milestone}/progress`).set(tm).send({ status: 'achieved' }).expect(404);
  });

  it('Moj rad: odgovorna osoba, voditelj i nepovezani član tima na poznatoj postavi; slaganje s portfeljem; izolacija', async () => {
    const tmW = await work(f.tokens.tm);
    const mine = tmW.items.filter((i) => i.role === 'responsible').map((i) => `${i.kind}|${i.urgency}|${i.due}`).sort();
    // D1.2 (31. 7.) uskoro, T1.1 (30. 6.) i MS1 (30. 6.) kasne, D1.3 (30. 9.) je izvan 30 dana.
    expect(mine).toEqual(['deliverable_responsible|due_soon|2027-07-31', 'milestone_responsible|overdue|2027-06-30', 'task_responsible|overdue|2027-06-30']);
    expect(tmW.items.find((i) => i.kind === 'deliverable_responsible')).toMatchObject({ link: `projekti/${f.A.id}/struktura`, title: expect.stringMatching(/^Isporuka D\d\.2 Izvještaj o anketi$/), detail: expect.stringMatching(/ti si odgovorna osoba · u izradi$/) });
    // Voditelj: iste isporuke kao „Moj rad” voditelja, s imenom odgovorne osobe; D1.1 bez odgovorne osobe.
    const pmW = await work(f.tokens.pm);
    const pmD = pmW.items.filter((i) => i.kind === 'deliverable_due');
    expect(pmD.map((i) => `${i.urgency}|${i.due}|${i.detail!.split(' · ')[1]}`).sort()).toEqual(['due_soon|2027-07-31|odgovorna osoba: Član tima A', 'overdue|2027-06-30|odgovorna osoba nije određena']);
    expect(pmW.items.find((i) => i.kind === 'milestone_due')!.detail).toMatch(/odgovorna osoba: Član tima A$/);
    expect(pmW.items.some((i) => i.role === 'responsible')).toBe(false);
    // Nepovezani član tima istog projekta: ništa od toga.
    expect((await work(f.tokens.extra)).items.filter((i) => /deliverable|milestone|task/.test(i.kind))).toEqual([]);
    // Portfelj voditelja: isporuke koje kasne = stavke voditelja koje kasne (iste definicije, portfolio/facts.ts).
    const pf = (await http().get('/api/portfolio').set(auth(f.tokens.pm)).expect(200)).body;
    expect(pf.projects.find((p: Body) => p.id === f.A.id).attention.lateDeliverables).toBe(pmD.filter((i) => i.urgency === 'overdue').length);
    const dl = pf.deadlines.find((x: Body) => x.key === `deliverable-${d12}`);
    expect(dl).toMatchObject({ responsible: 'Član tima A' });
    // Izolacija: ništa o projektu B ni drugom stanaru.
    expect(JSON.stringify(tmW)).not.toContain(f.B.id);
    expect(JSON.stringify(await work(other.tokens.tm))).not.toContain(f.A.id);
    expect(JSON.stringify(await notes(f.tokens.tm))).not.toContain(f.B.id);
  });

  it('broj upita /me/work ne raste s brojem stavki i projekata odgovorne osobe', async () => {
    const count = async (t: string) => {
      const orig = Client.prototype.query; let n = 0;
      Client.prototype.query = function (this: Client, ...a: unknown[]) { n++; return (orig as (...x: unknown[]) => unknown).apply(this, a); } as typeof orig;
      try { await work(t); } finally { Client.prototype.query = orig; }
      return n;
    };
    const before = await count(f.tokens.tm);
    const admin = auth(f.tokens.admin);
    for (let i = 0; i < 2; i++) {
      const p = (await http().post('/api/projects').set(admin).send({ acronym: `RX${i}${tag.slice(0, 3)}`, title: 'Dodatni', packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA', contractNo: `UG-RX${i}-${tag}`, startDate: '2027-01-01', durationMonths: 12 }).expect(201)).body;
      const wp = (await http().post(`/api/projects/${p.id}/work-packages`).set(admin).send({ title: 'Rad', startMonth: 1, endMonth: 12 }).expect(201)).body.id;
      const member = (await http().post(`/api/projects/${p.id}/team`).set(admin).send({ fullName: 'Član tima A', userId: f.users.tm }).expect(201)).body.id;
      await http().post(`/api/projects/${p.id}/work-packages/${wp}/deliverables`).set(admin).send({ title: 'Izvještaj', type: 'ISP', dissemination: 'JAV', dueMonth: 7, responsibleMemberId: member }).expect(201);
      await http().post(`/api/projects/${p.id}/work-packages/${wp}/tasks`).set(admin).send({ title: 'Zadatak', startMonth: 1, endMonth: 7, responsibleMemberId: member }).expect(201);
      await http().post(`/api/projects/${p.id}/transition`).set(admin).send({ to: 'active' }).expect(201);
    }
    expect((await work(f.tokens.tm)).items.filter((i) => i.role === 'responsible').length).toBe(7);
    expect(await count(f.tokens.tm)).toBe(before);
  });

  it('deaktivirani član tima: dodjela ostaje (vidljiva voditelju kao neaktivna), stavke nestaju iz njegova „Moj rad”, ne mijenja status', async () => {
    const admin = auth(f.tokens.admin);
    await http().patch(`${P()}/team/${f.A.member}`).set(admin).send({ active: false }).expect(200);
    expect((await work(f.tokens.tm)).items.filter((i) => i.role === 'responsible' && i.projectId === f.A.id)).toEqual([]);
    expect((await work(f.tokens.pm)).items.find((i) => i.key === `deliverable:${d12}`)!.detail).toMatch(/Član tima A više nije aktivna u timu – odredi drugu$/);
    expect((await structure(f.tokens.pm)).workPackages[0].deliverables.find((x: Body) => x.id === d12).responsible).toMatchObject({ name: 'Član tima A', active: false });
    await http().post(`${P()}/deliverables/${d12}/progress`).set(auth(f.tokens.tm)).send({ status: 'submitted' }).expect(403);
    // Voditelj može odrediti drugoga (ili ukloniti) – neaktivni se više ne nudi; ponovna aktivacija vraća stavke.
    await http().patch(`${P()}/team/${f.A.member}`).set(admin).send({ active: true }).expect(200);
    expect((await work(f.tokens.tm)).items.some((i) => i.key === `deliverable:${d12}`)).toBe(true);
  });

  it('dnevni sažetak i osobni kalendar preuzimaju stavke postojećim putem', async () => {
    // Kalendar: rokovi isporuka projekta koje korisnik vidi (portfelj) – D1.2 je među njima, bez imena osoba.
    const gen = (await http().post('/api/me/calendar').set(auth(f.tokens.tm)).expect(201)).body;
    const ics = (await http().get(gen.path).expect(200)).text.replace(/\r\n[ \t]/g, '');
    expect(ics).toMatch(new RegExp(`UID:deliverable-${d12}@arqus-projekti`));
    expect(ics).not.toContain('Član tima A');
    // Sažetak: isti MyWorkService pod korisnikom – stavka odgovorne osobe ulazi u „Uskoro”.
    const sent: OutgoingMail[] = [];
    const settings: MailSettings = { enabled: true, publicUrl: 'https://projekti.institucija.hr', from: { address: 'arqus@institucija.hr', name: 'ArQus Projekti' }, smtp: null, maxConcurrency: 1, digestHour: 7 };
    const m = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MAIL_SETTINGS).useValue(settings).overrideProvider(MAIL_TRANSPORT).useValue({ send: async (x: OutgoingMail) => { sent.push(x); return { attempts: 1 }; } }).compile();
    const mailApp = m.createNestApplication(); mailApp.setGlobalPrefix('api'); await mailApp.init();
    try {
      const tenantId = (await pool.query('select id from tenants where slug = $1', [f.slug])).rows[0].id;
      await mailApp.get(DigestService).run(new Date('2027-07-15T06:00:00Z'), { tenantIds: [tenantId] });
      const mail = sent.find((x) => x.to.address === `tm@${f.slug}.hr`)!;
      // Stavka odgovorne osobe koja kasni (sažetak prikazuje najviše 15 stavki, kasne prve).
      expect(mail.text).toMatch(/Prekretnica MS1 Prekretnica – kasni 15 dana \(rok 30\. 6\. 2027\.\) · ti si odgovorna osoba/);
      expect(mail.text).not.toMatch(/EUR|€/);
    } finally { await mailApp.close(); }
  });

  it('član tima koji je odgovorna osoba ne može se obrisati (baza, NO ACTION) – nijedna stavka ne ostaje tiho bez odgovornog', async () => {
    const admin = auth(f.tokens.admin);
    const x = (await http().post(`${P()}/team`).set(admin).send({ fullName: 'Privremeni član' }).expect(201)).body.id;
    await http().patch(`${P()}/milestones/${f.A.milestone}`).set(auth(f.tokens.pm)).send({ responsibleMemberId: x }).expect(200);
    await expect(pool.query('delete from team_members where id = $1', [x])).rejects.toThrow(/milestones_responsible_fk/);
    await http().patch(`${P()}/milestones/${f.A.milestone}`).set(auth(f.tokens.pm)).send({ responsibleMemberId: null }).expect(200);
    await pool.query('delete from team_members where id = $1', [x]);
  });
});
