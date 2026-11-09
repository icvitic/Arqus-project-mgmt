# Stanje projekta

**Zadnje ažuriranje:** 2026-11-09 · **Verzija:** v0.3.0 · **Faza:** 0 – provjera tržišta

## Gotovo
- Strategija i plan razvoja (Claude Docs, poveznica u `docs/strategija.md`).
- Odluka: proizvod razvija Arqus Solutions kao zaseban produkt (ADR-0005).
- Repozitorij, pravila verzioniranja i dokumentacije, ADR-0001 – ADR-0005.
- WP0.1: vodič za intervju, okvir popisa sugovornika, predložak bilješke s intervjua, početna analiza konkurencije.
- WP0.3 (v0.2.0): analiza konkurencije – 20 alata, karta tržišta, zaključci i pitanja za intervjue (`docs/faza-0/analiza-konkurencije.md`).
- WP0.4 (v0.3.0): domenski model v1 – moduli, entiteti, životni ciklusi, invarijante (`docs/domena/domenski-model-v1.md`); JSON shema paketa programa + primjeri HE i NPOO (`docs/domena/paketi/`); ADR-0006.

## U tijeku
- Ništa – WP0.4 završen.

## Sljedeće
1. WP0.5 – klikabilni prototip toka „radar poziva → prijava → projekt” (HTML, bez backenda), na temelju domenskog modela v1.
2. WP0.2 – prijedlog konkretnih sugovornika (traži Ivanovo odobrenje).
3. WP0.6 – priprema sinteze intervjua (čeka provedbu intervjua).

## Otvorena pitanja za Ivana
- Konačan naziv proizvoda (radni: „ArQus Projekti”).
- Tko provodi intervjue (Ivan osobno ili netko iz Arqus Solutions)?
- Znaš li za HR institucije koje koriste EMDESK ili Kronis (Sploro)? To bi bili dobri sugovornici za WP0.2.
- Domenski model: slažeš li se s ADR-0006 (prijava i projekt odvojeni, ugovaranje kopira proračun)? Ako ne, javi prije WP0.5 jer prototip slijedi model.
- NPOO paket je ilustrativan (stope ovise o pozivu). Imaš li Upute za prijavitelje nekog konkretnog NPOO poziva koje bi poslužile kao prvi „paket po pozivu”?

## Blokade
- Nema.
