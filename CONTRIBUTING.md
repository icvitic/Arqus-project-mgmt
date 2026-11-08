# Pravila rada u repozitoriju

## Verzioniranje
- [SemVer](https://semver.org/lang/hr/): `MAJOR.MINOR.PATCH`. Do komercijalnog izdanja `0.x`.
  - `MINOR` – završen radni paket (npr. WP0.2) ili nova funkcionalnost.
  - `PATCH` – ispravci i dopune dokumentacije.
- Svaka verzija = git tag `vX.Y.Z` + GitHub Release + zapis u `CHANGELOG.md`.

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
