# Lokalni pregled i testiranje verzija

Verzije se ne označavaju git tagovima (CONTRIBUTING), nego commitovima `release: vX.Y.Z`. Skripta `scripts/verzija.sh` iz njih izvodi popis verzija i svaku izdvaja u zasebnu mapu (`git worktree`) pod `.verzije/`, pa se više verzija može gledati istodobno bez mijenjanja radne kopije. Ako Ivan ručno doda tag `vX.Y.Z`, skripta ga koristi prvog.

## Preduvjeti
- git, bash, python3 (bez dodatnih paketa). Na Windowsu: Git Bash ili WSL.
- Prvi put: `git clone https://github.com/icvitic/arqus-project-mgmt && cd arqus-project-mgmt && git fetch --all`

## Naredbe
```bash
scripts/verzija.sh popis                    # sve verzije, najnovija prva
```
```bash
scripts/verzija.sh otvori v0.2.0            # izdvoji jednu verziju u .verzije/v0.2.0
```
```bash
scripts/verzija.sh otvori sve               # izdvoji sve verzije
```
```bash
scripts/verzija.sh posluzi                  # lokalni poslužitelj + preglednik na http://localhost:8765/site/
```
```bash
scripts/verzija.sh usporedi v0.2.0 v0.3.0   # koje su se datoteke promijenile između verzija
```
```bash
scripts/verzija.sh ukloni v0.2.0            # ukloni izdvojenu verziju
```

## Preglednik (`site/index.html`)
- Padajući izbornik: radna kopija (trenutna grana) i sve izdvojene verzije.
- Renderira Markdown (tablice, Mermaid dijagrami), JSON (paketi programa) i HTML (prototip iz WP0.5 otvara se u okviru ili novoj kartici).
- Poveznice među dokumentima rade unutar odabrane verzije. URL čuva verziju i datoteku (`?v=v0.3.0&f=docs/STATUS.md`), pa se može podijeliti.
- Knjižnice (marked, mermaid) učitavaju se s cdnjs-a; za potpuno izvanmrežni rad spremiti ih lokalno u `site/lib/` (nije napravljeno).

## Napomene
- `.verzije/` i `site/docs.json` su u `.gitignore` i ne ulaze u repozitorij.
- Nakon `git pull` novu verziju treba ponovno izdvojiti (`otvori`), a `posluzi` sam osvježava indeks.
- Ako port 8765 nije slobodan: `scripts/verzija.sh posluzi 8800`.
