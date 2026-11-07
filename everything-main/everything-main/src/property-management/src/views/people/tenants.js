/** Tenants: everyone on a lease, filtered by current, future or past. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, searchBox, chips, dataTable, emptyState, moreButton } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { setQuery } from '../../ui/router.js';
import { personName, primaryEmail, primaryPhone, matches, telHref } from '../../core/format.js';
import { balanceCell, money, rememberSort, saveSort, exportCSV, csvMoney, personAvatar } from '../common.js';
import { tenantStatus, primaryLease, TENANT_STATUS, tonePill } from '../properties/shared.js';

const FILTERS = [
  { id: 'current', label: 'Current', match: (s) => s === 'current' },
  { id: 'future', label: 'Future', match: (s) => s === 'future' },
  { id: 'past', label: 'Past', match: (s) => s === 'past' || s === 'none' },
  { id: 'all', label: 'All', match: () => true },
];

export function render(ctx) {
  const store = app.store;
  const state = {
    q: ctx.query.q || '',
    filter: FILTERS.some((f) => f.id === ctx.query.status) ? ctx.query.status : 'current',
    sort: rememberSort('tenants', { id: 'name', dir: 'asc' }),
  };

  let cache = new Map();
  const info = (t) => {
    let i = cache.get(t.id);
    if (!i) {
      const lease = primaryLease(t.id);
      i = { status: tenantStatus(t.id), lease, balance: lease ? app.ledger().lease(lease.id).balance : 0 };
      cache.set(t.id, i);
    }
    return i;
  };

  const header = pageHeader({
    title: 'Tenants',
    actions: [
      moreButton((btn) => openMenu(btn, [{ label: 'Export to CSV', icon: 'download', run: exportAll }, { label: 'Outstanding balances', icon: 'scale', href: '#/balances' }])),
      h('a.btn.primary', { href: '#/tenants/new' }, icon('plus', 16), 'New tenant'),
    ],
  });

  const search = searchBox({
    value: state.q,
    placeholder: 'Search by name, email, phone or unit',
    label: 'Search tenants',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      results.redraw();
    },
  });

  const filterNode = ctx.live(() => {
    cache = new Map();
    const all = store.all('tenants');
    return chips({
      label: 'Show',
      selected: state.filter,
      onSelect: (id) => {
        state.filter = id;
        setQuery({ status: id === 'current' ? '' : id });
        filterNode.redraw();
        results.redraw();
      },
      items: FILTERS.map((f) => ({ id: f.id, label: f.label, count: all.filter((t) => f.match(info(t).status)).length })),
    });
  }, ['tenants', 'leases', 'transactions']);

  const unitText = (t) => (info(t).lease ? lookup.leaseLabel(info(t).lease) : '');

  const columns = [
    {
      id: 'name',
      label: 'Name',
      sort: (t) => `${t.lastName || ''} ${t.firstName || ''}`.trim() || t.company || '',
      render: (t) => h('span.rn-person', personAvatar(t, { size: 'sm' }), h('span', h('span.primary-cell', personName(t)), t.company && (t.firstName || t.lastName) ? h('span.sub', ` ${t.company}`) : null)),
    },
    { id: 'unit', label: 'Unit', sort: unitText, render: (t) => (info(t).lease ? h('a', { href: `#/leases/${info(t).lease.id}` }, unitText(t)) : h('span.subtle', 'No lease')) },
    { id: 'phone', label: 'Phone', render: (t) => (primaryPhone(t) ? h('a', { href: telHref(primaryPhone(t)) }, primaryPhone(t)) : '') },
    { id: 'email', label: 'Email', sort: primaryEmail, render: (t) => (primaryEmail(t) ? h('a.truncate.rn-email', { href: `mailto:${primaryEmail(t)}` }, primaryEmail(t)) : '') },
    { id: 'balance', label: 'Balance', align: 'r', sort: (t) => info(t).balance, render: (t) => (info(t).lease ? balanceCell(info(t).balance) : '') },
    { id: 'status', label: 'Status', sort: (t) => info(t).status, render: (t) => tonePill(TENANT_STATUS[info(t).status].label, TENANT_STATUS[info(t).status].tone) },
  ];

  const rows = () => {
    const f = FILTERS.find((x) => x.id === state.filter);
    return store.all('tenants').filter((t) => f.match(info(t).status) && (!state.q || matches(`${personName(t)} ${t.company || ''} ${(t.emails || []).join(' ')} ${(t.phones || []).join(' ')} ${unitText(t)}`, state.q)));
  };

  const results = ctx.live(() => {
    const list = rows();
    return [
      h('div.sr-only', { role: 'status' }, `${list.length} tenants`),
      dataTable({
        caption: 'Tenants',
        rows: list,
        sort: state.sort,
        onSort: (s) => {
          state.sort = s;
          saveSort('tenants', s);
          results.redraw();
        },
        rowHref: (t) => `#/tenants/${t.id}`,
        columns,
        mobile: (t) =>
          h(
            'a.mobile-row',
            { href: `#/tenants/${t.id}` },
            personAvatar(t),
            h('div.grow', h('div.m-title', personName(t)), h('div.m-sub', unitText(t) || primaryPhone(t) || primaryEmail(t) || 'No lease')),
            h('div.m-end', info(t).balance > 0 ? h('span.num.owed', money(info(t).balance)) : null),
          ),
        empty: store.all('tenants').length
          ? emptyState({ compact: true, icon: 'search', title: 'No matching tenants', text: 'Try a different search or filter.', headingLevel: 3 })
          : emptyState({ icon: 'users', title: 'No tenants yet', text: 'Tenants are added when you create a lease, or you can add them here first.', headingLevel: 3, actions: [h('a.btn.primary', { href: '#/tenants/new' }, icon('plus', 16), 'New tenant')] }),
      }),
    ];
  }, ['tenants', 'leases', 'transactions', 'units', 'properties']);

  function exportAll() {
    exportCSV(
      'tenants',
      [
        { label: 'First name', value: (t) => t.firstName },
        { label: 'Last name', value: (t) => t.lastName },
        { label: 'Company', value: (t) => t.company },
        { label: 'Email', value: (t) => (t.emails || []).join('; ') },
        { label: 'Phone', value: (t) => (t.phones || []).join('; ') },
        { label: 'Unit', value: unitText },
        { label: 'Status', value: (t) => TENANT_STATUS[info(t).status].label },
        { label: 'Balance', value: (t) => csvMoney(info(t).balance) },
      ],
      rows(),
    );
  }

  return {
    node: h('div.page', header, h('section.card.list-card', { 'aria-label': 'Tenant list' }, h('div.toolbar', search, h('div.grow'), filterNode), results)),
    title: 'Tenants',
  };
}
