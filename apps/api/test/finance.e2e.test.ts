import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';

const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
/** „Danas” = 20. 7. 2027.: RP1 (siječanj–lipanj 2027.) je završio, RP2 (srpanj–prosinac) traje (WP1.16a: predaja tek nakon kraja razdoblja). */
const NOW = new Date('2027-07-20T10:00:00Z');

describe('Financije: timesheetovi, troškovi, ZNS (e2e)', () => {
  let app: INestApplication; let A = ''; let B = ''; let worker = '';
  const tag = randomUUID().slice(0, 8); const slugA = `fa-${tag}`, slugB = `fb-${tag}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (slug: string, email = `a@${slug}.hr`, pw = 'Lozinka-123456') => (await http().post('/api/auth/login').send({ tenantSlug: slug, email, password: pw }).expect(201)).body.accessToken as string;
  const pozivId = `npoo-fin-${tag}`;
  let pid = ''; let self = ''; let wp1 = ''; let ivana = ''; let marko = ''; let workerUserId = ''; let claim1 = ''; let manualExpense = '';
  const owner = new Pool({ connectionString: ADMIN_URL, max: 1 });
  type Exp = { id: string; amount: number; recognised: number | null; status: string; source: string; workPackage: string | null; description: string };

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    process.env.DATABASE_URL = APP_URL;
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), 'arqus-finance-'));
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugA, adminEmail: `a@${slugA}.hr`, adminPassword: 'Lozinka-123456' });
    await seedDemo({ url: ADMIN_URL, tenantSlug: slugB, adminEmail: `a@${slugB}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    A = await login(slugA); B = await login(slugB);
    const u = await http().post('/api/users').set(auth(A)).send({ email: `ivana@${slugA}.hr`, displayName: 'Ivana', password: 'Radnica-123456', roleCodes: ['team-member'] }).expect(201);
    workerUserId = u.body.id; worker = await login(slugA, `ivana@${slugA}.hr`, 'Radnica-123456');
    const pkg = await http().post('/api/programme-packages').set(auth(A)).send({
      meta: { id: pozivId, extends: 'npoo-2021-2026', programme: 'NPOO – poziv', version: '1.0.0', validFrom: '2026-10-01', language: 'hr' },
      actionTypes: [], costCategories: [], reporting: { periodMonths: 6, submissionDeadlineDays: 30 },
    }).expect(201);
    await http().post(`/api/programme-packages/${pkg.body.id}/publish`).set(auth(A)).expect(201);
    const p = await http().post('/api/projects').set(auth(A)).send({ acronym: 'FINPROJ', title: 'Financijski tok', packageId: pozivId, actionType: 'BESPOVRATNA', contractNo: `UG-F-${tag}`, startDate: '2027-01-01', durationMonths: 12 }).expect(201);
    pid = p.body.id; self = p.body.partners[0].id;
    wp1 = (await http().post(`/api/projects/${pid}/work-packages`).set(auth(A)).send({ title: 'Istraživanje', startMonth: 1, endMonth: 12 }).expect(201)).body.id;
    await http().put(`/api/projects/${pid}/budget/lines`).set(auth(A)).send({ lines: [{ partnerId: self, categoryCode: 'OS', amount: 2_000_000 }, { partnerId: self, categoryCode: 'VU', amount: 1_000_000 }] }).expect(200);
  });
  afterAll(async () => { vi.useRealTimers(); await app.close(); await owner.end(); });

  it('troškovi prije aktivacije → 409; tim: član s korisnikom i bez', async () => {
    await http().post(`/api/projects/${pid}/expenses`).set(auth(A)).send({ categoryCode: 'VU', date: '2027-02-01', description: 'Usluga', amount: 100 }).expect(409);
    ivana = (await http().post(`/api/projects/${pid}/team`).set(auth(A)).send({ fullName: 'Ivana Horvat', userId: workerUserId, role: 'istraživačica', annualCost: 3_440_000 }).expect(201)).body.id;
    marko = (await http().post(`/api/projects/${pid}/team`).set(auth(A)).send({ fullName: 'Marko Kovač', annualCost: 5_160_000 }).expect(201)).body.id;
    await http().post(`/api/projects/${pid}/transition`).set(auth(A)).send({ to: 'active' }).expect(201);
    const team = await http().get(`/api/projects/${pid}/team`).set(auth(A)).expect(200);
    expect(team.body).toHaveLength(2);
    expect(team.body.find((t: { id: string }) => t.id === ivana).annualCost).toBe(3_440_000);
    const asWorker = await http().get(`/api/projects/${pid}/team`).set(auth(worker)).expect(200);
    expect(asWorker.body.every((t: { annualCost: number | null }) => t.annualCost === null)).toBe(true); // plaće samo uz personnel:read
  });

  it('timesheet: djelatnica uređuje svoj, ne tuđi; greške 400, upozorenja vraćena; izvan trajanja 400', async () => {
    const own = await http().put(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02`).set(auth(worker)).send({ entries: [
      { day: 1, minutes: 480, workPackageId: wp1 }, { day: 2, minutes: 420, workPackageId: wp1 }, { day: 6, minutes: 120 },
    ] }).expect(200);
    expect(own.body).toMatchObject({ status: 'draft', totalMinutes: 1020 });
    expect(own.body.warnings).toEqual(['dan 6: rad vikendom']);
    await http().put(`/api/projects/${pid}/team/${marko}/timesheets/2027-02`).set(auth(worker)).send({ entries: [{ day: 1, minutes: 60 }] }).expect(403);
    const bad = await http().put(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02`).set(auth(worker)).send({ entries: [{ day: 30, minutes: 60 }] }).expect(400);
    expect(bad.body.issues[0]).toMatch(/ne postoji/);
    await http().put(`/api/projects/${pid}/team/${ivana}/timesheets/2028-02`).set(auth(worker)).send({ entries: [] }).expect(400);
    await http().get(`/api/projects/${pid}/team/${ivana}/timesheets/2027-13`).set(auth(A)).expect(400);
  });

  it('predaja (djelatnica) i odobrenje (voditelj, ne djelatnica): trošak osoblja po WP-u iz satnice paketa', async () => {
    await http().post(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02/submit`).set(auth(worker)).expect(201);
    await http().put(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02`).set(auth(worker)).send({ entries: [] }).expect(409);
    await http().post(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02/approve`).set(auth(worker)).expect(403);
    const ok = await http().post(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02/approve`).set(auth(A)).expect(201);
    expect(ok.body.status).toBe('approved');
    // 34.400 €/god ÷ 1720 h = 20 €/h: WP1 15 h = 300 €, bez WP-a 2 h = 40 €
    expect(ok.body.personnelCost.map((x: { amount: number }) => x.amount).sort()).toEqual([30_000, 4_000].sort());
    const ex = await http().get(`/api/projects/${pid}/expenses`).set(auth(A)).expect(200);
    const ts = ex.body.filter((e: { source: string }) => e.source === 'timesheet');
    expect(ts).toHaveLength(2);
    expect(ts[0]).toMatchObject({ categoryCode: 'OS', date: '2027-02-28', status: 'recorded' });
  });

  it('ručni troškovi: osoblje ručno 400, izvan trajanja 400, ispravan 201; izmjena i brisanje dok je evidentiran', async () => {
    const os = await http().post(`/api/projects/${pid}/expenses`).set(auth(A)).send({ categoryCode: 'OS', date: '2027-03-01', description: 'Plaća', amount: 100 }).expect(400);
    expect(os.body.issues[0]).toMatch(/timesheeta/);
    await http().post(`/api/projects/${pid}/expenses`).set(auth(A)).send({ categoryCode: 'VU', date: '2028-03-01', description: 'Kasno', amount: 100 }).expect(400);
    const e = await http().post(`/api/projects/${pid}/expenses`).set(auth(A)).send({ categoryCode: 'VU', workPackageId: wp1, date: '2027-03-15', description: 'Anketa', supplier: 'Agencija d.o.o.', amount: 250_000, evidenceRef: 'R-17/2027' }).expect(201);
    manualExpense = e.body.id;
    const upd = await http().patch(`/api/projects/${pid}/expenses/${manualExpense}`).set(auth(A)).send({ amount: 200_000 }).expect(200);
    expect(upd.body.amount).toBe(200_000);
    const tmp = await http().post(`/api/projects/${pid}/expenses`).set(auth(A)).send({ categoryCode: 'PUT', date: '2027-04-02', description: 'Put', amount: 30_000 }).expect(201);
    await http().delete(`/api/projects/${pid}/expenses/${tmp.body.id}`).set(auth(A)).expect(200);
    await http().post(`/api/projects/${pid}/expenses`).set(auth(A)).send({ categoryCode: 'PUT', date: '2027-08-10', description: 'Put RP2', amount: 50_000 }).expect(201);
  });

  it('ZNS za RP1: nacrt prikazuje prihvatljive troškove, izračun (neizravni 15 % osoblja) i popis za provjeru; dupli ZNS 409', async () => {
    const c = await http().post(`/api/projects/${pid}/claims`).set(auth(A)).send({ period: 1 }).expect(201);
    claim1 = c.body.id;
    expect(c.body.status).toBe('draft');
    expect(c.body.expenses).toHaveLength(3); // 2 osoblje + anketa; put iz RP2 nije u razdoblju
    expect(c.body.totals).toMatchObject({ direct: 234_000, indirect: 5_100, total: 239_100, requested: 239_100 });
    // Troškovi osoblja nose osobu, mjesec i radni paket (grupiranje u prikazu).
    expect(c.body.expenses.filter((e: Exp & { person: string }) => e.source === 'timesheet').map((e: Exp & { person: string; month: string }) => `${e.person}|${e.month}|${e.workPackage}`).sort()).toEqual(['Ivana Horvat|2027-02|WP1', 'Ivana Horvat|2027-02|null']);
    const keys = Object.fromEntries((c.body.checklist.items as { key: string; ok: boolean }[]).map((i) => [i.key, i.ok]));
    expect(keys).toEqual({ period_ended: true, has_expenses: true, timesheets_approved: true, evidence: false, dates_in_period: true, budget: true });
    expect(c.body.checklist.canSubmit).toBe(false);
    await http().post(`/api/projects/${pid}/claims`).set(auth(A)).send({ period: 1 }).expect(409);
  });

  it('predaja se odbija dok popis za provjeru ima blokirajuće stavke: neodobren timesheet, trošak bez dokaza', async () => {
    // Marko ima predan, neodobren timesheet za ožujak → trošak osoblja nedostaje.
    await http().put(`/api/projects/${pid}/team/${marko}/timesheets/2027-03`).set(auth(A)).send({ entries: [{ day: 1, minutes: 60, workPackageId: wp1 }] }).expect(200);
    await http().post(`/api/projects/${pid}/team/${marko}/timesheets/2027-03/submit`).set(auth(A)).expect(201);
    const r = await http().post(`/api/projects/${pid}/claims/${claim1}/submit`).set(auth(A)).send({ acknowledgeWithoutEvidence: [manualExpense] }).expect(409);
    expect(r.body.issues).toEqual([expect.stringMatching(/1 timesheet nije odobren.*Marko Kovač, 2027-03 \(čeka odobrenje, 1 h\)/)]);
    // Povrat u nacrt i dalje blokira (nacrt sa satima); prazan nacrt se ne broji.
    await http().post(`/api/projects/${pid}/team/${marko}/timesheets/2027-03/reopen`).set(auth(A)).expect(201);
    expect((await http().get(`/api/projects/${pid}/claims/${claim1}`).set(auth(A))).body.checklist.items.find((i: { key: string }) => i.key === 'timesheets_approved').details).toEqual(['Marko Kovač, 2027-03 (nacrt, 1 h)']);
    await http().put(`/api/projects/${pid}/team/${marko}/timesheets/2027-03`).set(auth(A)).send({ entries: [] }).expect(200);
    // Bez potvrde troška bez dokaza: 409 s popisom troška.
    const ev = await http().post(`/api/projects/${pid}/claims/${claim1}/submit`).set(auth(A)).send({}).expect(409);
    expect(ev.body.issues).toEqual([expect.stringMatching(/nema dokaz.*Anketa \(2\.000,00 EUR\)/)]);
    await http().post(`/api/projects/${pid}/claims/${claim1}/submit`).set(auth(A)).send({ acknowledgeWithoutEvidence: ['nije-uuid'] }).expect(400);
  });

  it('predaja s potvrdom troška bez dokaza: zapisana uz zahtjev i u reviziji; troškovi, timesheet i dokazi zaključani', async () => {
    const s = await http().post(`/api/projects/${pid}/claims/${claim1}/submit`).set(auth(A)).send({ acknowledgeWithoutEvidence: [manualExpense] }).expect(201);
    expect(s.body).toMatchObject({ status: 'submitted', requested: 239_100, earlyReason: null });
    expect(s.body.submission).toMatchObject({ early: false, acknowledgedWithoutEvidence: [expect.objectContaining({ id: manualExpense, description: 'Anketa', amount: 200_000 })] });
    expect(s.body.submission.warnings.map((w: { key: string }) => w.key)).toEqual(['evidence']);
    const audit = (await owner.query(`select action, diff from audit_entries where entity = 'claim' and entity_id = $1 and action like 'submit%'`, [claim1])).rows;
    expect(audit).toEqual([expect.objectContaining({ action: 'submit', diff: expect.objectContaining({ meta: expect.objectContaining({ acknowledgedWithoutEvidence: [manualExpense] }) }) })]);
    await http().patch(`/api/projects/${pid}/expenses/${manualExpense}`).set(auth(A)).send({ amount: 1 }).expect(409);
    const ts = await http().get(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02`).set(auth(A)).expect(200);
    expect(ts.body.status).toBe('locked');
    await http().post(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02/reopen`).set(auth(A)).expect(409);
    await http().post('/api/documents').set(auth(A)).field({ entityType: 'expense', entityId: manualExpense, kind: 'evidence' }).attach('file', PDF, 'racun.pdf').expect(409);
  });

  it('povrat na dopunu: troškovi, timesheet i dokazi se otključavaju; ponovna predaja ponovno prolazi popis za provjeru', async () => {
    await http().post(`/api/projects/${pid}/claims/${claim1}/decision`).set(auth(A)).send({ decision: 'returned' }).expect(400); // razlog obavezan
    const r = await http().post(`/api/projects/${pid}/claims/${claim1}/decision`).set(auth(A)).send({ decision: 'returned', note: 'Nedostaje račun' }).expect(201);
    expect(r.body).toMatchObject({ status: 'draft', note: 'Nedostaje račun', submission: null });
    expect(r.body.checklist.items.find((i: { key: string }) => i.key === 'evidence').ok).toBe(false); // potvrda iz prve predaje ne vrijedi
    expect((await http().get(`/api/projects/${pid}/team/${ivana}/timesheets/2027-02`).set(auth(A))).body.status).toBe('approved');
    await http().post('/api/documents').set(auth(A)).field({ entityType: 'expense', entityId: manualExpense, kind: 'evidence', title: 'Račun R-17/2027' }).attach('file', PDF, 'racun.pdf').expect(201);
    const again = await http().post(`/api/projects/${pid}/claims/${claim1}/submit`).set(auth(A)).send({}).expect(201);
    expect(again.body.submission).toMatchObject({ early: false, acknowledgedWithoutEvidence: [], warnings: [] });
    expect(again.body.note).toBeNull();
  });

  it('odluka: neispravni unosi 400 (datum, razlog, iznos, razlika bez napomene); ništa se ne mijenja', async () => {
    const os = (await http().get(`/api/projects/${pid}/claims/${claim1}`).set(auth(A))).body.expenses as Exp[];
    const noWp = os.find((e) => e.source === 'timesheet' && !e.workPackage)!;
    await http().post(`/api/projects/${pid}/claims/${claim1}/decision`).set(auth(A)).send({ decision: 'decided', decisionDate: '2027-07-21' }).expect(400); // u budućnosti
    await http().post(`/api/projects/${pid}/claims/${claim1}/decision`).set(auth(A)).send({ decision: 'decided', decisionDate: '2027-07-19' }).expect(400); // prije predaje
    const noReason = await http().post(`/api/projects/${pid}/claims/${claim1}/decision`).set(auth(A)).send({ decision: 'decided', expenses: [{ id: manualExpense, recognised: 150_000 }] }).expect(400);
    expect(noReason.body.issues[0]).toMatch(/razlog je obavezan/);
    await http().post(`/api/projects/${pid}/claims/${claim1}/decision`).set(auth(A)).send({ decision: 'decided', expenses: [{ id: noWp.id, recognised: noWp.amount + 1, reason: 'previše' }] }).expect(400);
    const diff = await http().post(`/api/projects/${pid}/claims/${claim1}/decision`).set(auth(A)).send({ decision: 'decided', funderTotal: 200_000 }).expect(400);
    expect(diff.body.issues[0]).toMatch(/razlikuje se od izračunatog/);
    await http().post(`/api/projects/${pid}/claims/${claim1}/decision`).set(auth(A)).send({ decision: 'partially_approved', approvedAmount: 220_000 }).expect(400); // stari oblik više ne postoji
    expect((await http().get(`/api/projects/${pid}/claims/${claim1}`).set(auth(A))).body.status).toBe('submitted');
  });

  it('odluka po trošku: umanjen i odbijen trošak s razlozima; priznato istim izračunom; djelomično odobren', async () => {
    const os = (await http().get(`/api/projects/${pid}/claims/${claim1}`).set(auth(A))).body.expenses as Exp[];
    const noWp = os.find((e) => e.source === 'timesheet' && !e.workPackage)!;
    // Pregled bez spremanja: isti izračun kao odluka; greške vraćene, ne bačene.
    const pv = await http().post(`/api/projects/${pid}/claims/${claim1}/decision/preview`).set(auth(A)).send({ expenses: [{ id: manualExpense, recognised: 150_000 }, { id: noWp.id, recognised: 0, reason: 'Rad bez radnog paketa nije prihvatljiv' }], funderTotal: 184_000 }).expect(201);
    expect(pv.body).toMatchObject({ computed: 184_500, approved: 184_000, difference: -500, outcome: 'partially_approved' });
    expect(pv.body.errors).toHaveLength(2); // razlog uz anketu, napomena uz razliku
    expect((await http().get(`/api/projects/${pid}/claims/${claim1}`).set(auth(A))).body.status).toBe('submitted');
    const d = await http().post(`/api/projects/${pid}/claims/${claim1}/decision`).set(auth(A)).send({ decision: 'decided', expenses: [
      { id: manualExpense, recognised: 150_000, reason: 'Priznata cijena prema tržišnoj provjeri' },
      { id: noWp.id, recognised: 0, reason: 'Rad bez radnog paketa nije prihvatljiv' },
    ] }).expect(201);
    // Priznato: OS 30.000 + VU 150.000 = 180.000 izravno, neizravni 15 % od 30.000 = 4.500 → 184.500
    expect(d.body).toMatchObject({ status: 'partially_approved', approved: 184_500, requested: 239_100, decisionDate: '2027-07-20' });
    expect(d.body.recognised).toMatchObject({ direct: 180_000, indirect: 4_500, total: 184_500, requested: 184_500 });
    expect(d.body.unrecognised).toEqual({ direct: 54_000, indirect: 600, total: 54_600, requested: 54_600 });
    expect(d.body.decision).toMatchObject({ computed: 184_500, funderTotal: null, difference: 0 });
    const st = Object.fromEntries((d.body.expenses as Exp[]).map((e) => [e.id === manualExpense ? 'VU' : e.workPackage ? 'OS-WP1' : 'OS-bez', `${e.status}|${e.recognised}`]));
    expect(st).toEqual({ VU: 'partially_accepted|150000', 'OS-WP1': 'accepted|30000', 'OS-bez': 'rejected|0' });
    expect((d.body.expenses as (Exp & { decisionReason: string })[]).find((e) => e.id === manualExpense)!.decisionReason).toBe('Priznata cijena prema tržišnoj provjeri');
    await http().post(`/api/projects/${pid}/claims/${claim1}/decision`).set(auth(A)).send({ decision: 'decided' }).expect(409); // već odlučeno
    // Dokazi odlučenih troškova (i umanjenih i odbijenih) ostaju zamrznuti.
    await http().post('/api/documents').set(auth(A)).field({ entityType: 'expense', entityId: manualExpense, kind: 'evidence' }).attach('file', Buffer.from('%PDF-1.7\nnovi\n%%EOF\n'), 'novi.pdf').expect(409);
  });

  it('ostvareno je isto u zahtjevu, pregledu financija i portfelju; nepriznato zasebno', async () => {
    const c = (await http().get(`/api/projects/${pid}/claims/${claim1}`).set(auth(A))).body;
    const o = (await http().get(`/api/projects/${pid}/finance`).set(auth(A)).expect(200)).body;
    expect(o.budgetStatus).toBe('locked');
    expect(o.byCategory.find((x: { code: string }) => x.code === 'OS')).toMatchObject({ planned: 2_000_000, actual: 30_000, unrecognised: 4_000, remaining: 1_970_000, percent: 2 });
    expect(o.byCategory.find((x: { code: string }) => x.code === 'VU')).toMatchObject({ planned: 1_000_000, actual: 150_000, unrecognised: 50_000, percent: 15 });
    // Ostvareno = priznato iz ZNS-a 1 + put iz RP2 (50.000, još bez odluke, traženi iznos).
    expect(o.actual.direct).toBe(c.recognised.direct + 50_000);
    expect(o.actual.total).toBe(c.recognised.total + 50_000);
    expect(o.unrecognised).toEqual(c.unrecognised);
    expect(o.claims).toEqual([expect.objectContaining({ period: 1, status: 'partially_approved', requested: 239_100, approved: 184_500, paid: null })]);
    const pf = (await http().get('/api/portfolio').set(auth(A)).expect(200)).body;
    const row = pf.projects.find((x: { id: string }) => x.id === pid);
    expect(row.budget).toMatchObject({ actual: o.actual.total, unrecognised: o.unrecognised.total, planned: o.planned.total });
  });

  it('nepromjenjivost na razini baze: aplikacijska uloga ne mijenja priznati iznos ni odlučen trošak; ispravak samo najavljen i revidiran', async () => {
    await http().delete(`/api/projects/${pid}/expenses/${manualExpense}`).set(auth(A)).expect(409);
    const app2 = new Pool({ connectionString: APP_URL, max: 1 });
    const c = await app2.connect();
    const tid = (await owner.query(`select tenant_id from expenses where id = $1`, [manualExpense])).rows[0].tenant_id as string;
    try {
      const attempt = async (q: string, params: unknown[], correction?: string) => {
        await c.query('begin');
        try {
          await c.query(`select set_config('app.tenant_id', $1, true)`, [tid]);
          if (correction) await c.query(`select set_config('app.claim_correction', $1, true)`, [correction]);
          await c.query(q, params);
          const n = (await c.query(`select count(*)::int as n from audit_entries where entity_id = $1 and action = 'recognition.correct'`, [manualExpense])).rows[0].n as number;
          return { ok: true, audit: n };
        } catch (e) { return { ok: false, error: (e as Error).message }; } finally { await c.query('rollback'); }
      };
      expect(await attempt(`update expenses set recognised_cents = 200000, status = 'accepted' where id = $1`, [manualExpense])).toMatchObject({ ok: false, error: expect.stringMatching(/nepromjenjiv/) });
      expect(await attempt(`update expenses set amount_cents = 1 where id = $1`, [manualExpense])).toMatchObject({ ok: false, error: expect.stringMatching(/nepromjenjiv/) });
      expect(await attempt(`delete from expenses where id = $1`, [manualExpense])).toMatchObject({ ok: false, error: expect.stringMatching(/nepromjenjiv/) });
      // Najava za DRUGI zahtjev ne otključava; najava za ovaj otključava samo priznati iznos, razlog i status – i okidač sam upisuje reviziju.
      expect(await attempt(`update expenses set recognised_cents = 200000, status = 'accepted' where id = $1`, [manualExpense], randomUUID())).toMatchObject({ ok: false });
      expect(await attempt(`update expenses set amount_cents = 1 where id = $1`, [manualExpense], claim1)).toMatchObject({ ok: false, error: expect.stringMatching(/nepromjenjiv/) });
      expect(await attempt(`update expenses set recognised_cents = 300000 where id = $1`, [manualExpense], claim1)).toMatchObject({ ok: false, error: expect.stringMatching(/expenses_decision_ck/) });
      expect(await attempt(`update expenses set recognised_cents = 200000, status = 'accepted', decision_reason = null where id = $1`, [manualExpense], claim1)).toEqual({ ok: true, audit: 1 });
    } finally { c.release(); await app2.end(); }
  });

  it('ispravak odluke: obavezan razlog, revizija iz baze i aplikacije; nakon isplate nije moguć', async () => {
    const os = (await http().get(`/api/projects/${pid}/claims/${claim1}`).set(auth(A))).body.expenses as Exp[];
    const noWp = os.find((e) => e.source === 'timesheet' && !e.workPackage)!;
    await http().post(`/api/projects/${pid}/claims/${claim1}/decision/correction`).set(auth(A)).send({ expenses: [{ id: noWp.id, recognised: 4_000 }] }).expect(400);
    // Nakon prigovora priznat je i rad bez radnog paketa: OS 34.000 → neizravni 5.100; priznato 189.100.
    const k = await http().post(`/api/projects/${pid}/claims/${claim1}/decision/correction`).set(auth(A)).send({ expenses: [{ id: noWp.id, recognised: 4_000 }], note: 'Prigovor prihvaćen (dopis PT-a 2027-07-20)' }).expect(201);
    expect(k.body).toMatchObject({ status: 'partially_approved', approved: 189_100, recognised: { total: 189_100 }, note: 'Prigovor prihvaćen (dopis PT-a 2027-07-20)' });
    expect((k.body.expenses as Exp[]).find((e) => e.id === noWp.id)).toMatchObject({ status: 'accepted', recognised: 4_000 });
    expect((k.body.expenses as Exp[]).find((e) => e.id === manualExpense)).toMatchObject({ status: 'partially_accepted', recognised: 150_000 }); // nenavedeni ostaje kako je odlučen
    const audit = (await owner.query(`select action, actor_type from audit_entries where entity_id in ($1, $2) and action in ('recognition.correct', 'decision.correct') order by id`, [noWp.id, claim1])).rows;
    expect(audit).toEqual([{ action: 'recognition.correct', actor_type: 'system' }, { action: 'decision.correct', actor_type: 'user' }]);
  });

  it('isplata: datum ne prije odluke ni u budućnosti; razlika prema odobrenom traži napomenu', async () => {
    const pay = (body: Record<string, unknown>) => http().post(`/api/projects/${pid}/claims/${claim1}/payment`).set(auth(A)).send(body);
    expect((await pay({ paidAmount: 189_100, paidAt: '2027-07-19' }).expect(400)).body.issues[0]).toMatch(/prije datuma odluke/);
    expect((await pay({ paidAmount: 189_100, paidAt: '2027-07-21' }).expect(400)).body.issues[0]).toMatch(/u budućnosti/);
    expect((await pay({ paidAmount: 180_000, paidAt: '2027-07-20' }).expect(400)).body.issues[0]).toMatch(/razlikuje se od odobrenog/);
    await pay({ paidAmount: 200_000, paidAt: '2027-07-20' }).expect(400);
    const paid = await pay({ paidAmount: 189_000, paidAt: '2027-07-20', note: 'Umanjeno za bankovnu naknadu' }).expect(201);
    expect(paid.body).toMatchObject({ paid: 189_000, paidAt: '2027-07-20', paymentNote: 'Umanjeno za bankovnu naknadu' });
    await pay({ paidAmount: 189_100, paidAt: '2027-07-20' }).expect(409); // već zabilježena
    await http().post(`/api/projects/${pid}/claims/${claim1}/decision/correction`).set(auth(A)).send({ expenses: [], note: 'Kasni ispravak' }).expect(409);
  });

  it('ZNS za RP2 (razdoblje traje): rana predaja samo s razlogom; razlog vidljiv na zahtjevu i u reviziji', async () => {
    const c = (await http().post(`/api/projects/${pid}/claims`).set(auth(A)).send({ period: 2 }).expect(201)).body;
    const period = c.checklist.items.find((i: { key: string }) => i.key === 'period_ended');
    expect(period).toMatchObject({ ok: false, severity: 'blocking', resolution: 'early_reason' });
    const put = (c.expenses as Exp[])[0]!.id;
    const no = await http().post(`/api/projects/${pid}/claims/${c.id}/submit`).set(auth(A)).send({ acknowledgeWithoutEvidence: [put] }).expect(409);
    expect(no.body.issues[0]).toMatch(/Razdoblje još traje/);
    await http().post(`/api/projects/${pid}/claims/${c.id}/submit`).set(auth(A)).send({ earlyReason: 'ok', acknowledgeWithoutEvidence: [put] }).expect(409);
    const s = await http().post(`/api/projects/${pid}/claims/${c.id}/submit`).set(auth(A)).send({ earlyReason: 'Projekt se završava ranije prema aneksu ugovora', acknowledgeWithoutEvidence: [put] }).expect(201);
    expect(s.body).toMatchObject({ status: 'submitted', earlyReason: 'Projekt se završava ranije prema aneksu ugovora', submission: { early: true } });
    expect(s.body.submission.warnings.map((w: { key: string }) => w.key)).toEqual(['period_ended', 'evidence', 'budget']); // PUT nije u proračunu – upozorenje, ne blokada
    const audit = (await owner.query(`select action, diff from audit_entries where entity = 'claim' and entity_id = $1 and action like 'submit%'`, [c.id])).rows;
    expect(audit).toEqual([expect.objectContaining({ action: 'submit.early', diff: expect.objectContaining({ meta: expect.objectContaining({ earlyReason: 'Projekt se završava ranije prema aneksu ugovora' }) }) })]);
    // Odbijanje cijelog zahtjeva: svi troškovi odbijeni s razlogom, ostvareno 0 za te troškove.
    const r = await http().post(`/api/projects/${pid}/claims/${c.id}/decision`).set(auth(A)).send({ decision: 'decided', expenses: [{ id: put, recognised: 0, reason: 'Putovanje nije u planu rada' }] }).expect(201);
    expect(r.body).toMatchObject({ status: 'rejected', approved: 0, recognised: { total: 0 }, unrecognised: { total: 50_000 } });
    await http().post(`/api/projects/${pid}/claims/${c.id}/payment`).set(auth(A)).send({ paidAmount: 0, paidAt: '2027-07-20' }).expect(409);
    const o = (await http().get(`/api/projects/${pid}/finance`).set(auth(A)).expect(200)).body;
    expect(o.actual.direct).toBe(184_000); // 34.000 + 150.000; put odbijen = 0
    expect(o.unrecognised.direct).toBe(100_000); // anketa 50.000 + put 50.000
  });

  it('izolacija: stanar B nema pristup timu, troškovima, ZNS-ovima ni pregledu', async () => {
    await http().get(`/api/projects/${pid}/team`).set(auth(B)).expect(404);
    await http().get(`/api/projects/${pid}/expenses`).set(auth(B)).expect(404);
    await http().get(`/api/projects/${pid}/claims/${claim1}`).set(auth(B)).expect(404);
    await http().get(`/api/projects/${pid}/finance`).set(auth(B)).expect(404);
    await http().post(`/api/projects/${pid}/expenses`).set(auth(B)).send({ categoryCode: 'VU', date: '2027-03-01', description: 'Upad', amount: 1 }).expect(404);
  });
});
