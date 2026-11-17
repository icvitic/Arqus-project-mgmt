import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  tenantId: string;
  userId?: string;
  /** Dozvole na razini institucije (uloge dodijeljene bez projekta) – vrijede za sve projekte. */
  permissions: ReadonlySet<string>;
  /** Dozvole po projektu (uloge dodijeljene na projektu, WP1.14): id projekta → skup dozvola. */
  projectPermissions: ReadonlyMap<string, ReadonlySet<string>>;
  ip?: string;
  sessionId?: string;
}

/** Jedno spremište po procesu – da i pomoćne funkcije izvan Nest DI (npr. `loadProject`) mogu provjeriti pristup. */
const als = new AsyncLocalStorage<RequestContext>();

/** Kontekst trenutnog zahtjeva ili undefined (sistemski poslovi, seed, migracije). */
export function currentContext(): RequestContext | undefined { return als.getStore(); }

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
