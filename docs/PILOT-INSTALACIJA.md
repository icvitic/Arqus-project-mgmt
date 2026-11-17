# Pilot-instalacija (WP1.9)

Jedan poslužitelj u EU s Dockerom: aplikacija (API + web u jednoj slici), PostgreSQL 16, Caddy (automatski HTTPS) i sigurnosne kopije svakih sat vremena. Neovisno o pružatelju (ADR-0009).

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
Nova institucija stvorena ovom naredbom (produkcijska slika, `NODE_ENV=production`) ima **obveznu dvofaktorsku prijavu za povlaštene uloge** (WP1.19). Administrator se prijavljuje oznakom institucije, e-adresom i lozinkom i odmah dobiva samo stranicu **Postavi dvofaktorsku prijavu** (treba mu aplikacija za autentikaciju na mobitelu: Microsoft ili Google Authenticator, Aegis, 1Password); dok MFA ne postavi, poslužitelj odbija sve osim vlastitog računa i odjave. Nakon toga u izborniku **Korisnici** dodaje korisnike i uloge.

**Obvezni MFA** (izbornik **Korisnici → Obvezna dvofaktorska prijava**, mijenja samo administrator; promjena se bilježi u reviziju):

| Postavka | Za koga je MFA obvezan |
| --- | --- |
| Nije obvezna | ni za koga (zadano za postojeće instalacije i demo) |
| Obvezna za povlaštene uloge | tko na razini institucije ima `users:write`, `tenant:write`, `personnel:read`, `audit:read`, `finance:write` ili `*` – sistemski administrator, ured za projekte i financije (zadano za novu produkcijsku instituciju) |
| Obvezna za sve | svaki korisnik institucije |

Korisnik kojem je MFA obvezan, a nema ga, pri prvom sljedećem zahtjevu (i sa starim tokenom) ide na postavljanje MFA; ne može ga isključiti dok ga institucija zahtijeva. Izgubljen uređaj: administrator u **Korisnici** radi „reset MFA”, korisnik ga pri sljedećoj prijavi ponovno postavlja. Postojeće instalacije nakon nadogradnje na v0.27.0 zadržavaju „nije obvezna” – preporuka je odmah prijeći na „povlaštene uloge”.

Globalni pozivi s portala EU Funding & Tenders uvoze se automatski minutu nakon pokretanja, zatim svakih `FT_IMPORT_INTERVAL_HOURS` (zadano 24 h; ADR-0011). Ručno: `docker compose exec app node dist/db/cli.js import-calls`. Poslužitelj treba izlazni HTTPS prema `api.tech.ec.europa.eu`.

## 4. Sigurnosne kopije i obnova
- Servis `backup` radi `pg_dump` svakih `BACKUP_INTERVAL_SECONDS` (zadano 3600 s → RPO 1 h) i briše kopije starije od `BACKUP_RETENTION_DAYS` (14). Kopije su u Docker volumenu `backups`. Dokumenti (volumen `documents`, ADR-0010) arhiviraju se jednom dnevno u isti volumen (`documents-YYYYMMDD.tar.gz`).
- Izvan poslužitelja: dnevno sinkronizirati volumen u S3-kompatibilnu pohranu u EU drugog pružatelja (npr. `rclone sync`), šifrirano.
- Obnova (provjereno lokalno, v0.13.0):
```bash
docker compose exec backup sh -c 'createdb -h db -U arqus arqus_obnova && pg_restore -h db -U arqus -d arqus_obnova /backups/<datoteka>.dump'
```
Zatim u `.env` usmjeriti aplikaciju na obnovljenu bazu ili je preimenovati. Dokumenti: `docker compose run --rm -v arqus-pilot_documents:/d -v arqus-pilot_backups:/b app sh -c 'tar -xzf /b/documents-<datum>.tar.gz -C /d'`. Obnovu probati barem jednom mjesečno.

## 5. Nadogradnja
```bash
git pull && docker compose up -d --build
```
Migracije se primjenjuju automatski. Prije nadogradnje napraviti ručnu kopiju (`docker compose exec backup sh -c 'pg_dump -h db -U arqus -Fc -f /backups/prije-nadogradnje.dump arqus'`).

## 6. Prije puštanja pilotu
- [ ] Sigurnosni pregled prema `docs/sigurnost/ASVS-L2.md` – sve stavke „nedostaje” s visokim rizikom riješene ili prihvaćene.
- [ ] Penetracijski test vanjskog izvođača (uvjet faze 2) – opseg, testni računi i prihvaćena ograničenja: `docs/sigurnost/PENTEST-OPSEG.md`.
- [ ] Obvezni MFA najmanje „za povlaštene uloge” (Korisnici → Obvezna dvofaktorska prijava).
- [ ] DPA s pružateljem i ugovor o obradi s pilot-institucijom.
- [ ] Probna obnova iz kopije.
