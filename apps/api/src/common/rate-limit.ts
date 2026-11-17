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
