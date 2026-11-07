/**
 * Transaction types, their totals, and the double-entry postings each one
 * makes. This file is the bookkeeping rulebook: every report, register, and
 * balance in the app is a sum over what `postings()` returns, and every list
 * of postings it returns sums to zero.
 *
 * A posting is { accountId, amount, contactId?, memo? } where amount is in
 * cents, positive for a debit and negative for a credit.
 */
import { allocate, applyRate, lineAmount, sum } from './money.js';
import { addDays, diffDays } from './dates.js';

export const TXN_TYPES = {
  invoice: { label: 'Invoice', plural: 'Invoices', side: 'sales', contact: 'customer', numbered: true, route: 'invoice' },
  payment: { label: 'Payment', plural: 'Payments', side: 'sales', contact: 'customer', route: 'payment' },
  estimate: { label: 'Estimate', plural: 'Estimates', side: 'sales', contact: 'customer', numbered: true, nonPosting: true, route: 'estimate' },
  salesReceipt: { label: 'Sales receipt', plural: 'Sales receipts', side: 'sales', contact: 'customer', numbered: true, route: 'sales-receipt' },
  creditMemo: { label: 'Credit memo', plural: 'Credit memos', side: 'sales', contact: 'customer', numbered: true, route: 'credit-memo' },
  refundReceipt: { label: 'Refund receipt', plural: 'Refund receipts', side: 'sales', contact: 'customer', numbered: true, route: 'refund-receipt' },
  expense: { label: 'Expense', plural: 'Expenses', side: 'purchases', contact: 'any', route: 'expense' },
  check: { label: 'Check', plural: 'Checks', side: 'purchases', contact: 'any', route: 'check' },
  bill: { label: 'Bill', plural: 'Bills', side: 'purchases', contact: 'vendor', route: 'bill' },
  billPayment: { label: 'Bill payment', plural: 'Bill payments', side: 'purchases', contact: 'vendor', route: 'bill-payment' },
  vendorCredit: { label: 'Vendor credit', plural: 'Vendor credits', side: 'purchases', contact: 'vendor', route: 'vendor-credit' },
  ccCredit: { label: 'Credit card refund', plural: 'Credit card refunds', side: 'purchases', contact: 'any', route: 'cc-credit' },
  purchaseOrder: { label: 'Purchase order', plural: 'Purchase orders', side: 'purchases', contact: 'vendor', numbered: true, nonPosting: true, route: 'purchase-order' },
  deposit: { label: 'Deposit', plural: 'Deposits', side: 'other', route: 'deposit' },
  transfer: { label: 'Transfer', plural: 'Transfers', side: 'other', route: 'transfer' },
  journal: { label: 'Journal entry', plural: 'Journal entries', side: 'other', numbered: true, route: 'journal' },
  ccPayment: { label: 'Credit card payment', plural: 'Credit card payments', side: 'other', route: 'cc-payment' },
};

export const SALES_DOCS = new Set(['invoice', 'estimate', 'salesReceipt', 'creditMemo', 'refundReceipt']);
export const PURCHASE_DOCS = new Set(['expense', 'check', 'bill', 'vendorCredit', 'ccCredit', 'purchaseOrder']);

export function typeLabel(type) {
  return TXN_TYPES[type]?.label || type;
}

export const TERMS = [
  { id: 'due', name: 'Due on receipt', days: 0 },
  { id: 'net15', name: 'Net 15', days: 15 },
  { id: 'net30', name: 'Net 30', days: 30 },
  { id: 'net60', name: 'Net 60', days: 60 },
];

export function termDays(termId, terms = TERMS) {
  const t = terms.find((x) => x.id === termId);
  return t ? t.days : 0;
}

export function dueDateFor(date, termId, terms = TERMS) {
  return addDays(date, termDays(termId, terms));
}

export const PAYMENT_METHODS = ['Cash', 'Check', 'Credit card', 'Debit card', 'Bank transfer', 'Direct debit', 'Other'];

/** Line amount, preferring qty x rate when both are present. */
export function lineTotal(line) {
  if (line.qty !== undefined && line.qty !== null && line.qty !== '' && line.rate !== undefined && line.rate !== null && line.rate !== '') {
    return lineAmount(line.qty, line.rate);
  }
  return Math.round(Number(line.amount) || 0);
}

/**
 * Totals for a sales document. Tax applies to taxable lines after their share
 * of any document discount, which is how a merchant's register computes it.
 */
export function salesTotals(doc, ctx = {}) {
  const lines = (doc.lines || []).filter((l) => !l.kind || l.kind === 'item');
  const subtotal = sum(lines, lineTotal);
  const taxableSubtotal = sum(lines.filter((l) => l.taxable), lineTotal);
  let discount = 0;
  if (doc.discountType === 'pct') discount = applyRate(subtotal, doc.discountValue || 0);
  else if (doc.discountType === 'amt') discount = Math.round(doc.discountValue || 0);
  discount = Math.max(0, Math.min(discount, Math.max(subtotal, 0)));
  const taxableBase = subtotal > 0 ? taxableSubtotal - Math.round((discount * taxableSubtotal) / subtotal) : taxableSubtotal;
  const bp = taxRateOf(doc, ctx);
  let tax = 0;
  if (doc.taxOverride !== undefined && doc.taxOverride !== null && doc.taxOverride !== '') tax = Math.round(doc.taxOverride);
  else if (bp !== null) tax = applyRate(taxableBase, bp);
  const total = subtotal - discount + tax;
  return { subtotal, discount, taxableBase, tax, total };
}

export function purchaseTotal(doc) {
  return sum(doc.lines || [], lineTotal);
}

/** Total of any transaction, as shown in lists. Always non-negative for documents. */
export function txnTotal(t, ctx = {}) {
  switch (t.type) {
    case 'invoice': case 'estimate': case 'salesReceipt': case 'creditMemo': case 'refundReceipt':
      return salesTotals(t, ctx).total;
    case 'expense': case 'check': case 'bill': case 'vendorCredit': case 'ccCredit': case 'purchaseOrder':
      return purchaseTotal(t);
    case 'payment': case 'billPayment': case 'transfer': case 'ccPayment':
      return Math.round(t.amount || 0);
    case 'deposit':
      return sum(t.lines || [], (l) => Math.round(l.amount || 0)) - Math.round(t.cashBack || 0);
    case 'journal':
      return sum(t.lines || [], (l) => Math.round(l.debit || 0));
    default:
      return 0;
  }
}

function role(ctx, name) {
  return ctx.role ? ctx.role(name) : name;
}

/**
 * The tax rate (basis points) a sales document uses: the one saved on it
 * (taxRateBp) or, before it is saved, the rate's current value. Null when it
 * has no tax rate.
 */
export function taxRateOf(doc, ctx = {}) {
  if (!doc.taxRateId) return null;
  if (Number.isFinite(doc.taxRateBp)) return doc.taxRateBp;
  const rate = ctx.taxRate ? ctx.taxRate(doc.taxRateId) : null;
  return rate ? rate.rate || 0 : null;
}

/** The account an item line posts to, from the item as it is now. */
function itemAccountNow(line, ctx, sales, item = line.itemId && ctx.item ? ctx.item(line.itemId) : null) {
  return sales ? item?.incomeAccountId || role(ctx, 'sales') : item?.expenseAccountId || role(ctx, 'uncategorizedExpense');
}

/** An item line's account as saved with it, while the line still has that item. */
function savedItemAccount(line) {
  return line.itemId && line.itemAccount?.itemId === line.itemId ? line.itemAccount.accountId : null;
}

function salesLineAccount(line, ctx) {
  return line.accountId || savedItemAccount(line) || itemAccountNow(line, ctx, true);
}

function purchaseLineAccount(line, ctx) {
  return line.accountId || savedItemAccount(line) || itemAccountNow(line, ctx, false);
}

/**
 * Posting documents keep the tax rate and item accounts they were saved
 * with, so editing a tax rate or an item later never rewrites past (or
 * closed) periods. Estimates and purchase orders post nothing and follow the
 * current values.
 */
export const SNAPSHOT_TYPES = new Set(['invoice', 'salesReceipt', 'creditMemo', 'refundReceipt', 'expense', 'check', 'bill', 'vendorCredit', 'ccCredit']);

/**
 * The record with its tax rate and item accounts saved on it. `fresh` takes
 * them from the current tax rate and items (a new transaction); otherwise
 * what is already saved is kept and only what is missing or stale (a line
 * whose item changed, a tax rate that was cleared) is filled in.
 */
export function withSnapshots(t, ctx = {}, { fresh = false } = {}) {
  if (!SNAPSHOT_TYPES.has(t.type)) return t;
  const out = { ...t };
  if (SALES_DOCS.has(t.type)) {
    const rate = t.taxRateId && ctx.taxRate ? ctx.taxRate(t.taxRateId) : null;
    if (!t.taxRateId) delete out.taxRateBp;
    else if (fresh || !Number.isFinite(t.taxRateBp)) {
      if (rate) out.taxRateBp = rate.rate || 0;
      else delete out.taxRateBp;
    }
  }
  if (Array.isArray(t.lines)) {
    const sales = SALES_DOCS.has(t.type);
    out.lines = t.lines.map((l) => {
      if (!l.itemId || l.accountId) {
        if (!l.itemAccount) return l;
        const { itemAccount, ...rest } = l;
        return rest;
      }
      if (!fresh && savedItemAccount(l)) return l;
      return { ...l, itemAccount: { itemId: l.itemId, accountId: itemAccountNow(l, ctx, sales) } };
    });
  }
  return out;
}

/** A copy without saved tax rate and item accounts, for a new transaction made from an old one. */
export function withoutSnapshots(t) {
  const out = { ...t };
  delete out.taxRateBp;
  if (Array.isArray(t.lines)) out.lines = t.lines.map((l) => {
    if (!l.itemAccount) return l;
    const { itemAccount, ...rest } = l;
    return rest;
  });
  return out;
}

/**
 * When an item's accounts or a tax rate change, the documents that used the
 * old values without having saved them (records from before snapshots) get
 * the old values saved on them, so their postings do not move. Returns the
 * changed records.
 */
export function freezeOldValues(txns, ctx, { oldItem = null, oldTaxRate = null } = {}) {
  const out = [];
  for (const t of txns) {
    if (!SNAPSHOT_TYPES.has(t.type) || t.voided) continue;
    let next = t;
    if (oldTaxRate && SALES_DOCS.has(t.type) && t.taxRateId === oldTaxRate.id && !Number.isFinite(t.taxRateBp)) {
      next = { ...next, taxRateBp: oldTaxRate.rate || 0 };
    }
    if (oldItem && (t.lines || []).some((l) => l.itemId === oldItem.id && !l.accountId && !savedItemAccount(l))) {
      const sales = SALES_DOCS.has(t.type);
      next = { ...next, lines: t.lines.map((l) => (l.itemId === oldItem.id && !l.accountId && !savedItemAccount(l) ? { ...l, itemAccount: { itemId: l.itemId, accountId: itemAccountNow(l, ctx, sales, oldItem) } } : l)) };
    }
    if (next !== t) out.push(next);
  }
  return out;
}

/**
 * Credit-side postings of a sales document (income, tax, less discount), as
 * the amounts that would be credited for an invoice. Sign: negative = credit.
 */
function salesRevenueSide(doc, ctx) {
  const out = [];
  const { discount, tax } = salesTotals(doc, ctx);
  for (const line of doc.lines || []) {
    if (line.kind && line.kind !== 'item') continue;
    const amount = lineTotal(line);
    if (!amount) continue;
    out.push({ accountId: salesLineAccount(line, ctx), amount: -amount, contactId: doc.contactId, memo: line.desc || '' });
  }
  if (discount) out.push({ accountId: role(ctx, 'discounts'), amount: discount, contactId: doc.contactId, memo: 'Discount' });
  if (tax) out.push({ accountId: role(ctx, 'salesTax'), amount: -tax, contactId: doc.contactId, memo: 'Sales tax', taxRateId: doc.taxRateId || null });
  return out;
}

/** Debit-side postings of a purchase document (expense lines). */
function purchaseCostSide(doc, ctx) {
  const out = [];
  for (const line of doc.lines || []) {
    const amount = lineTotal(line);
    if (!amount) continue;
    // The vendor stays the posting's contact; a billable customer rides along separately.
    out.push({ accountId: purchaseLineAccount(line, ctx), amount, contactId: doc.contactId || null, customerId: line.customerId || null, memo: line.desc || '' });
  }
  return out;
}

function negate(list) {
  return list.map((p) => ({ ...p, amount: -p.amount }));
}

/**
 * Accrual-basis postings: the books as they are kept.
 */
export function accrualPostings(t, ctx = {}) {
  const c = t.contactId || null;
  switch (t.type) {
    case 'invoice': {
      const rev = salesRevenueSide(t, ctx);
      const total = -sum(rev, (p) => p.amount);
      return total || rev.length ? [{ accountId: role(ctx, 'ar'), amount: total, contactId: c }, ...rev] : [];
    }
    case 'salesReceipt': {
      const rev = salesRevenueSide(t, ctx);
      const total = -sum(rev, (p) => p.amount);
      return [{ accountId: t.depositToId || role(ctx, 'undeposited'), amount: total, contactId: c }, ...rev];
    }
    case 'creditMemo': {
      const rev = negate(salesRevenueSide(t, ctx));
      const total = sum(rev, (p) => p.amount);
      return [{ accountId: role(ctx, 'ar'), amount: -total, contactId: c }, ...rev];
    }
    case 'refundReceipt': {
      const rev = negate(salesRevenueSide(t, ctx));
      const total = sum(rev, (p) => p.amount);
      return [{ accountId: t.accountId, amount: -total, contactId: c }, ...rev];
    }
    case 'payment': {
      const amount = Math.round(t.amount || 0);
      return [
        { accountId: t.depositToId || role(ctx, 'undeposited'), amount, contactId: c },
        { accountId: role(ctx, 'ar'), amount: -amount, contactId: c },
      ];
    }
    case 'expense': case 'check': {
      const cost = purchaseCostSide(t, ctx);
      const total = sum(cost, (p) => p.amount);
      return [{ accountId: t.accountId, amount: -total, contactId: c, memo: t.memo || '' }, ...cost];
    }
    case 'ccCredit': {
      const cost = negate(purchaseCostSide(t, ctx));
      const total = sum(cost, (p) => p.amount);
      return [{ accountId: t.accountId, amount: -total, contactId: c, memo: t.memo || '' }, ...cost];
    }
    case 'bill': {
      const cost = purchaseCostSide(t, ctx);
      const total = sum(cost, (p) => p.amount);
      return [{ accountId: role(ctx, 'ap'), amount: -total, contactId: c }, ...cost];
    }
    case 'vendorCredit': {
      const cost = negate(purchaseCostSide(t, ctx));
      const total = sum(cost, (p) => p.amount);
      return [{ accountId: role(ctx, 'ap'), amount: -total, contactId: c }, ...cost];
    }
    case 'billPayment': {
      const amount = Math.round(t.amount || 0);
      return [
        { accountId: role(ctx, 'ap'), amount, contactId: c },
        { accountId: t.accountId, amount: -amount, contactId: c },
      ];
    }
    case 'deposit': {
      const out = [];
      let total = 0;
      for (const line of t.lines || []) {
        const amount = Math.round(line.amount || 0);
        if (!amount) continue;
        total += amount;
        const accountId = line.paymentId ? role(ctx, 'undeposited') : line.accountId || role(ctx, 'uncategorizedIncome');
        out.push({ accountId, amount: -amount, contactId: line.contactId || null, memo: line.desc || '' });
      }
      const cashBack = Math.round(t.cashBack || 0);
      if (cashBack) {
        out.push({ accountId: t.cashBackAccountId || role(ctx, 'uncategorizedAsset'), amount: cashBack, memo: t.cashBackMemo || 'Cash back' });
        total -= cashBack;
      }
      return [{ accountId: t.accountId, amount: total, memo: t.memo || '' }, ...out];
    }
    case 'transfer': {
      const amount = Math.round(t.amount || 0);
      return [
        { accountId: t.toId, amount, memo: t.memo || '' },
        { accountId: t.fromId, amount: -amount, memo: t.memo || '' },
      ];
    }
    case 'ccPayment': {
      const amount = Math.round(t.amount || 0);
      return [
        { accountId: t.ccAccountId, amount, contactId: c, memo: t.memo || '' },
        { accountId: t.bankAccountId, amount: -amount, contactId: c, memo: t.memo || '' },
      ];
    }
    case 'journal': {
      const out = [];
      for (const line of t.lines || []) {
        const amount = Math.round(line.debit || 0) - Math.round(line.credit || 0);
        if (!amount || !line.accountId) continue;
        out.push({ accountId: line.accountId, amount, contactId: line.contactId || null, memo: line.desc || '' });
      }
      return out;
    }
    default:
      return [];
  }
}

/**
 * Spread `amount` of a document's settlement over the document's own
 * postings, by weight, so cash-basis income lands in the same accounts the
 * invoice would have credited.
 */
function prorate(amount, sides) {
  const parts = allocate(amount, sides.map((p) => p.amount));
  return sides.map((p, i) => ({ ...p, amount: parts[i] })).filter((p) => p.amount);
}

/**
 * Cash-basis postings. Invoices, bills, credit memos and vendor credits post
 * nothing on their own; money moving is what posts. A payment credits the
 * income accounts of the invoices it paid, in proportion to what it paid.
 */
export function cashPostings(t, ctx = {}) {
  const c = t.contactId || null;
  switch (t.type) {
    case 'invoice': case 'creditMemo': case 'bill': case 'vendorCredit':
      return [];
    case 'payment': {
      const amount = Math.round(t.amount || 0);
      const out = [{ accountId: t.depositToId || role(ctx, 'undeposited'), amount, contactId: c }];
      let applied = 0;
      for (const a of t.applied || []) {
        const doc = ctx.txn ? ctx.txn(a.txnId) : null;
        const value = Math.round(a.amount || 0);
        if (!doc || doc.type !== 'invoice' || !value) continue;
        const rev = salesRevenueSide(doc, ctx);
        applied += value;
        out.push(...prorate(-value, rev));
      }
      if (amount - applied) out.push({ accountId: role(ctx, 'ar'), amount: -(amount - applied), contactId: c });
      return out;
    }
    case 'billPayment': {
      const amount = Math.round(t.amount || 0);
      const out = [{ accountId: t.accountId, amount: -amount, contactId: c }];
      let applied = 0;
      for (const a of t.applied || []) {
        const doc = ctx.txn ? ctx.txn(a.txnId) : null;
        const value = Math.round(a.amount || 0);
        if (!doc || doc.type !== 'bill' || !value) continue;
        applied += value;
        out.push(...prorate(value, purchaseCostSide(doc, ctx)));
      }
      if (amount - applied) out.push({ accountId: role(ctx, 'ap'), amount: amount - applied, contactId: c });
      return out;
    }
    default:
      return accrualPostings(t, ctx);
  }
}

export function postings(t, basis, ctx) {
  if (TXN_TYPES[t.type]?.nonPosting || t.voided) return [];
  return basis === 'cash' ? cashPostings(t, ctx) : accrualPostings(t, ctx);
}

/** The account a transaction "belongs to" in lists: the bank, card, or A/R side. */
export function primaryAccountId(t, ctx = {}) {
  switch (t.type) {
    case 'expense': case 'check': case 'ccCredit': case 'refundReceipt': case 'billPayment': case 'deposit':
      return t.accountId;
    case 'salesReceipt': case 'payment':
      return t.depositToId || role(ctx, 'undeposited');
    case 'invoice': case 'creditMemo':
      return role(ctx, 'ar');
    case 'bill': case 'vendorCredit':
      return role(ctx, 'ap');
    case 'transfer':
      return t.fromId;
    case 'ccPayment':
      return t.bankAccountId;
    default:
      return null;
  }
}

/** Validation shared by every form and by the store. Returns a list of messages. */
export function validateTxn(t, ctx = {}) {
  const errors = [];
  if (!t.date) errors.push('Choose a date.');
  const meta = TXN_TYPES[t.type];
  if (!meta) return ['Unknown transaction type.'];
  if (['invoice', 'estimate', 'creditMemo', 'payment', 'salesReceipt', 'refundReceipt'].includes(t.type) && !t.contactId && t.type !== 'salesReceipt' && t.type !== 'refundReceipt') {
    errors.push('Choose a customer.');
  }
  if (['bill', 'billPayment', 'vendorCredit', 'purchaseOrder'].includes(t.type) && !t.contactId) errors.push('Choose a vendor.');
  if (['expense', 'check', 'ccCredit', 'refundReceipt', 'billPayment', 'deposit'].includes(t.type) && !t.accountId) {
    errors.push(t.type === 'deposit' ? 'Choose the account to deposit to.' : 'Choose the account this was paid from.');
  }
  if (t.type === 'transfer') {
    if (!t.fromId || !t.toId) errors.push('Choose both accounts.');
    else if (t.fromId === t.toId) errors.push('Transfer between two different accounts.');
    if (!(t.amount > 0)) errors.push('Enter an amount greater than zero.');
  }
  if (t.type === 'ccPayment') {
    if (!t.ccAccountId || !t.bankAccountId) errors.push('Choose the credit card and the bank account.');
    if (!(t.amount > 0)) errors.push('Enter an amount greater than zero.');
  }
  if (t.type === 'payment' || t.type === 'billPayment') {
    if (!(t.amount > 0) && !(t.applied || []).length) errors.push('Enter an amount received or choose what to apply it to.');
    const applied = sum(t.applied || [], (a) => a.amount);
    if (applied > (t.amount || 0) + 0) errors.push('The amounts applied add up to more than the payment.');
  }
  if (t.type === 'journal') {
    const lines = (t.lines || []).filter((l) => l.accountId && (l.debit || l.credit));
    if (lines.length < 2) errors.push('A journal entry needs at least two lines.');
    const debits = sum(lines, (l) => Math.round(l.debit || 0));
    const credits = sum(lines, (l) => Math.round(l.credit || 0));
    if (debits !== credits) errors.push('Debits and credits must be equal.');
    if ((t.lines || []).some((l) => (l.debit || l.credit) && !l.accountId)) errors.push('Choose an account on every line with an amount.');
  }
  if (SALES_DOCS.has(t.type) || PURCHASE_DOCS.has(t.type)) {
    const lines = (t.lines || []).filter((l) => lineTotal(l) !== 0 || l.itemId || l.accountId);
    if (!lines.length) errors.push('Add at least one line.');
    if (PURCHASE_DOCS.has(t.type) && t.type !== 'purchaseOrder' && (t.lines || []).some((l) => lineTotal(l) && !l.accountId && !l.itemId)) {
      errors.push('Choose a category on every line with an amount.');
    }
    const total = txnTotal(t, ctx);
    if (total < 0) errors.push('The total cannot be negative.');
  }
  if (t.type === 'deposit') {
    if (!(t.lines || []).some((l) => l.amount)) errors.push('Add at least one deposit line.');
  }
  return errors;
}

/** Sales doc status, as a short code and label. */
export function docStatus(t, openBalance, now) {
  const total = t._total ?? 0;
  if (t.voided) return { code: 'voided', label: 'Voided' };
  switch (t.type) {
    case 'invoice': {
      if (total === 0) return { code: 'paid', label: 'Paid' };
      if (openBalance <= 0) return { code: 'paid', label: 'Paid' };
      const overdueDays = t.dueDate ? diffDays(now, t.dueDate) : 0;
      if (overdueDays > 0) return { code: 'overdue', label: `Overdue ${overdueDays} ${overdueDays === 1 ? 'day' : 'days'}`, days: overdueDays };
      if (openBalance < total) return { code: 'partial', label: 'Partially paid' };
      if (!t.dueDate) return { code: 'open', label: 'Open' };
      const left = diffDays(t.dueDate, now);
      return { code: 'open', label: left === 0 ? 'Due today' : `Due in ${left} ${left === 1 ? 'day' : 'days'}` };
    }
    case 'bill': {
      if (openBalance <= 0) return { code: 'paid', label: 'Paid' };
      const overdueDays = t.dueDate ? diffDays(now, t.dueDate) : 0;
      if (overdueDays > 0) return { code: 'overdue', label: `Overdue ${overdueDays} ${overdueDays === 1 ? 'day' : 'days'}`, days: overdueDays };
      if (openBalance < total) return { code: 'partial', label: 'Partially paid' };
      return { code: 'open', label: 'Open' };
    }
    case 'estimate': {
      const s = t.status || 'pending';
      const labels = { pending: 'Pending', accepted: 'Accepted', closed: 'Closed', rejected: 'Rejected', converted: 'Converted' };
      if (s === 'pending' && t.expiryDate && t.expiryDate < now) return { code: 'expired', label: 'Expired' };
      return { code: s, label: labels[s] || 'Pending' };
    }
    case 'purchaseOrder':
      return { code: t.status === 'closed' ? 'closed' : 'open', label: t.status === 'closed' ? 'Closed' : 'Open' };
    case 'creditMemo': case 'vendorCredit':
      if (openBalance <= 0) return { code: 'closed', label: 'Applied' };
      return { code: 'open', label: 'Unapplied' };
    case 'payment': case 'billPayment':
      if (openBalance > 0) return { code: 'partial', label: 'Unapplied' };
      return { code: 'closed', label: t.type === 'payment' && t._deposited === false ? 'Not deposited' : 'Closed' };
    default:
      return { code: 'closed', label: '' };
  }
}
