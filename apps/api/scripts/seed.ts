/** Demo stanar + administrator. Pokretanje: pnpm --filter @arqus/api db:seed (nakon build i db:migrate). */
import { seedDemo } from '../dist/db/seed.js';
seedDemo().then((r) => { console.log(`Stanar ${r.tenantSlug}, admin ${r.adminEmail} / ${r.adminPassword}`); }).catch((e: unknown) => { console.error(e); process.exit(1); });
