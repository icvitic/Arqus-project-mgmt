# Roadmap

Oznake: `[ ]` nije počelo · `[~]` u tijeku · `[x]` gotovo · 👤 traži ljudski rad (Claude priprema materijale)

## Faza 0 – Provjera tržišta (mj. 1–3: studeni 2026. – siječanj 2027.)
Uvjet za fazu 1: ≥ 15 intervjua i ≥ 3 pisma namjere / dogovora o pilotu.

- [x] **WP0.0** Repozitorij, pravila verzioniranja, dokumentacija, ADR-ovi (v0.1.0)
- [x] **WP0.1** Materijali za intervjue: vodič za intervju, okvir popisa sugovornika, predložak bilješke s intervjua (v0.1.0)
- [~] **WP0.2** 👤 Popis 20 konkretnih sugovornika (imena, institucije, kontakti) – priprema Claude, odobrava Ivan (prijedlog institucija i uloga + pozivna poruka pripremljeni v0.4.1; čeka odobrenje, kontakti izvan gita)
- [x] **WP0.3** Detaljna analiza konkurencije (≥ 15 alata, cijene, funkcije, EU/HR pokrivenost) + karta tržišta (v0.2.0)
- [x] **WP0.4** Domenski model v1 (generički, neovisan o FPZ portalu): entiteti, odnosi, paketi programa (HE, NPOO) (v0.3.0)
- [x] **WP0.5** Klikabilni prototip toka „radar poziva → prijava → projekt” (HTML, bez backenda) (v0.4.0, `prototip/`)
- [~] **WP0.6** 👤 Provedba intervjua i sinteza nalaza (Claude priprema sintezu iz bilježaka) – pripremljeni scenarij demonstracije, predložak sinteze s 10 hipoteza, dopuna vodiča (v0.4.1); čeka intervjue
- [ ] **WP0.7** Cjenovna hipoteza v2 i odluka go/no-go za fazu 1

## Faza 1 – MVP i pilot (mj. 4–9)
Uvjet za fazu 2: 3 aktivna pilota, pentest bez kritičnih nalaza.

- [ ] **WP1.1** Temelji platforme: monorepo, CI/CD, IaC, okruženja dev/stage
- [ ] **WP1.2** Stanari (tenants), identitet (OIDC/SAML, MFA), uloge i prava, revizijski zapis
- [ ] **WP1.3** Paketi programa (konfiguracija pravila) – HE i NPOO
- [ ] **WP1.4** Radar poziva i go/no-go
- [ ] **WP1.5** Prijava i proračun prijave, konzorcij
- [ ] **WP1.6** Ugovaranje: pretvorba prijave u projekt
- [ ] **WP1.7** Tehnička provedba (WP, zadaci, isporuke, prekretnice, rizici) i portfelj
- [ ] **WP1.8** Sigurnosni pregled i pilot-instalacija

## Faza 2 – Komercijalna v1 (mj. 10–15)
Uvjet za fazu 3: 10 kupaca koji plaćaju, 60.000 € ARR.

- [ ] **WP2.1** Financije, timesheetovi, zahtjevi za nadoknadu
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
