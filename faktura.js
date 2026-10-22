const LEGACY_KEY = 'glos-faktura-data';
const VIEWS = ['list', 'customers', 'settings', 'editor'];
const $ = id => document.getElementById(id);
const form = $('invoiceForm');
const itemsElement = $('items');
const preview = $('invoicePreview');
const savedStatus = $('savedStatus');
const noticeElement = $('notice');

let data = null; // faktura otevřená v editoru (plochý tvar z invoiceToForm)
let profile = null;
let customers = [];
let userId = null;
let saveTimer = null;
let saving = Promise.resolve();
let noticeTimer = null;

const formatMoney = value => new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 }).format(value) + ' Kč';
const formatDate = value => value ? new Intl.DateTimeFormat('cs-CZ').format(new Date(value + 'T12:00:00')) : '—';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const todayIso = () => new Date().toLocaleDateString('sv-SE');
const sumItems = items => items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.price), 0);

function notify(message, isError = false) {
  clearTimeout(noticeTimer);
  noticeElement.textContent = message;
  noticeElement.classList.toggle('error', isError);
  noticeElement.hidden = false;
  if (!isError) noticeTimer = setTimeout(() => { noticeElement.hidden = true; }, 6000);
}

async function run(task) {
  try { return await task(); } catch (error) { notify(error.message || String(error), true); }
}

function showView(name) {
  VIEWS.forEach(view => { $(view + 'View').hidden = view !== name; });
  document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === (name === 'editor' ? 'list' : name)));
}

/* ---------- přihlášení ---------- */

function showAuth() {
  userId = null;
  $('appViews').hidden = true;
  $('authView').hidden = false;
}

async function enterApp(session) {
  if (userId === session.user.id) return; // TOKEN_REFRESHED apod. nesmí vyhodit uživatele z editoru
  userId = session.user.id;
  $('authView').hidden = true;
  $('appViews').hidden = false;
  await run(async () => {
    [profile, customers] = await Promise.all([db.getProfile(), db.listCustomers()]);
    if (profile) await openList();
    else { fillSettingsForm(); showView('settings'); notify('Nejdřív vyplň údaje dodavatele, předvyplní se do faktur.'); }
  });
}

$('authForm').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => { await db.signIn(new FormData(event.target).get('email')); notify('Přihlašovací odkaz je na cestě, zkontroluj e-mail.'); });
});

$('signOutButton').addEventListener('click', () => run(async () => { await flushSave(); await db.signOut(); }));

/* ---------- seznam faktur ---------- */

function statusInfo(invoice) {
  if (invoice.status === 'paid') return ['paid', 'Zaplaceno'];
  if (invoice.due && invoice.due < todayIso()) return ['overdue', 'Po splatnosti'];
  return invoice.status === 'sent' ? ['sent', 'Odeslaná'] : ['draft', 'Koncept'];
}

async function openList() {
  showView('list');
  $('legacyBanner').hidden = !readLegacy();
  renderInvoiceList(await db.listInvoices());
}

function renderInvoiceList(rows) {
  const body = rows.map(invoice => {
    const [cls, label] = statusInfo(invoice);
    return `<tr data-id="${invoice.id}"><td><strong>${escapeHtml(invoice.number)}</strong></td><td>${escapeHtml(invoice.customer_snapshot?.name || '—')}</td><td>${formatDate(invoice.issued)}</td><td>${formatDate(invoice.due)}</td><td class="num">${formatMoney(sumItems(invoice.invoice_items))}</td><td><span class="badge ${cls}">${label}</span></td>
      <td><div class="row-actions"><button type="button" data-action="open">Otevřít</button>${invoice.status === 'paid' ? '' : '<button type="button" data-action="paid">Zaplaceno</button>'}<button type="button" data-action="duplicate">Duplikovat</button></div></td></tr>`;
  }).join('');
  $('invoiceTable').innerHTML = rows.length
    ? `<thead><tr><th>Číslo</th><th>Odběratel</th><th>Vystaveno</th><th>Splatnost</th><th class="num">Částka</th><th>Stav</th><th></th></tr></thead><tbody>${body}</tbody>`
    : '<tbody><tr><td class="empty">Zatím žádné faktury. Začni tlačítkem „Nová faktura“.</td></tr></tbody>';
}

$('invoiceTable').addEventListener('click', event => {
  const action = event.target.dataset.action;
  if (!action) return;
  const id = event.target.closest('tr').dataset.id;
  run(async () => {
    if (action === 'open') await openInvoice(id);
    if (action === 'paid') { const invoice = await db.getInvoice(id); invoice.status = 'paid'; await db.saveInvoice(invoice); await openList(); notify(`Faktura ${invoice.number} je označená jako zaplacená.`); }
    if (action === 'duplicate') await duplicateInvoice(id);
  });
});

$('newInvoiceButton').addEventListener('click', () => run(async () => openInvoice(await db.createInvoice())));

async function duplicateInvoice(sourceId) {
  const source = await db.getInvoice(sourceId);
  const id = await db.createInvoice();
  const fresh = await db.getInvoice(id);
  const supplier = Object.fromEntries(Object.keys(supplierToForm()).map(key => [key, fresh[key]]));
  await db.saveInvoice({ ...source, ...supplier, id, number: fresh.number, symbol: fresh.symbol, issued: fresh.issued, due: fresh.due, status: 'draft' });
  await openInvoice(id);
  notify(`Vytvořena kopie jako faktura ${fresh.number}.`);
}

/* ---------- editor ---------- */

async function openInvoice(id) {
  data = await db.getInvoice(id);
  if (!data.items.length) data.items.push({ description: '', details: '', quantity: 1, price: 0 });
  showView('editor');
  renderCustomerSelect();
  renderForm();
  renderPreview();
  savedStatus.textContent = 'Uloženo';
}

function renderCustomerSelect() {
  $('customerSelect').innerHTML = '<option value="">— zadat ručně —</option>' + customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

function renderForm() {
  Object.entries(data).forEach(([key, value]) => {
    if (key === 'items') return;
    const input = form.elements[key];
    if (!input) return;
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
  });
  itemsElement.innerHTML = data.items.map((item, index) => `<div class="item-row" data-index="${index}">
    <div class="item-main"><label>Položka<input data-field="description" value="${escapeHtml(item.description)}" required></label><label>Popis<textarea data-field="details" rows="2">${escapeHtml(item.details)}</textarea></label></div>
    <label>Množství<input data-field="quantity" type="number" min="0" step="0.01" value="${item.quantity}"></label>
    <label>Cena za kus<input data-field="price" type="number" step="0.01" value="${item.price}"></label>
    <button class="remove-item" type="button" aria-label="Odebrat položku">×</button>
  </div>`).join('');
}

function collectData() {
  const values = Object.fromEntries([...form.elements].filter(input => input.name).map(input => [input.name, input.type === 'checkbox' ? input.checked : input.value]));
  values.id = data.id;
  values.items = [...itemsElement.querySelectorAll('.item-row')].map(row => ({
    description: row.querySelector('[data-field="description"]').value,
    details: row.querySelector('[data-field="details"]').value,
    quantity: Number(row.querySelector('[data-field="quantity"]').value) || 0,
    price: Number(row.querySelector('[data-field="price"]').value) || 0
  }));
  return values;
}

function persist() {
  saveTimer = null;
  const snapshot = data;
  saving = saving.then(() => db.saveInvoice(snapshot))
    .then(() => { if (!saveTimer) savedStatus.textContent = 'Uloženo'; })
    .catch(error => { savedStatus.textContent = 'Neuloženo'; notify('Uložení se nezdařilo: ' + error.message, true); });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  savedStatus.textContent = 'Ukládám…';
  saveTimer = setTimeout(persist, 700);
}

async function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); persist(); }
  await saving;
}

function saveAndRender() {
  data = collectData();
  renderPreview();
  scheduleSave();
}

function renderPreview() {
  const subtotal = sumItems(data.items);
  $('deleteButton').hidden = data.status !== 'draft';
  const rows = data.items.map(item => `<tr><td><strong>${escapeHtml(item.description)}</strong>${item.details ? `<small>${escapeHtml(item.details)}</small>` : ''}</td><td>${formatMoney(item.quantity * item.price)}</td></tr>`).join('');
  preview.innerHTML = `<header class="invoice-head"><div><h2>Faktura</h2><p>č. ${escapeHtml(data.number)}</p></div><div class="document-type">Daňový doklad<br>${data.vatPayer ? 'Plátce DPH' : 'Neplátce DPH'}</div></header>
    <div class="parties"><div><h3>Dodavatel</h3><strong>${escapeHtml(data.supplierName)}</strong><div>${escapeHtml(data.supplierAddress)}</div><div>${escapeHtml(data.supplierCity)}</div><br><div>IČO: ${escapeHtml(data.supplierId)}</div>${data.supplierVat ? `<div>DIČ: ${escapeHtml(data.supplierVat)}</div>` : '<div>Neplátce DPH</div>'}<br><div>Č. účtu: ${escapeHtml(data.account)}</div><div>${escapeHtml(data.supplierEmail)}</div><div>${escapeHtml(data.website)}</div></div>
    <div><h3>Odběratel</h3><strong>${escapeHtml(data.customerName)}</strong><div>${escapeHtml(data.customerAddress)}</div><div>${escapeHtml(data.customerCity)}</div><br><div>IČO: ${escapeHtml(data.customerId)}</div>${data.customerVat ? `<div>DIČ: ${escapeHtml(data.customerVat)}</div>` : ''}<br><div>${escapeHtml(data.customerEmail)}</div></div></div>
    <div class="dates"><div><small>Datum vystavení</small>${formatDate(data.issued)}</div><div><small>Datum splatnosti</small>${formatDate(data.due)}</div><div><small>Způsob úhrady</small>${escapeHtml(data.payment)}</div><div><small>Variabilní symbol</small>${escapeHtml(data.symbol)}</div></div>
    <table class="invoice-items"><thead><tr><th>Položka</th><th>Celkem</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="total"><div><span>Mezisoučet</span><strong>${formatMoney(subtotal)}</strong></div><div class="grand-total"><span>K úhradě</span><strong>${formatMoney(subtotal)}</strong></div></div>
    <div class="vat-note">${data.vatPayer ? 'DPH bude vyčísleno dle platné sazby.' : 'Nejsem plátce DPH. Fakturovaná částka je konečná.'}</div>${data.note ? `<div class="invoice-note">${escapeHtml(data.note)}</div>` : ''}<footer>Fyzická osoba zapsaná v živnostenském rejstříku.</footer>`;
}

form.addEventListener('input', event => {
  if (event.target.name === 'customerRef') {
    const customer = customers.find(c => c.id === event.target.value);
    if (customer) {
      data = collectData();
      Object.assign(data, customerToForm({ name: customer.name, address: customer.address, city: customer.city, id: customer.ico, vat: customer.dic, email: customer.email }));
      renderForm();
    }
  }
  saveAndRender();
});
itemsElement.addEventListener('click', event => {
  if (!event.target.classList.contains('remove-item')) return;
  data = collectData();
  data.items.splice(Number(event.target.closest('.item-row').dataset.index), 1);
  renderForm();
  saveAndRender();
});
$('addItemButton').addEventListener('click', () => {
  data = collectData();
  data.items.push({ description: '', details: '', quantity: 1, price: 0 });
  renderForm();
  saveAndRender();
  itemsElement.lastElementChild.querySelector('input').focus();
});
$('printButton').addEventListener('click', downloadPdf);

// Přímé stažení PDF: náhled se vykreslí mimo obrazovku na pevnou šířku A4, takže nezáleží na velikosti okna (mobil).
async function downloadPdf() {
  if (typeof html2pdf === 'undefined') { window.print(); return; }
  const button = $('printButton');
  const label = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Generuji PDF…';
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff';
  const paper = preview.cloneNode(true);
  paper.removeAttribute('id');
  paper.style.cssText = 'width:794px;max-width:none;min-height:0;margin:0;box-shadow:none';
  host.appendChild(paper);
  document.body.appendChild(host);
  try {
    await html2pdf().set({
      margin: 0,
      filename: `faktura-${String(data.number).replace(/[^\w.-]+/g, '_')}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, windowWidth: 794 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.total', '.vat-note', 'footer'] }
    }).from(paper).save();
  } catch (error) {
    notify('PDF se nepodařilo vytvořit: ' + error.message, true);
  } finally {
    host.remove();
    button.disabled = false;
    button.innerHTML = label;
  }
}
$('backButton').addEventListener('click', () => run(async () => { await flushSave(); await openList(); }));
$('deleteButton').addEventListener('click', () => run(async () => {
  if (!confirm(`Opravdu smazat koncept ${data.number}? Číslo se znovu nepoužije.`)) return;
  clearTimeout(saveTimer); saveTimer = null;
  await saving;
  await db.deleteInvoice(data.id);
  await openList();
}));

/* ---------- odběratelé ---------- */

function renderCustomers() {
  $('customerTable').innerHTML = customers.length
    ? `<thead><tr><th>Název</th><th>IČO</th><th></th></tr></thead><tbody>${customers.map(c => `<tr data-id="${c.id}"><td><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(c.city)}</small></td><td>${escapeHtml(c.ico)}</td><td><div class="row-actions"><button type="button" data-action="edit">Upravit</button><button type="button" class="danger" data-action="delete">Smazat</button></div></td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="empty">Adresář je prázdný.</td></tr></tbody>';
}

function fillCustomerForm(customer) {
  const f = $('customerForm').elements;
  ['id', 'name', 'address', 'city', 'ico', 'dic', 'email'].forEach(key => { f[key].value = customer?.[key] ?? ''; });
  $('customerFormTitle').textContent = customer ? 'Upravit odběratele' : 'Nový odběratel';
}

async function openCustomers() {
  customers = await db.listCustomers();
  renderCustomers();
  fillCustomerForm(null);
  showView('customers');
}

$('customerForm').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const values = Object.fromEntries(new FormData(event.target));
    if (!values.id) delete values.id;
    await db.saveCustomer(values);
    await openCustomers();
    notify('Odběratel uložen.');
  });
});
$('customerResetButton').addEventListener('click', () => fillCustomerForm(null));
$('customerTable').addEventListener('click', event => {
  const action = event.target.dataset.action;
  if (!action) return;
  const customer = customers.find(c => c.id === event.target.closest('tr').dataset.id);
  if (action === 'edit') fillCustomerForm(customer);
  if (action === 'delete' && confirm(`Smazat odběratele ${customer.name}? Vystavené faktury zůstanou beze změny.`)) run(async () => { await db.deleteCustomer(customer.id); await openCustomers(); });
});

/* ---------- dodavatel ---------- */

function fillSettingsForm() {
  const f = $('settingsForm').elements;
  const p = profile || { payment: 'Bankovním převodem', due_days: 14, vat_payer: false };
  ['name', 'address', 'city', 'ico', 'dic', 'account', 'email', 'website', 'payment', 'due_days'].forEach(key => { f[key].value = p[key] ?? ''; });
  f.vat_payer.checked = !!p.vat_payer;
}

$('settingsForm').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const f = event.target.elements;
    const next = Object.fromEntries(['name', 'address', 'city', 'ico', 'dic', 'account', 'email', 'website', 'payment'].map(key => [key, f[key].value]));
    next.due_days = Number(f.due_days.value) || 0;
    next.vat_payer = f.vat_payer.checked;
    await db.saveProfile(next);
    const firstSave = !profile;
    profile = next;
    notify('Údaje dodavatele uloženy.');
    if (firstSave) await openList();
  });
});

/* ---------- import ze starého generátoru ---------- */

function readLegacy() {
  try { return JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); } catch { return null; }
}

$('importLegacyButton').addEventListener('click', () => run(async () => {
  const legacy = readLegacy();
  if (!legacy) return openList();
  if (!profile) {
    profile = { name: legacy.supplierName, address: legacy.supplierAddress, city: legacy.supplierCity, ico: legacy.supplierId, dic: legacy.supplierVat, account: legacy.account, email: legacy.supplierEmail, website: legacy.website, payment: legacy.payment || 'Bankovním převodem', due_days: 14, vat_payer: !!legacy.vatPayer };
    await db.saveProfile(profile);
  }
  let customer = customers.find(c => c.ico && c.ico === legacy.customerId);
  if (!customer) {
    customer = await db.saveCustomer({ name: legacy.customerName, address: legacy.customerAddress, city: legacy.customerCity, ico: legacy.customerId, dic: legacy.customerVat, email: legacy.customerEmail });
    customers = await db.listCustomers();
  }
  const id = await db.createInvoice();
  try {
    await db.saveInvoice({ ...legacy, id, customerRef: customer.id, status: 'draft' });
  } catch (error) {
    await db.deleteInvoice(id);
    throw error;
  }
  localStorage.removeItem(LEGACY_KEY);
  await openList();
  notify('Stará faktura je v databázi.');
}));

/* ---------- navigace a start ---------- */

document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => run(async () => {
  await flushSave();
  if (button.dataset.tab === 'list') await openList();
  if (button.dataset.tab === 'customers') await openCustomers();
  if (button.dataset.tab === 'settings') { fillSettingsForm(); showView('settings'); }
})));

window.addEventListener('beforeunload', event => { if (saveTimer) event.preventDefault(); });

if (!sb) {
  $('setupView').hidden = false;
} else {
  // Dotazy do DB se z callbacku odkládají, jinak by se klient zasekl na vlastním zámku session.
  sb.auth.onAuthStateChange((event, session) => setTimeout(() => (session ? enterApp(session) : showAuth()), 0));
}
