/** CSV import of customers, vendors, and products/services: pick, map, preview, import. */
import { el, append, clear, pickFile } from '../ui/dom.js';
import { openDialog } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { store } from '../lib/store.js';
import { parseCSV } from '../lib/csv.js';
import { parseMoney } from '../lib/money.js';

const FIELDS = {
  customers: [['displayName', 'Display name', ['display name', 'name', 'customer', 'full name']], ['company', 'Company', ['company', 'company name', 'business']], ['firstName', 'First name', ['first name', 'first']], ['lastName', 'Last name', ['last name', 'last', 'surname']], ['email', 'Email', ['email', 'e-mail']], ['phone', 'Phone', ['phone', 'telephone']], ['line1', 'Street', ['street', 'address', 'address line 1', 'billing address']], ['city', 'City', ['city', 'town']], ['state', 'State', ['state', 'province', 'region']], ['zip', 'ZIP', ['zip', 'postal code', 'postcode', 'zip code']], ['country', 'Country', ['country']], ['notes', 'Notes', ['notes', 'note', 'memo']]],
  items: [['name', 'Name', ['name', 'product', 'service', 'item', 'product/service']], ['sku', 'SKU', ['sku', 'code']], ['desc', 'Description', ['description', 'sales description']], ['price', 'Price', ['price', 'rate', 'sales price', 'unit price']], ['cost', 'Cost', ['cost', 'purchase cost']], ['kind', 'Type', ['type', 'item type']]],
};
FIELDS.vendors = FIELDS.customers;

export async function openImport(what) {
  const file = await pickFile('.csv,text/csv');
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toastError('That file is larger than 5 MB.'); return; }
  const rows = parseCSV(await file.text());
  if (rows.length < 2) { toastError('The file has no rows to import.'); return; }
  const headers = rows[0];
  const fields = FIELDS[what];
  const mapping = {};
  for (const [key, , guesses] of fields) {
    const i = headers.findIndex((h) => guesses.includes(h.toLowerCase().trim()));
    mapping[key] = i;
  }
  const selects = fields.map(([key, label]) => {
    const s = el('select.select', { 'aria-label': `Column for ${label}` },
      el('option', { value: '-1' }, 'Do not import'),
      headers.map((h, i) => el('option', { value: String(i), selected: mapping[key] === i }, h || `Column ${i + 1}`)));
    s.addEventListener('change', () => { mapping[key] = +s.value; preview(); });
    return el('div.field', {}, el('label.field-label', {}, label), s);
  });
  const previewBox = el('div');
  const plan = () => {
    const out = [];
    const skipped = [];
    const seen = new Set();
    const get = (r, k) => (mapping[k] >= 0 ? (r[mapping[k]] || '').trim() : '');
    rows.slice(1).forEach((r, idx) => {
      if (what === 'items') {
        const name = get(r, 'name');
        if (!name) { skipped.push(`Row ${idx + 2}: no name`); return; }
        if (seen.has(name.toLowerCase()) || store.itemsList({ includeInactive: true }).some((i) => i.name.toLowerCase() === name.toLowerCase())) { skipped.push(`Row ${idx + 2}: ${name} already exists`); return; }
        seen.add(name.toLowerCase());
        const kindText = get(r, 'kind').toLowerCase();
        out.push({ name, sku: get(r, 'sku'), desc: get(r, 'desc'), price: Math.abs(parseMoney(get(r, 'price'))), cost: Math.abs(parseMoney(get(r, 'cost'))), kind: kindText.includes('non') || kindText.includes('product') ? 'nonInventory' : 'service', incomeAccountId: store.roleAccount('sales'), sold: true, purchased: !!get(r, 'cost') });
      } else {
        const name = get(r, 'displayName') || get(r, 'company') || [get(r, 'firstName'), get(r, 'lastName')].filter(Boolean).join(' ');
        if (!name) { skipped.push(`Row ${idx + 2}: no name`); return; }
        const kind = what === 'vendors' ? 'vendor' : 'customer';
        if (seen.has(name.toLowerCase()) || store.contactsOf(kind, { includeInactive: true }).some((c) => c.displayName.toLowerCase() === name.toLowerCase())) { skipped.push(`Row ${idx + 2}: ${name} already exists`); return; }
        seen.add(name.toLowerCase());
        out.push({ kind, displayName: name, company: get(r, 'company'), firstName: get(r, 'firstName'), lastName: get(r, 'lastName'), email: get(r, 'email'), phone: get(r, 'phone'), notes: get(r, 'notes'), billAddr: { line1: get(r, 'line1'), city: get(r, 'city'), state: get(r, 'state'), zip: get(r, 'zip'), country: get(r, 'country') }, terms: store.settings.defaultTerms });
      }
    });
    return { out, skipped };
  };
  function preview() {
    const { out, skipped } = plan();
    append(clear(previewBox), [
      el('p', { role: 'status' }, `${out.length} will be imported${skipped.length ? `, ${skipped.length} skipped` : ''}.`),
      skipped.length ? el('details', {}, el('summary', {}, 'Skipped rows'), el('ul', {}, skipped.slice(0, 50).map((s) => el('li', {}, s)))) : null,
      out.length ? el('div.table-wrap', { style: { marginTop: '10px' } }, el('table.grid', {},
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Name'), el('th', { scope: 'col' }, what === 'items' ? 'Price' : 'Email'))),
        el('tbody', {}, out.slice(0, 8).map((x) => el('tr', {}, el('td', {}, x.displayName || x.name), el('td', {}, what === 'items' ? (x.price / 100).toFixed(2) : x.email || '')))))) : null]);
  }
  preview();
  const label = what === 'items' ? 'products and services' : what;
  const dlg = openDialog({
    title: `Import ${label}`,
    wide: true,
    body: el('div.stack', {}, el('p.field-hint', {}, `${file.name}: ${rows.length - 1} rows. Match your columns to the fields.`), el('div.form-grid', {}, selects), previewBox),
    footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, 'Cancel'), el('button.btn.btn-primary', {
      type: 'button',
      onclick: () => {
        const { out } = plan();
        if (!out.length) { toastError('Nothing to import.'); return; }
        store.batch(({ put }) => { for (const rec of out) put(what === 'items' ? 'items' : 'contacts', { active: true, ...rec }); });
        toast(`Imported ${out.length} ${label}`);
        dlg.close();
      },
    }, 'Import')),
  });
}
