import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  tenantId: string;
  userId?: string;
  permissions: ReadonlySet<string>;
  ip?: string;
  sessionId?: string;
}

/** Kontekst zahtjeva (stanar, korisnik, dozvole) dostupan servisima bez prosljeđivanja parametara. */
@Injectable()
export class TenantContext {
  private readonly als = new AsyncLocalStorage<RequestContext>();
  run<T>(ctx: RequestContext, fn: () => T): T { return this.als.run(ctx, fn); }
  get(): RequestContext | undefined { return this.als.getStore(); }
  require(): RequestContext {
    const c = this.get();
    if (!c) throw new Error('Nema konteksta zahtjeva');
    return c;
  }
}
