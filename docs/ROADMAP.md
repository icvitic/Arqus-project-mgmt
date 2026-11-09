# Roadmap

Oznake: `[ ]` nije počelo · `[~]` u tijeku · `[x]` gotovo · `[-]` ukinuto · 👤 traži ljudski rad (Claude priprema materijale)

## Faza 0 – Provjera tržišta (mj. 1–3: studeni 2026. – siječanj 2027.)
Uvjet za fazu 1: ~~≥ 15 intervjua i ≥ 3 pisma namjere~~ → zamijenjeno ADR-0007: desk istraživanje tržišta i odluka go/no-go (WP0.6b, WP0.7). **Odluka: GO, uvjetno (2026-11-09).**

- [x] **WP0.0** Repozitorij, pravila verzioniranja, dokumentacija, ADR-ovi (v0.1.0)
- [x] **WP0.1** Materijali za intervjue: vodič za intervju, okvir popisa sugovornika, predložak bilješke s intervjua (v0.1.0)
- [-] **WP0.2** ~~Popis 20 sugovornika~~ – ukinuto ADR-0007; prijedlog i pozivna poruka ostaju za prodaju/pilote (v0.4.1)
- [x] **WP0.3** Detaljna analiza konkurencije (≥ 15 alata, cijene, funkcije, EU/HR pokrivenost) + karta tržišta (v0.2.0)
- [x] **WP0.4** Domenski model v1 (generički, neovisan o FPZ portalu): entiteti, odnosi, paketi programa (HE, NPOO) (v0.3.0)
- [x] **WP0.5** Klikabilni prototip toka „radar poziva → prijava → projekt” (HTML, bez backenda) (v0.4.0, `prototip/`)
- [-] **WP0.6** ~~Provedba intervjua i sinteza~~ – ukinuto ADR-0007; scenarij demonstracije i hipoteze H1–H10 koriste se u pilotima
- [x] **WP0.6b** Istraživanje tržišta iz javnih izvora: veličina tržišta, obujam HE/NPOO/PKK, broj potencijalnih kupaca, TAM/SAM/SOM (v0.5.0)
- [x] **WP0.7** Cjenovna hipoteza v2 (paketi Projekt / Institucija / Institucija+ / PaaS, svi ispod praga jednostavne nabave) i odluka go/no-go: GO uvjetno (v0.5.0)

## Faza 1 – MVP i pilot (mj. 4–9)
Uvjet za fazu 2 (WP0.7): 3 aktivna pilota od kojih ≥ 1 plaća, ≥ 10 institucija u beti, ušteda ≥ 30 % vremena na ZNS-u kod pilota, pentest bez kritičnih nalaza.
Redoslijed promijenjen prema WP0.7: provedba i troškovi/ZNS prije radara i prijave.

- [x] **WP1.1** Temelji platforme: pnpm monorepo (api, web, domain), CI, Docker Compose, validator i izračun iz paketa programa, ADR-0008 (v0.6.0); IaC i stage okruženje → WP1.9
- [x] **WP1.2** Stanari, identitet (lozinka + JWT), uloge i dozvole, revizijski zapis, RLS s automatskim testovima izolacije (v0.7.0)
- [ ] **WP1.2b** OIDC/SAML prijava (AAI@EduHr, Microsoft Entra), MFA (TOTP), pozivnice korisnika, poništavanje tokena
- [x] **WP1.3** Paketi programa u bazi: globalni + stanarski, verzije i status, uvoz iz `docs/domena/paketi`, validacija, nasljeđivanje (`extends`) za paket po pozivu, objava; ESLint (v0.8.0)
- [ ] **WP1.4** Radar poziva i go/no-go
- [ ] **WP1.5** Prijava i proračun prijave, konzorcij
- [ ] **WP1.6** Ugovaranje: pretvorba prijave u projekt
- [ ] **WP1.7** Tehnička provedba (WP, zadaci, isporuke, prekretnice, rizici) i portfelj
- [ ] **WP1.8** Troškovi, timesheetovi i zahtjevi za nadoknadu (ZNS) – prebačeno iz WP2.1 (WP0.7)
- [ ] **WP1.9** Sigurnosni pregled i pilot-instalacija

## Faza 2 – Komercijalna v1 (mj. 10–15)
Uvjet za fazu 3: 10 kupaca koji plaćaju, 60.000 € ARR.

- [ ] **WP2.1** Napredne financije: više valuta, storna, revizijski izvještaji (osnova prebačena u WP1.8)
- [ ] **WP2.2** Administracija (izvještaji, ZNS, putovanja, nabava, zapošljavanje)
- [ ] **WP2.3** AI pomoćnik (EU-hostani LLM, RAG po stanaru, oznake AI sadržaja)
- [ ] **WP2.4** Integracije M365/Google, uvoz iz Excela
- [ ] **WP2.5** Naplata pretplate, mjerenje potrošnje
- [ ] **WP2.6** Projektni vodiči i predlošci

## Faza 3 – Skaliranje (mj. 16–24)
- [ ] **WP3.1** PaaS / white-label instance
- [ ] **WP3.2** ISO/IEC 27001
- [ ] **WP3.3** Paketi Interreg, Erasmus+, ESIF, HRZZ, novi okvirni program 2028.+
- [ ] **WP3.4** Regija (SLO, BiH, SRB, CG, MK) – lokalizacija
