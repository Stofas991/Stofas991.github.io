/* ============================================================
   Wavy Boats - doporucene ceny v KOSIKU
   ------------------------------------------------------------
   Autor: Krystof Glos / glos-optimalizace.cz
   Verze: 3.2
   Zaklad: v2.0 (varianty a poctivy souhrn overeny naostro
           18. 8. 2026)

   Co to dela:
   1) U kazdeho radku kosiku vypise doporucenou cenu za kus.
      Kde je cena dealera shodna, nevypisuje nic (dohoda).
   2) Do souhrnu vpravo prida "Doporucene ceny celkem"
      (doporucena cena x pocet kusu, secteno za celou objednavku).
      Souhrn se vypisuje jen tehdy, kdyz se aspon jedna cena
      opravdu lisi - jinak by ho videl i nepihlaseny navstevnik.
   3) Kdyz se u nejake polozky cena nenajde, RIKA TO. Souhrn se
      nikdy nevydava za kompletni, kdyz kompletni neni.

   ZMENA PROTI VERZI 2.0 - ZDROJ DAT
   v2.0 volala pro kazdy kod v kosiku
   www.dealerwb.cz/export/productsComplete.xml?...&hash=...&code=...
   Tenhle export ale vraci i nakupni ceny, interni poznamky,
   skladove stavy a VSECHNY cenove hladiny (tzn. i ceny ostatnich
   dealeru) - a je funkcni i pro nepihlaseneho navstevnika, protoze
   se autorizuje hashem v URL, ne prihlasenim. Ten hash byl navic
   primo v tomto souboru, tedy citelny komukoli ve zdrojovem kodu
   stranky.

   Misto toho se ted cte jednou denne generovany
   scripts/ceny.json (bezi jako GitHub Actions job, viz
   generuj-ceny.py). Obsahuje jen kody a VEREJNE ceny - nakupni
   ceny, ceniky ani hash uz v klientskem kodu nejsou nikde.

   Dusledek: skript uz nezna dealersky cenik ani DPH sazbu, jen
   verejnou cenu s DPH. Rozlisovani "s DPH / bez DPH" (SHOW_WITH_VAT
   v predchozich verzich) a zobrazeni marze (SHOW_MARGIN) tedy
   odpadly - k prvnimu chybi sazba DPH, k druhemu dealerska cena.
   Kdyby to bylo potreba, da se snadno doplnit do ceny.json.

   Kod produktu NENI v kosiku videt, ale je v DOM:
   <tr data-micro="cartItem" data-micro-sku="99981T3">
   U varianty je tam kod VARIANTY (overeno: 1001E031A). V ceny.json
   je kazda varianta pod svym vlastnim kodem, takze presna shoda
   kodu z data-micro-sku stac.

   Vlozeni: Vzhled a obsah -> Editor -> HTML kody -> paticka
   Muze byt vlozeno soucasne s wavy-rrp-detail.js, scripty se
   neovlivnuji.

   VERZE 3.1 (20. 8. 2026) - window.WB_RRP_KOSIK.ensurePrices vystaveno
   navenek, aby wavy-original-code-katalog.js mohl pouzit STEJNY
   stazeny/cachovany ceny.json namisto dalsiho fetch().

   VERZE 3.2 (24. 8. 2026, zadani oprav P2/P4) - katalogovy skript uz
   ensurePrices nevola (presel na vlastni maly kody.json, viz jeho
   soubor) - vystaveni tu zustava jen jako verejne API pro pripadne
   dalsi skripty, uz ne kriticka cesta pro katalog. Cache v
   sessionStorage ted ma verzi a TTL (cacheRead/cacheWrite) namisto
   drivejsiho neomezeneho zmrazeni na cely zivot zalozky, a
   PRICES_URL ma ?v= pro cache-busting po nasazeni.
   ============================================================ */

(function () {
  'use strict';

  /* ================= KONFIGURACE ================= */
  var CONFIG = {
    // Denne generovany soubor - viz generuj-ceny.py + GitHub Actions
    // workflow. Zadny hash, zadna citliva data.
    //
    // ?v= (zadani oprav 24.8.2026, P2) - cache-busting v URL. GitHub
    // Pages vraci Cache-Control: max-age=600 a nejde to zmenit (zadna
    // vlastni HTTP hlavicka na GH Pages neexistuje) - verzovana URL
    // ale zajisti, ze po nasazeni nove verze dat CACHE_VERSION nize
    // (P4) okamzite prestane pouzivat starou sessionStorage kopii,
    // i kdyz by jeste 600s platila HTTP cache prohlizece.
    PRICES_URL: 'https://glos-optimalizace.cz/scripts/ceny.json?v=20260824',

    ROW_LABEL: 'Doporučená',
    SUM_LABEL: 'Doporučené ceny celkem:',
    PENDING_LABEL: 'Přepočítávám…',

    // Preskrtnuti hodnoty.
    // POZOR: dohoda s klientem (mail) mluvi o PRESKRTNUTE cene.
    // Vypnuto na vyslovne prani - pri predani to zminte, aby to
    // nevypadalo jako nedodelek.
    STRIKETHROUGH: false,

    // Vypsat souhrn jen tehdy, kdyz se aspon u jedne polozky
    // doporucena cena od ceny v kosiku opravdu lisi.
    //
    // Bez teto pojistky se souhrn vypisoval VZDY, tzn. i
    // nepihlasenemu navstevnikovi - ten ma v kosiku rovnou verejne
    // ceny, takze videl "Doporucene ceny celkem" rovnou cene kosiku.
    // Radky se mu skryly (viz SHOW_WHEN_EQUAL), souhrn ne.
    SUM_ONLY_WHEN_ROW_SHOWN: true,

    // Vypsat doporucenou cenu i u produktu, kde je shodna s cenou
    // v radku kosiku. Zamerne false - tak je to popsane v dohode.
    // POZOR: do SOUCTU se takova polozka pocita vzdy, i kdyz se u
    // radku nic nevypise. Souhrn je souctem doporucenych cen za
    // celou objednavku, ne souctem toho, co je videt.
    SHOW_WHEN_EQUAL: false,

    /* ---------- co kdyz se polozka nenajde ---------- */
    // 'warn' = vypsat souhrn a pod nim upozorneni
    // 'hide' = nevypisovat souhrn vubec
    // Nikdy se nevypisuje jen cislo bez upozorneni - nekompletni
    // souhrn, ktery vypada kompletne, je horsi nez zadny.
    INCOMPLETE_MODE: 'warn',
    INCOMPLETE_LABEL: 'Bez doporučené ceny: ',
    INCOMPLETE_SUFFIX: ' pol. (cena se nenačetla)',

    // ceny.json se stahuje jen jednou za relaci prohlizece.
    CACHE: true,
    CACHE_KEY: 'wbRrp3_ceny',

    // P4 (zadani oprav 24.8.2026): sessionStorage cache drzela 3,21 MB
    // BEZ casove znacky a bez verze - zustavala zmrazena po celou dobu
    // zivota zalozky (i kdyz se mezitim ceny.json aktualizoval), a byla
    // nepohodlne blizko 5MB limitu sessionStorage na Safari/iOS. Ted se
    // uklada s obalkou {v, ts, data} - CACHE_VERSION zmenit pri kazdem
    // vyznamnem prevygenerovani dat, CACHE_TTL_MS omezuje, jak dlouho
    // se zmrazena kopie pouziva bez ohledu na verzi.
    CACHE_VERSION: '20260824',
    CACHE_TTL_MS: 30 * 60 * 1000, // 30 minut

    // Kosik se po zmene mnozstvi prekresluje AJAXem, po prekresleni
    // se musi vlozene radky obnovit.
    WATCH_CHANGES: true,
    REDRAW_DELAY: 250,

    DEBUG: false
  };

  var ROW_CLASS = 'wb-rrp-cart';
  var SUM_CLASS = 'wb-rrp-sum';

  var lastReport = null;
  var pricesPromise = null;

  /* ================= POMOCNE ================= */

  function log() {
    if (CONFIG.DEBUG && window.console) {
      console.log.apply(console, ['[RRP kosik]'].concat([].slice.call(arguments)));
    }
  }

  function formatPrice(value) {
    return Math.round(value).toLocaleString('cs-CZ') + ' Kč';
  }

  // Z textu vytahne cislo pred "Kc" (nezlomitelne mezery, oddelovace
  // tisicu, desetinna carka).
  function priceFromText(text) {
    if (!text) return null;
    var t = String(text).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    var m = t.match(/(-?\d[\d ]*(?:[.,]\d+)?)\s*(?:Kč|Kc|CZK)/i);
    if (!m) return null;
    var n = parseFloat(m[1].replace(/ /g, '').replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  /* ================= CENY.JSON ================= */

  // Cte obalku {v, ts, data} - vraci data jen kdyz verze sedi A jeste
  // nevyprsel CACHE_TTL_MS. Stara/neverzovana polozka (napr. z pred
  // P4) proste nesedi na format a spadne do catch -> cte se znovu.
  function cacheRead() {
    if (!CONFIG.CACHE) return null;
    try {
      var raw = window.sessionStorage.getItem(CONFIG.CACHE_KEY);
      if (!raw) return null;
      var envelope = JSON.parse(raw);
      if (!envelope || envelope.v !== CONFIG.CACHE_VERSION) return null;
      if (Date.now() - envelope.ts > CONFIG.CACHE_TTL_MS) return null;
      return envelope.data;
    } catch (e) {
      return null; // sessionStorage nemusi byt k dispozici / poskozeny zaznam
    }
  }

  function cacheWrite(data) {
    if (!CONFIG.CACHE) return;
    try {
      window.sessionStorage.setItem(CONFIG.CACHE_KEY,
        JSON.stringify({ v: CONFIG.CACHE_VERSION, ts: Date.now(), data: data }));
    } catch (e) {
      /* QuotaExceededError apod. - cache je jen bonus, pokracuj bez ni */
    }
  }

  // Stahne se jen jednou (modulova promenna), navic si to drzi
  // sessionStorage (s TTL a verzi - viz cacheRead/cacheWrite, P4),
  // aby se pri navratu na kosik ve stejne relaci nemuselo znovu
  // stahovat.
  function ensurePrices() {
    if (pricesPromise) return pricesPromise;

    var cached = cacheRead();
    if (cached) {
      pricesPromise = Promise.resolve(cached);
      return pricesPromise;
    }

    pricesPromise = fetch(CONFIG.PRICES_URL, { credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' - ceny.json nedostupny');
        return res.json();
      })
      .then(function (data) {
        cacheWrite(data);
        return data;
      })
      .catch(function (err) {
        log('ceny.json se nepodarilo nacist', err);
        pricesPromise = null; // dalsi run() to zkusi znovu
        throw err;
      });

    return pricesPromise;
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

  // Cena za kus s DPH tak, jak ji vidi aktualni navstevnik.
  // Overena struktura bunky:
  //   td.p-price > span.p-label + strong.price-final + span.unit-value
  // Nas vlozeny blok je take v .p-price, proto se pred ctenim
  // odstranuje z klonu - jinak bychom pri prekresleni cetli sebe.
  function getRowUnitPrice(row) {
    var cell = row.querySelector('.p-price');
    if (!cell) return null;

    var direct = cell.querySelector('strong.price-final, .price-final');
    if (direct && !direct.closest('.' + ROW_CLASS)) {
      var value = priceFromText(direct.textContent);
      if (value != null) return value;
    }

    var clone = cell.cloneNode(true);
    var mine = clone.querySelectorAll('.' + ROW_CLASS);
    for (var i = 0; i < mine.length; i++) mine[i].parentNode.removeChild(mine[i]);
    return priceFromText(clone.textContent);
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
    value.style.cssText = 'color:#333;font-weight:600;'
      + (CONFIG.STRIKETHROUGH ? 'text-decoration:line-through;' : '');

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

  function summaryBox() {
    return document.querySelector('.price-wrapper');
  }

  // Na dobu prepoctu se vypisuje placeholder. Bez nej dealerovi po
  // zmene mnozstvi radka se souhrnem na ~2 s zmizi a vypada to,
  // jako by fice byla rozbita.
  //
  // Placeholder se vsak nesmi objevit tomu, komu se souhrn vubec
  // nema ukazovat (nepihlaseny, dealer bez rabatu) - proto jen
  // tehdy, kdyz uz souhrn jednou vypsany byl.
  function renderPending() {
    if (!lastReport || (CONFIG.SUM_ONLY_WHEN_ROW_SHOWN && !lastReport.shown)) return;
    var wrap = summaryBox();
    if (!wrap || document.querySelector('.' + SUM_CLASS)) return;
    var line = renderRowLine(CONFIG.SUM_LABEL, CONFIG.PENDING_LABEL, true);
    line.style.paddingTop = '10px';
    line.style.borderTop = '1px solid #e0e0e0';
    wrap.appendChild(line);
  }

  function renderSummary(report) {
    var wrap = summaryBox();
    if (!wrap) { log('souhrnny box nenalezen'); return; }

    // Zadny radek se nelisi = souhrn nema komu co rict.
    // Sem spada nepihlaseny navstevnik i dealer bez rabatu.
    if (CONFIG.SUM_ONLY_WHEN_ROW_SHOWN && !report.shown) {
      log('zadna cena se nelisi - souhrn se nevypisuje');
      return;
    }

    if (report.missing > 0 && CONFIG.INCOMPLETE_MODE === 'hide') {
      log('souhrn skryt -', report.missing, 'polozek bez ceny');
      return;
    }

    var first = renderRowLine(CONFIG.SUM_LABEL, formatPrice(report.sumRecommended), false);
    first.style.paddingTop = '10px';
    first.style.borderTop = '1px solid #e0e0e0';
    wrap.appendChild(first);

    if (report.missing > 0) {
      var warn = renderRowLine(
        CONFIG.INCOMPLETE_LABEL,
        report.missing + CONFIG.INCOMPLETE_SUFFIX,
        true
      );
      warn.style.color = '#c00';
      warn.style.fontSize = '12px';
      wrap.appendChild(warn);
    }
  }

  /* ================= HLAVNI BEH ================= */

  var running = false;
  var queued = false;

  function run() {
    // v1.0 tady jen "if (running) return;" - pri soubehu se druhe
    // volani tise zahodilo a uz se nikdy nezopakovalo.
    if (running) { queued = true; return; }

    var rows = getRows();
    if (!rows.length) return;

    running = true;
    clearRendered();
    renderPending();

    ensurePrices()
      .then(function (data) {
        var prices = (data && data.prices) || {};

        var results = rows.map(function (row) {
          var sku = row.getAttribute('data-micro-sku');

          // Radek bez SKU (darek, doprava) do rozhodovani nepatri.
          if (!sku) return { skipped: true };

          var recommended = prices[sku];
          if (recommended == null) return { sku: sku, missing: true };

          var qty = getQuantity(row);
          var onPage = getRowUnitPrice(row);

          // Do souctu polozka patri vzdy. Skryva se jen radek.
          var visible = true;
          if (!CONFIG.SHOW_WHEN_EQUAL && onPage != null
              && Math.round(recommended) <= Math.round(onPage)) {
            visible = false;
          }

          return {
            sku: sku,
            unit: recommended,
            recommended: recommended * qty,
            qty: qty,
            onPage: onPage,
            visible: visible
          };
        });

        var report = {
          sumRecommended: 0,
          missing: 0,
          shown: 0,
          signature: cartSignature(),
          items: []
        };

        results.forEach(function (r) {
          if (!r || r.skipped) return;
          if (r.missing) {
            report.missing++;
            report.items.push({ sku: r.sku, stav: 'nenalezeno' });
            return;
          }
          report.sumRecommended += r.recommended;
          if (r.visible) report.shown++;
          report.items.push({
            sku: r.sku, ks: r.qty, cenaVRadku: r.onPage,
            doporucenaCelkem: Math.round(r.recommended),
            vypsano: r.visible
          });
        });

        // Az tady se kresli, jednim prubehem. clearRendered odstrani
        // i placeholder "Prepocitavam...".
        clearRendered();
        results.forEach(function (r, i) {
          if (r && !r.skipped && !r.missing && r.visible) {
            renderRow(rows[i], r.unit);
          }
        });

        if (report.sumRecommended > 0 || report.missing > 0) {
          renderSummary(report);
        }

        lastReport = report;
        log('souhrn', report.sumRecommended, '| bez ceny:', report.missing);
      })
      .catch(function (err) {
        log('run() selhal -', err);
        clearRendered();
      })
      .then(function () {
        running = false;
        if (queued) { queued = false; setTimeout(run, 0); }
      });
  }

  /* ================= PREKRESLOVANI ================= */

  // Podpis obsahu kosiku: kod + pocet kusu za kazdy radek.
  // Podle nej se pozna skutecna zmena (pridani, odebrani, zmena
  // mnozstvi) nezavisle na tom, jestli je na strance co videt.
  function cartSignature() {
    return getRows().map(function (row) {
      return (row.getAttribute('data-micro-sku') || '?') + ':' + getQuantity(row);
    }).join('|');
  }

  function needsRedraw() {
    if (!getRows().length) return false;

    // Jeste jsme nebezeli (kosik se donacetl az po startu).
    if (!lastReport) return true;

    // Zmenil se obsah kosiku - prepocitat, i kdyz zadny nas prvek
    // na strance neni. Nova polozka muze mit rabat, i kdyz zadna
    // z predchozich ho nemela.
    if (lastReport.signature !== cartSignature()) return true;

    // Shoptet prekreslil DOM a smazal nase prvky. Hlida se jen to,
    // co tam podle posledniho behu patri - jinak by observer u
    // nepihlaseneho (kde se zamerne nekresli nic) volal run()
    // po kazde zmene v DOM.
    if (lastReport.shown > 0 && !document.querySelector('.' + ROW_CLASS)) return true;

    var sumExpected = !CONFIG.SUM_ONLY_WHEN_ROW_SHOWN || lastReport.shown > 0;
    if (sumExpected && !document.querySelector('.' + SUM_CLASS)) return true;

    return false;
  }

  function watch() {
    if (!CONFIG.WATCH_CHANGES) return;

    var timer = null;
    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (needsRedraw()) run();
      }, CONFIG.REDRAW_DELAY);
    }

    var observer = new MutationObserver(function (records) {
      // Ignoruj vlastni vlozene prvky, jinak observer bezi v kruhu.
      for (var i = 0; i < records.length; i++) {
        var t = records[i].target;
        if (t.closest && (t.closest('.' + ROW_CLASS) || t.closest('.' + SUM_CLASS))) continue;
        schedule();
        return;
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Shoptet po zmene kosiku vystreli vlastni event. Kdyz ho tato
    // verze sablony ma, je to spolehlivejsi nez observer nad body.
    ['ShoptetDOMCartItemsUpdated', 'ShoptetDOMCartUpdated', 'ShoptetDOMPageContentLoaded']
      .forEach(function (name) {
        document.addEventListener(name, function () {
          log('event', name);
          schedule();
        });
      });
  }

  /* ================= LADICI API ================= */

  window.WB_RRP_KOSIK = {
    // Na /kosik/ spustit: WB_RRP_KOSIK.debug()
    debug: function () {
      var out = {
        radky: getRows().map(function (r) {
          return {
            sku: r.getAttribute('data-micro-sku'),
            ks: getQuantity(r),
            cenaVRadku: getRowUnitPrice(r),
            vypsano: !!r.querySelector('.' + ROW_CLASS)
          };
        }),
        souhrn: (document.querySelector('.' + SUM_CLASS) || {}).textContent || null,
        report: lastReport
      };
      if (window.console) {
        console.log('[RRP kosik] diagnostika:', out);
        if (console.table) console.table(out.radky);
      }
      return out;
    },
    reload: function () {
      try { window.sessionStorage.removeItem(CONFIG.CACHE_KEY); } catch (e) { /* ignore */ }
      pricesPromise = null;
      lastReport = null;
      clearRendered();
      run();
    },
    run: run,
    config: CONFIG,

    // Sdileny pristup k ceny.json pro dalsi skripty na strance (napr.
    // wavy-original-code-katalog.js) - vraci STEJNY promise/cache jako
    // kosik, aby se soubor nestahoval podruhe. Bezpecne volat i na
    // strankach bez kosiku, protoze tento skript je v paticce vsude.
    ensurePrices: ensurePrices
  };

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
   OVERENO 17.-18. 8. 2026 na v1.0/v2.0 (naostro, proti
   productsComplete.xml)
   ------------------------------------------------------------
   Kosik s 5 polozkami, prihlaseny dealer, cenik VO - Prodej:
   8M0223380   59 Kc x5   doporucena  86 Kc
   8M0210412   47 Kc x1   doporucena  63 Kc
   130651      90 Kc x1   doporucena  90 Kc  <- shodne, radek skryty
   8M0215696  101 Kc x1   doporucena 137 Kc
   FO13944     84 Kc x1   doporucena 122 Kc
   ---------------------------------------------
   Celkem za zbozi         617 Kc
   Doporucene ceny celkem  842 Kc

   Zmena mnozstvi 5 -> 6 ks dala spravne 928 Kc.

   v3.0 mela stejnou logiku vyhodnoceni radku a souctu, jen jiny
   zdroj dat (ceny.json namisto per-kod dotazu na feed). Hodnoty
   nahore by tedy mely vyjit stejne - overit po nasazeni.

   CO ZBYVA OVERIT
   a) ze GitHub Actions job dobehl a ceny.json je na
      https://glos-optimalizace.cz/scripts/ceny.json dostupny a
      neni prazdny ({"prices":{...}} s tisici zaznamu).
   b) castka v souhrnu po nasazeni v3.0 sedi s hodnotami tabulky
      nahore.
   c) chovani pri vypadku ceny.json (napr. spatny nazev branch pro
      GitHub Pages) - radky se nemaji vypisovat s chybnou hodnotou,
      maji zmizet cele. To zajistuje catch() v run().
   ============================================================ */