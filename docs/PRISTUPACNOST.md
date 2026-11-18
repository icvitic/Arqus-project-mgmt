# Pristupačnost sučelja – izvještaj o sukladnosti s WCAG 2.1 (WP1.22)

**Proizvod:** ArQus Projekti (web sučelje `apps/web`) · **Verzija:** 0.32.0 · **Datum procjene:** 18. 11. 2026. · **Mjerilo:** WCAG 2.1, razine A i AA (u EU kroz normu EN 301 549, poglavlje 9 – web), koju za tijela javnog sektora traži Zakon o pristupačnosti mrežnih stranica i programskih rješenja za pokretne uređaje tijela javnog sektora (prijenos Direktive (EU) 2016/2102).

> **Ovo je samoprocjena.** Napravljena je automatskim i skriptiranim provjerama u pregledniku te pregledom koda. **Nijednu pomoćnu tehnologiju (čitač zaslona, glasovno upravljanje, povećalo) nije koristila osoba, i sučelje nije testirao korisnik s invaliditetom.** Izvještaj zato ne tvrdi sukladnost; tvrdi samo ono što je provjereno i kako. **Preporučeni sljedeći korak je neovisna revizija** (i prolaz čitačem zaslona NVDA i VoiceOver koji radi osoba – `docs/STATUS.md`), prije nego se tvrdnja o pristupačnosti upotrijebi u natječaju.

## 1. Metoda

| Provjera | Kako | Što pokriva |
| --- | --- | --- |
| **axe-core 4.14.0** (automatski) | u e2e testu u pregledniku (`apps/web/e2e/a11y.cjs`, Playwright + Chromium) na svakom stanju zaslona koje tok dosegne – 46 stanja: prijava, zaboravljena lozinka (obrazac i odgovor), prihvaćanje pozivnice (i s greškom u obrascu), nova lozinka, nevaljana poveznica, MFA kod, Moj rad (član tima, voditelj, prazno stanje), portfelj (prazan i s podacima), radar (popis, novi poziv, poziv), prijave (popis, prijava), projekti, sve kartice projekta (pregled, struktura, proračun, tim i timesheet, troškovi, dokazi, ZNS nacrt i odlučen, ugovoreno/ostvareno, dokumenti, uvoz s greškama po retku, pristup), struktura kako je vidi odgovorna osoba, korisnici, dijalog s poveznicom, moj račun i postavljanje MFA, obvezni MFA, revizija, paketi (popis, novi, pojedinosti), organizacije, otvoren izbornik obavijesti, obavijest o sukobu izmjena, evidencija za ispis | pravila s oznakama `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`; svako stanje u **svijetloj i tamnoj temi** (`prefers-color-scheme`) i na **1400 px i 390 px** (182 provjere po prolazu). Nalaz utjecaja *serious* ili *critical* **ruši e2e** (i CI) |
| **Skriptirane provjere** (isti test) | Playwright: tipkovnica (`Tab`, `Shift+Tab`, `Enter`, strelice, `Home`, `End`, `Escape`), izračunati stilovi, DOM | jedan `h1` i razine naslova bez preskoka; `lang="hr"`; naslov dokumenta po ruti i jedinstven među zaslonima; orijentiri (zaglavlje, izbornik s nazivom, jedan `main`); „Preskoči na sadržaj” prvi u redoslijedu tipke Tab i premješta fokus; područje `aria-live`; **preljev na 320 CSS px** bez vodoravnog pomicanja stranice (na svakom stanju); **vidljiv fokus** (obrub ≥ 2 px) na svakom zaustavljanju u tokovima tipkovnicom; fokus na naslov nakon promjene stranice; dijalog: fokus pri otvaranju u dijalogu, 12× `Tab` i `Shift+Tab` ne izlaze, `Escape` zatvara, fokus se vraća na gumb koji ga je otvorio; kartice projekta po obrascu ARIA (strelice, `Home`, jedna kartica u redoslijedu tipke Tab); izbornik obavijesti (`Enter` otvara, `Escape` zatvara i vraća fokus na zvonce) |
| **Tokovi samo tipkovnicom** (skriptirano) | bez miša, od učitavanja stranice | prijava; član tima iz „Moj rad” otvara timesheet, upisuje sate, sprema i predaje; voditeljica iz „Moj rad” otvara i odobrava timesheet; financije otvaraju karticu ZNS, zahtjev i redak popisa troškova osoblja; administrator popunjava pozivnicu (i odabir projekta strelicama) i šalje je |
| **Pregled koda i boja** | ručno, uz izračun kontrasta | stanja koja axe ne vidi: zadržavanje pokazivača, fokus, odabrano, onemogućeno, oznake statusa (chip), značke, trake potrošnje na portfelju; ostali kriteriji iz tablice ispod |

**Polazište** (prije ispravaka, isti tok, axe 4.14.0, 45 stanja × do 4 varijante = 178 provjera): 2 pravila, oba *serious* – `color-contrast` 1.535 elemenata u 67 provjera na 28 stanja (zelena i narančasta boja oznaka statusa i siva pomoćna boja na pozadini oznaka u svijetloj temi – 4,45–4,46 : 1; zadana plava boja poveznica u tamnoj temi – 1,8 : 1) i `scrollable-region-focusable` 12 elemenata u 8 provjera (tablice koje se pomiču vodoravno nisu bile dostupne tipkovnicom). Skriptirane provjere tada nisu postojale; nakon uvođenja na prvom prolazu: nedostajali su poveznica za preskakanje, naziv izbornika, naslov dokumenta po ruti, područje `aria-live`, a četiri stanja su na 320 px imala vodoravno pomicanje stranice.

**Stanje nakon ispravaka (v0.32.0):** axe – **0 nalaza** (ni manjeg utjecaja) u 182 provjere; skriptirane provjere – **0 nalaza**. Brojke se ponavljaju pri svakom pokretanju (`apps/web/e2e/run-local.sh`, posao `e2e-browser` u CI-ju).

## 2. Kriteriji uspjeha

Oznake: **Podržava** · **Djelomično** · **Ne podržava** · **N/P** (ne primjenjuje se).

| Kriterij | Razina | Stanje | Osnova |
| --- | --- | --- | --- |
| 1.1.1 Netekstualni sadržaj | A | Podržava | axe (`image-alt`, `svg-img-alt`, `button-name`); ikona zvonca skrivena, gumb ima naziv; trake potrošnje skrivene uz brojčanu vrijednost; točka „nepročitano” ima skriveni tekst |
| 1.2.1–1.2.5 Vremenski mediji | A/AA | N/P | sučelje nema zvuka ni videa |
| 1.3.1 Informacije i odnosi | A | Djelomično | naslovi, orijentiri, oznake polja (`label for`), zaglavlja tablica s `scope` i naziv tablice – skriptirano i axe; **ali** opseg zaglavlja i naziv tablice postavlja zajednički pomoćnik u pregledniku (`useAccessibleTables`), ne izravno u oznakama, a greške poslužitelja nisu programski vezane uz polje |
| 1.3.2 Smislen redoslijed | A | Podržava | redoslijed DOM-a = vizualni; tokovi tipkovnicom |
| 1.3.3 Osjetilne značajke | A | Podržava | upute ne ovise o obliku ni položaju (pregled teksta) |
| 1.3.4 Orijentacija | AA | Podržava | bez zaključavanja orijentacije; provjera na 390 i 320 px |
| 1.3.5 Prepoznavanje svrhe unosa | AA | Podržava | `autocomplete` na prijavi (`organization`, `username`, `current-password`, `one-time-code`), novoj lozinci i promjeni lozinke (`new-password`), ponovnoj prijavi |
| 1.4.1 Uporaba boje | A | Podržava | status, hitnost, prekoračenje i provjera uvijek i riječima (oznake „kasni 3 d”, „potrošnja ispred vremena +25 p. b.”, „neaktivan/na u timu”); vikend u timesheetu i nazivom (skriveni tekst i opis) |
| 1.4.2 Upravljanje zvukom | A | N/P | nema zvuka |
| 1.4.3 Kontrast (minimum) | AA | Podržava | axe u obje teme na svim stanjima; stanja izvan axea izračunom: pomoćni tekst 5,3–5,9 : 1, oznake statusa 5,8 : 1 (svijetla) i ≥ 5,5 : 1 (tamna), odabrana stavka izbornika i kartice tekst u boji teksta; onemogućeni elementi izuzeti |
| 1.4.4 Promjena veličine teksta | AA | Podržava | povećanje preglednika do 200 % = širina 700 px (provjereno na 390 i 320 px bez gubitka sadržaja); veličine su u px, pa samo „veličina fonta” u postavkama Chromea (bez povećanja) ne mijenja tekst |
| 1.4.5 Slike teksta | AA | Podržava | nema slika teksta |
| 1.4.10 Preljev | AA | Podržava | skriptirano na 320 px na svakom stanju: stranica se ne pomiče vodoravno; tablice (timesheet po danima, proračun, ZNS, portfelj) pomiču se unutar vlastitog označenog područja dostupnog tipkovnicom (axe `scrollable-region-focusable`) |
| 1.4.11 Kontrast netekstualnog sadržaja | AA | Podržava | obrub polja za unos 3,4–3,6 : 1 (svijetla) i 4,4 : 1 (tamna); obrub fokusa u boji naglaska ≥ 5 : 1; ispune traka ≥ 3 : 1 prema podlozi; sekundarni gumbi prepoznaju se po tekstu (dopušteno tumačenjem kriterija) |
| 1.4.12 Razmak teksta | AA | Djelomično | rasporedi su fleksibilni (bez fiksnih visina), ali nije skriptirano; opis projekta i programa na portfelju namjerno je skraćen na dva retka (`.clamp`) – puni naslov je na projektu |
| 1.4.13 Sadržaj pri zadržavanju ili fokusu | AA | Podržava | jedini takav sadržaj su izvorni opisi preglednika (`title`); izbornik obavijesti otvara se klikom/`Enter`, zatvara `Escape` |
| 2.1.1 Tipkovnica | A | Podržava | skriptirani tokovi samo tipkovnicom (odj. 1); retci tablica koji se otvaraju klikom imaju poveznicu u prvom stupcu; prilagođene kontrole (kartice, dijalog, izbornik obavijesti) po uobičajenim obrascima; nisu svi zasloni prođeni skriptom (odj. 3) |
| 2.1.2 Bez zamke za tipkovnicu | A | Podržava | dijalog zadržava fokus dok je otvoren (namjerno, s `Escape`), ostalo skriptirano |
| 2.1.4 Prečaci jednim znakom | A | N/P | nema prečaca |
| 2.2.1 Prilagodljivo vrijeme | A | Djelomično | prijava vrijedi 8 h bez upozorenja i bez produljenja; nakon isteka upisano ostaje na zaslonu i nastavlja se nakon ponovne prijave istog računa (dijalog „Sesija je istekla”) – podaci se ne gube, ali se vrijeme ne može produljiti unaprijed |
| 2.2.2 Pauziranje, zaustavljanje, skrivanje | A | Podržava | nema pokretnog ni trepćućeg sadržaja; brojke značke osvježavaju se tiho |
| 2.3.1 Tri bljeska | A | Podržava | nema bljeskanja |
| 2.4.1 Zaobilaženje blokova | A | Podržava | „Preskoči na sadržaj” i orijentiri – skriptirano |
| 2.4.2 Naslov stranice | A | Podržava | naslov po ruti („Proračun – BLUESENSE – ArQus Projekti”) – skriptirano, jedinstven među zaslonima |
| 2.4.3 Redoslijed fokusa | A | Podržava | fokus na naslov nakon promjene stranice, u dijalog i natrag, gumbi tijekom slanja ne gube fokus (`aria-disabled`) – skriptirano |
| 2.4.4 Svrha poveznice (u kontekstu) | A | Podržava | poveznice nose naslov stavke; pregled |
| 2.4.5 Više načina | AA | Podržava | izbornik, „Moj rad”, portfelj (rokovi), obavijesti, pretraga i filtri na radaru |
| 2.4.6 Naslovi i oznake | AA | Podržava | pregled; skriptirana struktura naslova |
| 2.4.7 Vidljivi fokus | AA | Podržava | obrub u boji naglaska na svakom interaktivnom elementu u obje teme; skriptirano na svakom zaustavljanju u tokovima tipkovnicom |
| 2.5.1 Pokreti pokazivača | A | N/P | nema pokreta po putanji ni više dodira |
| 2.5.2 Poništavanje pokazivača | A | Podržava | standardni klik (aktivacija pri otpuštanju) |
| 2.5.3 Oznaka u nazivu | A | Podržava | gdje je naziv dulji od vidljivog teksta (zvonce, „→ predana”, račun), naziv sadrži vidljivi tekst |
| 2.5.4 Aktiviranje pokretom | A | N/P | nema |
| 3.1.1 Jezik stranice | A | Podržava | `lang="hr"` – skriptirano |
| 3.1.2 Jezik dijelova | AA | Djelomično | nazivi poziva s portala EU Funding & Tenders i dijelovi paketa programa su na engleskom bez oznake `lang="en"` |
| 3.2.1 Pri fokusu | A | Podržava | fokus ne mijenja kontekst |
| 3.2.2 Pri unosu | A | Djelomično | ne mijenja se kontekst, ali neki padajući izbornici spremaju odmah pri promjeni (status i odgovorna osoba u strukturi, uloga u Korisnicima): strelicom kroz zatvoren izbornik svaki korak sprema |
| 3.2.3 Dosljedna navigacija | AA | Podržava | isto zaglavlje i izbornik na svim zaslonima |
| 3.2.4 Dosljedna identifikacija | AA | Podržava | zajedničke komponente (`ui.tsx`) |
| 3.3.1 Prepoznavanje grešaka | A | Djelomično | greške su tekstom, najavljuju se (`role="alert"`), obvezna polja provjerava preglednik (`required`); greške poslužitelja prikazuju se na vrhu obrasca, ne uz polje |
| 3.3.2 Oznake ili upute | A | Podržava | svako polje ima oznaku (axe `label`); uputa je opis polja (`aria-describedby`) |
| 3.3.3 Prijedlog ispravka | AA | Djelomično | poruke uglavnom kažu što ispraviti („Sati u obliku 7,5”, pravila lozinke), ne sve |
| 3.3.4 Sprječavanje grešaka (pravne, financijske, podaci) | AA | Podržava | predaja ZNS-a s popisom za provjeru, potvrda nepovratnih radnji, povrat timesheeta i ZNS-a, zaštita od tihog prepisivanja (revizije) |
| 4.1.1 Raščlanjivanje | A | Podržava | axe (`duplicate-id*`); u WCAG 2.2 kriterij je ukinut |
| 4.1.2 Naziv, uloga, vrijednost | A | Podržava | axe; kartice (`tab`, `aria-selected`, `aria-controls`), dijalozi (`aria-modal`, naziv), izbornik obavijesti (`aria-expanded`, `aria-controls`), trenutna stranica (`aria-current`) |
| 4.1.3 Statusne poruke | AA | Podržava | jedno područje `aria-live` za spremljeno, predano, neuspjelo, kopirano, ponovnu prijavu; učitavanje `role="status"`; greške `role="alert"` |

**Zbroj (50 kriterija razina A i AA):** 34 podržava, 7 djelomično, 0 ne podržava, 9 N/P (1.2.1–1.2.5 su pet kriterija u jednom retku).

## 3. Poznata ograničenja

- **Bez pomoćne tehnologije i bez korisnika.** Čitač zaslona, glasovno upravljanje i povećalo nije koristila osoba; ništa nije testirao korisnik s invaliditetom. axe i skripte ne vide kako se sučelje *izgovara* ni je li redoslijed smislen slušatelju.
- **Djelomično podržani kriteriji** – tablica, odj. 2: 1.3.1 (opseg i naziv tablica postavlja pomoćnik u pregledniku; greške poslužitelja nisu vezane uz polje), 1.4.12 (nije skriptirano; skraćeni opisi na portfelju), 2.2.1 (8 h bez produljenja), 3.1.2 (engleski nazivi bez oznake jezika), 3.2.2 (izbornici koji spremaju pri promjeni), 3.3.1 i 3.3.3 (greške poslužitelja).
- **Pokrivenost.** Skriptom su prođeni glavni tokovi i ≈ 46 stanja zaslona; rijetka stanja (npr. ispravak odluke o ZNS-u, JSON način paketa, verzije dokumenata, svi koraci prijave na poziv) provjerena su samo kroz zajedničke komponente.
- **Sadržaj izvan sučelja.** Preuzete datoteke (XLSX, ZIP paket ZNS-a, HTML evidencija rada za ispis, CSV revizije) i e-poruke nisu provjerene kao pristupačni dokumenti. Evidencija rada prikazuje se u okviru (`iframe` s naslovom); njezin sadržaj nije prošao axe.
- **Preglednici.** Automatske provjere rade u Chromiumu; Firefox i Safari (VoiceOver) nisu provjereni.
- **Pokazivač.** Ciljevi su uobičajene veličine gumba i poveznica; WCAG 2.1 AA nema zahtjev za veličinu cilja (2.5.5 je AAA, 2.5.8 je WCAG 2.2) – tekstualni gumbi („Natrag”, „Sakrij”) su manji od 24 px po visini.

## 4. Izjava o pristupačnosti

Sučelje ima stranicu **Pristupačnost** (`#/pristupacnost`, poveznica u podnožju, dostupna i bez prijave): čemu proizvod teži, poznata ograničenja jednostavnim jezikom i kako prijaviti prepreku – administratoru institucije i na kontakt koji postavlja instalacija (`ACCESSIBILITY_CONTACT`, `infra/prod/.env.example`; bez njega stranica upućuje samo na administratora). To je **izjava proizvoda**. **Institucija, kao tijelo javnog sektora, odgovara za vlastitu zakonsku izjavu o pristupačnosti** (sadržaj i obrazac propisuje Zakon i Provedbena odluka Komisije (EU) 2018/1523, uključujući postupak praćenja i nadzorno tijelo); ova stranica i ovaj izvještaj daju joj podlogu.

## 5. Što je promijenjeno (WP1.22)

Ispravci su u zajedničkim dijelovima (`apps/web/src/ui.tsx`, `styles.css`, `App.tsx`), pa vrijede za svaki zaslon:

- boje: tamnija zelena, narančasta i pomoćna siva u svijetloj temi; poveznice u boji naglaska i u tamnoj temi; obrub polja za unos s kontrastom ≥ 3 : 1; vidljiv fokus na svim interaktivnim elementima; `prefers-reduced-motion`;
- struktura: „Preskoči na sadržaj”, izbornik s nazivom, `main` s fokusom, podnožje, naslov dokumenta po ruti, fokus na naslov nakon promjene stranice, `aria-current`;
- komponente: `Field` (oznaka `for` i uputa kao opis), `Dialog` (fokus, zadržavanje, `Escape`, povratak fokusa), `TabList`/`TabPanel` (obrazac ARIA „tabs”), `Announcer`/`announce` (statusne poruke), `useAccessibleTables` (označena pomična područja i nazivi tablica), `ActionForm`/`ActionButton` (`aria-disabled` umjesto `disabled` tijekom slanja – fokus se ne gubi; najava ishoda; naziv gumba), `Loading` (`role="status"`), izbornik obavijesti (`aria-controls`, `Escape` vraća fokus, skriveni tekst „nepročitano”);
- istek sesije: dijalog ponovne prijave istog računa umjesto prelaska na prijavu – upisano ostaje (`pages/Reauth.tsx`);
- pojedini zasloni: poveznice u retcima tablica (projekti, prijave, radar, paketi, portfelj), pomični okvir tablice rokova na radaru i partnera na pregledu projekta, putanja (`nav`) na projektu, vikend u timesheetu nazivom, nazivi gumba za oduzimanje uloge, prazna zaglavlja tablica.
