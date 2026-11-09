# Changelog

Format prema [Keep a Changelog](https://keepachangelog.com/hr/1.1.0/), verzije prema [SemVer](https://semver.org/lang/hr/). Do prve komercijalne verzije koristi se 0.x.

## [Unreleased]

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
