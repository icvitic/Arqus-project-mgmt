/** Uvoz/osvježavanje globalnih paketa programa iz docs/domena/paketi (ili ARQUS_PACKAGES_DIR). */
import { importGlobalPackages } from '../dist/db/seed.js';
importGlobalPackages(process.env.DATABASE_MIGRATE_URL ?? 'postgres://arqus:arqus@127.0.0.1:5432/arqus')
  .then((r) => { console.log(`uvezeno: ${r.imported.join(', ') || '-'}; nepromijenjeno: ${r.unchanged.join(', ') || '-'}`); if (r.rejected.length) { console.error('odbijeno:', JSON.stringify(r.rejected, null, 1)); process.exit(1); } })
  .catch((e: unknown) => { console.error(e); process.exit(1); });
