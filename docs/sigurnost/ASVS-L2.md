# Sigurnosni pregled prema OWASP ASVS 4.0.3, razina 2 (WP1.9)

Stanje v0.13.0. Oznake: **da** · **djelomično** · **nedostaje** · **n/p** (ne primjenjuje se). Ovo je samoprocjena tima, ne zamjena za penetracijski test.

| Područje | Zahtjev (sažeto) | Stanje | Dokaz / napomena |
| --- | --- | --- | --- |
| V1 Arhitektura | Izolacija stanara na razini baze | da | RLS s FORCE na svim tablicama, aplikacijska uloga bez BYPASSRLS, kompozitni FK; testovi `rls.test.ts` |
| V2.1 Lozinke | Min. duljina, bez zamjene znakova | djelomično | seed traži ≥ 12 znakova u produkciji; politika za korisnike koje stvara admin – nedostaje provjera duljine i popisa probijenih lozinki |
| V2.2.1 | Zaštita od pogađanja | da | 10 neuspjelih pokušaja / 15 min po računu, 100 po IP-u → 429; test `security.e2e.test.ts` |
| V2.4 Pohrana lozinki | Spori hash sa soli | da | scrypt N=2^15, sol 16 B, `timingSafeEqual` |
| V2.8 MFA | Višefaktorska prijava | nedostaje | WP1.2b (TOTP) |
| V3 Sesije | Istek, odjava, poništenje | djelomično | JWT 8 h, potpis HS256; nema poništenja tokena na poslužitelju (odjava samo u pregledniku) – WP1.2b |
| V4 Kontrola pristupa | Provjera na poslužitelju, najmanje ovlasti | da | `@RequirePermission` na svakoj ruti, vlastiti timesheet bez `timesheets:approve`, 404 za tuđe resurse |
| V5 Validacija | Shema za svaki ulaz | da | Zod/ParseUUIDPipe na svim tijelima i parametrima; paketi JSON Schema 2020-12 |
| V5.3 Injekcije | Parametrizirani upiti | da | Drizzle/pg parametri; jedini dinamički SQL (`ALTER ROLE`) koristi `format(%L)` |
| V7 Zapisi | Revizija sigurnosnih događaja | da | `audit_entries` (append-only), login.ok/failed s IP-om |
| V8 Zaštita podataka | Bez osjetljivih podataka u odgovorima | djelomično | lozinke nikad u odgovoru; godišnji trošak osoblja vidljiv svima s `timesheets:read` – razmotriti zasebnu dozvolu |
| V9 Komunikacija | TLS, HSTS | da | Caddy (TLS 1.2+/1.3, automatski certifikati), HSTS 1 god. |
| V10 Zlonamjerni kod | Ovisnosti | djelomično | lockfile u gitu; nedostaje automatski `pnpm audit`/Dependabot u CI-ju |
| V12 Datoteke | Prijenos datoteka | n/p | dokumenti (M9) još nisu implementirani |
| V13 API | Ograničenje veličine tijela, metode | da | JSON do 1 MB, samo potrebne metode po ruti |
| V14 Konfiguracija | Sigurnosna zaglavlja, tajne iz okruženja | da | CSP `default-src 'self'`, X-Frame-Options DENY, nosniff, Referrer-Policy; produkcija odbija start bez `AUTH_JWT_SECRET` ≥ 32 znaka i `DB_APP_PASSWORD`; kontejner kao neprivilegirani korisnik |
| — Sigurnosne kopije | RPO 1 h / RTO 4 h (ADR-0003) | djelomično | `pg_dump` svakih sat, obnova provjerena; izvanposlužiteljska kopija i mjerenje RTO-a – nedostaje |

## Prioriteti prije pilota
1. Politika lozinki pri stvaranju korisnika (≥ 12 znakova, provjera protiv popisa probijenih lozinki).
2. Poništenje tokena (popis opozvanih sesija ili kratki pristupni + osvježavajući token) i MFA (WP1.2b).
3. `pnpm audit --prod` i Dependabot u CI-ju.
4. Izvanposlužiteljske šifrirane kopije.
