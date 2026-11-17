# Usporedba EU pružatelja poslužitelja – podloga za odluku

**Datum:** 2026-11-17 · **Status:** prijedlog, čeka Ivanovu odluku · **Vezano uz:** ADR-0003 (EU hosting), ADR-0009 (pilot na jednom poslužitelju), ADR-0010 (pohrana dokumenata)

## 1. Što nam treba

| Faza | Potreba |
| --- | --- |
| Pilot i javna demo adresa (sada) | jedan virtualni poslužitelj (2–4 vCPU, 4–8 GB RAM, 80 GB diska), HTTPS, sigurnosne kopije izvan poslužitelja, ugovor o obradi podataka, ISO/IEC 27001 |
| Komercijalna v1 (faza 2) | upravljana baza PostgreSQL, S3-kompatibilna pohrana za dokumente, mogućnost Kubernetesa – po mogućnosti kod istog pružatelja, bez selidbe |
| Prodaja javnom sektoru u HR | jasan odgovor na pitanje „gdje su podaci” i „čije je to pravo”; pružatelj iz EU, bez izloženosti zakonima trećih država |

Cijena poslužitelja nije odlučujuća: razlika između najjeftinije i najskuplje opcije je nekoliko desetaka eura mjesečno, a pilot „Institucija” vrijedi 500 EUR mjesečno.

## 2. Usporedba

Oznake: **✓** potvrđeno na službenoj stranici pružatelja 17. 11. 2026. · **~** podatak s posrednih stranica, treba potvrditi · **?** nije provjereno.

| | Exoscale (A1 Digital) | Hetzner | OVHcloud | Scaleway | UpCloud | STACKIT / IONOS | Domaći pružatelji (CROWEB, Setcor, KING ICT, A1 Cloud) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sjedište | Švicarska / Austrija; sestrinska tvrtka A1 Hrvatska ✓ | Njemačka ✓ | Francuska | Francuska | Finska | Njemačka | Hrvatska |
| Podaci u Hrvatskoj | **da – zona HR-ZAG-1 u podatkovnom centru A1 Hrvatska, Zagreb** ✓ | ne (Nürnberg, Falkenstein, Helsinki) ✓ | ne ? | ne (Pariz, Amsterdam, Varšava) ~ | ne ? | ne (Njemačka, Austrija) ~ | da |
| Certifikati | ISO 27001 ✓, BSI C5 ✓ | ISO/IEC 27001:2022 za sve tri EU lokacije ✓ | ? (u ovom pregledu nije potvrđeno) | ? | ? | ISO 27001 i BSI C5 ~ | ISO 27001 (CROWEB i 27017/27018) ~ |
| Poslužitelj 4 GB RAM, mjesečno | ~ 30–40 EUR ? | CPX22: 16,99 EUR (Helsinki) / 19,99 EUR (Nürnberg) ✓ | VPS-1: od 3,81 EUR, dnevna kopija uključena ✓ | DEV1-M: ~14,45 EUR + disk i IPv4 ~ | ? | ? | na upit |
| Poslužitelj 8 GB RAM, mjesečno | ~ 60 EUR (67 USD) ~ | CPX32: 30,49 / 35,99 EUR ✓ | VPS-2: od 7,21 EUR ✓ | ? | ? | ? | na upit |
| Kopije poslužitelja | snimke, dodatno | +20 % cijene poslužitelja ✓ | uključene (24 h); 7 dana uz doplatu ✓ | dodatno | ? | ? | na upit |
| S3 pohrana | da (ista cijena u svim zonama ✓; dostupnost u Zagrebu ?) | da, osnovna naknada ~6,49 EUR/mj. ~ | da | da | da | da | uglavnom ne |
| Upravljani PostgreSQL | da, od ~98 USD/mj. (4 GB) ~ | **ne** | da, ~63 USD/mj. ~ | da | da, od ~30 USD/mj. ~ | da | uglavnom ne |
| Upravljani Kubernetes | da | **ne** (samo vlastita instalacija) | da | da | da | da | ne |
| Napomena | jedina s EU oblakom u Zagrebu; lokalni partner A1 Hrvatska | najbolji omjer cijene i snage; dva poskupljenja u 2026. i povremena nedostupnost najjeftinijih planova ~ | najjeftiniji; VPS je zasebna linija od javnog oblaka | solidna platforma, bez posebne prednosti za nas | provjeriti ako ostali otpadnu | razina njemačkog javnog sektora; prodaja preko ponuda, za nas prerano | podaci u HR i domaći ugovor, ali klasični hosting bez S3 i upravljane baze |

Cijene su bez PDV-a. Stupci s oznakom ~ i ? ne smiju se uzeti kao konačni – prije narudžbe provjeriti u kalkulatoru pružatelja.

## 3. Preporuka

**Exoscale, zona Zagreb (HR-ZAG-1), s kopijama u drugoj zoni (Beč).**

Razlozi, redom važnosti:
1. **Prodajni argument.** „Podaci su u Zagrebu, kod europskog pružatelja s ISO 27001 i BSI C5” jači je odgovor hrvatskoj instituciji od „u Njemačkoj”. GDPR to ne traži (dovoljan je EGP), ali kupci u javnom sektoru to pitaju prvo.
2. **Bez selidbe u fazi 2.** Isti pružatelj ima upravljani PostgreSQL, S3 pohranu i Kubernetes; Hetzner nema upravljanu bazu ni upravljani Kubernetes.
3. **Lokalni ugovorni partner.** A1 Hrvatska kao sestrinska tvrtka olakšava ugovor, račun i podršku na hrvatskom – korisno i kupcima u nabavi.
4. **Širenje u regiju** (faza 3): zone u Beču i Sofiji.

Cijena je viša nego kod Hetznera (procjena 60–90 EUR mjesečno za poslužitelj s 8 GB, disk i pohranu kopija, prema ~45 EUR), što je zanemarivo prema vrijednosti jednog pilota.

**Dva uvjeta prije odluke** (nisam ih mogao potvrditi na službenim stranicama):
- da su S3 pohrana i upravljani PostgreSQL dostupni baš u zoni Zagreb (stranica cijena spominje Zagreb samo uz GPU instance);
- točna cijena iz kalkulatora (stranica cijena nije prikazala iznose).

Ako ijedan uvjet ne vrijedi: **Hetzner (Nürnberg ili Helsinki)** – najbolja cijena, ISO 27001, instalacija ista (ADR-0009). Selidba kasnije je kopija baze i ista Docker slika, pa ova odluka nije nepovratna.

**Ne preporučujem sada:** OVHcloud VPS (najjeftiniji, ali bez prednosti osim cijene), Scaleway i UpCloud (dalje od kupaca, bez posebne prednosti), STACKIT/IONOS (prerano), domaće pružatelje klasičnog hostinga (nemaju S3 ni upravljanu bazu; smisleni samo ako kupac izričito traži domaću pravnu osobu, a to pokriva A1).

## 4. Što slijedi nakon odluke

Ivan:
1. Otvoriti korisnički račun na ime Arqus Solutionsa i potpisati ugovor o obradi podataka (DPA).
2. Odabrati domenu (npr. poddomenu postojeće) i dati pristup DNS zapisima.
3. Javiti odluku; pristupni podaci se ne šalju u razgovoru – instalaciju pokreće Ivan prema uputama ili daje privremeni pristup na dogovoren način.

Razvoj (jedan manji paket nakon odluke):
- instalacija prema `docs/PILOT-INSTALACIJA.md` (oko sat vremena) i javna demo adresa;
- S3 izvedba pohrane dokumenata (ADR-0010) i kopije baze izvan poslužitelja, s mjerenjem vremena obnove;
- ADR s odlukom o pružatelju.

## 5. Ograničenja ovog pregleda

- Službene stranice Scalewaya i UpClouda nisu bile dostupne za čitanje; podaci za njih su s posrednih stranica.
- Cijene Exoscalea nisu potvrđene na službenoj stranici (iznosi se nisu prikazali); navedeni iznosi su s posredne stranice ažurirane 17. 11. 2026.
- Certifikati OVHclouda, Scalewaya i UpClouda nisu provjeravani.
- Vlasnička struktura pružatelja i izloženost zakonima trećih država nisu pravno analizirane; za ugovor s javnim naručiteljem to treba potvrditi s pružateljem.

## 6. Izvori

- Hetzner – cijene: https://www.hetzner.com/cloud/regular-performance/ · certifikat: https://www.hetzner.com/unternehmen/zertifizierung/
- Hetzner – poskupljenja 2026. (posredno): https://www.tomshardware.com/tech-industry/hetzner-to-raise-prices-by-up-to-37-percent-from-april-1 · https://www.bitdoze.com/hetzner-cloud-cost-optimized-plans/
- OVHcloud – VPS: https://www.ovhcloud.com/en-ie/vps/
- Exoscale – Zagreb: https://www.exoscale.com/lp/a1-european-cloud-croatia/ · zone: https://www.exoscale.com/datacenters/ · cijene: https://www.exoscale.com/pricing/ · posredno: https://getdeploying.com/exoscale
- Scaleway – posredno: https://www.whtop.com/plans/scaleway.com/101611 · promjena cijena: https://www.scaleway.com/en/blog/a-transparent-update-on-scaleway-pricing/
- UpCloud – posredno: https://upcloud.com/global/blog/introducing-starter-and-premium-plans/
- STACKIT / IONOS: https://stackit.com/en/learn/knowledge/cloud-security/certificates · https://european.cloud/compare/ionos-vs-stackit/
- Domaći pružatelji (posredno): https://www.croweb.host/certifications · https://www.server-parts.eu/post/croatian-cloud-providers-croatia
