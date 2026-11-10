/* Operativni CLI za instalaciju (kontejner): `node dist/db/cli.js migrate | import-packages | seed | init`.
 * migrate – primjena migracija (vlasnička uloga DATABASE_MIGRATE_URL)
 * import-packages – uvoz/osvježavanje globalnih paketa programa (ARQUS_PACKAGES_DIR)
 * seed – prvi stanar i administrator (SEED_TENANT_SLUG, SEED_TENANT_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD)
 * init – migrate + import-packages (pri svakom pokretanju kontejnera; idempotentno) */
import { Pool } from 'pg';
import { runMigrations } from './migrate';
import { importGlobalPackages, seedDemo } from './seed';

async function main(cmd: string | undefined): Promise<void> {
  const url = process.env.DATABASE_MIGRATE_URL;
  if (!url) throw new Error('DATABASE_MIGRATE_URL nije postavljen');
  if (cmd === 'migrate' || cmd === 'init') {
    await runMigrations(url); console.log('Migracije primijenjene.');
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
  if (!['migrate', 'import-packages', 'seed', 'init'].includes(cmd ?? '')) throw new Error('Naredba: migrate | import-packages | seed | init');
}
main(process.argv[2]).catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
