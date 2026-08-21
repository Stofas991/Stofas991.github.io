#!/usr/bin/env python3
"""
Wavy Boats - jednorazova diagnostika struktury popisnych parametru
--------------------------------------------------------------------
NEPOUZIVAT jako soucast pipeline - je to jednorazovy nastroj, ktery
zjisti, jak se v productsComplete.xml skutecne jmenuji tagy pro
POPISNE parametry (admin: "Popisne parametry", textPropertyName[] /
textPropertyValue[]). generuj-ceny.py dnes cte jen PARAMETERS/PARAMETER,
coz jsou VARIANTNI parametry - jiny blok.

Co dela:
  1) Streamuje productsComplete.xml (stejne jako generuj-ceny.py -
     iterparse + elem.clear(), nikdy cely dokument v pameti).
  2) Pro kazdy SHOPITEM sesbira nazvy PRIMYCH potomku a pocita jejich
     vyskyt (summary na konci) - z toho uz je casto vidět, jestli tam
     nejaky "TEXT_PROPERT*" / "POPIS*" blok je.
  3. Hleda prvni SHOPITEM, ktery obsahuje tag odpovidajici heuristice
     (nazev obsahuje "TEXT" + "PROPERT", nebo "POPIS"), a vypise jeho
     kompletni XML podstrom.
  4) Bezpecnost: pri vypisu podstromu se text hodnot v zakazanych
     tazich (PURCHASE_PRICE, PURCHASE_VAT, PURCHASE_PRICE_INCL_VAT,
     PRICELIST, PRICELISTS, INTERNAL_NOTE, STOCK) nahrazuje "[SKRYTO]" -
     i pro jednorazovou diagnostiku nema smysl tato data tisknout do
     konzole/logu.

Pouziti:
  FEED_HASH=... python scripts/diagnostika-popisne-parametry.py
  FEED_HASH=... python scripts/diagnostika-popisne-parametry.py --code 8M0224239
  FEED_HASH=... python scripts/diagnostika-popisne-parametry.py --max-items 0   # bez limitu, cely feed

--code omezi feed na jeden produkt (rychle, malo dat). Bez --code se
prochazi az --max-items polozek (default 2000) a pak se to zastavi,
i kdyz se nic nenajde - proti omylem stazenemu celemu 255MB feedu.
"""

import argparse
import os
import sys
import xml.etree.ElementTree as ET

import requests

FEED_BASE = "https://www.dealerwb.cz/export/productsComplete.xml"
PATTERN_ID = "-5"
PARTNER_ID = "10"

FORBIDDEN_TAGS = {
    "PURCHASE_PRICE", "PURCHASE_VAT", "PURCHASE_PRICE_INCL_VAT",
    "PRICELIST", "PRICELISTS", "INTERNAL_NOTE", "STOCK",
}

CANDIDATE_HINTS = ("TEXTPROPERT", "POPIS")


def feed_url(code=None):
    feed_hash = os.environ.get("FEED_HASH")
    if not feed_hash:
        sys.exit("Chybi promenna prostredi FEED_HASH.")
    url = f"{FEED_BASE}?patternId={PATTERN_ID}&partnerId={PARTNER_ID}&hash={feed_hash}"
    if code:
        url += f"&code={code}"
    return url


def direct_children(elem, tag):
    return [c for c in elem if c.tag == tag]


def looks_like_candidate(tag_name):
    upper = tag_name.upper().replace("_", "").replace("-", "")
    return any(hint in upper for hint in CANDIDATE_HINTS)


def dump_subtree(elem, indent=0):
    pad = "  " * indent
    text = (elem.text or "").strip()
    if elem.tag in FORBIDDEN_TAGS and text:
        text = "[SKRYTO]"
    line = f"{pad}<{elem.tag}>"
    if text and not list(elem):
        line += f"{text}</{elem.tag}>"
        print(line)
    else:
        print(line)
        for child in elem:
            dump_subtree(child, indent + 1)
        print(f"{pad}</{elem.tag}>")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--code", default=None, help="omezit feed na jeden kod produktu")
    parser.add_argument("--max-items", type=int, default=2000,
                         help="max. poctu SHOPITEM ke zpracovani (0 = bez limitu)")
    args = parser.parse_args()

    url = feed_url(args.code)
    tag_counts = {}
    seen_items = 0
    found_subtree = False

    with requests.get(url, stream=True, timeout=300) as resp:
        resp.raise_for_status()
        resp.raw.decode_content = True

        context = ET.iterparse(resp.raw, events=("end",))

        for _, elem in context:
            if elem.tag != "SHOPITEM":
                continue

            seen_items += 1
            child_tags = sorted(set(c.tag for c in elem))
            for t in child_tags:
                tag_counts[t] = tag_counts.get(t, 0) + 1

            if not found_subtree:
                candidate = next((c for c in elem if looks_like_candidate(c.tag)), None)
                if candidate is not None:
                    code = next((c.text for c in elem if c.tag == "CODE"), "?")
                    print(f"\n=== Nalezen kandidat u SHOPITEM CODE={code} "
                          f"(polozka #{seen_items}) ===\n")
                    dump_subtree(elem)
                    found_subtree = True

            elem.clear()

            if found_subtree:
                break
            if args.max_items and seen_items >= args.max_items:
                print(f"\nDosazen limit --max-items={args.max_items}, zastavuji "
                      f"(pouzij --max-items 0 pro prohledani celeho feedu).")
                break

    print(f"\n--- Souhrn: {seen_items} SHOPITEM zpracovano ---")
    print("Primi potomci SHOPITEM a v kolika polozkach se vyskytli:")
    for tag, count in sorted(tag_counts.items(), key=lambda kv: -kv[1]):
        print(f"  {tag}: {count}")

    if not found_subtree:
        print("\nZadny tag odpovidajici heuristice (obsahuje 'TEXTPROPERT' nebo 'POPIS') "
              "nenalezen v prohledanem rozsahu.")
        print("Dalsi kroky: zkus --code s konkretnim produktem, u ktereho vis, ze "
              "'Puvodni kod' uz je vyplneny, nebo zvys/vypni --max-items.")


if __name__ == "__main__":
    main()
