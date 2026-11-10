// drizzle-kit dodaje UNIQUE ograničenja na postojeće tablice NA KRAJ migracije, iza stranih ključeva koji ih trebaju
// (greška 42830). Skripta ih premješta na početak najnovije (ili zadane) migracije. Pokreće se iz `db:generate`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = join(import.meta.dirname, '..', 'drizzle');
const file = process.argv.slice(2).find((a) => a.endsWith('.sql')) ?? readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort().at(-1);
const path = join(dir, file);
const parts = readFileSync(path, 'utf-8').split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
const isUnique = (s) => /^ALTER TABLE "[^"]+" ADD CONSTRAINT "[^"]+" UNIQUE\(/.test(s);
const moved = parts.filter(isUnique);
if (moved.length) writeFileSync(path, [...moved, ...parts.filter((s) => !isUnique(s))].join('--> statement-breakpoint\n') + '\n');
console.log(`${file}: premješteno ${moved.length} UNIQUE ograničenja na početak`);
