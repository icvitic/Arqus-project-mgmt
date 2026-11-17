import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { buildAccessFixture, PDF, type AccessFixture } from './access-fixture';

/**
 * WP1.15 – portfelj. Točne brojke na maloj postavi (dva NPOO projekta od 1. 1. 2027., 12 mjeseci, „danas” = 15. 7. 2027.)
 * i pravila pristupa (WP1.14): voditelj i član tima samo na projektu A, financije i uprava na razini institucije.
 *
 * NPOO: neizravni 15 % od osoblja, financiranje 100 %, razdoblja od 3 mjeseca, rok 30 dana.
 * Proračun po projektu: OS 20.000 + VU 10.000 + NT 3.000 = 33.000,00 EUR.
 */
const NOW = new Date('2027-07-15T10:00:00Z');

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Portfelj (WP1.15, e2e)', () => {
  let app: INestApplication; let f: AccessFixture;
  const tag = randomUUID().slice(0, 8);
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = async (t: string, q = ''): Promise<Body> => (await http().get(`/api/portfolio${q}`).set(auth(t)).expect(200)).body;
  let tmB = ''; let callId = ''; let goProposal = '';

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), 'arqus-portfolio-'));
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    f = await buildAccessFixture(app, `pf-${tag}`);
    const admin = auth(f.tokens.admin);
    // A: ručni trošak bez dokaza, visok otvoren rizik, ZNS za RP1 predan (troškovi iz veljače i ožujka).
    await http().post(`/api/projects/${f.A.id}/expenses`).set(admin).send({ categoryCode: 'PUT', date: '2027-03-03', description: 'Putni trošak', amount: 20_000 }).expect(201);
    await http().post(`/api/projects/${f.A.id}/risks`).set(admin).send({ description: 'Visok rizik', likelihood: 3, impact: 2 }).expect(201);
    await http().post(`/api/projects/${f.A.id}/claims/${f.A.claim}/submit`).set(admin).expect(201);
    // B: veći trošak s (internim) dokazom; isti član tima kao na A, upisan samo imenom, radi 1. 2. i na B (8 h + 4 h = 12 h).
    const big = (await http().post(`/api/projects/${f.B.id}/expenses`).set(admin).send({ categoryCode: 'VU', date: '2027-05-05', description: 'Studija', amount: 1_500_000 }).expect(201)).body.id as string;
    await http().post('/api/documents').set(admin).field({ entityType: 'expense', entityId: big, title: 'Račun', kind: 'evidence' }).attach('file', PDF, 'racun.pdf').expect(201);
    tmB = (await http().post(`/api/projects/${f.B.id}/team`).set(admin).send({ fullName: 'Član tima A', annualCost: 3_000_000 }).expect(201)).body.id as string;
    await http().put(`/api/projects/${f.B.id}/team/${tmB}/timesheets/${f.month}`).set(admin).send({ entries: [{ day: 1, minutes: 240, workPackageId: f.B.wp }] }).expect(200);
    await http().post(`/api/projects/${f.B.id}/team/${tmB}/timesheets/${f.month}/submit`).set(admin).expect(201);
    // Radar: praćeni poziv (go) s rokom predaje i internim rokom; poziv no-go se ne prikazuje.
    callId = (await http().post('/api/calls').set(admin).send({ code: `PF-${tag}`, title: 'Poziv za portfelj', programme: 'NPOO', packageId: 'npoo-2021-2026', actionTypes: ['BESPOVRATNA'], deadlines: [{ kind: 'submission', at: '2027-07-25T15:00:00Z' }] }).expect(201)).body.id as string;
    await http().put(`/api/calls/${callId}/decision`).set(admin).send({ decision: 'go', rationale: 'Uklapa se', internalDeadline: '2027-07-20' }).expect(200);
    const noGo = (await http().post('/api/calls').set(admin).send({ code: `PF-NO-${tag}`, title: 'Odbačeni poziv', programme: 'NPOO', deadlines: [{ kind: 'submission', at: '2027-07-22T15:00:00Z' }] }).expect(201)).body.id as string;
    await http().put(`/api/calls/${noGo}/decision`).set(admin).send({ decision: 'no_go', rationale: 'Ne' }).expect(200);
    // Prijave: jedna iz odluke go (ideja, interni rok 18. 7.), jedna odbijena.
    const p1 = (await http().post(`/api/calls/${callId}/proposal`).set(admin).send({ acronym: `GO${tag.slice(0, 4)}`, title: 'Prijava iz radara', durationMonths: 12, internalDeadline: '2027-07-18' }).expect(201)).body;
    goProposal = p1.id;
    await http().put(`/api/proposals/${p1.id}/budget/lines`).set(admin).send({ lines: [{ memberId: p1.members[0].id, categoryCode: 'OS', amount: 1_000_000 }] }).expect(200);
    const p2 = (await http().post('/api/proposals').set(admin).send({ packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA', acronym: `RJ${tag.slice(0, 4)}`, title: 'Odbijena prijava', durationMonths: 12 }).expect(201)).body;
    await http().post(`/api/proposals/${p2.id}/work-packages`).set(admin).send({ title: 'Rad', startMonth: 1, endMonth: 12 }).expect(201);
    await http().put(`/api/proposals/${p2.id}/budget/lines`).set(admin).send({ lines: [{ memberId: p2.members[0].id, categoryCode: 'OS', amount: 500_000 }] }).expect(200);
    await http().post(`/api/proposals/${p2.id}/budget/lock`).set(admin).expect(201);
    for (const to of ['preparation', 'internal_review']) await http().post(`/api/proposals/${p2.id}/transition`).set(admin).send({ to }).expect(201);
    await http().post(`/api/proposals/${p2.id}/submit`).set(admin).send({ portal: 'eNPOO', reference: 'X-1' }).expect(201);
    await http().post(`/api/proposals/${p2.id}/outcome`).set(admin).send({ result: 'rejected' }).expect(201);
  }, 90_000);
  afterAll(async () => { vi.useRealTimers(); await app.close(); });

  const byAcr = (b: Body) => Object.fromEntries((b.projects as Body[]).map((p) => [p.id === f.A.id ? 'A' : p.id === f.B.id ? 'B' : p.acronym, p]));

  it('ured / administrator: brojke, projekti, napredak, upozorenja', async () => {
    const b = await get(f.tokens.admin);
    expect(b.today).toBe('2027-07-15');
    expect(b.access).toEqual({ full: true, people: true, pipeline: true, calls: true, finance: 'all' });
    expect(b.summary).toMatchObject({
      projects: 2, activeProjects: 2, deadlinesSoon: 5, overdue: 5, attention: { lagging: 1, ahead: 0 },
      money: { projects: 2, planned: 6_600_000, requested: 6_600_000, spent: 1_620_000, spentPercent: 25, projectPlanned: 6_600_000, projectRequested: 6_600_000, projectSpent: 1_620_000 },
      successRate: { funded: 0, rejected: 1, percent: 0 },
      pipeline: { open: 1, requested: 1_150_000, requestedOwn: 1_150_000 },
    });
    const { A, B } = byAcr(b);
    expect(A).toMatchObject({
      status: 'active', role: 'coordinator', programme: 'Nacionalni plan oporavka i otpornosti 2021.–2026.', endDate: '2027-12-31', time: { state: 'running', month: 7, percent: 54 },
      budget: { planned: 3_300_000, actual: 70_000, requested: 3_300_000, percent: 2, signal: 'lagging', gap: -52 },
      nextReport: { period: 2, dueDate: '2027-07-30', days: 15, overdue: false },
      attention: { lateDeliverables: 1, highRisks: 1, timesheetsToApprove: 2, expensesWithoutEvidence: 1, unclaimedPeriods: 1 },
    });
    expect(B).toMatchObject({
      budget: { planned: 3_300_000, actual: 1_550_000, percent: 47, signal: 'ok', gap: -7 },
      nextReport: { period: 1, dueDate: '2027-04-30', days: -76, overdue: true },
      attention: { lateDeliverables: 1, highRisks: 0, timesheetsToApprove: 2, expensesWithoutEvidence: 0, unclaimedPeriods: 2 },
    });
    // Iste brojke kao „Ugovoreno / ostvareno” na projektu (vlastita organizacija je jedini partner).
    const fin = (await http().get(`/api/projects/${f.A.id}/finance`).set(auth(f.tokens.admin)).expect(200)).body;
    expect([fin.planned.total, fin.actual.total, fin.planned.requested]).toEqual([A.budget.planned, A.budget.actual, A.budget.requested]);
  });

  it('rokovi: prošli prvi, zatim idućih 60 dana; prozor se mijenja parametrom days', async () => {
    const b = await get(f.tokens.admin);
    const acr = (id?: string) => (id === f.A.id ? 'A' : id === f.B.id ? 'B' : '');
    expect((b.deadlines as Body[]).map((d) => `${d.kind}|${d.days}|${d.overdue}|${acr(d.projectId)}`)).toEqual([
      'claim_due|-76|true|B',
      'deliverable|-15|true|A', 'deliverable|-15|true|B', 'milestone|-15|true|A', 'milestone|-15|true|B',
      'proposal_internal|3|false|', 'call_internal|5|false|', 'call_submission|10|false|',
      'claim_due|15|false|A', 'claim_due|15|false|B',
    ]);
    const d0 = (b.deadlines as Body[])[0]!;
    expect(d0).toMatchObject({ date: '2027-04-30', title: 'RP1 – rok za zahtjev za nadoknadu i izvještaj', link: `projekti/${f.B.id}/zns` });
    expect((b.deadlines as Body[]).find((d) => d.kind === 'call_submission')).toMatchObject({ callId, link: `radar/${callId}`, at: '2027-07-25T15:00:00Z', date: '2027-07-25' });
    expect((b.deadlines as Body[]).find((d) => d.kind === 'proposal_internal')).toMatchObject({ proposalId: goProposal, link: `prijave/${goProposal}` });
    const short = await get(f.tokens.admin, '?days=10');
    expect(short.days).toBe(10);
    expect((short.deadlines as Body[]).map((d) => d.kind)).toEqual(['claim_due', 'deliverable', 'deliverable', 'milestone', 'milestone', 'proposal_internal', 'call_internal', 'call_submission']);
    expect(short.summary).toMatchObject({ deadlinesSoon: 5, overdue: 5 }); // brojke ne ovise o prozoru popisa
    expect((await get(f.tokens.admin, '?days=abc')).days).toBe(60);
  });

  it('opterećenje ljudi: ista osoba kroz projekte, dan iznad 8 h, godišnji fond iz paketa', async () => {
    const b = await get(f.tokens.admin);
    expect(b.people).toMatchObject({ months: ['2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07'], year: '2027', dailyLimitHours: 8 });
    const persons = b.people.persons as Body[];
    expect(persons.map((p) => [p.name, p.yearMinutes, p.projects.length])).toEqual([['Član tima A', 720, 2], [expect.stringMatching(/^Istraživač PB/), 480, 1], ['Voditelj A', 240, 1]]);
    expect(persons[0]).toMatchObject({ userId: f.users.tm, annualLimitHours: 1720, overAnnual: false, overDays: [{ date: '2027-02-01', minutes: 720, projects: 2 }] });
    expect(persons[0]!.months[0]).toEqual({ month: '2027-02', minutes: 720 });
    expect(persons[0]!.projects.map((p: Body) => p.id).sort()).toEqual([f.A.id, f.B.id].sort());
  });

  it('prijave: po statusu s traženim iznosima, interni rokovi', async () => {
    const b = await get(f.tokens.admin);
    expect(b.pipeline.byStatus).toEqual([{ status: 'idea', count: 1, requested: 1_150_000, requestedOwn: 1_150_000 }, { status: 'rejected', count: 1, requested: 575_000, requestedOwn: 575_000 }]);
    expect(b.pipeline.proposals).toEqual([expect.objectContaining({ id: goProposal, status: 'idea', internalDeadline: '2027-07-18', days: 3, callCode: `PF-${tag}`, requested: 1_150_000 })]);
  });

  it('voditelj samo na A: samo A, iznosi za A, bez ljudi, prijava i poziva', async () => {
    const b = await get(f.tokens.pm);
    expect(b.access).toEqual({ full: false, people: false, pipeline: false, calls: false, finance: 'all' });
    expect((b.projects as Body[]).map((p) => p.id)).toEqual([f.A.id]);
    expect(b.projects[0]).toMatchObject({ budget: { planned: 3_300_000, actual: 70_000 }, attention: { timesheetsToApprove: 2, expensesWithoutEvidence: 1, unclaimedPeriods: 1 } });
    expect(b.summary).toMatchObject({ projects: 1, activeProjects: 1, money: { projects: 1, planned: 3_300_000, spent: 70_000 }, pipeline: null, successRate: null, deadlinesSoon: 1, overdue: 2 });
    expect(b.people).toBeNull(); expect(b.pipeline).toBeNull();
    expect((b.deadlines as Body[]).every((d) => d.projectId === f.A.id)).toBe(true);
    expect(JSON.stringify(b)).not.toContain(f.B.id);
  });

  it('član tima na A: projekt i rokovi bez novca', async () => {
    const b = await get(f.tokens.tm);
    expect(b.access).toEqual({ full: false, people: false, pipeline: false, calls: false, finance: 'none' });
    expect((b.projects as Body[]).map((p) => p.id)).toEqual([f.A.id]);
    expect(b.projects[0]).toMatchObject({ budget: null, time: { month: 7, percent: 54 }, attention: { lateDeliverables: 1, highRisks: 1, timesheetsToApprove: 2, expensesWithoutEvidence: null, unclaimedPeriods: null } });
    expect(b.summary.money).toBeNull();
    expect((b.deadlines as Body[]).map((d) => d.kind)).toEqual(['deliverable', 'milestone', 'claim_due']);
    expect((b.deadlines as Body[]).find((d) => d.kind === 'claim_due')!.link).toBe(`projekti/${f.A.id}`);
    expect(JSON.stringify(b)).not.toMatch(/3300000|1150000|"planned"/);
  });

  it('financije i uprava (portfolio:read): sve; povjerljivi dokaz broji se samo onome tko ga smije vidjeti', async () => {
    for (const [t, evA, evB] of [[f.tokens.fin, 1, 0], [f.tokens.rdr, 2, 1]] as const) {
      const b = await get(t);
      expect(b.access).toEqual({ full: true, people: true, pipeline: true, calls: true, finance: 'all' });
      expect(b.summary).toMatchObject({ projects: 2, money: { spent: 1_620_000 }, overdue: 5, deadlinesSoon: 5, successRate: { rejected: 1 } });
      const { A, B } = byAcr(b);
      expect([A.attention.expensesWithoutEvidence, B.attention.expensesWithoutEvidence]).toEqual([evA, evB]);
      expect(b.people.persons).toHaveLength(3);
      expect(b.pipeline.open).toBe(1);
    }
  });

  it('bez ijednog projekta: 403', async () => {
    await http().get('/api/portfolio').set(auth(f.tokens.extra)).expect(403);
    await http().get('/api/portfolio').expect(401);
  });
});
