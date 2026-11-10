# Stanje projekta

**Zadnje ažuriranje:** 2026-11-10 · **Verzija:** v0.13.0 · **Faza:** 1 – MVP i pilot

## Gotovo
- Odgovori Ivana (2026-11-10): pilot-institucija još ne postoji; EU pružatelj nije odabran; HE i NPOO paketi smiju se objaviti.
- v0.13.0: paketi HE i NPOO provjereni i objavljeni; WP1.9 dio neovisan o pružatelju – Docker slika, produkcijski compose (HTTPS, kopije), sigurnosna zaglavlja, ograničenje prijava, ASVS L2 samoprocjena, upute za instalaciju. Slika testirana e2e testom.
- WP1.10 (v0.12.0): web sučelje za pilot – projekti, organizacije, struktura, proračun, timesheetovi, troškovi, ZNS, ugovoreno/ostvareno; e2e provjera cijelog toka u pregledniku. Prvi pilot može raditi kroz preglednik.
- WP1.8 (v0.11.0): tim, timesheetovi s izračunom troška osoblja iz paketa, troškovi, zahtjevi za nadoknadu (predaja, povrat, odluka, isplata), ugovoreno vs. ostvareno; nepromjenjivost prihvaćenih troškova u bazi. 78 testova. Backend jezgra provedbe za MVP je gotova.
- WP1.7 (v0.10.0): struktura provedbe (WP, zadaci, isporuke, prekretnice, rizici) i proračun projekta s izračunom iz paketa; zaključavanje proračuna aktivacijom; ograničenja baze → 409. 62 testa.
- WP1.6 (v0.9.0): organizacije, projekti, partneri, prijelazi statusa, izvještajna razdoblja iz paketa; kompozitni strani ključevi protiv miješanja stanara. 48 testova. PR #2 i #3 spojeni.
- WP1.3 (v0.8.0): paketi programa u bazi (globalni/stanarski, verzije, objava), uvoz iz datoteka, nasljeđivanje za paket po pozivu, ESLint. 30 testova.
- WP1.2 (v0.7.0): Drizzle, migracije, RLS po stanaru s testovima izolacije na pravoj bazi, aplikacijska DB uloga, prijava lozinkom + JWT, dozvole i sistemske uloge, revizijski zapis (append-only). 22 testa.
- WP1.1 (v0.6.0): monorepo `apps/api` (NestJS), `apps/web` (React/Vite), `packages/domain` (validator paketa, izračun proračuna), Docker Compose, CI; ADR-0008. PR #1 (faza 0) spojen u `main`.
- Odluka (Ivan, 2026-11-09): faza 1 financira se zasad iz vlastitih sredstava Arqus Solutionsa; prijava na EU poziv za MSP ostaje opcija za kasnije.
- Strategija i plan razvoja (Claude Docs, poveznica u `docs/strategija.md`).
- Odluka: proizvod razvija Arqus Solutions kao zaseban produkt (ADR-0005).
- Repozitorij, pravila verzioniranja i dokumentacije, ADR-0001 – ADR-0005.
- WP0.1: vodič za intervju, okvir popisa sugovornika, predložak bilješke s intervjua, početna analiza konkurencije.
- WP0.3 (v0.2.0): analiza konkurencije – 20 alata, karta tržišta, zaključci i pitanja za intervjue (`docs/faza-0/analiza-konkurencije.md`).
- WP0.6b + WP0.7 (v0.5.0): istraživanje tržišta iz javnih izvora, TAM/SAM/SOM, cjenovna hipoteza v2, odluka GO uvjetno; ADR-0007 (bez intervjua).
- Priprema WP0.2 i WP0.6 (v0.4.1): prijedlog 20 sugovornika, pozivna poruka, scenarij demonstracije, predložak sinteze s hipotezama, dopuna vodiča.
- WP0.5 (v0.4.0): klikabilni prototip (`prototip/index.html`) s automatskim testom toka; Windows pokretač `verzija.cmd`.
- Alati (v0.3.1): `scripts/verzija.sh` + lokalni preglednik verzija (`site/`), upute `docs/LOKALNO-TESTIRANJE.md`, dnevnik potrošnje `docs/POTROSNJA.md`.
- WP0.4 (v0.3.0): domenski model v1 – moduli, entiteti, životni ciklusi, invarijante (`docs/domena/domenski-model-v1.md`); JSON shema paketa programa + primjeri HE i NPOO (`docs/domena/paketi/`); ADR-0006.

## U tijeku
- WP1.9 – čeka odabir pružatelja i pilot-institucije (instalacija za ~1 sat prema `docs/PILOT-INSTALACIJA.md`) i vanjski penetracijski test.

## Sljedeće
1. WP1.2b – sigurnosni prioriteti iz ASVS pregleda: politika lozinki, korisnici i uloge u sučelju, poništenje sesija, MFA (TOTP); `pnpm audit` u CI-ju.
2. Sučelje za pakete po pozivu (stvaranje iz Uputa za prijavitelje, validacija, objava).
3. WP1.4–1.5 – radar poziva i prijava (pretvorba u projekt prema ADR-0006).

## Otvorena pitanja za Ivana
- Kad odabereš pružatelja i pilot-instituciju, instalacija ide prema `docs/PILOT-INSTALACIJA.md`; za vanjski penetracijski test treba budžet i izvođača.
- Prototip: isprobaj tok u `verzija.cmd` → verzija ≥ v0.4.0 → poveznica „Prototip”. Što nedostaje da ga pokažeš sugovorniku?
- NPOO stopa neizravnih troškova (15 %) nije potvrđena u pozivima – Upute za prijavitelje jednog stvarnog poziva i dalje bi pomogle.
- Identitet za pilote: koriste li ciljne institucije AAI@EduHr (sveučilišta) ili Microsoft 365? To određuje redoslijed u WP1.2b.
- Potrošnja: Claude ne može očitati tvoj brojač; ako želiš nadzor, povremeno upiši postotak iz Settings → Usage u `docs/POTROSNJA.md` ili ga javi u poruci.
- Konačan naziv proizvoda (radni: „ArQus Projekti”).
- Tko provodi intervjue (Ivan osobno ili netko iz Arqus Solutions)?
- Znaš li za HR institucije koje koriste EMDESK ili Kronis (Sploro)? To bi bili dobri sugovornici za WP0.2.
- NPOO paket je ilustrativan (stope ovise o pozivu). Imaš li Upute za prijavitelje nekog konkretnog NPOO poziva koje bi poslužile kao prvi „paket po pozivu”?

## Blokade
- Nema.
