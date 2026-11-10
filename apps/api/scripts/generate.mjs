// `pnpm db:generate --name <naziv>`: drizzle-kit generate s argumentima, zatim popravak redoslijeda ograničenja.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
execFileSync('pnpm', ['exec', 'drizzle-kit', 'generate', ...process.argv.slice(2)], { stdio: 'inherit' });
execFileSync(process.execPath, [join(import.meta.dirname, 'fix-migration-order.mjs')], { stdio: 'inherit' });
