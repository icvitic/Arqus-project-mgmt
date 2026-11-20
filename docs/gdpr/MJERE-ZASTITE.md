# Tehničke i organizacijske mjere zaštite (proizvod ArQus Projekti, v0.33.0)

> **Napomena.** Ovo je radni predložak koji je pripremio razvojni tim bez pravnog pregleda. Prije upotrebe (npr. kao prilog ugovoru o obradi, čl. 28(3)(c) i čl. 32 GDPR-a) ga mora provjeriti službenik za zaštitu podataka institucije ili pravnik. Navedene su samo mjere koje proizvod **ima**, svaka s mjestom gdje je provedena ili dokumentirana. Ono što ovisi o pružatelju smještaja (još nije odabran) ili o instituciji navedeno je odvojeno, kao neispunjeno ili tuđe. Dokument ne tvrdi da je proizvod „usklađen s GDPR-om”; samoprocjena sigurnosti: [`../sigurnost/ASVS-L2.md`](../sigurnost/ASVS-L2.md) (nije zamjena za penetracijski test, koji još nije proveden).

## 1. Povjerljivost

| Mjera | Kako | Gdje (provedba / dokaz) |
| --- | --- | --- |
| Odvojenost institucija u bazi | Row-Level Security s `FORCE` na svim tablicama, aplikacijska uloga bez `BYPASSRLS`, kompozitni strani ključevi `(tenant_id, …)` | migracije `apps/api/drizzle/0001…0032`; test `apps/api/test/rls.test.ts` |
| Kontrola pristupa po ulozi i projektu | svaka ruta ima točno jednu oznaku autorizacije; dozvole se računaju iz uloga pri svakom zahtjevu; nevidljiv projekt = 404 | `apps/api/src/identity/auth.guard.ts`, `common/access.ts`; test `route-coverage.e2e.test.ts`; [`AUTORIZACIJA.md`](../sigurnost/AUTORIZACIJA.md) |
| Plaće samo uz posebnu dozvolu | godišnji trošak i svaki iznos pripisiv radu jedne osobe samo uz `personnel:read`; i u izvozu podataka osobe | `apps/api/src/common/personnel.ts`, `privacy/subject-data.ts`; testovi `pentest-prep.e2e.test.ts`, `privacy.e2e.test.ts` |
| Zaštita podataka o osobi od drugih korisnika | obavijesti čita samo primatelj (RLS po korisniku); izvoz podataka osobe bez podataka trećih osoba | migracija 0027; `privacy/subject-data.ts` |
| Povjerljivi dokumenti | samo uz `documents:confidential`, inače nevidljivi | `documents/documents.service.ts` |
| Autentikacija | lozinke scrypt (N=2^15, sol); politika lozinki; TOTP MFA s tajnom šifriranom AES-256-GCM; obvezni MFA po postavci institucije (uključuje `privacy:manage`); ograničenje neuspjelih prijava | `identity/password.ts`, `identity/totp.ts`, `common/crypto-box.ts`, `identity/mfa-policy.ts`, `identity/login-throttle.ts` |
| Sesije | u bazi, provjera pri svakom zahtjevu, opoziv odmah (odjava, deaktivacija, zatvaranje računa, promjena lozinke/MFA), istek 8 h | `identity/identity.service.ts` (`sessionAccess`) |
| Tokeni izvan sesije | pozivnice, nove lozinke, kalendar: 256 bita iz CSPRNG-a, u bazi samo SHA-256, jednokratni ili opozivi | `identity/account.service.ts`, `me/calendar.service.ts` |
| Šifriranje u prijenosu | HTTPS (Caddy, TLS 1.2+/1.3, HSTS); SMTP samo preko TLS-a s provjerom certifikata | `infra/prod/Caddyfile`, `mail/smtp-client.ts` |
| Šifriranje kopija | kopije baze i dokumenata šifrirane na poslužitelju (AES-256-GCM) prije slanja izvan poslužitelja | `apps/api/src/backup/backup-crypto.ts`, ADR-0012 |
| Bez tajni u zapisima | revizijski zapis bez lozinki, hasheva, tokena (uklanjanje pri upisu i prikazu); zapis neuspjele prijave bez upisanog teksta | `audit/audit-redaction.ts` |

## 2. Cjelovitost

| Mjera | Kako | Gdje |
| --- | --- | --- |
| Revizijski zapis samo za dodavanje | aplikacija nema `UPDATE`/`DELETE`; okidač odbija izmjenu, brisanje i `TRUNCATE` i vlasniku; jedini put brisanja je funkcija s rokom i donjim granicama | migracije 0001 i 0032; test `privacy.e2e.test.ts` |
| Nepromjenjivost financijskih zapisa | odlučeni i izvan sustava potraživani troškovi nepromjenjivi (okidač); ispravak odluke i zamjena imena pri anonimizaciji jedine uske iznimke, obje revidirane u okidaču | migracije 0021, 0025, 0032 |
| Četiri oka | nitko ne odobrava timesheet koji je sam predao | `finance/timesheets.service.ts` |
| Istovremenost | obavezna revizija retka pri spremanju | `common/revision.ts` |
| Cjelovitost dokumenata | SHA-256 pri prijenosu, provjera pri izvozu i `documents verify` | `documents/document-storage.ts` |

## 3. Dostupnost i otpornost

| Mjera | Kako | Gdje |
| --- | --- | --- |
| Sigurnosne kopije | `pg_dump` svakih sat (lokalno 14 dana), šifrirana kopija izvan poslužitelja svakih 15 min (30 dana) | `infra/prod/backup.sh`, `apps/api/src/backup/offsite.ts`, ADR-0012 |
| Provjerena obnova | skriptirana obnova, izmjerena (17 s demo; 49 s s 1,2 GB baze) | `infra/prod/restore.sh`, `docs/PILOT-INSTALACIJA.md` odj. 4 |
| Glasan neuspjeh kopija | zapis, izlazni kod, `unhealthy`, `backup status` | ADR-0012 |

## 4. Smanjenje količine podataka i ograničenje pohrane

| Mjera | Kako | Gdje |
| --- | --- | --- |
| Rokovi čuvanja po vrsti podatka | dnevni posao briše sesije, istekle tokene, zapise pošte i sažetka, obavijesti, obrisane dokumente i istekle revizijske zapise; probno izvođenje; zaslon s brojevima | `privacy/retention.service.ts`, `privacy/retention-policy.ts`; [`EVIDENCIJA-OBRADE.md`](EVIDENCIJA-OBRADE.md) odj. 3 |
| Zatvaranje računa | vjerodajnice, sesije, tokeni, obavijesti i e-adresa odmah nestaju | `privacy/privacy.service.ts` (`close`) |
| Evidencija zahtjeva ispitanika i rok za odgovor (v0.34.0) | svaki zahtjev s danom zaprimanja; rok od mjesec dana (uz produljenje tri) računa sustav i pokazuje ga administratoru u „Moj rad” i dnevnom sažetku; ishod i dan odgovora; revizija bez imena podnositelja | `privacy/subject-requests.service.ts`, `packages/domain/src/subject-requests.ts`; test `subject-requests.e2e.test.ts` |
| Anonimizacija nakon roka | ime → pseudonim, veza s računom prekinuta, financijski zapis ostaje | `privacy/privacy.service.ts` (`anonymise`) |
| Što se ne sprema | sadržaj poslane e-pošte, datoteke uvoza iz Excela, upisani tekst neuspjele prijave | `mail/mail.service.ts`, `import/`, `identity/identity.service.ts` |

## 5. Prava ispitanika
Izvoz podataka osobe (administrator i samoposluga), zatvaranje računa, anonimizacija: [`PRAVA-ISPITANIKA.md`](PRAVA-ISPITANIKA.md).

## 6. Sigurnost razvoja

| Mjera | Gdje |
| --- | --- |
| Automatski testovi na svakom pull requestu (API, RLS, pokrivenost ruta, pokrivenost evidencije obrade, e2e u pregledniku s provjerom pristupačnosti) | `.github/workflows/ci.yml` |
| Provjera ovisnosti (`pnpm audit --prod --audit-level high` ruši CI) | `.github/workflows/ci.yml` |
| Validacija svakog ulaza (Zod), sigurnosna zaglavlja (CSP, nosniff, `no-store`), ograničenja izvoza po korisniku | `common/validation.ts`, `common/http-setup.ts`, `common/rate-limit.ts` |
| Evidencija obrade koja ne može tiho zastarjeti (test ruši novu osobnu tablicu ili stupac bez zapisa) | `apps/api/test/privacy-inventory.test.ts` |

## 7. Što proizvod NE osigurava (ovisi o pružatelju ili instituciji)
- **Pružatelj smještaja u EU** – nije odabran (ADR-0003, `docs/infrastruktura/usporedba-eu-pruzatelja.md`): fizička sigurnost, šifriranje diskova poslužitelja, certifikati pružatelja (npr. ISO/IEC 27001), mrežna zaštita. Upisuje se u ugovor o obradi nakon odabira.
- **Penetracijski test** – planiran, nije proveden (`docs/sigurnost/PENTEST-OPSEG.md`).
- **Organizacijske mjere institucije** – tko dobiva koju ulogu, obuka korisnika, postupak po zahtjevima ispitanika i incidentima, evidencija zahtjeva (proizvod je ne vodi), potvrda rokova čuvanja.
- **Kopije** već napravljene prije brisanja ili anonimizacije sadrže podatke do isteka roka kopija (14 / 30 dana).
- **Ograničenja u memoriji jedne instance** (prijave, izvozi) – s više instanci vrijede po instanci.
