# ADR-0011: Uvoz globalnih poziva s portala EU Funding & Tenders

- **Status:** prihvaćeno · **Datum:** 2026-11-16 · dopunjuje ADR-0004 (paketi) i WP1.4 (radar)

## Kontekst
Radar poziva (WP1.4) imao je samo ručno unesene pozive. Ručno praćenje stotina EU tema je glavni trošak ureda za projekte (WP0.6b). Portal Funding & Tenders nudi javni pretraživački API (SEDIA search, bez korisničkog ključa) koji koristi i sam portal.

## Odluka
- ArQus kao servis za sve stanare uvozi **najavljene i otvorene** teme razdoblja 2021–2027 (vrste: grant, poziv za prijedloge, kaskadno financiranje) u globalne pozive (`tenant_id NULL`, `source = 'ft'`). Ocjena i odluka ostaju po instituciji (`call_tracking`), pa ponovni uvoz ne dira praćenje.
- Upsert po oznaci teme vlasničkom ulogom; ručno uneseni globalni poziv iste oznake se ne prepisuje. Teme čiji su svi rokovi prošli preskaču se (indeks portala sadrži zastarjele zapise sa statusom „otvoren”); duplikati po oznaci → zadnji uvoz.
- Rokovi: portal vraća briselsko lokalno vrijeme označeno kao `+0000` (17:00 „Brussels time”); pretvaramo u stvarni UTC prema zoni Europe/Brussels.
- Horizon Europe dobiva paket `horizon-europe-2021-2027` i vrste akcije RIA/IA/CSA (i JU inačice); ostali programi bez paketa dok ne dobiju svoj paket. Izvorna vrsta akcije, oznaka poziva i model roka idu u sažetak.
- Pokretanje: `cli.js import-calls` (ili `--file` sa spremljenim odgovorima) i periodički u procesu aplikacije (`FT_IMPORT_INTERVAL_HOURS`, u produkciji 24 h).
- Proračun teme nije u odgovoru pretraživanja (traži poseban dohvat detalja po temi) – za sada se ne uvozi.

## Posljedice
- Poslužitelj treba izlazni HTTPS prema `api.tech.ec.europa.eu`.
- API nije formalno dokumentiran kao javni ugovor; promjena formata ruši uvoz, ne aplikaciju (greška u zapisniku, postojeći pozivi ostaju). Domensko mapiranje je pokriveno testovima s uzorkom stvarnog odgovora.
- Sadržaj je s portala Europske komisije; izvor je naveden uz svaki poziv (poveznica na temu). Ponovna uporaba sadržaja Komisije dopuštena je uz navođenje izvora (Odluka Komisije 2011/833/EU).
- Radar s ~500 globalnih poziva: filtri po programu i „vlastiti i praćeni”, prikaz najbližih 100 rokova uz „prikaži još”.
