# Razvoj – lokalno pokretanje

## Preduvjeti
Node 22 (`.nvmrc`), pnpm 10 (`corepack enable`), Docker (za bazu, Redis, MinIO).

## Prvi put
```bash
pnpm install
```
```bash
pnpm infra:up
```
```bash
pnpm build
```

## Baza (nakon `pnpm infra:up` i `pnpm build`)
```bash
pnpm --filter @arqus/api db:migrate
```
```bash
pnpm --filter @arqus/api db:seed
```
```bash
pnpm --filter @arqus/api db:import-packages   # osvježi globalne pakete nakon promjene JSON-a u docs/domena/paketi
```
Seed stvara sistemske uloge i demo stanara `demo` s administratorom `admin@demo.local` / `Demo-lozinka-1` (promjenjivo kroz `SEED_*` varijable). Prijava: `POST /api/auth/login {tenantSlug, email, password}` → `accessToken` (Bearer).

Dvije uloge u bazi: `arqus` (vlasnik, migracije) i `arqus_app` (aplikacija, bez BYPASSRLS). API uvijek radi pod `arqus_app`, pa RLS politike vrijede i za grešku u kodu. Testovi traže PostgreSQL na `127.0.0.1:5433` (`TEST_DATABASE_MIGRATE_URL`, `TEST_DATABASE_URL`); CI ga diže kao servis.

## Svakodnevno
```bash
pnpm dev
```
API: http://localhost:3000/api/health · Web: http://localhost:5173 (proxy `/api` → 3000).

```bash
pnpm typecheck && pnpm lint && pnpm test
```

## Struktura
| Putanja | Sadržaj |
| --- | --- |
| `apps/api` | NestJS API; jedan modul po domenskom modulu (`src/health`, `src/programmes`, `src/identity`, `src/audit`); `src/db` Drizzle shema i servis; `drizzle/` migracije |
| `apps/web` | React/Vite sučelje |
| `packages/domain` | tipovi, validator paketa programa, izračun proračuna; CLI `node packages/domain/dist/cli.js <mapa>` |
| `docs/domena/paketi` | izvor istine za shemu i pakete programa (HE, NPOO) |
| `infra` | Docker Compose i `.env.example` |
| `prototip` | klikabilni prototip iz faze 0 (bez backenda) |

## Pravila
- Moduli API-ja ne čitaju tuđe tablice; komunikacija kroz servise i događaje (ADR-0002, domenski model odj. 1).
- Izračuni koji ovise o pravilima programa žive u `@arqus/domain`, ne u kontrolerima.
- Svaki poslovni upit ide kroz `DbService.tx()` (stanar iz konteksta) ili `withTenant()`; `withoutTenant()` samo za prijavu i sistemske poslove.
- Svaka promjena poslovnih podataka zove `AuditService.record()` u istoj transakciji. Zapis neuspjele radnje ide u zasebnoj transakciji.
- Tablica koja pokazuje na drugi redak stanara ima kompozitni strani ključ `(tenant_id, <fk>)` → `(tenant_id, id)`; sam RLS ne štiti strane ključeve.
- Provjeri redoslijed u migraciji koju generira drizzle-kit: jedinstveno ograničenje mora biti prije stranog ključa koji ga koristi.
- Nova tablica = migracija s `ENABLE/FORCE ROW LEVEL SECURITY`, politika po `app_current_tenant()`, GRANT za `arqus_app` i test u `test/rls.test.ts`.
- Paket po pozivu: stanarski JSON s `meta.extends = <id programskog paketa>` i samo razlikama; `POST /api/programme-packages/validate` vraća razriješeni paket; nakon `publish` je nepromjenjiv.
- Migracije: promijeni `src/db/schema.ts` → `pnpm --filter @arqus/api db:generate` → dopuni RLS u generiranom SQL-u ili novoj `--custom` migraciji.
- Svaka promjena sheme paketa: ažurirati `docs/domena/paketi/schema.v1.json` i kopiju u `packages/domain/src/schema/` (test to provjerava).
