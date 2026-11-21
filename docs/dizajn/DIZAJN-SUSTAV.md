# Dizajn sustava sučelja (WP1.25, v0.35.0)

Pravila izgleda ArQus Projekata. Izvor istine su varijable na vrhu `apps/web/src/styles.css`; ovaj dokument objašnjava čemu služe i kako se koriste. Tko dodaje zaslon, slaže ga od postojećih dijelova i ne uvodi nove boje ni veličine.

## 1. Za koga i čemu
Korisnici su ured za projekte, voditelji projekata, financije i uprava javnih ustanova. Sučelje je radni alat s puno tablica i obrazaca, pa su mjerila: čitljivost brojeva, jasan rok i stanje, mirna površina. Jedini izražajni element je **bočna traka u boji tinte** sa zlatnom oznakom trenutne stranice; sve ostalo je neutralno.

## 2. Boje
Svaka boja ima svijetlu i tamnu vrijednost (tema slijedi postavku sustava; `data-theme` je može zadati).

| Varijabla | Svijetlo | Tamno | Uloga |
| --- | --- | --- | --- |
| `--ink` | `#14254a` | `#0a0f17` | tinta: bočna traka, zaglavlje na uskim zaslonima, ploča na prijavi |
| `--mark` | `#f2b544` | `#f2b544` | oznaka trenutne stranice i fokus na tinti – nigdje drugdje |
| `--bg` | `#f2f4f7` | `#0f141a` | papir: pozadina stranice |
| `--card` | `#ffffff` | `#161d26` | kartica, dijalog, polje |
| `--fg` / `--muted` | `#18212f` / `#566174` | `#e6ebf1` / `#93a0ae` | tekst / sporedni tekst |
| `--accent` | `#1b4fb5` | `#6ea8ff` | poveznice, glavna radnja, aktivna kartica |
| `--ok` / `--warn` / `--bad` | `#146c3f` / `#8a4f00` / `#b3261e` | `#4cc38a` / `#f0b35a` / `#ff7b72` | u redu / uskoro, upozorenje / kasni, greška |
| `--ok-bg` / `--warn-bg` / `--bad-bg` | `#e2f3e9` / `#fbeed6` / `#fde7e4` | `#16301f` / `#3a2b12` / `#3a1d1c` | podloga oznake istog značenja |
| `--line` / `--field` | `#d9dee6` / `#7d8896` | `#2a343f` / `#76838f` | razdjelnik / obrub polja i gumba |

Pravila:
- Boja nikad nije jedini nosilac značenja: uz crveno uvijek stoji tekst („kasni 12 d”).
- Zelena, žuta i crvena znače samo stanje. Ne koriste se za ukras.
- Tekst na tinti je `--ink-fg` ili `--ink-strong`; `--muted` na tinti nije dovoljno kontrastan.

## 3. Pismo
**IBM Plex Sans** (400, 500, 600), poslužen s vlastitog poslužitelja kroz paket `@fontsource/ibm-plex-sans` (licenca SIL OFL 1.1) – bez dohvata s tuđih poslužitelja, u skladu s CSP-om `font-src 'self'`. Učitavaju se samo latinični i prošireni latinični skup.

| Uloga | Veličina / debljina |
| --- | --- |
| Naslov stranice (`h1`) | 26 px / 600 |
| Naslov kartice (`h2`) | 17 px / 600 |
| Podnaslov (`h3`) | 15 px / 600 |
| Tekst | 15 px / 400, prored 1,5 |
| Tablica, polje, gumb | 14 px |
| Zaglavlje tablice, oznaka polja | 12,5–13 px / 600 odnosno 500 |
| Pomoćni tekst, oznaka stanja | 12 px |

Brojevi u tablicama su tablični (`font-variant-numeric: tabular-nums`, klasa `num`) i poravnati desno. Zaglavlja tablica i oznake pišu se rečenično, ne velikim slovima.

## 4. Raspored
- **Od 1024 px:** bočna traka široka 232 px (`--rail`), stalno vidljiva. Gore naziv proizvoda i ustanove, zatim izbornik po skupinama, na dnu korisnik, obavijesti i odjava. Sadržaj je poravnat lijevo, najviše 1400 px.
- **Ispod 1024 px:** traka postaje zaglavlje u boji tinte; izbornik se prelama u retke.
- Redoslijed u dokumentu je isti u oba rasporeda, pa redoslijed tipke Tab i čitača zaslona ne ovisi o širini.

Skupine izbornika (naziv skupine se prikazuje samo ako korisnik vidi barem jednu njezinu stavku):

| Skupina | Stavke |
| --- | --- |
| – | Moj rad, Portfelj |
| Prijave na pozive | Radar poziva, Prijave |
| Provedba | Projekti, Organizacije, Paketi programa |
| Uprava | Korisnici, Revizija, Osobni podaci |

## 5. Dijelovi
- **Kartica** (`.card`): bijela podloga, obrub `--line`, polumjer 8 px, bez sjene. Jedna kartica = jedna cjelina; naslov kartice je `h2`.
- **Gumb:** glavna radnja zaslona je `button.primary` (najviše jedna po kartici); ostale su obrubljene; nepovratne su `button.danger`. Tekst gumba kaže što će se dogoditi („Zatvori zahtjev”), a potvrda koristi isti izraz.
- **Polje** (`Field`): oznaka iznad polja, pomoćni tekst ispod. Polja u obrascu poravnata su po gornjem rubu, pa pomoćni tekst jednog polja ne pomiče susjedno.
- **Oznaka stanja** (`Chip`): kratak tekst; `tone="ok" | "warn" | "bad"` samo kad nosi to značenje.
- **Tablica:** uvijek u `.scroll` s nazivom (`caption`), da se na uskom zaslonu pomiče tablica, a ne stranica.
- **Kartice unutar stranice** (`TabList`): za dijelove iste cjeline (projekt, osobni podaci); svaka ima vlastitu adresu.
- **Dijalog** (`Dialog`): za jednu radnju koja traži potvrdu ili nekoliko polja; „Odustani” je uvijek dostupan.
- **Upozorenje** (`.warnbox`) i **greška** (`.alert`): kažu što je pošlo po zlu i što učiniti.

## 6. Pristupačnost
Dizajn je provjeren istim provjerama kao i prije (`docs/PRISTUPACNOST.md`): axe-core na 59 stanja zaslona u obje teme i dvije širine bez nalaza, vidljiv fokus na svakom zaustavljanju tipke Tab (na tinti u boji `--mark`), bez vodoravnog pomicanja na 320 px. Nova boja ili veličina ulazi tek kad te provjere prođu.

## 7. Što ovaj dokument nije
Nije vizualni identitet tvrtke (logotip, tiskani materijali) ni konačan naziv proizvoda – oboje je otvoreno. Kad naziv i logotip budu određeni, mijenjaju se naziv u traci i na prijavi te po potrebi `--ink` i `--mark`.
