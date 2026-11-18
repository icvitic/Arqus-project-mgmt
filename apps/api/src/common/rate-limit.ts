import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface Entry { count: number; first: number }

/**
 * WP1.19 – ograničenje skupih izvoza po korisniku (izvoz revizije u CSV, paket ZNS-a u ZIP-u): najviše `EXPORT_RATE_MAX`
 * (zadano 20) pokušaja po vrsti izvoza u prozoru od `EXPORT_RATE_WINDOW_MINUTES` (zadano 10) minuta, inače 429.
 * Isti obrazac kao ograničenje prijava (`identity/login-throttle.ts`): u memoriji JEDNE instance – s više instanci
 * granica vrijedi po instanci (za više instanci premjestiti u Redis).
 */
@Injectable()
export class ExportRateLimit {
  private readonly hits = new Map<string, Entry>();
  private readonly max = Math.max(1, Number(process.env.EXPORT_RATE_MAX ?? 20) || 20);
  private readonly windowMs = Math.max(1, Number(process.env.EXPORT_RATE_WINDOW_MINUTES ?? 10) || 10) * 60_000;

  /**
   * Broji pokušaj izvoza; prekoračenje → 429 s vremenom do sljedećeg pokušaja. WP1.17: ista granica vrijedi za čitanje
   * datoteke za uvoz projekta (pregled i potvrda) – `what` i `code` mijenjaju samo tekst i oznaku odgovora.
   */
  take(kind: string, userId: string, what = 'izvoza', code = 'export_rate_limited'): void {
    const key = `${kind}:${userId}`;
    const now = Date.now();
    let e = this.hits.get(key);
    if (e && now - e.first > this.windowMs) { this.hits.delete(key); e = undefined; }
    if (e && e.count >= this.max) {
      const retry = Math.max(1, Math.ceil((e.first + this.windowMs - now) / 60_000));
      throw new HttpException({ statusCode: 429, code, message: `Previše ${what} u kratkom vremenu (najviše ${this.max} u ${Math.round(this.windowMs / 60_000)} min) – pokušaj ponovno za ${retry} min` }, HttpStatus.TOO_MANY_REQUESTS);
    }
    this.hits.set(key, e ? { ...e, count: e.count + 1 } : { count: 1, first: now });
    if (this.hits.size > 50_000) for (const k of [...this.hits.keys()].slice(0, 10_000)) this.hits.delete(k);
  }
}

/** WP1.21 – vrste ograničenja za račune (javne rute pozivnice i nove lozinke, probna poruka). */
export type AccountLimitKind = 'forgot-ip' | 'forgot-account' | 'token-ip' | 'token-fail-ip' | 'mail-test';

/**
 * WP1.21 – ograničenja javnih ruta računa i probne poruke, isti obrazac kao ograničenje prijava (klizni prozor u memoriji
 * JEDNE instance; s više instanci granica vrijedi po instanci):
 * - zaboravljena lozinka: `ACCOUNT_FORGOT_IP_MAX` (20) po IP-u i `ACCOUNT_FORGOT_ACCOUNT_MAX` (5) po upisanom računu
 *   (SHA-256 oznake institucije i e-adrese – ne ovisi o tome postoji li račun, pa 429 ne otkriva račun);
 * - token (pregled, prihvaćanje pozivnice, nova lozinka): `ACCOUNT_TOKEN_FAIL_MAX` (20) NEVALJANIH tokena po IP-u i ukupno
 *   `ACCOUNT_TOKEN_IP_MAX` (200) zahtjeva po IP-u (ograničava i rad scrypta);
 * - probna poruka: 3 po administratoru.
 * Prozor: `ACCOUNT_RATE_WINDOW_MINUTES` (15).
 */
@Injectable()
export class AccountRateLimit {
  private readonly hits = new Map<string, Entry>();
  private readonly windowMs = Math.max(1, Number(process.env.ACCOUNT_RATE_WINDOW_MINUTES ?? 15) || 15) * 60_000;
  private readonly limits: Record<AccountLimitKind, number> = {
    'forgot-ip': Math.max(1, Number(process.env.ACCOUNT_FORGOT_IP_MAX ?? 20) || 20),
    'forgot-account': Math.max(1, Number(process.env.ACCOUNT_FORGOT_ACCOUNT_MAX ?? 5) || 5),
    'token-ip': Math.max(1, Number(process.env.ACCOUNT_TOKEN_IP_MAX ?? 200) || 200),
    'token-fail-ip': Math.max(1, Number(process.env.ACCOUNT_TOKEN_FAIL_MAX ?? 20) || 20),
    'mail-test': 3,
  };

  private live(key: string, now: number): Entry | undefined {
    const e = this.hits.get(key);
    if (e && now - e.first > this.windowMs) { this.hits.delete(key); return undefined; }
    return e;
  }

  /** 429 ako je granica dosegnuta (ne broji). */
  check(kind: AccountLimitKind, key: string | undefined): void {
    const now = Date.now();
    const e = this.live(`${kind}:${key ?? 'unknown'}`, now);
    if (e && e.count >= this.limits[kind]) {
      const retry = Math.max(1, Math.ceil((e.first + this.windowMs - now) / 60_000));
      throw new HttpException({ statusCode: 429, code: 'account_rate_limited', message: `Previše zahtjeva – pokušaj ponovno za ${retry} min` }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  hit(kind: AccountLimitKind, key: string | undefined): void {
    const k = `${kind}:${key ?? 'unknown'}`; const now = Date.now();
    const e = this.live(k, now);
    this.hits.set(k, e ? { ...e, count: e.count + 1 } : { count: 1, first: now });
    if (this.hits.size > 50_000) for (const x of [...this.hits.keys()].slice(0, 10_000)) this.hits.delete(x);
  }

  take(kind: AccountLimitKind, key: string | undefined): void { this.check(kind, key); this.hit(kind, key); }
}
