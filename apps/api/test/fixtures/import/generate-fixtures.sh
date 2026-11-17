#!/usr/bin/env bash
# WP1.17 – stvarne datoteke za testove čitača XLSX-a: openpyxl i LibreOffice. Generirane datoteke su u repozitoriju, pa CI
# ne treba ni Python ni LibreOffice; ova skripta ih samo ponovno stvara (npr. nakon promjene sadržaja).
# Potrebno: python3 s openpyxl-om (testirano 3.1.5) i LibreOffice (soffice, testirano 24.2). Pokretanje: bash generate-fixtures.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
lo() { LANG=C.UTF-8 soffice --headless --norestore -env:UserInstallation=file://"$work/lo-profile" "$@" >/dev/null 2>&1; }
python3 -I "$here/generate-openpyxl.py" "$here" "$work"
# LibreOffice: otvori radnu knjigu openpyxl-a (s formulama bez spremljenih vrijednosti), izračunaj je i spremi kao .xlsx
# (spremljene vrijednosti formula, vlastiti stilovi i dijeljeni nizovi LibreOfficea).
lo --convert-to xlsx --outdir "$work/lo" "$work/src-projekt.xlsx"
lo --convert-to xlsx --outdir "$work/lo" "$work/src-1904.xlsx"
cp "$work/lo/src-projekt.xlsx" "$here/libreoffice-projekt.xlsx"
cp "$work/lo/src-1904.xlsx" "$here/libreoffice-1904.xlsx"
# CSV iz lista „Troškovi” kako ga sprema LibreOffice s hrvatskim jezikom (datumi 10.02.2026, decimalni zarez, TOČNO/NETOČNO):
# jezik se upisuje u profil, filtar 59 = ';', 34 = '"', 76 = UTF-8, 1 = prvi redak, zadnji parametar = broj lista (3).
python3 -I - "$work/lo-profile/user/registrymodifications.xcu" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
item = '<item oor:path="/org.openoffice.Setup/L10N"><prop oor:name="ooSetupSystemLocale" oor:op="fuse"><value>hr-HR</value></prop></item>\n'
open(p, 'w', encoding='utf-8').write(s.replace('</oor:items>', item + '</oor:items>'))
PY
lo --convert-to 'csv:Text - txt - csv (StarCalc):59,34,76,1,,0,false,true,false,false,false,3' --outdir "$work/csv" "$work/lo/src-projekt.xlsx"
cp "$work"/csv/src-projekt-*.csv "$here/libreoffice-troskovi.csv"
echo "LibreOffice: $(soffice --version | head -1)"
python3 -I -c 'import openpyxl; print("openpyxl:", openpyxl.__version__)'
