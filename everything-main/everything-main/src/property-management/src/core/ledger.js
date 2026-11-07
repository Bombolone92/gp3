/**
 * Double-entry ledger.
 *
 * Every financial event is one transaction record with balanced lines:
 *
 *   { id, kind, date, memo, ref, lines: [{ accountId, amount, propertyId,
 *     unitId?, leaseId?, vendorId?, ownerId?, forAccountId? }], ... }
 *
 * `amount` is integer cents, positive for a debit and negative for a credit,
 * and the lines of a transaction always sum to zero. Receivable lines carry
 * `forAccountId` (the income or deposit account the charge was for), so a
 * lease balance can be broken down by what it is for and payments can be
 * applied to specific charges.
 *
 * The builders below are pure: they return a transaction and the caller
 * stores it. ledgerIndex() derives every balance the app shows in one pass
 * and is memoized on the store's revision counter.
 */
import { ACC } from './accounts.js';
import { newId } from './ids.js';

export const TX_KINDS = {
  charge: 'Charge',
  payment: 'Payment',
  credit: 'Credit',
  refund: 'Refund',
  'apply-deposit': 'Deposit applied',
  'apply-prepayment': 'Prepayment applied',
  bill: 'Bill',
  'bill-payment': 'Bill payment',
  expense: 'Expense',
  transfer: 'Transfer',
  journal: 'Journal entry',
  contribution: 'Owner contribution',
  distribution: 'Owner distribution',
  deposit: 'Bank deposit',
};

export function kindLabel(kind) {
  return TX_KINDS[kind] || 'Transaction';
}

const int = (v) => Math.round(Number(v) || 0);
const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0);

export function isBalanced(tx) {
  return Array.isArray(tx?.lines) && tx.lines.length > 0 && sum(tx.lines, (l) => int(l.amount)) === 0 && tx.lines.every((l) => l.accountId);
}

export function txTotal(tx) {
  return sum((tx.lines || []).filter((l) => l.amount > 0), (l) => l.amount);
}

function base(kind, { id, date, memo = '', ref = '', attachments, workOrderId } = {}) {
  return {
    id: id || newId(),
    kind,
    date,
    memo: String(memo || '').trim(),
    ref: String(ref || '').trim(),
    ...(attachments?.length ? { attachments } : {}),
    ...(workOrderId ? { workOrderId } : {}),
  };
}

function leaseRefs(lease) {
  return { leaseId: lease.id, propertyId: lease.propertyId, unitId: lease.unitId || null };
}

const positive = (items) => items.map((i) => ({ ...i, amount: int(i.amount) })).filter((i) => i.amount > 0);

// ---- Lease transactions -------------------------------------------------------

/** Charge a lease: debit receivables, credit the income (or deposit) account. */
export function buildCharge({ lease, date, items, memo, ref, id, dueDate, auto }) {
  const r = leaseRefs(lease);
  const lines = [];
  for (const it of positive(items)) {
    lines.push({ accountId: ACC.ar, amount: it.amount, ...r, forAccountId: it.accountId, memo: it.memo || '' });
    lines.push({ accountId: it.accountId, amount: -it.amount, ...r });
  }
  return { ...base('charge', { id, date, memo, ref }), ...r, lines, ...(dueDate ? { dueDate } : {}), ...(auto ? { auto } : {}) };
}

/**
 * Receive a payment on a lease. `allocations` say which charges it pays
 * ([{ accountId, amount }]); anything left over is held as prepaid rent.
 */
export function buildPayment({ lease, date, amount, allocations = [], bankAccountId = ACC.operating, method = '', ref, memo, payer = '', id, attachments }) {
  const r = leaseRefs(lease);
  const total = int(amount);
  const allocs = positive(allocations);
  const applied = sum(allocs, (a) => a.amount);
  if (applied > total) throw new Error('The amounts applied add up to more than the payment.');
  const lines = [{ accountId: bankAccountId, amount: total, propertyId: r.propertyId, unitId: r.unitId }];
  for (const a of allocs) lines.push({ accountId: ACC.ar, amount: -a.amount, ...r, forAccountId: a.accountId });
  if (total > applied) lines.push({ accountId: ACC.prepaid, amount: -(total - applied), ...r });
  return { ...base('payment', { id, date, memo, ref, attachments }), ...r, method, payer, bankAccountId, lines };
}

/** Waive or reduce what a tenant owes: debit the income account, credit receivables. */
export function buildCredit({ lease, date, items, memo, ref, id }) {
  const r = leaseRefs(lease);
  const lines = [];
  for (const it of positive(items)) {
    lines.push({ accountId: it.accountId, amount: it.amount, ...r });
    lines.push({ accountId: ACC.ar, amount: -it.amount, ...r, forAccountId: it.accountId });
  }
  return { ...base('credit', { id, date, memo, ref }), ...r, lines };
}

/**
 * Pay money back to a tenant out of a liability held for them: prepaid rent
 * (a credit balance) or their security deposit.
 */
export function buildRefund({ lease, date, amount, fromAccountId = ACC.prepaid, bankAccountId = ACC.operating, method = 'check', ref, memo, payee = '', id }) {
  const r = leaseRefs(lease);
  const a = int(amount);
  return {
    ...base('refund', { id, date, memo, ref }),
    ...r,
    method,
    payee,
    bankAccountId,
    lines: [
      { accountId: fromAccountId, amount: a, ...r },
      { accountId: bankAccountId, amount: -a, propertyId: r.propertyId, unitId: r.unitId },
    ],
  };
}

/** Use part of a held deposit to pay charges (usually at move-out). */
export function buildApplyDeposit({ lease, date, items, memo, id }) {
  const r = leaseRefs(lease);
  const its = positive(items);
  const total = sum(its, (i) => i.amount);
  const lines = [{ accountId: ACC.depositsHeld, amount: total, ...r }];
  for (const it of its) lines.push({ accountId: ACC.ar, amount: -it.amount, ...r, forAccountId: it.accountId });
  return { ...base('apply-deposit', { id, date, memo: memo || 'Security deposit applied' }), ...r, lines };
}

/** Move prepaid rent onto charges. */
export function buildApplyPrepayment({ lease, date, items, id }) {
  const r = leaseRefs(lease);
  const its = positive(items);
  const total = sum(its, (i) => i.amount);
  const lines = [{ accountId: ACC.prepaid, amount: total, ...r }];
  for (const it of its) lines.push({ accountId: ACC.ar, amount: -it.amount, ...r, forAccountId: it.accountId });
  return { ...base('apply-prepayment', { id, date, memo: 'Prepayment applied' }), ...r, lines, auto: true };
}

// ---- Vendor and company transactions ------------------------------------------

/** A vendor bill: debit expense lines, credit payables per property. */
export function buildBill({ vendorId, date, dueDate, items, memo, ref, id, workOrderId, attachments }) {
  const lines = [];
  for (const it of positive(items)) {
    const refs = { propertyId: it.propertyId || null, unitId: it.unitId || null };
    lines.push({ accountId: it.accountId, amount: it.amount, ...refs, vendorId, memo: it.memo || '' });
    lines.push({ accountId: ACC.ap, amount: -it.amount, ...refs, vendorId });
  }
  const propertyIds = [...new Set(lines.map((l) => l.propertyId).filter(Boolean))];
  return { ...base('bill', { id, date, memo, ref, workOrderId, attachments }), vendorId, dueDate: dueDate || date, propertyId: propertyIds.length === 1 ? propertyIds[0] : null, lines };
}

/**
 * Pay one or more bills from a bank account. `allocations` are
 * [{ billId, amount }]; `bills` maps billId -> bill so each payment line
 * lands on the same properties as the bill it pays. `previous` are earlier
 * payments on those bills, so a part payment is spread over what each
 * property still owes and the last one clears every property exactly.
 */
export function buildBillPayment({ vendorId, date, bankAccountId = ACC.operating, method = 'check', ref, memo, allocations, bills, previous = [], id }) {
  const lines = [];
  const allocs = allocations.map((a) => ({ billId: a.billId, amount: int(a.amount) })).filter((a) => a.amount > 0);
  const key = (l) => `${l.propertyId || ''}|${l.unitId || ''}`;
  for (const a of allocs) {
    const bill = bills.get ? bills.get(a.billId) : bills[a.billId];
    // What the bill still owes per property and unit.
    const open = new Map();
    for (const l of (bill?.lines || []).filter((x) => x.accountId === ACC.ap)) {
      const k = key(l);
      if (!open.has(k)) open.set(k, { propertyId: l.propertyId, unitId: l.unitId, owed: 0 });
      open.get(k).owed += -l.amount;
    }
    for (const p of previous) {
      if (p.voided || p.id === id) continue;
      for (const l of p.lines || []) if (l.accountId === ACC.ap && l.billId === a.billId && open.has(key(l))) open.get(key(l)).owed -= l.amount;
    }
    const parts = [...open.values()].filter((o) => o.owed > 0);
    const owed = parts.reduce((s, o) => s + o.owed, 0);
    // Spread in proportion to what is owed, with the rounding remainder on
    // the last part so it adds up exactly; paying it all clears each part.
    let left = a.amount;
    parts.forEach((o, i) => {
      const share = i === parts.length - 1 ? left : a.amount >= owed ? o.owed : Math.round((a.amount * o.owed) / owed);
      left -= share;
      if (!share) return;
      lines.push({ accountId: ACC.ap, amount: share, propertyId: o.propertyId, unitId: o.unitId, vendorId, billId: a.billId });
      lines.push({ accountId: bankAccountId, amount: -share, propertyId: o.propertyId, unitId: o.unitId, vendorId });
    });
    if (!parts.length) {
      lines.push({ accountId: ACC.ap, amount: a.amount, propertyId: null, vendorId, billId: a.billId });
      lines.push({ accountId: bankAccountId, amount: -a.amount, propertyId: null, vendorId });
    }
  }
  return { ...base('bill-payment', { id, date, memo, ref }), vendorId, bankAccountId, method, allocations: allocs, lines };
}

/** Pay an expense straight from a bank account, without a bill. */
export function buildExpense({ vendorId = null, payee = '', date, bankAccountId = ACC.operating, method = 'check', items, memo, ref, id, attachments }) {
  const lines = [];
  for (const it of positive(items)) {
    const refs = { propertyId: it.propertyId || null, unitId: it.unitId || null };
    lines.push({ accountId: it.accountId, amount: it.amount, ...refs, vendorId, memo: it.memo || '' });
    lines.push({ accountId: bankAccountId, amount: -it.amount, ...refs, vendorId });
  }
  return { ...base('expense', { id, date, memo, ref, attachments }), vendorId, payee, bankAccountId, method, lines };
}

export function buildTransfer({ date, fromAccountId, toAccountId, amount, propertyId = null, memo, ref, id }) {
  const a = int(amount);
  return {
    ...base('transfer', { id, date, memo, ref }),
    propertyId,
    lines: [
      { accountId: toAccountId, amount: a, propertyId },
      { accountId: fromAccountId, amount: -a, propertyId },
    ],
  };
}

/** Money an owner puts in (contribution) or takes out (distribution). */
export function buildOwnerTransaction({ kind, ownerId, propertyId, date, amount, bankAccountId = ACC.operating, method = 'check', memo, ref, id }) {
  const a = int(amount);
  const equity = kind === 'contribution' ? ACC.contributions : ACC.distributions;
  const sign = kind === 'contribution' ? 1 : -1;
  return {
    ...base(kind, { id, date, memo, ref }),
    ownerId,
    propertyId,
    bankAccountId,
    method,
    lines: [
      { accountId: bankAccountId, amount: sign * a, propertyId, ownerId },
      { accountId: equity, amount: -sign * a, propertyId, ownerId },
    ],
  };
}

/** General journal entry; `lines` are { accountId, debit, credit, propertyId, memo }. */
export function buildJournal({ date, lines, memo, ref, id }) {
  const out = lines
    .map((l) => {
      const line = { accountId: l.accountId, amount: int(l.debit) - int(l.credit), propertyId: l.propertyId || null, unitId: l.unitId || null, memo: l.memo || '' };
      // Optional links (a lease, what a receivable is for) are kept when present.
      for (const k of ['leaseId', 'forAccountId', 'vendorId', 'ownerId']) if (l[k]) line[k] = l[k];
      return line;
    })
    .filter((l) => l.accountId && l.amount);
  const tx = { ...base('journal', { id, date, memo, ref }), lines: out };
  if (!isBalanced(tx)) throw new Error('Debits and credits must be equal.');
  return tx;
}

// ---- Derived balances ---------------------------------------------------------

function emptyLease() {
  return { ar: 0, prepaid: 0, deposits: 0, byAccount: new Map(), lines: [], lastPayment: null, charged: 0, paid: 0 };
}

/**
 * One pass over the ledger. Voided transactions are ignored.
 * Returns {
 *   lease(id)   -> { balance, ar, prepaid, deposits (collected), depositsCharged, byAccount, lines, lastPayment }
 *   bill(id)    -> { total, paid, balance, payments }
 *   account(id) -> debit-positive balance
 *   vendorOwed(id)
 * }
 */
export function computeIndex(transactions) {
  const leases = new Map();
  const bills = new Map();
  const accounts = new Map();
  const vendors = new Map();
  const payments = [];

  const leaseOf = (id) => {
    let l = leases.get(id);
    if (!l) leases.set(id, (l = emptyLease()));
    return l;
  };
  const billOf = (id) => {
    let b = bills.get(id);
    if (!b) bills.set(id, (b = { total: 0, paid: 0, payments: [] }));
    return b;
  };

  for (const tx of transactions) {
    if (tx.voided) continue;
    if (tx.kind === 'bill') billOf(tx.id).total += -sum(tx.lines.filter((l) => l.accountId === ACC.ap), (l) => l.amount);
    if (tx.kind === 'bill-payment') {
      for (const a of tx.allocations || []) {
        const b = billOf(a.billId);
        b.paid += a.amount;
        b.payments.push(tx);
      }
    }
    if (tx.kind === 'payment') payments.push(tx);
    for (const line of tx.lines) {
      const amt = line.amount;
      accounts.set(line.accountId, (accounts.get(line.accountId) || 0) + amt);
      if (line.leaseId) {
        const l = leaseOf(line.leaseId);
        if (line.accountId === ACC.ar) {
          l.ar += amt;
          l.byAccount.set(line.forAccountId, (l.byAccount.get(line.forAccountId) || 0) + amt);
          l.lines.push({ date: tx.date, amount: amt, forAccountId: line.forAccountId, txId: tx.id, kind: tx.kind });
          if (amt > 0 && tx.kind === 'charge') l.charged += amt;
          // Paying (or waiving) a charge for prepaid rent turns it into credit.
          if (amt < 0 && line.forAccountId === ACC.prepaid) l.lines.push({ date: tx.date, amount: amt, prepaid: true, txId: tx.id, kind: tx.kind });
        } else if (line.accountId === ACC.prepaid) {
          l.prepaid += -amt;
          // A charge for prepaid rent (last month's rent, say) is not credit
          // until it is paid; see the receivable line above.
          if (tx.kind !== 'charge') l.lines.push({ date: tx.date, amount: amt, prepaid: true, txId: tx.id, kind: tx.kind });
        } else if (line.accountId === ACC.depositsHeld) {
          l.deposits += -amt;
        }
      }
      if (line.vendorId && line.accountId === ACC.ap) vendors.set(line.vendorId, (vendors.get(line.vendorId) || 0) - amt);
    }
  }
  for (const tx of payments) {
    const l = leases.get(tx.leaseId);
    if (!l) continue;
    l.paid += txTotal(tx);
    if (!l.lastPayment || tx.date > l.lastPayment.date) l.lastPayment = tx;
  }
  for (const l of leases.values()) {
    // Prepaid rent is credit once it is paid, like a deposit is held once paid.
    l.prepaid -= Math.max(0, l.byAccount.get(ACC.prepaid) || 0);
    l.balance = l.ar - l.prepaid;
    // A deposit is held once it is paid: charging it credits the liability,
    // but whatever the tenant still owes on it has not been collected.
    l.depositsCharged = l.deposits;
    l.deposits = Math.max(0, l.deposits - Math.max(0, l.byAccount.get(ACC.depositsHeld) || 0));
    l.lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  for (const b of bills.values()) b.balance = b.total - b.paid;

  return {
    lease: (id) => leases.get(id) || { ...emptyLease(), balance: 0 },
    leaseIds: () => [...leases.keys()],
    bill: (id) => bills.get(id) || { total: 0, paid: 0, balance: 0, payments: [] },
    account: (id) => accounts.get(id) || 0,
    vendorOwed: (id) => vendors.get(id) || 0,
  };
}

const memo = new WeakMap();

/** Memoized index for a store; recomputed only when the ledger changes. */
export function ledgerIndex(store) {
  const rev = store.revision('transactions');
  const hit = memo.get(store);
  if (hit && hit.rev === rev) return hit.index;
  const index = computeIndex(store.all('transactions'));
  memo.set(store, { rev, index });
  return index;
}

/** What a lease owed (positive) or had in credit (negative) at the end of `date`. */
export function leaseBalanceAsOf(leaseInfo, date, { forAccountId = null } = {}) {
  let bal = 0;
  for (const l of leaseInfo.lines) {
    if (l.date > date) break;
    if (forAccountId && !l.prepaid && l.forAccountId !== forAccountId) continue;
    bal += l.amount;
  }
  return bal;
}

/**
 * Suggest how to apply a payment to what a lease owes. Deposits first, then
 * fees, then rent, so rent is the balance left open when a payment is short.
 * byAccount: Map(accountId -> cents owed). Returns [{ accountId, amount }].
 */
export function suggestAllocation(byAccount, amount, accountsById = new Map()) {
  const owed = [...byAccount.entries()].filter(([, v]) => v > 0);
  const rank = (id) => (id === ACC.depositsHeld ? 0 : id === ACC.rent || accountsById.get?.(id)?.role === 'rent' ? 2 : 1);
  owed.sort((a, b) => rank(a[0]) - rank(b[0]) || String(accountsById.get?.(a[0])?.number || a[0]).localeCompare(String(accountsById.get?.(b[0])?.number || b[0]), undefined, { numeric: true }));
  let left = int(amount);
  const out = [];
  for (const [accountId, due] of owed) {
    if (left <= 0) break;
    const a = Math.min(due, left);
    out.push({ accountId, amount: a });
    left -= a;
  }
  return out;
}

/** Signed effect of a transaction on one account (for registers). */
export function amountOn(tx, accountId) {
  return sum(tx.lines.filter((l) => l.accountId === accountId), (l) => l.amount);
}

/** Effect of a transaction on a lease's balance (for the lease ledger). */
export function leaseEffect(tx, leaseId) {
  return sum(tx.lines.filter((l) => l.leaseId === leaseId && (l.accountId === ACC.ar || l.accountId === ACC.prepaid)), (l) => l.amount);
}

export function billStatus(bill, info, today) {
  if (bill.voided) return 'void';
  if (info.balance <= 0) return 'paid';
  if (bill.dueDate && bill.dueDate < today) return 'overdue';
  if (info.paid > 0) return 'partial';
  return 'due';
}
