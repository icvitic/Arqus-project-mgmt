#!/bin/sh
# Sigurnosne kopije baze: pg_dump u prilagođenom formatu svakih INTERVAL_SECONDS (zadano 1 h → RPO 1 h, ADR-0003),
# brisanje kopija starijih od RETENTION_DAYS. Kopije su u volumenu `backups`; za izvanposlužiteljsku kopiju sinkronizirati u S3 (EU).
set -eu
mkdir -p /backups
while true; do
  f="/backups/arqus-$(date -u +%Y%m%dT%H%M%SZ).dump"
  if pg_dump -h "${PGHOST:-db}" -U "${PGUSER:-arqus}" -d "${PGDATABASE:-arqus}" -Fc -f "$f.tmp"; then mv "$f.tmp" "$f"; echo "kopija: $f ($(du -h "$f" | cut -f1))"; else echo "GREŠKA kopije" >&2; rm -f "$f.tmp"; fi
  find /backups -name 'arqus-*.dump' -mtime "+${RETENTION_DAYS:-14}" -delete
  sleep "${INTERVAL_SECONDS:-3600}"
done
