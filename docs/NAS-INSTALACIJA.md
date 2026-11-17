# Demo instanca na Synology NAS-u (pristup preko Tailscalea)

Stalno upaljena demo instanca ArQus Projekata s izmišljenim podacima, dostupna samo uređajima u tvojoj Tailscale mreži. **Nije za stvarne podatke institucije** – za pilot vrijedi [PILOT-INSTALACIJA.md](PILOT-INSTALACIJA.md) i odabir pružatelja ([infrastruktura/usporedba-eu-pruzatelja.md](infrastruktura/usporedba-eu-pruzatelja.md)).

> Ove upute nisu isprobane na stvarnom Synology uređaju. Sama instalacija (`infra/nas/docker-compose.yml`) provjerena je u Dockeru na Linuxu. Nazivi izbornika u DSM-u mogu se malo razlikovati po verziji – ako neki korak ne odgovara onome što vidiš, javi što piše na ekranu.

## Što treba
- Synology s DSM 7.2 ili novijim i paketom **Container Manager** (modeli s Intel/AMD ili 64-bitnim ARM procesorom; stariji 32-bitni ARM modeli ga nemaju).
- Barem 4 GB RAM-a, od toga oko 1,5 GB slobodno.
- Tailscale račun (besplatni je dovoljan).
- GitHub račun `icvitic` (slika aplikacije je u privatnom registru).

## 1. Tailscale
1. DSM → **Package Center** → potraži **Tailscale** → Install → Open → **Log in** i prijavi se svojim Tailscale računom.
2. Na računalu i mobitelu s kojih ćeš otvarati demo instaliraj Tailscale i prijavi se **istim** računom.
3. Na https://login.tailscale.com/admin/machines pročitaj ime NAS-a (npr. `nas`) i njegovu adresu `100.x.y.z`.

## 2. Token za preuzimanje slike
Slika je privatna, pa NAS treba token koji smije samo čitati pakete:
1. GitHub → profilna slika → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**.
2. Naziv npr. `nas-demo`, trajanje po želji, označi samo **read:packages** → **Generate token** → kopiraj token (prikazuje se samo jednom).

## 3. Slika aplikacije
DSM → **Container Manager** → **Image** → **Action → Import → Add from URL**:
- Repository URL: `ghcr.io/icvitic/arqus-project-mgmt`
- Username: `icvitic` · Password: token iz koraka 2
- Tag: `latest`

Pričekaj da se slika preuzme (oko 100 MB). Ako ovaj izbornik ne nudi korisničko ime i lozinku: uključi SSH (Control Panel → Terminal & SNMP), spoji se i pokreni `sudo docker login ghcr.io -u icvitic` (lozinka = token), zatim nastavi s korakom 4 – projekt će sliku preuzeti sam.

## 4. Projekt
1. **Container Manager → Project → Create**.
2. Project name: `arqus-demo`; Path: nova mapa, npr. `/docker/arqus-demo`.
3. Source: **Create docker-compose.yml** i zalijepi cijeli sadržaj datoteke [`infra/nas/docker-compose.yml`](../infra/nas/docker-compose.yml) iz repozitorija.
4. Preskoči Web portal → **Next → Done**. Prvo pokretanje traje minutu-dvije: stvaraju se ključevi instalacije, baza i demo podaci.

Ako je port 8080 na NAS-u zauzet, u zalijepljenom tekstu promijeni `"8080:3000"` u npr. `"8088:3000"`.

## 5. Otvaranje
S uređaja u Tailscale mreži: **http://IME-NAS-A:8080** (ili `http://100.x.y.z:8080`).

Prijava: institucija `demo`, račun `ured@demo.local`, lozinka `Plavi-Jadran-2026`. Ostali računi: [DEMO.md](DEMO.md). Scenarij demonstracije: [DEMO-SCENARIJ.md](DEMO-SCENARIJ.md).

## Održavanje
- **Vraćanje demo podataka na početno stanje:** Container Manager → Container → `arqus-demo-app-1` → Action → **Open terminal** → Create → upiši `node dist/db/cli.js demo --reset`.
- **Nova verzija:** Image → odaberi sliku → ponovno je preuzmi (isti postupak kao u koraku 3), zatim Project → `arqus-demo` → Action → **Stop**, pa **Build** (ili Start). Migracije baze primjenjuju se same; demo podaci ostaju.
- **Zapis aplikacije:** Container → `arqus-demo-app-1` → Details → Log.
- **Brisanje svega:** Project → `arqus-demo` → Action → Delete (uključi brisanje volumena).

## Sigurnost i ograničenja
- Port 8080 otvoren je na NAS-u, pa je demo dostupan i s lokalne mreže, ne samo preko Tailscalea. S interneta nije dostupan dok na ruteru ne proslijediš port – **nemoj to raditi**. Ako želiš pristup samo preko Tailscalea, u DSM vatrozidu (Control Panel → Security → Firewall) dopusti port 8080 samo za raspon `100.64.0.0/10`.
- Promet unutar Tailscalea je šifriran, iako je adresa `http://`. Preglednik će stranicu označiti kao „nije sigurno”; aplikacija radi normalno.
- Ključevi instalacije (za prijave i MFA) stvaraju se pri prvom pokretanju i ostaju u volumenu `secrets`; nisu zapisani u compose datoteci.
- Pokazivanje sugovorniku izvan tvoje mreže: u Tailscaleu možeš podijeliti samo ovaj uređaj s drugim Tailscale korisnikom (Machines → Share) ili kasnije uključiti javnu adresu (Tailscale Funnel) – javi kad zatreba.
- Nema sigurnosnih kopija i nema jamstva dostupnosti: ovo je demo.
