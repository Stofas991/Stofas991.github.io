#!/usr/bin/env python3
"""
Wavy Boats - denni generovani verejnych dat z productsComplete.xml
--------------------------------------------------------------------
Bezi jako GitHub Actions job jednou denne. Stahuje CELY export
(obsahuje hash, ktery NIKDY nesmi jit do klientskych skriptu) a
vyrobi z nej dva verejne bezpecne vystupy:

  "prices"        - {kod: verejna_cena} pro VSECHNY kody, tzn.
                     zaklad. produkty i jednotlive varianty.
                     Pouziva ho kosikovy skript, kde je kod z
                     data-micro-sku uz presny.

  "variantGroups" - jen pro produkty s variantami (~60 z ~43000).
                     Kazdy clen skupiny je pod SVYM VLASTNIM kodem
                     jako klic, takze detailovy skript nalezne
                     skupinu z jakehokoli kodu, ktery ma po ruce.
                     Obsahuje kod, cenu a hodnoty parametru (napr.
                     "Model: Mercury R150L DS") - to jsou udaje,
                     ktere Shoptet uz sam zobrazuje verejne v
                     prepinaci varianty, takze nejde o nic citliveho.

Nikdy se nectou tagy PURCHASE_PRICE, PRICELIST/PRICELISTS,
INTERNAL_NOTE ani STOCK - jen CODE, PRICE_VAT a PARAMETER/VALUE.

Pouziva xml.etree.ElementTree.iterparse nad streamovanym
pripojenim (requests, stream=True), takze v pameti nikdy neni
cely 255MB dokument - jen jeden SHOPITEM najednou.
"""

import json
import os
import sys
import xml.etree.ElementTree as ET

import requests

FEED_BASE = "https://www.dealerwb.cz/export/productsComplete.xml"
PATTERN_ID = "-5"
PARTNER_ID = "10"

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "ceny.json")


def feed_url() -> str:
    feed_hash = os.environ.get("FEED_HASH")
    if not feed_hash:
        sys.exit("Chybi promenna prostredi FEED_HASH (nastavena jako GitHub Secret).")
    return f"{FEED_BASE}?patternId={PATTERN_ID}&partnerId={PARTNER_ID}&hash={feed_hash}"


def direct_child_text(elem, tag):
    """Text primeho potomka - ne rekurzivni hledani (rekurzivni by
    u variant mohlo najit tag ve spatne urovni stromu)."""
    for child in elem:
        if child.tag == tag:
            return child.text
    return None


def direct_children(elem, tag):
    return [c for c in elem if c.tag == tag]


def parse_price(text):
    if text is None:
        return None
    try:
        return float(text.strip().replace(",", "."))
    except ValueError:
        return None


def read_params(variant_elem):
    """Hodnoty parametru variant - jen text, ktery uz Shoptet sam
    zobrazuje verejne v prepinaci varianty na detailu."""
    values = []
    for holder in direct_children(variant_elem, "PARAMETERS"):
        for param in direct_children(holder, "PARAMETER"):
            value = direct_child_text(param, "VALUE") or direct_child_text(param, "PARAMETER_VALUE")
            if value:
                values.append(value.strip())
    return values


def generate():
    url = feed_url()
    prices = {}
    variant_groups = {}
    seen_products = 0
    seen_variants = 0

    with requests.get(url, stream=True, timeout=300) as resp:
        resp.raise_for_status()
        resp.raw.decode_content = True

        context = ET.iterparse(resp.raw, events=("end",))

        for _, elem in context:
            if elem.tag != "SHOPITEM":
                continue

            seen_products += 1
            base_code = direct_child_text(elem, "CODE")
            base_price = parse_price(direct_child_text(elem, "PRICE_VAT"))
            if base_code and base_price is not None:
                prices[base_code.strip()] = base_price

            variant_nodes = []
            for holder in direct_children(elem, "VARIANTS"):
                variant_nodes.extend(direct_children(holder, "VARIANT"))

            if variant_nodes:
                group = []
                for variant in variant_nodes:
                    seen_variants += 1
                    v_code = direct_child_text(variant, "CODE")
                    v_price = parse_price(direct_child_text(variant, "PRICE_VAT"))
                    if v_price is None:
                        v_price = base_price  # fallback na cenu rodice
                    if not v_code or v_price is None:
                        continue
                    v_code = v_code.strip()
                    prices[v_code] = v_price
                    group.append({
                        "code": v_code,
                        "price": v_price,
                        "params": read_params(variant),
                    })

                # Kazdy clen skupiny je klicem na CELOU skupinu -
                # detailovy skript nema jak vedet dopredu, jestli
                # kod na strance je "zakladni" nebo "varianta".
                for member in group:
                    variant_groups[member["code"]] = group
                if base_code:
                    variant_groups[base_code.strip()] = group

            # Kriticke pro pametovou spotrebu: uvolni zpracovany
            # SHOPITEM, jinak strom roste po celou dobu behu.
            elem.clear()

    output = {"prices": prices, "variantGroups": variant_groups}

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Hotovo: {len(prices)} kodu, {len(variant_groups)} kodu ve skupinach variant "
          f"(z {seen_variants} variant), produktu v feedu: {seen_products}")
    print(f"Ulozeno do: {OUTPUT_PATH}")


if __name__ == "__main__":
    generate()