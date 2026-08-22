#!/usr/bin/env python3
"""
Wavy Boats - denni generovani verejnych dat z productsComplete.xml
--------------------------------------------------------------------
Bezi jako GitHub Actions job jednou denne. Stahuje CELY export
(obsahuje hash, ktery NIKDY nesmi jit do klientskych skriptu) a
vyrobi z nej tri verejne bezpecne vystupy:

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

  "originalCodes" - {kod: puvodni_kod} jen pro produkty/varianty,
                     ktere maji vyplneny popisny parametr "Puvodni
                     kod" (admin: Popisne parametry, v XML tag
                     TEXT_PROPERTIES/TEXT_PROPERTY). Overeno naostro
                     20. 8. 2026 na kodu 815303T. Shoptet uz tuto
                     hodnotu sam zobrazuje verejne na detailu (a
                     dokonce i v SHORT_DESCRIPTION), takze nejde o
                     rozsireni citlivych dat.

Nikdy se nectou tagy PURCHASE_PRICE, PRICELIST/PRICELISTS,
INTERNAL_NOTE ani STOCK - jen CODE, PRICE_VAT, PARAMETER/VALUE a
TEXT_PROPERTIES/TEXT_PROPERTY.

Pouziva xml.etree.ElementTree.iterparse nad streamovanym
pripojenim (requests, stream=True), takze v pameti nikdy neni
cely 255MB dokument - jen jeden SHOPITEM najednou.
"""

import json
import os
import sys
import unicodedata
import xml.etree.ElementTree as ET

import requests

# Nazev popisneho parametru s puvodnim kodem. Porovnava se case-
# insensitive a bez diakritiky (norm_name) - pokud si klient nazev
# v adminu prejmenuje, generate() to ma detekovat a selhat viditelne
# (viz kontrola za hlavni smyckou), ne tise vratit prazdny slovnik.
ORIGINAL_CODE_PARAM_NAME = "Původní kód"

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


def norm_name(s):
    """Male pismena, bez diakritiky, bez zdvojenych mezer - pro
    porovnani nazvu popisneho parametru nezavisle na tom, jak presne
    ho klient v adminu napsal."""
    if s is None:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return " ".join(s.lower().split())


ORIGINAL_CODE_PARAM_NAME_NORM = norm_name(ORIGINAL_CODE_PARAM_NAME)


def read_text_properties(elem):
    """Popisne parametry primo na SHOPITEM nebo VARIANT (TEXT_PROPERTIES/
    TEXT_PROPERTY - jina vetev nez variantni PARAMETERS v read_params).
    Vraci (puvodni_kod nebo None, pocet nedoprazdnych popisnych
    parametru celkem) - druha hodnota slouzi jen k detekci, ze klient
    prejmenoval parametr (viz kontrola v generate())."""
    matched = None
    count = 0
    for holder in direct_children(elem, "TEXT_PROPERTIES"):
        for prop in direct_children(holder, "TEXT_PROPERTY"):
            value = direct_child_text(prop, "VALUE")
            if not value or not value.strip():
                continue
            count += 1
            if matched is None:
                name = direct_child_text(prop, "NAME")
                if name and norm_name(name) == ORIGINAL_CODE_PARAM_NAME_NORM:
                    matched = value.strip()
    return matched, count


def parse_products(xml_stream):
    """Ciste zpracovani streamu XML (bez site/souboru) - vraci
    {"prices", "variantGroups", "originalCodes"} + statistiky pro
    vypis. Vytazeno z generate(), aby se dalo testovat nad malym
    vzorkem XML (viz test_generuj_ceny.py) bez skutecneho stahovani
    255MB feedu."""
    prices = {}
    variant_groups = {}
    original_codes = {}
    seen_products = 0
    seen_variants = 0
    text_properties_seen = 0

    context = ET.iterparse(xml_stream, events=("end",))

    for _, elem in context:
        if elem.tag != "SHOPITEM":
            continue

        seen_products += 1
        base_code = direct_child_text(elem, "CODE")
        base_price = parse_price(direct_child_text(elem, "PRICE_VAT"))
        if base_code and base_price is not None:
            prices[base_code.strip()] = base_price

        base_original, base_tp_count = read_text_properties(elem)
        text_properties_seen += base_tp_count
        if base_code and base_original:
            original_codes[base_code.strip()] = base_original

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

                v_original, v_tp_count = read_text_properties(variant)
                text_properties_seen += v_tp_count
                if v_code and v_original:
                    original_codes[v_code.strip()] = v_original

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

    # Popisne parametry ve feedu jsou, ale ani jeden neodpovida
    # ocekavanemu nazvu - klient nejspis parametr v adminu prejmenoval.
    # Radeji spadnout viditelne nez tise vyrobit prazdny originalCodes.
    if text_properties_seen > 0 and not original_codes:
        sys.exit(
            f"Nalezeno {text_properties_seen} popisnych parametru s hodnotou, ale "
            f"zadny neodpovida nazvu '{ORIGINAL_CODE_PARAM_NAME}' (case-insensitive, "
            f"bez diakritiky). Zkontrolujte, jestli klient nazev parametru v adminu "
            f"nezmenil."
        )

    return {
        "prices": prices,
        "variantGroups": variant_groups,
        "originalCodes": original_codes,
        "seenProducts": seen_products,
        "seenVariants": seen_variants,
    }


def generate():
    url = feed_url()

    with requests.get(url, stream=True, timeout=300) as resp:
        resp.raise_for_status()
        resp.raw.decode_content = True
        result = parse_products(resp.raw)

    output = {
        "prices": result["prices"],
        "variantGroups": result["variantGroups"],
        "originalCodes": result["originalCodes"],
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Hotovo: {len(output['prices'])} kodu, {len(output['variantGroups'])} kodu ve "
          f"skupinach variant (z {result['seenVariants']} variant), "
          f"{len(output['originalCodes'])} puvodnich kodu, "
          f"produktu v feedu: {result['seenProducts']}")
    print(f"Ulozeno do: {OUTPUT_PATH}")


if __name__ == "__main__":
    generate()