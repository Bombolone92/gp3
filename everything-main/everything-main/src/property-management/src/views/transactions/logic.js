/**
 * Pure helpers behind the lease pages and transaction dialogs: aging,
 * running ledgers, proration and payment allocation. No DOM, no store
 * access, so they are easy to test.
 */
import { ACC } from '../../core/accounts.js';
import { diffDays, addDays, parseISODate } from '../../core/dates.js';
import { computeIndex, leaseEffect } from '../../core/ledger.js';

export const AGING_BUCKETS = [
  { id: 'current', label: '0 to 30 days', max: 30 },
  { id: 'd31', label: '31 to 60 days', max: 60 },
  { id: 'd61', label: '61 to 90 days', max: 90 },
  { id: 'd90', label: 'Over 90 days', max: Infinity },
];

/**
 * Age what a lease owes by charge date. Payments and credits are applied to
 * the oldest charges first; whatever is left open is bucketed by how many
 * days ago it was charged. `lines` are a ledger index lease's lines.
 * Returns { current, d31, d61, d90, total }.
 */
export function agingBuckets(lines, today) {
  const out = { current: 0, d31: 0, d61: 0, d90: 0, total: 0 };
  const debits = [];
  let credit = 0;
  for (const l of lines) {
    if (l.date > today) continue;
    if (l.amount > 0) debits.push({ date: l.date, open: l.amount });
    else credit += -l.amount;
  }
  debits.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const d of debits) {
    const used = Math.min(d.open, credit);
    d.open -= used;
    credit -= used;
    if (!d.open) continue;
    const age = diffDays(d.date, today);
    const bucket = AGING_BUCKETS.find((b) => age <= b.max).id;
    out[bucket] += d.open;
    out.total += d.open;
  }
  return out;
}

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || '') < (b.createdAt || '') ? -1 : (a.createdAt || '') > (b.createdAt || '') ? 1 : 0);

/**
 * Running ledger for one lease, oldest first:
 * [{ tx, effect, charge, credit, balance }]. Voided transactions are kept
 * (so they can be shown) but do not move the balance.
 */
export function ledgerRows(transactions, leaseId) {
  const rows = [];
  let balance = 0;
  for (const tx of transactions.filter((t) => t.leaseId === leaseId || t.lines?.some((l) => l.leaseId === leaseId)).sort(byDate)) {
    const effect = tx.voided ? 0 : leaseEffect(tx, leaseId);
    // Moving prepaid rent onto a charge does not change what is owed.
    if (!tx.voided && !effect && tx.kind === 'apply-prepayment') continue;
    balance += effect;
    rows.push({ tx, effect, charge: effect > 0 ? effect : 0, credit: effect < 0 ? -effect : 0, balance });
  }
  return rows;
}

/** Charged, paid and open amounts per account for a lease. */
export function accountSummary(transactions, leaseId) {
  const m = new Map();
  const row = (id) => {
    if (!m.has(id)) m.set(id, { accountId: id, charged: 0, paid: 0, balance: 0 });
    return m.get(id);
  };
  for (const tx of transactions) {
    if (tx.voided) continue;
    for (const l of tx.lines || []) {
      if (l.leaseId !== leaseId || l.accountId !== ACC.ar) continue;
      const r = row(l.forAccountId || ACC.rent);
      if (l.amount > 0) r.charged += l.amount;
      else r.paid += -l.amount;
      r.balance += l.amount;
    }
  }
  return [...m.values()];
}

function daysInMonth(iso) {
  const d = parseISODate(iso);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** The first due date (rent day) strictly after `start`. */
export function firstDueAfter(start, day) {
  const d = parseISODate(start);
  const y = d.getFullYear();
  const m = d.getMonth();
  const clamp = (yy, mm) => Math.min(day, new Date(yy, mm + 1, 0).getDate());
  const sameMonth = new Date(y, m, clamp(y, m));
  if (sameMonth > d) return toISO(sameMonth);
  return toISO(new Date(y, m + 1, clamp(y, m + 1)));
}

function toISO(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Rent for the partial period from `start` up to the day before the first
 * regular due date, prorated by the days in the start month. Returns
 * { amount, from, to, firstDue } or null when the lease starts on its due day.
 */
export function proration(rent, start, day) {
  if (!rent || !start) return null;
  const startDay = Number(start.slice(8, 10));
  const lastOfMonth = daysInMonth(start);
  if (startDay === Math.min(day, lastOfMonth)) return null;
  const firstDue = firstDueAfter(start, day);
  const days = diffDays(start, firstDue);
  if (days <= 0) return null;
  return { amount: Math.round((rent * days) / daysInMonth(start)), from: start, to: addDays(firstDue, -1), firstDue, days };
}

/** Rows for a payment's "Apply to" table: accounts with money owed. */
export function owedRows(byAccount) {
  return [...byAccount.entries()].filter(([, v]) => v > 0).map(([accountId, owed]) => ({ accountId, owed }));
}

/** Sum of allocation amounts. */
export const allocated = (rows) => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

/** Group selected bill payments by vendor: Map(vendorId -> [{ billId, amount }]). */
export function groupByVendor(selections, billsById) {
  const out = new Map();
  for (const s of selections) {
    if (!(s.amount > 0)) continue;
    const bill = billsById.get(s.billId);
    if (!bill) continue;
    if (!out.has(bill.vendorId)) out.set(bill.vendorId, []);
    out.get(bill.vendorId).push({ billId: s.billId, amount: s.amount });
  }
  return out;
}

/** Debit minus credit across journal grid rows. */
export function journalDifference(rows) {
  return rows.reduce((s, r) => s + (Number(r.debit) || 0) - (Number(r.credit) || 0), 0);
}

/**
 * Why replacing a transaction with `next` (an edit, a void or a restore)
 * would leave the books impossible, or null when it is fine: a bill paid
 * beyond its total, more deposit refunded or applied than was collected,
 * more prepaid rent used than the tenant has, or (for an edited charge)
 * payments already applied to it adding up to more than its new amount.
 */
export function changeProblem(transactions, next, { action = 'This change' } = {}) {
  const old = transactions.find((t) => t.id === next.id) || null;
  const before = computeIndex(transactions);
  const ix = computeIndex(transactions.map((t) => (t.id === next.id ? next : t)));
  const billIds = new Set([...(next.allocations || []), ...(old?.allocations || [])].map((a) => a.billId));
  if (next.kind === 'bill') billIds.add(next.id);
  for (const id of billIds) if (ix.bill(id).balance < 0) return `${action} would pay that bill more than it is for. Void the newer payment first.`;
  const leaseIds = new Set([...(next.lines || []), ...(old?.lines || [])].map((l) => l.leaseId).filter(Boolean));
  for (const id of leaseIds) {
    const l = ix.lease(id);
    const was = before.lease(id);
    const unpaidDeposit = Math.max(0, l.byAccount.get(ACC.depositsHeld) || 0);
    if (l.depositsCharged - unpaidDeposit < 0) return `${action} would use more deposit than the tenant paid. Void the deposit refund or application first.`;
    if (l.prepaid < 0 && l.prepaid < was.prepaid) return `${action} would use more prepaid rent than the tenant has. It was already applied to charges or refunded; void that first.`;
    if (next.kind === 'charge' && !next.voided) {
      for (const [acc, v] of l.byAccount) if (v < 0 && v < (was.byAccount.get(acc) || 0)) return `${action} would make the charge smaller than what was already paid on it. Edit or void the payment first.`;
    }
  }
  return null;
}

/** Why a voided transaction cannot be restored, or null when it can. */
export function restoreProblem(transactions, tx) {
  return changeProblem(transactions, { ...tx, voided: false }, { action: 'Restoring it' });
}
