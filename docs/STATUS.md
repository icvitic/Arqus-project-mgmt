# Stanje projekta

**Zadnje ažuriranje:** 2026-11-09 · **Verzija:** v0.4.1 · **Faza:** 0 – provjera tržišta

## Gotovo
- Strategija i plan razvoja (Claude Docs, poveznica u `docs/strategija.md`).
- Odluka: proizvod razvija Arqus Solutions kao zaseban produkt (ADR-0005).
- Repozitorij, pravila verzioniranja i dokumentacije, ADR-0001 – ADR-0005.
- WP0.1: vodič za intervju, okvir popisa sugovornika, predložak bilješke s intervjua, početna analiza konkurencije.
- WP0.3 (v0.2.0): analiza konkurencije – 20 alata, karta tržišta, zaključci i pitanja za intervjue (`docs/faza-0/analiza-konkurencije.md`).
- Priprema WP0.2 i WP0.6 (v0.4.1): prijedlog 20 sugovornika, pozivna poruka, scenarij demonstracije, predložak sinteze s hipotezama, dopuna vodiča.
- WP0.5 (v0.4.0): klikabilni prototip (`prototip/index.html`) s automatskim testom toka; Windows pokretač `verzija.cmd`.
- Alati (v0.3.1): `scripts/verzija.sh` + lokalni preglednik verzija (`site/`), upute `docs/LOKALNO-TESTIRANJE.md`, dnevnik potrošnje `docs/POTROSNJA.md`.
- WP0.4 (v0.3.0): domenski model v1 – moduli, entiteti, životni ciklusi, invarijante (`docs/domena/domenski-model-v1.md`); JSON shema paketa programa + primjeri HE i NPOO (`docs/domena/paketi/`); ADR-0006.

## U tijeku
- WP0.2 – čeka Ivanovo odobrenje prijedloga sugovornika (👤).
- WP0.6 – čeka provedbu intervjua (👤); Claude radi sintezu iz bilježaka.

## Sljedeće
1. 👤 Ivan: odobriti/izmijeniti `prijedlog-sugovornika.md`, upisati kontakte izvan gita, početi s pozivima (A-prioriteti, skupine 1 i 3).
2. Claude (sljedeće sesije, dok traju intervjui): „paket po pozivu” za jedan stvarni NPOO poziv čim Ivan pošalje Upute za prijavitelje; dorade prototipa prema prvim reakcijama; međusinteza nakon ≥ 8 intervjua.
3. WP0.7 – cjenovna hipoteza v2 i go/no-go nakon ≥ 15 intervjua.
Napomena: svi pripremni paketi faze 0 koje Claude može sam napraviti su gotovi. Daljnji napredak faze 0 ovisi o intervjuima (ljudski rad). Zakazane sesije bez novog ulaza (bilješke, upute poziva, povratne informacije) trebale bi biti kratke ili preskočene radi potrošnje.

## Otvorena pitanja za Ivana
- Prototip: isprobaj tok u `verzija.cmd` → verzija ≥ v0.4.0 → poveznica „Prototip”. Što nedostaje da ga pokažeš sugovorniku?
- WP0.2: odobravaš li prijedlog sugovornika (institucije/uloge)? Koga zamijeniti? Tko kontaktira?
- Pošalji Upute za prijavitelje jednog NPOO poziva (PDF/poveznica) za prvi stvarni „paket po pozivu”.
- Potrošnja: Claude ne može očitati tvoj brojač; ako želiš nadzor, povremeno upiši postotak iz Settings → Usage u `docs/POTROSNJA.md` ili ga javi u poruci.
- Konačan naziv proizvoda (radni: „ArQus Projekti”).
- Tko provodi intervjue (Ivan osobno ili netko iz Arqus Solutions)?
- Znaš li za HR institucije koje koriste EMDESK ili Kronis (Sploro)? To bi bili dobri sugovornici za WP0.2.
- NPOO paket je ilustrativan (stope ovise o pozivu). Imaš li Upute za prijavitelje nekog konkretnog NPOO poziva koje bi poslužile kao prvi „paket po pozivu”?

## Blokade
- Nema.
