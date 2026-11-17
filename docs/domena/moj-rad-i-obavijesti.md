# „Moj rad”, obavijesti i osobni kalendar rokova (WP1.18, v0.30.0)

Cilj: **član tima nakon prijave vidi što danas treba napraviti** – bez traženja po projektima. Tri dijela:

| Dio | Što je | Gdje |
| --- | --- | --- |
| **Moj rad** | trenutno stanje: što čeka korisnika (izvodi se iz podataka pri svakom učitavanju, ništa se ne sprema) | `GET /api/me/work`, stranica **Moj rad** (početna za sve osim uprave i ureda), značka u izborniku |
| **Obavijesti** | događaji koji su se korisniku dogodili (odobren timesheet, vraćen ZNS…) – spremaju se | `GET /api/me/notifications`, zvonce u zaglavlju |
| **Kalendar** | rokovi koje korisnik vidi, u Outlooku / Google Kalendaru, preko tajne poveznice | `GET /api/calendar/<token>.ics`, **Moj račun → Rokovi u mom kalendaru** |

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

**Sadržaj:** vrsta, akter, projekt/prijava i strukturirani podaci (akronim, mjesec, razdoblje, ishod, uloga, naziv datoteke); tekst se slaže pri čitanju (`notificationText` u domeni – isti za sučelje i budući sažetak e-poštom). Bez iznosa i bez slobodnog teksta drugih korisnika, osim razloga povrata ZNS-a koji primatelj vidi i na zahtjevu.

**Samo vlastite.** Svaki upit filtrira po korisniku, a baza (RLS, migracija 0027) iste retke otkriva samo kad je u transakciji postavljen `app.user_id` tog korisnika: upit koji bi zaboravio filtar ili se izvršio bez postavke ne vraća ništa. Aplikacija smije mijenjati samo `read_at` (sadržaj je nepromjenjiv). **Zašto zaštita po korisniku i u bazi:** obavijesti su jedina tablica čiji su retci osobni unutar institucije; jedna postavka po čitanju je mala cijena za jamstvo koje ne ovisi o ispravnosti svakog budućeg upita.

**API:** `GET /api/me/notifications?limit=&before=` (najnovije prve, keyset po id-u, `next`, `unread`), `POST /api/me/notifications/:id/read`, `POST /api/me/notifications/read-all`.

**Čuvanje:** pročitane obavijesti starije od **90 dana** (`NOTIFICATION_RETENTION_DAYS`) brišu se pri sljedećem čitanju popisa vlasnika; nepročitane se ne brišu. Brisanje pri čitanju ne treba raspored poslova ni pristup preko granice stanara; obavijesti neaktivnih korisnika ostaju dok se ne prijave (malo podataka, brišu se s korisnikom).

## 3. Osobni kalendar rokova (iCalendar)

Kalendarski klijenti ne šalju zaglavlje Authorization, pa se feed adresira **tajnim tokenom u URL-u**: `https://<instalacija>/api/calendar/<token>.ics`.

**Sadržaj:** isti rokovi koje korisnik vidi na portfelju, istim pravilima pristupa (`PortfolioService.deadlines`): izvještajna razdoblja (kraj i rok ZNS-a), isporuke i prekretnice otvorenih projekata, interni rokovi i rokovi predaje praćenih poziva (uz `calls:read` institucije), interni rokovi prijava (vlastitih ili uz `proposals:read` institucije). Od 180 dana unatrag do 2 godine unaprijed. Cjelodnevni događaji za datume; rok predaje poziva s vremenom kao UTC. Naslov `[AKRONIM] naslov roka`, opis = vrsta roka. Bez iznosa, bez imena osoba.

**Format (RFC 5545):** CRLF, presavijanje na 75 okteta (bez prelamanja UTF-8 znaka), escape `\ ; , \n`, stabilni `UID` (`<vrsta>-<id entiteta>@arqus-projekti` – ažuriranje zamjenjuje događaj), `DTSTAMP`, `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` 4 h, `TRANSP:TRANSPARENT`. Generator `packages/domain/src/ical.ts`.

**Zaštite** (nova neprijavljena površina – `docs/sigurnost/PENTEST-OPSEG.md`): token 32 bajta iz CSPRNG-a (256 bita), u bazi samo SHA-256, prikazan jednom; novi token poništava stari; „Ukloni” ga briše; deaktivacija korisnika ga briše, a feed provjerava i da je korisnik aktivan i nije obrisan; korisnik u ograničenom stanju obveznog MFA ne dobiva feed; isti 404 (status i tijelo) za nepoznat, opozvan i neispravan token, a neispravan prolazi isti put (hash i upit); bez stanara baza otkriva samo redak čiji je hash postavljen u transakciji (RLS – tokeni se ne mogu nabrojati); ograničenje 120 zahtjeva u 10 min po IP adresi (`CALENDAR_RATE_MAX`, `CALENDAR_RATE_WINDOW_MINUTES`); samo čitanje (osim vremena zadnjeg dohvata); `Cache-Control: no-store, private`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`; Caddy u zapisu pristupa token zamjenjuje oznakom `[token]`.

## 4. E-pošta – kad bude SMTP (nije napravljeno)

SMTP još nije konfiguriran nigdje (ovisi o pružatelju). Kad bude, šalje se **jedan dnevni sažetak** po korisniku – ništa drugo (bez poruke po događaju):

- **Kada:** jednom dnevno u 7:00 po zoni institucije, radnim danom; samo ako postoji barem jedna stavka „kasni” ili „uskoro” u „Moj rad” **ili** barem jedna nepročitana obavijest nastala nakon prethodnog sažetka. Inače se ne šalje ništa.
- **Kome:** aktivnim korisnicima s potvrđenom e-adresom koji se nisu isključili (postavka u Moj račun, zadano uključeno); korisnicima u ograničenom stanju obveznog MFA ne.
- **Naslov:** `ArQus: 2 kasni, 1 uskoro, 3 nove obavijesti` (dijelovi s nulom se izostavljaju).
- **Tijelo (tekst i jednostavan HTML):**
  1. „Kasni” i „Uskoro” iz `GET /api/me/work` (isti `deriveWorkItems`, isti tekst `title` i `detail`, akronim, rok), najviše 15 stavki, zatim „i još N”.
  2. Broj stavki „čeka” (bez popisa).
  3. Nepročitane obavijesti nastale od prethodnog sažetka (`notificationText`, najviše 10).
  4. Jedna poveznica na **Moj rad** (`https://<instalacija>/#/moj-rad`) – poveznice na pojedine stavke da (relativne putanje iz `link`), ali **bez tokena i bez ičega što prijavljuje korisnika**.
- **Ne sadrži:** iznose (kao ni stranica), tokene, priloge, imena projekata koje korisnik ne vidi (isti izračun kao stranica, za tog korisnika).
- **Bilježi se:** vrijeme zadnjeg sažetka po korisniku (da se obavijesti ne ponavljaju); revizija `digest.sent` bez sadržaja.
- **Potrebno za izvedbu:** SMTP pružatelj (EU), `SMTP_*` varijable, SPF/DKIM domene instalacije, raspored (isti proces kao dnevni uvoz poziva), predložak, postavka isključivanja, test sa simuliranim SMTP-om.
