# Changelog

Format prema [Keep a Changelog](https://keepachangelog.com/hr/1.1.0/), verzije prema [SemVer](https://semver.org/lang/hr/). Do prve komercijalne verzije koristi se 0.x.

## [Unreleased]

## [0.30.1] - 2026-11-18
### Ispravljeno
- **Objava slike (GHCR)**: izgradnja slike za v0.30.0 zaglavila je na `pnpm install` za arm64 pod emulacijom (QEMU) i prekinuta je nakon 6 sati, pa je `latest` ostao na v0.29.0. Faza izgradnje sada radi na arhitekturi stroja koji gradi (`--platform=$BUILDPLATFORM`; produkcijske ovisnosti su čisti JavaScript, a izgradnja staje ako se među njima pojavi izvorni modul), završna faza nema nijedan `RUN` (direktoriji podataka kopiraju se s vlasništvom i pravima), pa emulacija više nije potrebna. Posao objave ima vremensko ograničenje od 30 minuta. Provjereno lokalnom izgradnjom za arm64 i amd64.

## [0.30.0] - 2026-11-17
### Dodano
- WP1.18 **„Moj rad”** (`docs/domena/moj-rad-i-obavijesti.md`): `GET /api/me/work` i stranica **Moj rad** – što čeka korisnika, izvedeno iz trenutnih podataka (ništa se ne sprema), sa stavkom po vrsti, projektu (ili prijavi/pozivu), roku, hitnosti (kasni / uskoro / čeka / za informaciju) i poveznicom na zaslon na kojem se rješava; bez iznosa. Uloga se određuje po projektu: član tima (timesheet tekućeg mjeseca, nepredani raniji mjeseci od ulaska u tim, vraćen timesheet, predan timesheet čeka, rizik kojem je nositelj), odobravatelj (timesheetovi koje smije odobriti – četiri oka), financije (troškovi bez dokaza, nacrt ZNS-a završenog razdoblja s brojem blokada, vraćen ZNS, razdoblje bez ZNS-a, nepredani troškovi iz ranijih razdoblja, odlučen neisplaćen ZNS), voditelj (isporuke i prekretnice koje kasne ili dospijevaju u 30 dana, visoki rizici, odstupanja od pravila programa, rok izvještaja), prijave (interni rok s brojem neispunjenih stavki spremnosti), radar (praćeni poziv bez odluke go/no-go), administrator (računi bez obveznog MFA). Čista funkcija `deriveWorkItems` u domeni; zajedničke definicije s portfeljem u `apps/api/src/portfolio/facts.ts` (portfelj ih sada koristi), blokade ZNS-a istom funkcijom kao popis za provjeru, spremnost istom kao prijava. Ograničen broj upita neovisno o broju projekata.
- **Obavijesti u aplikaciji**: tablica `notifications` (RLS po stanaru za upis, po korisniku za čitanje – `app.user_id`; aplikacija mijenja samo `read_at`), upis u istoj transakciji kao događaj, nikad akteru: timesheet odobren / vraćen, ZNS vraćen (s razlogom) / odlučen / isplaćen (onome tko ga je predao), pristup projektu dodijeljen / oduzet, imenovanje voditeljem projekta ili prijave, uvoz iz Excela primijenjen / poništen (voditelju projekta). `GET /api/me/notifications` (najnovije prve, keyset, broj nepročitanih), `POST /api/me/notifications/:nid/read`, `POST /api/me/notifications/read-all`; pročitane starije od 90 dana brišu se (`NOTIFICATION_RETENTION_DAYS`). Zvonce s brojem nepročitanih i kratkim popisom u zaglavlju.
- **Osobni kalendar rokova** (iCalendar, RFC 5545): `GET /api/calendar/<token>.ics` – jedina nova neprijavljena ruta – s rokovima koje korisnik vidi na portfelju (razdoblja i rokovi ZNS-a, isporuke, prekretnice, rokovi poziva i prijava), stabilni UID-ovi, cjelodnevni događaji, presavijanje na 75 okteta; `GET|POST|DELETE /api/me/calendar` i kartica u **Moj račun** (stvori, kopiraj, ukloni). Token 256 bita, u bazi samo SHA-256, prikazan jednom; isti 404 za nepoznat, opozvan i neispravan token; ograničenje 120 / 10 min po IP-u (`CALENDAR_RATE_MAX`, `CALENDAR_RATE_WINDOW_MINUTES`); tablica `calendar_tokens` (RLS: bez stanara vidljiv samo redak čiji je hash postavljen u transakciji). Generator `packages/domain/src/ical.ts`.
- Opis dnevnog sažetka e-poštom za kad bude SMTP (`docs/domena/moj-rad-i-obavijesti.md`, odj. 4).
- Migracije 0026 (tablice) i 0027 (RLS, `app_current_user()`, ovlasti).
- Testovi: `my-work.e2e.test.ts` (13 – svaka uloga na poznatoj postavi, slaganje s brojkama portfelja, izolacija, četiri oka, broj upita, obavijesti po događaju i samo primatelju, paginacija i brisanje, kalendar s parsiranjem, isti odgovori za nevaljane tokene, deaktivacija, obvezni MFA, ograničenje), `rls.test.ts` (+2), domena `my-work.test.ts` (18), test pokrivenosti ruta (javna ruta kalendara izričito), demo test („Moj rad” i obavijesti svakog računa), e2e u pregledniku (+1 korak).

### Promijenjeno
- **Početna stranica**: uz `portfolio:read` institucije i dalje Portfelj, svi ostali (voditelji, članovi tima) **Moj rad** umjesto popisa projekata; „Moj rad” u izborniku za sve, sa značkom prošlih i bliskih rokova.
- Kartica **Tim i timesheetovi** prima putanju `projekti/<id>/tim/<član>/<mjesec>` (poveznice iz „Moj rad” i obavijesti otvaraju točno taj timesheet).
- Portfelj: rokovi nose stabilan ključ (`key`); `PortfolioService.deadlines` daje sve rokove za kalendar bez računanja novca.
- Deaktivacija korisnika briše i njegovu poveznicu kalendara.
- Caddy (`infra/prod/Caddyfile`) u zapisu pristupa token kalendara zamjenjuje oznakom `[token]`.
- Demo: Marinine sate za prošli mjesec na ZELENI-LAB-u unosi ured (odobrava voditelj Josip); odluku i isplatu ZNS-a 1 upisuje ured (financije dobivaju obavijesti); HRZZ poziv bez odluke s internim rokom za 3 tjedna; Luka je nositelj rizika terenskih mjerenja; starije obavijesti demo korisnika označene pročitanima.

### Ispravljeno
- **„Danas” u pregledniku u zoni institucije**: zadani datumi (odluka i isplata ZNS-a, novi trošak, tekući mjesec timesheeta) računali su se u vremenskoj zoni preglednika, a poslužitelj ih provjerava u zoni institucije – korisnik u drugoj zoni oko ponoći dobio bi prijedlog koji poslužitelj odbija („datum odluke je prije predaje”). Preglednik sada koristi zonu institucije iz `/api/me` (`localToday`, `apps/web/src/lib/claims.ts`), s testom.

## [0.29.0] - 2026-11-17
### Dodano
- WP1.17 **Uvoz postojećeg projekta iz Excela** (`docs/UVOZ-PROJEKTA.md`): kartica **Uvoz** na projektu (i uputa na pregledu novog projekta). `GET /api/projects/:id/import/template` – predložak za projekt izrađen vlastitim XLSX pisačem (list *Upute*, listovi *Radni paketi*, *Isporuke*, *Prekretnice*, *Proračun*, *Tim*, *Troškovi* i *Šifarnik* s partnerima, kategorijama paketa, postojećim radnim paketima, vrstama isporuka i razinama diseminacije; padajući popisi – pisač sada podržava provjeru podataka). `POST …/import/preview` – pregled bez spremanja: po listu pročitani i valjani retci, što će se stvoriti, izmijeniti ili preskočiti, greške (list, redak kao u Excelu, stupac kako ga je korisnik napisao, vrijednost, kako ispraviti) i upozorenja (mogući duplikati, razdoblje s već predanim ZNS-om, razdoblje koje još traje, zamjena nacrta proračuna, prekoračenje proračuna po kategoriji); list se može izričito izostaviti. `POST …/import/confirm` – primjena točno pregledanih bajtova (SHA-256 datoteke, revizija projekta, otisak plana; inače 409), upozorenja izričito potvrđena, sve u jednoj transakciji, jedan revizijski zapis po uvozu. `GET …/imports` i `POST …/imports/:importId/undo` – povijest i poništavanje s popisom prepreka (trošak u ZNS-u, izmijenjen ili s dokazom, radni paket sa zadacima, troškovima ili satima, član tima s timesheetovima, izmijenjen ili zaključan proračun).
- Svaki redak prolazi **ista pravila kao ručni unos**: Zod sheme ruta i domenska pravila, sada zajednička (`expenseRuleIssues`, `monthRangeIssue`, `deliverableCodeIssues` u `packages/domain/src/project-import.ts`; `ExpensesService` i `ImplementationService` ih koriste). Listovi i stupci prepoznaju se po nazivu (hrvatski i engleski, bez obzira na velika slova, dijakritiku, razmake i redoslijed; vlastiti stupci se zanemaruju), redak zaglavlja među prvih 15 redaka. Hrvatski i ISO zapis brojeva i datuma, TOČNO/NETOČNO; datum s kosom crtom odbija se kao nejednoznačan.
- **Troškovi potraživani izvan sustava** (ZNS predan prije ArQusa): status troška `historic` uz oznaku zahtjeva, priznati iznos i razlog umanjenja – računaju se u ostvareno (priznato ili traženo) i u kumulativ prema proračunu u popisu za provjeru ZNS-a, nikad u novi ZNS ni u troškove iz ranijih razdoblja, ne broje se kao trošak bez dokaza; razdoblje s takvim troškom nije „razdoblje bez ZNS-a” u portfelju; označeni u popisu troškova i u *Sažetku* paketa ZNS-a. Nepromjenjivi u bazi osim poništavanjem uvoza (okidač). Troškovi osoblja ranijih razdoblja (`historic_personnel`, po osobi i mjesecu) samo uz `personnel:read`, skriveni ostalima kao trošak iz timesheeta; timesheet za isti mjesec se ne odobrava (409).
- **Vlastiti čitač XLSX i CSV** (`apps/api/src/import/`, bez novih ovisnosti): ZIP (inflate iz `zlib` s granicom izlaza, CRC-32, granice zapisa i veličina, bez ZIP64, šifriranih zapisa i putanja), XML bez DTD-a i vanjskih entiteta, dijeljeni i umetnuti tekst, obogaćeni tekst bez fonetike, spremljene vrijednosti formula (nikad izračun), brojevi, logičke vrijednosti, greške, datumi kao serijski broj u sustavu 1900 (s nepostojećim 29. 2. 1900.) i 1904, ISO datumi, prefiksi imenskog prostora; skriveni listovi samo s nazivom lista predloška; .xls, lozinka, .xlsm i .xlsb odbijeni porukom. Pregled i potvrda ograničeni po korisniku kao skupi izvozi (429 `import_rate_limited`).
- Tablica `project_imports` (RLS, aplikacija bez DELETE); `expenses`: `external_claim`, `team_member_id`, `import_id` (migracije 0024, 0025).
- Demo: treći projekt **DIGI-ARHIV** – u tijeku od 1. 3. 2026., u ArQusu samo osnovni podaci, partner i aktivacija; `docs/primjeri/uvoz-projekta-DIGI-ARHIV.xlsx` (izrađuje `pnpm --filter @arqus/api demo:import-example`, test provjerava da je aktualan) uvozi se uživo – scenarij, korak 8b.
- Testovi: `project-import.e2e.test.ts` (11), `import-reader.test.ts` (17) s datotekama iz LibreOfficea 24.2 i openpyxl-a 3.1.5 u `apps/api/test/fixtures/import/` (skripta za ponovno stvaranje), domena `project-import.test.ts` (12), demo test (uvoz primjera), e2e u pregledniku (uvoz kroz sučelje).
- Strategija, odj. 9: odluka vlasnika – WP1.17 i WP1.18 rade se odmah.

### Promijenjeno
- `ensureTeamMemberAccess` vraća novu dodjelu uloge (uvoz je pamti za poništavanje).
- Ispravak odluke o ZNS-u (okidač) ne smije mijenjati ni nove stupce troška (oznaka zahtjeva, osoba, uvoz).
- Demo: portfelj pokazuje tri projekta u provedbi; do uvoza DIGI-ARHIV-a rok ZNS-a za njegov RP1 je prošli rok.

## [0.28.0] - 2026-11-17
### Dodano
- WP1.20 **S3 pohrana dokumenata** (ADR-0010, dopuna): druga izvedba iza istog ugovora pohrane, odabir `DOCUMENTS_STORAGE=local|s3` (zadano `local` – demo, NAS i testovi bez promjene); varijable `DOCUMENTS_S3_*` (adresa, regija, bucket, ključ, tajna, adresni stil, prefiks ključeva, zaglavlje šifriranja na strani poslužitelja, vremensko ograničenje, ponavljanja). Vlastiti S3 klijent bez novih ovisnosti (`apps/api/src/storage/`): AWS Signature V4 nad Node `crypto` i `fetch`, put (Buffer ili datoteka, tijelo potpisano SHA-256), get kao tok, head, delete, popis s nastavkom; vremensko ograničenje do odgovora i stanke u prijenosu, ograničeno ponavljanje samo idempotentnih operacija. Ista jamstva kao lokalna pohrana: ključ s poslužitelja, objekt vidljiv tek cijeli, veličina i SHA-256 provjereni prije prvog poslanog bajta pri preuzimanju i u paketu ZNS-a (provjera svih dokaza prije slanja sada strujanjem). Nedostupna pohrana → 503 s kratkom porukom, bez konfiguracije u odgovoru.
- **Spremnost** `/api/health/ready` provjerava i pohranu dokumenata (`checks: { database, storage }`; rezultat pohrane pamti se 10 s); 503 „Pohrana dokumenata nije dostupna”.
- **CLI** `documents verify [--quick]` (nedostajuće, oštećene i siročad, izlazni kod 1 kod problema) i `documents migrate --to s3|local|mirror` (kopija s provjerom hasha na izvoru i odredištu, idempotentno i nastavljivo, izvor se ne briše, sukob se ne prepisuje; `mirror` = drugi bucket `DOCUMENTS_MIRROR_S3_*`) – sigurno na živom sustavu.
- **Kopije izvan poslužitelja** (ADR-0012): servis `offsite` (profil `offsite`, slika aplikacije) svakih 15 min šifrira svaku novu kopiju iz volumena `backups` na poslužitelju (AES-256-GCM u odsječcima od 64 KiB, ključ datoteke HKDF iz `BACKUP_ENCRYPTION_KEY`, format `ARQUSBK1`) i šalje u S3 bucket (`BACKUP_S3_*`), briše udaljene kopije starije od 30 dana (nikad najnoviju). Neuspjeh: `[GREŠKA]` u zapisu, izlazni kod 1, stanje u `offsite-status.json`, `backup status` (izlazni kod 1 kad zadnja uspješna kopija ili najnovija kopija baze stariji od 3 h) kao provjera zdravlja servisa. CLI `backup offsite | status | fetch | decrypt | encrypt | key-fingerprint` – dešifriranje samo s ključem.
- **Obnova** `infra/prod/restore.sh`: prazan poslužitelj + bucket + `.env` → baza (pg_restore u jednoj transakciji), dokumenti, pokretanje, `documents verify`. Proba obnove izmjerena: 17 s (demo), 49 s (1,2 GB baze + 1 GB dokumenata), 26 s (dokumenti u S3) – bez instalacije poslužitelja i slike.
- `scripts/minio-test.sh` – MinIO za integracijske testove (lokalno i u CI-ju istom naredbom). Novi testovi: SigV4 prema objavljenim primjerima AWS-a i klijent (vremena, ponavljanje, adrese), šifriranje i sinkronizacija s lažnim satom, zajednički ugovor pohrane za obje izvedbe, API s `DOCUMENTS_STORAGE=s3`, `documents verify/migrate` i kopije nad MinIO-m.
- Dokumentacija: `docs/PILOT-INSTALACIJA.md` (bucketi, ključ za kopije i gdje ga čuvati, prelazak na S3, obnova, mjesečna proba obnove), ADR-0012, ADR-0010 (S3 izvedba), ASVS, opseg penetracijskog testa, usporedba pružatelja.

### Promijenjeno
- Servis `backup` uz `DOCUMENTS_STORAGE=s3` ne radi dnevnu arhivu dokumenata (dokumenti su u bucketu).
- Preuzimanje dokumenta kojemu nedostaje sadržaj u pohrani vraća 500 s jasnom porukom umjesto neobrađene greške; paket ZNS-a pri nedostupnoj pohrani vraća 503 (ne „datoteka nedostaje” i ne zapisuje neuspjeh provjere).
- Demo reset briše dokumente institucije u pohrani koju aplikacija koristi (lokalno ili S3).
- CI: MinIO (`pgsty/minio:RELEASE.2026-08-04T00-00-00Z`) prije `pnpm test`, testovi nad S3 se izvode.

## [0.27.0] - 2026-11-17
### Dodano
- WP1.19 **Plaće se ne mogu izvesti bez prava na plaće**: iznos pripisiv radu jedne osobe – iznos i priznati iznos troška osoblja iz timesheeta (troškovi, ZNS, kandidati iz ranijih razdoblja), trošak osoblja u odgovoru na odobrenje timesheeta, listovi *Troškovi* i *Troškovi osoblja* paketa ZNS-a i kontrolna lista – vraća se samo uz `personnel:read` na projektu; ostali dobivaju sate i `amountHidden: true` (iznos `null`). Skrivanje je u API-ju; sučelje prikazuje „skriveno”. Zbrojevi po kategoriji i projektu ostaju vidljivi; kategorija s jednom osobom je dokumentirano preostalo otkrivanje. Bez `personnel:read` korisnik s `finance:write` odlučuje o zahtjevu i ručnim troškovima, a o pojedinom trošku osoblja ne (403; trošak ostaje priznat kako je zatražen dok ga ne umanje ured ili financije).
- **Obvezni MFA**: postavka institucije `requireMfa` (`none` / `privileged` / `all`); `privileged` obuhvaća svakoga s `users:write`, `tenant:write`, `personnel:read`, `audit:read`, `finance:write` ili `*` na razini institucije. Bez postavljenog MFA prijava vodi u ograničeno stanje (samo vlastiti račun, postavljanje MFA i odjava; ostalo 403 `mfa_setup_required`), provjera pri svakom zahtjevu i za stari token; sučelje odmah otvara postavljanje MFA s objašnjenjem. Postavku mijenja samo administrator (`users:write`) u izborniku **Korisnici**, uz revizijski zapis; tko je postrožuje, mora i sam imati MFA. API: `GET|PUT /api/tenant/security`, `mfa` u `/api/me`, `mfaSetupRequired` u odgovoru prijave, `mfaRequired` u popisu korisnika. Nova produkcijska institucija (`cli.js seed`, `NODE_ENV=production`) zadano `privileged`; postojeće, testne i demo `none`.
- **Opseg penetracijskog testa** za izvođača: `docs/sigurnost/PENTEST-OPSEG.md` (arhitektura i granice povjerenja, opseg, testna instanca i računi po ulozi, model autorizacije, prihvaćena ograničenja, prioriteti testa).
- Ograničenje skupih izvoza po korisniku (CSV revizije, ZIP paketa ZNS-a): 20 u 10 minuta (`EXPORT_RATE_MAX`, `EXPORT_RATE_WINDOW_MINUTES`), inače 429; u memoriji instance.
- Test `apps/api/test/pentest-prep.e2e.test.ts` (20 testova): plaće na svakoj ruti i izvozu, MFA za svaku postavku, obavezna revizija na svih šest ruta, zapis neuspjele prijave, strujanje i ograničenje izvoza, rubna površina. E2e u pregledniku: obvezni MFA (ured u otvorenoj sesiji ide na postavljanje MFA) i troškovi osoblja bez prava na plaće.
- Strategija, odj. 8: rad tijekom točke zaustavljanja – WP1.19 (sigurnosne dorade prije penetracijskog testa) i WP1.20 (S3 pohrana i kopije izvan poslužitelja); nove funkcije i dalje čekaju bilješke s demonstracija.

### Promijenjeno
- **Revizija je obavezna** na svakom spremanju koje je prima (osnovni podaci projekta i prijave, proračun projekta i prijave, timesheet, odabir troškova iz ranijih razdoblja): bez nje 400 „Nedostaje revizija”. Prvo istovremeno spremanje proračuna (i timesheeta) daje `revision_conflict` umjesto generičkog „Zapis s istim ključem već postoji”. Sučelje, demo punjenje i testovi šalju reviziju.
- **Zapis neuspjele prijave** ne čuva upisani tekst: postojeći račun → id računa, nepoznata e-adresa → nepovratni otisak (HMAC s tajnom poslužitelja); isto za neuspio MFA kod. Ograničenje prijava i dalje po računu (ključ je sažetak) i po IP-u.
- **Izvoz revizije u CSV** struji se u stranicama od 1.000 redaka (bez 50.000 redaka u memoriji); broj redaka u zapisu izvoza.
- Prijava: i za nepostojeći račun ili instituciju računa se jedan scrypt (vrijeme odgovora ne otkriva postoji li račun).
- Isključivanje MFA odjavljuje ostale uređaje; isključivanje nije moguće dok ga institucija zahtijeva.
- `/api/health` u produkciji bez verzije i vremena rada; 409 iz baze bez naziva ograničenja; JWT samo HS256.
- Sigurnosna zaglavlja i kratka poruka i na odgovorima 400/413 parsera tijela (neispravan ili prevelik JSON); HTTP postavke u `configureHttp` (`main.ts` i testovi).
- Tekst popisa za provjeru ZNS-a ne sadrži iznos pojedinog troška osoblja.

### Ispravljeno
- `POST /api/programme-packages/:rowId/publish` s id-jem koji nije UUID vraćao je 500 (sada 400).
- Manifest paketa ZNS-a (`sadrzaj.csv`) nije neutralizirao ćelije koje počinju formulom.
- Naziv prenesene datoteke zadržavao je znakove za smjer teksta (npr. U+202E – lažno prikazana vrsta datoteke).

## [0.26.0] - 2026-11-17
### Dodano
- Usporedba EU pružatelja poslužitelja s preporukom (`docs/infrastruktura/usporedba-eu-pruzatelja.md`) – podloga za odluku o pilot-instalaciji i javnoj adresi.
- Demo instanca na Synology NAS-u preko Tailscalea: `infra/nas/docker-compose.yml` (slika iz registra, ključevi instalacije stvaraju se pri prvom pokretanju i ostaju u volumenu) i upute `docs/NAS-INSTALACIJA.md`.
- GitHub Actions „Slika”: objava Docker slike za amd64 i arm64 u GitHub Container Registry (`ghcr.io/icvitic/arqus-project-mgmt`, oznake `latest` i broj verzije) pri svakom spajanju u `main`.

## [0.25.0] - 2026-11-17
### Dodano
- WP1.14b **Bez tihog prepisivanja** (optimistička istovremenost): cjelobrojna revizija retka (`revision`) na projektu, proračunu projekta, prijavi, timesheetu i ZNS-u, raste pri svakoj izmjeni. Spremanje proračuna projekta i prijave, mjesečnog timesheeta, osnovnih podataka projekta i prijave te odabira troškova iz ranijih razdoblja prima `revision`; ako se pohranjena razlikuje, odgovor je 409 (`code: revision_conflict`, tko i kada je promijenio) i ništa se ne zapisuje (provjera uz zaključavanje retka). Sučelje šalje reviziju i na sukob prikazuje obavijest: tko je i kada spremio, učitavanje najnovijeg stanja, popis vlastitih nespremljenih izmjena (polje, tvoj unos, sada spremljeno) i primjena vlastitih izmjena na najnovije stanje.
- **Revizija** – stranica za `audit:read` (administrator, ured za projekte): najnovije prvo, filtri (razdoblje u danima institucije, korisnik, vrsta zapisa, id zapisa, radnja), učitavanje starijih zapisa (keyset), čitljiv prikaz „prije / poslije”, izvoz filtriranog rezultata u CSV (UTF-8 s BOM-om, `;`, zaštita od CSV injekcije). API: `GET /api/audit` (filtri, `before`), `GET /api/audit/facets`, `GET /api/audit/export.csv`. Čitanje se ne revidira, izvoz se revidira.
- **Četiri oka na timesheetovima**: tko je predao timesheet (`submitted_by`), ne odobrava ga – odobrava drugi korisnik s `timesheets:approve` na projektu; sučelje predavatelju ne nudi „Odobri”.
- **Voditelj vlastite prijave**: voditelj prijave bez uloge institucije čita i priprema svoju prijavu (osnovno osim voditelja, konzorcij, radni paketi, proračun, dokumenti, priprema i interna provjera); u popisu prijava i u portfelju vidi samo vlastite. Nova oznaka rute `@ProposalPermission`; tuđa prijava 404; test pokrivenosti ruta provjerava svaku rutu prijave.
- **Valjanost paketa programa**: paket koji još ne vrijedi blokira novi projekt i prijavu (kao zastario); početak izvan razdoblja valjanosti, istekao paket i provjerljiva pravila `validations` (npr. NPOO `project.endDate > 2026-06-30`, udjeli kategorija) daju **odstupanja od pravila programa** na pregledu projekta i prijave i u odgovoru pri stvaranju, računaju se iznova (`packages/domain/src/package-rules.ts`).
- **„Danas” u zoni institucije**: postavka `tenants.settings.timeZone` (zadano Europe/Zagreb); radar (status, „još N dana”, interni rokovi), portfelj, popis za provjeru ZNS-a, datumi odluke i isplate, naziv paketa za predaju i demo računaju kalendarski dan u toj zoni (`packages/domain/src/time.ts`).
- Migracija 0023: revizije, predavatelj timesheeta (dopuna iz revizijskog zapisa), jedinstvenost dodjele uloge (korisnik, uloga, opseg; postojeći duplikati se uklanjaju uz revizijski zapis).
- Demo: voditelji unose sate članova bez računa, ured ih odobrava; Petra Horvat kao voditeljica sama priprema prijavu AQUAREST; promjena plaće u reviziji; ZELENI-LAB kao namjerni primjer odstupanja od pravila programa (RRF krajnji rok). Scenarij: korak „Revizija”.

### Promijenjeno
- Godišnji trošak člana tima bilježi se u reviziji s iznosom (prije `***`); pregled revizije ga i iz njega izvedene troškove osoblja bez `personnel:read` prikazuje kao `[skriveno]`. Tajne se uklanjaju iz revizijskog zapisa pri upisu i prikazu.
- Razvojni seed: oznaka `razvoj` (ne sudara se s demo institucijom), administrator `admin@razvoj.local`, lozinka koja zadovoljava politiku lozinki; administrator se traži samo unutar svog stanara.
- Oznake statusa u rodu imenice (prijava, isporuka, prekretnica: „predana”, „odbijena”, „ostvarena”).
- Dokument koji se više ne mijenja (dokaz troška u predanom ZNS-u, zatvoren projekt, zaključena prijava) nosi razlog (`frozen`); sučelje ne nudi „Ukloni” ni novu verziju.
- Izbornik se na uskom zaslonu prelama bez vodoravnog pomicanja.

### Ispravljeno
- Radar: interni rok u „Nadolazećim rokovima” prikazuje se kao datum (prije se zbog pretvorbe vremena prikazivao kao 01:59 sljedećeg dana).
- Struktura projekta više ne šalje istovremene upite na jednoj transakciji (upozorenje `pg` o istodobnim upitima nestalo iz testova).
- Ista uloga navedena dvaput pri stvaranju korisnika stvara jednu dodjelu.
- Tekući mjesec timesheeta i zadani datum troška u sučelju po lokalnom kalendaru (ne UTC).

## [0.24.1] - 2026-11-17
### Ispravljeno
- Demo okruženje: `demo.cmd` i `scripts/demo.sh` više ne ovise o portu 8080. Ako port nije dostupan (zauzet ili ga je Windows rezervirao – „bind: … forbidden by its access permissions”), skripta redom proba 8081, 8088, 18080 i 28080, zapamti odabrani (`infra/demo/.port`) i ispiše adresu; vlastiti port kroz `ARQUS_DEMO_PORT`. Izgradnja slike odvojena je od pokretanja, pa se greška izgradnje ne miješa s greškom porta.

## [0.24.0] - 2026-11-17
### Dodano
- WP1.16b **ZNS paket za predaju** (`docs/domena/zns-pravila.md`): `GET /api/projects/:id/claims/:cid/export` – jedan ZIP za svaki status (nacrt označen kao NACRT u svakoj generiranoj datoteci): `troskovi.xlsx` (Sažetak po kategorijama paketa s traženim / priznatim / nepriznatim, svi troškovi, troškovi osoblja po osobi i mjesecu s podjelom po radnom paketu), `evidencije-rada/` (mjesečna evidencija za potpis po osobi i mjesecu, jedna stranica A4), `dokazi/` (trenutna verzija, SHA-256 provjeren pri izvozu – neslaganje prekida izvoz), `kontrolna-lista.html` (stanje pri predaji), `sadrzaj.csv` (manifest s veličinama i SHA-256). Strujanje bez otvorene transakcije, granica 500 MiB dokaza, povjerljivi dokazi samo uz `documents:confidential`, svaki izvoz u reviziji.
- Vlastiti ZIP pisač (deflate i CRC-32 iz Node `zlib`) i XLSX pisač (SpreadsheetML) bez novih ovisnosti, s testovima prema neovisnom čitaču, Python `zipfile`/`openpyxl` i `unzip -t`.
- Ispis mjesečne evidencije rada iz kartice „Tim i timesheetovi” (`GET …/team/:mid/timesheets/:month/record`, isti dokument kao u paketu).
- **Troškovi iz ranijih razdoblja**: nepredani trošak datiran u razdoblju čiji je ZNS već predan nacrt kasnijeg razdoblja nudi zasebno i uključuje samo izričitim odabirom (`PUT …/claims/:cid/earlier-expenses`); stavka u popisu za provjeru; oznaka u zahtjevu i paketu; signal na kartici Ugovoreno / ostvareno i u portfelju.
- **Mjerenje pripreme ZNS-a**: automatske mjere na predanom zahtjevu (dani od kraja razdoblja i od otvaranja nacrta do predaje, povrati na dopunu, troškovi, dokazi, timesheetovi); neobavezni „sati utrošeni na pripremu” pri predaji ili naknadno (`PUT …/claims/:cid/preparation-hours`); polazna mjera institucije (`PUT /api/portfolio/claim-savings/baseline`); izvještaj **„Ušteda na ZNS-u”** na portfelju (`GET /api/portfolio/claim-savings`). Izračun u `packages/domain/src/claim-savings.ts` s testovima.
- Demo: polazna mjera 30 h i 18 h pripreme ZNS-a 1 ZELENI-LAB → ušteda 40 %; kasno evidentiran račun za RP1 (troškovi iz ranijih razdoblja u nacrtu ZNS-a 2).
- Migracija 0022 (`earlier_expense_ids`, `preparation_minutes` na zahtjevu).

### Promijenjeno
- Ured za projekte dobiva `tenant:write` (postavke institucije).
- Snimka predaje sprema cijeli popis za provjeru (kontrolna lista u paketu).
- `downloadFile` u sučelju uzima naziv datoteke iz odgovora poslužitelja i prikazuje poruku poslužitelja kod greške.

## [0.23.0] - 2026-11-17
### Dodano
- WP1.16a **ZNS – ispravnost** (`docs/domena/zns-pravila.md`). Domena (`packages/domain/src/claims.ts`): popis za provjeru prije predaje, odluka po trošku s izračunom priznatog iznosa (isti izračun kao zahtjev), provjera isplate, definicije ostvareno / priznato / nepriznato – s testovima rubnih slučajeva (17).
- Predaja ZNS-a tek nakon kraja razdoblja; ranija predaja samo uz razlog (spremljen uz zahtjev, prikazan na njemu, u reviziji `submit.early`). `POST …/claims/:cid/submit` prima `earlyReason` i `acknowledgeWithoutEvidence`.
- Popis za provjeru (prikazan na nacrtu, provodi se pri predaji): razdoblje završilo, svi timesheetovi članova tima u mjesecima razdoblja odobreni (neodobreni se navode), dokaz uz svaki ručni trošak ili izričita potvrda (u reviziji), datumi u razdoblju; kumulativno prekoračenje kategorije proračuna kao upozorenje. Upozorenja i potvrde spremaju se uz predaju.
- Odluka po trošku (`decision: 'decided'`): priznati iznos (zadano cijeli) i razlog kod umanjenja/odbijanja; trošak prihvaćen, djelomično priznat ili odbijen; datum odluke; iznos financijera s obaveznom napomenom kad se razlikuje od izračunatog; ishod zahtjeva iz odluke. `POST …/decision/preview` (izračun bez spremanja) i `POST …/decision/correction` (namjerni, revidirani ispravak prije isplate).
- Isplata: datum ne prije odluke i ne u budućnosti; razlika prema odobrenom traži napomenu; bilježi se jednom.
- „Nepriznato” u pregledu financija (ukupno, po kategoriji, po partneru), u zahtjevu i u portfelju.
- Web: provjera prije predaje s blokirajućim stavkama i upozorenjima, razlog rane predaje, potvrda troškova bez dokaza; troškovi osoblja grupirani po osobi i mjesecu (zahtjev, odluka, troškovi); obrazac odluke s umanjenjem/odbijanjem po trošku, razlozima i izračunom priznatog uz iznos financijera; ispravak odluke; isplata s provjerom datuma i iznosa; traženo / priznato / nepriznato nakon odluke.
- Migracije 0020 (priznati iznos i razlog po trošku, status `partially_accepted`, razlog rane predaje, snimka predaje, datum i izračun odluke, napomena uz isplatu; dopuna postojećih zapisa) i 0021 (okidač nepromjenjivosti s jedinim, najavljenim i revidiranim putem ispravka).

### Promijenjeno
- Ostvareno (pregled financija, portfelj, zahtjev): prije odluke traženi iznos troška, nakon odluke priznati, odbijen 0 (do sada su se brojili svi neodbijeni troškovi u punom iznosu, i nepriznati dio djelomično odobrenog ZNS-a).
- Djelomično odobren ZNS više ne označava sve troškove prihvaćenima; stari oblik odluke (`approved`/`partially_approved`/`rejected` + `approvedAmount`) uklonjen. Povrat na dopunu traži razlog.
- Novi zahtjev zadano nudi najranije završeno razdoblje bez zahtjeva.
- Dokazi su zamrznuti i uz djelomično priznate i odbijene troškove (do sada samo uz troškove u zahtjevu i prihvaćene).
- Demo: ZNS 1 ZELENI-LAB-a odlučen po trošku (elaborat umanjen, putovanje odbijeno, s razlozima); ZNS 2 u nacrtu s otvorenim stavkama (Josipov timesheet za 12. mjesec čeka odobrenje, brošure bez dokaza). Scenarij i `docs/DEMO.md` ažurirani.

### Ispravljeno
- Popis ZNS-ova više ne izvršava upite istodobno na istoj transakciji (`Promise.all`).

## [0.22.0] - 2026-11-17
### Dodano
- Revizija strategije nakon WP1.15 (`docs/strategija-razvoja-faza-1b.md`, odj. 7): WP1.16 proširen ispravnošću ZNS-a, WP1.14b proširen i pomaknut iza njega, WP1.17 i WP1.18 uvjetni; točka zaustavljanja do povratne informacije s demonstracija.
- WP1.15 **Portfelj** (M10): `GET /api/portfolio[?days=N]` – pregled svih projekata institucije u jednom zahtjevu, samo čitanje, bez novih tablica i migracija. Brojke (projekti u provedbi; ugovoreni proračun, zatraženo financiranje i potrošnja vlastite organizacije, uz iznose cijelih projekata; rokovi u 30 dana i prošli rokovi; prijave u tijeku s traženim iznosima; uspješnost prijava), projekti s proteklim vremenom i potrošnjom (oznaka kad se razlikuju za više od 20 postotnih bodova), sljedećim izvještajem i upozorenjima (isporuke koje kasne, visoki rizici, timesheetovi koji čekaju odobrenje, ručni troškovi bez dokaza, završena razdoblja bez predanog ZNS-a), jedan popis rokova (prošli neispunjeni prvi, zatim idućih 60 dana: razdoblja i ZNS, isporuke, prekretnice, rokovi i interni rokovi praćenih poziva, interni rokovi prijava), opterećenje ljudi kroz projekte (sati po mjesecu, sati ove godine prema godišnjem fondu iz pravila paketa, dani s više od 8 h ukupno – provjera dvostrukog financiranja) i prijave po statusu.
- Pristup prema WP1.14: ruta `@AnyScope('projects:read')`; uz `portfolio:read` institucije (ured, financije, uprava, administrator) sve; inače samo projekti s dodjelom, iznosi samo uz `finance:read` na projektu, bez opterećenja ljudi, prijave i pozivi samo uz dozvolu institucije.
- Domena (`packages/domain/src/portfolio.ts`): napredak u vremenu, postotak i signal potrošnje, spajanje i poredak rokova, godišnji fond sati iz pravila paketa, opterećenje po osobi (prepoznavanje po računu ili imenu), uspješnost prijava – s testovima rubnih slučajeva.
- Web: stranica **Portfelj** – prva stavka izbornika i početna stranica uz `portfolio:read` institucije (ostali i dalje počinju na Projektima, a Portfelj otvaraju za svoje projekte); pločice, dvije trake vrijeme/potrošnja, upozorenja kao oznake koje vode na karticu gdje se popravljaju, rokovi u stilu „za N d / kasni N d” s izborom prozora, prazno stanje s prvim koracima za novu instituciju.
- Testovi: `portfolio.e2e.test.ts` (točne brojke na postavi s dva projekta, pravila pristupa za voditelja i člana tima na projektu, financije i upravu), domena (15), e2e u pregledniku: korak „portfelj” (22 koraka).

### Promijenjeno
- Demo: ZELENI-LAB počinje 12 mjeseci prije punjenja (13. mjesec; RP2 završio, ZNS 2 još nije predan), glavna oprema (120.000 EUR) nije nabavljena – potrošnja kasni za vremenom, isporuka D2.1 i prekretnica kasne; timesheetovi za 12 mjeseci; Marina Šimić radi i na BLUESENSE-u (dan s 10 h kroz dva projekta); odbijena prijava PAMETNI-KAMPUS. Scenarij demonstracije počinje na portfelju.

## [0.21.0] - 2026-11-17
### Dodano
- WP1.14 pristup po projektu (`docs/sigurnost/AUTORIZACIJA.md`): uloga se dodjeljuje na razini institucije (svi projekti) ili na jednom projektu i tada vrijedi samo za taj projekt – u API-ju i u popisima. Kontekst zahtjeva nosi dozvole institucije i mapu dozvola po projektu, svježe pri svakom zahtjevu (opoziv vrijedi odmah).
- Provedba sigurno prema zadanome: svaka ruta mora imati točno jednu oznaku (`@Public`, `@Authenticated`, `@RequirePermission` – institucija, `@ProjectPermission` – projekt u putanji, `@ResolvesProject` – dokumenti, `@AnyScope` – popisi i referentni podaci); neoznačena ruta odbija se za sve. Projekt bez pristupa je 404 kao projekt druge institucije; `loadProject` kao druga linija obrane.
- `GET /api/projects` i popisi dokumenata samo s pristupom; dokumenti razrješavaju vlasnika (projekt, trošak, isporuka, ZNS, prijava) i provjeravaju pristup tom projektu.
- Pristup novom projektu: imenovani voditelj (pri stvaranju, ugovaranju prijave – nositelj, promjeni voditelja) dobiva ulogu voditelja na projektu; član tima s korisničkim računom dobiva ulogu člana tima na projektu.
- Upravljanje pristupom: `GET/POST /api/projects/:id/access`, `DELETE /api/projects/:id/access/:assignmentId` (administrator ili `projects:write` na projektu; bez `users:write` samo uloge čije dozvole dodjeljivač i sam ima). `/api/me` i prijava vraćaju `projectPermissions`, `/api/users` `projectRoles`.
- Povjerljivi dokumenti: nova dozvola `documents:confidential` (administrator, ured, voditelj projekta, financije); ostali povjerljive dokumente ne vide u popisima ni u brojanju dokaza, izravno 404; povjerljivim ih označava samo tko ima dozvolu.
- `PATCH /api/projects/:id/team/:mid` (član tima; godišnji trošak samo uz `personnel:read`).
- Web: kartica **Pristup** na projektu (tko vidi projekt i kroz koju ulogu, dodjela i oduzimanje), Korisnici s ulogom institucije i ulogama na projektima (novi korisnik zadano dobiva projektnu ulogu na projektu), sve provjere unutar projekta po projektu, izbornik i kartice samo ono što korisnik smije otvoriti.
- Testovi: `project-access.e2e.test.ts` (voditelj i član tima samo na A, financije i čitatelj institucije – svi moduli, popisi, dokumenti, plaće, povjerljivo, samoodobrenje, upravljanje pristupom, opoziv), `route-coverage.e2e.test.ts` (sve rute razvrstane; svaka projektna ruta s id-jevima projekta B → 404, svaka ruta institucije → 403). E2E u pregledniku (21 korak): član tima samo na projektu vidi samo svoj projekt.
- Migracija 0019: strani ključ dodjele uloge na projekt, indeks po projektu, prazan godišnji trošak člana tima.

### Promijenjeno
- Uloga „Član tima” više nema `finance:read`: ne vidi proračun, troškove ni ZNS projekta (iz troškova osoblja mogle su se izračunati tuđe satnice); vlastiti timesheet i dokumenti ostaju.
- Plaće: godišnji trošak člana tima čita se, **upisuje i mijenja** samo uz `personnel:read` na projektu; voditelj bez nje dodaje člana bez troška, timesheet bez upisanog troška ne može se odobriti (409).
- Nitko ne odobrava vlastiti timesheet, bez obzira na ulogu (403).
- Uloga financije dobiva `documents:write` (prilaže dokaze uz troškove).
- Ugovaranje prijave traži i `proposals:read` institucije; dokumenti prijave traže dozvole prijava institucije.
- Organizacije i paketi programa (čitanje) dostupni uz dozvolu na bilo kojem projektu (partneri, kategorije troškova); izmjene ostaju radnja institucije.
- Sistemske uloge usklađuju se s bazom pri svakom `cli.js init` / `migrate` (postojeće instalacije preuzimaju nove dozvole).
- Demo: `voditelj@` je voditeljica samo na BLUESENSE-u, `voditelj2@` samo na ZELENI-LAB-u, `clan@` član tima samo na BLUESENSE-u; prijave priprema ured; dokaze troškova prilažu financije; povjerljiva odluka o plaćama tima. Scenarij: korak „Tko vidi koji projekt”.

## [0.20.0] - 2026-11-17
### Dodano
- Strategija razvoja za fazu 1b „Spremnost za pilot” (`docs/strategija-razvoja-faza-1b.md`): radni paketi WP1.13–WP1.18 u ROADMAP-u.
- WP1.13 demo okruženje: naredba `cli.js demo [--reset] [--slug]` puni demo instituciju „Pokazno sveučilište” kroz pravi API (aplikacijska uloga, RLS, dozvole i revizija), prijavljena kao sedam demo korisnika s različitim ulogama; datumi relativni prema današnjem danu.
- Sadržaj: radar sa 6 vlastitih poziva (ocjene, go / pratimo / no-go, interni rokovi), paket po pozivu za NPOO s izvještavanjem od 6 mjeseci, 6 partnera iz 6 država; NPOO projekt ZELENI-LAB prošao poziv → go → prijava → predaja → financirana → ugovorena, s ZNS-om za RP1 (predan, djelomično odobren, isplaćen) i nacrtom za RP2; HE projekt BLUESENSE u provedbi (struktura, rizici, zaključan proračun, tim s plaćama, 10 mjeseci timesheetova od kojih jedan čeka odobrenje, troškovi s PDF dokazima i jedan bez dokaza, ugovori); prijava AQUAREST u pripremi s otvorenim stavkama spremnosti.
- Sigurnost demoa: demo stanar nosi oznaku `settings.demo`; naredba odbija stanara bez nje, reset briše samo retke i datoteke demo stanara (globalni retci i drugi stanari ostaju), `init` nikad ne stvara demo račune, u produkcijskom načinu treba `ARQUS_DEMO=1`. Idempotentno; prekinuto punjenje se ponavlja.
- Jedna naredba lokalno: `demo.cmd` (Windows, Docker Desktop) i `scripts/demo.sh` s `start | reset | stop | obrisi | log`, `infra/demo/docker-compose.yml` (baza + aplikacija na http://localhost:8080, javne demo tajne, volumen dokumenata).
- Dokumentacija: `docs/DEMO.md` (pokretanje, računi, reset, problemi) i `docs/DEMO-SCENARIJ.md` (demonstracija od 20 minuta po stvarnim zaslonima).
- Test `demo.e2e.test.ts`: sadržaj kroz HTTP API, idempotentnost, reset ne dira drugog stanara ni globalne pozive, odbijanje ne-demo stanara.

## [0.19.0] - 2026-11-16
### Dodano
- WP1.12 uvoz poziva s portala EU Funding & Tenders (ADR-0011): javni SEDIA search API, najavljene i otvorene teme razdoblja 2021–2027, stranice po 100, ponovni pokušaj na 429/5xx, vremensko ograničenje.
- Upsert globalnih poziva vlasničkom ulogom (`source = 'ft'`, `synced_at`; migracija 0018): ručno uneseni globalni pozivi se ne prepisuju, praćenje institucije ostaje, teme s isteklim rokovima i duplikati se preskaču.
- `@arqus/domain`: `mapFtResult`, `selectFtCalls`, `brusselsWallToUtc` (rokovi „17:00 Brussels time” → UTC), `heActionTypes` (RIA/IA/CSA), popis okvirnih programa.
- Pokretanje: `cli.js import-calls [--file …]` i periodički u aplikaciji (`FT_IMPORT_INTERVAL_HOURS`, u produkciji 24 h).
- API radara: filtri `programme`, `scope`, `mine` (vlastiti i praćeni), `GET /api/calls/programmes`, `GET /api/calls/sources` (broj i zadnje osvježenje uvoza).
- Web: filtri po programu i „vlastiti i praćeni”, pretraga s odgodom, prikaz najbližih 100 rokova uz „prikaži još”, oznaka F&T, izvor i poveznica na temu u detalju.
- Provjereno na stvarnom portalu: 1.116 zapisa → 467 aktualnih poziva (365 Horizon Europe s paketom), 13 s; ponovni uvoz bez duplikata.
- E2E (20 koraka): uzorak teme s portala, filtar programa i detalj poziva.

## [0.18.0] - 2026-11-16
### Dodano
- WP1.11 dokumenti (M9, ADR-0010): tablice `documents` i `document_versions` (migracije 0016/0017, RLS; aplikacija nad verzijama ima samo `SELECT, INSERT`, dokumenti se brišu logički).
- REST `/api/documents`: učitavanje (multipart, najviše 25 MB) uz projekt, trošak, isporuku, ZNS ili prijavu; nove verzije (ista datoteka odbijena), popis po entitetu, projektu ili prijavi, detalj s poviješću verzija, izmjena metapodataka, logičko brisanje, preuzimanje trenutne ili bilo koje verzije.
- Sigurnost: popis dopuštenih vrsta s provjerom potpisa sadržaja (HTML, SVG, izvršne odbijene), čišćenje naziva datoteke, ključ pohrane generira poslužitelj, preuzimanje uvijek kao privitak s `nosniff` i CSP `sandbox`, provjera SHA-256 pri preuzimanju, preuzimanja u reviziji.
- Pravila: dokazi troška zamrzavaju se kad trošak uđe u ZNS; dokumenti zatvorenog projekta i zaključene prijave ne mijenjaju se. ZNS pokazuje ručno unesene troškove bez dokaza (`missingEvidence`), popis troškova broj dokaza.
- `@arqus/domain`: `checkUpload`, `sanitizeFileName`, `formatBytes`, vrste dokumenata i oznake povjerljivosti.
- Web: kartica **Dokumenti** na projektu (svi dokumenti projekta, verzije, preuzimanje), „Dokazi (n)” uz svaki trošak, upozorenje i stupac dokaza u ZNS-u, dokumenti na prijavi; oznaka AI sadržaja.
- Infrastruktura: volumen `documents` u produkcijskom compose-u, dnevna arhiva dokumenata u servisu `backup`, upute za obnovu.
- E2E (19 koraka): dokaz uz trošak, provjera dokaza u ZNS-u, ugovor na projektu s novom verzijom i preuzimanjem.

## [0.17.0] - 2026-11-16
### Dodano
- WP1.5 prijave (M5, ADR-0006): tablice `proposals`, `proposal_members`, `proposal_work_packages`, `proposal_budget_lines` s kompozitnim FK-ovima po stanaru, migracije 0014/0015 s RLS-om.
- REST `/api/proposals`: popis, detalj (konzorcij, radni paketi, proračun izračunat iz paketa, spremnost), nova prijava, `POST /api/calls/:id/proposal` (samo nakon odluke go; paket i vrsta akcije iz poziva; jedna aktivna prijava po pozivu), članovi (vlastita organizacija automatski, potvrda sudjelovanja), radni paketi unutar trajanja, proračun član × kategorija s provjerom paketa, zaključavanje i otključavanje (nova verzija), prijelazi statusa, predaja (samo iz interne provjere i uz ispunjenu spremnost; snimka proračuna), ishod (financirana / rezervna lista / odbijena), ugovaranje.
- Ugovaranje: financirana prijava stvara projekt s partnerima, radnim paketima i proračunom v1 (nacrt) kopiranim iz prijave; projekt pamti izvornu prijavu, prijava ostaje arhiv predane verzije.
- `@arqus/domain`: statusi i prijelazi prijave, `proposalReadiness` (konzorcij prema pravilima paketa, potvrde, radni paket, proračun unesen i zaključan, voditelj, poziv otvoren).
- Web: stranica **Prijave** – popis, nova prijava, detalj s fazama, spremnošću, tijekom (predaja, ishod, ugovaranje), konzorcijem, strukturom rada i tablicom proračuna; na radaru gumb „Otvori prijavu” nakon odluke go (ili poveznica na postojeću prijavu).
- E2E (16 koraka): projekt više ne nastaje izravno – prijava se otvara iz radara, puni, predaje, dobiva ishod i ugovara u projekt, a zatim slijede aktivacija, timesheet, trošak i ZNS.

## [0.16.0] - 2026-11-16
### Dodano
- WP1.4 radar poziva: tablice `calls` (globalni `tenant_id NULL` vidljivi svima, vlastiti po stanaru; rokovi s vremenskom zonom) i `call_tracking` (po stanaru: ocjena prikladnosti, odluka, interni rok, odgovorna osoba), migracije 0012/0013 s RLS-om.
- REST `/api/calls`: popis s filtrima (status, pretraga, praćeni) i poretkom po najbližem roku, detalj s poviješću ocjena i odluka (iz revizije), unos i izmjena vlastitog poziva (globalni se ne mijenja), `PUT /:id/assessment`, `PUT /:id/decision`, `GET /deadlines?days=` (rokovi praćenih poziva i interni rokovi).
- Pravila: status (najavljen/otvoren/zatvoren/otkazan) iz otvaranja i rokova predaje (dvofazni pozivi, info-dan ne zatvara poziv); ocjena 1–5 po četiri kriterija → postotak i preporuka (≥ 70 % go, ≥ 50 % razmotriti); go i no-go traže obrazloženje; go nije moguć na zatvorenom ili otkazanom pozivu.
- `@arqus/domain`: `callStatus`, `nextDeadline`, `daysUntil` (kalendarski dani), `fitScore`.
- Web: stranica **Radar poziva** – nadolazeći rokovi s odbrojavanjem, popis s filtrima, obrazac za novi poziv (lokalno vrijeme → ISO s zonom), detalj s ocjenom (klizači i preporuka uživo), odlukom i poviješću.
- E2E (16 koraka): novi poziv, ocjena 75 %, odluka go, poziv u nadolazećim rokovima.

## [0.15.0] - 2026-11-16
### Dodano
- Web: stranica **Paketi programa** – popis globalnih i vlastitih paketa, pregled razriješenih pravila (kategorije sa stablom i izračunom neizravnih, stope po vrsti korisnika, izvještavanje, trošak osoblja, provjere, izvori, verzije), obrazac **Novi paket po pozivu** (roditelj, identifikator poziva → oznaka, stope financiranja, stopa i osnovica neizravnih troškova, metoda i djelitelj troška osoblja, izvještajno razdoblje, dodatne kategorije, poveznica na Upute), napredni JSON način, provjera s prikazom razriješenih pravila, spremanje nacrta, objava, nova verzija, brisanje nacrta.
- API: `GET /api/programme-packages/rows/:rowId` (izvorni sadržaj za novu verziju), `DELETE /api/programme-packages/rows/:rowId` (samo nacrt); ured za projekte dobiva dozvolu `packages:write`.
- E2E: paket po pozivu stvara se i objavljuje kroz sučelje (15 koraka).
### Ispravljeno
- Nasljeđivanje paketa: napomena roditelja više se ne prenosi na paket po pozivu, izvori poziva navode se prvi, a provjere s pravilom `package.extends == null` vrijede samo za korijenski paket.
- `run-local.sh`: poslužitelji iz prethodnog e2e pokretanja ostajali su aktivni (gašena je ljuska, ne proces), pa je novo pokretanje moglo testirati stari API; sada `exec` i provjera zauzetosti porta.

## [0.14.0] - 2026-11-16
### Sigurnost
- Nadograđeni `drizzle-orm` 0.45.2 (SQL injection preko identifikatora, GHSA) i `zod` 4.6.6 (iscrpljivanje memorije) – obje visoke ranjivosti; `pnpm audit --prod --audit-level high` sada ruši CI.
### Dodano
- WP1.2b: politika lozinki (`passwordIssues` u domeni: ≥ 12 znakova, česte riječi, ponavljanja, nizovi, osobni podaci) pri stvaranju korisnika, resetu i promjeni lozinke.
- Sesije u bazi (`sessions`, migracije 0010/0011): provjera pri svakom zahtjevu, odjava (`POST /api/auth/logout`) opoziva sesiju; deaktivacija, reset lozinke i MFA opozivaju sve sesije korisnika; dozvole se čitaju svježe pa promjena uloga vrijedi odmah.
- MFA (TOTP, RFC 6238): `POST /api/me/mfa/setup|enable|disable`, prijava traži kod (`mfaRequired`), tajna šifrirana AES-256-GCM (`MFA_ENCRYPTION_KEY`), zaštita od ponovne upotrebe koda.
- Administracija: `PATCH /api/users/:id` (ime, stanje, uloge), `POST /api/users/:id/reset-password`, `POST /api/users/:id/reset-mfa`, `GET /api/roles`; zaštita od samodeaktivacije i uklanjanja zadnjeg administratora.
- Vlastiti račun: `POST /api/me/password` (opoziva ostale sesije).
- Dozvola `personnel:read`: godišnji trošak osoblja vidljiv samo uredu za projekte, financijama i administratoru.
- Web: prijava s MFA kodom, stranica **Korisnici** (dodavanje, uloge, deaktivacija, nova lozinka, reset MFA), **Moj račun** (promjena lozinke, postavljanje MFA), odjava na poslužitelju.
- E2E u pregledniku proširen: administrator stvara korisnika, korisnik postavlja MFA i prijavljuje se s kodom; test sada ruši svaki neočekivani HTTP 4xx/5xx.
### Ispravljeno
- Nakon prijave drugog korisnika sučelje je na trenutak učitavalo zadnju stranicu prethodnog korisnika (403) – pronađeno e2e testom.

## [0.13.0] - 2026-11-10
### Dodano
- WP1.9 (dio neovisan o pružatelju): `Dockerfile` (jedna slika, API poslužuje izgrađeno web sučelje, neprivilegirani korisnik, provjera zdravlja), `infra/prod/docker-compose.yml` (PostgreSQL 16, Caddy s automatskim HTTPS-om, servis za sigurnosne kopije svakih sat uz zadržavanje 14 dana), `infra/prod/backup.sh`, `.env.example`.
- `cli.js init|migrate|import-packages|seed`: migracije, lozinka aplikacijske uloge iz `DB_APP_PASSWORD`, uvoz paketa, prvi stanar; u produkciji obvezne jake tajne.
- Sigurnost: zaglavlja (CSP `default-src 'self'`, X-Frame-Options, nosniff, Referrer-Policy, HSTS u produkciji, `no-store` za API), ograničenje neuspjelih prijava (10 / 15 min po računu, 100 po IP-u → 429), ograničenje veličine tijela 1 MB, `/api/health/ready` s provjerom baze.
- Dokumenti: `docs/PILOT-INSTALACIJA.md`, `docs/sigurnost/ASVS-L2.md` (samoprocjena s prioritetima), ADR-0009.
### Promijenjeno
- Paketi programa **objavljeni**: Horizon Europe (osnovica neizravnih A–D bez volontera A.5, podugovaranja, potpore trećima i interno fakturiranih usluga; dodana kategorija A.5) i NPOO (satnica / 1720 h, najviše 1720 h godišnje; stopa neizravnih 15 % označena kao zadana vrijednost koju poziv mora potvrditi). Izvori u `meta.sources`.
- Uvoz paketa odbija izmjenu već objavljene verzije (treba povećati verziju).
### Provjereno
- Slika izgrađena i pokrenuta s PostgreSQL kontejnerom; e2e test sučelja prolazi nad produkcijskim kontejnerom (s CSP-om); kopija i obnova u novu bazu rade. Testovi: ukupno 85 (3 web, 28 domena, 54 API).

## [0.12.0] - 2026-11-10
### Dodano
- WP1.10 web sučelje (`apps/web`, React 19 + Vite, bez UI biblioteka, svijetla i tamna tema): prijava; popis i izrada projekata (paket i vrsta akcije iz paketa); registar organizacija; detalj projekta s karticama Pregled (ugovor, partneri, promjena statusa s potvrdom, izvještajna razdoblja), Struktura rada (radni paketi, isporuke sa statusom, prekretnice, rizici), Proračun (tablični unos partner × kategorija, izračun iz paketa), Tim i timesheetovi (mjesečna mreža dan × radni paket, predaja, odobrenje, povrat), Troškovi, Zahtjevi za nadoknadu (otvaranje, predaja, odluka, isplata), Ugovoreno / ostvareno.
- Gumbi i polja prikazuju se prema dozvolama iz `/api/me`; greške API-ja s popisom problema prikazuju se uz obrazac.
- E2E provjera u pregledniku (`apps/web/e2e/run-local.sh`, Playwright): cijeli tok od prijave do predaje ZNS-a na pravom API-ju i bazi.
- Jedinični testovi formatiranja (euri, sati, datumi).
### Ispravljeno
- Unos iznosa „20.000” tumači se kao dvadeset tisuća (hrvatski zapis), ne kao decimalni broj – greška pronađena e2e testom.

## [0.11.0] - 2026-11-10
### Dodano
- WP1.8 tim i timesheetovi: `team_members` (godišnji trošak osoblja), mjesečni `timesheets` (nacrt → predan → odobren → zaključan) s unosom u minutama po danu i radnom paketu. Odobrenje stvara troškove osoblja po WP-u prema pravilu paketa (satnica ili dnevnica). Bez dozvole `timesheets:approve` korisnik uređuje samo vlastiti timesheet.
- Troškovi (`expenses`): ručna evidencija s kategorijom iz paketa, WP-om, dobavljačem i oznakom dokaza; datum unutar trajanja projekta; trošak osoblja ne unosi se ručno kad paket traži evidenciju rada.
- Zahtjevi za nadoknadu (`reimbursement_claims`) po izvještajnom razdoblju i partneru: nacrt s pregledom prihvatljivih troškova i izračunom, predaja (troškovi pridruženi, timesheetovi zaključani), odluka (odobren, djelomično, odbijen, vraćen na dopunu), isplata.
- `GET /api/projects/:id/finance`: ugovoreno vs. ostvareno po kategoriji i partneru, pregled ZNS-ova.
- Baza: okidač koji prihvaćene i odbijene troškove čini nepromjenjivima (invarijanta 6), CHECK da je trošak u zahtjevu točno kad nije „evidentiran”.
- Shema paketa: `personnelRule.categoryCode` i `hoursPerDay` (HE `A.1`, NPOO `OS`), semantička provjera.
- `@arqus/domain`: `personnelCostCents`, `timesheetIssues`, `minutesByWorkPackage`, `daysInMonth`.
- `db:generate` automatski premješta UNIQUE ograničenja ispred stranih ključeva (problem se ponavljao u tri migracije).
- Dozvole `timesheets:read/write/approve`. Testovi: ukupno 78 (28 domena, 50 API).

## [0.10.0] - 2026-11-10
### Dodano
- WP1.7 provedba: tablice `work_packages`, `tasks`, `deliverables`, `milestones`, `risks` (migracije 0006/0007, RLS, kompozitni FK, CHECK ograničenja). REST pod `/api/projects/:id`: `structure` (ugniježđeno, oznake WP1/T2.1/D1.1/MS1, rokovi kao datumi), stvaranje i izmjena WP-ova, zadataka, isporuka, prekretnica i rizika; brisanje praznog WP-a.
- Pravila: mjeseci unutar trajanja projekta i WP-a, voditelj mora biti partner projekta, vrsta isporuke i razina diseminacije iz paketa, `submittedAt` pri predaji isporuke, razina rizika (vjerojatnost × utjecaj).
- WP1.7 proračun: `project_budgets` (verzije, nacrt/zaključan) i `budget_lines` (partner × kategorija × WP, centi). `GET /api/projects/:id/budget` s izračunom po partneru i ukupno; `PUT .../budget/lines` (tablični unos). Aktivacija projekta zaključava proračun v1.
- `@arqus/domain`: `computeProjectBudget`, `budgetLineIssues` (samo listovi stabla kategorija, bez neizravnih), `monthEndDate`, `riskLevel`.
- Globalni filtar grešaka PostgreSQL ograničenja (jedinstvenost, strani ključ, CHECK) → 409 umjesto 500.
- Testovi: ukupno 62 (22 domena, 40 API).

## [0.9.0] - 2026-11-09
### Dodano
- WP1.6: tablice `organisations`, `projects`, `project_partners`, `reporting_periods` (migracije 0004/0005, RLS s FORCE). Kompozitni strani ključevi `(tenant_id, id)` sprječavaju vezu na retke drugog stanara i kad je id poznat (provjere stranih ključeva u PostgreSQL-u zaobilaze RLS).
- REST `/api/organisations` (popis s pretragom, dohvat, stvaranje, izmjena; validacija PIC/OIB) i `/api/projects` (popis, detalj s partnerima i razdobljima, stvaranje uz paket i vrstu akcije, izmjena, dodavanje/uklanjanje partnera, `POST /:id/transition`).
- Vlastita organizacija stanara dodaje se automatski kao partner; vrsta korisnika (npr. `nonProfit`) određuje se iz paketa i organizacije.
- `@arqus/domain`: životni ciklus projekta (`transitionIssues`), datumi bez pomaka vremenske zone, `generateReportingPeriods` (aktivacija generira razdoblja iz pravila paketa).
- Zod validacija tijela zahtjeva (`parseBody`, 400 s popisom problema); dozvole `organisations:read/write`.
- Testovi: ukupno 48 (17 domena, 31 API) – uključuje provjeru da svaka tablica ima prisilni RLS i napad preko poznatog id-a tuđe organizacije.
### Promijenjeno
- Projekt se aktivira samo uz objavljenu verziju paketa; nakon aktivacije početak, trajanje i partneri mijenjaju se samo amandmanom (dolazi kasnije).
- Pravilo rada: Claude spaja PR čim CI prođe (AUTONOMNI-RAD, t. 7).

## [0.8.0] - 2026-11-09
### Dodano
- WP1.3: tablica `programme_packages` (globalni paketi `tenant_id NULL` vidljivi svima, stanarski izolirani RLS-om), migracije 0002/0003; uvoz globalnih paketa iz `docs/domena/paketi` (`db:import-packages`, idempotentno po checksumu; seed ga poziva); REST: popis, dohvat razriješenog paketa (`?version=`), `POST /validate`, `POST` (stanarski nacrt), `POST /:id/publish`.
- `@arqus/domain`: nasljeđivanje paketa (`mergePackages`, `resolvePackage`) – paket po pozivu nasljeđuje programski paket i mijenja samo razlike; otkrivanje kružnog nasljeđivanja; semantička validacija izvodi se na razriješenom paketu.
- ESLint 9 (flat config, typescript-eslint) + `pnpm lint` u CI-ju.
- Testovi: ukupno 30 (10 domena, 7 RLS, 13 e2e).
### Promijenjeno
- Paketi programa se više ne čitaju iz datoteka pri pokretanju API-ja nego iz baze.
- CI: izgradnja prije typechecka (CI je padao jer `@arqus/domain` nije imao `dist`).

## [0.7.0] - 2026-11-09
### Dodano
- WP1.2: Drizzle shema (`tenants`, `users`, `roles`, `role_assignments`, `audit_entries`) i migracije; RLS na svim tablicama s `FORCE`, politike po `app_current_tenant()`, zasebna aplikacijska uloga `arqus_app` bez BYPASSRLS, revizijski zapis samo za dodavanje (bez UPDATE/DELETE prava).
- Identitet: prijava lozinkom (scrypt) + JWT (HS256, `jose`), `AuthGuard` s `@Public()` i `@RequirePermission()`, kontekst zahtjeva (AsyncLocalStorage) → `DbService.tx()` postavlja stanara u transakciji; katalog dozvola i 6 sistemskih uloga; rute `/api/auth/login`, `/api/me`, `/api/users`, `/api/audit`.
- Seed (`db:seed`) i migracijska skripta (`db:migrate`); CI s PostgreSQL servisom.
- Testovi: 6 RLS testova na pravoj bazi (izolacija čitanja i pisanja, fail-closed bez konteksta, nepromjenjiva revizija, sistemske uloge) + 6 e2e testova identiteta; ukupno 22 testa prolaze.
### Promijenjeno
- Sve rute osim `/api/health` i `/api/auth/login` traže Bearer token; paketi programa traže `packages:read`.
- ADR-0008 dopunjen odlukom o Drizzleu i autentikaciji; OIDC/SAML i MFA izdvojeni u WP1.2b.

## [0.6.0] - 2026-11-09
### Dodano
- WP1.1 temelji platforme: pnpm monorepo; `packages/domain` (tipovi paketa programa, validator Ajv 2020-12 + semantička pravila, izračun proračuna partnera s izvedenim neizravnim troškovima i stopom financiranja, CLI); `apps/api` NestJS s modulima `health` i `programmes` (učitava i validira pakete iz `docs/domena/paketi`, REST `/api/programme-packages`); `apps/web` React/Vite početna stranica; `infra/docker-compose.yml` (PostgreSQL 16, Redis 7, MinIO); GitHub Actions CI; `docs/RAZVOJ.md`.
- ADR-0008: tehnološki okvir (NestJS, React/Vite, Vitest, pnpm, PostgreSQL).
- Testovi: 7 jediničnih (domena) + 3 e2e (API); svi prolaze. Izgrađeni API provjeren ručno.

## [0.5.0] - 2026-11-09
### Dodano
- WP0.6b: istraživanje tržišta iz javnih izvora (`docs/faza-0/istrazivanje-trzista.md`) – veličina i rast tržišta, obujam Horizon Europe (HR: 352 projekta, 539 sudjelovanja 2021.–2024.), SAFU 2024 (262 ugovora, 1.807 ZNS-ova), broj potencijalnih kupaca u HR (117 visokih učilišta…), TAM/SAM/SOM, posljedice za proizvod.
- WP0.7: cjenovna hipoteza v2 (Projekt 150 EUR/projekt/mj., Institucija 6.000 EUR/god., Institucija+ 13.200 EUR/god., PaaS od 25.000 EUR/god.; sve ispod praga jednostavne nabave), projekcija prihoda i odluka **GO, uvjetno** (`docs/faza-0/cjenovna-hipoteza-v2.md`).
- ADR-0007: faza 0 zatvara se desk istraživanjem umjesto intervjuima; provjera s kupcima seli u pilote faze 1.
### Promijenjeno
- ROADMAP: WP0.2 i WP0.6 ukinuti; novi kriterij za fazu 2; redoslijed faze 1 – provedba i troškovi/ZNS (novi WP1.8) prije radara i prijave; sigurnosni pregled postaje WP1.9.

## [0.4.1] - 2026-11-09
### Dodano
- WP0.2 (priprema): prijedlog 20 sugovornika po segmentima – institucije, ciljne uloge, razlozi, javne ulazne točke, prioriteti i raspored kontakta (`docs/faza-0/prijedlog-sugovornika.md`); predložak pozivne poruke (`pozivna-poruka.md`). Bez osobnih podataka; čeka Ivanovo odobrenje.
- WP0.6 (priprema): scenarij 10-minutne demonstracije prototipa s pitanjima po koraku (`scenarij-demonstracije.md`); predložak sinteze s 10 hipoteza H1–H10 i tablicom reakcija na prototip (`sinteza-predlozak.md`); mapa `intervjui/` s pravilima.
### Promijenjeno
- Vodič za intervju: dopunska pitanja 17–24 (iz analize konkurencije i domenskog modela) i korak demonstracije.

## [0.4.0] - 2026-11-09
### Dodano
- WP0.5: klikabilni prototip `prototip/index.html` – radar poziva s ocjenom prikladnosti i go/no-go, prijava (konzorcij, radni paketi, proračun po pravilima paketa s izračunom neizravnih troškova i stope financiranja, verzije proračuna, provjera spremnosti, predaja, ishod), ugovaranje prema ADR-0006, projekt (aktivacija, izvještajna razdoblja iz paketa, isporuke, prekretnice, troškovi vs. ugovoreno), portfelj. Tok provjeren automatski u Chromiumu.
- `verzija.cmd` + `scripts/verzija.py`: Windows/međuplatformski pokretač – povlači verzije s GitHuba, nudi izbornik, izdvaja odabranu verziju i pokreće je lokalno s preglednikom.
### Promijenjeno
- ADR-0006 potvrdio Ivan (2026-11-09).

## [0.3.1] - 2026-11-09
### Dodano
- `scripts/verzija.sh`: popis verzija iz release commitova, izdvajanje verzija u `.verzije/` (git worktree), usporedba, lokalni poslužitelj.
- `site/index.html`: lokalni preglednik dokumentacije po verzijama (Markdown + Mermaid, JSON, HTML), testiran u pregledniku.
- `docs/LOKALNO-TESTIRANJE.md` (upute) i `docs/POTROSNJA.md` (dnevnik potrošnje tokena s pravilima pauziranja).

## [0.3.0] - 2026-11-09
### Dodano
- WP0.4: domenski model v1 (`docs/domena/domenski-model-v1.md`) – 11 modula, entiteti s atributima, životni ciklusi (poziv, prijava, projekt, zahtjev za nadoknadu, timesheet), ER dijagram, 9 invarijanti, pitanja za intervjue.
- Nacrt JSON sheme paketa programa (`docs/domena/paketi/schema.v1.json`) i dva primjera paketa koji prolaze validaciju: Horizon Europe 2021–2027 i NPOO 2021–2026 (ilustrativan).
- ADR-0006: prijava i projekt su odvojeni agregati; ugovaranje kopira proračun i strukturu.

## [0.2.0] - 2026-11-09
### Dodano
- WP0.3 (dio 2/2): Converis, Cayuse, InfoEd, GrantBite, ažurirane cijene Instrumentla; konačna karta tržišta, zaključci za proizvod i pitanja za intervjue. WP0.3 završen.
- WP0.3 (dio 1/2): analiza konkurencije proširena na 15+ alata u četiri skupine (EU specijalizirani, institucijski sustavi, javni HR/EU alati, opći PM), s cijenama, pokrivenošću životnog ciklusa, izvorima i preliminarnom kartom tržišta.

### Promijenjeno
- Samostalni rad: jedna sesija dnevno u Claude Code u oblaku (umjesto tri tjedno).

## [0.1.1] - 2026-11-09
### Promijenjeno
- Verzija se vodi u datoteci `VERSION` i commitovima `release: vX.Y.Z` jer sesije ne smiju stvarati git tagove ni GitHub Release.

## [0.1.0] - 2026-11-08
### Dodano
- Početna struktura repozitorija i dokumentacije (README, STATUS, ROADMAP, CONTRIBUTING, pravila autonomnog rada).
- Sažetak strategije s poveznicom na puni dokument.
- ADR-0001 do ADR-0005: zapis odluka, multi-tenant modularni monolit, EU hosting, paketi programa, odvojenost od FPZ portala.
- Faza 0 (WP0.1): vodič za intervju, okvir popisa sugovornika, predložak bilješke, početna analiza konkurencije.
