// WP1.17: primjer ispunjene radne knjige za demo uvoza (docs/primjeri/uvoz-projekta-DIGI-ARHIV.xlsx).
// Pokretanje (nakon pnpm build): pnpm --filter @arqus/api demo:import-example (test `demo-import-example` provjerava da je datoteka aktualna).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { demoImportWorkbook, DEMO_IMPORT_FILE } from '../dist/demo/import-example.js';

const dir = join(import.meta.dirname, '..', '..', '..', 'docs', 'primjeri');
mkdirSync(dir, { recursive: true });
const buf = await demoImportWorkbook();
writeFileSync(join(dir, DEMO_IMPORT_FILE), buf);
console.log(`${join(dir, DEMO_IMPORT_FILE)} (${buf.length} B)`);
