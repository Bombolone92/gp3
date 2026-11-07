/** Recurring transactions, sales tax, and the audit log. */
import { el, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { dataTable } from '../ui/table.js';
import { amountNode, dateText } from '../ui/format.js';
import { toast } from '../ui/toast.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { field, textInput, moneyInput } from '../ui/fields.js';
import { openMenu } from '../ui/menu.js';
import { navigate } from '../ui/router.js';
import { pageHead, emptyState, viewState, tabs } from './page.js';
import { store } from '../lib/store.js';
import { TXN_TYPES, typeLabel, txnTotal } from '../lib/txn.js';
import { describeSchedule, dueDates } from '../lib/recurring.js';
import { formatMoney } from '../lib/money.js';
import { today, periodRange, formatRange } from '../lib/dates.js';
import { salesTaxLiability } from '../lib/reports.js';
import { openRecurringForm } from '../forms/recurring.js';
import { openTxnForm, openTxn } from '../forms/index.js';
import { createFromTemplate, runRecurring } from '../lib/recurring-run.js';

// --------------------------------------------------------------- recurring

export function renderRecurring(main) {
  const rows = [...store.recurring.values()].sort((a, b) => (a.nextDate || '').localeCompare(b.nextDate || ''));
  const now = today();
  const columns = [
    { key: 'name', label: 'Template name', primary: true, render: (r) => el('span.cell-main', {}, r.name), sortable: false },
    { key: 'type', label: 'Type', render: (r) => typeLabel(r.type), sortable: false },
    { key: 'mode', label: 'How it runs', hideMobile: true, render: (r) => (r.mode === 'reminder' ? 'Reminder' : 'Scheduled'), sortable: false },
    { key: 'interval', label: 'Interval', hideMobile: true, render: (r) => describeSchedule(r), sortable: false },
    { key: 'prev', label: 'Previous date', hideMobile: true, render: (r) => dateText(r.lastCreated), sortable: false },
    { key: 'next', label: 'Next date', render: (r) => (r.active === false ? el('span.badge', {}, 'Paused') : el('span', {}, dateText(r.nextDate), dueDates(r, now, 1).length ? el('span.badge.badge-warning', { style: { marginLeft: '8px' } }, 'Due') : null)), sortable: false },
    { key: 'name2', label: 'Customer or vendor', hideMobile: true, render: (r) => store.contactName(r.template?.contactId), sortable: false },
    { key: 'amount', label: 'Amount', align: 'right', amount: true, render: (r) => amountNode(txnTotal(r.template || {}, store.ctx())), sortable: false },
    {
      key: 'action', label: 'Action', srLabel: 'Action', className: 'actions-cell', sortable: false,
      render: (r) => {
        const b = el('button.btn.btn-sm', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, 'Use', el('span', { html: icon('chevDown', 14) }));
        b.addEventListener('click', () => openMenu(b, [
          { label: 'Use now', icon: 'plus', onClick: () => openTxnForm({ type: r.type, draft: { ...structuredClone(r.template), date: today() } }) },
          { label: 'Create on schedule now', icon: 'repeat', disabled: !dueDates(r, now, 1).length, onClick: () => { const n = runRecurring(store, { only: r.id, includeReminders: true }); toast(`${n} created`); } },
          { label: 'Edit schedule', icon: 'pencil', onClick: () => openRecurringForm({ rule: r }) },
          { label: r.active === false ? 'Resume' : 'Pause', icon: r.active === false ? 'repeat' : 'ban', onClick: () => store.put('recurring', { ...r, active: r.active === false }) },
          { label: 'Duplicate', icon: 'copy', onClick: () => store.put('recurring', { ...structuredClone(r), id: undefined, name: `${r.name} (copy)`, count: 0 }) },
          'sep',
          { label: 'Delete', icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog({ title: `Delete ${r.name}?`, message: 'Transactions already created from it are kept.', confirmLabel: 'Delete', danger: true })) store.remove('recurring', r.id); } },
        ], { align: 'end' }));
        return b;
      },
    },
  ];
  const table = dataTable({
    columns, rows, ariaLabel: 'Recurring transactions',
    onRowClick: (r) => openRecurringForm({ rule: r }),
    empty: emptyState({ iconName: 'repeat', title: 'No recurring transactions', text: 'Open an invoice, bill, expense, or journal entry and choose Make recurring to save it as a schedule.' }),
  });
  swap(main, el('div.page', {},
    pageHead({ title: 'Recurring transactions', crumbs: [['Accounting', 'banking'], ['Recurring transactions']], actions: [el('button.btn.btn-primary', { type: 'button', onclick: () => newTemplate() }, 'New')] }),
    table.root));
}

function newTemplate() {
  const types = ['invoice', 'bill', 'expense', 'check', 'deposit', 'transfer', 'journal', 'salesReceipt'];
  const pick = el('div.stack', {}, el('p', {}, 'Which kind of transaction should repeat? Fill it in, then choose Make recurring in its footer.'),
    el('div.chip-row', { style: { flexWrap: 'wrap' } }, types.map((t) => el('button.chip', { type: 'button', onclick: () => { dlg.close(); openTxnForm({ type: t }); } }, TXN_TYPES[t].label))));
  const dlg = openDialog({ title: 'New recurring template', body: pick });
}

// --------------------------------------------------------------- sales tax

export function renderSalesTax(main) {
  const st = viewState('salestax', { period: 'lastQuarter' });
  const range = periodRange(st.period, { now: today(), fiscalStartMonth: store.settings.fiscalStartMonth });
  const rep = salesTaxLiability(store, range);
  const liability = store.accountBalance(store.roleAccount('salesTax'));
  const rates = store.taxRateList({ includeInactive: true });
  const columns = [
    { key: 'name', label: 'Rate name', primary: true, render: (r) => el('span.cell-main', {}, r.name, r.active === false ? el('span.badge', { style: { marginLeft: '8px' } }, 'Inactive') : null), sortable: false },
    { key: 'agency', label: 'Agency', render: (r) => r.agency || '', sortable: false },
    { key: 'rate', label: 'Rate', align: 'right', render: (r) => `${(r.rate / 100).toFixed(r.rate % 100 ? 2 : 0)}%`, sortable: false },
    { key: 'action', label: 'Action', srLabel: 'Action', className: 'actions-cell', sortable: false, render: (r) => el('button.row-link', { type: 'button', onclick: () => editRate(r) }, 'Edit') },
  ];
  const periodSel = el('select.select', { 'aria-label': 'Period', onchange: (e) => { st.period = e.target.value; renderSalesTax(main); } },
    [['thisMonth', 'This month'], ['lastMonth', 'Last month'], ['thisQuarter', 'This quarter'], ['lastQuarter', 'Last quarter'], ['thisYear', 'This year'], ['lastYear', 'Last year']].map(([v, l]) => el('option', { value: v, selected: st.period === v }, l)));
  const totalTax = rep.rows.at(-1).values[3];
  swap(main, el('div.page', {},
    pageHead({ title: 'Sales tax', crumbs: [['Sales Tax', 'sales-tax'], ['Sales tax']], actions: [el('a.btn', { href: '#/report/salesTax' }, 'Liability report'), el('button.btn', { type: 'button', onclick: () => editRate(null) }, 'Add rate'), el('button.btn.btn-primary', { type: 'button', onclick: () => recordPayment(liability) }, 'Record tax payment')] }),
    el('div.stat-row', {},
      el('div.stat', {}, el('div.kpi-label', {}, 'Sales tax owed now'), el('div.kpi-value', {}, formatMoney(liability))),
      el('div.stat', {}, el('div.kpi-label', {}, `Tax collected, ${formatRange(range.from, range.to)}`), el('div.kpi-value', {}, formatMoney(totalTax)), el('div.field', { style: { marginTop: '6px' } }, periodSel))),
    el('h2.section-title', {}, 'Tax rates'),
    dataTable({ columns, rows: rates, ariaLabel: 'Sales tax rates', onRowClick: (r) => editRate(r), empty: emptyState({ iconName: 'percent', title: 'No tax rates', text: 'Add the sales tax rate you charge.' }) }).root));
}

function editRate(rate) {
  const r = rate ? structuredClone(rate) : { name: '', rate: 0, agency: '', active: true };
  const name = textInput({ value: r.name });
  name.addEventListener('input', () => { r.name = name.value; });
  const agency = textInput({ value: r.agency || '' });
  agency.addEventListener('input', () => { r.agency = agency.value; });
  const pct = textInput({ value: r.rate ? String(r.rate / 100) : '', inputMode: 'decimal' });
  pct.addEventListener('input', () => { r.rate = Math.round((parseFloat(pct.value) || 0) * 100); });
  const active = el('label.check', {}, el('input', { type: 'checkbox', checked: r.active !== false, onchange: (e) => { r.active = e.target.checked; } }), 'Active');
  const dlg = openDialog({
    title: rate ? 'Edit tax rate' : 'Add tax rate',
    body: el('div.stack', {}, field('Name', name, { required: true }), el('div.form-grid', {}, field('Rate (%)', pct, { hint: 'For example 8.25' }), field('Agency', agency)), active),
    footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'button', onclick: () => { if (!r.name.trim()) { name.focus(); return; } store.put('taxRates', r); toast('Tax rate saved'); dlg.close(); } }, 'Save')),
    initialFocus: name,
  });
}

function recordPayment(owed) {
  let amount = owed;
  const bank = store.accountsOfType('bank')[0]?.id;
  const amt = moneyInput({ value: owed, ariaLabel: 'Payment amount', onChange: (v) => { amount = v || 0; } });
  const dlg = openDialog({
    title: 'Record a sales tax payment',
    body: el('div.stack', {}, el('p', {}, `You owe ${formatMoney(owed)}. Record what you paid the tax agency; it reduces Sales Tax Payable and comes out of your bank account.`), field('Payment amount', amt)),
    footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, 'Cancel'), el('button.btn.btn-primary', {
      type: 'button',
      onclick: () => {
        dlg.close();
        openTxnForm({ type: 'expense', draft: { accountId: bank, memo: 'Sales tax payment', lines: [{ accountId: store.roleAccount('salesTax'), amount, desc: 'Sales tax payment' }] } });
      },
    }, 'Continue')),
  });
}

// --------------------------------------------------------------- audit log

export function renderAudit(main) {
  const st = viewState('audit', { kind: 'all' });
  const items = [];
  const label = { txns: 'Transaction', contacts: 'Contact', items: 'Item', accounts: 'Account', rules: 'Rule', recurring: 'Recurring template', taxRates: 'Tax rate', recons: 'Reconciliation' };
  for (const [col, name] of Object.entries(label)) {
    if (st.kind !== 'all' && st.kind !== col) continue;
    for (const r of store[col].values()) {
      const what = col === 'txns' ? `${typeLabel(r.type)}${r.num ? ` #${r.num}` : ''}${r.contactId ? `, ${store.contactName(r.contactId)}` : ''}`
        : col === 'contacts' ? r.displayName : col === 'accounts' ? store.accountName(r.id) : col === 'recons' ? `${store.account(r.accountId)?.name || ''} through ${r.statementDate}` : r.name;
      items.push({ id: `${col}:${r.id}`, col, name, what, at: r.updatedAt || r.createdAt || 0, created: (r.updatedAt || 0) - (r.createdAt || 0) < 1000, rec: r });
    }
  }
  items.sort((a, b) => b.at - a.at);
  const rows = items.slice(0, 2000);
  const columns = [
    { key: 'at', label: 'Date changed', render: (r) => (r.at ? new Date(r.at).toLocaleString() : ''), sortable: false },
    { key: 'event', label: 'Event', render: (r) => (r.created ? 'Added' : 'Edited'), sortable: false },
    { key: 'name', label: 'Type', render: (r) => r.name, sortable: false },
    { key: 'what', label: 'Name', primary: true, render: (r) => el('span.cell-main', {}, r.what || ''), sortable: false },
    { key: 'amount', label: 'Amount', align: 'right', render: (r) => (r.col === 'txns' ? amountNode(store.total(r.rec)) : ''), sortable: false },
  ];
  swap(main, el('div.page', {},
    pageHead({ title: 'Audit log', crumbs: [['Accounting', 'banking'], ['Audit log']] }),
    tabs([['all', 'All'], ['txns', 'Transactions'], ['contacts', 'Contacts'], ['accounts', 'Accounts'], ['items', 'Products']], st.kind, (k) => { st.kind = k; renderAudit(main); }, { label: 'Filter' }),
    el('p.field-hint', { style: { marginBottom: '10px' } }, 'The latest changes to your books, newest first. Deleted records are not listed.'),
    dataTable({
      columns, rows, ariaLabel: 'Audit log',
      onRowClick: (r) => {
        if (r.col === 'txns') openTxn(r.rec.id);
        else if (r.col === 'contacts') navigate(`${r.rec.kind}/${r.rec.id}`);
        else if (r.col === 'accounts') navigate(`register/${r.rec.id}`);
      },
      empty: emptyState({ iconName: 'history', title: 'No changes yet' }),
    }).root));
}

export { createFromTemplate };
