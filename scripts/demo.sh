#!/usr/bin/env bash
# Demo okruženje ArQus Projekti (WP1.13) na macOS/Linuxu – treba Docker. Upute: docs/DEMO.md
#   scripts/demo.sh          izgradi i pokreni (prvi put nekoliko minuta), napuni demo podatke, ispiši adresu i račune
#   scripts/demo.sh reset    vrati demo instituciju na početno stanje (svježi datumi)
#   scripts/demo.sh stop     zaustavi (podaci ostaju)
#   scripts/demo.sh obrisi   zaustavi i obriši sve demo podatke (baza i dokumenti)
#   scripts/demo.sh log      prikaži zapis aplikacije
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/infra/demo/docker-compose.yml")
URL=http://localhost:8080

command -v docker >/dev/null || { echo "Docker nije instaliran (https://docs.docker.com/get-docker/)." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker ne radi – pokreni Docker i pokušaj ponovno." >&2; exit 1; }

accounts() {
  "${COMPOSE[@]}" exec -T app node dist/db/cli.js demo | sed -n '/^Prijava:/,$p'
  echo; echo "Otvori $URL  ·  scenarij demonstracije: docs/DEMO-SCENARIJ.md"
}

case "${1:-start}" in
  start)
    "${COMPOSE[@]}" up -d --build
    echo -n "Čekam aplikaciju"
    for _ in $(seq 1 120); do
      if curl -sf "$URL/api/health" >/dev/null 2>&1; then echo " – spremna."; accounts; exit 0; fi
      echo -n "."; sleep 2
    done
    echo; echo "Aplikacija se nije pokrenula u 4 minute. Zapis: scripts/demo.sh log" >&2; exit 1 ;;
  reset)
    "${COMPOSE[@]}" exec -T app node dist/db/cli.js demo --reset
    echo; echo "Demo vraćen na početno stanje – $URL (prijavi se ponovno)." ;;
  stop) "${COMPOSE[@]}" stop; echo "Zaustavljeno; podaci ostaju. Ponovno: scripts/demo.sh" ;;
  obrisi) "${COMPOSE[@]}" down -v; echo "Demo okruženje i svi njegovi podaci obrisani." ;;
  log) "${COMPOSE[@]}" logs --tail 200 app ;;
  *) echo "Uporaba: scripts/demo.sh [start|reset|stop|obrisi|log]" >&2; exit 2 ;;
esac
