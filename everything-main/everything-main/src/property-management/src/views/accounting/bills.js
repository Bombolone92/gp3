/** Bills: what you owe vendors, with selection to pay several at once. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, stat, chips, searchBox, dataTable, emptyState, statusPill, moreButton } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { setQuery } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { billStatus } from '../../core/ledger.js';
import { addDays, startOfMonth } from '../../core/dates.js';
import { displayName, matches } from '../../core/format.js';
import { money, date, vendorSelect, propertySelect, exportCSV, csvMoney, rememberSort, saveSort } from '../common.js';
import { txTotal, txPropertyName, runTx } from './shared.js';

const FILTERS = [
  { id: 'unpaid', label: 'Unpaid', match: (s) => s === 'due' || s === 'partial' || s === 'overdue' },
  { id: 'overdue', label: 'Overdue', match: (s) => s === 'overdue' },
  { id: 'paid', label: 'Paid', match: (s) => s === 'paid' },
  { id: 'all', label: 'All', match: (s) => s !== 'void' },
];

export function render(ctx) {
  const store = app.store;
  const state = {
    filter: FILTERS.some((f) => f.id === ctx.query.status) ? ctx.query.status : 'unpaid',
    vendor: ctx.query.vendor || '',
    property: ctx.query.property || '',
    q: ctx.query.q || '',
    sort: rememberSort('bills', { id: 'due', dir: 'asc' }),
    selected: new Set(),
  };
  const persist = () => setQuery({ status: state.filter === 'unpaid' ? '' : state.filter, vendor: state.vendor, property: state.property, q: state.q });

  const search = searchBox({
    value: state.q,
    placeholder: 'Search vendor, memo or reference',
    label: 'Search bills',
    onInput: (v) => {
      state.q = v;
      persist();
      redraw();
    },
  });
  const vendor = vendorSelect({ value: state.vendor, empty: 'All vendors', 'aria-label': 'Vendor' });
  vendor.addEventListener('change', () => {
    state.vendor = vendor.value;
    persist();
    redraw();
  });
  const property = propertySelect({ value: state.property, empty: 'All properties', 'aria-label': 'Property' });
  property.addEventListener('change', () => {
    state.property = property.value;
    persist();
    redraw();
  });

  function bills() {
    const ledger = app.ledger();
    const today = app.today();
    return store
      .all('transactions')
      .filter((t) => t.kind === 'bill')
      .map((t) => {
        const info = ledger.bill(t.id);
        return { t, info, status: billStatus(t, info, today) };
      });
  }

  // Filters stay outside the redrawn regions so typing and ticking keep focus.
  function current() {
    const all = bills();
    const f = FILTERS.find((x) => x.id === state.filter);
    const rows = all.filter(
      (b) =>
        f.match(b.status) &&
        (!state.vendor || b.t.vendorId === state.vendor) &&
        (!state.property || b.t.propertyId === state.property || b.t.lines.some((l) => l.propertyId === state.property)) &&
        (!state.q || matches(`${displayName(lookup.vendor(b.t.vendorId))} ${b.t.memo} ${b.t.ref}`, state.q)),
    );
    const payable = new Set(rows.filter((b) => b.info.balance > 0 && b.status !== 'void').map((b) => b.t.id));
    for (const id of state.selected) if (!payable.has(id)) state.selected.delete(id);
    return { all, rows, payable };
  }
  const sum = (list) => list.reduce((s, b) => s + b.info.balance, 0);
  const redraw = () => {
    stats.redraw();
    chipsRegion.redraw();
    table.redraw();
    selbar.redraw();
  };
  const setFilter = (id) => {
    state.filter = id;
    persist();
    redraw();
  };

  const stats = ctx.live(() => {
    const { all } = current();
    const today = app.today();
    const unpaid = all.filter((b) => FILTERS[0].match(b.status));
    const overdue = all.filter((b) => b.status === 'overdue');
    const week = unpaid.filter((b) => b.status !== 'overdue' && b.t.dueDate <= addDays(today, 7));
    const monthStart = startOfMonth(today);
    let paidThisMonth = 0;
    for (const t of store.all('transactions')) if (t.kind === 'bill-payment' && !t.voided && t.date >= monthStart && t.date <= today) paidThisMonth += txTotal(t);
    return h(
      'div.stats.list-stats',
      stat({ label: 'Unpaid', value: money(sum(unpaid)), sub: `${unpaid.length} ${unpaid.length === 1 ? 'bill' : 'bills'}`, onClick: () => setFilter('unpaid') }),
      stat({ label: 'Overdue', value: money(sum(overdue)), sub: `${overdue.length} ${overdue.length === 1 ? 'bill' : 'bills'}`, tone: overdue.length ? 'danger' : null, onClick: () => setFilter('overdue') }),
      stat({ label: 'Due in the next 7 days', value: money(sum(week)), sub: `${week.length} ${week.length === 1 ? 'bill' : 'bills'}` }),
      stat({ label: 'Paid this month', value: money(paidThisMonth) }),
    );
  }, ['transactions']);

  const chipsRegion = ctx.live(() => {
    const { all } = current();
    return chips({ label: 'Status', selected: state.filter, onSelect: setFilter, items: FILTERS.map((x) => ({ id: x.id, label: x.label, count: all.filter((b) => x.match(b.status)).length })) });
  }, ['transactions']);

  const selbar = ctx.live(() => {
    const { rows } = current();
    const selectedRows = rows.filter((b) => state.selected.has(b.t.id));
    // Always present (a hint when nothing is selected) so ticking a box
    // never shifts the rows under the pointer.
    if (!selectedRows.length) {
      if (!rows.some((b) => b.status !== 'paid' && b.status !== 'void')) return null;
      return h('div.acct-selbar.idle', h('span.grow', { role: 'status' }, 'Select bills to pay several at once.'), h('button.btn.sm.primary', { type: 'button', disabled: true }, icon('wallet', 14), 'Pay selected'));
    }
    return h(
      'div.acct-selbar',
      { role: 'region', 'aria-label': 'Selected bills' },
      h('span.grow', { role: 'status' }, h('strong', `${selectedRows.length} selected`), ` · ${money(sum(selectedRows))}`),
      h('button.btn.sm.ghost', { type: 'button', onClick: () => (state.selected.clear(), table.redraw(), selbar.redraw()) }, 'Clear'),
      h('button.btn.sm.primary', { type: 'button', onClick: () => paySelected(selectedRows) }, icon('wallet', 14), 'Pay selected'),
    );
  }, ['transactions']);

  const pick = (id, on) => {
    if (on) state.selected.add(id);
    else state.selected.delete(id);
    // Keep the desktop and phone checkboxes for the same bill in step.
    for (const box of table.querySelectorAll(`input[data-bill="${id}"]`)) box.checked = on;
    selbar.redraw();
  };
  const checkbox = (b, label) =>
    h('input', {
      type: 'checkbox',
      checked: state.selected.has(b.t.id),
      'data-bill': b.t.id,
      'aria-label': label,
      onChange: (e) => pick(b.t.id, e.target.checked),
    });

  const table = ctx.live(() => {
    const { all, rows, payable } = current();
    return dataTable({
      caption: 'Bills',
      rows,
      sort: state.sort,
      onSort: (s) => {
        state.sort = s;
        saveSort('bills', s);
        table.redraw();
      },
      rowHref: (b) => `#/bills/${b.t.id}`,
      columns: [
        {
          id: 'sel',
          link: false,
          label: '',
          srLabel: 'Select',
          cls: 'acct-sel',
          render: (b) => (payable.has(b.t.id) ? checkbox(b, `Select bill from ${displayName(lookup.vendor(b.t.vendorId))} for ${money(b.info.balance)}`) : null),
        },
        { id: 'due', label: 'Due', sort: (b) => b.t.dueDate || b.t.date, render: (b) => h('span.nowrap', date(b.t.dueDate || b.t.date)) },
        { id: 'vendor', label: 'Vendor', sort: (b) => displayName(lookup.vendor(b.t.vendorId)), render: (b) => h('span.primary-link', displayName(lookup.vendor(b.t.vendorId)) || 'Unknown vendor') },
        { id: 'memo', label: 'Memo', sort: (b) => b.t.memo || '', render: (b) => h('span.acct-desc', h('span.truncate', b.t.memo || 'Bill'), b.t.ref ? h('span.acct-memo', `Ref ${b.t.ref}`) : null) },
        { id: 'property', label: 'Property', sort: (b) => txPropertyName(b.t), render: (b) => h('span.truncate', txPropertyName(b.t)) },
        { id: 'status', label: 'Status', sort: (b) => b.status, render: (b) => statusPill(b.status) },
        { id: 'amount', label: 'Amount', align: 'r', sort: (b) => b.info.total, render: (b) => h('span.num', money(b.info.total)) },
        { id: 'balance', label: 'Balance', align: 'r', sort: (b) => b.info.balance, render: (b) => (b.info.balance ? h('span.num.strong', money(b.info.balance)) : h('span.subtle', money(0))) },
      ],
      mobile: (b) =>
        h(
          'div.acct-mobile-bill',
          payable.has(b.t.id) ? checkbox(b, `Select bill from ${displayName(lookup.vendor(b.t.vendorId))}`) : null,
          h(
            'a.mobile-row.grow',
            { href: `#/bills/${b.t.id}` },
            h('div.grow', { style: { minWidth: 0 } }, h('div.m-title', displayName(lookup.vendor(b.t.vendorId)) || 'Unknown vendor'), h('div.m-sub', `Due ${date(b.t.dueDate || b.t.date)} · ${b.t.memo || 'Bill'}`)),
            h('div.m-end', h('span.num', money(b.info.balance || b.info.total)), statusPill(b.status)),
          ),
        ),
      empty: all.length
        ? emptyState({ compact: true, icon: 'search', title: 'No matching bills', text: 'Try a different status or filter.', headingLevel: 3 })
        : emptyState({
            icon: 'receipt',
            title: 'No bills yet',
            text: 'Record vendor bills to track what you owe and pay them on time.',
            headingLevel: 3,
            actions: [h('button.btn.primary', { type: 'button', onClick: () => runTx('billDialog', {}) }, icon('plus', 16), 'Record bill')],
          }),
    });
  }, ['transactions', 'vendors', 'properties']);

  async function paySelected(rows) {
    const vendors = new Set(rows.map((b) => b.t.vendorId));
    const res = await runTx('payBillsDialog', { vendorId: vendors.size === 1 ? [...vendors][0] : null, billIds: rows.map((b) => b.t.id) });
    if (res) {
      state.selected.clear();
      redraw();
    }
  }

  const exportRows = () => {
    const rows = bills().filter((b) => b.status !== 'void');
    exportCSV(
      `bills-${app.today()}`,
      [
        { label: 'Bill date', value: (b) => b.t.date },
        { label: 'Due date', value: (b) => b.t.dueDate },
        { label: 'Vendor', value: (b) => displayName(lookup.vendor(b.t.vendorId)) },
        { label: 'Memo', value: (b) => b.t.memo },
        { label: 'Reference', value: (b) => b.t.ref },
        { label: 'Property', value: (b) => txPropertyName(b.t) },
        { label: 'Status', value: (b) => b.status },
        { label: 'Amount', value: (b) => csvMoney(b.info.total) },
        { label: 'Balance', value: (b) => csvMoney(b.info.balance) },
      ],
      rows,
    );
    toast(`Exported ${rows.length} bills`);
  };

  return {
    node: h(
      'div.page.acct-page',
      pageHeader({
        title: 'Bills',
        actions: [
          moreButton((btn) => openMenu(btn, [{ label: 'Export to CSV', icon: 'download', run: exportRows }])),
          h('button.btn', { type: 'button', onClick: () => runTx('payBillsDialog', {}) }, icon('wallet', 16), 'Pay bills'),
          h('button.btn.primary', { type: 'button', onClick: () => runTx('billDialog', {}) }, icon('plus', 16), 'Record bill'),
        ],
      }),
      stats,
      h('section.card.list-card', { 'aria-label': 'Bills' }, h('div.toolbar.acct-filters', search, vendor, property, h('div.grow'), chipsRegion), selbar, table),
    ),
    title: 'Bills',
  };
}
