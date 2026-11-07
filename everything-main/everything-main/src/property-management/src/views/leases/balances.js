/** Outstanding balances: who owes what, aged by charge date. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, stat, searchBox, dataTable, emptyState, statusPill, select, moreButton } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { setQuery } from '../../ui/router.js';
import { leaseStatus } from '../../core/leases.js';
import { matches, pluralize, primaryPhone, telHref } from '../../core/format.js';
import { formatMoneyShort } from '../../core/money.js';
import { money, balanceCell, date, exportCSV, csvMoney, rememberSort, saveSort } from '../common.js';
import { AGING_BUCKETS, agingBuckets } from '../transactions/logic.js';

export function render(ctx) {
  const store = app.store;
  const state = {
    q: ctx.query.q || '',
    property: ctx.query.property || '',
    credits: ctx.query.credits === '1',
    sort: rememberSort('balances', { id: 'total', dir: 'desc' }),
  };
  const tx = () => import('../transactions/dialogs.js');
  let lastRows = [];

  const header = pageHeader({
    title: 'Outstanding balances',
    subtitle: 'Leases with money owed, aged from the date each charge was posted.',
    actions: [
      moreButton((btn) => openMenu(btn, [{ label: 'Export to CSV', icon: 'file-down', run: () => exportRows() }])),
      h('button.btn.primary', { type: 'button', onClick: () => tx().then((m) => m.receivePaymentDialog()) }, icon('hand-coins', 16), 'Receive payment'),
    ],
  });

  function exportRows() {
    exportCSV(`outstanding-balances-${app.today()}`, [
      { label: 'Property', value: (r) => lookup.property(r.lease.propertyId)?.name || '' },
      { label: 'Unit', value: (r) => lookup.unit(r.lease.unitId)?.name || '' },
      { label: 'Tenants', value: (r) => lookup.tenantNames(r.lease) },
      { label: 'Status', value: (r) => r.status },
      { label: 'Phone', value: (r) => r.phone },
      { label: 'Last payment', value: (r) => r.last?.date || '' },
      ...AGING_BUCKETS.map((b) => ({ label: b.label, value: (r) => csvMoney(r.aging[b.id]) })),
      { label: 'Balance', value: (r) => csvMoney(r.balance) },
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
    redraw();
  });
  const creditsBox = h('input', { type: 'checkbox', checked: state.credits });
  creditsBox.addEventListener('change', () => {
    state.credits = creditsBox.checked;
    setQuery({ credits: state.credits ? '1' : '' });
    redraw();
  });
  const search = searchBox({
    value: state.q,
    placeholder: 'Search unit or tenant',
    label: 'Search balances',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      redraw();
    },
  });

  function rowsFor() {
    const today = app.today();
    const ledger = app.ledger();
    const out = [];
    for (const lease of store.all('leases')) {
      if (lease.draft) continue;
      if (state.property && lease.propertyId !== state.property) continue;
      const info = ledger.lease(lease.id);
      if (!(info.balance > 0 || (state.credits && info.balance < 0))) continue;
      if (state.q && !matches(`${lookup.leaseLabel(lease)} ${lookup.tenantNames(lease)}`, state.q)) continue;
      const tenants = lookup.tenants(lease.tenantIds);
      out.push({
        id: lease.id,
        lease,
        status: leaseStatus(lease, today),
        phone: tenants.map(primaryPhone).find(Boolean) || '',
        last: info.lastPayment,
        aging: agingBuckets(info.lines, today),
        balance: info.balance,
      });
    }
    return out;
  }

  const statsHost = h('div');
  const tableHost = h('div');

  function redraw() {
    const rows = rowsFor();
    lastRows = rows;
    const owing = rows.filter((r) => r.balance > 0);
    const total = owing.reduce((s, r) => s + r.balance, 0);
    const sumBucket = (id) => owing.reduce((s, r) => s + r.aging[id], 0);
    statsHost.replaceChildren(
      h(
        'div.stats.list-stats',
        stat({ label: 'Total outstanding', value: formatMoneyShort(total), sub: money(total), tone: total ? 'danger' : null }),
        stat({ label: 'Leases owing', value: String(owing.length) }),
        stat({ label: 'Over 30 days', value: formatMoneyShort(sumBucket('d31') + sumBucket('d61') + sumBucket('d90')), tone: sumBucket('d31') + sumBucket('d61') + sumBucket('d90') ? 'warning' : null }),
        stat({ label: 'Over 90 days', value: formatMoneyShort(sumBucket('d90')), tone: sumBucket('d90') ? 'danger' : null }),
      ),
    );
    const columns = [
      {
        id: 'lease',
        label: 'Lease',
        sort: (r) => lookup.leaseLabel(r.lease),
        render: (r) => h('span.ls-lease', h('span.ls-lease-title', lookup.leaseLabel(r.lease)), h('span.ls-lease-sub', lookup.tenantNames(r.lease) || 'No tenants')),
      },
      { id: 'status', label: 'Status', sort: (r) => r.status, render: (r) => h('span.ls-pills', statusPill(r.status), r.lease.evictionPending ? statusPill('eviction') : null) },
      { id: 'phone', label: 'Phone', render: (r) => (r.phone ? h('a.nowrap', { href: telHref(r.phone) }, r.phone) : h('span.subtle', '')) },
      { id: 'last', label: 'Last payment', sort: (r) => r.last?.date || '', render: (r) => (r.last ? h('span.ls-term', h('span', date(r.last.date)), h('span.sub', money(r.last.lines.find((l) => l.amount > 0)?.amount || 0))) : h('span.subtle', 'None')) },
      ...AGING_BUCKETS.map((b) => ({ id: b.id, label: b.label.replace(' to ', '-').replace('Over ', '').replace(' days', '') + (b.id === 'd90' ? '+' : ''), srLabel: b.label, align: 'r', sort: (r) => r.aging[b.id], render: (r) => (r.aging[b.id] ? h(`span.num${b.id === 'd90' ? '.owed' : ''}`, money(r.aging[b.id])) : h('span.subtle', '')) })),
      { id: 'total', label: 'Balance', align: 'r', sort: (r) => r.balance, render: (r) => balanceCell(r.balance) },
      {
        id: 'act',
        label: '',
        srLabel: 'Actions',
        render: (r) =>
          r.balance > 0
            ? h('button.btn.sm', { type: 'button', onClick: () => tx().then((m) => m.receivePaymentDialog({ leaseId: r.lease.id })), 'aria-label': `Receive payment for ${lookup.leaseLabel(r.lease)}` }, 'Receive')
            : null,
      },
    ];
    const table = dataTable({
      caption: 'Outstanding balances',
      rows,
      pageSize: 2000,
      sort: state.sort,
      onSort: (s) => {
        state.sort = s;
        saveSort('balances', s);
        redraw();
      },
      rowHref: (r) => `#/leases/${r.lease.id}?tab=ledger`,
      columns,
      mobile: (r) =>
        h(
          'a.mobile-row',
          { href: `#/leases/${r.lease.id}?tab=ledger` },
          h('div.grow', { style: { minWidth: '0' } }, h('div.m-title', lookup.leaseLabel(r.lease)), h('div.m-sub', lookup.tenantNames(r.lease) || 'No tenants'), h('div.m-sub', r.last ? `Last paid ${date(r.last.date)}` : 'No payments')),
          h('div.m-end', balanceCell(r.balance), r.aging.d90 ? h('span.pill.danger', '90+ days') : r.aging.d31 + r.aging.d61 ? h('span.pill.warning', '30+ days') : null),
        ),
      empty: emptyState({ compact: true, icon: 'circle-check', title: state.q || state.property ? 'No matching balances' : 'Everyone is paid up', text: state.q || state.property ? 'Try a different search or property.' : 'No lease has a balance due right now.', headingLevel: 3 }),
    });
    // Totals row under the table.
    const tbl = table.querySelector('table');
    if (tbl && rows.length) {
      tbl.append(
        h(
          'tfoot',
          h(
            'tr',
            h('th', { scope: 'row', colspan: 4 }, `Total, ${pluralize(owing.length, 'lease')}`),
            AGING_BUCKETS.map((b) => h('td.r', h('span.num', money(sumBucket(b.id))))),
            h('td.r', h('strong.num', money(total))),
            h('td'),
          ),
        ),
      );
    }
    tableHost.replaceChildren(h('div.sr-only', { role: 'status' }, `${pluralize(rows.length, 'lease')}`), table);
  }

  redraw();
  ctx.onDispose(store.subscribe((c) => ['leases', 'transactions', 'tenants'].some((k) => c.has(k)) && redraw()));

  return {
    node: h(
      'div.page',
      header,
      statsHost,
      h('section.card.list-card', { 'aria-label': 'Outstanding balances' }, h('div.toolbar', search, propSelect, h('div.grow'), h('label.check', creditsBox, 'Include credit balances')), tableHost),
    ),
    title: 'Outstanding balances',
  };
}
