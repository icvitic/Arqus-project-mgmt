# Cjenovna hipoteza v2 i odluka go/no-go (WP0.7)

Ulazi: strategija (v1 hipoteza), analiza konkurencije (WP0.3), istraživanje tržišta (WP0.6b). Datum: 2026-11-09.

## 1. Načela
1. Svi paketi za HR javni sektor **ispod 26.540 EUR/god.** (prag jednostavne nabave) – kupnja bez postupka javne nabave.
2. Naplata po **instituciji (stanaru) s ograničenjem broja aktivnih projekata**, ne po korisniku: potiče da svi (voditelji, računovodstvo, uprava) uđu u sustav; konkurencija naplaćuje po korisniku, što ograničava usvajanje.
3. Mali subjekti (poduzeća, udruge) plaćaju **po projektu**, jer imaju 1–3 projekta i ne razmišljaju o „instituciji”.
4. Cijene u EUR, godišnje unaprijed (uz popust) ili mjesečno; prvi kupci (pilot) dobivaju 50 % popusta na 12 mjeseci u zamjenu za povratne informacije i referencu.

## 2. Paketi (hipoteza v2)
| Paket | Za koga | Ograničenja | Cijena |
| --- | --- | --- | --- |
| **Projekt** | poduzeće, udruga, mala ustanova | po aktivnom projektu, do 10 korisnika po projektu | **150 EUR/projekt/mj.** (1.500 EUR/god. uz godišnje plaćanje) |
| **Institucija** | sastavnica, institut, veleučilište, grad, agencija | do 30 aktivnih projekata, neograničeni korisnici, 2 paketa programa | **500 EUR/mj.** (6.000 EUR/god.) |
| **Institucija+** | velike sastavnice, instituti, razvojne agencije, veliki gradovi | neograničeno projekata, svi paketi programa, SSO (OIDC/SAML), portfelj za upravu, API, izvoz za fondovieu/F&T | **1.100 EUR/mj.** (13.200 EUR/god.) |
| **Enterprise / PaaS** | sveučilište s više sastavnica, konzultantska kuća (white-label), ministarstvo/agencija | zasebna instanca ili baza, vlastiti brend, SLA, podrška za pakete programa | **od 25.000 EUR/god.** + uvođenje |
| Dodaci | svi | dodatnih 10 projekata (Institucija): 100 EUR/mj.; AI pomoćnik (faza 2): 100–200 EUR/mj. po stanaru | |

Usporedba sa sidrima: EMDESK 6,50–12 EUR/korisnik/mj. → institucija s 60 korisnika plaća 4.700–8.600 EUR/god. (naš paket Institucija je unutar raspona, bez brojanja korisnika). Worktribe/Converis > 100.000 GBP/god. – izvan HR tržišta. Instrumentl 179–899 USD/mj. samo za otkrivanje poziva.

## 3. Projekcija prihoda (osnovni scenarij)
| Godina | Kupci | ARR (EUR) | Napomena |
| --- | --- | --- | --- |
| 1 (faza 1, 2027.) | 3 pilota (50 % popusta) + 10 „Projekt” | ~25.000 | kriterij faze 1: 3 aktivna pilota |
| 2 (faza 2, 2028.) | 8 Institucija, 2 Institucija+, 1 PaaS, 30 Projekt | ~145.000 | kriterij faze 2: 10 kupaca, 60.000 ARR – premašen |
| 3 (faza 3, 2029.) | 15 Institucija, 5 Institucija+, 3 PaaS, 60 Projekt, prvi kupci u SLO/SRB | ~320.000 | u skladu sa SOM procjenom |

Pesimistično (sporiji javni sektor): 2. godina ~70.000, 3. godina ~160.000 EUR. Trošak razvoja 550–700 tis. EUR kroz 24 mj. (strategija) ne pokriva se iz prihoda do 4.–5. godine → potrebno vanjsko financiranje ili ulaganje Arqus Solutionsa; moguć izvor: EU poziv za digitalna rješenja (EDIH, NPOO/PKK za MSP) – sam proizvod je kandidat za bespovratna sredstva.

## 4. Odluka go/no-go za fazu 1
**Preporuka: GO, uvjetno**, uz promjenu kriterija (ADR-0007).

Za:
- Potvrđena praznina (20 alata, WP0.3) i rastuće tržište (9–11 %/god.).
- Velik obujam provedbe u HR (tisuće ZNS-ova, stotine ugovora godišnje) i usitnjeno tržište koje pogoduje cijeni ispod praga nabave.
- Program 2028.+ i NPOO rok 2026. stvaraju trenutak kad institucije mijenjaju procese.
- Generički model (WP0.4) i prototip (WP0.5) već postoje; trošak faze 1 je upravljiv.

Protiv / rizici:
- **Nema primarne provjere s kupcima** – najveći rizik; umanjiti pilotima po tržišnim uvjetima već u fazi 1 i javnim beta pristupom.
- Prodaja javnom sektoru je spora; prihod kasni za troškom.
- Kronis i GrantBite mogu dodati HR pravila.

Uvjeti za nastavak u fazu 2 (zamjena za intervjue): 3 aktivna pilota od kojih ≥ 1 plaća, ≥ 10 institucija koje su isprobale beta verziju, mjerena ušteda vremena na ZNS-u ≥ 30 % kod pilota.

## 5. Posljedice za plan faze 1
1. Redoslijed MVP-a: temelji (WP1.1–1.3) → **projekt i provedba (WP1.6–1.7)** → **troškovi i ZNS (prebaciti iz WP2.1 u fazu 1 kao WP1.8)** → radar i prijava (WP1.4–1.5) → sigurnosni pregled i piloti (WP1.9).
2. Prvi paketi programa: **PKK/NPOO (ZNS kroz fondovieu)** i Horizon Europe.
3. Hrvatski jezik prvi, engleski od početka u shemi (i18n), ostali jezici u fazi 3.
