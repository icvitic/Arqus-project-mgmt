# Evidencija obrade osobnih podataka u proizvodu ArQus Projekti (WP1.23, v0.33.0; dopuna WP1.24, v0.34.0)

> **Napomena.** Ovo je radni predložak koji je pripremio razvojni tim bez pravnog pregleda. Prije upotrebe ga mora provjeriti službenik za zaštitu podataka institucije ili pravnik. Dokument opisuje što proizvod tehnički radi; ne tvrdi da je proizvod ili njegova upotreba „usklađena s GDPR-om” i nije pravni savjet. Evidenciju aktivnosti obrade (čl. 30 GDPR-a) vodi institucija kao voditelj obrade – ovaj dokument joj služi kao podloga za dio koji se odnosi na ArQus Projekte.

## 1. Uloge
- **Voditelj obrade:** institucija (stanar) – određuje svrhu, korisnike i rokove. U proizvodu: „institucija”.
- **Izvršitelj obrade:** isporučitelj proizvoda (ArQus) i, kad bude odabran, pružatelj smještaja u EU (ADR-0003, ADR-0009). Ugovor: [`UGOVOR-O-OBRADI-predlozak.md`](UGOVOR-O-OBRADI-predlozak.md).
- **Ispitanici:** zaposlenici i suradnici institucije s korisničkim računom (`korisnik`), osobe koje rade na projektima s računom ili bez njega (`clan_tima`), voditelji prijava (`podnositelj_prijave`), osobe koje pokušavaju prijavu (`posjetitelj` – samo IP adresa u zapisu neuspjele prijave).

## 2. Gdje su osobni podaci (po tablici)

Strojno čitljiv dio ove tablice je [`evidencija-obrade.json`](evidencija-obrade.json) – po stupcu. Test `apps/api/test/privacy-inventory.test.ts` pada ako se u shemu doda tablica bez zapisa ili stupac koji po nazivu izgleda osobno (ime, e-adresa, veza na korisnika ili člana tima, IP, preglednik, vjerodajnice, plaća, slobodni tekst, JSON) a nije naveden. Kategorija izvoza je naziv lista/ključa u izvozu podataka osobe (odj. 5).

| Tablica | Ispitanici | Podaci | Svrha | Tko vidi | Rok čuvanja (od v0.33.0) | Izvoz |
| --- | --- | --- | --- | --- | --- | --- |
| `users` | korisnik | ime, e-adresa, hash lozinke (scrypt), šifrirana MFA tajna, zadnja prijava | prijava, autorizacija, pošta, odgovornost | administrator (bez vjerodajnica) | dok je račun otvoren; **zatvaranjem računa** vjerodajnice, MFA i e-adresa odmah nestaju, ostaju id i ime | `account` |
| `sessions` | korisnik | IP adresa, preglednik, vrijeme | valjanost i opoziv prijave | nitko u sučelju | `sessions`: 30 dana nakon isteka/odjave (najmanje 7); zatvaranjem odmah | `sessions` |
| `role_assignments` | korisnik | uloge, projekti | autorizacija | administrator, voditelj projekta | dok vrijede; zatvaranjem odmah | `roles` |
| `audit_entries` | korisnik, član tima, posjetitelj | tko, što, kada, IP, promjene prije/poslije (imena, e-adrese, iznosi plaća) | dokaz i odgovornost, sigurnost | `audit:read`; plaće samo uz `personnel:read` | `audit`: 3650 dana (najmanje 1825) i ne prije isteka roka čuvanja projekta koji je tada postojao; `loginFailures`: 365 dana (najmanje 90). Samo dodavanje (odj. 6) | `audit` |
| `team_members` | član tima | ime, uloga u timu, **godišnji trošak (plaća)**, veza na račun | evidencija rada, trošak osoblja | tko vidi projekt; plaća uz `personnel:read` | rok čuvanja projekta (odj. 4), zatim **anonimizacija** | `teamMemberships` |
| `timesheets`, `timesheet_entries` | član tima, korisnik | sati po danu i radnom paketu, tko je predao i odobrio | dokaz rada za trošak osoblja | član (vlastite), voditelj, financije | rok čuvanja projekta; posao čuvanja ih nikad ne briše | `timesheets` |
| `expenses` | član tima | trošak osoblja po osobi i mjesecu (iz plaće), opis s imenom | zahtjev za nadoknadu | `finance:read`; iznos osoblja uz `personnel:read` | rok čuvanja projekta; odlučeni nepromjenjivi; anonimizacijom ime u opisu → pseudonim | `personnelCosts` |
| `reimbursement_claims` | – (zahtjev partnera) | snimke predaje/odluke i bilješke mogu spomenuti osobu | zahtjev za nadoknadu | `finance:read` | rok čuvanja projekta; nepromjenjiv nakon predaje – anonimizacija ga samo navodi | – |
| `tasks`, `deliverables`, `milestones` | član tima | odgovorna osoba (veza na člana tima) | provedba | tko vidi projekt | rok čuvanja projekta (nakon anonimizacije člana prikazuje se pseudonim) | `responsibilities` |
| `risks` | korisnik | vlasnik rizika, slobodni tekst | upravljanje rizicima | tko vidi projekt | rok čuvanja projekta | `risks` |
| `projects` | korisnik | voditelj projekta | upravljanje projektom | tko vidi projekt | rok čuvanja projekta | `projectsManaged` |
| `proposals` | voditelj prijave | voditelj prijave | priprema prijave | `proposals:read`, voditelj | bez automatskog roka (odj. 4) | `proposalsLed` |
| `call_tracking` | korisnik | tko je ocijenio, odlučio, odgovoran; obrazloženje | odluka o prijavi | `calls:read` | bez automatskog roka | `callTracking` |
| `documents`, `document_versions` | korisnik, član tima | tko je prenio, naziv datoteke; **sadržaj datoteke sustav ne vidi** | dokazi, isporuke | `documents:read` (+ `documents:confidential`) | rok čuvanja projekta; logički obrisani `deletedDocuments`: 180 dana (najmanje 30), dokaz u zahtjevu tek nakon roka projekta | `documents` (popis) |
| `notifications` | korisnik | događaji za korisnika, bez iznosa | obavještavanje | samo primatelj (RLS) | `notificationsRead` 90 dana, `notificationsUnread` 365 dana; zatvaranjem odmah | `notifications` |
| `calendar_tokens` | korisnik | SHA-256 tokena kalendara, zadnja upotreba | osobni kalendar | nitko (hash) | do opoziva ili zatvaranja | `calendar` |
| `account_tokens` | korisnik | SHA-256 pozivnice / nove lozinke | postavljanje lozinke | administrator vidi da postoji | `accountTokens`: 7 dana nakon isteka; zatvaranjem odmah | `accountTokens` |
| `mail_deliveries` | korisnik | kome i kada je poslana poruka, ishod (bez sadržaja) | dijagnostika pošte | administrator | `mailDeliveries`: 180 dana (najmanje 30); zatvaranjem odmah | `mailDeliveries` |
| `digest_runs` | korisnik | dan i ishod sažetka | jedan sažetak dnevno | nitko | `digestRuns`: 90 dana; zatvaranjem odmah | `digestRuns` |
| `subject_requests` | podnositelj zahtjeva (i bez računa), korisnik | ime i kontakt podnositelja, vrsta prava, sažetak zahtjeva, dani zaprimanja, utvrđivanja identiteta, produljenja i odgovora, ishod s obrazloženjem | odgovor u zakonskom roku i dokaz postupanja (čl. 12(3), 5(2)) | administrator (`privacy:manage`) | `subjectRequests`: zatvoren zahtjev 1825 dana nakon zatvaranja (najmanje 365); otvoren se ne briše; zatvaranje računa ga **ne** briše | `subjectRequests` (samo zahtjevi povezani s računom osobe) |
| `work_packages`, `budget_lines` | – | slobodni tekst (ciljevi, opis) može spomenuti osobu | struktura i proračun | tko vidi projekt | rok čuvanja projekta; anonimizacija navodi pojavu imena | – |
| `tenants` | – | postavke institucije (id administratora koji je potvrdio rokove) | postavke | administrator | dok postoji institucija | – |
| `organisations`, `project_partners`, `proposal_members`, `proposal_work_packages`, `proposal_budget_lines` | – | pravne osobe; aplikacija **ne vodi kontakt-osobe** organizacija | partneri | tko vidi | – | – |
| `project_imports` | – | naziv i SHA-256 učitane datoteke, tko je uvezao; **datoteka se ne sprema** | poništavanje uvoza | voditelj projekta | dok postoji projekt | – |
| `programme_packages`, `calls`, `roles`, `reporting_periods`, `project_budgets`, `retention_runs` | – | bez osobnih podataka (osim `created_by`/`updated_by`) | – | – | – | – |

**Stupci `created_by` / `updated_by`** u gotovo svim tablicama sadrže id korisnika (pseudonimna veza na račun). Ne izvoze se pojedinačno – radnje osobe su u izvozu kroz revizijski zapis (`audit`).

**Čega u proizvodu nema:** zapisa neuspjelih prijava izvan revizijskog zapisa (ograničenje prijava drži samo SHA-256 ključ u memoriji procesa), spremljenih datoteka uvoza iz Excela (samo naziv i SHA-256), sadržaja poslane e-pošte, kontakt-osoba organizacija, posebnih kategorija podataka (čl. 9) u strukturiranim poljima. Sadržaj prenesenih dokumenata može sadržavati bilo što – sustav ga ne čita.

## 3. Rokovi čuvanja i posao koji ih provodi
Svakog dana (od 2:00 u zoni institucije, `RETENTION_HOUR`) posao čuvanja (`apps/api/src/privacy/retention.service.ts`) briše ono čemu je istekao rok; probno izvođenje samo broji. Zaslon **Osobni podaci → Rokovi čuvanja** pokazuje svaku kategoriju, rok, koliko se drži, što je zadnje izvođenje uklonilo i što se zadržava preko roka jer o tome nešto ovisi. **Zadani rokovi su prijedlog razvojnog tima, ne pravni savjet – institucija ih mora potvrditi** (gumb „Potvrđujem rokove” bilježi tko i kada).

| Ključ | Što | Zadano | Donja granica | Mijenja institucija | Gdje se provodi granica |
| --- | --- | --- | --- | --- | --- |
| `sessions` | sesije nakon isteka ili odjave | 30 dana | 7 | da | aplikacija |
| `accountTokens` | istekle pozivnice i poveznice | 7 dana | 1 | ne | aplikacija |
| `mailDeliveries` | zapis isporuke pošte | 180 dana | 30 | da | aplikacija |
| `digestRuns` | zapis dnevnog sažetka | 90 dana | 14 | ne | aplikacija |
| `notificationsRead` | pročitane obavijesti | 90 dana | 7 | da | baza (`privacy_notifications_purge`) |
| `notificationsUnread` | nepročitane obavijesti | 365 dana | 90 | da | baza |
| `deletedDocuments` | logički obrisani dokumenti | 180 dana | 30 | da | baza (`privacy_documents_purge`) |
| `loginFailures` | revizijski zapisi neuspjelih prijava | 365 dana | 90 | da | baza (`privacy_audit_purge`) |
| `audit` | ostali revizijski zapisi | 3650 dana | 1825 | da | baza (`privacy_audit_purge`) |
| `subjectRequests` | zatvoreni zahtjevi ispitanika (od dana zatvaranja) | 1825 dana | 365 | da | aplikacija; okidač u bazi odbija brisanje otvorenog zahtjeva |

Posao **nikad ne briše** timesheetove, troškove, zahtjeve, članove tima, proračune ni projekte – nijedna kategorija ih ne dotiče. Serije od 500 redaka (`RETENTION_BATCH`), najviše 40 serija po kategoriji i 10 minuta po izvođenju; zakazano izvođenje umeće redak `retention_runs` (jedinstven po instituciji i danu), pa druga instanca isti dan ne radi ništa. Uključeno u produkciji (`RETENTION_ENABLED=0` isključuje), izvan produkcije samo uz `RETENTION_ENABLED=1`.

## 4. Rok čuvanja projekta (financijski dokazi)
Pravila programa razlikuju se (npr. godine nakon isplate završnog iznosa ili nakon kraja projekta; nacionalna pravila mogu biti dulja). Proizvod **ne pretpostavlja zakonski rok**: institucija ga postavlja po paketu programa, s vlastitim zadanim rokom; bez postavke vrijedi **10 godina (zadano, označeno kao nepotvrđeno)**, a nikad manje od **3 godine** (granica u bazi, `privacy_project_years`).

- **Sat:** rok počinje kad je projekt zatvoren, raskinut ili arhiviran i nema predanog neodlučenog zahtjeva; početak je kasniji od (kraj projekta = početak + trajanje, posljednja isplata, posljednja odluka o zahtjevu). Funkcija u bazi `project_retention_end` – isti izračun za zaslon, anonimizaciju, revizijski zapis i dokumente.
- **Prijave koje nisu postale projekt** i **praćenje poziva** nemaju automatski rok (prijava može postati projekt i godinama kasnije); institucija ih briše ručno – poznato ograničenje.

## 5. Prava ispitanika u proizvodu
Postupak po pravu: [`PRAVA-ISPITANIKA.md`](PRAVA-ISPITANIKA.md). Ukratko:
- **Pristup i prenosivost** – izvoz podataka osobe (administrator, dozvola `privacy:manage`) i samoposluga u „Moj račun”. ZIP: `podaci.json`, `podaci.xlsx`, `procitaj-me.html`.
- **Pripisivanje osobi:** korisnički račun i zapisi člana tima povezani s njim (veza u podacima). Zapis člana tima bez računa sustav samo predlaže po imenu; operater ga izričito označava. Zapis povezan s drugim računom ne može se pripisati.
- **Brisanje** – zatvaranje računa odmah, anonimizacija projektnih zapisa nakon roka čuvanja projekta.
- **Evidencija zahtjeva i rok (WP1.24)** – svaki zahtjev se upisuje u **Osobni podaci → Zahtjevi**: rok za odgovor (mjesec dana od zaprimanja, uz produljenje tri) sustav računa sam i pokazuje ga administratoru u „Moj rad”. Revizijski zapis o zahtjevu ne sadrži ime podnositelja ni slobodni tekst (čuva se dulje od evidencije). Zahtjev se u izvoz podataka osobe uključuje samo ako ga je operater povezao s njezinim računom.

## 6. Revizijski zapis
Odluka: **revizijski zapis se ne redigira** (varijanta a). Zapis je dokaz tko je što napravio; izmjena bi ga obezvrijedila. Umjesto toga ima vlastiti rok čuvanja i jedan kontrolirani put brisanja:
- aplikacijska uloga nema `UPDATE`/`DELETE` (migracija 0001), a okidač `audit_entries_guard_trg` (migracija 0032) odbija izmjenu, brisanje i `TRUNCATE` i vlasničkoj ulozi, osim brisanja unutar funkcije `privacy_audit_purge`;
- funkcija briše samo zapise starije od roka (donje granice 1825 / 90 dana su u funkciji, ne u postavci) i samo ako su stariji od nastanka najstarijeg projekta kojemu rok čuvanja još traje; brisanje ostavlja vlastiti zapis `audit.purge`;
- administrator ne može skratiti rok ispod 5 godina, pa ni uništiti trag vlastitih radnji iz tog razdoblja.

## 7. Izmjene ove evidencije
Svaka nova tablica ili stupac s osobnim podacima: zapis u `evidencija-obrade.json` i red u odj. 2 (test ih traži), po potrebi kategorija izvoza u `apps/api/src/privacy/subject-data.ts` i rok u `apps/api/src/privacy/retention-policy.ts`.
