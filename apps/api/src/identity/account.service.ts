import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { invitationMail, passwordChangedMail, passwordIssues, passwordResetMail, testMail, timeZoneOr } from '@arqus/domain';
import { DbService, type Tx } from '../db/db.service';
import { accountTokens, tenants, users, type AccountTokenKind, type MailDelivery, type User } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { AccountRateLimit } from '../common/rate-limit';
import { TenantContext } from '../common/tenant-context';
import { MailService, type MailJob } from '../mail/mail.service';
import { IdentityService, type CreateUserInput } from './identity.service';
import { LoginThrottle } from './login-throttle';
import { hashPassword } from './password';

/** Token: 32 bajta (256 bita) iz CSPRNG-a, base64url bez paddinga = 43 znaka (isti oblik kao token kalendara). */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const hashAccountToken = (token: string): string => createHash('sha256').update(`arqus-account|${token}`, 'utf8').digest('hex');

const hoursEnv = (name: string, def: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : def; };
/** Rok valjanosti: pozivnica 7 dana (`ACCOUNT_INVITE_TTL_HOURS`), nova lozinka 60 min (`ACCOUNT_RESET_TTL_MINUTES`). */
export const inviteTtlHours = () => hoursEnv('ACCOUNT_INVITE_TTL_HOURS', 168);
export const resetTtlMinutes = () => hoursEnv('ACCOUNT_RESET_TTL_MINUTES', 60);

export const INVALID_LINK = 'invalid_link';
/** Isti odgovor (status i tijelo) za nepoznat, istekao, iskorišten, opozvan i neispravan token. */
const invalidLink = () => new BadRequestException({ statusCode: 400, code: INVALID_LINK, message: 'Poveznica nije valjana – istekla je, već je iskorištena ili je zamijenjena novom. Zatraži novu.' });

/** Isti odgovor zahtjeva za novu lozinku bez obzira na to postoji li račun i u kojem je stanju. */
export const FORGOT_MESSAGE = 'Ako račun s tom e-adresom postoji i aktivan je, na nju je poslana poveznica za novu lozinku. Poveznica vrijedi ograničeno vrijeme.';
/** Bez uključene pošte (isti tekst za svaki račun – postavka instalacije, ne računa). */
export const FORGOT_MESSAGE_NO_MAIL = 'Ova instalacija ne šalje e-poštu, pa se poveznica za novu lozinku ne može poslati.';

export interface Issued { delivery: MailDelivery; expiresAt: Date; token?: string }
interface ClientInfo { ip?: string; userAgent?: string }

/**
 * WP1.21 – računi bez dijeljenja lozinki: pozivnice, poveznice za novu lozinku i zaboravljena lozinka.
 *
 * Pravila tokena (pozivnica i nova lozinka jednako): 256 bita iz CSPRNG-a; u bazi samo SHA-256; jednokratnost atomično u
 * bazi (`DELETE … RETURNING` u transakciji prihvaćanja – od dva istovremena prihvaćanja drugo čeka zaključani redak i ne
 * nalazi ga); pozivnica vrijedi 7 dana, nova lozinka 1 h; novi token korisnika briše njegove dosadašnje; deaktivacija i
 * brisanje korisnika ih brišu; prihvaćanje opoziva sve sesije korisnika. Nepoznat, istekao, iskorišten i neispravan token
 * daju isti odgovor. Token se ne upisuje u reviziju, dnevnik ni tablicu (u bazi je samo hash).
 *
 * Tko vidi poveznicu: s uključenom poštom samo primatelj (poruka), a API administratoru ne vraća ništa tajno. Bez pošte API
 * token vraća JEDNOM administratoru, koji ga predaje korisniku pouzdanim kanalom (revizija bilježi tko je izdao, kojim
 * načinom i s koje adrese je poveznica iskorištena – preostali rizik je opisan u docs/sigurnost/AUTORIZACIJA.md).
 */
@Injectable()
export class AccountService {
  private readonly log = new Logger('Racuni');
  private readonly background = new Set<Promise<void>>();

  constructor(
    private readonly db: DbService, private readonly audit: AuditService, private readonly identity: IdentityService,
    private readonly mail: MailService, private readonly limits: AccountRateLimit, private readonly throttle: LoginThrottle,
    private readonly ctx: TenantContext,
  ) {}

  /** Čeka pozadinske poslove (zahtjevi za novu lozinku, slanje pošte) – testovi i gašenje. */
  async idle(): Promise<void> {
    while (this.background.size) await Promise.all([...this.background]);
    await this.mail.idle();
  }

  private runInBackground(work: () => Promise<void>): void {
    const p = work().catch((e: unknown) => this.log.error(`Pozadinski posao nije uspio: ${e instanceof Error ? e.name : 'greška'}`));
    this.background.add(p);
    void p.finally(() => this.background.delete(p));
  }

  private async institution(tx: Tx, tenantId: string): Promise<{ name: string; slug: string; timeZone: string }> {
    const t = (await tx.select({ name: tenants.name, slug: tenants.slug, settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)))[0];
    return { name: t?.name ?? '', slug: t?.slug ?? '', timeZone: timeZoneOr(t?.settings?.timeZone) };
  }

  /**
   * Novi token korisnika (stari prestaju vrijediti). Vraća token samo kad pošta nije uključena (ručna predaja); s poštom
   * vraća i posao za slanje koji pozivatelj stavlja u red NAKON potvrde transakcije.
   */
  private async issue(tx: Tx, tenantId: string, user: Pick<User, 'id' | 'email' | 'displayName'>, kind: AccountTokenKind, createdBy: string | null): Promise<{ issued: Issued; job: MailJob | null }> {
    const token = randomBytes(32).toString('base64url');
    const delivery: MailDelivery = this.mail.enabled ? 'mail' : 'link';
    const ttlMs = kind === 'invite' ? inviteTtlHours() * 3_600_000 : resetTtlMinutes() * 60_000;
    const expiresAt = new Date(Date.now() + ttlMs);
    await tx.delete(accountTokens).where(eq(accountTokens.userId, user.id));
    await tx.insert(accountTokens).values({ tenantId, userId: user.id, kind, tokenHash: hashAccountToken(token), delivery, createdBy, expiresAt });
    if (delivery === 'link') return { issued: { delivery, expiresAt, token }, job: null };
    const inst = await this.institution(tx, tenantId);
    const content = kind === 'invite'
      ? invitationMail({ institution: inst.name, recipientName: user.displayName, link: this.mail.appLink(`pozivnica/${token}`), validHours: Math.round(inviteTtlHours()) })
      : passwordResetMail({ institution: inst.name, recipientName: user.displayName, link: this.mail.appLink(`lozinka/${token}`), validMinutes: Math.round(resetTtlMinutes()), byAdministrator: createdBy !== null });
    return { issued: { delivery, expiresAt }, job: { tenantId, userId: user.id, kind: kind === 'invite' ? 'invite' : 'reset', to: { address: user.email, name: user.displayName }, content } };
  }

  // ---------- administrator (users:write) ----------

  /** Novi korisnik (pozvan, bez lozinke) i pozivnica u istoj transakciji. */
  async createAndInvite(input: CreateUserInput) {
    const c = this.ctx.require();
    const { user, issued, job } = await this.db.tx(async (tx) => {
      const created = await this.identity.createUser(tx, c.tenantId, input, c.userId);
      const r = await this.issue(tx, c.tenantId, { id: created.id, email: created.email, displayName: created.displayName }, 'invite', c.userId!);
      await this.audit.record(tx, { entity: 'user', entityId: created.id, action: 'invite.issue', diff: { meta: { delivery: r.issued.delivery, reason: 'create', expiresAt: r.issued.expiresAt.toISOString() } } });
      return { user: created, ...r };
    });
    if (job) void this.mail.enqueue(job);
    return { ...user, invitation: issued };
  }

  private async target(tx: Tx, id: string): Promise<User> {
    const u = (await tx.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))))[0];
    if (!u) throw new NotFoundException(`Korisnik ${id} ne postoji`);
    return u;
  }

  /** Ponovno pošalji / izdaj pozivnicu (stara prestaje vrijediti). Samo za pozvanog korisnika. */
  async resendInvitation(id: string): Promise<Issued> {
    const c = this.ctx.require();
    const { issued, job } = await this.db.tx(async (tx) => {
      const u = await this.target(tx, id);
      if (u.status !== 'invited') throw new ConflictException(u.status === 'active' ? 'Korisnik je već prihvatio pozivnicu – za zaboravljenu lozinku izdaj poveznicu za novu lozinku' : 'Korisnik je deaktiviran – najprije ga aktiviraj');
      const r = await this.issue(tx, c.tenantId, u, 'invite', c.userId!);
      await this.audit.record(tx, { entity: 'user', entityId: id, action: 'invite.issue', diff: { meta: { delivery: r.issued.delivery, reason: 'resend', expiresAt: r.issued.expiresAt.toISOString() } } });
      return r;
    });
    if (job) void this.mail.enqueue(job);
    return issued;
  }

  /** Poništi pozivnicu: neiskorištena poveznica prestaje vrijediti; korisnik ostaje pozvan (novu pozivnicu može dobiti kasnije). */
  async cancelInvitation(id: string) {
    return this.db.tx(async (tx) => {
      const u = await this.target(tx, id);
      if (u.status !== 'invited') throw new ConflictException('Korisnik nije u stanju „pozvan”');
      const r = await tx.delete(accountTokens).where(and(eq(accountTokens.userId, id), eq(accountTokens.kind, 'invite'))).returning({ id: accountTokens.id });
      await this.audit.record(tx, { entity: 'user', entityId: id, action: 'invite.cancel', diff: { meta: { hadPending: r.length > 0 } } });
      return { ok: true };
    });
  }

  /**
   * Poveznica za novu lozinku za postojećeg (aktivnog) korisnika – zamjenjuje nekadašnje upisivanje lozinke umjesto njega.
   * Dosadašnja lozinka vrijedi dok korisnik ne odabere novu; MFA se ne dira.
   */
  async issuePasswordLink(id: string): Promise<Issued> {
    const c = this.ctx.require();
    const { issued, job } = await this.db.tx(async (tx) => {
      const u = await this.target(tx, id);
      if (u.status === 'invited') throw new ConflictException('Korisnik još nije prihvatio pozivnicu – pošalji mu pozivnicu ponovno');
      if (u.status !== 'active') throw new ConflictException('Korisnik je deaktiviran – poveznica za novu lozinku ne aktivira račun');
      const r = await this.issue(tx, c.tenantId, u, 'reset', c.userId!);
      await this.audit.record(tx, { entity: 'user', entityId: id, action: 'password.link_issue', diff: { meta: { delivery: r.issued.delivery, expiresAt: r.issued.expiresAt.toISOString() } } });
      return r;
    });
    if (job) void this.mail.enqueue(job);
    return issued;
  }

  /** Probna poruka administratoru (sebi). */
  async sendTestMail() {
    const c = this.ctx.require();
    if (!this.mail.enabled) throw new ConflictException('Slanje e-pošte nije uključeno na ovoj instalaciji (MAIL_TRANSPORT)');
    this.limits.take('mail-test', c.userId);
    const job = await this.db.tx(async (tx) => {
      const u = await this.target(tx, c.userId!);
      const inst = await this.institution(tx, c.tenantId);
      await this.audit.record(tx, { entity: 'user', entityId: u.id, action: 'mail.test' });
      return { tenantId: c.tenantId, userId: u.id, kind: 'test' as const, to: { address: u.email, name: u.displayName }, content: testMail({ institution: inst.name, recipientName: u.displayName, when: new Date(), timeZone: inst.timeZone }) };
    });
    const sent = await this.mail.enqueue(job);
    return { sent };
  }

  // ---------- javne rute (bez prijave) ----------

  /** Vlasnik tokena bez stanara: RLS otkriva samo redak čiji je hash postavljen u transakciji. Neispravan oblik ide istim putem. */
  private async owner(token: string) {
    const hash = hashAccountToken(TOKEN_RE.test(token) ? token : `invalid:${token.slice(0, 200)}`);
    const row = await this.db.withoutTenant(async (tx) => {
      await tx.execute(sql`select set_config('app.account_token_hash', ${hash}, true)`);
      return (await tx.select({ tenantId: accountTokens.tenantId, userId: accountTokens.userId, kind: accountTokens.kind, expiresAt: accountTokens.expiresAt })
        .from(accountTokens).where(eq(accountTokens.tokenHash, hash)))[0];
    });
    return row && TOKEN_RE.test(token) ? { ...row, hash } : null;
  }

  private tokenGate(ip: string | undefined): void {
    this.limits.check('token-fail-ip', ip);
    this.limits.take('token-ip', ip);
  }
  private invalid(ip: string | undefined): never {
    this.limits.hit('token-fail-ip', ip);
    throw invalidLink();
  }

  /** Pregled poveznice (stranica prije unosa lozinke): institucija, ime i e-adresa – samo za valjan token, inače isti 400. */
  async inspect(token: string, kind: AccountTokenKind, client: ClientInfo) {
    this.tokenGate(client.ip);
    const o = await this.owner(token);
    if (!o || o.kind !== kind || o.expiresAt.getTime() <= Date.now()) this.invalid(client.ip);
    const info = await this.db.withTenant(o.tenantId, async (tx) => {
      const u = (await tx.select().from(users).where(and(eq(users.id, o.userId), isNull(users.deletedAt))))[0];
      if (!u || u.status !== (kind === 'invite' ? 'invited' : 'active')) return null;
      const inst = await this.institution(tx, o.tenantId);
      return { kind, institution: inst.name, tenantSlug: inst.slug, email: u.email, displayName: u.displayName, expiresAt: o.expiresAt };
    });
    if (!info) this.invalid(client.ip);
    return info;
  }

  /** Opća pravila lozinke (bez osobnih podataka) prije traženja tokena – slaba lozinka ne troši i ne otkriva token. */
  private generalPolicy(password: string): void {
    const issues = passwordIssues(password);
    if (issues.length) throw new BadRequestException({ message: 'Lozinka ne zadovoljava pravila', issues });
  }

  /**
   * Zajednički put prihvaćanja: token se briše (`DELETE … RETURNING`) u istoj transakciji u kojoj se postavlja lozinka –
   * ako lozinka ne prođe pravila (s osobnim podacima), transakcija se poništava i token ostaje valjan.
   */
  private async consume(token: string, kind: AccountTokenKind, password: string, client: ClientInfo) {
    this.tokenGate(client.ip);
    this.generalPolicy(password);
    const o = await this.owner(token);
    if (!o || o.kind !== kind) this.invalid(client.ip);
    const result = await this.db.withTenant(o.tenantId, async (tx) => {
      const used = (await tx.delete(accountTokens).where(and(eq(accountTokens.tokenHash, o.hash), eq(accountTokens.kind, kind), gt(accountTokens.expiresAt, sql`now()`)))
        .returning({ userId: accountTokens.userId, createdBy: accountTokens.createdBy, delivery: accountTokens.delivery }))[0];
      if (!used) return null;
      const u = (await tx.select().from(users).where(and(eq(users.id, used.userId), isNull(users.deletedAt))))[0];
      if (!u || u.status !== (kind === 'invite' ? 'invited' : 'active')) return null;
      const inst = await this.institution(tx, o.tenantId);
      this.identity.checkPolicy(password, { email: u.email, displayName: u.displayName, tenantSlug: inst.slug });
      const now = new Date();
      await tx.update(users).set({ passwordHash: await hashPassword(password), passwordChangedAt: now, ...(kind === 'invite' ? { status: 'active' as const } : {}), updatedAt: now, updatedBy: u.id }).where(eq(users.id, u.id));
      await this.identity.revokeSessions(tx, u.id);
      await tx.delete(accountTokens).where(eq(accountTokens.userId, u.id));
      // Revizija: tko je poveznicu izdao i kojim načinom (pošta / ručna predaja) te s koje adrese je iskorištena.
      await this.audit.record(tx, {
        tenantId: o.tenantId, entity: 'user', entityId: u.id, action: kind === 'invite' ? 'invite.accept' : 'password.reset',
        actorType: 'user', actorId: u.id, ip: client.ip ?? null,
        diff: { meta: { issuedBy: used.createdBy, delivery: used.delivery, ip: client.ip ?? null, userAgent: client.userAgent?.slice(0, 300) ?? null } },
      });
      return { user: u, inst, when: now, tenantId: o.tenantId };
    });
    if (!result) this.invalid(client.ip);
    return result;
  }

  /** Prihvaćanje pozivnice: lozinka, račun aktivan, sesije opozvane – zatim uobičajena prijava (uključujući obvezni MFA). */
  async acceptInvitation(token: string, password: string, client: ClientInfo) {
    const r = await this.consume(token, 'invite', password, client);
    // Uobičajena prijava istim putem kao /auth/login: novi korisnik nema MFA, pa ako ga institucija traži, sesija je u
    // ograničenom stanju (`mfaSetupRequired`) i korisnik ide na postavljanje MFA.
    return this.identity.login({ tenantSlug: r.inst.slug, email: r.user.email, password }, client);
  }

  /**
   * Nova lozinka poveznicom: sve sesije opozvane, obavijest e-poštom. NE dira MFA (prijava i dalje traži kod), NE aktivira
   * deaktiviran račun (token se ne izdaje i ne prihvaća za račun koji nije aktivan) i NE prijavljuje korisnika.
   * Privremeno zaključavanje nakon pogrešnih lozinki (brojač računa) se briše: štitilo je od pogađanja STARE lozinke, a
   * korisnik je upravo dokazao pristup poveznici; brojač po IP adresi ostaje.
   */
  async resetPassword(token: string, password: string, client: ClientInfo) {
    const r = await this.consume(token, 'reset', password, client);
    this.throttle.succeeded(r.inst.slug, r.user.email);
    if (this.mail.enabled) {
      void this.mail.enqueue({ tenantId: r.tenantId, userId: r.user.id, kind: 'password_changed', to: { address: r.user.email, name: r.user.displayName },
        content: passwordChangedMail({ institution: r.inst.name, recipientName: r.user.displayName, when: r.when, timeZone: r.inst.timeZone, loginUrl: this.mail.baseUrl }) });
    }
    return { ok: true, tenantSlug: r.inst.slug, email: r.user.email, mfaEnabled: r.user.mfaEnabled };
  }

  /**
   * Zaboravljena lozinka: odgovor je ISTI (status, tijelo i vremenska klasa) bez obzira na to postoji li račun, je li pozvan,
   * deaktiviran ili zaključan – sve osim provjere ulaza i ograničenja radi se u pozadini, nakon odgovora. Poveznica ide samo
   * e-poštom; bez uključene pošte ne izdaje se ništa (korisnik se obraća administratoru – `mailEnabled` je isti za sve).
   */
  forgot(input: { tenantSlug: string; email: string }, client: ClientInfo) {
    const acct = createHash('sha256').update(`${input.tenantSlug.trim().toLowerCase()}|${input.email.trim().toLowerCase()}`).digest('base64url');
    this.limits.check('forgot-ip', client.ip);
    this.limits.check('forgot-account', acct);
    this.limits.hit('forgot-ip', client.ip);
    this.limits.hit('forgot-account', acct);
    if (this.mail.enabled) this.runInBackground(() => this.forgotWork(input, client));
    return { ok: true, message: this.mail.enabled ? FORGOT_MESSAGE : FORGOT_MESSAGE_NO_MAIL, mailEnabled: this.mail.enabled };
  }

  private async forgotWork(input: { tenantSlug: string; email: string }, client: ClientInfo): Promise<void> {
    const tenant = await this.db.withoutTenant(async (tx) => (await tx.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.slug, input.tenantSlug.trim()), isNull(tenants.deletedAt))))[0]);
    if (!tenant) return;
    const job = await this.db.withTenant(tenant.id, async (tx) => {
      const u = (await tx.select().from(users).where(and(eq(users.email, input.email.trim().toLowerCase()), isNull(users.deletedAt))))[0];
      if (!u || u.status !== 'active') return null; // pozvan, deaktiviran ili nepostojeći: ništa (isti odgovor je već poslan)
      const r = await this.issue(tx, tenant.id, u, 'reset', null);
      await this.audit.record(tx, { tenantId: tenant.id, entity: 'user', entityId: u.id, action: 'password.reset_request', actorType: 'system', ip: client.ip ?? null, diff: { meta: { delivery: r.issued.delivery, ip: client.ip ?? null } } });
      return r.job;
    });
    if (job) await this.mail.enqueue(job);
  }
}
