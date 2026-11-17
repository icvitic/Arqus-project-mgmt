#!/bin/sh
# Sigurnosne kopije baze i dokumenata: pg_dump u prilagođenom formatu svakih INTERVAL_SECONDS (zadano 1 h → RPO 1 h, ADR-0003),
# brisanje kopija starijih od RETENTION_DAYS. Kopije su u volumenu `backups`; kopiju izvan poslužitelja (šifrirano, S3) radi
# servis `offsite` (ADR-0012, docs/PILOT-INSTALACIJA.md odj. 4).
# DOCUMENTS_STORAGE=s3: dokumenti su u S3 bucketu (štiti ih verzioniranje bucketa i `documents verify`), pa se dnevna arhiva
# lokalnog volumena ne radi.
set -eu
mkdir -p /backups
if [ "${DOCUMENTS_STORAGE:-local}" = "s3" ]; then echo "dokumenti su u S3 (DOCUMENTS_STORAGE=s3) – dnevna arhiva dokumenata se ne radi"; fi
while true; do
  f="/backups/arqus-$(date -u +%Y%m%dT%H%M%SZ).dump"
  if pg_dump -h "${PGHOST:-db}" -U "${PGUSER:-arqus}" -d "${PGDATABASE:-arqus}" -Fc -f "$f.tmp"; then mv "$f.tmp" "$f"; echo "kopija: $f ($(du -h "$f" | cut -f1))"; else echo "GREŠKA kopije" >&2; rm -f "$f.tmp"; fi
  # Dokumenti (ADR-0010): jedna arhiva dnevno; verzije se ne mijenjaju pa je dnevna arhiva dovoljna uz RPO baze.
  d="/backups/documents-$(date -u +%Y%m%d).tar.gz"
  if [ "${DOCUMENTS_STORAGE:-local}" != "s3" ] && [ -d /documents ] && [ ! -f "$d" ]; then
    if tar -czf "$d.tmp" -C /documents .; then mv "$d.tmp" "$d"; echo "dokumenti: $d ($(du -h "$d" | cut -f1))"; else echo "GREŠKA arhive dokumenata" >&2; rm -f "$d.tmp"; fi
  fi
  find /backups \( -name 'arqus-*.dump' -o -name 'documents-*.tar.gz' \) -mtime "+${RETENTION_DAYS:-14}" -delete
  sleep "${INTERVAL_SECONDS:-3600}"
done
