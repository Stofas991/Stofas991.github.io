#!/usr/bin/env python3
"""
Testy generuj-ceny.py nad malym vzorkem XML (bez site).

Overuje predevsim novy vystup "originalCodes":
  - popisny parametr "Puvodni kod" se spravne naparsuje na urovni
    SHOPITEM i na urovni jednotlive VARIANT,
  - produkt bez parametru / s prazdnou hodnotou se do originalCodes
    nedostane,
  - porovnani nazvu parametru je case-insensitive a bez diakritiky,
  - zadny ze zakazanych tagu (PURCHASE_PRICE, PRICELIST, PRICELISTS,
    INTERNAL_NOTE, STOCK) se nedostane do vystupu, i kdyz je ve
    vzorku pritomen s hodnotou,
  - kdyz feed obsahuje popisne parametry, ale ani jeden neodpovida
    ocekavanemu nazvu, skript spadne viditelne (SystemExit).

Spusteni: python scripts/test_generuj_ceny.py
"""

import importlib.util
import io
import json
import os
import unittest

# "generuj-ceny.py" ma v nazvu pomlcku, takze normalni "import" nejde -
# modul se musi nacist rucne ze souboru vedle tohoto testu.
_MODULE_PATH = os.path.join(os.path.dirname(__file__), "generuj-ceny.py")
_spec = importlib.util.spec_from_file_location("generuj_ceny", _MODULE_PATH)
gc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gc)


SAMPLE_XML = """<?xml version="1.0" encoding="UTF-8"?>
<SHOP>
<SHOPITEMS>

  <!-- 1) zakladni produkt s puvodnim kodem + vsechny zakazane tagy vyplnene -->
  <SHOPITEM>
    <CODE>TEST001</CODE>
    <PRICE_VAT>100.00</PRICE_VAT>
    <PURCHASE_PRICE>SECRET_PURCHASE_PRICE</PURCHASE_PRICE>
    <INTERNAL_NOTE>SECRET_INTERNAL_NOTE</INTERNAL_NOTE>
    <STOCK>SECRET_STOCK_LEVEL</STOCK>
    <PRICELISTS>
      <PRICELIST>
        <TITLE>SECRET_PRICELIST_TITLE</TITLE>
        <PRICE_VAT>SECRET_DEALER_PRICE</PRICE_VAT>
      </PRICELIST>
    </PRICELISTS>
    <TEXT_PROPERTIES>
      <TEXT_PROPERTY>
        <NAME>Původní kód</NAME>
        <VALUE>OLD001</VALUE>
        <DESCRIPTION></DESCRIPTION>
      </TEXT_PROPERTY>
    </TEXT_PROPERTIES>
  </SHOPITEM>

  <!-- 2) produkt bez popisnych parametru vubec -->
  <SHOPITEM>
    <CODE>TEST002</CODE>
    <PRICE_VAT>200.00</PRICE_VAT>
  </SHOPITEM>

  <!-- 3) produkt s variantami - jen jedna varianta ma vlastni puvodni kod -->
  <SHOPITEM>
    <CODE>TEST003</CODE>
    <PRICE_VAT>300.00</PRICE_VAT>
    <VARIANTS>
      <VARIANT>
        <CODE>TEST003-A</CODE>
        <PRICE_VAT>310.00</PRICE_VAT>
        <TEXT_PROPERTIES>
          <TEXT_PROPERTY>
            <NAME>Původní kód</NAME>
            <VALUE>OLD003A</VALUE>
          </TEXT_PROPERTY>
        </TEXT_PROPERTIES>
      </VARIANT>
      <VARIANT>
        <CODE>TEST003-B</CODE>
        <PRICE_VAT>320.00</PRICE_VAT>
      </VARIANT>
    </VARIANTS>
  </SHOPITEM>

  <!-- 4) nazev parametru jinak zapsany (case + diakritika) - musi stale sednout -->
  <SHOPITEM>
    <CODE>TEST004</CODE>
    <PRICE_VAT>400.00</PRICE_VAT>
    <TEXT_PROPERTIES>
      <TEXT_PROPERTY>
        <NAME>  PUVODNI   KOD  </NAME>
        <VALUE>OLD004</VALUE>
      </TEXT_PROPERTY>
    </TEXT_PROPERTIES>
  </SHOPITEM>

  <!-- 5) parametr vyplneny, ale hodnota prazdna - nema se zapsat -->
  <SHOPITEM>
    <CODE>TEST005</CODE>
    <PRICE_VAT>500.00</PRICE_VAT>
    <TEXT_PROPERTIES>
      <TEXT_PROPERTY>
        <NAME>Původní kód</NAME>
        <VALUE></VALUE>
      </TEXT_PROPERTY>
    </TEXT_PROPERTIES>
  </SHOPITEM>

</SHOPITEMS>
</SHOP>
"""

# Feed, kde JE popisny parametr s hodnotou, ale zadny neodpovida
# ocekavanemu nazvu - simuluje klienta, ktery si parametr prejmenoval.
SAMPLE_XML_RENAMED_PARAM = """<?xml version="1.0" encoding="UTF-8"?>
<SHOP>
<SHOPITEMS>
  <SHOPITEM>
    <CODE>TEST999</CODE>
    <PRICE_VAT>999.00</PRICE_VAT>
    <TEXT_PROPERTIES>
      <TEXT_PROPERTY>
        <NAME>Stary kod (jinak nazvano)</NAME>
        <VALUE>SOMEVALUE</VALUE>
      </TEXT_PROPERTY>
    </TEXT_PROPERTIES>
  </SHOPITEM>
</SHOPITEMS>
</SHOP>
"""

FORBIDDEN_MARKERS = [
    "SECRET_PURCHASE_PRICE",
    "SECRET_INTERNAL_NOTE",
    "SECRET_STOCK_LEVEL",
    "SECRET_PRICELIST_TITLE",
    "SECRET_DEALER_PRICE",
]


class ParseProductsTests(unittest.TestCase):

    def setUp(self):
        self.result = gc.parse_products(io.BytesIO(SAMPLE_XML.encode("utf-8")))

    def test_base_product_original_code(self):
        self.assertEqual(self.result["originalCodes"].get("TEST001"), "OLD001")

    def test_product_without_param_omitted(self):
        self.assertNotIn("TEST002", self.result["originalCodes"])

    def test_variant_own_original_code(self):
        self.assertEqual(self.result["originalCodes"].get("TEST003-A"), "OLD003A")
        # varianta bez parametru se nezapisuje
        self.assertNotIn("TEST003-B", self.result["originalCodes"])
        # zakladni produkt (TEST003) sam parametr nema
        self.assertNotIn("TEST003", self.result["originalCodes"])

    def test_name_matching_case_and_diacritics_insensitive(self):
        self.assertEqual(self.result["originalCodes"].get("TEST004"), "OLD004")

    def test_empty_value_skipped(self):
        self.assertNotIn("TEST005", self.result["originalCodes"])

    def test_prices_still_parsed_normally(self):
        # regrese - puvodni chovani (prices/variantGroups) nesmi zmenit refaktor
        self.assertEqual(self.result["prices"]["TEST001"], 100.0)
        self.assertEqual(self.result["prices"]["TEST003-A"], 310.0)
        self.assertIn("TEST003-A", self.result["variantGroups"])
        self.assertIn("TEST003-B", self.result["variantGroups"])

    def test_forbidden_tags_never_leak_into_output(self):
        serialized = json.dumps({
            "prices": self.result["prices"],
            "variantGroups": self.result["variantGroups"],
            "originalCodes": self.result["originalCodes"],
        })
        for marker in FORBIDDEN_MARKERS:
            self.assertNotIn(marker, serialized,
                              f"zakazana hodnota '{marker}' se dostala do vystupu")

    def test_output_has_exactly_expected_top_level_shape(self):
        self.assertIn("prices", self.result)
        self.assertIn("variantGroups", self.result)
        self.assertIn("originalCodes", self.result)


class FailLoudOnRenamedParamTests(unittest.TestCase):

    def test_exits_when_no_text_property_matches_name(self):
        stream = io.BytesIO(SAMPLE_XML_RENAMED_PARAM.encode("utf-8"))
        with self.assertRaises(SystemExit):
            gc.parse_products(stream)


if __name__ == "__main__":
    unittest.main()
