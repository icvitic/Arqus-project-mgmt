import { runMigrations } from '../src/db/migrate';
import { importGlobalPackages } from '../src/db/seed';

export const ADMIN_URL = process.env.TEST_DATABASE_MIGRATE_URL ?? 'postgres://arqus@127.0.0.1:5433/arqus_test';
export const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';

/**
 * Globalni setup: migracije pod vlasničkom ulogom i globalni paketi programa (HE, NPOO); testovi zatim koriste aplikacijsku ulogu.
 * Paketi se uvoze ovdje, jednom, da nijedan test ne ovisi o tome je li ih prije njega uvezao neki drugi (redoslijed datoteka nije zajamčen).
 */
export default async function setup(): Promise<void> {
  process.env.DATABASE_URL = APP_URL;
  process.env.DATABASE_MIGRATE_URL = ADMIN_URL;
  await runMigrations(ADMIN_URL);
  await importGlobalPackages(ADMIN_URL);
}
