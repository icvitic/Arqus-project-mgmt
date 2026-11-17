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
PORT_FILE="$ROOT/infra/demo/.port"
# Port: ARQUS_DEMO_PORT, inače zadnji uspješno korišten, inače prvi slobodan od zadanih (bira "start").
SAVED_PORT="${ARQUS_DEMO_PORT:-$(cat "$PORT_FILE" 2>/dev/null || true)}"
export ARQUS_DEMO_PORT="${SAVED_PORT:-8080}"
URL="http://localhost:$ARQUS_DEMO_PORT"

command -v docker >/dev/null || { echo "Docker nije instaliran (https://docs.docker.com/get-docker/)." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker ne radi – pokreni Docker i pokušaj ponovno." >&2; exit 1; }

accounts() {
  "${COMPOSE[@]}" exec -T app node dist/db/cli.js demo | sed -n '/^Prijava:/,$p'
  echo; echo "Otvori $URL  ·  scenarij demonstracije: docs/DEMO-SCENARIJ.md"
}

case "${1:-start}" in
  start)
    [ "${ARQUS_DEMO_SKIP_BUILD:-}" = 1 ] || "${COMPOSE[@]}" build
    started=
    for port in ${SAVED_PORT:+$SAVED_PORT} 8080 8081 8088 18080 28080; do
      export ARQUS_DEMO_PORT="$port"
      if out="$("${COMPOSE[@]}" up -d 2>&1)"; then started=1; break; fi
      if ! grep -qiE 'ports are not available|port is already allocated|address already in use|bind:' <<<"$out"; then echo "$out" >&2; exit 1; fi
      echo "Port $port nije dostupan, probavam sljedeći…"
    done
    [ -n "$started" ] || { echo "Nijedan od zadanih portova nije slobodan. Postavi drugi: ARQUS_DEMO_PORT=9000 scripts/demo.sh" >&2; exit 1; }
    echo "$ARQUS_DEMO_PORT" > "$PORT_FILE"; URL="http://localhost:$ARQUS_DEMO_PORT"
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
