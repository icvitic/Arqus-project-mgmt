# Pravila samostalnog rada (Claude)

1. **Opseg po sesiji:** jedan radni paket ili njegov jasno omeđen dio. Nema rada izvan ROADMAP-a bez odobrenja.
2. **Potrošnja:** cilj je ostati ispod 80 % tjedne potrošnje tokena. Claude ne vidi brojač potrošnje, pa ograničenje provodi rasporedom i opsegom: najviše jedna zakazana sesija dnevno (kontinuirani razvoj u Claude Code u oblaku), svaka s jednim omeđenim zadatkom, bez velikih pretraživanja i ponavljanja. Ako Ivan javi da je potrošnja blizu granice, zakazane sesije se pauziraju. Opseg svake sesije upisuje se u `docs/POTROSNJA.md`; pragovi pauziranja definirani su ondje.
3. **Verzioniranje:** svaki napredak → commit (Conventional Commits) → zapis u CHANGELOG → pri završetku radnog paketa nova verzija u `VERSION` i commit `release: vX.Y.Z` (tagove i releaseove sesija ne smije stvarati).
4. **Dokumentacija:** nakon svake sesije ažuriraju se `docs/STATUS.md`, `docs/ROADMAP.md`, `docs/POTROSNJA.md` i izvještaj u `docs/izvjestaji/GGGG-MM-DD.md`.
5. **Izvještavanje:** na kraju svake sesije kratak izvještaj Ivanu: što je napravljeno, verzija, što slijedi, pitanja/blokade.
6. **Ljudske odluke:** stavke označene 👤 i sve što je nepovratno (objava, kontakt s trećim osobama, troškovi) Claude priprema, ali ne izvršava bez Ivanova odobrenja.
7. **Pull requestovi (odluka Ivana, 2026-11-09):** Claude otvara PR za svaki završeni radni paket, prati ga i **spaja u `main` čim CI prođe**, bez posebne potvrde. Ako CI padne, Claude ga popravlja; spajanje s crvenim CI-jem nije dopušteno. Nakon spajanja kratko javlja Ivanu.
8. **Odvojenost:** nikakav kod ni podaci iz FPZ Projektnog portala ne ulaze u ovaj repozitorij.
