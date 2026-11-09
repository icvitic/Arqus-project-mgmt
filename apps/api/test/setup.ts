import { runMigrations } from '../src/db/migrate';

export const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
export const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';

/** Globalni setup: migracije pod vlasničkom ulogom; testovi zatim koriste aplikacijsku ulogu. */
export default async function setup(): Promise<void> {
  process.env.DATABASE_URL = APP_URL;
  process.env.DATABASE_MIGRATE_URL = ADMIN_URL;
  await runMigrations(ADMIN_URL);
}
