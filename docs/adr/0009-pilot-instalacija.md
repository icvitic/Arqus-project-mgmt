# ADR-0009: Pilot-instalacija – jedan poslužitelj, Docker Compose, neovisno o pružatelju

- **Status:** prihvaćeno · **Datum:** 2026-11-10 · dopunjuje ADR-0003

## Kontekst
Pilot-institucija i EU pružatelj još nisu odabrani (Ivan, 2026-11-10). ADR-0003 predviđa Kubernetes i Terraform radi prenosivosti, što je za pilot s jednom institucijom preskupo u radu i trošku.

## Odluka
- Za pilot: jedan virtualni poslužitelj kod bilo kojeg EU pružatelja, `infra/prod/docker-compose.yml` (aplikacija, PostgreSQL 16, Caddy s automatskim HTTPS-om, servis za kopije).
- Jedna slika (`Dockerfile`): API poslužuje i izgrađeno web sučelje (isto podrijetlo, bez CORS-a); pri pokretanju `cli.js init` primijeni migracije, postavi lozinku aplikacijske uloge i osvježi globalne pakete.
- Kubernetes/Terraform ostaju cilj za fazu 2–3 (više stanara, SLA); slika i varijable okruženja već su prikladne za to.

## Posljedice
- Instalacija za ~1 sat na bilo kojem pružatelju; prelazak na drugog pružatelja = kopija baze + ista slika.
- Jedna točka kvara (prihvatljivo za pilot; RTO 4 h kroz obnovu iz kopije). Ograničenje prijava je u memoriji jedne instance.
