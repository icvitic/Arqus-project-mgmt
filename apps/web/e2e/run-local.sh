#!/usr/bin/env bash
# Lokalna e2e provjera: migracije + seed na testnoj bazi, izgrađeni API (port 3100), vite preview (4173), Playwright.
# Varijable: DATABASE_MIGRATE_URL (vlasnik), DATABASE_URL (arqus_app), E2E_SHOTS (mapa za snimke, neobavezno).
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"; cd "$ROOT"
: "${DATABASE_MIGRATE_URL:?postavi DATABASE_MIGRATE_URL}"; : "${DATABASE_URL:?postavi DATABASE_URL}"
pnpm build >/dev/null
(cd apps/api && node -r ./scripts/register.js scripts/migrate.ts && SEED_TENANT_SLUG=e2e SEED_TENANT_NAME="E2E institucija" SEED_ADMIN_EMAIL=admin@e2e.local SEED_ADMIN_PASSWORD=E2e-lozinka-123 node -r ./scripts/register.js scripts/seed.ts)
(cd apps/api && PORT=3100 node dist/main.js > /tmp/arqus-e2e-api.log 2>&1) & API_PID=$!
(cd apps/web && ARQUS_API_URL=http://localhost:3100 pnpm exec vite preview --port 4173 --strictPort > /tmp/arqus-e2e-web.log 2>&1) & WEB_PID=$!
trap 'kill $API_PID $WEB_PID 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -sf http://localhost:3100/api/health >/dev/null && curl -sf http://localhost:4173 >/dev/null && break; sleep 1; done
ARQUS_API_URL=http://localhost:3100 WEB_URL=http://localhost:4173 node apps/web/e2e/smoke.cjs
