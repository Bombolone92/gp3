/** Reports: revenue, receivables, sales pipeline, work done, and costs. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, stat, select, card } from '../ui/components.js';
import { setQuery } from '../ui/router.js';
import { columnChart, barList } from '../ui/chart.js';
import { addDays, addMonths, startOfMonth, endOfMonth, formatDate } from '../core/dates.js';
import { formatMoneyShort } from '../core/money.js';
import { clientName, formatHours, pluralize } from '../core/format.js';
import { revenueByMonth, agedReceivables, revenueByItem, topClients, quoteFunnel, leadSources, visitsByMember, expensesByCategory } from '../core/reports.js';
import { entryMinutes } from './timesheets-core.js';
import { money } from './common.js';
import { downloadText, toCSV } from '../core/csv.js';

const RANGES = [
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'quarter', label: 'Last 3 months' },
  { id: 'year', label: 'This year' },
  { id: '12m', label: 'Last 12 months' },
];

function rangeFor(id, today) {
  switch (id) {
    case 'month':
      return [startOfMonth(today), today];
    case 'last_month': {
      const s = startOfMonth(addMonths(today, -1));
      return [s, endOfMonth(s)];
    }
    case 'quarter':
      return [startOfMonth(addMonths(today, -2)), today];
    case 'year':
      return [`${today.slice(0, 4)}-01-01`, today];
    default:
      return [startOfMonth(addMonths(today, -11)), today];
  }
}

export function render(ctx) {
  const store = app.store;
  const state = { range: RANGES.some((r) => r.id === ctx.query.range) ? ctx.query.range : '12m' };
  const body = h('div.stack', { style: { gap: '16px' } });

  function draw() {
    const today = app.today();
    const [from, to] = rangeFor(state.range, today);
    const payments = store.all('payments');
    const invoices = store.all('invoices');
    const jobs = store.all('jobs');
    const expenses = store.all('expenses');

    const months = revenueByMonth({ payments, invoices }, from, to);
    const collected = months.reduce((s, m) => s + m.collected, 0);
    const invoiced = months.reduce((s, m) => s + m.invoiced, 0);
    const costs = expenses.filter((x) => x.date >= from && x.date <= to).reduce((s, x) => s + (x.amount || 0), 0);
    let labour = 0;
    let minutes = 0;
    for (const e of store.all('timeEntries')) {
      if (e.date < from || e.date > to) continue;
      const m = entryMinutes(e);
      minutes += m;
      labour += Math.round((m / 60) * (lookup.member(e.memberId)?.laborRate || 0));
    }
    const aged = agedReceivables({ invoices, payments }, today);
    const owed = aged.reduce((s, b) => s + b.amount, 0);
    const funnel = quoteFunnel(store.all('quotes'), from, to);
    const visitsDone = visitsByMember(jobs, from, to);
    // Each visit once, though a visit done by two people is on both their bars.
    let totalVisits = 0;
    for (const j of jobs) for (const v of j.visits || []) if (v.completedAt && v.date && v.date >= from && v.date <= to) totalVisits++;
    // Same invoices revenueByMonth counts as invoiced, so the average matches the total.
    const issuedInvoices = invoices.filter((i) => i.sentAt && !i.badDebt && i.issueDate >= from && i.issueDate <= to);
    const avgInvoice = issuedInvoices.length ? Math.round(invoiced / issuedInvoices.length) : 0;

    const revenueChart = columnChart({
      title: 'Invoiced and collected by month',
      categories: months.map((m) => ({ label: m.label, full: formatDate(m.start, { month: 'long', year: 'numeric' }), values: [m.invoiced, m.collected] })),
      series: [
        { name: 'Invoiced', color: 'var(--series-1)' },
        { name: 'Collected', color: 'var(--series-2)' },
      ],
      format: money,
      short: (n) => formatMoneyShort(n),
    });

    body.replaceChildren(
      h(
        'div.stats',
        stat({ label: 'Collected', value: money(collected), sub: 'Payments received' }),
        stat({ label: 'Invoiced', value: money(invoiced), sub: `${pluralize(issuedInvoices.length, 'invoice')}, ${money(avgInvoice)} average` }),
        stat({ label: 'Expenses and labour', value: money(costs + labour), sub: `${money(costs)} expenses, ${money(labour)} labour` }),
        stat({ label: 'Net', value: money(collected - costs - labour), sub: 'Collected minus costs', tone: collected - costs - labour >= 0 ? 'success' : 'danger' }),
      ),
      card({ title: 'Revenue', body: revenueChart, id: 'rep-revenue' }),
      h(
        'div.report-grid',
        card({
          title: 'Receivables',
          id: 'rep-ar',
          actions: h('span.money', { style: { fontWeight: '700' } }, money(owed)),
          body: barList(
            aged.map((b) => ({ label: b.label, value: b.amount, sub: `${b.count} invoice${b.count === 1 ? '' : 's'}` })),
            { format: money, empty: 'Nothing outstanding.' },
          ),
          flush: true,
        }),
        card({
          title: 'Quotes',
          id: 'rep-quotes',
          body: h(
            'div.stack',
            h(
              'div.doc-meta',
              h('div', h('div.meta-label', 'Created'), h('div.meta-value', String(funnel.created))),
              h('div', h('div.meta-label', 'Sent'), h('div.meta-value', String(funnel.sent))),
              h('div', h('div.meta-label', 'Won'), h('div.meta-value', String(funnel.won))),
              h('div', h('div.meta-label', 'Win rate'), h('div.meta-value', `${funnel.rate}%`)),
            ),
            h('div.subtle', `${money(funnel.wonValue)} won of ${money(funnel.sentValue)} quoted.`),
          ),
        }),
        card({ title: 'Revenue by service', id: 'rep-items', flush: true, body: barList(revenueByItem(invoices, from, to).map((r) => ({ label: r.label, value: r.amount })), { format: money }) }),
        card({ title: 'Top clients', id: 'rep-clients', flush: true, body: barList(topClients(payments, from, to).map((r) => ({ label: clientName(lookup.client(r.clientId)), value: r.amount })), { format: money }) }),
        card({
          title: 'Visits completed',
          id: 'rep-visits',
          actions: h('span', { style: { fontWeight: '700' } }, String(totalVisits)),
          flush: true,
          body: barList(
            [...visitsDone].map(([id, n]) => ({ label: id === 'unassigned' ? 'Unassigned' : lookup.member(id)?.name || 'Former member', value: n })).sort((a, b) => b.value - a.value),
            { format: (n) => String(n) },
          ),
        }),
        card({
          title: 'Expenses by category',
          id: 'rep-expenses',
          flush: true,
          actions: h('span.subtle', `${formatHours(minutes)} logged`),
          body: barList(expensesByCategory(expenses, from, to).map((r) => ({ label: r.label, value: r.amount })), { format: money }),
        }),
        card({ title: 'New clients by lead source', id: 'rep-leads', flush: true, body: barList(leadSources(store.all('clients'), from, to).map((r) => ({ label: r.label, value: r.count })), { format: (n) => String(n) }) }),
      ),
    );
  }

  const rangeSelect = select({
    value: state.range,
    'aria-label': 'Report period',
    options: RANGES.map((r) => ({ value: r.id, label: r.label })),
    style: { width: 'auto' },
    onChange: (e) => {
      state.range = e.target.value;
      setQuery({ range: state.range });
      draw();
    },
  });

  const exportCSV = () => {
    const today = app.today();
    const [from, to] = rangeFor(state.range, today);
    const rows = [['Month', 'Invoiced', 'Collected']];
    for (const m of revenueByMonth({ payments: store.all('payments'), invoices: store.all('invoices') }, from, to)) rows.push([m.key, (m.invoiced / 100).toFixed(2), (m.collected / 100).toFixed(2)]);
    downloadText(`revenue-${from}-to-${to}.csv`, toCSV(rows));
  };

  draw();
  // Team (names, labour rates) and settings (currency) are shown too.
  ctx.onDispose(store.subscribe((c) => ['payments', 'invoices', 'jobs', 'expenses', 'timeEntries', 'quotes', 'clients', 'team', 'settings'].some((k) => c.has(k)) && draw()));
  return {
    node: h('div.page', pageHeader({ title: 'Reports', actions: [rangeSelect, h('button.btn', { type: 'button', onClick: exportCSV }, icon('file-down', 16), 'Export')] }), body),
    title: 'Reports',
  };
}

export { addDays };
