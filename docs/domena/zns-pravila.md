# Pravila zahtjeva za nadoknadu sredstava (ZNS)

**Od verzije:** v0.23.0 (WP1.16a), dopuna v0.24.0 (WP1.16b: paket za predaju, troškovi iz ranijih razdoblja, mjerenje pripreme). **Kod:** `packages/domain/src/claims.ts` (čiste funkcije), `apps/api/src/finance/claims.service.ts`, okidač `expenses_immutable_trg` (migracija 0021).

ZNS se vodi po izvještajnom razdoblju i partneru (vlastita organizacija). Iznosi su u centima; izračun uvijek ide istim pravilima kao proračun: izravni troškovi → neizravni po pravilu paketa → stopa financiranja.

## Životni ciklus

| Status | Kako nastaje | Što je zaključano |
| --- | --- | --- |
| nacrt | otvaranje (bilo kad, i prije kraja razdoblja); povrat na dopunu | ništa – troškovi razdoblja ulaze dinamički; troškovi iz ranijih razdoblja samo izričitim odabirom |
| predan | predaja nakon popisa za provjeru | troškovi (`u zahtjevu`), timesheetovi (`zaključan`), dokazi |
| odobren / djelomično odobren / odbijen | odluka po trošku | priznati iznosi (nepromjenjivi u bazi) |
| (isplaćen) | isplata uz odobren ili djelomično odobren | – ispravak odluke više nije moguć |

**Povrat na dopunu** (iz predanog): obavezan razlog; troškovi se vraćaju u `evidentiran`, timesheetovi u `odobren`, dokazi se mogu dopuniti; snimka predaje (razlog rane predaje, potvrde, upozorenja) briše se iz zahtjeva (ostaje u reviziji). Ponovna predaja ponovno prolazi cijeli popis za provjeru.

## Predaja i popis za provjeru

Predaja je moguća tek kad je **datum kraja razdoblja prošao** (na sam zadnji dan razdoblja predaja je rana). Ranija predaja traži upisan **razlog** (najmanje 5 znakova); razlog se sprema uz zahtjev, prikazuje na njemu i bilježi u reviziji (`submit.early`).

| Stavka | Vrsta | Rješenje |
| --- | --- | --- |
| Razdoblje je završilo | blokira | ili razlog rane predaje (tada upozorenje) |
| Zahtjev ima troškove | blokira | – |
| Svi timesheetovi članova tima partnera za mjesece razdoblja su odobreni (nacrt ili predan sa satima = trošak osoblja nedostaje; prazan nacrt se ne broji) | blokira | odobriti ili vratiti u prazan nacrt |
| Svaki ručno uneseni trošak ima dokaz (trošak osoblja dokazuje se timesheetom) | blokira | priložiti dokaz ili izričito potvrditi navedene troškove (tada upozorenje; potvrda u reviziji) |
| Svi troškovi su unutar razdoblja (osim izričito odabranih troškova iz ranijih razdoblja) | blokira | – |
| Troškovi iz ranijih razdoblja: koliko je uključeno, koliko nepredanih nije | upozorenje | odabrati ih u nacrtu ili svjesno ostaviti |
| Kumulativno po kategoriji (ranije zatraženo/priznato + ovaj zahtjev) unutar ugovorenog proračuna | upozorenje | – |

Upozorenja, potvrđeni troškovi bez dokaza, uključeni troškovi iz ranijih razdoblja i cijeli popis stavki (od v0.24.0) spremaju se uz predaju (`submission`) – to je kontrolna lista u paketu za predaju.

## Odluka

Odluka se upisuje **po trošku**: priznati iznos (zadano cijeli) i razlog, obavezan kad je priznato manje od traženog. Trošak je **prihvaćen** (priznato = traženo), **djelomično priznat** (0 < priznato < traženo) ili **odbijen** (0). Datum odluke ne smije biti u budućnosti ni prije predaje.

Priznati ukupni iznos računa se iz priznatih iznosa istim izračunom kao zahtjev. Iznos iz odluke financijera može se upisati; ako se razlikuje od izračunatog, razlika se prikazuje i traži se napomena. Odobreno = iznos financijera, inače izračunati.

Ishod: **odbijen** ako je odobreno 0; **odobren** ako su svi troškovi prihvaćeni u cijelosti i odobreno nije manje od traženog; inače **djelomično odobren**.

**Ispravak odluke** (npr. nakon prigovora): samo za odlučen, neisplaćen zahtjev, uz obavezan razlog (`POST …/decision/correction`). Baza dopušta promjenu priznatog iznosa, razloga i statusa odlučenog troška samo u transakciji koja najavi taj zahtjev (`app.claim_correction`) i za svaki promijenjeni trošak sama upisuje revizijski zapis (`recognition.correct`). Svaka druga izmjena ili brisanje odlučenog troška odbija se u bazi.

## Isplata

Datum isplate ne prije datuma odluke i ne u budućnosti; isplaćeni iznos uspoređuje se s odobrenim – razlika traži napomenu. Isplata se bilježi jednom.

## Definicije

- **Traženo** – izračun iz traženih iznosa troškova (snimka pri predaji).
- **Priznato** – izračun iz priznatih iznosa nakon odluke.
- **Nepriznato** – traženo − priznato (izravno, neizravno, ukupno, doprinos).
- **Ostvareno** (pregled financija, portfelj, zahtjev) – trošak bez odluke s traženim iznosom, nakon odluke s priznatim; odbijen = 0. Nepriznato se prikazuje zasebno.

## Prikaz

Odobrenje timesheeta stvara jedan trošak osoblja po radnom paketu (pohranjena razina detalja ostaje). U zahtjevu, odluci i popisu troškova troškovi osoblja grupiraju se po osobi i mjesecu (klik otvara retke po radnom paketu); ručni troškovi su pojedinačni. Novi zahtjev zadano nudi najranije završeno razdoblje bez zahtjeva.

## Troškovi iz ranijih razdoblja (WP1.16b)

Nacrt automatski uzima samo evidentirane troškove partnera **datirane u svom razdoblju** koji nisu u drugom zahtjevu. Trošak evidentiran kasnije s datumom u razdoblju čiji je ZNS već predan zato ne bi ušao ni u jedan zahtjev. Pravilo:

- **Nepredan trošak iz ranijeg razdoblja** = evidentiran, nije u zahtjevu, datiran u razdoblju za koje je ZNS istog partnera već predan (nije nacrt). Ako je ZNS njegova razdoblja nacrt (ili ga još nema), trošak pripada tom zahtjevu, ne kasnijem.
- Nacrt kasnijeg razdoblja istog partnera nudi ih kao **„troškovi iz ranijih razdoblja”**; ulaze u zahtjev **samo izričitim odabirom** priprematelja (`PUT …/claims/:cid/earlier-expenses`, u reviziji `earlier.select`). Odabir se pamti na nacrtu (i nakon povrata na dopunu); jedan trošak može biti odabran u samo jednom nacrtu.
- Odabrani trošak ulazi u iznose, provjeru dokaza i proračun; provjera „unutar razdoblja” vrijedi za ostale troškove. Popis za provjeru navodi uključene i neuključene (upozorenje, ne blokira).
- U zahtjevu, radnoj knjizi i kontrolnoj listi označen je kao „ranije razdoblje”.
- Signal „nepredani troškovi iz ranijih razdoblja” (kartica Ugovoreno / ostvareno, portfelj → Traži pažnju) broji takve troškove koji nisu odabrani ni u jednom nacrtu.

## Troškovi potraživani izvan sustava (WP1.17)

Projekt koji se uvozi iz Excela (`docs/UVOZ-PROJEKTA.md`) ima razdoblja čiji su ZNS-ovi predani prije ArQusa. Njihovi troškovi uvoze se sa statusom **`historic`** („potraživan izvan sustava”), uz neobaveznu oznaku zahtjeva (`external_claim`), priznati iznos (`recognised_cents`, prazno = priznat kako je zatražen) i razlog umanjenja (obavezan kad je priznato manje od traženog).

- **Ostvareno** = priznati iznos, inače traženi (ista funkcija `effectiveAmount` kao za odlučene troškove); razlika je **nepriznato** – pregled financija i portfelj ih uključuju bez posebnog koda.
- **Nisu ni u jednom zahtjevu sustava** (`claim_id` prazan): nacrt uzima samo status `recorded`, pa ih ne uzima; nisu „nepredani troškovi iz ranijih razdoblja” (pravilo traži `recorded`); ne broje se kao trošak bez dokaza.
- **Kumulativ prema proračunu** u popisu za provjeru (stavka *budget*) uključuje ih uz ranije zahtjeve istog partnera.
- **Razdoblje** vlastite organizacije s barem jednim takvim troškom portfelj smatra predanim (nije „razdoblje bez ZNS-a”).
- **Paket za predaju**: list *Sažetak* navodi broj i zbroj troškova partnera potraživanih izvan sustava („nisu dio ovog zahtjeva”); bez `personnel:read` zbroj je bez troškova osoblja.
- **Nepromjenjivi**: ruta troška ih ne mijenja ni ne briše (409), a okidač `expenses_immutable_trg` (migracija 0025) odbija svaku izmjenu i brisanje osim brisanja pri poništavanju uvoza koji ih je stvorio (transakcija najavljuje `app.import_undo`).
- **Trošak osoblja iz ranijeg razdoblja** (`source = historic_personnel`): iznos po osobi (`team_member_id`) i mjesecu, uvoz samo uz `personnel:read`; iznos skriven bez `personnel:read` kao trošak iz timesheeta (troškovi, revizija, paket). Za mjesec s takvim troškom timesheet osobe se ne odobrava (409), a za mjesec s predanim ili odobrenim timesheetom uvoz se odbija – trošak ne nastaje dvaput. Trošak osoblja koji nije potraživan i dalje nastaje samo iz timesheeta.
- Ograničenja u bazi: `historic` bez `claim_id`; `historic_personnel` samo kao `historic` i uz osobu; oznaka zahtjeva samo uz `historic`; priznati iznos između 0 i traženog.

## Paket za predaju (WP1.16b)

`GET /api/projects/:id/claims/:cid/export` (`finance:read` na projektu, svaki status) vraća jedan ZIP `ZNS_<AKRONIM>_RP<n>[_NACRT]_<datum>.zip`:

| Datoteka | Sadržaj |
| --- | --- |
| `sadrzaj.csv` | manifest (UTF-8, `;`): zahtjev, projekt, razdoblje, status, vrijeme izvoza, izvoznik, verzija aplikacije; svaka datoteka s veličinom i SHA-256; izostavljeni povjerljivi dokazi bez naziva. Ne sadrži vlastiti zbroj. |
| `troskovi.xlsx` | list **Sažetak** (zaglavlje zahtjeva; po kategorijama paketa traženo / priznato / nepriznato, neizravni, stopa financiranja, traženo / odobreno / isplaćeno), **Troškovi** (svaki trošak: datum, kategorija, radni paket, opis, dobavljač, traženo, priznato, status, razlog odluke, razdoblje, nazivi dokaza, mapa u paketu; automatski filtar), **Troškovi osoblja** (osoba i mjesec: sati, jedinica i količina prema pravilu paketa, osnova, stopa – samo uz `personnel:read`, iznos, priznato, sati i iznos po radnom paketu). Brojevi kao brojevi, datumi kao datumi, novac s dvije decimale, zamrznuti redci zaglavlja. |
| `evidencije-rada/<Osoba>_<GGGG-MM>.html` | mjesečna evidencija za potpis po osobi i mjesecu (članovi tima partnera sa satima u mjesecima razdoblja i timesheetovi troškova osoblja u zahtjevu): sati po danu i radnom paketu, zbrojevi, status, odobrio/la i datum, crte za potpis zaposlenika i nadređenog; jedna stranica A4. Isti dokument daje ispis timesheeta na kartici „Tim i timesheetovi” (`GET …/team/:mid/timesheets/:month/record`). |
| `dokazi/<rb>_<datum>_<opis>/` | trenutna verzija dokaza uz troškove (rb = redni broj troška u zahtjevu); SHA-256 svake datoteke provjerava se pri izvozu – neslaganje ili nedostajuća datoteka prekida izvoz (409, revizija `export.failed`). Povjerljivi dokazi samo uz `documents:confidential`, inače u manifestu kao izostavljeni (bez naziva). |
| `kontrolna-lista.html` | popis za provjeru kakav je bio pri predaji (za nacrt trenutni), razlog rane predaje, potvrđeni troškovi bez dokaza, uključeni troškovi iz ranijih razdoblja, upozorenja. |

- Nacrt je u svakoj generiranoj datoteci označen kao **NACRT**.
- Nazivi su sigurni (bez putanja iz korisničkog unosa), jedinstveni i stabilnog redoslijeda; generirane datoteke ne sadrže vrijeme izvoza, pa dva izvoza istih podataka imaju iste zbrojeve (razlikuje se samo manifest).
- Granica: dokazi zajedno najviše 500 MiB (`CLAIM_EXPORT_MAX_BYTES`), inače 409 s porukom. Podaci se čitaju u jednoj transakciji, dokazi se provjeravaju prije prvog poslanog bajta, ZIP se struji bez otvorene transakcije (u memoriji je jedna datoteka).
- Svaki izvoz upisuje se u reviziju (`export`, uz broj datoteka, dokaza, izostavljenih i SHA-256 manifesta).
- **Poznato ograničenje:** format je generički (kategorije paketa). Obrasci financijera (tablice eFondova, financijski izvještaj Horizon Europe) nisu uključeni – odredit će ih pilot-institucije.

## Mjerenje pripreme (WP1.16b)

Sustav mjeri proteklo vrijeme i aktivnost, ne sate rada. **Automatski** (prikaz na zahtjevu nakon predaje, bez unosa):

| Mjera | Definicija |
| --- | --- |
| dani od kraja razdoblja do predaje | kalendarski dani od zadnjeg dana razdoblja do (zadnje) predaje; negativno = rana predaja |
| dani u pripremi | od otvaranja nacrta (stvaranje zahtjeva) do (zadnje) predaje; isti dan = 0 |
| povrati na dopunu | broj zapisa `decision.returned` u reviziji |
| troškovi, dokazi, timesheetovi, troškovi iz ranijih razdoblja | broj troškova u zahtjevu, aktivnih dokaza uz njih (svi, i povjerljivi – samo zbroj), različitih timesheetova troškova osoblja |

**Prijavljeno:** pri predaji neobavezno „sati utrošeni na pripremu” (naknadno ili ispravak: `PUT …/claims/:cid/preparation-hours`, samo predan/odlučen zahtjev). **Polazna mjera institucije:** „sati po ZNS-u prije ArQusa” (`tenants.settings.claimBaselineHours`, `PUT /api/portfolio/claim-savings/baseline`, dozvola `tenant:write` – administrator i ured za projekte).

**Ušteda na ZNS-u** (`GET /api/portfolio/claim-savings`, `portfolio:read` institucije; portfelj): za predane zahtjeve s upisanim satima prosjek sati prema polaznoj mjeri, ušteda = (polazna − prosjek) / polazna (jedna decimala; negativno = dulje nego prije), broj zahtjeva u izračunu, cilj ≥ 30 %, automatske mjere kao popratne brojke. Bez polazne mjere ili bez prijavljenih sati izvještaj kaže što treba upisati. Izračun: `packages/domain/src/claim-savings.ts`.
