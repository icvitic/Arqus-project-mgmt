# Changelog

Format prema [Keep a Changelog](https://keepachangelog.com/hr/1.1.0/), verzije prema [SemVer](https://semver.org/lang/hr/). Do prve komercijalne verzije koristi se 0.x.

## [Unreleased]

## [0.11.0] - 2026-11-10
### Dodano
- WP1.8 tim i timesheetovi: `team_members` (godišnji trošak osoblja), mjesečni `timesheets` (nacrt → predan → odobren → zaključan) s unosom u minutama po danu i radnom paketu. Odobrenje stvara troškove osoblja po WP-u prema pravilu paketa (satnica ili dnevnica). Bez dozvole `timesheets:approve` korisnik uređuje samo vlastiti timesheet.
- Troškovi (`expenses`): ručna evidencija s kategorijom iz paketa, WP-om, dobavljačem i oznakom dokaza; datum unutar trajanja projekta; trošak osoblja ne unosi se ručno kad paket traži evidenciju rada.
- Zahtjevi za nadoknadu (`reimbursement_claims`) po izvještajnom razdoblju i partneru: nacrt s pregledom prihvatljivih troškova i izračunom, predaja (troškovi pridruženi, timesheetovi zaključani), odluka (odobren, djelomično, odbijen, vraćen na dopunu), isplata.
- `GET /api/projects/:id/finance`: ugovoreno vs. ostvareno po kategoriji i partneru, pregled ZNS-ova.
- Baza: okidač koji prihvaćene i odbijene troškove čini nepromjenjivima (invarijanta 6), CHECK da je trošak u zahtjevu točno kad nije „evidentiran”.
- Shema paketa: `personnelRule.categoryCode` i `hoursPerDay` (HE `A.1`, NPOO `OS`), semantička provjera.
- `@arqus/domain`: `personnelCostCents`, `timesheetIssues`, `minutesByWorkPackage`, `daysInMonth`.
- `db:generate` automatski premješta UNIQUE ograničenja ispred stranih ključeva (problem se ponavljao u tri migracije).
- Dozvole `timesheets:read/write/approve`. Testovi: ukupno 78 (28 domena, 50 API).

## [0.10.0] - 2026-11-10
### Dodano
- WP1.7 provedba: tablice `work_packages`, `tasks`, `deliverables`, `milestones`, `risks` (migracije 0006/0007, RLS, kompozitni FK, CHECK ograničenja). REST pod `/api/projects/:id`: `structure` (ugniježđeno, oznake WP1/T2.1/D1.1/MS1, rokovi kao datumi), stvaranje i izmjena WP-ova, zadataka, isporuka, prekretnica i rizika; brisanje praznog WP-a.
- Pravila: mjeseci unutar trajanja projekta i WP-a, voditelj mora biti partner projekta, vrsta isporuke i razina diseminacije iz paketa, `submittedAt` pri predaji isporuke, razina rizika (vjerojatnost × utjecaj).
- WP1.7 proračun: `project_budgets` (verzije, nacrt/zaključan) i `budget_lines` (partner × kategorija × WP, centi). `GET /api/projects/:id/budget` s izračunom po partneru i ukupno; `PUT .../budget/lines` (tablični unos). Aktivacija projekta zaključava proračun v1.
- `@arqus/domain`: `computeProjectBudget`, `budgetLineIssues` (samo listovi stabla kategorija, bez neizravnih), `monthEndDate`, `riskLevel`.
- Globalni filtar grešaka PostgreSQL ograničenja (jedinstvenost, strani ključ, CHECK) → 409 umjesto 500.
- Testovi: ukupno 62 (22 domena, 40 API).

## [0.9.0] - 2026-11-09
### Dodano
- WP1.6: tablice `organisations`, `projects`, `project_partners`, `reporting_periods` (migracije 0004/0005, RLS s FORCE). Kompozitni strani ključevi `(tenant_id, id)` sprječavaju vezu na retke drugog stanara i kad je id poznat (provjere stranih ključeva u PostgreSQL-u zaobilaze RLS).
- REST `/api/organisations` (popis s pretragom, dohvat, stvaranje, izmjena; validacija PIC/OIB) i `/api/projects` (popis, detalj s partnerima i razdobljima, stvaranje uz paket i vrstu akcije, izmjena, dodavanje/uklanjanje partnera, `POST /:id/transition`).
- Vlastita organizacija stanara dodaje se automatski kao partner; vrsta korisnika (npr. `nonProfit`) određuje se iz paketa i organizacije.
- `@arqus/domain`: životni ciklus projekta (`transitionIssues`), datumi bez pomaka vremenske zone, `generateReportingPeriods` (aktivacija generira razdoblja iz pravila paketa).
- Zod validacija tijela zahtjeva (`parseBody`, 400 s popisom problema); dozvole `organisations:read/write`.
- Testovi: ukupno 48 (17 domena, 31 API) – uključuje provjeru da svaka tablica ima prisilni RLS i napad preko poznatog id-a tuđe organizacije.
### Promijenjeno
- Projekt se aktivira samo uz objavljenu verziju paketa; nakon aktivacije početak, trajanje i partneri mijenjaju se samo amandmanom (dolazi kasnije).
- Pravilo rada: Claude spaja PR čim CI prođe (AUTONOMNI-RAD, t. 7).

## [0.8.0] - 2026-11-09
### Dodano
- WP1.3: tablica `programme_packages` (globalni paketi `tenant_id NULL` vidljivi svima, stanarski izolirani RLS-om), migracije 0002/0003; uvoz globalnih paketa iz `docs/domena/paketi` (`db:import-packages`, idempotentno po checksumu; seed ga poziva); REST: popis, dohvat razriješenog paketa (`?version=`), `POST /validate`, `POST` (stanarski nacrt), `POST /:id/publish`.
- `@arqus/domain`: nasljeđivanje paketa (`mergePackages`, `resolvePackage`) – paket po pozivu nasljeđuje programski paket i mijenja samo razlike; otkrivanje kružnog nasljeđivanja; semantička validacija izvodi se na razriješenom paketu.
- ESLint 9 (flat config, typescript-eslint) + `pnpm lint` u CI-ju.
- Testovi: ukupno 30 (10 domena, 7 RLS, 13 e2e).
### Promijenjeno
- Paketi programa se više ne čitaju iz datoteka pri pokretanju API-ja nego iz baze.
- CI: izgradnja prije typechecka (CI je padao jer `@arqus/domain` nije imao `dist`).

## [0.7.0] - 2026-11-09
### Dodano
- WP1.2: Drizzle shema (`tenants`, `users`, `roles`, `role_assignments`, `audit_entries`) i migracije; RLS na svim tablicama s `FORCE`, politike po `app_current_tenant()`, zasebna aplikacijska uloga `arqus_app` bez BYPASSRLS, revizijski zapis samo za dodavanje (bez UPDATE/DELETE prava).
- Identitet: prijava lozinkom (scrypt) + JWT (HS256, `jose`), `AuthGuard` s `@Public()` i `@RequirePermission()`, kontekst zahtjeva (AsyncLocalStorage) → `DbService.tx()` postavlja stanara u transakciji; katalog dozvola i 6 sistemskih uloga; rute `/api/auth/login`, `/api/me`, `/api/users`, `/api/audit`.
- Seed (`db:seed`) i migracijska skripta (`db:migrate`); CI s PostgreSQL servisom.
- Testovi: 6 RLS testova na pravoj bazi (izolacija čitanja i pisanja, fail-closed bez konteksta, nepromjenjiva revizija, sistemske uloge) + 6 e2e testova identiteta; ukupno 22 testa prolaze.
### Promijenjeno
- Sve rute osim `/api/health` i `/api/auth/login` traže Bearer token; paketi programa traže `packages:read`.
- ADR-0008 dopunjen odlukom o Drizzleu i autentikaciji; OIDC/SAML i MFA izdvojeni u WP1.2b.

## [0.6.0] - 2026-11-09
### Dodano
- WP1.1 temelji platforme: pnpm monorepo; `packages/domain` (tipovi paketa programa, validator Ajv 2020-12 + semantička pravila, izračun proračuna partnera s izvedenim neizravnim troškovima i stopom financiranja, CLI); `apps/api` NestJS s modulima `health` i `programmes` (učitava i validira pakete iz `docs/domena/paketi`, REST `/api/programme-packages`); `apps/web` React/Vite početna stranica; `infra/docker-compose.yml` (PostgreSQL 16, Redis 7, MinIO); GitHub Actions CI; `docs/RAZVOJ.md`.
- ADR-0008: tehnološki okvir (NestJS, React/Vite, Vitest, pnpm, PostgreSQL).
- Testovi: 7 jediničnih (domena) + 3 e2e (API); svi prolaze. Izgrađeni API provjeren ručno.

## [0.5.0] - 2026-11-09
### Dodano
- WP0.6b: istraživanje tržišta iz javnih izvora (`docs/faza-0/istrazivanje-trzista.md`) – veličina i rast tržišta, obujam Horizon Europe (HR: 352 projekta, 539 sudjelovanja 2021.–2024.), SAFU 2024 (262 ugovora, 1.807 ZNS-ova), broj potencijalnih kupaca u HR (117 visokih učilišta…), TAM/SAM/SOM, posljedice za proizvod.
- WP0.7: cjenovna hipoteza v2 (Projekt 150 EUR/projekt/mj., Institucija 6.000 EUR/god., Institucija+ 13.200 EUR/god., PaaS od 25.000 EUR/god.; sve ispod praga jednostavne nabave), projekcija prihoda i odluka **GO, uvjetno** (`docs/faza-0/cjenovna-hipoteza-v2.md`).
- ADR-0007: faza 0 zatvara se desk istraživanjem umjesto intervjuima; provjera s kupcima seli u pilote faze 1.
### Promijenjeno
- ROADMAP: WP0.2 i WP0.6 ukinuti; novi kriterij za fazu 2; redoslijed faze 1 – provedba i troškovi/ZNS (novi WP1.8) prije radara i prijave; sigurnosni pregled postaje WP1.9.

## [0.4.1] - 2026-11-09
### Dodano
- WP0.2 (priprema): prijedlog 20 sugovornika po segmentima – institucije, ciljne uloge, razlozi, javne ulazne točke, prioriteti i raspored kontakta (`docs/faza-0/prijedlog-sugovornika.md`); predložak pozivne poruke (`pozivna-poruka.md`). Bez osobnih podataka; čeka Ivanovo odobrenje.
- WP0.6 (priprema): scenarij 10-minutne demonstracije prototipa s pitanjima po koraku (`scenarij-demonstracije.md`); predložak sinteze s 10 hipoteza H1–H10 i tablicom reakcija na prototip (`sinteza-predlozak.md`); mapa `intervjui/` s pravilima.
### Promijenjeno
- Vodič za intervju: dopunska pitanja 17–24 (iz analize konkurencije i domenskog modela) i korak demonstracije.

## [0.4.0] - 2026-11-09
### Dodano
- WP0.5: klikabilni prototip `prototip/index.html` – radar poziva s ocjenom prikladnosti i go/no-go, prijava (konzorcij, radni paketi, proračun po pravilima paketa s izračunom neizravnih troškova i stope financiranja, verzije proračuna, provjera spremnosti, predaja, ishod), ugovaranje prema ADR-0006, projekt (aktivacija, izvještajna razdoblja iz paketa, isporuke, prekretnice, troškovi vs. ugovoreno), portfelj. Tok provjeren automatski u Chromiumu.
- `verzija.cmd` + `scripts/verzija.py`: Windows/međuplatformski pokretač – povlači verzije s GitHuba, nudi izbornik, izdvaja odabranu verziju i pokreće je lokalno s preglednikom.
### Promijenjeno
- ADR-0006 potvrdio Ivan (2026-11-09).

## [0.3.1] - 2026-11-09
### Dodano
- `scripts/verzija.sh`: popis verzija iz release commitova, izdvajanje verzija u `.verzije/` (git worktree), usporedba, lokalni poslužitelj.
- `site/index.html`: lokalni preglednik dokumentacije po verzijama (Markdown + Mermaid, JSON, HTML), testiran u pregledniku.
- `docs/LOKALNO-TESTIRANJE.md` (upute) i `docs/POTROSNJA.md` (dnevnik potrošnje tokena s pravilima pauziranja).

## [0.3.0] - 2026-11-09
### Dodano
- WP0.4: domenski model v1 (`docs/domena/domenski-model-v1.md`) – 11 modula, entiteti s atributima, životni ciklusi (poziv, prijava, projekt, zahtjev za nadoknadu, timesheet), ER dijagram, 9 invarijanti, pitanja za intervjue.
- Nacrt JSON sheme paketa programa (`docs/domena/paketi/schema.v1.json`) i dva primjera paketa koji prolaze validaciju: Horizon Europe 2021–2027 i NPOO 2021–2026 (ilustrativan).
- ADR-0006: prijava i projekt su odvojeni agregati; ugovaranje kopira proračun i strukturu.

## [0.2.0] - 2026-11-09
### Dodano
- WP0.3 (dio 2/2): Converis, Cayuse, InfoEd, GrantBite, ažurirane cijene Instrumentla; konačna karta tržišta, zaključci za proizvod i pitanja za intervjue. WP0.3 završen.
- WP0.3 (dio 1/2): analiza konkurencije proširena na 15+ alata u četiri skupine (EU specijalizirani, institucijski sustavi, javni HR/EU alati, opći PM), s cijenama, pokrivenošću životnog ciklusa, izvorima i preliminarnom kartom tržišta.

### Promijenjeno
- Samostalni rad: jedna sesija dnevno u Claude Code u oblaku (umjesto tri tjedno).

## [0.1.1] - 2026-11-09
### Promijenjeno
- Verzija se vodi u datoteci `VERSION` i commitovima `release: vX.Y.Z` jer sesije ne smiju stvarati git tagove ni GitHub Release.

## [0.1.0] - 2026-11-08
### Dodano
- Početna struktura repozitorija i dokumentacije (README, STATUS, ROADMAP, CONTRIBUTING, pravila autonomnog rada).
- Sažetak strategije s poveznicom na puni dokument.
- ADR-0001 do ADR-0005: zapis odluka, multi-tenant modularni monolit, EU hosting, paketi programa, odvojenost od FPZ portala.
- Faza 0 (WP0.1): vodič za intervju, okvir popisa sugovornika, predložak bilješke, početna analiza konkurencije.
