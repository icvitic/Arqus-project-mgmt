#!/usr/bin/env bash
# Lokalni pregled verzija projekta (bez git tagova – verzije se čitaju iz commitova "release: vX.Y.Z").
#
#   scripts/verzija.sh popis                 – ispiši sve verzije (najnovija prva)
#   scripts/verzija.sh otvori v0.2.0         – izdvoji verziju u .verzije/v0.2.0 (git worktree)
#   scripts/verzija.sh otvori sve            – izdvoji sve verzije
#   scripts/verzija.sh ukloni v0.2.0         – ukloni izdvojenu verziju
#   scripts/verzija.sh posluzi [port]        – pokreni lokalni poslužitelj i otvori preglednik (zadano 8765)
#   scripts/verzija.sh usporedi v0.2.0 v0.3.0 – razlike između dvije verzije (sažetak datoteka)
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
DIR="$ROOT/.verzije"
cd "$ROOT"

popis() {
  git log --all --grep='^release: v[0-9]' --format='%s%x09%h%x09%ad' --date=short \
    | sed -E 's/^release: (v[0-9]+\.[0-9]+\.[0-9]+)[^\t]*\t/\1\t/' \
    | awk -F'\t' '!seen[$1]++'
}

commit_za() {
  local v="$1"
  if git rev-parse -q --verify "refs/tags/$v" >/dev/null 2>&1; then
    git rev-parse "refs/tags/$v"; return
  fi
  local c
  c=$(git log --all --grep="^release: $v\([^0-9]\|\$\)" --format='%H' | head -1)
  [[ -n "$c" ]] || { echo "Verzija $v nije pronađena. Pokreni: $0 popis" >&2; exit 1; }
  echo "$c"
}

otvori() {
  local v="$1"
  if [[ "$v" == "sve" ]]; then
    popis | cut -f1 | while read -r x; do otvori "$x"; done; return
  fi
  [[ "$v" == v* ]] || v="v$v"
  mkdir -p "$DIR"
  if [[ -d "$DIR/$v" ]]; then echo "$v već izdvojena: $DIR/$v"; return; fi
  git worktree add --detach "$DIR/$v" "$(commit_za "$v")" >/dev/null
  echo "$v → $DIR/$v"
}

ukloni() {
  local v="$1"; [[ "$v" == v* ]] || v="v$v"
  git worktree remove --force "$DIR/$v" && echo "uklonjeno $v"
}

indeks() {
  # site/docs.json: { "radno": [...], "v0.3.0": [...] } – popis .md/.json/.html datoteka po verziji
  python3 - "$ROOT" "$DIR" <<'PY'
import json, os, sys, pathlib
root, vdir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
def files(base):
    out=[]
    for p in sorted(base.rglob('*')):
        if p.is_file() and p.suffix in ('.md','.json','.html') and not any(s.startswith('.') for s in p.relative_to(base).parts) \
           and 'node_modules' not in p.parts and p.relative_to(base).parts[0] != 'site':
            out.append(p.relative_to(base).as_posix())
    return out
idx = {"radno": {"path": ".", "files": files(root)}}
if vdir.is_dir():
    for d in sorted(vdir.iterdir(), key=lambda p: [int(x) for x in p.name[1:].split('.')] if p.name[1:].replace('.','').isdigit() else [0], reverse=True):
        if d.is_dir(): idx[d.name] = {"path": f".verzije/{d.name}", "files": files(d)}
(root/'site'/'docs.json').write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding='utf-8')
print(f"indeks: {len(idx)} verzija → site/docs.json")
PY
}

posluzi() {
  local port="${1:-8765}"
  indeks
  local url="http://localhost:$port/site/"
  echo "Poslužujem $ROOT na $url  (Ctrl+C za prekid)"
  ( sleep 1; command -v xdg-open >/dev/null && xdg-open "$url" || command -v open >/dev/null && open "$url" || true ) &
  python3 -m http.server "$port" --bind 127.0.0.1
}

usporedi() {
  git diff --stat "$(commit_za "$1")" "$(commit_za "$2")"
}

case "${1:-}" in
  popis) popis | awk -F'\t' '{printf "%-8s %-9s %s\n", $1, $2, $3}' ;;
  otvori) otvori "${2:?verzija ili 'sve'}" ;;
  ukloni) ukloni "${2:?verzija}" ;;
  posluzi) posluzi "${2:-}" ;;
  usporedi) usporedi "${2:?od}" "${3:?do}" ;;
  indeks) indeks ;;
  *) sed -n '2,10p' "$0" ;;
esac
