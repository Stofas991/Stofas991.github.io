/* ============================================================
   Wavy Boats - volba delene expedice (krok 2)
   ------------------------------------------------------------
   Autor: Krystof Glos / glos-optimalizace.cz
   Verze: 5.2
   Zaklad: v5.0 (vykresleni i detekce dostupnosti overeny naostro
           18. 8. 2026 na www.dealerwb.cz/objednavka/krok-2/)

   ZMENY PROTI VERZI 5.0
   1) Hlaska pri nerozhodnute dostupnosti. v5.0 volala showError(),
      ale ta byla podminena existenci bloku volby - a ten se v rezimu
      PENDING jeste nevykresluje. Prvni klik na "Objednat" se tedy
      spolkl BEZ JAKEKOLI HLASKY a zakaznik do 6,5 s nevidel nic.
      Ted se hlaska vlozi nad tlacitko i bez bloku.
   2) CASTECNA DOSTUPNOST JEDNE POLOZKY. Kdyz dealer objedna 3 ks
      jednoho produktu a skladem je 1 ks, cely radek je "Skladem",
      takze v5.0 vyhodnotila "vse skladem" a volbu vubec nenabidla.
      Rozhodnout se ale musi stejne. Ted se z textu dostupnosti
      tahne pocet kusu ("Skladem (1 ks)" -> 1) a porovnava se s
      objednanym mnozstvim. Staci jedna takova polozka a volba se
      nabidne, i kdyz je v kosiku sama.
      Kdyz je radek skladem, objednava se vic kusu a pocet skladem
      z textu vycist nejde, nabidne se volba take (viz
      CHOICE_WHEN_COUNT_UNKNOWN).

   Co to dela:
   1) Nad tlacitko "Objednat s povinnosti platby" prida povinnou
      volbu zpusobu expedice. Nic neni predvybrane.
   2) Bez vybrane volby nelze objednavku dokoncit.
   3) Zvolena varianta se zapise do poznamky AZ PRI ODESLANI,
      za text, ktery si tam napsal zakaznik.

   ZMENY PROTI VERZI 4.0
   - Volba se nabizi jen tehdy, kdy ma smysl: v kosiku je
     ALESPON JEDNA polozka skladem A ZAROVEN alespon jedna
     neskladova. Kdyz je vse skladem nebo naopak nic skladem,
     je zpusob expedice jednoznacny a blok se nevykresli;
     odeslani objednavky pak nic neblokuje.
   - Dostupnost se cte z /kosik/ pres fetch + DOMParser, protoze
     krok 2 dostupnost polozek nezobrazuje.
   - Kdyz dostupnost nelze urcit (jiny HTML, chyba site, neznamy
     text stavu), script se chova jako v4.0, tzn. volbu ZOBRAZI.
     Selhani detekce nikdy nesmi vest k tomu, ze se dealer
     nedozvi o delene expedici.

   OVERENE SELEKTORY (17. 8. 2026)
   krok:      /objednavka/krok-2/
   poznamka:  textarea#remark  (name="remark")  <- NE "note"!
   prepinac:  input#add-note   ("Zadat poznamku pro prodejce")
   tlacitko:  button#submit-order
   ukotveni:  div.next-step    (pravy sloupec col-md-4, ~413 px)
   formular:  form#order-form  (action .../Step2Validate/)

   DOSTUPNOST - OVERENO 18. 8. 2026
   inspect() na kosiku s 5 polozkami vratil 1 skladem / 4 neskladem
   / 0 neznamych, selektor radku "table.cart-table tbody tr".
   Blok se vykreslil, dlazdice i info reaguji.
   Skutecne texty v kosiku:
       "Dostupnost Skladem (1 ks)"        -> in
       "Dostupnost Momentalne nedostupne" -> out
   POZOR: skladem je v celem e-shopu jediny produkt -
   BEZEL KIT (8M0215696), "Skladem (1 ks)". Bez nej v kosiku
   nastane "nic neni skladem" a blok se zamerne nevykresli.
   Na to pozor pri kazdem dalsim testovani.

   POZNAMKA K POZNAMCE OBJEDNAVKY
   textarea#remark je pri sbalene sekci visibility:hidden a ma
   vysku 0, ale NENI disabled a ma name="remark". Nedisablovane
   pole formular odesila i kdyz neni videt, takze skryte zalozni
   pole nejspis nebude potreba. Overit ale skutecnym odeslanim.

   Vlozeni: Vzhled a obsah -> Editor -> HTML kody -> paticka
   ============================================================ */

(function () {
  'use strict';

  /* ================= KONFIGURACE ================= */
  var CONFIG = {
    HEADING: 'Způsob expedice',
    ERROR: 'Vyberte způsob expedice.',
    PENDING_ERROR: 'Zjišťujeme dostupnost položek, zkuste to za okamžik znovu.',
    INFO_TITLE: 'Co která možnost znamená',

    OPTIONS: [
      {
        id: 'ihned',
        label: 'Odeslat ihned, co je skladem',
        info: 'Co máme skladem, odešleme hned – i když je to jen část kusů z položky. Zbytek doobjednáme a pošleme samostatně po naskladnění. Zásilky tedy budou dvě.',
        noteText: 'ZPŮSOB EXPEDICE: Skladové produkty odeslat ihned, neskladové následně po naskladnění.'
      },
      {
        id: 'kompletni',
        label: 'Čekat na kompletní objednávku',
        info: 'Objednávku odešleme až ve chvíli, kdy budeme mít všechny položky. Přijde v jedné zásilce, ale později.',
        noteText: 'ZPŮSOB EXPEDICE: Vyčkat na naskladnění všech produktů a odeslat kompletní objednávku.'
      }
    ],

    SELECTORS: {
      note: 'textarea#remark, textarea[name="remark"]',
      noteToggle: '#add-note',
      submit: '#submit-order',
      form: '#order-form',
      anchor: '.next-step'
    },

    /* ---------- detekce dostupnosti ---------- */
    AVAIL: {
      // Vypnutim se script vrati k chovani v4.0 (volba vzdy).
      ENABLED: true,

      cartUrl: '/kosik/',
      timeoutMs: 6000,

      // Zkousi se v tomto poradi, pouzije se prvni sada s vysledkem.
      rowSelectors: [
        '#cart-content tbody tr',
        'table.cart-table tbody tr',
        '.cart-table tbody tr',
        'tr.removeable-item',
        '.cart-item'
      ],
      // Radek se povazuje za produkt, jen kdyz obsahuje jednu z tehle veci.
      productMarkers: 'td.p-name, .p-name, .main-link, input.amount, .quantity input',
      // Darky, doprava, platba, slevy - do rozhodovani nepatri.
      excludeSelectors: '.cart-row-gift, .free-gift, .gift, .cart-row-discount, .discount-coupon',
      // Kde v radku hledat text dostupnosti.
      textSelectors: '.availability, .p-availability, .availability-label, [class*="availability"], [data-availability]',

      // Porovnava se na male pismena BEZ diakritiky, jako podretezec.
      // OUT se testuje PRVNI, jinak by "skladem u dodavatele"
      // spadlo do IN kvuli slovu "skladem".
      OUT: [
        'momentalne nedostupne',
        'nedostupne',
        'vyprodano',
        'na dotaz',
        'skladem u dodavatele',
        'na ceste',
        'ocekavame',
        'predobjednavka',
        'na objednavku'
      ],
      IN: [
        'skladem',
        'ihned k odeslani',
        'k odeslani ihned',
        'na prodejne'
      ],

      /* ---------- castecna dostupnost jedne polozky ---------- */
      // Dealer si da 3 ks jednoho produktu a skladem je 1 ks. Cely
      // radek je "Skladem", ale rozhodnout se stejne musi: poslat
      // ten jeden kus hned, nebo cekat na vsechny tri.
      // Proto se z textu dostupnosti tahne pocet kusu a porovnava
      // se s objednanym mnozstvim.
      PARTIAL_ENABLED: true,

      // "Skladem (1 ks)" -> 1. Zabira i "(1 ks)" samostatne.
      stockCountPattern: '\\((?:\\s*(?:>|<|max\\.?)?\\s*)(\\d+)\\s*ks',

      // Radek je skladem, ale pocet kusu z textu vycist nejde
      // (napr. jen "Skladem") a objednava se vic nez 1 ks. Nevime,
      // jestli je to cele skladem. true = radsi nabidnout volbu.
      CHOICE_WHEN_COUNT_UNKNOWN: true,

      // Kdyz je vse skladem / nic skladem, blok se nevykresli.
      // Tady se da zapnout, aby se do poznamky presto zapsala
      // informace pro sklad. Vychozi false = poznamka zustane
      // presne takova, jakou ji napsal zakaznik.
      AUTO_NOTE: false,
      AUTO_TEXTS: {
        allIn: 'ZPŮSOB EXPEDICE: Vše skladem, odeslat ihned.',
        allOut: 'ZPŮSOB EXPEDICE: Nic není skladem, odeslat kompletní objednávku po naskladnění.'
      }
    },

    // Ohraniceni bloku v poznamce. Diky nemu se pri opakovanem
    // odeslani (napr. po chybe validace) blok PREPISE, ne prilepi.
    MARK_START: '--- expedice ---',
    MARK_END: '--- konec expedice ---',

    DEBUG: false
  };

  var CLS = 'wb-expedice';

  var MODE = { PENDING: 'pending', CHOICE: 'choice', SKIP: 'skip' };
  var mode = MODE.PENDING;
  var skipReason = null;      // 'allIn' | 'allOut'
  var chosenId = null;
  var infoOpen = false;
  var lastReport = null;

  /* ================= POMOCNE ================= */

  function log() {
    if (CONFIG.DEBUG && window.console) {
      console.log.apply(console, ['[Expedice]'].concat([].slice.call(arguments)));
    }
  }

  function getOption(id) {
    for (var i = 0; i < CONFIG.OPTIONS.length; i++) {
      if (CONFIG.OPTIONS[i].id === id) return CONFIG.OPTIONS[i];
    }
    return null;
  }

  // male pismena, bez diakritiky, sjednocene mezery
  function norm(s) {
    var t = (s === null || s === undefined) ? '' : String(s);
    if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return t.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function matchesAny(text, list) {
    for (var i = 0; i < list.length; i++) {
      if (text.indexOf(list[i]) !== -1) return true;
    }
    return false;
  }

  // Pole poznamky je skryte za prepinacem "Zadat poznamku pro
  // prodejce". Pokud je vypnuty, zapneme ho, aby se dalo naplnit.
  function ensureNoteAvailable() {
    var toggle = document.querySelector(CONFIG.SELECTORS.noteToggle);
    if (toggle && !toggle.checked) {
      toggle.click();
      log('prepinac poznamky zapnut');
    }
    return document.querySelector(CONFIG.SELECTORS.note);
  }

  /* ================= DOSTUPNOST ================= */

  function pickRows(doc) {
    for (var i = 0; i < CONFIG.AVAIL.rowSelectors.length; i++) {
      var found = doc.querySelectorAll(CONFIG.AVAIL.rowSelectors[i]);
      if (found.length) {
        return { selector: CONFIG.AVAIL.rowSelectors[i], rows: [].slice.call(found) };
      }
    }
    return { selector: null, rows: [] };
  }

  function rowAvailabilityText(row) {
    var el = row.querySelector(CONFIG.AVAIL.textSelectors);
    if (el) {
      var attr = el.getAttribute && el.getAttribute('data-availability');
      return norm(attr || el.textContent);
    }
    var own = row.getAttribute && row.getAttribute('data-availability');
    return norm(own || '');
  }

  function classify(text) {
    if (!text) return 'unknown';
    if (matchesAny(text, CONFIG.AVAIL.OUT)) return 'out';
    if (matchesAny(text, CONFIG.AVAIL.IN)) return 'in';
    return 'unknown';
  }

  // Objednane mnozstvi z radku kosiku. Cte se i z atributu, protoze
  // radek muze prijit z dokumentu naparsovaneho DOMParserem.
  function rowQuantity(row) {
    var input = row.querySelector('input[name="amount"], input[data-testid="cartAmount"]');
    if (!input) return 1;
    var raw = input.value || input.getAttribute('value');
    var n = parseFloat(raw);
    return (isNaN(n) || n <= 0) ? 1 : n;
  }

  // Pocet kusu skladem z textu dostupnosti: "skladem (1 ks)" -> 1.
  // Vraci null, kdyz v textu zadny pocet neni.
  function stockCount(text) {
    if (!text) return null;
    var re = new RegExp(CONFIG.AVAIL.stockCountPattern, 'i');
    var m = String(text).match(re);
    if (!m) return null;
    var n = parseInt(m[1], 10);
    return isNaN(n) ? null : n;
  }

  // Je radek skladem jen castecne? Tzn. objednava se vic kusu,
  // nez je skladem. Vraci true / false / null (nevime).
  function isPartial(state, text, qty) {
    if (!CONFIG.AVAIL.PARTIAL_ENABLED) return false;
    if (state !== 'in') return false;
    if (qty <= 1) return false;

    var stock = stockCount(text);
    if (stock == null) return CONFIG.AVAIL.CHOICE_WHEN_COUNT_UNKNOWN ? null : false;
    return qty > stock;
  }

  function readCartDoc(doc) {
    var picked = pickRows(doc);
    var report = {
      selector: picked.selector, items: [],
      in: 0, out: 0, unknown: 0,
      partial: 0, partialUnknown: 0
    };

    picked.rows.forEach(function (row) {
      if (CONFIG.AVAIL.excludeSelectors && row.matches
          && row.matches(CONFIG.AVAIL.excludeSelectors)) return;
      if (CONFIG.AVAIL.productMarkers
          && !row.querySelector(CONFIG.AVAIL.productMarkers)) return;

      var nameEl = row.querySelector('.p-name, .main-link, a');
      var text = rowAvailabilityText(row);
      var state = classify(text);
      var qty = rowQuantity(row);
      var stock = stockCount(text);
      var partial = isPartial(state, text, qty);

      if (partial === true) report.partial++;
      else if (partial === null) report.partialUnknown++;

      report.items.push({
        nazev: nameEl ? norm(nameEl.textContent).slice(0, 60) : '(?)',
        dostupnost: text || '(nic nenalezeno)',
        stav: state,
        ks: qty,
        skladem: stock,
        castecne: partial
      });
      report[state]++;
    });

    return report;
  }

  function fetchCart() {
    var ctrl = window.AbortController ? new AbortController() : null;
    var opts = { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (ctrl) {
      opts.signal = ctrl.signal;
      setTimeout(function () { ctrl.abort(); }, CONFIG.AVAIL.timeoutMs);
    }

    return fetch(CONFIG.AVAIL.cartUrl, opts)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        return readCartDoc(doc);
      });
  }

  // Vysledek -> rozhodnuti. Cokoli nejasneho = zobraz volbu.
  function decide(report) {
    if (!report || !report.items.length) return { mode: MODE.CHOICE, reason: 'zadne polozky' };
    if (report.unknown > 0) return { mode: MODE.CHOICE, reason: 'neznamy stav dostupnosti' };

    // Jedna polozka, ktera je skladem jen castecne (3 ks objednane,
    // 1 ks skladem), staci sama - i kdyz je v kosiku jako jedina.
    // Cely radek je "Skladem", ale rozhodnout se musi stejne.
    if (report.partial > 0) {
      return { mode: MODE.CHOICE, reason: 'polozka skladem jen castecne' };
    }
    if (report.partialUnknown > 0) {
      return { mode: MODE.CHOICE, reason: 'vic kusu, pocet skladem neznamy' };
    }

    if (report.in > 0 && report.out > 0) return { mode: MODE.CHOICE, reason: 'mix skladem/neskladem' };
    if (report.out === 0) return { mode: MODE.SKIP, skip: 'allIn', reason: 'vse skladem' };
    return { mode: MODE.SKIP, skip: 'allOut', reason: 'nic neni skladem' };
  }

  /* ================= VZHLED ================= */

  function paintTiles() {
    var tiles = document.querySelectorAll('.' + CLS + '-tile');
    for (var i = 0; i < tiles.length; i++) {
      var active = tiles[i].getAttribute('data-id') === chosenId;
      tiles[i].style.background = active ? '#111' : '#fff';
      tiles[i].style.color = active ? '#fff' : '#111';
      tiles[i].style.borderColor = active ? '#111' : '#ccc';
      tiles[i].setAttribute('aria-checked', active ? 'true' : 'false');
    }
  }

  function paintInfo() {
    var panel = document.querySelector('.' + CLS + '-info');
    var btn = document.querySelector('.' + CLS + '-infobtn');
    if (panel) panel.style.display = infoOpen ? 'block' : 'none';
    if (btn) {
      btn.style.background = infoOpen ? '#111' : '#fff';
      btn.style.color = infoOpen ? '#fff' : '#666';
      btn.setAttribute('aria-expanded', infoOpen ? 'true' : 'false');
    }
  }

  function select(id) {
    chosenId = id;
    paintTiles();
    hideError();
    hideStandaloneNotice();
    log('vybrano', id);
  }

  // Hlaska mimo blok volby. Potrebujeme ji pro rezim PENDING, kdy
  // blok jeste NENI na strance (mount() bezi az v rezimu CHOICE).
  // v5.0 tady mela showError() podminenou existenci bloku, takze se
  // prvni klik na Objednat spolkl uplne bez hlasky a zakaznik cekal
  // az 6,5 s, aniz by se cokoli stalo.
  function showStandaloneNotice(message) {
    var btn = document.querySelector(CONFIG.SELECTORS.submit);
    if (!btn) return;

    var note = document.querySelector('.' + CLS + '-notice');
    if (!note) {
      note = document.createElement('div');
      note.className = CLS + '-notice';
      note.setAttribute('role', 'status');
      note.style.cssText = 'margin:0 0 10px;padding:8px 10px;background:#f5f5f5;'
        + 'border-left:3px solid #c00;font-size:12px;line-height:1.4;color:#333;';
      var anchor = btn.closest(CONFIG.SELECTORS.anchor) || btn.parentNode;
      anchor.parentNode.insertBefore(note, anchor);
    }
    note.textContent = message;
    note.style.display = 'block';
  }

  function hideStandaloneNotice() {
    var note = document.querySelector('.' + CLS + '-notice');
    if (note && note.parentNode) note.parentNode.removeChild(note);
  }

  function showError(message) {
    var err = document.querySelector('.' + CLS + '-err');
    var box = document.querySelector('.' + CLS);

    // Blok na strance neni (typicky rezim PENDING) - hlaska musi jit
    // i tak, jinak klik na Objednat vypada jako by se nic nestalo.
    if (!box) {
      showStandaloneNotice(message || CONFIG.ERROR);
      return;
    }

    if (err) {
      err.textContent = message || CONFIG.ERROR;
      err.style.display = 'block';
    }
    box.style.borderColor = '#c00';
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function hideError() {
    var err = document.querySelector('.' + CLS + '-err');
    var box = document.querySelector('.' + CLS);
    if (err) err.style.display = 'none';
    if (box) box.style.borderColor = 'transparent';
  }

  /* ================= SESTAVENI ================= */

  function buildHeading() {
    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;';

    var title = document.createElement('span');
    title.style.cssText = 'font-size:12px;font-weight:700;letter-spacing:.04em;'
      + 'text-transform:uppercase;color:#111;';
    title.textContent = CONFIG.HEADING + ' *';

    var btn = document.createElement('button');
    btn.type = 'button'; // zamerne - jinak by tlacitko odeslalo formular
    btn.className = CLS + '-infobtn';
    btn.textContent = 'i';
    btn.title = CONFIG.INFO_TITLE;
    btn.setAttribute('aria-expanded', 'false');
    btn.style.cssText = 'flex:0 0 auto;width:16px;height:16px;line-height:14px;padding:0;'
      + 'border:1px solid #999;border-radius:50%;background:#fff;color:#666;'
      + 'font-size:11px;font-weight:700;font-family:Georgia,serif;cursor:pointer;';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      infoOpen = !infoOpen;
      paintInfo();
    });

    head.appendChild(title);
    head.appendChild(btn);
    return head;
  }

  function buildInfoPanel() {
    var panel = document.createElement('div');
    panel.className = CLS + '-info';
    panel.style.cssText = 'display:none;margin-bottom:10px;padding:10px;background:#fff;'
      + 'border-left:3px solid #111;font-size:12px;line-height:1.45;color:#555;';

    CONFIG.OPTIONS.forEach(function (opt) {
      var row = document.createElement('div');
      row.style.cssText = 'margin-bottom:6px;';

      var name = document.createElement('strong');
      name.style.cssText = 'display:block;color:#111;font-weight:600;';
      name.textContent = opt.label;

      var text = document.createElement('span');
      text.textContent = opt.info;

      row.appendChild(name);
      row.appendChild(text);
      panel.appendChild(row);
    });

    return panel;
  }

  function build() {
    var wrap = document.createElement('div');
    wrap.className = CLS;
    wrap.setAttribute('role', 'radiogroup');
    wrap.style.cssText = 'margin:0 0 14px;padding:12px;'
      + 'border:2px solid transparent;background:#f5f5f5;';

    wrap.appendChild(buildHeading());
    wrap.appendChild(buildInfoPanel());

    CONFIG.OPTIONS.forEach(function (opt) {
      var tile = document.createElement('div');
      tile.className = CLS + '-tile';
      tile.setAttribute('data-id', opt.id);
      tile.setAttribute('role', 'radio');
      tile.setAttribute('aria-checked', 'false');
      tile.setAttribute('tabindex', '0');
      tile.style.cssText = 'border:1px solid #ccc;background:#fff;color:#111;'
        + 'padding:10px 12px;margin-bottom:6px;cursor:pointer;'
        + 'font-size:13px;line-height:1.3;'
        + 'transition:background .12s,color .12s,border-color .12s;';
      tile.textContent = opt.label;

      tile.addEventListener('click', function () { select(opt.id); });
      tile.addEventListener('keydown', function (e) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); select(opt.id); }
      });

      wrap.appendChild(tile);
    });

    var err = document.createElement('div');
    err.className = CLS + '-err';
    err.style.cssText = 'display:none;margin-top:6px;font-size:12px;'
      + 'color:#c00;font-weight:600;';
    err.textContent = CONFIG.ERROR;
    wrap.appendChild(err);

    return wrap;
  }

  /* ================= ZAPIS DO POZNAMKY ================= */

  function writeNoteText(payload) {
    if (!payload) return false;

    var note = ensureNoteAvailable();
    if (!note) { log('poznamka nenalezena'); return false; }

    var text = note.value || '';

    // odstran predchozi blok, pokud tam uz je
    var s = text.indexOf(CONFIG.MARK_START);
    var e = text.indexOf(CONFIG.MARK_END);
    if (s !== -1 && e !== -1 && e > s) {
      text = text.slice(0, s) + text.slice(e + CONFIG.MARK_END.length);
    }
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    var block = CONFIG.MARK_START + '\n' + payload + '\n' + CONFIG.MARK_END;
    note.value = text ? text + '\n\n' + block : block;

    note.dispatchEvent(new Event('input', { bubbles: true }));
    note.dispatchEvent(new Event('change', { bubbles: true }));

    log('zapsano do poznamky');
    return true;
  }

  /* ================= BLOKOVANI ODESLANI ================= */

  function guard(e) {
    // Vse skladem / nic skladem -> nic neblokujeme.
    if (mode === MODE.SKIP) {
      if (CONFIG.AVAIL.AUTO_NOTE && skipReason) {
        writeNoteText(CONFIG.AVAIL.AUTO_TEXTS[skipReason]);
      }
      log('odeslani propusteno - volba neni potreba (' + skipReason + ')');
      return;
    }

    // Jeste neznama dostupnost. Blokujeme jen kratce - po timeoutu
    // se stav prepne na CHOICE, takze se objednavka nezasekne.
    if (mode === MODE.PENDING) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      showError(CONFIG.PENDING_ERROR);
      log('odeslani zdrzeno - ceka se na dostupnost');
      return;
    }

    if (chosenId) {
      writeNoteText(getOption(chosenId).noteText);
      log('odeslani propusteno');
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    showError(CONFIG.ERROR);
    log('odeslani zablokovano - volba nevybrana');
  }

  function installGuard() {
    // Capture faze, abychom predbehli Shoptetovy handlery.
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest(CONFIG.SELECTORS.submit) : null;
      if (btn) guard(e);
    }, true);

    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (form && form.matches && form.matches(CONFIG.SELECTORS.form)) guard(e);
    }, true);
  }

  /* ================= VLOZENI ================= */

  function mount() {
    if (mode !== MODE.CHOICE) return false;
    if (document.querySelector('.' + CLS)) return true;

    var btn = document.querySelector(CONFIG.SELECTORS.submit);
    if (!btn) { log('tlacitko odeslani nenalezeno'); return false; }

    // Zamerne NE k poznamce - ta sekce je sbalena a blok by mel
    // nulovou vysku. Kotvime nad kontejner tlacitka.
    var anchor = btn.closest(CONFIG.SELECTORS.anchor) || btn.parentNode;
    anchor.parentNode.insertBefore(build(), anchor);

    // Obnov stav po prekresleni stranky
    paintTiles();
    paintInfo();

    log('vlozeno nad tlacitko');
    return true;
  }

  function unmount() {
    var box = document.querySelector('.' + CLS);
    if (box && box.parentNode) box.parentNode.removeChild(box);
  }

  /* ================= START ================= */

  function isFinalStep() {
    if (/\/objednavka\/krok-2\//.test(window.location.pathname)) return true;
    return !!document.querySelector(CONFIG.SELECTORS.submit)
        && !!document.querySelector(CONFIG.SELECTORS.note);
  }

  function setMode(next, reason, skip) {
    if (mode === next && skipReason === (skip || null)) return;
    mode = next;
    skipReason = skip || null;
    log('rezim:', mode, skipReason || '', '(' + (reason || '') + ')');

    // Dostupnost je rozhodnuta, hlaska "Zjistujeme dostupnost" uz
    // neplati - jinak by na strance zustala visnout.
    if (mode !== MODE.PENDING) hideStandaloneNotice();

    if (mode === MODE.CHOICE) mount();
    else unmount();
  }

  function resolveMode() {
    if (!CONFIG.AVAIL.ENABLED) {
      setMode(MODE.CHOICE, 'detekce vypnuta');
      return;
    }
    if (!window.fetch || !window.DOMParser) {
      setMode(MODE.CHOICE, 'prohlizec neumi fetch/DOMParser');
      return;
    }

    var settled = false;
    var fallback = setTimeout(function () {
      if (!settled) { settled = true; setMode(MODE.CHOICE, 'timeout detekce'); }
    }, CONFIG.AVAIL.timeoutMs + 500);

    fetchCart().then(function (report) {
      lastReport = report;
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      var d = decide(report);
      setMode(d.mode, d.reason, d.skip);
    }).catch(function (err) {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      setMode(MODE.CHOICE, 'chyba detekce: ' + (err && err.message));
    });
  }

  function init() {
    if (!isFinalStep()) { log('nejsme v poslednim kroku'); return; }

    installGuard();
    resolveMode();

    // Krok objednavky se prekresluje AJAXem (zmena adresy, validace).
    // Podminka na chybejici blok brani zacykleni observeru.
    var timer = null;
    var observer = new MutationObserver(function () {
      if (mode !== MODE.CHOICE) return;
      if (document.querySelector('.' + CLS)) return;
      if (!isFinalStep()) return;
      clearTimeout(timer);
      timer = setTimeout(mount, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ---------- ladici API pro konzoli ---------- */
  window.WB_EXPEDICE = {
    // Spustit na /kosik/ i na /objednavka/krok-2/:
    //   WB_EXPEDICE.inspect()
    inspect: function () {
      return fetchCart().then(function (report) {
        if (window.console) {
          console.log('[Expedice] radky ze selektoru:', report.selector);
          if (console.table) console.table(report.items);
          console.log('[Expedice] skladem:', report.in,
                      '| neskladem:', report.out,
                      '| nezname:', report.unknown);
          console.log('[Expedice] rozhodnuti:', decide(report));
        }
        return report;
      });
    },
    stav: function () {
      return { mode: mode, skipReason: skipReason, chosenId: chosenId, report: lastReport };
    },
    config: CONFIG
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* ============================================================
   POZNAMKY

   1) Kdy se volba zobrazi
      mix skladem + neskladem  -> ZOBRAZI
      polozka skladem jen
      castecne (3 ks obj.,
      1 ks skladem)            -> ZOBRAZI, i kdyz je v kosiku sama
      vic kusu, pocet skladem
      z textu neznamy          -> ZOBRAZI (bezpecna zaloha)
      vse skladem v plnem
      objednanem mnozstvi      -> skryje, odeslani projde
      nic neni skladem         -> skryje, odeslani projde
      neznamy/nejasny stav     -> ZOBRAZI (bezpecna zaloha)

   2) Proc se dostupnost cte z /kosik/
      Krok 2 seznam polozek s dostupnosti nezobrazuje, takze na
      strance neni z ceho cist. Fetch na /kosik/ s
      credentials:'include' vrati HTML kosiku prihlaseneho
      zakaznika, dostupnost se vytahne z radku tabulky.

   3) Zavod s casem pri odeslani
      Fetch bezi hned pri nacteni kroku 2, zakaznik pak jeste
      vyplnuje formular, takze v praxi je rozhodnuto davno pred
      kliknutim. Kdyby ne, prvni klik se zablokuje s hlaskou
      "Zjistujeme dostupnost..." a po timeoutu (6,5 s) se stav
      prepne na "zobrazit volbu". Objednavka se tedy nemuze
      zaseknout natrvalo.

   4) AUTO_NOTE
      Vychozi false. Kdyz klient bude chtit mit v poznamce
      informaci i u jednoznacnych objednavek (aby sklad nemusel
      dohledavat dostupnost), staci prepnout na true.

   5) Ikona "i" ma type="button"
      Bez toho by kliknuti na ni odeslalo formular objednavky.

   CO ZBYVA OVERIT
   a) castecna dostupnost naostro. Na /kosik/ dej u BEZEL KITu
      (8M0215696, skladem 1 ks) mnozstvi 3 a spust
      WB_EXPEDICE.inspect(). V items ma byt castecne:true a
      rozhodnuti "polozka skladem jen castecne".
      Zaroven zkontroluj, ze regulark stockCountPattern trefi text
      dostupnosti i u jinych produktu (napr. "Skladem (>5 ks)").
   b) na male testovaci objednavce:
      - ze tlacitko bez vybrane volby objednavku NEODESLE
      - ze se text v poznamce objevi AZ ZA textem zakaznika
      - ze Shoptet odesle obsah poznamky i kdyz byla sekce sbalena
        a prepinac zapnul az script.
        textarea#remark neni disabled (jen visibility:hidden), takze
        by to projit melo, ale potvrdit to jde jen odeslanim.
   ============================================================ */
