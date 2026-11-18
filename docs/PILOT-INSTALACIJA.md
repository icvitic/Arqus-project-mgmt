# Pilot-instalacija (WP1.9)

Jedan poslužitelj u EU s Dockerom: aplikacija (API + web u jednoj slici), PostgreSQL 16, Caddy (automatski HTTPS), sigurnosne kopije svakih sat vremena i njihova šifrirana kopija u S3 bucketu izvan poslužitelja. Dokumenti u volumenu ili u S3 bucketu. Neovisno o pružatelju (ADR-0009, ADR-0010, ADR-0012).

## 1. Poslužitelj
- Pružatelj s podatkovnim centrom u EU i ugovorom o obradi podataka (DPA, GDPR čl. 28). Kandidati: Hetzner (DE/FI), Scaleway (FR), OVHcloud (FR), ili hrvatski pružatelj. Cijene i uvjete provjeriti u trenutku narudžbe.
- Za pilot (do ~50 korisnika): 2 vCPU, 4 GB RAM, 40 GB SSD, Ubuntu 24.04 LTS, Docker Engine + Compose plugin.
- Vatrozid: otvoreni samo 22 (SSH, samo ključem), 80 i 443. Automatska sigurnosna ažuriranja OS-a (`unattended-upgrades`).
- DNS: A/AAAA zapis domene (npr. `pilot.arqus.hr`) prema poslužitelju.

## 2. Instalacija
```bash
git clone https://github.com/icvitic/arqus-project-mgmt && cd arqus-project-mgmt/infra/prod
```
```bash
cp .env.example .env
```
Popuniti `.env`: `DOMAIN`, `ACME_EMAIL`, a tajne generirati s `openssl rand -base64 36` (`DB_OWNER_PASSWORD`, `DB_APP_PASSWORD`, `AUTH_JWT_SECRET`, `MFA_ENCRYPTION_KEY`). Datoteka `.env` ne ide u git.
```bash
docker compose up -d --build
```
Pri svakom pokretanju aplikacija primijeni migracije, postavi lozinku aplikacijske uloge u bazi i osvježi globalne pakete programa. Provjera: `https://<domena>/api/health/ready` vraća `{"status":"ready"}`.

## 3. Prva institucija i administrator
```bash
docker compose exec -e SEED_TENANT_SLUG=fpz -e SEED_TENANT_NAME="Naziv institucije" -e SEED_ADMIN_EMAIL=admin@institucija.hr -e SEED_ADMIN_PASSWORD='<najmanje 12 znakova>' app node dist/db/cli.js seed
```
Nova institucija stvorena ovom naredbom (produkcijska slika, `NODE_ENV=production`) ima **obveznu dvofaktorsku prijavu za povlaštene uloge** (WP1.19). Administrator se prijavljuje oznakom institucije, e-adresom i lozinkom i odmah dobiva samo stranicu **Postavi dvofaktorsku prijavu** (treba mu aplikacija za autentikaciju na mobitelu: Microsoft ili Google Authenticator, Aegis, 1Password); dok MFA ne postavi, poslužitelj odbija sve osim vlastitog računa i odjave. Nakon toga u izborniku **Korisnici** poziva korisnike (e-adresa, ime, uloga – **bez lozinke**, WP1.21): korisnik na poveznici pozivnice sam bira lozinku. Naredba `seed` je jedini put kojim netko zadaje tuđu lozinku – samo za prvog administratora.

**Obvezni MFA** (izbornik **Korisnici → Obvezna dvofaktorska prijava**, mijenja samo administrator; promjena se bilježi u reviziju):

| Postavka | Za koga je MFA obvezan |
| --- | --- |
| Nije obvezna | ni za koga (zadano za postojeće instalacije i demo) |
| Obvezna za povlaštene uloge | tko na razini institucije ima `users:write`, `tenant:write`, `personnel:read`, `audit:read`, `finance:write` ili `*` – sistemski administrator, ured za projekte i financije (zadano za novu produkcijsku instituciju) |
| Obvezna za sve | svaki korisnik institucije |

Korisnik kojem je MFA obvezan, a nema ga, pri prvom sljedećem zahtjevu (i sa starim tokenom) ide na postavljanje MFA; ne može ga isključiti dok ga institucija zahtijeva. Izgubljen uređaj: administrator u **Korisnici** radi „reset MFA”, korisnik ga pri sljedećoj prijavi ponovno postavlja. Postojeće instalacije nakon nadogradnje na v0.27.0 zadržavaju „nije obvezna” – preporuka je odmah prijeći na „povlaštene uloge”.

### E-pošta (WP1.21)
Bez postavki aplikacija **ne šalje e-poštu** i sve radi: poveznicu pozivnice i poveznicu za novu lozinku administrator dobiva jednom (prozor s gumbom „Kopiraj”) i predaje je korisniku pouzdanim kanalom (osobno, telefonom, službenim chatom); „Zaboravljena lozinka?” tada upućuje na administratora; dnevnog sažetka nema. Za slanje (preporučeno za pilot) u `.env` upisati relay pružatelja e-pošte u EU:

| Varijabla | Značenje | Zadano |
| --- | --- | --- |
| `MAIL_TRANSPORT` | `off` ili `smtp` | `off` |
| `PUBLIC_URL` | javna adresa instalacije (`https://<domena>`); **jedini** izvor poveznica u porukama (nikad zaglavlje Host / X-Forwarded-*). Obvezna uz `smtp`; mora biti `https://` (`http://` samo za localhost), bez upita i fragmenta | – |
| `SMTP_HOST` | relay (npr. `smtp.pruzatelj.eu`) | – (obvezan uz `smtp`) |
| `SMTP_SECURITY` | `starttls` (port 587), `tls` (implicitni TLS, 465) ili `none` – **samo** lokalni testni poslužitelj, tada bez vjerodajnica | `starttls` |
| `SMTP_PORT` | port relaya | 587 / 465 / 25 prema `SMTP_SECURITY` |
| `SMTP_USER`, `SMTP_PASSWORD` | vjerodajnice (AUTH PLAIN ili LOGIN; šalju se samo kroz TLS) | prazno |
| `SMTP_TLS_CA_FILE` | PEM dodatnog CA ako relay ima certifikat vlastitog CA (sistemski CA-ovi ostaju; provjera certifikata i imena se ne može isključiti) | prazno |
| `SMTP_TIMEOUT_SECONDS`, `SMTP_RETRIES` | istek spajanja i svake razmjene; ponovni pokušaji samo privremenih grešaka | 20 / 2 |
| `MAIL_FROM`, `MAIL_FROM_NAME` | adresa i ime pošiljatelja (domena sa SPF i DKIM zapisima relaya) | – / `ArQus Projekti` |
| `MAIL_MAX_CONNECTIONS` | najviše istovremenih SMTP veza | 2 |
| `DIGEST_HOUR` | sat dnevnog sažetka u zoni institucije (radnim danom, najkasnije do 12:00) | 7 |
| `ACCOUNT_INVITE_TTL_HOURS`, `ACCOUNT_RESET_TTL_MINUTES` | valjanost pozivnice i poveznice za novu lozinku | 168 (7 dana) / 60 |

**Provjere pri pokretanju:** uz `MAIL_TRANSPORT=smtp` bez ispravnog `PUBLIC_URL` (https), `SMTP_HOST` ili `MAIL_FROM`, uz vjerodajnice i `SMTP_SECURITY=none`, nečitljiv `SMTP_TLS_CA_FILE` ili nepoznatu vrijednost aplikacija **odbija start** s porukom „Postavke e-pošte: …” (zapis kontejnera). Nakon pokretanja: **Korisnici → E-pošta → Pošalji probnu poruku sebi**; ista kartica pokazuje zadnje isporuke (bez sadržaja) i neuspjehe. Što se šalje: pozivnica, poveznica za novu lozinku, obavijest „lozinka je promijenjena” i dnevni sažetak (`docs/domena/moj-rad-i-obavijesti.md`, odj. 4) – ništa drugo. Sadržaj poruka se nigdje ne sprema.

Globalni pozivi s portala EU Funding & Tenders uvoze se automatski minutu nakon pokretanja, zatim svakih `FT_IMPORT_INTERVAL_HOURS` (zadano 24 h; ADR-0011). Ručno: `docker compose exec app node dist/db/cli.js import-calls`. Poslužitelj treba izlazni HTTPS prema `api.tech.ec.europa.eu`.

## 4. Pohrana dokumenata, sigurnosne kopije i obnova

### 4.1 Što radi bez ičega dodatnog
- Servis `backup` radi `pg_dump` svakih `BACKUP_INTERVAL_SECONDS` (zadano 3600 s → RPO 1 h) i briše kopije starije od `BACKUP_RETENTION_DAYS` (14) u Docker volumenu `backups`. Uz lokalnu pohranu dokumenata (volumen `documents`, ADR-0010) jednom dnevno radi i arhivu `documents-YYYYMMDD.tar.gz`.
- To **nije dovoljno**: kopije su na istom poslužitelju. Prije puštanja pilotu uključiti kopije izvan poslužitelja (4.3).

### 4.2 Bucketi kod pružatelja (S3)
Dva bucketa, svaki sa **zasebnim ključem koji ima prava samo na taj bucket** (čitanje, pisanje, popis, brisanje):

| Bucket | Za što | Gdje | Postavke kod pružatelja |
| --- | --- | --- | --- |
| `…-dokumenti` (neobavezno) | sadržaj dokumenata (`DOCUMENTS_STORAGE=s3`) | ista zona kao poslužitelj | privatan, **verzioniranje uključeno**, šifriranje na strani poslužitelja (ako ga pružatelj ne radi sam: `DOCUMENTS_S3_SSE=AES256`) |
| `…-kopije` | šifrirane kopije baze (i arhive dokumenata) | **druga zona ili drugi pružatelj** (npr. poslužitelj u Zagrebu, kopije u Beču) | privatan; preporuka: zaključavanje objekata (object lock) ili verzioniranje, da ni ukraden ključ ne može obrisati kopije |

Adresa (`…_S3_ENDPOINT`, npr. `https://sos-hr-zag-1.exo.io`) i regija su u dokumentaciji pružatelja. Većina pružatelja radi s `…_S3_FORCE_PATH_STYLE=true`; ako pružatelj traži adresu `https://<bucket>.<endpoint>`, postaviti `false`.

**Dokumenti u S3 (neobavezno).** Lokalni volumen je za pilot dovoljan. Prelazak na bucket (na živom sustavu, bez gubitka):
```bash
# 1. u .env upisati DOCUMENTS_S3_* (DOCUMENTS_STORAGE ostaje local), pa: docker compose up -d app
docker compose exec app node dist/db/cli.js documents migrate --to s3      # kopira sve, s provjerom hasha; može dok sustav radi
docker compose stop app
docker compose run --rm app node dist/db/cli.js documents migrate --to s3  # dokopira ono što je stiglo u međuvremenu
# 2. u .env DOCUMENTS_STORAGE=s3, zatim:
docker compose up -d app backup
docker compose exec app node dist/db/cli.js documents verify               # izlazni kod 0 = sve verzije su u bucketu
```
Izvor (volumen `documents`) se ne briše – obrisati ga ručno tek nakon nekoliko dana rada i uspješnog `documents verify`. Povratak: isto s `--to local`. `https://<domena>/api/health/ready` pokazuje `"storage":"ok"` kad je pohrana dostupna.

Što tada štiti dokumente: verzioniranje bucketa (vraćanje obrisane ili prepisane verzije kod pružatelja), `documents verify` (preporuka: tjedno, npr. cron na poslužitelju: `docker compose -f /…/infra/prod/docker-compose.yml exec -T app node dist/db/cli.js documents verify`) i po želji kopija u drugi bucket: `DOCUMENTS_MIRROR_S3_*` u `.env` i `documents migrate --to mirror` (idempotentno – svaki put kopira samo nove verzije). Dnevna arhiva volumena se tada ne radi.

### 4.3 Kopije izvan poslužitelja (obavezno prije pilota)
1. **Ključ za šifriranje kopija** (jednom, na poslužitelju):
   ```bash
   openssl rand -base64 32
   ```
   Upisati u `.env` kao `BACKUP_ENCRYPTION_KEY`. **Odmah** spremiti cijelu `.env` datoteku izvan poslužitelja – u upravitelj lozinki tvrtke (npr. Bitwarden, 1Password) i po mogućnosti ispis u zatvorenoj omotnici u sefu. **Izgubljen ključ = izgubljene kopije** (nitko ih, ni Arqus ni pružatelj, ne može dešifrirati). Ključ se nikad ne šalje e-poštom ni u razgovoru i ne mijenja se bez razloga (stare kopije ostaju čitljive samo starim ključem). Otisak ključa (za usporedbu sa spremljenom kopijom, nije tajna): `docker compose run --rm --no-deps --entrypoint node offsite dist/db/cli.js backup key-fingerprint`.
2. U `.env` upisati `BACKUP_S3_*` (bucket `…-kopije`) i `COMPOSE_PROFILES=offsite`, zatim `docker compose up -d`.
3. Provjera nakon 15–20 minuta:
   ```bash
   docker compose exec offsite node dist/db/cli.js backup status    # izlazni kod 0 = u redu
   docker compose ps                                               # offsite: healthy
   ```
Servis šalje svaku novu kopiju šifriranu (na poslužitelju, prije slanja) svakih 15 min i u bucketu čuva 30 dana (`BACKUP_OFFSITE_RETENTION_DAYS`; najnovija kopija uvijek ostaje). Neuspjeh: `[GREŠKA]` u `docker compose logs offsite`, `backup status` s izlaznim kodom 1 i `offsite` **unhealthy** u `docker compose ps` kad je zadnja uspješna kopija starija od 3 h (`BACKUP_OFFSITE_MAX_AGE_HOURS`). Preporuka: vanjski nadzor koji svakih sat vremena izvodi `backup status` i šalje obavijest. Shema i format: ADR-0012.

### 4.4 Obnova (novi poslužitelj, izgubljen poslužitelj)
Treba: poslužitelj s Dockerom, ovaj repozitorij, **`.env` iz sigurne kopije** (s `BACKUP_ENCRYPTION_KEY`, `BACKUP_S3_*`; zadržati i `MFA_ENCRYPTION_KEY`, inače korisnici moraju ponovno postaviti MFA) i pristup bucketu kopija.
```bash
git clone https://github.com/icvitic/arqus-project-mgmt && cd arqus-project-mgmt/infra/prod
# vratiti .env iz upravitelja lozinki
sh restore.sh                               # najnovija kopija
sh restore.sh 2026-11-17T09:30:00Z          # ili najnovija kopija do tog trenutka (npr. prije greške)
```
Skripta: digne bazu (odbija ako nije prazna), preuzme i dešifrira kopiju baze i arhivu dokumenata (provjera cjelovitosti; kriv ključ ili izmijenjena datoteka zaustavljaju obnovu), vrati bazu u jednoj transakciji, vrati dokumente (uz `DOCUMENTS_STORAGE=s3` su već u bucketu), pokrene sve servise, čeka spremnost i izvede `documents verify`. Na kraju ispiše ukupno vrijeme. Uz lokalnu pohranu `documents verify` nabroji dokumente učitane nakon zadnje dnevne arhive – njih treba zatražiti od korisnika ponovno. Zatim DNS na novi poslužitelj (ako se promijenio) i prijava.

Ručno, bez skripte: `docker compose run --rm --no-deps --user "$(id -u):$(id -g)" -v "$PWD/obnova:/obnova" --entrypoint node offsite dist/db/cli.js backup fetch --dir /obnova` preuzme i dešifrira najnoviju kopiju u `./obnova`. Pojedinačnu datoteku preuzetu iz bucketa dešifrira bilo koje računalo s Dockerom i slikom aplikacije, samo s ključem: `docker run --rm -e BACKUP_ENCRYPTION_KEY -v "$PWD:/w" --entrypoint node ghcr.io/icvitic/arqus-project-mgmt:latest dist/db/cli.js backup decrypt /w/<datoteka>.enc /w/<datoteka>` (uz `export BACKUP_ENCRYPTION_KEY=…`).

**Izmjereno** (lokalna proba 2026-11-17, ADR-0012): 17 s s demo podacima, 49 s s 1,2 GB baze i 1 GB dokumenata, 26 s kad su dokumenti u S3. Bez najma i postavljanja poslužitelja, Dockera, slike i DNS-a (realno 30–60 min ručnog rada) i uz lokalnu mrežu prema bucketu – cilj RTO 4 h ima veliku rezervu, ali broj treba potvrditi na pilot-poslužitelju.

### 4.5 Mjesečna proba obnove (obavezno)
Jednom mjesečno, na **zasebnom** poslužitelju ili računalu s Dockerom (nikad na produkcijskom – skripta traži praznu bazu):
1. klonirati repozitorij, vratiti `.env` iz upravitelja lozinki (provjerava i da je spremljena kopija ključa ispravna), u njoj `DOMAIN` na probnu vrijednost;
2. `sh restore.sh` i zapisati ukupno vrijeme;
3. prijaviti se, otvoriti projekt i preuzeti jedan dokument; `documents verify` bez nalaza;
4. zapisati u dnevnik rada: datum, kopija (naziv iz ispisa), vrijeme obnove, nalazi; zatim `docker compose --profile offsite down -v` i ugasiti probni poslužitelj.
Proba bez uspjeha = kopije se smatraju neispravnima dok se uzrok ne otkloni.

## 5. Nadogradnja
```bash
git pull && docker compose up -d --build
```
Migracije se primjenjuju automatski. Prije nadogradnje napraviti ručnu kopiju (`docker compose exec backup sh -c 'pg_dump -h db -U arqus -Fc -f /backups/prije-nadogradnje.dump arqus'`).

## 6. Prije puštanja pilotu
- [ ] Sigurnosni pregled prema `docs/sigurnost/ASVS-L2.md` – sve stavke „nedostaje” s visokim rizikom riješene ili prihvaćene.
- [ ] Penetracijski test vanjskog izvođača (uvjet faze 2) – opseg, testni računi i prihvaćena ograničenja: `docs/sigurnost/PENTEST-OPSEG.md`.
- [ ] Obvezni MFA najmanje „za povlaštene uloge” (Korisnici → Obvezna dvofaktorska prijava).
- [ ] E-pošta uključena (`MAIL_TRANSPORT=smtp`, `PUBLIC_URL`, SPF/DKIM domene pošiljatelja) i probna poruka stigla – inače administrator poveznice predaje ručno.
- [ ] DPA s pružateljem i ugovor o obradi s pilot-institucijom.
- [ ] Kopije izvan poslužitelja uključene (`COMPOSE_PROFILES=offsite`), `backup status` u redu, `.env` s `BACKUP_ENCRYPTION_KEY` spremljena izvan poslužitelja.
- [ ] Probna obnova iz kopije izvan poslužitelja na zasebnom poslužitelju (4.5), izmjereno vrijeme zapisano.
