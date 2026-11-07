/**
 * Pure helpers behind the activities, billing, and accounts screens:
 * filtering entries, grouping bills by tab, per-client balances, bill runs,
 * period navigation, and the trust three-way reconciliation check.
 */
import { activityAmount, flatFeeDue, isUnbilled, billBalance, billPaid, billStatus, billTotals, agingBuckets, accountBalance, txAmount } from './finance.js';
import { addDays, addMonths, diffDays, startOfMonth, endOfMonth } from './dates.js';
import { normalize } from './format.js';

// ---- Activities ------------------------------------------------------------------

/** 'unbilled' | 'billed' | 'nonbillable' */
export function activityBillingState(a) {
  if (a.billable === false) return 'nonbillable';
  return a.billId ? 'billed' : 'unbilled';
}

/**
 * Filter activities. opts: { kind: 'all'|'time'|'expense'|'flat', from, to,
 * userId, billed: 'all'|'unbilled'|'billed'|'nonbillable', matterId, q,
 * textOf(a) for search }.
 */
export function filterActivities(list, { kind = 'all', from = '', to = '', userId = '', billed = 'all', matterId = '', q = '', textOf = (a) => a.description || '' } = {}) {
  const tokens = normalize(q).trim().split(/\s+/).filter(Boolean);
  return list.filter((a) => {
    if (kind !== 'all' && a.kind !== kind) return false;
    if (from && a.date < from) return false;
    if (to && a.date > to) return false;
    if (userId && a.userId !== userId) return false;
    if (matterId && a.matterId !== matterId) return false;
    if (billed !== 'all' && activityBillingState(a) !== billed) return false;
    if (tokens.length) {
      const t = normalize(textOf(a));
      if (!tokens.every((tok) => t.includes(tok))) return false;
    }
    return true;
  });
}

/** Totals for the activities footer. */
export function activityTotals(list) {
  let billableMinutes = 0;
  let nonBillableMinutes = 0;
  let amount = 0;
  let billableAmount = 0;
  for (const a of list) {
    const v = activityAmount(a);
    amount += v;
    const billable = a.billable !== false;
    if (billable) billableAmount += v;
    if (a.kind === 'time') {
      if (billable) billableMinutes += Number(a.minutes) || 0;
      else nonBillableMinutes += Number(a.minutes) || 0;
    }
  }
  return { count: list.length, billableMinutes, nonBillableMinutes, minutes: billableMinutes + nonBillableMinutes, amount, billableAmount };
}

/**
 * Move a date range one period back (dir -1) or forward (dir 1). Whole
 * months (a month, a quarter, a year) move by their number of months;
 * anything else moves by its own length.
 */
export function shiftRange(from, to, dir) {
  if (!from || !to) return null;
  if (from === startOfMonth(from) && to === endOfMonth(to) && from <= to) {
    const n = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
    const s = addMonths(from, dir * n);
    return [s, endOfMonth(addMonths(s, n - 1))];
  }
  const len = diffDays(from, to) + 1;
  return [addDays(from, dir * len), addDays(to, dir * len)];
}

// ---- Bills ----------------------------------------------------------------------------

export const BILL_TABS = [
  { id: 'draft', label: 'Draft', match: (s) => s === 'draft' },
  { id: 'pending', label: 'Pending approval', match: (s) => s === 'pending' },
  { id: 'unpaid', label: 'Unpaid', match: (s) => s === 'unpaid' || s === 'partial' || s === 'overdue' },
  { id: 'overdue', label: 'Overdue', match: (s) => s === 'overdue' },
  { id: 'paid', label: 'Paid', match: (s) => s === 'paid' },
  { id: 'void', label: 'Void', match: (s) => s === 'void' },
  { id: 'all', label: 'All', match: () => true },
];

export function billTab(id) {
  return BILL_TABS.find((t) => t.id === id) || BILL_TABS[2];
}

/** Activity ids a bill covers (to release them when the bill is voided or deleted). */
export function billActivityIds(bill) {
  return [...new Set((bill?.lines || []).map((l) => l.activityId).filter(Boolean))];
}

/** Next stored status for "approve": draft -> pending -> issued. */
export function nextApprovalStatus(status) {
  if (status === 'draft') return 'pending';
  if (status === 'pending') return 'issued';
  return status;
}

/**
 * Per-client outstanding balances. Returns rows sorted by outstanding desc:
 * { clientId, matters, wip, outstanding, aging, trust, lastPayment }.
 */
export function outstandingByClient({ matters, bills, payments, activities, transactions, accounts, today }) {
  const trustIds = new Set(accounts.filter((a) => a.type === 'trust').map((a) => a.id));
  const matterClient = new Map(matters.map((m) => [m.id, m.clientId]));
  const rows = new Map();
  const row = (cid) => {
    if (!rows.has(cid)) rows.set(cid, { clientId: cid, matterIds: new Set(), wip: 0, outstanding: 0, aging: { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 }, trust: 0, lastPayment: '' });
    return rows.get(cid);
  };
  for (const m of matters) if (m.clientId) row(m.clientId).matterIds.add(m.id);
  for (const a of activities) {
    if (!isUnbilled(a) || !a.matterId) continue;
    const cid = matterClient.get(a.matterId);
    if (cid) row(cid).wip += activityAmount(a);
  }
  // Each bill's own payments, so balances are not a scan of every payment.
  const paysByBill = new Map();
  for (const p of payments) {
    if (!p.billId) continue;
    if (!paysByBill.has(p.billId)) paysByBill.set(p.billId, []);
    paysByBill.get(p.billId).push(p);
  }
  for (const b of bills) {
    const cid = b.clientId || matterClient.get(b.matterId);
    if (!cid) continue;
    const pays = paysByBill.get(b.id) || [];
    const bal = billBalance(b, pays);
    if (bal <= 0) continue;
    const r = row(cid);
    r.outstanding += bal;
    const a = agingBuckets([b], pays, today);
    for (const k in a) r.aging[k] += a[k];
  }
  for (const p of payments) {
    const cid = p.contactId || matterClient.get(p.matterId);
    if (!cid) continue;
    const r = row(cid);
    if (p.date > r.lastPayment) r.lastPayment = p.date;
  }
  for (const t of transactions) {
    if (!trustIds.has(t.accountId) || !t.matterId) continue;
    const cid = matterClient.get(t.matterId);
    if (cid) row(cid).trust += txAmount(t);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, matters: r.matterIds.size }))
    .filter((r) => r.wip || r.outstanding || r.trust)
    .sort((a, b) => b.outstanding - a.outstanding || b.wip - a.wip);
}

/** Open bills for a client with their balances (for statements). */
export function openBillsForClient(clientId, bills, payments, today, matters = []) {
  // Same client rule as outstandingByClient: the bill's client, else its matter's.
  const matterClient = new Map(matters.map((m) => [m.id, m.clientId]));
  return bills
    .filter((b) => (b.clientId || matterClient.get(b.matterId)) === clientId && billBalance(b, payments) > 0)
    .sort((a, b) => (a.issueDate < b.issueDate ? -1 : 1))
    .map((b) => ({ bill: b, total: billTotals(b).total, paid: billPaid(b, payments), balance: billBalance(b, payments), status: billStatus(b, payments, today) }));
}

/**
 * Matters ready to bill in [from, to]: unbilled billable activity, or a flat
 * fee matter whose fee was never billed. Returns
 * [{ matter, minutes, time, expenses, flat, total, activityIds }].
 */
export function billableMatters({ matters, activities, from = '', to = '' }) {
  const byMatter = new Map();
  for (const a of activities) {
    if (!a.matterId || !isUnbilled(a)) continue;
    if (from && a.date < from) continue;
    if (to && a.date > to) continue;
    if (!byMatter.has(a.matterId)) byMatter.set(a.matterId, []);
    byMatter.get(a.matterId).push(a);
  }
  // Matters whose flat fee is recorded as flat fee entries, billed or not.
  const flatEntered = new Set(activities.filter((a) => a.kind === 'flat' && a.billable !== false).map((a) => a.matterId));
  const out = [];
  for (const m of matters) {
    const list = byMatter.get(m.id) || [];
    const flatPending = !flatEntered.has(m.id) && flatFeeDue(m, []);
    if (!list.length && !flatPending) continue;
    let minutes = 0;
    let time = 0;
    let expenses = 0;
    let flat = flatPending ? Number(m.billing.flatFeeCents) : 0;
    for (const a of list) {
      const v = activityAmount(a);
      if (a.kind === 'time') {
        minutes += Number(a.minutes) || 0;
        time += v;
      } else if (a.kind === 'expense') expenses += v;
      else flat += v;
    }
    out.push({ matter: m, minutes, time, expenses, flat, total: time + expenses + flat, activityIds: list.map((a) => a.id) });
  }
  return out;
}

// ---- Trust ------------------------------------------------------------------------------

/**
 * Three-way reconciliation: the bank statement balance, the account's book
 * (ledger) balance, and the sum of every client's trust ledger must agree.
 * statementCents may be null when the person has not entered it yet.
 */
export function reconcileTrust({ account, transactions, statementCents = null }) {
  const book = accountBalance(account, transactions);
  const perMatter = new Map();
  // An opening balance belongs to no client ledger, like a deposit without a matter.
  let unassigned = Number(account.openingBalanceCents) || 0;
  for (const t of transactions) {
    if (t.accountId !== account.id) continue;
    if (!t.matterId) {
      unassigned += txAmount(t);
      continue;
    }
    perMatter.set(t.matterId, (perMatter.get(t.matterId) || 0) + txAmount(t));
  }
  let clients = 0;
  for (const v of perMatter.values()) clients += v;
  const negative = [...perMatter.entries()].filter(([, v]) => v < 0).map(([id, v]) => ({ matterId: id, balance: v }));
  const bankKnown = statementCents !== null && statementCents !== undefined && Number.isFinite(statementCents);
  return {
    book,
    clients,
    unassigned,
    bank: bankKnown ? statementCents : null,
    bankDiff: bankKnown ? statementCents - book : null,
    clientsDiff: book - clients,
    negative,
    balanced: (!bankKnown || statementCents === book) && book === clients && !negative.length,
  };
}
