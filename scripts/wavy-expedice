/* ============================================================
   Wavy Boats - volba delene expedice (povinna, krok 2)
   ------------------------------------------------------------
   Autor: Krystof Glos / glos-optimalizace.cz
   Verze: 4.0
   Stav:  vykresleni overeno naostro na
          www.dealerwb.cz/objednavka/krok-2/

   Co to dela:
   1) Nad tlacitko "Objednat s povinnosti platby" prida povinnou
      volbu zpusobu expedice. Nic neni predvybrane.
   2) Bez vybrane volby nelze objednavku dokoncit.
   3) Zvolena varianta se zapise do poznamky AZ PRI ODESLANI,
      za text, ktery si tam napsal zakaznik.

   Nahrazuje soucasny rucni postup, kdy je zakaznik na homepage
   vyzvan, aby si zpusob odeslani sam napsal do poznamky.

   ZMENY PROTI VERZI 3.0
   - u nadpisu je ikona "i", ktera rozbali vysvetleni obou variant.
     Zavreny blok ma 142 px (stejne jako v3), rozbaleny 289 px,
     takze vychozi stav zustava cisty.

   OVERENE SELEKTORY (17. 8. 2026)
   krok:      /objednavka/krok-2/
   poznamka:  textarea#remark  (name="remark")  <- NE "note"!
   prepinac:  input#add-note   ("Zadat poznamku pro prodejce")
   tlacitko:  button#submit-order
   ukotveni:  div.next-step    (pravy sloupec col-md-4, ~413 px)
   formular:  form#order-form  (action .../Step2Validate/)

   Vlozeni: Vzhled a obsah -> Editor -> HTML kody -> paticka
   ============================================================ */

(function () {
  'use strict';

  /* ================= KONFIGURACE ================= */
  var CONFIG = {
    HEADING: 'Způsob expedice',
    ERROR: 'Vyberte způsob expedice.',
    INFO_TITLE: 'Co která možnost znamená',

    OPTIONS: [
      {
        id: 'ihned',
        label: 'Odeslat ihned, co je skladem',
        // Vysvetleni mluvi o praktickem dusledku, ne o procesu -
        // dealera zajima, kolik zasilek mu prijde.
        info: 'Co máme skladem, odešleme hned. Zbytek doobjednáme a pošleme samostatně po naskladnění. Zásilky tedy budou dvě.',
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

    // Ohraniceni bloku v poznamce. Diky nemu se pri opakovanem
    // odeslani (napr. po chybe validace) blok PREPISE, ne prilepi.
    MARK_START: '--- expedice ---',
    MARK_END: '--- konec expedice ---',

    DEBUG: false
  };

  var CLS = 'wb-expedice';
  var chosenId = null;
  var infoOpen = false;

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
    log('vybrano', id);
  }

  function showError() {
    var err = document.querySelector('.' + CLS + '-err');
    var box = document.querySelector('.' + CLS);
    if (err) err.style.display = 'block';
    if (box) {
      box.style.borderColor = '#c00';
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
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

  function writeNote() {
    var option = getOption(chosenId);
    if (!option) return false;

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

    var block = CONFIG.MARK_START + '\n' + option.noteText + '\n' + CONFIG.MARK_END;
    note.value = text ? text + '\n\n' + block : block;

    note.dispatchEvent(new Event('input', { bubbles: true }));
    note.dispatchEvent(new Event('change', { bubbles: true }));

    log('zapsano do poznamky:', option.id);
    return true;
  }

  /* ================= BLOKOVANI ODESLANI ================= */

  function guard(e) {
    if (chosenId) {
      writeNote();
      log('odeslani propusteno');
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    showError();
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

  /* ================= START ================= */

  function isFinalStep() {
    if (/\/objednavka\/krok-2\//.test(window.location.pathname)) return true;
    return !!document.querySelector(CONFIG.SELECTORS.submit)
        && !!document.querySelector(CONFIG.SELECTORS.note);
  }

  function init() {
    if (!isFinalStep()) { log('nejsme v poslednim kroku'); return; }

    mount();
    installGuard();

    // Krok objednavky se prekresluje AJAXem (zmena adresy, validace).
    // Podminka na chybejici blok brani zacykleni observeru.
    var timer = null;
    var observer = new MutationObserver(function () {
      if (document.querySelector('.' + CLS)) return;
      if (!isFinalStep()) return;
      clearTimeout(timer);
      timer = setTimeout(mount, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* ============================================================
   POZNAMKY

   1) Volba se nabizi VZDY.
      Overeno 17. 8. 2026: v kosiku bylo 32 polozek a vsech 32
      melo stav "Momentalne nedostupne". Klient potvrdil jediny
      stav dostupnosti a moznost vse doobjednat, takze podminka
      "cast objednavky neni skladem" je splnena vzdy.
      Kdyby pribyl jiny stav dostupnosti, lze doplnit detekci
      pres .p-availability v kosiku a volbu prenaset mezi kroky.

   2) Proc neni volba u poznamky
      Sekce s poznamkou je sbalena za prepinacem "Zadat poznamku
      pro prodejce". Vlozeny blok tam mel nulovou vysku, takze
      nebyl videt, i kdyz script probehl bez chyby. Nad tlacitkem
      "Objednat" ma 142 px a je videt vzdy.

   3) Ikona "i" ma type="button"
      Bez toho by kliknuti na ni odeslalo formular objednavky.

   4) Opakovane odeslani
      Blok v poznamce je ohraniceny znackami, takze se pri druhem
      odeslani prepise a neobjevi se dvakrat.

   CO ZBYVA OVERIT ODESLANIM SKUTECNE OBJEDNAVKY
   Tohle uz nelze otestovat bez vytvoreni realne objednavky:
   - ze tlacitko bez vybrane volby objednavku NEODESLE
   - ze se text v poznamce objevi AZ ZA textem zakaznika
   - ze Shoptet odesle obsah poznamky i kdyz byla sekce sbalena
     a prepinac zapnul az script  <- nejrizikovejsi bod
     Zaloha, kdyby to nefungovalo: zapisovat hodnotu do skryteho
     pole formulare misto do textarey.
   Doporucuji zkusit na male testovaci objednavce.
   ============================================================ */
