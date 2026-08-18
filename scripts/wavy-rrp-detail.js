/* ============================================================
   Wavy Boats - doporucena cena na DETAILU PRODUKTU
   ------------------------------------------------------------
   Autor: Krystof Glos / glos-optimalizace.cz
   Verze: 4.3
   Zaklad: v4.2 (varianty overeny naostro 18. 8. 2026)

   ZMENY PROTI VERZI 4.2
   1) Doporucena cena NENI preskrtnuta (STRIKETHROUGH: false).
      Dohoda s klientem mluvi o preskrtnute cene, takze je to
      vedoma odchylka - pri predani ji zminte. Prepnuti zpet je
      jedna hodnota v CONFIG.
   2) Rozhodnuti "zobrazit / nezobrazit" se dela proti CENE NA
      STRANCE, ne proti dealerskemu ceniku z feedu.
      Proc: feed se stahuje s credentials:'omit' a hash v URL, takze
      vraci dealersky cenik VZDY - bez ohledu na to, kdo se na
      stranku kouka. v4.2 proto vypisovala doporucenou cenu i
      NEPRIHLASENEMU navstevnikovi, a to jako druhou, uplne shodnou
      radku (overeno 18. 8. na /weathercap-female/: 63 Kc a pod tim
      "Doporucena cena: 63 Kc"). Cena na strance je jedina cena, o
      ktere vime, ze patri aktualni session.
      Dusledek: nepihlaseny nevidi nic (jeho cena = doporucena),
      dealer se shodnou cenou taky nic (viz dohoda), dealer s nizsi
      cenou vidi preskrtnutou doporucenou.
   3) Fallback "vratil se jediny SHOPITEM, beru ho" ma pojistku.
      Filtr &code= v exportu je PODSTRINGOVY, ne presny (overeno:
      &code=8M02104 vrati 72 produktu, &code=1001E031 vrati 1).
      Bez pojistky umel fallback prilepit cenu ciziho produktu.

   ZMENY PROTI VERZI 3.0
   1) Podpora variant. Feed se naparsuje CELY jednou (SHOPITEM
      + vsechny VARIANT) a drzi se v pameti. Pri prepnuti
      varianty se jen dohleda odpovidajici zaznam a prepise
      hodnota - zadny dalsi request.
   2) Opraveno cteni dealerskeho ceniku. v3.0 hledala PRICELIST
      pres getElementsByTagName na celem SHOPITEMu, takze u
      produktu s variantami mohla vzit cenik NAHODNE VARIANTY.
      Ted se cte jen z primych potomku daneho uzlu.
   3) Parovani varianty ma dve urovne:
      a) podle kodu varianty (spolehlive, pokud varianty maji
         vlastni kody a Shoptet je na detailu prepisuje)
      b) podle hodnot parametru (kdyz varianty vlastni kod nemaji)
   4) Prepnuti varianty se hlida pres MutationObserver nad kodem
      a cenou + change/click na formulari produktu.
   5) WB_RRP.debug() vypise, co script na strance vidi a co nasel
      ve feedu. Bez toho se parovani variant nedoladi.

   OVERENO NA VARIANTACH (18. 8. 2026, dealerwb.cz)
   - VARIANT ma vlastni CODE, PRICE_VAT, PRICELISTS i PARAMETERS
   - filtr &code= bere i kod varianty (vrati rodicovsky SHOPITEM)
   - varianty jsou v <select id="simple-variants-select">
   - POZOR: text option NEOBSAHUJE kod varianty, jen parametr, napr.
     "Typ: E7.5 LH Avator - Na objednavku  (53 728 Kc)".
     Parovani proto NIKDY nejde pres kod, vzdy pres hodnotu
     parametru (matchBySelection). Kdyz dve varianty budou mit
     shodnou hodnotu parametru, nevypise se nic - to je zamer.
   - u variantniho produktu nema rodicovsky SHOPITEM ani CODE, ani
     PRICE_VAT jako primeho potomka (jsou jen na VARIANT). Proto se
     base.code / base.mainWithVat u variant beznne rovnaji null.

   Ladeni na detailu:  WB_RRP.debug()

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

    // Preskrtnuti hodnoty.
    // POZOR: dohoda s klientem (mail) mluvi o PRESKRTNUTE cene.
    // Vypnuto na vyslovne prani - pri predani to zminte, aby to
    // nevypadalo jako nedodelek.
    STRIKETHROUGH: false,

    /* ---------- kdy cenu NEZOBRAZIT ---------- */
    // Porovnava se s cenou, kterou ma navstevnik na strance.
    // Diky tomu se cena schova jak dealerovi se shodnou cenou, tak
    // nepihlasenemu navstevnikovi (ten ma na strance rovnou tu
    // doporucenou, takze by videl tu samou cenu dvakrat).
    PAGE_PRICE: {
      // Odkud cist cenu s DPH. Poradi = priorita.
      // Overeno: .p-final-price-wrapper .price-final-holder = "101 Kč"
      selectors: [
        '.p-final-price-wrapper .price-final-holder',
        '.p-final-price-wrapper .price-final',
        '.price-final-holder',
        '.p-final-price'
      ],
      // Zaloha - Shoptet plni i mikrodata s cistym cislem.
      metaSelector: 'meta[itemprop="price"], [data-micro="price"]',

      // Cenu na strance nejde precist (jina sablona, "od 1 000 Kč"
      // u nevybrane varianty). true = radsi nic nevypisovat, aby se
      // nestalo, ze doporucenou cenu uvidi koncovy zakaznik.
      HIDE_WHEN_UNKNOWN: true
    },

    // Vypsat i kdyz je doporucena cena shodna s cenou na strance.
    // Zamerne false - tak je to popsane v dohode s klientem.
    // Pri prepnuti na true si to s klientem nejdriv odsouhlas.
    SHOW_WHEN_EQUAL: false,

    // Puvodni pojistka z v4.2 - vypsat jen kdyz feed vraci dealersky
    // cenik. Uz neni potreba (rozhoduje cena na strance) a u variant
    // je matouci, protoze rodicovsky SHOPITEM cenik nema.
    REQUIRE_DEALER_PRICELIST: false,

    // null = prvni cenik ve feedu. Jinak presny nazev z tagu TITLE,
    // napr. 'VO - Prodej' (nutne, pokud dealer muze mit ceniku vic).
    DEALER_PRICELIST_TITLE: null,

    /* ---------- varianty ---------- */
    VARIANTS: {
      // Kdyz varianta neni vybrana (nebo ji nelze sparovat) a vsechny
      // varianty maji stejnou doporucenou cenu, vypis ji.
      // Pri rozdilnych cenach se nevypisuje nic - lepsi nic nez
      // cena patrici jine variante.
      SHOW_BASE_WHEN_UNIFORM: true,

      // Kdyz varianta nema vlastni PRICE_VAT, pouzij cenu produktu.
      FALLBACK_TO_BASE_PRICE: true,

      // Kdyz varianta nema vlastni PRICELISTS, pouzij cenik produktu.
      FALLBACK_TO_BASE_PRICELIST: true,

      // Selektory formulare / prepinacu varianty na detailu.
      formSelectors: '#product-detail-form, form[action*="/kosik/"], .p-detail form',
      codeSelectors: '.p-detail .p-code .p-code-value, .p-detail .p-code, .p-code-value, .p-code, [itemprop="sku"]',
      priceSelectors: '.p-final-price-wrapper, .price-final-holder, .price-final',

      // Prvky, ktere obsahuji kody VSECH variant (rozbalovaci seznam,
      // dlazdice). Z nich se NESMI cist "aktualni kod" - dealerwb.cz
      // ma kody variant prave tady a v3/v4.0 z toho slepila nesmysl.
      chooserSelectors: 'select, .advanced-parameter, .parameter-value, '
        + '#simple-variants, .variant-list, .p-variants, [data-testid*="variant"]',

      // Kde hledat text ZVOLENE varianty (obsahuje jeji kod).
      optionSelectors: 'select option:checked, .advanced-parameter.active, '
        + '.advanced-parameter--active, .parameter-value.active, input[type="radio"]:checked',

      // Kolik kodu se maximalne zkusi vytahnout z feedu, nez to vzdame.
      MAX_FETCH_ATTEMPTS: 4,

      // Odkud cist zvolene hodnoty parametru (fallback parovani).
      selectedValueSelectors: [
        '.advanced-parameter.active',
        '.advanced-parameter--active',
        '.parameter-value.active',
        'input[type="radio"]:checked'
      ],

      // Prodleva po zmene varianty - Shoptet dokresluje cenu AJAXem.
      debounceMs: 180
    },

    CACHE: true,
    CACHE_PREFIX: 'wbRrp4_',

    // Optional daily-generated public prices JSON (see wavy-rrp-kosik.js)
    // When set, the script will use this file (no sensitive dealer feed).
    PRICES_URL: 'https://glos-optimalizace.cz/scripts/ceny.json',
    PRICES_CACHE: true,
    PRICES_CACHE_KEY: 'wbRrp4_ceny',

    DEBUG: false
  };

  var CSS_CLASS = 'wb-rrp';

  var product = null;      // { base:{...}, variants:[...] }
  var lastRendered = null; // naposledy vypsana hodnota
  var loading = false;
  var pricesPromise = null;
  var lastDiag = {};

  /* ================= POMOCNE ================= */

  function log() {
    if (CONFIG.DEBUG && window.console) {
      console.log.apply(console, ['[RRP detail]'].concat([].slice.call(arguments)));
    }
  }

  function txt(el) {
    return el ? String(el.textContent).trim() : null;
  }

  // Pouze primi potomci - PRICE_VAT a VAT jsou i vnorene
  // v PRICELISTS a VARIANTS, takze querySelector by vratil spatny.
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

  // Shoptet zaokrouhluje na cele koruny (133.57 -> 134 Kc)
  function formatPrice(value) {
    return Math.round(value).toLocaleString('cs-CZ') + ' Kč';
  }

  function withoutVat(priceWithVat, vatPercent) {
    if (priceWithVat == null) return null;
    return priceWithVat / (1 + (vatPercent || 0) / 100);
  }

  // porovnavani textu: male pismena, bez diakritiky, bez mezer
  function norm(s) {
    var t = (s === null || s === undefined) ? '' : String(s);
    if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return t.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function uniq(list) {
    var out = [];
    list.forEach(function (v) { if (v != null && out.indexOf(v) === -1) out.push(v); });
    return out;
  }

  /* ================= CENA NA STRANCE ================= */

  // Z textu vytahne cislo pred "Kc". Nezlomitelne mezery i mezery
  // mezi tisici se odstranuji, desetinna carka se prevadi na tecku.
  // "od 53 728 Kč" vrati null zamerne - je to rozsah, ne cena
  // konkretni varianty, takze se s nim neda porovnavat.
  function priceFromText(text) {
    if (!text) return null;
    var t = String(text).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (/(^|\s)od\s/i.test(t)) return null;
    var m = t.match(/(-?\d[\d ]*(?:[.,]\d+)?)\s*(?:Kč|Kc|CZK)/i);
    if (!m) return null;
    var n = parseFloat(m[1].replace(/ /g, '').replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent !== null) return true;
    return !!(el.getClientRects && el.getClientRects().length);
  }

  // Cena s DPH, kterou ma na strance aktualni navstevnik.
  //
  // POZOR - zjisteno testem 18. 8. 2026:
  // U variantniho produktu drzi Shoptet v DOM cenu KAZDE varianty
  // plus rozsah "od X Kč" - na Avatoru 7.5e to byly 4 elementy
  // .price-final-holder a jen JEDEN z nich byl viditelny.
  // querySelector() bral ten prvni, tzn. skrytou cenu jine
  // varianty (42 982 Kč misto 62 722 Kč u varianty s paketem).
  // Proto se bere prvni VIDITELNY element. Kdyz zadny viditelny
  // neni, vraci se null - porovnavat cenu proti skryte cene jine
  // varianty je horsi nez cenu nevypsat.
  function pagePriceWithVat() {
    var sels = CONFIG.PAGE_PRICE.selectors;

    for (var i = 0; i < sels.length; i++) {
      var els = document.querySelectorAll(sels[i]);
      for (var j = 0; j < els.length; j++) {
        if (!isVisible(els[j])) continue;
        var value = priceFromText(els[j].textContent);
        if (value != null) return value;
      }
    }

    // Mikrodata jsou zaloha jen tehdy, kdyz je na strance jedina -
    // u variant je jich taky vic a nedaji se rozlisit viditelnosti.
    var metas = document.querySelectorAll(CONFIG.PAGE_PRICE.metaSelector);
    if (metas.length === 1) {
      var raw = metas[0].getAttribute('content') || metas[0].textContent;
      var n = parseFloat(String(raw).replace(/\s/g, '').replace(',', '.'));
      if (!isNaN(n)) return n;
    }

    log('cenu na strance nelze jednoznacne precist');
    return null;
  }

  /* ================= CTENI ZE STRANKY ================= */

  // Kod produktu: bez mezer, alespon 2 znaky, obsahuje cislici.
  var CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._\/\-]{1,}$/;
  var NOT_A_CODE = [
    'zvolte', 'variantu', 'varianta', 'vyberte', 'kod', 'code',
    'skladem', 'nedostupne', 'dostupnost', 'ks', 'cena'
  ];

  // Z libovolneho textu vytahne kody. Klicova zmena proti v4.0:
  // text se tokenizuje, netahne se jako celek. Kontejner prepinace
  // variant tak misto jednoho slepence vrati seznam kodu.
  function extractCodes(raw) {
    if (!raw) return [];
    var cleaned = String(raw).replace(/(kód|kod|code)\s*:/gi, ' ');
    var tokens = cleaned.split(/[\s,;|()\[\]]+/);
    var out = [];
    tokens.forEach(function (t) {
      var token = t.trim();
      if (!token || !CODE_RE.test(token)) return;
      if (!/\d/.test(token)) return;                       // kod ma vzdy cislici
      if (NOT_A_CODE.indexOf(norm(token)) !== -1) return;
      if (out.indexOf(token) === -1) out.push(token);
    });
    return out;
  }

  function isChooser(el) {
    if (!el) return false;
    if (el.matches && el.matches(CONFIG.VARIANTS.chooserSelectors)) return true;
    if (el.closest && el.closest(CONFIG.VARIANTS.chooserSelectors)) return true;
    return !!(el.querySelector && el.querySelector(CONFIG.VARIANTS.chooserSelectors));
  }

  function elementCodes(el) {
    if (!el) return [];
    var clone = el.cloneNode(true);
    var label = clone.querySelector('.p-code-label');
    if (label) label.parentNode.removeChild(label);
    return extractCodes(clone.textContent);
  }

  // Vsechny prepinace variant. POZOR: na dealerwb.cz je select
  // uvnitr .p-code, NE ve formulari - hledat jen ve form je malo.
  function variantSelects() {
    var found = document.querySelectorAll(
      CONFIG.VARIANTS.formSelectors.split(',').map(function (s) {
        return s.trim() + ' select';
      }).join(', ') + ', .p-detail select, .p-code select'
    );
    return [].slice.call(found);
  }

  // Kod ZVOLENE varianty - cte se z vybrane option / aktivni dlazdice.
  // Na dealerwb.cz je kod varianty prave tady.
  function getSelectedVariantCode() {
    // Selecty primo pres selectedIndex - spolehlivejsi nez :checked,
    // Shoptet meni property, ne atribut selected.
    var selects = variantSelects();
    for (var s = 0; s < selects.length; s++) {
      var opt = selects[s].options[selects[s].selectedIndex];
      if (!opt || !opt.value) continue;        // "Zvolte variantu" nema value
      var fromOpt = extractCodes(opt.getAttribute('data-code') || opt.textContent);
      if (fromOpt.length === 1) return fromOpt[0];
      // Vic "kodu podobnych" tokenu (napr. "1001E031A E7.5 LH Avator"
      // da i token E7.5). Rozhodne az srovnani se kody z feedu -
      // a to nejdelsim, kvuli prefixum typu 1001E031A / ...APAK.
      if (fromOpt.length > 1 && product && product.variants.length) {
        var known = fromOpt.filter(function (c) {
          return product.variants.some(function (v) { return norm(v.code) === norm(c); });
        });
        if (known.length) {
          known.sort(function (a, b) { return b.length - a.length; });
          return known[0];
        }
      }
    }

    var els = document.querySelectorAll(CONFIG.VARIANTS.optionSelectors);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.tagName === 'OPTION' && !el.value) continue;
      var codes = extractCodes(
        el.getAttribute('data-code')
        || el.getAttribute('title')
        || el.textContent
      );
      if (codes.length === 1) return codes[0];
    }
    return null;
  }

  // Kod, ktery je na strance videt jako JEDNOZNACNY (mimo prepinac).
  function getVisibleCode() {
    var els = document.querySelectorAll(CONFIG.VARIANTS.codeSelectors);
    for (var i = 0; i < els.length; i++) {
      if (isChooser(els[i])) continue;          // <- to nas v4.0 rozbilo
      var codes = elementCodes(els[i]);
      if (codes.length === 1) return codes[0];
    }
    return null;
  }

  // Aktualni kod pro parovani: nejdriv zvolena varianta, pak stranka.
  function currentCode() {
    return getSelectedVariantCode() || getVisibleCode();
  }

  // Vsechny kody, ktere jsou na strance k videni - vcetne kodu variant
  // z prepinace. Slouzi jako kandidati pro dotaz do feedu: kterykoli
  // z nich by mel vratit spravny SHOPITEM.
  function getAllPageCodes() {
    var list = [];
    var els = document.querySelectorAll(CONFIG.VARIANTS.codeSelectors);
    for (var i = 0; i < els.length; i++) {
      list = list.concat(elementCodes(els[i]));
    }
    return uniq(list);
  }

  // Vsechny kody, pod kterymi se da produkt ve feedu zkusit najit.
  function codeCandidates() {
    var list = [getSelectedVariantCode(), getVisibleCode()];

    var micro = document.querySelector('[itemprop="sku"], [data-micro-sku]');
    if (micro) {
      list = list.concat(extractCodes(micro.getAttribute && micro.getAttribute('data-micro-sku')));
      list = list.concat(extractCodes(txt(micro)));
    }
    if (product && product.base && product.base.code) list.push(product.base.code);

    list = list.concat(getAllPageCodes());

    return uniq(list.filter(Boolean));
  }

  // Zvolene hodnoty parametru - fallback, kdyz varianty nemaji kody.
  function getSelectedValues() {
    var values = [];

    variantSelects().forEach(function (select) {
      var opt = select.options[select.selectedIndex];
      if (opt && opt.value) values.push(norm(opt.textContent));
    });

    CONFIG.VARIANTS.selectedValueSelectors.forEach(function (sel) {
      var found = document.querySelectorAll(sel);
      for (var i = 0; i < found.length; i++) {
        var el = found[i];
        var v = el.getAttribute('data-parameter-value')
          || el.getAttribute('data-value')
          || el.getAttribute('title')
          || (el.labels && el.labels[0] ? el.labels[0].textContent : null)
          || el.value
          || el.textContent;
        if (v) values.push(norm(v));
      }
    });

    return uniq(values.filter(Boolean));
  }

  /* ================= FEED ================= */

  function feedUrl(code) {
    return CONFIG.FEED_BASE + CONFIG.FEED_QUERY + '&code=' + encodeURIComponent(code);
  }

  // Cenik hleda JEN v primych potomcich uzlu (SHOPITEM nebo VARIANT).
  // v3.0 tady mela getElementsByTagName, cimz u variantniho produktu
  // sahla i do PRICELISTS jednotlivych variant.
  function pickDealerPricelist(node) {
    var holders = directChildren(node, 'PRICELISTS');
    var lists = [];
    holders.forEach(function (h) {
      lists = lists.concat(directChildren(h, 'PRICELIST'));
    });
    // nektere sablony maji PRICELIST bez obalu
    lists = lists.concat(directChildren(node, 'PRICELIST'));

    for (var i = 0; i < lists.length; i++) {
      var title = txt(directChild(lists[i], 'TITLE'));
      if (CONFIG.DEALER_PRICELIST_TITLE && title !== CONFIG.DEALER_PRICELIST_TITLE) continue;

      var price = toNumber(directChild(lists[i], 'PRICE_VAT'));
      if (price == null) continue;

      return { title: title, priceWithVat: price };
    }
    return null;
  }

  function readVariantParams(variantNode) {
    var out = [];

    // <PARAMETERS><PARAMETER><NAME>/<VALUE>
    var holders = directChildren(variantNode, 'PARAMETERS');
    var params = [];
    holders.forEach(function (h) { params = params.concat(directChildren(h, 'PARAMETER')); });
    params = params.concat(directChildren(variantNode, 'PARAMETER'));

    params.forEach(function (p) {
      var name = txt(directChild(p, 'NAME')) || txt(directChild(p, 'PARAMETER_NAME'));
      var value = txt(directChild(p, 'VALUE')) || txt(directChild(p, 'PARAMETER_VALUE'));
      if (value) out.push({ name: name, value: value, normValue: norm(value) });
    });

    // Zaloha: nazev varianty typu "Barva: cervena / Velikost: M"
    if (!out.length) {
      var name = txt(directChild(variantNode, 'NAME'))
        || txt(directChild(variantNode, 'VARIANT_NAME'));
      if (name) {
        name.split(/[\/|,;]/).forEach(function (part) {
          var bits = part.split(':');
          var value = (bits.length > 1 ? bits.slice(1).join(':') : part).trim();
          if (value) {
            out.push({
              name: bits.length > 1 ? bits[0].trim() : null,
              value: value,
              normValue: norm(value)
            });
          }
        });
      }
    }

    return out;
  }

  function parseItem(item) {
    var baseVat = toNumber(directChild(item, 'VAT')) || 0;
    var baseDealer = pickDealerPricelist(item);

    var base = {
      code: txt(directChild(item, 'CODE')),
      vat: baseVat,
      mainWithVat: toNumber(directChild(item, 'PRICE_VAT')),
      dealerWithVat: baseDealer ? baseDealer.priceWithVat : null,
      dealerTitle: baseDealer ? baseDealer.title : null
    };

    var variants = [];
    var holders = directChildren(item, 'VARIANTS');
    var nodes = [];
    holders.forEach(function (h) { nodes = nodes.concat(directChildren(h, 'VARIANT')); });
    nodes = nodes.concat(directChildren(item, 'VARIANT'));

    nodes.forEach(function (v) {
      var dealer = pickDealerPricelist(v);
      var main = toNumber(directChild(v, 'PRICE_VAT'));

      variants.push({
        code: txt(directChild(v, 'CODE')),
        vat: toNumber(directChild(v, 'VAT')) || baseVat,
        mainWithVat: (main == null && CONFIG.VARIANTS.FALLBACK_TO_BASE_PRICE)
          ? base.mainWithVat : main,
        dealerWithVat: dealer ? dealer.priceWithVat
          : (CONFIG.VARIANTS.FALLBACK_TO_BASE_PRICELIST ? base.dealerWithVat : null),
        dealerTitle: dealer ? dealer.title : base.dealerTitle,
        params: readVariantParams(v)
      });
    });

    return { base: base, variants: variants };
  }

  function parseFeed(xmlText, wantedCodes) {
    var xml = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (xml.querySelector('parsererror')) {
      log('XML se nepodarilo naparsovat - overte URL a hash');
      return null;
    }

    var items = xml.getElementsByTagName('SHOPITEM');
    var wanted = wantedCodes.map(norm);
    var fallback = null;

    for (var i = 0; i < items.length; i++) {
      var parsed = parseItem(items[i]);
      if (!fallback) fallback = parsed;

      if (parsed.base.code && wanted.indexOf(norm(parsed.base.code)) !== -1) return parsed;

      for (var v = 0; v < parsed.variants.length; v++) {
        if (parsed.variants[v].code
            && wanted.indexOf(norm(parsed.variants[v].code)) !== -1) return parsed;
      }
    }

    // Filtr &code= vratil jeden produkt, ale kod nesedi znak na znak.
    // POZOR: filtr je PODSTRINGOVY (&code=8M02104 vrati 72 produktu),
    // takze "jediny vraceny produkt" NENI dukaz spravnosti - klidne
    // to muze byt cizi produkt, jehoz kod nas kod jen obsahuje.
    // Bereme ho jen tehdy, kdyz nektery kod ze stranky s nekterym
    // kodem z feedu opravdu souvisi (jeden je prefixem druheho).
    if (items.length === 1 && fallback) {
      var feedCodes = [fallback.base.code].concat(
        fallback.variants.map(function (v) { return v.code; })
      ).filter(Boolean).map(norm);

      var related = wanted.some(function (w) {
        return feedCodes.some(function (f) {
          return f.indexOf(w) === 0 || w.indexOf(f) === 0;
        });
      });

      if (related) {
        log('kod nesedi presne, ale souvisi - beru jediny SHOPITEM', fallback.base.code);
        return fallback;
      }
      log('jediny vraceny SHOPITEM ma nesouvisejici kod - zahazuji', feedCodes);
    }

    log('produkt', wantedCodes, 've feedu nenalezen (SHOPITEMu:', items.length + ')');
    return null;
  }

  function cacheKeyFor(code) {
    return CONFIG.CACHE_PREFIX + norm(code);
  }

  function readCache(codes) {
    if (!CONFIG.CACHE) return null;
    for (var i = 0; i < codes.length; i++) {
      try {
        var hit = window.sessionStorage.getItem(cacheKeyFor(codes[i]));
        if (hit) { log('z cache', codes[i]); return JSON.parse(hit); }
      } catch (e) { /* sessionStorage nemusi byt k dispozici */ }
    }
    return null;
  }

  // Ulozi pod kod produktu I pod kody vsech variant, aby prepnuti
  // varianty a navrat na produkt uz netrefily sit.
  function writeCache(data) {
    if (!CONFIG.CACHE || !data) return;
    var keys = [data.base.code];
    data.variants.forEach(function (v) { keys.push(v.code); });
    var payload = JSON.stringify(data);
    uniq(keys.filter(Boolean)).forEach(function (k) {
      try { window.sessionStorage.setItem(cacheKeyFor(k), payload); } catch (e) { /* ignore */ }
    });
  }

  function fetchByCode(code, allCodes) {
    return fetch(feedUrl(code), { credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' - overte patternId a hash');
        return res.text();
      })
      .then(function (text) {
        var data = parseFeed(text, allCodes);
        lastDiag.attempts.push({ kod: code, nalezeno: !!data, delkaXml: text.length });
        return data;
      });
  }

  // Stahovani ceny.json (stejne chovani jako v wavy-rrp-kosik.js)
  function ensurePrices() {
    if (pricesPromise) return pricesPromise;

    if (!CONFIG.PRICES_URL) return Promise.resolve(null);

    if (CONFIG.PRICES_CACHE) {
      try {
        var hit = window.sessionStorage.getItem(CONFIG.PRICES_CACHE_KEY);
        if (hit) {
          pricesPromise = Promise.resolve(JSON.parse(hit));
          return pricesPromise;
        }
      } catch (e) { /* sessionStorage nemusi byt k dispozici */ }
    }

    pricesPromise = fetch(CONFIG.PRICES_URL, { credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' - ceny.json nedostupny');
        return res.json();
      })
      .then(function (data) {
        if (CONFIG.PRICES_CACHE) {
          try { window.sessionStorage.setItem(CONFIG.PRICES_CACHE_KEY, JSON.stringify(data)); }
          catch (e) { /* ignore */ }
        }
        return data;
      })
      .catch(function (err) {
        log('ceny.json se nepodarilo nacist', err);
        pricesPromise = null;
        throw err;
      });

    return pricesPromise;
  }

  // Zkusi kody postupne - u variant nemusi filtr &code= brat kod varianty.
  // Pokud je nastaven CONFIG.PRICES_URL, pouzije ten soubor (rychle a bez citlivych dat).
  function loadProduct() {
    var codes = codeCandidates().slice(0, CONFIG.VARIANTS.MAX_FETCH_ATTEMPTS);
    lastDiag.codes = codes;
    lastDiag.attempts = [];
    if (!codes.length) return Promise.resolve(null);

    // If prices.json is configured, prefer it (no dealer feed, public prices only)
    if (CONFIG.PRICES_URL) {
      return ensurePrices().then(function (data) {
        var prices = (data && data.prices) || {};
        var found = [];
        for (var i = 0; i < codes.length; i++) {
          var c = codes[i];
          if (!c) continue;
          if (prices.hasOwnProperty(c) && prices[c] != null) {
            found.push({ code: c, mainWithVat: prices[c] });
          }
        }
        if (!found.length) {
          log('ceny.json: zadny kod nenalezen pro', codes);
          return null;
        }

        // Build product object compatible se zbytkem skriptu
        var base = {
          code: found[0].code,
          vat: 0,
          mainWithVat: found[0].mainWithVat,
          dealerWithVat: null,
          dealerTitle: null
        };
        var variants = [];
        for (var j = 1; j < found.length; j++) {
          variants.push({ code: found[j].code, vat: 0, mainWithVat: found[j].mainWithVat, dealerWithVat: null, dealerTitle: null, params: [] });
        }

        var payload = { base: base, variants: variants };
        try { writeCache(payload); } catch (e) { /* ignore */ }
        return payload;
      }).catch(function (err) {
        log('ceny.json selhalo:', err && err.message);
        return null;
      });
    }

    var cached = readCache(codes);
    if (cached) return Promise.resolve(cached);

    var idx = 0;
    function attempt() {
      if (idx >= codes.length) return Promise.resolve(null);
      var code = codes[idx++];
      return fetchByCode(code, codes)
        .then(function (data) {
          if (data) { lastDiag.matchedByFeedCode = code; return data; }
          return attempt();
        })
        .catch(function (err) {
          log('pokus s kodem', code, 'selhal:', err && err.message);
          lastDiag.attempts.push({ kod: code, chyba: err && err.message });
          return attempt();
        });
    }

    return attempt().then(function (data) {
      if (data) writeCache(data);
      return data;
    });
  }

  /* ================= VYBER SPRAVNEHO ZAZNAMU ================= */

  function matchByCode(data, code) {
    if (!code) return null;
    var want = norm(code);
    for (var i = 0; i < data.variants.length; i++) {
      if (data.variants[i].code && norm(data.variants[i].code) === want) {
        return { record: data.variants[i], how: 'kod varianty' };
      }
    }
    if (data.base.code && norm(data.base.code) === want && !data.variants.length) {
      return { record: data.base, how: 'kod produktu' };
    }
    return null;
  }

  function matchByParams(data) {
    var selected = getSelectedValues();
    lastDiag.selectedValues = selected;
    if (!selected.length) return null;

    var hits = data.variants.filter(function (v) {
      if (!v.params.length) return false;
      return v.params.every(function (p) { return selected.indexOf(p.normValue) !== -1; });
    });

    if (hits.length === 1) return { record: hits[0], how: 'hodnoty parametru' };
    if (hits.length > 1) log('parametry pasuji na vic variant:', hits.length);
    return null;
  }

  // Texty, ktere popisuji ZVOLENOU variantu (option, dlazdice, kod).
  function selectionTexts() {
    var out = [];

    variantSelects().forEach(function (s) {
      var opt = s.options[s.selectedIndex];
      if (opt && opt.value) out.push(opt.textContent);
    });

    var els = document.querySelectorAll(CONFIG.VARIANTS.optionSelectors);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.tagName === 'OPTION' && !el.value) continue;
      out.push(el.getAttribute('data-code'));
      out.push(el.getAttribute('title'));
      out.push(el.textContent);
    }

    var visible = getVisibleCode();
    if (visible) out.push(visible);

    return out.filter(Boolean).map(norm);
  }

  // Parovani podle textu zvolene varianty.
  // Klicove: kody i nazvy variant se u Wavy Boats PREKRYVAJI
  //   1001E031A     je podretezec  1001E031APAK
  //   E7.5 LH Avator je podretezec E7.5 LH Avator s paketem
  // Proto se nebere prvni shoda, ale NEJDELSI - kratsi varianta by
  // jinak vzdy prebila tu s prilepkem a dealer by videl cizi cenu.
  function matchBySelection(data) {
    var texts = selectionTexts();
    if (!texts.length) return null;

    function inTexts(needle) {
      if (!needle) return false;
      for (var i = 0; i < texts.length; i++) {
        if (texts[i].indexOf(needle) !== -1) return true;
      }
      return false;
    }

    var scored = [];
    data.variants.forEach(function (v) {
      var score = 0;
      var how = [];

      var code = norm(v.code);
      if (code && inTexts(code)) {
        // kod vazi vic nez nazev - je jednoznacnejsi
        score += code.length * 10;
        how.push('kód');
      }

      if (v.params.length) {
        var all = true;
        var len = 0;
        v.params.forEach(function (p) {
          if (inTexts(p.normValue)) len += p.normValue.length;
          else all = false;
        });
        if (all) { score += len; how.push('parametry'); }
      }

      if (score > 0) scored.push({ record: v, score: score, how: how.join(' + ') });
    });

    if (!scored.length) return null;

    scored.sort(function (a, b) { return b.score - a.score; });

    // Remiza = nejde rozhodnout, radsi nic nez cizi cena.
    if (scored.length > 1 && scored[0].score === scored[1].score) {
      log('shoda na vic variant se stejnym skore - nevypisuji');
      return null;
    }

    return { record: scored[0].record, how: scored[0].how + ' zvolené varianty' };
  }

  function uniformVariant(data) {
    if (!data.variants.length) return null;
    var first = null;
    for (var i = 0; i < data.variants.length; i++) {
      var value = data.variants[i].mainWithVat;
      if (value == null) return null;
      if (first === null) first = value;
      else if (Math.round(first) !== Math.round(value)) return null;
    }
    return { record: data.variants[0], how: 'vsechny varianty stejna cena' };
  }

  function resolveRecord(data) {
    if (!data) return null;

    if (!data.variants.length) {
      return { record: data.base, how: 'produkt bez variant' };
    }

    var hit = matchByCode(data, currentCode())
      || matchBySelection(data)
      || matchByParams(data);
    if (hit) return hit;

    if (CONFIG.VARIANTS.SHOW_BASE_WHEN_UNIFORM) {
      var uni = uniformVariant(data);
      if (uni) return uni;
    }

    log('variantu nelze sparovat - nevypisuji');
    return null;
  }

  /* ================= VYKRESLENI ================= */

  function anchorEl() {
    var sels = CONFIG.VARIANTS.priceSelectors.split(',');
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i].trim());
      if (el) return el;
    }
    return null;
  }

  function removeBox() {
    var box = document.querySelector('.' + CSS_CLASS);
    if (box && box.parentNode) box.parentNode.removeChild(box);
    lastRendered = null;
  }

  // Na rozdil od v3.0 umi hodnotu PREPSAT, ne jen vlozit poprve.
  function render(recommended) {
    var box = document.querySelector('.' + CSS_CLASS);

    if (!box) {
      var anchor = anchorEl();
      if (!anchor) { log('nenalezeno misto pro vlozeni'); return false; }

      box = document.createElement('div');
      box.className = CSS_CLASS;
      box.style.cssText = 'margin-top:8px;font-size:14px;line-height:1.4;';

      var label = document.createElement('span');
      label.className = CSS_CLASS + '-label';
      label.textContent = CONFIG.LABEL + ' ';
      label.style.cssText = 'color:#777;';

      var value = document.createElement('span');
      value.className = CSS_CLASS + '-value';
      value.style.cssText = 'font-weight:600;color:#333;'
        + (CONFIG.STRIKETHROUGH ? 'text-decoration:line-through;' : '');

      box.appendChild(label);
      box.appendChild(value);
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
    }

    box.querySelector('.' + CSS_CLASS + '-value').textContent = formatPrice(recommended);
    lastRendered = Math.round(recommended);
    return true;
  }

  /* ================= ROZHODNUTI ================= */

  function update() {
    if (!product) return;

    var hit = resolveRecord(product);
    lastDiag.match = hit ? hit.how : null;
    lastDiag.record = hit ? hit.record : null;

    if (!hit) { removeBox(); return; }

    var rec = hit.record;

    var recommended = CONFIG.SHOW_WITH_VAT
      ? rec.mainWithVat
      : withoutVat(rec.mainWithVat, rec.vat);

    var dealerPrice = CONFIG.SHOW_WITH_VAT
      ? rec.dealerWithVat
      : withoutVat(rec.dealerWithVat, rec.vat);

    if (recommended == null) { log('hlavni cena ve feedu chybi'); removeBox(); return; }

    if (CONFIG.REQUIRE_DEALER_PRICELIST && dealerPrice == null) {
      log('zadny dealersky cenik - nezobrazuji');
      removeBox();
      return;
    }

    // Rozhoduje cena na strance, ne cenik z feedu - viz hlavicka.
    var onPage = pagePriceWithVat();
    lastDiag.pagePrice = onPage;

    if (onPage == null) {
      if (CONFIG.PAGE_PRICE.HIDE_WHEN_UNKNOWN) {
        log('cenu na strance nelze precist - nezobrazuji');
        removeBox();
        return;
      }
      log('cenu na strance nelze precist - vypisuji bez kontroly');
    } else if (!CONFIG.SHOW_WHEN_EQUAL
               && Math.round(rec.mainWithVat) <= Math.round(onPage)) {
      // Porovnava se vzdy s DPH - cena na strance je s DPH, bez ohledu
      // na to, jak je nastaveno SHOW_WITH_VAT.
      // Sem spada dealer se shodnou cenou i nepihlaseny navstevnik,
      // ktery ma na strance rovnou tu doporucenou cenu.
      log('cena na strance je stejna nebo vyssi (' + onPage + ') - nezobrazuji');
      removeBox();
      return;
    }

    if (lastRendered === Math.round(recommended)
        && document.querySelector('.' + CSS_CLASS)) return;

    render(recommended);
    log('vykresleno', recommended, '| parovani:', hit.how, '| cenik:', rec.dealerTitle);
  }

  /* ================= SLEDOVANI ZMEN VARIANTY ================= */

  function watchVariantChanges() {
    var timer = null;
    function ping(reason) {
      clearTimeout(timer);
      timer = setTimeout(function () {
        log('prekresleni:', reason);
        // Kod varianty muze ukazovat na produkt, ktery jsme jeste
        // nenacetli (napr. jina sada variant) - pak dotahnem znovu.
        var visible = currentCode();
        if (visible && product && !matchByCode(product, visible)
            && product.variants.length
            && !product.variants.some(function (v) { return !v.code; })) {
          ensureProduct().then(update);
        } else {
          update();
        }
      }, CONFIG.VARIANTS.debounceMs);
    }

    document.addEventListener('change', function (e) {
      if (!e.target.closest) return;
      if (e.target.tagName === 'SELECT'
          || e.target.closest(CONFIG.VARIANTS.formSelectors)
          || e.target.closest('.p-detail')) ping('change');
    }, true);

    document.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      if (e.target.closest('.advanced-parameter, .parameter-value, ' + CONFIG.VARIANTS.formSelectors)) {
        ping('click');
      }
    }, true);

    // Shoptet po vyberu varianty prekresluje kod i cenu AJAXem.
    var targets = [];
    var codeEl = document.querySelector(CONFIG.VARIANTS.codeSelectors);
    if (codeEl) targets.push(codeEl.parentNode || codeEl);
    var priceEl = anchorEl();
    if (priceEl) targets.push(priceEl.parentNode || priceEl);

    if (targets.length && window.MutationObserver) {
      var obs = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          // ignoruj vlastni blok, jinak observer bezi v kruhu
          var t = records[i].target;
          if (t.closest && t.closest('.' + CSS_CLASS)) continue;
          ping('dom');
          return;
        }
      });
      targets.forEach(function (t) {
        obs.observe(t, { childList: true, subtree: true, characterData: true });
      });
    }
  }

  /* ================= START ================= */

  function ensureProduct() {
    if (loading) return Promise.resolve(product);
    loading = true;
    return loadProduct()
      .then(function (data) {
        loading = false;
        if (data) product = data;
        lastDiag.product = product;
        return product;
      })
      .catch(function (err) {
        loading = false;
        log('chyba', err);
        return product;
      });
  }

  function init() {
    if (!document.querySelector('.p-detail, .p-detail-inner-header')) return;

    ensureProduct().then(function (data) {
      if (!data) { log('produkt se nepodarilo dohledat ve feedu'); return; }
      log('nacteno:', data.base.code, '| variant:', data.variants.length);
      update();
    });

    watchVariantChanges();
  }

  /* ---------- ladici API ---------- */
  window.WB_RRP = {
    // Na detailu variantniho produktu spustit: WB_RRP.debug()
    debug: function () {
      var cands = codeCandidates();
      var out = {
        cenaNaStrance: pagePriceWithVat(),
        kodZvoleneVarianty: getSelectedVariantCode(),
        kodNaStrance: getVisibleCode(),
        vsechnyKodyNaStrance: getAllPageCodes(),
        kandidatiKodu: cands,
        zvoleneHodnoty: getSelectedValues(),
        textyZvoleneVarianty: selectionTexts(),
        feedUrl: cands[0] ? feedUrl(cands[0]) : null,
        pokusyOFeed: lastDiag.attempts,
        produkt: product && {
          kod: product.base.code,
          cenaProduktu: product.base.mainWithVat,
          dealerProduktu: product.base.dealerWithVat,
          pocetVariant: product.variants.length,
          varianty: product.variants.map(function (v) {
            return {
              kod: v.code,
              doporucena: v.mainWithVat,
              dealer: v.dealerWithVat,
              parametry: v.params.map(function (p) { return p.value; }).join(' / ')
            };
          })
        },
        parovani: lastDiag.match,
        sparovanyZaznam: lastDiag.record,
        vypsano: lastRendered
      };
      if (window.console) {
        console.log('[RRP detail] diagnostika:', out);
        if (out.produkt && console.table) console.table(out.produkt.varianty);
      }
      return out;
    },
    reload: function () {
      product = null;
      try {
        Object.keys(window.sessionStorage).forEach(function (k) {
          if (k.indexOf(CONFIG.CACHE_PREFIX) === 0) window.sessionStorage.removeItem(k);
        });
      } catch (e) { /* ignore */ }
      return ensureProduct().then(function () { update(); return window.WB_RRP.debug(); });
    },
    update: update,
    config: CONFIG
  };

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
   3) BEZPECNOST EXPORTU - OTEVRENA OTAZKA PRO KLIENTA
      URL exportu vcetne hashe je citelna komukoli, kdo si zobrazi
      zdroj stranky. Overeno 18. 8. 2026 z NEPRIHLASENE session:
      export vraci HTTP 200 a obsahuje PURCHASE_PRICE, PURCHASE_VAT,
      PURCHASE_PRICE_INCL_VAT, INTERNAL_NOTE, STOCK a PRICELISTS.
      Bez filtru &code= je to 43 430 produktu / 255 MB, tzn. cely
      katalog s nakupnimi cenami a vsemi cenovymi hladinami.
      Nez se to nasadi, musi to klient vedet a odsouhlasit.
      Reseni, pokud to vadi: maly endpoint na vlastnim serveru, ktery
      hash drzi u sebe a vraci jen CODE + PRICE_VAT.
   4) Cache je v sessionStorage pod kodem produktu I kodem kazde
      varianty. Pri ladeni pouzij WB_RRP.reload(), samotny F5 vezme
      data z cache.

   PROC v3.0 U VARIANT NIC NEVYPSALA (predpoklad, potvrdit debugem)
   - parseFeed hledala SHOPITEM, jehoz primy potomek CODE se rovna
     kodu ze stranky. U variantniho produktu je na strance kod
     VARIANTY, ktery je v XML o uroven niz, takze podminka nikdy
     neplatila a script skoncil na "produkt nenalezen".
   - Druha, tisi vada: pickDealerPricelist brala PRICELIST pres
     getElementsByTagName, tzn. u variant mohla vratit cenu jine
     varianty a REQUIRE_DEALER_PRICELIST tak prosel s cizim cislem.
   ============================================================ */
