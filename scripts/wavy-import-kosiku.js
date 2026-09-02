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
    // Souberne 4, ne 8. Duvod je v REALNEM OBJEMU, ne v technickem limitu:
    // klient (mail Pracnove, zari 2026) uvadi, ze dealeri posilaji tabulky
    // o par polozkach, "nekdy i s patnacti". Pri patnacti polozkach je
    // rozdil mezi 4 a 8 souberne asi pul sekundy - neznatelny. Ctyrka
    // pritom pulí spickovou zatez sdileneho hostingu, na kterem shop bezi.
    //
    // Osmicka je overene optimum pro velke tabulky (viz bod 7 v hlavicce)
    // a da se sem vratit, kdyby dealeri zacali posilat stovky polozek -
    // coz se muze stat prave tim, ze tahle funkce vznikne: dnes objednavaji
    // mailem, a mailem nikdo neposle 300radkovou tabulku.
    SOUBEZNE: 4,
    SOUBEZNE_PO_CHYBACH: 1,   // na co spadnout, kdyz zacnou padat odpovedi
    CHYB_NEZ_ZPOMALIM: 3,     // kolik chyb v jedne davce spusti zpomaleni

    // Od jake doby behu se ukaze samostatna prubehova obrazovka.
    //
    // Zmereno: 15 polozek (realny objem podle klienta) trva ~1,5 s. Pri
    // hranici 600 ms se obrazovka objevila, ale jen na 900 ms - to pusobi
    // jako zavada. Hranice je proto nad tim: kratky beh zustane na nahledu
    // a uzivatel jde rovnou na vysledek.
    //
    // Okamzitou zpetnou vazbu mezitim dava sam potvrzovaci button, ktery
    // se pri kliknuti zablokuje a prepise na "Vkladam...". Bez toho by
    // uzivatel po kliknuti 2 s nevidel vubec nic.
    PRUBEH_OD_MS: 2000,
    VYPRAZDNIT_PRED: false,   // vychozi volba v UI, viz bod 6

    /* ---------- endpointy (ze shoptet.config, s fallbackem) ---------- */
    URL_PRIDAT: '/action/Cart/addCartItem/',
    URL_OBSAH: '/action/Cart/GetCartContent/',
    URL_SMAZAT: '/action/Cart/deleteCartItem/',

    /* ---------- kontrolni rezim (nic nevklada) ---------- */
    // Overuje kody pres vyhledavani. Je to GET, tedy CTENI - kosik se
    // nedotkne. Slouzi k tomu, aby si dealer (nebo my pri predvadeni)
    // mohl soubor prohnat naprazdno.
    //
    // Stoji 1 pozadavek na polozku, tedy zhruba 200 ms - u 300 polozek
    // asi minutu. To je pro vkladani duvod, proc se nepouziva, ale pro
    // jednorazovou kontrolu je to prijatelne.
    //
    // BONUS: vysledek vyhledavani obsahuje i dostupnost ("Skladem (4 ks)"),
    // takze kontrolni rezim umi rict "chces 999, skladem 4". Samo
    // vkladani to neumi - Shoptet mnozstvi nad sklad prijme bez varovani
    // (viz bod 5 v hlavicce).
    URL_HLEDAT: '/vyhledavani/?string=',
    SOUBEZNE_KONTROLA: 8,

    /* ---------- stare (nahrazene) kody ---------- */
    // Dealeri maji v tabulkach kody z rozkresu, ktere vyrobce mezitim
    // prečísloval - Shoptet takovy kod nezna a vlozeni selze. Klient
    // ale puvodni kody vyplnuje do popisnych parametru a denni generator
    // je publikuje do kody.json jako {aktualni: puvodni}. Obraceni
    // {puvodni: aktualni} tedy dava presne to, co tu potrebujeme.
    //
    // POZOR NA PORADI: nejdriv se VZDY zkusi kod tak, jak je v tabulce,
    // a mapa se pouzije teprve kdyz Shoptet vrati 500. Duvod: overeno,
    // ze 4 ze 44 puvodnich kodu jsou ZAROVEN platne kody jinych produktu
    // (napr. 865448A01 je puvodni kod k 8M0188327 i samostatny produkt).
    // Kdyby se mapa uplatnila prednostne, vlozil by se u nich cizi dil.
    //
    // Soubor je maly (~1 kB) a stahuje se AZ kdyz nejaka polozka selze,
    // takze bezchybny import zadny dotaz navic nedela.
    URL_STARE_KODY: 'https://glos-optimalizace.cz/scripts/kody.json',
    ZKOUSET_STARE_KODY: true,

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

  // Vytahne z odpovedi jen `code` a zbytek tela zahodi.
  //
  // Proc: addCartItem vraci v payloadu CELY kosik. Zmereno na dealerwb.cz -
  // odpoved roste o ~1 kB na kazdou polozku, ktera uz v kosiku je:
  //     0 polozek ->  1,9 kB      39 polozek -> 43 kB
  //    19 polozek -> 22 kB        59 polozek -> 64 kB
  // U 300polozkove tabulky se tim za cely beh prenese kvadraticky, radove
  // desitky MB, prestoze nas zajima jedno cislo na zacatku JSONu.
  //
  // Zmereno (zaklad 150 polozek, 40 pridani po 8 soubezne):
  //    cele telo:  74 ms/polozka, 7 185 kB
  //    useknute:   68 ms/polozka, 3 499 kB
  // Casove je to jen ~7 % - na rychle lince se to neprojevi. Objem dat to
  // ale puli, a to je rozdil pro dealera na pomale nebo merene lince.
  // Neprodavej to jako zrychleni, je to uspora dat.
  //
  // Kdyz se `code` v prvnich kusech streamu nenajde, docte se telo cele -
  // korektnost ma prednost pred usporou.
  function prectiKod(r) {
    if (!r.body || !r.body.getReader) {
      return r.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) { /* ignore */ }
        return j ? j.code : 0;
      });
    }

    var reader = r.body.getReader();
    var dec = new TextDecoder();
    var txt = '';

    function dalsi(kolo) {
      return reader.read().then(function (c) {
        if (c.value) txt += dec.decode(c.value, { stream: true });
        var m = txt.match(/"code"\s*:\s*(\d+)/);
        if (m) {
          try { reader.cancel(); } catch (e) { /* ignore */ }
          return parseInt(m[1], 10);
        }
        if (c.done) {
          var j = null; try { j = JSON.parse(txt); } catch (e) { /* ignore */ }
          return j ? j.code : 0;
        }
        if (kolo >= 4) {
          // Neobvykle poradi klicu - docteme radeji vse.
          return reader.read().then(function dalsiVse(cc) {
            if (cc.value) txt += dec.decode(cc.value, { stream: true });
            if (!cc.done) return reader.read().then(dalsiVse);
            var jj = null; try { jj = JSON.parse(txt); } catch (e) { /* ignore */ }
            return jj ? jj.code : 0;
          });
        }
        return dalsi(kolo + 1);
      });
    }
    return dalsi(0);
  }

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
      return prectiKod(r).then(function (code) {
        return { kod: kod, qty: qty, code: code };
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

  // onProgress dostava (smazano, celkem). Celkem se zjisti z prvniho
  // pruchodu a dal se nemeni, aby ukazatel neposkakoval - jinak by
  // "zbyva 40" po kazdem kole klesalo a pruh by se nikam neposouval.
  function vyprazdniKosik(onProgress) {
    var kolo = 0;
    var celkem = null;
    var smazano = 0;

    function dalsi() {
      if (kolo++ > 15) return Promise.resolve(false);
      return stavKosiku().then(function (s) {
        if (celkem === null) celkem = s.itemIds.length;
        if (!s.itemIds.length) {
          if (onProgress && celkem) onProgress(celkem, celkem);
          return true;
        }

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
            })).then(function () {
              smazano += davka.length;
              if (onProgress) onProgress(Math.min(smazano, celkem), celkem);
            });
          });
        }, Promise.resolve()).then(dalsi);
      });
    }
    return dalsi();
  }

  /* ================= STARE (NAHRAZENE) KODY ================= */

  // Mapa {puvodni_kod: aktualni_kod}, memoizovana. Vraci {} kdyz se
  // soubor nepodari nacist - stary kod se pak jen nedohleda, coz je
  // stejny vysledek jako dnes, ne chyba.
  var stareKodyPromise = null;
  function zajistiStareKody() {
    if (!CONFIG.ZKOUSET_STARE_KODY) return Promise.resolve({});
    if (stareKodyPromise) return stareKodyPromise;

    stareKodyPromise = fetch(CONFIG.URL_STARE_KODY, { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var obraceno = {};
        Object.keys(data || {}).forEach(function (aktualni) {
          var puvodni = String(data[aktualni] || '').trim();
          // Pri kolizi (jeden puvodni kod na vic aktualnich) radeji
          // nemapovat vubec, nez hadat. Overeno, ze dnes zadna neni.
          if (!puvodni) return;
          if (obraceno[puvodni] && obraceno[puvodni] !== aktualni) {
            obraceno[puvodni] = null;
          } else if (!(puvodni in obraceno)) {
            obraceno[puvodni] = aktualni;
          }
        });
        return obraceno;
      })
      .catch(function (e) {
        log('kody.json se nepodarilo nacist', e && e.message);
        return {};
      });

    return stareKodyPromise;
  }

  // Zkusi znovu vlozit polozky, ktere selhaly, pod aktualnim kodem.
  // Vraci seznam uspesnych substituci [{polozka, novyKod}].
  function dohledejStareKody(nepodarene) {
    if (!nepodarene.length) return Promise.resolve([]);

    return zajistiStareKody().then(function (mapa) {
      var kandidati = nepodarene.filter(function (p) { return mapa[p.kod]; });
      if (!kandidati.length) return [];

      var out = [];
      var i = 0;
      function davka() {
        if (i >= kandidati.length) return Promise.resolve(out);
        var cast = kandidati.slice(i, i + CONFIG.SOUBEZNE);
        i += cast.length;
        return Promise.all(cast.map(function (p) {
          var novy = mapa[p.kod];
          return vlozPolozku(novy, p.qty).then(function (v) {
            if (v.code === 200) {
              p.vlozenoJako = novy;      // aby vyhodnot() hledal v kosiku spravne
              out.push({ polozka: p, novyKod: novy });
            }
          });
        })).then(davka);
      }
      return davka();
    });
  }

  /* ================= KONTROLNI REZIM (jen cteni) ================= */

  // Overi jeden kod pres vyhledavani. Bere se JEN PRESNA shoda SKU -
  // vyhledavani vraci i delsi kody (na "11149A2" vrati 7 vysledku
  // vcetne 11149A20..A27), takze prvni vysledek by byl spatne.
  function zkontrolujKod(kod) {
    return fetch(CONFIG.URL_HLEDAT + encodeURIComponent(kod), {
      credentials: 'include'
    }).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var dlazdice = [].slice.call(doc.querySelectorAll('[data-micro="product"]'));

      var presne = dlazdice.filter(function (d) {
        var sku = d.querySelector('[data-micro="sku"]');
        return sku && sku.textContent.trim() === kod;
      });

      if (!presne.length) {
        return { kod: kod, nalezeno: false, vysledku: dlazdice.length };
      }

      var d = presne[0];
      var dostupnost = d.querySelector('.availability');
      var text = dostupnost ? dostupnost.textContent.replace(/\s+/g, ' ').trim() : '';
      // "Skladem (4 ks)" -> 4. Kdyz to nejde precist, sklad neznamy.
      var m = text.match(/\((\d+)\s*ks\)/i);

      return {
        kod: kod,
        nalezeno: true,
        nejednoznacne: presne.length > 1,
        nazev: (d.querySelector('[data-micro="name"]') || {}).textContent
          ? d.querySelector('[data-micro="name"]').textContent.trim() : '',
        dostupnost: text,
        skladem: m ? parseInt(m[1], 10) : null,
        url: (d.querySelector('a[data-micro="url"]') || {}).getAttribute
          ? d.querySelector('a[data-micro="url"]').getAttribute('href') : null
      };
    }).catch(function (e) {
      return { kod: kod, nalezeno: null, chyba: e.message };
    });
  }

  function zkontrolujVse(polozky, onProgress) {
    var out = [];
    var i = 0;
    function davka() {
      if (i >= polozky.length) return Promise.resolve(out);
      var cast = polozky.slice(i, i + CONFIG.SOUBEZNE_KONTROLA);
      i += cast.length;
      return Promise.all(cast.map(function (p) { return zkontrolujKod(p.kod); }))
        .then(function (res) {
          out = out.concat(res);
          if (onProgress) onProgress(out.length, polozky.length);
          return davka();
        });
    }
    return davka();
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
      // Kdyz se polozka vlozila pod aktualnim kodem misto stareho z
      // tabulky, v kosiku lezi pod tim novym - hledat musime tam.
      var kodVKosiku = p.vlozenoJako || p.kod;
      var vKosiku = kosik.mnozstvi ? kosik.mnozstvi[kodVKosiku] : undefined;
      if (p.vlozenoJako) v = { kod: p.kod, code: 200 };

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
    prehled.vlozeno.forEach(function (z) {
      pridej(z.polozka.vlozenoJako ? ('vlozeno jako ' + z.polozka.vlozenoJako) : 'vlozeno', z, z.vKosiku);
    });
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
    // Vzhled se vaze na promenne sablony, ne na vlastni paletu - kdyz
    // klient zmeni barvy v administraci, dialog se zmeni s nim.
    // Overeno na dealerwb.cz: --color-primary #000, hover #ff0000,
    // --template-font "Exo 2", tlacitka hranata a verzalkami, text #4d4d4d.
    // Fallbacky jsou pro pripad, ze by sablona promenne nemela.
    s.textContent = [
      '#' + MODAL_ID + ',.wb-imp-btn{font-family:var(--template-font,inherit)}',
      '.wb-imp-btn{display:inline-flex;align-items:center;gap:8px;margin:12px 0;cursor:pointer}',
      '#' + MODAL_ID + '{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6)}',
      '.wb-imp-box{background:#fff;color:#4d4d4d;width:min(760px,94vw);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.45)}',
      '.wb-imp-hd{padding:14px 18px;background:var(--color-header-background,#000);color:#fff;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}',
      '.wb-imp-hd h3{margin:0;font-size:15px;text-transform:uppercase;font-weight:400;letter-spacing:.03em;color:#fff}',
      '.wb-imp-x{background:none;border:0;color:#fff;font-size:24px;cursor:pointer;line-height:1;padding:0 4px}',
      '.wb-imp-x:hover{color:var(--color-primary-hover,#ff0000)}',
      '.wb-imp-bd{padding:18px;overflow:auto;flex:1;font-size:14px;line-height:1.55}',
      '.wb-imp-ft{padding:12px 18px;border-top:1px solid #e0e0e0;display:flex;gap:10px;justify-content:flex-end;flex-shrink:0;flex-wrap:wrap}',
      '.wb-imp-drop{border:2px dashed #c0c0c0;padding:26px;text-align:center;cursor:pointer}',
      '.wb-imp-drop:hover,.wb-imp-drop.hover{border-color:var(--color-primary,#000);background:#fafafa}',
      '.wb-imp-vol{margin-top:14px;padding:12px;background:#f5f5f5;font-size:13px}',
      '.wb-imp-vol label{display:flex;gap:8px;align-items:flex-start;margin:6px 0;cursor:pointer}',
      // Sablona Shoptetu schovava nativni radio (position:absolute;
      // width:1px;height:1px;appearance:none) a kresli si vlastni pres
      // strukturu labelu, kterou tady nemame - bez tohoto resetu neni
      // videt zadne kolecko a dealer nepozna, co je zvolene.
      '#' + MODAL_ID + ' input[type="radio"]{appearance:auto;-webkit-appearance:radio;',
      'position:static;width:16px;height:16px;min-width:16px;margin:2px 0 0;opacity:1;flex-shrink:0}',
      '.wb-imp-tab{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}',
      '.wb-imp-tab th,.wb-imp-tab td{border-bottom:1px solid #e8e8e8;padding:5px 7px;text-align:left}',
      '.wb-imp-tab th{background:#f5f5f5;text-transform:uppercase;font-weight:400;letter-spacing:.03em;color:#000}',
      '.wb-imp-sum{display:flex;gap:16px;flex-wrap:wrap;margin:4px 0 12px;font-weight:600}',
      '.wb-imp-ok{color:#0a7a3a}.wb-imp-err{color:var(--color-primary-hover,#c00)}.wb-imp-warn{color:#9a5b00}',
      '.wb-imp-bar{height:8px;background:#e8e8e8;overflow:hidden;margin:10px 0}',
      '.wb-imp-bar>div{height:100%;background:var(--color-primary,#000);width:0;transition:width .2s}',
      '.wb-imp-note{font-size:12px;color:#777;margin-top:10px}',
      '.wb-imp-bd b,.wb-imp-bd strong{color:#000}'
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

  // Rezim se cte az na druhe obrazovce - volba "co s obsahem kosiku"
  // ma smysl teprve ve chvili, kdy uzivatel vidi, co v souboru je.
  function rezim() {
    var el = document.querySelector('input[name="wb-imp-mode"]:checked');
    return el ? el.value : (CONFIG.VYPRAZDNIT_PRED ? 'vyprazdnit' : 'pridat');
  }

  function nactiSoubor(f) {
    modal('<div>Načítám <b>' + f.name + '</b>…</div>');

    zajistiSheetJS()
      .then(function () { return f.arrayBuffer(); })
      .then(function (ab) {
        var p = parsuj(ab);
        if (!p.radky.length) throw new Error('v tabulce nejsou žádné položky s kódem produktu');
        stav = {
          nazevSouboru: f.name,
          parsed: p,
          polozky: agreguj(p.radky)
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

    // Volba rezimu je tady, ne na prvni obrazovce - az ted uzivatel vi,
    // co v souboru je, a muze se rozhodnout.
    html += '<div class="wb-imp-vol">'
      + '<label><input type="radio" name="wb-imp-mode" value="pridat"' + (CONFIG.VYPRAZDNIT_PRED ? '' : ' checked') + '>'
      +   '<span><b>Přidat k obsahu košíku</b> — u shodných kódů se množství sečte.</span></label>'
      + '<label><input type="radio" name="wb-imp-mode" value="vyprazdnit"' + (CONFIG.VYPRAZDNIT_PRED ? ' checked' : '') + '>'
      +   '<span><b>Nejdřív košík vyprázdnit</b> — zůstane jen to, co je v tabulce.</span></label>'
      + '<label style="margin-top:10px;padding-top:10px;border-top:1px solid #e2e5e8">'
      +   '<input type="radio" name="wb-imp-mode" value="zkontrolovat">'
      +   '<span><b>Jen zkontrolovat</b> — nic se nevloží, ukáže dostupnost. Trvá to déle.</span></label>'
      + '</div>';

    modal(html,
        '<button class="btn" id="wb-imp-back" type="button">Jiný soubor</button>'
      + '<button class="btn btn-conversion" id="wb-imp-go" type="button">Vložit do košíku</button>');

    var go = document.getElementById('wb-imp-back');
    if (go) go.onclick = krokVyber;

    // Popisek tlacitka sleduje zvolenou moznost
    var btn = document.getElementById('wb-imp-go');
    function prepisTlacitko() {
      btn.textContent = (rezim() === 'zkontrolovat') ? 'Zkontrolovat' : 'Vložit do košíku';
    }
    [].slice.call(document.querySelectorAll('input[name="wb-imp-mode"]')).forEach(function (r) {
      r.addEventListener('change', prepisTlacitko);
    });
    prepisTlacitko();

    btn.onclick = function () {
      stav.rezim = rezim();
      // Okamzita zpetna vazba - u kratkych behu je to jedina, kterou
      // uzivatel uvidi, protoze prubehova obrazovka uz nenaskoci.
      btn.disabled = true;
      btn.textContent = (stav.rezim === 'zkontrolovat') ? 'Kontroluji…' : 'Vkládám…';
      var zpet = document.getElementById('wb-imp-back');
      if (zpet) zpet.disabled = true;

      if (stav.rezim === 'zkontrolovat') krokKontrolniBeh();
      else krokVkladani();
    };
  }

  /* ---------- krok 3b: kontrolni beh (nic nevklada) ---------- */

  function krokKontrolniBeh() {
    var pol = stav.polozky;
    modal('<div id="wb-imp-stat">Kontroluji…</div>'
      + '<div class="wb-imp-bar"><div id="wb-imp-fill"></div></div>'
      + '<div class="wb-imp-note">Do košíku se nic nevkládá.</div>');

    var stat = document.getElementById('wb-imp-stat');
    var fill = document.getElementById('wb-imp-fill');

    zkontrolujVse(pol, function (hotovo, celkem) {
      stat.innerHTML = 'Kontroluji <b>' + hotovo + '</b> z <b>' + celkem + '</b>…';
      fill.style.width = Math.round(hotovo / celkem * 100) + '%';
    }).then(function (vysledky) {
      krokPrehledKontroly(pol, vysledky);
    }).catch(function (e) {
      modal('<div class="wb-imp-err"><b>Kontrola se nedokončila.</b></div>'
        + '<div style="margin-top:8px">' + String(e.message || e) + '</div>',
        '<button class="btn" id="wb-imp-zav2" type="button">Zavřít</button>');
      var b = document.getElementById('wb-imp-zav2');
      if (b) b.onclick = zavri;
    });
  }

  function krokPrehledKontroly(polozky, vysledky) {
    var podle = {};
    vysledky.forEach(function (v) { podle[v.kod] = v; });

    var ok = [], chybi = [], nadSklad = [], nejiste = [];
    polozky.forEach(function (p) {
      var v = podle[p.kod];
      if (!v || v.nalezeno === null) { nejiste.push({ p: p, v: v }); return; }
      if (!v.nalezeno) { chybi.push({ p: p, v: v }); return; }
      if (v.skladem !== null && p.qty > v.skladem) { nadSklad.push({ p: p, v: v }); return; }
      ok.push({ p: p, v: v });
    });

    var html = '<div class="wb-imp-note" style="margin-top:0"><b>Kontrolní režim</b> — '
      + 'do košíku se nic nevložilo.</div>'
      + '<div class="wb-imp-sum">'
      + '<span class="wb-imp-ok">✓ v katalogu: ' + ok.length + '</span>'
      + (nadSklad.length ? '<span class="wb-imp-warn">! nad sklad: ' + nadSklad.length + '</span>' : '')
      + (chybi.length ? '<span class="wb-imp-err">✗ nenalezeno: ' + chybi.length + '</span>' : '')
      + (nejiste.length ? '<span class="wb-imp-warn">? nezjištěno: ' + nejiste.length + '</span>' : '')
      + '</div>';

    if (chybi.length) {
      html += '<div style="margin-top:10px"><b class="wb-imp-err">Tyto kódy se v katalogu nenašly</b>'
        + '<div class="wb-imp-note">Může jít o kód nahrazený výrobcem (supersession).</div>'
        + '<table class="wb-imp-tab"><thead><tr><th>Kód</th><th>Název v tabulce</th><th>Ks</th><th></th></tr></thead><tbody>';
      chybi.forEach(function (z) {
        html += '<tr><td><b>' + z.p.kod + '</b></td><td>' + (z.p.popis || '—') + '</td><td>' + z.p.qty + '</td>'
          + '<td><a href="' + CONFIG.URL_HLEDAT + encodeURIComponent(z.p.kod) + '" target="_blank" rel="noopener">hledat</a></td></tr>';
      });
      html += '</tbody></table></div>';
    }

    if (nadSklad.length) {
      html += '<div style="margin-top:14px"><b class="wb-imp-warn">Požadované množství je vyšší než skladem</b>'
        + '<div class="wb-imp-note">Vložit to lze, e-shop to dovolí — jen ať to není překvapení.</div>'
        + '<table class="wb-imp-tab"><thead><tr><th>Kód</th><th>Název</th><th>Chcete</th><th>Skladem</th></tr></thead><tbody>';
      nadSklad.forEach(function (z) {
        html += '<tr><td><b>' + z.p.kod + '</b></td><td>' + (z.v.nazev || '—') + '</td>'
          + '<td>' + z.p.qty + '</td><td>' + z.v.skladem + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    if (nejiste.length) {
      html += '<div class="wb-imp-note" style="margin-top:14px">U ' + nejiste.length
        + ' položek se kontrola nepovedla (chyba sítě). Zkuste to prosím znovu.</div>';
    }

    html += '<div class="wb-imp-note" style="margin-top:14px">Když je vše v pořádku, '
      + 'zvolte „Jiný soubor" a nahrajte tabulku znovu s možností vložení do košíku.</div>';

    var csv = ['Kontrola souboru;' + (stav ? stav.nazevSouboru : '')];
    csv.push('Datum;' + new Date().toLocaleString('cs-CZ'));
    csv.push('');
    csv.push('Stav;Kod;Nazev v tabulce;Nazev v katalogu;Pozadovano;Skladem;Dostupnost');
    function radek(stavTxt, z) {
      csv.push([stavTxt, z.p.kod, z.p.popis, (z.v && z.v.nazev) || '', z.p.qty,
        (z.v && z.v.skladem !== null && z.v.skladem !== undefined) ? z.v.skladem : '',
        (z.v && z.v.dostupnost) || '']
        .map(function (x) { return String(x === undefined ? '' : x).replace(/;/g, ','); }).join(';'));
    }
    ok.forEach(function (z) { radek('v katalogu', z); });
    nadSklad.forEach(function (z) { radek('NAD SKLAD', z); });
    chybi.forEach(function (z) { radek('NENALEZENO', z); });
    nejiste.forEach(function (z) { radek('NEZJISTENO', z); });
    var csvText = csv.join('\n');

    modal(html,
        '<button class="btn" id="wb-imp-back2" type="button">Jiný soubor</button>'
      + '<button class="btn" id="wb-imp-csv2" type="button">Uložit CSV</button>'
      + '<button class="btn btn-conversion" id="wb-imp-zav3" type="button">Zavřít</button>');

    document.getElementById('wb-imp-back2').onclick = krokVyber;
    document.getElementById('wb-imp-csv2').onclick = function () {
      stahniCsv(csvText, 'kontrola-souboru.csv');
    };
    document.getElementById('wb-imp-zav3').onclick = zavri;
  }

  /* ---------- krok 3: vkladani ---------- */

  function krokVkladani() {
    var pol = stav.polozky;
    // Prubehova obrazovka se ukaze AZ kdyz beh trva dele nez PRUBEH_OD_MS.
    // Pri patnacti polozkach je hotovo pod sekundu a obrazovka by jen
    // blikla - to pusobi jako zavada, ne jako zpetna vazba.
    // Modal zustava otevreny s obsahem z predchozi obrazovky, aby se
    // dialog nezavrel a hned neotevrel.
    var ukazanProbeh = false;
    var stat = null, fill = null;

    function ukazPrubeh() {
      if (ukazanProbeh) return;
      ukazanProbeh = true;
      modal('<div id="wb-imp-stat">Vkládám…</div>'
        + '<div class="wb-imp-bar"><div id="wb-imp-fill"></div></div>'
        + '<div class="wb-imp-note">Nezavírejte prosím stránku, dokud import neskončí.</div>');
      stat = document.getElementById('wb-imp-stat');
      fill = document.getElementById('wb-imp-fill');
    }

    var casovac = setTimeout(ukazPrubeh, CONFIG.PRUBEH_OD_MS);

    function pokrok(hotovo, celkem, soubezne) {
      if (!ukazanProbeh) return;
      stat.innerHTML = 'Vkládám <b>' + hotovo + '</b> z <b>' + celkem + '</b> položek…'
        + (soubezne === CONFIG.SOUBEZNE_PO_CHYBACH && CONFIG.SOUBEZNE > CONFIG.SOUBEZNE_PO_CHYBACH
            ? ' <span class="wb-imp-warn">(zpomaleno kvůli chybám)</span>' : '');
      fill.style.width = Math.round(hotovo / celkem * 100) + '%';
    }

    var pred = stav.rezim === 'vyprazdnit'
      ? vyprazdniKosik(function (smazano, celkem) {
          if (!ukazanProbeh) return;
          stat.innerHTML = 'Vyprazdňuji košík — <b>' + smazano + '</b> z <b>' + celkem + '</b>';
          fill.style.width = celkem ? Math.round(smazano / celkem * 100) + '%' : '0%';
        }).then(function (ok) {
          // Pruh vynulovat, at vkladani zacina od nuly a nepokracuje
          // z pozice, kterou nechalo mazani.
          if (ukazanProbeh) fill.style.width = '0%';
          return ok;
        })
      : Promise.resolve(true);

    pred
      .then(function () { return vlozVse(pol, pokrok); })
      .then(function (vysledky) {
        // Nepodarene kody muzou byt stare (vyrobce je precisloval).
        // Zkusime je dohledat pres kody.json - jen kdyz je co dohledavat.
        var nepodarene = vysledky
          .filter(function (v) { return v.code !== 200; })
          .map(function (v) {
            return pol.filter(function (p) { return p.kod === v.kod; })[0];
          })
          .filter(Boolean);

        if (!nepodarene.length) return { vysledky: vysledky, nahrazeno: [] };

        if (ukazanProbeh) stat.innerHTML = 'Dohledávám nahrazené kódy…';
        return dohledejStareKody(nepodarene).then(function (nahrazeno) {
          return { vysledky: vysledky, nahrazeno: nahrazeno };
        });
      })
      .then(function (o) {
        if (ukazanProbeh) stat.innerHTML = 'Kontroluji obsah košíku…';
        return stavKosiku().then(function (kosik) {
          return { vysledky: o.vysledky, nahrazeno: o.nahrazeno, kosik: kosik };
        });
      })
      .then(function (o) {
        clearTimeout(casovac);
        var prehled = vyhodnot(pol, o.vysledky, o.kosik);
        prehled.nahrazeno = o.nahrazeno || [];
        krokPrehled(prehled, o.kosik);
      })
      .catch(function (e) {
        clearTimeout(casovac);
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
    // Nahrazene kody nejsou chyba, ale dealer o nich MUSI vedet - v kosiku
    // je jiny kod, nez mel v tabulce. Zkraceny vysledek se proto pouzije
    // jen kdyz zadna substituce nebyla.
    var vseVPoradku = !prehled.nenalezeno.length && !prehled.neshoda.length
      && !prehled.neovereno.length && !(prehled.nahrazeno && prehled.nahrazeno.length);

    // Kdyz je vsechno v poradku, neni co hlasit - plna tabulka polozek,
    // ktere presne odpovidaji tomu, co uzivatel prave videl v nahledu,
    // je jen obrad. Detail je za odkazem pro toho, kdo ho chce.
    if (vseVPoradku) {
      modal('<div style="font-size:15px;margin-bottom:6px">'
          + '<b class="wb-imp-ok">Vloženo ' + prehled.vlozeno.length + ' položek do košíku.</b></div>'
        + '<div class="wb-imp-note">Vše z tabulky se podařilo spárovat. '
        + '<a href="#" id="wb-imp-detail">Zobrazit přehled</a></div>',
          '<button class="btn" id="wb-imp-kopie" type="button">Kopírovat přehled</button>'
        + '<button class="btn btn-conversion" id="wb-imp-hotovo" type="button">Hotovo</button>');

      var odkaz = document.getElementById('wb-imp-detail');
      if (odkaz) odkaz.onclick = function (e) {
        e.preventDefault();
        krokPrehledDetail(prehled, kosik);
      };
      pripojPrehledAkce(prehled, kosik);
      return;
    }

    krokPrehledDetail(prehled, kosik);
  }

  // Sdilene akce paticky prehledu (kopie, CSV, hotovo, opakovani).
  function pripojPrehledAkce(prehled, kosik) {
    var csv = prehledCsv(prehled, { nazevSouboru: stav ? stav.nazevSouboru : '' });

    var bCsv = document.getElementById('wb-imp-csv');
    if (bCsv) bCsv.onclick = function () { stahniCsv(csv, 'import-kosiku-prehled.csv'); };

    var bKop = document.getElementById('wb-imp-kopie');
    if (bKop) bKop.onclick = function () {
      var b = this;
      var hotovo = function () {
        b.textContent = 'Zkopírováno';
        setTimeout(function () { b.textContent = 'Kopírovat přehled'; }, 1800);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(csv).then(hotovo, function () { fallbackKopie(csv, hotovo); });
      else fallbackKopie(csv, hotovo);
    };

    var bHot = document.getElementById('wb-imp-hotovo');
    if (bHot) bHot.onclick = function () {
      zavri();
      // Kosik se meni na serveru, stranku je potreba prekreslit,
      // aby dealer videl skutecny obsah.
      if (CONFIG.JEN_NA_URL.test(location.pathname)) location.reload();
    };

    var bZnovu = document.getElementById('wb-imp-znovu');
    if (bZnovu) bZnovu.onclick = function () {
      stav.polozky = prehled.nenalezeno.concat(prehled.neshoda).map(function (z) { return z.polozka; });
      // POZOR: rezim se MUSI prepnout na 'pridat'. V rezimu 'vyprazdnit'
      // by opakovani vyprazdnilo kosik ZNOVU a smazalo tim i polozky,
      // ktere se prvnim behem uspesne vlozily - v kosiku by zustalo jen
      // to, co se opakuje. Vyprazdneni je jednorazovy krok, ktery uz
      // probehl.
      stav.rezim = 'pridat';
      krokVkladani();
    };
  }

  function krokPrehledDetail(prehled, kosik) {
    var html = '<div class="wb-imp-sum">'
      + '<span class="wb-imp-ok">✓ vloženo: ' + prehled.vlozeno.length + '</span>'
      + (prehled.nenalezeno.length ? '<span class="wb-imp-err">✗ nenalezeno: ' + prehled.nenalezeno.length + '</span>' : '')
      + (prehled.neshoda.length ? '<span class="wb-imp-warn">≠ neshoda: ' + prehled.neshoda.length + '</span>' : '')
      + (prehled.neovereno.length ? '<span class="wb-imp-warn">? neověřeno: ' + prehled.neovereno.length + '</span>' : '')
      + ((prehled.nahrazeno && prehled.nahrazeno.length)
          ? '<span class="wb-imp-warn">↻ nahrazeno: ' + prehled.nahrazeno.length + '</span>' : '')
      + '</div>';

    if (prehled.nahrazeno && prehled.nahrazeno.length) {
      html += '<div style="margin-top:10px"><b class="wb-imp-warn">Tyto kódy výrobce nahradil novějšími</b>'
        + '<div class="wb-imp-note">Kód z vaší tabulky se v katalogu nenašel, ale je u něj vedený '
        + 'jako původní kód novějšího dílu — do košíku je vložený ten novější. '
        + 'Zkontrolujte prosím, že jde o díl, který jste chtěli.</div>'
        + '<table class="wb-imp-tab"><thead><tr><th>Kód v tabulce</th><th>Vloženo jako</th><th>Ks</th></tr></thead><tbody>';
      prehled.nahrazeno.forEach(function (z) {
        html += '<tr><td>' + z.polozka.kod + '</td><td><b>' + z.novyKod + '</b></td>'
          + '<td>' + z.polozka.qty + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

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
    pripojPrehledAkce(prehled, kosik);
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
