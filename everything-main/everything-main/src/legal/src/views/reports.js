/**
 * Reports: an index of report cards, and one page per report with date
 * range controls, a chart, a totals table, CSV export, and printing.
 */
import '../styles/reports.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, select, textInput, stat, emptyState, field } from '../ui/components.js';
import { setQuery } from '../ui/router.js';
import { columnChart, barList } from '../ui/report-chart.js';
import { matterLink, contactLink, contactPicker, matterPicker } from './common.js';
import { formatMoney, formatMoneyShort } from '../core/money.js';
import { formatHoursDecimal } from '../core/duration.js';
import { formatDate, namedRange, RANGE_OPTIONS, addDays, parseISODate } from '../core/dates.js';
import { downloadCsv } from '../core/csv.js';
import { contactName, matterLabel, padNumber } from '../core/format.js';
import {
  lastMonths,
  monthsBetween,
  revenueByMonth,
  agingByClient,
  clientLedger,
  hoursByUser,
  activityByCategory,
  mattersByArea,
  mattersByMonth,
  matterProfitability,
  trustByMatter,
  trustLedgerRows,
} from '../core/report-calc.js';

const money = (c) => formatMoney(c);
const cents = (c) => ((Number(c) || 0) / 100).toFixed(2);
const pct = (v) => (v === null || v === undefined ? '' : `${Math.round(v * 100)}%`);
const hours = (m) => formatHoursDecimal(m, 1);
const monthLabel = (ym, long = false) => new Intl.DateTimeFormat(undefined, long ? { month: 'long', year: 'numeric' } : { month: 'short' }).format(parseISODate(`${ym}-01`));

const PERIODS = [
  { value: '12m', label: 'Last 12 months' },
  { value: 'year', label: 'This year' },
  { value: 'last-year', label: 'Last year' },
];

function periodMonths(period, today) {
  if (period === 'year' || period === 'last-year') {
    const [from, to] = namedRange(period, today);
    return monthsBetween(from, to);
  }
  return lastMonths(today, 12);
}

/** Report definitions. kind: 'period' (monthly charts), 'range' (date range), or 'none'. */
const REPORTS = [
  { id: 'revenue', group: 'Billing', icon: 'chart', title: 'Revenue', description: 'Billed and collected by month.', kind: 'period', build: buildRevenue },
  { id: 'aging', group: 'Billing', icon: 'coins', title: 'Accounts receivable aging', description: 'Unpaid balances by client and how overdue they are.', kind: 'none', build: buildAging },
  {
    id: 'ledger',
    group: 'Billing',
    icon: 'file-spreadsheet',
    title: 'Client ledger',
    description: 'A client statement of bills, payments, and running balance.',
    kind: 'range',
    defaultRange: 'year',
    build: buildLedger,
  },
  {
    id: 'hours',
    group: 'Productivity',
    icon: 'timer',
    title: 'Billable hours by user',
    description: 'Hours against targets, utilization, and realization.',
    kind: 'range',
    defaultRange: 'month',
    build: buildHours,
  },
  {
    id: 'categories',
    group: 'Productivity',
    icon: 'list',
    title: 'Activity summary',
    description: 'Time and expenses by activity category.',
    kind: 'range',
    defaultRange: 'month',
    build: buildCategories,
  },
  {
    id: 'matters-area',
    group: 'Matters',
    icon: 'scale',
    title: 'Matters by practice area',
    description: 'Open, pending, and closed matters, and where open matters sit by stage.',
    kind: 'none',
    build: buildMattersArea,
  },
  { id: 'matters-month', group: 'Matters', icon: 'chart-line', title: 'New and closed matters', description: 'Matters opened and closed each month.', kind: 'period', build: buildMattersMonth },
  {
    id: 'profitability',
    group: 'Matters',
    icon: 'trending-up',
    title: 'Matter profitability',
    description: 'Work recorded, billed, collected, and unbilled per matter.',
    kind: 'range',
    defaultRange: 'all',
    build: buildProfitability,
  },
  { id: 'trust-balances', group: 'Trust', icon: 'vault', title: 'Trust balances', description: 'Client funds held per matter, with low balances flagged.', kind: 'none', build: buildTrustBalances },
  {
    id: 'trust-ledger',
    group: 'Trust',
    icon: 'landmark',
    title: 'Trust ledger',
    description: 'Every trust deposit and withdrawal with running balances.',
    kind: 'range',
    defaultRange: 'month',
    build: buildTrustLedger,
  },
];

export function render(ctx) {
  const rep = REPORTS.find((r) => r.id === ctx.params.report);
  return rep ? renderReport(ctx, rep) : renderIndex();
}

// ---- Index ---------------------------------------------------------------------------

function renderIndex() {
  const groups = [...new Set(REPORTS.map((r) => r.group))];
  return {
    title: 'Reports',
    node: h(
      'div.page',
      pageHeader({ title: 'Reports', subtitle: 'Billing, productivity, matter, and trust reports. Every report can be exported to CSV or printed.' }),
      groups.map((g) =>
        h(
          'section.report-group',
          { 'aria-labelledby': `rg-${g}` },
          h('h2', { id: `rg-${g}` }, g),
          h(
            'ul.report-cards',
            REPORTS.filter((r) => r.group === g).map((r) =>
              h(
                'li',
                h(
                  'a.report-card',
                  { href: `#/reports/${r.id}` },
                  h('span.report-icon', icon(r.icon, 20)),
                  h('span.grow', h('span.report-title', r.title), h('span.report-desc', r.description)),
                  icon('chevron-right', 16),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  };
}

// ---- One report -----------------------------------------------------------------------

function renderReport(ctx, rep) {
  const today = app.today();
  const state = {
    period: ctx.query.period || '12m',
    range: ctx.query.range || rep.defaultRange || 'month',
    from: ctx.query.from || '',
    to: ctx.query.to || '',
    client: ctx.query.client || '',
    matter: ctx.query.matter || '',
    account: ctx.query.account || '',
  };
  const weekStart = app.settings().weekStart || 0;
  const bounds = () => {
    if (state.range === 'custom') return [state.from, state.to];
    return namedRange(state.range, today, weekStart) || ['', ''];
  };

  const controls = h('div.report-controls.no-print');
  const body = h('div.report-body');
  const subtitle = h('span');

  function drawControls() {
    const parts = [];
    if (rep.kind === 'period') {
      const sel = select({ name: 'period', value: state.period, 'aria-label': 'Period', options: PERIODS });
      sel.addEventListener('change', () => update({ period: sel.value }));
      parts.push(field('Period', sel));
    }
    if (rep.kind === 'range') {
      const sel = select({ name: 'range', value: state.range, 'aria-label': 'Date range', options: [...RANGE_OPTIONS, { value: 'custom', label: 'Custom range' }] });
      sel.addEventListener('change', () => {
        const patch = { range: sel.value };
        if (sel.value === 'custom' && !state.from) {
          const [f, t] = bounds();
          patch.from = f || addDays(today, -30);
          patch.to = t || today;
        }
        update(patch, true);
      });
      parts.push(field('Date range', sel));
      if (state.range === 'custom') {
        const from = textInput({ name: 'from', type: 'date', value: state.from });
        const to = textInput({ name: 'to', type: 'date', value: state.to });
        from.addEventListener('change', () => update({ from: from.value }));
        to.addEventListener('change', () => update({ to: to.value }));
        parts.push(field('From', from), field('To', to));
      }
    }
    if (rep.id === 'ledger') {
      const withBills = new Set(app.store.all('bills').map((b) => b.clientId));
      parts.push(
        field('Client', contactPicker({ value: state.client, allowCreate: false, label: 'Client', filter: (c) => withBills.has(c.id), onChange: (v) => update({ client: v }) }), {
          cls: 'report-picker',
        }),
      );
    }
    if (rep.id === 'trust-ledger') {
      const accts = app.store.all('accounts').filter((a) => a.type === 'trust');
      const sel = select({
        name: 'account',
        value: state.account,
        'aria-label': 'Trust account',
        options: [{ value: '', label: 'All trust accounts' }, ...accts.map((a) => ({ value: a.id, label: a.name }))],
      });
      sel.addEventListener('change', () => update({ account: sel.value }));
      parts.push(
        field('Account', sel),
        field('Matter', matterPicker({ value: state.matter, label: 'Matter', placeholder: 'All matters', onChange: (v) => update({ matter: v }) }), { cls: 'report-picker' }),
      );
    }
    controls.replaceChildren(...parts);
    controls.hidden = !parts.length;
  }

  function update(patch, redrawControls = false) {
    Object.assign(state, patch);
    setQuery(patch);
    if (redrawControls || 'range' in patch) drawControls();
    draw();
  }

  let lastCsv = null;
  function draw() {
    const [from, to] = bounds();
    const out = rep.build({ state, from, to, today, months: periodMonths(state.period, today) });
    lastCsv = out.csv || null;
    exportBtn.disabled = !lastCsv?.length;
    subtitle.textContent = out.subtitle || (rep.kind === 'period' ? PERIODS.find((p) => p.value === state.period)?.label : rep.kind === 'range' ? rangeText(from, to) : `As of ${formatDate(today)}`);
    const parts = out.empty
      ? [emptyState({ icon: rep.icon, title: out.empty.title, text: out.empty.text, headingLevel: 2 })]
      : [
          out.stats?.length
            ? h(
                'div.stats.report-stats',
                out.stats.map((s) => stat(s)),
              )
            : null,
          out.chart ? h('section.card.report-chart-card', { 'aria-label': 'Chart' }, h('div.card-body', out.chart)) : null,
          out.extra || null,
          out.table ? reportTable(out.table, rep.title) : null,
        ];
    body.replaceChildren(...parts.filter(Boolean));
  }

  const exportBtn = h(
    'button.btn',
    {
      type: 'button',
      onClick: () => {
        if (!lastCsv?.length) return;
        downloadCsv(`${rep.id}-${today}.csv`, lastCsv);
      },
    },
    icon('download', 16),
    h('span.hide-sm', 'Export CSV'),
  );
  const printBtn = h('button.btn', { type: 'button', onClick: () => window.print() }, icon('printer', 16), h('span.hide-sm', 'Print'));

  drawControls();
  draw();
  ctx.watch(['activities', 'bills', 'payments', 'transactions', 'accounts', 'matters', 'contacts', 'users', 'settings'], draw);

  return {
    title: rep.title,
    node: h(
      'div.page.report-page',
      pageHeader({
        title: rep.title,
        crumbs: [{ label: 'Reports', href: '#/reports' }, { label: rep.group }],
        subtitle: [subtitle, h('span.print-only', app.settings().firm.name || '')],
        actions: [exportBtn, printBtn],
      }),
      controls,
      body,
    ),
  };
}

function rangeText(from, to) {
  if (!from && !to) return 'All dates';
  if (from === to) return formatDate(from);
  return `${from ? formatDate(from) : 'Beginning'} to ${to ? formatDate(to) : 'today'}`;
}

/** table: { columns: [{ label, align, render(row) }], rows, totals?: [cells], caption } */
function reportTable(t, title) {
  if (!t.rows.length) return h('section.card', h('div.card-body', h('p.subtle', t.emptyText || 'Nothing to show for this selection.')));
  return h(
    'section.card.report-table-card',
    { 'aria-label': `${title} table` },
    h(
      'div.report-table-wrap',
      { tabindex: '0', role: 'region', 'aria-label': `${title} data` },
      h(
        'table.table-plain.report-table',
        h('caption.sr-only', title),
        h(
          'thead',
          h(
            'tr',
            t.columns.map((c) => h(`th${c.align === 'r' ? '.r' : ''}`, { scope: 'col' }, c.label)),
          ),
        ),
        h(
          'tbody',
          t.rows.map((r) =>
            h(
              `tr${t.rowClass?.(r) ? '.' + t.rowClass(r) : ''}`,
              t.columns.map((c, i) =>
                h(i === 0 ? 'th' : 'td', { scope: i === 0 ? 'row' : null, class: [c.align === 'r' ? 'r num' : '', i === 0 ? 'row-head' : ''].filter(Boolean).join(' ') || null }, c.render(r)),
              ),
            ),
          ),
        ),
        t.totals
          ? h(
              'tfoot',
              h(
                'tr',
                t.totals.map((cell, i) => h(`td${t.columns[i]?.align === 'r' ? '.r.num' : ''}`, cell)),
              ),
            )
          : null,
      ),
    ),
  );
}

const sum = (rows, f) => rows.reduce((s, r) => s + (Number(f(r)) || 0), 0);

// ---- Builders ---------------------------------------------------------------------------

function buildRevenue({ months }) {
  const rows = revenueByMonth({ bills: app.store.all('bills'), payments: app.store.all('payments'), months });
  const billed = sum(rows, (r) => r.billed);
  const collected = sum(rows, (r) => r.collected);
  return {
    stats: [
      { label: 'Billed', value: formatMoney(billed), icon: 'receipt-text' },
      { label: 'Collected', value: formatMoney(collected), icon: 'hand-coins', tone: 'success' },
      { label: 'Collection rate', value: billed ? pct(collected / billed) : 'None', sub: 'Collected as a share of billed' },
      { label: 'Average per month', value: formatMoney(Math.round(collected / Math.max(1, rows.length))), sub: 'Collected' },
    ],
    chart: columnChart({
      title: 'Billed and collected by month',
      categories: rows.map((r) => ({ label: monthLabel(r.month), full: monthLabel(r.month, true), values: [r.billed, r.collected] })),
      series: [{ name: 'Billed' }, { name: 'Collected' }],
      format: money,
      short: (v) => formatMoneyShort(v),
    }),
    table: {
      columns: [
        { label: 'Month', render: (r) => monthLabel(r.month, true) },
        { label: 'Billed', align: 'r', render: (r) => money(r.billed) },
        { label: 'Collected', align: 'r', render: (r) => money(r.collected) },
      ],
      rows,
      totals: ['Total', money(billed), money(collected)],
    },
    csv: [['Month', 'Billed', 'Collected'], ...rows.map((r) => [r.month, cents(r.billed), cents(r.collected)])],
  };
}

function buildAging({ today }) {
  const rows = agingByClient({ bills: app.store.all('bills'), payments: app.store.all('payments'), today });
  const t = { current: sum(rows, (r) => r.current), d30: sum(rows, (r) => r.d30), d60: sum(rows, (r) => r.d60), d90: sum(rows, (r) => r.d90), d90plus: sum(rows, (r) => r.d90plus) };
  const total = t.current + t.d30 + t.d60 + t.d90 + t.d90plus;
  if (!rows.length) return { empty: { title: 'Nothing is owed', text: 'Every issued bill is paid in full.' }, csv: null };
  const buckets = [
    ['Current', t.current],
    ['1 to 30 days', t.d30],
    ['31 to 60 days', t.d60],
    ['61 to 90 days', t.d90],
    ['Over 90 days', t.d90plus],
  ];
  return {
    stats: [
      { label: 'Total outstanding', value: formatMoney(total), icon: 'coins' },
      { label: 'Overdue', value: formatMoney(total - t.current), tone: total - t.current ? 'danger' : '' },
      { label: 'Over 90 days', value: formatMoney(t.d90plus), tone: t.d90plus ? 'danger' : '' },
      { label: 'Clients with balances', value: String(rows.length) },
    ],
    chart: columnChart({
      title: 'Outstanding by age',
      categories: buckets.map(([label, v]) => ({ label, values: [v] })),
      series: [{ name: 'Outstanding' }],
      format: money,
      short: (v) => formatMoneyShort(v),
      height: 220,
    }),
    table: {
      columns: [
        { label: 'Client', render: (r) => (r.clientId ? contactLink(r.clientId) : 'No client') },
        { label: 'Current', align: 'r', render: (r) => money(r.current) },
        { label: '1 to 30', align: 'r', render: (r) => money(r.d30) },
        { label: '31 to 60', align: 'r', render: (r) => money(r.d60) },
        { label: '61 to 90', align: 'r', render: (r) => money(r.d90) },
        { label: 'Over 90', align: 'r', render: (r) => money(r.d90plus) },
        { label: 'Total', align: 'r', render: (r) => h('strong', money(r.total)) },
      ],
      rows,
      totals: ['Total', money(t.current), money(t.d30), money(t.d60), money(t.d90), money(t.d90plus), money(total)],
    },
    csv: [
      ['Client', 'Current', '1-30', '31-60', '61-90', 'Over 90', 'Total'],
      ...rows.map((r) => [lookup.contactName(r.clientId), cents(r.current), cents(r.d30), cents(r.d60), cents(r.d90), cents(r.d90plus), cents(r.total)]),
    ],
  };
}

function buildLedger({ state, from, to }) {
  if (!state.client) return { empty: { title: 'Choose a client', text: 'Pick a client above to see their statement of bills and payments.' } };
  const name = lookup.contactName(state.client);
  const l = clientLedger({ clientId: state.client, bills: app.store.all('bills'), payments: app.store.all('payments'), from, to });
  const rows = from ? [{ date: from, description: 'Opening balance', charge: 0, credit: 0, balance: l.opening, opening: true }, ...l.rows] : l.rows;
  return {
    subtitle: `${name} · ${rangeText(from, to)}`,
    stats: [
      { label: 'Billed', value: formatMoney(l.charges) },
      { label: 'Paid', value: formatMoney(l.credits), tone: 'success' },
      { label: 'Balance', value: formatMoney(l.closing), tone: l.closing > 0 ? 'warning' : '' },
    ],
    table: {
      columns: [
        { label: 'Date', render: (r) => formatDate(r.date) },
        {
          label: 'Description',
          render: (r) =>
            r.kind === 'bill'
              ? h('a.rec-link', { href: `#/bills/${r.ref.id}` }, r.description)
              : r.kind === 'payment'
                ? `${r.description}${r.ref.reference ? ` (${r.ref.reference})` : ''}`
                : h('em', r.description),
        },
        { label: 'Matter', render: (r) => (r.ref?.matterId ? matterLink(r.ref.matterId, { short: true }) : '') },
        { label: 'Charges', align: 'r', render: (r) => (r.charge ? money(r.charge) : '') },
        { label: 'Payments', align: 'r', render: (r) => (r.credit ? money(r.credit) : '') },
        { label: 'Balance', align: 'r', render: (r) => money(r.balance) },
      ],
      rows,
      totals: ['Total', '', '', money(l.charges), money(l.credits), money(l.closing)],
      emptyText: 'No bills or payments in this range.',
    },
    csv: [
      ['Date', 'Description', 'Matter', 'Charges', 'Payments', 'Balance'],
      ...rows.map((r) => [r.date, r.description, r.ref?.matterId ? lookup.matter(r.ref.matterId)?.displayNumber || '' : '', cents(r.charge), cents(r.credit), cents(r.balance)]),
    ],
  };
}

function buildHours({ from, to }) {
  const rows = hoursByUser({ activities: app.store.all('activities'), users: app.store.all('users'), bills: app.store.all('bills'), from, to, today: app.today() }).sort(
    (a, b) => b.billableMinutes - a.billableMinutes,
  );
  if (!rows.length) return { empty: { title: 'No time recorded', text: 'There are no time entries in this range.' } };
  const bill = sum(rows, (r) => r.billableMinutes);
  const non = sum(rows, (r) => r.nonBillableMinutes);
  const target = sum(rows, (r) => r.targetMinutes);
  const worked = sum(rows, (r) => r.workedValue);
  const billed = sum(rows, (r) => r.billedValue);
  return {
    stats: [
      { label: 'Billable hours', value: hours(bill), icon: 'timer' },
      { label: 'Non-billable hours', value: hours(non) },
      { label: 'Utilization', value: target ? pct(bill / target) : 'No targets', sub: target ? `of ${hours(target)} target hours` : 'Set targets in Settings, Users' },
      { label: 'Realization', value: worked ? pct(billed / worked) : 'None', sub: 'Billed value of billable work' },
    ],
    extra: h(
      'section.card.report-chart-card',
      { 'aria-label': 'Billable hours by user' },
      h(
        'div.card-body',
        barList({
          title: 'Billable hours by user',
          rows: rows.map((r) => ({
            label: r.name,
            value: r.billableMinutes / 60,
            display: `${hours(r.billableMinutes)} h`,
            target: r.targetMinutes ? r.targetMinutes / 60 : null,
            sub: r.targetMinutes ? `Target ${hours(r.targetMinutes)} h · ${pct(r.utilization)} utilized` : 'No target set',
          })),
        }),
      ),
    ),
    table: {
      columns: [
        { label: 'User', render: (r) => r.name },
        { label: 'Billable', align: 'r', render: (r) => hours(r.billableMinutes) },
        { label: 'Non-billable', align: 'r', render: (r) => hours(r.nonBillableMinutes) },
        { label: 'Target', align: 'r', render: (r) => (r.targetMinutes ? hours(r.targetMinutes) : '') },
        { label: 'Utilization', align: 'r', render: (r) => pct(r.utilization) },
        { label: 'Value', align: 'r', render: (r) => money(r.workedValue) },
        { label: 'Billed', align: 'r', render: (r) => money(r.billedValue) },
        { label: 'Realization', align: 'r', render: (r) => pct(r.realization) },
      ],
      rows,
      totals: ['Total', hours(bill), hours(non), target ? hours(target) : '', target ? pct(bill / target) : '', money(worked), money(billed), worked ? pct(billed / worked) : ''],
    },
    csv: [
      ['User', 'Billable hours', 'Non-billable hours', 'Target hours', 'Utilization', 'Value', 'Billed', 'Realization'],
      ...rows.map((r) => [r.name, hours(r.billableMinutes), hours(r.nonBillableMinutes), hours(r.targetMinutes), pct(r.utilization), cents(r.workedValue), cents(r.billedValue), pct(r.realization)]),
    ],
  };
}

function buildCategories({ from, to }) {
  const rows = activityByCategory({ activities: app.store.all('activities'), settings: app.settings(), from, to });
  if (!rows.length) return { empty: { title: 'No activity recorded', text: 'There are no time or expense entries in this range.' } };
  const time = rows.filter((r) => r.kind === 'time');
  const exp = rows.filter((r) => r.kind === 'expense');
  return {
    stats: [
      { label: 'Hours recorded', value: hours(sum(time, (r) => r.minutes)), icon: 'clock' },
      { label: 'Time value', value: formatMoney(sum(time, (r) => r.amount)) },
      { label: 'Expenses', value: formatMoney(sum(exp, (r) => r.amount)), icon: 'receipt' },
      { label: 'Entries', value: String(sum(rows, (r) => r.count)) },
    ],
    extra: time.length
      ? h(
          'section.card.report-chart-card',
          { 'aria-label': 'Hours by category' },
          h('div.card-head', h('h2', 'Hours by category')),
          h('div.card-body', barList({ title: 'Hours by category', rows: time.filter((r) => r.minutes).map((r) => ({ label: r.name, value: r.minutes / 60, display: `${hours(r.minutes)} h` })) })),
        )
      : null,
    table: {
      columns: [
        { label: 'Category', render: (r) => r.name },
        { label: 'Type', render: (r) => (r.kind === 'expense' ? 'Expense' : 'Time') },
        { label: 'Entries', align: 'r', render: (r) => String(r.count) },
        { label: 'Hours', align: 'r', render: (r) => (r.kind === 'time' ? hours(r.minutes) : '') },
        { label: 'Value', align: 'r', render: (r) => money(r.amount) },
        { label: 'Billable value', align: 'r', render: (r) => money(r.billableAmount) },
      ],
      rows,
      totals: ['Total', '', String(sum(rows, (r) => r.count)), hours(sum(time, (r) => r.minutes)), money(sum(rows, (r) => r.amount)), money(sum(rows, (r) => r.billableAmount))],
    },
    csv: [
      ['Category', 'Type', 'Entries', 'Hours', 'Value', 'Billable value'],
      ...rows.map((r) => [r.name, r.kind, r.count, r.kind === 'time' ? hours(r.minutes) : '', cents(r.amount), cents(r.billableAmount)]),
    ],
  };
}

function buildMattersArea() {
  const rows = mattersByArea({ matters: app.store.all('matters'), settings: app.settings() });
  if (!rows.length) return { empty: { title: 'No matters yet', text: 'Matters you open appear here by practice area.' } };
  const open = sum(rows, (r) => r.open);
  const pending = sum(rows, (r) => r.pending);
  const closed = sum(rows, (r) => r.closed);
  return {
    stats: [
      { label: 'Open', value: String(open), icon: 'briefcase' },
      { label: 'Pending', value: String(pending) },
      { label: 'Closed', value: String(closed) },
      { label: 'Practice areas in use', value: String(rows.filter((r) => r.practiceAreaId).length) },
    ],
    chart: columnChart({
      title: 'Matters by practice area',
      categories: rows.map((r) => ({ label: r.name, values: [r.open, r.pending, r.closed] })),
      series: [{ name: 'Open' }, { name: 'Pending' }, { name: 'Closed' }],
      format: String,
      short: (v) => String(Math.round(v)),
      stacked: true,
    }),
    extra: h(
      'section.card',
      { 'aria-label': 'Open matters by stage' },
      h('div.card-head', h('h2', 'Open and pending matters by stage')),
      h(
        'div.card-body.stage-breakdown',
        rows
          .filter((r) => r.open + r.pending)
          .map((r) =>
            h(
              'div.stage-area',
              h('h3', r.name),
              h(
                'ul.stage-chips',
                r.stageList.map((s) => h(`li.stage-chip${s.count ? '' : '.zero'}`, h('span', s.name), h('strong.num', String(s.count)))),
              ),
            ),
          ),
      ),
    ),
    table: {
      columns: [
        { label: 'Practice area', render: (r) => r.name },
        { label: 'Open', align: 'r', render: (r) => String(r.open) },
        { label: 'Pending', align: 'r', render: (r) => String(r.pending) },
        { label: 'Closed', align: 'r', render: (r) => String(r.closed) },
        { label: 'Total', align: 'r', render: (r) => h('strong', String(r.total)) },
      ],
      rows,
      totals: ['Total', String(open), String(pending), String(closed), String(open + pending + closed)],
    },
    csv: [['Practice area', 'Open', 'Pending', 'Closed', 'Total'], ...rows.map((r) => [r.name, r.open, r.pending, r.closed, r.total])],
  };
}

function buildMattersMonth({ months }) {
  const rows = mattersByMonth({ matters: app.store.all('matters'), months });
  const opened = sum(rows, (r) => r.opened);
  const closed = sum(rows, (r) => r.closed);
  return {
    stats: [
      { label: 'Opened', value: String(opened), icon: 'briefcase' },
      { label: 'Closed', value: String(closed) },
      { label: 'Net change', value: `${opened - closed >= 0 ? '+' : ''}${opened - closed}` },
    ],
    chart: columnChart({
      title: 'Matters opened and closed by month',
      categories: rows.map((r) => ({ label: monthLabel(r.month), full: monthLabel(r.month, true), values: [r.opened, r.closed] })),
      series: [{ name: 'Opened' }, { name: 'Closed' }],
      format: String,
      short: (v) => String(Math.round(v * 10) / 10),
    }),
    table: {
      columns: [
        { label: 'Month', render: (r) => monthLabel(r.month, true) },
        { label: 'Opened', align: 'r', render: (r) => String(r.opened) },
        { label: 'Closed', align: 'r', render: (r) => String(r.closed) },
      ],
      rows,
      totals: ['Total', String(opened), String(closed)],
    },
    csv: [['Month', 'Opened', 'Closed'], ...rows.map((r) => [r.month, r.opened, r.closed])],
  };
}

function buildProfitability({ from, to }) {
  const rows = matterProfitability({ matters: app.store.all('matters'), activities: app.store.all('activities'), bills: app.store.all('bills'), payments: app.store.all('payments'), from, to });
  if (!rows.length) return { empty: { title: 'No billable work in this range', text: 'Record time or expenses on matters to see profitability.' } };
  const t = { worked: sum(rows, (r) => r.worked), billed: sum(rows, (r) => r.billed), collected: sum(rows, (r) => r.collected), wip: sum(rows, (r) => r.wip) };
  const top = rows.slice(0, 10);
  return {
    stats: [
      { label: 'Work recorded', value: formatMoney(t.worked), icon: 'clock' },
      { label: 'Billed', value: formatMoney(t.billed) },
      { label: 'Collected', value: formatMoney(t.collected), tone: 'success' },
      { label: 'Unbilled work', value: formatMoney(t.wip), tone: t.wip ? 'warning' : '' },
    ],
    chart: columnChart({
      title: 'Top matters by collections',
      categories: top.map((r) => {
        const m = lookup.matter(r.matterId);
        // The number itself: "2026-00012" and "00012-Lopez" both shorten to "00012".
        return { label: m?.number ? padNumber(m.number) : m?.displayNumber?.slice(0, 5) || '', full: matterLabel(m), values: [r.worked, r.billed, r.collected] };
      }),
      series: [{ name: 'Recorded' }, { name: 'Billed' }, { name: 'Collected' }],
      format: money,
      short: (v) => formatMoneyShort(v),
    }),
    table: {
      columns: [
        { label: 'Matter', render: (r) => matterLink(r.matterId) },
        { label: 'Client', render: (r) => lookup.contactName(lookup.matter(r.matterId)?.clientId) },
        { label: 'Hours', align: 'r', render: (r) => hours(r.workedMinutes) },
        { label: 'Recorded', align: 'r', render: (r) => money(r.worked) },
        { label: 'Billed', align: 'r', render: (r) => money(r.billed) },
        { label: 'Collected', align: 'r', render: (r) => money(r.collected) },
        { label: 'Collection rate', align: 'r', render: (r) => pct(r.collectionRate) },
        { label: 'Unbilled', align: 'r', render: (r) => money(r.wip) },
      ],
      rows,
      totals: ['Total', '', hours(sum(rows, (r) => r.workedMinutes)), money(t.worked), money(t.billed), money(t.collected), t.billed ? pct(t.collected / t.billed) : '', money(t.wip)],
    },
    csv: [
      ['Matter', 'Client', 'Hours', 'Recorded', 'Billed', 'Collected', 'Collection rate', 'Unbilled'],
      ...rows.map((r) => {
        const m = lookup.matter(r.matterId);
        return [matterLabel(m), lookup.contactName(m?.clientId), hours(r.workedMinutes), cents(r.worked), cents(r.billed), cents(r.collected), pct(r.collectionRate), cents(r.wip)];
      }),
    ],
  };
}

function buildTrustBalances() {
  const rows = trustByMatter({ matters: app.store.all('matters'), transactions: app.store.all('transactions'), accounts: app.store.all('accounts') });
  if (!rows.length) return { empty: { title: 'No trust funds held', text: 'Record trust deposits on matters to see balances here.' } };
  const total = sum(rows, (r) => r.balance);
  const low = rows.filter((r) => r.low);
  return {
    stats: [
      { label: 'Total held in trust', value: formatMoney(total), icon: 'vault' },
      { label: 'Matters with funds', value: String(rows.filter((r) => r.balance > 0).length) },
      { label: 'Below minimum', value: String(low.length), tone: low.length ? 'warning' : '' },
    ],
    table: {
      columns: [
        { label: 'Matter', render: (r) => matterLink(r.matterId) },
        { label: 'Client', render: (r) => (r.clientId ? contactLink(r.clientId) : '') },
        { label: 'Minimum', align: 'r', render: (r) => (r.minimum ? money(r.minimum) : '') },
        { label: 'Balance', align: 'r', render: (r) => h(r.low ? 'strong.text-warning' : 'span', money(r.balance)) },
        { label: 'Status', render: (r) => (r.low ? h('span.pill.warning', 'Below minimum') : r.balance > 0 ? h('span.pill.success', 'Funded') : h('span.pill', 'Empty')) },
      ],
      rows,
      totals: ['Total', '', '', money(total), ''],
    },
    csv: [['Matter', 'Client', 'Minimum', 'Balance'], ...rows.map((r) => [matterLabel(lookup.matter(r.matterId)), contactName(lookup.contact(r.clientId)), cents(r.minimum), cents(r.balance)])],
  };
}

function buildTrustLedger({ state, from, to }) {
  const accounts = app.store.all('accounts');
  if (!accounts.some((a) => a.type === 'trust')) return { empty: { title: 'No trust account', text: 'Add a trust account under Accounts to start recording client funds.' } };
  const l = trustLedgerRows({ transactions: app.store.all('transactions'), accounts, accountId: state.account, matterId: state.matter, from, to });
  const rows = from ? [{ id: 'opening', date: from, description: 'Opening balance', amountCents: 0, balance: l.opening, opening: true }, ...l.rows] : l.rows;
  return {
    stats: [
      { label: 'Opening balance', value: formatMoney(l.opening) },
      { label: 'Deposits', value: formatMoney(l.deposits), tone: 'success' },
      { label: 'Withdrawals', value: formatMoney(l.withdrawals) },
      { label: 'Closing balance', value: formatMoney(l.closing), icon: 'vault' },
    ],
    table: {
      columns: [
        { label: 'Date', render: (r) => formatDate(r.date) },
        {
          label: 'Description',
          render: (r) => (r.opening ? h('em', r.description) : [r.description || (r.type === 'withdrawal' ? 'Withdrawal' : 'Deposit'), r.reference ? h('span.subtle', ` (${r.reference})`) : null]),
        },
        { label: 'Matter', render: (r) => (r.matterId ? matterLink(r.matterId, { short: true }) : '') },
        { label: 'Account', render: (r) => (r.accountId ? app.store.get('accounts', r.accountId)?.name || '' : '') },
        { label: 'Deposit', align: 'r', render: (r) => (!r.opening && r.type !== 'withdrawal' ? money(r.amountCents) : '') },
        { label: 'Withdrawal', align: 'r', render: (r) => (r.type === 'withdrawal' ? money(r.amountCents) : '') },
        { label: 'Balance', align: 'r', render: (r) => money(r.balance) },
      ],
      rows,
      totals: ['Total', '', '', '', money(l.deposits), money(l.withdrawals), money(l.closing)],
      emptyText: 'No trust transactions in this range.',
    },
    csv: [
      ['Date', 'Description', 'Reference', 'Matter', 'Account', 'Deposit', 'Withdrawal', 'Balance'],
      ...rows.map((r) => [
        r.date,
        r.description || '',
        r.reference || '',
        r.matterId ? lookup.matter(r.matterId)?.displayNumber || '' : '',
        r.accountId ? app.store.get('accounts', r.accountId)?.name || '' : '',
        !r.opening && r.type !== 'withdrawal' ? cents(r.amountCents) : '',
        r.type === 'withdrawal' ? cents(r.amountCents) : '',
        cents(r.balance),
      ]),
    ],
  };
}
