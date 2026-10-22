// Vrstva nad Supabase. URL a anon klíč jsou veřejné záměrně, data chrání přihlášení a RLS (supabase/schema.sql).
const SUPABASE_URL = 'https://xbtoxmfwzvesfdpiussf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_FIpFHwUtkDH6hxGJcqve4w_-Buem216';

const sb = SUPABASE_URL.includes('YOUR-PROJECT') ? null : supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const unwrap = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

const supplierToForm = (s = {}) => ({ supplierName: s.name || '', supplierAddress: s.address || '', supplierCity: s.city || '', supplierId: s.id || '', supplierVat: s.vat || '', account: s.account || '', supplierEmail: s.email || '', website: s.website || '' });
const customerToForm = (c = {}) => ({ customerName: c.name || '', customerAddress: c.address || '', customerCity: c.city || '', customerId: c.id || '', customerVat: c.vat || '', customerEmail: c.email || '' });

// Řádek z DB (s vnořenými invoice_items) -> plochý objekt, se kterým pracuje formulář a náhled.
function invoiceToForm(row) {
  return {
    id: row.id, number: row.number, issued: row.issued || '', due: row.due || '', payment: row.payment, symbol: row.symbol,
    status: row.status, paidDate: row.paid_at ? new Date(row.paid_at).toLocaleDateString('sv-SE') : '',
    note: row.note, vatPayer: row.vat_payer, customerRef: row.customer_id || '',
    ...supplierToForm(row.supplier_snapshot), ...customerToForm(row.customer_snapshot),
    items: [...(row.invoice_items || [])].sort((a, b) => a.position - b.position)
      .map(i => ({ description: i.description, details: i.details, quantity: Number(i.quantity), price: Number(i.price) }))
  };
}

function formToInvoice(d) {
  return {
    id: d.id, number: d.number, customer_id: d.customerRef || '', issued: d.issued, due: d.due, payment: d.payment, symbol: d.symbol,
    status: d.status, note: d.note, vat_payer: d.vatPayer,
    supplier_snapshot: { name: d.supplierName, address: d.supplierAddress, city: d.supplierCity, id: d.supplierId, vat: d.supplierVat, account: d.account, email: d.supplierEmail, website: d.website },
    customer_snapshot: { name: d.customerName, address: d.customerAddress, city: d.customerCity, id: d.customerId, vat: d.customerVat, email: d.customerEmail },
    items: d.items
  };
}

const db = {
  getSession: async () => unwrap(await sb.auth.getSession()).session,
  signIn: async email => unwrap(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } })),
  signOut: async () => unwrap(await sb.auth.signOut()),

  getProfile: async () => unwrap(await sb.from('supplier_profile').select('*').eq('id', 1).maybeSingle()),
  saveProfile: async p => unwrap(await sb.from('supplier_profile').upsert({ ...p, id: 1 })),

  listCustomers: async () => unwrap(await sb.from('customers').select('*').order('name')),
  saveCustomer: async c => unwrap(await sb.from('customers').upsert(c).select().single()),
  deleteCustomer: async id => unwrap(await sb.from('customers').delete().eq('id', id)),

  listInvoices: async () => unwrap(await sb.from('invoices').select('id,number,issued,due,status,paid_at,customer_id,customer_snapshot,invoice_items(quantity,price)').order('number', { ascending: false })),
  getInvoice: async id => invoiceToForm(unwrap(await sb.from('invoices').select('*, invoice_items(*)').eq('id', id).single())),
  createInvoice: async () => unwrap(await sb.rpc('create_invoice')),
  saveInvoice: async d => {
    unwrap(await sb.rpc('save_invoice', { p: formToInvoice(d) }));
    // save_invoice dá při zaplacení „teď“; skutečné datum úhrady (např. u starších faktur) se přepíše zvlášť.
    if (d.status === 'paid' && d.paidDate) unwrap(await sb.from('invoices').update({ paid_at: new Date(d.paidDate + 'T12:00:00').toISOString() }).eq('id', d.id));
  },
  deleteInvoice: async id => unwrap(await sb.from('invoices').delete().eq('id', id))
};
