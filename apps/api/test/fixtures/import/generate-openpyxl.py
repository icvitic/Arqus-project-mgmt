"""WP1.17 – radne knjige za testove čitača, napisane openpyxl-om (vidi generate-fixtures.sh).

Projekt u testovima: paket NPOO (kategorije OS, VU, OP, PUT, …), početak 1. 1. 2026., 24 mjeseca.
"""
import sys
from datetime import date, datetime
import openpyxl
from openpyxl.utils.datetime import CALENDAR_MAC_1904

out_dir, work_dir = sys.argv[1], sys.argv[2]


def projekt(with_formulas: bool) -> openpyxl.Workbook:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Radni paketi"
    # Naslov iznad zaglavlja, stupci drugim redoslijedom i vlastiti stupac korisnika.
    ws.append(["Plan rada projekta (iz vlastite tablice)"])
    ws.merge_cells("A1:D1")
    ws.append(["Naziv", "Broj", "Završni mjesec", "Početni mjesec", "Interna napomena"])
    ws.append(["Upravljanje projektom", 1, 24, 1, "Ana"])
    ws.append(["Istraživanje", "WP2", "M18", "M3", None])
    ws.append([None, None, None, None, None])  # prazan redak u sredini
    ws.append(["Diseminacija", 3, 24, 6, ""])

    t = wb.create_sheet("Tim")
    t.append(["Ime i prezime", "Uloga", "Godišnji trošak (EUR)"])
    t.append(["Ivana Kovač", "istraživačica", 36000])
    t.append(["Marko Babić", "tehničar", 28800.5])

    e = wb.create_sheet("Troškovi")
    e.append(["Opis", "Datum", "Iznos (EUR)", "Kategorija", "Radni paket", "Dobavljač", "Potraživano izvan sustava",
              "Razdoblje / ZNS", "Priznati iznos (EUR)", "Razlog umanjenja", "Dokaz (broj računa)", "Moj stupac", "Osoba"])
    e.append(["Elaborat energetskog pregleda", datetime(2026, 2, 10), 1234.56, "VU", 1, "Energo-plan d.o.o.", "DA", "ZNS 1 – RP1",
              "=C2-234.56" if with_formulas else 1000, "Priznato do iznosa iz ugovora", "R-88/2026", "x", None])
    e.append(["Putovanje na sastanak", "15.3.2026.", "86,50", "PUT", "WP2", "Putnički nalog 3/2026", "da", "ZNS 1 – RP1", None, None, "PN-3/2026", None, None])
    e.append(["Rad Ivane Kovač, veljača", date(2026, 2, 28), 3000, "OS", None, None, True, "ZNS 1 – RP1", None, None, None, None, "Ivana Kovač"])
    e.append(["Kalibracija senzora", "2026-08-05", "1.250,00", "VU – Vanjske usluge", 2, "Mjerna tehnika d.o.o.", "NE", None, None, None, "R-655/2026", None, None])
    e.append(["=SUM(1,2)" if False else "=formula koja je samo tekst", date(2026, 9, 1), 10, "PV", None, None, None, None, None, None, None, None, None])
    for row in e.iter_rows(min_row=2, min_col=2, max_col=2):
        for c in row:
            if isinstance(c.value, (date, datetime)):
                c.number_format = "DD.MM.YYYY"
    # Tekst koji izgleda kao formula mora ostati tekst: openpyxl bi ga inače zapisao kao formulu.
    e["A6"].data_type = "s"
    hidden = wb.create_sheet("Pomoćno")
    hidden["A1"] = "skriveni list koji nije list predloška"
    hidden.sheet_state = "hidden"
    return wb


projekt(False).save(f"{out_dir}/openpyxl-projekt.xlsx")
projekt(True).save(f"{work_dir}/src-projekt.xlsx")

# Vrste ćelija: formula bez spremljene vrijednosti, logičke vrijednosti, datumi s formatom, skriveni list s nazivom predloška, spojene ćelije.
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Vrste"
ws.append(["tekst", "broj", "decimalni", "logička", "datum", "formula", "datum-vrijeme"])
ws.append(["Zagreb – šđčćž", 42, 1234.5, True, date(2026, 12, 31), "=B2*2", datetime(2026, 1, 15, 13, 45)])
ws["E2"].number_format = "DD.MM.YYYY"
ws["G2"].number_format = "DD.MM.YYYY HH:MM"
ws.merge_cells("A4:C4")
ws["A4"] = "spojeno"
h = wb.create_sheet("Troškovi")
h.sheet_state = "hidden"
h.append(["Datum", "Kategorija", "Iznos"])
h.append([date(1900, 3, 1), "VU", 1])
h["A2"].number_format = "D.M.YYYY"
wb.save(f"{out_dir}/openpyxl-cells.xlsx")

# Sustav datuma 1904 (stari Mac): isti datum kao serijski broj u drugom sustavu.
wb = openpyxl.Workbook()
wb.epoch = CALENDAR_MAC_1904
ws = wb.active
ws.title = "Troškovi"
ws.append(["Datum", "Kategorija", "Iznos (EUR)", "Opis"])
ws.append([date(2026, 3, 2), "VU", 100, "Usluga"])
ws["A2"].number_format = "DD.MM.YYYY"
wb.save(f"{out_dir}/openpyxl-1904.xlsx")
wb.save(f"{work_dir}/src-1904.xlsx")
