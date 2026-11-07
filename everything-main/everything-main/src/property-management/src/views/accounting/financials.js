/**
 * Financials: income statement, balance sheet summary, cash position and a
 * 12-month trend for a period and (optionally) one property.
 */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, derived } from '../../app.js';
import { pageHeader, stat, card } from '../../ui/components.js';
import { columnChart } from '../../ui/chart.js';
import { setQuery } from '../../ui/router.js';
import { formatMoneyShort } from '../../core/money.js';
import { bankAccounts } from '../../core/accounts.js';
import { incomeStatement, balanceSheet, monthlyIncomeExpense, accountBalance } from '../../core/financials.js';
import { money, propertySelect } from '../common.js';
import { periodPicker, periodRange, periodLabel, stmt, stmtCell, PERIODS } from './shared.js';

const REPORTS = [
  { id: 'income-statement', label: 'Income statement', icon: 'chart' },
  { id: 'balance-sheet', label: 'Balance sheet', icon: 'scale' },
  { id: 'cash-flow', label: 'Cash flow', icon: 'transfer' },
  { id: 'trial-balance', label: 'Trial balance', icon: 'list' },
  { id: 'general-ledger', label: 'General ledger', icon: 'book' },
  { id: 'owner-statement', label: 'Owner statements', icon: 'briefcase' },
];

export function render(ctx) {
  const store = app.store;
  const today = app.today();
  const state = {
    period: PERIODS.some((p) => p.id === ctx.query.period) ? ctx.query.period : 'ytd',
    from: ctx.query.from || '',
    to: ctx.query.to || '',
    propertyId: ctx.query.property || '',
  };
  [state.from, state.to] = periodRange(state.period, today, state);

  const picker = periodPicker({
    period: state.period,
    from: state.from,
    to: state.to,
    onChange: (s) => {
      Object.assign(state, s);
      setQuery({ period: s.period === 'ytd' ? '' : s.period, from: s.period === 'custom' ? s.from : '', to: s.period === 'custom' ? s.to : '' });
      body.redraw();
    },
  });
  const property = propertySelect({ value: state.propertyId, empty: 'All properties', 'aria-label': 'Property' });
  property.addEventListener('change', () => {
    state.propertyId = property.value;
    setQuery({ property: property.value });
    body.redraw();
  });

  const body = ctx.live(() => draw(), ['transactions', 'accounts', 'properties']);

  function draw() {
    const propertyIds = state.propertyId ? [state.propertyId] : null;
    const key = `${state.from}|${state.to}|${state.propertyId}`;
    const is = derived(`fin-is:${key}`, ['transactions', 'accounts'], () => incomeStatement(store, { from: state.from, to: state.to, propertyIds }));
    const bs = derived(`fin-bs:${key}`, ['transactions', 'accounts'], () => balanceSheet(store, { asOf: state.to, propertyIds }));
    const trend = derived(`fin-trend:${state.propertyId}`, ['transactions', 'accounts'], () => monthlyIncomeExpense(store, { months: 12, today, propertyIds }), { daily: true });
    const banks = bankAccounts(store.all('accounts'));
    const cashRows = banks.map((a) => ({ a, bal: propertyIds ? bankForProperty(a.id, state.propertyId, state.to) : accountBalance(store, a.id, state.to) }));
    const cash = cashRows.reduce((s, r) => s + r.bal, 0);
    const margin = is.totalIncome ? Math.round((is.net / is.totalIncome) * 100) : null;

    const chart = columnChart({
      title: 'Income and expenses by month',
      categories: trend.map((r) => ({
        label: new Date(`${r.month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' }),
        full: new Date(`${r.month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
        values: [Math.max(0, r.income), Math.max(0, r.expense)],
      })),
      series: [
        { name: 'Income', color: 'var(--series-1)' },
        { name: 'Expenses', color: 'var(--series-2)' },
      ],
      format: money,
      short: (n) => formatMoneyShort(n),
    });

    return h(
      'div.stack.acct-stack',
      h(
        'div.stats',
        stat({ label: 'Income', value: money(is.totalIncome), sub: periodLabel(state.from, state.to) }),
        stat({ label: 'Expenses', value: money(is.totalExpense), sub: `${is.expense.length} expense ${is.expense.length === 1 ? 'account' : 'accounts'}` }),
        stat({ label: 'Net operating income', value: stmt(is.net), tone: is.net < 0 ? 'danger' : 'success', sub: margin === null ? 'No income in this period' : `${margin}% margin` }),
        stat({ label: 'Cash in bank', value: money(cash), sub: `As of ${new Date(`${state.to}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`, href: '#/banking' }),
      ),
      h(
        'div.acct-grid',
        card({
          title: 'Income statement',
          actions: h('a.btn.sm.ghost', { href: `#/reports/income-statement?from=${state.from}&to=${state.to}${state.propertyId ? '&p=' + state.propertyId : ''}` }, 'Full report', icon('arrow-right', 14)),
          flush: true,
          body: incomeStatementBody(is),
        }),
        h(
          'div.stack.acct-stack',
          card({
            title: 'Balance sheet',
            actions: h('a.btn.sm.ghost', { href: `#/reports/balance-sheet?asOf=${state.to}${state.propertyId ? '&p=' + state.propertyId : ''}` }, 'Full report', icon('arrow-right', 14)),
            flush: true,
            body: balanceBody(bs),
          }),
          card({
            title: 'Cash position',
            flush: true,
            body: cashRows.length
              ? h(
                  'ul.acct-cash',
                  cashRows.map(({ a, bal }) =>
                    h('li', h('a', { href: `#/banking/${a.id}` }, h('span.grow.truncate', a.name), a.last4 ? h('span.subtle', ` ••${a.last4}`) : null), stmtCell(bal)),
                  ),
                )
              : h('div.section-empty', 'No bank accounts yet.', h('a.btn.sm', { href: '#/banking' }, 'Add one')),
          }),
        ),
      ),
      card({ title: 'Last 12 months', body: chart }),
      card({
        title: 'Reports',
        body: h(
          'ul.acct-report-links',
          REPORTS.map((r) => h('li', h('a.list-item', { href: `#/reports/${r.id}` }, icon(r.icon, 18), h('span.title.grow', r.label), icon('chevron-right', 16)))),
        ),
      }),
    );
  }

  function bankForProperty(accountId, propertyId, asOf) {
    let sum = 0;
    for (const t of store.all('transactions')) {
      if (t.voided || t.date > asOf) continue;
      for (const l of t.lines) if (l.accountId === accountId && l.propertyId === propertyId) sum += l.amount;
    }
    return sum;
  }

  return {
    node: h('div.page.acct-page', pageHeader({ title: 'Financials', subtitle: 'Accrual basis' }), h('div.toolbar.acct-toolbar', picker, property), body),
    title: 'Financials',
  };
}

function group(title, rows, totalLabel, totalValue, open = true) {
  const details = h(
    'details.acct-group',
    { open: open || null },
    h('summary', h('span.grow', title), stmtCell(totalValue, { strong: true })),
    rows.length
      ? h(
          'table.acct-stmt',
          h('caption.sr-only', title),
          h(
            'tbody',
            rows.map((r) =>
              h(
                'tr',
                h('th', { scope: 'row' }, r.accountId ? h('a', { href: `#/accounts/${r.accountId}` }, r.number ? h('span.acct-no', r.number) : null, r.name) : r.name),
                h('td.r', stmtCell(r.amount)),
              ),
            ),
          ),
          h('tfoot', h('tr', h('th', { scope: 'row' }, totalLabel), h('td.r', stmtCell(totalValue, { strong: true })))),
        )
      : h('p.acct-none', 'Nothing in this period.'),
  );
  return details;
}

function incomeStatementBody(is) {
  return h(
    'div.acct-statement',
    group('Income', is.income, 'Total income', is.totalIncome),
    group('Expenses', is.expense, 'Total expenses', is.totalExpense),
    h('div.acct-net', h('span.grow', 'Net operating income'), stmtCell(is.net, { strong: true })),
  );
}

function balanceBody(bs) {
  return h(
    'div.acct-statement',
    group('Assets', bs.assets, 'Total assets', bs.totalAssets, false),
    group('Liabilities', bs.liabilities, 'Total liabilities', bs.totalLiabilities, false),
    group('Equity', bs.equity, 'Total equity', bs.totalEquity, false),
    h('div.acct-net', h('span.grow', 'Liabilities and equity'), stmtCell(bs.totalLiabilities + bs.totalEquity, { strong: true })),
  );
}
