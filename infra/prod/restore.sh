#!/bin/sh
# Obnova pilot-instalacije iz kopije izvan poslužitelja (WP1.20, ADR-0012): prazan poslužitelj + bucket + ključ → sustav radi.
# Pretpostavke: repozitorij kloniran, infra/prod/.env vraćen iz sigurne kopije (upravitelj lozinki) s BACKUP_ENCRYPTION_KEY
# i BACKUP_S3_*, Docker radi. Baza mora biti prazna (novi poslužitelj ili `docker compose down -v`) – skripta to provjerava.
#
#   sh restore.sh                         # najnovija kopija baze i najnovija arhiva dokumenata
#   sh restore.sh 2026-11-17T09:30:00Z    # najnovija kopija do tog trenutka (npr. prije greške)
#
# Koraci: (1) baza, (2) preuzimanje i dešifriranje (provjera cjelovitosti), (3) uloga i pg_restore u jednoj transakciji,
# (4) dokumenti (samo uz lokalnu pohranu; uz S3 su već u bucketu), (5) pokretanje i čekanje spremnosti, (6) documents verify.
set -eu
cd "$(dirname "$0")"
START=$(date +%s)
AT="${1:-}"
WORK="${RESTORE_DIR:-$PWD/obnova}"
DC="docker compose --profile offsite"
step() { echo "[$(( $(date +%s) - START )) s] $*"; }
[ -f .env ] || { echo "Nema infra/prod/.env – vrati je iz sigurne kopije (upravitelj lozinki) prije obnove." >&2; exit 1; }
STORAGE=$(sed -n 's/^DOCUMENTS_STORAGE=//p' .env | tail -n 1); STORAGE=${STORAGE:-local}

step "1/6 baza"
$DC up -d --wait db
TABLES=$($DC exec -T db psql -U arqus -d arqus -tAc "select count(*) from information_schema.tables where table_schema = 'public'")
if [ "$TABLES" != "0" ]; then
  echo "Baza nije prazna ($TABLES tablica). Obnova se radi samo u praznu bazu: novi poslužitelj ili 'docker compose down -v' (briše SVE volumene)." >&2
  exit 1
fi

step "2/6 preuzimanje i dešifriranje kopije iz bucketa"
mkdir -p "$WORK"; chmod 700 "$WORK"
$DC run --rm --no-deps --user "$(id -u):$(id -g)" -v "$WORK:/obnova" --entrypoint node offsite \
  dist/db/cli.js backup fetch --dir /obnova ${AT:+--at "$AT"} $( [ "$STORAGE" = "s3" ] && echo --no-documents ) | tee "$WORK/preuzimanje.log"
DUMP=$(sed -n 's|^KOPIJA_BAZE=/obnova/||p' "$WORK/preuzimanje.log")
DOCS=$(sed -n 's|^ARHIVA_DOKUMENATA=/obnova/||p' "$WORK/preuzimanje.log")
[ -n "$DUMP" ] && [ -f "$WORK/$DUMP" ] || { echo "Kopija baze nije preuzeta." >&2; exit 1; }

step "3/6 obnova baze ($DUMP)"
# Uloga aplikacije je na razini klastera (nije u pg_dump); lozinku joj pri pokretanju postavlja `cli.js init` iz DB_APP_PASSWORD.
$DC exec -T db psql -U arqus -d arqus -v ON_ERROR_STOP=1 -qc "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arqus_app') THEN CREATE ROLE arqus_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; END IF; END \$\$"
$DC exec -T db pg_restore -U arqus -d arqus --single-transaction --exit-on-error < "$WORK/$DUMP"

step "4/6 dokumenti"
if [ "$STORAGE" = "s3" ]; then
  echo "DOCUMENTS_STORAGE=s3 – dokumenti su u bucketu dokumenata (verzioniranje kod pružatelja); provjera u koraku 6."
elif [ -n "$DOCS" ]; then
  $DC run --rm --no-deps --user root -v "$WORK:/obnova:ro" --entrypoint sh app -c "tar -xzf '/obnova/$DOCS' -C /data/documents && chown -R node:node /data/documents"
  echo "dokumenti vraćeni iz $DOCS"
else
  echo "UPOZORENJE: u bucketu nema arhive dokumenata – dokumenti nisu vraćeni." >&2
fi

step "5/6 pokretanje"
$DC up -d --wait app
$DC up -d

step "6/6 provjera dokumenata"
if ! $DC exec -T app node dist/db/cli.js documents verify; then
  echo "UPOZORENJE: documents verify je našao probleme. Uz lokalnu pohranu očekivano su to dokumenti učitani nakon zadnje dnevne arhive (popis iznad) – zatraži ih od korisnika ponovno." >&2
fi
rm -rf "$WORK"
step "obnova gotova – ukupno $(( $(date +%s) - START )) s (provjeri prijavu i https://<domena>/api/health/ready)"
