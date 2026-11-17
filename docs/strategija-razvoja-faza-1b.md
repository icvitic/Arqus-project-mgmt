# Strategija daljnjeg razvoja – faza 1b „Spremnost za pilot”

**Datum:** 2026-11-17 · **Polazište:** v0.19.0 · **Vrijedi do:** prvog aktivnog pilota ili revizije nakon WP1.15

## 1. Gdje smo

Proizvod u v0.19.0 pokriva cijeli životni ciklus u sučelju: radar poziva (s dnevnim uvozom s portala Funding & Tenders) → odluka go/no-go → prijava → ugovaranje → provedba → timesheetovi i troškovi → ZNS → dokumenti. Širina MVP-a je gotova.

Uvjeti za fazu 2 (WP0.7) nisu funkcionalni nego tržišni:

| Uvjet | Stanje | Što ga koči |
| --- | --- | --- |
| 3 aktivna pilota, ≥ 1 plaća | 0 | nema pilot-institucije; proizvod se ne može pokazati bez instalacije |
| ≥ 10 institucija isprobalo betu | 0 | nema demo okruženja ni javne instance |
| ušteda ≥ 30 % vremena na ZNS-u | nije mjerljivo | ZNS se u sustavu priprema, ali se ne može izvesti u obliku za predaju; nema mjerenja |
| pentest bez kritičnih nalaza | nije naručen | uloge „na projektu” nisu provedene – korisnik s ulogom na jednom projektu vidi sve projekte institucije |

**Zaključak:** dodavanje novih modula više ne približava fazu 2. Do prvog pilota razvoj se prebacuje sa širine na **spremnost za pilot**: da se proizvod može pokazati, da mu se mogu povjeriti stvarni podaci, da dokazivo štedi vrijeme na ZNS-u i da uprava institucije u njemu vidi svoju korist.

## 2. Načela odlučivanja

1. **Svaki radni paket mora pomaknuti jedan od četiri uvjeta faze 2.** Ako ne pomiče nijedan, odgađa se.
2. **Širina na zahtjev.** Novi paketi programa (Interreg, Erasmus+, HRZZ) i novi izvori poziva rade se tek kad ih traži imenovani pilot.
3. **Ne gradi se ono što ovisi o neodabranom pružatelju** (S3, OIDC, e-pošta, Kubernetes). Sučelja već postoje; izvedba čeka odluku.
4. **Pravilo demo podataka.** Svaka nova funkcija dodaje svoj primjer u demo okruženje, da je odmah vidljiva kupcu.
5. **Jedan radni paket = jedan PR = jedna verzija**, s testovima i e2e provjerom; spajanje kad CI prođe.
6. **Mjerljivo prije lijepog.** Za ZNS se prvo gradi ono što se može izmjeriti kod pilota.

## 3. Redoslijed (WP1.13 – WP1.18)

Redoslijed slijedi put kupca: vidjeti → povjeriti podatke → prepoznati korist → dobiti izlaz za financijera → unijeti postojeće projekte → koristiti svaki dan.

| # | Radni paket | Uvjet koji pomiče | Sadržaj | Gotovo kad |
| --- | --- | --- | --- | --- |
| **WP1.13** | Demo okruženje | piloti, beta | Naredba koja puni demo instituciju realnim podacima (HE projekt u provedbi s troškovima, timesheetovima, ZNS-om i dokumentima; NPOO projekt u ugovaranju; prijava u pripremi; praćeni pozivi; nekoliko korisnika s različitim ulogama). Pokretanje jednom naredbom na Windowsu (Docker Desktop). Scenarij demonstracije od 20 minuta prema stvarnom proizvodu. | Ivan na svom računalu jednom naredbom dobije punu demo instancu i može je vratiti na početno stanje |
| **WP1.14** | Pristup po projektu | pentest, povjerenje pilota | Uloge dodijeljene na projektu vrijede samo za taj projekt (API i popisi); povjerljivi dokumenti i podaci o plaćama samo ovlaštenima; zaštita od istovremenog prepisivanja proračuna; pregled revizijskog zapisa u sučelju; sakrivanje radnji koje korisnik ne smije. | test izolacije „voditelj projekta A ne vidi projekt B” prolazi za sve rute; ASVS L2 ažuriran |
| **WP1.15** | Portfelj | plaćeni pilot (kupac je uprava) | Početna stranica institucije: projekti s potrošnjom prema proračunu, rokovi u idućih 60 dana (izvještaji, isporuke, pozivi, interni rokovi), opterećenje ljudi kroz sve projekte s provjerom godišnjeg ograničenja sati (dvostruko financiranje), prijave po statusu. Poštuje pristup po projektu. | prodekan u jednom pogledu vidi sve projekte i sljedeće rokove |
| **WP1.16** | ZNS paket za predaju | ušteda ≥ 30 % | Izvoz zahtjeva: tablica troškova po kategorijama paketa (XLSX/CSV), mjesečne evidencije rada za potpis (ispis/PDF), ZIP s dokazima, kontrolna lista potpunosti. Mjerenje: trajanje pripreme ZNS-a i broj ručnih koraka iz revizijskog zapisa. | iz predanog ZNS-a jednim klikom nastaje paket koji se prilaže financijeru; izvještaj o trajanju pripreme |
| **WP1.17** | Uvoz iz Excela | beta, uvođenje pilota | Uvoz postojećeg projekta: proračun, tim, troškovi; pregled prije potvrde s prikazom grešaka po retku; predlošci tablica. | projekt koji je u tijeku unosi se za manje od sat vremena |
| **WP1.18** | Rokovi i „Moj rad” | aktivnost pilota | Stranica za člana tima (moji timesheetovi, zadaci, rokovi), obavijesti u aplikaciji o rokovima i radnjama koje čekaju (odobrenje timesheeta, dokaz koji nedostaje); e-pošta kad bude SMTP. | član tima nakon prijave vidi što danas treba napraviti |

**Vrata:** WP1.14 mora biti gotov prije nego što se u sustav unesu stvarni podaci prve institucije. Zato ide odmah nakon demo okruženja, a i zato da portfelj, izvoz i obavijesti od početka poštuju pristup po projektu (bez naknadne prerade).

**Revizija strategije:** nakon WP1.15 ili čim se pojavi prvi pilot – tada redoslijed određuju njegove potrebe.

## 4. Što se namjerno ne radi sada

| Odgođeno | Okidač za početak |
| --- | --- |
| OIDC/SAML (AAI@EduHr, Entra), pozivnice e-poštom | poznata pilot-institucija i njezin sustav identiteta |
| S3 pohrana, izvanposlužiteljske kopije, mjerenje RTO-a | odabran EU pružatelj |
| Vanjski penetracijski test | gotov WP1.14, odobren budžet |
| Proračun teme s F&T-a, fondovieu, HRZZ pozivi | pilot koji ih prati |
| Novi paketi programa (Interreg, Erasmus+, HRZZ) | pilot s takvim projektom |
| AI pomoćnik, naplata pretplate, integracije M365/Google | faza 2 (nakon ispunjenih uvjeta) |
| Amandmani ugovora, izvještaji prema financijeru (M8) u punom opsegu | prvi pilot u provedbi koji to zatraži; minimum dolazi kroz WP1.16 |

## 5. Ljudski kolosijek (Ivan) – usporedno s razvojem

Razvoj sam ne može ispuniti nijedan uvjet faze 2. Najduži rok ima pronalazak pilota.

1. **Nakon WP1.13:** pokazati demo trima do pet institucija s popisa `docs/faza-0/prijedlog-sugovornika.md`; cilj su 3 pilota, od toga 1 po tržišnim uvjetima.
2. **Odabrati EU pružatelja** za pilot-instalaciju (dovoljan je jedan virtualni poslužitelj; ADR-0009).
3. **Od prvog pilota zatražiti polaznu mjeru:** koliko sati sada traje priprema jednog ZNS-a. Bez toga se uvjet od 30 % ne može dokazati.
4. **Budžet i izvođač za penetracijski test** – naručiti nakon WP1.14.
5. Otvoreno od prije: Upute za prijavitelje jednog NPOO poziva (stopa neizravnih troškova), AAI@EduHr ili Microsoft 365 kod ciljnih institucija.

## 6. Način rada i potrošnja

- **Strategija i revizije:** Fable 5.2 – ovaj dokument, revizija nakon WP1.15 i pregled svakog PR-a prije spajanja.
- **Izvedba:** Opus 5.5 – po jedan radni paket prema zadatku iz ovog dokumenta.
- **Tempo:** najviše dva radna paketa dnevno; nakon svakog izvještaj i stanka dok tjedna potrošnja ne dopusti nastavak (granica 80 %).
- **Gotovo znači:** testovi i e2e prolaze, revizija ovisnosti čista, dokumentacija i demo podaci ažurirani, PR spojen.

## 7. Revizija nakon WP1.15 (2026-11-17, v0.22.0)

**Stanje.** WP1.13 demo, WP1.14 pristup po projektu i WP1.15 portfelj su gotovi. Proizvod se sada može pokazati (demo), smije primiti stvarne podatke (pristup po projektu) i ima pogled za kupca (portfelj). Od četiri uvjeta faze 2 razvoj je otključao tri preduvjeta; ispunjenje svih i dalje ovisi o pilotima.

**Što je punjenje demo podataka pokazalo.** Najviše nedostataka je u samom ZNS-u, a to je jedina mjerljiva vrijednost iz uvjeta faze 2:
- ZNS se može predati prije kraja razdoblja; djelomično odobren ZNS označi sve troškove prihvaćenima, i nepriznate; datum isplate se ne provjerava prema odluci.
- Svaki odobreni timesheet stvara po jedan trošak za svaki radni paket, pa ZNS jednog razdoblja ima 40+ redaka.
- Valjanost paketa programa (rok, pravila `validations`) ne provjerava se pri stvaranju projekta.

**Promjena redoslijeda.**

| # | Radni paket | Promjena |
| --- | --- | --- |
| **WP1.16** | ZNS: ispravnost i paket za predaju | Prošireno: prvo pravila (predaja tek nakon kraja razdoblja, odluka po trošku, provjera datuma, sažeti prikaz troškova osoblja), zatim izvoz i mjerenje. Ostaje sljedeći. |
| **WP1.14b** | Dorade prije pilota | Prošireno i pomaknuto iza WP1.16: zaštita od istovremenog prepisivanja proračuna, pregled revizijskog zapisa, provjera valjanosti paketa, pristup voditelja vlastitoj prijavi, „danas” po zoni Europe/Zagreb, uklanjanje istovremenih upita na jednoj transakciji (prestaje raditi u pg 9). |
| WP1.17, WP1.18 | Uvoz iz Excela; rokovi i „Moj rad” | **Uvjetno.** Rade se tek nakon povratne informacije s prvih demonstracija. |

**Točka zaustavljanja.** Nakon WP1.16 i WP1.14b daljnji razvoj bez povratne informacije kupaca je nagađanje: ne znamo unose li institucije postojeće projekte iz Excela (WP1.17) ili im više treba nešto treće. Zato se nakon ta dva paketa razvoj zaustavlja dok Ivan ne održi barem tri demonstracije i zapiše što su sugovornici tražili (predložak: `docs/faza-0/predlozak-biljeske.md`). Te bilješke određuju sljedeću reviziju.

**Poznata ograničenja koja ostaju do pilota:** izolacija projekata samo u aplikaciji (bez RLS-a po projektu), prijave na razini institucije, voditelj može unijeti i odobriti timesheet člana bez korisničkog računa, iznosi troškova osoblja vidljivi uz `finance:read`. Sva su zapisana u `docs/sigurnost/AUTORIZACIJA.md` i idu u opseg penetracijskog testa.
