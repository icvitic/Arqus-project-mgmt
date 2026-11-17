import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

interface Entry { count: number; first: number }

/**
 * Ograničenje neuspjelih prijava (ASVS V2.2.1): po kombinaciji stanar+e-adresa i po IP adresi, u kliznom prozoru.
 * U memoriji jedne instance – za pilot dovoljno; za više instanci premjestiti u Redis.
 * WP1.19: ključ računa je SHA-256 oznake institucije i e-adrese (upisani tekst – ponekad lozinka – ne čuva se ni u memoriji).
 */
@Injectable()
export class LoginThrottle {
  private readonly hits = new Map<string, Entry>();
  private readonly max = Number(process.env.LOGIN_MAX_ATTEMPTS ?? 10);
  private readonly windowMs = Number(process.env.LOGIN_WINDOW_MINUTES ?? 15) * 60_000;

  private keys(tenantSlug: string, email: string, ip?: string): [string, number][] {
    const acct = createHash('sha256').update(`${tenantSlug.trim().toLowerCase()}|${email.trim().toLowerCase()}`).digest('base64url');
    return [[`acct:${acct}`, this.max], ...(ip ? [[`ip:${ip}`, this.max * 10] as [string, number]] : [])];
  }

  private live(key: string): Entry | undefined {
    const e = this.hits.get(key);
    if (e && Date.now() - e.first > this.windowMs) { this.hits.delete(key); return undefined; }
    return e;
  }

  assertAllowed(tenantSlug: string, email: string, ip?: string): void {
    for (const [key, limit] of this.keys(tenantSlug, email, ip)) {
      const e = this.live(key);
      if (e && e.count >= limit) {
        const retry = Math.ceil((e.first + this.windowMs - Date.now()) / 60_000);
        throw new HttpException(`Previše neuspjelih pokušaja prijave – pokušaj ponovno za ${retry} min`, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
  }

  failed(tenantSlug: string, email: string, ip?: string): void {
    for (const [key] of this.keys(tenantSlug, email, ip)) {
      const e = this.live(key);
      this.hits.set(key, e ? { ...e, count: e.count + 1 } : { count: 1, first: Date.now() });
    }
    if (this.hits.size > 50_000) for (const k of [...this.hits.keys()].slice(0, 10_000)) this.hits.delete(k);
  }

  succeeded(tenantSlug: string, email: string): void { this.hits.delete(this.keys(tenantSlug, email)[0]![0]); }
}
