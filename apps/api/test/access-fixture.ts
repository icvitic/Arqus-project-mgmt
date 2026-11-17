import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { seedDemo } from '../src/db/seed';

/**
 * Zajednička postava za testove pristupa po projektu (WP1.14): jedan stanar, dva projekta (A i B) s punim sadržajem
 * u svim modulima i korisnici s različitim dodjelama:
 *  - pm      – voditelj projekta SAMO na A (dobiva ulogu imenovanjem za voditelja pri stvaranju projekta)
 *  - tm      – član tima SAMO na A (dobiva ulogu dodavanjem u tim s korisničkim računom)
 *  - fin     – financije na razini institucije
 *  - rdr     – čitatelj (uprava) na razini institucije
 *  - extra   – bez ikakve uloge (za dodjele kroz upravljanje pristupom)
 */
export const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const PW = 'Plava-Staza-2027-x';

export interface ProjectIds { id: string; self: string; wp: string; task: string; deliverable: string; milestone: string; risk: string; member: string; expense: string; claim: string; doc: string; confidentialDoc: string; evidence: string }
export interface AccessFixture {
  slug: string;
  tokens: { admin: string; pm: string; tm: string; fin: string; rdr: string; extra: string };
  users: { pm: string; tm: string; fin: string; rdr: string; extra: string };
  A: ProjectIds & { pmMember: string };
  B: ProjectIds;
  month: string;
}

export async function buildAccessFixture(app: INestApplication, slug: string): Promise<AccessFixture> {
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (email: string, pw = PW) => (await http().post('/api/auth/login').send({ tenantSlug: slug, email, password: pw }).expect(201)).body.accessToken as string;
  await seedDemo({ url: ADMIN_URL, tenantSlug: slug, adminEmail: `a@${slug}.hr`, adminPassword: 'Lozinka-123456' });
  const admin = await login(`a@${slug}.hr`, 'Lozinka-123456');
  const mk = async (local: string, roleCodes: string[]) => (await http().post('/api/users').set(auth(admin)).send({ email: `${local}@${slug}.hr`, displayName: `Korisnik ${local}`, password: PW, roleCodes }).expect(201)).body.id as string;
  const users = { pm: await mk('pm', []), tm: await mk('tm', []), fin: await mk('fin', ['finance']), rdr: await mk('rdr', ['reader']), extra: await mk('extra', []) };
  const month = '2027-02';

  const project = async (acronym: string, managerUserId?: string) => {
    const p = (await http().post('/api/projects').set(auth(admin)).send({ acronym, title: `Projekt ${acronym}`, packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA', contractNo: `UG-${acronym}-${slug}`, startDate: '2027-01-01', durationMonths: 12, ...(managerUserId ? { managerUserId } : {}) }).expect(201)).body;
    const id = p.id as string; const self = p.partners[0].id as string;
    const wp = (await http().post(`/api/projects/${id}/work-packages`).set(auth(admin)).send({ title: 'Istraživanje', startMonth: 1, endMonth: 12 }).expect(201)).body.id as string;
    const task = (await http().post(`/api/projects/${id}/work-packages/${wp}/tasks`).set(auth(admin)).send({ title: 'Zadatak', startMonth: 1, endMonth: 6 }).expect(201)).body.id as string;
    const deliverable = (await http().post(`/api/projects/${id}/work-packages/${wp}/deliverables`).set(auth(admin)).send({ title: 'Izvještaj', type: 'ISP', dissemination: 'JAV', dueMonth: 6 }).expect(201)).body.id as string;
    const milestone = (await http().post(`/api/projects/${id}/milestones`).set(auth(admin)).send({ title: 'Prekretnica', dueMonth: 6 }).expect(201)).body.id as string;
    const risk = (await http().post(`/api/projects/${id}/risks`).set(auth(admin)).send({ description: 'Rizik', likelihood: 2, impact: 2 }).expect(201)).body.id as string;
    await http().put(`/api/projects/${id}/budget/lines`).set(auth(admin)).send({ lines: [{ partnerId: self, categoryCode: 'OS', amount: 2_000_000 }, { partnerId: self, categoryCode: 'VU', amount: 1_000_000 }] }).expect(200);
    const member = (await http().post(`/api/projects/${id}/team`).set(auth(admin)).send({ fullName: `Istraživač ${acronym}`, annualCost: 3_440_000 }).expect(201)).body.id as string;
    return { id, self, wp, task, deliverable, milestone, risk, member };
  };
  const a = await project(`PA${slug.slice(-4)}`, users.pm);
  const b = await project(`PB${slug.slice(-4)}`);
  // Član tima A povezan s korisnikom tm (→ uloga člana tima na A); voditelj je i sam član tima (za provjeru samoodobrenja).
  const tmMember = (await http().post(`/api/projects/${a.id}/team`).set(auth(admin)).send({ fullName: 'Član tima A', userId: users.tm, annualCost: 3_000_000 }).expect(201)).body.id as string;
  const pmMember = (await http().post(`/api/projects/${a.id}/team`).set(auth(admin)).send({ fullName: 'Voditelj A', userId: users.pm, annualCost: 5_000_000 }).expect(201)).body.id as string;

  const finish = async (p: typeof a) => {
    await http().post(`/api/projects/${p.id}/transition`).set(auth(admin)).send({ to: 'active' }).expect(201);
    const expense = (await http().post(`/api/projects/${p.id}/expenses`).set(auth(admin)).send({ categoryCode: 'VU', date: '2027-02-10', description: 'Usluga', amount: 50_000 }).expect(201)).body.id as string;
    const up = async (fields: Record<string, string>) => (await http().post('/api/documents').set(auth(admin)).field(fields).attach('file', PDF, 'dokument.pdf').expect(201)).body.id as string;
    const doc = await up({ entityType: 'project', entityId: p.id, title: 'Interni dokument' });
    const confidentialDoc = await up({ entityType: 'project', entityId: p.id, title: 'Povjerljivi ugovor', confidentiality: 'confidential' });
    // Jedini dokaz troška je povjerljiv: tko ga ne smije vidjeti, vidi 0 dokaza.
    const evidence = await up({ entityType: 'expense', entityId: expense, title: 'Račun', kind: 'evidence', confidentiality: 'confidential' });
    const claim = (await http().post(`/api/projects/${p.id}/claims`).set(auth(admin)).send({ period: 1 }).expect(201)).body.id as string;
    return { expense, doc, confidentialDoc, evidence, claim };
  };
  const A = { ...a, ...(await finish(a)), pmMember };
  const B = { ...b, ...(await finish(b)) };
  // Timesheet člana tima B (predan) – za pokušaje tuđeg odobrenja.
  await http().put(`/api/projects/${B.id}/team/${B.member}/timesheets/${month}`).set(auth(admin)).send({ entries: [{ day: 1, minutes: 480, workPackageId: B.wp }] }).expect(200);
  await http().post(`/api/projects/${B.id}/team/${B.member}/timesheets/${month}/submit`).set(auth(admin)).expect(201);

  const tokens = { admin, pm: await login(`pm@${slug}.hr`), tm: await login(`tm@${slug}.hr`), fin: await login(`fin@${slug}.hr`), rdr: await login(`rdr@${slug}.hr`), extra: await login(`extra@${slug}.hr`) };
  // Član tima A unosi i predaje vlastiti timesheet; voditelj također (vlastiti, ne smije ga sam odobriti).
  await http().put(`/api/projects/${A.id}/team/${tmMember}/timesheets/${month}`).set(auth(tokens.tm)).send({ entries: [{ day: 1, minutes: 480, workPackageId: A.wp }] }).expect(200);
  await http().post(`/api/projects/${A.id}/team/${tmMember}/timesheets/${month}/submit`).set(auth(tokens.tm)).expect(201);
  await http().put(`/api/projects/${A.id}/team/${pmMember}/timesheets/${month}`).set(auth(tokens.pm)).send({ entries: [{ day: 2, minutes: 240, workPackageId: A.wp }] }).expect(200);
  await http().post(`/api/projects/${A.id}/team/${pmMember}/timesheets/${month}/submit`).set(auth(tokens.pm)).expect(201);
  return { slug, tokens, users, A: { ...A, member: tmMember }, B, month };
}
