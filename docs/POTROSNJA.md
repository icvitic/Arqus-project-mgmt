# Dnevnik potrošnje tokena

**Pravilo:** ne prelaziti 80 % tjedne potrošnje (AUTONOMNI-RAD, t. 2).
**Ograničenje:** Claude u sesiji **ne vidi** brojač potrošnje računa; nijedan alat u Claude Code u oblaku ga ne izlaže. Zato se vodi ovaj dnevnik:
- Claude nakon svake sesije upisuje **opseg** (vrsta zadatka, broj web pretraživanja/dohvaćanja, podagenti, veličina izlaza) i procjenu težine (L/M/H).
- Ivan po potrebi upisuje **očitanje** postotka s claude.ai → Settings → Usage (tjedni limit) u stupac „Očitanje”.
- Ako je očitanje ≥ 70 %, zakazane sesije se pauziraju do resetiranja tjednog limita; pri ≥ 60 % Claude radi samo zadatke težine L.

Težina: **L** = samo pisanje/uređivanje dokumenata iz postojećeg znanja; **M** = uz ≤ 6 pretraživanja ili pregled repozitorija; **H** = više pretraživanja, podagenti, generiranje koda i testiranje u pregledniku.

| Datum | Sesija | Zadatak | Pretraživanja / dohvaćanja | Podagenti | Težina | Očitanje (Ivan) |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-18 | 20 (podagent) | WP1.23 osobni podaci (evidencija obrade s testom, izvoz, zatvaranje računa, anonimizacija, posao i zaslon rokova čuvanja, stranica Privatnost, predlošci GDPR); v0.33.0 | 0 / 0 | 0 | H | |
| 2026-11-18 | 19 (podagent) | WP1.22 pristupačnost sučelja (axe-core i skriptirane provjere u e2e, e2e u CI-ju, ispravci zajedničkih komponenti, istek sesije, izvještaj o sukladnosti, stranica Pristupačnost) i odgovorne osobe (migracija 0030, Moj rad, obavijesti, uska iznimka za status), v0.32.0 | 2 / 0 (verzije paketa u registru npm) | 0 | H | |
| 2026-11-08 | 1 (ručno) | WP0.0, WP0.1, ADR-ovi, strategija | ~5 / ~5 | 0 | M | |
| 2026-11-09 | 1 (zakazana) | WP0.3 dio 1 | 6 / 6 | 0 | M | |
| 2026-11-09 | 2 (ručno) | WP0.3 dio 2, v0.2.0 | 4 / 6 | 0 | M | |
| 2026-11-09 | 3 (ručno) | WP0.4 domenski model, v0.3.0 | 0 / 0 | 0 | L | |
| 2026-11-09 | 3 (nastavak) | skripta verzija + preglednik, test u pregledniku, v0.3.1 | 0 / 0 | 0 | M | |
| 2026-11-18 | 18 (podagent) | WP1.21 računi bez dijeljenja lozinki i e-pošta (pozivnice i nova lozinka s jednokratnim tokenima u bazi, zaboravljena lozinka s jednakim odgovorom, vlastiti SMTP klijent bez ovisnosti s lažnim poslužiteljem u testovima i Mailpitom u CI-ju, zapis isporuka, dnevni sažetak s jednokratnošću u bazi, sučelje Korisnici/prijava/javne stranice/Moj račun, demo kroz pozivnice i profil `mail`; ~60 novih API testova, 12 domena, e2e +4 koraka; snimke zaslona u dvije teme i dvije širine); v0.31.0 | 0 / 1 (slika ghcr.io/axllent/mailpit) | 0 | H | |
| 2026-11-17 | 17 (podagent) | WP1.18 rokovi i „Moj rad” (izvođenje stavki u domeni, zajedničke definicije s portfeljem, obavijesti s RLS-om po korisniku i upisom u transakciji događaja, osobni kalendar iCalendar s tokenom i zaštitama, zvonce, stranica Moj rad, kartica kalendara, demo i scenarij; 13 novih API testova + RLS, 18 domena, e2e +1 korak; feed provjeren Python icalendarom, Caddy filtar provjeren u Dockeru); v0.30.0 | 0 / 2 (PyPI icalendar i slika caddy:2-alpine – samo za provjeru) | 0 | H | |
| 2026-11-17 | 16 (podagent) | WP1.17 uvoz postojećeg projekta iz Excela (vlastiti čitač ZIP/XML/XLSX/CSV s granicama, predložak po projektu, pregled i potvrda istih bajtova, troškovi potraživani izvan sustava kroz ostvareno/ZNS/portfelj/paket, povijest i poništavanje, kartica Uvoz, demo DIGI-ARHIV i primjer radne knjige; stvarne datoteke iz LibreOfficea i openpyxl-a; 29 novih API testova, 12 domena, e2e +1 korak); v0.29.0 | 0 / 0 | 0 | H | |
| 2026-11-17 | 15 (podagent) | WP1.20 S3 pohrana dokumenata i kopije izvan poslužitelja (vlastiti SigV4 klijent s provjerom prema objavljenim primjerima AWS-a, S3 izvedba pohrane, `documents verify/migrate`, šifriranje kopija AES-256-GCM u odsječcima, servis `offsite`, `restore.sh`, MinIO u CI-ju, 51 novi API test; proba obnove u Dockeru u tri varijante s mjerenjem); v0.28.0 | 0 / 3 (AWS dokumentacija nedostupna, vektori iz aws-c-auth i GitHub pretrage) | 0 | H | |
| 2026-11-17 | 14 (podagent) | WP1.19 sigurnosne dorade prije penetracijskog testa (skrivanje iznosa troškova osoblja u API-ju, izvozu i odluci; obvezni MFA s ograničenim stanjem i sučeljem; obavezna revizija i utrka prvog proračuna; zapis neuspjele prijave; strujanje i ograničenje izvoza; pregled rubne površine s ispravcima; opseg testa za izvođača; 20 novih API testova, e2e +3 koraka); v0.27.0 | 0 / 0 | 0 | H | |
| 2026-11-17 | 13 (podagent) | WP1.14b dorade prije pilota (revizija retka i obavijest o sukobu, stranica Revizija s CSV-om i skrivanjem plaća, četiri oka, voditelj vlastite prijave s razvrstavanjem ruta, valjanost paketa i odstupanja, „danas” po zoni, migracija 0023, demo, e2e, snimke u pregledniku); točka zaustavljanja; v0.25.0 | 0 / 0 | 0 | H | |
| 2026-11-17 | 12 (podagent) | WP1.16b ZNS paket za predaju (vlastiti ZIP i XLSX pisač s testovima, izvoz s provjerom SHA-256 i strujanjem, evidencije rada za potpis, troškovi iz ranijih razdoblja, mjerenje pripreme i izvještaj uštede, demo, e2e, provjera paketa openpyxl/LibreOffice/Playwright PDF); v0.24.0 | 0 / 0 | 0 | H | |
| 2026-11-17 | 11 (podagent) | WP1.16a ZNS – ispravnost (domena: popis za provjeru, odluka po trošku, isplata; migracije 0020/0021 s okidačem; API, web, demo priča, e2e, snimke zaslona); v0.23.0 | 0 / 0 | 0 | H | |
| 2026-11-17 | 10 (podagent) | WP1.15 portfelj (API agregat, domena s testovima, stranica Portfelj, demo signali, scenarij, e2e, snimke zaslona u pregledniku); v0.22.0 | 0 / 0 | 0 | H | |
| 2026-11-17 | 9 (podagent) | WP1.14 pristup po projektu (guard s razvrstavanjem ruta, dokumenti, plaće, samoodobrenje, upravljanje pristupom, web Pristup/Korisnici, test izolacije i pokrivenosti ruta, demo, dokumentacija); v0.21.0 | 0 / 0 | 0 | H | |
| 2026-11-17 | 8 (podagent) | WP1.13 demo okruženje (seeder kroz API, Docker skripte, scenarij, testovi); v0.20.0 | 0 / 0 | 0 | H | |
| 2026-11-16 | 7 (ručno) | WP1.12 uvoz poziva s F&T (domena, uvoz, radar, e2e); v0.19.0 | 0 / 14 (javni API portala) | 0 | H | |
| 2026-11-16 | 6 (ručno) | WP1.11 dokumenti (API, web, e2e, kopije); v0.18.0 | 0 / 0 | 0 | H | |
| 2026-11-16 | 5 (nastavak 3) | WP1.5 prijave (API, web, e2e); v0.17.0 | 0 / 0 | 0 | H | |
| 2026-11-16 | 5 (nastavak 2) | WP1.4 radar poziva (API, web, e2e); v0.16.0 | 0 / 0 | 0 | H | |
| 2026-11-16 | 5 (nastavak) | sučelje za pakete po pozivu, ispravak nasljeđivanja, e2e; v0.15.0 | 0 / 0 | 0 | H | |
| 2026-11-16 | 5 (ručno) | WP1.2b sesije, MFA, politika lozinki, korisnici u sučelju; nadogradnja ovisnosti; v0.14.0 | 0 / 0 | 0 | H | |
| 2026-11-10 | 4 (nastavak 3) | objava paketa HE/NPOO; WP1.9 Docker, compose, sigurnost, upute; e2e nad kontejnerom; v0.13.0 | 2 / 4 (3 neuspjela: 403, 503, 429) | 0 | H | |
| 2026-11-10 | 4 (nastavak 2) | WP1.10 web sučelje (8 ekrana), e2e u pregledniku; v0.12.0 | 0 / 0 | 0 | H | |
| 2026-11-10 | 4 (nastavak) | WP1.8 tim, timesheetovi, troškovi, ZNS; 78 testova; v0.11.0 | 0 / 0 | 0 | H | |
| 2026-11-10 | 4 (ručno) | WP1.7 provedba i proračun projekta; 62 testa; v0.10.0 | 0 / 0 | 0 | H | |
| 2026-11-09 | 3 (nastavak 8) | spajanje PR #2/#3; WP1.6 projekti, organizacije, razdoblja; 48 testova; v0.9.0 | 0 / 0 | 0 | H | |
| 2026-11-09 | 3 (nastavak 7) | CI popravak; WP1.3 paketi u bazi, nasljeđivanje, ESLint; 30 testova; v0.8.0 | 0 / 0 | 0 | H | |
| 2026-11-09 | 3 (nastavak 6) | WP1.2 Drizzle, RLS, identitet, revizija; lokalni PostgreSQL za testove; 22 testa; v0.7.0 | 0 / 0 | 0 | H | |
| 2026-11-09 | 3 (nastavak 5) | spajanje PR #1; WP1.1 monorepo (api, web, domain, CI, compose), 10 testova, v0.6.0 | 0 / 0 | 0 | H | |
| 2026-11-09 | 3 (nastavak 4) | WP0.6b istraživanje tržišta, WP0.7 cijene i go/no-go, ADR-0007, v0.5.0 | 8 / 4 (3 neuspjela: EK profili 404, PDF ručno izvučen) | 0 | M | |
| 2026-11-09 | 3 (nastavak 3) | priprema WP0.2 (prijedlog sugovornika, pozivna poruka) i WP0.6 (scenarij demo, sinteza), v0.4.1 | 0 / 0 | 0 | L | |
| 2026-11-09 | 3 (nastavak 2) | WP0.5 prototip (318 redaka HTML/JS) + automatski test toka u Chromiumu, `verzija.cmd`/`verzija.py`, v0.4.0 | 0 / 0 | 0 | H | |

Tjedni zbroj (tjedan od 2026-11-08): 5 sesija (jedna duga s tri nastavka), od toga 4 u jednom danu; jedna težine H. Preporuka: do kraja tjedna samo zakazane sesije (jedna dnevno).
