# „Moj rad”, obavijesti, osobni kalendar rokova i dnevni sažetak (WP1.18, v0.30.0; sažetak WP1.21, v0.31.0)

Cilj: **član tima nakon prijave vidi što danas treba napraviti** – bez traženja po projektima. Tri dijela:

| Dio | Što je | Gdje |
| --- | --- | --- |
| **Moj rad** | trenutno stanje: što čeka korisnika (izvodi se iz podataka pri svakom učitavanju, ništa se ne sprema) | `GET /api/me/work`, stranica **Moj rad** (početna za sve osim uprave i ureda), značka u izborniku |
| **Obavijesti** | događaji koji su se korisniku dogodili (odobren timesheet, vraćen ZNS…) – spremaju se | `GET /api/me/notifications`, zvonce u zaglavlju |
| **Kalendar** | rokovi koje korisnik vidi, u Outlooku / Google Kalendaru, preko tajne poveznice | `GET /api/calendar/<token>.ics`, **Moj račun → Rokovi u mom kalendaru** |
| **Dnevni sažetak** (v0.31.0) | jedna e-poruka radnim danom ujutro kad nešto kasni, dospijeva ili ima novih obavijesti (odj. 4) | `GET\|PUT /api/me/digest`, **Moj račun → Dnevni sažetak e-poštom** |

Nigdje se ne prikazuje iznos; ništa ne otkriva projekt ili prijavu koju korisnik ne bi vidio otvaranjem sam (pristup po projektu, `docs/sigurnost/AUTORIZACIJA.md`).

## 1. Moj rad

Izvođenje je čista funkcija `deriveWorkItems` (`packages/domain/src/my-work.ts`); činjenice skuplja `MyWorkService` (`apps/api/src/me/my-work.service.ts`). Stavka ima vrstu, projekt (ili prijavu / poziv), rok gdje postoji, hitnost i poveznicu na zaslon na kojem se rješava.

**Hitnost:** *kasni* (rok je prošao) · *uskoro* (rok za najviše 30 dana; timesheet tekućeg mjeseca: zadnjih 5 dana mjeseca) · *čeka* (treba radnja, nema bliskog roka – ili čeka nekoga drugog) · *za informaciju*. „Danas” je kalendarski dan u zoni institucije. Značka u izborniku = kasni + uskoro.

### U kojoj je ulozi korisnik na projektu

Osoba može biti član tima na jednom projektu, a voditelj na drugom – uloga se određuje **po projektu**:

| Uloga | Uvjet |
| --- | --- |
| član tima | povezan s aktivnim članom tima (`team_members.user_id`) projekta u provedbi i smije voditi timesheet (`timesheets:write`) |
| odobravatelj / voditelj / financije | dozvola (`timesheets:approve` / `projects:write` / `finance:write`) **dodijeljena na tom projektu** ili je korisnik **imenovani voditelj** projekta (i dozvolu ima) |
| financijski ured | `finance:write` na razini institucije **bez** `projects:write` institucije → stavke financija na svim projektima |
| prijave | voditelj prijave (vlastite) ili izričita `proposals:write` institucije |
| radar | izričita `calls:write` institucije |
| administrator | `users:write` institucije |

**Odluka (provjeriti):** dozvole na razini institucije (administrator `*`, ured za projekte) **ne** pretvaraju svaki projekt institucije u osobnu obvezu – inače bi svaki timesheet na odobrenju i svaki trošak bez dokaza svih projekata bio u njihovom „Moj rad” i popis bi bio beskoristan. Njihov pregled je **Portfelj** (iste brojke). Izuzetak je financijski ured, kojem su svi ZNS-ovi posao. „Izričita” dozvola znači navedena u ulozi, ne kroz `*`: administrator dobiva samo administratorske stavke i ono što je osobno njegovo (npr. prijava kojoj je voditelj).

### Vrste stavki

| Vrsta | Uloga | Pravilo | Hitnost | Vodi na |
| --- | --- | --- | --- | --- |
| `timesheet_current` | član | timesheet tekućeg mjeseca nije predan: „nije započet” / „u tijeku – N h” / „spreman za predaju” (zadnjih 5 dana) | čeka → uskoro | timesheet (član, mjesec) |
| `timesheet_missing` | član | završeni mjesec bez predanog timesheeta, od kasnijeg od početka projekta i ulaska u tim (ulazak = upis člana; raniji ako za raniji mjesec već postoji timesheet), unutar trajanja; mjesec pokriven troškom osoblja potraživanim prije ArQusa se ne traži | kasni | timesheet |
| `timesheet_reopened` | član | timesheet u nacrtu koji je bio vraćen (revizija `reopen`) | čeka / uskoro / kasni po kraju mjeseca | timesheet |
| `timesheet_submitted` | član | vlastiti predan timesheet čeka odobrenje | čeka | timesheet |
| `risk_owned` | nositelj | otvoren ili nastupio rizik kojem je korisnik nositelj (`risks.owner_user_id`) | čeka | struktura |
| `timesheet_to_approve` | odobravatelj | predan timesheet koji korisnik smije odobriti: **nije njegov i nije ga on predao** (četiri oka), predavatelj je poznat | čeka | timesheet |
| `expenses_without_evidence` | financije | broj ručno unesenih troškova bez (vidljivog) dokaza | čeka | troškovi |
| `claim_draft` | financije | nacrt ZNS-a za razdoblje koje je završilo, s brojem otvorenih blokada popisa za provjeru | po roku ZNS-a | ZNS |
| `claim_returned` | financije | ZNS vraćen na dopunu (nacrt s razlogom povrata), s brojem blokada | po roku ZNS-a | ZNS |
| `period_unclaimed` | financije | završeno razdoblje bez predanog ZNS-a i bez nacrta | po roku ZNS-a | ZNS |
| `expenses_stranded` | financije | nepredani troškovi iz ranijih razdoblja | čeka | ZNS |
| `claim_unpaid` | financije | odobren (i djelomično) ZNS bez zabilježene isplate | informacija | ZNS |
| `deliverable_due` | voditelj | otvorena isporuka (planirana, u izradi, odbijena) koja kasni ili dospijeva u 30 dana | kasni / uskoro | struktura |
| `milestone_due` | voditelj | planirana prekretnica koja kasni ili dospijeva u 30 dana | kasni / uskoro | struktura |
| `risks_high` | voditelj | broj visokih otvorenih rizika (vjerojatnost × utjecaj ≥ 6) | čeka | struktura |
| `deviations` | voditelj | broj odstupanja od pravila programa (isti izračun kao na projektu) | čeka | pregled projekta |
| `report_next` | voditelj | sljedeći nepredani rok ZNS-a i izvještaja (samo ako korisnik na projektu nije i u ulozi financija – tada to pokrivaju stavke ZNS-a) | po roku / informacija | ZNS ili pregled |
| `proposal_deadline` | prijave | prijava u pripremi (ideja, priprema, interna provjera) s internim rokom do 30 dana ili prošlim, s brojem neispunjenih stavki spremnosti | kasni / uskoro | prijava |
| `call_decision` | radar | praćeni poziv bez odluke go / no-go (bez odluke ili „pratimo”) čiji je interni rok (i prošao, dok rok predaje traje) ili rok predaje unutar 30 dana | kasni / uskoro | poziv na radaru |
| `mfa_missing` | administrator | broj aktivnih računa kojima je MFA obvezan po postavci institucije, a nemaju ga | čeka | Korisnici |

**Nije napravljeno – nema podatka u modelu:** zadaci, isporuke i prekretnice nemaju odgovornu **osobu** (samo partnera-nositelja, `lead_partner_id`). Jedina osobna odgovornost u strukturi je nositelj rizika – zato `risk_owned`. Dodavanje odgovorne osobe isporuci je mala promjena (stupac, polje u sučelju i uvozu), ali je nismo uveli nagađanjem; ako pilot to traži, stavka „isporuke za koje sam odgovoran” izvodi se istim putem.

### Zajedničke definicije s portfeljem

Ista stvar se na dva zaslona ne broji različito. `apps/api/src/portfolio/facts.ts` drži izraze koje koriste i portfelj i „Moj rad”: visoki rizici, timesheetovi na odobrenju, troškovi bez dokaza (s pravilom povjerljivih dokaza), nepredani troškovi iz ranijih razdoblja, „razdoblje predano” (ZNS vlastite organizacije koji nije nacrt ili trošak potraživan prije ArQusa), statusi otvorenih projekata, isporuka, prekretnica i prijava. Blokade ZNS-a broji ista funkcija kao popis za provjeru na ZNS-u (`claimChecklist`), stavke spremnosti ista kao na prijavi (`proposalReadiness`), odstupanja ista kao na projektu (`packageDeviations`), račune bez MFA isti izračun kao postavka u izborniku Korisnici. Test `apps/api/test/my-work.e2e.test.ts` provjerava da se brojke slažu s portfeljem.

**Broj upita** ne ovisi o broju projekata: svaki upit obuhvaća sve relevantne projekte; uz to po jedan dohvat za svaki različit paket programa (kao portfelj). Izmjereno: 25 SQL naredbi po zahtjevu voditelja i 17 financija, uključujući provjeru sesije i transakciju; isto i s tri projekta više.

## 2. Obavijesti

Upisuje ih servis **u istoj transakciji** kao događaj (`apps/api/src/notifications/notify.ts`): ako se događaj ne spremi, nema ni obavijesti. **Nikad akteru.** Obavijest nastaje samo ako primatelj u tom trenutku smije vidjeti ono o čemu govori (dozvola na projektu – inače ništa).

| Događaj | Primatelj | Uvjet primatelja | Tekst (primjer) |
| --- | --- | --- | --- |
| timesheet odobren | član tima povezan s računom | `timesheets:read` na projektu | „Timesheet za listopad 2026. je odobren (BLUESENSE)” |
| timesheet vraćen u nacrt | isti | isti | „… vraćen je na doradu” – povrat timesheeta u modelu nema razlog |
| ZNS vraćen na dopunu | tko ga je (zadnji put) predao – iz revizije predaje | `finance:read` | uz razlog povrata (vidljiv i na zahtjevu) |
| ZNS odlučen | isti | isti | ishod (odobren / djelomično / odbijen), bez iznosa |
| isplata zabilježena | isti | isti | bez iznosa |
| dodijeljen pristup projektu | korisnik | – | uloga (i dodavanjem u tim s računom, i uvozom) |
| oduzet pristup projektu | korisnik | – | i poništavanjem uvoza koji je dodao člana tima |
| imenovan voditeljem projekta | imenovani | – | stvaranje projekta, ugovaranje prijave, promjena voditelja |
| imenovan voditeljem prijave | imenovani | – | nova prijava, promjena voditelja |
| uvoz iz Excela primijenjen | voditelj projekta | `projects:read` | naziv datoteke |
| uvoz poništen | voditelj projekta i autor uvoza | `projects:read` | naziv datoteke |

**Sadržaj:** vrsta, akter, projekt/prijava i strukturirani podaci (akronim, mjesec, razdoblje, ishod, uloga, naziv datoteke); tekst se slaže pri čitanju (`notificationText` u domeni – isti za sučelje i dnevni sažetak e-poštom). Bez iznosa i bez slobodnog teksta drugih korisnika, osim razloga povrata ZNS-a koji primatelj vidi i na zahtjevu.

**Samo vlastite.** Svaki upit filtrira po korisniku, a baza (RLS, migracija 0027) iste retke otkriva samo kad je u transakciji postavljen `app.user_id` tog korisnika: upit koji bi zaboravio filtar ili se izvršio bez postavke ne vraća ništa. Aplikacija smije mijenjati samo `read_at` (sadržaj je nepromjenjiv). **Zašto zaštita po korisniku i u bazi:** obavijesti su jedina tablica čiji su retci osobni unutar institucije; jedna postavka po čitanju je mala cijena za jamstvo koje ne ovisi o ispravnosti svakog budućeg upita.

**API:** `GET /api/me/notifications?limit=&before=` (najnovije prve, keyset po id-u, `next`, `unread`), `POST /api/me/notifications/:id/read`, `POST /api/me/notifications/read-all`.

**Čuvanje:** pročitane obavijesti starije od **90 dana** (`NOTIFICATION_RETENTION_DAYS`) brišu se pri sljedećem čitanju popisa vlasnika; nepročitane se ne brišu. Brisanje pri čitanju ne treba raspored poslova ni pristup preko granice stanara; obavijesti neaktivnih korisnika ostaju dok se ne prijave (malo podataka, brišu se s korisnikom).

## 3. Osobni kalendar rokova (iCalendar)

Kalendarski klijenti ne šalju zaglavlje Authorization, pa se feed adresira **tajnim tokenom u URL-u**: `https://<instalacija>/api/calendar/<token>.ics`.

**Sadržaj:** isti rokovi koje korisnik vidi na portfelju, istim pravilima pristupa (`PortfolioService.deadlines`): izvještajna razdoblja (kraj i rok ZNS-a), isporuke i prekretnice otvorenih projekata, interni rokovi i rokovi predaje praćenih poziva (uz `calls:read` institucije), interni rokovi prijava (vlastitih ili uz `proposals:read` institucije). Od 180 dana unatrag do 2 godine unaprijed. Cjelodnevni događaji za datume; rok predaje poziva s vremenom kao UTC. Naslov `[AKRONIM] naslov roka`, opis = vrsta roka. Bez iznosa, bez imena osoba.

**Format (RFC 5545):** CRLF, presavijanje na 75 okteta (bez prelamanja UTF-8 znaka), escape `\ ; , \n`, stabilni `UID` (`<vrsta>-<id entiteta>@arqus-projekti` – ažuriranje zamjenjuje događaj), `DTSTAMP`, `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` 4 h, `TRANSP:TRANSPARENT`. Generator `packages/domain/src/ical.ts`.

**Zaštite** (nova neprijavljena površina – `docs/sigurnost/PENTEST-OPSEG.md`): token 32 bajta iz CSPRNG-a (256 bita), u bazi samo SHA-256, prikazan jednom; novi token poništava stari; „Ukloni” ga briše; deaktivacija korisnika ga briše, a feed provjerava i da je korisnik aktivan i nije obrisan; korisnik u ograničenom stanju obveznog MFA ne dobiva feed; isti 404 (status i tijelo) za nepoznat, opozvan i neispravan token, a neispravan prolazi isti put (hash i upit); bez stanara baza otkriva samo redak čiji je hash postavljen u transakciji (RLS – tokeni se ne mogu nabrojati); ograničenje 120 zahtjeva u 10 min po IP adresi (`CALENDAR_RATE_MAX`, `CALENDAR_RATE_WINDOW_MINUTES`); samo čitanje (osim vremena zadnjeg dohvata); `Cache-Control: no-store, private`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`; Caddy u zapisu pristupa token zamjenjuje oznakom `[token]`.

## 4. Dnevni sažetak e-poštom (WP1.21, v0.31.0)

Napravljeno kad je aplikacija dobila slanje e-pošte (vlastiti SMTP klijent, `docs/PILOT-INSTALACIJA.md` odj. 3). Bez uključene pošte (`MAIL_TRANSPORT=off` – demo, NAS) sažetka nema. Uz sigurnosne poruke računa (pozivnica, nova lozinka, „lozinka je promijenjena”) sažetak je **jedina** e-pošta – nema poruke po događaju.

- **Kada:** radnim danom od **7:00** po zoni institucije (`DIGEST_HOUR`). Raspored u procesu aplikacije (isti mehanizam kao dnevni uvoz poziva) provjerava svakih 5 minuta (`DIGEST_TICK_MINUTES`); sažetak koji u 7:00 nije otišao (aplikacija ugašena) šalje se pri prvoj provjeri nakon toga, ali **najkasnije do 12:00** – popodne se više ne šalje. **Radni dan = ponedjeljak–petak u zoni institucije**; kalendara blagdana nema (ovisi o zemlji i instituciji) – sažetak na blagdan je bezopasan, a propušten radni dan ne bi bio.
- **Kome:** aktivnim korisnicima s lozinkom koji ga nisu isključili (**Moj račun → Dnevni sažetak e-poštom**, zadano uključeno; promjena vrijedi od sljedeće provjere). Ne dobiva ga tko se ne može prijaviti: pozvan (pozivnica neprihvaćena), deaktiviran, obrisan, ili mu je MFA obvezan, a nije ga postavio. Potvrda e-adrese je pozivnica: račun postaje aktivan tek kad korisnik otvori poveznicu iz pretinca (ili onu koju mu je predao administrator).
- **Uvjet:** barem jedna stavka **kasni** ili **uskoro** u „Moj rad” **ili** barem jedna nepročitana obavijest nastala nakon prethodnog poslanog sažetka (bez prethodnog: sve nepročitane). Inače ništa. Pravilo: `selectDigest` u `packages/domain/src/mail.ts`.
- **Sadržaj:** stavke se računaju **istim** `MyWorkService` kao `GET /api/me/work`, za tog korisnika i pod njegovim dozvolama (kontekst kao njegov zahtjev, dozvole iz baze pri svakom izvođenju). Naslov `ArQus: 2 kasni, 1 uskoro, 3 nove obavijesti` (dijelovi s nulom izostavljeni). Tijelo (tekst i jednostavan HTML istog sadržaja, bez slika): „Kasni” i „Uskoro” (oznaka projekta, naslov, pojedinosti s rokom; najviše 15, zatim „… i još N”), broj stavki „čeka”, nove obavijesti **samo naslovom** (najviše 10 – pojedinosti nose ime aktera i razlog povrata, pa se vide tek u aplikaciji), jedna poveznica `<PUBLIC_URL>/#/moj-rad` i rečenica gdje se sažetak isključuje. Predložak: `digestMail` u domeni.
- **Ne sadrži:** iznose, tokene ni ništa što prijavljuje korisnika, priloge, projekte i prijave koje korisnik ne vidi, poveznicu za odjavu (nema nove neprijavljene površine – postavka je u Moj račun).
- **Najviše jednom po korisniku i danu – u bazi:** prije slanja servis u **zasebnoj transakciji** umeće redak u `digest_runs` (jedinstven indeks institucija + korisnik + dan institucije, `ON CONFLICT DO NOTHING`); šalje samo onaj tko je redak umetnuo. Ponovno pokretanje i druga instanca istog dana ne šalju ništa. Pad procesa između umetanja i slanja znači da sažetak tog dana izostane – nikad da ode dvaput. Ishod se upisuje u isti redak (`sent`, `empty`, `skipped`, `failed`).
- **Otpornost:** neuspjeh jednog pretinca (ili greška u podacima jednog korisnika) ne zaustavlja ostale; izvođenje traje najviše `DIGEST_RUN_MAX_MINUTES` (20) – korisnici koji nisu stigli na red preuzimaju se pri sljedećoj provjeri istog jutra; broj istovremenih SMTP veza ograničava red e-pošte (`MAIL_MAX_CONNECTIONS`, 2). Privremene greške relaya ponavljaju se ograničeno, neuspjeli sažetak se taj dan ne ponavlja.
- **Bilježi se:** redak `digest_runs` (dan, ishod, vrijeme) i zapis isporuke (`mail_deliveries`: primatelj-račun, vrsta `digest`, ishod, oznaka greške) – **bez sadržaja**; administrator ga vidi u **Korisnici → E-pošta**. Revizijski zapis po sažetku se ne piše (bio bi jedan redak dnevno po korisniku u nepromjenjivoj tablici; isporuka je zabilježena drugdje); revidira se promjena postavke (`digest.update`).
- **Test:** `apps/api/test/digest.e2e.test.ts` (jednom dnevno i s dvije istovremene instance, postavka, tko se ne može prijaviti, neuspio pretinac, vikend i prije 7:00, vremensko ograničenje, bez iznosa i tuđih projekata), domena `mail.test.ts` (odabir, naslov, radni dan i sat u zoni institucije).
