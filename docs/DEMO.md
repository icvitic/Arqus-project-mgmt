# Demo okruženje

Jednom naredbom na vlastitom računalu dobiješ ArQus Projekti s popunjenom demo institucijom („Pokazno sveučilište”): portfelj sa svim signalima, projekt Horizon Europe u provedbi, NPOO projekt s isplaćenim i otvorenim ZNS-om, prijavu u pripremi, radar poziva i korisnike s različitim ulogama. Nakon demonstracije jednom naredbom sve vraćaš na početno stanje.

Scenarij demonstracije od 20 minuta: [DEMO-SCENARIJ.md](DEMO-SCENARIJ.md).

> Demo je samo za pokazivanje. Lozinke i ključevi u `infra/demo/docker-compose.yml` namjerno su javni; aplikacija je dostupna samo s tog računala (`127.0.0.1:8080`). Za pilot-instalaciju vrijedi [PILOT-INSTALACIJA.md](PILOT-INSTALACIJA.md). Sva imena institucija, osoba, poziva i brojeva ugovora su izmišljena.

## Pokretanje

**Windows:** instaliraj i pokreni [Docker Desktop](https://www.docker.com/products/docker-desktop/), zatim u mapi repozitorija dvaput klikni `demo.cmd` (ili u naredbenom retku `demo.cmd`).

**macOS / Linux:** `scripts/demo.sh` (treba Docker s `docker compose`).

Prvo pokretanje gradi Docker sliku i traje nekoliko minuta; svako sljedeće desetak sekundi. Skripta čeka da aplikacija proradi, ispiše račune i (na Windowsu) otvori preglednik na **http://localhost:8080** (ako port 8080 nije dostupan, skripta sama uzme sljedeći slobodni i ispiše adresu).

| Naredba (Windows / macOS, Linux) | Što radi |
| --- | --- |
| `demo.cmd` / `scripts/demo.sh` | izgradi, pokreni, napuni demo podatke (ako ih još nema), ispiši račune |
| `demo.cmd reset` / `scripts/demo.sh reset` | obriše demo instituciju i napuni je ponovno, s datumima prema današnjem danu |
| `demo.cmd stop` / `scripts/demo.sh stop` | zaustavi; podaci ostaju za sljedeći put |
| `demo.cmd obrisi` / `scripts/demo.sh obrisi` | zaustavi i obriše bazu i dokumente demo okruženja |
| `demo.cmd log` / `scripts/demo.sh log` | zadnjih 200 redaka zapisa aplikacije |

**Prije svake demonstracije pokreni `reset`:** datumi (rokovi poziva, timesheetovi, razdoblja) računaju se od dana punjenja, pa demo napunjen prije mjesec dana izgleda zastarjelo, a tragovi prethodne demonstracije nestaju.

## Računi

Prijava: **Institucija (oznaka)** `demo`, lozinka za sve račune **`Plavi-Jadran-2026`**.

| E-adresa | Osoba | Uloga | Opseg | Za što |
| --- | --- | --- | --- | --- |
| `ured@demo.local` | Ana Kovačević | voditeljica ureda za projekte | institucija | **glavni račun za demonstraciju**: radar, prijave, svi projekti, plaće, povjerljivi dokumenti, **Revizija**; odobrava timesheetove koje su voditelji unijeli za članove bez računa (četiri oka) |
| `voditelj@demo.local` | doc. dr. sc. Petra Horvat | voditeljica projekta | **samo BLUESENSE** + voditeljica prijave **AQUAREST** | vidi samo svoj projekt; struktura, tim, odobrava timesheetove člana tima (ne vlastite ni one koje je sama predala), kartica **Pristup**; u **Prijavama** samo AQUAREST, koju sama priprema (proračun, dokumenti, konzorcij); ne vidi plaće ni radar; u **Troškovima** i **ZNS-u** troškove osoblja vidi u satima, iznos je „skriveno” (zbroj kategorije vidi) |
| `voditelj2@demo.local` | Josip Barić | voditelj projekta | **samo ZELENI-LAB** | vidi samo svoj projekt (postao voditelj ugovaranjem prijave kojoj je bio nositelj) |
| `clan@demo.local` | Luka Novak | član tima | **samo BLUESENSE** | vlastiti timesheetovi (jedan čeka odobrenje, tekući mjesec u nacrtu); ne vidi plaće ni povjerljive dokumente |
| `financije@demo.local` | Maja Jurić | financije / računovodstvo | institucija | troškovi i dokazi na svim projektima, tim s godišnjim troškom, ZNS – i iznosi troškova osoblja po osobi |
| `uprava@demo.local` | prof. dr. sc. Tomislav Perić | uprava (samo čitanje) | institucija | nakon prijave **Portfelj** (svi projekti, novac, rokovi, ljudi, prijave); pregled projekata i financija – troškovi osoblja u satima, bez iznosa po osobi |
| `admin@demo.local` | Nikola Radić | administrator stanara | institucija | korisnici i uloge (institucija i projekti), **Revizija** |

Uloge „na projektu” vrijede samo za taj projekt (WP1.14, `docs/sigurnost/AUTORIZACIJA.md`): voditelj BLUESENSE-a ne vidi ZELENI-LAB ni na popisu ni izravnom poveznicom. Voditelj prijave (WP1.14b) radi na vlastitoj prijavi i bez uloge institucije: Petra Horvat sama je unijela proračun AQUAREST-a, priložila nacrt Part B i pokrenula pripremu; predaju, ishod i ugovaranje evidentira ured.

**Plaće (WP1.19):** iznos troška osoblja (iz odobrenog timesheeta) vidi samo uloga s pristupom podacima o osoblju – `ured@`, `financije@`, `admin@`. `voditelj@`, `voditelj2@` i `uprava@` u **Troškovima**, **ZNS-u** i paketu za predaju vide sate po osobi i mjesecu i oznaku „skriveno” umjesto iznosa; zbrojeve po kategoriji (upravljanje proračunom) vide svi s pristupom financijama. Voditelj koji odlučuje o ZNS-u ne umanjuje pojedini trošak osoblja – to radi ured ili financije.

**Dvofaktorska prijava (WP1.19):** demo institucija **ne zahtijeva** MFA (demonstracija bez trenja). Postavku pokazuje `admin@demo.local` u **Korisnici → Obvezna dvofaktorska prijava** (nije obvezna / povlaštene uloge / svi); prije postrožavanja administrator sam uključi MFA u **Moj račun**. Nakon demonstracije `demo.cmd reset` vraća postavku. Nova produkcijska institucija zadano zahtijeva MFA za povlaštene uloge.

**Četiri oka (WP1.14b):** tko je predao timesheet, ne odobrava ga. Voditelji unose i predaju sate članova bez korisničkog računa (Marina Šimić, Ivana Marić), a odobrava ih ured za projekte; Lukine timesheetove (predaje ih sam) odobrava voditeljica.

## Što je u demo instituciji

| Područje | Sadržaj |
| --- | --- |
| Organizacije | vlastita (Pokazno sveučilište) + 6 partnera: DE, IT, ES, NL, SI, HR |
| Radar poziva | 6 vlastitih poziva: 2 × go (jedan završio ugovorom, jedan s prijavom u pripremi), 2 × pratimo, 1 × no-go s obrazloženjem, 1 zatvoren; ocjene prikladnosti i interni rokovi → popunjeni „Nadolazeći rokovi (60 dana)” |
| Paket po pozivu | `npoo-poziv-zdp-2025` nasljeđuje NPOO i mijenja izvještavanje na 6 mjeseci |
| **Portfelj** | početna stranica za ured, financije, upravu i administratora: 2 projekta u provedbi, ugovoreno (naš dio) ~1,01 mil. EUR od ~2,79 mil. EUR cijelih projekata, potrošeno ~21 % (uz nepriznato u odlukama o ZNS-u 2.165 EUR); ZELENI-LAB s oznakom „potrošnja kasni” (oprema nije nabavljena), isporuke koje kasne u oba projekta, visoki rizici, timesheetovi koji čekaju odobrenje (po jedan na svakom projektu), troškovi bez dokaza, razdoblje bez predanog ZNS-a, nepredan trošak iz ranijeg razdoblja; **Ušteda na ZNS-u** 40 % (polazna mjera 30 h, ZNS 1 pripremljen za 18 h); rokovi (3 prošla, ZNS RP2 za ~2 tjedna, rokovi poziva i prijave); opterećenje 5 osoba – Marina Šimić radi na oba projekta i ima dan s 10 h; prijave: 1 u pripremi, uspješnost 50 % (1 financirana, 1 odbijena) |
| **Revizija** | stranica za administratora i ured: tko je što i kada promijenio (odluke na radaru, prijave, proračuni, timesheetovi, ZNS, korisnici i uloge), filtri po razdoblju, korisniku, vrsti zapisa i radnji, „prije / poslije” i izvoz u CSV. Primjer promjene plaće: financije su Ivani Marić povećale godišnji trošak (45.000 → 46.800 EUR) – iznos vidi samo uloga s pristupom podacima o osoblju |
| **ZELENI-LAB** (NPOO) | **namjerno odstupanje od pravila programa**: na pregledu projekta „Odstupanja od pravila programa – Završetak projekta nakon 30. 6. 2026. (RRF krajnji rok 31. 8. 2026.)” – demo je relativan prema današnjem danu, a NPOO ima stvarni krajnji rok, pa projekt u 13. mjesecu nužno traje iza njega; pokazuje kako sustav upozorava na pravilo paketa (projekt je prihvaćen, upozorenje je vidljivo i računa se iznova). BLUESENSE i AQUAREST nemaju odstupanja; prošao cijeli put poziv → go → prijava → predaja → financirana → ugovorena; aktivan 13. mjesec; RP1: ZNS 1 predan i odlučen po trošku – elaborat umanjen (11.800 → 10.500 EUR), studijsko putovanje odbijeno (865 EUR), oba s razlogom; priznato ~44.000 od traženih ~46.200 EUR (nepriznato točno 2.165 EUR; iznosi osoblja ovise o datumu punjenja) i isplaćeno, uz upisanih 18 h pripreme i paket za predaju (ZIP: radna knjiga troškova, evidencije rada, dokazi); račun za najam termovizijske kamere (640 EUR) datiran u RP1, evidentiran nakon predaje ZNS-a 1; RP2 završio prošli mjesec, ZNS 2 u nacrtu s otvorenim stavkama provjere (Josipov timesheet za 12. mjesec čeka odobrenje ureda, brošure bez dokaza) i ponuđenim troškom iz ranijeg razdoblja; glavna oprema (120.000 EUR) nije nabavljena zbog žalbe u javnoj nabavi → isporuka D2.1 i prekretnica MS1 kasne, potrošnja 24 % uz 52 % proteklog vremena; 12 mjeseci timesheetova (Josip Barić, Marina Šimić) |
| **BLUESENSE** (Horizon Europe, RIA) | koordinator, 4 partnera, aktivan 11. mjesec; 5 radnih paketa, zadaci, isporuke (prihvaćene, predana, jedna kasni), prekretnice, rizici; zaključan proračun ~2,4 mil. EUR; tim od 4 osobe s godišnjim troškom (Marina Šimić od prošlog mjeseca i ovdje); 10 mjeseci timesheetova (jedan čeka odobrenje); 6 ručnih troškova s dokazima, jedan namjerno bez dokaza; ugovor (povjerljiv), sporazum o konzorciju i povjerljiva odluka o plaćama tima (vide je ured, voditeljica i financije, ne član tima) |
| **AQUAREST** (prijava, HE) | u pripremi iz odluke go: konzorcij od 5 članova (2 nisu potvrdila), 5 radnih paketa, djelomičan proračun → provjera spremnosti pokazuje otvorene stavke; proračun, nacrt Part B i prijelaz u pripremu unijela je voditeljica prijave (Petra Horvat, bez uloge institucije) |
| **PAMETNI-KAMPUS** (prijava, NPOO) | predana u prošlom krugu i odbijena (61/100) – za uspješnost prijava na portfelju |

Stvarni pozivi s portala EU Funding & Tenders nisu dio demoa (demo ne ovisi o mreži). Ako ih želiš prikazati: `docker compose -f infra/demo/docker-compose.yml exec app node dist/db/cli.js import-calls` (traži internet).

## Kako radi

- `node dist/db/cli.js demo [--reset] [--slug <oznaka>]` (API, `apps/api/src/demo/`). Pod vlasničkom vezom stvara samo stanara i prvog administratora (kao `seed`); sve ostalo puni kroz pravi API pod aplikacijskom ulogom (RLS), prijavljen kao demo korisnici – ista pravila, dozvole i revizijski zapis kao u sučelju.
- Idempotentno: postoji li dovršena demo institucija, ništa se ne mijenja. Prekinuto punjenje sljedeće pokretanje obriše i ponovi.
- Demo stanar nosi oznaku `settings.demo = true`. Naredba **odbija** dirati stanara bez te oznake, pa ni `--reset` ne može obrisati stvarnu instituciju. Reset briše samo retke s `tenant_id` demo stanara i njegove datoteke dokumenata; globalni paketi, pozivi i drugi stanari ostaju.
- Nikad se ne pokreće sama: `init` ne stvara demo račune. U produkcijskom načinu (`NODE_ENV=production`) naredba traži `ARQUS_DEMO=1`, koji postavlja samo demo compose.
- Lozinka: `DEMO_PASSWORD` ili zadana `Plavi-Jadran-2026` (mora zadovoljiti politiku lozinki).

Bez Dockera (razvoj): nakon `pnpm build` i migracija, u `apps/api`:
```bash
DATABASE_MIGRATE_URL=postgres://arqus:arqus@127.0.0.1:5432/arqus DATABASE_URL=postgres://arqus_app:arqus@127.0.0.1:5432/arqus node dist/db/cli.js demo
```
Razvojni `db:seed` od v0.25.0 stvara stanara `razvoj`, pa se oznaka `demo` ne sudara s demo institucijom. Ako u bazi već postoji stanar `demo` bez demo oznake (stari seed), naredba ga odbija – koristi `--slug pokazni` (prijava s oznakom `pokazni`, računi `ured@pokazni.local` …).

## Rješavanje problema

| Problem | Rješenje |
| --- | --- |
| „Docker Desktop nije pokrenut” | pokreni Docker Desktop, pričekaj zelenu oznaku „Engine running”, ponovi |
| Port 8080 nije dostupan (zauzet ili ga je Windows rezervirao: „bind: … forbidden by its access permissions”) | skripta sama proba 8080, 8081, 8088, 18080 i 28080 i ispiše adresu koju je odabrala; vlastiti port: `set ARQUS_DEMO_PORT=9000` pa `demo.cmd` (Linux/macOS: `ARQUS_DEMO_PORT=9000 scripts/demo.sh`) |
| Aplikacija se ne pokrene u 4 minute | `demo.cmd log`; najčešće je prva izgradnja slike spora ili nema mjesta na disku |
| Prijava ne uspijeva | oznaka institucije je `demo` (mala slova); nakon `reset` prijavi se ponovno (stare sesije su obrisane) |
| Datumi izgledaju stari | `demo.cmd reset` |
| Želim potpuno čisto stanje | `demo.cmd obrisi`, zatim `demo.cmd` |
| Nova verzija koda | `git pull`, zatim `demo.cmd` (slika se ponovno gradi) i `demo.cmd reset` |
