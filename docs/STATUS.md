# Stanje projekta

**Zadnje ažuriranje:** 2026-11-09 · **Verzija:** v0.9.0 · **Faza:** 1 – MVP i pilot

## Gotovo
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
- Ništa – WP1.6 završen.

## Sljedeće
1. WP1.7 – provedba: radni paketi, zadaci, isporuke, prekretnice, rizici; proračun projekta po partneru i kategoriji s izračunom iz paketa (`computePartnerBudget`).
2. WP1.8 – troškovi, timesheetovi, zahtjevi za nadoknadu (ZNS).
3. Web sučelje za projekte (prijenos prototipa u React) – nakon WP1.7, da prvi pilot može raditi bez API klijenta.
4. WP1.2b – OIDC/MFA kad krene prvi pilot.

## Otvorena pitanja za Ivana
- Globalni paketi HE i NPOO su `draft` jer pravila nisu provjerena prema službenim dokumentima, pa se HE projekti zasad ne mogu aktivirati. Da ih provjerim prema važećem HE Model Grant Agreementu i objavim (1–2 dohvaćanja dokumenata)?
- Prototip: isprobaj tok u `verzija.cmd` → verzija ≥ v0.4.0 → poveznica „Prototip”. Što nedostaje da ga pokažeš sugovorniku?
- Pošalji Upute za prijavitelje jednog PKK ili NPOO poziva (PDF/poveznica): mehanizam „paket po pozivu” (`extends`) je gotov, treba prvi stvarni sadržaj.
- Identitet za pilote: koriste li ciljne institucije AAI@EduHr (sveučilišta) ili Microsoft 365? To određuje redoslijed u WP1.2b.
- Potrošnja: Claude ne može očitati tvoj brojač; ako želiš nadzor, povremeno upiši postotak iz Settings → Usage u `docs/POTROSNJA.md` ili ga javi u poruci.
- Konačan naziv proizvoda (radni: „ArQus Projekti”).
- Tko provodi intervjue (Ivan osobno ili netko iz Arqus Solutions)?
- Znaš li za HR institucije koje koriste EMDESK ili Kronis (Sploro)? To bi bili dobri sugovornici za WP0.2.
- NPOO paket je ilustrativan (stope ovise o pozivu). Imaš li Upute za prijavitelje nekog konkretnog NPOO poziva koje bi poslužile kao prvi „paket po pozivu”?

## Blokade
- Nema.
