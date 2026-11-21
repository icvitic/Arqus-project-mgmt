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
**Testovi nad stvarnim SMTP poslužiteljem (WP1.21).** SMTP klijent i slanje pozivnice provjeravaju se i nad Mailpitom u Dockeru (STARTTLS s testnim certifikatom iz `apps/api/test/fixtures/smtp-test.*`, obvezna prijava) – ista naredba kao u CI-ju:
```bash
sh scripts/smtp-test.sh up
TEST_SMTP_PORT=1125 TEST_SMTP_API=http://127.0.0.1:8125 pnpm test
sh scripts/smtp-test.sh down
```
Bez `TEST_SMTP_PORT` preskaču se uz poruku `[WP1.21] … PRESKAČU`; testovi klijenta nad lažnim poslužiteljem u procesu (`smtp-client.test.ts`) rade uvijek.

Bez `TEST_S3_ENDPOINT` ti se testovi preskaču uz poruku `[WP1.20] … PRESKAČU` (ostali rade bez Dockera); ako je postavljen, a MinIO ne radi, padaju. Aplikacija lokalno s S3: `DOCUMENTS_STORAGE=s3` i `DOCUMENTS_S3_*` (vidi `infra/prod/.env.example`).

## Web sučelje
`pnpm dev` diže API (3000) i web (5173, proxy `/api`). Prijava: oznaka institucije `razvoj`, `admin@razvoj.local` / `Zeleni-Kamen-2026` (nakon `db:seed`).
Pakete po pozivu ured za projekte stvara u izborniku **Paketi programa → Novi paket po pozivu** (nasljeđuje programski paket, provjera prije spremanja, objava).

## E2E provjera u pregledniku
```bash
DATABASE_MIGRATE_URL=postgres://arqus@127.0.0.1:5433/arqus_e2e DATABASE_URL=postgres://arqus_app:arqus@127.0.0.1:5433/arqus_e2e apps/web/e2e/run-local.sh
```
Izgradi sve, primijeni migracije i seed, digne API i `vite preview` te Playwrightom prođe cijeli tok sučelja (prijava → paket → radar → prijava na poziv → projekt → proračun → aktivacija → timesheet → trošak → ZNS → dokumenti → uvoz → portfelj → revizija → pozivnica → MFA → „Moj rad” s odgovornom osobom). `E2E_SHOTS=<mapa>` sprema snimke zaslona. Playwright i axe-core su razvojne ovisnosti `apps/web` (točne verzije); lokalno koristi već instaliran Chromium (`PLAYWRIGHT_BROWSERS_PATH`), inače jednom `pnpm --filter @arqus/web exec playwright install chromium`.

**Od v0.32.0 (WP1.22) i u CI-ju** – zaseban posao `e2e-browser` u `.github/workflows/ci.yml` na svakom pull requestu: PostgreSQL 16 kao servis, `playwright install --with-deps chromium`, zatim ista skripta `run-local.sh`. Pri neuspjehu ispisuje zapise API-ja i weba; snimke, zapisi i nalazi pristupačnosti (`a11y.json`) uvijek su artefakt posla `e2e-browser`.

### Provjera pristupačnosti (WCAG 2.1 AA)
Dio iste e2e skripte (`apps/web/e2e/a11y.cjs`, `docs/PRISTUPACNOST.md`):
- **axe-core** na svakom stanju zaslona koje tok dosegne (≈ 50: prijava, javne stranice pozivnice i nove lozinke, Moj rad, portfelj, radar, prijave, sve kartice projekta, korisnici, račun, revizija, paketi, organizacije, otvoreni dijalozi i izbornik obavijesti, obrazac s greškom, prazno stanje), u svijetloj i tamnoj temi (`prefers-color-scheme`) te na 1400 i 390 px. Nalaz utjecaja *serious* ili *critical* uz oznake `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` **ruši e2e**; manji se ispisuju. Na kraju zbroj po pravilu.
- **Skriptirane provjere** (isto ruše e2e): točno jedan `h1` i razine naslova bez preskoka, `lang="hr"`, naslov dokumenta po ruti (dva zaslona ne dijele naslov), orijentiri (zaglavlje, izbornik s nazivom, jedan `main`), „Preskoči na sadržaj” prvi u redoslijedu tipke Tab, područje `aria-live`, preljev na 320 px bez vodoravnog pomicanja stranice, vidljiv fokus na svakom zaustavljanju tipke Tab, fokus zarobljen u dijalogu i vraćen nakon zatvaranja, fokus na naslov nakon promjene stranice; glavni tokovi samo tipkovnicom (prijava, član tima iz „Moj rad” upisuje i predaje timesheet, voditelj odobrava, financije otvaraju ZNS i popis za provjeru, administrator poziva korisnika, kartice strelicama, izbornik obavijesti).
- `A11Y_REPORT=<datoteka.json>` zapisuje sve nalaze; `A11Y_ONLY_LIGHT=1` samo svjetla tema (brže lokalno).

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
- Događaj koji se tiče drugog korisnika (odobren ili vraćen timesheet, odluka o ZNS-u, pristup, imenovanje, uvoz) upisuje obavijest `notify()` (`apps/api/src/notifications/notify.ts`) u istoj transakciji: nikad akteru, uz `requires` (dozvola koju primatelj mora imati na projektu), bez iznosa i bez slobodnog teksta osim razloga koji primatelj vidi na entitetu. Tekst obavijesti je u domeni (`notificationText`). Pravila: `docs/domena/moj-rad-i-obavijesti.md`.
- Korisnik s lozinkom u testu nastaje samo kroz pozivnicu (`apps/api/test/invite.ts` – API bez e-pošte vraća token, test ga prihvaća); API nema prečac za postavljanje tuđe lozinke. Javna ruta s tokenom prima token u tijelu, nikad u putanji ili upitu; poveznica s tokenom u sučelju ima token u fragmentu (`#/…`). E-pošta se šalje samo kroz `MailService.enqueue` (izvan zahtjeva, sadržaj se ne sprema, poveznice samo iz `PUBLIC_URL` – `appLink`); predložak poruke je čista funkcija u `packages/domain/src/mail.ts`.
- Brojka koja se pokazuje na portfelju i u „Moj rad” (troškovi bez dokaza, visoki rizici, razdoblje predano…) definira se jednom u `apps/api/src/portfolio/facts.ts`; nova vrsta stavke „Moj rad” ide u `deriveWorkItems` (`packages/domain/src/my-work.ts`) s testom, činjenice se skupljaju jednim upitom za sve projekte (bez upita po projektu).
- „Danas” se uvijek računa u zoni institucije: `tenantToday()` / `tenantTimeZone()` (`common/tenant-context.ts`), u domeni `todayIn()`; nikad `toISOString().slice(0, 10)`.
- Tablica koja pokazuje na drugi redak stanara ima kompozitni strani ključ `(tenant_id, <fk>)` → `(tenant_id, id)`; sam RLS ne štiti strane ključeve.
- Migracije generiraj s `pnpm --filter @arqus/api db:generate --name <naziv>`: skripta sama premješta UNIQUE ograničenja ispred stranih ključeva koji ih koriste.
- WP1.23: nova tablica ili stupac s osobnim podacima (ime, e-adresa, veza na korisnika ili člana tima, IP, slobodni tekst, plaća…) traži zapis u `docs/gdpr/evidencija-obrade.json` i red u `docs/gdpr/EVIDENCIJA-OBRADE.md` – `test/privacy-inventory.test.ts` inače pada; po potrebi i kategoriju izvoza (`src/privacy/subject-data.ts`) i rok čuvanja (`src/privacy/retention-policy.ts`). Revizijski zapis nitko ne mijenja ni ne briše osim funkcije `privacy_audit_purge` (migracija 0032).
- WP1.24: rok za odgovor na zahtjev ispitanika računa samo domena (`subjectRequestDue`, `packages/domain/src/subject-requests.ts`) i sprema se u `subject_requests.due_on`; klijent ga ne šalje. Revizijski zapis o zahtjevu ne smije sadržavati ime podnositelja, kontakt ni slobodni tekst (revizija se čuva dulje od evidencije); stavka „Moj rad” također ne.
- WP1.25: izgled se slaže od postojećih dijelova i varijabli (`docs/dizajn/DIZAJN-SUSTAV.md`); nova boja ili veličina ide kao varijabla na vrh `styles.css` u obje teme i mora proći provjeru pristupačnosti u e2e. Tekst na bočnoj traci koristi `--ink-fg` / `--ink-strong`, nikad `--muted`.
- Nova tablica = migracija s `ENABLE/FORCE ROW LEVEL SECURITY`, politika po `app_current_tenant()`, GRANT za `arqus_app` i test u `test/rls.test.ts`. Osobni retci unutar institucije (obavijesti) imaju i politiku po korisniku (`app_current_user()` iz `app.user_id`, koji postavlja servis prije čitanja).
- Paket po pozivu: stanarski JSON s `meta.extends = <id programskog paketa>` i samo razlikama; `POST /api/programme-packages/validate` vraća razriješeni paket; nakon `publish` je nepromjenjiv.
- Migracije: promijeni `src/db/schema.ts` → `pnpm --filter @arqus/api db:generate` → dopuni RLS u generiranom SQL-u ili novoj `--custom` migraciji.
- Svaka promjena sheme paketa: ažurirati `docs/domena/paketi/schema.v1.json` i kopiju u `packages/domain/src/schema/` (test to provjerava).
