/* ============================================================
   Wavy Boats - IMPORT OBJEDNAVKOVE TABULKY DO KOSIKU
   ------------------------------------------------------------
   Autor: Krystof Glos / glos-optimalizace.cz
   Verze: 1.0

   Dealer nahraje svou objednavkovou tabulku (.xls / .xlsx / .csv)
   a skript z ni naplni kosik. Parsovani bezi CELE v prohlizeci,
   soubor se nikam neposila.

   ============================================================
   OVERENO NAOSTRO (2. 9. 2026, dealerwb.cz)
   ------------------------------------------------------------
   Nic z nasledujiciho neni domnenka - vsechno bylo zmereno na
   zivem shopu. Kdyz to budes menit, over to znovu, nedomysli si to.

   1) KOSIK BERE PRIMO KOD PRODUKTU
      POST /action/Cart/addCartItem/
      language=cs&productCode=<KOD>&amount=<N>

      Zadne productId, zadne priceId, zadne dohledavani. Shoptet
      si kod prelozi sam na serveru.

      POZOR na alternativy, ktere NEfunguji:
        - jen productId bez priceId -> code 500
        - parametr "code" misto "productCode" -> code 500

   2) PAROVANI JE PRESNE, NE PREFIXOVE
      V katalogu je 919 kodu (2,1 %), ktere jsou prefixem jineho
      kodu - napr. 11149A2 je prefixem 11149A20..A27.
      Overeno: productCode=11149A2 vlozi PRESNE 11149A2.
      Proto se tu NEPOUZIVA zadne longest-match skorovani jako v
      wavy-rrp-detail.js. Tam je potreba, protoze se kod lusti z
      nejednoznacneho textu v DOM. Tady prichazi z vyhrazeneho
      sloupce tabulky a je uz presny. Fuzzy parovani by sem vlozilo
      cizi dil.

   3) VARIANTY FUNGUJI STEJNOU CESTOU
      productCode=11500107A vlozi spravnou variantu, bez variantId.

   4) NEEXISTUJICI KOD SELZE BEZPECNE
      code 500 a do kosiku se nic nevlozi.
      POZOR: chybova zprava je zavadejici ("vyberte jednu z variant
      produktu") i u kodu, ktery vubec neexistuje. Nepouzivej ji
      pro rozhodovani, uzivateli ji nezobrazuj - rozhoduje `code`.

   5) MNOZSTVI NAD SKLAD PROJDE
      16160004 ma skladem 4 ks, amount=999 vratilo code 200 a v
      kosiku bylo 999. Shoptet nikdy nevlozi MENE, nez je zadano -
      kategorie "vlozeno mene, nez dealer chtel" tedy nemuze
      nastat. Viz ZNAME MEZERY nize.

   6) OPAKOVANE VLOZENI SCITA
      2 ks, pak 3 ks -> v kosiku 5 ks. Proto CONFIG.VYPRAZDNIT_PRED
      a volba v UI - at je to rozhodnuti dealera, ne nase.

   7) SOUBEZNOST: 8 JE OPTIMUM
      Merene na 16 polozkach, vzdy 16/16 spravne:
        souberne 1  -> 245 ms/polozka
        souberne 4  ->  59 ms/polozka
        souberne 8  ->  36 ms/polozka   <- optimum
        souberne 12 ->  41 ms/polozka   (server se dusi, POMALEJSI)

      POZOR: per-polozkova cena ROSTE s velikosti kosiku. Pri 295
      polozkach to bylo 88 ms/polozka, ne 36. Cely beh 25,8 s.
      Shoptet po kazdem vlozeni prepocitava kosik a cim vic je v
      nem polozek, tim je to drazsi. Neslibuj uzivateli zbyvajici
      cas podle prumeru - lhal by. Proto se zobrazuje "137/295".

   8) CSRF JE VYPNUTY, ALE POCITEJ S TIM, ZE SE ZAPNE
      shoptet.csrf.enabled === false, token je v shoptet.csrf.token.
      Token se proto cte dynamicky pri kazdem behu.

   OVERENO END-TO-END: 300radkovy soubor -> 295 polozek po agregaci
   -> 293 vlozeno, 2 nenalezena (presne ty dva vymyslene kody),
   0 neshod mnozstvi, 11149A27 nevlozen.

   ============================================================
   VSTUPNI SOUBOR (overeno na realnem prtorder.xls)
   ------------------------------------------------------------
   - Stary binarni .xls (OLE2/BIFF, magic d0cf11e0), NE xlsx.
   - List "Pick List", ale nazev se NEKONTROLUJE - bere se prvni
     list, aby to vydrzelo jiny rozkresovy program.
   - Sloupce Qty | Part Number | Part Description.
     POZOR: hlavicka se hleda podle NAZVU, ne podle pozice. V
     puvodnim zadani bylo pořadi uvedene spatne, realne je Part
     Number druhy. Kdyby se to v generujicim programu zmenilo,
     tohle to ustoji.
   - Part Number se cte VZDY jako string (vedouci nuly, vedecky
     zapis).
   - Qty je float (2.0) -> parseInt.
   - Popisy maji mezery na konci -> trim.
   - Za daty je padding: v realnem souboru 97 radku, ktere maji ve
     sloupci Qty prazdny STRING, ne prazdnou bunku. Test na typ
     bunky by nesepnul. Prazdne radky se proto PRESKAKUJI podle
     hodnoty a NEUKONCUJI cteni - data nemusi byt souvisla.

   ============================================================
   POZOR NA SABLONU
   ------------------------------------------------------------
   Sablona schovava nativni formularove prvky a kresli si vlastni
   pres strukturu svych labelu. Overeno na radiu: dostane
   position:absolute; width:1px; height:1px; appearance:none.
   Cokoli formularoveho, co se sem prida, proto MUSI mit vlastni
   reset uvnitr modalu (viz pravidlo pro input[type=radio] ve
   vlozStyl) - jinak je prvek fakticky neviditelny a uzivatel
   nepozna, co je zvolene.

   Vlozeni: Vzhled a obsah -> Editor -> HTML kody -> paticka
   ============================================================ */

(function () {
  'use strict';

  var CONFIG = {
    /* ---------- kde se objevi tlacitko ---------- */
    // Zamerne plosne kotvy, ne hluboke CSS cesty - Shoptet meni
    // sablony a hluboky selektor by tise prestal platit.
    KOTVY: [
      '.cart-content',
      '#content .cart',
      '.cart-inner',
      '#content'
    ],
    // Kdyz zadna kotva nesedi, tlacitko se vlozi jako plovouci.
    PLOVOUCI_FALLBACK: true,
    // Na kterych URL se tlacitko vubec nabidne.
    JEN_NA_URL: /\/kosik\//,

    /* ---------- parsovani ---------- */
    SLOUPCE: {
      mnozstvi: ['qty', 'quantity', 'mnozstvi', 'množství', 'pocet', 'počet'],
      kod: ['part number', 'partnumber', 'part no', 'kod', 'kód', 'code', 'sku'],
      popis: ['part description', 'description', 'popis', 'nazev', 'název']
    },
    MAX_RADKU: 5000,          // pojistka proti omylem nahranemu obrimu souboru
    SHEETJS_URL: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',

    /* ---------- vkladani ---------- */
    SOUBEZNE: 8,              // overene optimum, viz bod 7 v hlavicce
    SOUBEZNE_PO_CHYBACH: 1,   // na co spadnout, kdyz zacnou padat odpovedi
    CHYB_NEZ_ZPOMALIM: 3,     // kolik chyb v jedne davce spusti zpomaleni
    VYPRAZDNIT_PRED: false,   // vychozi volba v UI, viz bod 6

    /* ---------- endpointy (ze shoptet.config, s fallbackem) ---------- */
    URL_PRIDAT: '/action/Cart/addCartItem/',
    URL_OBSAH: '/action/Cart/GetCartContent/',
    URL_SMAZAT: '/action/Cart/deleteCartItem/',

    DEBUG: false
  };

  var CSS_ID = 'wb-import-styl';
  var MODAL_ID = 'wb-import-modal';

  function log() {
    if (CONFIG.DEBUG && window.console) {
      console.log.apply(console, ['[import kosiku]'].concat([].slice.call(arguments)));
    }
  }

  /* ================= POMOCNE ================= */

  function url(klic, fallback) {
    var c = window.shoptet && window.shoptet.config;
    return (c && c[klic]) || fallback;
  }

  function telo(o) {
    return Object.keys(o).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]);
    }).join('&');
  }

  // CSRF token, kdyz je ochrana zapnuta. Nazev pole neni v shoptet.csrf
  // uveden, takze se zjistuje z existujiciho csrf-enabled formulare na
  // strance. Kdyz se nenajde, radeji to nahlasime, nez abychom hadali.
  function csrfPole() {
    var c = window.shoptet && window.shoptet.csrf;
    if (!c || !c.enabled || !c.token) return {};

    var znama = { language: 1, priceId: 1, productId: 1, productCode: 1, amount: 1, itemId: 1 };
    var form = document.querySelector('form.' + (c.formsSelector || 'csrf-enabled'));
    if (form) {
      var vstupy = form.querySelectorAll('input[type="hidden"]');
      for (var i = 0; i < vstupy.length; i++) {
        var n = vstupy[i].name;
        if (n && !znama[n]) {
          var o = {}; o[n] = c.token; return o;
        }
      }
    }
    log('CSRF je zapnuty, ale nazev pole se nepodarilo zjistit - vkladani muze selhat');
    return {};
  }

  function normHlavicka(s) {
    var t = (s === null || s === undefined) ? '' : String(s);
    if (t.normalize) t = t.normalize('NFD').replace(DIAKRITIKA, '');
    return t.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  var DIAKRITIKA = new RegExp('[' + String.fromCharCode(0x0300) + '-'
    + String.fromCharCode(0x036f) + ']', 'g');

  /* ================= SHEETJS (lazy) ================= */

  var sheetPromise = null;
  function zajistiSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (sheetPromise) return sheetPromise;

    // Nacita se AZ pri otevreni dialogu - je to skoro 1 MB a nema co
    // delat na kazdem zobrazeni stranky.
    sheetPromise = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = CONFIG.SHEETJS_URL;
      s.onload = function () { window.XLSX ? res(window.XLSX) : rej(new Error('XLSX se nenacetl')); };
      s.onerror = function () { rej(new Error('knihovnu pro cteni tabulek nelze nacist')); };
      document.head.appendChild(s);
    }).catch(function (e) { sheetPromise = null; throw e; });

    return sheetPromise;
  }

  /* ================= PARSOVANI ================= */

  function najdiSloupec(hlavicka, varianty) {
    for (var i = 0; i < hlavicka.length; i++) {
      if (varianty.indexOf(hlavicka[i]) !== -1) return i;
    }
    return -1;
  }

  function parsuj(arrayBuffer) {
    var wb = window.XLSX.read(arrayBuffer, { type: 'array', raw: true });
    if (!wb.SheetNames.length) throw new Error('soubor neobsahuje zadny list');

    var nazevListu = wb.SheetNames[0];
    var aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[nazevListu], {
      header: 1, raw: true, defval: ''
    });
    if (!aoa.length) throw new Error('list je prazdny');

    var hlavicka = (aoa[0] || []).map(normHlavicka);
    var iQty = najdiSloupec(hlavicka, CONFIG.SLOUPCE.mnozstvi);
    var iKod = najdiSloupec(hlavicka, CONFIG.SLOUPCE.kod);
    var iPopis = najdiSloupec(hlavicka, CONFIG.SLOUPCE.popis);

    if (iKod === -1) {
      throw new Error('v tabulce chybi sloupec s kodem produktu (hledam napr. "Part Number"). '
        + 'Nalezena hlavicka: ' + hlavicka.filter(Boolean).join(', '));
    }

    var radky = [];
    var preskoceno = 0;
    var bezMnozstvi = 0;

    for (var r = 1; r < aoa.length && radky.length < CONFIG.MAX_RADKU; r++) {
      var row = aoa[r] || [];

      // Kod je jediny povinny udaj. Prazdny radek se PRESKOCI, necte se
      // jako konec dat - padding muze byt i mezi daty.
      var kod = String(row[iKod] === null || row[iKod] === undefined ? '' : row[iKod]).trim();
      if (!kod) { preskoceno++; continue; }

      var qty = 1;
      if (iQty !== -1) {
        var raw = String(row[iQty] === null || row[iQty] === undefined ? '' : row[iQty]).trim();
        var n = parseInt(raw.replace(',', '.'), 10);
        if (isFinite(n) && n > 0) qty = n;
        else bezMnozstvi++;
      }

      radky.push({
        kod: kod,
        qty: qty,
        popis: iPopis === -1 ? '' : String(row[iPopis] || '').trim(),
        radek: r + 1
      });
    }

    return {
      nazevListu: nazevListu,
      radky: radky,
      preskoceno: preskoceno,
      bezMnozstvi: bezMnozstvi,
      dosazenLimit: radky.length >= CONFIG.MAX_RADKU
    };
  }

  // Secte mnozstvi u stejneho kodu. Dve funkce naraz:
  // 1) dealer nemusi resit, ze ma kod v tabulce dvakrat,
  // 2) vsechny pozdejsi pozadavky jsou na RUZNE kody, takze pri
  //    soubeznem vkladani nemuze vzniknout zavod o tutez polozku.
  function agreguj(radky) {
    var mapa = {};
    var poradi = [];
    radky.forEach(function (r) {
      if (mapa[r.kod]) {
        mapa[r.kod].qty += r.qty;
        mapa[r.kod].radky.push(r.radek);
      } else {
        mapa[r.kod] = { kod: r.kod, qty: r.qty, popis: r.popis, radky: [r.radek] };
        poradi.push(r.kod);
      }
    });
    return poradi.map(function (k) { return mapa[k]; });
  }

  /* ================= KOSIK ================= */

  function vlozPolozku(kod, qty) {
    var data = { language: 'cs', productCode: kod, amount: String(qty) };
    var csrf = csrfPole();
    Object.keys(csrf).forEach(function (k) { data[k] = csrf[k]; });

    return fetch(url('addToCartUrl', CONFIG.URL_PRIDAT), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: telo(data)
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) { /* neocekavana odpoved */ }
        return { kod: kod, qty: qty, code: j ? j.code : 0 };
      });
    }).catch(function (e) {
      return { kod: kod, qty: qty, code: 0, sit: e.message };
    });
  }

  // Skutecny stav kosiku. Hlasi se JEN to, co je tady - ne to, co
  // vratilo code 200. Kdyby pri soubeznem vkladani doslo k zavodu,
  // odhali ho prave tohle srovnani.
  function stavKosiku() {
    return fetch(url('cartContentUrl', CONFIG.URL_OBSAH), {
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (r) { return r.json(); }).then(function (j) {
      var html = String((j.payload && j.payload.content) || '');
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var mapa = {};
      var itemIds = [];
      [].slice.call(doc.querySelectorAll('tr[data-micro="cartItem"]')).forEach(function (tr) {
        var vstup = tr.querySelector('input[name="amount"]');
        var sku = tr.getAttribute('data-micro-sku');
        if (sku) mapa[sku] = vstup ? parseInt(vstup.value, 10) : null;
      });
      var m = html.match(/name="itemId"[^>]*value="([^"]+)"/g) || [];
      m.forEach(function (s) {
        var id = s.match(/value="([^"]+)"/)[1];
        if (itemIds.indexOf(id) === -1) itemIds.push(id);
      });
      return { mnozstvi: mapa, itemIds: itemIds };
    }).catch(function (e) {
      log('stav kosiku nelze precist', e);
      return { mnozstvi: null, itemIds: [] };
    });
  }

  function vyprazdniKosik(onProgress) {
    var kolo = 0;
    function dalsi() {
      if (kolo++ > 15) return Promise.resolve(false);
      return stavKosiku().then(function (s) {
        if (!s.itemIds.length) return true;
        if (onProgress) onProgress(s.itemIds.length);
        var davky = [];
        for (var i = 0; i < s.itemIds.length; i += CONFIG.SOUBEZNE) {
          davky.push(s.itemIds.slice(i, i + CONFIG.SOUBEZNE));
        }
        return davky.reduce(function (p, davka) {
          return p.then(function () {
            return Promise.all(davka.map(function (id) {
              return fetch(url('removeFromCartUrl', CONFIG.URL_SMAZAT), {
                method: 'POST', credentials: 'include',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'X-Requested-With': 'XMLHttpRequest'
                },
                body: telo({ itemId: id })
              }).catch(function () { /* jednotliva chyba nesmi zabit uklid */ });
            }));
          });
        }, Promise.resolve()).then(dalsi);
      });
    }
    return dalsi();
  }

  /* ================= BEH IMPORTU ================= */

  // Vklada po davkach. Chyba jedne polozky nezabije beh; kdyz zacnou
  // padat, spadne soubeznost na 1 (server je pravdepodobne zahlceny).
  function vlozVse(polozky, onProgress) {
    var vysledky = [];
    var soubezne = CONFIG.SOUBEZNE;
    var i = 0;

    function davka() {
      if (i >= polozky.length) return Promise.resolve(vysledky);
      var cast = polozky.slice(i, i + soubezne);
      i += cast.length;

      return Promise.all(cast.map(function (p) { return vlozPolozku(p.kod, p.qty); }))
        .then(function (res) {
          vysledky = vysledky.concat(res);
          var chyb = res.filter(function (r) { return r.code !== 200; }).length;
          if (chyb >= CONFIG.CHYB_NEZ_ZPOMALIM && soubezne > CONFIG.SOUBEZNE_PO_CHYBACH) {
            soubezne = CONFIG.SOUBEZNE_PO_CHYBACH;
            log('prepinam na soubeznost', soubezne, '- v davce bylo', chyb, 'chyb');
          }
          if (onProgress) onProgress(vysledky.length, polozky.length, soubezne);
          return davka();
        });
    }
    return davka();
  }

  // Slozi prehled. Zdroj pravdy je SKUTECNY stav kosiku, ne code 200.
  function vyhodnot(polozky, vysledky, kosik) {
    var podleKodu = {};
    vysledky.forEach(function (v) { podleKodu[v.kod] = v; });

    var out = { vlozeno: [], nenalezeno: [], neshoda: [], neovereno: [] };

    polozky.forEach(function (p) {
      var v = podleKodu[p.kod];
      var vKosiku = kosik.mnozstvi ? kosik.mnozstvi[p.kod] : undefined;

      if (v && v.code !== 200) {
        out.nenalezeno.push({ polozka: p, sit: v.sit });
      } else if (kosik.mnozstvi === null) {
        // Kosik se nepodarilo precist - nemuzeme tvrdit, ze je vlozeno.
        out.neovereno.push({ polozka: p });
      } else if (vKosiku === p.qty) {
        out.vlozeno.push({ polozka: p, vKosiku: vKosiku });
      } else {
        out.neshoda.push({ polozka: p, vKosiku: vKosiku === undefined ? 0 : vKosiku });
      }
    });
    return out;
  }

  /* ================= EXPORT PREHLEDU ================= */

  function prehledCsv(prehled, meta) {
    var r = [];
    r.push('Import objednavkove tabulky - ' + (meta.nazevSouboru || ''));
    r.push('Datum;' + new Date().toLocaleString('cs-CZ'));
    r.push('');
    r.push('Stav;Kod;Nazev;Pozadovano;V kosiku;Radky v souboru');
    function pridej(stav, z, vKosiku) {
      r.push([stav, z.polozka.kod, z.polozka.popis, z.polozka.qty,
        vKosiku === undefined ? '' : vKosiku, z.polozka.radky.join('+')]
        .map(function (x) { return String(x === undefined ? '' : x).replace(/;/g, ','); }).join(';'));
    }
    prehled.vlozeno.forEach(function (z) { pridej('vlozeno', z, z.vKosiku); });
    prehled.nenalezeno.forEach(function (z) { pridej('NENALEZENO', z, 0); });
    prehled.neshoda.forEach(function (z) { pridej('NESHODA', z, z.vKosiku); });
    prehled.neovereno.forEach(function (z) { pridej('NEOVERENO', z, ''); });
    if (prehled.nenalezeno.length) {
      r.push('');
      r.push('Pozn.: nenalezeny kod muze byt kod nahrazeny vyrobcem (supersession).');
    }
    return r.join('\n');
  }

  function stahniCsv(text, nazev) {
    // Pozn.: Blob + a[download] je zamerne - soubor nesmi opustit
    // prohlizec, nikam se neposila.
    var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nazev;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ================= UI ================= */

  function vlozStyl() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = [
      '.wb-imp-btn{display:inline-flex;align-items:center;gap:8px;margin:12px 0;cursor:pointer}',
      '#' + MODAL_ID + '{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)}',
      '.wb-imp-box{background:#fff;color:#111;width:min(760px,94vw);max-height:90vh;display:flex;flex-direction:column;border-radius:8px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.4)}',
      '.wb-imp-hd{padding:14px 18px;background:#0a2540;color:#fff;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}',
      '.wb-imp-hd h3{margin:0;font-size:16px}',
      '.wb-imp-x{background:none;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1}',
      '.wb-imp-bd{padding:18px;overflow:auto;flex:1;font-size:14px;line-height:1.55}',
      '.wb-imp-ft{padding:12px 18px;border-top:1px solid #e0e0e0;display:flex;gap:10px;justify-content:flex-end;flex-shrink:0;flex-wrap:wrap}',
      '.wb-imp-drop{border:2px dashed #b0b8c0;border-radius:6px;padding:24px;text-align:center;cursor:pointer}',
      '.wb-imp-drop.hover{border-color:#0a7;background:#f3fffb}',
      '.wb-imp-vol{margin-top:14px;padding:12px;background:#f6f7f9;border-radius:6px;font-size:13px}',
      '.wb-imp-vol label{display:flex;gap:8px;align-items:flex-start;margin:6px 0;cursor:pointer}',
      // Sablona Shoptetu schovava nativni radio (position:absolute;
      // width:1px;height:1px;appearance:none) a kresli si vlastni pres
      // strukturu labelu, kterou tady nemame - bez tohoto resetu neni
      // videt zadne kolecko a dealer nepozna, co je zvolene.
      '#' + MODAL_ID + ' input[type="radio"]{appearance:auto;-webkit-appearance:radio;',
      'position:static;width:16px;height:16px;min-width:16px;margin:2px 0 0;opacity:1;flex-shrink:0}',
      '.wb-imp-tab{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}',
      '.wb-imp-tab th,.wb-imp-tab td{border-bottom:1px solid #e8e8e8;padding:5px 7px;text-align:left}',
      '.wb-imp-tab th{background:#f2f4f6}',
      '.wb-imp-sum{display:flex;gap:16px;flex-wrap:wrap;margin:4px 0 12px;font-weight:600}',
      '.wb-imp-ok{color:#0a7a3a}.wb-imp-err{color:#b3261e}.wb-imp-warn{color:#9a5b00}',
      '.wb-imp-bar{height:8px;background:#e8e8e8;border-radius:4px;overflow:hidden;margin:10px 0}',
      '.wb-imp-bar>div{height:100%;background:#0a7;width:0;transition:width .2s}',
      '.wb-imp-note{font-size:12px;color:#666;margin-top:10px}'
    ].join('');
    document.head.appendChild(s);
  }

  var stav = null;   // drzi rozparsovana data mezi kroky

  function zavri() {
    var m = document.getElementById(MODAL_ID);
    if (m) m.remove();
    stav = null;
  }

  function modal(obsahHtml, patickaHtml) {
    vlozStyl();
    var m = document.getElementById(MODAL_ID);
    if (!m) {
      m = document.createElement('div');
      m.id = MODAL_ID;
      m.innerHTML = '<div class="wb-imp-box">'
        + '<div class="wb-imp-hd"><h3>Import objednávkové tabulky</h3>'
        + '<button class="wb-imp-x" aria-label="Zavřít">&times;</button></div>'
        + '<div class="wb-imp-bd"></div><div class="wb-imp-ft"></div></div>';
      document.body.appendChild(m);
      m.querySelector('.wb-imp-x').onclick = zavri;
      m.addEventListener('click', function (e) { if (e.target === m) zavri(); });
    }
    m.querySelector('.wb-imp-bd').innerHTML = obsahHtml;
    m.querySelector('.wb-imp-ft').innerHTML = patickaHtml || '';
    return m;
  }

  /* ---------- krok 1: vyber souboru ---------- */

  function krokVyber() {
    var m = modal(
        '<div class="wb-imp-drop" id="wb-imp-drop">'
      +   '<div style="font-weight:600;margin-bottom:6px">Přetáhněte sem tabulku nebo klikněte</div>'
      +   '<div style="font-size:12px;color:#666">.xls, .xlsx nebo .csv &middot; soubor zůstává ve vašem počítači</div>'
      +   '<input type="file" id="wb-imp-file" accept=".xls,.xlsx,.csv" style="display:none">'
      + '</div>'
      + '<div class="wb-imp-vol">'
      +   '<div style="font-weight:600;margin-bottom:6px">Co s položkami, které už v košíku jsou</div>'
      +   '<label><input type="radio" name="wb-imp-mode" value="pridat"' + (CONFIG.VYPRAZDNIT_PRED ? '' : ' checked') + '>'
      +     '<span><b>Přidat k obsahu košíku</b> — u shodných kódů se množství sečte (výchozí chování e-shopu).</span></label>'
      +   '<label><input type="radio" name="wb-imp-mode" value="vyprazdnit"' + (CONFIG.VYPRAZDNIT_PRED ? ' checked' : '') + '>'
      +     '<span><b>Nejdřív košík vyprázdnit</b> — v košíku zůstane jen to, co je v tabulce.</span></label>'
      + '</div>',
      '<button class="btn btn-conversion" id="wb-imp-zrus" type="button">Zrušit</button>'
    );

    var drop = m.querySelector('#wb-imp-drop');
    var file = m.querySelector('#wb-imp-file');
    drop.onclick = function () { file.click(); };
    file.onchange = function () { if (file.files[0]) nactiSoubor(file.files[0]); };
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('hover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('hover'); });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer.files[0]) nactiSoubor(e.dataTransfer.files[0]);
    });
    m.querySelector('#wb-imp-zrus').onclick = zavri;
  }

  function rezim() {
    var el = document.querySelector('input[name="wb-imp-mode"]:checked');
    return el ? el.value : 'pridat';
  }

  function nactiSoubor(f) {
    var zvolenyRezim = rezim();
    modal('<div>Načítám <b>' + f.name + '</b>…</div>');

    zajistiSheetJS()
      .then(function () { return f.arrayBuffer(); })
      .then(function (ab) {
        var p = parsuj(ab);
        if (!p.radky.length) throw new Error('v tabulce nejsou žádné položky s kódem produktu');
        stav = {
          nazevSouboru: f.name,
          parsed: p,
          polozky: agreguj(p.radky),
          rezim: zvolenyRezim
        };
        krokKontrola();
      })
      .catch(function (e) {
        modal('<div class="wb-imp-err"><b>Soubor nelze načíst.</b></div>'
          + '<div style="margin-top:8px">' + String(e.message || e) + '</div>'
          + '<div class="wb-imp-note">Zkontrolujte, že tabulka má sloupec s kódem produktu '
          + '(např. „Part Number") v prvním řádku.</div>',
          '<button class="btn" id="wb-imp-zn" type="button">Zkusit jiný soubor</button>');
        var b = document.getElementById('wb-imp-zn');
        if (b) b.onclick = krokVyber;
      });
  }

  /* ---------- krok 2: kontrola pred vlozenim ---------- */

  function krokKontrola() {
    var p = stav.parsed;
    var pol = stav.polozky;
    var duplicity = pol.filter(function (a) { return a.radky.length > 1; });
    var celkemKs = pol.reduce(function (s, a) { return s + a.qty; }, 0);

    var html = '<div class="wb-imp-sum">'
      + '<span>Soubor: <b>' + stav.nazevSouboru + '</b></span>'
      + '<span>Položek: <b>' + pol.length + '</b></span>'
      + '<span>Kusů celkem: <b>' + celkemKs + '</b></span>'
      + '</div>';

    html += '<div>Rozpoznáno <b>' + p.radky.length + '</b> řádků z listu „' + p.nazevListu + '"';
    if (p.preskoceno) html += ', ' + p.preskoceno + ' prázdných přeskočeno';
    html += '.</div>';

    if (duplicity.length) {
      html += '<div class="wb-imp-note">Stejný kód se v tabulce opakuje u ' + duplicity.length
        + ' položek — množství jsem sečetl: '
        + duplicity.slice(0, 5).map(function (a) { return a.kod + ' → ' + a.qty + ' ks'; }).join(', ')
        + (duplicity.length > 5 ? ' a další' : '') + '.</div>';
    }
    if (p.bezMnozstvi) {
      html += '<div class="wb-imp-note">U ' + p.bezMnozstvi
        + ' řádků nešlo přečíst množství — použil jsem 1 ks.</div>';
    }
    if (p.dosazenLimit) {
      html += '<div class="wb-imp-err">Tabulka je delší než ' + CONFIG.MAX_RADKU
        + ' řádků, zpracoval jsem prvních ' + CONFIG.MAX_RADKU + '.</div>';
    }

    html += '<table class="wb-imp-tab"><thead><tr><th>#</th><th>Kód</th><th>Název v tabulce</th><th>Ks</th></tr></thead><tbody>';
    pol.slice(0, 200).forEach(function (a, i) {
      html += '<tr><td>' + (i + 1) + '</td><td><b>' + a.kod + '</b></td><td>' + (a.popis || '—') + '</td><td>' + a.qty + '</td></tr>';
    });
    html += '</tbody></table>';
    if (pol.length > 200) html += '<div class="wb-imp-note">Zobrazeno prvních 200 z ' + pol.length + '.</div>';

    html += '<div class="wb-imp-note">'
      + (stav.rezim === 'vyprazdnit'
          ? 'Košík bude před vložením vyprázdněn.'
          : 'Položky se přidají k obsahu košíku.')
      + ' Odhadovaná doba vkládání: ' + Math.max(1, Math.round(pol.length * 0.09)) + '–'
      + Math.max(2, Math.round(pol.length * 0.15)) + ' s.</div>';

    modal(html,
        '<button class="btn" id="wb-imp-back" type="button">Jiný soubor</button>'
      + '<button class="btn btn-conversion" id="wb-imp-go" type="button">Vložit do košíku</button>');

    document.getElementById('wb-imp-back').onclick = krokVyber;
    document.getElementById('wb-imp-go').onclick = krokVkladani;
  }

  /* ---------- krok 3: vkladani ---------- */

  function krokVkladani() {
    var pol = stav.polozky;
    modal('<div id="wb-imp-stat">Připravuji…</div>'
      + '<div class="wb-imp-bar"><div id="wb-imp-fill"></div></div>'
      + '<div class="wb-imp-note">Nezavírejte prosím stránku, dokud import neskončí.</div>');

    var stat = document.getElementById('wb-imp-stat');
    var fill = document.getElementById('wb-imp-fill');

    function pokrok(hotovo, celkem, soubezne) {
      stat.innerHTML = 'Vkládám <b>' + hotovo + '</b> z <b>' + celkem + '</b> položek…'
        + (soubezne === CONFIG.SOUBEZNE_PO_CHYBACH && CONFIG.SOUBEZNE > CONFIG.SOUBEZNE_PO_CHYBACH
            ? ' <span class="wb-imp-warn">(zpomaleno kvůli chybám)</span>' : '');
      fill.style.width = Math.round(hotovo / celkem * 100) + '%';
    }

    var pred = stav.rezim === 'vyprazdnit'
      ? (stat.textContent = 'Vyprazdňuji košík…', vyprazdniKosik(function (n) {
          stat.innerHTML = 'Vyprazdňuji košík… zbývá <b>' + n + '</b>';
        }))
      : Promise.resolve(true);

    pred
      .then(function () { return vlozVse(pol, pokrok); })
      .then(function (vysledky) {
        stat.innerHTML = 'Kontroluji obsah košíku…';
        return stavKosiku().then(function (kosik) {
          return { vysledky: vysledky, kosik: kosik };
        });
      })
      .then(function (o) {
        krokPrehled(vyhodnot(pol, o.vysledky, o.kosik), o.kosik);
      })
      .catch(function (e) {
        modal('<div class="wb-imp-err"><b>Import se nedokončil.</b></div>'
          + '<div style="margin-top:8px">' + String(e.message || e) + '</div>'
          + '<div class="wb-imp-note">Zkontrolujte prosím obsah košíku — část položek už v něm být může.</div>',
          '<button class="btn" id="wb-imp-zav" type="button">Zavřít</button>');
        var b = document.getElementById('wb-imp-zav');
        if (b) b.onclick = zavri;
      });
  }

  /* ---------- krok 4: prehled ---------- */

  function krokPrehled(prehled, kosik) {
    var html = '<div class="wb-imp-sum">'
      + '<span class="wb-imp-ok">✓ vloženo: ' + prehled.vlozeno.length + '</span>'
      + (prehled.nenalezeno.length ? '<span class="wb-imp-err">✗ nenalezeno: ' + prehled.nenalezeno.length + '</span>' : '')
      + (prehled.neshoda.length ? '<span class="wb-imp-warn">≠ neshoda: ' + prehled.neshoda.length + '</span>' : '')
      + (prehled.neovereno.length ? '<span class="wb-imp-warn">? neověřeno: ' + prehled.neovereno.length + '</span>' : '')
      + '</div>';

    if (prehled.nenalezeno.length) {
      html += '<div style="margin-top:10px"><b class="wb-imp-err">Tyto kódy se v katalogu nenašly</b>'
        + '<div class="wb-imp-note">Může jít o kód, který výrobce nahradil novějším (supersession) — '
        + 'v tom případě chyba není na e-shopu. Zkuste díl dohledat vyhledáváním.</div>'
        + '<table class="wb-imp-tab"><thead><tr><th>Kód</th><th>Název v tabulce</th><th>Ks</th><th>Řádky</th><th></th></tr></thead><tbody>';
      prehled.nenalezeno.forEach(function (z) {
        html += '<tr><td><b>' + z.polozka.kod + '</b></td><td>' + (z.polozka.popis || '—') + '</td>'
          + '<td>' + z.polozka.qty + '</td><td>' + z.polozka.radky.join('+') + '</td>'
          + '<td><a href="/vyhledavani/?string=' + encodeURIComponent(z.polozka.kod) + '" target="_blank" rel="noopener">hledat</a></td></tr>';
      });
      html += '</tbody></table></div>';
    }

    if (prehled.neshoda.length) {
      html += '<div style="margin-top:14px"><b class="wb-imp-warn">U těchto položek nesedí množství</b>'
        + '<table class="wb-imp-tab"><thead><tr><th>Kód</th><th>Požadováno</th><th>V košíku</th></tr></thead><tbody>';
      prehled.neshoda.forEach(function (z) {
        html += '<tr><td><b>' + z.polozka.kod + '</b></td><td>' + z.polozka.qty + '</td><td>' + z.vKosiku + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    if (prehled.neovereno.length) {
      html += '<div style="margin-top:14px" class="wb-imp-note">'
        + 'Obsah košíku se nepodařilo přečíst, takže u ' + prehled.neovereno.length
        + ' položek nemůžu potvrdit, že se opravdu vložily. Zkontrolujte prosím košík ručně.</div>';
    }

    if (kosik.mnozstvi) {
      html += '<div class="wb-imp-note">V košíku je teď celkem '
        + Object.keys(kosik.mnozstvi).length + ' různých položek.</div>';
    }

    var patka = '';
    if (prehled.nenalezeno.length || prehled.neshoda.length) {
      patka += '<button class="btn" id="wb-imp-znovu" type="button">Zkusit znovu nepodařené</button>';
    }
    patka += '<button class="btn" id="wb-imp-kopie" type="button">Kopírovat přehled</button>'
      + '<button class="btn" id="wb-imp-csv" type="button">Uložit CSV</button>'
      + '<button class="btn btn-conversion" id="wb-imp-hotovo" type="button">Hotovo</button>';

    modal(html, patka);

    var csv = prehledCsv(prehled, { nazevSouboru: stav ? stav.nazevSouboru : '' });

    document.getElementById('wb-imp-csv').onclick = function () {
      stahniCsv(csv, 'import-kosiku-prehled.csv');
    };
    document.getElementById('wb-imp-kopie').onclick = function () {
      var b = this;
      var hotovo = function () { b.textContent = 'Zkopírováno'; setTimeout(function () { b.textContent = 'Kopírovat přehled'; }, 1800); };
      if (navigator.clipboard) navigator.clipboard.writeText(csv).then(hotovo, function () { fallbackKopie(csv, hotovo); });
      else fallbackKopie(csv, hotovo);
    };
    document.getElementById('wb-imp-hotovo').onclick = function () {
      zavri();
      // Kosik se meni na serveru, stranku je potreba prekreslit,
      // aby dealer videl skutecny obsah.
      if (CONFIG.JEN_NA_URL.test(location.pathname)) location.reload();
    };
    var znovu = document.getElementById('wb-imp-znovu');
    if (znovu) znovu.onclick = function () {
      var opakovat = prehled.nenalezeno.concat(prehled.neshoda).map(function (z) { return z.polozka; });
      stav.polozky = opakovat;
      krokVkladani();
    };
  }

  function fallbackKopie(text, hotovo) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); hotovo(); } catch (e) { /* ignore */ }
    ta.remove();
  }

  /* ================= START ================= */

  function vlozTlacitko() {
    if (document.querySelector('.wb-imp-btn')) return true;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-conversion wb-imp-btn';
    btn.textContent = 'Nahrát objednávkovou tabulku';
    btn.onclick = krokVyber;

    for (var i = 0; i < CONFIG.KOTVY.length; i++) {
      var kotva = document.querySelector(CONFIG.KOTVY[i]);
      if (kotva) { kotva.insertBefore(btn, kotva.firstChild); return true; }
    }
    if (CONFIG.PLOVOUCI_FALLBACK) {
      btn.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:99998';
      document.body.appendChild(btn);
      return true;
    }
    return false;
  }

  function init() {
    vlozStyl();
    if (!CONFIG.JEN_NA_URL.test(location.pathname)) return;
    if (!vlozTlacitko()) log('misto pro tlacitko se nenaslo');
  }

  /* ---------- ladici API ---------- */
  window.WB_IMPORT = {
    otevri: krokVyber,
    // Umoznuje odzkouseni bez souboru: WB_IMPORT.test([['16160004',2]])
    test: function (pary) {
      stav = {
        nazevSouboru: '(test)',
        parsed: { nazevListu: '(test)', radky: [], preskoceno: 0, bezMnozstvi: 0, dosazenLimit: false },
        polozky: pary.map(function (p, i) { return { kod: p[0], qty: p[1], popis: '', radky: [i + 2] }; }),
        rezim: 'pridat'
      };
      stav.parsed.radky = stav.polozky.slice();
      krokKontrola();
    },
    vyprazdniKosik: vyprazdniKosik,
    stavKosiku: stavKosiku,
    config: CONFIG
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
