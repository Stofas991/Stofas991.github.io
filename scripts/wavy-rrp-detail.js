/* ============================================================
   Wavy Boats - doporucena cena na DETAILU PRODUKTU
   ------------------------------------------------------------
   Autor: Krystof Glos / glos-optimalizace.cz
   Verze: 3.0
   Stav:  Overeno naostro na www.dealerwb.cz

   Zmeny proti verzi 2.0:
   - doporucena cena se vypisuje VZDY, i kdyz je shodna s cenou
     dealera (SHOW_WHEN_EQUAL). Duvod: kdyz se u jednoho produktu
     objevi a u jineho ne, dealer nevi, jestli produkt RRP nema,
     nebo jestli se neco nenacetlo. Chova se stejne jako kosik.
   - opraveny hash (kazda sablona exportu ma vlastni!)

   Vlozeni: Vzhled a obsah -> Editor -> HTML kody -> paticka
   ============================================================ */

(function () {
  'use strict';

  /* ================= KONFIGURACE ================= */
  var CONFIG = {
    // POZOR: hash patri ke KONKRETNI sablone exportu.
    // Tento hash je pro patternId=-5 (productsComplete).
    // Prepsani patternId bez vymeny hashe vraci HTTP 404.
    FEED_BASE: 'https://www.dealerwb.cz/export/productsComplete.xml',
    FEED_QUERY: '?patternId=-5&partnerId=10&hash=738e78238a7d577048263ecf38a28f593beda19c0cd2dc4bb785db326f97e01a',

    SHOW_WITH_VAT: true,
    LABEL: 'Doporučená cena:',

    // true  = vypsat i kdyz je doporucena cena shodna s cenou dealera
    // false = pri shodne cene nic nevypisovat
    SHOW_WHEN_EQUAL: true,

    // Vypsat jen prihlasenemu dealerovi (tj. tomu, kdo ma vlastni cenik).
    // Ucet bez ceniku vidi bezne koncove ceny, takze by se cena
    // zopakovala dvakrat pod sebou.
    REQUIRE_DEALER_PRICELIST: true,

    // null = prvni cenik ve feedu. Jinak presny nazev z tagu TITLE,
    // napr. 'VO - Prodej' (nutne, pokud dealer muze mit ceniku vic).
    DEALER_PRICELIST_TITLE: null,

    CACHE: true,
    CACHE_PREFIX: 'wbRrp_',

    DEBUG: false
  };

  var CSS_CLASS = 'wb-rrp';

  /* ================= POMOCNE ================= */

  function log() {
    if (CONFIG.DEBUG && window.console) {
      console.log.apply(console, ['[RRP detail]'].concat([].slice.call(arguments)));
    }
  }

  // Pouze primi potomci - PRICE_VAT a VAT jsou i vnorene
  // v PRICELISTS a VARIANTS, takze querySelector by vratil spatny.
  function directChild(parent, tagName) {
    var ch = parent.children;
    for (var i = 0; i < ch.length; i++) {
      if (ch[i].tagName.toUpperCase() === tagName) return ch[i];
    }
    return null;
  }

  function toNumber(el) {
    if (!el) return null;
    var n = parseFloat(String(el.textContent).trim().replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  // Shoptet zaokrouhluje na cele koruny (133.57 -> 134 Kc)
  function formatPrice(value) {
    return Math.round(value).toLocaleString('cs-CZ') + ' Kč';
  }

  function withoutVat(priceWithVat, vatPercent) {
    if (priceWithVat == null) return null;
    return priceWithVat / (1 + (vatPercent || 0) / 100);
  }

  /* ================= CTENI ZE STRANKY ================= */

  function getProductCode() {
    var el = document.querySelector('.p-detail .p-code, .p-code');
    if (!el) return null;
    var clone = el.cloneNode(true);
    var label = clone.querySelector('.p-code-label');
    if (label) label.parentNode.removeChild(label);
    var code = clone.textContent.replace(/^\s*Kód:?\s*/i, '').trim();
    return code || null;
  }

  /* ================= FEED ================= */

  function feedUrl(code) {
    return CONFIG.FEED_BASE + CONFIG.FEED_QUERY + '&code=' + encodeURIComponent(code);
  }

  function pickDealerPricelist(item) {
    var lists = item.getElementsByTagName('PRICELIST');
    for (var i = 0; i < lists.length; i++) {
      var titleEl = lists[i].getElementsByTagName('TITLE')[0];
      var title = titleEl ? titleEl.textContent.trim() : null;

      if (CONFIG.DEALER_PRICELIST_TITLE && title !== CONFIG.DEALER_PRICELIST_TITLE) continue;

      var priceEl = lists[i].getElementsByTagName('PRICE_VAT')[0];
      var price = priceEl ? parseFloat(String(priceEl.textContent).replace(',', '.')) : null;
      if (price == null || isNaN(price)) continue;

      return { title: title, priceWithVat: price };
    }
    return null;
  }

  function parseFeed(xmlText, wantedCode) {
    var xml = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (xml.querySelector('parsererror')) {
      log('XML se nepodarilo naparsovat - overte URL a hash');
      return null;
    }

    var items = xml.getElementsByTagName('SHOPITEM');
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var codeEl = directChild(item, 'CODE');
      if (!codeEl || codeEl.textContent.trim() !== wantedCode) continue;

      var dealer = pickDealerPricelist(item);
      return {
        vat: toNumber(directChild(item, 'VAT')) || 0,
        mainWithVat: toNumber(directChild(item, 'PRICE_VAT')),
        dealerWithVat: dealer ? dealer.priceWithVat : null,
        dealerTitle: dealer ? dealer.title : null
      };
    }

    log('produkt', wantedCode, 've feedu nenalezen');
    return null;
  }

  function loadFeedData(code) {
    var key = CONFIG.CACHE_PREFIX + code;

    if (CONFIG.CACHE) {
      try {
        var hit = window.sessionStorage.getItem(key);
        if (hit) { log('z cache', code); return Promise.resolve(JSON.parse(hit)); }
      } catch (e) { /* sessionStorage nemusi byt k dispozici */ }
    }

    return fetch(feedUrl(code), { credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' - overte patternId a hash');
        return res.text();
      })
      .then(function (text) {
        var data = parseFeed(text, code);
        if (CONFIG.CACHE && data) {
          try { window.sessionStorage.setItem(key, JSON.stringify(data)); } catch (e) { /* ignore */ }
        }
        return data;
      });
  }

  /* ================= VYKRESLENI ================= */

  function render(recommended) {
    if (document.querySelector('.' + CSS_CLASS)) return false;

    var anchor = document.querySelector('.p-final-price-wrapper')
      || document.querySelector('.price-final-holder')
      || document.querySelector('.price-final');
    if (!anchor) { log('nenalezeno misto pro vlozeni'); return false; }

    var box = document.createElement('div');
    box.className = CSS_CLASS;
    box.style.cssText = 'margin-top:8px;font-size:14px;line-height:1.4;';

    var label = document.createElement('span');
    label.className = CSS_CLASS + '-label';
    label.textContent = CONFIG.LABEL + ' ';
    label.style.cssText = 'color:#777;';

    var value = document.createElement('span');
    value.className = CSS_CLASS + '-value';
    value.textContent = formatPrice(recommended);
    value.style.cssText = 'font-weight:600;color:#333;';

    box.appendChild(label);
    box.appendChild(value);
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
    return true;
  }

  /* ================= START ================= */

  function init() {
    if (!document.querySelector('.p-detail, .p-detail-inner-header')) return;

    var code = getProductCode();
    if (!code) { log('kod produktu nenalezen'); return; }

    loadFeedData(code)
      .then(function (data) {
        if (!data) return;

        var recommended = CONFIG.SHOW_WITH_VAT
          ? data.mainWithVat
          : withoutVat(data.mainWithVat, data.vat);

        var dealerPrice = CONFIG.SHOW_WITH_VAT
          ? data.dealerWithVat
          : withoutVat(data.dealerWithVat, data.vat);

        if (recommended == null) { log('hlavni cena ve feedu chybi'); return; }

        if (CONFIG.REQUIRE_DEALER_PRICELIST && dealerPrice == null) {
          log('zadny dealersky cenik - nezobrazuji');
          return;
        }

        if (!CONFIG.SHOW_WHEN_EQUAL && dealerPrice != null
            && Math.round(recommended) <= Math.round(dealerPrice)) {
          log('shodna cena - nezobrazuji');
          return;
        }

        render(recommended);
        log('vykresleno', recommended, 'cenik:', data.dealerTitle);
      })
      .catch(function (err) { log('chyba', err); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* ============================================================
   OVERENE HODNOTY (17. 8. 2026, prihlaseny dealer, VO - Prodej)
   ------------------------------------------------------------
   815026Q     dealer 133,57  doporucena 187,00
   8M0204695   dealer 217,66  doporucena 304,73
   8M0210412   dealer  46,60  doporucena  62,91
   99981T3     dealer  90,00  doporucena  90,00  <- shodne ceny

   POZNAMKY
   1) Kazda sablona exportu ma VLASTNI hash. patternId=-5 patri
      k hashi vyse. Zamena patternId bez vymeny hashe vraci 404
      a script pak tise nic nevypise - proto pri ladeni DEBUG:true.
   2) Vlastni sablony exportu Shoptet nabizi jen jako XLSX/CSV,
      takze pro cteni v prohlizeci se nedaji pouzit.
   3) URL exportu vcetne hashe je v tomto souboru citelna komukoli,
      kdo si zobrazi zdroj stranky. Export obsahuje i PURCHASE_PRICE
      a INTERNAL_NOTE. Pokud to klientovi vadi, resenim je maly
      endpoint na vlastnim serveru, ktery hash drzi u sebe.
   ============================================================ */
