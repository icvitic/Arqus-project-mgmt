import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';
import { buildXlsx, type Cell } from '../src/export/xlsx-writer';
import { readXlsx } from '../src/import/xlsx-reader';
import { AuditService } from '../src/audit/audit.service';
import { readSheet, readZip } from './zip-reader';

/**
 * WP1.17 – uvoz postojećeg projekta iz Excela (e2e): predložak i povratno putovanje, svaki list s greškama po retku,
 * atomičnost, isti bajtovi (SHA-256, revizija projekta, otisak plana), troškovi potraživani izvan sustava (ostvareno, ZNS,
 * troškovi iz ranijih razdoblja, skrivanje plaća, paket ZNS-a, portfelj), dozvole po listu, poništavanje i svaka prepreka,
 * 404 za tuđi projekt, ograničenje učestalosti, stvarne datoteke iz LibreOfficea i openpyxl-a.
 * Projekti: paket NPOO (razdoblja od 3 mjeseca), početak 1. 1. 2026., 24 mjeseca – RP1–RP3 su završila.
 */
const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
const FIX = join(__dirname, 'fixtures', 'import');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
type Rows = Record<string, (string | number | boolean | null)[]>[];
interface Plan {
  sha256: string; projectRevision: number; fingerprint: string; errors: number; warnings: number; canConfirm: boolean; needsAcknowledge: boolean; permissions: string[];
  sheets: { key: string; name: string | null; status: string; reason: string | null; rowsRead: number; rowsValid: number; created: number; updated: number; unchanged: number;
    errors: { sheet: string; row: number | null; column: string | null; value: string | null; message: string }[]; warnings: { row: number | null; message: string }[]; items: { row: number; action: string; text: string; historic?: boolean }[] }[];
}

describe('Uvoz postojećeg projekta iz Excela (WP1.17, e2e)', () => {
  let app: INestApplication;
  const tag = randomUUID().slice(0, 8); const slug = `ui-${tag}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const PW = 'Plava-Staza-2027-x';
  const login = async (email: string, pw = PW) => (await http().post('/api/auth/login').send({ tenantSlug: slug, email, password: pw }).expect(201)).body.accessToken as string;
  const owner = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const t: Record<string, string> = {}; const u: Record<string, string> = {};
  let partnerOrg = '';

  const download = (url: string, token: string) => http().get(url).set(auth(token)).buffer(true)
    .parse((res, cb) => { const parts: Buffer[] = []; res.on('data', (c: Buffer) => parts.push(c)); res.on('end', () => cb(null, Buffer.concat(parts))); });
  /** Radna knjiga: list → retci (prvi redak su nazivi stupaca, kao u predlošku). */
  const book = (sheets: Record<string, Cell[][]>) => buildXlsx({ sheets: Object.entries(sheets).map(([name, rows]) => ({ name, rows })) });
  /** Retci kao objekti (naziv stupca → vrijednost) → list s retkom zaglavlja. */
  const sheetOf = (headers: string[], rows: Rows): Cell[][] => [headers, ...rows.map((r) => headers.map((h) => { const v = r[h.replace(/ \*$/, '')]; return v === true ? 'DA' : v === false ? 'NE' : (v ?? null) as Cell; }))];
  const preview = (pid: string, file: Buffer, token: string, name = 'uvoz.xlsx', fields: Record<string, string> = {}) =>
    http().post(`/api/projects/${pid}/import/preview`).set(auth(token)).field(fields).attach('file', file, name);
  const confirm = (pid: string, file: Buffer, plan: Plan, token: string, extra: Record<string, string> = {}, name = 'uvoz.xlsx') =>
    http().post(`/api/projects/${pid}/import/confirm`).set(auth(token)).field({ sha256: plan.sha256, revision: String(plan.projectRevision), fingerprint: plan.fingerprint, acknowledgeWarnings: 'true', ...extra }).attach('file', file, name);
  const sheet = (p: Plan, key: string) => p.sheets.find((s) => s.key === key)!;
  const project = async (acronym: string, opts: { active?: boolean; manager?: string; partner?: boolean } = {}) => {
    const p = (await http().post('/api/projects').set(auth(t.admin!)).send({ acronym, title: `Projekt ${acronym}`, packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA', contractNo: `UG-${acronym}-${tag}`, startDate: '2026-01-01', durationMonths: 24,
      ...(opts.manager ? { managerUserId: opts.manager } : {}), partners: opts.partner ? [{ organisationId: partnerOrg, role: 'partner' }] : [] }).expect(201)).body;
    if (opts.active) await http().post(`/api/projects/${p.id}/transition`).set(auth(t.admin!)).send({ to: 'active' }).expect(201);
    return { id: p.id as string, self: p.partners.find((x: { isSelf: boolean }) => x.isSelf).id as string, selfName: p.partners.find((x: { isSelf: boolean }) => x.isSelf).name as string };
  };
  const get = async (url: string, token = t.office!) => (await http().get(url).set(auth(token)).expect(200)).body;
  const importOk = async (pid: string, file: Buffer, token = t.office!, name = 'uvoz.xlsx', fields: Record<string, string> = {}) => {
    const plan = (await preview(pid, file, token, name, fields).expect(201)).body as Plan;
    expect(plan.errors, JSON.stringify(plan.sheets.flatMap((s) => s.errors))).toBe(0);
    const r = (await confirm(pid, file, plan, token, fields, name).expect(201)).body as { importId: string; counts: Record<string, { created: number }> };
    return { plan, result: r };
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = APP_URL;
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), 'arqus-uvoz-'));
    process.env.EXPORT_RATE_MAX = '60';
    await seedDemo({ url: ADMIN_URL, tenantSlug: slug, adminEmail: `a@${slug}.hr`, adminPassword: 'Lozinka-123456' });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    t.admin = await login(`a@${slug}.hr`, 'Lozinka-123456');
    const mk = async (local: string, roleCodes: string[]) => { u[local] = (await http().post('/api/users').set(auth(t.admin!)).send({ email: `${local}@${slug}.hr`, displayName: `Korisnik ${local}`, password: PW, roleCodes }).expect(201)).body.id; t[local] = await login(`${local}@${slug}.hr`); };
    await mk('office', ['project-office']); await mk('fin', ['finance']); await mk('rdr', ['reader']); await mk('pm', []); await mk('tm', []); await mk('lim', ['project-office']);
    partnerOrg = (await http().post('/api/organisations').set(auth(t.admin!)).send({ name: 'Razvojna agencija Sjever', shortName: 'RAS', country: 'HR', type: 'public_body' }).expect(201)).body.id;
  }, 60_000);
  afterAll(async () => { delete process.env.EXPORT_RATE_MAX; await app.close(); await owner.end(); });

  it('predložak: listovi, šifarnik projekta, padajući popisi; bez prava na plaće nema stupca godišnjeg troška', async () => {
    const p = await project(`TPL${tag.slice(0, 3)}`, { partner: true, manager: u.pm });
    await http().post(`/api/projects/${p.id}/work-packages`).set(auth(t.admin!)).send({ title: 'Postojeći radni paket', startMonth: 1, endMonth: 12 }).expect(201);
    const r = await download(`/api/projects/${p.id}/import/template`, t.office!).expect(200);
    expect(r.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(String(r.headers['content-disposition'])).toMatch(/Uvoz_TPL.*_predlozak\.xlsx/);
    const wb = readXlsx(r.body as Buffer, () => true);
    expect(wb.sheets.map((s) => s.name)).toEqual(['Upute', 'Radni paketi', 'Isporuke', 'Prekretnice', 'Proračun', 'Tim', 'Troškovi', 'Šifarnik']);
    const header = (name: string) => wb.sheets.find((s) => s.name === name)!.rows[0]!.cells.map((c) => (c && c.t === 's' ? c.v : ''));
    expect(header('Tim')).toContain('Godišnji trošak (EUR)');
    expect(header('Troškovi')).toEqual(expect.arrayContaining(['Datum *', 'Kategorija *', 'Iznos (EUR) *', 'Potraživano izvan sustava', 'Priznati iznos (EUR)', 'Osoba']));
    const ref = JSON.stringify(wb.sheets.find((s) => s.name === 'Šifarnik')!.rows);
    for (const v of ['RAS', p.selfName, 'VU', 'Vanjske usluge', 'WP1', 'Postojeći radni paket', 'ISP', 'JAV']) expect(ref).toContain(v);
    // Padajući popisi pokazuju na šifarnik (provjera podataka u XML-u lista).
    const files = new Map(readZip(r.body as Buffer).map((e) => [e.name, e.data.toString('utf8')]));
    expect(files.get('xl/worksheets/sheet7.xml')).toMatch(/<dataValidation type="list"[^>]*><formula1>&quot;DA,NE&quot;<\/formula1>/);
    expect(files.get('xl/worksheets/sheet7.xml')).toContain("'Šifarnik'!$E$2:$E$8");
    // Voditelj projekta (bez personnel:read) dobiva predložak bez stupca godišnjeg troška.
    const pm = readXlsx((await download(`/api/projects/${p.id}/import/template`, t.pm!).expect(200)).body as Buffer, () => true);
    expect(pm.sheets.find((s) => s.name === 'Tim')!.rows[0]!.cells.map((c) => (c && c.t === 's' ? c.v : ''))).not.toContain('Godišnji trošak (EUR)');
  });

  it('povratno putovanje: popunjen predložak u ugovaranju (bez troškova), pa nakon aktivacije isti predložak s troškovima', async () => {
    const p = await project(`RT${tag.slice(0, 4)}`, { partner: true });
    const tpl = (await download(`/api/projects/${p.id}/import/template`, t.office!).expect(200)).body as Buffer;
    // Popunjavanje predloška: nazivi stupaca iz preuzetog predloška, podaci programski.
    const wb = readXlsx(tpl, () => true);
    const heads = (name: string) => wb.sheets.find((s) => s.name === name)!.rows[0]!.cells.map((c) => (c && c.t === 's' ? c.v : ''));
    const filled = await book({
      'Radni paketi': sheetOf(heads('Radni paketi'), [{ Broj: 1, Naziv: 'Upravljanje', 'Početni mjesec': 1, 'Završni mjesec': 24, Nositelj: p.selfName }, { Broj: 2, Naziv: 'Istraživanje', 'Početni mjesec': 'M3', 'Završni mjesec': 'M18', Nositelj: 'RAS' }]),
      Isporuke: sheetOf(heads('Isporuke'), [{ 'Radni paket': 'WP2', Naziv: 'Izvještaj o mjerenjima', Vrsta: 'ISP', 'Razina diseminacije': 'JAV', 'Mjesec isporuke': 12 }]),
      Prekretnice: sheetOf(heads('Prekretnice'), [{ Naziv: 'Laboratorij otvoren', Mjesec: 9, 'Način provjere': 'Zapisnik' }]),
      'Proračun': sheetOf(heads('Proračun'), [
        { Partner: p.selfName, Kategorija: 'OS', 'Iznos (EUR)': '60.000,00' }, { Partner: p.selfName, Kategorija: 'VU – Vanjske usluge', 'Radni paket': 2, 'Iznos (EUR)': 20000 },
        { Partner: 'RAS', Kategorija: 'PV', 'Iznos (EUR)': 5000.5 }, { Partner: 'RAS', Kategorija: 'PUT' /* bez iznosa: preskače se */ },
      ]),
      Tim: sheetOf(heads('Tim'), [{ 'Ime i prezime': 'Ivana Kovač', Uloga: 'istraživačica', 'Godišnji trošak (EUR)': 36000, 'E-adresa korisnika': `tm@${slug}.hr` }, { 'Ime i prezime': 'Marko Babić', Partner: 'RAS', 'Godišnji trošak (EUR)': 28800 }]),
      'Troškovi': sheetOf(heads('Troškovi'), [
        { Datum: '10.02.2026.', Kategorija: 'VU', 'Radni paket': 2, Opis: 'Elaborat energetskog pregleda', Dobavljač: 'Energo-plan d.o.o.', 'Iznos (EUR)': '1.234,56', 'Dokaz (broj računa)': 'R-88/2026', 'Potraživano izvan sustava': true, 'Razdoblje / ZNS': 'ZNS 1 – RP1', 'Priznati iznos (EUR)': 1000, 'Razlog umanjenja': 'Priznato do iznosa iz ugovora' },
        { Datum: '2026-02-28', Kategorija: 'OS', 'Iznos (EUR)': 3000, 'Potraživano izvan sustava': 'DA', 'Razdoblje / ZNS': 'ZNS 1 – RP1', Osoba: 'Ivana Kovač' },
        { Datum: '15.03.2026', Kategorija: 'PUT', Opis: 'Putovanje na sastanak', 'Iznos (EUR)': 86.5, 'Potraživano izvan sustava': 'da' },
        { Datum: '05.08.2026.', Kategorija: 'VU', Opis: 'Kalibracija senzora', 'Iznos (EUR)': 1250, 'Dokaz (broj računa)': 'R-655/2026' },
      ]),
    });
    // 1) U ugovaranju: troškovi se odbijaju s jasnim razlogom; sve ostalo je valjano.
    let plan = (await preview(p.id, filled, t.office!).expect(201)).body as Plan;
    expect(sheet(plan, 'expenses')).toMatchObject({ status: 'rejected', reason: expect.stringMatching(/dok je projekt aktivan.*u ugovaranju/) });
    expect(plan.canConfirm).toBe(false);
    for (const k of ['workPackages', 'deliverables', 'milestones', 'budget', 'team']) expect(sheet(plan, k).errors).toEqual([]);
    // Izostavljanje lista je izričito (ne tiho preskakanje).
    plan = (await preview(p.id, filled, t.office!, 'uvoz.xlsx', { skip: 'expenses' }).expect(201)).body as Plan;
    expect(sheet(plan, 'expenses').status).toBe('skipped');
    expect(plan).toMatchObject({ errors: 0, canConfirm: true });
    expect(sheet(plan, 'budget')).toMatchObject({ created: 3, rowsRead: 4 });
    expect(sheet(plan, 'workPackages').items.map((i) => i.text)).toEqual(['WP1 Upravljanje (M1–M24)', 'WP2 Istraživanje (M3–M18)']);
    expect(sheet(plan, 'deliverables').items[0]!.text).toBe('D2.1 Izvještaj o mjerenjima (M12, ISP/JAV)');
    // Pregled ništa ne sprema.
    expect((await get(`/api/projects/${p.id}/structure`)).workPackages).toEqual([]);
    const applied = (await confirm(p.id, filled, plan, t.office!, { skip: 'expenses' }).expect(201)).body;
    expect(applied.counts).toMatchObject({ workPackages: { created: 2 }, deliverables: { created: 1 }, milestones: { created: 1 }, budget: { created: 3 }, team: { created: 2 } });
    expect(applied.links.map((l: { tab: string }) => l.tab)).toEqual(['struktura', 'struktura', 'struktura', 'proracun', 'tim']);
    const st = await get(`/api/projects/${p.id}/structure`);
    expect(st.workPackages.map((w: { code: string; leadPartnerId: string }) => w.code)).toEqual(['WP1', 'WP2']);
    expect(st.workPackages[1].deliverables[0].code).toBe('D2.1');
    expect(st.milestones[0]).toMatchObject({ code: 'MS1', title: 'Laboratorij otvoren', verification: 'Zapisnik' });
    const budget = await get(`/api/projects/${p.id}/budget`);
    expect(budget).toMatchObject({ status: 'draft', revision: 2 });
    expect(budget.lines.map((l: { categoryCode: string; amount: number }) => `${l.categoryCode}:${l.amount}`).sort()).toEqual(['OS:6000000', 'PV:500050', 'VU:2000000']);
    const team = await get(`/api/projects/${p.id}/team`);
    expect(team.map((m: { fullName: string; annualCost: number }) => `${m.fullName}:${m.annualCost}`)).toEqual(['Ivana Kovač:3600000', 'Marko Babić:2880000']);
    // Član tima povezan s korisnikom dobiva pristup projektu (kao ručno dodavanje).
    await http().get(`/api/projects/${p.id}`).set(auth(t.tm!)).expect(200);
    // Jedan revizijski zapis za cijeli uvoz.
    const audit = (await owner.query(`select action, diff from audit_entries where entity = 'project_import' and entity_id = $1`, [applied.importId])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].diff.meta).toMatchObject({ projectId: p.id, fileName: 'uvoz.xlsx', sha256: sha(filled) });
    expect(audit[0].diff.after.counts.team.created).toBe(2);

    // 2) Aktivacija zaključava proračun; isti predložak sada: postojeće se prepoznaje i preskače, troškovi se uvoze.
    await http().post(`/api/projects/${p.id}/transition`).set(auth(t.admin!)).send({ to: 'active' }).expect(201);
    plan = (await preview(p.id, filled, t.office!).expect(201)).body as Plan;
    expect(plan.errors).toBe(0);
    expect(sheet(plan, 'workPackages')).toMatchObject({ created: 0, unchanged: 2 });
    expect(sheet(plan, 'budget')).toMatchObject({ created: 0, unchanged: 3 });
    expect(sheet(plan, 'budget').items[0]!.text).toMatch(/zaključan i jednak datoteci/);
    expect(sheet(plan, 'team')).toMatchObject({ created: 0, unchanged: 2 });
    expect(sheet(plan, 'milestones')).toMatchObject({ created: 0, unchanged: 1 });
    // Isporuke nemaju prirodni ključ (broj se dodjeljuje) – ponovni uvoz bi ih udvostručio, zato ih izostavljamo.
    expect(sheet(plan, 'expenses')).toMatchObject({ created: 4, status: 'ready' });
    expect(sheet(plan, 'expenses').items.filter((i) => i.historic)).toHaveLength(3);
    plan = (await preview(p.id, filled, t.office!, 'uvoz.xlsx', { skip: 'deliverables' }).expect(201)).body as Plan;
    const second = (await confirm(p.id, filled, plan, t.office!, { skip: 'deliverables' }).expect(201)).body;
    expect(second.counts.expenses.created).toBe(4);

    // Troškovi potraživani izvan sustava: ostvareno s priznatim iznosom, označeni, ne ulaze u ZNS ni u „ranija razdoblja”.
    const ex = await get(`/api/projects/${p.id}/expenses`);
    const elaborat = ex.find((e: { description: string }) => e.description === 'Elaborat energetskog pregleda');
    expect(elaborat).toMatchObject({ status: 'historic', historic: true, amount: 123_456, recognised: 100_000, externalClaim: 'ZNS 1 – RP1', decisionReason: 'Priznato do iznosa iz ugovora', imported: true });
    const os = ex.find((e: { source: string }) => e.source === 'historic_personnel');
    expect(os).toMatchObject({ status: 'historic', amount: 300_000, person: 'Ivana Kovač', month: '2026-02', categoryCode: 'OS' });
    expect(os.description).toMatch(/Trošak osoblja: Ivana Kovač, 02\/2026/);
    const fin = await get(`/api/projects/${p.id}/finance`);
    const cat = (code: string) => fin.byCategory.find((c: { code: string }) => c.code === code);
    expect(cat('VU')).toMatchObject({ actual: 100_000 + 125_000, unrecognised: 23_456 });
    expect(cat('OS').actual).toBe(300_000);
    expect(cat('PUT').actual).toBe(8_650);
    expect(fin.strandedExpenses.count).toBe(0);
    // Novi ZNS za RP1: povijesni troškovi nisu u njemu; RP3 sadrži samo obični trošak.
    const c1 = (await http().post(`/api/projects/${p.id}/claims`).set(auth(t.office!)).send({ period: 1 }).expect(201)).body;
    expect((await get(`/api/projects/${p.id}/claims/${c1.id}`)).expenses).toEqual([]);
    const c3 = (await http().post(`/api/projects/${p.id}/claims`).set(auth(t.office!)).send({ period: 3 }).expect(201)).body;
    const claim3 = await get(`/api/projects/${p.id}/claims/${c3.id}`);
    expect(claim3.expenses.map((e: { description: string }) => e.description)).toEqual(['Kalibracija senzora']);
    expect(claim3.earlierCandidates).toEqual([]);
    // Kumulativ prema proračunu u popisu za provjeru uključuje i ranije potraživano (VU: 1.000 + 1.250 ≤ 20.000).
    expect(claim3.checklist.items.find((i: { key: string }) => i.key === 'budget').ok).toBe(true);
    // Povijesni trošak se ne mijenja ni ne briše kroz rute troškova (ni u bazi).
    await http().delete(`/api/projects/${p.id}/expenses/${elaborat.id}`).set(auth(t.office!)).expect(409);
    await http().patch(`/api/projects/${p.id}/expenses/${elaborat.id}`).set(auth(t.office!)).send({ amount: 1 }).expect(409);
    await expect(owner.query(`update expenses set amount_cents = 1 where id = $1`, [elaborat.id])).rejects.toThrow(/nepromjenjiv/);
    // Timesheet za mjesec s uvezenim troškom osoblja ne može stvoriti trošak dvaput.
    const ivana = team.find((m: { fullName: string }) => m.fullName === 'Ivana Kovač').id;
    await http().put(`/api/projects/${p.id}/team/${ivana}/timesheets/2026-02`).set(auth(t.admin!)).send({ revision: 0, entries: [{ day: 3, minutes: 480 }] }).expect(200);
    await http().post(`/api/projects/${p.id}/team/${ivana}/timesheets/2026-02/submit`).set(auth(t.admin!)).expect(201);
    const dbl = await http().post(`/api/projects/${p.id}/team/${ivana}/timesheets/2026-02/approve`).set(auth(t.office!)).expect(409);
    expect(dbl.body.message).toMatch(/već postoji trošak osoblja potraživan izvan sustava/);

    // Skrivanje plaća: voditelj bez personnel:read ne vidi iznos uvezenog troška osoblja (ni u ZNS-u ni u paketu).
    await http().post(`/api/projects/${p.id}/access`).set(auth(t.admin!)).send({ userId: u.pm, roleCode: 'project-manager' }).expect(201);
    const pmEx = await get(`/api/projects/${p.id}/expenses`, t.pm!);
    expect(pmEx.find((e: { source: string }) => e.source === 'historic_personnel')).toMatchObject({ amount: null, recognised: null, amountHidden: true, person: 'Ivana Kovač' });
    expect(pmEx.find((e: { description: string }) => e.description === 'Elaborat energetskog pregleda')).toMatchObject({ amount: 123_456, amountHidden: false });
    // Paket ZNS-a: Sažetak navodi ranije potraživano izvan sustava; bez personnel:read zbroj je bez troškova osoblja.
    const zipOf = async (token: string) => new Map(readZip((await download(`/api/projects/${p.id}/claims/${c3.id}/export`, token).expect(200)).body as Buffer).map((e) => [e.name, e.data]));
    const summary = async (token: string) => {
      const x = new Map(readZip((await zipOf(token)).get('troskovi.xlsx')!).map((e) => [e.name, e.data.toString('utf8')]));
      return [...readSheet(x, 1).values()].map((c) => c.v).join(' | ');
    };
    expect(await summary(t.office!)).toMatch(/Potraživano izvan sustava \(prije ArQusa\) \| 3 – nisu dio ovog zahtjeva; ranije potraživano 4\.321,06 EUR, priznato 4\.086,50 EUR/);
    expect(await summary(t.pm!)).toMatch(/3 – nisu dio ovog zahtjeva; ranije potraživano 1\.321,06 EUR, priznato 1\.086,50 EUR \(bez troškova osoblja/);
    // Portfelj: ostvareno jednako pregledu projekta; RP1 nije „razdoblje bez ZNS-a” (potraživano izvan sustava).
    const pf = await get('/api/portfolio');
    const row = pf.projects.find((x: { id: string }) => x.id === p.id);
    expect(row.budget.projectActual).toBe(fin.actual.total);
    expect(row.budget.projectUnrecognised).toBe(fin.unrecognised.total);
    // RP1 je potraživan izvan sustava; RP2 i RP3 su završila bez predanog ZNS-a u sustavu (RP3 ima samo nacrt).
    expect(row.attention).toMatchObject({ unclaimedPeriods: 2, expensesWithoutEvidence: 1, strandedExpenses: 0 });
    expect(row.nextReport.period).toBe(2);
  });

  it('greške po listu, retku (kao u Excelu) i stupcu; jedan loš redak blokira cijeli uvoz', async () => {
    const p = await project(`ER${tag.slice(0, 4)}`, { active: true });
    const file = await book({
      'Radni paketi': [['Plan rada (naslov iznad zaglavlja)'], ['Naziv', 'Početni mjesec', 'Završni mjesec'], ['Upravljanje', 1, 30], ['Istraživanje', 5, 2], ['', 1, 3]],
      Troskovi: [['Datum', 'Kategorija', 'Iznos', 'Opis', 'Moj stupac'],
        ['31.02.2026.', 'VU', 10, 'Nepostojeći datum', 'x'],
        ['01.03.2026.', 'XX', 10, 'Nepoznata kategorija', null],
        ['01.03.2026.', 'VU', -5, 'Negativan iznos', null],
        ['01.03.2026.', 'NT', 10, 'Neizravni se ne unose', null],
        ['01.03.2028.', 'VU', '12,345', 'Izvan trajanja i tri decimale', null],
        ['01.03.2026.', 'OS', 100, 'Trošak osoblja ručno', null],
        ['02/10/2026', 'VU', 10, 'Datum s kosom crtom', null],
        ['01.03.2026.', 'VU', 10, 'Priznato bez DA', null],
        ['01.04.2026.', 'VU', 99.99, 'Ispravan redak', null]],
      Tim: [['Uloga', 'E-adresa korisnika'], ['nešto', null]],
    });
    const plan = (await preview(p.id, file, t.office!).expect(201)).body as Plan;
    expect(plan.canConfirm).toBe(false);
    const wp = sheet(plan, 'workPackages');
    expect(wp.errors.map((e) => [e.row, e.column, e.message])).toEqual([
      [3, 'Završni mjesec', 'WP1: mjesec 30 je izvan trajanja projekta (24 mj.)'],
      [4, 'Završni mjesec', 'WP2: završni mjesec je prije početnog'],
      [5, 'Naziv', 'obavezna vrijednost nedostaje'],
    ]);
    const ex = sheet(plan, 'expenses');
    expect(ex.name).toBe('Troskovi');
    const at = (row: number) => ex.errors.filter((e) => e.row === row).map((e) => `${e.column}=${e.value}: ${e.message}`);
    expect(at(2)).toEqual(['Datum=31.02.2026.: datum ne postoji']);
    expect(at(3)[0]).toMatch(/^Kategorija=XX: kategorija ne postoji u paketu programa \(šifre: OS, VU, OP, RAD, PUT, UP, PV\)/);
    expect(at(4)).toEqual([expect.stringMatching(/^Iznos=-5: iznos ne smije biti negativan/)]);
    expect(at(5)).toEqual([expect.stringMatching(/^Kategorija=NT: u kategoriju "NT" ne unose se iznosi/)]);
    expect(at(6)).toEqual(['Iznos=12,345: iznos ima više od dvije decimale – zaokruži na cente']);
    expect(at(7)).toEqual([expect.stringMatching(/^Kategorija=OS: trošak osoblja \(OS\) nastaje odobrenjem timesheeta.*upiši DA u stupac „Potraživano izvan sustava”/)]);
    expect(at(8)).toEqual([expect.stringMatching(/^Datum=02\/10\/2026: datum s kosom crtom nije jednoznačan/)]);
    expect(at(9)).toEqual([]);
    expect(at(10)).toEqual([]);
    expect(ex).toMatchObject({ rowsRead: 9, rowsValid: 2 });
    // Datum izvan trajanja projekta: isto pravilo kao ručni unos (nakon ispravka decimala).
    const team = sheet(plan, 'team');
    expect(team.errors[0]!.message).toBe('Na listu „Tim” nedostaje obavezni stupac: „Ime i prezime” (redak zaglavlja 1).');
    // Potvrda s greškama: ništa se ne primjenjuje.
    const r = await confirm(p.id, file, plan, t.office!).expect(400);
    expect(r.body.code).toBe('import_has_errors');
    expect(await get(`/api/projects/${p.id}/expenses`)).toEqual([]);
    expect((await get(`/api/projects/${p.id}/structure`)).workPackages).toEqual([]);
    // Iznos izvan trajanja projekta – zasebno (prethodni redak imao je dvije greške, prva prekida provjeru retka).
    const f2 = await book({ 'Troškovi': [['Datum', 'Kategorija', 'Iznos', 'Opis'], ['01.03.2028.', 'VU', 10, 'Izvan trajanja']] });
    const p2 = (await preview(p.id, f2, t.office!).expect(201)).body as Plan;
    expect(sheet(p2, 'expenses').errors[0]).toMatchObject({ row: 2, column: 'Datum', message: 'datum 2028-03-01 je izvan trajanja projekta (2026-01-01 – 2027-12-31)' });
  });

  it('atomičnost: greška tijekom primjene poništava sve (ništa nije spremljeno)', async () => {
    const p = await project(`AT${tag.slice(0, 4)}`, { active: true });
    const file = await book({ 'Radni paketi': [['Naziv', 'Početni mjesec', 'Završni mjesec'], ['Upravljanje', 1, 24]], 'Troškovi': [['Datum', 'Kategorija', 'Iznos', 'Opis'], ['01.03.2026.', 'VU', 10, 'Usluga']] });
    const plan = (await preview(p.id, file, t.office!).expect(201)).body as Plan;
    const audit = app.get(AuditService);
    const orig = audit.record.bind(audit);
    const spy = vi.spyOn(audit, 'record').mockImplementation(async (tx, input) => { if (input.entity === 'project_import') throw new Error('kvar pri upisu'); return orig(tx, input); });
    try { await confirm(p.id, file, plan, t.office!).expect(500); } finally { spy.mockRestore(); }
    expect(await get(`/api/projects/${p.id}/expenses`)).toEqual([]);
    expect((await get(`/api/projects/${p.id}/structure`)).workPackages).toEqual([]);
    expect(await get(`/api/projects/${p.id}/imports`)).toEqual([]);
    expect((await get(`/api/projects/${p.id}`)).revision).toBe(plan.projectRevision);
  });

  it('isti bajtovi: promijenjena datoteka, promijenjen projekt ili podaci nakon pregleda → 409, ništa se ne sprema', async () => {
    const p = await project(`SB${tag.slice(0, 4)}`, { active: true });
    const file = await book({ 'Troškovi': [['Datum', 'Kategorija', 'Iznos', 'Opis'], ['01.03.2026.', 'VU', 10, 'Usluga'], ['02.03.2026.', 'PUT', 20, 'Put']] });
    const plan = (await preview(p.id, file, t.office!).expect(201)).body as Plan;
    expect(plan.sha256).toBe(sha(file));
    // (a) drugi bajtovi uz SHA-256 iz pregleda
    const other = await book({ 'Troškovi': [['Datum', 'Kategorija', 'Iznos', 'Opis'], ['01.03.2026.', 'VU', 99, 'Usluga']] });
    expect((await confirm(p.id, other, plan, t.office!).expect(409)).body.code).toBe('import_file_changed');
    // (b) drugi bajtovi s vlastitim SHA-256, ali otiskom starog plana
    expect((await confirm(p.id, other, { ...plan, sha256: sha(other) }, t.office!).expect(409)).body.code).toBe('import_plan_changed');
    // (c) drugi odabir listova nego u pregledu
    expect((await confirm(p.id, file, plan, t.office!, { skip: 'expenses' }).expect(409)).body.code).toBe('import_plan_changed');
    // (d) podaci projekta promijenjeni nakon pregleda (novi trošak → novo upozorenje o duplikatu) bez promjene revizije projekta
    await http().post(`/api/projects/${p.id}/expenses`).set(auth(t.office!)).send({ categoryCode: 'VU', date: '2026-03-01', description: 'Ručno', amount: 1000 }).expect(201);
    expect((await confirm(p.id, file, plan, t.office!).expect(409)).body.code).toBe('import_plan_changed');
    // (e) projekt promijenjen nakon pregleda (revizija)
    const fresh = (await preview(p.id, file, t.office!).expect(201)).body as Plan;
    expect(sheet(fresh, 'expenses').warnings.map((w) => w.message)).toContain('mogući duplikat troška koji već postoji u sustavu (01.03.2026., VU, 10,00 EUR: „Ručno”)');
    await http().patch(`/api/projects/${p.id}`).set(auth(t.office!)).send({ revision: fresh.projectRevision, title: 'Novi naslov' }).expect(200);
    expect((await confirm(p.id, file, fresh, t.office!).expect(409)).body.code).toBe('revision_conflict');
    // (f) upozorenja moraju biti potvrđena; bez revizije 400
    const again = (await preview(p.id, file, t.office!).expect(201)).body as Plan;
    expect((await confirm(p.id, file, again, t.office!, { acknowledgeWarnings: 'false' }).expect(400)).body.code).toBe('import_warnings_unacknowledged');
    const noRev = await http().post(`/api/projects/${p.id}/import/confirm`).set(auth(t.office!)).field({ sha256: again.sha256, fingerprint: again.fingerprint }).attach('file', file, 'uvoz.xlsx').expect(400);
    expect(JSON.stringify(noRev.body.issues)).toMatch(/revision/);
    expect((await get(`/api/projects/${p.id}/expenses`)).map((e: { description: string }) => e.description)).toEqual(['Ručno']);
    await confirm(p.id, file, again, t.office!).expect(201);
    expect(await get(`/api/projects/${p.id}/expenses`)).toHaveLength(3);
    expect((await get(`/api/projects/${p.id}`)).revision).toBe(again.projectRevision + 1);
  });

  it('dozvole po listu: list bez dozvole je greška tog lista; plaće i troškovi osoblja samo uz personnel:read; čitatelj 403; tuđi projekt 404', async () => {
    const p = await project(`PE${tag.slice(0, 4)}`, { active: true, manager: u.pm });
    const file = await book({
      'Radni paketi': [['Naziv', 'Početni mjesec', 'Završni mjesec'], ['Upravljanje', 1, 24]],
      Tim: [['Ime i prezime', 'Godišnji trošak (EUR)'], ['Ana Anić', 30000], ['Bez troška', null]],
      'Troškovi': [['Datum', 'Kategorija', 'Iznos', 'Potraživano izvan sustava', 'Osoba'], ['28.02.2026.', 'OS', 1000, 'DA', 'Ana Anić'], ['01.03.2026.', 'VU', 10, 'NE', null]],
    });
    // Financije (finance:write, bez projects:write): list radnih paketa odbijen s razlogom, ostalo valjano.
    const fin = (await preview(p.id, file, t.fin!).expect(201)).body as Plan;
    expect(sheet(fin, 'workPackages')).toMatchObject({ status: 'rejected', reason: expect.stringMatching(/Nedostaje dozvola projects:write na ovom projektu – list „Radni paketi” ne možeš uvesti/) });
    expect(sheet(fin, 'team').errors).toEqual([]);
    expect(sheet(fin, 'expenses').errors.map((e) => `${e.row}:${e.column}:${e.message}`)).toEqual(['3:Opis:najmanje 2 znaka']);
    // Voditelj projekta (projects:write i finance:write na projektu, bez personnel:read): plaća i trošak osoblja odbijeni po retku.
    const pm = (await preview(p.id, file, t.pm!).expect(201)).body as Plan;
    expect(sheet(pm, 'workPackages').errors).toEqual([]);
    expect(sheet(pm, 'team').errors).toEqual([expect.objectContaining({ row: 2, column: 'Godišnji trošak (EUR)', message: expect.stringMatching(/^Nedostaje dozvola personnel:read – godišnji trošak/) })]);
    expect(sheet(pm, 'expenses').errors).toEqual(expect.arrayContaining([expect.objectContaining({ row: 2, column: 'Kategorija', message: expect.stringMatching(/^Nedostaje dozvola personnel:read – troškove osoblja iz ranijih razdoblja/) })]));
    // Ured za projekte (sve dozvole): valjano – uz opis koji nedostaje u običnom trošku.
    const office = (await preview(p.id, file, t.office!).expect(201)).body as Plan;
    expect(sheet(office, 'expenses').errors.map((e) => `${e.row}:${e.column}`)).toEqual(['3:Opis']);
    expect(office.permissions).toEqual(['finance:write', 'personnel:read', 'projects:write']);
    // Čitatelj (samo čitanje): 403; član tima projekta A na projektu B: 404 na svim rutama uvoza.
    await preview(p.id, file, t.rdr!).expect(403);
    await http().get(`/api/projects/${p.id}/import/template`).set(auth(t.rdr!)).expect(200);
    const other = await project(`PB${tag.slice(0, 4)}`, { active: true });
    for (const r of [
      http().get(`/api/projects/${other.id}/import/template`), http().get(`/api/projects/${other.id}/imports`),
      http().post(`/api/projects/${other.id}/import/preview`).attach('file', file, 'x.xlsx'),
      http().post(`/api/projects/${other.id}/import/confirm`).field({ sha256: sha(file), revision: '1', fingerprint: 'a'.repeat(64) }).attach('file', file, 'x.xlsx'),
      http().post(`/api/projects/${other.id}/imports/${randomUUID()}/undo`),
    ]) expect((await r.set(auth(t.pm!))).status).toBe(404);
  });

  it('poništavanje: uklanja sve što je uvoz stvorio; svaka prepreka odbija poništavanje s popisom razloga', async () => {
    const p = await project(`UN${tag.slice(0, 4)}`, { active: true });
    const file = (n: string) => book({
      'Radni paketi': [['Broj', 'Naziv', 'Početni mjesec', 'Završni mjesec'], [Number(n), `Paket ${n}`, 1, 24]],
      Tim: [['Ime i prezime', 'Godišnji trošak'], [`Osoba ${n}`, 30000]],
      'Proračun': [['Kategorija', 'Iznos'], ['VU', 1000 * Number(n)]],
      'Troškovi': [['Datum', 'Kategorija', 'Radni paket', 'Iznos', 'Opis', 'Potraživano izvan sustava'], ['01.02.2026.', 'VU', Number(n), 10, `Usluga ${n}`, 'DA'], ['01.05.2026.', 'PUT', null, 20, `Put ${n}`, 'NE']],
    });
    // 1) čisto poništavanje
    const f1 = await file('1');
    const a = await importOk(p.id, f1);
    expect((await get(`/api/projects/${p.id}/imports`))[0]).toMatchObject({ id: a.result.importId, status: 'applied', canUndo: true, blockers: [], createdBy: 'Korisnik office', fileName: 'uvoz.xlsx' });
    await http().post(`/api/projects/${p.id}/imports/${a.result.importId}/undo`).set(auth(t.office!)).expect(201);
    expect(await get(`/api/projects/${p.id}/expenses`)).toEqual([]);
    expect((await get(`/api/projects/${p.id}/structure`)).workPackages).toEqual([]);
    expect(await get(`/api/projects/${p.id}/team`)).toEqual([]);
    expect((await get(`/api/projects/${p.id}/budget`)).status).toBe('none');
    const h = await get(`/api/projects/${p.id}/imports`);
    expect(h[0]).toMatchObject({ status: 'undone', undoneBy: 'Korisnik office', canUndo: false });
    await http().post(`/api/projects/${p.id}/imports/${a.result.importId}/undo`).set(auth(t.office!)).expect(409);
    expect((await owner.query(`select count(*)::int as n from audit_entries where entity = 'project_import' and entity_id = $1 and action = 'undo'`, [a.result.importId])).rows[0].n).toBe(1);

    // 2) prepreke: zadatak na radnom paketu, timesheet člana tima, izmijenjen proračun, dokaz uz trošak, trošak u predanom ZNS-u
    const b = await importOk(p.id, await file('2'));
    const st = await get(`/api/projects/${p.id}/structure`);
    await http().post(`/api/projects/${p.id}/work-packages/${st.workPackages[0].id}/tasks`).set(auth(t.office!)).send({ title: 'Zadatak', startMonth: 1, endMonth: 3 }).expect(201);
    const member = (await get(`/api/projects/${p.id}/team`))[0].id;
    await http().put(`/api/projects/${p.id}/team/${member}/timesheets/2026-08`).set(auth(t.office!)).send({ revision: 0, entries: [{ day: 3, minutes: 60 }] }).expect(200);
    const budget = await get(`/api/projects/${p.id}/budget`);
    await http().put(`/api/projects/${p.id}/budget/lines`).set(auth(t.office!)).send({ revision: budget.revision, lines: [{ partnerId: p.self, categoryCode: 'VU', amount: 5 }] }).expect(200);
    const exs = await get(`/api/projects/${p.id}/expenses`);
    const put = exs.find((e: { description: string }) => e.description === 'Put 2');
    await http().post('/api/documents').set(auth(t.office!)).field({ entityType: 'expense', entityId: put.id, kind: 'evidence' }).attach('file', Buffer.from('%PDF-1.7\n%%EOF\n'), 'r.pdf').expect(201);
    const claim = (await http().post(`/api/projects/${p.id}/claims`).set(auth(t.office!)).send({ period: 2 }).expect(201)).body;
    await http().post(`/api/projects/${p.id}/claims/${claim.id}/submit`).set(auth(t.office!)).send({}).expect(201);
    const blocked = await http().post(`/api/projects/${p.id}/imports/${b.result.importId}/undo`).set(auth(t.office!)).expect(409);
    expect(blocked.body.code).toBe('import_undo_blocked');
    expect(blocked.body.blockers).toEqual([
      '1 uvezeni trošak je u zahtjevu za nadoknadu (npr. 01.05.2026. „Put 2”)',
      'uz uvezene troškove priložen je 1 dokaz',
      'uvezeni radni paketi imaju 1 zadatak',
      'uvezeni članovi tima imaju 1 timesheet',
      'proračun je u međuvremenu izmijenjen',
    ]);
    expect((await get(`/api/projects/${p.id}/imports`))[0]).toMatchObject({ canUndo: false, blockers: blocked.body.blockers });
    expect((await get(`/api/projects/${p.id}/expenses`)).length).toBe(2);
    // Poništavanje traži iste dozvole kao uvoz: financije (bez projects:write) ne poništavaju uvoz s radnim paketima.
    expect((await http().post(`/api/projects/${p.id}/imports/${b.result.importId}/undo`).set(auth(t.fin!)).expect(403)).body.message).toMatch(/projects:write/);
  });

  it('proračun: zamjena nacrta je upozorenje; zaključan proračun s drugim podacima odbija list s razlogom', async () => {
    const p = await project(`BU${tag.slice(0, 4)}`);
    await http().put(`/api/projects/${p.id}/budget/lines`).set(auth(t.office!)).send({ revision: 0, lines: [{ partnerId: p.self, categoryCode: 'VU', amount: 100 }] }).expect(200);
    const file = await book({ 'Proračun': [['Kategorija', 'Iznos'], ['VU', 50], ['OP', 70]] });
    const plan = (await preview(p.id, file, t.office!).expect(201)).body as Plan;
    expect(sheet(plan, 'budget')).toMatchObject({ updated: 2, warnings: [expect.objectContaining({ message: 'Uvoz zamjenjuje postojeći nacrt proračuna (1 redak, 1,00 EUR) novim (2 retka, 120,00 EUR).' })] });
    const r = (await confirm(p.id, file, plan, t.office!).expect(201)).body;
    // Poništavanje vraća prijašnje retke nacrta.
    await http().post(`/api/projects/${p.id}/imports/${r.importId}/undo`).set(auth(t.office!)).expect(201);
    expect((await get(`/api/projects/${p.id}/budget`)).lines.map((l: { categoryCode: string; amount: number }) => `${l.categoryCode}:${l.amount}`)).toEqual(['VU:100']);
    await http().post(`/api/projects/${p.id}/transition`).set(auth(t.admin!)).send({ to: 'active' }).expect(201);
    const locked = (await preview(p.id, file, t.office!).expect(201)).body as Plan;
    expect(sheet(locked, 'budget')).toMatchObject({ status: 'rejected', reason: 'Proračun v1 je zaključan (aktivacijom projekta) – mijenja se samo amandmanom, ne uvozom.' });
  });

  it('stvarne datoteke: LibreOffice i openpyxl daju isti uvoz; CSV iz LibreOfficea s hrvatskim zapisom', async () => {
    const results: Record<string, unknown> = {};
    for (const f of ['libreoffice-projekt.xlsx', 'openpyxl-projekt.xlsx']) {
      const p = await project(`${f.slice(0, 2).toUpperCase()}${tag.slice(0, 4)}`, { active: true });
      const buf = readFileSync(join(FIX, f));
      const { plan } = await importOk(p.id, buf, t.office!, f);
      expect(plan.ignoredSheets).toEqual(['Pomoćno']);
      expect(sheet(plan, 'workPackages')).toMatchObject({ created: 3, rowsRead: 3 });
      expect(sheet(plan, 'team').created).toBe(2);
      expect(sheet(plan, 'expenses')).toMatchObject({ created: 5, rowsRead: 5 });
      const ex = (await get(`/api/projects/${p.id}/expenses`)).map((e: { date: string; categoryCode: string; amount: number; recognised: number | null; status: string; description: string }) =>
        `${e.date} ${e.categoryCode} ${e.amount} ${e.recognised} ${e.status} ${e.description}`).sort();
      results[f] = ex;
      expect(ex).toContain('2026-02-10 VU 123456 100000 historic Elaborat energetskog pregleda');
      expect(ex).toContain('2026-09-01 PV 1000 null recorded =formula koja je samo tekst');
      expect(ex).toContain('2026-08-05 VU 125000 null recorded Kalibracija senzora');
    }
    expect(results['libreoffice-projekt.xlsx']).toEqual(results['openpyxl-projekt.xlsx']);
    // CSV (list „Troškovi” iz LibreOfficea, hrvatski jezik): datumi 10.02.2026, decimalni zarez, TOČNO.
    const p = await project(`CS${tag.slice(0, 4)}`, { active: true });
    await importOk(p.id, await book({ Tim: [['Ime i prezime'], ['Ivana Kovač']], 'Radni paketi': [['Naziv', 'Početni mjesec', 'Završni mjesec'], ['Paket A', 1, 24], ['Paket B', 1, 24]] }));
    const { plan } = await importOk(p.id, readFileSync(join(FIX, 'libreoffice-troskovi.csv')), t.office!, 'libreoffice-troskovi.csv');
    expect(plan.format).toBe('csv');
    expect(sheet(plan, 'expenses')).toMatchObject({ created: 5 });
    expect((await get(`/api/projects/${p.id}/expenses`)).filter((e: { status: string }) => e.status === 'historic')).toHaveLength(3);
  });

  it('neispravne datoteke: jasna poruka (xls, xlsm, lozinka, nije radna knjiga)', async () => {
    const p = await project(`BF${tag.slice(0, 4)}`, { active: true });
    const cfb = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600)]);
    expect((await preview(p.id, cfb, t.office!, 'stara.xls').expect(400)).body).toMatchObject({ code: 'import_file_xls', message: expect.stringMatching(/Excel 97–2003 \(\.xls\)/) });
    const enc = Buffer.concat([cfb, Buffer.from('EncryptedPackage', 'utf16le')]);
    expect((await preview(p.id, enc, t.office!, 'tajna.xlsx').expect(400)).body.code).toBe('import_file_encrypted');
    expect((await preview(p.id, Buffer.from('PK\x03\x04nije zip'), t.office!, 'x.xlsm').expect(400)).body.code).toBe('import_file_xlsm');
    expect((await preview(p.id, Buffer.from('nije tablica'), t.office!, 'x.xlsx').expect(400)).body.message).toMatch(/nije radna knjiga Excela/);
    await preview(p.id, Buffer.alloc(6 * 1024 * 1024, 65), t.office!, 'velika.csv').expect(413);
  });

  it('ograničenje učestalosti: pregled i potvrda kao skupi izvozi (429 import_rate_limited)', async () => {
    const p = await project(`RL${tag.slice(0, 4)}`, { active: true });
    const file = await book({ 'Troškovi': [['Datum', 'Kategorija', 'Iznos', 'Opis'], ['01.03.2026.', 'VU', 10, 'Usluga']] });
    for (let i = 0; i < 60; i++) await preview(p.id, file, t.lim!).expect(201);
    const r = await preview(p.id, file, t.lim!).expect(429);
    expect(r.body).toMatchObject({ code: 'import_rate_limited', message: expect.stringMatching(/Previše uvoza u kratkom vremenu/) });
  }, 60_000);
});
