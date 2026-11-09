import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { join } from 'node:path';

/** Migracije se izvode pod VLASNIČKOM ulogom (DATABASE_MIGRATE_URL), ne pod aplikacijskom. */
export async function runMigrations(url = process.env.DATABASE_MIGRATE_URL ?? 'postgres://arqus:arqus@127.0.0.1:5432/arqus'): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: join(__dirname, '..', '..', 'drizzle') });
  } finally {
    await pool.end();
  }
}
