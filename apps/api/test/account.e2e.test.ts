import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { seedDemo } from '../src/db/seed';
import { base32Decode, hotp } from '../src/identity/totp';

const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
const codeAt = (secret: string, offsetSteps = 0) => hotp(base32Decode(secret), Math.floor(Date.now() / 30_000) + offsetSteps);

describe('Računi, sesije i MFA (e2e)', () => {
  let app: INestApplication; let admin = '';
  const tag = randomUUID().slice(0, 8); const slug = `acc-${tag}`;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = (email: string, password: string, code?: string) => http().post('/api/auth/login').send({ tenantSlug: slug, email, password, ...(code ? { code } : {}) });
  let marija = ''; let marijaToken = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    await seedDemo({ url: ADMIN_URL, tenantSlug: slug, adminEmail: `admin@${slug}.hr`, adminPassword: 'Glavni-ulaz-2027', importPackages: false });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    admin = (await login(`admin@${slug}.hr`, 'Glavni-ulaz-2027').expect(201)).body.accessToken;
  });
  afterAll(async () => { await app.close(); });

  it('politika lozinki pri stvaranju korisnika (400 s razlozima)', async () => {
    const r = await http().post('/api/users').set(auth(admin)).send({ email: `marija@${slug}.hr`, displayName: 'Marija Kos', password: 'Lozinka-123456', roleCodes: ['team-member'] }).expect(400);
    expect(r.body.issues.join(' ')).toMatch(/prečesta/);
    await http().post('/api/users').set(auth(admin)).send({ email: `marija@${slug}.hr`, displayName: 'Marija Kos', password: 'kratka', roleCodes: ['team-member'] }).expect(400);
    const ok = await http().post('/api/users').set(auth(admin)).send({ email: `marija@${slug}.hr`, displayName: 'Marija Kos', password: 'plavi-bicikl-uz-rijeku', roleCodes: ['team-member'] }).expect(201);
    marija = ok.body.id; expect(ok.body.roles).toEqual(['team-member']);
    marijaToken = (await login(`marija@${slug}.hr`, 'plavi-bicikl-uz-rijeku').expect(201)).body.accessToken;
  });

  it('popis korisnika s ulogama i popis uloga', async () => {
    const users = (await http().get('/api/users').set(auth(admin)).expect(200)).body;
    expect(users.find((u: { id: string }) => u.id === marija).roles).toEqual(['team-member']);
    const roles = (await http().get('/api/roles').set(auth(admin)).expect(200)).body;
    expect(roles.map((r: { code: string }) => r.code)).toEqual(expect.arrayContaining(['tenant-admin', 'reader', 'project-manager']));
  });

  it('promjena uloga vrijedi odmah, bez ponovne prijave', async () => {
    await http().get('/api/users').set(auth(marijaToken)).expect(403);
    await http().patch(`/api/users/${marija}`).set(auth(admin)).send({ roleCodes: ['project-office'] }).expect(200);
    await http().get('/api/users').set(auth(marijaToken)).expect(200);
    await http().patch(`/api/users/${marija}`).set(auth(admin)).send({ roleCodes: ['team-member'] }).expect(200);
    await http().get('/api/users').set(auth(marijaToken)).expect(403);
  });

  it('odjava opoziva token', async () => {
    const t = (await login(`marija@${slug}.hr`, 'plavi-bicikl-uz-rijeku').expect(201)).body.accessToken;
    await http().get('/api/me').set(auth(t)).expect(200);
    await http().post('/api/auth/logout').set(auth(t)).expect(201);
    const r = await http().get('/api/me').set(auth(t)).expect(401);
    expect(r.body.message).toMatch(/opozvana/);
    await http().get('/api/me').set(auth(marijaToken)).expect(200); // druga sesija i dalje vrijedi
  });

  it('promjena vlastite lozinke: kriva trenutna 400, slaba nova 400; ostale sesije opozvane, trenutna ostaje', async () => {
    const other = (await login(`marija@${slug}.hr`, 'plavi-bicikl-uz-rijeku').expect(201)).body.accessToken;
    await http().post('/api/me/password').set(auth(marijaToken)).send({ currentPassword: 'kriva-lozinka-xyz', newPassword: 'zuti-kisobran-na-kisi' }).expect(400);
    await http().post('/api/me/password').set(auth(marijaToken)).send({ currentPassword: 'plavi-bicikl-uz-rijeku', newPassword: 'marija-kos-2027-x' }).expect(400);
    await http().post('/api/me/password').set(auth(marijaToken)).send({ currentPassword: 'plavi-bicikl-uz-rijeku', newPassword: 'zuti-kisobran-na-kisi' }).expect(201);
    await http().get('/api/me').set(auth(marijaToken)).expect(200);
    await http().get('/api/me').set(auth(other)).expect(401);
    await login(`marija@${slug}.hr`, 'plavi-bicikl-uz-rijeku').expect(401);
    marijaToken = (await login(`marija@${slug}.hr`, 'zuti-kisobran-na-kisi').expect(201)).body.accessToken;
  });

  it('MFA: postavljanje, potvrda, prijava s kodom, zaštita od ponovne upotrebe koda, isključivanje', async () => {
    const setup = (await http().post('/api/me/mfa/setup').set(auth(marijaToken)).expect(201)).body;
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    await http().post('/api/me/mfa/enable').set(auth(marijaToken)).send({ code: '000000' }).expect(400);
    await http().post('/api/me/mfa/enable').set(auth(marijaToken)).send({ code: codeAt(setup.secret) }).expect(201);
    const me = (await http().get('/api/me').set(auth(marijaToken)).expect(200)).body;
    expect(me.user.mfaEnabled).toBe(true);
    const noCode = await login(`marija@${slug}.hr`, 'zuti-kisobran-na-kisi').expect(401);
    expect(noCode.body.mfaRequired).toBe(true);
    const wrong = await login(`marija@${slug}.hr`, 'zuti-kisobran-na-kisi', '123456').expect(401);
    expect(wrong.body.mfaRequired).toBe(true);
    const code = codeAt(setup.secret, 1); // sljedeći korak (kod iz potvrde je već iskorišten)
    const ok = await login(`marija@${slug}.hr`, 'zuti-kisobran-na-kisi', code).expect(201);
    await login(`marija@${slug}.hr`, 'zuti-kisobran-na-kisi', code).expect(401); // isti kod drugi put
    await http().post('/api/me/mfa/disable').set(auth(ok.body.accessToken)).send({ code: '111111' }).expect(400);
    const audit = (await http().get('/api/audit?entity=user&limit=200').set(auth(admin)).expect(200)).body.map((a: { action: string }) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['mfa.enable', 'login.mfa_failed', 'password.change', 'logout']));
  });

  it('administrator resetira MFA i lozinku; sve sesije korisnika opozvane', async () => {
    await http().post(`/api/users/${marija}/reset-mfa`).set(auth(admin)).expect(201);
    await http().get('/api/me').set(auth(marijaToken)).expect(401);
    await http().post(`/api/users/${marija}/reset-password`).set(auth(admin)).send({ newPassword: 'admin' }).expect(400);
    await http().post(`/api/users/${marija}/reset-password`).set(auth(admin)).send({ newPassword: 'nova-privremena-staza-7' }).expect(201);
    marijaToken = (await login(`marija@${slug}.hr`, 'nova-privremena-staza-7').expect(201)).body.accessToken; // bez MFA koda
  });

  it('deaktivacija: opoziv sesija i blokada prijave; zaštita od samodeaktivacije i uklanjanja zadnjeg administratora', async () => {
    const meAdmin = (await http().get('/api/me').set(auth(admin))).body.user.id;
    await http().patch(`/api/users/${meAdmin}`).set(auth(admin)).send({ status: 'disabled' }).expect(403);
    const last = await http().patch(`/api/users/${meAdmin}`).set(auth(admin)).send({ roleCodes: ['reader'] }).expect(409);
    expect(last.body.message).toMatch(/jedini aktivni administrator/);
    await http().patch(`/api/users/${marija}`).set(auth(admin)).send({ status: 'disabled' }).expect(200);
    await http().get('/api/me').set(auth(marijaToken)).expect(401);
    await login(`marija@${slug}.hr`, 'nova-privremena-staza-7').expect(401);
    await http().patch(`/api/users/${marija}`).set(auth(admin)).send({ status: 'active' }).expect(200);
    await login(`marija@${slug}.hr`, 'nova-privremena-staza-7').expect(201);
  });
});
