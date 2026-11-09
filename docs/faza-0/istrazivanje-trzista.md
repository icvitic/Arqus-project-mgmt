# Istraživanje tržišta iz javnih izvora (WP0.6b)

**Svrha:** zamjenjuje intervjue kao ulaz za odluku go/no-go (ADR-0007). Datum: 2026-11-09. Opseg: 8 web pretraživanja, 1 dohvaćeno izvješće (SAFU 2024). Brojke su iz javnih izvora, s datumom i izvorom; procjene su jasno označene kao **procjena**.

## 1. Veličina i rast tržišta softvera za upravljanje grantovima
| Pokazatelj | Vrijednost | Izvor |
| --- | --- | --- |
| Globalno tržište 2025. | 2,41 mlrd. USD, CAGR 8,9 % (2026.–2035.) | [GMI](https://www.gminsights.com/industry-analysis/grant-management-software-market) |
| Globalno 2024. (druga procjena) | 2,75 mlrd. USD, CAGR 10,3 % (2025.–2030.) | [GII](https://www.gii.co.jp/report/go1326010-grant-management-software.html) |
| Europa 2023. → 2028. | 489 → 948 mil. USD (CAGR ~14 %) – gornja procjena | [Business Market Insights](https://www.businessmarketinsights.com/reports/europe-grant-management-software-market) |
| Europa, CAGR 2025.–2032. | 10,2 % | [KBV Research](https://www.kbvresearch.com/europe-grant-management-software-market) |

Zaključak: europsko tržište raste 9–11 % godišnje; procjene veličine se razlikuju dvostruko (metodologija, što se broji). Za planiranje: **Europa ≈ 0,6–0,9 mlrd. USD u 2027.**, pretežno institucijski sustavi i grantodavatelji (grant-maker softver), a ne alati za prijavitelje – naš segment (grant-seeker, provedba) manji je i slabije pokriven.

## 2. Potražnja: obujam EU i nacionalnih projekata
### Horizon Europe
| Pokazatelj | Vrijednost | Izvor |
| --- | --- | --- |
| HE ukupno, 2021.–siječanj 2025. | 15.148 ugovora, 43,2 mlrd. EUR | Horizon Dashboard, snimka 6. 1. 2025. ([UKRO](https://www.ukro.ac.uk/news/horizon-dashboard-data-update-5/)) |
| HE 2021.–2023. | 10.674 ugovora, 30,8 mlrd. EUR | [EK factsheet](https://era.gv.at/news-items/commission-publishes-factsheet-with-key-figures-of-horizon-europe-implementation/) |
| Europska partnerstva do kraja 2025. | 1.345 grantova, 9.568 jedinstvenih sudionika, 12,5 mlrd. EUR | [ERA-LEARN / EK godišnje izvješće](https://www.era-learn.eu/news-events/news/ec-annual-report-on-rtd-activities-of-the-european-union-and-monitoring-of-horizon-europe-in-2025) |
| **Hrvatska** HE 2021.–2024. | 1.817 prijava (2,1 % svih), uspješnost 17,0 % (EU prosjek 16,2 %), **352 projekta s HR korisnikom**, **539 HR sudjelovanja**, 136,4 mil. EUR (0,32 %) | [MZOM, info-dan Teaming, 3/2025](https://uniri.hr/wp-content/uploads/2025/03/02_MZOM_Info-dan_Teaming-4.3.2025.pdf) |
| Zapadni Balkan (H2020, cijelo razdoblje) | ~1.000 organizacija, ~170 mil. EUR; u HE Srbija i Crna Gora najuspješnije | [EK](https://www.researchprofessionalnews.com/?p=399189), [WB InfoHub 2025](https://westernbalkans-infohub.eu/wp-content/uploads/2025/08/Working-Document-Enhancing-Western-Balkans-Participation-in-Horizon-Europe-and-Framework-Programme-10.pdf) |

Izvedeno za HR: ~135 novih HE sudjelovanja godišnje i ~450 prijava godišnje. Svaka prijava = jedan prolaz kroz „radar → prijava”; svako sudjelovanje = 3–4 godine provedbe.

### Kohezijska politika i NPOO (Hrvatska)
| Pokazatelj | Vrijednost | Izvor |
| --- | --- | --- |
| SAFU portfelj 2021.–2027. (PKK + ITP) | alokacija ≈ 6,6 mlrd. EUR; 2024.: prvih 73 ugovora, 1,1 mlrd. EUR | [SAFU, Izvješće o radu 2024](https://safu.hr/wp-content/uploads/2025/02/Izvjesce-o-radu-za-2024.pdf) |
| NPOO (SAFU kao provedbeno tijelo) | 50 investicija, 3,1 mlrd. EUR; 2024.: 189 ugovora, 1,1 mlrd. EUR | isto |
| SAFU 2024. ukupno | **262 ugovora** (2,2 mlrd. EUR), **1.807 odobrenih zahtjeva za nadoknadom (ZNS)**, 404 pregledana plana nabave, 389 ex-post kontrola nabave, 487 zaposlenih | isto |
| MINTS turizam (2 NPOO poziva 2023.) | ~460 prijava, 289 mil. EUR traženo | [MINTS](https://www.index.hr/vijesti/clanak/ministarstvo-objavilo-dobitnike-poticaja-iz-npooa-evo-gdje-ih-mozete-provjeriti/2533069.aspx) |

SAFU je samo jedno od provedbenih tijela (ostala: HZZ, HAMAG-BICRO, FZOEU, ministarstva). **Procjena:** u Hrvatskoj se godišnje obradi **5.000–8.000 ZNS-ova** i potpiše **800–1.500 ugovora** o bespovratnim sredstvima iz EU i nacionalnih izvora. Svaki ZNS je ručni posao na strani korisnika – to je jezgra boli u provedbi (hipoteza H1).

## 3. Broj potencijalnih kupaca (Hrvatska)
| Segment | Broj subjekata | Od toga realno s ≥ 3 projekta (procjena) | Izvor / napomena |
| --- | --- | --- | --- |
| Visoka učilišta s pravnom osobnošću | **117** (10 javnih sveučilišta, 4 privatna, 72 sastavnice, 13 javnih + 18 privatnih veleučilišta) | ~60 | [Eurydice, Upisnik visokih učilišta, 3/2024](https://eurydice.eacea.ec.europa.eu/hr/national-education-systems/croatia/vrste-visokoskolskih-ustanova) |
| Javni znanstveni instituti | ~25 | ~20 | procjena iz Upisnika znanstvenih organizacija (provjeriti) |
| Županije, gradovi, općine | 21 + 128 + 428 = 577 | ~120 (gradovi i veće općine s EU projektima) | ustroj RH; procjena |
| Regionalni koordinatori / razvojne agencije | ~21 | ~21 | po jedna po županiji |
| Konzultantske kuće za EU fondove | 50–100 aktivnih | ~15 kao kanal (white-label) | procjena |
| Poduzeća s EU grantom (NPOO, PKK, EIC) | 1.500–3.000 korisnika u razdoblju | ~300 s ≥ 2 projekta | procjena iz broja ugovora |
| Udruge, javne ustanove (škole, bolnice, kultura) | > 1.000 korisnika | ~100 | ESF+ i NPOO korisnici; niska platežna moć |

Važno ograničenje: hrvatske institucije pokrivene su **jednostavnom nabavom do 26.540 EUR** godišnje bez postupka javne nabave – cijena ispod tog praga uklanja najveću prepreku kupnji u javnom sektoru.

## 4. TAM / SAM / SOM
Pretpostavke cijena iz `cjenovna-hipoteza-v2.md` (institucija 6.000–15.000 EUR/god., mali subjekt ~1.800 EUR/god.).

| Razina | Opseg | Procjena godišnje vrijednosti |
| --- | --- | --- |
| **TAM – EU** | alati za prijavitelje i provedbu (grant-seeker) u Europi: ~15–20 % tržišta softvera za grantove | **100–180 mil. EUR/god.** |
| **SAM – HR + regija (SLO, BiH, SRB, CG, MK)** | ~300 institucija (HE, instituti, JLS, agencije) × 8.000 EUR + ~1.000 poduzeća/udruga × 1.800 EUR | **~4,2 mil. EUR/god.** (HR ≈ 1,8 mil., regija ≈ 2,4 mil.) |
| **SOM – 3 godine** | 10 institucija + 2 PaaS/konzultantska kanala + 40 malih subjekata u HR; prvi kupci u SLO/SRB | **~250–300 tis. EUR ARR** (3. godina); kriterij faze 2 (60 tis. ARR) dostižan u 2. godini |

Osjetljivost: ako javne institucije kupuju sporije (proračunski ciklus, programski ugovori), SOM u 3. godini pada na ~150 tis. EUR; ako konzultantski kanal (white-label) uspije, raste na > 400 tis. EUR.

## 5. Što podaci govore o proizvodu
1. **Provedba je masovna, prijava rjeđa.** U HR ~450 HE prijava/god., ali tisuće ZNS-ova i stotine aktivnih projekata istodobno. MVP mora prvo olakšati provedbu (troškovi, ZNS, izvještaji, rokovi), radar i prijava su ulazna točka, ne glavna vrijednost. Prioritet za fazu 1: **WP1.6–1.7 (projekt, provedba) i rani dio WP2.1 (troškovi, ZNS)** ispred punog radara.
2. **Nacionalni programi (NPOO, PKK) su po obujmu veći od HE u Hrvatskoj** (2,2 mlrd. EUR ugovoreno u 2024. samo kroz SAFU, nasuprot 136 mil. EUR HE u 4 godine). Paket programa za PKK/NPOO (ZNS kroz fondovieu) ima veću komercijalnu težinu od HE paketa, iako je HE pravilima najstandardiziraniji.
3. **Tržište je usitnjeno** – 72 sastavnice sveučilišta su zasebne pravne osobe s vlastitim proračunima: prodaja ide po sastavnici (cijena 6–15 tis. EUR), uz mogućnost sveučilišnog okvira (PaaS) kasnije.
4. **Regija je dostupna istim proizvodom:** Srbija i Crna Gora rastu u HE; svi koriste iste HE obrasce, a nacionalni paketi dodaju se konfiguracijom (ADR-0004).
5. **Konkurencija** (WP0.3) ne pokriva HR/NPOO pravila ni hrvatski jezik; cjenovno sidro EMDESK 6,50–12 EUR/korisnik/mj. odgovara našem rasponu za instituciju.

## 6. Ograničenja istraživanja
- Nema primarnih podataka o spremnosti na plaćanje; cjenovna hipoteza ostaje hipoteza do prvih ponuda (faza 1, pilot po tržišnim uvjetima).
- Brojevi instituta, JLS-ova s projektima i poduzeća su procjene; točni popisi (Upisnik znanstvenih organizacija, fondovieu popis korisnika) nisu dohvaćeni radi štednje tokena.
- EK profil države za HE (mjesečno ažuriran) nije bio dostupan (404); korišteni MZOM podaci iz 3/2025.
- Europske procjene tržišta su iz komercijalnih izvještaja s različitim metodologijama.
