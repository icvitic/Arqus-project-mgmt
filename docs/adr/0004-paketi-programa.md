# ADR-0004: Pravila programa kao konfiguracija („paketi programa”)

- **Status:** prihvaćeno · **Datum:** 2026-11-08

## Kontekst
Svaki program (Horizon Europe, Interreg, NPOO, ESIF, HRZZ…) ima vlastite kategorije troškova, stope, predloške prijave i rokove izvještavanja. Od 2028. mijenjaju se svi EU programi.

## Odluka
Pravila programa opisuju se verzioniranim konfiguracijskim paketima (shema + validacija), a ne kodom. Paket sadrži: kategorije troškova i pravila prihvatljivosti, stope (npr. indirektni troškovi), strukturu prijave, predloške izvještaja, rokove. Projekt je vezan uz točnu verziju paketa.

## Posljedice
Novi program ili novo razdoblje dodaje se konfiguracijom; potreban je urednik i validator paketa.
