/**
 * The bank feed: turning statement lines into books.
 *
 * A line is "to review" until it is either added (a new transaction is
 * created from it), matched (linked to a transaction already in the books),
 * or excluded (a duplicate or a personal charge). Rules categorize lines as
 * they arrive; matching suggests existing transactions with the same amount
 * near the same date.
 */
import { dayNum } from './dates.js';
import { lineTotal } from './txn.js';

// ------------------------------------------------------------------ rules

export const RULE_FIELDS = [
  ['desc', 'Description'],
  ['amount', 'Amount'],
];

export const RULE_OPS = {
  desc: [['contains', 'contains'], ['notContains', "doesn't contain"], ['is', 'is exactly'], ['startsWith', 'starts with']],
  amount: [['equals', 'equals'], ['gt', 'is greater than'], ['lt', 'is less than']],
};

function testCondition(line, c) {
  if (c.field === 'amount') {
    const v = Math.abs(line.amount);
    const target = Math.abs(Math.round(c.value || 0));
    if (c.op === 'equals') return v === target;
    if (c.op === 'gt') return v > target;
    if (c.op === 'lt') return v < target;
    return false;
  }
  const hay = (line.desc || '').toLowerCase();
  const needle = String(c.value || '').toLowerCase().trim();
  if (!needle) return false;
  if (c.op === 'contains') return hay.includes(needle);
  if (c.op === 'notContains') return !hay.includes(needle);
  if (c.op === 'is') return hay.trim() === needle;
  if (c.op === 'startsWith') return hay.startsWith(needle);
  return false;
}

/** Does a rule apply to a line? */
export function ruleMatches(rule, line) {
  if (rule.active === false) return false;
  if (rule.accountIds?.length && !rule.accountIds.includes(line.accountId)) return false;
  if (rule.direction === 'out' && line.amount >= 0) return false;
  if (rule.direction === 'in' && line.amount <= 0) return false;
  const conds = (rule.conditions || []).filter((c) => c.field && c.op);
  if (!conds.length) return false;
  return rule.match === 'any' ? conds.some((c) => testCondition(line, c)) : conds.every((c) => testCondition(line, c));
}

/** The first rule that applies, in priority order. */
export function findRule(rules, line) {
  const sorted = [...rules].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || (a.createdAt || 0) - (b.createdAt || 0));
  return sorted.find((r) => ruleMatches(r, line)) || null;
}

// --------------------------------------------------------------- matching

/**
 * Transactions already in the books that could be this line: same account,
 * same amount in the same direction, within `window` days, not already
 * matched to another line, and not reconciled. Best (closest date) first.
 */
export function findMatches(store, line, { window = 10, takenIds = null } = {}) {
  const L = store.ledger('accrual');
  const idx = L.accountIndex.get(line.accountId);
  const out = [];
  const lineDay = dayNum(line.date);
  const taken = takenIds || new Set([...store.bankLines.values()].filter((l) => l.txnId && l.id !== line.id).map((l) => l.txnId));
  const reconciled = store.reconciledIds(line.accountId);
  if (idx !== undefined) {
    const list = L.byAccount(idx);
    const seen = new Map();
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      const d = L.day[i];
      if (Math.abs(d - lineDay) > window) continue;
      const t = L.txns[L.txn[i]];
      seen.set(t.id, (seen.get(t.id) || { t, amount: 0, day: d }));
      seen.get(t.id).amount += L.amt[i];
    }
    for (const { t, amount, day } of seen.values()) {
      if (Math.round(amount) !== line.amount) continue;
      if (taken.has(t.id) || reconciled.has(t.id)) continue;
      out.push({ kind: 'txn', txn: t, score: Math.abs(day - lineDay) });
    }
  }
  // Money in: an open invoice for exactly this amount is probably being paid.
  // Money out: an open bill.
  const info = store.docInfo();
  const type = line.amount > 0 ? 'invoice' : 'bill';
  for (const t of store.txns.values()) {
    if (t.type !== type || t.voided) continue;
    const open = info.open.get(t.id) || 0;
    if (open !== Math.abs(line.amount)) continue;
    out.push({ kind: 'open', txn: t, score: 100 + Math.abs(dayNum(t.dueDate || t.date) - lineDay) / 100 });
  }
  return out.sort((a, b) => a.score - b.score).slice(0, 8);
}

/**
 * The transaction to create when a line is added with a payee and category.
 * Money out of a bank is an expense; into a bank, a deposit. On a credit card,
 * a charge is an expense and a credit is a card credit.
 */
export function draftFromLine(store, line, { contactId = null, categoryId, memo = '', transferAccountId = null } = {}) {
  const account = store.account(line.accountId);
  const isCard = account?.type === 'creditCard';
  const amount = Math.abs(line.amount);
  const base = { date: line.date, memo: memo || line.desc, bankLineId: line.id };
  if (transferAccountId) {
    if (isCard && line.amount > 0) return { ...base, type: 'ccPayment', ccAccountId: line.accountId, bankAccountId: transferAccountId, amount };
    const otherIsCard = store.account(transferAccountId)?.type === 'creditCard';
    if (!isCard && line.amount < 0 && otherIsCard) return { ...base, type: 'ccPayment', ccAccountId: transferAccountId, bankAccountId: line.accountId, amount };
    return line.amount < 0
      ? { ...base, type: 'transfer', fromId: line.accountId, toId: transferAccountId, amount }
      : { ...base, type: 'transfer', fromId: transferAccountId, toId: line.accountId, amount };
  }
  const category = categoryId || store.roleAccount(line.amount < 0 ? 'uncategorizedExpense' : 'uncategorizedIncome');
  if (line.amount < 0) {
    return { ...base, type: 'expense', accountId: line.accountId, contactId, lines: [{ accountId: category, amount, desc: line.desc }] };
  }
  if (isCard) {
    return { ...base, type: 'ccCredit', accountId: line.accountId, contactId, lines: [{ accountId: category, amount, desc: line.desc }] };
  }
  return { ...base, type: 'deposit', accountId: line.accountId, contactId, lines: [{ accountId: category, contactId, amount, desc: line.desc }] };
}

/** A payment (or bill payment) that settles an open document from a line. */
export function settleFromLine(store, line, doc) {
  const amount = Math.abs(line.amount);
  if (doc.type === 'invoice') {
    return { type: 'payment', date: line.date, contactId: doc.contactId, amount, depositToId: line.accountId, applied: [{ txnId: doc.id, amount }], memo: line.desc, bankLineId: line.id };
  }
  return { type: 'billPayment', date: line.date, contactId: doc.contactId, amount, accountId: line.accountId, applied: [{ txnId: doc.id, amount }], memo: line.desc, bankLineId: line.id };
}

/** Category suggestion from history: the category last used for a similar description. */
export function suggestFromHistory(store, line) {
  const words = (line.desc || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 2).join(' ');
  if (!words) return null;
  let best = null;
  for (const l of store.bankLines.values()) {
    if (l.status !== 'added' || !l.txnId || l.accountId !== line.accountId) continue;
    const other = (l.desc || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 2).join(' ');
    if (other !== words) continue;
    const t = store.txn(l.txnId);
    if (!t || !t.lines?.[0]?.accountId) continue;
    if (!best || (l.date > best.date)) best = { date: l.date, categoryId: t.lines[0].accountId, contactId: t.contactId || null };
  }
  return best;
}

export { lineTotal };
