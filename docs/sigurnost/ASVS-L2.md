# Sigurnosni pregled prema OWASP ASVS 4.0.3, razina 2 (WP1.9)

Stanje v0.14.0, kontrola pristupa (V4, V8) ažurirana u v0.21.0 (WP1.14). Oznake: **da** · **djelomično** · **nedostaje** · **n/p** (ne primjenjuje se). Ovo je samoprocjena tima, ne zamjena za penetracijski test.

| Područje | Zahtjev (sažeto) | Stanje | Dokaz / napomena |
| --- | --- | --- | --- |
| V1 Arhitektura | Izolacija stanara na razini baze | da | RLS s FORCE na svim tablicama, aplikacijska uloga bez BYPASSRLS, kompozitni FK; testovi `rls.test.ts` |
| V2.1 Lozinke | Min. duljina, česte lozinke, osobni podaci | da | `passwordIssues` (≥ 12, ≤ 128 znakova, bez pravila sastava, odbija česte riječi s dodanim brojevima, ponavljanja, nizove, ime/e-adresu/oznaku institucije) pri stvaranju, resetu i promjeni lozinke; provjera protiv velikog popisa probijenih lozinki (HIBP k-anonimnost) – nedostaje |
| V2.2.1 | Zaštita od pogađanja | da | 10 neuspjelih pokušaja / 15 min po računu, 100 po IP-u → 429; test `security.e2e.test.ts` |
| V2.4 Pohrana lozinki | Spori hash sa soli | da | scrypt N=2^15, sol 16 B, `timingSafeEqual` |
| V2.8 MFA | Višefaktorska prijava | da | TOTP (RFC 6238, testiran vektorima iz standarda), tajna šifrirana AES-256-GCM, zaštita od ponovne upotrebe koda, neuspjeli kodovi u ograničenju prijava i reviziji; obveznost MFA po ulozi – nedostaje |
| V3 Sesije | Istek, odjava, poništenje | da | sesija u bazi (`sessions`) provjerava se pri svakom zahtjevu; odjava, deaktivacija, reset lozinke i MFA opozivaju sesije; promjena i opoziv uloga (i na projektu) vrijede od idućeg zahtjeva |
| V4.1.1, V4.1.3 Kontrola pristupa | Provjera na poslužitelju, najmanje ovlasti | da | Dozvole se računaju pri svakom zahtjevu iz uloga (ne iz tokena). Uloga se dodjeljuje na razini institucije ili na projektu; uloga na projektu vrijedi samo za taj projekt (WP1.14, `docs/sigurnost/AUTORIZACIJA.md`) |
| V4.1.5 | Sigurno prema zadanome (deny by default) | da | Svaka ruta mora imati točno jednu oznaku autorizacije (javna / prijava / institucija / projekt / razriješen projekt / bilo koji opseg); ruta bez oznake odbija se za sve. Test `route-coverage.e2e.test.ts` popisuje sve rute i pada na nerazvrstanoj |
| V4.2.1 IDOR | Zaštita od izravnog pristupa tuđim objektima | da | Projekt bez pristupa = 404 (kao druga institucija); entitet iz putanje traži se zajedno s projektom iz putanje; id-jevi u tijelu provjeravaju se prema istom projektu; dokumenti razrješavaju vlasnika. Test `project-access.e2e.test.ts` (voditelj/član tima samo na A, financije i čitatelj institucije) i automatska provjera svih projektnih ruta s id-jevima projekta B; `loadProject` kao druga linija obrane |
| V4.1.2 / V4.3 | Zaštita od eskalacije, razdvajanje dužnosti | da | Bez `users:write` dodjeljuje se samo uloga čije dozvole dodjeljivač ima na projektu; nitko ne odobrava vlastiti timesheet; zaštita zadnjeg administratora. Pregled revizije u sučelju – WP1.14b |
| V4 (popisi) | Popisi i zbrojevi ne otkrivaju nedopušteno | da | `/projects` i popisi dokumenata samo s pristupom; povjerljivi dokumenti izostavljeni iz popisa i brojanja dokaza |
| V4 (baza) | Izolacija projekata i u bazi | djelomično | RLS izolira stanare; izolacija projekata unutar stanara provodi se u aplikaciji – politike po projektu u bazi nisu napravljene |
| V5 Validacija | Shema za svaki ulaz | da | Zod/ParseUUIDPipe na svim tijelima i parametrima; paketi JSON Schema 2020-12 |
| V5.3 Injekcije | Parametrizirani upiti | da | Drizzle/pg parametri; jedini dinamički SQL (`ALTER ROLE`) koristi `format(%L)` |
| V7 Zapisi | Revizija sigurnosnih događaja | da | `audit_entries` (append-only), login.ok/failed s IP-om |
| V8 Zaštita podataka | Bez osjetljivih podataka u odgovorima | djelomično | lozinke i MFA tajne nikad u odgovoru; godišnji trošak osoblja čita se, upisuje i mijenja samo uz `personnel:read` na projektu (ured, financije, administrator); povjerljivi dokumenti samo uz `documents:confidential` (inače 404, izostavljeni iz popisa). Nedostaje: iznosi troškova osoblja iz odobrenih timesheetova vidljivi su uz `finance:read` (iz njih se može izračunati satnica) |
| V9 Komunikacija | TLS, HSTS | da | Caddy (TLS 1.2+/1.3, automatski certifikati), HSTS 1 god. |
| V10 Zlonamjerni kod | Ovisnosti | da | lockfile u gitu; `pnpm audit --prod --audit-level high` ruši CI (v0.14.0: nadograđeni drizzle-orm 0.45 i zod 4 zbog dvije visoke ranjivosti) |
| V12 Datoteke | Prijenos datoteka | da | dokumenti (M9, v0.18.0): popis dopuštenih vrsta s provjerom potpisa, čišćenje naziva, ključ pohrane s poslužitelja, preuzimanje kao privitak uz `nosniff` i CSP `sandbox`, provjera SHA-256; pristup po projektu i povjerljivost od v0.21.0 |
| V13 API | Ograničenje veličine tijela, metode | da | JSON do 1 MB, samo potrebne metode po ruti |
| V14 Konfiguracija | Sigurnosna zaglavlja, tajne iz okruženja | da | CSP `default-src 'self'`, X-Frame-Options DENY, nosniff, Referrer-Policy; produkcija odbija start bez `AUTH_JWT_SECRET` ≥ 32 znaka i `DB_APP_PASSWORD`; kontejner kao neprivilegirani korisnik |
| — Sigurnosne kopije | RPO 1 h / RTO 4 h (ADR-0003) | djelomično | `pg_dump` svakih sat, obnova provjerena; izvanposlužiteljska kopija i mjerenje RTO-a – nedostaje |

## Prioriteti prije pilota
1. Izvanposlužiteljske šifrirane kopije i mjerenje RTO-a.
2. Obvezni MFA za uloge s pristupom financijama i administraciji (postavka stanara).
3. Provjera lozinki protiv HIBP popisa (k-anonimnost, bez slanja lozinke).
4. Vanjski penetracijski test (WP1.14 – pristup po projektu – je gotov; opseg testa: `docs/sigurnost/AUTORIZACIJA.md`).
5. Skrivanje iznosa troškova osoblja bez `personnel:read`; zaštita od istovremenog prepisivanja proračuna i pregled revizije u sučelju (WP1.14b).
