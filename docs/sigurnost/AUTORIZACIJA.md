# Autorizacija: pristup po projektu (WP1.14, v0.21.0)

Ovaj dokument opisuje tko što smije u ArQus Projektima: model dodjela, kako se provjerava na poslužitelju, matricu uloga i dozvola, koje su rute vezane uz projekt i poznata ograničenja. Izolacija između institucija (stanara) je zasebna razina – RLS u bazi, vidi `ASVS-L2.md` (V1) – i ovdje se podrazumijeva.

## 1. Model

**Dvije vrste dodjele uloge** (`role_assignments`):

| Dodjela | `project_id` | Vrijedi za |
| --- | --- | --- |
| na razini institucije | `NULL` | sve projekte institucije i radnje institucije |
| na projektu | id projekta | samo taj projekt |

Svaka uloga može se dodijeliti na oba načina. Sučelje zadano dodjeljuje „projektne” uloge (voditelj projekta, član tima) na projektu, a ostale na razini institucije (polje `scope` uloge je samo zadani izbor u sučelju).

**Kontekst zahtjeva** (`RequestContext`) pri svakom zahtjevu svježe iz baze (ne iz tokena) nosi `permissions` – dozvole na razini institucije – i `projectPermissions` – mapu id projekta → dozvole. Opoziv uloge zato vrijedi već od idućeg zahtjeva, i bez nove prijave.

**Pravilo za radnju na projektu:** dopuštena je ako korisnik traženu dozvolu ima na razini institucije **ili** na tom projektu. Projekt na kojem korisnik nema `projects:read` ni na jednoj razini ponaša se kao nepostojeći (**404**, ista poruka kao za projekt druge institucije – postojanje se ne otkriva). Vidljiv projekt bez tražene dozvole daje **403**.

**Radnje institucije** – novi projekt, ugovaranje prijave u projekt, korisnici i uloge, paketi programa (izmjene), organizacije (izmjene), radar poziva, prijave, revizijski zapis – traže dozvolu **na razini institucije**; uloga na projektu za njih ne vrijedi.

## 2. Provedba

Središnje mjesto je `apps/api/src/common/access.ts` (`canOnProject`, `canSeeProject`, `assertProjectPermission`, `projectsWith`). Koriste ga:

1. **AuthGuard** (`apps/api/src/identity/auth.guard.ts`). Svaka ruta mora imati **točno jednu** oznaku; ruta bez oznake se odbija za sve (403) – sigurno prema zadanome:

   | Oznaka | Značenje |
   | --- | --- |
   | `@Public()` | bez prijave (`/health`, `/health/ready`, `/auth/login`) |
   | `@Authenticated()` | samo valjana prijava (`/me`, vlastiti račun, odjava) |
   | `@RequirePermission(p)` | radnja institucije – dozvola na razini institucije |
   | `@ProjectPermission(p)` | projekt u putanji (`:id`) – guard provjerava dozvolu na tom projektu prije ulaska u handler |
   | `@ResolvesProject(p)` | entitet projekta bez projekta u putanji (dokumenti) – guard traži dozvolu u bilo kojem opsegu, servis razrješava vlasnika i provjerava upravo taj projekt |
   | `@AnyScope(p)` | popisi i referentni podaci – dozvola na razini institucije ili na barem jednom projektu; servis vraća samo dopušteno |

2. **`loadProject`** (druga linija obrane): u zahtjevu korisnika projekt bez pristupa je 404 i kad bi ruta zaboravila provjeru.
3. **Servisi** za pravila koja ovise o podacima: dokumenti (vlasnik, povjerljivost), plaće, samoodobrenje, upravljanje pristupom.

**Test pokrivenosti ruta** (`apps/api/test/route-coverage.e2e.test.ts`) popisuje sve rute registrirane u aplikaciji (i provjerava da se popis poklapa s Expressom) i pada ako je ijedna nerazvrstana. Za svaku projektnu rutu automatski poziva id-jeve projekta B kao korisnik s ulogom samo na projektu A i traži 404; za svaku rutu dokumenata isto s dokumentom/entitetom projekta B; za svaku rutu institucije traži 403. Nova ruta tako ne može tiho preskočiti autorizaciju.

### Rute po vrsti

- **Projektne** (`@ProjectPermission`, sve pod `/api/projects/:id`): projekt (detalj, izmjena, partneri, prijelaz statusa), struktura (radni paketi, zadaci, isporuke, prekretnice, rizici), proračun, tim i članovi tima, timesheetovi (unos, predaja, odobrenje, povrat), troškovi, ugovoreno/ostvareno, zahtjevi za nadoknadu (stvaranje, predaja, odluka, isplata), pristup projektu (`/access`). Entitet iz putanje (`wpId`, `taskId`, `mid`, `eid`, `cid` …) uvijek se traži zajedno s projektom iz putanje, pa id s drugog projekta daje 404; id-jevi u tijelu (partner, radni paket) provjeravaju se prema istom projektu.
- **Razriješene u servisu** (`@ResolvesProject`): sve rute `/api/documents`. Za dokument se čita vlasnik (projekt ili prijava); za prijenos i popis entitet (`project`, `expense`, `deliverable`, `claim`, `proposal`). Svaki navedeni opseg u upitu mora biti dopušten (tuđi id u kombinaciji s vlastitim projektom ne prolazi tiho). Dokumenti prijave traže `documents:*` i `proposals:read`/`proposals:write` na razini institucije.
- **Bilo koji opseg** (`@AnyScope`): `GET /api/projects` (filtriran: svi projekti uz `projects:read` institucije, inače samo projekti s dodjelom), `GET /api/organisations[/:id]` i `GET /api/programme-packages…` (referentni podaci potrebni za rad na projektu: partneri, kategorije troškova; izmjene su radnja institucije).
- **Institucija** (`@RequirePermission`): korisnici, uloge, revizija, paketi (izmjene, provjera), organizacije (izmjene), radar poziva, prijave, `POST /api/projects`, ugovaranje prijave (`projects:write` i `proposals:read` institucije).

## 3. Uloge i dozvole

Sistemske uloge definirane su u `apps/api/src/identity/permissions.ts`; pri svakom pokretanju kontejnera (`cli.js init` / `migrate`) usklađuju se s bazom, pa postojeća instalacija preuzima promjene dozvola. ● = dozvola uloge (vrijedi ondje gdje je uloga dodijeljena – na instituciji ili na projektu).

| Dozvola | tenant-admin | project-office | project-manager | team-member | finance | reader |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `tenant:read` | ● | ● |  |  |  |  |
| `tenant:write` | ● |  |  |  |  |  |
| `users:read` | ● | ● |  |  |  |  |
| `users:write` | ● |  |  |  |  |  |
| `roles:read` | ● | ● |  |  |  |  |
| `roles:write` | ● |  |  |  |  |  |
| `audit:read` | ● | ● |  |  |  |  |
| `packages:read` | ● | ● | ● | ● | ● | ● |
| `packages:write` | ● | ● |  |  |  |  |
| `organisations:read` | ● | ● | ● | ● | ● | ● |
| `organisations:write` | ● | ● | ● |  |  |  |
| `calls:read` | ● | ● | ● |  |  | ● |
| `calls:write` | ● | ● |  |  |  |  |
| `proposals:read` | ● | ● | ● |  |  | ● |
| `proposals:write` | ● | ● | ● |  |  |  |
| `projects:read` | ● | ● | ● | ● | ● | ● |
| `projects:write` | ● | ● | ● |  |  |  |
| `finance:read` | ● | ● | ● | – | ● | ● |
| `finance:write` | ● | ● | ● |  | ● |  |
| `timesheets:read` | ● | ● | ● | ● | ● |  |
| `timesheets:write` | ● | ● | ● | ● |  |  |
| `timesheets:approve` | ● | ● | ● |  |  |  |
| `personnel:read` | ● | ● |  |  | ● |  |
| `reports:read` | ● | ● | ● |  | ● | ● |
| `reports:write` | ● | ● | ● |  |  |  |
| `documents:read` | ● | ● | ● | ● | ● |  |
| `documents:write` | ● | ● | ● | ● | ● |  |
| `documents:confidential` | ● | ● | ● |  | ● |  |
| `portfolio:read` | ● | ● |  |  | ● | ● |

Promjene u v0.21.0: nova dozvola `documents:confidential` (administrator, ured za projekte, voditelj projekta, financije); financije dobivaju `documents:write` (prilaganje dokaza uz trošak).

## 4. Posebna pravila

- **Tko dobiva pristup novom projektu.** Korisnik imenovan za voditelja pri stvaranju projekta, ugovaranju prijave (nositelj prijave) ili promjeni voditelja dobiva ulogu voditelja projekta na tom projektu, osim ako već ima `projects:write` na razini institucije. Član tima povezan s korisničkim računom dobiva ulogu člana tima na projektu ako tamo još nema dodjelu (i ako mu ona išta dodaje).
- **Upravljanje pristupom** (`/api/projects/:id/access`, kartica „Pristup” na projektu, izbornik Korisnici): smije administrator korisnika (`users:write` institucije) ili tko ima `projects:write` na projektu. Bez `users:write` dodijeliti ili oduzeti se može samo uloga čije sve dozvole dodjeljivač i sam ima na tom projektu (voditelj ne može nikome, ni sebi, dati ulogu s `personnel:read` ili `*`). Dodjela s jednog projekta ne može se opozvati kroz putanju drugog. Zaštita „barem jedan aktivni administrator institucije” odnosi se na uloge institucije i ostaje.
- **Plaće.** Godišnji trošak člana tima čita se, upisuje i mijenja samo uz `personnel:read` na tom projektu. Voditelj bez te dozvole dodaje člana tima bez troška; financije ili ured upisuju ga poslije (`PATCH /team/:mid`). Timesheet člana bez upisanog troška ne može se odobriti (409).
- **Nema samoodobrenja.** Nitko ne odobrava timesheet člana tima povezanog s vlastitim računom, bez obzira na ulogu (403).
- **Povjerljivi dokumenti** (`confidentiality = 'confidential'`) vidljivi su samo uz `documents:confidential` na tom opsegu. Ostali ih ne vide u popisima ni u brojanju dokaza (troškovi, ZNS – trošak s povjerljivim dokazom izgleda kao trošak bez dokaza), a izravan pristup i preuzimanje daju 404. Označiti dokument povjerljivim može samo tko ima tu dozvolu.

## 5. Nadogradnja postojeće instalacije

- Dodjele koje već postoje imaju `project_id = NULL` i ostaju na razini institucije – ništa se ne sužava samo od sebe. Nakon nadogradnje administrator u izborniku **Korisnici** treba voditeljima i članovima tima zamijeniti ulogu institucije ulogom na projektu.
- Migracija 0019: strani ključ dodjele na projekt istog stanara (brisanje projekta briše dodjele), indeks po projektu, `team_members.annual_cost_cents` smije biti prazan.

## 6. Poznata ograničenja

- **Prijave su na razini institucije.** Nositelj prijave bez uloge institucije ne vidi svoju prijavu dok se ne ugovori u projekt; dokumenti prijave isto. Pristup po prijavi je kandidat za kasniji paket.
- **Izvedeni podaci o plaći.** Troškovi osoblja nastali odobrenjem timesheeta (iznos i sati po mjesecu) vidljivi su uz `finance:read` na projektu, pa se iz njih može izračunati satnica. Član tima zato nema `finance:read` (ne vidi proračun, troškove ni ZNS); voditelj projekta i čitatelj ih vide. Skrivanje iznosa troškova osoblja bez `personnel:read` – sljedeći paket.
- **Bez politika po projektu u bazi.** RLS izolira stanare; izolacija projekata unutar stanara provodi se u aplikaciji (guard, servisi, `loadProject`). Politike po projektu u bazi – WP1.14b ili kasnije.
- **Referentni podaci.** Korisnik s ulogom samo na projektu vidi popis organizacija i paketa programa institucije (ne i projekte drugih).
- **Popis korisnika.** Tko upravlja pristupom projektu (voditelj) vidi imena i e-adrese aktivnih korisnika institucije (za dodjelu i povezivanje člana tima).
- **Revizijski zapis** (`/api/audit`) je radnja institucije; pregled u sučelju i zaštita od istovremenog prepisivanja proračuna prebačeni su u **WP1.14b**.
- **Uloga bez `projects:read`.** Vlastita uloga stanara s dozvolama na projektu, ali bez `projects:read`, ne otvara projekt (404) – sistemske uloge to nemaju.
