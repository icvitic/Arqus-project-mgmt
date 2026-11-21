import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { timeZoneOr, todayIn } from '@arqus/domain';

export interface RequestContext {
  tenantId: string;
  userId?: string;
  /** Dozvole na razini institucije (uloge dodijeljene bez projekta) – vrijede za sve projekte. */
  permissions: ReadonlySet<string>;
  /** Dozvole po projektu (uloge dodijeljene na projektu, WP1.14): id projekta → skup dozvola. */
  projectPermissions: ReadonlyMap<string, ReadonlySet<string>>;
  /** WP1.14b: prijave kojima je korisnik voditelj (`leadUserId`) – voditelj radi na vlastitoj prijavi bez uloge institucije. */
  leadProposals?: ReadonlySet<string>;
  /** WP1.26: suradnici na prijavi – id prijave → dozvole suradnika na njoj (uređivanje ili samo čitanje). */
  proposalGrants?: ReadonlyMap<string, ReadonlySet<string>>;
  /** WP1.14b: vremenska zona institucije (`tenants.settings.timeZone`, zadano Europe/Zagreb) – za „danas”. */
  timeZone?: string;
  ip?: string;
  sessionId?: string;
}

/** Jedno spremište po procesu – da i pomoćne funkcije izvan Nest DI (npr. `loadProject`) mogu provjeriti pristup. */
const als = new AsyncLocalStorage<RequestContext>();

/** Kontekst trenutnog zahtjeva ili undefined (sistemski poslovi, seed, migracije). */
export function currentContext(): RequestContext | undefined { return als.getStore(); }

/** Današnji dan institucije iz konteksta zahtjeva (WP1.14b); bez konteksta zadana zona Europe/Zagreb. */
export function tenantToday(now: Date = new Date()): string { return todayIn(timeZoneOr(als.getStore()?.timeZone), now); }
/** Vremenska zona institucije iz konteksta zahtjeva. */
export function tenantTimeZone(): string { return timeZoneOr(als.getStore()?.timeZone); }

/** Kontekst zahtjeva (stanar, korisnik, dozvole) dostupan servisima bez prosljeđivanja parametara. */
@Injectable()
export class TenantContext {
  run<T>(ctx: RequestContext, fn: () => T): T { return als.run(ctx, fn); }
  get(): RequestContext | undefined { return als.getStore(); }
  require(): RequestContext {
    const c = this.get();
    if (!c) throw new Error('Nema konteksta zahtjeva');
    return c;
  }
}
