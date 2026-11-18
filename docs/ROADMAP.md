# Roadmap

Oznake: `[ ]` nije počelo · `[~]` u tijeku · `[x]` gotovo · `[-]` ukinuto · 👤 traži ljudski rad (Claude priprema materijale)

## Faza 0 – Provjera tržišta (mj. 1–3: studeni 2026. – siječanj 2027.)
Uvjet za fazu 1: ~~≥ 15 intervjua i ≥ 3 pisma namjere~~ → zamijenjeno ADR-0007: desk istraživanje tržišta i odluka go/no-go (WP0.6b, WP0.7). **Odluka: GO, uvjetno (2026-11-09).**

- [x] **WP0.0** Repozitorij, pravila verzioniranja, dokumentacija, ADR-ovi (v0.1.0)
- [x] **WP0.1** Materijali za intervjue: vodič za intervju, okvir popisa sugovornika, predložak bilješke s intervjua (v0.1.0)
- [-] **WP0.2** ~~Popis 20 sugovornika~~ – ukinuto ADR-0007; prijedlog i pozivna poruka ostaju za prodaju/pilote (v0.4.1)
- [x] **WP0.3** Detaljna analiza konkurencije (≥ 15 alata, cijene, funkcije, EU/HR pokrivenost) + karta tržišta (v0.2.0)
- [x] **WP0.4** Domenski model v1 (generički, neovisan o FPZ portalu): entiteti, odnosi, paketi programa (HE, NPOO) (v0.3.0)
- [x] **WP0.5** Klikabilni prototip toka „radar poziva → prijava → projekt” (HTML, bez backenda) (v0.4.0, `prototip/`)
- [-] **WP0.6** ~~Provedba intervjua i sinteza~~ – ukinuto ADR-0007; scenarij demonstracije i hipoteze H1–H10 koriste se u pilotima
- [x] **WP0.6b** Istraživanje tržišta iz javnih izvora: veličina tržišta, obujam HE/NPOO/PKK, broj potencijalnih kupaca, TAM/SAM/SOM (v0.5.0)
- [x] **WP0.7** Cjenovna hipoteza v2 (paketi Projekt / Institucija / Institucija+ / PaaS, svi ispod praga jednostavne nabave) i odluka go/no-go: GO uvjetno (v0.5.0)

## Faza 1 – MVP i pilot (mj. 4–9)
Uvjet za fazu 2 (WP0.7): 3 aktivna pilota od kojih ≥ 1 plaća, ≥ 10 institucija u beti, ušteda ≥ 30 % vremena na ZNS-u kod pilota, pentest bez kritičnih nalaza.
Redoslijed promijenjen prema WP0.7: provedba i troškovi/ZNS prije radara i prijave.

- [x] **WP1.1** Temelji platforme: pnpm monorepo (api, web, domain), CI, Docker Compose, validator i izračun iz paketa programa, ADR-0008 (v0.6.0); IaC i stage okruženje → WP1.9
- [x] **WP1.2** Stanari, identitet (lozinka + JWT), uloge i dozvole, revizijski zapis, RLS s automatskim testovima izolacije (v0.7.0)
- [~] **WP1.2b** Politika lozinki, sesije s opozivom, MFA (TOTP), upravljanje korisnicima i ulogama u sučelju, `pnpm audit` u CI-ju (v0.14.0); pozivnice e-poštom → WP1.21 (v0.31.0); OIDC/SAML (AAI@EduHr, Microsoft Entra) čeka pilot-instituciju
- [x] **WP1.3b** Sučelje za pakete po pozivu: popis, pregled razriješenih pravila, obrazac nasljeđivanja (stope, neizravni, osoblje, razdoblja, dodatne kategorije), JSON način, provjera, objava, nove verzije (v0.15.0)
- [x] **WP1.3** Paketi programa u bazi: globalni + stanarski, verzije i status, uvoz iz `docs/domena/paketi`, validacija, nasljeđivanje (`extends`) za paket po pozivu, objava; ESLint (v0.8.0)
- [x] **WP1.4** Radar poziva i go/no-go: pozivi (globalni i vlastiti) s rokovima i automatskim statusom, ocjena prikladnosti, odluka s obrazloženjem, interni rok i odgovorna osoba, povijest, nadolazeći rokovi (v0.16.0); uvoz s Funding & Tenders portala (v0.19.0)
- [x] **WP1.5** Prijava i proračun prijave, konzorcij: iz odluke go, spremnost, predaja, ishod, ugovaranje u projekt s kopijom partnera, radnih paketa i proračuna (v0.17.0)
- [x] **WP1.6** Projekt: registar organizacija, projekt vezan uz verziju paketa, partneri, prijelazi statusa, izvještajna razdoblja iz paketa (v0.9.0); pretvorba prijave u projekt dolazi s WP1.5
- [x] **WP1.7** Tehnička provedba (WP, zadaci, isporuke, prekretnice, rizici) i proračun projekta s izračunom iz paketa (v0.10.0); portfelj → uz web sučelje
- [x] **WP1.8** Troškovi, timesheetovi i zahtjevi za nadoknadu (ZNS) – prebačeno iz WP2.1 (WP0.7) (v0.11.0)
- [~] **WP1.9** Sigurnosni pregled i pilot-instalacija – Docker slika, produkcijski compose (Caddy HTTPS, kopije svakih sat), sigurnosna zaglavlja, ograničenje prijava, ASVS L2 samoprocjena, upute (v0.13.0); čeka odabir pružatelja i pilot-institucije, penetracijski test
- [x] **WP1.11** Dokumenti (M9): dokumenti s verzijama uz projekt, trošak (dokaz), isporuku, ZNS i prijavu; provjera vrste i SHA-256, zamrzavanje dokaza predajom ZNS-a, upozorenje za troškove bez dokaza, pohrana iza sučelja (lokalni volumen, S3 kasnije), dnevna kopija (v0.18.0); predlošci → WP2.6
- [x] **WP1.12** Uvoz poziva s portala EU Funding & Tenders: javni search API, najavljene i otvorene teme 2021–2027, briselsko vrijeme rokova, paket i vrste akcije za Horizon Europe, periodički uvoz, filtri radara (v0.19.0); proračun teme i fondovieu → kasnije
- [x] **WP1.10** Web sučelje za pilot: prijava, projekti, organizacije, struktura, proračun, timesheetovi, troškovi, ZNS, ugovoreno/ostvareno (React) + e2e provjera u pregledniku (v0.12.0)

### Faza 1b – Spremnost za pilot (od v0.19.0)
Širina MVP-a je gotova; do prvog pilota razvoj ide na spremnost za pilot. Obrazloženje i redoslijed: `docs/strategija-razvoja-faza-1b.md`.

- [x] **WP1.13** Demo okruženje: demo institucija s realnim podacima, pokretanje jednom naredbom, scenarij demonstracije (v0.20.0; `demo.cmd`, `docs/DEMO.md`, `docs/DEMO-SCENARIJ.md`)
- [x] **WP1.14** Pristup po projektu: uloge na projektu, povjerljivi dokumenti, plaće i razdvajanje dužnosti, provjera pokrivenosti svih ruta (v0.21.0; `docs/sigurnost/AUTORIZACIJA.md`)
- [x] **WP1.15** Portfelj (M10): pregled institucije – projekti, potrošnja, rokovi, opterećenje ljudi
- [x] **WP1.16a** ZNS – ispravnost: predaja nakon kraja razdoblja (ranije uz razlog), popis za provjeru prije predaje, odluka po trošku s priznatim iznosom, provjera isplate, jedna definicija ostvarenog uz nepriznato, sažeti troškovi osoblja (v0.23.0; `docs/domena/zns-pravila.md`)
- [x] **WP1.16b** ZNS paket za predaju: izvoz troškova (XLSX), mjesečne evidencije rada za potpis, dokazi s provjerom SHA-256, kontrolna lista i manifest u jednom ZIP-u; troškovi iz ranijih razdoblja; mjerenje trajanja pripreme i izvještaj „Ušteda na ZNS-u” (v0.24.0; `docs/domena/zns-pravila.md`)
- [x] **WP1.14b** Dorade prije pilota: zaštita od istovremenog prepisivanja (proračuni, timesheetovi, osnovni podaci), pregled revizijskog zapisa (stranica Revizija, CSV), četiri oka na timesheetovima, pristup voditelja vlastitoj prijavi, provjera valjanosti paketa i odstupanja od pravila programa, „danas” po zoni institucije (Europe/Zagreb), bez istovremenih upita na jednoj transakciji, jedinstvenost dodjela uloga (v0.25.0; `docs/sigurnost/AUTORIZACIJA.md`). **Točka zaustavljanja** – razvoj staje do barem tri demonstracije.
- [x] **WP1.19** (v0.27.0) Sigurnosne dorade prije penetracijskog testa: iznosi troškova osoblja samo uz pravo na plaće, obvezni MFA za povlaštene uloge, obvezna revizija u API-ju, zapis neuspjele prijave bez upisanog teksta, opseg testa za izvođača
- [x] **WP1.20** (v0.28.0) S3 pohrana dokumenata i kopije izvan poslužitelja, mjerenje vremena obnove: S3 izvedba pohrane bez novih ovisnosti (vlastiti SigV4), `documents verify` i `documents migrate`, šifrirane kopije izvan poslužitelja (servis `offsite`), skriptirana i izmjerena obnova (ADR-0012)
- [x] **WP1.17** (v0.29.0) Uvoz postojećeg projekta iz Excela: predložak za projekt, vlastiti čitač XLSX/CSV, pregled s greškama po listu, retku i stupcu, potvrda istih bajtova, sve ili ništa, troškovi potraživani prije ArQusa, povijest i poništavanje (`docs/UVOZ-PROJEKTA.md`)
- [x] **WP1.18** (v0.30.0) Rokovi i „Moj rad”: početna stranica s onim što čeka korisnika (timesheetovi, odobrenja, ZNS, isporuke, prijave, pozivi), obavijesti u aplikaciji (zvonce), osobni kalendar rokova (iCalendar po tajnoj poveznici); e-pošta opisana i čeka SMTP (`docs/domena/moj-rad-i-obavijesti.md`). **Faza 1b (WP1.13–WP1.20) je gotova.**

### Nastavak bez bilješki s demonstracija (od v0.30.1)
Paketi koje treba svaki pilot, neovisno o demonstracijama. Obrazloženje i redoslijed: `docs/strategija-razvoja-faza-1b.md`, odj. 10.

- [x] **WP1.21** (v0.31.0) Računi bez dijeljenja lozinki i e-pošta: pozivnice umjesto upisane lozinke, poveznica za novu lozinku i samostalni oporavak zaboravljene lozinke (jednokratni tokeni u bazi, token u fragmentu adrese), vlastiti SMTP klijent bez novih ovisnosti, zapis isporuka, dnevni sažetak „Moj rad” e-poštom; sve radi i bez SMTP-a (poveznica koju administrator kopira)
- [x] **WP1.22** (v0.32.0) Pristupačnost sučelja (WCAG 2.1 AA, EN 301 549 – automatska provjera axe-core i skriptirane provjere u e2e, e2e u CI-ju, glavni tokovi tipkovnicom, izvještaj o sukladnosti kao samoprocjena i stranica „Pristupačnost”) i odgovorne osobe na isporukama, prekretnicama i zadacima u „Moj rad” (uska iznimka za promjenu statusa vlastite stavke); čeka prolaz čitačem zaslona i neovisnu reviziju (ljudski kolosijek)
- [x] **WP1.23** (v0.33.0) Osobni podaci u proizvodu (GDPR): izvoz podataka osobe (administrator, samoposluga), zatvaranje računa, anonimizacija nakon roka čuvanja uz očuvanje financijskih zapisa, rokovi čuvanja s dnevnim poslom i zaslonom, evidencija obrade s testom pokrivenosti sheme, stranica „Privatnost”, predlošci ugovora o obradi, mjera i prava ispitanika; čeka pravni pregled predložaka i potvrdu rokova (ljudski kolosijek)

## Faza 2 – Komercijalna v1 (mj. 10–15)
Uvjet za fazu 3: 10 kupaca koji plaćaju, 60.000 € ARR.

- [ ] **WP2.1** Napredne financije: više valuta, storna, revizijski izvještaji (osnova prebačena u WP1.8)
- [ ] **WP2.2** Administracija (izvještaji, ZNS, putovanja, nabava, zapošljavanje)
- [ ] **WP2.3** AI pomoćnik (EU-hostani LLM, RAG po stanaru, oznake AI sadržaja)
- [ ] **WP2.4** Integracije M365/Google, uvoz iz Excela
- [ ] **WP2.5** Naplata pretplate, mjerenje potrošnje
- [ ] **WP2.6** Projektni vodiči i predlošci

## Faza 3 – Skaliranje (mj. 16–24)
- [ ] **WP3.1** PaaS / white-label instance
- [ ] **WP3.2** ISO/IEC 27001
- [ ] **WP3.3** Paketi Interreg, Erasmus+, ESIF, HRZZ, novi okvirni program 2028.+
- [ ] **WP3.4** Regija (SLO, BiH, SRB, CG, MK) – lokalizacija
