#!/usr/bin/env python3
"""
Vyrobi testovaci objednavkovou tabulku pro wavy-import-kosiku.js.

Format je shodny s realnym prtorder.xls od klienta:
  - stary binarni .xls (BIFF/OLE2), ne xlsx
  - list "Pick List"
  - sloupce Qty | Part Number | Part Description
  - Qty jako desetinne cislo (2.0), Part Number jako text
  - popisy s mezerou na konci

Soubor NENI jen N platnych kodu - prvnich 7 radku jsou zamerne
problemove pripady, aby se na nich daly projit vsechny vetve prehledu.

Kody se berou ze scripts/ceny.json, takze jsou SKUTECNE a proti shopu
se opravdu sparuji. ceny.json musi existovat (generuje ho
generuj-ceny.py).

Pouziti:
    python scripts/vyrob-testovaci-tabulku.py            # 100 i 300
    python scripts/vyrob-testovaci-tabulku.py 500        # vlastni pocet

Vystupni soubory jsou v .gitignore - jsou to testovaci data, ne zdroj.
"""

import json
import os
import random
import sys

try:
    import xlwt
except ImportError:
    sys.exit("Chybi xlwt. Nainstaluj: pip install xlwt")

ZDE = os.path.dirname(os.path.abspath(__file__))
CENY = os.path.join(ZDE, "ceny.json")

# Zamerne problemove pripady. Poradi zachovat - je na ne odkazovano
# v dokumentaci a testech.
PASTI = [
    (2.0, "16160004", "GASKET "),                   # realny kod z prtorder.xls
    (1.0, "879150054", "THERMOSTAT ASSEMBLY "),      # realny
    (1.0, "863657A1", "CABLE ASSEMBLY "),            # realny
    (1.0, "11149A2", "PREFIX TEST - kratsi kod "),   # je prefixem 11149A20..A27
    (3.0, "NEEXISTUJE001", "NEEXISTUJICI KOD "),     # -> nenalezeno
    (1.0, "SUPERSEDED999", "NAHRAZENY KOD "),        # -> nenalezeno / supersession
    (999.0, "16160004", "NAD SKLADOVY STAV "),       # duplicita + mnozstvi nad sklad
]


def nacti_kody():
    if not os.path.exists(CENY):
        sys.exit(f"Chybi {CENY} - spust nejdriv generuj-ceny.py")
    with open(CENY, encoding="utf-8") as f:
        data = json.load(f)
    prices = data["prices"]
    groups = data.get("variantGroups", {})
    jednoduche = sorted(k for k in prices if k not in groups)
    variantni = sorted(groups.keys())
    return jednoduche, variantni


def vyrob(pocet, jednoduche, variantni, seed=20260902):
    rnd = random.Random(seed)
    radky = list(PASTI)

    # varianty - jina cesta parovani, ma se overit taky
    pocet_variant = min(8, max(0, pocet // 20))
    for kod in rnd.sample(variantni, min(pocet_variant, len(variantni))):
        radky.append((float(rnd.randint(1, 3)), kod, "VARIANTNI PRODUKT "))

    # duplicity - stejny kod dvakrat, ma se secist
    pocet_dupl = min(4, max(0, pocet // 25))
    dupl = rnd.sample(jednoduche, pocet_dupl) if pocet_dupl else []
    for kod in dupl:
        radky.append((2.0, kod, "DUPLICITA A "))
    for kod in dupl:
        radky.append((3.0, kod, "DUPLICITA B "))

    # doplnit na pozadovany pocet
    pouzite = {r[1] for r in radky}
    zbyva = pocet - len(radky)
    if zbyva > 0:
        kandidati = [k for k in jednoduche if k not in pouzite]
        for kod in rnd.sample(kandidati, min(zbyva, len(kandidati))):
            radky.append((float(rnd.randint(1, 5)), kod, "PART DESCRIPTION "))
    else:
        radky = radky[:pocet]

    return radky


def uloz(radky, cesta):
    wb = xlwt.Workbook()
    ws = wb.add_sheet("Pick List")
    for i, nazev in enumerate(("Qty", "Part Number", "Part Description")):
        ws.write(0, i, nazev)
    for i, (qty, pn, popis) in enumerate(radky, start=1):
        ws.write(i, 0, qty)
        ws.write(i, 1, pn)      # text, ne cislo - kvuli vedoucim nulam
        ws.write(i, 2, popis)
    wb.save(cesta)


def main():
    pocty = [int(a) for a in sys.argv[1:]] or [100, 300]
    jednoduche, variantni = nacti_kody()
    print(f"katalog: {len(jednoduche)} jednoduchych, {len(variantni)} variantnich kodu")

    for pocet in pocty:
        radky = vyrob(pocet, jednoduche, variantni)
        cesta = os.path.join(ZDE, f"test-{len(radky)}.xls")
        uloz(radky, cesta)
        dupl = len(radky) - len({r[1] for r in radky})
        print(f"  {os.path.basename(cesta)}: {len(radky)} radku, "
              f"{dupl} duplicitnich, 2 neexistujici, prefix 11149A2, 999 ks u 16160004")


if __name__ == "__main__":
    main()
