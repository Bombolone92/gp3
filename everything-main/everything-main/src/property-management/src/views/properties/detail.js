/** Property page: summary, units, financials, leases, maintenance, notes and files. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup, occupancyMap } from '../../app.js';
import { pageHeader, tabs, emptyState, moreButton, dataTable, segmented, statusPill, stat } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { confirmDialog } from '../../ui/dialog.js';
import { navigate, setQuery } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { formatAddress, mapsUrl, displayName, pluralize } from '../../core/format.js';
import { propertyTypeLabel, propertyGroup } from '../../core/settings.js';
import { leaseStatus, monthlyRent, effectiveEnd } from '../../core/leases.js';
import { kindLabel, txTotal } from '../../core/ledger.js';
import { ACC } from '../../core/accounts.js';
import { startOfMonth, endOfMonth, addMonths } from '../../core/dates.js';
import { OPEN_WORK_ORDER, OPEN_TASK } from '../../core/counts.js';
import { isOverdue } from '../../core/status.js';
import { money, moneyCell, balanceCell, date, kvList, notesCard, sectionEmpty, unitStatus } from '../common.js';
import { attachmentsCard } from '../attachments.js';
import { propertyFigures, propertyCash, incomeByAccount, upcomingEnds, occupancyBar, unitDialog, bulkUnitsDialog, listingDialog, unlistUnit, tx, recordsUsing, listWords } from './shared.js';

const TABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'units', label: 'Units' },
  { id: 'financials', label: 'Financials' },
  { id: 'leases', label: 'Leases' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'notes', label: 'Notes' },
  { id: 'files', label: 'Files' },
];

const PERIODS = [
  { value: 'month', label: 'This month' },
  { value: 'last', label: 'Last month' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'year', label: 'Last year' },
];

function periodRange(p, today) {
  if (p === 'last') {
    const s = startOfMonth(addMonths(today, -1));
    return [s, endOfMonth(s)];
  }
  if (p === 'ytd') return [`${today.slice(0, 4)}-01-01`, today];
  if (p === 'year') {
    const y = Number(today.slice(0, 4)) - 1;
    return [`${y}-01-01`, `${y}-12-31`];
  }
  return [startOfMonth(today), endOfMonth(today)];
}

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  let tab = TABS.some((t) => t.id === ctx.query.tab) ? ctx.query.tab : 'summary';
  let period = PERIODS.some((p) => p.value === ctx.query.period) ? ctx.query.period : 'month';
  let title = 'Property';

  const body = ctx.live(draw, ['properties', 'units', 'leases', 'tenants', 'owners', 'transactions', 'workOrders', 'tasks', 'team', 'accounts', 'vendors']);

  function selectTab(next) {
    tab = next;
    setQuery({ tab: next === 'summary' ? '' : next });
    body.redraw();
    body.querySelector('.tabs [aria-selected="true"]')?.focus();
  }

  function draw() {
    const p = store.get('properties', id);
    if (!p) {
      return emptyState({ icon: 'building', title: 'Property not found', text: 'It may have been deleted.', headingLevel: 1, actions: [h('a.btn.primary', { href: '#/properties' }, 'Back to properties')] });
    }
    title = p.name;
    const units = lookup.unitsOf(p.id);
    const header = pageHeader({
      title: h('span.row.rn-title', p.name, p.active === false ? statusPill('closed') : null),
      crumbs: [{ label: 'Properties', href: '#/properties' }],
      subtitle: h('span', `${propertyTypeLabel(p.type)} · ${formatAddress(p.address) || 'No address'}`),
      actions: [
        moreButton((btn) => moreMenu(btn, p)),
        h('a.btn.hide-mobile', { href: `#/properties/${p.id}/edit` }, icon('pencil', 16), 'Edit'),
        h('button.btn.hide-mobile', { type: 'button', onClick: () => tx().then((m) => m.receivePaymentDialog({})) }, icon('hand-coins', 16), 'Receive payment'),
        h('a.btn.primary', { href: `#/leases/new?propertyId=${p.id}` }, icon('plus', 16), 'New lease'),
      ],
    });
    const counts = { units: units.length, leases: store.all('leases').filter((l) => l.propertyId === p.id).length };
    const bar = h(
      'div.detail-tabs',
      tabs({
        label: 'Property sections',
        items: TABS.map((t) => ({ ...t, count: counts[t.id] })),
        selected: tab,
        onSelect: selectTab,
      }),
    );
    return [header, bar, h('div.tab-panel', { role: 'tabpanel', 'aria-labelledby': `tab-${tab}` }, renderTab(p, units))];
  }

  function renderTab(p, units) {
    if (tab === 'units') return unitsTab(p, units);
    if (tab === 'financials') return financialsTab(p);
    if (tab === 'leases') return leasesTab(p);
    if (tab === 'maintenance') return maintenanceTab(p);
    if (tab === 'notes') return h('div.rn-narrow', notesCard('properties', p));
    if (tab === 'files') return h('div.rn-narrow', attachmentsCard('properties', p, { folder: `files/properties/${p.id}` }));
    return summaryTab(p, units);
  }

  // ---- Summary -----------------------------------------------------------------------

  function summaryTab(p, units) {
    const today = app.today();
    const f = propertyFigures(p.id);
    const leases = store.all('leases').filter((l) => l.propertyId === p.id);
    const ends = upcomingEnds(leases, 90);
    const openWO = store.all('workOrders').filter((w) => w.propertyId === p.id && OPEN_WORK_ORDER.has(w.status));
    const map = mapsUrl(p.address);

    const figures = h(
      'div.stats.rn-stats',
      stat({ label: 'Occupancy', value: units.length ? `${Math.round(f.rate * 100)}%` : 'No units', sub: `${f.occupied} of ${pluralize(f.units, 'unit')}` }),
      stat({ label: 'Vacant', value: String(f.vacant), sub: f.listed ? `${f.listed} listed` : 'None listed', onClick: () => selectTab('units') }),
      stat({ label: 'Monthly rent', value: money(f.rent), sub: 'Current leases' }),
      stat({ label: 'Balance due', value: money(f.balance), tone: f.balance > 0 ? 'danger' : null, href: '#/balances', sub: 'Owed by tenants' }),
    );

    const details = h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Property details'), h('a.btn.sm.ghost', { href: `#/properties/${p.id}/edit` }, 'Edit')),
      h(
        'div.card-body.stack',
        kvList([
          ['Type', `${propertyTypeLabel(p.type)} (${propertyGroup(p.type).toLowerCase()})`],
          ['Address', h('span', formatAddress(p.address) || 'No address', map ? [' ', h('a', { href: map, target: '_blank', rel: 'noopener noreferrer' }, 'Map')] : null)],
          ['Year built', p.yearBuilt ? String(p.yearBuilt) : ''],
          ['Manager', lookup.member(p.managerId)?.name || h('span.subtle', 'No manager assigned')],
          ['Description', p.description || ''],
        ]),
        p.amenities?.length ? h('div', h('div.section-title', 'Amenities'), h('div.tags.rn-tags', p.amenities.map((a) => h('span.tag', a)))) : null,
      ),
    );

    const expirations = h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Leases ending soon'), h('a.btn.sm.ghost', { href: '#/renewals' }, 'Renewals')),
      ends.length
        ? h(
            'ul.list',
            ends.slice(0, 6).map(({ lease, end }) =>
              h(
                'li',
                h(
                  'a.list-item',
                  { href: `#/leases/${lease.id}` },
                  h('div.grow', h('div.title', lookup.leaseLabel(lease)), h('div.meta', lookup.tenantNames(lease) || 'No tenants')),
                  h('span.rn-when', date(end)),
                ),
              ),
            ),
          )
        : sectionEmpty('No leases end in the next 90 days.'),
    );

    const maintenance = h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Open work orders', openWO.length ? h('span.count', ` ${openWO.length}`) : null), h('a.btn.sm.ghost', { href: `#/work-orders/new?propertyId=${p.id}` }, icon('plus', 14), 'New')),
      openWO.length
        ? h(
            'ul.list',
            openWO.slice(0, 6).map((w) =>
              h(
                'li',
                h(
                  'a.list-item',
                  { href: `#/work-orders/${w.id}` },
                  h('div.grow', h('div.title', w.title), h('div.meta', [w.unitId ? lookup.unit(w.unitId)?.name : 'Whole property', w.dueDate ? `due ${date(w.dueDate)}` : ''].filter(Boolean).join(' · '))),
                  w.priority === 'urgent' || w.priority === 'high' ? statusPill(w.priority) : statusPill(w.status),
                ),
              ),
            ),
          )
        : sectionEmpty('Nothing open.'),
    );

    return h('div.stack', figures, h('div.detail', h('div.detail-main', details, expirations, maintenance), h('div.detail-aside', ownersCard(p), bankingCard(p))));
  }

  function ownersCard(p) {
    const owners = p.owners || [];
    return h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Rental owners'), h('a.btn.sm.ghost', { href: `#/properties/${p.id}/edit` }, 'Edit')),
      owners.length
        ? h(
            'ul.list',
            owners.map((o) => {
              const owner = lookup.owner(o.ownerId);
              return h(
                'li',
                h(
                  'a.list-item',
                  { href: owner ? `#/owners/${owner.id}` : '#/owners' },
                  h('div.grow', h('div.title', owner ? displayName(owner) : 'Unknown owner'), owner?.managementFee ? h('div.meta', `${owner.managementFee}% management fee`) : null),
                  h('span.num', `${o.pct}%`),
                ),
              );
            }),
          )
        : sectionEmpty('No owners recorded.', h('a.btn.sm', { href: `#/properties/${p.id}/edit` }, 'Add owner')),
    );
  }

  function bankingCard(p) {
    const today = app.today();
    const cash = propertyCash(p.id, today);
    let deposits = 0;
    for (const t of store.all('transactions')) {
      if (t.voided) continue;
      for (const l of t.lines) if (l.propertyId === p.id && l.accountId === ACC.depositsHeld) deposits -= l.amount;
    }
    // A deposit is held once it is paid; one charged but not paid yet is
    // not money in the bank.
    const ledger = app.ledger();
    for (const l of store.all('leases')) if (l.propertyId === p.id) deposits -= Math.max(0, ledger.lease(l.id).byAccount.get(ACC.depositsHeld) || 0);
    const available = cash - deposits - (p.reserve || 0);
    const bank = lookup.account(p.bankAccountId);
    return h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Banking')),
      h(
        'div.card-body',
        kvList([
          ['Bank account', bank ? h('a', { href: `#/banking/${bank.id}` }, bank.name) : h('span.subtle', 'Not set')],
          ['Cash balance', h('span.num', money(cash))],
          ['Deposits held', h('span.num', money(deposits))],
          ['Reserve', h('span.num', money(p.reserve || 0))],
          ['Available', h(`span.num.rn-strong${available < 0 ? '.owed' : ''}`, money(available))],
        ]),
      ),
      h(
        'div.rn-card-actions',
        h('button.btn.sm', { type: 'button', onClick: () => tx().then((m) => m.billDialog({ propertyId: p.id })) }, icon('receipt', 14), 'Record bill'),
        p.owners?.length ? h('button.btn.sm', { type: 'button', onClick: () => tx().then((m) => m.ownerTransactionDialog({ kind: 'distribution', ownerId: p.owners[0].ownerId, propertyId: p.id })) }, icon('wallet', 14), 'Owner draw') : null,
      ),
    );
  }

  // ---- Units ---------------------------------------------------------------------------

  function unitsTab(p, units) {
    const today = app.today();
    const occ = occupancyMap();
    const ledger = app.ledger();
    const sorted = [...units].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const leaseOf = (u) => occ.get(u.id) || null;
    const columns = [
      { id: 'name', label: 'Unit', sort: (u) => u.name, render: (u) => h('a.primary-link', { href: `#/units/${u.id}` }, u.name) },
      { id: 'size', label: 'Beds / baths', render: (u) => [u.beds ?? '', u.baths ?? ''].some((x) => x !== '' && x !== null) ? `${u.beds ?? 0} bd / ${u.baths ?? 0} ba` : h('span.subtle', 'Not set') },
      { id: 'sqft', label: 'Sq ft', align: 'r', sort: (u) => u.sqft || 0, render: (u) => (u.sqft ? h('span.num', u.sqft.toLocaleString()) : '') },
      { id: 'market', label: 'Market rent', align: 'r', sort: (u) => u.marketRent || 0, render: (u) => moneyCell(u.marketRent || 0, { zero: 'Not set' }) },
      { id: 'status', label: 'Status', sort: (u) => unitStatus(u), render: (u) => statusPill(unitStatus(u)) },
      { id: 'tenants', label: 'Tenants', render: (u) => (leaseOf(u) ? h('a', { href: `#/leases/${leaseOf(u).id}` }, lookup.tenantNames(leaseOf(u)) || 'No tenants') : h('span.subtle', 'None')) },
      { id: 'end', label: 'Lease end', sort: (u) => (leaseOf(u) ? effectiveEnd(leaseOf(u)) || leaseOf(u).end || '' : ''), render: (u) => (leaseOf(u) ? date(effectiveEnd(leaseOf(u)) || leaseOf(u).end) || h('span.subtle', 'Month-to-month') : '') },
      { id: 'balance', label: 'Balance', align: 'r', sort: (u) => (leaseOf(u) ? ledger.lease(leaseOf(u).id).balance : 0), render: (u) => (leaseOf(u) ? balanceCell(ledger.lease(leaseOf(u).id).balance) : '') },
      { id: 'actions', label: '', srLabel: 'Actions', render: (u) => moreButton((btn) => unitMenu(btn, p, u), `Actions for unit ${u.name}`) },
    ];
    return h(
      'section.card.list-card',
      h(
        'div.toolbar',
        h('h2.rn-toolbar-title', pluralize(units.length, 'unit')),
        h('div.grow'),
        p.singleUnit && units.length ? null : h('button.btn.sm', { type: 'button', onClick: () => bulkUnitsDialog(p.id) }, 'Add several'),
        h('button.btn.sm.primary', { type: 'button', onClick: () => unitDialog(p.id) }, icon('plus', 14), 'Add unit'),
      ),
      dataTable({
        caption: `Units at ${p.name}`,
        rows: sorted,
        columns,
        rowHref: (u) => `#/units/${u.id}`,
        mobile: (u) =>
          h(
            'a.mobile-row',
            { href: `#/units/${u.id}` },
            h('div.grow', h('div.m-title', u.name), h('div.m-sub', leaseOf(u) ? lookup.tenantNames(leaseOf(u)) || 'Occupied' : `Market rent ${money(u.marketRent || 0)}`)),
            h('div.m-end', statusPill(unitStatus(u)), leaseOf(u) && ledger.lease(leaseOf(u).id).balance > 0 ? h('span.num.owed', money(ledger.lease(leaseOf(u).id).balance)) : null),
          ),
        empty: emptyState({ icon: 'door', title: 'No units yet', text: 'Add the units you rent out at this property.', headingLevel: 3, actions: [h('button.btn.primary', { type: 'button', onClick: () => unitDialog(p.id) }, icon('plus', 16), 'Add unit')] }),
      }),
    );
  }

  function unitMenu(btn, p, u) {
    const uses = recordsUsing({ unitId: u.id });
    const occupied = !!occupancyMap().get(u.id);
    openMenu(btn, [
      { label: 'Open unit', icon: 'door', href: `#/units/${u.id}` },
      { label: 'Edit unit', icon: 'pencil', run: () => unitDialog(p.id, u) },
      { label: 'New lease', icon: 'file-signature', href: `#/leases/new?unitId=${u.id}` },
      occupied ? null : u.listing?.listed ? { label: 'Remove listing', icon: 'eye-off', run: () => unlistUnit(u) } : { label: 'List for rent', icon: 'megaphone', run: () => listingDialog(u) },
      { separator: true },
      {
        label: 'Delete unit',
        icon: 'trash',
        danger: true,
        disabled: uses.length > 0,
        description: uses.length ? `Has ${listWords(uses)}` : null,
        run: async () => {
          const ok = await confirmDialog({ title: `Delete unit ${u.name}?`, message: 'The unit and its notes and files list are removed.', confirmLabel: 'Delete unit', danger: true });
          if (!ok) return;
          const removed = store.remove('units', u.id);
          toast(`Unit ${u.name} deleted`, { action: { label: 'Undo', run: () => store.restore('units', removed) } });
        },
      },
    ]);
  }

  // ---- Financials ----------------------------------------------------------------------

  function financialsTab(p) {
    const today = app.today();
    const [from, to] = periodRange(period, today);
    const is = incomeByAccount([p.id], from, to);
    const recent = store
      .all('transactions')
      .filter((t) => !t.voided && (t.propertyId === p.id || t.lines.some((l) => l.propertyId === p.id)))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || '').localeCompare(a.createdAt || '')))
      .slice(0, 15);

    const section = (label, rows, total) => [
      h('tr.rn-is-head', h('th', { scope: 'rowgroup', colspan: 2 }, label)),
      rows.length ? rows.map((r) => h('tr', h('td', h('a', { href: `#/accounts/${r.accountId}` }, r.name)), h('td.r', h('span.num', money(r.amount))))) : h('tr', h('td.subtle', { colspan: 2 }, 'None')),
      h('tr.rn-is-total', h('th', { scope: 'row' }, `Total ${label.toLowerCase()}`), h('td.r', h('span.num', money(total)))),
    ];

    const statement = h(
      'section.card',
      h(
        'div.card-head',
        h('h2.grow', 'Income statement'),
        segmented({
          label: 'Period',
          value: period,
          items: PERIODS,
          onChange: (v) => {
            period = v;
            setQuery({ period: v === 'month' ? '' : v });
            body.redraw();
          },
        }),
      ),
      h(
        'div.card-body.flush',
        h(
          'div.table-wrap',
          h(
            'table.table.rn-is',
            h('caption.sr-only', `Income statement for ${p.name}, ${date(from)} to ${date(to)}`),
            h('tbody', section('Income', is.income, is.totalIncome), section('Expenses', is.expense, is.totalExpense)),
            h('tfoot', h('tr.rn-is-net', h('th', { scope: 'row' }, 'Net operating income'), h('td.r', h(`span.num${is.net < 0 ? '.owed' : ''}`, money(is.net))))),
          ),
        ),
      ),
      h('div.rn-card-foot.subtle', `${date(from)} to ${date(to)}, accrual basis.`, ' ', h('a', { href: `#/reports/income-statement?from=${from}&to=${to}&p=${p.id}` }, 'Full report')),
    );

    const txCard = h(
      'section.card',
      h(
        'div.card-head',
        h('h2.grow', 'Recent transactions'),
        h('button.btn.sm', { type: 'button', onClick: () => tx().then((m) => m.expenseDialog({ propertyId: p.id })) }, 'Record expense'),
        h('button.btn.sm', { type: 'button', onClick: () => tx().then((m) => m.billDialog({ propertyId: p.id })) }, 'Record bill'),
      ),
      recent.length
        ? h(
            'ul.list',
            recent.map((t) => {
              const amt = t.lines.filter((l) => l.propertyId === p.id && l.amount > 0).reduce((s, l) => s + l.amount, 0) || txTotal(t);
              return h(
                'li',
                h(
                  'a.list-item',
                  { href: `#/transactions/${t.id}` },
                  h('span.rn-date', date(t.date, { month: 'short', day: 'numeric' })),
                  h('div.grow', h('div.title', t.memo || kindLabel(t.kind)), h('div.meta', [kindLabel(t.kind), t.leaseId ? lookup.leaseLabel(lookup.lease(t.leaseId)) : t.vendorId ? displayName(lookup.vendor(t.vendorId)) : ''].filter(Boolean).join(' · '))),
                  h('span.num', money(amt)),
                ),
              );
            }),
          )
        : sectionEmpty('No transactions yet.'),
      h('div.rn-card-foot', h('a', { href: `#/ledger?propertyId=${p.id}` }, 'View all in the general ledger')),
    );

    return h('div.rn-two', statement, txCard);
  }

  // ---- Leases --------------------------------------------------------------------------

  function leasesTab(p) {
    const today = app.today();
    const ledger = app.ledger();
    const order = { active: 0, future: 1, draft: 2, past: 3 };
    const leases = store
      .all('leases')
      .filter((l) => l.propertyId === p.id)
      .sort((a, b) => order[leaseStatus(a, today)] - order[leaseStatus(b, today)] || (a.start < b.start ? 1 : -1));
    return h(
      'section.card.list-card',
      h('div.toolbar', h('h2.rn-toolbar-title', pluralize(leases.length, 'lease')), h('div.grow'), h('a.btn.sm.primary', { href: `#/leases/new?propertyId=${p.id}` }, icon('plus', 14), 'New lease')),
      dataTable({
        caption: `Leases at ${p.name}`,
        rows: leases,
        rowHref: (l) => `#/leases/${l.id}`,
        columns: [
          { id: 'unit', label: 'Lease', render: (l) => h('div', h('div.primary-cell', lookup.unit(l.unitId)?.name || 'Unit'), h('div.sub', lookup.tenantNames(l) || 'No tenants')) },
          { id: 'status', label: 'Status', render: (l) => h('span.row', statusPill(leaseStatus(l, today)), l.evictionPending ? statusPill('eviction') : null) },
          { id: 'term', label: 'Term', render: (l) => `${date(l.start)}${l.end && l.type !== 'at-will' ? ` to ${date(l.end)}` : ', month-to-month'}` },
          { id: 'rent', label: 'Rent', align: 'r', render: (l) => h('span.num', money(monthlyRent(l, app.today()))) },
          { id: 'balance', label: 'Balance', align: 'r', render: (l) => balanceCell(ledger.lease(l.id).balance) },
        ],
        mobile: (l) =>
          h(
            'a.mobile-row',
            { href: `#/leases/${l.id}` },
            h('div.grow', h('div.m-title', `${lookup.unit(l.unitId)?.name || 'Unit'} · ${lookup.tenantNames(l) || 'No tenants'}`), h('div.m-sub', `${date(l.start)}${l.end ? ` to ${date(l.end)}` : ''}`)),
            h('div.m-end', statusPill(leaseStatus(l, today)), balanceCell(ledger.lease(l.id).balance)),
          ),
        empty: emptyState({ icon: 'file-signature', title: 'No leases yet', text: 'Create a lease to start collecting rent.', headingLevel: 3, actions: [h('a.btn.primary', { href: `#/leases/new?propertyId=${p.id}` }, 'New lease')] }),
      }),
    );
  }

  // ---- Maintenance -------------------------------------------------------------------

  function maintenanceTab(p) {
    const today = app.today();
    const wos = store
      .all('workOrders')
      .filter((w) => w.propertyId === p.id)
      .sort((a, b) => Number(OPEN_WORK_ORDER.has(b.status)) - Number(OPEN_WORK_ORDER.has(a.status)) || (b.dueDate || '').localeCompare(a.dueDate || ''));
    const tasks = store
      .all('tasks')
      .filter((t) => t.propertyId === p.id)
      .sort((a, b) => Number(OPEN_TASK.has(b.status)) - Number(OPEN_TASK.has(a.status)) || (a.dueDate || '9').localeCompare(b.dueDate || '9'));
    const row = (href, title, meta, pills) => h('li', h('a.list-item', { href }, h('div.grow', h('div.title', title), h('div.meta', meta)), h('span.row', pills)));
    return h(
      'div.rn-two',
      h(
        'section.card',
        h('div.card-head', h('h2.grow', 'Work orders', h('span.count', ` ${wos.length}`)), h('a.btn.sm', { href: `#/work-orders/new?propertyId=${p.id}` }, icon('plus', 14), 'New work order')),
        wos.length
          ? h(
              'ul.list',
              wos.slice(0, 20).map((w) =>
                row(
                  `#/work-orders/${w.id}`,
                  `WO-${w.number}: ${w.title}`,
                  [w.unitId ? `Unit ${lookup.unit(w.unitId)?.name || ''}` : 'Whole property', w.vendorId ? displayName(lookup.vendor(w.vendorId)) : 'No vendor', w.dueDate ? `due ${date(w.dueDate)}` : ''].filter(Boolean).join(' · '),
                  [isOverdue(w, today) ? statusPill('overdue') : null, statusPill(w.status)],
                ),
              ),
            )
          : sectionEmpty('No work orders for this property.'),
      ),
      h(
        'section.card',
        h('div.card-head', h('h2.grow', 'Tasks', h('span.count', ` ${tasks.length}`)), h('a.btn.sm', { href: `#/tasks/new?propertyId=${p.id}` }, icon('plus', 14), 'New task')),
        tasks.length
          ? h(
              'ul.list',
              tasks.slice(0, 20).map((t) =>
                row(`#/tasks/${t.id}`, t.title, [t.unitId ? `Unit ${lookup.unit(t.unitId)?.name || ''}` : '', t.dueDate ? `due ${date(t.dueDate)}` : 'No due date'].filter(Boolean).join(' · '), [isOverdue(t, today) ? statusPill('overdue') : null, statusPill(t.status)]),
              ),
            )
          : sectionEmpty('No tasks for this property.'),
      ),
    );
  }

  // ---- Menu ---------------------------------------------------------------------------

  function moreMenu(btn, p) {
    const uses = recordsUsing({ propertyId: p.id });
    const canDelete = !uses.length;
    openMenu(btn, [
      { label: 'Edit property', icon: 'pencil', href: `#/properties/${p.id}/edit` },
      { label: 'Add unit', icon: 'door', run: () => unitDialog(p.id) },
      { label: 'Receive payment', icon: 'hand-coins', run: () => tx().then((m) => m.receivePaymentDialog({})) },
      { label: 'Record bill', icon: 'receipt', run: () => tx().then((m) => m.billDialog({ propertyId: p.id })) },
      { label: 'New work order', icon: 'wrench', href: `#/work-orders/new?propertyId=${p.id}` },
      { separator: true },
      p.active === false
        ? { label: 'Reactivate property', icon: 'unarchive', run: () => (store.patch('properties', p.id, { active: true }), toast('Property reactivated')) }
        : {
            label: 'Deactivate property',
            icon: 'archive',
            run: async () => {
              const ok = await confirmDialog({ title: `Deactivate ${p.name}?`, message: 'It is hidden from lists and pickers, but its history and books are kept. You can reactivate it any time.', confirmLabel: 'Deactivate' });
              if (!ok) return;
              store.patch('properties', p.id, { active: false });
              toast('Property deactivated');
            },
          },
      {
        label: 'Delete property',
        icon: 'trash',
        danger: true,
        disabled: !canDelete,
        description: canDelete ? null : `Has ${listWords(uses)}; deactivate it instead`,
        run: async () => {
          const ok = await confirmDialog({ title: `Delete ${p.name}?`, message: 'The property and its units are deleted. This cannot be undone after you leave this page.', confirmLabel: 'Delete property', danger: true });
          if (!ok) return;
          const units = lookup.unitsOf(p.id);
          store.bulkRemove('units', units.map((u) => u.id));
          const removed = store.remove('properties', p.id);
          navigate('/properties');
          toast(`${p.name} deleted`, {
            action: {
              label: 'Undo',
              run: () => {
                store.restore('properties', removed);
                for (const u of units) store.restore('units', u);
              },
            },
          });
        },
      },
    ]);
  }

  return {
    node: h('div.page', body),
    get title() {
      return title;
    },
  };
}
