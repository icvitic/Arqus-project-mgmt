# ADR-0006: Prijava i projekt su odvojeni agregati; ugovaranje kopira, ne referencira

- **Status:** prihvaćeno · **Datum:** 2026-11-09

## Kontekst
Prijava (proposal) i ugovoreni projekt dijele strukturu (partneri, radni paketi, proračun), pa je privlačno modelirati ih kao jedan entitet s više statusa. No prijava je povijesni dokument koji nakon predaje ne smije mijenjati sadržaj, dok se projekt godinama mijenja (amandmani, prenamjene proračuna, promjene partnera). Jedna prijava može i ne rezultirati projektom, a projekt može nastati bez prijave u sustavu (migracija postojećih projekata).

## Odluka
- `Prijava` (modul M5) i `Projekt` (modul M6) zasebni su agregati s vlastitim životnim ciklusima.
- **Ugovaranje** je domenska radnja koja iz prijave u statusu `financirana` stvara projekt: kopira partnere, strukturu rada i zaključani proračun u proračun projekta v1. Projekt čuva referencu `source_proposal_id`; prijava postaje nepromjenjiva.
- Projekt može nastati i izravno (bez prijave), uz obvezan odabir paketa programa.
- Proračun je zasebno verzioniran entitet u oba konteksta (`ProposalBudget`, `ProjectBudget`) s istom strukturom stavki, da bi se ista pravila paketa mogla primijeniti i uspoređivati planirano/ugovoreno/ostvareno.

## Posljedice
- Nešto dupliciranja strukture (WP-ovi, proračun) između modula; zauzvrat jednostavni statusi i jasna odgovornost.
- Potreban je uvoz postojećih projekata (bez prijave) za pilote.
- Usporedba „što smo prijavili vs. što smo ugovorili” moguća je bez posebnog arhiviranja.
