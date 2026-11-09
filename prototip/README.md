# Prototip WP0.5 – „radar poziva → prijava → projekt”

Jedna HTML datoteka (`index.html`), bez backenda; stanje se čuva u pregledniku (localStorage), gumb „Resetiraj podatke” vraća demo. Služi za intervjue (WP0.6): pokazati tok i provjeriti domenski model v1 s potencijalnim kupcima.

**Pokretanje:** `verzija.cmd` (Windows) ili `scripts/verzija.sh posluzi`, pa poveznica „Prototip” u ispisu; ili otvoriti `prototip/index.html` izravno u pregledniku.

## Što pokriva
| Korak | Što se može kliknuti | Veza na model v1 |
| --- | --- | --- |
| Radar poziva | popis poziva (HE, NPOO, MSCA), ručni unos, ocjena prikladnosti (4 kriterija), odluka go / pratiti / no-go | M3: Poziv, OcjenaPrikladnosti, OdlukaGoNoGo |
| Prijava | osnovno, konzorcij (iz registra organizacija, potvrde), radni paketi, proračun partner × kategorija iz paketa, zaključavanje/verzije proračuna, provjera spremnosti, interna provjera, predaja, ishod | M4, M5; invarijante 3–5 |
| Ugovaranje | iz financirane prijave stvara projekt kopijom partnera, WP-ova i proračuna v1; prijava postaje arhiv | ADR-0006 |
| Projekt | ugovor i aktivacija (generira izvještajna razdoblja iz paketa), isporuke i prekretnice, troškovi stanara vs. ugovoreno, zahtjevi i izvještaji po razdoblju | M6, M7, M8 |
| Portfelj | lijevak, aktivni projekti, nadolazeći rokovi (pozivi, interni rokovi, izvještaji, isporuke) | M10 |

Pravila paketa (HE: neizravni 25 % na A+C, stope RIA/IA/CSA s 100 % za neprofitne u IA, 18-mjesečna razdoblja; NPOO ilustrativno) ugrađena su kao pojednostavljena kopija `docs/domena/paketi/*.json`.

## Što namjerno nije u prototipu
Prijava korisnika i uloge, dokumenti, timesheetovi, zahtjev za nadoknadu kao zaseban obrazac, amandmani, više stanara, AI pomoćnik. Dizajn je funkcionalan, ne konačan.

## Testiranje
Tok je provjeren automatski u Chromiumu (Playwright): go → prijava s 4 partnera iz 3 države → proračun 2,1 M € / zatraženo 1,95 M € → upozorenje za podugovaranje > 15 % → zaključavanje → predaja → financirana → ugovaranje → aktivacija (2 razdoblja za 36 mj.) → trošak → isporuka → portfelj; arhivirana prijava nepromjenjiva; stanje preživljava osvježavanje.
