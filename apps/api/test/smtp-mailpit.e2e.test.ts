import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';
import { AccountService } from '../src/identity/account.service';
import { smtpSend, SmtpError } from '../src/mail/smtp-client';
import { TEST_CERT } from './smtp-fake';

/**
 * WP1.21 – SMTP klijent i cijeli put pozivnice nad STVARNIM SMTP poslužiteljem (Mailpit u Dockeru: `sh scripts/smtp-test.sh up`)
 * sa STARTTLS-om (testni certifikat) i obveznom prijavom. Bez TEST_SMTP_PORT preskače se s vidljivom porukom; ako je
 * postavljen, a poslužitelj ne radi, test PADA (nikad tiho ne prolazi).
 */
const PORT = process.env.TEST_SMTP_PORT ?? '';
const API = process.env.TEST_SMTP_API ?? 'http://127.0.0.1:8125';
const enabled = PORT !== '';
const SKIP = '[WP1.21] TEST_SMTP_PORT nije postavljen – testovi nad stvarnim SMTP poslužiteljem (Mailpit) se PRESKAČU. Pokreni: sh scripts/smtp-test.sh up, zatim TEST_SMTP_PORT=1125 TEST_SMTP_API=http://127.0.0.1:8125';
if (!enabled) console.warn(SKIP);
const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
const USER = 'arqus-test', PASS = 'arqus-test-secret-123';

interface MpSummary { ID: string; Subject: string; To: { Address: string; Name: string }[] }
async function waitFor(address: string, timeoutMs = 10_000): Promise<{ Subject: string; Text: string; HTML: string; From: { Address: string; Name: string }; To: { Address: string; Name: string }[] }> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await fetch(`${API}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
    const list = (await r.json()) as { messages: MpSummary[] };
    if (list.messages?.length) return (await (await fetch(`${API}/api/v1/message/${list.messages[0]!.ID}`)).json()) as never;
    await new Promise((x) => setTimeout(x, 200));
  }
  throw new Error(`Poruka za ${address} nije stigla u Mailpit`);
}

describe.skipIf(!enabled)('SMTP nad stvarnim poslužiteljem – Mailpit (WP1.21)', () => {
  const tag = randomUUID().slice(0, 8);
  const cfg = { host: 'localhost', port: Number(PORT), security: 'starttls' as const, user: USER, password: PASS, ca: TEST_CERT, timeoutMs: 10_000, retries: 0, heloName: 'arqus.test' };

  it('STARTTLS + AUTH: poruka stiže s ispravno dekodiranim naslovom, imenima, tekstom i HTML-om', async () => {
    const to = `ana-${tag}@institucija.hr`;
    const subject = 'Pozivnica u ArQus Projekti – Sveučilište u Đakovu (čćžšđ)';
    await smtpSend(cfg, { from: { address: 'arqus@institucija.hr', name: 'ArQus Projekti' }, to: { address: to, name: 'Ana Horvat-Đurić' }, subject, text: 'Pozdrav, Ana!\n.\nDrugi redak €', html: '<p>Pozdrav, <b>Ana</b>!</p>' });
    const m = await waitFor(to);
    expect(m.Subject).toBe(subject);
    expect(m.From).toMatchObject({ Address: 'arqus@institucija.hr', Name: 'ArQus Projekti' });
    expect(m.To[0]).toMatchObject({ Address: to, Name: 'Ana Horvat-Đurić' });
    expect(m.Text.replace(/\r\n/g, '\n').trim()).toBe('Pozdrav, Ana!\n.\nDrugi redak €');
    expect(m.HTML).toContain('<b>Ana</b>');
  });

  it('kriva lozinka → trajna greška „auth”; nepouzdan certifikat → „tls”', async () => {
    const e1 = await smtpSend({ ...cfg, password: 'kriva' }, { from: { address: 'a@institucija.hr' }, to: { address: 'b@institucija.hr' }, subject: 'x', text: 'x', html: 'x' }).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(SmtpError); expect((e1 as SmtpError).cls).toBe('auth');
    const e2 = await smtpSend({ ...cfg, ca: undefined }, { from: { address: 'a@institucija.hr' }, to: { address: 'b@institucija.hr' }, subject: 'x', text: 'x', html: 'x' }).catch((e: unknown) => e);
    expect((e2 as SmtpError).cls).toBe('tls');
  });

  describe('cijeli put: aplikacija s MAIL_TRANSPORT=smtp šalje pozivnicu, korisnik je prihvaća', () => {
    let app: INestApplication; const slug = `mp-${tag}`; let admin = '';
    const saved: Record<string, string | undefined> = {};
    const env = { MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'localhost', SMTP_PORT: PORT, SMTP_SECURITY: 'starttls', SMTP_USER: USER, SMTP_PASSWORD: PASS, SMTP_TLS_CA_FILE: join(__dirname, 'fixtures', 'smtp-test.crt'), MAIL_FROM: 'arqus@institucija.hr', MAIL_FROM_NAME: 'ArQus Projekti', PUBLIC_URL: 'https://projekti.institucija.hr' };
    beforeAll(async () => {
      process.env.DATABASE_URL = APP_URL;
      for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
      await seedDemo({ url: ADMIN_URL, tenantSlug: slug, tenantName: 'Mailpit institut', adminEmail: `a@${slug}.hr`, adminPassword: 'Lozinka-123456', importPackages: false });
      const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
      admin = (await request(app.getHttpServer()).post('/api/auth/login').send({ tenantSlug: slug, email: `a@${slug}.hr`, password: 'Lozinka-123456' }).expect(201)).body.accessToken;
    });
    afterAll(async () => {
      await app?.close();
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    });

    it('pozivnica stiže u pretinac; poveznica iz PUBLIC_URL; prihvaćanje radi; isporuka zabilježena', async () => {
      const email = `novi-${tag}@institucija.hr`;
      const r = await request(app.getHttpServer()).post('/api/users').set({ Authorization: `Bearer ${admin}` }).send({ email, displayName: 'Novi Korisnik' }).expect(201);
      expect(r.body.invitation.token).toBeUndefined();
      await app.get(AccountService).idle();
      const m = await waitFor(email);
      expect(m.Subject).toBe('Pozivnica u ArQus Projekti – Mailpit institut');
      const token = /https:\/\/projekti\.institucija\.hr\/#\/pozivnica\/([A-Za-z0-9_-]{43})/.exec(m.Text)![1]!;
      await request(app.getHttpServer()).post('/api/auth/invitation/accept').send({ token, password: 'Plava-Staza-2027-x' }).expect(201);
      const st = (await request(app.getHttpServer()).get('/api/tenant/mail').set({ Authorization: `Bearer ${admin}` }).expect(200)).body;
      expect(st.recent[0]).toMatchObject({ kind: 'invite', outcome: 'sent' });
    });
  });
});
