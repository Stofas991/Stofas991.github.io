/* ============================================================
   Wavy Boats - puvodni kod na DETAILU PRODUKTU
   ------------------------------------------------------------
   Autor: Krystof Glos / glos-optimalizace.cz
   Verze: 1.0

   Presune hodnotu popisneho parametru "Puvodni kod" z bloku
   .detail-parameters k aktualnimu kodu v .p-code. Cte se primo
   z DOM - zadna zavislost na ceny.json, zadny fetch.

   OVERENO NAOSTRO (20. 8. 2026, dealerwb.cz, /adaptor-37/, kod 815303T)
   - .p-code je <span class="p-code"> uvnitr .p-detail-inner-header,
     display:inline-block. Vlastni box proto MUSI byt display:block,
     jinak nezalomi na novy radek.
   - stranka ma VIC nez jeden .detail-parameters blok (u ADAPTOR dva -
     prvni prazdny, druhy s Kategorie/EAN/Puvodni kod). Kod prochazi
     VSECHNY, ne jen "druhy", protoze poradi neni zaruceno pravidlo,
     jen pozorovani na jednom produktu.
   - radek parametru:
     <tr>
       <th><span class="row-header-label">Puvodni kod<span class="row-header-label-colon">:</span></span></th>
       <td>815303</td>
     </tr>
     Nazev radku se cte z .row-header-label (obsahuje i dvojtecku
     jako vnoreny span - odstranit regexem, ne spolehat na presny
     text).

   Vlozeni: Vzhled a obsah -> Editor -> HTML kody -> paticka
   (muze byt soucasne s wavy-rrp-detail.js a wavy-rrp-kosik.js)
   ============================================================ */

(function () {
  'use strict';

  var CONFIG = {
    PARAM_NAME: 'Původní kód',
    LABEL: 'Původní kód:',
    PARAMETERS_SELECTOR: '.detail-parameters',
    CODE_ANCHOR_SELECTOR: '.p-code',

    // Stranka prekresluje kod/cenu AJAXem po zmene varianty (viz
    // wavy-rrp-detail.js) - kdyby se stejnym zpusobem prekreslovaly
    // i popisne parametry, tento debounce zachyti i to.
    WATCH_CHANGES: true,
    debounceMs: 200,

    DEBUG: false
  };

  var CSS_CLASS = 'wb-original-code';

  // Rozsah kombinujicich diakritickych znamenek (U+0300-U+036F) po NFD
  // normalizaci - sestaveno z kodu bodu, aby se v editoru/rendereru
  // neobjevil literalni kombinujici znak (snadny zdroj tichych chyb).
  var DIACRITICS_RE = new RegExp('[' + String.fromCharCode(0x0300) + '-'
    + String.fromCharCode(0x036f) + ']', 'g');

  function log() {
    if (CONFIG.DEBUG && window.console) {
      console.log.apply(console, ['[original-code detail]'].concat([].slice.call(arguments)));
    }
  }

  // male pismena, bez diakritiky, bez zdvojenych mezer
  function norm(s) {
    var t = (s === null || s === undefined) ? '' : String(s);
    if (t.normalize) t = t.normalize('NFD').replace(DIACRITICS_RE, '');
    return t.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  var PARAM_NAME_NORM = norm(CONFIG.PARAM_NAME);

  // Nazev radku vcetne vnorene dvojtecky (.row-header-label-colon) -
  // ta se odstrani regexem, ne spolehanim na presny text.
  function rowLabel(row) {
    var labelEl = row.querySelector('th .row-header-label, th');
    if (!labelEl) return '';
    return labelEl.textContent.replace(/:\s*$/, '').trim();
  }

  // Vraci { value, row } prvniho nalezeneho radku, nebo null. Vraceny
  // <tr> se v update() skryje - "presunout", ne "zobrazit navic" (viz
  // OVERENO): stejna hodnota by jinak byla videt dvakrat krok od kroku
  // pod sebou (u nasi vzorku navic potretí v .p-short-description, ale
  // to je samostatny, klientem rucne zapsany text - tam se nesaha).
  function findOriginalCodeRow() {
    var tables = document.querySelectorAll(CONFIG.PARAMETERS_SELECTOR);
    for (var t = 0; t < tables.length; t++) {
      var rows = tables[t].querySelectorAll('tr');
      for (var r = 0; r < rows.length; r++) {
        if (norm(rowLabel(rows[r])) !== PARAM_NAME_NORM) continue;
        var td = rows[r].querySelector('td');
        var value = td ? td.textContent.trim() : '';
        if (value) return { value: value, row: rows[r] };
      }
    }
    return null;
  }

  function removeBox() {
    var box = document.querySelector('.' + CSS_CLASS);
    if (box && box.parentNode) box.parentNode.removeChild(box);
  }

  function render(value) {
    var anchor = document.querySelector(CONFIG.CODE_ANCHOR_SELECTOR);
    if (!anchor) { log('.p-code nenalezen'); return; }

    var box = document.createElement('span');
    box.className = CSS_CLASS;
    // display:block je nutne - .p-code je inline-block, bez tohoto
    // by nas text splynul na stejny radek.
    box.style.cssText = 'display:block;margin-top:4px;font-size:14px;line-height:1.4;';

    var label = document.createElement('span');
    label.className = CSS_CLASS + '-label';
    label.textContent = CONFIG.LABEL + ' ';
    label.style.cssText = 'color:#777;';

    var valueEl = document.createElement('span');
    valueEl.textContent = value;

    box.appendChild(label);
    box.appendChild(valueEl);
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
  }

  var lastRendered = null;
  var hiddenRow = null;

  function unhideRow() {
    if (hiddenRow) { hiddenRow.style.display = ''; hiddenRow = null; }
  }

  function update() {
    var hit = findOriginalCodeRow();

    if (!hit) {
      unhideRow();
      if (lastRendered !== null) { removeBox(); lastRendered = null; }
      return;
    }

    if (hit.value === lastRendered && document.querySelector('.' + CSS_CLASS)) {
      // Shoptet muze radek prekreslit (novy uzel se stejnym obsahem) -
      // pojistka, aby skryty zustal ten aktualni, ne odstraneny stary.
      if (hiddenRow !== hit.row) { unhideRow(); hit.row.style.display = 'none'; hiddenRow = hit.row; }
      return;
    }

    unhideRow();
    hit.row.style.display = 'none';
    hiddenRow = hit.row;

    removeBox();
    render(hit.value);
    lastRendered = hit.value;
    log('vykresleno', hit.value);
  }

  function watchChanges() {
    if (!CONFIG.WATCH_CHANGES) return;

    var timer = null;
    function ping(reason) {
      clearTimeout(timer);
      timer = setTimeout(function () {
        log('prekresleni:', reason);
        update();
      }, CONFIG.debounceMs);
    }

    var targets = [];
    document.querySelectorAll(CONFIG.PARAMETERS_SELECTOR).forEach(function (t) { targets.push(t); });
    var anchor = document.querySelector(CONFIG.CODE_ANCHOR_SELECTOR);
    if (anchor) targets.push(anchor.parentNode || anchor);

    if (targets.length && window.MutationObserver) {
      var obs = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var t = records[i].target;
          if (t.closest && t.closest('.' + CSS_CLASS)) continue; // ignoruj vlastni box
          ping('dom');
          return;
        }
      });
      targets.forEach(function (t) {
        obs.observe(t, { childList: true, subtree: true, characterData: true });
      });
    }
  }

  function init() {
    if (!document.querySelector('.p-detail, .p-detail-inner-header')) return;
    update();
    watchChanges();
  }

  window.WB_ORIGINAL_CODE = {
    debug: function () {
      var hit = findOriginalCodeRow();
      var out = { nalezenaHodnota: hit ? hit.value : null, vypsano: lastRendered, skrytyRadek: !!hiddenRow };
      if (window.console) console.log('[original-code detail] diagnostika:', out);
      return out;
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
