/** General ledger: every transaction, newest first, with filters. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app } from '../../app.js';
import { pageHeader, searchBox, select, dataTable, emptyState, moreButton } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { setQuery } from '../../ui/router.js';
import { TX_KINDS } from '../../core/ledger.js';
import { matches } from '../../core/format.js';
import { money, date, propertySelect, accountSelect, exportCSV, csvMoney, rememberSort, saveSort } from '../common.js';
import { kindLabel, txTitle, txTotal, txPropertyName, voidPill, runTx } from './shared.js';

export function render(ctx) {
  const store = app.store;
  const q = ctx.query;
  const state = {
    q: q.q || '',
    kind: q.kind || '',
    property: q.property || '',
    account: q.account || '',
    from: q.from || '',
    to: q.to || '',
    voided: q.voided === '1',
    sort: rememberSort('ledger', { id: 'date', dir: 'desc' }),
  };

  const set = (patch) => {
    Object.assign(state, patch);
    setQuery({ q: state.q, kind: state.kind, property: state.property, account: state.account, from: state.from, to: state.to, voided: state.voided ? '1' : '' });
    results.redraw();
  };

  const search = searchBox({ value: state.q, placeholder: 'Search memo, reference, tenant or vendor', label: 'Search transactions', onInput: (v) => set({ q: v }) });
  const kind = select({ value: state.kind, options: [{ value: '', label: 'All types' }, ...Object.entries(TX_KINDS).map(([value, label]) => ({ value, label }))], 'aria-label': 'Transaction type' });
  kind.addEventListener('change', () => set({ kind: kind.value }));
  const property = propertySelect({ value: state.property, empty: 'All properties', 'aria-label': 'Property' });
  property.addEventListener('change', () => set({ property: property.value }));
  const account = accountSelect({ value: state.account, empty: 'All accounts', 'aria-label': 'Account' });
  account.addEventListener('change', () => set({ account: account.value }));
  const from = h('input.input', { type: 'date', value: state.from, 'aria-label': 'From date' });
  const to = h('input.input', { type: 'date', value: state.to, 'aria-label': 'To date' });
  from.addEventListener('change', () => set({ from: from.value }));
  to.addEventListener('change', () => set({ to: to.value }));
  const voided = h('input', { type: 'checkbox', checked: state.voided });
  voided.addEventListener('change', () => set({ voided: voided.checked }));

  function filtered() {
    return store.all('transactions').filter((t) => {
      if (t.voided && !state.voided) return false;
      if (state.kind && t.kind !== state.kind) return false;
      if (state.from && t.date < state.from) return false;
      if (state.to && t.date > state.to) return false;
      if (state.property && t.propertyId !== state.property && !t.lines.some((l) => l.propertyId === state.property)) return false;
      if (state.account && !t.lines.some((l) => l.accountId === state.account)) return false;
      if (state.q && !matches(`${t.memo} ${t.ref} ${txTitle(t)} ${kindLabel(t.kind)}`, state.q)) return false;
      return true;
    });
  }

  const results = ctx.live(() => {
    const rows = filtered();
    const total = rows.reduce((s, t) => s + (t.voided ? 0 : txTotal(t)), 0);
    const any = store.all('transactions').length;
    return [
      h('div.acct-results-meta', h('span', { role: 'status' }, `${rows.length.toLocaleString()} ${rows.length === 1 ? 'transaction' : 'transactions'}`), rows.length ? h('span.subtle', `${money(total)} total`) : null),
      dataTable({
        caption: 'Transactions',
        rows,
        sort: state.sort,
        onSort: (s) => {
          state.sort = s;
          saveSort('ledger', s);
          results.redraw();
        },
        rowHref: (t) => `#/transactions/${t.id}`,
        columns: [
          { id: 'date', label: 'Date', sort: (t) => `${t.date}|${t.createdAt || ''}`, render: (t) => h('span.nowrap', date(t.date)) },
          { id: 'kind', label: 'Type', sort: (t) => kindLabel(t.kind), render: (t) => h('span.nowrap', kindLabel(t.kind), t.voided ? [' ', voidPill()] : null) },
          {
            id: 'desc',
            label: 'Description',
            sort: (t) => txTitle(t),
            render: (t) => h('span.acct-desc', h('span.truncate', txTitle(t)), t.memo && t.memo !== txTitle(t) ? h('span.acct-memo.truncate', t.memo) : null),
          },
          { id: 'property', label: 'Property', sort: (t) => txPropertyName(t), render: (t) => h('span.truncate', txPropertyName(t)) },
          { id: 'ref', label: 'Ref', sort: (t) => t.ref || '', render: (t) => h('span.subtle', t.ref || '') },
          { id: 'amount', label: 'Amount', align: 'r', sort: (t) => txTotal(t), render: (t) => h(`span.num${t.voided ? '.struck' : ''}`, money(txTotal(t))) },
        ],
        mobile: (t) =>
          h(
            'a.mobile-row',
            { href: `#/transactions/${t.id}` },
            h('div.grow', { style: { minWidth: 0 } }, h('div.m-title', txTitle(t)), h('div.m-sub', `${kindLabel(t.kind)} · ${date(t.date)}${t.ref ? ' · ' + t.ref : ''}`)),
            h('div.m-end', h(`span.num${t.voided ? '.struck' : ''}`, money(txTotal(t))), t.voided ? voidPill() : null),
          ),
        empty: any
          ? emptyState({ compact: true, icon: 'search', title: 'No matching transactions', text: 'Try different filters or dates.', headingLevel: 3 })
          : emptyState({ icon: 'book', title: 'No transactions yet', text: 'Payments, charges, bills and journal entries will all appear here.', headingLevel: 3 }),
      }),
    ];
  }, ['transactions', 'accounts', 'leases', 'tenants', 'vendors', 'owners', 'properties']);

  const exportRows = () =>
    exportCSV(
      `transactions-${app.today()}`,
      [
        { label: 'Date', value: (t) => t.date },
        { label: 'Type', value: (t) => kindLabel(t.kind) },
        { label: 'Description', value: (t) => txTitle(t) },
        { label: 'Memo', value: (t) => t.memo },
        { label: 'Property', value: (t) => txPropertyName(t) },
        { label: 'Reference', value: (t) => t.ref },
        { label: 'Amount', value: (t) => csvMoney(txTotal(t)) },
        { label: 'Voided', value: (t) => (t.voided ? 'Yes' : '') },
      ],
      filtered().sort((a, b) => (a.date < b.date ? 1 : -1)),
    );

  const header = pageHeader({
    title: 'General ledger',
    subtitle: 'Every transaction across your properties',
    actions: [
      moreButton((btn) =>
        openMenu(btn, [
          { label: 'Transfer between accounts', icon: 'transfer', run: () => runTx('transferDialog') },
          { label: 'Record expense', icon: 'wallet', run: () => runTx('expenseDialog', {}) },
          { separator: true },
          { label: 'Export to CSV', icon: 'download', run: exportRows },
        ]),
      ),
      h('button.btn.primary', { type: 'button', onClick: () => runTx('journalDialog', {}) }, icon('plus', 16), 'Journal entry'),
    ],
  });

  return {
    node: h(
      'div.page.acct-page',
      header,
      h(
        'section.card.list-card',
        { 'aria-label': 'Transactions' },
        h(
          'div.toolbar.acct-filters',
          search,
          kind,
          property,
          account,
          h('div.acct-dates', from, h('span.subtle', { 'aria-hidden': 'true' }, 'to'), to),
          h('label.check', voided, h('span', 'Show voided')),
        ),
        results,
      ),
    ),
    title: 'General ledger',
  };
}

