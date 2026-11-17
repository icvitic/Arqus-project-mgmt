# Uvoz postojećeg projekta iz Excela (WP1.17, v0.29.0)

Projekt koji je već u tijeku unosi se u ArQus iz tablice, bez prepisivanja: radni paketi, isporuke i prekretnice, proračun, tim i troškovi – i troškovi koji su već bili u zahtjevima za nadoknadu (ZNS) predanima prije ArQusa. Cilj: projekt u tijeku je u sustavu za manje od sat vremena.

## Tijek

1. **Projekt u ArQusu** – osnovni podaci (paket programa, vrsta akcije, početak, trajanje, broj ugovora) i partneri unose se u sučelju (**Projekti → Novi projekt**). To traje par minuta.
2. **Predložak** – na projektu kartica **Uvoz** → *Preuzmi predložak za ovaj projekt*. Predložak je izrađen za taj projekt: list *Upute*, listovi s podacima i list *Šifarnik* s partnerima, kategorijama troškova paketa, postojećim radnim paketima, vrstama isporuka i razinama diseminacije (padajući popisi u ćelijama).
3. **Popuni ili zalijepi** vlastite podatke. Prazan list se preskače.
4. **Učitaj** datoteku → *Provjeri datoteku*. Pregled pokazuje po listu što će se stvoriti i svaku grešku (list, redak kao u Excelu, stupac, vrijednost, kako ispraviti). **Ništa se ne sprema.**
5. **Potvrdi** – greške blokiraju potvrdu; upozorenja (mogući duplikati, razdoblja s već predanim ZNS-om, prekoračenje proračuna) treba izričito potvrditi. Uvoz se primjenjuje **sve ili ništa**, u jednoj transakciji.
6. **Povijest** – svaki uvoz je zapisan (datoteka, SHA-256, tko, kada, brojevi po listu) i može se **poništiti** dok na uvezenim podacima ništa nije izgrađeno.

Kartica **Uvoz** vidljiva je korisnicima s pravom uređivanja strukture (`projects:write`) ili financija (`finance:write`) projekta. Na pregledu novog projekta (dok nema primijenjenog uvoza) stoji uputa „Projekt je već u tijeku?” koju korisnik može sakriti.

### Projekt u ugovaranju ili aktivan?

- **Troškovi** se uvoze samo dok je projekt aktivan (isto pravilo kao ručni unos).
- **Proračun** se uvozi dok je nacrt; aktivacija projekta zaključava proračun v1, a zaključan proračun mijenja se samo amandmanom – list *Proračun* s drugim podacima tada se odbija (jednak zaključanom se preskače).

Zato su moguća dva puta:
- **Jednim uvozom:** projekt aktivirati odmah nakon unosa osnovnih podataka (generiraju se izvještajna razdoblja; bez proračuna se ništa ne zaključava) pa uvesti cijelu datoteku. Uvezeni proračun ostaje nacrt (kao i proračun ručno unesen nakon aktivacije).
- **U dva koraka:** u ugovaranju uvesti strukturu, proračun i tim (list *Troškovi* izostaviti gumbom *Izostavi list*), aktivirati projekt (zaključava proračun) pa istu datoteku uvesti ponovno. Radni paketi, prekretnice i članovi tima koji već postoje s istim podacima prepoznaju se i preskaču, jednak zaključan proračun također; **isporuke** nemaju prirodni ključ (broj se dodjeljuje), pa list *Isporuke* pri ponovnom uvozu treba izostaviti.

## Listovi i stupci

Listovi i stupci prepoznaju se **po nazivu**, ne po položaju: velika i mala slova, dijakritika, razmaci, zvjezdica i tekst u zagradama se zanemaruju, a prihvaćaju se i engleski nazivi (npr. *Costs*, *Amount*, *Date*). Stupce smiješ preslagivati i dodavati vlastite (zanemaruju se i navode u pregledu). Redak zaglavlja je prvi od prvih 15 redaka koji odgovara stupcima lista – naslov iznad njega se preskače. Obavezni stupci su označeni s \*.

| List | Stupci | Dozvola | Što nastaje |
| --- | --- | --- | --- |
| **Radni paketi** | Broj, Naziv\*, Početni mjesec\*, Završni mjesec\*, Nositelj, Ciljevi | `projects:write` | radni paket (broj prazan = sljedeći slobodni; postojeći s istim brojem i podacima se preskače, s drugim podacima je greška) |
| **Isporuke** | Radni paket\*, Naziv\*, Vrsta\*, Razina diseminacije\*, Mjesec isporuke\*, Nositelj | `projects:write` | isporuka D<WP>.<n> (radni paket postojeći ili s lista *Radni paketi*) |
| **Prekretnice** | Naziv\*, Mjesec\*, Način provjere | `projects:write` | prekretnica MS<n> (ista po nazivu i mjesecu se preskače) |
| **Proračun** | Partner, Kategorija\*, Radni paket, Iznos (EUR)\*, Opis | `finance:write` | redak proračuna; list **zamjenjuje cijeli nacrt** proračuna (upozorenje sa starim i novim zbrojem); redak bez iznosa se preskače |
| **Tim** | Ime i prezime\*, Uloga, Partner, E-adresa korisnika, Godišnji trošak (EUR) | `finance:write`; godišnji trošak još i `personnel:read` | član tima; e-adresa mora pripadati postojećem korisniku institucije (dobiva ulogu člana tima na projektu, kao pri ručnom dodavanju); postojeći član istog imena kod istog partnera se preskače |
| **Troškovi** | Datum\*, Partner, Kategorija\*, Radni paket, Opis, Dobavljač, Iznos (EUR)\*, Dokaz (broj računa), Potraživano izvan sustava, Razdoblje / ZNS, Priznati iznos (EUR), Razlog umanjenja, Osoba | `finance:write`; trošak osoblja iz ranijeg razdoblja još i `personnel:read` | evidentirani trošak ili trošak potraživan izvan sustava (dolje) |

Partner: naziv, kratica ili redni broj partnera (prazno = vlastita institucija; za nositelja radnog paketa i isporuke prazno = bez nositelja). Kategorija: šifra (*VU*), šifra s nazivom (*VU – Vanjske usluge*) ili naziv. Radni paket: broj (*2*, *WP2*) ili naziv.

Svaki redak prolazi **ista pravila kao ručni unos** (iste provjere API-ja i domene): kategorija postoji u paketu i u nju se smije unositi (neizravni se ne unose), partner je na projektu, datum je unutar trajanja projekta, mjeseci unutar trajanja, vrste isporuka i razine diseminacije iz paketa, duljine tekstova, iznosi u centima, trošak osoblja nastaje iz timesheeta.

## Formati

- **Datoteke:** `.xlsx` (Excel, LibreOffice, Google Sheets – preuzimanje kao .xlsx) do **5 MB**; ili **CSV** po listu (UTF-8 s BOM-om ili bez, separator `;`, `,` ili tabulator). List u CSV-u određuje izbor u sučelju, naziv datoteke (npr. `troskovi.csv`) ili zaglavlje.
- **Ne prima se:** `.xls` (Excel 97–2003), `.xlsm` (makronaredbe), `.xlsb`, datoteke zaštićene lozinkom, `.ods` – poruka kaže kako datoteku spremiti.
- **Iznosi:** `1.234,56`, `1234,56`, `1 234,56 €`, `1234.56`, `1,234.56`, `20.000` (tisuće); najviše dvije decimale; nenegativni.
- **Datumi:** ćelija s formatom datuma, `31.12.2026.`, `31. 12. 2026`, `2026-12-31`. Zapis s kosom crtom (`02/10/2026`) se **odbija** jer nije jednoznačan (dan/mjesec ili mjesec/dan).
- **Mjeseci projekta:** `3` ili `M3`. **DA/NE:** da, ne, x, yes, no, TOČNO/NETOČNO, 1/0.
- **Formule se nikad ne izračunavaju** – uvozi se vrijednost koju je program spremio uz formulu. Formula bez spremljene vrijednosti (npr. datoteka koju je napisao program, a nije je otvorio Excel ili LibreOffice) je greška s uputom da se datoteka otvori i spremi. Tekst koji počinje s `=` ostaje tekst.
- **Granice:** do 10.000 redaka po listu, prvih 100 stupaca (dalje se zanemaruje uz upozorenje), tekst u ćeliji do 32.767 znakova.

## Troškovi koji su već potraživani prije ArQusa

Projekt u tijeku ima razdoblja čiji su ZNS-ovi predani prije uvođenja ArQusa. Takav trošak upisuje se s **DA** u stupcu *Potraživano izvan sustava*:

- Uz DA mogu se upisati **Razdoblje / ZNS** (npr. „ZNS 1 – RP1”), **Priznati iznos** (prazno = priznat kako je zatražen ili odluka još nije stigla) i **Razlog umanjenja** (obavezan kad je priznato manje od traženog – isto pravilo kao odluka o ZNS-u u sustavu). Bez DA ti stupci moraju biti prazni.
- Trošak dobiva status **„potraživan izvan sustava”** i:
  - **ulazi u ostvareno** – s priznatim iznosom ako je upisan, inače s traženim; razlika je nepriznato (Ugovoreno / ostvareno, portfelj);
  - **ulazi u kumulativ prema proračunu** u popisu za provjeru novog ZNS-a (upozorenje o prekoračenju kategorije uzima u obzir cijelo dosadašnje potraživanje);
  - **ne nudi se ni u jednom novom ZNS-u** ni kao „trošak iz ranijih razdoblja”, ne broji se kao trošak bez dokaza ni kao nepredan trošak;
  - razdoblje vlastite organizacije u kojem postoji takav trošak **nije „razdoblje bez ZNS-a”** u portfelju;
  - **ne mijenja se i ne briše** (ni rutom ni izravnim upitom u bazi – okidač); jedini ispravak je poništavanje uvoza.
- Označen je u popisu troškova (izvor „uvoz – prije ArQusa”, oznaka zahtjeva), u pregledu uvoza i u paketu ZNS-a (list *Sažetak*: broj i zbroj troškova potraživanih izvan sustava – „nisu dio ovog zahtjeva”).
- **Troškovi osoblja** iz ranijih razdoblja uvoze se kao **jedan redak po osobi i mjesecu**: kategorija troškova osoblja, osoba (član tima s lista *Tim* ili postojeći), datum u tom mjesecu, iznos, DA. Iznos je podatak o plaći: uvozi ga samo uloga s pristupom podacima o osoblju (`personnel:read`), a ostalima se prikazuje kao „skriveno” – na svakoj ruti i u izvozu, isto kao trošak iz timesheeta. Za mjesec za koji osoba već ima predan ili odobren timesheet uvoz se odbija, a odobrenje timesheeta za mjesec s uvezenim troškom osoblja se odbija – trošak ne nastaje dvaput.
- Trošak osoblja **bez** DA odbija se: troškovi osoblja koji nisu potraživani nastaju samo iz odobrenih timesheetova (za takve mjesece unesi timesheetove).

Trošak bez DA je obični evidentirani trošak: ulazi u ZNS svog razdoblja; ako je za to razdoblje ZNS u sustavu već predan, upozorenje kaže da će se nuditi kao trošak iz ranijeg razdoblja.

## Isti bajtovi i atomičnost

Potvrda šalje istu datoteku još jednom, uz **SHA-256** datoteke iz pregleda, **reviziju projekta** iz pregleda i **otisak plana** (SHA-256 svih planiranih promjena, upozorenja i odabira listova). Poslužitelj ponovno čita datoteku i izračunava plan u transakciji uz zaključan redak projekta; ako se datoteka, projekt ili bilo što što plan koristi promijenilo (npr. netko je u međuvremenu dodao trošak pa se pojavio mogući duplikat), odgovor je 409 i ništa se ne sprema – treba ponovno pregledati. Datoteka se ne čuva na poslužitelju između pregleda i potvrde.

Uvoz se primjenjuje u jednoj transakciji (greška bilo gdje poništava sve), bilježi se **jednim revizijskim zapisom** (`project_import`, radnja `apply`: tko, kada, datoteka, SHA-256, brojevi po listu – bez iznosa) i povećava reviziju projekta (i proračuna kad ga mijenja).

## Poništavanje

Poništavanje (povijest na kartici Uvoz) uklanja, u jednoj transakciji, sve što je uvoz stvorio: troškove, članove tima i njihove nove dodjele uloge na projektu, prekretnice, isporuke i radne pakete; uvezeni proračun briše se, a zamijenjeni nacrt vraća se na prijašnje retke. Zapis ostaje u povijesti kao „poništen” i u reviziji (`undo`).

Poništavanje se **odbija s popisom razloga** ako je na uvezenim podacima nešto izgrađeno:
- uvezeni trošak je u zahtjevu za nadoknadu, izmijenjen je, odabran je kao trošak iz ranijeg razdoblja ili uz njega postoji dokaz;
- uvezeni radni paket ima zadatke, kasnije dodane isporuke, troškove izvan uvoza, sate u timesheetovima ili ga koristi druga verzija proračuna;
- uvezenoj isporuci ili prekretnici promijenjen je status (ili isporuka ima dokument);
- uvezeni član tima ima timesheetove ili troškove osoblja iz drugog uvoza;
- proračun je nakon uvoza izmijenjen ili zaključan (aktivacija).

Poništavanje traži iste dozvole kao uvoz (npr. uvoz s radnim paketima i godišnjim troškom poništava korisnik s `projects:write`, `finance:write` i `personnel:read`). Što poništavanje **ne može**: vratiti podatke koje je korisnik nakon uvoza sam promijenio (zato se takav uvoz ne poništava) i ukloniti postojeće zapise koje je uvoz samo prepoznao i preskočio.

## Sigurnost čitanja datoteke

Datoteka je neprijateljski ulaz. Čitač je vlastiti (bez novih ovisnosti): ZIP s granicama broja zapisa (1.000), raspakirane veličine zapisa (25 MB) i ukupno (60 MB), inflate koji staje na deklariranoj veličini, provjera CRC-32; XML bez DTD-a i vanjskih entiteta; nazivi zapisa nikad nisu putanje; formule se ne izračunavaju; granice redaka i stupaca; pregled i potvrda ograničeni po korisniku (kao skupi izvozi, 429). Detalji: `docs/sigurnost/PENTEST-OPSEG.md`.

## Poznata ograničenja

- **Datoteke koje je zapisao Microsoft Excel nisu bile dostupne za testiranje.** Čitač je provjeren na datotekama iz LibreOfficea 24.2, Pythonove biblioteke openpyxl 3.1.5, vlastitog pisača ArQusa i ručno složenim datotekama za sve vrste ćelija iz standarda (dijeljeni i umetnuti tekst, obogaćeni tekst, rezultati formula, logičke vrijednosti, greške, datumi kao serijski broj u sustavu 1900 i 1904, ISO datumi, prefiksi imenskog prostora). Excel piše isti standard, ali ako čitač nešto ne razumije, poruka kaže koji list i koju ćeliju – u tom slučaju spremi datoteku kao CSV (UTF-8) po listu ili javi poruku podršci.
- Isporuke se pri ponovnom uvozu iste datoteke ne prepoznaju kao postojeće (izostavi list).
- Uvoz ne mijenja postojeće zapise (osim zamjene nacrta proračuna); izmjene postojećih radnih paketa i članova tima rade se na pripadnim karticama.
- Zadaci i rizici se ne uvoze; timesheetovi se ne uvoze (troškovi osoblja ranijih razdoblja uvoze se kao iznosi po osobi i mjesecu, bez sati – ne ulaze u opterećenje ljudi u portfelju).
- Razdoblje se smatra potraživanim izvan sustava kad u njemu postoji barem jedan takav trošak vlastite organizacije; ZNS za takvo razdoblje u sustavu se i dalje može otvoriti (ne sadrži povijesne troškove).
- Datumi u primjeru za demo su fiksni (projekt DIGI-ARHIV počinje 1. 3. 2026.).

## Primjer

`docs/primjeri/uvoz-projekta-DIGI-ARHIV.xlsx` – ispunjena radna knjiga za demo projekt DIGI-ARHIV (3 radna paketa, 2 isporuke, 1 prekretnica, 7 redaka proračuna, 3 člana tima, 19 troškova: 16 potraživanih u ZNS-u 1 prije ArQusa, od toga 12 troškova osoblja po osobi i mjesecu, i 3 obična troška tekućeg razdoblja). Izrađuje je skripta (`pnpm build`, zatim `pnpm --filter @arqus/api demo:import-example`), a test provjerava da je datoteka u repozitoriju aktualna.
