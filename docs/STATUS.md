# Stanje projekta

**Zadnje ažuriranje:** 2026-11-09 · **Verzija:** v0.6.0 · **Faza:** 1 – MVP i pilot

## Gotovo
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
- Ništa – WP1.1 završen.

## Sljedeće
1. WP1.2 – stanari, identitet, uloge, revizijski zapis: odabir ORM-a (Drizzle), migracije, RLS i automatski testovi izolacije stanara, OIDC prijava, ESLint/Prettier.
2. WP1.3 – paketi programa u bazi (globalni + stanarski), verzioniranje, urednik/validator; paket po PKK/NPOO pozivu čim stignu upute.
3. WP1.6–1.7 – projekt i provedba (prije radara i prijave, prema WP0.7).

## Otvorena pitanja za Ivana
- Prototip: isprobaj tok u `verzija.cmd` → verzija ≥ v0.4.0 → poveznica „Prototip”. Što nedostaje da ga pokažeš sugovorniku?
- Pošalji Upute za prijavitelje jednog PKK ili NPOO poziva (PDF/poveznica) za prvi stvarni „paket po pozivu” – prema istraživanju, nacionalni programi su komercijalno važniji od HE.
- Tehnološki okvir odabran (ADR-0008: NestJS, React/Vite, PostgreSQL, Vitest). Prigovor? ORM (Drizzle) potvrđuje se u WP1.2.
- Potrošnja: Claude ne može očitati tvoj brojač; ako želiš nadzor, povremeno upiši postotak iz Settings → Usage u `docs/POTROSNJA.md` ili ga javi u poruci.
- Konačan naziv proizvoda (radni: „ArQus Projekti”).
- Tko provodi intervjue (Ivan osobno ili netko iz Arqus Solutions)?
- Znaš li za HR institucije koje koriste EMDESK ili Kronis (Sploro)? To bi bili dobri sugovornici za WP0.2.
- NPOO paket je ilustrativan (stope ovise o pozivu). Imaš li Upute za prijavitelje nekog konkretnog NPOO poziva koje bi poslužile kao prvi „paket po pozivu”?

## Blokade
- Nema.
