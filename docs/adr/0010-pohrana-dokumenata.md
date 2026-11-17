# ADR-0010: Pohrana dokumenata – sučelje pohrane, lokalni volumen za pilot, nepromjenjive verzije

- **Status:** prihvaćeno · **Datum:** 2026-11-16 · dopunjuje ADR-0003 i ADR-0009 · **Dopuna 2026-11-17 (v0.28.0, WP1.20):** S3 izvedba napravljena (vidi dolje)

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

## Dopuna (2026-11-17, v0.28.0, WP1.20): S3 izvedba
- **Napravljeno, bez promjene sheme:** druga izvedba iza istog ugovora (`apps/api/src/documents/storage-backends.ts`), odabir `DOCUMENTS_STORAGE=local|s3` (zadano `local` – demo, NAS i testovi ne mijenjaju ništa). Varijable `DOCUMENTS_S3_*`: adresa, regija, bucket, ključ, tajna, adresni stil (path/virtual-hosted), neobavezni prefiks ključeva i zaglavlje šifriranja na strani poslužitelja (`x-amz-server-side-encryption`).
- **Bez novih ovisnosti:** vlastiti S3 klijent (`apps/api/src/storage/`) – AWS Signature V4 nad Node `crypto` i `fetch`; put, get kao tok, head, delete, popis s nastavkom. Provjeren objavljenim primjerima AWS-a i stvarnim S3-kompatibilnim poslužiteljem (MinIO); stvarni AWS i usluga budućeg pružatelja nisu isprobani.
- **Ista jamstva:** ključ `<tenantId>/<uuid>` (u S3 pod prefiksom); objekt vidljiv tek cijeli (PUT je atomičan, tijelo potpisano SHA-256 pa pružatelj odbija oštećen prijenos); preuzimanje provjerava veličinu i SHA-256 prije prvog poslanog bajta (najviše jedna datoteka od ≤ 25 MB u memoriji, kao i prije); paket ZNS-a provjerava sve dokaze strujanjem prije slanja i svaki ponovno pri slanju. Nedostupna pohrana: vremensko ograničenje (zadano 15 s do odgovora i 15 s stanke u prijenosu), najviše 2 ponavljanja samo za idempotentne operacije, zatim 503 s kratkom porukom (bez konfiguracije); pojedinosti samo u zapisu poslužitelja. `/api/health/ready` javlja dostupnost pohrane (rezultat se pamti 10 s, da javna ruta ne izaziva zahtjeve prema pružatelju).
- **Operativne naredbe** (`cli.js`): `documents verify [--quick]` – svaka verzija iz baze postoji s ispravnom veličinom i SHA-256, popis nedostajućih, oštećenih i siročadi (siročad mlađa od 1 h su vjerojatno prijenos u tijeku i nisu problem), izlazni kod 1 kod problema; `documents migrate --to s3|local|mirror` – kopija svih verzija u drugu pohranu s provjerom hasha na izvoru i odredištu, idempotentno i nastavljivo, izvor se nikad ne briše, drugačiji sadržaj u odredištu se ne prepisuje; `mirror` je drugi bucket (`DOCUMENTS_MIRROR_S3_*`). Obje su sigurne na živom sustavu.
- **Kopije:** uz `DOCUMENTS_STORAGE=s3` dnevna arhiva volumena se ne radi; dokumente štite verzioniranje (i po mogućnosti zaključavanje objekata ili replikacija u drugu zonu) bucketa kod pružatelja, redovni `documents verify` i po želji `documents migrate --to mirror` u drugi bucket. Kopije baze idu izvan poslužitelja prema ADR-0012.
- **Ograničenja:** jedan PUT do 5 GB (dokument je ≤ 25 MB; višedijelni prijenos nije napravljen); nema privremenih poveznica (sav promet ide kroz API zbog autorizacije i revizije); klijent ne čita vjerodajnice iz metapodataka oblaka ni privremene tokene (samo ključ i tajna).
