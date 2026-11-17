/* Operativni CLI za instalaciju (kontejner): `node dist/db/cli.js migrate | import-packages | seed | init`.
 * migrate – primjena migracija i usklađivanje sistemskih uloga (vlasnička uloga DATABASE_MIGRATE_URL)
 * import-packages – uvoz/osvježavanje globalnih paketa programa (ARQUS_PACKAGES_DIR)
 * seed – prvi stanar i administrator (SEED_TENANT_SLUG, SEED_TENANT_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD)
 * init – migrate + import-packages (pri svakom pokretanju kontejnera; idempotentno)
 * import-calls [--file a.json ...] – uvoz globalnih poziva s portala EU Funding & Tenders (ili iz spremljenih odgovora search API-ja)
 * demo [--reset] [--slug <oznaka>] – demo institucija s realnim podacima (WP1.13; nikad implicitno). Treba i DATABASE_URL (aplikacijska uloga);
 *   u produkciji samo uz ARQUS_DEMO=1. Lozinka demo korisnika: DEMO_PASSWORD ili zadana (docs/DEMO.md). */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { runMigrations } from './migrate';
import { IdentityService } from '../identity/identity.service';
import { importGlobalPackages, seedDemo } from './seed';
import { readFileSync } from 'node:fs';
import { fetchFtResults, importFtCalls } from '../calls/ft-import';
import type { FtResult } from '@arqus/domain';

async function main(cmd: string | undefined): Promise<void> {
  const url = process.env.DATABASE_MIGRATE_URL;
  if (!url) throw new Error('DATABASE_MIGRATE_URL nije postavljen');
  if (cmd === 'migrate' || cmd === 'init') {
    await runMigrations(url); console.log('Migracije primijenjene.');
    // Sistemske uloge iz koda (dozvole se mijenjaju s verzijama, npr. WP1.14) – postojeća instalacija ih preuzima pri svakom pokretanju.
    await syncSystemRoles(url); console.log('Sistemske uloge usklađene.');
    // Migracija 0001 stvara aplikacijsku ulogu sa zadanom lozinkom; u instalaciji je zamjenjujemo tajnom iz okruženja.
    const appPw = process.env.DB_APP_PASSWORD;
    if (appPw) {
      if (appPw.length < 16) throw new Error('DB_APP_PASSWORD mora imati barem 16 znakova');
      const pool = new Pool({ connectionString: url, max: 1 });
      try { const { rows } = await pool.query<{ q: string }>(`select format('ALTER ROLE arqus_app WITH PASSWORD %L', $1::text) as q`, [appPw]); await pool.query(rows[0]!.q); }
      finally { await pool.end(); }
      console.log('Lozinka aplikacijske uloge postavljena.');
    } else if (process.env.NODE_ENV === 'production') throw new Error('U produkciji DB_APP_PASSWORD je obvezan');
  }
  if (cmd === 'import-packages' || cmd === 'init') {
    const r = await importGlobalPackages(url);
    console.log(`Paketi – uvezeno: ${r.imported.join(', ') || '-'}; nepromijenjeno: ${r.unchanged.join(', ') || '-'}`);
    if (r.rejected.length) { console.error('Odbijeni paketi:', JSON.stringify(r.rejected)); process.exitCode = 1; }
  }
  if (cmd === 'seed') {
    if (process.env.NODE_ENV === 'production' && (process.env.SEED_ADMIN_PASSWORD ?? '').length < 12) throw new Error('U produkciji SEED_ADMIN_PASSWORD mora imati barem 12 znakova');
    const r = await seedDemo({ url, importPackages: false });
    console.log(`Stanar ${r.tenantSlug}, administrator ${r.adminEmail} (lozinka iz SEED_ADMIN_PASSWORD).`);
  }
  if (cmd === 'import-calls') {
    const files = process.argv.slice(3).filter((a) => a !== '--file');
    const results = files.length ? files.flatMap((f) => (JSON.parse(readFileSync(f, 'utf8')) as { results: FtResult[] }).results) : await fetchFtResults();
    const r = await importFtCalls(url, results);
    console.log(`F&T – dohvaćeno ${r.fetched}; novih ${r.inserted}, osvježeno ${r.updated}, ručnih zadržano ${r.keptManual}; preskočeno: duplikati ${r.skipped.duplicate}, istekli ${r.skipped.expired}, neispravni ${r.skipped.invalid}`);
  }
  if (cmd === 'demo') await demo(url, process.argv.slice(3));
  if (!['migrate', 'import-packages', 'seed', 'init', 'import-calls', 'demo'].includes(cmd ?? '')) throw new Error('Naredba: migrate | import-packages | seed | init | import-calls | demo');
}

async function syncSystemRoles(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try { await drizzle(pool, { schema }).transaction((tx) => IdentityService.ensureSystemRoles(tx)); }
  finally { await pool.end(); }
}

async function demo(ownerUrl: string, args: string[]): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.ARQUS_DEMO !== '1') throw new Error('Demo podaci se u produkciji pune samo uz ARQUS_DEMO=1 (zaštita pilot-instalacije).');
  const appUrl = process.env.DATABASE_URL;
  if (!appUrl) throw new Error('DATABASE_URL (aplikacijska uloga) nije postavljen – demo podaci pune se kroz API pod RLS-om');
  const unknown = args.filter((a, i) => !['--reset', '--slug'].includes(a) && args[i - 1] !== '--slug');
  if (unknown.length) throw new Error(`Nepoznati argumenti: ${unknown.join(' ')} (demo [--reset] [--slug <oznaka>])`);
  const slugAt = args.indexOf('--slug');
  const { runDemo } = await import('../demo/demo');
  const started = Date.now();
  const r = await runDemo({ ownerUrl, appUrl, reset: args.includes('--reset'), slug: slugAt >= 0 ? args[slugAt + 1] : undefined, password: process.env.DEMO_PASSWORD || undefined, log: (m) => console.log(`  ${m}`) });
  console.log(r.status === 'created' ? `Demo institucija "${r.slug}" spremna (${((Date.now() - started) / 1000).toFixed(0)} s).` : `Demo institucija "${r.slug}" već postoji.`);
  if (r.summary) console.log(`  projekti: ${r.summary.projects.join(', ')}; prijave: ${r.summary.proposals.join(', ')}; pozivi: ${r.summary.calls}; timesheetovi: ${r.summary.timesheets}; troškovi: ${r.summary.expenses}; dokumenti: ${r.summary.documents}; ZNS: ${r.summary.claims}`);
  console.log(`Prijava: oznaka institucije "${r.slug}", lozinka za sve račune: ${r.password}`);
  for (const u of r.users) console.log(`  ${u.email.padEnd(28)} ${u.roleLabel} – ${u.note}`);
}
main(process.argv[2]).catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
