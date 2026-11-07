/** Dashboard: rent this month, what is owed, occupancy, and everything that needs attention. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { monthlyIncomeExpense } from '../core/financials.js';
import { app, lookup, occupancyMap, derived } from '../app.js';
import { emptyState, statusPill, stat, chips } from '../ui/components.js';
import { columnChart } from '../ui/chart.js';
import { addDays, diffDays, formatDate, relativeDay } from '../core/dates.js';
import { formatMoneyShort } from '../core/money.js';
import { displayName, personName, pluralize } from '../core/format.js';
import { ACC } from '../core/accounts.js';
import { billStatus } from '../core/ledger.js';
import { daysLeft, leaseStatus, renewalStatus } from '../core/leases.js';
import { occupancyStats, OPEN_WORK_ORDER, INCOMING_KINDS } from '../core/counts.js';
import { agingFor } from '../core/reports.js';
import { isOverdue, taskKindLabel } from '../core/status.js';
import { money } from './common.js';
import { calendarItems } from './calendar.js';
import { currentMember, relatedText } from './tasks/list.js';
import { toast } from '../ui/toast.js';


// ---- Pure calculations (unit tested) ---------------------------------------------

/** Rent and other charges posted this month, and what was collected against them. */
export function monthCollection(transactions, month) {
  let charged = 0;
  let collected = 0;
  for (const tx of transactions) {
    if (tx.voided || !tx.date || tx.date.slice(0, 7) !== month) continue;
    if (tx.kind === 'charge') {
      for (const l of tx.lines) if (l.accountId === ACC.ar && l.amount > 0 && l.forAccountId !== ACC.depositsHeld) charged += l.amount;
    } else if (tx.kind === 'payment') {
      for (const l of tx.lines) {
        // Everything received except money set aside as a security deposit.
        if ((l.accountId === ACC.ar && l.forAccountId !== ACC.depositsHeld) || l.accountId === ACC.prepaid) collected += -l.amount;
      }
    }
  }
  return { charged, collected };
}

/**
 * The date of the oldest charge a lease still owes (first in, first out),
 * or null when nothing is owed. Rent paid early is credit for the charges
 * that follow, and moving it onto a charge is not a new debt.
 */
export function oldestUnpaid(info, asOf = '9999-12-31') {
  return agingFor(info, asOf).oldest;
}

// ---- View ---------------------------------------------------------------------------

export function render(ctx) {
  const store = app.store;
  const today = app.today();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const me = currentMember();
  const who = (me?.name || store.all('team').find((m) => /owner/i.test(m.role || ''))?.name || app.user?.username || '').split(' ')[0];

  const pay = async (leaseId) => {
    const m = await import('./transactions/dialogs.js');
    m.receivePaymentDialog(leaseId ? { leaseId } : {});
  };

  const header = h(
    'header.page-header',
    h('div.titles', h('div.subtle.home-date', formatDate(today, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })), h('h1', `${greeting}${who ? ', ' + who : ''}`)),
    h(
      'div.actions.home-actions',
      h('button.btn', { type: 'button', onClick: () => pay() }, icon('hand-coins', 16), 'Receive payment'),
      h('a.btn', { href: '#/work-orders/new' }, icon('wrench', 16), h('span.hide-mobile', 'New work order'), h('span.show-mobile', 'Work order')),
      h('a.btn.primary', { href: '#/leases/new' }, icon('file-signature', 16), 'New lease'),
    ),
  );

  const leaseColls = ['leases', 'transactions', 'tenants', 'units', 'properties'];
  return {
    node: h(
      'div.page.home',
      header,
      ctx.live(() => kpis(), ['leases', 'transactions', 'units', 'properties', 'workOrders']),
      h(
        'div.home-grid',
        h(
          'div.home-col',
          ctx.live(() => balancesCard(pay), leaseColls),
          ctx.live(() => chartCard(), ['transactions', 'accounts']),
          ctx.live(() => expiringCard(), ['leases', 'tenants', 'units', 'properties']),
          ctx.live(() => upcomingCard(), ['leases', 'events', 'inspections', 'tenants', 'units']),
        ),
        h(
          'div.home-col',
          ctx.live(() => requestsCard(me), ['tasks', 'team', 'tenants', 'units', 'properties']),
          ctx.live(() => overdueTasksCard(), ['tasks', 'team']),
          ctx.live(() => applicationsCard(), ['applicants', 'units', 'properties']),
          ctx.live(() => vacancyCard(), ['units', 'leases', 'properties']),
          ctx.live(() => billsCard(), ['transactions', 'vendors']),
        ),
      ),
    ),
    title: 'Dashboard',
  };
}

function homeCard({ title, icon: ic, href, linkLabel = 'View all', body, extra, count }) {
  const id = `hc-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return h(
    'section.card.home-card',
    { 'aria-labelledby': id },
    h(
      'div.card-head',
      h('h2.grow', { id }, h('span.home-card-icon', { 'aria-hidden': 'true' }, icon(ic, 16)), title, count !== undefined ? h('span.count', ` ${count}`) : null),
      extra || null,
      href ? h('a.link-more', { href, 'aria-label': `${linkLabel}: ${title}` }, linkLabel, icon('arrow-right', 14)) : null,
    ),
    body,
  );
}

function kpis() {
  const store = app.store;
  const today = app.today();
  const ledger = app.ledger();
  const month = today.slice(0, 7);
  const { charged, collected } = derived('home.collection', ['transactions'], () => monthCollection(store.all('transactions'), month), { daily: true });
  let owed = 0;
  let owing = 0;
  for (const l of store.all('leases')) {
    if (l.draft) continue;
    const b = ledger.lease(l.id).balance;
    if (b > 0) {
      owed += b;
      owing++;
    }
  }
  const occ = occupancyStats(store, today);
  const wos = store.all('workOrders').filter((w) => OPEN_WORK_ORDER.has(w.status));
  const urgent = wos.filter((w) => w.priority === 'urgent').length;
  const pct = charged ? Math.min(100, Math.round((collected / charged) * 100)) : 0;

  const collectedTile = h(
    'a.stat.kpi-collected',
    { href: '#/leases' },
    h('span.stat-label', `Collected in ${formatDate(today, { month: 'long' })}`),
    h('span.stat-value', money(collected)),
    h('span.stat-sub', charged ? `${pct}% of ${money(charged)} charged` : 'No charges posted yet'),
    h('span.kpi-progress', { role: 'progressbar', 'aria-label': 'Share of this month’s charges collected', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('span', { style: { width: `${pct}%` } })),
  );

  return h(
    'section.stats.home-kpis',
    { 'aria-label': 'Key figures' },
    collectedTile,
    stat({ label: 'Outstanding balances', value: money(owed), sub: owing ? `${pluralize(owing, 'lease')} owe rent` : 'Everyone is paid up', tone: owing ? 'danger' : 'success', href: '#/balances' }),
    stat({ label: 'Occupancy', value: `${Math.round(occ.rate * 100)}%`, sub: `${occ.occupied} of ${pluralize(occ.units, 'unit')} occupied`, href: '#/properties' }),
    stat({ label: 'Open work orders', value: String(wos.length), sub: urgent ? `${urgent} urgent` : 'None urgent', tone: urgent ? 'warning' : null, href: '#/work-orders' }),
  );
}

function balancesCard(pay) {
  const store = app.store;
  const today = app.today();
  const ledger = app.ledger();
  const rows = store
    .all('leases')
    .filter((l) => !l.draft)
    .map((l) => ({ lease: l, info: ledger.lease(l.id) }))
    .filter((r) => r.info.balance > 0)
    .sort((a, b) => b.info.balance - a.info.balance);
  const total = rows.reduce((s, r) => s + r.info.balance, 0);
  const body = rows.length
    ? h(
        'ul.home-list',
        rows.slice(0, 5).map(({ lease, info }) => {
          const since = oldestUnpaid(info);
          const late = since && since <= today ? diffDays(since, today) : 0;
          return h(
            'li.home-row',
            h(
              'a.home-row-main',
              { href: `#/leases/${lease.id}?tab=ledger` },
              h('span.home-row-title', lookup.leaseLabel(lease)),
              h('span.home-row-sub', [lookup.tenantNames(lease), leaseStatus(lease, today) === 'past' ? 'Former tenant' : ''].filter(Boolean).join(' · ') || 'No tenants'),
            ),
            h('span.home-row-end', h('span.num.owed', money(info.balance)), late ? h(`span.home-late${late > 30 ? '.bad' : ''}`, `${late} day${late === 1 ? '' : 's'} late`) : h('span.subtle', 'Due')),
            h('button.btn.sm.home-row-action', { type: 'button', 'aria-label': `Receive payment for ${lookup.leaseLabel(lease)}`, onClick: () => pay(lease.id) }, icon('hand-coins', 14), h('span.hide-mobile', 'Receive')),
          );
        }),
      )
    : emptyState({ compact: true, icon: 'circle-check', title: 'No outstanding balances', text: 'Every tenant is paid up.', headingLevel: 3 });
  return homeCard({
    title: 'Outstanding balances',
    icon: 'hand-coins',
    href: '#/balances',
    extra: rows.length ? h('span.home-total', money(total)) : null,
    body: [body, rows.length > 5 ? h('p.home-foot.subtle', `Showing 5 of ${rows.length}`) : null],
  });
}

function chartCard() {
  const store = app.store;
  const data = derived('home.incomeExpense', ['transactions', 'accounts'], () => monthlyIncomeExpense(store, { months: 12, today: app.today() }), { daily: true });
  const any = data.some((d) => d.income || d.expense);
  const totalIncome = data.reduce((s, d) => s + d.income, 0);
  const totalExpense = data.reduce((s, d) => s + d.expense, 0);
  const body = any
    ? h(
        'div.card-body',
        h(
          'div.home-chart-summary',
          h('span', 'Income ', h('strong', money(totalIncome))),
          h('span', 'Expenses ', h('strong', money(totalExpense))),
          h('span', 'Net ', h(`strong${totalIncome - totalExpense < 0 ? '.owed' : ''}`, money(totalIncome - totalExpense))),
        ),
        columnChart({
          title: 'Income and expenses by month, last 12 months',
          categories: data.map((d) => ({ label: formatDate(`${d.month}-01`, { month: 'short' }), values: [Math.max(0, d.income), Math.max(0, d.expense)] })),
          series: [
            { name: 'Income', color: 'var(--series-1)' },
            { name: 'Expenses', color: 'var(--series-2)' },
          ],
          format: money,
          short: (c) => formatMoneyShort(c),
          height: 220,
        }),
      )
    : emptyState({ compact: true, icon: 'chart', title: 'No income or expenses yet', text: 'Rent charges, bills and expenses show up here month by month.', headingLevel: 3 });
  return homeCard({ title: 'Income and expenses', icon: 'chart', href: '#/financials', linkLabel: 'Financials', body });
}

let expiringBucket = '30';
function expiringCard() {
  const store = app.store;
  const today = app.today();
  const leases = store
    .all('leases')
    .filter((l) => leaseStatus(l, today) === 'active')
    .map((l) => ({ l, d: daysLeft(l, today) }))
    .filter((x) => x.d !== null && x.d <= 90)
    .sort((a, b) => a.d - b.d);
  const buckets = [
    { id: '30', label: '0 to 30 days', match: (d) => d <= 30 },
    { id: '60', label: '31 to 60', match: (d) => d > 30 && d <= 60 },
    { id: '90', label: '61 to 90', match: (d) => d > 60 },
  ];
  const wrap = h('div');
  const draw = () => {
    const b = buckets.find((x) => x.id === expiringBucket);
    const rows = leases.filter((x) => b.match(x.d));
    wrap.replaceChildren(
      h(
        'div.home-chips',
        chips({
          label: 'Ending within',
          selected: expiringBucket,
          onSelect: (id) => {
            expiringBucket = id;
            draw();
          },
          items: buckets.map((x) => ({ id: x.id, label: x.label, count: leases.filter((y) => x.match(y.d)).length })),
        }),
      ),
      rows.length
        ? h(
            'ul.home-list',
            rows.slice(0, 6).map(({ l, d }) =>
              h(
                'li.home-row',
                h('a.home-row-main', { href: `#/leases/${l.id}` }, h('span.home-row-title', lookup.leaseLabel(l)), h('span.home-row-sub', `${lookup.tenantNames(l) || 'No tenants'} · ends ${formatDate(l.end)}`)),
                h('span.home-row-end', statusPill(renewalStatus(l)), h('span.subtle', d === 0 ? 'Today' : `${d} day${d === 1 ? '' : 's'}`)),
              ),
            ),
          )
        : h('p.home-empty', 'No leases end in this window.'),
    );
  };
  draw();
  return homeCard({ title: 'Expiring leases', icon: 'calendar-clock', href: '#/renewals', linkLabel: 'Renewals', body: leases.length ? wrap : emptyState({ compact: true, icon: 'calendar-check', title: 'No leases ending soon', text: 'Fixed-term leases ending in the next 90 days appear here.', headingLevel: 3 }) });
}

function upcomingCard() {
  const today = app.today();
  const items = calendarItems(app.store, { from: today, to: addDays(today, 6), today, ledger: app.ledger() }).filter((i) => ['lease', 'event', 'inspection'].includes(i.type));
  const body = items.length
    ? h(
        'ul.home-list',
        items.slice(0, 8).map((it) => {
          const content = [h('span.home-row-main', h('span.home-row-title', it.title), it.sub ? h('span.home-row-sub', it.sub) : null), h('span.home-row-end', h('span.subtle.nowrap', relativeDay(it.date, today)))];
          return h('li.home-row', it.href ? h('a.home-row-link', { href: it.href }, content) : h('a.home-row-link', { href: '#/calendar' }, content));
        }),
      )
    : emptyState({ compact: true, icon: 'calendar-days', title: 'A quiet week', text: 'No move-ins, move-outs, inspections or events in the next 7 days.', headingLevel: 3 });
  return homeCard({ title: 'This week', icon: 'calendar-days', href: '#/calendar', linkLabel: 'Calendar', body });
}

function requestsCard(me) {
  const store = app.store;
  const list = store
    .all('tasks')
    .filter((t) => INCOMING_KINDS.has(t.kind) && t.status === 'new')
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const accept = (t) => {
    store.patch('tasks', t.id, { status: 'in-progress', assigneeId: t.assigneeId || me?.id || null });
    toast(`Accepted: ${t.title}`, { action: { label: 'Undo', run: () => store.patch('tasks', t.id, { status: 'new', assigneeId: t.assigneeId || null }) } });
  };
  const body = list.length
    ? h(
        'ul.home-list',
        list.slice(0, 5).map((t) =>
          h(
            'li.home-row',
            h('a.home-row-main', { href: `#/tasks/${t.id}` }, h('span.home-row-title', t.title), h('span.home-row-sub', [taskKindLabel(t.kind), relatedText(t)].filter(Boolean).join(' · '))),
            h('button.btn.sm.home-row-action', { type: 'button', 'aria-label': `Accept ${t.title}`, onClick: () => accept(t) }, icon('check', 14), 'Accept'),
          ),
        ),
      )
    : emptyState({ compact: true, icon: 'inbox', title: 'No new requests', text: 'Requests from residents and owners land here.', headingLevel: 3 });
  return homeCard({ title: 'Incoming requests', icon: 'inbox', href: '#/tasks?view=incoming', count: list.length || undefined, body });
}

function overdueTasksCard() {
  const store = app.store;
  const today = app.today();
  const list = store
    .all('tasks')
    .filter((t) => isOverdue(t, today))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const body = list.length
    ? h(
        'ul.home-list',
        list.slice(0, 5).map((t) =>
          h(
            'li.home-row',
            h('a.home-row-main', { href: `#/tasks/${t.id}` }, h('span.home-row-title', t.title), h('span.home-row-sub', [lookup.member(t.assigneeId)?.name || 'Unassigned', relatedText(t)].filter(Boolean).join(' · '))),
            h('span.home-row-end', h('span.overdue.nowrap', relativeDay(t.dueDate, today))),
          ),
        ),
      )
    : emptyState({ compact: true, icon: 'check-check', title: 'Nothing overdue', text: 'Tasks past their due date show up here.', headingLevel: 3 });
  return homeCard({ title: 'Overdue tasks', icon: 'clock', href: '#/tasks?view=open', count: list.length || undefined, body });
}

function applicationsCard() {
  const store = app.store;
  const today = app.today();
  const list = store
    .all('applicants')
    .filter((a) => a.status === 'new' || a.status === 'screening')
    .sort((a, b) => (b.appliedOn || '').localeCompare(a.appliedOn || ''));
  const body = list.length
    ? h(
        'ul.home-list',
        list.slice(0, 5).map((a) =>
          h(
            'li.home-row',
            h('a.home-row-main', { href: `#/applicants/${a.id}` }, h('span.home-row-title', personName(a)), h('span.home-row-sub', a.unitId ? lookup.unitLabel(a.unitId) : 'No unit selected')),
            h('span.home-row-end', statusPill(a.status), a.appliedOn ? h('span.subtle.nowrap', relativeDay(a.appliedOn, today)) : null),
          ),
        ),
      )
    : emptyState({ compact: true, icon: 'contact', title: 'No applications to review', text: 'New and undecided rental applications appear here.', headingLevel: 3 });
  return homeCard({ title: 'Rental applications', icon: 'contact', href: '#/applicants', count: list.length || undefined, body });
}

function vacancyCard() {
  const store = app.store;
  const occ = occupancyMap();
  const today = app.today();
  const vacant = store.all('units').filter((u) => store.get('properties', u.propertyId)?.active !== false && !occ.get(u.id));
  const listed = vacant.filter((u) => u.listing?.listed);
  const upcoming = new Map();
  for (const l of store.all('leases')) if (!l.draft && leaseStatus(l, today) === 'future') upcoming.set(l.unitId, l);
  const body = vacant.length
    ? [
        h(
          'div.home-split',
          h('a.home-split-item', { href: '#/listings' }, h('span.home-split-num', String(listed.length)), h('span', 'Listed')),
          h('a.home-split-item', { href: '#/listings' }, h('span.home-split-num', String(vacant.length - listed.length)), h('span', 'Not listed')),
        ),
        h(
          'ul.home-list',
          vacant.slice(0, 5).map((u) =>
            h(
              'li.home-row',
              h('a.home-row-main', { href: `#/units/${u.id}` }, h('span.home-row-title', lookup.unitLabel(u.id)), h('span.home-row-sub', upcoming.get(u.id) ? `Leased from ${formatDate(upcoming.get(u.id).start)}` : u.marketRent ? `${money(u.marketRent)} market rent` : 'Vacant')),
              h('span.home-row-end', statusPill(upcoming.get(u.id) ? 'future' : u.listing?.listed ? 'listed' : 'vacant')),
            ),
          ),
        ),
      ]
    : emptyState({ compact: true, icon: 'home', title: 'Fully occupied', text: 'Every unit has an active lease.', headingLevel: 3 });
  return homeCard({ title: 'Vacant units', icon: 'door', href: '#/listings', linkLabel: 'Listings', count: vacant.length || undefined, body });
}

/** "Due today", "Due tomorrow", "Due Oct 20", "6 days overdue". */
export function dueText(due, today) {
  const n = diffDays(today, due);
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} overdue`;
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  return `Due ${formatDate(due, { month: 'short', day: 'numeric' })}`;
}

function billsCard() {
  const store = app.store;
  const today = app.today();
  const ledger = app.ledger();
  const horizon = addDays(today, 14);
  const list = store
    .all('transactions')
    .filter((t) => t.kind === 'bill' && !t.voided && t.dueDate && t.dueDate <= horizon)
    .map((t) => ({ t, info: ledger.bill(t.id) }))
    .filter((x) => x.info.balance > 0)
    .sort((a, b) => a.t.dueDate.localeCompare(b.t.dueDate));
  const overdueTotal = list.filter((x) => x.t.dueDate < today).reduce((s, x) => s + x.info.balance, 0);
  const body = list.length
    ? [
        overdueTotal ? h('p.home-alert', icon('alert', 14), `${money(overdueTotal)} overdue`) : null,
        h(
          'ul.home-list',
          list.slice(0, 5).map(({ t, info }) => {
            const st = billStatus(t, info, today);
            const vendor = store.get('vendors', t.vendorId);
            return h(
              'li.home-row',
              h('a.home-row-main', { href: `#/bills/${t.id}` }, h('span.home-row-title', vendor ? displayName(vendor) : 'Vendor'), h('span.home-row-sub', t.memo || t.ref || 'Bill')),
              h('span.home-row-end', h('span.num', money(info.balance)), h(`span.nowrap${st === 'overdue' ? '.overdue' : '.subtle'}`, dueText(t.dueDate, today))),
            );
          }),
        ),
      ]
    : emptyState({ compact: true, icon: 'receipt', title: 'No bills due soon', text: 'Unpaid bills due in the next two weeks appear here.', headingLevel: 3 });
  return homeCard({ title: 'Bills to pay', icon: 'receipt', href: '#/bills', count: list.length || undefined, body });
}

