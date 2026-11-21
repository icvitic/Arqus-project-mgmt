# Dizajn sustava sučelja (WP1.25, v0.35.0)

Pravila izgleda ArQus Projekata. Izvor istine su varijable na vrhu `apps/web/src/styles.css`; ovaj dokument objašnjava čemu služe i kako se koriste. Tko dodaje zaslon, slaže ga od postojećih dijelova i ne uvodi nove boje ni veličine.

## 1. Za koga i čemu
Korisnici su ured za projekte, voditelji projekata, financije i uprava javnih ustanova. Sučelje je radni alat s puno tablica i obrazaca, pa su mjerila: čitljivost brojeva, jasan rok i stanje, mirna površina.

Izgled slijedi **vizualni identitet ArQus Solutionsa** s javne stranice https://arqus-solutions.eu (preuzeto 2026-11-21): logotip, pisma i paleta. Stranica tvrtke je cijela tamna; sučelje je radni alat pa je radna površina svijetla (uz tamnu temu po postavci sustava), a identitet nosi **bočna traka u opsidijanskoj boji s logotipom** i ljubičasta kao boja radnje.

## 2. Logotip
- Datoteka: `apps/web/src/brand/arqus-wordmark-dark.svg` – logotip tvrtke, nepromijenjen (napomena o izvoru u `apps/web/src/brand/README.md`).
- Gdje: vrh bočne trake, zaglavlje na uskim zaslonima i ploča na stranici prijave. Uz njega stoji naziv proizvoda „Projekti”.
- Logotip ima ugrađenu opsidijansku podlogu i **ne stavlja se na svijetlu podlogu**; svijetla inačica ne postoji. Ne mijenja mu se boja ni omjer.
- Ikona kartice preglednika je prsten slova Q, ista kao na stranici tvrtke.

## 3. Boje
Svaka boja ima svijetlu i tamnu vrijednost (tema slijedi postavku sustava; `data-theme` je može zadati). Boje identiteta: opsidijan `#0D0A1C`, indigo `#171336`, kvantna ljubičasta `#8F6CFF`, iris `#B9A6FF`, ultra `#5B3DF5`, čelična `#C2BDDB`, zelena `#4ADE80`, jantarna `#FFC857`.

| Varijabla | Svijetlo | Tamno | Uloga |
| --- | --- | --- | --- |
| `--ink` | `#0D0A1C` (opsidijan) | isto | bočna traka, zaglavlje na uskim zaslonima, ploča na prijavi |
| `--ink-hover` / `--ink-active` | `#171336` (indigo) / `#241F4D` | isto | stavka izbornika pod pokazivačem / trenutna |
| `--mark` | `#8F6CFF` (kvantna ljubičasta) | isto | oznaka trenutne stranice i fokus na tinti |
| `--bg` | `#F4F3F9` | `#0D0A1C` | pozadina stranice |
| `--card` | `#FFFFFF` | `#171336` | kartica, dijalog |
| `--fg` / `--muted` | `#15122A` / `#5D5878` | `#F4F2FC` / `#B0AACD` | tekst / sporedni tekst |
| `--accent` | `#5B3DF5` (ultra) | `#B9A6FF` (iris) | poveznice, glavna radnja, aktivna kartica |
| `--ok` / `--warn` / `--bad` | `#146C3F` / `#8A4F00` / `#B3261E` | `#4ADE80` / `#FFC857` / `#FF8A80` | u redu / uskoro, upozorenje / kasni, greška |
| `--ok-bg` / `--warn-bg` / `--bad-bg` | `#E2F3E9` / `#FBEED6` / `#FDE7E4` | `#143524` / `#3A2E14` / `#3D1C24` | podloga oznake istog značenja |
| `--line` / `--field` | `#DCD9E8` / `#7D77A0` | `#2C2756` / `#8A84AD` | razdjelnik / obrub polja i gumba |

Odstupanja od stranice tvrtke, zbog čitljivosti (WCAG 2.1 AA):
- Na svijetloj podlozi boja radnje je **ultra `#5B3DF5`** (6,1 : 1 na bijelom); kvantna ljubičasta `#8F6CFF` na bijelom nema dovoljan kontrast za tekst, pa ostaje za tintu.
- Sporedni tekst identiteta `#7D77A0` ne koristi se za tekst (premali kontrast na obje podloge) nego za obrube; sporedni tekst je `#5D5878` odnosno `#B0AACD`.
- Zelena i jantarna identiteta koriste se u tamnoj temi; u svijetloj su njihove tamnije inačice.

Pravila:
- Boja nikad nije jedini nosilac značenja: uz crveno uvijek stoji tekst („kasni 12 d”).
- Zelena, žuta i crvena znače samo stanje. Ne koriste se za ukras.
- Tekst na tinti je `--ink-fg` ili `--ink-strong`; `--muted` na tinti nije dovoljno kontrastan.

## 3a. Pismo
Kao na stranici tvrtke: **Geist** za naslove (`--font-display`; 500 i 600) i **IBM Plex Sans** za tekst (`--font`; 400, 500, 600). Oba su poslužena s vlastitog poslužitelja kroz pakete `@fontsource/geist` i `@fontsource/ibm-plex-sans` (licenca SIL OFL 1.1) – stranica tvrtke ih dohvaća s Google Fontsa, a aplikacija ne dohvaća ništa s tuđih poslužitelja (CSP `font-src 'self'`). Učitavaju se latinični i prošireni latinični skup (č, ć, đ, š, ž). IBM Plex Mono sa stranice tvrtke u aplikaciji se ne koristi.

| Uloga | Pismo, veličina / debljina |
| --- | --- |
| Naslov stranice (`h1`) | Geist 27 px / 600, zbijeno |
| Naslov kartice (`h2`) | Geist 17,5 px / 600 |
| Podnaslov (`h3`) | Geist 15 px / 600 |
| Tekst | IBM Plex Sans 15 px / 400, prored 1,5 |
| Tablica, polje, gumb | IBM Plex Sans 14 px |
| Zaglavlje tablice, oznaka polja | 12,5–13 px / 600 odnosno 500 |
| Pomoćni tekst, oznaka stanja | 12 px |

Brojevi u tablicama su tablični (`font-variant-numeric: tabular-nums`, klasa `num`) i poravnati desno. Zaglavlja tablica i oznake pišu se rečenično; velika slova s razmakom (kao na gumbima stranice tvrtke) u radnom sučelju se ne koriste jer otežavaju čitanje dugih oznaka.

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

## 7. Otvoreno
Naziv proizvoda „ArQus Projekti” je i dalje radni. Ako tvrtka izradi svijetlu inačicu logotipa ili zaseban znak proizvoda, zamjenjuje se datoteka u `apps/web/src/brand/`.
