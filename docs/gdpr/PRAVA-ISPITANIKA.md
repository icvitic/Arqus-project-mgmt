# Prava ispitanika u proizvodu ArQus Projekti (WP1.23, v0.33.0; evidencija zahtjeva WP1.24, v0.34.0)

> **Napomena.** Ovo je radni predložak koji je pripremio razvojni tim bez pravnog pregleda. Prije upotrebe ga mora provjeriti službenik za zaštitu podataka institucije ili pravnik. Opisuje kako se pojedino pravo tehnički provodi u proizvodu i gdje proizvod ne pomaže; ne odlučuje o tome postoji li pravo u konkretnom slučaju (to procjenjuje institucija kao voditelj obrade) i nije pravni savjet.

**Tko radi:** administrator institucije s dozvolom `privacy:manage` (sistemska uloga „Administrator stanara”; drugim ulogama se ne dodjeljuje). Izbornik **Osobni podaci**. Sve radnje se bilježe u revizijski zapis (tko, za koga, kada – ne sadržaj izvoza).

**Rok:** odgovor ispitaniku u pravilu u roku od mjesec dana od zaprimanja zahtjeva (čl. 12(3) GDPR-a). Od v0.34.0 proizvod vodi **evidenciju zahtjeva i rokova** – vidi odjeljak 0.

**Utvrđivanje identiteta podnositelja zahtjeva** provodi institucija izvan proizvoda (npr. zahtjev s poslovne e-adrese, osobno). Proizvod ne provjerava tko je podnio zahtjev.

## 0. Evidencija zahtjeva i rok za odgovor (WP1.24)
**Administrator:** Osobni podaci → **Zahtjevi i rokovi** → **Novi zahtjev…**
- Upisuje se: dan zaprimanja, na koje se pravo zahtjev odnosi, kako je zaprimljen, podnositelj i kontakt za odgovor, po potrebi sažetak, dan utvrđivanja identiteta i e-adresa korisničkog računa podnositelja. Zahtjev dobiva oznaku (`ZI-1`, `ZI-2`…).
- **Rok računa sustav:** mjesec dana od dana zaprimanja, kalendarski (zahtjev zaprimljen 20. 11. → rok 20. 12.; zaprimljen 31. 1. → rok zadnji dan veljače). Rok koji padne na subotu, nedjelju ili blagdan sustav **ne pomiče** na idući radni dan – prikazani rok je zato isti ili raniji od pravnog, nikad kasniji. Od kada rok teče u konkretnom slučaju (npr. tek nakon utvrđivanja identiteta) procjenjuje institucija; sustav uvijek računa od upisanog dana zaprimanja, a dan utvrđivanja identiteta samo bilježi.
- **Podsjetnik:** svaki otvoreni zahtjev je stavka u „Moj rad” onoga tko ima `privacy:manage` – „uskoro” u zadnjih 10 dana roka, „kasni” nakon njega – i ulazi u jutarnji sažetak e-poštom. Stavka nosi samo oznaku i vrstu zahtjeva, bez imena podnositelja. U osobni kalendar rokova zahtjevi ne ulaze.
- **Produlji rok…:** još dva mjeseca (ukupno tri od zaprimanja). Bilježi se razlog i dan kad je ispitanik obaviješten; obavijest nakon osnovnog roka sustav prihvaća, ali je označava zakašnjelom. Pogrešno upisano produljenje se poništava.
- **Zatvori…:** dan odgovora ispitaniku i ishod (udovoljeno, djelomično udovoljeno, odbijeno, povučen); uz odbijanje i djelomično udovoljenje obvezno je obrazloženje. Zahtjev zatvoren nakon roka ostaje tako označen. Pogrešno zatvoren zahtjev se ponovno otvara (rok ostaje isti).
- **Što evidencija nije:** ne šalje odgovor ispitaniku, ne provjerava identitet i ne odlučuje postoji li pravo. Samu radnju (izvoz, zatvaranje računa, anonimizaciju) administrator izvodi na kartici „Osoba” – evidencija bilježi da je zahtjev zaprimljen i kada je na njega odgovoreno.
- **Čuvanje:** zahtjev se kroz sučelje ne briše. Zatvoreni zahtjevi brišu se sami 1825 dana (5 godina) nakon zatvaranja (zadano, najmanje 365; Rokovi čuvanja → „Zatvoreni zahtjevi ispitanika”) – rok je prijedlog razvojnog tima, potvrđuje ga institucija. Otvoren zahtjev se ne briše. Zatvaranje računa podnositelja evidenciju ne briše.
- **Revizijski zapis** bilježi svaku radnju nad zahtjevom (tko, kada, vrsta, rokovi, ishod), ali ne i ime podnositelja, kontakt ni upisani tekst – revizija se čuva dulje od evidencije.
- **Izvoz podataka osobe** sadrži njezine zahtjeve samo ako ih je operater povezao s njezinim računom (sustav ih ne povezuje po imenu).

## Kako sustav pripisuje zapise jednoj osobi
1. **Korisnički račun** – jednoznačan (e-adresa unutar institucije).
2. **Zapisi člana tima povezani s računom** (`team_members.user_id`) – pripadaju osobi automatski.
3. **Zapisi člana tima bez računa** (npr. vanjski suradnik kojemu je voditelj unosio sate) – sustav ih **samo predlaže** kad se ime podudara (bez obzira na dijakritiku i velika slova). Operater ih pripisuje izričito, nakon provjere izvan sustava (ugovor, kadrovska evidencija). Isto ime nije dokaz iste osobe.
4. Zapis povezan s **drugim** računom ne može se pripisati (sustav odbija).

## 1. Pravo na pristup (čl. 15) i prenosivost (čl. 20)
**Administrator:** Osobni podaci → Pronađi osobu (ime ili e-adresa) → Odaberi → provjeri zapise i kandidate → **Preuzmi podatke osobe (ZIP)**.
- Sadržaj: `podaci.json` (strojno čitljivo, UTF-8), `podaci.xlsx` (isti podaci po listovima), `procitaj-me.html` (sažetak i pravila). Kategorije: račun, uloge, sesije (IP, preglednik), pozivnice/poveznice (bez tokena), kalendar (bez tokena), obavijesti, zahtjevi za ostvarivanje prava povezani s računom, isporuke e-pošte, dnevni sažetak, članstva u timovima, timesheetovi sa satima po danu, troškovi osoblja, odgovornosti, rizici, projekti i prijave koje osoba vodi, praćenje poziva, popis dokumenata koje je prenijela, revizijski zapis.
- **Treće osobe:** nisu u izvozu sati, iznosi ni imena drugih članova tima. Uz timesheet stoji ime osobe koja ga je odobrila (dio zapisa, kao na potpisanoj evidenciji rada). Revizijski zapis: zapisi kojima je osoba predmet – s promjenama, ali drugi korisnik je samo „drugi korisnik” (bez imena i IP-a), a vrijednosti koje identificiraju treće osobe zamijenjene su oznakom „[treća osoba]”; zapisi u kojima je osoba radila na tuđem zapisu – samo vrijeme, radnja, vrsta zapisa i njezina IP adresa, bez sadržaja.
- **Plaće:** godišnji trošak i iz njega izvedeni iznosi su osobni podatak osobe i ulaze u izvoz – ali **samo ako ga izrađuje netko tko i inače smije vidjeti plaće** (`personnel:read` na razini institucije). Inače su iznosi prazni i izvoz to izričito navodi. Tako izvoz ne otvara put do plaća onome tko ih ne smije vidjeti.
- **Dokumenti:** sadržaj datoteka nije u izvozu (mogu sadržavati podatke drugih osoba koje sustav ne vidi). Popis je u izvozu i na zaslonu; datoteke institucija predaje nakon pregleda (kartica „Dokumenti” projekta → Preuzmi).
- Izvoz je ograničen po korisniku (20 u 10 minuta), ne sprema se ni u predmemoriju preglednika (`no-store`).

**Samoposluga:** svaki korisnik u **Moj račun → Moji podaci → Preuzmi moje podatke (ZIP)**. Isti sadržaj i ista pravila. Iznosi plaće samo ako korisnik ima pristup podacima o plaćama (kao u sučelju); inače izvoz navodi da je potpun izvoz moguće zatražiti od institucije. *Odluka i obrazloženje:* samoposluga ne smije pokazati više nego sučelje – godišnji trošak u timu vidi samo uloga s pristupom plaćama, a osoba bez te uloge svoj trošak dobiva kroz zahtjev instituciji (koja ionako vodi obračun plaće).

## 2. Pravo na ispravak (čl. 16)
- **Ime i e-adresa računa:** administrator, Korisnici → (ime se mijenja; e-adresa se zasad ne mijenja – novi račun uz zatvaranje starog).
- **Ime i uloga člana tima, godišnji trošak:** voditelj projekta / financije na kartici „Tim i timesheetovi”.
- **Timesheet:** dok nije odobren, ispravlja ga osoba ili voditelj; odobren timesheet vraća se na doradu („Vrati na doradu”) ako nije u predanom zahtjevu.
- **Gdje proizvod ne pomaže:** podaci u **predanom ili odlučenom zahtjevu za nadoknadu** su nepromjenjivi (dokaz prema financijeru); ispravak ide kroz financijera i put „ispravak odluke” (samo priznati iznosi). Ispravak e-adrese računa nema zasebnu radnju.

## 3. Pravo na brisanje (čl. 17)
Brisanje je ograničeno obvezom čuvanja financijske dokumentacije projekta (pravila programa); proizvod zato radi u dva koraka:

**a) Zatvaranje računa (odmah, nepovratno)** – Osobni podaci → osoba → **Zatvori račun…** (razlog + upisano ime i prezime).
- Odmah nestaju: hash lozinke, MFA tajna, sve sesije (IP, preglednik), pozivnice i poveznice, token kalendara, obavijesti, zapisi dnevnog sažetka i isporuke pošte, uloge. E-adresa se zamjenjuje adresom `zatvoren-<id>@racun.invalid` – račun se ne može naći ni prijaviti (lozinka, postojeća sesija, poveznica, kalendar, zaboravljena lozinka – sve odbija; ponovna aktivacija nije moguća).
- **Ostaje:** id i ime i prezime (ime je na odobrenim timesheetovima drugih osoba, odlukama, projektima koje je vodila i u revizijskom zapisu – dokaz za zahtjeve koje financijer može provjeravati godinama), vrijeme i tko je zatvorio račun, te zapisi člana tima povezani s računom (do anonimizacije).

**b) Anonimizacija zapisa člana tima (nakon roka čuvanja projekta, nepovratno)** – Osobni podaci → osoba → zapis → **Anonimiziraj…**
- Pregled prije potvrde pokazuje točno što se mijenja: ime → pseudonim stabilan unutar projekta („Bivši član tima 1”), uloga u timu obrisana, veza s računom prekinuta, ime u opisu troškova osoblja zamijenjeno pseudonimom. Iznosi, sati, statusi, zahtjevi i zbrojevi ostaju isti (zahtjev i paket ZNS-a se i dalje slažu).
- **Rok:** dok traje rok čuvanja projekta (ili još nije počeo) anonimizacija se odbija s datumom kraja; moguća je samo uz zabilježen razlog (npr. zahtjev ispitanika koji je odobrio službenik za zaštitu podataka). Rok: Osobni podaci → Rokovi čuvanja → Rok čuvanja projekta.
- Potvrda traži upisano ime osobe i otisak pregleda (ako se podaci u međuvremenu promijene, traži se novi pregled).
- **Gdje proizvod ne pomaže:** slobodni tekst koji spominje ime (opis putnog naloga, bilješke zahtjeva, snimka predaje, naslovi dokumenata, rizici) sustav **samo navodi** za ručni pregled – predan zahtjev je nepromjenjiv. **Sadržaj datoteka** sustav ne vidi: pregled navodi dokumente koje je osoba prenijela, a institucija ih pregledava i briše ili zadržava. Ime zatvorenog računa ostaje i nakon anonimizacije zapisa člana tima (odobravatelj na tuđim zapisima). **Revizijski zapis se ne mijenja** – briše se tek po isteku vlastitog roka (`EVIDENCIJA-OBRADE.md`, odj. 6).

**c) Ostalo se briše samo od sebe** po rokovima čuvanja (posao čuvanja, `EVIDENCIJA-OBRADE.md`, odj. 3).

## 4. Pravo na ograničenje obrade (čl. 18)
- Najbliže što proizvod ima: **deaktivacija** računa (Korisnici → deaktiviraj) – osoba se ne prijavljuje, sesije i poveznice se gase, podaci ostaju nepromijenjeni; ponovna aktivacija moguća.
- **Gdje proizvod ne pomaže:** nema oznake „obrada ograničena” na zapisima člana tima ili timesheetovima koja bi spriječila daljnju upotrebu (npr. u novom zahtjevu za nadoknadu). Institucija to bilježi izvan sustava i upućuje voditelja projekta.

## 5. Pravo na prigovor (čl. 21)
- Proizvod nema posebnu radnju. Obrada u proizvodu služi provedbi projekata i dokazivanju troškova; o prigovoru odlučuje institucija. Ako prigovor bude prihvaćen, provodi se kroz zatvaranje računa, deaktivaciju ili (nakon roka) anonimizaciju.
- Prigovor na dnevni sažetak e-poštom: korisnik ga sam isključuje u Moj račun.

## 6. Automatizirano odlučivanje (čl. 22)
Proizvod ne donosi odluke o osobama automatizirano. Izračuni (trošak osoblja iz sati i godišnjeg troška) su aritmetika po pravilu programa koju provjerava čovjek.

## Gdje proizvod ne pomaže (sažetak)
- slanje odgovora ispitaniku i pomicanje roka s neradnog dana – evidencija zahtjeva (odj. 0) bilježi rok i ishod, odgovor šalje institucija;
- utvrđivanje identiteta podnositelja zahtjeva;
- sadržaj prenesenih datoteka (pregled ručno);
- ograničenje obrade na razini pojedinog zapisa;
- sigurnosne kopije (lokalno 14 dana, šifrirane izvan poslužitelja 30 dana) sadrže podatke do isteka svog roka – brisanje ili anonimizacija ne dopire u već napravljene kopije (`MJERE-ZASTITE.md`).
