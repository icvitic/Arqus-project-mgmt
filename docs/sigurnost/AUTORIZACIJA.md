# Autorizacija: pristup po projektu (WP1.14, v0.21.0; WP1.14b, v0.25.0)

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

**Radnje institucije** – novi projekt, ugovaranje prijave u projekt, korisnici i uloge, paketi programa (izmjene), organizacije (izmjene), radar poziva, nova prijava, predaja i ishod prijave, promjena voditelja prijave, revizijski zapis – traže dozvolu **na razini institucije**; uloga na projektu za njih ne vrijedi.

**Voditelj prijave (WP1.14b).** Korisnik upisan kao voditelj prijave (`proposals.lead_user_id`) na **toj prijavi** ima implicitne dozvole `proposals:read`, `proposals:write`, `documents:read` i `documents:write`, i bez ikakve uloge: čita prijavu, uređuje pripremu (osnovni podaci osim voditelja, konzorcij, radni paketi, proračun i njegovo zaključavanje, dokumenti prijave) i premješta je u pripremu i na internu provjeru (i natrag). Na popisu prijava i u pregledu prijava na portfelju vidi samo vlastite prijave. Tuđa prijava ponaša se kao nepostojeća (**404**). Nova prijava, promjena voditelja, povlačenje, prijelaz u evaluaciju, predaja, ishod, ugovaranje i povjerljivi dokumenti prijave ostaju radnje institucije. Popis prijava kojima je korisnik voditelj računa se pri svakom zahtjevu (`RequestContext.leadProposals`), pa promjena voditelja vrijedi odmah. Za referentne podatke koje zasloni prijave trebaju (`GET /api/organisations…`, `GET /api/programme-packages…`) i za rute dokumenata voditelj prijave prolazi provjeru „bilo koji opseg”; servis dokumenata zatim provjerava upravo tu prijavu.

## 2. Provedba

Središnje mjesto je `apps/api/src/common/access.ts` (`canOnProject`, `canSeeProject`, `assertProjectPermission`, `projectsWith`; za prijave `canOnProposal`, `canSeeProposal`, `assertProposalPermission`). Koriste ga:

1. **AuthGuard** (`apps/api/src/identity/auth.guard.ts`). Svaka ruta mora imati **točno jednu** oznaku; ruta bez oznake se odbija za sve (403) – sigurno prema zadanome:

   | Oznaka | Značenje |
   | --- | --- |
   | `@Public()` | bez prijave (`/health`, `/health/ready`, `/auth/login`) |
   | `@Authenticated()` | samo valjana prijava (`/me`, vlastiti račun, odjava) |
   | `@RequirePermission(p)` | radnja institucije – dozvola na razini institucije |
   | `@ProjectPermission(p)` | projekt u putanji (`:id`) – guard provjerava dozvolu na tom projektu prije ulaska u handler |
   | `@ResolvesProject(p)` | entitet projekta bez projekta u putanji (dokumenti) – guard traži dozvolu u bilo kojem opsegu, servis razrješava vlasnika i provjerava upravo taj projekt |
   | `@AnyScope(p)` | popisi i referentni podaci – dozvola na razini institucije ili na barem jednom projektu (za referentne podatke i dokumente: ili voditelj barem jedne prijave); servis vraća samo dopušteno |
   | `@ProposalPermission(p)` | WP1.14b: prijava u putanji (`:id`) – dozvola na razini institucije ili voditelj te prijave (samo dozvole voditelja); nevidljiva prijava → 404, vidljiva bez dozvole → 403. Bez parametra (popis): institucija ili voditelj barem jedne prijave, servis filtrira |

2. **`loadProject`** (druga linija obrane): u zahtjevu korisnika projekt bez pristupa je 404 i kad bi ruta zaboravila provjeru. Isto vrijedi za prijavu (`ProposalsService.row`).
3. **Servisi** za pravila koja ovise o podacima: dokumenti (vlasnik, povjerljivost), plaće, samoodobrenje, upravljanje pristupom.

**Test pokrivenosti ruta** (`apps/api/test/route-coverage.e2e.test.ts`) popisuje sve rute registrirane u aplikaciji (i provjerava da se popis poklapa s Expressom) i pada ako je ijedna nerazvrstana. Za svaku projektnu rutu automatski poziva id-jeve projekta B kao korisnik s ulogom samo na projektu A i traži 404; za svaku rutu dokumenata isto s dokumentom/entitetom projekta B; za svaku rutu prijave (WP1.14b) traži 404 za tuđu prijavu kao voditelj druge prijave, voditelj projekta i član tima, a 200 za GET vlastite prijave; za svaku rutu institucije traži 403. Rute prijave s `:id` smiju biti samo „prijava” ili „institucija”, a od ruta prijave samo nova prijava, predaja, ishod i ugovaranje su radnje institucije. Nova ruta tako ne može tiho preskočiti autorizaciju.

### Rute po vrsti

- **Projektne** (`@ProjectPermission`, sve pod `/api/projects/:id`): projekt (detalj, izmjena, partneri, prijelaz statusa), struktura (radni paketi, zadaci, isporuke, prekretnice, rizici), proračun, tim i članovi tima, timesheetovi (unos, predaja, odobrenje, povrat), troškovi, ugovoreno/ostvareno, zahtjevi za nadoknadu (stvaranje, predaja, odluka, isplata), pristup projektu (`/access`). WP1.16b: `GET …/claims/:cid/export` (paket za predaju, `finance:read`), `PUT …/claims/:cid/earlier-expenses` i `PUT …/claims/:cid/preparation-hours` (`finance:write`), `GET …/team/:mid/timesheets/:month/record` (evidencija za ispis, `timesheets:read`). Entitet iz putanje (`wpId`, `taskId`, `mid`, `eid`, `cid` …) uvijek se traži zajedno s projektom iz putanje, pa id s drugog projekta daje 404; id-jevi u tijelu (partner, radni paket) provjeravaju se prema istom projektu.
- **Razriješene u servisu** (`@ResolvesProject`): sve rute `/api/documents`. Za dokument se čita vlasnik (projekt ili prijava); za prijenos i popis entitet (`project`, `expense`, `deliverable`, `claim`, `proposal`). Svaki navedeni opseg u upitu mora biti dopušten (tuđi id u kombinaciji s vlastitim projektom ne prolazi tiho). Dokumenti prijave traže `documents:*` i `proposals:read`/`proposals:write` na razini institucije.
- **Bilo koji opseg** (`@AnyScope`): `GET /api/projects` (filtriran: svi projekti uz `projects:read` institucije, inače samo projekti s dodjelom), `GET /api/portfolio` (vidi odj. 4 – Portfelj), `GET /api/organisations[/:id]` i `GET /api/programme-packages…` (referentni podaci potrebni za rad na projektu: partneri, kategorije troškova; izmjene su radnja institucije).
- **Prijava** (`@ProposalPermission`, WP1.14b): `GET /api/proposals` (popis, filtriran), `GET|PATCH /api/proposals/:id`, članovi, radni paketi, `PUT …/budget/lines`, `POST …/budget/lock|unlock`, `POST …/transition` (voditelj samo u pripremu i internu provjeru; servis provjerava). U `PATCH` promjenu `leadUserId` smije samo `proposals:write` institucije.
- **Institucija** (`@RequirePermission`): `GET /api/portfolio/claim-savings` (`portfolio:read`), `PUT /api/portfolio/claim-savings/baseline` (`tenant:write`), korisnici, uloge, revizija (`GET /api/audit`, `GET /api/audit/facets`, `GET /api/audit/export.csv` – `audit:read`), paketi (izmjene, provjera), organizacije (izmjene), radar poziva, `POST /api/proposals`, `POST /api/calls/:callId/proposal`, `POST /api/proposals/:id/submit|outcome`, `POST /api/projects`, ugovaranje prijave (`projects:write` i `proposals:read` institucije).

## 3. Uloge i dozvole

Sistemske uloge definirane su u `apps/api/src/identity/permissions.ts`; pri svakom pokretanju kontejnera (`cli.js init` / `migrate`) usklađuju se s bazom, pa postojeća instalacija preuzima promjene dozvola. ● = dozvola uloge (vrijedi ondje gdje je uloga dodijeljena – na instituciji ili na projektu).

| Dozvola | tenant-admin | project-office | project-manager | team-member | finance | reader |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `tenant:read` | ● | ● |  |  |  |  |
| `tenant:write` | ● | ● |  |  |  |  |
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

`portfolio:read` postoji od WP1.2, a koristi se od v0.22.0 (portfelj, odj. 4).

Promjene u v0.25.0 (WP1.14b): dozvole uloga se ne mijenjaju. Novo: implicitne dozvole voditelja prijave na vlastitoj prijavi (odj. 1); `audit:read` otvara stranicu **Revizija** (iznosi plaća u njoj samo uz `personnel:read` institucije, odj. 4); jedinstvenost dodjele uloge u bazi.

Promjene u v0.24.0: ured za projekte dobiva `tenant:write` (postavke institucije – zasad samo polazna mjera „sati po ZNS-u prije ArQusa”).

Promjene u v0.21.0: nova dozvola `documents:confidential` (administrator, ured za projekte, voditelj projekta, financije); financije dobivaju `documents:write` (prilaganje dokaza uz trošak).

## 4. Posebna pravila

- **Tko dobiva pristup novom projektu.** Korisnik imenovan za voditelja pri stvaranju projekta, ugovaranju prijave (nositelj prijave) ili promjeni voditelja dobiva ulogu voditelja projekta na tom projektu, osim ako već ima `projects:write` na razini institucije. Član tima povezan s korisničkim računom dobiva ulogu člana tima na projektu ako tamo još nema dodjelu (i ako mu ona išta dodaje).
- **Upravljanje pristupom** (`/api/projects/:id/access`, kartica „Pristup” na projektu, izbornik Korisnici): smije administrator korisnika (`users:write` institucije) ili tko ima `projects:write` na projektu. Bez `users:write` dodijeliti ili oduzeti se može samo uloga čije sve dozvole dodjeljivač i sam ima na tom projektu (voditelj ne može nikome, ni sebi, dati ulogu s `personnel:read` ili `*`). Dodjela s jednog projekta ne može se opozvati kroz putanju drugog. Zaštita „barem jedan aktivni administrator institucije” odnosi se na uloge institucije i ostaje.
- **Plaće.** Godišnji trošak člana tima čita se, upisuje i mijenja samo uz `personnel:read` na tom projektu. Voditelj bez te dozvole dodaje člana tima bez troška; financije ili ured upisuju ga poslije (`PATCH /team/:mid`). Timesheet člana bez upisanog troška ne može se odobriti (409).
- **Nema samoodobrenja.** Nitko ne odobrava timesheet člana tima povezanog s vlastitim računom, bez obzira na ulogu (403).
- **Četiri oka (WP1.14b).** Tko je predao timesheet (`timesheets.submitted_by`), ne smije ga odobriti (403) – ni kad je kao voditelj unio i predao sate člana tima bez korisničkog računa; odobrava drugi korisnik s `timesheets:approve` na tom projektu. Predan timesheet bez zabilježenog predavatelja (stariji od migracije 0023 i bez revizijskog zapisa predaje) ne odobrava se (409) dok se ne vrati u nacrt i ponovno preda. Povrat u nacrt briše predavatelja.
- **Revizija (WP1.14b).** `GET /api/audit` (filtri `from`, `to` – kalendarski dani u zoni institucije, `actorId`, `entity`, `entityId`, `action`; keyset paginacija `before`, najnoviji prvi), `GET /api/audit/facets`, `GET /api/audit/export.csv` (filtrirani rezultat, UTF-8 s BOM-om, separator `;`, zaštita od CSV injekcije, najviše 50.000 redaka). Sve uz `audit:read` institucije. Čitanje se ne revidira, izvoz se revidira (`audit.export` s filtrima i brojem redaka). **Plaće:** godišnji trošak člana tima (od v0.25.0 bilježi se s iznosom, prije `***`) i iz njega izvedeni iznosi – trošak osoblja po radnom paketu u odobrenju timesheeta, iznos i priznati iznos troška osoblja, umanjenja troškova osoblja u odluci o ZNS-u – bez `personnel:read` institucije prikazuju se kao `[skriveno]` (i u CSV-u); zapis nosi oznaku `redacted`. **Tajne:** ključevi koji nose lozinke, hasheve, MFA tajne, tokene ili ključeve uklanjaju se pri upisu u reviziju (`AuditService.record` → `scrubSecrets`) i još jednom pri čitanju; provjereno da postojeći zapisi tajne ne sadrže.
- **Zaštita od tihog prepisivanja (WP1.14b).** Cjelobrojna revizija (`revision`) na projektu, proračunu projekta, prijavi, timesheetu i ZNS-u raste pri svakoj izmjeni. Spremanje koje šalje `revision` provjerava je uz zaključavanje retka; razlika → 409 `{ code: 'revision_conflict', conflict: { expected, current, updatedAt, updatedBy } }` i ništa se ne zapisuje. Klijent koji reviziju ne šalje (skripte, stariji klijenti) sprema bez provjere – sučelje je šalje uvijek.
- **Portfelj** (`GET /api/portfolio`, WP1.15, v0.22.0). Dostupan svakome tko vidi barem jedan projekt. Uz `portfolio:read` **na razini institucije** (administrator, ured za projekte, financije, uprava/čitatelj) vidi sve projekte i sve dijelove: iznose, opterećenje ljudi, prijave i rokove poziva – i kad uloga inače nema `timesheets:read`, `proposals:read` ili `calls:read` (portfelj je zbirni prikaz za upravu; satnice i plaće se ne prikazuju, samo sati). Bez toga: samo projekti s `projects:read`; iznosi, troškovi bez dokaza i razdoblja bez ZNS-a samo za projekte s `finance:read`; broj timesheetova na odobrenju uz `timesheets:read`; **opterećenje ljudi** samo uz `projects:read` i `timesheets:read` institucije (inače bi otkrilo sate na tuđim projektima); prijave uz `proposals:read` institucije, rokovi poziva uz `calls:read` institucije. Uloga na projektu (i projektni `portfolio:read`) ne otvara podatke institucije. Troškovi bez dokaza broje se po pravilu povjerljivih dokumenata (trošak samo s povjerljivim dokazom bez `documents:confidential` je trošak bez dokaza). Test: `apps/api/test/portfolio.e2e.test.ts`.
- **Paket ZNS-a za predaju** (WP1.16b): `finance:read` na projektu. Povjerljivi dokazi uključeni su samo uz `documents:confidential` na projektu; inače su u manifestu navedeni kao izostavljeni, bez naziva i sadržaja. Stopa troška osoblja u radnoj knjizi samo uz `personnel:read` (iznos i sati vidljivi su kao i na zahtjevu). Mjera „broj dokaza” na zahtjevu i u izvještaju o uštedi broji i povjerljive dokaze (samo zbroj, bez naziva). Svaki izvoz i neuspjela provjera cjelovitosti u reviziji. **Ušteda na ZNS-u** – samo uz `portfolio:read` institucije (obuhvaća sve projekte).
- **Povjerljivi dokumenti** (`confidentiality = 'confidential'`) vidljivi su samo uz `documents:confidential` na tom opsegu. Ostali ih ne vide u popisima ni u brojanju dokaza (troškovi, ZNS – trošak s povjerljivim dokazom izgleda kao trošak bez dokaza), a izravan pristup i preuzimanje daju 404. Označiti dokument povjerljivim može samo tko ima tu dozvolu.

## 5. Nadogradnja postojeće instalacije

- Dodjele koje već postoje imaju `project_id = NULL` i ostaju na razini institucije – ništa se ne sužava samo od sebe. Nakon nadogradnje administrator u izborniku **Korisnici** treba voditeljima i članovima tima zamijeniti ulogu institucije ulogom na projektu.
- Migracija 0019: strani ključ dodjele na projekt istog stanara (brisanje projekta briše dodjele), indeks po projektu, `team_members.annual_cost_cents` smije biti prazan.

## 6. Poznata ograničenja

- **Prijave.** Od v0.25.0 voditelj prijave radi na vlastitoj prijavi (odj. 1); ostali sudionici pripreme (npr. suradnik koji nije voditelj) i dalje trebaju ulogu institucije. Dodjela uloga po prijavi nije napravljena.
- **Izvedeni podaci o plaći.** Troškovi osoblja nastali odobrenjem timesheeta (iznos i sati po mjesecu) vidljivi su uz `finance:read` na projektu, pa se iz njih može izračunati satnica. Član tima zato nema `finance:read` (ne vidi proračun, troškove ni ZNS); voditelj projekta i čitatelj ih vide. Skrivanje iznosa troškova osoblja bez `personnel:read` – sljedeći paket.
- **Bez politika po projektu u bazi.** RLS izolira stanare; izolacija projekata unutar stanara provodi se u aplikaciji (guard, servisi, `loadProject`). Politike po projektu u bazi – WP1.14b ili kasnije.
- **Referentni podaci.** Korisnik s ulogom samo na projektu vidi popis organizacija i paketa programa institucije (ne i projekte drugih).
- **Popis korisnika.** Tko upravlja pristupom projektu (voditelj) vidi imena i e-adrese aktivnih korisnika institucije (za dodjelu i povezivanje člana tima).
- **Revizijski zapis** (`/api/audit`) je radnja institucije; pregled u sučelju (stranica Revizija) od v0.25.0. Prikazuje i imena korisnika koji se pojavljuju u reviziji (i bez `users:read`). Iznosi troškova osoblja u **zbrojevima** (proračun i odluka o ZNS-u po kategoriji) nisu skriveni – kao i na kartici ZNS-a uz `finance:read`.
- **Revizija spremanja nije obavezna u API-ju.** Bez polja `revision` spremanje prolazi bez provjere (kompatibilnost s postojećim klijentima i skriptama).
- **Uloga bez `projects:read`.** Vlastita uloga stanara s dozvolama na projektu, ali bez `projects:read`, ne otvara projekt (404) – sistemske uloge to nemaju.
