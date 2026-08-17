/* ============================================================
   Wavy Boats - doporucene ceny v KOSIKU
   ------------------------------------------------------------
   Autor: Krystof Glos / glos-optimalizace.cz
   Verze: 1.0
   Stav:  Overeno naostro na www.dealerwb.cz/kosik/

   Co to dela:
   1) U kazdeho radku kosiku vypise doporucenou cenu za kus
   2) Do souhrnu vpravo prida "Doporucene ceny celkem"
      (doporucena cena x pocet kusu, secteno za celou objednavku)

   Kod produktu NENI v kosiku videt, ale je v DOM:
   <tr data-micro="cartItem" data-micro-sku="99981T3">
   Odtud se cte - neni potreba dolovat ho z URL produktu.

   Vlozeni: Vzhled a obsah -> Editor -> HTML kody -> paticka
   Muze byt vlozeno soucasne s wavy-rrp-detail.js, scripty se
   neovlivnuji a sdileji cache pres stejny CACHE_PREFIX.
   ============================================================ */

(function () {
  'use strict';

  /* ================= KONFIGURACE ================= */
  var CONFIG = {
    // POZOR: hash patri ke KONKRETNI sablone exportu (zde patternId=-5).
    // Zamena patternId bez vymeny hashe vraci HTTP 404.
    FEED_BASE: 'https://www.dealerwb.cz/export/productsComplete.xml',
    FEED_QUERY: '?patternId=-5&partnerId=10&hash=738e78238a7d577048263ecf38a28f593beda19c0cd2dc4bb785db326f97e01a',

    SHOW_WITH_VAT: true,

    ROW_LABEL: 'Doporučená',
    SUM_LABEL: 'Doporučené ceny celkem:',

    // Vypsat doporucenou cenu i u produktu, kde je shodna s cenou
    // dealera. Zamerne true - kdyz se u jednoho radku objevi a u
    // jineho ne, dealer nevi, jestli produkt RRP nema, nebo jestli
    // se neco nenacetlo.
    SHOW_WHEN_EQUAL: true,

    // Zobrazit i rozdil (marze za objednavku). Zamerne vypnuto -
    // je to informace, kterou by mel schvalit klient.
    SHOW_MARGIN: false,
    MARGIN_LABEL: 'Rozdíl:',

    CACHE: true,
    CACHE_PREFIX: 'wbRrp_',

    // Kosik se po zmene mnozstvi prekresluje AJAXem, po prekresleni
    // se musi vlozene radky obnovit.
    WATCH_CHANGES: true,
    REDRAW_DELAY: 400,

    DEBUG: false
  };

  var ROW_CLASS = 'wb-rrp-cart';
  var SUM_CLASS = 'wb-rrp-sum';

  /* ================= POMOCNE ================= */

  function log() {
    if (CONFIG.DEBUG && window.console) {
      console.log.apply(console, ['[RRP kosik]'].concat([].slice.call(arguments)));
    }
  }

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

  function formatPrice(value) {
    return Math.round(value).toLocaleString('cs-CZ') + ' Kč';
  }

  function withoutVat(priceWithVat, vatPercent) {
    if (priceWithVat == null) return null;
    return priceWithVat / (1 + (vatPercent || 0) / 100);
  }

  /* ================= CTENI Z KOSIKU ================= */

  function getRows() {
    return [].slice.call(document.querySelectorAll('tr[data-micro="cartItem"]'));
  }

  // Mnozstvi je input[name="amount"] (data-testid="cartAmount").
  // POZOR: v bunce jsou i skryte inputy itemId a priceId - ty
  // obsahuji GUID, ne cislo, takze se na ne nesmi spolehnout.
  function getQuantity(row) {
    var input = row.querySelector('input[name="amount"], input[data-testid="cartAmount"]');
    if (!input) return 1;
    var n = parseFloat(input.value);
    return (isNaN(n) || n <= 0) ? 1 : n;
  }

  /* ================= FEED ================= */

  function feedUrl(code) {
    return CONFIG.FEED_BASE + CONFIG.FEED_QUERY + '&code=' + encodeURIComponent(code);
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

      var dealerWithVat = null;
      var pl = item.getElementsByTagName('PRICELIST')[0];
      if (pl) {
        var pv = pl.getElementsByTagName('PRICE_VAT')[0];
        if (pv) {
          var d = parseFloat(String(pv.textContent).replace(',', '.'));
          dealerWithVat = isNaN(d) ? null : d;
        }
      }

      return {
        vat: toNumber(directChild(item, 'VAT')) || 0,
        mainWithVat: toNumber(directChild(item, 'PRICE_VAT')),
        dealerWithVat: dealerWithVat
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
        if (hit) return Promise.resolve(JSON.parse(hit));
      } catch (e) { /* ignore */ }
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

  function clearRendered() {
    var old = document.querySelectorAll('.' + ROW_CLASS + ', .' + SUM_CLASS);
    for (var i = 0; i < old.length; i++) {
      old[i].parentNode.removeChild(old[i]);
    }
  }

  function renderRow(row, recommended) {
    var cell = row.querySelector('.p-price');
    if (!cell || cell.querySelector('.' + ROW_CLASS)) return;

    var box = document.createElement('div');
    box.className = ROW_CLASS;
    box.style.cssText = 'margin-top:5px;font-size:12px;color:#888;line-height:1.3;';

    var label = document.createElement('span');
    label.textContent = CONFIG.ROW_LABEL;

    var value = document.createElement('strong');
    value.textContent = formatPrice(recommended);
    value.style.cssText = 'color:#333;font-weight:600;';

    box.appendChild(label);
    box.appendChild(document.createElement('br'));
    box.appendChild(value);
    cell.appendChild(box);
  }

  function renderRowLine(labelText, valueText, muted) {
    var line = document.createElement('div');
    line.className = SUM_CLASS;
    line.style.cssText = 'margin-top:8px;font-size:13px;color:#666;'
      + 'display:flex;justify-content:space-between;gap:10px;';

    var label = document.createElement('span');
    label.textContent = labelText;

    var value = document.createElement('strong');
    value.textContent = valueText;
    value.style.cssText = muted ? 'color:#666;font-weight:600;' : 'color:#333;font-weight:600;';

    line.appendChild(label);
    line.appendChild(value);
    return line;
  }

  function renderSummary(sumRecommended, sumDealer) {
    var wrap = document.querySelector('.price-wrapper');
    if (!wrap) { log('souhrnny box nenalezen'); return; }

    var first = renderRowLine(CONFIG.SUM_LABEL, formatPrice(sumRecommended), false);
    first.style.paddingTop = '10px';
    first.style.borderTop = '1px solid #e0e0e0';
    wrap.appendChild(first);

    if (CONFIG.SHOW_MARGIN && sumDealer != null) {
      wrap.appendChild(
        renderRowLine(CONFIG.MARGIN_LABEL, formatPrice(sumRecommended - sumDealer), true)
      );
    }
  }

  /* ================= HLAVNI BEH ================= */

  var running = false;

  function run() {
    if (running) return;
    var rows = getRows();
    if (!rows.length) return;

    running = true;
    clearRendered();

    var jobs = rows.map(function (row) {
      var sku = row.getAttribute('data-micro-sku');
      if (!sku) return Promise.resolve(null);

      return loadFeedData(sku)
        .then(function (data) {
          if (!data || data.mainWithVat == null) return null;

          var recommended = CONFIG.SHOW_WITH_VAT
            ? data.mainWithVat
            : withoutVat(data.mainWithVat, data.vat);

          var dealer = CONFIG.SHOW_WITH_VAT
            ? data.dealerWithVat
            : withoutVat(data.dealerWithVat, data.vat);

          if (recommended == null) return null;

          if (!CONFIG.SHOW_WHEN_EQUAL && dealer != null
              && Math.round(recommended) <= Math.round(dealer)) {
            return null;
          }

          var qty = getQuantity(row);
          renderRow(row, recommended);

          return {
            recommended: recommended * qty,
            dealer: dealer != null ? dealer * qty : null
          };
        })
        .catch(function (err) { log('chyba u', sku, err); return null; });
    });

    Promise.all(jobs).then(function (results) {
      var sumRecommended = 0;
      var sumDealer = 0;
      var dealerKnown = true;

      results.forEach(function (r) {
        if (!r) return;
        sumRecommended += r.recommended;
        if (r.dealer == null) dealerKnown = false;
        else sumDealer += r.dealer;
      });

      if (sumRecommended > 0) {
        renderSummary(sumRecommended, dealerKnown ? sumDealer : null);
        log('souhrn', sumRecommended);
      }
      running = false;
    });
  }

  /* ================= PREKRESLOVANI ================= */

  function watch() {
    if (!CONFIG.WATCH_CHANGES) return;

    var timer = null;
    var observer = new MutationObserver(function () {
      // Prekreslit jen kdyz zmizely nase vlozene prvky, jinak by
      // se observer spoustel sam od sebe do nekonecna.
      if (document.querySelector('.' + ROW_CLASS)) return;
      if (!getRows().length) return;

      clearTimeout(timer);
      timer = setTimeout(run, CONFIG.REDRAW_DELAY);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ================= START ================= */

  function init() {
    if (!getRows().length) {
      log('nejsme na kosiku nebo je prazdny');
      // Kosik se muze donacist az pozdeji, proto sledujeme zmeny i tak
      watch();
      return;
    }
    run();
    watch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* ============================================================
   OVERENO 17. 8. 2026 (prihlaseny dealer, cenik VO - Prodej)
   ------------------------------------------------------------
   Kosik se 2 polozkami:
   99981T3    cena  90 Kc   doporucena  90 Kc  (shodne)
   8M0210412  cena  47 Kc   doporucena  63 Kc
   ---------------------------------------------
   Celkem za zbozi         137 Kc
   Doporucene ceny celkem  153 Kc  (presne 152,91)

   CO JESTE NENI OVERENO
   - zmena mnozstvi v kosiku (AJAX prekresleni). Logika pro nej
     je pripravena (MutationObserver), ale netestovana naostro.
     Pri testu zvyste pocet kusu a zkontrolujte, ze se radky vrati
     a ze souhrn odpovida doporucena x pocet kusu.
   - kosik s vetsim mnozstvim polozek. Feed se vola pro kazdy kod
     zvlast (s cache), takze u desitek polozek zvazte stazeni
     celeho feedu jednim requestem.

   POZNAMKA K CENAM
   Pocet kusu se cte z input[name="amount"]. V bunce s mnozstvim
   jsou i skryte inputy itemId a priceId, ktere obsahuji GUID -
   na ty se nesmi spolehnout, jinak souhrn vyjde vzdy pro 1 ks.
   ============================================================ */
