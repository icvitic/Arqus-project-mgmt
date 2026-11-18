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
import { DigestService } from '../src/me/digest.service';
import { MAIL_SETTINGS, MAIL_TRANSPORT, type MailSettings, type MailTransport } from '../src/mail/mail-config';
import { SmtpError, type OutgoingMail } from '../src/mail/smtp-client';
import { buildAccessFixture, type AccessFixture } from './access-fixture';
import { inviteUser } from './invite';

const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const SETTINGS: MailSettings = { enabled: true, publicUrl: 'https://projekti.institucija.hr', from: { address: 'arqus@institucija.hr', name: 'ArQus Projekti' }, smtp: null, maxConcurrency: 2, digestHour: 7 };

/** Pon–pet; 08:00 po Zagrebu ljeti = 06:00 UTC. */
const THU = new Date('2027-07-15T06:00:00Z');
const FRI = new Date('2027-07-16T06:30:00Z');
const SAT = new Date('2027-07-17T06:00:00Z');
const MON = new Date('2027-07-19T06:15:00Z');
const TUE_EARLY = new Date('2027-07-20T04:30:00Z'); // 06:30 po Zagrebu – prije 7:00
const TUE = new Date('2027-07-20T07:00:00Z');

function capture(fail: Set<string> = new Set()): MailTransport & { sent: OutgoingMail[] } {
  const sent: OutgoingMail[] = [];
  return {
    sent,
    send: async (m) => {
      await new Promise((r) => setTimeout(r, 5)); // stvarni relay nije trenutan – istovremena izvođenja se preklapaju
      if (fail.has(m.to.address)) throw Object.assign(new SmtpError('rejected', false, 'odbijeno'), { attempts: 1 });
      sent.push(m); return { attempts: 1 };
    },
  };
}

async function app(transport: MailTransport): Promise<INestApplication> {
  const m = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MAIL_SETTINGS).useValue(SETTINGS).overrideProvider(MAIL_TRANSPORT).useValue(transport).compile();
  const a = m.createNestApplication(); a.setGlobalPrefix('api'); await a.init();
  return a;
}

/** Pozivnica kroz instancu bez e-pošte (token u odgovoru), kao u ostalim testovima. */
async function inviteUserNoMail(adminToken: string, user: { email: string; displayName: string }, password: string) {
  const plain = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const a0 = plain.createNestApplication(); a0.setGlobalPrefix('api'); await a0.init();
  try { return await inviteUser(a0, adminToken, user, password); } finally { await a0.close(); }
}

describe('Dnevni sažetak e-poštom (WP1.21, e2e)', () => {
  let a1: INestApplication; let a2: INestApplication; let f: AccessFixture; let tenantId = '';
  const fail = new Set<string>();
  const t1 = capture(fail); const t2 = capture(fail);
  const owner = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const tag = randomUUID().slice(0, 8);
  const email = (k: string) => `${k}@dg-${tag}.hr`;
  /** Primatelji SAŽETAKA (pozivnice koje instanca s poštom usput šalje ne broje se). */
  const to = (t: { sent: OutgoingMail[] }) => t.sent.filter((m) => m.subject.startsWith('ArQus:')).map((m) => m.to.address).sort();
  const run = (a: INestApplication, now: Date, opts: { maxMs?: number } = {}) => a.get(DigestService).run(now, { tenantIds: [tenantId], ...opts });

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), 'arqus-digest-'));
    // Korisnike stvara instanca bez e-pošte (pozivnica s tokenom kroz API, kao administrator bez pošte); sažetak šalju
    // dvije instance s e-poštom nad istom bazom.
    const plain = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const a0 = plain.createNestApplication(); a0.setGlobalPrefix('api'); await a0.init();
    try { f = await buildAccessFixture(a0, `dg-${tag}`, { proposals: true }); } finally { await a0.close(); }
    a1 = await app(t1); a2 = await app(t2);
    tenantId = (await owner.query(`select id from tenants where slug = $1`, [f.slug])).rows[0].id;
  }, 90_000);
  afterAll(async () => { await a1.close(); await a2.close(); await owner.end(); });

  it('radni dan u 8:00: sažetak dobivaju samo korisnici kojima nešto kasni, dospijeva ili imaju novu obavijest; sadržaj = „Moj rad” bez iznosa i tuđih projekata', async () => {
    const r = await run(a1, THU);
    expect(r.tenants).toBe(1);
    const got = to(t1);
    expect(got).toEqual(expect.arrayContaining([email('tm'), email('pm'), email('fin')]));
    expect(got).not.toContain(email('rdr')); // nema stavki ni obavijesti → ništa
    expect(r.sent).toBe(got.length); expect(r.claimed).toBe(r.sent + r.empty + r.skipped + r.failed);
    const tm = t1.sent.find((m) => m.to.address === email('tm'))!;
    expect(tm.subject).toMatch(/^ArQus: \d+ kasni/);
    expect(tm.text).toContain(`[PA${f.slug.slice(-4)}] Timesheet za`);
    expect(tm.text).toContain('https://projekti.institucija.hr/#/moj-rad');
    expect(tm.text).toContain('Moj račun → Dnevni sažetak e-poštom');
    for (const m of t1.sent.filter((x) => [email('tm'), email('pm'), email('lead')].includes(x.to.address))) {
      expect(m.text + m.html).not.toContain(`PB${f.slug.slice(-4)}`); // uloge samo na projektu A (financije institucije vide i B)
    }
    for (const m of t1.sent) {
      expect(m.text).not.toMatch(/€|EUR|\d{1,3}(\.\d{3})*,\d{2}/);
      expect(m.text).not.toMatch(/#\/(pozivnica|lozinka)\//);
    }
    // Broj u naslovu odgovara popisu (najviše 15 stavki uz „i još N”).
    const overdue = Number(/^ArQus: (\d+) kasni/.exec(tm.subject)![1]);
    const listed = tm.text.split('Kasni (')[1]!.split('\n\n')[1]!.split('\n').filter((l) => l.startsWith('- ')).length;
    expect(listed).toBe(Math.min(overdue, 15));
    // Zapis isporuke bez sadržaja.
    const deliveries = (await owner.query(`select kind, outcome from mail_deliveries where tenant_id = $1 and kind = 'digest'`, [tenantId])).rows;
    expect(deliveries.length).toBe(got.length);
  });

  it('jednom dnevno: ponovno izvođenje istog dana i dvije instance istovremeno ne šalju ništa dvaput', async () => {
    const before = t1.sent.length;
    expect((await run(a1, new Date(THU.getTime() + 3600_000))).claimed).toBe(0);
    expect(t1.sent.length).toBe(before);
    // Petak: dvije instance (dvije aplikacije, ista baza) istovremeno.
    t1.sent.length = 0; t2.sent.length = 0;
    const [r1, r2] = await Promise.all([run(a1, FRI), run(a2, FRI)]);
    const all = [...to(t1), ...to(t2)].sort();
    expect(new Set(all).size).toBe(all.length); // nitko dvaput
    expect(all).toEqual(expect.arrayContaining([email('tm'), email('pm')]));
    expect(r1.sent + r2.sent).toBe(all.length);
    const dup = (await owner.query(`select user_id, count(*)::int as n from digest_runs where tenant_id = $1 group by user_id, day having count(*) > 1`, [tenantId])).rows;
    expect(dup).toEqual([]);
  });

  it('vikend i prije 7:00 ništa; isključen sažetak vrijedi odmah; tko se ne može prijaviti ne dobiva ništa; jedan neuspio pretinac ne zaustavlja ostale', async () => {
    t1.sent.length = 0;
    expect((await run(a1, SAT)).tenants).toBe(0);
    expect((await run(a1, TUE_EARLY)).tenants).toBe(0);
    expect(t1.sent).toEqual([]);
    // Korisnik isključuje sažetak.
    const off = (await request(a1.getHttpServer()).put('/api/me/digest').set({ Authorization: `Bearer ${f.tokens.tm}` }).send({ enabled: false }).expect(200)).body;
    expect(off).toEqual({ enabled: false, mailEnabled: true, hour: 7 });
    await request(a1.getHttpServer()).put('/api/me/digest').set({ Authorization: `Bearer ${f.tokens.tm}` }).send({ enabled: 'ne' }).expect(400);
    // Pozvan korisnik s pristupom projektu (ima obavijest), deaktiviran korisnik i korisnik bez obveznog MFA.
    const admin = { Authorization: `Bearer ${f.tokens.admin}` };
    const invited = (await request(a1.getHttpServer()).post('/api/users').set(admin).send({ email: email('pozvan'), displayName: 'Pozvan' }).expect(201)).body.id;
    await request(a1.getHttpServer()).post(`/api/projects/${f.A.id}/access`).set(admin).send({ userId: invited, roleCode: 'team-member' }).expect(201);
    const gone = await inviteUserNoMail(f.tokens.admin, { email: email('otisao'), displayName: 'Otišao' }, 'Plava-Staza-2027-x');
    await request(a1.getHttpServer()).post(`/api/projects/${f.A.id}/access`).set(admin).send({ userId: gone.id, roleCode: 'team-member' }).expect(201);
    await request(a1.getHttpServer()).patch(`/api/users/${gone.id}`).set(admin).send({ status: 'disabled' }).expect(200);
    // Nova obavijest voditelju prijave nakon prethodnog sažetka (dobio je pristup projektu B) – jedini razlog za njegov sažetak.
    await request(a1.getHttpServer()).post(`/api/projects/${f.B.id}/access`).set(admin).send({ userId: f.users.lead, roleCode: 'reader' }).expect(201);
    await owner.query(`update tenants set settings = settings || '{"requireMfa":"privileged"}'::jsonb where id = $1`, [tenantId]); // financije bez MFA
    fail.add(email('pm'));
    try {
      const r = await run(a1, MON);
      const got = to(t1);
      expect(got).not.toContain(email('tm'));
      expect(got).not.toContain(email('pozvan'));
      expect(got).not.toContain(email('otisao'));
      expect(got).not.toContain(email('fin'));
      expect(got).not.toContain(email('pm')); // neuspjelo – ali ostali su dobili
      expect(got).toContain(email('lead'));
      expect(t1.sent.find((m) => m.to.address === email('lead') && m.subject.startsWith('ArQus:'))!.subject).toBe('ArQus: 1 nova obavijest');
      expect(r.failed).toBe(1); expect(r.skipped).toBeGreaterThanOrEqual(1);
      const outcome = async (k: string) => (await owner.query(`select d.outcome from digest_runs d join users u on u.id = d.user_id where d.tenant_id = $1 and u.email = $2 and d.day = '2027-07-19'`, [tenantId, email(k)])).rows[0]?.outcome;
      expect(await outcome('pm')).toBe('failed');
      expect(await outcome('fin')).toBe('skipped');
      expect(await outcome('tm')).toBeUndefined();
      expect((await owner.query(`select error_class from mail_deliveries m join users u on u.id = m.user_id where m.tenant_id = $1 and u.email = $2 and m.kind = 'digest' order by m.id desc limit 1`, [tenantId, email('pm')])).rows[0].error_class).toBe('rejected');
    } finally {
      fail.clear();
      await owner.query(`update tenants set settings = settings - 'requireMfa' where id = $1`, [tenantId]);
    }
    // Ponovno uključen – vrijedi od sljedećeg izvođenja.
    await request(a1.getHttpServer()).put('/api/me/digest').set({ Authorization: `Bearer ${f.tokens.tm}` }).send({ enabled: true }).expect(200);
    t1.sent.length = 0;
    await run(a1, TUE);
    expect(to(t1)).toContain(email('tm'));
  });

  it('vremensko ograničenje izvođenja: nakon roka ništa se ne preuzima (ostatak čeka sljedeću provjeru)', async () => {
    const r = await run(a1, new Date('2027-07-21T06:00:00Z'), { maxMs: -1 });
    expect(r.stoppedEarly).toBe(true); expect(r.claimed).toBe(0);
    expect((await run(a1, new Date('2027-07-21T06:05:00Z'))).claimed).toBeGreaterThan(0);
  });
});
