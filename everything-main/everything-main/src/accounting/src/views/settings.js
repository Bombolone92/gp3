/** Settings: company, preferences, closing the books, appearance, and data. */
import { el, download, pickFile, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { field, textInput, textArea, selectInput, dateInput, checkbox, segmented } from '../ui/fields.js';
import { toast, toastError } from '../ui/toast.js';
import { confirmDialog, promptDialog } from '../ui/dialog.js';
import { applyTheme, currentTheme } from '../ui/theme.js';
import { pageHead, tabs, viewState, pageDraft, clearDraft } from './page.js';
import { store } from '../lib/store.js';
import { sdk } from '../lib/puter.js';
import { exportBackup, restoreBackup, validateBackup, eraseAll } from '../lib/backup.js';
import { loadSample, sampleConflicts } from '../lib/sample.js';
import { monthName, today, formatDate } from '../lib/dates.js';
import { formatMoney } from '../lib/money.js';

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'INR', 'SGD', 'HKD', 'ZAR', 'MXN', 'BRL'];

function section(title, desc, ...children) {
  return el('section.settings-section', {}, el('div.settings-section-head', {}, el('h2', {}, title), desc ? el('p.field-hint', {}, desc) : null), el('div.settings-section-body', {}, children));
}

export function renderSettings(main, route) {
  const st = viewState('settings', { tab: 'company' });
  const s = store.settings;
  const save = (patch, msg = 'Saved') => { try { store.saveSettings(patch); toast(msg); return true; } catch (e) { toastError(e); return false; } };
  const rerender = () => renderSettings(main, route);

  let body;
  if (st.tab === 'company') {
    const c = pageDraft(route, 'company', () => {
      const draft = structuredClone(s.company || {});
      draft.address = draft.address || {};
      return draft;
    });
    const bind = (obj, key, opts = {}) => { const i = textInput({ value: obj[key] || '', type: opts.type || 'text', autocomplete: opts.ac || 'off' }); i.addEventListener('input', () => { obj[key] = i.value; }); return i; };
    body = el('form.stack', { onsubmit: (e) => { e.preventDefault(); if (save({ company: c }, 'Company details saved')) clearDraft(route, 'company'); document.dispatchEvent(new CustomEvent('company:changed')); } },
      section('Company name', 'Shown on invoices, reports, and the top bar.',
        el('div.form-grid', {}, field('Company name', bind(c, 'name', { ac: 'organization' }), { required: true }), field('Legal name', bind(c, 'legalName')), field('Business ID or tax ID', bind(c, 'taxId')))),
      section('Contact info', null,
        el('div.form-grid', {}, field('Company email', bind(c, 'email', { type: 'email', ac: 'email' })), field('Company phone', bind(c, 'phone', { type: 'tel', ac: 'tel' })), field('Website', bind(c, 'website', { type: 'url', ac: 'url' })))),
      section('Address', null,
        el('div.form-grid', {}, field('Street address', bind(c.address, 'line1', { ac: 'address-line1' }), { className: 'span-2' }), field('City', bind(c.address, 'city')), field('State or region', bind(c.address, 'state')), field('ZIP or postal code', bind(c.address, 'zip')), field('Country', bind(c.address, 'country')))),
      el('div', {}, el('button.btn.btn-primary', { type: 'submit' }, 'Save company details')));
  } else if (st.tab === 'prefs') {
    const terms = selectInput({ options: (s.terms || []).map((t) => [t.id, t.name]), value: s.defaultTerms, ariaLabel: 'Default terms', onChange: (v) => save({ defaultTerms: v }) });
    const currency = selectInput({ options: CURRENCIES.map((c) => [c, c]), value: s.currency, ariaLabel: 'Home currency', onChange: (v) => save({ currency: v }, 'Currency changed') });
    const dateStyle = selectInput({ options: [['mdy', 'MM/DD/YYYY'], ['dmy', 'DD/MM/YYYY'], ['ymd', 'YYYY-MM-DD']], value: s.dateStyle, ariaLabel: 'Date format', onChange: (v) => save({ dateStyle: v }, 'Date format changed') });
    const fy = selectInput({ options: Array.from({ length: 12 }, (_, i) => [String(i + 1), monthName(i + 1)]), value: String(s.fiscalStartMonth), ariaLabel: 'First month of fiscal year', onChange: (v) => save({ fiscalStartMonth: +v }) });
    const method = segmented({ options: [['accrual', 'Accrual'], ['cash', 'Cash']], value: s.accountingMethod, ariaLabel: 'Accounting method for reports', onChange: (v) => save({ accountingMethod: v }) });
    const start = textInput({ value: String(s.invoiceStart || 1001), inputMode: 'numeric' });
    start.addEventListener('change', () => save({ invoiceStart: Math.max(1, parseInt(start.value, 10) || 1001) }));
    const msg = textArea({ value: s.invoiceMessage || '', rows: 2 });
    msg.addEventListener('change', () => save({ invoiceMessage: msg.value }));
    body = el('div.stack', {},
      section('Sales', 'Defaults for new invoices and estimates.',
        el('div.form-grid', {}, field('Default terms', terms), field('First invoice number', start, { hint: 'Used until you have invoices; then numbers continue from the highest.' }), field('Default message on invoices', msg, { className: 'span-2' })),
        checkbox({ checked: !!s.paymentsToUndeposited, label: 'Hold received payments in Undeposited Funds, to combine several into one deposit', onChange: (v) => save({ paymentsToUndeposited: v }) })),
      section('Accounting', null,
        el('div.form-grid', {}, field('First month of fiscal year', fy), field('Accounting method for reports', method)),
        checkbox({ checked: s.showAccountNumbers !== false, label: 'Show account numbers', onChange: (v) => save({ showAccountNumbers: v }) })),
      section('Currency and formats', 'Amounts are recorded in one home currency.',
        el('div.form-grid', {}, field('Home currency', currency), field('Date format', dateStyle))),
      section('Payment terms', 'Terms set the due date from the invoice or bill date.', termsEditor(rerender)));
  } else if (st.tab === 'close') {
    const close = pageDraft(route, 'closeDate', () => ({ value: s.closeDate }));
    const date = dateInput({ value: close.value, ariaLabel: 'Closing date', onChange: (v) => { close.value = v; } });
    body = el('div.stack', {},
      section('Close the books', 'Prevent changes to transactions on or before a date, for example after filing taxes or sending statements to your accountant.',
        el('div.form-grid', {}, field('Closing date', date)),
        el('div.row', {},
          el('button.btn.btn-primary', { type: 'button', onclick: () => { if (save({ closeDate: date.value || null }, date.value ? `Books closed through ${formatDate(date.value)}` : 'Books reopened')) clearDraft(route, 'closeDate'); } }, 'Save closing date'),
          s.closeDate ? el('button.btn', { type: 'button', onclick: () => { if (save({ closeDate: null }, 'Books reopened')) clearDraft(route, 'closeDate'); } }, 'Reopen the books') : null),
        s.closeDate ? el('p.banner.banner-info', {}, el('span', { html: icon('lock', 18) }), `Transactions dated on or before ${formatDate(s.closeDate)} cannot be added, changed, or deleted.`) : null));
  } else if (st.tab === 'look') {
    const theme = segmented({ options: [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], value: currentTheme(), ariaLabel: 'Theme', onChange: (v) => { applyTheme(v); save({ theme: v }, 'Theme changed'); } });
    body = el('div.stack', {}, section('Theme', 'System follows your device setting.', theme.root));
  } else {
    const stats = store.stats();
    body = el('div.stack', {},
      section('Back up your books', 'A complete copy of your company in one JSON file.',
        el('div.row', { style: { flexWrap: 'wrap' } },
          el('button.btn', { type: 'button', onclick: () => download(JSON.stringify(exportBackup(store), null, 1), `books-backup-${today()}.json`, 'application/json') }, el('span', { html: icon('download', 16) }), 'Download backup'),
          el('button.btn', { type: 'button', onclick: async () => {
            try {
              const path = `backups/books-backup-${today()}-${Date.now()}.json`;
              await sdk().fs.write(path, JSON.stringify(exportBackup(store)), { createMissingParents: true });
              toast('Backup saved to your Puter drive');
            } catch (e) { toastError(`Could not save: ${e.message || e}`); }
          } }, el('span', { html: icon('cloud', 16) }), 'Save backup to Puter'),
          el('button.btn', { type: 'button', onclick: restore }, el('span', { html: icon('upload', 16) }), 'Restore from backup'))),
      section('Sample company', 'Fill the books with nine months of a sample design studio, to explore every screen.',
        el('button.btn', { type: 'button', onclick: async () => {
          const clashes = sampleConflicts(store);
          if (clashes.length) {
            toastError(clashes.length > 3 ? 'The sample data is already in your books.' : `The sample data could not be added: ${clashes.join(', ')} ${clashes.length === 1 ? 'is' : 'are'} already in your books.`);
            return;
          }
          if (store.txns.size && !(await confirmDialog({ title: 'Add sample data?', message: 'Sample customers, vendors, and transactions are added next to your own records.', confirmLabel: 'Add sample data' }))) return;
          try {
            loadSample(store);
            toast('Sample company loaded');
          } catch (e) { toastError(e); }
        } }, 'Load sample data')),
      section('Erase everything', 'Delete all accounts, contacts, transactions, and settings. Download a backup first.',
        el('button.btn.btn-danger', { type: 'button', onclick: async () => {
          const typed = await promptDialog({ title: 'Erase all data?', label: 'Type ERASE to confirm. This cannot be undone.', confirmLabel: 'Erase' });
          if (typed !== 'ERASE') { if (typed !== null) toast('Nothing was erased.'); return; }
          eraseAll(store);
          store.saveSettings({ onboarded: false });
          toast('All data erased');
          location.reload();
        } }, 'Erase all data')),
      section('About these books', null,
        el('dl.keyval', {},
          el('dt', {}, 'Accounts'), el('dd', {}, String(stats.accounts)),
          el('dt', {}, 'Contacts'), el('dd', {}, String(stats.contacts)),
          el('dt', {}, 'Transactions'), el('dd', {}, String(stats.txns)),
          el('dt', {}, 'Ledger postings'), el('dd', {}, String(stats.postings)),
          el('dt', {}, 'Ledger balance check'), el('dd', {}, stats.imbalance === 0 ? 'Debits equal credits' : `Out of balance by ${formatMoney(stats.imbalance)}`),
          el('dt', {}, 'Storage'), el('dd', {}, 'Your own Puter account. ', el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Powered by Puter')))));
  }

  swap(main, el('div.page.settings', {},
    pageHead({ title: 'Settings', crumbs: [['Settings']] }),
    tabs([['company', 'Company'], ['prefs', 'Preferences'], ['close', 'Closing date'], ['look', 'Appearance'], ['data', 'Data']], st.tab, (k) => { st.tab = k; rerender(); main.querySelector('.tab[aria-selected="true"]')?.focus(); }, { label: 'Settings sections' }),
    body));
}

function termsEditor(rerender) {
  const list = el('ul.terms-list');
  for (const t of store.settings.terms || []) {
    list.append(el('li', {}, el('span.grow', {}, t.name), el('span.muted', {}, `${t.days} days`),
      ['due', 'net15', 'net30', 'net60'].includes(t.id) ? null : el('button.icon-btn', { type: 'button', 'aria-label': `Remove ${t.name}`, html: icon('x', 15), onclick: () => { store.saveSettings({ terms: store.settings.terms.filter((x) => x.id !== t.id) }); rerender(); } })));
  }
  const add = el('button.btn.btn-sm', { type: 'button', onclick: async () => {
    const days = await promptDialog({ title: 'New payment terms', label: 'Due in how many days?', placeholder: '45' });
    const n = parseInt(days, 10);
    if (!Number.isFinite(n) || n < 0) return;
    store.saveSettings({ terms: [...store.settings.terms, { id: `net${n}`, name: n === 0 ? 'Due on receipt' : `Net ${n}`, days: n }].filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i) });
    rerender();
  } }, 'Add terms');
  return el('div.stack', {}, list, el('div', {}, add));
}

async function restore() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
    validateBackup(data);
  } catch (e) {
    toastError(e instanceof SyntaxError ? 'This file is not valid JSON.' : e.message);
    return;
  }
  const n = Object.values(data.collections || {}).reduce((a, l) => a + l.length, 0);
  const ok = await confirmDialog({ title: 'Replace your books with this backup?', message: `Everything currently in your books is replaced by the backup from ${data.exportedAt?.slice(0, 10) || 'an unknown date'} (${n} records).`, confirmLabel: 'Restore', danger: true });
  if (!ok) return;
  try {
    restoreBackup(store, data);
    toast('Backup restored');
  } catch (e) { toastError(e); }
}
