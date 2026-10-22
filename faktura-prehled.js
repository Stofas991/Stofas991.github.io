// Záložka Přehled: příjmy po měsících, klienti a daňový souhrn. Počítá se živě z faktur; koncepty se nepočítají.
const VAT_LIMIT = 2000000; // obratový limit pro povinnou registraci k DPH za kalendářní rok (od 2025)
const MONTHS = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];
const MONTHS_LONG = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];

let overviewRows = [];
let overviewYear = null;

const compactMoney = value => new Intl.NumberFormat('cs-CZ', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const percent = value => new Intl.NumberFormat('cs-CZ', { style: 'percent', maximumFractionDigits: 0 }).format(value);
const paidIso = invoice => invoice.paid_at ? new Date(invoice.paid_at).toLocaleDateString('sv-SE') : null;
const yearOf = iso => iso ? Number(iso.slice(0, 4)) : null;
const daysBetween = (fromIso, toIso) => Math.round((new Date(toIso + 'T12:00:00') - new Date(fromIso + 'T12:00:00')) / 86400000);

async function openOverview() {
  overviewRows = (await db.listInvoices()).filter(invoice => invoice.status !== 'draft');
  const years = new Set([new Date().getFullYear()]);
  overviewRows.forEach(invoice => { years.add(yearOf(invoice.issued)); years.add(yearOf(paidIso(invoice))); });
  const sorted = [...years].filter(Boolean).sort((a, b) => b - a);
  if (!sorted.includes(overviewYear)) overviewYear = sorted[0];
  $('overviewYear').innerHTML = sorted.map(year => `<option value="${year}"${year === overviewYear ? ' selected' : ''}>${year}</option>`).join('');
  renderOverview();
  showView('overview');
}

$('overviewYear').addEventListener('change', event => { overviewYear = Number(event.target.value); renderOverview(); });

function renderOverview() {
  const year = overviewYear;
  const issuedIn = y => overviewRows.filter(invoice => yearOf(invoice.issued) === y);
  const paidIn = y => overviewRows.filter(invoice => invoice.status === 'paid' && yearOf(paidIso(invoice)) === y);
  const amount = invoice => sumItems(invoice.invoice_items);
  const total = list => list.reduce((sum, invoice) => sum + amount(invoice), 0);

  const issued = issuedIn(year);
  const paid = paidIn(year);
  const waiting = issued.filter(invoice => invoice.status !== 'paid');
  const invoicedTotal = total(issued);

  $('overviewStats').innerHTML = [
    ['Vyfakturováno', total(issued), `${issued.length} ${plural(issued.length, 'faktura', 'faktury', 'faktur')}`],
    ['Zaplaceno', total(paid), `podle data úhrady v roce ${year}`],
    ['Čeká na zaplacení', total(waiting), waiting.length ? `${waiting.length} ${plural(waiting.length, 'faktura', 'faktury', 'faktur')} z roku ${year}` : 'vše zaplaceno']
  ].map(([label, value, meta]) => `<div class="stat-tile"><span class="stat-label">${label}</span><strong class="stat-value">${formatMoney(value)}</strong><span class="stat-meta">${meta}</span></div>`).join('');

  const byMonth = (list, dateOf) => {
    const months = Array(12).fill(0);
    list.forEach(invoice => { months[Number(dateOf(invoice).slice(5, 7)) - 1] += amount(invoice); });
    return months;
  };
  renderIncomeChart({
    invoiced: byMonth(issued, invoice => invoice.issued),
    paid: byMonth(paid, paidIso),
    previous: byMonth(issuedIn(year - 1), invoice => invoice.issued)
  }, year);

  renderClients(issued, invoicedTotal);
  renderTax(total(paid), year);
}

function plural(count, one, few, many) {
  return count === 1 ? one : count >= 2 && count <= 4 ? few : many;
}

// Krok osy jako „hezké“ číslo (1, 2, 5 × 10^n), aby popisky byly kulaté (0, 10 tis., 20 tis.).
function niceStep(value) {
  if (value <= 0) return 1000;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 5, 10].map(step => step * power).find(candidate => candidate >= value);
}

function renderIncomeChart(series, year) {
  const hasPrevious = series.previous.some(Boolean);
  const peak = Math.max(...series.invoiced, ...series.paid, ...(hasPrevious ? series.previous : [0]));
  if (!peak) {
    $('incomeChart').innerHTML = `<p class="empty-note">V roce ${year} zatím nejsou žádné odeslané ani zaplacené faktury.</p>`;
    return;
  }
  const step = niceStep(peak / 4);
  const max = Math.ceil(peak / step) * step;
  const height = value => `${(value / max) * 100}%`;
  const ticks = Array.from({ length: max / step + 1 }, (_, index) => index * step);

  const legend = `<div class="chart-legend">
      <span><i class="key key-bar series-1"></i>Vyfakturováno</span>
      <span><i class="key key-bar series-2"></i>Zaplaceno</span>
      ${hasPrevious ? `<span><i class="key key-tick"></i>Vyfakturováno ${year - 1}</span>` : ''}
    </div>`;

  const columns = MONTHS.map((month, index) => `<div class="month-col" data-month="${index}" tabindex="0" aria-label="${MONTHS_LONG[index]}">
      <div class="month-bars">
        <span class="bar series-1" style="height:${height(series.invoiced[index])}"></span>
        <span class="bar series-2" style="height:${height(series.paid[index])}"></span>
        ${hasPrevious && series.previous[index] ? `<span class="prev-tick" style="bottom:${height(series.previous[index])}"></span>` : ''}
      </div>
      <span class="month-label">${month}</span>
    </div>`).join('');

  const table = `<details class="chart-table"><summary>Zobrazit jako tabulku</summary>
      <table class="data-table"><thead><tr><th>Měsíc</th><th class="num">Vyfakturováno</th><th class="num">Zaplaceno</th>${hasPrevious ? `<th class="num">${year - 1}</th>` : ''}</tr></thead>
      <tbody>${MONTHS_LONG.map((month, index) => `<tr><td>${month}</td><td class="num">${formatMoney(series.invoiced[index])}</td><td class="num">${formatMoney(series.paid[index])}</td>${hasPrevious ? `<td class="num">${formatMoney(series.previous[index])}</td>` : ''}</tr>`).join('')}</tbody></table>
    </details>`;

  $('incomeChart').innerHTML = `${legend}
    <div class="chart">
      <div class="chart-axis">${ticks.map(tick => `<span style="bottom:${height(tick)}">${tick ? compactMoney(tick) : '0'}</span>`).join('')}</div>
      <div class="chart-plot">
        <div class="grid-area">${ticks.map(tick => `<span class="gridline" style="bottom:${height(tick)}"></span>`).join('')}</div>
        <div class="month-row">${columns}</div>
        <div class="chart-tip" hidden></div>
      </div>
    </div>${table}`;

  const plot = $('incomeChart').querySelector('.chart-plot');
  const tip = plot.querySelector('.chart-tip');
  const show = column => {
    const index = Number(column.dataset.month);
    tip.innerHTML = `<strong>${MONTHS_LONG[index]} ${year}</strong>
      <span><i class="key key-bar series-1"></i>Vyfakturováno <b>${formatMoney(series.invoiced[index])}</b></span>
      <span><i class="key key-bar series-2"></i>Zaplaceno <b>${formatMoney(series.paid[index])}</b></span>
      ${hasPrevious ? `<span><i class="key key-tick"></i>${year - 1} <b>${formatMoney(series.previous[index])}</b></span>` : ''}`;
    tip.hidden = false;
    plot.querySelectorAll('.month-col').forEach(other => other.classList.toggle('active', other === column));
    const plotBox = plot.getBoundingClientRect();
    const colBox = column.getBoundingClientRect();
    // Popisek vedle sloupce (vpravo, u konce roku vlevo), aby nezakrýval data, na která ukazuje.
    const right = colBox.right - plotBox.left + 6;
    const left = right + tip.offsetWidth <= plotBox.width ? right : colBox.left - plotBox.left - tip.offsetWidth - 6;
    tip.style.left = `${Math.max(left, 0)}px`;
  };
  const hide = () => { tip.hidden = true; plot.querySelectorAll('.month-col.active').forEach(column => column.classList.remove('active')); };
  plot.querySelectorAll('.month-col').forEach(column => {
    column.addEventListener('pointerenter', () => show(column));
    column.addEventListener('focus', () => show(column));
    column.addEventListener('click', () => show(column)); // dotyk na mobilu
  });
  plot.addEventListener('pointerleave', hide);
  plot.addEventListener('focusout', event => { if (!plot.contains(event.relatedTarget)) hide(); });
}

function renderClients(issued, invoicedTotal) {
  const groups = new Map();
  issued.forEach(invoice => {
    const key = invoice.customer_id || 'name:' + (invoice.customer_snapshot?.name || '—');
    const group = groups.get(key) || { name: invoice.customer_snapshot?.name || '—', total: 0, count: 0, payDays: [] };
    group.total += sumItems(invoice.invoice_items);
    group.count += 1;
    const paidOn = invoice.status === 'paid' ? paidIso(invoice) : null;
    if (paidOn && invoice.issued) group.payDays.push(Math.max(0, daysBetween(invoice.issued, paidOn)));
    groups.set(key, group);
  });
  const list = [...groups.values()].sort((a, b) => b.total - a.total);
  if (!list.length) { $('clientList').innerHTML = '<p class="empty-note">Žádné faktury v tomto roce.</p>'; return; }
  const top = list[0].total || 1;
  $('clientList').innerHTML = list.map(client => {
    const avg = client.payDays.length ? Math.round(client.payDays.reduce((a, b) => a + b, 0) / client.payDays.length) : null;
    const share = invoicedTotal ? client.total / invoicedTotal : 0;
    return `<div class="client-row">
        <div class="client-head"><strong>${escapeHtml(client.name)}</strong><span class="client-value">${formatMoney(client.total)} <span class="muted">· ${percent(share)}</span></span></div>
        <div class="client-track"><span class="client-bar" style="width:${Math.max((client.total / top) * 100, 1)}%"></span></div>
        <div class="client-meta">${client.count} ${plural(client.count, 'faktura', 'faktury', 'faktur')} · ${avg === null ? 'zatím nic nezaplaceno' : `platí v průměru za ${avg} ${plural(avg, 'den', 'dny', 'dní')}`}</div>
      </div>`;
  }).join('');
}

function renderTax(paidTotal, year) {
  const ratio = paidTotal / VAT_LIMIT;
  const [state, label] = ratio >= 1 ? ['critical', '⚠ Limit překročen'] : ratio >= 0.75 ? ['warning', '⚠ Blížíš se limitu'] : ['good', '✓ Pod limitem'];
  $('taxSummary').innerHTML = `
    <span class="stat-label">Příjmy ${year} podle data úhrady</span>
    <strong class="tax-value">${formatMoney(paidTotal)}</strong>
    <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="${VAT_LIMIT}" aria-valuenow="${paidTotal}" aria-label="Příjmy vůči limitu pro DPH">
      <span class="meter-fill ${state}" style="width:${Math.min(ratio, 1) * 100}%"></span>
    </div>
    <div class="meter-legend"><span class="meter-state ${state}">${label}</span><span>${percent(ratio)} z ${formatMoney(VAT_LIMIT)}</span></div>
    <p class="tax-row">${ratio < 1 ? `Do limitu zbývá <strong>${formatMoney(VAT_LIMIT - paidTotal)}</strong>.` : `Limit je překročen o <strong>${formatMoney(paidTotal - VAT_LIMIT)}</strong>. Ozvi se účetní kvůli registraci k DPH.`}</p>
    <p class="muted small">Orientačně: limit pro povinnou registraci k DPH je ${formatMoney(VAT_LIMIT)} obratu za kalendářní rok. Počítají se zaplacené faktury s datem úhrady v roce ${year}; přesný obrat ověř s účetní.</p>`;
}
