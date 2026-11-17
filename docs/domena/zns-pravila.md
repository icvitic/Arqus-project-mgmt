# Pravila zahtjeva za nadoknadu sredstava (ZNS)

**Od verzije:** v0.23.0 (WP1.16a). **Kod:** `packages/domain/src/claims.ts` (čiste funkcije), `apps/api/src/finance/claims.service.ts`, okidač `expenses_immutable_trg` (migracija 0021).

ZNS se vodi po izvještajnom razdoblju i partneru (vlastita organizacija). Iznosi su u centima; izračun uvijek ide istim pravilima kao proračun: izravni troškovi → neizravni po pravilu paketa → stopa financiranja.

## Životni ciklus

| Status | Kako nastaje | Što je zaključano |
| --- | --- | --- |
| nacrt | otvaranje (bilo kad, i prije kraja razdoblja); povrat na dopunu | ništa – troškovi razdoblja ulaze dinamički |
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
| Svi troškovi su unutar razdoblja | blokira | – |
| Kumulativno po kategoriji (ranije zatraženo/priznato + ovaj zahtjev) unutar ugovorenog proračuna | upozorenje | – |

Upozorenja i potvrđeni troškovi bez dokaza spremaju se uz predaju (`submission`).

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
