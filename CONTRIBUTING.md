# Pravila rada u repozitoriju

## Verzioniranje
- [SemVer](https://semver.org/lang/hr/): `MAJOR.MINOR.PATCH`. Do komercijalnog izdanja `0.x`.
  - `MINOR` – završen radni paket (npr. WP0.2) ili nova funkcionalnost.
  - `PATCH` – ispravci i dopune dokumentacije.
- Svaka verzija = nova vrijednost u datoteci `VERSION` + zapis u `CHANGELOG.md` + commit s porukom `release: vX.Y.Z`.
- Git tagove i GitHub Release izrađuje Ivan ručno ako ih želi (Claudeove sesije ne smiju stvarati tagove ni releaseove); povijest verzija uvijek je vidljiva u `CHANGELOG.md` i `git log --grep release:`.
- Lokalni pregled bilo koje verzije: `scripts/verzija.sh` (vidi `docs/LOKALNO-TESTIRANJE.md`).

## Grane
- `main` je uvijek ispravna i dokumentirana.
- Rad ide na granama `wp/<oznaka>-<kratki-opis>` (npr. `wp/0.2-intervjui`), spaja se pull requestom.

## Poruke commitova
[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, uz oznaku radnog paketa, npr. `docs(wp0.1): vodič za intervju`.

## Dokumentacija (obavezno uz svaku promjenu)
1. `docs/STATUS.md` – ažurirati stanje.
2. `CHANGELOG.md` – zapis pod `[Unreleased]`, pri izdanju pod novu verziju.
3. `docs/ROADMAP.md` – označiti napredak radnog paketa.
4. Nova arhitekturna odluka → novi ADR u `docs/adr/`.
