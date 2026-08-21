/* ============================================================
   Wavy Boats - puvodni kod ve VYPISU KATALOGU
   ------------------------------------------------------------
   Autor: Krystof Glos / glos-optimalizace.cz
   Verze: 1.0

   Pro kazdou dlazdici vezme kod z [data-micro="sku"], dohleda ho
   v originalCodes (ceny.json) a vykresli pod kod produktu.

   ZDROJ DAT: STEJNY ceny.json jako wavy-rrp-kosik.js - znovu
   pouziva jeho window.WB_RRP_KOSIK.ensurePrices(), NESTAHUJE
   soubor podruhe. Pokud kosikovy skript neni na strance nacteny
   (nemel by nastat - oba jsou v paticce), original kod se proste
   nevypise (fail-silent, zadny vlastni fetch jako zaloha - to by
   porusilo cely smysl znovupouziti).

   OVERENO NAOSTRO (20.-21. 8. 2026, dealerwb.cz, /adaptery/,
   kod 815303T / puvodni 815303):
   - [data-micro="sku"] je <span> primo uvnitr <span class="p-code">.
   - .p-code je v dlazdici POSITION:ABSOLUTE (top:0; right:0) presne
     nad pravym hornim rohem obrazku produktu (.p je position:relative).
     Bile pozadi, height auto - kdyz se prida druhy radek textu BEZ
     upravy CSS, box jen naroste a zabere vic fotky (overeno primym
     testem - z jednoradkoveho ~19px boxu na ~39px, oboje uvnitr
     vysky obrazku).
   - Oprava: box se OZNACI jako "stitek" (padding, box-shadow,
     zaoblene rohy) jen tehdy, kdyz mu skutecne pridavame druhy
     radek - dlazdice bez puvodniho kodu zustavaji uplne beze zmeny
     (zadna trida, zadny inline styl navic).
   - 30 dlazdic na kategorii = 30 [data-micro="sku"] uzlu, presna
     shoda (overeno driv, viz spec).

   Vlozeni: Vzhled a obsah -> Editor -> HTML kody -> paticka
   (za wavy-rrp-kosik.js, aby WB_RRP_KOSIK uz existoval)
   ============================================================ */

(function () {
  'use strict';

  var CONFIG = {
    TILE_SKU_SELECTOR: '[data-micro="sku"]',
    LABEL: 'Původní kód:',
    WATCH_CHANGES: true,
    debounceMs: 250,
    DEBUG: false
  };

  var CSS_CLASS = 'wb-original-code-tile';
  var BADGE_CLASS = 'wb-code-badge';
  var STYLE_ID = 'wb-original-code-katalog-style';

  function log() {
    if (CONFIG.DEBUG && window.console) {
      console.log.apply(console, ['[original-code katalog]'].concat([].slice.call(arguments)));
    }
  }

  // Styl se vklada jen jednou a jen ovlivnuje elementy s nasi vlastni
  // znackovaci tridou - dlazdice bez puvodniho kodu se ho nikdy
  // nedotknou (BADGE_CLASS se na ne neprida).
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.' + BADGE_CLASS + '{background:#fff;padding:2px 6px;border-radius:0 0 0 6px;' +
      'box-shadow:0 1px 4px rgba(0,0,0,.18);max-width:92%;box-sizing:border-box;}' +
      '.' + CSS_CLASS + '{display:block;font-size:11px;color:#666;line-height:1.3;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;margin-top:1px;}';
    document.head.appendChild(style);
  }

  function ensurePrices() {
    if (window.WB_RRP_KOSIK && typeof window.WB_RRP_KOSIK.ensurePrices === 'function') {
      return window.WB_RRP_KOSIK.ensurePrices();
    }
    log('WB_RRP_KOSIK.ensurePrices nenalezen - nevypisuji (zadny vlastni fetch jako zaloha)');
    return Promise.reject(new Error('WB_RRP_KOSIK neni k dispozici'));
  }

  function renderForTile(skuEl, value) {
    var pCode = skuEl.closest('.p-code') || skuEl.parentElement;
    if (!pCode || pCode.querySelector('.' + CSS_CLASS)) return; // uz vykresleno

    pCode.classList.add(BADGE_CLASS);

    var line = document.createElement('span');
    line.className = CSS_CLASS;
    line.textContent = CONFIG.LABEL + ' ' + value;
    pCode.appendChild(line);
  }

  function run() {
    var skuEls = document.querySelectorAll(CONFIG.TILE_SKU_SELECTOR);
    if (!skuEls.length) return;

    ensurePrices()
      .then(function (data) {
        var originalCodes = (data && data.originalCodes) || {};
        var rendered = 0;

        skuEls.forEach(function (skuEl) {
          var code = (skuEl.textContent || '').trim();
          if (!code) return;
          var value = originalCodes[code];
          if (!value) return; // AC3/AC4 - tise nic, dlazdice vypada jako dnes

          ensureStyle();
          renderForTile(skuEl, value);
          rendered++;
        });

        log('vykresleno', rendered, 'z', skuEls.length, 'dlazdic');
      })
      .catch(function (err) {
        // AC4: vypadek ceny.json = vypis funguje jako dnes, zadna
        // chyba viditelna uzivateli. log() je gated na DEBUG.
        log('ceny.json/originalCodes se nepodarilo nacist:', err && err.message);
      });
  }

  function watchChanges() {
    if (!CONFIG.WATCH_CHANGES) return;

    var timer = null;
    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(run, CONFIG.debounceMs);
    }

    if (!window.MutationObserver) return;

    // Kategorie muze prekreslit vypis AJAXem (razeni, filtr, strankovani
    // bez reloadu) - stejny vzor jako v wavy-rrp-kosik.js.
    var observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var t = records[i].target;
        if (t.closest && (t.closest('.' + CSS_CLASS) || t.closest('.' + BADGE_CLASS))) continue;
        schedule();
        return;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    run();
    watchChanges();
  }

  window.WB_ORIGINAL_CODE_KATALOG = {
    debug: function () {
      var skuEls = document.querySelectorAll(CONFIG.TILE_SKU_SELECTOR);
      var out = {
        dlazdicNalezeno: skuEls.length,
        vykresleno: document.querySelectorAll('.' + CSS_CLASS).length,
        kody: [].slice.call(skuEls).map(function (el) { return (el.textContent || '').trim(); })
      };
      if (window.console) console.log('[original-code katalog] diagnostika:', out);
      return out;
    },
    run: run,
    config: CONFIG
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
