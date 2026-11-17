# Stanje projekta

**Zadnje ažuriranje:** 2026-11-17 · **Verzija:** v0.24.0 · **Faza:** 1 – MVP i pilot

## Gotovo
- WP1.16b (v0.24.0): ZNS paket za predaju – jedan ZIP s radnom knjigom troškova (XLSX po kategorijama paketa, svi troškovi, troškovi osoblja po osobi i mjesecu), mjesečnim evidencijama rada za potpis (jedna stranica A4; isti dokument i kao ispis timesheeta), dokazima s provjerom SHA-256, kontrolnom listom i manifestom; nacrt označen kao NACRT, povjerljivi dokazi samo uz dozvolu, svaki izvoz u reviziji. Troškovi evidentirani nakon predaje svog razdoblja nude se u sljedećem nacrtu i ulaze samo izričitim odabirom (signal u portfelju). Mjerenje pripreme: automatske mjere na zahtjevu, prijavljeni sati pri predaji, polazna mjera institucije i izvještaj „Ušteda na ZNS-u” na portfelju. Financijski ured sada predaje paket iz sustava, a uprava vidi uštedu.
- WP1.16a (v0.23.0): ZNS – ispravnost – predaja tek nakon kraja razdoblja (ranije samo uz razlog, vidljiv na zahtjevu i u reviziji); popis za provjeru prije predaje (neodobreni timesheetovi i troškovi bez dokaza blokiraju, trošak bez dokaza može se izričito potvrditi, prekoračenje kategorije proračuna je upozorenje); odluka po trošku s priznatim iznosom i razlogom, priznati ukupni iznos istim izračunom kao zahtjev, usporedba s iznosom financijera; provjera datuma i iznosa isplate; jedna definicija ostvarenog (priznato nakon odluke) uz nepriznato u pregledu, zahtjevu i portfelju; troškovi osoblja sažeti po osobi i mjesecu. Priznati iznos nepromjenjiv u bazi osim kroz najavljen ispravak koji baza sama revidira. Pravila: `docs/domena/zns-pravila.md`. ZNS je sada dovoljno strog da ga financijski ured i revizor mogu prihvatiti.
- WP1.15 (v0.22.0): portfelj – prvi zaslon uprave i ureda nakon prijave: projekti s potrošnjom prema proteklom vremenu (oznaka kad se razlikuju za više od 20 postotnih bodova), upozorenja koja vode na mjesto popravka (isporuke koje kasne, visoki rizici, timesheetovi na odobrenju, troškovi bez dokaza, razdoblja bez ZNS-a), jedan popis rokova (izvještaji, isporuke, pozivi, interni rokovi), opterećenje ljudi kroz projekte s provjerom godišnjeg fonda sati i dana iznad 8 h (dvostruko financiranje), prijave po statusu i uspješnost. Poštuje pristup po projektu (voditelj vidi samo svoje projekte, bez novca tamo gdje nema financije, bez ljudi i prijava). Demonstracija počinje na portfelju. Prodekan u jednom pogledu vidi sve projekte i sljedeće rokove.
- WP1.14 (v0.21.0): pristup po projektu – uloga dodijeljena na projektu vrijedi samo za taj projekt (API, popisi, dokumenti); voditelj projekta A ne vidi projekt B ni izravnom poveznicom (404). Svaka ruta mora biti izričito razvrstana, a test pokrivenosti za svaku projektnu rutu provjerava izolaciju. Plaće upisuju i vide samo ovlašteni, nitko ne odobrava vlastiti timesheet, povjerljive dokumente vide samo ured, voditelj i financije; financije prilažu dokaze. Kartica „Pristup” na projektu i uloge na projektima u izborniku Korisnici. Vrata za stvarne podatke prve institucije i za penetracijski test su otvorena (`docs/sigurnost/AUTORIZACIJA.md`).
- WP1.13 (v0.20.0): demo okruženje – `demo.cmd` (Windows, Docker Desktop) u nekoliko minuta digne ArQus Projekti na http://localhost:8080 s popunjenom demo institucijom (HE projekt u provedbi, NPOO projekt s isplaćenim ZNS-om, prijava u pripremi, radar, 7 korisnika s različitim ulogama); `demo.cmd reset` vraća početno stanje. Scenarij demonstracije od 20 minuta u `docs/DEMO-SCENARIJ.md`. Ivan može pokazati pravi proizvod bez ručne instalacije.
- WP1.12 (v0.19.0): uvoz poziva s portala EU Funding & Tenders – ~470 aktualnih tema (365 Horizon Europe s paketom i vrstom akcije) osvježava se svaki dan; radar s filtrima po programu i „vlastiti i praćeni”. Institucija više ne mora ručno unositi EU pozive.
- WP1.11 (v0.18.0): dokumenti – dokazi uz troškove (zamrzavaju se predajom ZNS-a), ugovori i isporuke na projektu, dokumenti prijave; verzije s SHA-256, sigurna provjera i preuzimanje, dnevna kopija. Pilot ima sve za reviziju troškova na jednom mjestu.
- WP1.5 (v0.17.0): prijave – iz odluke go na radaru, konzorcij s potvrdama, struktura rada, proračun po pravilima paketa (verzije, zaključavanje), provjera spremnosti, predaja, ishod i ugovaranje u projekt. Cijeli put poziv → prijava → projekt → ZNS radi u sučelju.
- WP1.4 (v0.16.0): radar poziva – pozivi s rokovima i statusom, ocjena prikladnosti, odluka go/no-go s poviješću, nadolazeći rokovi; web stranica Radar poziva.
- v0.15.0: sučelje za pakete po pozivu (obrazac nasljeđivanja, JSON način, provjera, objava, verzije); ispravak nasljeđivanja napomena i provjera; pouzdaniji e2e. Ured za projekte može sam dodavati NPOO/PKK pozive.
- WP1.2b (v0.14.0): politika lozinki, sesije s opozivom, MFA (TOTP), korisnici i uloge u sučelju, zaštita podataka o plaćama, `pnpm audit` u CI-ju; nadograđeni drizzle-orm i zod zbog visokih ranjivosti. 100 testova + e2e (14 koraka).
- Odgovori Ivana (2026-11-10): pilot-institucija još ne postoji; EU pružatelj nije odabran; HE i NPOO paketi smiju se objaviti.
- v0.13.0: paketi HE i NPOO provjereni i objavljeni; WP1.9 dio neovisan o pružatelju – Docker slika, produkcijski compose (HTTPS, kopije), sigurnosna zaglavlja, ograničenje prijava, ASVS L2 samoprocjena, upute za instalaciju. Slika testirana e2e testom.
- WP1.10 (v0.12.0): web sučelje za pilot – projekti, organizacije, struktura, proračun, timesheetovi, troškovi, ZNS, ugovoreno/ostvareno; e2e provjera cijelog toka u pregledniku. Prvi pilot može raditi kroz preglednik.
- WP1.8 (v0.11.0): tim, timesheetovi s izračunom troška osoblja iz paketa, troškovi, zahtjevi za nadoknadu (predaja, povrat, odluka, isplata), ugovoreno vs. ostvareno; nepromjenjivost prihvaćenih troškova u bazi. 78 testova. Backend jezgra provedbe za MVP je gotova.
- WP1.7 (v0.10.0): struktura provedbe (WP, zadaci, isporuke, prekretnice, rizici) i proračun projekta s izračunom iz paketa; zaključavanje proračuna aktivacijom; ograničenja baze → 409. 62 testa.
- WP1.6 (v0.9.0): organizacije, projekti, partneri, prijelazi statusa, izvještajna razdoblja iz paketa; kompozitni strani ključevi protiv miješanja stanara. 48 testova. PR #2 i #3 spojeni.
- WP1.3 (v0.8.0): paketi programa u bazi (globalni/stanarski, verzije, objava), uvoz iz datoteka, nasljeđivanje za paket po pozivu, ESLint. 30 testova.
- WP1.2 (v0.7.0): Drizzle, migracije, RLS po stanaru s testovima izolacije na pravoj bazi, aplikacijska DB uloga, prijava lozinkom + JWT, dozvole i sistemske uloge, revizijski zapis (append-only). 22 testa.
- WP1.1 (v0.6.0): monorepo `apps/api` (NestJS), `apps/web` (React/Vite), `packages/domain` (validator paketa, izračun proračuna), Docker Compose, CI; ADR-0008. PR #1 (faza 0) spojen u `main`.
- Odluka (Ivan, 2026-11-09): faza 1 financira se zasad iz vlastitih sredstava Arqus Solutionsa; prijava na EU poziv za MSP ostaje opcija za kasnije.
- Strategija i plan razvoja (Claude Docs, poveznica u `docs/strategija.md`).
- Odluka: proizvod razvija Arqus Solutions kao zaseban produkt (ADR-0005).
- Repozitorij, pravila verzioniranja i dokumentacije, ADR-0001 – ADR-0005.
- WP0.1: vodič za intervju, okvir popisa sugovornika, predložak bilješke s intervjua, početna analiza konkurencije.
- WP0.3 (v0.2.0): analiza konkurencije – 20 alata, karta tržišta, zaključci i pitanja za intervjue (`docs/faza-0/analiza-konkurencije.md`).
- WP0.6b + WP0.7 (v0.5.0): istraživanje tržišta iz javnih izvora, TAM/SAM/SOM, cjenovna hipoteza v2, odluka GO uvjetno; ADR-0007 (bez intervjua).
- Priprema WP0.2 i WP0.6 (v0.4.1): prijedlog 20 sugovornika, pozivna poruka, scenarij demonstracije, predložak sinteze s hipotezama, dopuna vodiča.
- WP0.5 (v0.4.0): klikabilni prototip (`prototip/index.html`) s automatskim testom toka; Windows pokretač `verzija.cmd`.
- Alati (v0.3.1): `scripts/verzija.sh` + lokalni preglednik verzija (`site/`), upute `docs/LOKALNO-TESTIRANJE.md`, dnevnik potrošnje `docs/POTROSNJA.md`.
- WP0.4 (v0.3.0): domenski model v1 – moduli, entiteti, životni ciklusi, invarijante (`docs/domena/domenski-model-v1.md`); JSON shema paketa programa + primjeri HE i NPOO (`docs/domena/paketi/`); ADR-0006.

## U tijeku
- WP1.9 – čeka odabir pružatelja i pilot-institucije (instalacija za ~1 sat prema `docs/PILOT-INSTALACIJA.md`) i vanjski penetracijski test (WP1.14 gotov – test se može naručiti; opseg autorizacije u `docs/sigurnost/AUTORIZACIJA.md`).

## Sljedeće
Prema reviziji strategije nakon WP1.15 (`docs/strategija-razvoja-faza-1b.md`, odj. 7): WP1.14b dorade prije pilota. Zatim **točka zaustavljanja** (razvoj staje dok se ne održe barem tri demonstracije): WP1.17 (uvoz iz Excela) i WP1.18 (rokovi i „Moj rad”) rade se tek nakon povratne informacije s barem tri demonstracije.

## Otvorena pitanja za Ivana
- WP1.16b: potvrdi (1) pravilo troškova iz ranijih razdoblja (nacrt kasnijeg razdoblja ih nudi, ulaze samo izričitim odabirom); (2) da ured za projekte smije mijenjati postavke institucije (`tenant:write`, zasad samo polazna mjera ZNS-a); (3) da mjera „broj dokaza” broji i povjerljive dokaze (samo zbroj). Format paketa je generički – koje obrasce financijera (eFondovi, Horizon Europe) pilot treba, odlučuje se s pilotom. Za mjerenje uštede od prvog pilota treba polazna mjera (sati po ZNS-u prije ArQusa).
- WP1.16a: potvrdi pravila ZNS-a (`docs/domena/zns-pravila.md`): neodobren timesheet u razdoblju blokira predaju (ne samo upozorava); predaja na zadnji dan razdoblja smatra se ranom; ispravak odluke dopušten samo prije isplate.
- WP1.14: postojeće instalacije zadržavaju uloge na razini institucije – nakon nadogradnje u izborniku Korisnici voditeljima i članovima tima zamijeniti ulogu institucije ulogom na projektu. Odluka: prijave ostaju na razini institucije (nositelj prijave bez uloge institucije ne vidi prijavu dok se ne ugovori) – je li to prihvatljivo za pilot?
- Ljudski kolosijek iz strategije faze 1b: demo je spreman (`demo.cmd`, upute `docs/DEMO.md`) – pokazati ga trima do pet institucija; isprobaj `demo.cmd` na svom računalu prije prvog razgovora (slika, compose, punjenje, reset i ponovno pokretanje provjereni su u Dockeru na Linuxu; sama skripta `demo.cmd` na Windowsu nije), odabrati EU pružatelja, od prvog pilota dobiti polaznu mjeru trajanja pripreme ZNS-a, budžet za penetracijski test.
- Kad odabereš pružatelja i pilot-instituciju, instalacija ide prema `docs/PILOT-INSTALACIJA.md`; za vanjski penetracijski test treba budžet i izvođača.
- Prototip: isprobaj tok u `verzija.cmd` → verzija ≥ v0.4.0 → poveznica „Prototip”. Što nedostaje da ga pokažeš sugovorniku?
- NPOO stopa neizravnih troškova (15 %) nije potvrđena u pozivima – Upute za prijavitelje jednog stvarnog poziva i dalje bi pomogle.
- Identitet za pilote: koriste li ciljne institucije AAI@EduHr (sveučilišta) ili Microsoft 365? To određuje redoslijed u WP1.2b.
- Potrošnja: Claude ne može očitati tvoj brojač; ako želiš nadzor, povremeno upiši postotak iz Settings → Usage u `docs/POTROSNJA.md` ili ga javi u poruci.
- Konačan naziv proizvoda (radni: „ArQus Projekti”).
- Tko provodi intervjue (Ivan osobno ili netko iz Arqus Solutions)?
- Znaš li za HR institucije koje koriste EMDESK ili Kronis (Sploro)? To bi bili dobri sugovornici za WP0.2.
- NPOO paket je ilustrativan (stope ovise o pozivu). Imaš li Upute za prijavitelje nekog konkretnog NPOO poziva koje bi poslužile kao prvi „paket po pozivu”?

## Blokade
- Nema.
