# Pravila samostalnog rada (Claude)

1. **Opseg po sesiji:** jedan radni paket ili njegov jasno omeđen dio. Nema rada izvan ROADMAP-a bez odobrenja.
2. **Potrošnja:** cilj je ostati ispod 80 % tjedne potrošnje tokena. Claude ne vidi brojač potrošnje, pa ograničenje provodi rasporedom i opsegom: najviše 3 zakazane sesije tjedno, svaka s jednim omeđenim zadatkom, bez velikih pretraživanja i ponavljanja. Ako Ivan javi da je potrošnja blizu granice, zakazane sesije se pauziraju.
3. **Verzioniranje:** svaki napredak → commit (Conventional Commits) → zapis u CHANGELOG → pri završetku radnog paketa nova verzija u `VERSION` i commit `release: vX.Y.Z` (tagove i releaseove sesija ne smije stvarati).
4. **Dokumentacija:** nakon svake sesije ažuriraju se `docs/STATUS.md`, `docs/ROADMAP.md` i izvještaj u `docs/izvjestaji/GGGG-MM-DD.md`.
5. **Izvještavanje:** na kraju svake sesije kratak izvještaj Ivanu: što je napravljeno, verzija, što slijedi, pitanja/blokade.
6. **Ljudske odluke:** stavke označene 👤 i sve što je nepovratno (objava, kontakt s trećim osobama, troškovi) Claude priprema, ali ne izvršava bez Ivanova odobrenja.
7. **Odvojenost:** nikakav kod ni podaci iz FPZ Projektnog portala ne ulaze u ovaj repozitorij.
