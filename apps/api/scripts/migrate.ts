import { runMigrations } from '../dist/db/migrate.js';
runMigrations().then(() => { console.log('Migracije primijenjene.'); }).catch((e: unknown) => { console.error(e); process.exit(1); });
