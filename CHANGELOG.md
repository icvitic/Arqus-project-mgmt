# Changelog

Format prema [Keep a Changelog](https://keepachangelog.com/hr/1.1.0/), verzije prema [SemVer](https://semver.org/lang/hr/). Do prve komercijalne verzije koristi se 0.x.

## [Unreleased]

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
