/* ============================================================
   Wavy Boats - doporucene ceny v KOSIKU
   ------------------------------------------------------------
   Autor: Krystof Glos / glos-optimalizace.cz
   Verze: 2.0
   Zaklad: v1.0 (overena naostro, ale jen na produktech BEZ variant)

   Co to dela:
   1) U kazdeho radku kosiku vypise preskrtnutou doporucenou cenu
      za kus. Kde je cena dealera shodna, nevypisuje nic (dohoda).
   2) Do souhrnu vpravo prida "Doporucene ceny celkem"
      (doporucena cena x pocet kusu, secteno za celou objednavku).
   3) Kdyz se u nejake polozky cena nenacte, RIKA TO. Souhrn se
      nikdy nevydava za kompletni, kdyz kompletni neni.

   ZMENY PROTI VERZI 1.0 (vse vychazi z testu 18. 8. 2026)
   1) PODPORA VARIANT. v1.0 hledala jen SHOPITEM, jehoz PRIMY
      potomek CODE se rovna SKU z radku kosiku. U variantniho
      produktu vsak rodicovsky SHOPITEM v tomto exportu CODE ani
      PRICE_VAT jako primeho potomka NEMA - jsou az na VARIANT.
      Dusledek naostro: radek s variantou zustal bez ceny A SOUHRN
      SE VUBEC NEZMENIL. Kosik za 43 599 Kc hlasil "doporucene ceny
      celkem 842 Kc", protoze motor za 42 982 Kc do souctu nespadl.
      Ted se prochazi SHOPITEM i vsechny jeho VARIANT.
   2) POCTIVY SOUHRN. Kdyz se nejaka polozka nenajde, pod souhrn se
      vypise, kolika polozek se to tyka (viz INCOMPLETE_*).
   3) Skryvani pri shodne cene, aby to odpovidalo dohode s klientem.
      Porovnava se s cenou v radku kosiku
      (.p-price strong.price-final), tzn. s cenou aktualni session -
      ne s cenikem z feedu, ktery vraci dealerske ceny vzdy.
      Preskrtnuti je pripravene, ale VYPNUTE (STRIKETHROUGH: false)
      - vedoma odchylka od mailu, viz komentar u CONFIG.
   4) Prekreslovani po zmene mnozstvi. v1.0 se dokazala zaseknout:
      observer se vracel, kdyz na strance zbyl aspon jeden nas
      radek, a run() se pri soubehu tise zahodil. Naostro to
      znamenalo, ze ceny na ~2 s zmizely (mereno: pryc ve 2,6 s,
      zpatky ve 4,6 s). Ted se hlida i chybejici souhrn, soubezne
      volani se zaradi do fronty a na dobu prepoctu se vypisuje
      "Prepocitavam...".
   5) Cenik se cte jen z PRIMYCH potomku uzlu. v1.0 mela
      getElementsByTagName('PRICELIST')[0], cimz u variantniho
      produktu mohla vzit cenik nahodne varianty.

   6) SOUHRN JEN KDYZ SE NECO LISI. Radky se pri shodne cene
      skryvaly, ale souhrn se vypisoval vzdy - takze nepihlaseny
      navstevnik videl "Doporucene ceny celkem" rovnou cene kosiku
      (on ma v kosiku rovnou verejne ceny). Stejne u dealera, ktery
      ma v kosiku jen zbozi bez rabatu. Ted se souhrn i placeholder
      vypisuji jen tehdy, kdyz se aspon u jedne polozky doporucena
      cena od ceny v kosiku lisi (SUM_ONLY_WHEN_ROW_SHOWN).
      Prekreslovani se proto uz neridi jen pritomnosti nasich prvku,
      ale podpisem obsahu kosiku (kod + pocet kusu) - jinak by
      observer u nepihlaseneho volal run() po kazde zmene v DOM.

   Kod produktu NENI v kosiku videt, ale je v DOM:
   <tr data-micro="cartItem" data-micro-sku="99981T3">
   U varianty je tam kod VARIANTY (overeno: 1001E031A).

   Vlozeni: Vzhled a obsah -> Editor -> HTML kody -> paticka
   Muze byt vlozeno soucasne s wavy-rrp-detail.js, scripty se
   neovlivnuji.
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
    // Stejne to plati pro dealera, ktery ma v kosiku jen zbozi bez
    // rabatu - nema smysl mu ukazovat souhrn, kdyz zadna z cen se
    // nelisi.
    SUM_ONLY_WHEN_ROW_SHOWN: true,

    // Vypsat doporucenou cenu i u produktu, kde je shodna s cenou
    // v radku kosiku. Zamerne false - tak je to popsane v dohode.
    // POZOR: do SOUCTU se takova polozka pocita vzdy, i kdyz se u
    // radku nic nevypise. Souhrn je souctem doporucenych cen za
    // celou objednavku, ne souctem toho, co je videt.
    SHOW_WHEN_EQUAL: false,

    // Zobrazit i rozdil (marze za objednavku). Zamerne vypnuto -
    // je to informace, kterou by mel schvalit klient.
    SHOW_MARGIN: false,
    MARGIN_LABEL: 'Rozdíl:',

    /* ---------- co kdyz se polozka nenajde ---------- */
    // 'warn' = vypsat souhrn a pod nim upozorneni
    // 'hide' = nevypisovat souhrn vubec
    // Nikdy se nevypisuje jen cislo bez upozorneni - nekompletni
    // souhrn, ktery vypada kompletne, je horsi nez zadny.
    INCOMPLETE_MODE: 'warn',
    INCOMPLETE_LABEL: 'Bez doporučené ceny: ',
    INCOMPLETE_SUFFIX: ' pol. (cena se nenačetla)',

    CACHE: true,
    CACHE_PREFIX: 'wbRrp2_',

    // Kosik se po zmene mnozstvi prekresluje AJAXem, po prekresleni
    // se musi vlozene radky obnovit.
    WATCH_CHANGES: true,
    REDRAW_DELAY: 250,

    DEBUG: false
  };

  var ROW_CLASS = 'wb-rrp-cart';
  var SUM_CLASS = 'wb-rrp-sum';

  var lastReport = null;

  /* ================= POMOCNE ================= */

  function log() {
    if (CONFIG.DEBUG && window.console) {
      console.log.apply(console, ['[RRP kosik]'].concat([].slice.call(arguments)));
    }
  }

  function directChild(parent, tagName) {
    if (!parent) return null;
    var ch = parent.children;
    for (var i = 0; i < ch.length; i++) {
      if (ch[i].tagName.toUpperCase() === tagName) return ch[i];
    }
    return null;
  }

  function directChildren(parent, tagName) {
    var out = [];
    if (!parent) return out;
    var ch = parent.children;
    for (var i = 0; i < ch.length; i++) {
      if (ch[i].tagName.toUpperCase() === tagName) out.push(ch[i]);
    }
    return out;
  }

  function toNumber(el) {
    if (!el) return null;
    var n = parseFloat(String(el.textContent).trim().replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  function norm(s) {
    return (s === null || s === undefined) ? '' : String(s).trim().toLowerCase();
  }

  function formatPrice(value) {
    return Math.round(value).toLocaleString('cs-CZ') + ' Kč';
  }

  function withoutVat(priceWithVat, vatPercent) {
    if (priceWithVat == null) return null;
    return priceWithVat / (1 + (vatPercent || 0) / 100);
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

  /* ================= FEED ================= */

  function feedUrl(code) {
    return CONFIG.FEED_BASE + CONFIG.FEED_QUERY + '&code=' + encodeURIComponent(code);
  }

  // Cenik hleda JEN v primych potomcich uzlu (SHOPITEM nebo VARIANT).
  // v1.0 tady mela getElementsByTagName, cimz u variantniho produktu
  // sahla i do PRICELISTS jednotlivych variant.
  function pickDealerPricelist(node) {
    var lists = [];
    directChildren(node, 'PRICELISTS').forEach(function (h) {
      lists = lists.concat(directChildren(h, 'PRICELIST'));
    });
    lists = lists.concat(directChildren(node, 'PRICELIST'));

    for (var i = 0; i < lists.length; i++) {
      var price = toNumber(directChild(lists[i], 'PRICE_VAT'));
      if (price != null) return price;
    }
    return null;
  }

  function readNode(node, fallbackVat, fallbackMain, fallbackDealer) {
    var main = toNumber(directChild(node, 'PRICE_VAT'));
    var dealer = pickDealerPricelist(node);
    return {
      code: directChild(node, 'CODE') ? directChild(node, 'CODE').textContent.trim() : null,
      vat: toNumber(directChild(node, 'VAT')) || fallbackVat || 0,
      mainWithVat: main != null ? main : (fallbackMain != null ? fallbackMain : null),
      dealerWithVat: dealer != null ? dealer : (fallbackDealer != null ? fallbackDealer : null)
    };
  }

  // Hleda PRESNOU shodu kodu - v kosiku mame SKU z DOM, takze nema
  // smysl nic hadat. Filtr &code= je podstringovy (&code=8M02104
  // vrati 72 produktu), takze "prvni vraceny produkt" by mohl byt
  // uplne jiny produkt.
  function parseFeed(xmlText, wantedCode) {
    var xml = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (xml.querySelector('parsererror')) {
      log('XML se nepodarilo naparsovat - overte URL a hash');
      return null;
    }

    var wanted = norm(wantedCode);
    var items = xml.getElementsByTagName('SHOPITEM');

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var base = readNode(item, 0, null, null);

      if (base.code && norm(base.code) === wanted) {
        base.how = 'kód produktu';
        return base;
      }

      var variantNodes = [];
      directChildren(item, 'VARIANTS').forEach(function (h) {
        variantNodes = variantNodes.concat(directChildren(h, 'VARIANT'));
      });
      variantNodes = variantNodes.concat(directChildren(item, 'VARIANT'));

      for (var v = 0; v < variantNodes.length; v++) {
        // Varianta si dopocitava DPH i cenu z rodice, kdyz vlastni nema.
        var rec = readNode(variantNodes[v], base.vat, base.mainWithVat, base.dealerWithVat);
        if (rec.code && norm(rec.code) === wanted) {
          rec.how = 'kód varianty';
          return rec;
        }
      }
    }

    log('produkt', wantedCode, 've feedu nenalezen');
    return null;
  }

  function loadFeedData(code) {
    var key = CONFIG.CACHE_PREFIX + norm(code);

    if (CONFIG.CACHE) {
      try {
        var hit = window.sessionStorage.getItem(key);
        if (hit) return Promise.resolve(JSON.parse(hit));
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

    if (CONFIG.SHOW_MARGIN && report.sumDealer != null && report.missing === 0) {
      wrap.appendChild(
        renderRowLine(CONFIG.MARGIN_LABEL,
          formatPrice(report.sumRecommended - report.sumDealer), true)
      );
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

    var jobs = rows.map(function (row) {
      var sku = row.getAttribute('data-micro-sku');

      // Radek bez SKU (darek, doprava) do rozhodovani nepatri.
      if (!sku) return Promise.resolve({ skipped: true });

      return loadFeedData(sku)
        .then(function (data) {
          if (!data || data.mainWithVat == null) {
            return { sku: sku, missing: true };
          }

          var recommended = CONFIG.SHOW_WITH_VAT
            ? data.mainWithVat
            : withoutVat(data.mainWithVat, data.vat);

          var dealer = CONFIG.SHOW_WITH_VAT
            ? data.dealerWithVat
            : withoutVat(data.dealerWithVat, data.vat);

          if (recommended == null) return { sku: sku, missing: true };

          var qty = getQuantity(row);
          var onPage = getRowUnitPrice(row);

          // Do souctu polozka patri vzdy. Skryva se jen radek.
          var visible = true;
          if (!CONFIG.SHOW_WHEN_EQUAL && onPage != null
              && Math.round(data.mainWithVat) <= Math.round(onPage)) {
            visible = false;
          }

          return {
            sku: sku,
            unit: recommended,
            recommended: recommended * qty,
            dealer: dealer != null ? dealer * qty : null,
            qty: qty,
            onPage: onPage,
            visible: visible
          };
        })
        .catch(function (err) {
          log('chyba u', sku, err);
          return { sku: sku, missing: true };
        });
    });

    Promise.all(jobs).then(function (results) {
      var report = {
        sumRecommended: 0,
        sumDealer: 0,
        dealerKnown: true,
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
        if (r.dealer == null) report.dealerKnown = false;
        else report.sumDealer += r.dealer;
        report.items.push({
          sku: r.sku, ks: r.qty, cenaVRadku: r.onPage,
          doporucenaCelkem: Math.round(r.recommended),
          vypsano: r.visible
        });
      });

      if (!report.dealerKnown) report.sumDealer = null;

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
      try {
        Object.keys(window.sessionStorage).forEach(function (k) {
          if (k.indexOf(CONFIG.CACHE_PREFIX) === 0) window.sessionStorage.removeItem(k);
        });
      } catch (e) { /* ignore */ }
      clearRendered();
      run();
    },
    run: run,
    config: CONFIG
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
   OVERENO 17. 8. 2026 (v1.0) a 18. 8. 2026 (v2.0)
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

   PROC v1.0 SELHALA U VARIANT (zmereno, ne odhad)
   Radek kosiku ma v data-micro-sku kod VARIANTY (1001E031A).
   Rodicovsky SHOPITEM v tomto exportu nema primy potomek CODE ani
   PRICE_VAT - jsou az na VARIANT. Podminka v1.0 tedy nikdy
   neplatila, radek zustal bez ceny a souhrn se nezmenil:
   kosik za 43 599 Kc hlasil "doporucene ceny celkem 842 Kc".

   CO ZBYVA OVERIT
   - kosik s vetsim mnozstvim polozek. Feed se vola pro kazdy kod
     zvlast (s cache), takze u desitek polozek zvazte stazeni
     celeho feedu jednim requestem. Pozor, cely export je 255 MB,
     takze "jednim requestem" znamena vlastni endpoint, ne
     productsComplete.
   - jestli tato sablona strili ShoptetDOMCartItemsUpdated. Kdyz ano,
     da se REDRAW_DELAY jeste snizit a observer nad body zrusit.
   ============================================================ */
