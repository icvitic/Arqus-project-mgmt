import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';
import { readSheet, readZip } from './zip-reader';

/**
 * WP1.16b – paket ZNS-a za predaju, troškovi iz ranijih razdoblja i mjerenje pripreme (e2e).
 * Projekt NPOO (razdoblja od 3 mjeseca) od 1. 1. 2025., 24 mjeseca: RP1–RP4 su završila.
 */
const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
const PDF = (s: string) => Buffer.from(`%PDF-1.7\n% ${s}\n1 0 obj << >> endobj\n%%EOF\n`);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
type Files = Map<string, Buffer>;

describe('Paket ZNS-a za predaju i mjerenje pripreme (WP1.16b, e2e)', () => {
  let app: INestApplication;
  const tag = randomUUID().slice(0, 8); const slug = `zp-${tag}`; const other = `zo-${tag}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const PW = 'Plava-Staza-2027-x';
  const login = async (s: string, email: string, pw = PW) => (await http().post('/api/auth/login').send({ tenantSlug: s, email, password: pw }).expect(201)).body.accessToken as string;
  const owner = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const t: Record<string, string> = {};
  let pid = ''; let otherPid = ''; let wp1 = ''; let wp2 = ''; let durdica = ''; let ivan = ''; let claim1 = ''; let claim2 = ''; let claim3 = ''; let vuExpense = ''; let lateExpense = ''; let confidentialDoc = '';
  let tenantId = '';

  const download = (url: string, token: string) => http().get(url).set(auth(token)).buffer(true)
    .parse((res, cb) => { const parts: Buffer[] = []; res.on('data', (c: Buffer) => parts.push(c)); res.on('end', () => cb(null, Buffer.concat(parts))); });
  const unpack = (zip: Buffer): Files => new Map(readZip(zip).map((e) => [e.name, e.data]));
  const manifest = (files: Files) => files.get('sadrzaj.csv')!.toString('utf8').replace(/^\ufeff/, '').trim().split('\r\n').slice(1).map((l) => l.split(';'));
  const exportOf = async (cid: string, token = t.admin!) => {
    const r = await download(`/api/projects/${pid}/claims/${cid}/export`, token).expect(200);
    expect(r.headers['content-type']).toBe('application/zip');
    return { files: unpack(r.body as Buffer), name: /filename="([^"]+)"/.exec(String(r.headers['content-disposition']))![1]!, raw: r.body as Buffer };
  };
  const upload = async (token: string, entityId: string, fileName: string, content: Buffer, confidentiality = 'internal') =>
    (await http().post('/api/documents').set(auth(token)).field({ entityType: 'expense', entityId, kind: 'evidence', confidentiality }).attach('file', content, fileName).expect(201)).body.id as string;
  const expense = async (body: Record<string, unknown>) => (await http().post(`/api/projects/${pid}/expenses`).set(auth(t.admin!)).send(body).expect(201)).body.id as string;
  const claim = async (cid: string, token = t.admin!) => (await http().get(`/api/projects/${pid}/claims/${cid}`).set(auth(token)).expect(200)).body;

  beforeAll(async () => {
    process.env.DATABASE_URL = APP_URL;
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), 'arqus-zns-paket-'));
    await seedDemo({ url: ADMIN_URL, tenantSlug: slug, adminEmail: `a@${slug}.hr`, adminPassword: 'Lozinka-123456' });
    await seedDemo({ url: ADMIN_URL, tenantSlug: other, adminEmail: `a@${other}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    t.admin = await login(slug, `a@${slug}.hr`, 'Lozinka-123456');
    tenantId = (await owner.query<{ id: string }>('select id from tenants where slug = $1', [slug])).rows[0]!.id;
    const mk = async (local: string, roleCodes: string[]) => (await http().post('/api/users').set(auth(t.admin!)).send({ email: `${local}@${slug}.hr`, displayName: `Korisnik ${local}`, password: PW, roleCodes }).expect(201)).body.id as string;
    const pmUser = await mk('pm', []); await mk('rdr', ['reader']); await mk('ured', ['project-office']); await mk('fin', ['finance']); const pm2User = await mk('pm2', []);

    const p = (await http().post('/api/projects').set(auth(t.admin!)).send({ acronym: 'ŽITO-LAB', title: 'Žitarice & „klima” – laboratorij', packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA', contractNo: 'UG-2025/č-01', startDate: '2025-01-01', durationMonths: 24, managerUserId: pmUser }).expect(201)).body;
    pid = p.id; const self = p.partners[0].id;
    otherPid = (await http().post('/api/projects').set(auth(t.admin!)).send({ acronym: `DRUGI${tag.slice(0, 3)}`, title: 'Drugi projekt', packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA', startDate: '2025-01-01', durationMonths: 12, managerUserId: pm2User }).expect(201)).body.id;
    wp1 = (await http().post(`/api/projects/${pid}/work-packages`).set(auth(t.admin!)).send({ title: 'Upravljanje', startMonth: 1, endMonth: 24 }).expect(201)).body.id;
    wp2 = (await http().post(`/api/projects/${pid}/work-packages`).set(auth(t.admin!)).send({ title: 'Istraživanje', startMonth: 1, endMonth: 24 }).expect(201)).body.id;
    await http().put(`/api/projects/${pid}/budget/lines`).set(auth(t.admin!)).send({ lines: [
      { partnerId: self, categoryCode: 'OS', amount: 6_000_000 }, { partnerId: self, categoryCode: 'VU', amount: 2_000_000 }, { partnerId: self, categoryCode: 'PUT', amount: 300_000 }, { partnerId: self, categoryCode: 'PV', amount: 500_000 },
    ] }).expect(200);
    durdica = (await http().post(`/api/projects/${pid}/team`).set(auth(t.admin!)).send({ fullName: 'Đurđica Šimić-Ćorić', role: 'istraživačica', annualCost: 3_440_000 }).expect(201)).body.id;
    ivan = (await http().post(`/api/projects/${pid}/team`).set(auth(t.admin!)).send({ fullName: 'Ivan Horvat', annualCost: 5_160_000 }).expect(201)).body.id;
    await http().post(`/api/projects/${pid}/transition`).set(auth(t.admin!)).send({ to: 'active' }).expect(201);
    const ts = async (member: string, month: string, entries: unknown[]) => {
      await http().put(`/api/projects/${pid}/team/${member}/timesheets/${month}`).set(auth(t.admin!)).send({ entries }).expect(200);
      await http().post(`/api/projects/${pid}/team/${member}/timesheets/${month}/submit`).set(auth(t.admin!)).expect(201);
      await http().post(`/api/projects/${pid}/team/${member}/timesheets/${month}/approve`).set(auth(t.admin!)).expect(201);
    };
    await ts(durdica, '2025-02', [{ day: 3, minutes: 480, workPackageId: wp1 }, { day: 4, minutes: 240, workPackageId: wp2 }, { day: 4, minutes: 120, workPackageId: wp1 }]);
    await ts(ivan, '2025-03', [{ day: 10, minutes: 450, workPackageId: wp2 }]);
    vuExpense = await expense({ categoryCode: 'VU', workPackageId: wp2, date: '2025-03-10', description: 'Anketa & analiza „Jadran” – čćđšž', supplier: 'Istraživanja d.o.o.', amount: 250_000 });
    await upload(t.admin!, vuExpense, 'Račun br. 12 – Šimić.pdf', PDF('racun'));
    await upload(t.admin!, vuExpense, 'Račun br. 12 – Šimić.pdf', PDF('racun-2')); // isti naziv → jedinstven naziv u paketu
    const put = await expense({ categoryCode: 'PUT', date: '2025-02-20', description: 'Putni nalog Zagreb–Split', amount: 45_000 });
    confidentialDoc = await upload(t.admin!, put, 'putni-nalog.pdf', PDF('povjerljivo'), 'confidential');
    await expense({ categoryCode: 'PV', date: '2025-03-25', description: 'Tisak letaka', amount: 30_000 }); // bez dokaza
    claim1 = (await http().post(`/api/projects/${pid}/claims`).set(auth(t.admin!)).send({ period: 1 }).expect(201)).body.id;
    for (const k of ['pm', 'rdr', 'ured', 'fin', 'pm2']) t[k] = await login(slug, `${k}@${slug}.hr`);
    t.other = await login(other, `a@${other}.hr`, 'Lozinka-123456');
  }, 60_000);
  afterAll(async () => { await app.close(); await owner.end(); });

  it('nacrt: paket je označen kao NACRT u svakoj generiranoj datoteci; manifest odgovara datotekama', async () => {
    const { files, name } = await exportOf(claim1);
    expect(name).toMatch(/^ZNS_ZITO-LAB_RP1_NACRT_\d{4}-\d{2}-\d{2}\.zip$/);
    const generated = [...files.keys()].filter((f) => !f.startsWith('dokazi/'));
    expect(generated).toEqual(['sadrzaj.csv', 'troskovi.xlsx', 'kontrolna-lista.html', 'evidencije-rada/Durdica-Simic-Coric_2025-02.html', 'evidencije-rada/Ivan-Horvat_2025-03.html']);
    for (const f of generated.filter((x) => x.endsWith('.html'))) expect(files.get(f)!.toString('utf8'), f).toContain('NACRT');
    expect(files.get('sadrzaj.csv')!.toString('utf8')).toContain('NACRT');
    const x = new Map(readZip(files.get('troskovi.xlsx')!).map((e) => [e.name, e.data.toString('utf8')]));
    for (const n of [1, 2, 3]) expect([...readSheet(x, n).values()].some((c) => c.v.startsWith('NACRT'))).toBe(true);
    // Kontrolna lista nacrta je živa: navodi trošak bez dokaza.
    expect(files.get('kontrolna-lista.html')!.toString('utf8')).toContain('Tisak letaka');
  });

  it('predaja sa satima pripreme; paket: manifest i hashevi, zbrojevi = zahtjev, evidencije rada, dokazi s jedinstvenim nazivima', async () => {
    const c0 = await claim(claim1);
    const ack = c0.checklist.items.find((i: { key: string }) => i.key === 'evidence').expenseIds;
    const sub = (await http().post(`/api/projects/${pid}/claims/${claim1}/submit`).set(auth(t.admin!)).send({ acknowledgeWithoutEvidence: ack, preparationHours: 12.5 }).expect(201)).body;
    expect(sub.preparation.hours).toBe(12.5);
    expect(sub.preparation.measures).toMatchObject({ daysInPreparation: 0, returns: 0, expenses: 6, evidenceFiles: 3, timesheets: 2, earlierExpenses: 0 });
    expect(sub.preparation.measures.daysAfterPeriodEnd).toBeGreaterThan(500);

    const { files, name } = await exportOf(claim1);
    expect(name).toMatch(/^ZNS_ZITO-LAB_RP1_\d{4}-\d{2}-\d{2}\.zip$/);
    const rows = manifest(files);
    const meta = Object.fromEntries(rows.filter((r) => r[0] === 'meta').map((r) => [r[1], r[4]]));
    expect(meta).toMatchObject({ zahtjev: claim1, status: 'submitted', verzija_aplikacije: expect.any(String), izvezao: expect.stringContaining(`a@${slug}.hr`) });
    expect(Date.parse(meta.izvezeno!)).toBeGreaterThan(Date.now() - 60_000);
    const listed = rows.filter((r) => r[0] === 'datoteka');
    expect(listed.map((r) => r[1])).toEqual([...files.keys()].filter((f) => f !== 'sadrzaj.csv'));
    for (const r of listed) { const b = files.get(r[1]!)!; expect(Number(r[2]), r[1]).toBe(b.length); expect(r[3], r[1]).toBe(sha(b)); }
    expect([...files.keys()].filter((f) => f.startsWith('dokazi/'))).toEqual([
      'dokazi/001_2025-02-20_Putni-nalog-Zagreb-Split/putni-nalog.pdf',
      'dokazi/004_2025-03-10_Anketa-analiza-Jadran-ccdsz/Račun br. 12 – Šimić.pdf',
      'dokazi/004_2025-03-10_Anketa-analiza-Jadran-ccdsz/Račun br. 12 – Šimić (2).pdf',
    ]);
    expect(files.get('dokazi/004_2025-03-10_Anketa-analiza-Jadran-ccdsz/Račun br. 12 – Šimić (2).pdf')!.toString()).toContain('racun-2');

    // Radna knjiga: zbrojevi jednaki zahtjevu iz API-ja.
    const x = new Map(readZip(files.get('troskovi.xlsx')!).map((e) => [e.name, e.data.toString('utf8')]));
    const s1 = readSheet(x, 1);
    const valueRight = (label: string) => { const ref = [...s1].find(([, c]) => c.v === label)![0]; const row = ref.replace(/[A-Z]+/, ''); return Number(s1.get(`C${row}`)!.v); };
    expect(Math.round(valueRight('Izravni troškovi ukupno') * 100)).toBe(sub.totals.direct);
    expect(Math.round(valueRight('Neizravni troškovi ukupno') * 100)).toBe(sub.totals.indirect);
    expect(Math.round(valueRight('Ukupno prihvatljivi troškovi') * 100)).toBe(sub.totals.total);
    expect(Math.round(valueRight('Traženi iznos (doprinos)') * 100)).toBe(sub.totals.requested);
    const s2 = readSheet(x, 2);
    expect([...s2.values()].filter((c) => c.v === 'evidencija rada (timesheet)')).toHaveLength(3); // Đurđica po dva radna paketa + Ivan
    const s3 = readSheet(x, 3);
    expect([...s3.values()].map((c) => c.v)).toEqual(expect.arrayContaining(['Đurđica Šimić-Ćorić', 'Ivan Horvat']));
    expect(x.get('xl/worksheets/sheet2.xml')).toContain('state="frozen"');

    // Evidencije rada: prave osobe i mjeseci, status i potpisi.
    const rec = files.get('evidencije-rada/Durdica-Simic-Coric_2025-02.html')!.toString('utf8');
    expect(rec).toContain('Đurđica Šimić-Ćorić'); expect(rec).toContain('veljača 2025.'); expect(rec).toContain('UG-2025/č-01');
    expect(rec).toContain('odobren i zaključan'); expect(rec).toContain('Nadređeni / voditelj projekta'); expect(rec).not.toContain('NACRT');
    expect(rec).toContain('Ukupno sati na projektu: <b>14 h</b>');
    // Kontrolna lista: snimka pri predaji i potvrđeni trošak bez dokaza.
    const cl = files.get('kontrolna-lista.html')!.toString('utf8');
    expect(cl).toContain('Popis za provjeru pri predaji'); expect(cl).toContain('izričito potvrđeni'); expect(cl).toContain('Tisak letaka');
  });

  it('povjerljivi dokaz: bez dozvole izostavljen (naziv skriven, u manifestu), s dozvolom uključen; drugi projekt i stanar → 404', async () => {
    const reader = await exportOf(claim1, t.rdr!);
    expect([...reader.files.keys()].some((f) => f.includes('putni-nalog'))).toBe(false);
    const omitted = manifest(reader.files).filter((r) => r[0] === 'izostavljeno');
    expect(omitted).toHaveLength(1); expect(omitted[0]![4]).toMatch(/povjerljivi dokaz uz trošak br\. 1/); expect(omitted[0]![4]).not.toContain('putni');
    expect(reader.files.get('kontrolna-lista.html')!.toString()).toContain('Povjerljivi dokazi');
    const x = new Map(readZip(reader.files.get('troskovi.xlsx')!).map((e) => [e.name, e.data.toString('utf8')]));
    expect([...readSheet(x, 2).values()].some((c) => c.v === '[povjerljivi dokaz – izostavljen]')).toBe(true);
    expect([...readSheet(x, 3).values()].some((c) => c.v.startsWith('Stopa se prikazuje samo uz pristup'))).toBe(true);
    const fin = await exportOf(claim1, t.fin!);
    expect([...fin.files.keys()]).toContain('dokazi/001_2025-02-20_Putni-nalog-Zagreb-Split/putni-nalog.pdf');
    await http().get(`/api/projects/${pid}/claims/${claim1}/export`).set(auth(t.pm2!)).expect(404);
    await http().get(`/api/projects/${pid}/claims/${claim1}/export`).set(auth(t.other!)).expect(404);
    await http().get(`/api/projects/${otherPid}/claims/${claim1}/export`).set(auth(t.admin!)).expect(404);
  });

  it('dva izvoza istih podataka: iste datoteke (usporedivo); svaki izvoz u reviziji', async () => {
    const a = await exportOf(claim1); const b = await exportOf(claim1);
    for (const f of a.files.keys()) if (f !== 'sadrzaj.csv') expect(sha(a.files.get(f)!), f).toBe(sha(b.files.get(f)!));
    const { rows } = await owner.query<{ action: string; diff: { meta: Record<string, unknown> }; actor_id: string }>(`select action, diff, actor_id from audit_entries where entity = 'claim' and entity_id = $1 and action = 'export' order by id`, [claim1]);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.at(-1)!.diff.meta).toMatchObject({ status: 'submitted', draft: false, evidence: 3, omittedConfidential: 0 });
  });

  it('oštećena datoteka u pohrani prekida izvoz jasnom porukom (409) i bilježi neuspjeh; prevelik paket se odbija', async () => {
    const { rows: [v] } = await owner.query<{ storage_key: string }>('select storage_key from document_versions where document_id = $1', [confidentialDoc]);
    const path = join(process.env.DOCUMENTS_DIR!, v!.storage_key);
    const original = readFileSync(path);
    writeFileSync(path, Buffer.concat([original, Buffer.from('izmijenjeno')]));
    try {
      const r = await http().get(`/api/projects/${pid}/claims/${claim1}/export`).set(auth(t.admin!)).expect(409);
      expect(r.body.message).toMatch(/provjera cjelovitosti dokaza „dokazi\/001_2025-02-20_Putni-nalog-Zagreb-Split\/putni-nalog\.pdf” nije uspjela/);
      const { rows } = await owner.query(`select diff from audit_entries where entity = 'claim' and entity_id = $1 and action = 'export.failed'`, [claim1]);
      expect(rows).toHaveLength(1);
    } finally { writeFileSync(path, original); }
    process.env.CLAIM_EXPORT_MAX_BYTES = '50';
    try {
      const r = await http().get(`/api/projects/${pid}/claims/${claim1}/export`).set(auth(t.admin!)).expect(409);
      expect(r.body.message).toMatch(/najviše/);
    } finally { delete process.env.CLAIM_EXPORT_MAX_BYTES; }
    await exportOf(claim1);
  });

  it('odluka: priznato i nepriznato po kategoriji u radnoj knjizi', async () => {
    await http().post(`/api/projects/${pid}/claims/${claim1}/decision`).set(auth(t.admin!)).send({ decision: 'decided', expenses: [{ id: vuExpense, recognised: 200_000, reason: 'Priznato do iznosa iz ugovora.' }] }).expect(201);
    const c = await claim(claim1);
    const { files } = await exportOf(claim1);
    const x = new Map(readZip(files.get('troskovi.xlsx')!).map((e) => [e.name, e.data.toString('utf8')]));
    const s1 = readSheet(x, 1);
    const ref = [...s1].find(([, v]) => v.v === 'VU')![0].replace(/[A-Z]+/, '');
    expect(Number(s1.get(`C${ref}`)!.v)).toBe(2500); expect(Number(s1.get(`D${ref}`)!.v)).toBe(2000); expect(Number(s1.get(`E${ref}`)!.v)).toBe(500);
    const req = [...s1].find(([, v]) => v.v === 'Traženi iznos (doprinos)')![0].replace(/[A-Z]+/, '');
    expect(Math.round(Number(s1.get(`D${req}`)!.v) * 100)).toBe(c.recognised.requested);
  });

  it('trošak iz ranijeg razdoblja: vidljiv i izričito uključiv; signal u financijama i portfelju; jedan nacrt', async () => {
    lateExpense = await expense({ categoryCode: 'VU', date: '2025-03-28', description: 'Kasno evidentiran račun za anketu', supplier: 'Istraživanja d.o.o.', amount: 40_000 });
    await upload(t.admin!, lateExpense, 'kasni-racun.pdf', PDF('kasni'));
    expect((await http().get(`/api/projects/${pid}/finance`).set(auth(t.admin!)).expect(200)).body.strandedExpenses).toEqual({ count: 1, amount: 40_000 });
    const pf = (await http().get('/api/portfolio').set(auth(t.admin!)).expect(200)).body;
    expect(pf.projects.find((p: { id: string }) => p.id === pid).attention.strandedExpenses).toBe(1);

    claim2 = (await http().post(`/api/projects/${pid}/claims`).set(auth(t.admin!)).send({ period: 2 }).expect(201)).body.id;
    claim3 = (await http().post(`/api/projects/${pid}/claims`).set(auth(t.admin!)).send({ period: 3 }).expect(201)).body.id;
    let c2 = await claim(claim2);
    expect(c2.expenses.map((e: { id: string }) => e.id)).not.toContain(lateExpense);
    expect(c2.earlierCandidates).toEqual([expect.objectContaining({ id: lateExpense, period: 1, selected: false, selectedElsewhere: null, documents: 1 })]);
    expect(c2.checklist.items.find((i: { key: string }) => i.key === 'earlier_periods')).toMatchObject({ ok: false, severity: 'warning' });

    // Odabir: samo nepredani trošak ranijeg razdoblja; čitatelj ne smije; drugi nacrt ga ne može uzeti.
    await http().put(`/api/projects/${pid}/claims/${claim2}/earlier-expenses`).set(auth(t.rdr!)).send({ expenseIds: [lateExpense] }).expect(403);
    await http().put(`/api/projects/${pid}/claims/${claim2}/earlier-expenses`).set(auth(t.admin!)).send({ expenseIds: [vuExpense] }).expect(400);
    c2 = (await http().put(`/api/projects/${pid}/claims/${claim2}/earlier-expenses`).set(auth(t.admin!)).send({ expenseIds: [lateExpense] }).expect(200)).body;
    expect(c2.expenses.find((e: { id: string }) => e.id === lateExpense)).toMatchObject({ earlier: true });
    expect(c2.checklist.items.find((i: { key: string }) => i.key === 'dates_in_period')).toMatchObject({ ok: true, title: 'Svi ostali troškovi su unutar razdoblja' });
    expect(c2.checklist.items.find((i: { key: string }) => i.key === 'earlier_periods')).toMatchObject({ ok: true });
    expect(c2.totals.byCategory.VU).toBe(40_000);
    const r = await http().put(`/api/projects/${pid}/claims/${claim3}/earlier-expenses`).set(auth(t.admin!)).send({ expenseIds: [lateExpense] }).expect(400);
    expect(r.body.issues[0]).toMatch(/već je odabran u nacrtu ZNS-a za RP2/);
    expect((await claim(claim3)).earlierCandidates[0]).toMatchObject({ selectedElsewhere: 2, selected: false });
    expect((await http().get(`/api/projects/${pid}/finance`).set(auth(t.admin!)).expect(200)).body.strandedExpenses.count).toBe(0);

    // Paket nacrta RP2 označava trošak iz ranijeg razdoblja.
    const { files } = await exportOf(claim2);
    const x = new Map(readZip(files.get('troskovi.xlsx')!).map((e) => [e.name, e.data.toString('utf8')]));
    expect([...readSheet(x, 2).values()].some((c) => c.v === 'ranije razdoblje')).toBe(true);
    expect(files.get('kontrolna-lista.html')!.toString()).toContain('Troškovi iz ranijih razdoblja – izričito uključeni (1)');
    expect([...files.keys()]).toContain('dokazi/001_2025-03-28_Kasno-evidentiran-racun-za-anketu/kasni-racun.pdf');

    // Predaja RP2 (bez troškova u razdoblju osim kasnog) pridružuje i kasni trošak.
    const sub = (await http().post(`/api/projects/${pid}/claims/${claim2}/submit`).set(auth(t.admin!)).send({}).expect(201)).body;
    expect(sub.expenses.map((e: { id: string }) => e.id)).toEqual([lateExpense]);
    expect(sub.preparation).toMatchObject({ hours: null, measures: expect.objectContaining({ earlierExpenses: 1 }) });
    expect((await claim(claim3)).earlierCandidates).toEqual([]);
  });

  it('mjerenje: povrat na dopunu se broji; sati se mogu upisati naknadno (ne u nacrtu)', async () => {
    await http().post(`/api/projects/${pid}/claims/${claim2}/decision`).set(auth(t.admin!)).send({ decision: 'returned', note: 'Nedostaje izjava o nabavi.' }).expect(201);
    await http().put(`/api/projects/${pid}/claims/${claim2}/preparation-hours`).set(auth(t.admin!)).send({ hours: 3 }).expect(409);
    await http().post(`/api/projects/${pid}/claims/${claim2}/submit`).set(auth(t.admin!)).send({ preparationHours: 6 }).expect(201);
    let c2 = await claim(claim2);
    expect(c2.preparation).toMatchObject({ hours: 6, measures: expect.objectContaining({ returns: 1 }) });
    await http().put(`/api/projects/${pid}/claims/${claim2}/preparation-hours`).set(auth(t.rdr!)).send({ hours: 7.5 }).expect(403);
    c2 = (await http().put(`/api/projects/${pid}/claims/${claim2}/preparation-hours`).set(auth(t.admin!)).send({ hours: 7.5 }).expect(200)).body;
    expect(c2.preparation.hours).toBe(7.5);
    await http().put(`/api/projects/${pid}/claims/${claim2}/preparation-hours`).set(auth(t.admin!)).send({ hours: -1 }).expect(400);
  });

  it('ušteda na ZNS-u: bez polazne mjere objašnjava; ured upisuje polaznu mjeru; pristup po pravilima portfelja', async () => {
    let s = (await http().get('/api/portfolio/claim-savings').set(auth(t.rdr!)).expect(200)).body;
    expect(s).toMatchObject({ status: 'no_baseline', missing: ['baseline'], submittedClaims: 2, reportedClaims: 2, averageHours: 10, canEditBaseline: false });
    await http().put('/api/portfolio/claim-savings/baseline').set(auth(t.rdr!)).send({ hours: 20 }).expect(403);
    await http().put('/api/portfolio/claim-savings/baseline').set(auth(t.fin!)).send({ hours: 20 }).expect(403);
    await http().get('/api/portfolio/claim-savings').set(auth(t.pm!)).expect(403);
    await http().put('/api/portfolio/claim-savings/baseline').set(auth(t.ured!)).send({ hours: 0 }).expect(400);
    s = (await http().put('/api/portfolio/claim-savings/baseline').set(auth(t.ured!)).send({ hours: 20 }).expect(200)).body;
    // (12,5 + 7,5) / 2 = 10 h prema 20 h → 50 %.
    expect(s).toMatchObject({ status: 'ok', baselineHours: 20, averageHours: 10, savingHours: 10, savingPercent: 50, meetsTarget: true, canEditBaseline: true });
    expect(s.automatic).toMatchObject({ claims: 2, returns: 1, claimsReturned: 1 });
    expect(s.claims.map((c: { acronym: string; period: number }) => `${c.acronym} RP${c.period}`).sort()).toEqual(['ŽITO-LAB RP1', 'ŽITO-LAB RP2']);
    const { rows } = await owner.query(`select diff from audit_entries where tenant_id = $1 and entity = 'tenant' and action = 'settings.update'`, [tenantId]);
    expect(rows).toHaveLength(1);
    expect((await owner.query<{ settings: Record<string, unknown> }>('select settings from tenants where id = $1', [tenantId])).rows[0]!.settings.claimBaselineHours).toBe(20);
    s = (await http().put('/api/portfolio/claim-savings/baseline').set(auth(t.admin!)).send({ hours: null }).expect(200)).body;
    expect(s.status).toBe('no_baseline');
    await http().put('/api/portfolio/claim-savings/baseline').set(auth(t.admin!)).send({ hours: 20 }).expect(200);
  });

  it('evidencija rada za ispis (isti dokument kao u paketu): HTML s CSP-om; tuđi projekt 404', async () => {
    const r = await http().get(`/api/projects/${pid}/team/${durdica}/timesheets/2025-02/record`).set(auth(t.pm!)).expect(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.text).toContain('Evidencija radnog vremena na projektu'); expect(r.text).toContain('Đurđica Šimić-Ćorić');
    const { files } = await exportOf(claim1);
    expect(files.get('evidencije-rada/Durdica-Simic-Coric_2025-02.html')!.toString('utf8')).toBe(r.text);
    const empty = await http().get(`/api/projects/${pid}/team/${ivan}/timesheets/2025-06/record`).set(auth(t.admin!)).expect(200);
    expect(empty.text).toContain('nije unesen');
    await http().get(`/api/projects/${pid}/team/${durdica}/timesheets/2025-02/record`).set(auth(t.pm2!)).expect(404);
  });
});
