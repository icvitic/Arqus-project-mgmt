import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { configureHttp } from '../src/common/http-setup';
import { seedDemo } from '../src/db/seed';
import { AccountService } from '../src/identity/account.service';
import { MAIL_SETTINGS, MAIL_TRANSPORT, mailSettingsFromEnv, type MailSettings, type MailTransport } from '../src/mail/mail-config';
import { SmtpError, type OutgoingMail } from '../src/mail/smtp-client';
import { base32Decode, hotp } from '../src/identity/totp';
import { inviteUser } from './invite';

const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
const PW = 'Plava-Staza-2027-x';
const codeAt = (secret: string, offsetSteps = 0) => hotp(base32Decode(secret), Math.floor(Date.now() / 30_000) + offsetSteps);
const TOKEN_IN_LINK = /#\/(pozivnica|lozinka)\/([A-Za-z0-9_-]{43})/;

/** Hvatanje izlaza procesa (dnevnik) tijekom testa – token se ne smije pojaviti ni u jednom retku. */
const output: string[] = [];
const capture = () => {
  for (const stream of [process.stdout, process.stderr]) {
    const orig = stream.write.bind(stream);
    vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => { output.push(String(chunk)); return (orig as (...a: unknown[]) => boolean)(chunk, ...rest); }) as typeof stream.write);
  }
  for (const m of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    // eslint-disable-next-line no-console -- hvatanje svega što test zapiše u dnevnik (provjera da tokena nema)
    const orig = console[m].bind(console);
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { output.push(a.map(String).join(' ')); orig(...a); });
  }
};

/** Svi tokeni koje je test vidio (odgovori API-ja i uhvaćene poruke) – na kraju se traže u bazi, reviziji i dnevniku. */
const seenTokens = new Set<string>();

async function makeApp(mail?: { settings: MailSettings; transport: MailTransport }): Promise<NestExpressApplication> {
  let b = Test.createTestingModule({ imports: [AppModule] });
  if (mail) b = b.overrideProvider(MAIL_SETTINGS).useValue(mail.settings).overrideProvider(MAIL_TRANSPORT).useValue(mail.transport);
  const m = await b.compile();
  const app = m.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureHttp(app, false);
  await app.init();
  return app;
}

describe('Računi bez dijeljenja lozinki (WP1.21, e2e)', () => {
  const owner = new Pool({ connectionString: ADMIN_URL, max: 2 });
  const tag = randomUUID().slice(0, 8);
  afterAll(async () => { await owner.end(); });
  beforeAll(() => { process.env.DATABASE_URL = APP_URL; capture(); });

  // ------------------------------------------------------------------------------------------------------------------
  describe('bez e-pošte: poveznicu dobiva administrator (ručna predaja)', () => {
    let app: NestExpressApplication; const slug = `ac-${tag}`; let admin = ''; let adminId = ''; let tenantId = '';
    let ip = 1;
    const http = () => request(app.getHttpServer());
    const anon = () => ({ 'X-Forwarded-For': `10.21.${Math.floor(ip / 250)}.${ip++ % 250}` });
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const invite = async (local: string, roleCodes: string[] = []) => {
      const r = await http().post('/api/users').set(auth(admin)).send({ email: `${local}@${slug}.hr`, displayName: `Osoba ${local}`, roleCodes }).expect(201);
      seenTokens.add(r.body.invitation.token);
      return { id: r.body.id as string, token: r.body.invitation.token as string, body: r.body };
    };
    const accept = (token: string, password = PW) => http().post('/api/auth/invitation/accept').set(anon()).send({ token, password });
    let invalidBody: unknown;

    beforeAll(async () => {
      tenantId = (await seedDemo({ url: ADMIN_URL, tenantSlug: slug, tenantName: 'Institut Pozivnica', adminEmail: `a@${slug}.hr`, adminPassword: 'Lozinka-123456', importPackages: false })).tenantId;
      app = await makeApp();
      const login = await http().post('/api/auth/login').send({ tenantSlug: slug, email: `a@${slug}.hr`, password: 'Lozinka-123456' }).expect(201);
      admin = login.body.accessToken; adminId = login.body.user.id;
      invalidBody = (await http().post('/api/auth/invitation/accept').set(anon()).send({ token: 'x'.repeat(43), password: PW }).expect(400)).body;
    });
    afterAll(async () => { await app.close(); });

    it('stvaranje korisnika bez lozinke: stanje „pozvan”, token jednom administratoru (256 bita, 7 dana), prijava nije moguća', async () => {
      const r = await http().post('/api/users').set(auth(admin)).send({ email: `ana@${slug}.hr`, displayName: 'Ana Horvat', roleCodes: ['finance'] }).expect(201);
      expect(r.body.status).toBe('invited');
      expect(r.body.invitation.delivery).toBe('link');
      expect(r.body.invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seenTokens.add(r.body.invitation.token);
      const ttl = new Date(r.body.invitation.expiresAt).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(7 * 86_400_000 - 60_000); expect(ttl).toBeLessThanOrEqual(7 * 86_400_000);
      for (const password of ['', 'Plava-Staza-2027-x', 'Lozinka-123456']) await http().post('/api/auth/login').set(anon()).send({ tenantSlug: slug, email: `ana@${slug}.hr`, password: password || 'x' }).expect(401);
      // Lozinka pri stvaranju i izmjeni korisnika više ne postoji (400), a stara ruta za upisivanje tuđe lozinke je uklonjena (404).
      await http().post('/api/users').set(auth(admin)).send({ email: `b@${slug}.hr`, displayName: 'Bez', password: PW }).expect(400);
      await http().patch(`/api/users/${r.body.id}`).set(auth(admin)).send({ password: PW }).expect(400);
      await http().post(`/api/users/${r.body.id}/reset-password`).set(auth(admin)).send({ newPassword: PW }).expect(404);
      // Popis: stanje i podaci o pozivnici, bez tokena.
      const list = (await http().get('/api/users').set(auth(admin)).expect(200)).body as { id: string; status: string; invitation: Record<string, unknown> | null }[];
      const row = list.find((u) => u.id === r.body.id)!;
      expect(row.status).toBe('invited'); expect(row.invitation).toMatchObject({ delivery: 'link' });
      expect(JSON.stringify(list)).not.toContain(r.body.invitation.token);

      // Pregled poveznice (stranica prije unosa lozinke) i prihvaćanje → uobičajena prijava.
      const info = (await http().post('/api/auth/token/inspect').set(anon()).send({ token: r.body.invitation.token, kind: 'invite' }).expect(201)).body;
      expect(info).toMatchObject({ kind: 'invite', institution: 'Institut Pozivnica', tenantSlug: slug, email: `ana@${slug}.hr`, displayName: 'Ana Horvat' });
      const wrongKind = await http().post('/api/auth/token/inspect').set(anon()).send({ token: r.body.invitation.token, kind: 'reset' }).expect(400);
      expect(wrongKind.body).toEqual(invalidBody);
      const ok = await accept(r.body.invitation.token).expect(201);
      expect(ok.body.accessToken).toMatch(/^eyJ/); expect(ok.body.mfaSetupRequired).toBe(false);
      expect((await http().get('/api/me').set(auth(ok.body.accessToken)).expect(200)).body.user.status).toBe('active');
      // Jednokratno: drugi put isti odgovor kao nepoznat token.
      expect((await accept(r.body.invitation.token).expect(400)).body).toEqual(invalidBody);
      expect((await http().post('/api/auth/token/inspect').set(anon()).send({ token: r.body.invitation.token, kind: 'invite' }).expect(400)).body).toEqual(invalidBody);
      await http().post('/api/auth/login').set(anon()).send({ tenantSlug: slug, email: `ana@${slug}.hr`, password: PW }).expect(201);

      // Revizija: tko je izdao, kojim načinom, i prihvaćanje s IP adresom (zloupotreba poveznice vidljiva naknadno).
      const audit = (await http().get(`/api/audit?entity=user&entityId=${r.body.id}`).set(auth(admin)).expect(200)).body as { action: string; actorId: string | null; ip: string | null; diff: { meta?: Record<string, unknown> } }[];
      const issued = audit.find((a) => a.action === 'invite.issue')!;
      expect(issued.actorId).toBe(adminId); expect(issued.diff.meta).toMatchObject({ delivery: 'link', reason: 'create' });
      const acc = audit.find((a) => a.action === 'invite.accept')!;
      expect(acc.actorId).toBe(r.body.id); expect(acc.diff.meta).toMatchObject({ issuedBy: adminId, delivery: 'link' });
      expect(acc.ip).toMatch(/^10\.21\./);
    });

    it('istek, ponovno izdavanje (stari token umire), poništavanje, deaktivacija i neispravan oblik – isti odgovor', async () => {
      // Ponovno izdavanje
      const b = await invite('bruno');
      const again = (await http().post(`/api/users/${b.id}/invitation`).set(auth(admin)).expect(201)).body;
      seenTokens.add(again.token);
      expect(again.token).not.toBe(b.token);
      expect((await accept(b.token).expect(400)).body).toEqual(invalidBody);
      // Poništavanje
      await http().delete(`/api/users/${b.id}/invitation`).set(auth(admin)).expect(200);
      expect((await accept(again.token).expect(400)).body).toEqual(invalidBody);
      const list = (await http().get('/api/users').set(auth(admin)).expect(200)).body as { id: string; status: string; invitation: unknown }[];
      expect(list.find((u) => u.id === b.id)).toMatchObject({ status: 'invited', invitation: null });
      const third = (await http().post(`/api/users/${b.id}/invitation`).set(auth(admin)).expect(201)).body; seenTokens.add(third.token);
      await accept(third.token).expect(201);
      // Pozivnica za aktivnog korisnika i poveznica za novu lozinku za pozvanog: 409.
      await http().post(`/api/users/${b.id}/invitation`).set(auth(admin)).expect(409);
      const c = await invite('cvita');
      await http().post(`/api/users/${c.id}/password-link`).set(auth(admin)).expect(409);
      // Deaktivacija gasi pozivnicu; ponovna aktivacija bez lozinke vraća stanje „pozvan” (bez valjane poveznice).
      await http().patch(`/api/users/${c.id}`).set(auth(admin)).send({ status: 'disabled' }).expect(200);
      expect((await accept(c.token).expect(400)).body).toEqual(invalidBody);
      const re = (await http().patch(`/api/users/${c.id}`).set(auth(admin)).send({ status: 'active' }).expect(200)).body;
      expect(re.status).toBe('invited'); expect(re.invitation).toBeNull();
      // Istek (7 dana) – pomaknut u prošlost izravno u bazi.
      const d = await invite('dora');
      await owner.query(`update account_tokens set expires_at = now() - interval '1 second' where tenant_id = $1 and user_id = $2`, [tenantId, d.id]);
      expect((await accept(d.token).expect(400)).body).toEqual(invalidBody);
      expect((await http().post('/api/auth/token/inspect').set(anon()).send({ token: d.token, kind: 'invite' }).expect(400)).body).toEqual(invalidBody);
      // Neispravan oblik: isti odgovor (status i tijelo) kao nepoznat token.
      for (const bad of ['abc', d.token.slice(0, 42), `${d.token}x`, `${d.token.slice(0, 42)}!`, ' '.repeat(43), 'š'.repeat(43), 'a'.repeat(500)]) {
        expect((await accept(bad).expect(400)).body).toEqual(invalidBody);
      }
      await http().post('/api/auth/invitation/accept').set(anon()).send({ token: 'a'.repeat(501), password: PW }).expect(400);
    });

    it('dva istovremena prihvaćanja iste pozivnice: točno jedno uspije (jednokratnost u bazi)', async () => {
      for (let round = 0; round < 3; round++) {
        const e = await invite(`ema${round}`);
        const [r1, r2] = await Promise.all([accept(e.token, 'Prva-lozinka-od-ema-1'), accept(e.token, 'Druga-lozinka-od-ema-2')]);
        expect([r1.status, r2.status].sort()).toEqual([201, 400]);
        const winner = r1.status === 201 ? 'Prva-lozinka-od-ema-1' : 'Druga-lozinka-od-ema-2';
        const loser = r1.status === 201 ? 'Druga-lozinka-od-ema-2' : 'Prva-lozinka-od-ema-1';
        await http().post('/api/auth/login').set(anon()).send({ tenantSlug: slug, email: `ema${round}@${slug}.hr`, password: winner }).expect(201);
        await http().post('/api/auth/login').set(anon()).send({ tenantSlug: slug, email: `ema${round}@${slug}.hr`, password: loser }).expect(401);
      }
    });

    it('poveznica za novu lozinku: sesije opozvane, nema prijave tokenom, MFA ostaje, deaktiviran račun se ne aktivira', async () => {
      const f = await inviteUser(app, admin, { email: `fran@${slug}.hr`, displayName: 'Fran Kos', roleCodes: [] }, PW);
      // MFA na računu
      const setup = (await http().post('/api/me/mfa/setup').set(auth(f.accessToken)).expect(201)).body;
      await http().post('/api/me/mfa/enable').set(auth(f.accessToken)).send({ code: codeAt(setup.secret) }).expect(201);
      const session = f.accessToken; // uključivanje MFA zadržava trenutnu sesiju
      const link = (await http().post(`/api/users/${f.id}/password-link`).set(auth(admin)).expect(201)).body;
      seenTokens.add(link.token);
      expect(link.delivery).toBe('link');
      const ttl = new Date(link.expiresAt).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(59 * 60_000); expect(ttl).toBeLessThanOrEqual(60 * 60_000);
      // Do upotrebe poveznice stara lozinka vrijedi (administrator ne zaključava korisnika).
      await http().get('/api/me').set(auth(session)).expect(200);
      expect((await http().post('/api/auth/token/inspect').set(anon()).send({ token: link.token, kind: 'reset' }).expect(201)).body.kind).toBe('reset');
      expect((await http().post('/api/auth/invitation/accept').set(anon()).send({ token: link.token, password: 'Nova-staza-kroz-park-1' }).expect(400)).body).toEqual(invalidBody); // krivi tip
      const done = (await http().post('/api/auth/password/reset').set(anon()).send({ token: link.token, password: 'Nova-staza-kroz-park-1' }).expect(201)).body;
      expect(done).toMatchObject({ ok: true, tenantSlug: slug, email: `fran@${slug}.hr`, mfaEnabled: true });
      expect(done.accessToken).toBeUndefined();
      await http().get('/api/me').set(auth(session)).expect(401);
      // MFA nije zaobiđen: bez koda 401 s oznakom MFA, s kodom prijava.
      const noCode = await http().post('/api/auth/login').set(anon()).send({ tenantSlug: slug, email: `fran@${slug}.hr`, password: 'Nova-staza-kroz-park-1' }).expect(401);
      expect(noCode.body.mfaRequired).toBe(true);
      await http().post('/api/auth/login').set(anon()).send({ tenantSlug: slug, email: `fran@${slug}.hr`, password: 'Nova-staza-kroz-park-1', code: codeAt(setup.secret, 1) }).expect(201);
      await http().post('/api/auth/password/reset').set(anon()).send({ token: link.token, password: 'Treca-staza-kroz-park-1' }).expect(400);
      // Deaktivacija gasi izdanu poveznicu, a za deaktiviran račun nova se ne izdaje.
      const link2 = (await http().post(`/api/users/${f.id}/password-link`).set(auth(admin)).expect(201)).body; seenTokens.add(link2.token);
      await http().patch(`/api/users/${f.id}`).set(auth(admin)).send({ status: 'disabled' }).expect(200);
      expect((await http().post('/api/auth/password/reset').set(anon()).send({ token: link2.token, password: 'Cetvrta-staza-u-parku-4' }).expect(400)).body).toEqual(invalidBody);
      await http().post(`/api/users/${f.id}/password-link`).set(auth(admin)).expect(409);
      expect((await http().get('/api/users').set(auth(admin)).expect(200)).body.find((u: { id: string }) => u.id === f.id).status).toBe('disabled');
    });

    it('zaboravljena lozinka bez e-pošte: isti odgovor, ništa se ne izdaje, sučelje upućuje na administratora', async () => {
      const a = await http().post('/api/auth/password/forgot').set(anon()).send({ tenantSlug: slug, email: `ana@${slug}.hr` }).expect(202);
      const b = await http().post('/api/auth/password/forgot').set(anon()).send({ tenantSlug: slug, email: `nema@${slug}.hr` }).expect(202);
      expect(a.body).toEqual(b.body); expect(a.body.mailEnabled).toBe(false);
      await app.get(AccountService).idle();
      expect((await owner.query(`select count(*)::int as n from account_tokens where tenant_id = $1 and kind = 'reset'`, [tenantId])).rows[0].n).toBe(0);
    });

    it('pozivnica ne podiže ovlasti: bez users:write nema pozivnica ni poveznica; prihvaćanje ne mijenja uloge', async () => {
      const g = await inviteUser(app, admin, { email: `goran@${slug}.hr`, displayName: 'Goran', roleCodes: ['project-office'] }, PW); // users:read, bez users:write
      const target = await invite('hana', ['reader']);
      await http().post('/api/users').set(auth(g.accessToken)).send({ email: `x@${slug}.hr`, displayName: 'X Y' }).expect(403);
      await http().post(`/api/users/${target.id}/invitation`).set(auth(g.accessToken)).expect(403);
      await http().delete(`/api/users/${target.id}/invitation`).set(auth(g.accessToken)).expect(403);
      await http().post(`/api/users/${adminId}/password-link`).set(auth(g.accessToken)).expect(403);
      const accepted = (await accept(target.token).expect(201)).body;
      expect(accepted.permissions.sort()).toEqual(['calls:read', 'finance:read', 'organisations:read', 'packages:read', 'portfolio:read', 'projects:read', 'proposals:read', 'reports:read'].sort());
    });

    it('obvezni MFA institucije: prihvaćena pozivnica vodi u ograničeno stanje postavljanja MFA', async () => {
      const i = await invite('iva');
      await owner.query(`update tenants set settings = settings || '{"requireMfa":"all"}'::jsonb where id = $1`, [tenantId]);
      try {
        const r = (await accept(i.token).expect(201)).body;
        expect(r.mfaSetupRequired).toBe(true);
        expect((await http().get('/api/me/work').set(auth(r.accessToken)).expect(403)).body.code).toBe('mfa_setup_required');
      } finally {
        await owner.query(`update tenants set settings = settings - 'requireMfa' where id = $1`, [tenantId]);
      }
    });

    it('ograničenja javnih ruta: nevaljani tokeni po IP-u → 429 i za valjan token; zaboravljena lozinka po računu i IP-u', async () => {
      const valid = await invite('jura');
      const ipX = { 'X-Forwarded-For': '10.99.1.1' };
      for (let i = 0; i < 20; i++) await http().post('/api/auth/invitation/accept').set(ipX).send({ token: randomUUID().replace(/-/g, '').padEnd(43, 'a'), password: PW }).expect(400);
      const blocked = await http().post('/api/auth/invitation/accept').set(ipX).send({ token: valid.token, password: PW }).expect(429);
      expect(blocked.body.code).toBe('account_rate_limited');
      await http().post('/api/auth/token/inspect').set(ipX).send({ token: valid.token, kind: 'invite' }).expect(429);
      await http().post('/api/auth/password/reset').set(ipX).send({ token: valid.token, password: PW }).expect(429);
      await accept(valid.token).expect(201); // druga adresa nije blokirana
      // Zaboravljena lozinka: 5 po upisanom računu (i nepostojećem – 429 ne otkriva račun), 20 po IP-u.
      const ipY = { 'X-Forwarded-For': '10.99.2.2' };
      for (let i = 0; i < 5; i++) await http().post('/api/auth/password/forgot').set(anon()).send({ tenantSlug: slug, email: `nepostojeci@${slug}.hr` }).expect(202);
      expect((await http().post('/api/auth/password/forgot').set(anon()).send({ tenantSlug: slug, email: `nepostojeci@${slug}.hr` }).expect(429)).body.code).toBe('account_rate_limited');
      for (let i = 0; i < 20; i++) await http().post('/api/auth/password/forgot').set(ipY).send({ tenantSlug: slug, email: `r${i}@${slug}.hr` }).expect(202);
      await http().post('/api/auth/password/forgot').set(ipY).send({ tenantSlug: slug, email: `r99@${slug}.hr` }).expect(429);
    });

    it('token nikad u putanji: ruta s tokenom u URL-u ne postoji, a sučelje ga nosi u fragmentu (#)', async () => {
      const k = await invite('kata');
      await http().post(`/api/auth/invitation/accept/${k.token}`).set(anon()).send({ password: PW }).expect(404);
      await http().get(`/api/auth/invitation/${k.token}`).set(anon()).expect(404);
      await accept(k.token).expect(201);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('s e-poštom: poveznica samo u pretinac korisnika, iz PUBLIC_URL', () => {
    let app: NestExpressApplication; const slug = `am-${tag}`; let admin = ''; let tenantId = '';
    const sent: OutgoingMail[] = [];
    let gate: Promise<void> | null = null;
    const failFor = new Set<string>();
    const transport: MailTransport = {
      send: async (m) => {
        if (gate) await gate;
        if (failFor.has(m.to.address)) throw Object.assign(new SmtpError('rejected', false, 'odbijeno'), { attempts: 1 });
        sent.push(m);
        for (const x of [m.text, m.html]) { const t = TOKEN_IN_LINK.exec(x)?.[2]; if (t) seenTokens.add(t); }
        return { attempts: 1 };
      },
    };
    const settings: MailSettings = { enabled: true, publicUrl: 'https://projekti.institucija.hr', from: { address: 'arqus@institucija.hr', name: 'ArQus Projekti' }, smtp: null, maxConcurrency: 2, digestHour: 7 };
    let ip = 1;
    const anon = () => ({ 'X-Forwarded-For': `10.22.${Math.floor(ip / 250)}.${ip++ % 250}` });
    const http = () => request(app.getHttpServer());
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const hostile = { Host: 'napadac.example', 'X-Forwarded-Host': 'napadac.example', 'X-Forwarded-Proto': 'http', Origin: 'https://napadac.example', Referer: 'https://napadac.example/' };
    const idle = () => app.get(AccountService).idle();
    const lastTo = (address: string) => [...sent].reverse().find((m) => m.to.address === address);

    beforeAll(async () => {
      tenantId = (await seedDemo({ url: ADMIN_URL, tenantSlug: slug, tenantName: 'Sveučilište s poštom', adminEmail: `a@${slug}.hr`, adminPassword: 'Lozinka-123456', importPackages: false })).tenantId;
      app = await makeApp({ settings, transport });
      admin = (await http().post('/api/auth/login').send({ tenantSlug: slug, email: `a@${slug}.hr`, password: 'Lozinka-123456' }).expect(201)).body.accessToken;
    });
    afterAll(async () => { await app.close(); });

    it('pozivnica: API ne vraća ništa tajno; poruka ide korisniku s poveznicom iz PUBLIC_URL i usprkos neprijateljskim zaglavljima', async () => {
      const r = await http().post('/api/users').set({ ...auth(admin), ...hostile }).send({ email: `lea@${slug}.hr`, displayName: 'Lea Babić', roleCodes: ['reader'] }).expect(201);
      expect(r.body.invitation).toEqual({ delivery: 'mail', expiresAt: expect.any(String) });
      expect(JSON.stringify(r.body)).not.toMatch(/[A-Za-z0-9_-]{43}/);
      await idle();
      const m = lastTo(`lea@${slug}.hr`)!;
      expect(m.to.name).toBe('Lea Babić');
      expect(m.subject).toBe('Pozivnica u ArQus Projekti – Sveučilište s poštom');
      const link = /https?:\/\/\S+/.exec(m.text)![0];
      expect(link).toMatch(/^https:\/\/projekti\.institucija\.hr\/#\/pozivnica\/[A-Za-z0-9_-]{43}$/);
      expect(m.text + m.html).not.toContain('napadac');
      // Token je iza '#': preglednik ga ne šalje poslužitelju (ni u zapisu pristupa ni u Refereru).
      expect(link.indexOf('#')).toBeLessThan(link.indexOf(TOKEN_IN_LINK.exec(link)![2]!));
      const token = TOKEN_IN_LINK.exec(link)![2]!;
      await http().post('/api/auth/invitation/accept').set(anon()).send({ token, password: PW }).expect(201);
      const audit = (await http().get(`/api/audit?entity=user&entityId=${r.body.id}`).set(auth(admin)).expect(200)).body as { action: string; diff: { meta?: Record<string, unknown> } }[];
      expect(audit.find((a) => a.action === 'invite.issue')!.diff.meta).toMatchObject({ delivery: 'mail' });
      expect(audit.find((a) => a.action === 'invite.accept')!.diff.meta).toMatchObject({ delivery: 'mail' });
    });

    it('zaboravljena lozinka: isti odgovor za postojeći, nepostojeći, pozvan, deaktiviran račun i nepoznatu instituciju; poruka izvan odgovora', async () => {
      const invited = (await http().post('/api/users').set(auth(admin)).send({ email: `pozvan@${slug}.hr`, displayName: 'Pozvan' }).expect(201)).body.id;
      const off = await inviteUserWithMail(`off@${slug}.hr`);
      await http().patch(`/api/users/${off}`).set(auth(admin)).send({ status: 'disabled' }).expect(200);
      await idle(); sent.length = 0;
      // Relay je „spor” (poruka čeka dok je ne pustimo) – odgovor ipak stiže odmah: slanje je izvan zahtjeva.
      let release!: () => void; gate = new Promise((r) => { release = r; });
      const cases = [[slug, `lea@${slug}.hr`], [slug, `nema@${slug}.hr`], [slug, `pozvan@${slug}.hr`], [slug, `off@${slug}.hr`], [`nema-${tag}`, `lea@${slug}.hr`], [slug, 'LEA@' + slug + '.HR']] as const;
      const bodies: unknown[] = []; const times: number[] = [];
      for (const [s, e] of cases) {
        const t0 = Date.now();
        const r = await http().post('/api/auth/password/forgot').set({ ...anon(), ...hostile }).send({ tenantSlug: s, email: e }).expect(202);
        times.push(Date.now() - t0); bodies.push(r.body);
      }
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
      expect(bodies[0]).toMatchObject({ ok: true, mailEnabled: true });
      expect(sent).toHaveLength(0); // ništa još nije poslano, a svi su odgovori stigli
      expect(Math.max(...times)).toBeLessThan(1000);
      release(); gate = null; await idle();
      // Poruke: samo aktivni postojeći račun (dva zahtjeva – drugi je poništio prvu poveznicu).
      expect(sent.map((m) => m.to.address)).toEqual([`lea@${slug}.hr`, `lea@${slug}.hr`]);
      const links = sent.map((m) => /https?:\/\/\S+/.exec(m.text)![0]);
      for (const l of links) expect(l).toMatch(/^https:\/\/projekti\.institucija\.hr\/#\/lozinka\/[A-Za-z0-9_-]{43}$/);
      expect(sent[0]!.text).toContain('Zatražena je nova lozinka');
      const [first, second] = links.map((l) => TOKEN_IN_LINK.exec(l)![2]!);
      await http().post('/api/auth/password/reset').set(anon()).send({ token: first, password: 'Nova-lozinka-za-leu-7' }).expect(400);
      const before = (await http().post('/api/auth/login').set(anon()).send({ tenantSlug: slug, email: `lea@${slug}.hr`, password: PW }).expect(201)).body.accessToken;
      sent.length = 0;
      await http().post('/api/auth/password/reset').set(anon()).send({ token: second, password: 'Nova-lozinka-za-leu-7' }).expect(201);
      await http().get('/api/me').set(auth(before)).expect(401); // sve sesije opozvane
      await idle();
      const notice = lastTo(`lea@${slug}.hr`)!;
      expect(notice.subject).toMatch(/^Lozinka je promijenjena/);
      expect(notice.text).toContain('https://projekti.institucija.hr/');
      expect(TOKEN_IN_LINK.test(notice.text)).toBe(false);
      await http().post('/api/auth/login').set(anon()).send({ tenantSlug: slug, email: `lea@${slug}.hr`, password: 'Nova-lozinka-za-leu-7' }).expect(201);
      // Pozvani korisnik ne dobiva poveznicu za novu lozinku (treba prihvatiti pozivnicu), deaktivirani ništa.
      expect((await owner.query(`select count(*)::int as n from account_tokens where tenant_id = $1 and user_id = $2 and kind = 'reset'`, [tenantId, invited])).rows[0].n).toBe(0);
      const audit = (await http().get('/api/audit?action=password.reset_request').set(auth(admin)).expect(200)).body as { ip: string | null }[];
      expect(audit.length).toBe(2); expect(audit[0]!.ip).toMatch(/^10\.22\./);
    });

    it('zaključavanje nakon pogrešnih lozinki: nova lozinka briše brojač računa (korisnik je dokazao pristup poveznici)', async () => {
      for (let i = 0; i < 10; i++) await http().post('/api/auth/login').set(anon()).send({ tenantSlug: slug, email: `lea@${slug}.hr`, password: `kriva-${i}` }).expect(401);
      await http().post('/api/auth/login').set(anon()).send({ tenantSlug: slug, email: `lea@${slug}.hr`, password: 'Nova-lozinka-za-leu-7' }).expect(429);
      await http().post('/api/auth/password/forgot').set(anon()).send({ tenantSlug: slug, email: `lea@${slug}.hr` }).expect(202);
      await idle();
      const token = TOKEN_IN_LINK.exec(lastTo(`lea@${slug}.hr`)!.text)![2]!;
      await http().post('/api/auth/password/reset').set(anon()).send({ token, password: 'Treca-lozinka-za-leu-8' }).expect(201);
      await http().post('/api/auth/login').set(anon()).send({ tenantSlug: slug, email: `lea@${slug}.hr`, password: 'Treca-lozinka-za-leu-8' }).expect(201);
    });

    it('neuspjela isporuka: zapis bez sadržaja, ostali primatelji dobivaju poruke; stanje i probna poruka (ograničena)', async () => {
      failFor.add(`los@${slug}.hr`);
      await http().post('/api/users').set(auth(admin)).send({ email: `los@${slug}.hr`, displayName: 'Loš Pretinac' }).expect(201);
      await http().post('/api/users').set(auth(admin)).send({ email: `dobar@${slug}.hr`, displayName: 'Dobar Pretinac' }).expect(201);
      await idle();
      expect(lastTo(`dobar@${slug}.hr`)).toBeTruthy();
      const st = (await http().get('/api/tenant/mail').set(auth(admin)).expect(200)).body;
      expect(st).toMatchObject({ enabled: true, from: 'arqus@institucija.hr', publicUrl: 'https://projekti.institucija.hr' });
      expect(st.recent.find((d: { displayName: string }) => d.displayName === 'Loš Pretinac')).toMatchObject({ kind: 'invite', outcome: 'failed', errorClass: 'rejected' });
      expect(st.last7Days.failed).toBeGreaterThanOrEqual(1);
      const cols = (await owner.query(`select column_name from information_schema.columns where table_name = 'mail_deliveries' order by 1`)).rows.map((r) => r.column_name);
      expect(cols).toEqual(['attempts', 'created_at', 'error_class', 'id', 'kind', 'outcome', 'tenant_id', 'user_id']);
      for (let i = 0; i < 3; i++) expect((await http().post('/api/tenant/mail/test').set(auth(admin)).expect(201)).body.sent).toBe(true);
      await http().post('/api/tenant/mail/test').set(auth(admin)).expect(429);
      expect(lastTo(`a@${slug}.hr`)!.subject).toMatch(/^Probna poruka/);
    });

    async function inviteUserWithMail(email: string): Promise<string> {
      const r = await http().post('/api/users').set(auth(admin)).send({ email, displayName: 'Osoba Test' }).expect(201);
      await idle();
      const token = TOKEN_IN_LINK.exec(lastTo(email)!.text)![2]!;
      await http().post('/api/auth/invitation/accept').set(anon()).send({ token, password: PW }).expect(201);
      return r.body.id;
    }
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('postavke e-pošte: neispravne zaustavljaju pokretanje', () => {
    const base = { MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.institucija.hr', MAIL_FROM: 'arqus@institucija.hr', PUBLIC_URL: 'https://projekti.institucija.hr' };
    it('ispravne postavke i zadane vrijednosti', () => {
      expect(mailSettingsFromEnv({}).enabled).toBe(false);
      expect(mailSettingsFromEnv({ MAIL_TRANSPORT: 'off', PUBLIC_URL: 'nije url' }).enabled).toBe(false);
      const s = mailSettingsFromEnv(base);
      expect(s).toMatchObject({ enabled: true, publicUrl: 'https://projekti.institucija.hr', digestHour: 7, smtp: { port: 587, security: 'starttls', heloName: 'projekti.institucija.hr' } });
      expect(mailSettingsFromEnv({ ...base, SMTP_SECURITY: 'tls' }).smtp!.port).toBe(465);
      expect(mailSettingsFromEnv({ ...base, PUBLIC_URL: 'http://localhost:3000/' }).publicUrl).toBe('http://localhost:3000');
      expect(mailSettingsFromEnv({ ...base, PUBLIC_URL: 'https://x.hr/arqus/' }).publicUrl).toBe('https://x.hr/arqus');
    });
    it.each([
      [{ PUBLIC_URL: undefined }, /PUBLIC_URL nije postavljen/],
      [{ PUBLIC_URL: 'http://projekti.institucija.hr' }, /https/],
      [{ PUBLIC_URL: 'https://projekti.institucija.hr/?a=1' }, /upit/],
      [{ PUBLIC_URL: 'https://projekti.institucija.hr/#x' }, /fragment/],
      [{ PUBLIC_URL: 'https://u:p@projekti.institucija.hr' }, /korisnika/],
      [{ SMTP_HOST: '' }, /SMTP_HOST/],
      [{ MAIL_FROM: '' }, /MAIL_FROM/],
      [{ MAIL_FROM: 'a@b.hr\r\nBcc: x@y.hr' }, /MAIL_FROM/],
      [{ MAIL_FROM_NAME: 'ArQus\r\nBcc: x@y.hr' }, /MAIL_FROM_NAME/],
      [{ SMTP_SECURITY: 'ssl' }, /SMTP_SECURITY/],
      [{ SMTP_SECURITY: 'none', SMTP_USER: 'u', SMTP_PASSWORD: 'p' }, /nešifriranom/],
      [{ SMTP_PASSWORD: 'p' }, /SMTP_USER/],
      [{ SMTP_PORT: '99999' }, /SMTP_PORT/],
      [{ SMTP_TLS_CA_FILE: '/nema/ove/datoteke.pem' }, /SMTP_TLS_CA_FILE/],
      [{ MAIL_TRANSPORT: 'sendmail' }, /MAIL_TRANSPORT/],
    ])('%o → greška', (over, re) => {
      const env = { ...base, ...over } as Record<string, string | undefined>;
      for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
      expect(() => mailSettingsFromEnv(env as NodeJS.ProcessEnv)).toThrow(re);
    });
    it('aplikacija se ne pokreće s uključenom poštom bez PUBLIC_URL', async () => {
      const saved = { ...process.env };
      Object.assign(process.env, { MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.institucija.hr', MAIL_FROM: 'arqus@institucija.hr' }); delete process.env.PUBLIC_URL;
      try {
        await expect(Test.createTestingModule({ imports: [AppModule] }).compile()).rejects.toThrow(/PUBLIC_URL/);
        process.env.PUBLIC_URL = 'http://projekti.institucija.hr';
        await expect(Test.createTestingModule({ imports: [AppModule] }).compile()).rejects.toThrow(/https/);
      } finally {
        for (const k of ['MAIL_TRANSPORT', 'SMTP_HOST', 'MAIL_FROM', 'PUBLIC_URL']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
      }
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  it('nijedan token nije u reviziji, nijednoj tablici ni u dnevniku procesa', async () => {
    expect(seenTokens.size).toBeGreaterThan(15);
    const tables = (await owner.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`)).rows.map((r) => r.table_name);
    const tokens = [...seenTokens];
    const hits: string[] = [];
    for (const t of tables) {
      const { rows } = await owner.query<{ n: number }>(`select count(*)::int as n from ${JSON.stringify(t)} x where exists (select 1 from unnest($1::text[]) tok where position(tok in x::text) > 0)`, [tokens]);
      if (rows[0]!.n) hits.push(t);
    }
    expect(hits).toEqual([]);
    const log = output.join('\n');
    expect(tokens.filter((t) => log.includes(t))).toEqual([]);
  });
});
