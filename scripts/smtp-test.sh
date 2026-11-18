#!/bin/sh
# Stvarni SMTP poslužitelj (Mailpit) za integracijske testove WP1.21 – ISTA naredba lokalno i u CI-ju.
#   sh scripts/smtp-test.sh up     # pokreni (SMTP 127.0.0.1:1125 sa STARTTLS-om i prijavom, HTTP API 127.0.0.1:8125)
#   sh scripts/smtp-test.sh down   # zaustavi i ukloni
# Zatim testovi: TEST_SMTP_PORT=1125 TEST_SMTP_API=http://127.0.0.1:8125 pnpm test
# Bez TEST_SMTP_PORT test nad Mailpitom se preskače (s vidljivom porukom).
# Slika: Mailpit s GitHub Container Registryja (ghcr.io – bez ograničenja povlačenja Docker Huba), prikvačena oznakom.
# Certifikat i ključ su testni (apps/api/test/fixtures/smtp-test.*, CN=localhost) – nisu tajna.
set -eu
IMAGE="${MAILPIT_IMAGE:-ghcr.io/axllent/mailpit:v1.27.11}"
NAME="${MAILPIT_CONTAINER:-arqus-mailpit-test}"
SMTP_PORT="${MAILPIT_SMTP_PORT:-1125}"
API_PORT="${MAILPIT_API_PORT:-8125}"
FIXTURES="$(cd "$(dirname "$0")/.." && pwd)/apps/api/test/fixtures"
case "${1:-up}" in
  up)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker run -d --name "$NAME" -p "127.0.0.1:$SMTP_PORT:1025" -p "127.0.0.1:$API_PORT:8025" \
      -v "$FIXTURES/smtp-test.crt:/certs/cert.pem:ro" -v "$FIXTURES/smtp-test.key:/certs/key.pem:ro" \
      -e MP_SMTP_TLS_CERT=/certs/cert.pem -e MP_SMTP_TLS_KEY=/certs/key.pem -e MP_SMTP_REQUIRE_STARTTLS=true \
      -e MP_SMTP_AUTH="arqus-test:arqus-test-secret-123" \
      "$IMAGE" >/dev/null
    i=0
    until curl -fsS --noproxy '*' "http://127.0.0.1:$API_PORT/api/v1/info" >/dev/null 2>&1; do
      i=$((i + 1)); [ "$i" -gt 60 ] && { docker logs "$NAME" >&2; echo "Mailpit se nije pokrenuo" >&2; exit 1; }
      sleep 1
    done
    echo "Mailpit spreman: SMTP 127.0.0.1:$SMTP_PORT (STARTTLS, prijava), API http://127.0.0.1:$API_PORT ($IMAGE)"
    ;;
  down) docker rm -f "$NAME" >/dev/null 2>&1 || true; echo "Mailpit uklonjen" ;;
  *) echo "Upotreba: $0 up|down" >&2; exit 2 ;;
esac
