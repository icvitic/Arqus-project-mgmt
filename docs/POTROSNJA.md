# Dnevnik potrošnje tokena

**Pravilo:** ne prelaziti 80 % tjedne potrošnje (AUTONOMNI-RAD, t. 2).
**Ograničenje:** Claude u sesiji **ne vidi** brojač potrošnje računa; nijedan alat u Claude Code u oblaku ga ne izlaže. Zato se vodi ovaj dnevnik:
- Claude nakon svake sesije upisuje **opseg** (vrsta zadatka, broj web pretraživanja/dohvaćanja, podagenti, veličina izlaza) i procjenu težine (L/M/H).
- Ivan po potrebi upisuje **očitanje** postotka s claude.ai → Settings → Usage (tjedni limit) u stupac „Očitanje”.
- Ako je očitanje ≥ 70 %, zakazane sesije se pauziraju do resetiranja tjednog limita; pri ≥ 60 % Claude radi samo zadatke težine L.

Težina: **L** = samo pisanje/uređivanje dokumenata iz postojećeg znanja; **M** = uz ≤ 6 pretraživanja ili pregled repozitorija; **H** = više pretraživanja, podagenti, generiranje koda i testiranje u pregledniku.

| Datum | Sesija | Zadatak | Pretraživanja / dohvaćanja | Podagenti | Težina | Očitanje (Ivan) |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-08 | 1 (ručno) | WP0.0, WP0.1, ADR-ovi, strategija | ~5 / ~5 | 0 | M | |
| 2026-11-09 | 1 (zakazana) | WP0.3 dio 1 | 6 / 6 | 0 | M | |
| 2026-11-09 | 2 (ručno) | WP0.3 dio 2, v0.2.0 | 4 / 6 | 0 | M | |
| 2026-11-09 | 3 (ručno) | WP0.4 domenski model, v0.3.0 | 0 / 0 | 0 | L | |
| 2026-11-09 | 3 (nastavak) | skripta verzija + preglednik, test u pregledniku, v0.3.1 | 0 / 0 | 0 | M | |

Tjedni zbroj (tjedan od 2026-11-08): 5 sesija, od toga 4 u jednom danu. Preporuka: do kraja tjedna samo zakazane sesije (jedna dnevno).
