# Stanje projekta

**Zadnje ažuriranje:** 2026-11-09 · **Verzija:** v0.4.0 · **Faza:** 0 – provjera tržišta

## Gotovo
- Strategija i plan razvoja (Claude Docs, poveznica u `docs/strategija.md`).
- Odluka: proizvod razvija Arqus Solutions kao zaseban produkt (ADR-0005).
- Repozitorij, pravila verzioniranja i dokumentacije, ADR-0001 – ADR-0005.
- WP0.1: vodič za intervju, okvir popisa sugovornika, predložak bilješke s intervjua, početna analiza konkurencije.
- WP0.3 (v0.2.0): analiza konkurencije – 20 alata, karta tržišta, zaključci i pitanja za intervjue (`docs/faza-0/analiza-konkurencije.md`).
- WP0.5 (v0.4.0): klikabilni prototip (`prototip/index.html`) s automatskim testom toka; Windows pokretač `verzija.cmd`.
- Alati (v0.3.1): `scripts/verzija.sh` + lokalni preglednik verzija (`site/`), upute `docs/LOKALNO-TESTIRANJE.md`, dnevnik potrošnje `docs/POTROSNJA.md`.
- WP0.4 (v0.3.0): domenski model v1 – moduli, entiteti, životni ciklusi, invarijante (`docs/domena/domenski-model-v1.md`); JSON shema paketa programa + primjeri HE i NPOO (`docs/domena/paketi/`); ADR-0006.

## U tijeku
- Ništa – WP0.5 završen.

## Sljedeće
1. WP0.2 – prijedlog konkretnih sugovornika (traži Ivanovo odobrenje) – jedini preostali pripremni paket prije intervjua.
2. WP0.6 – scenarij demonstracije prototipa za intervju (10 min) i predložak sinteze; sama provedba intervjua je 👤.
3. WP0.7 – cjenovna hipoteza v2 (nakon prvih intervjua).

## Otvorena pitanja za Ivana
- Prototip: isprobaj tok u `verzija.cmd` → verzija v0.4.0 → poveznica „Prototip”. Što nedostaje da ga pokažeš sugovorniku?
- Smijem li pripremiti WP0.2 (popis 20 sugovornika s javno dostupnim kontaktima) u sljedećoj sesiji?
- Potrošnja: Claude ne može očitati tvoj brojač; ako želiš nadzor, povremeno upiši postotak iz Settings → Usage u `docs/POTROSNJA.md` ili ga javi u poruci.
- Konačan naziv proizvoda (radni: „ArQus Projekti”).
- Tko provodi intervjue (Ivan osobno ili netko iz Arqus Solutions)?
- Znaš li za HR institucije koje koriste EMDESK ili Kronis (Sploro)? To bi bili dobri sugovornici za WP0.2.
- NPOO paket je ilustrativan (stope ovise o pozivu). Imaš li Upute za prijavitelje nekog konkretnog NPOO poziva koje bi poslužile kao prvi „paket po pozivu”?

## Blokade
- Nema.
