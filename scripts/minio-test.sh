#!/bin/sh
# Lokalni S3-kompatibilni poslužitelj (MinIO) za integracijske testove WP1.20 – ISTA naredba lokalno i u CI-ju.
#   sh scripts/minio-test.sh up     # pokreni (127.0.0.1:9100) i pričekaj spremnost
#   sh scripts/minio-test.sh down   # zaustavi i ukloni
# Zatim testovi: TEST_S3_ENDPOINT=http://127.0.0.1:9100 TEST_S3_ACCESS_KEY_ID=arqus-test TEST_S3_SECRET_ACCESS_KEY=arqus-test-secret-123 pnpm test
# Bez TEST_S3_ENDPOINT testovi nad MinIO-m se preskaču (s vidljivom porukom).
# Slika: zajednička (community) gradnja MinIO-a koju održava pgsty – službene MinIO slike više se ne objavljuju; prikvačena oznakom.
set -eu
IMAGE="${MINIO_IMAGE:-pgsty/minio:RELEASE.2026-08-04T00-00-00Z}"
NAME="${MINIO_CONTAINER:-arqus-minio-test}"
PORT="${MINIO_PORT:-9100}"
case "${1:-up}" in
  up)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker run -d --name "$NAME" -p "127.0.0.1:$PORT:9000" \
      -e MINIO_ROOT_USER=arqus-test -e MINIO_ROOT_PASSWORD=arqus-test-secret-123 \
      "$IMAGE" server /data >/dev/null
    i=0
    until curl -fsS --noproxy '*' "http://127.0.0.1:$PORT/minio/health/ready" >/dev/null 2>&1; do
      i=$((i + 1)); [ "$i" -gt 60 ] && { docker logs "$NAME" >&2; echo "MinIO se nije pokrenuo" >&2; exit 1; }
      sleep 1
    done
    echo "MinIO spreman: http://127.0.0.1:$PORT ($IMAGE)"
    ;;
  down) docker rm -f "$NAME" >/dev/null 2>&1 || true; echo "MinIO uklonjen" ;;
  *) echo "Upotreba: $0 up|down" >&2; exit 2 ;;
esac
