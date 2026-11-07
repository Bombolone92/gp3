/**
 * Billing and trust accounting. Pure functions over plain records; all
 * amounts are integer cents.
 *
 * Activities (time, expense, flat fee) are the unit of billable work. A bill
 * snapshots the activities it covers as lines, so later edits to an activity
 * never change a bill that was already issued. Payments settle bills. Every
 * movement of money is a transaction on a bank account, which is what the
 * trust ledger and account balances are computed from.
 */
import { timeValue } from './duration.js';
import { centsStep, mulCents, percentOf, roundCents } from './money.js';
import { addDays, diffDays } from './dates.js';
import { newId } from './ids.js';

// ---- Activities -------------------------------------------------------------

export function activityAmount(a) {
  if (!a) return 0;
  if (a.kind === 'time') return timeValue(a.minutes, a.rateCents);
  if (a.kind === 'expense') return mulCents(Number(a.priceCents) || 0, Number(a.qty ?? 1) || 0);
  return Number(a.amountCents) || 0; // flat fee
}

export const isUnbilled = (a) => !!a && a.billable !== false && !a.billId;

/** Hourly rate for new time: matter override, then user's rate, then the client's own rate, then firm default. */
export function rateFor({ matter, user, client = null, settings }) {
  if (matter?.billing?.method === 'hourly' && Number(matter.billing.rateCents) > 0) return Number(matter.billing.rateCents);
  if (user && Number(user.rateCents) > 0) return Number(user.rateCents);
  if (client && Number(client.rateCents) > 0) return Number(client.rateCents);
  return Number(settings?.billing?.defaultRateCents) || 0;
}

/** Totals over a list of activities: { minutes, billableMinutes, amount, billableAmount }. */
export function sumActivities(list) {
  let minutes = 0;
  let billableMinutes = 0;
  let amount = 0;
  let billableAmount = 0;
  for (const a of list) {
    const v = activityAmount(a);
    amount += v;
    if (a.kind === 'time') minutes += Number(a.minutes) || 0;
    if (a.billable !== false) {
      billableAmount += v;
      if (a.kind === 'time') billableMinutes += Number(a.minutes) || 0;
    }
  }
  return { minutes, billableMinutes, amount, billableAmount };
}

// ---- Bills ------------------------------------------------------------------

/** A bill line from an activity (a snapshot, independent of later edits). */
export function lineFromActivity(a) {
  return {
    id: newId(),
    activityId: a.id,
    kind: a.kind,
    date: a.date,
    description: a.description || '',
    categoryId: a.categoryId || null,
    userId: a.userId || null,
    minutes: a.kind === 'time' ? Number(a.minutes) || 0 : null,
    rateCents: a.kind === 'time' ? Number(a.rateCents) || 0 : null,
    qty: a.kind === 'expense' ? Number(a.qty ?? 1) : null,
    priceCents: a.kind === 'expense' ? Number(a.priceCents) || 0 : null,
    amountCents: activityAmount(a),
  };
}

export function lineAmount(l) {
  if (l.kind === 'time') return timeValue(l.minutes, l.rateCents);
  if (l.kind === 'expense') return mulCents(Number(l.priceCents) || 0, Number(l.qty ?? 1) || 0);
  return Number(l.amountCents) || 0;
}

/**
 * { fees, expenses, subtotal, discount, tax, total }. Expense lines are
 * disbursements: the discount applies to fees only, and tax applies to fees
 * (and to expenses when the firm taxes them).
 */
export function billTotals(bill) {
  let fees = 0;
  let expenses = 0;
  for (const l of bill?.lines || []) {
    const v = lineAmount(l);
    if (l.kind === 'expense') expenses += v;
    else fees += v;
  }
  const d = bill?.discount;
  let discount = 0;
  // Credit lines can make fees negative; a discount never goes below zero.
  const discountable = Math.max(0, fees);
  if (d && Number(d.value) > 0) discount = d.type === 'amount' ? Math.min(discountable, Math.round(Number(d.value))) : percentOf(discountable, Math.min(100, Number(d.value)));
  const taxable = fees - discount + (bill?.taxExpenses ? expenses : 0);
  const tax = Math.max(0, percentOf(taxable, Number(bill?.taxRate) || 0));
  const subtotal = fees + expenses;
  return { fees, expenses, subtotal, discount, tax, total: roundCents(subtotal - discount + tax) };
}

// billId -> amount paid, per payments array. store.all() returns the same array until payments
// change, so lists of bills read the payments once instead of once per bill.
const paidByBill = new WeakMap();

export function billPaid(bill, payments) {
  let index = paidByBill.get(payments);
  if (!index) {
    index = new Map();
    for (const p of payments) {
      const id = p.billId;
      if (id) index.set(id, (index.get(id) || 0) + (Number(p.amountCents) || 0));
    }
    paidByBill.set(payments, index);
  }
  return index.get(bill.id) || 0;
}

export function billBalance(bill, payments) {
  if (bill.status === 'void' || bill.status === 'draft' || bill.status === 'pending') return 0;
  const due = billTotals(bill).total - billPaid(bill, payments);
  // Less than the currency's smallest unit is not owed (a yen bill paid before
  // amounts were rounded to whole yen can be a fraction of a yen short).
  return due < centsStep() ? 0 : due;
}

/**
 * Display status: draft, pending (awaiting approval), unpaid, overdue,
 * partial, paid, void.
 */
export function billStatus(bill, payments, today) {
  if (!bill) return 'draft';
  if (bill.status === 'void' || bill.status === 'draft' || bill.status === 'pending') return bill.status;
  const { total } = billTotals(bill);
  const paid = billPaid(bill, payments);
  if (total - paid < centsStep()) return 'paid';
  if (bill.dueDate && bill.dueDate < today) return 'overdue';
  return paid > 0 ? 'partial' : 'unpaid';
}

export const BILL_STATUS = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending: { label: 'Pending approval', tone: 'info' },
  unpaid: { label: 'Unpaid', tone: 'warning' },
  partial: { label: 'Partially paid', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'danger' },
  paid: { label: 'Paid', tone: 'success' },
  void: { label: 'Void', tone: 'neutral' },
};

/**
 * Whether a flat fee matter still needs its agreed fee added to a bill: it
 * was never billed, and nobody records the fee as flat fee entries (billed
 * or not) instead.
 */
export function flatFeeDue(matter, activities) {
  if (matter?.billing?.method !== 'flat' || !(Number(matter.billing.flatFeeCents) > 0) || matter.billing.flatFeeBilled) return false;
  return !activities.some((a) => a.matterId === matter.id && a.kind === 'flat' && a.billable !== false);
}

/**
 * Draft a bill for a matter from its unbilled activities in [from, to]
 * (either bound may be empty). Returns { bill, activityIds } or null when
 * there is nothing to bill. A flat fee matter with no flat fee entry yet gets
 * one line for the agreed fee.
 */
export function draftBill({ matter, activities, settings, number, issueDate, from = '', to = '', userId = null }) {
  const picked = activities
    .filter((a) => a.matterId === matter.id && isUnbilled(a) && (!from || a.date >= from) && (!to || a.date <= to))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const lines = picked.map(lineFromActivity);
  if (flatFeeDue(matter, activities)) {
    lines.unshift({
      id: newId(),
      activityId: null,
      kind: 'flat',
      date: issueDate,
      description: `Flat fee: ${matter.description || 'legal services'}`,
      userId,
      amountCents: Number(matter.billing.flatFeeCents),
    });
  }
  if (!lines.length) return null;
  const b = settings.billing || {};
  return {
    bill: {
      number,
      matterId: matter.id,
      clientId: matter.clientId || null,
      issueDate,
      dueDate: addDays(issueDate, Number(b.termsDays ?? 30)),
      status: 'draft',
      lines,
      discount: { type: 'percent', value: 0 },
      taxRate: Number(b.taxRate) || 0,
      taxName: b.taxName || 'Tax',
      taxExpenses: !!b.taxExpenses,
      message: b.message || '',
      periodFrom: from || picked[0]?.date || issueDate,
      periodTo: to || picked[picked.length - 1]?.date || issueDate,
    },
    activityIds: picked.map((a) => a.id),
  };
}

/** Accounts receivable aging of open balances: current, 1-30, 31-60, 61-90, 90+ days past due. */
export function agingBuckets(bills, payments, today) {
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
  for (const b of bills) {
    const bal = billBalance(b, payments);
    if (bal <= 0) continue;
    const late = b.dueDate ? diffDays(b.dueDate, today) : 0;
    if (late <= 0) buckets.current += bal;
    else if (late <= 30) buckets.d30 += bal;
    else if (late <= 60) buckets.d60 += bal;
    else if (late <= 90) buckets.d90 += bal;
    else buckets.d90plus += bal;
  }
  return buckets;
}

// ---- Accounts and trust -------------------------------------------------------

/** Signed effect of a transaction on its account. */
export function txAmount(t) {
  const v = Math.abs(Number(t.amountCents) || 0);
  return t.type === 'withdrawal' ? -v : v;
}

export function accountBalance(account, transactions) {
  let bal = Number(account.openingBalanceCents) || 0;
  for (const t of transactions) if (t.accountId === account.id) bal += txAmount(t);
  return bal;
}

/** Trust funds held for one matter (across all trust accounts). */
export function trustBalance(matterId, transactions, accounts) {
  const trustIds = new Set(accounts.filter((a) => a.type === 'trust').map((a) => a.id));
  let bal = 0;
  for (const t of transactions) if (t.matterId === matterId && trustIds.has(t.accountId)) bal += txAmount(t);
  return bal;
}

/** Trust funds held for one matter in one trust account. */
export function matterAccountBalance(matterId, accountId, transactions) {
  let bal = 0;
  for (const t of transactions) if (t.matterId === matterId && t.accountId === accountId) bal += txAmount(t);
  return bal;
}

/**
 * Running ledger for an account (optionally one matter), oldest first:
 * [{ ...transaction, balance }].
 */
export function ledger(transactions, { accountId = null, matterId = null, opening = 0 } = {}) {
  const rows = transactions
    .filter((t) => (!accountId || t.accountId === accountId) && (!matterId || t.matterId === matterId))
    .sort((a, b) => (a.date === b.date ? String(a.createdAt || '').localeCompare(String(b.createdAt || '')) : a.date < b.date ? -1 : 1));
  let bal = opening;
  return rows.map((t) => {
    bal += txAmount(t);
    return { ...t, balance: bal };
  });
}

/**
 * Whether a trust withdrawal is allowed. Trust money belongs to the client:
 * a matter's trust balance may never go below zero. With a `date`, the
 * withdrawal must also leave the matter's ledger at or above zero on that
 * day and on every later day (a backdated withdrawal cannot spend funds
 * that arrived after it).
 */
export function checkTrustWithdrawal({ matterId, accountId, amountCents, transactions, ignoreTxIds = [], date = '' }) {
  const ignore = new Set(ignoreTxIds);
  const kept = transactions.filter((t) => !ignore.has(t.id));
  const held = matterAccountBalance(matterId, accountId, kept);
  let available = held;
  if (date) {
    // The new withdrawal sorts after everything already on its date: what is available is the
    // balance at the end of that day, or the lowest running balance after it if that is lower.
    let low = 0;
    for (const r of ledger(kept.filter((t) => t.matterId === matterId && t.accountId === accountId))) low = r.date <= date ? r.balance : Math.min(low, r.balance);
    available = low;
  }
  const amount = Math.abs(Number(amountCents) || 0);
  if (!matterId) return { ok: false, available, reason: 'Trust withdrawals must be tied to a matter.' };
  if (amount <= 0) return { ok: false, available, reason: 'Enter an amount greater than zero.' };
  if (amount > available)
    return { ok: false, available, reason: amount > held ? 'This would overdraw the trust funds held for this matter.' : 'This would overdraw the trust funds held for this matter on or after that date.' };
  return { ok: true, available };
}

// ---- Matters --------------------------------------------------------------------

/**
 * Money at a glance for a matter. `lists` are the firm's full collections
 * (or any superset of this matter's records).
 */
export function matterFinancials(matter, { activities, bills, payments, transactions, accounts }) {
  let wip = 0;
  let wipMinutes = 0;
  let workedAmount = 0;
  let workedMinutes = 0;
  for (const a of activities) {
    if (a.matterId !== matter.id) continue;
    const v = activityAmount(a);
    if (a.kind === 'time') workedMinutes += Number(a.minutes) || 0;
    if (a.billable !== false) workedAmount += v;
    if (isUnbilled(a)) {
      wip += v;
      if (a.kind === 'time') wipMinutes += Number(a.minutes) || 0;
    }
  }
  let billed = 0;
  let outstanding = 0;
  let paid = 0;
  for (const b of bills) {
    if (b.matterId !== matter.id || b.status === 'void' || b.status === 'draft' || b.status === 'pending') continue;
    billed += billTotals(b).total;
    outstanding += billBalance(b, payments);
  }
  for (const p of payments) if (p.matterId === matter.id) paid += Number(p.amountCents) || 0;
  const trust = trustBalance(matter.id, transactions, accounts);
  const budget = Number(matter.billing?.budgetCents) || 0;
  return {
    wip,
    wipMinutes,
    workedAmount,
    workedMinutes,
    billed,
    outstanding,
    paid,
    trust,
    budget,
    budgetUsedPct: budget ? Math.round((workedAmount / budget) * 100) : null,
    trustLow: Number(matter.trustMinimumCents) > 0 && trust < Number(matter.trustMinimumCents),
  };
}
