#!/usr/bin/env bash
# Lokalna e2e provjera: migracije + seed na testnoj bazi, izgrađeni API (port 3100), vite preview (4173), Playwright.
# Varijable: DATABASE_MIGRATE_URL (vlasnik), DATABASE_URL (arqus_app), E2E_SHOTS (mapa za snimke, neobavezno).
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"; cd "$ROOT"
: "${DATABASE_MIGRATE_URL:?postavi DATABASE_MIGRATE_URL}"; : "${DATABASE_URL:?postavi DATABASE_URL}"
pnpm build >/dev/null
(cd apps/api && node -r ./scripts/register.js scripts/migrate.ts && SEED_TENANT_SLUG=e2e SEED_TENANT_NAME="E2E institucija" SEED_ADMIN_EMAIL=admin@e2e.local SEED_ADMIN_PASSWORD=E2e-lozinka-123 node -r ./scripts/register.js scripts/seed.ts && node dist/db/cli.js import-calls --file ../web/e2e/ft-sample.json)
# Testna baza se ponovno koristi: ako je prethodno pokretanje palo nakon koraka „obvezni MFA”, institucija e2e ostaje s
# obveznim MFA i administratorom s uključenim MFA, pa bi sljedeće pokretanje palo već na prijavi. Vrati polazno stanje.
(cd apps/api && node -e '
const { Client } = require("pg");
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_MIGRATE_URL }); await c.connect();
  await c.query("update tenants set settings = settings - $1 where slug = $2", ["requireMfa", "e2e"]);
  await c.query("update users set mfa_enabled = false, mfa_secret_enc = null, mfa_pending_enc = null, mfa_last_step = null where email = $1 and tenant_id = (select id from tenants where slug = $2)", ["admin@e2e.local", "e2e"]);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
')
# Zauzet port bi značio da test razgovara sa starim poslužiteljem – odbij start.
for p in 3100 4173; do if (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null; then echo "Port $p je zauzet (stari poslužitelj?) – zaustavi ga prije e2e testa." >&2; exit 1; fi; done
# `exec` da PID bude sam proces poslužitelja (inače `kill` ugasi samo ljusku, a poslužitelj ostane).
(cd apps/api && PORT=3100 exec node dist/main.js > /tmp/arqus-e2e-api.log 2>&1) & API_PID=$!
(cd apps/web && ARQUS_API_URL=http://localhost:3100 exec node_modules/.bin/vite preview --port 4173 --strictPort > /tmp/arqus-e2e-web.log 2>&1) & WEB_PID=$!
trap 'kill $API_PID $WEB_PID 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -sf http://localhost:3100/api/health >/dev/null && curl -sf http://localhost:4173 >/dev/null && break; sleep 1; done
ARQUS_API_URL=http://localhost:3100 WEB_URL=http://localhost:4173 node apps/web/e2e/smoke.cjs
