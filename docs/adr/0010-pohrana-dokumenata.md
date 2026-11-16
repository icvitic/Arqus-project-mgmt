# ADR-0010: Pohrana dokumenata – sučelje pohrane, lokalni volumen za pilot, nepromjenjive verzije

- **Status:** prihvaćeno · **Datum:** 2026-11-16 · dopunjuje ADR-0003 i ADR-0009

## Kontekst
M9 traži dokaze uz troškove, isporuke, ugovore i prijave. Revizija financijera traži da dokaz priložen uz prijavljeni trošak ostane nepromijenjen i da se vidi tko ga je i kada učitao. EU pružatelj (i njegova S3 pohrana) još nije odabran.

## Odluka
- Sadržaj datoteka je izvan baze, iza sučelja `DocumentStorage` (`put`, `get`, `discard`). Za pilot: lokalni direktorij (`DOCUMENTS_DIR`, u produkciji Docker volumen `documents`). S3-kompatibilna izvedba (EU, šifriranje na strani poslužitelja) dodaje se kad se odabere pružatelj, bez promjene sheme.
- Ključ pohrane generira poslužitelj (`<tenantId>/<uuid>`), nikad iz naziva datoteke.
- Metapodaci u bazi pod RLS-om: `documents` (veza na projekt/trošak/isporuku/ZNS/prijavu, vrsta, povjerljivost, oznaka AI sadržaja) i `document_versions` (naziv, MIME, veličina, SHA-256, tko i kada). Aplikacijska uloga nad verzijama ima samo `SELECT, INSERT`; dokumenti se brišu logički.
- Dokazi troška zamrzavaju se kad trošak uđe u ZNS (nema nove verzije ni brisanja); dokumenti zatvorenog projekta i zaključene prijave također.
- Prijenos: najviše 25 MB, popis dopuštenih vrsta s provjerom potpisa sadržaja (HTML, SVG i izvršne datoteke odbijene). Preuzimanje uvijek kao privitak, `nosniff`, CSP `sandbox`, provjera SHA-256 pri svakom preuzimanju; preuzimanje se bilježi u reviziju.

## Posljedice
- Sigurnosna kopija mora obuhvatiti i volumen `documents` (servis `backup` radi dnevnu arhivu); kopija baze i dokumenata nisu atomične – u najgorem slučaju verzija u bazi bez datoteke iz zadnjeg dana (otkriva je provjera hasha).
- Datoteka se zapisuje prije transakcije; neuspjela transakcija je briše. Pad procesa između može ostaviti datoteku bez zapisa (bezopasno; čišćenje siročadi kasnije).
- Oznaka povjerljivosti zasad je samo oznaka; ograničenje pristupa po oznaci dolazi s ulogama na razini projekta.
