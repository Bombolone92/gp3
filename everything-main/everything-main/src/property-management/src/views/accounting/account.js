/** One account's register: every line posted to it, with a running balance. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, stat, dataTable, emptyState } from '../../ui/components.js';
import { setQuery } from '../../ui/router.js';
import { addMonths, startOfMonth } from '../../core/dates.js';
import { normalSign, typeLabel } from '../../core/accounts.js';
import { generalLedger } from '../../core/financials.js';
import { money, date, propertySelect, exportCSV, csvMoney } from '../common.js';
import { accountDialog, kindLabel, txTitle, stmtCell, notFound } from './shared.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  const today = app.today();
  const state = { from: ctx.query.from || startOfMonth(addMonths(today, -11)), to: ctx.query.to || today, property: ctx.query.property || '' };

  const from = h('input.input', { type: 'date', value: state.from, 'aria-label': 'From date' });
  const to = h('input.input', { type: 'date', value: state.to, 'aria-label': 'To date' });
  const property = propertySelect({ value: state.property, empty: 'All properties', 'aria-label': 'Property' });
  const apply = () => {
    Object.assign(state, { from: from.value, to: to.value, property: property.value });
    setQuery({ from: state.from, to: state.to, property: state.property });
    top.redraw();
    table.redraw();
  };
  from.addEventListener('change', apply);
  to.addEventListener('change', apply);
  property.addEventListener('change', apply);

  const filters = h('div.row.acct-wrap', h('div.acct-dates', from, h('span.subtle', { 'aria-hidden': 'true' }, 'to'), to), property);
  const ledgerFor = () => generalLedger(store, { from: state.from, to: state.to, accountIds: [id], propertyIds: state.property ? [state.property] : null })[0];
  const watch = ['transactions', 'accounts', 'leases', 'tenants', 'vendors', 'owners', 'properties'];

  const top = ctx.live(() => {
    const a = store.get('accounts', id);
    if (!a) return notFound('Account', { href: '#/accounts', label: 'Go to the chart of accounts' });
    const g = ledgerFor();
    const opening = g?.opening || 0;
    const count = g?.rows.length || 0;
    const activity = (g?.rows || []).reduce((s, r) => s + r.amount, 0);
    const balance = app.ledger().account(id) * normalSign(a.type);
    const exportRows = () =>
      exportCSV(
        `${a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${state.from}-to-${state.to}`,
        [
          { label: 'Date', value: (r) => r.date },
          { label: 'Type', value: (r) => kindLabel(r.tx.kind) },
          { label: 'Description', value: (r) => txTitle(r.tx) },
          { label: 'Memo', value: (r) => r.memo },
          { label: 'Property', value: (r) => lookup.property(r.line.propertyId)?.name || '' },
          { label: 'Reference', value: (r) => r.tx.ref },
          { label: 'Amount', value: (r) => csvMoney(r.amount) },
          { label: 'Balance', value: (r) => csvMoney(r.balance) },
        ],
        ledgerFor()?.rows || [],
      );
    return [
      pageHeader({
        title: a.name,
        crumbs: [{ label: 'Chart of accounts', href: '#/accounts' }],
        subtitle: [a.number, `${typeLabel(a.type)} account`, a.active === false ? 'Inactive' : null].filter(Boolean).join(' · '),
        actions: [
          a.bank ? h('a.btn', { href: `#/banking/${a.id}` }, icon('landmark', 16), 'Banking') : null,
          h('button.btn', { type: 'button', onClick: exportRows }, icon('download', 16), 'Export CSV'),
          h('button.btn.primary', { type: 'button', onClick: () => accountDialog(a) }, icon('pencil', 16), 'Edit'),
        ],
      }),
      h(
        'div.stats',
        stat({ label: 'Current balance', value: money(balance) }),
        stat({ label: 'Opening balance', value: money(opening), sub: date(state.from) }),
        stat({ label: 'Activity in period', value: money(activity), sub: `${count} ${count === 1 ? 'entry' : 'entries'}` }),
      ),
    ];
  }, watch);

  const table = ctx.live(() => {
    const a = store.get('accounts', id);
    if (!a) return null;
    const g = ledgerFor();
    const rows = (g?.rows || []).slice().reverse();
    return [
      dataTable({
        caption: `${a.name} register`,
        rows,
        rowHref: (r) => `#/transactions/${r.tx.id}`,
        columns: [
          { id: 'date', label: 'Date', render: (r) => h('span.nowrap', date(r.date)) },
          { id: 'kind', label: 'Type', render: (r) => h('span.nowrap', kindLabel(r.tx.kind)) },
          { id: 'desc', label: 'Description', render: (r) => h('span.acct-desc', h('span.truncate', txTitle(r.tx)), r.memo && r.memo !== txTitle(r.tx) ? h('span.acct-memo', r.memo) : null) },
          { id: 'prop', label: 'Property', render: (r) => h('span.truncate', lookup.property(r.line.propertyId)?.name || '') },
          { id: 'amt', label: 'Amount', align: 'r', render: (r) => stmtCell(r.amount) },
          { id: 'bal', label: 'Balance', align: 'r', render: (r) => stmtCell(r.balance) },
        ],
        mobile: (r) =>
          h('a.mobile-row', { href: `#/transactions/${r.tx.id}` }, h('div.grow', { style: { minWidth: 0 } }, h('div.m-title', txTitle(r.tx)), h('div.m-sub', `${date(r.date)} · ${kindLabel(r.tx.kind)}`)), h('div.m-end', stmtCell(r.amount), h('span.subtle.acct-small', money(r.balance)))),
        empty: emptyState({ compact: true, icon: 'list', title: 'No entries in this period', text: 'Choose a wider date range to see more.', headingLevel: 3 }),
      }),
      h('div.acct-opening', h('span', `Opening balance on ${date(state.from)}`), stmtCell(g?.opening || 0)),
    ];
  }, watch);

  return {
    node: h('div.page.acct-page', h('div.stack.acct-stack', top, store.get('accounts', id) ? h('section.card.list-card', { 'aria-label': 'Register' }, h('div.toolbar.acct-filters', filters), table) : null)),
    title: store.get('accounts', id)?.name || 'Account',
  };
}
