import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as schema from './schema';
import { TenantContext } from '../common/tenant-context';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Jedan pool prema bazi pod APLIKACIJSKOM ulogom (bez BYPASSRLS). Svaki poslovni upit ide kroz
 * `withTenant`, koji unutar transakcije postavlja `app.tenant_id`; RLS politike iz migracije filtriraju redove.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;
  readonly db: Db;

  constructor(private readonly ctx: TenantContext) {
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5432/arqus', max: 10 });
    this.db = drizzle(this.pool, { schema });
  }

  /** Transakcija vezana uz eksplicitni stanar. */
  async withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return fn(tx);
    });
  }

  /** Transakcija vezana uz stanara iz konteksta zahtjeva (AuthGuard). Bez konteksta baca grešku. */
  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tenantId = this.ctx.get()?.tenantId;
    if (!tenantId) throw new Error('Nema konteksta stanara – upit odbijen');
    return this.withTenant(tenantId, fn);
  }

  /** Transakcija BEZ stanara – samo za prijavu (pronalazak stanara po slugu) i sistemske poslove. */
  async withoutTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => fn(tx));
  }

  async onModuleDestroy(): Promise<void> { await this.pool.end(); }
}
