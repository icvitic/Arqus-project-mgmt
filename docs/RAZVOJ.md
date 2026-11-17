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
Seed stvara sistemske uloge i razvojnog stanara `razvoj` s administratorom `admin@razvoj.local` / `Zeleni-Kamen-2026` (promjenjivo kroz `SEED_*` varijable; lozinka iz `SEED_ADMIN_PASSWORD` mora zadovoljiti politiku lozinki, administrator se traži samo unutar tog stanara). Oznaka `demo` ostaje slobodna za demo instituciju (`cli demo`). Prijava: `POST /api/auth/login {tenantSlug, email, password}` → `accessToken` (Bearer).

Dvije uloge u bazi: `arqus` (vlasnik, migracije) i `arqus_app` (aplikacija, bez BYPASSRLS). API uvijek radi pod `arqus_app`, pa RLS politike vrijede i za grešku u kodu. Testovi traže PostgreSQL na `127.0.0.1:5433` (`TEST_DATABASE_MIGRATE_URL`, `TEST_DATABASE_URL`); CI ga diže kao servis.

Demo institucija s realnim podacima (WP1.13): `node dist/db/cli.js demo [--reset] [--slug <oznaka>]` u `apps/api`, uz `DATABASE_MIGRATE_URL` i `DATABASE_URL`; vidi [DEMO.md](DEMO.md).

## Svakodnevno
```bash
pnpm dev
```
API: http://localhost:3000/api/health · Web: http://localhost:5173 (proxy `/api` → 3000).

```bash
pnpm typecheck && pnpm lint && pnpm test
```

**Testovi nad S3 (WP1.20).** Pohrana dokumenata u S3, `documents verify/migrate` i kopije izvan poslužitelja testiraju se i nad stvarnim S3-kompatibilnim poslužiteljem (MinIO u Dockeru) – ista naredba kao u CI-ju:
```bash
sh scripts/minio-test.sh up
TEST_S3_ENDPOINT=http://127.0.0.1:9100 TEST_S3_ACCESS_KEY_ID=arqus-test TEST_S3_SECRET_ACCESS_KEY=arqus-test-secret-123 pnpm test
sh scripts/minio-test.sh down
```
Bez `TEST_S3_ENDPOINT` ti se testovi preskaču uz poruku `[WP1.20] … PRESKAČU` (ostali rade bez Dockera); ako je postavljen, a MinIO ne radi, padaju. Aplikacija lokalno s S3: `DOCUMENTS_STORAGE=s3` i `DOCUMENTS_S3_*` (vidi `infra/prod/.env.example`).

## Web sučelje
`pnpm dev` diže API (3000) i web (5173, proxy `/api`). Prijava: oznaka institucije `razvoj`, `admin@razvoj.local` / `Zeleni-Kamen-2026` (nakon `db:seed`).
Pakete po pozivu ured za projekte stvara u izborniku **Paketi programa → Novi paket po pozivu** (nasljeđuje programski paket, provjera prije spremanja, objava).

## E2E provjera u pregledniku
```bash
DATABASE_MIGRATE_URL=postgres://arqus@127.0.0.1:5433/arqus_e2e DATABASE_URL=postgres://arqus_app:arqus@127.0.0.1:5433/arqus_e2e apps/web/e2e/run-local.sh
```
Izgradi sve, primijeni migracije i seed, digne API i `vite preview` te Playwrightom prođe tok prijava → projekt → proračun → aktivacija → timesheet → trošak → ZNS. `E2E_SHOTS=<mapa>` sprema snimke zaslona. Nije u CI-ju (traži preglednik); pokrenuti prije spajanja promjena u sučelju.

## Struktura
| Putanja | Sadržaj |
| --- | --- |
| `apps/api` | NestJS API; jedan modul po domenskom modulu (`src/health`, `src/programmes`, `src/identity`, `src/audit`); `src/db` Drizzle shema i servis; `drizzle/` migracije |
| `apps/web` | React/Vite sučelje: `src/pages` (stranice), `src/tabs` (kartice projekta), `src/lib` (API klijent, formatiranje, tipovi), `e2e/` (Playwright) |
| `packages/domain` | tipovi, validator paketa programa, izračun proračuna; CLI `node packages/domain/dist/cli.js <mapa>` |
| `docs/domena/paketi` | izvor istine za shemu i pakete programa (HE, NPOO) |
| `infra` | Docker Compose i `.env.example` |
| `prototip` | klikabilni prototip iz faze 0 (bez backenda) |

## Pravila
- Moduli API-ja ne čitaju tuđe tablice; komunikacija kroz servise i događaje (ADR-0002, domenski model odj. 1).
- Izračuni koji ovise o pravilima programa žive u `@arqus/domain`, ne u kontrolerima.
- Svaka nova ruta dobiva točno jednu oznaku autorizacije (`apps/api/src/identity/auth.guard.ts`): ruta s projektom u putanji `@ProjectPermission(p)` (parametar `:id`), ruta s prijavom u putanji `@ProposalPermission(p)` (institucija ili voditelj te prijave), entitet projekta bez projekta u putanji `@ResolvesProject(p)` uz provjeru vlasnika u servisu (`assertProjectPermission`), radnja institucije `@RequirePermission(p)`. Ruta bez oznake se odbija, a `test/route-coverage.e2e.test.ts` pada – novi parametar putanje dodaj u `paramsB` tog testa. Model: `docs/sigurnost/AUTORIZACIJA.md`.
- Svaki poslovni upit ide kroz `DbService.tx()` (stanar iz konteksta) ili `withTenant()`; `withoutTenant()` samo za prijavu i sistemske poslove.
- Svaka promjena poslovnih podataka zove `AuditService.record()` u istoj transakciji. Zapis neuspjele radnje ide u zasebnoj transakciji. Tajne (lozinke, hashevi, MFA tajne, tokeni) ne idu u `diff` – `record()` ih ionako uklanja; iznosi plaća smiju (pregled ih skriva bez `personnel:read`).
- Jedna transakcija = jedan klijent baze: upiti na istom `tx` jedan za drugim, nikad `Promise.all` (prestaje raditi u pg 9).
- Spremanje koje zamjenjuje cijeli skup ili zapis (proračun, timesheet, osnovni podaci) prima **obaveznu** `revision` (`common/revision.ts`: `revisionField` u shemi – bez nje 400, `assertRevision` kao prva radnja, `bump` u svakoj izmjeni); sučelje je šalje i prikazuje `ConflictNotice` na 409. Ako spremanje može stvoriti prvi zapis (revizija 0), najprije zaključaj roditeljski redak (`for('no key update')`), da istovremeno prvo spremanje dobije `revision_conflict`.
- Iznos pripisiv radu jedne osobe (trošak osoblja iz timesheeta) vraća se samo uz `personnel:read` na projektu (`common/personnel.ts`: `seesPersonnelAmounts`, `hidesAmount`; inače `amount: null`, `amountHidden: true`). Zbrojevi po kategoriji smiju ostati.
- Skup izvoz (velik rezultat ili ZIP) koristi `ExportRateLimit.take(vrsta, korisnik)` i struji rezultat (`StreamableFile` s generatorom), bez cijelog sadržaja u memoriji.
- HTTP postavke (zaglavlja, parser tijela, prefiks) samo kroz `configureHttp` (`common/http-setup.ts`) – isto u `main.ts` i testovima.
- „Danas” se uvijek računa u zoni institucije: `tenantToday()` / `tenantTimeZone()` (`common/tenant-context.ts`), u domeni `todayIn()`; nikad `toISOString().slice(0, 10)`.
- Tablica koja pokazuje na drugi redak stanara ima kompozitni strani ključ `(tenant_id, <fk>)` → `(tenant_id, id)`; sam RLS ne štiti strane ključeve.
- Migracije generiraj s `pnpm --filter @arqus/api db:generate --name <naziv>`: skripta sama premješta UNIQUE ograničenja ispred stranih ključeva koji ih koriste.
- Nova tablica = migracija s `ENABLE/FORCE ROW LEVEL SECURITY`, politika po `app_current_tenant()`, GRANT za `arqus_app` i test u `test/rls.test.ts`.
- Paket po pozivu: stanarski JSON s `meta.extends = <id programskog paketa>` i samo razlikama; `POST /api/programme-packages/validate` vraća razriješeni paket; nakon `publish` je nepromjenjiv.
- Migracije: promijeni `src/db/schema.ts` → `pnpm --filter @arqus/api db:generate` → dopuni RLS u generiranom SQL-u ili novoj `--custom` migraciji.
- Svaka promjena sheme paketa: ažurirati `docs/domena/paketi/schema.v1.json` i kopiju u `packages/domain/src/schema/` (test to provjerava).
