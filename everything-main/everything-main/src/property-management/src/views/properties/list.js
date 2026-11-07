/** Properties: the portfolio at a glance, with occupancy, rent and balances. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, stat, searchBox, chips, dataTable, emptyState, moreButton } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { setQuery } from '../../ui/router.js';
import { formatAddress, displayName, matches, pluralize } from '../../core/format.js';
import { propertyTypeLabel, propertyGroup } from '../../core/settings.js';
import { money, balanceCell, rememberSort, saveSort, exportCSV, csvMoney } from '../common.js';
import { propertyFigures, occupancyBar } from './shared.js';

const FILTERS = [
  { id: 'all', label: 'All', match: (p) => p.active !== false },
  { id: 'residential', label: 'Residential', match: (p) => p.active !== false && propertyGroup(p.type) === 'Residential' },
  { id: 'commercial', label: 'Commercial', match: (p) => p.active !== false && propertyGroup(p.type) === 'Commercial' },
  { id: 'inactive', label: 'Inactive', match: (p) => p.active === false },
];

function ownerNames(p) {
  return (p.owners || [])
    .map((o) => displayName(lookup.owner(o.ownerId)))
    .filter(Boolean)
    .join(', ');
}

export function render(ctx) {
  const store = app.store;
  const state = {
    q: ctx.query.q || '',
    filter: FILTERS.some((f) => f.id === ctx.query.filter) ? ctx.query.filter : 'all',
    sort: rememberSort('properties', { id: 'name', dir: 'asc' }),
  };

  const header = pageHeader({
    title: 'Properties',
    actions: [
      moreButton((btn) =>
        openMenu(btn, [
          { label: 'Export to CSV', icon: 'download', run: exportAll },
          { label: 'Rent roll', icon: 'file-signature', href: '#/leases' },
          { label: 'Vacant units', icon: 'door', href: '#/listings' },
        ]),
      ),
      h('a.btn.primary', { href: '#/properties/new' }, icon('plus', 16), 'New property'),
    ],
  });

  const search = searchBox({
    value: state.q,
    placeholder: 'Search by name or address',
    label: 'Search properties',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      results.redraw();
    },
  });

  const figures = new Map();
  const fig = (p) => {
    let f = figures.get(p.id);
    if (!f) figures.set(p.id, (f = propertyFigures(p.id)));
    return f;
  };

  const statsNode = ctx.live(() => {
    figures.clear();
    const active = store.all('properties').filter((p) => p.active !== false);
    let units = 0;
    let occupied = 0;
    let rent = 0;
    for (const p of active) {
      const f = fig(p);
      units += f.units;
      occupied += f.occupied;
      rent += f.rent;
    }
    const rate = units ? Math.round((occupied / units) * 100) : 0;
    return h(
      'div.stats.list-stats',
      stat({ label: 'Properties', value: String(active.length), sub: pluralize(units, 'unit') }),
      stat({ label: 'Occupancy', value: `${rate}%`, sub: `${occupied} of ${units} units occupied`, tone: rate >= 90 ? 'success' : rate < 75 && units ? 'warning' : null }),
      stat({ label: 'Vacant units', value: String(units - occupied), href: '#/listings', sub: 'View listings' }),
      stat({ label: 'Monthly rent', value: money(rent), sub: 'From current leases' }),
    );
  }, ['properties', 'units', 'leases', 'transactions']);

  const filterNode = ctx.live(() => {
    const all = store.all('properties');
    return chips({
      label: 'Show',
      selected: state.filter,
      onSelect: (id) => {
        state.filter = id;
        setQuery({ filter: id === 'all' ? '' : id });
        filterNode.redraw();
        results.redraw();
      },
      items: FILTERS.map((f) => ({ id: f.id, label: f.label, count: all.filter(f.match).length })),
    });
  }, ['properties']);

  const columns = [
    {
      id: 'name',
      label: 'Property',
      sort: (p) => p.name,
      render: (p) => h('div', h('div.primary-cell', p.name), h('div.sub', formatAddress(p.address) || 'No address')),
    },
    { id: 'type', label: 'Type', sort: (p) => propertyTypeLabel(p.type), render: (p) => propertyTypeLabel(p.type) },
    { id: 'units', label: 'Units', align: 'r', sort: (p) => fig(p).units, render: (p) => h('span.num', String(fig(p).units)) },
    { id: 'occ', label: 'Occupancy', sort: (p) => fig(p).rate, render: (p) => occupancyBar(fig(p).occupied, fig(p).units) },
    { id: 'owners', label: 'Owners', sort: (p) => ownerNames(p), render: (p) => ownerNames(p) || h('span.subtle', 'None') },
    { id: 'manager', label: 'Manager', sort: (p) => lookup.member(p.managerId)?.name || '', render: (p) => lookup.member(p.managerId)?.name || h('span.subtle', 'Unassigned') },
    { id: 'balance', label: 'Balance due', align: 'r', sort: (p) => fig(p).balance, render: (p) => balanceCell(fig(p).balance) },
    { id: 'rent', label: 'Monthly rent', align: 'r', sort: (p) => fig(p).rent, render: (p) => h('span.num', money(fig(p).rent)) },
  ];

  function rows() {
    const f = FILTERS.find((x) => x.id === state.filter) || FILTERS[0];
    return store.all('properties').filter((p) => f.match(p) && (!state.q || matches(`${p.name} ${formatAddress(p.address)} ${ownerNames(p)}`, state.q)));
  }

  const results = ctx.live(() => {
    const list = rows();
    const total = store.all('properties').length;
    return [
      h('div.sr-only', { role: 'status' }, `${list.length} properties`),
      dataTable({
        caption: 'Properties',
        rows: list,
        sort: state.sort,
        onSort: (s) => {
          state.sort = s;
          saveSort('properties', s);
          results.redraw();
        },
        rowHref: (p) => `#/properties/${p.id}`,
        columns,
        mobile: (p) => {
          const f = fig(p);
          return h(
            'a.mobile-row',
            { href: `#/properties/${p.id}` },
            h('div.grow', h('div.m-title', p.name), h('div.m-sub', `${propertyTypeLabel(p.type)} · ${f.occupied}/${f.units} occupied`)),
            h('div.m-end', h('span.num', money(f.rent)), f.balance > 0 ? h('span.num.owed', `${money(f.balance)} due`) : null),
          );
        },
        empty: total
          ? emptyState({ compact: true, icon: 'search', title: 'No matching properties', text: 'Try a different search or filter.', headingLevel: 3 })
          : emptyState({
              icon: 'building',
              title: 'Add your first property',
              text: 'Properties hold your units, leases and books. Start with an address; you can add units right away.',
              actions: [h('a.btn.primary', { href: '#/properties/new' }, icon('plus', 16), 'New property')],
              headingLevel: 3,
            }),
      }),
    ];
  }, ['properties', 'units', 'leases', 'transactions', 'owners', 'team']);

  function exportAll() {
    exportCSV(
      'properties',
      [
        { label: 'Property', value: (p) => p.name },
        { label: 'Type', value: (p) => propertyTypeLabel(p.type) },
        { label: 'Address', value: (p) => formatAddress(p.address) },
        { label: 'Units', value: (p) => fig(p).units },
        { label: 'Occupied', value: (p) => fig(p).occupied },
        { label: 'Owners', value: ownerNames },
        { label: 'Manager', value: (p) => lookup.member(p.managerId)?.name || '' },
        { label: 'Monthly rent', value: (p) => csvMoney(fig(p).rent) },
        { label: 'Balance due', value: (p) => csvMoney(fig(p).balance) },
        { label: 'Status', value: (p) => (p.active === false ? 'Inactive' : 'Active') },
      ],
      store.all('properties'),
    );
  }

  return {
    node: h('div.page', header, statsNode, h('section.card.list-card', { 'aria-label': 'Property list' }, h('div.toolbar', search, h('div.grow'), filterNode), results)),
    title: 'Properties',
  };
}
