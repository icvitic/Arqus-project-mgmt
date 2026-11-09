#!/usr/bin/env node
/** CLI: validira sve pakete programa u zadanoj mapi. Izlaz 1 ako je bilo koji neispravan. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateProgrammePackage } from './validate.js';

const dir = process.argv[2] ?? 'docs/domena/paketi';
let failed = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('schema'))) {
  const r = validateProgrammePackage(JSON.parse(readFileSync(join(dir, f), 'utf-8')));
  if (r.ok) console.log(`OK   ${f}  (${r.pkg.meta.id} v${r.pkg.meta.version})`);
  else { failed++; console.log(`FAIL ${f}`); r.issues.forEach((i) => console.log(`     ${i.path}: ${i.message}`)); }
}
process.exit(failed ? 1 : 0);
