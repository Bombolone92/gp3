/** Home: what needs attention, and the business at a glance. */
import { el, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { selectInput } from '../ui/fields.js';
import { columnChart, donutChart } from '../ui/chart.js';
import { navigate } from '../ui/router.js';
import { viewState } from './page.js';
import { store } from '../lib/store.js';
import { openNew } from '../forms/lazy.js';
import { formatMoney } from '../lib/money.js';
import { periodRange, today, monthBuckets, addMonths, startOfMonth, formatRange, addDays } from '../lib/dates.js';
import { isBalanceSheet, typeInfo } from '../lib/accounts.js';
import { profitAndLoss } from '../lib/reports.js';
import { dueDates } from '../lib/recurring.js';

const LS_PRIVACY = 'bookkeeping:privacy';

function greeting(name) {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

function card(title, body, { action = null, wide = false, className = '' } = {}) {
  return el(`section.card.home-card${wide ? '.wide' : ''}${className ? `.${className}` : ''}`, { 'aria-label': title },
    el('div.card-head', {}, el('h2.card-title', {}, title), action ? el('div.spacer') : null, action),
    el('div.card-body', {}, body));
}

function periodSelect(st, key, onChange) {
  return selectInput({
    options: [['thisMonth', 'This month'], ['lastMonth', 'Last month'], ['thisQuarter', 'This quarter'], ['lastQuarter', 'Last quarter'], ['thisYearToDate', 'This year to date'], ['last365', 'Last 12 months']],
    value: st[key], ariaLabel: 'Period', onChange: (v) => { st[key] = v; onChange(); },
  });
}

export function renderHome(main, _route, { user } = {}) {
  const st = viewState('home', { pnl: 'thisMonth', exp: 'thisMonth' });
  let privacy = false;
  try { privacy = localStorage.getItem(LS_PRIVACY) === 'on'; } catch {}
  const rerender = () => renderHome(main, _route, { user });
  const now = today();
  const fy = store.settings.fiscalStartMonth;
  const sm = store.summary();

  // ------------------------------------------------------ needs attention
  const review = [...store.bankLines.values()].filter((l) => l.status === 'review').length;
  const pendingEstimates = store.txnList((t) => t.type === 'estimate' && (t.status || 'pending') === 'pending').length;
  const reminders = [...store.recurring.values()].filter((r) => r.mode === 'reminder' && dueDates(r, now, 1).length);
  const tasks = [
    sm.overdueCount && { icon: 'alert', tone: 'negative', text: `${sm.overdueCount} overdue ${sm.overdueCount === 1 ? 'invoice' : 'invoices'}`, amount: sm.overdueInvoices, to: 'invoices?status=overdue' },
    review && { icon: 'bank', tone: 'info', text: `${review} bank ${review === 1 ? 'transaction' : 'transactions'} to review`, to: 'banking' },
    sm.overdueBillCount && { icon: 'receipt', tone: 'warning', text: `${sm.overdueBillCount} overdue ${sm.overdueBillCount === 1 ? 'bill' : 'bills'}`, amount: sm.overdueBills, to: 'bills?status=overdue' },
    sm.notDepositedCount && { icon: 'piggy', tone: 'info', text: `${sm.notDepositedCount} ${sm.notDepositedCount === 1 ? 'payment' : 'payments'} to deposit`, amount: sm.notDeposited, action: () => openNew('deposit') },
    reminders.length && { icon: 'repeat', tone: 'info', text: `${reminders.length} recurring ${reminders.length === 1 ? 'transaction' : 'transactions'} to review`, to: 'recurring' },
    pendingEstimates && { icon: 'estimate', tone: 'info', text: `${pendingEstimates} pending ${pendingEstimates === 1 ? 'estimate' : 'estimates'}`, to: 'estimates?status=pending' },
  ].filter(Boolean);
  const attention = tasks.length
    ? el('ul.task-list', {}, tasks.map((t) => el('li', {},
      el(t.to ? 'a.task' : 'button.task', { href: t.to ? `#/${t.to}` : null, type: t.to ? null : 'button', onclick: t.action || null },
        el(`span.task-ico.tone-${t.tone}`, { html: icon(t.icon, 16) }),
        el('span.grow', {}, t.text),
        t.amount !== undefined ? el('span.money.priv', {}, formatMoney(t.amount)) : null,
        el('span', { html: icon('chevR', 16) })))))
    : el('div.empty', { style: { padding: '24px 8px' } }, el('div.empty-icon', { html: icon('ok', 24) }), el('h2', {}, "You're all caught up"), el('p', {}, 'Overdue invoices, bills, and bank transactions to review show up here.'));

  // ------------------------------------------------------------- P&L
  const pr = periodRange(st.pnl, { now, fiscalStartMonth: fy });
  const pnl = profitAndLoss(store, { from: pr.from, to: pr.to, basis: store.settings.accountingMethod });
  const val = (label) => pnl.rows.find((r) => r.label === label)?.values[0] || 0;
  const income = val('Total for Income') + val('Total for Other Income');
  const expenses = val('Total for Expenses') + val('Total for Cost of Goods Sold') + val('Total for Other Expenses');
  const net = income - expenses;
  const maxBar = Math.max(income, expenses, 1);
  const bar = (label, value, color) => el('div.pl-bar', {},
    el('div.pl-bar-head', {}, el('span.kpi-label', {}, label), el('span.money.priv', {}, formatMoney(value))),
    el('div.progress', { role: 'img', 'aria-label': `${label} ${formatMoney(value)}` }, el('span', { style: { width: `${Math.max(0, (value / maxBar) * 100)}%`, background: `var(${color})` } })));
  const pnlCard = card('Profit and loss', el('div.stack', {},
    el('div', {}, el('div.kpi-label', {}, `Net profit for ${formatRange(pr.from, pr.to)}`), el(`div.kpi-value.priv${net < 0 ? '.neg' : ''}`, {}, formatMoney(net))),
    bar('Income', income, '--chart-1'),
    bar('Expenses', expenses, '--chart-2'),
    el('a.link-btn', { href: `#/report/pnl` }, 'View report')), { action: periodSelect(st, 'pnl', rerender) });

  // ---------------------------------------------------------- expenses
  const er = periodRange(st.exp, { now, fiscalStartMonth: fy });
  const L = store.ledger(store.settings.accountingMethod);
  const act = L.activity(er.from, er.to);
  const slices = [];
  for (let i = 0; i < L.accountIds.length; i++) {
    const a = store.account(L.accountIds[i]);
    if (!a || !['expense', 'cogs', 'otherExpense'].includes(a.type) || act[i] <= 0) continue;
    slices.push({ label: a.name, value: act[i] });
  }
  slices.sort((a, b) => b.value - a.value);
  const expCard = card('Expenses', slices.length
    ? donutChart({ title: `Spending by category, ${formatRange(er.from, er.to)}`, slices, centerLabel: 'Total spent', onSelect: () => navigate('report/pnl') })
    : el('p.muted', {}, 'No expenses in this period.'), { action: periodSelect(st, 'exp', rerender) });

  // ---------------------------------------------------------- invoices
  let paid30 = 0;
  for (const t of store.txns.values()) if (!t.voided && (t.type === 'payment' || t.type === 'salesReceipt') && t.date >= addDays(now, -30)) paid30 += store.total(t);
  const invTotal = Math.max(sm.openInvoices + paid30, 1);
  const invCard = card('Invoices', el('div.stack', {},
    el('div.inv-split', {},
      el('div', {}, el('div.kpi-label', {}, `Unpaid (${sm.openCount})`), el('div.kpi-value.priv', {}, formatMoney(sm.openInvoices))),
      el('div', {}, el('div.kpi-label', {}, 'Paid, last 30 days'), el('div.kpi-value.priv', {}, formatMoney(paid30)))),
    el('div.progress.progress-lg', { role: 'img', 'aria-label': `Overdue ${formatMoney(sm.overdueInvoices)}, not due yet ${formatMoney(sm.openInvoices - sm.overdueInvoices)}, paid ${formatMoney(paid30)}` },
      el('span', { style: { width: `${(sm.overdueInvoices / invTotal) * 100}%`, background: 'var(--negative)' } }),
      el('span', { style: { width: `${((sm.openInvoices - sm.overdueInvoices) / invTotal) * 100}%`, background: 'var(--chart-other)' } }),
      el('span', { style: { width: `${(paid30 / invTotal) * 100}%`, background: 'var(--positive)' } })),
    el('ul.legend-list', {},
      el('li', {}, el('span.chart-swatch', { style: { background: 'var(--negative)' } }), el('a', { href: '#/invoices?status=overdue' }, 'Overdue'), el('span.money.priv', {}, formatMoney(sm.overdueInvoices))),
      el('li', {}, el('span.chart-swatch', { style: { background: 'var(--chart-other)' } }), el('a', { href: '#/invoices?status=notDue' }, 'Not due yet'), el('span.money.priv', {}, formatMoney(sm.openInvoices - sm.overdueInvoices))),
      el('li', {}, el('span.chart-swatch', { style: { background: 'var(--positive)' } }), el('a', { href: '#/invoices?status=paid' }, 'Paid'), el('span.money.priv', {}, formatMoney(paid30))))));

  // ------------------------------------------------------------ banks
  const banks = store.accountsOfType('bank', 'creditCard');
  const bankCard = card('Bank accounts', banks.length ? el('ul.bank-list', {}, banks.map((a) => {
    const n = [...store.bankLines.values()].filter((l) => l.accountId === a.id && l.status === 'review').length;
    return el('li', {}, el('a.bank-row', { href: `#/banking?account=${a.id}` },
      el('span.task-ico.tone-info', { html: icon(a.type === 'creditCard' ? 'card' : 'bank', 15) }),
      el('span.grow', {}, el('div.truncate', {}, a.name), el('div.cell-sub', {}, n ? `${n} to review` : 'Up to date')),
      el('span', { style: { textAlign: 'right' } },
        el('div.money.priv', {}, formatMoney(store.accountBalance(a.id))),
        el('div.cell-sub', {}, 'In your books'))));
  })) : el('p.muted', {}, 'No bank accounts yet.'), { action: el('a.link-btn', { href: '#/banking' }, 'Go to banking') });

  // ------------------------------------------------- income vs expenses
  const months = monthBuckets(startOfMonth(addMonths(now, -11)), now);
  const inc = []; const exp = [];
  for (const m of months) {
    const a = L.activity(m.from, m.to);
    let i = 0; let e = 0;
    for (let k = 0; k < L.accountIds.length; k++) {
      const acct = store.account(L.accountIds[k]);
      if (!acct || isBalanceSheet(acct.type)) continue;
      const v = a[k] * typeInfo(acct.type).sign;
      if (typeInfo(acct.type).cls === 'income') i += v; else e += v;
    }
    inc.push(i); exp.push(e);
  }
  const trendCard = card('Income and expenses', columnChart({
    title: 'Income and expenses by month, last 12 months',
    categories: months.map((m) => m.label.slice(0, 3)),
    series: [{ name: 'Income', values: inc }, { name: 'Expenses', values: exp }],
    onSelect: (i) => navigate(`report/pnl?from=${months[i].from}&to=${months[i].to}`),
  }), { wide: true });

  const privacyBtn = el('button.btn.btn-ghost', { type: 'button', 'aria-pressed': String(privacy) },
    el('span', { html: icon(privacy ? 'eyeOff' : 'eye', 18) }), privacy ? 'Show amounts' : 'Privacy');
  privacyBtn.addEventListener('click', () => {
    try { localStorage.setItem(LS_PRIVACY, privacy ? 'off' : 'on'); } catch {}
    rerender();
  });

  const quick = [
    ['Create invoice', () => openNew('invoice')],
    ['Record payment', () => openNew('payment')],
    ['Record expense', () => openNew('expense')],
    ['Enter bill', () => openNew('bill')],
    ['Pay bills', () => openNew('pay-bills')],
    ['Record deposit', () => openNew('deposit')],
    ['Write check', () => openNew('check')],
    ['Upload bank statement', () => import('./banking.js').then((m) => m.openBankImport())],
  ];

  swap(main, el('div.page.home', { class: privacy ? 'privacy-on' : '' },
    el('div.home-hero', {},
      el('h1.page-title.home-title', { tabIndex: -1 }, greeting(user?.username)),
      el('div.spacer'),
      privacyBtn),
    el('div.home-actions', {},
      el('h2.home-actions-title', { id: 'home-actions-title' }, 'Create actions'),
      el('div.chip-row', { role: 'group', 'aria-labelledby': 'home-actions-title' }, quick.map(([label, fn]) => el('button.chip', { type: 'button', onclick: fn }, el('span', { html: icon('plus', 15) }), label)))),
    el('h2.home-section', {}, 'Business at a glance'),
    el('div.home-grid', {},
      card('Needs attention', attention),
      pnlCard,
      invCard,
      expCard,
      bankCard,
      trendCard)));
}
