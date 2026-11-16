# Sigurnosni pregled prema OWASP ASVS 4.0.3, razina 2 (WP1.9)

Stanje v0.14.0. Oznake: **da** · **djelomično** · **nedostaje** · **n/p** (ne primjenjuje se). Ovo je samoprocjena tima, ne zamjena za penetracijski test.

| Područje | Zahtjev (sažeto) | Stanje | Dokaz / napomena |
| --- | --- | --- | --- |
| V1 Arhitektura | Izolacija stanara na razini baze | da | RLS s FORCE na svim tablicama, aplikacijska uloga bez BYPASSRLS, kompozitni FK; testovi `rls.test.ts` |
| V2.1 Lozinke | Min. duljina, česte lozinke, osobni podaci | da | `passwordIssues` (≥ 12, ≤ 128 znakova, bez pravila sastava, odbija česte riječi s dodanim brojevima, ponavljanja, nizove, ime/e-adresu/oznaku institucije) pri stvaranju, resetu i promjeni lozinke; provjera protiv velikog popisa probijenih lozinki (HIBP k-anonimnost) – nedostaje |
| V2.2.1 | Zaštita od pogađanja | da | 10 neuspjelih pokušaja / 15 min po računu, 100 po IP-u → 429; test `security.e2e.test.ts` |
| V2.4 Pohrana lozinki | Spori hash sa soli | da | scrypt N=2^15, sol 16 B, `timingSafeEqual` |
| V2.8 MFA | Višefaktorska prijava | da | TOTP (RFC 6238, testiran vektorima iz standarda), tajna šifrirana AES-256-GCM, zaštita od ponovne upotrebe koda, neuspjeli kodovi u ograničenju prijava i reviziji; obveznost MFA po ulozi – nedostaje |
| V3 Sesije | Istek, odjava, poništenje | da | sesija u bazi (`sessions`) provjerava se pri svakom zahtjevu; odjava, deaktivacija, reset lozinke i MFA opozivaju sesije; promjena uloga vrijedi odmah |
| V4 Kontrola pristupa | Provjera na poslužitelju, najmanje ovlasti | da | `@RequirePermission` na svakoj ruti, vlastiti timesheet bez `timesheets:approve`, 404 za tuđe resurse |
| V5 Validacija | Shema za svaki ulaz | da | Zod/ParseUUIDPipe na svim tijelima i parametrima; paketi JSON Schema 2020-12 |
| V5.3 Injekcije | Parametrizirani upiti | da | Drizzle/pg parametri; jedini dinamički SQL (`ALTER ROLE`) koristi `format(%L)` |
| V7 Zapisi | Revizija sigurnosnih događaja | da | `audit_entries` (append-only), login.ok/failed s IP-om |
| V8 Zaštita podataka | Bez osjetljivih podataka u odgovorima | da | lozinke i MFA tajne nikad u odgovoru; godišnji trošak osoblja samo uz dozvolu `personnel:read` (ured za projekte, financije, administrator) |
| V9 Komunikacija | TLS, HSTS | da | Caddy (TLS 1.2+/1.3, automatski certifikati), HSTS 1 god. |
| V10 Zlonamjerni kod | Ovisnosti | da | lockfile u gitu; `pnpm audit --prod --audit-level high` ruši CI (v0.14.0: nadograđeni drizzle-orm 0.45 i zod 4 zbog dvije visoke ranjivosti) |
| V12 Datoteke | Prijenos datoteka | n/p | dokumenti (M9) još nisu implementirani |
| V13 API | Ograničenje veličine tijela, metode | da | JSON do 1 MB, samo potrebne metode po ruti |
| V14 Konfiguracija | Sigurnosna zaglavlja, tajne iz okruženja | da | CSP `default-src 'self'`, X-Frame-Options DENY, nosniff, Referrer-Policy; produkcija odbija start bez `AUTH_JWT_SECRET` ≥ 32 znaka i `DB_APP_PASSWORD`; kontejner kao neprivilegirani korisnik |
| — Sigurnosne kopije | RPO 1 h / RTO 4 h (ADR-0003) | djelomično | `pg_dump` svakih sat, obnova provjerena; izvanposlužiteljska kopija i mjerenje RTO-a – nedostaje |

## Prioriteti prije pilota
1. Izvanposlužiteljske šifrirane kopije i mjerenje RTO-a.
2. Obvezni MFA za uloge s pristupom financijama i administraciji (postavka stanara).
3. Provjera lozinki protiv HIBP popisa (k-anonimnost, bez slanja lozinke).
4. Vanjski penetracijski test.
