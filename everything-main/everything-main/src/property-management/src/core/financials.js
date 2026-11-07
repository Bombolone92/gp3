/**
 * Financial statements and ledger queries (accrual basis).
 *
 * Pure functions over the store's ledger and chart of accounts. Voided
 * transactions never count. When `propertyIds` is given, only lines tagged
 * with one of those properties are included.
 *
 * Amounts in statement rows use the account's natural sign: income and
 * liabilities are positive when credited, assets and expenses when debited.
 */
import { compareAccounts, normalSign, ACC } from './accounts.js';
import { kindLabel } from './ledger.js';

const live = (store) => store.all('transactions').filter((t) => !t.voided);
const byId = (store) => new Map(store.all('accounts').map((a) => [a.id, a]));
const propSet = (ids) => (Array.isArray(ids) && ids.length ? new Set(ids) : null);
const inProps = (line, set) => !set || set.has(line.propertyId);
const inRange = (date, from, to) => (!from || date >= from) && (!to || date <= to);

function rowsFrom(totals, accounts, type, sign) {
  const rows = [];
  for (const [id, sum] of totals) {
    const a = accounts.get(id);
    if (!a || a.type !== type) continue;
    const amount = sum * sign;
    if (!amount) continue;
    rows.push({ accountId: id, name: a.name, number: a.number || '', amount });
  }
  return rows.sort((x, y) => compareAccounts(accounts.get(x.accountId), accounts.get(y.accountId)));
}

const total = (rows) => rows.reduce((s, r) => s + r.amount, 0);

/** Sum of debit-positive line amounts per account for lines that pass `keep`. */
function sumLines(txs, keep) {
  const totals = new Map();
  for (const tx of txs) {
    for (const l of tx.lines) {
      if (!keep(tx, l)) continue;
      totals.set(l.accountId, (totals.get(l.accountId) || 0) + l.amount);
    }
  }
  return totals;
}

// ---- Statements ---------------------------------------------------------------------

export function incomeStatement(store, { from = null, to = null, propertyIds = null } = {}) {
  const accounts = byId(store);
  const set = propSet(propertyIds);
  const totals = sumLines(live(store), (tx, l) => inRange(tx.date, from, to) && inProps(l, set));
  const income = rowsFrom(totals, accounts, 'income', -1);
  const expense = rowsFrom(totals, accounts, 'expense', 1);
  const totalIncome = total(income);
  const totalExpense = total(expense);
  return { income, expense, totalIncome, totalExpense, net: totalIncome - totalExpense };
}

export function balanceSheet(store, { asOf = null, propertyIds = null } = {}) {
  const accounts = byId(store);
  const set = propSet(propertyIds);
  const totals = sumLines(live(store), (tx, l) => inRange(tx.date, null, asOf) && inProps(l, set));
  const assets = rowsFrom(totals, accounts, 'asset', 1);
  const liabilities = rowsFrom(totals, accounts, 'liability', -1);
  const equity = rowsFrom(totals, accounts, 'equity', -1);
  // Income and expenses not yet closed to equity show as net income.
  let net = 0;
  for (const [id, sum] of totals) {
    const t = accounts.get(id)?.type;
    if (t === 'income' || t === 'expense') net -= sum;
  }
  if (net) equity.push({ accountId: null, name: 'Net income (retained earnings)', number: '', amount: net });
  return {
    assets,
    liabilities,
    equity,
    totalAssets: total(assets),
    totalLiabilities: total(liabilities),
    totalEquity: total(equity),
  };
}

const CASH_LABELS = {
  payment: 'Tenant payments',
  contribution: 'Owner contributions',
  'bill-payment': 'Bill payments',
  expense: 'Expenses paid',
  refund: 'Tenant refunds',
  distribution: 'Owner distributions',
  transfer: 'Transfers',
  journal: 'Journal entries',
  deposit: 'Bank deposits',
};

export function cashFlow(store, { from = null, to = null, propertyIds = null } = {}) {
  const accounts = byId(store);
  const set = propSet(propertyIds);
  const isBank = (id) => !!accounts.get(id)?.bank;
  let opening = 0;
  const ins = new Map();
  const outs = new Map();
  for (const tx of live(store)) {
    if (to && tx.date > to) continue;
    let delta = 0;
    for (const l of tx.lines) if (isBank(l.accountId) && inProps(l, set)) delta += l.amount;
    if (!delta) continue;
    if (from && tx.date < from) {
      opening += delta;
      continue;
    }
    const label = CASH_LABELS[tx.kind] || kindLabel(tx.kind);
    const m = delta > 0 ? ins : outs;
    m.set(label, (m.get(label) || 0) + Math.abs(delta));
  }
  const list = (m) => [...m.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
  const inflows = list(ins);
  const outflows = list(outs);
  const net = total(inflows) - total(outflows);
  return { opening, closing: opening + net, inflows, outflows, net };
}

/**
 * Balances at the end of the period: assets, liabilities and equity carry
 * everything up to `to`; income and expenses count from `from`, and what
 * they earned before it sits in retained earnings, so debits equal credits
 * and the balance sheet accounts tie to the balance sheet.
 */
export function trialBalance(store, { from = null, to = null, propertyIds = null } = {}) {
  const accounts = byId(store);
  const set = propSet(propertyIds);
  const isPL = (id) => ['income', 'expense'].includes(accounts.get(id)?.type);
  const totals = new Map();
  for (const tx of live(store)) {
    if (to && tx.date > to) continue;
    const before = from && tx.date < from;
    for (const l of tx.lines) {
      if (!inProps(l, set)) continue;
      const id = before && isPL(l.accountId) ? ACC.retained : l.accountId;
      totals.set(id, (totals.get(id) || 0) + l.amount);
    }
  }
  const rows = [];
  for (const [id, sum] of totals) {
    const a = accounts.get(id);
    if (!sum) continue;
    rows.push({ accountId: id, name: a?.name || 'Unknown account', number: a?.number || '', type: a?.type || '', debit: sum > 0 ? sum : 0, credit: sum < 0 ? -sum : 0 });
  }
  rows.sort((x, y) => (accounts.get(x.accountId) && accounts.get(y.accountId) ? compareAccounts(accounts.get(x.accountId), accounts.get(y.accountId)) : 0));
  return { rows, totalDebit: rows.reduce((s, r) => s + r.debit, 0), totalCredit: rows.reduce((s, r) => s + r.credit, 0) };
}

const txOrder = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));

/**
 * Account registers. Amounts and balances use the account's natural sign
 * (a positive amount increases the account's normal balance).
 */
export function generalLedger(store, { from = null, to = null, accountIds = null, propertyIds = null } = {}) {
  const accounts = byId(store);
  const set = propSet(propertyIds);
  const want = Array.isArray(accountIds) && accountIds.length ? new Set(accountIds) : null;
  const groups = new Map();
  const group = (id) => {
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { account: accounts.get(id) || { id, name: 'Unknown account', type: 'asset' }, opening: 0, rows: [], closing: 0 }));
    return g;
  };
  const txs = live(store)
    .filter((t) => !to || t.date <= to)
    .sort(txOrder);
  for (const tx of txs) {
    for (const l of tx.lines) {
      if (want && !want.has(l.accountId)) continue;
      if (!inProps(l, set)) continue;
      const g = group(l.accountId);
      const amount = l.amount * normalSign(g.account.type);
      if (from && tx.date < from) {
        g.opening += amount;
        continue;
      }
      g.rows.push({ tx, line: l, date: tx.date, memo: tx.memo || l.memo || kindLabel(tx.kind), amount, balance: 0 });
    }
  }
  const out = [];
  for (const g of groups.values()) {
    let bal = g.opening;
    for (const r of g.rows) r.balance = bal += r.amount;
    g.closing = bal;
    if (g.rows.length || g.opening) out.push(g);
  }
  return out.sort((a, b) => compareAccounts(a.account, b.account));
}

// ---- Owners ----------------------------------------------------------------------------

const COLLECTED = new Set(['payment', 'apply-prepayment', 'apply-deposit']);

export function ownerStatement(store, { ownerId, from = null, to = null } = {}) {
  const accounts = byId(store);
  const owner = store.get('owners', ownerId);
  const feePct = Number(owner?.managementFee) || 0;
  const props = store
    .all('properties')
    .map((p) => ({ p, share: (p.owners || []).find((o) => o.ownerId === ownerId) }))
    .filter((x) => x.share);
  const txs = live(store);
  const rows = props.map(({ p, share }) => {
    const pct = Number(share.pct) || 0;
    const k = pct / 100;
    let opening = 0;
    let closing = 0;
    let income = 0;
    let expenses = 0;
    let contributions = 0;
    let distributions = 0;
    let rentCollected = 0;
    for (const tx of txs) {
      if (to && tx.date > to) continue;
      const within = !from || tx.date >= from;
      for (const l of tx.lines) {
        if (l.propertyId !== p.id) continue;
        const a = accounts.get(l.accountId);
        if (!a) continue;
        if (a.bank) {
          // Money an owner put in or took out is that owner's alone, not
          // shared by everyone's ownership share.
          if (l.ownerId && l.ownerId !== ownerId) continue;
          const v = l.ownerId ? (k ? l.amount / k : 0) : l.amount;
          closing += v;
          if (!within) opening += v;
        }
        if (!within) continue;
        if (a.type === 'income') income += -l.amount;
        else if (a.type === 'expense') expenses += l.amount;
        else if (a.role === 'contributions' || a.role === 'distributions') {
          // A line tagged with an owner belongs to that owner alone.
          if (l.ownerId && l.ownerId !== ownerId) continue;
          // Unscaled here because every amount is scaled by the share below.
          const v = l.ownerId ? (k ? l.amount / k : 0) : l.amount;
          if (a.role === 'contributions') contributions += -v;
          else distributions += v;
        } else if (a.id === ACC.ar && COLLECTED.has(tx.kind) && l.amount < 0 && accounts.get(l.forAccountId)?.role === 'rent') {
          // Rent is collected when a payment, prepaid rent or an applied
          // deposit settles it (the money itself arrived earlier for the last two).
          rentCollected += -l.amount;
        }
      }
    }
    const scale = (v) => Math.round(v * k);
    return {
      propertyId: p.id,
      pct,
      opening: scale(opening),
      income: scale(income),
      expenses: scale(expenses),
      contributions: scale(contributions),
      distributions: scale(distributions),
      managementFee: Math.round((rentCollected * k * feePct) / 100),
      closing: scale(closing),
    };
  });
  const keys = ['opening', 'income', 'expenses', 'contributions', 'distributions', 'managementFee', 'closing'];
  const totals = Object.fromEntries(keys.map((key) => [key, rows.reduce((s, r) => s + r[key], 0)]));
  return { properties: rows, totals };
}

// ---- Budgets -------------------------------------------------------------------------------

/** Budgeted cents for one account line in a given month (1-12). */
export function budgetForMonth(line, month) {
  if (Array.isArray(line.months) && line.months.length === 12) return Number(line.months[month - 1]) || 0;
  return Number(line.monthly) || 0;
}

export function budgetVsActual(store, { budgetId, from = null, to = null } = {}) {
  const budget = store.get('budgets', budgetId);
  const accounts = byId(store);
  if (!budget) return { rows: [], totals: { income: { budget: 0, actual: 0 }, expense: { budget: 0, actual: 0 }, net: { budget: 0, actual: 0 } } };
  const year = Number(budget.year);
  const start = from && from > `${year}-01-01` ? from : `${year}-01-01`;
  const end = to && to < `${year}-12-31` ? to : `${year}-12-31`;
  const m1 = Number(start.slice(5, 7));
  const m2 = Number(end.slice(5, 7));
  const actualTotals = sumLines(live(store), (tx, l) => inRange(tx.date, start, end) && l.propertyId === budget.propertyId);
  const ids = new Set((budget.lines || []).map((l) => l.accountId));
  for (const [id, sum] of actualTotals) {
    const t = accounts.get(id)?.type;
    if (sum && (t === 'income' || t === 'expense')) ids.add(id);
  }
  const rows = [];
  for (const id of ids) {
    const a = accounts.get(id);
    if (!a || (a.type !== 'income' && a.type !== 'expense')) continue;
    const line = (budget.lines || []).find((l) => l.accountId === id);
    let b = 0;
    if (line && start <= end) for (let m = m1; m <= m2; m++) b += budgetForMonth(line, m);
    const actual = (actualTotals.get(id) || 0) * normalSign(a.type);
    // Positive variance is always favorable: more income or less expense.
    const variance = a.type === 'income' ? actual - b : b - actual;
    rows.push({ accountId: id, name: a.name, number: a.number || '', type: a.type, budget: b, actual, variance, pct: b ? actual / b : null });
  }
  rows.sort((x, y) => compareAccounts(accounts.get(x.accountId), accounts.get(y.accountId)));
  const sum = (type, key) => rows.filter((r) => r.type === type).reduce((s, r) => s + r[key], 0);
  const totals = {
    income: { budget: sum('income', 'budget'), actual: sum('income', 'actual') },
    expense: { budget: sum('expense', 'budget'), actual: sum('expense', 'actual') },
  };
  totals.net = { budget: totals.income.budget - totals.expense.budget, actual: totals.income.actual - totals.expense.actual };
  return { rows, totals, from: start, to: end };
}

// ---- Trends and cash -----------------------------------------------------------------------

function monthKey(y, m) {
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function monthlyIncomeExpense(store, { months = 12, today, propertyIds = null } = {}) {
  const accounts = byId(store);
  const set = propSet(propertyIds);
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const keys = [];
  for (let i = 0; i < months; i++) {
    keys.unshift(monthKey(y, m));
    m -= 1;
    if (!m) {
      m = 12;
      y -= 1;
    }
  }
  const out = new Map(keys.map((k) => [k, { month: k, income: 0, expense: 0 }]));
  for (const tx of live(store)) {
    const row = out.get(tx.date.slice(0, 7));
    if (!row || tx.date > today) continue;
    for (const l of tx.lines) {
      if (!inProps(l, set)) continue;
      const t = accounts.get(l.accountId)?.type;
      if (t === 'income') row.income -= l.amount;
      else if (t === 'expense') row.expense += l.amount;
    }
  }
  return [...out.values()];
}

/** Cash held in bank accounts for one property. */
export function propertyCash(store, propertyId, asOf = null) {
  const accounts = byId(store);
  let sum = 0;
  for (const tx of live(store)) {
    if (asOf && tx.date > asOf) continue;
    for (const l of tx.lines) if (l.propertyId === propertyId && accounts.get(l.accountId)?.bank) sum += l.amount;
  }
  return sum;
}

/** Debit-positive balance of an account, optionally as of a date. */
export function accountBalance(store, accountId, asOf = null) {
  let sum = 0;
  for (const tx of live(store)) {
    if (asOf && tx.date > asOf) continue;
    for (const l of tx.lines) if (l.accountId === accountId) sum += l.amount;
  }
  return sum;
}

// ---- Reconciliation -------------------------------------------------------------------------

/** Ids of transactions cleared by finished reconciliations of an account. */
export function reconciledIds(store, accountId) {
  const ids = new Set();
  for (const r of store.all('reconciliations')) if (r.accountId === accountId && r.status === 'reconciled') for (const id of r.cleared || []) ids.add(id);
  return ids;
}

export function lastReconciliation(store, accountId) {
  return (
    store
      .all('reconciliations')
      .filter((r) => r.accountId === accountId && r.status === 'reconciled')
      .sort((a, b) => (a.statementDate < b.statementDate ? 1 : -1))[0] || null
  );
}

/**
 * Transactions touching a bank account that no finished reconciliation has
 * cleared, up to a date. amount is the debit-positive effect on the account.
 */
export function unreconciledLines(store, accountId, upTo = null) {
  const done = reconciledIds(store, accountId);
  const out = [];
  for (const tx of live(store)) {
    if (done.has(tx.id) || (upTo && tx.date > upTo)) continue;
    let amount = 0;
    let touches = false;
    for (const l of tx.lines) {
      if (l.accountId !== accountId) continue;
      touches = true;
      amount += l.amount;
    }
    if (touches && amount) out.push({ tx, date: tx.date, amount });
  }
  return out.sort((a, b) => txOrder(a.tx, b.tx));
}

/**
 * Balance the bank statement should show: everything already reconciled
 * plus the transactions ticked in this reconciliation.
 */
export function clearedBalance(store, accountId, cleared = []) {
  const done = reconciledIds(store, accountId);
  const ticked = new Set(cleared);
  let sum = 0;
  for (const tx of live(store)) {
    if (!done.has(tx.id) && !ticked.has(tx.id)) continue;
    for (const l of tx.lines) if (l.accountId === accountId) sum += l.amount;
  }
  return sum;
}
