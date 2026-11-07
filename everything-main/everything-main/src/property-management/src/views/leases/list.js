/** Rent roll: every lease with its status, term, rent and balance. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, stat, searchBox, chips, dataTable, emptyState, statusPill, select, moreButton } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { setQuery } from '../../ui/router.js';
import { leaseStatus, daysLeft, isExpiring, monthlyRent, effectiveEnd } from '../../core/leases.js';
import { leaseTypeLabel } from '../../core/settings.js';
import { matches, pluralize } from '../../core/format.js';
import { formatMoneyShort } from '../../core/money.js';
import { money, balanceCell, date, rememberSort, saveSort, exportCSV, csvMoney } from '../common.js';

const FILTERS = [
  { id: 'active', label: 'Active' },
  { id: 'future', label: 'Future' },
  { id: 'expiring', label: 'Expiring' },
  { id: 'draft', label: 'Draft' },
  { id: 'past', label: 'Past' },
  { id: 'all', label: 'All' },
];

export function termText(lease) {
  if (lease.type === 'at-will') return `From ${date(lease.start)}`;
  const end = effectiveEnd(lease) || lease.end;
  return `${date(lease.start)} to ${end ? date(end) : 'open'}`;
}

export function render(ctx) {
  const store = app.store;
  const state = {
    q: ctx.query.q || '',
    filter: FILTERS.some((f) => f.id === ctx.query.status) ? ctx.query.status : 'active',
    property: ctx.query.property || '',
    sort: rememberSort('leases', { id: 'lease', dir: 'asc' }),
  };

  const tx = () => import('../transactions/dialogs.js');
  const header = pageHeader({
    title: 'Rent roll',
    actions: [
      moreButton((btn) => openMenu(btn, [{ label: 'Export to CSV', icon: 'file-down', run: () => exportRows() }, { label: 'Outstanding balances', icon: 'hand-coins', href: '#/balances' }, { label: 'Renewals', icon: 'repeat', href: '#/renewals' }])),
      h('button.btn', { type: 'button', onClick: () => tx().then((m) => m.receivePaymentDialog()) }, icon('hand-coins', 16), h('span.hide-mobile', 'Receive payment')),
      h('a.btn.primary', { href: '#/leases/new' }, icon('plus', 16), 'New lease'),
    ],
  });

  const today = () => app.today();
  const noticeDays = () => app.settings().leases?.noticeDays ?? 60;
  const statusOf = (l) => leaseStatus(l, today());
  const match = (f, l) => {
    const s = statusOf(l);
    if (f === 'all') return true;
    if (f === 'expiring') return isExpiring(l, today(), noticeDays());
    return s === f;
  };
  let lastRows = [];

  function exportRows() {
    const ledger = app.ledger();
    exportCSV(`rent-roll-${today()}`, [
      { label: 'Lease', value: (l) => l.number || '' },
      { label: 'Property', value: (l) => lookup.property(l.propertyId)?.name || '' },
      { label: 'Unit', value: (l) => lookup.unit(l.unitId)?.name || '' },
      { label: 'Tenants', value: (l) => lookup.tenantNames(l) },
      { label: 'Status', value: (l) => statusOf(l) },
      { label: 'Type', value: (l) => leaseTypeLabel(l.type) },
      { label: 'Start', value: (l) => l.start || '' },
      { label: 'End', value: (l) => effectiveEnd(l) || l.end || '' },
      { label: 'Monthly rent', value: (l) => csvMoney(monthlyRent(l, today())) },
      { label: 'Deposits held', value: (l) => csvMoney(ledger.lease(l.id).deposits) },
      { label: 'Balance', value: (l) => csvMoney(ledger.lease(l.id).balance) },
    ], lastRows);
  }

  const propSelect = select({
    value: state.property,
    'aria-label': 'Property',
    cls: 'sm',
    options: [{ value: '', label: 'All properties' }, ...store.all('properties').slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name }))],
  });
  propSelect.addEventListener('change', () => {
    state.property = propSelect.value;
    setQuery({ property: state.property });
    region.redraw();
  });

  const search = searchBox({
    value: state.q,
    placeholder: 'Search unit, tenant or lease number',
    label: 'Search leases',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      region.redraw();
    },
  });

  const statsRegion = ctx.live(() => {
    const t = today();
    const ledger = app.ledger();
    const all = store.all('leases');
    const active = all.filter((l) => statusOf(l) === 'active');
    const roll = active.reduce((s, l) => s + monthlyRent(l, t), 0);
    let owed = 0;
    let owing = 0;
    for (const l of all) {
      const b = ledger.lease(l.id).balance;
      if (b > 0) {
        owed += b;
        owing++;
      }
    }
    const expiring = all.filter((l) => isExpiring(l, t, noticeDays())).length;
    const setFilter = (f) => {
      state.filter = f;
      setQuery({ status: f === 'active' ? '' : f });
      region.redraw();
    };
    return h(
      'div.stats.list-stats',
      stat({ label: 'Active leases', value: String(active.length), onClick: () => setFilter('active') }),
      stat({ label: 'Monthly rent', value: formatMoneyShort(roll), sub: money(roll) }),
      stat({ label: 'Outstanding', value: formatMoneyShort(owed), sub: owing ? `${pluralize(owing, 'lease')} owing` : 'Nothing owed', tone: owed > 0 ? 'danger' : null, href: '#/balances' }),
      stat({ label: 'Expiring soon', value: String(expiring), sub: `Within ${noticeDays()} days`, tone: expiring ? 'warning' : null, onClick: () => setFilter('expiring') }),
    );
  }, ['leases', 'transactions', 'settings']);

  const chipsHost = h('div.ls-chips');
  const region = ctx.live(() => {
    const t = today();
    const ledger = app.ledger();
    const all = store.all('leases').filter((l) => !state.property || l.propertyId === state.property);
    const text = (l) => `${lookup.leaseLabel(l)} ${lookup.tenantNames(l)} ${l.number || ''}`;
    const rows = all.filter((l) => match(state.filter, l) && (!state.q || matches(text(l), state.q)));
    lastRows = rows;
    const counts = Object.fromEntries(FILTERS.map((f) => [f.id, all.filter((l) => match(f.id, l)).length]));
    const filterChips = chips({
      label: 'Lease status',
      selected: state.filter,
      onSelect: (id) => {
        state.filter = id;
        setQuery({ status: id === 'active' ? '' : id });
        region.redraw();
      },
      items: FILTERS.map((f) => ({ id: f.id, label: f.label, count: counts[f.id] })),
    });
    const columns = [
      {
        id: 'lease',
        label: 'Lease',
        sort: (l) => lookup.leaseLabel(l),
        render: (l) => h('span.ls-lease', h('span.ls-lease-title', lookup.leaseLabel(l)), h('span.ls-lease-sub', [lookup.tenantNames(l) || 'No tenants', l.number ? `#${l.number}` : ''].filter(Boolean).join(' · '))),
      },
      {
        id: 'status',
        label: 'Status',
        sort: (l) => statusOf(l),
        render: (l) => h('span.ls-pills', statusPill(statusOf(l)), l.evictionPending ? statusPill('eviction') : null),
      },
      { id: 'term', label: 'Term', sort: (l) => l.start, render: (l) => h('span.ls-term', h('span', leaseTypeLabel(l.type)), h('span.sub', termText(l))) },
      {
        id: 'left',
        label: 'Days left',
        align: 'r',
        sort: (l) => daysLeft(l, t) ?? 99999,
        render: (l) => {
          const d = daysLeft(l, t);
          if (d === null) return h('span.subtle', '');
          return h(`span.num${d <= 60 ? '.ls-soon' : ''}`, String(d));
        },
      },
      { id: 'rent', label: 'Rent', align: 'r', sort: (l) => monthlyRent(l, t), render: (l) => h('span.num', money(monthlyRent(l, t))) },
      { id: 'balance', label: 'Balance', align: 'r', sort: (l) => ledger.lease(l.id).balance, render: (l) => balanceCell(ledger.lease(l.id).balance) },
    ];
    chipsHost.replaceChildren(filterChips);
    return [
      h('div.sr-only', { role: 'status' }, `${pluralize(rows.length, 'lease')}`),
      dataTable({
        caption: 'Leases',
        rows,
        sort: state.sort,
        onSort: (s) => {
          state.sort = s;
          saveSort('leases', s);
          region.redraw();
        },
        rowHref: (l) => `#/leases/${l.id}`,
        columns,
        mobile: (l) => {
          const bal = ledger.lease(l.id).balance;
          return h(
            'a.mobile-row',
            { href: `#/leases/${l.id}` },
            h('div.grow', { style: { minWidth: '0' } }, h('div.m-title', lookup.leaseLabel(l)), h('div.m-sub', lookup.tenantNames(l) || 'No tenants'), h('div.m-sub', termText(l))),
            h('div.m-end', statusPill(statusOf(l)), h('span.money', money(monthlyRent(l, t))), bal ? balanceCell(bal) : null),
          );
        },
        empty: all.length
          ? emptyState({ compact: true, icon: 'search', title: 'No matching leases', text: 'Try a different search, property or status.', headingLevel: 3 })
          : emptyState({ icon: 'file-signature', title: 'No leases yet', text: 'Create a lease to start charging rent and tracking payments.', headingLevel: 3, actions: [h('a.btn.primary', { href: '#/leases/new' }, icon('plus', 16), 'New lease')] }),
      }),
    ];
  }, ['leases', 'transactions', 'tenants', 'units', 'properties', 'settings']);

  return { node: h('div.page', header, statsRegion, h('section.card.list-card', { 'aria-label': 'Leases' }, h('div.toolbar', search, propSelect, h('div.grow'), chipsHost), region)), title: 'Rent roll' };
}
