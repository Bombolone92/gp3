/**
 * Reconciliation: proving the books agree with a statement.
 *
 * A finished reconciliation stores the ids it cleared and the amount each had
 * on the account at that moment. "Reconciled" is derived from those records,
 * so finishing one never rewrites hundreds of transactions, and an edit made
 * afterwards shows up as a discrepancy instead of silently changing history.
 */
import { typeInfo } from './accounts.js';

/** Amount a transaction moves an account (debit positive). */
export function amountOn(store, t, accountId) {
  let v = 0;
  for (const p of store.ledgerPostingsOf(t)) if (p.accountId === accountId) v += p.amount;
  return v;
}

export function lastReconciliation(store, accountId) {
  let last = null;
  for (const r of store.recons.values()) {
    if (r.accountId !== accountId || r.status !== 'done') continue;
    if (!last || r.statementDate > last.statementDate || (r.statementDate === last.statementDate && r.finishedAt > last.finishedAt)) last = r;
  }
  return last;
}

export function draftReconciliation(store, accountId) {
  for (const r of store.recons.values()) if (r.accountId === accountId && r.status === 'draft') return r;
  return null;
}

/** Sum of everything reconciled so far on the account (debit positive). */
export function beginningBalance(store, accountId) {
  // What each transaction was worth when it was reconciled, so a later edit
  // shows up as a discrepancy instead of quietly moving this number.
  let v = 0;
  const seen = new Set();
  for (const r of store.recons.values()) {
    if (r.accountId !== accountId || r.status !== 'done') continue;
    for (const id of r.clearedIds || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (r.amounts && r.amounts[id] !== undefined) v += r.amounts[id];
      else {
        const t = store.txn(id);
        if (t) v += amountOn(store, t, accountId);
      }
    }
  }
  return v;
}

/** Unreconciled transactions on the account up to the statement date. */
export function candidates(store, accountId, statementDate) {
  const L = store.ledger('accrual');
  const idx = L.accountIndex.get(accountId);
  if (idx === undefined) return [];
  const reconciled = store.reconciledIds(accountId);
  const cleared = store.clearedIds(accountId);
  const by = new Map();
  const list = L.byAccount(idx);
  for (let k = 0; k < list.length; k++) {
    const i = list[k];
    const t = L.txns[L.txn[i]];
    if (reconciled.has(t.id)) continue;
    if (statementDate && t.date > statementDate) continue;
    if (!by.has(t.id)) by.set(t.id, { txn: t, amount: 0, cleared: cleared.has(t.id) });
    by.get(t.id).amount += L.amt[i];
  }
  return [...by.values()].filter((c) => c.amount !== 0).sort((a, b) => a.txn.date.localeCompare(b.txn.date));
}

/**
 * The numbers at the top of the reconcile screen, in the account's natural
 * sign (a card balance owed is positive).
 */
export function summarize(store, accountId, { endingBalance, selected, items }) {
  const sign = typeInfo(store.account(accountId)?.type).sign;
  const begin = beginningBalance(store, accountId);
  let increases = 0; let decreases = 0; let nIn = 0; let nOut = 0;
  for (const c of items) {
    if (!selected.has(c.txn.id)) continue;
    const natural = c.amount * sign;
    if (natural >= 0) { increases += natural; nIn++; } else { decreases += -natural; nOut++; }
  }
  const beginning = begin * sign;
  const cleared = beginning + increases - decreases;
  return { beginning, increases, decreases, nIn, nOut, cleared, ending: endingBalance, difference: Math.round(endingBalance - cleared) };
}

/** Record a finished reconciliation. Returns the record to save. */
export function finishRecord(store, { accountId, statementDate, endingBalance, selected, draftId = null, adjustmentId = null }) {
  const amounts = {};
  for (const id of selected) {
    const t = store.txn(id);
    if (t) amounts[id] = amountOn(store, t, accountId);
  }
  const sign = typeInfo(store.account(accountId)?.type).sign;
  return {
    id: draftId || undefined,
    accountId,
    statementDate,
    endingBalance,
    beginningBalance: beginningBalance(store, accountId) * sign,
    clearedIds: [...selected],
    amounts,
    adjustmentId,
    status: 'done',
    finishedAt: Date.now(),
  };
}

/** Undo the most recent reconciliation of an account (back to unreconciled). */
export function undoLast(store, accountId) {
  const last = lastReconciliation(store, accountId);
  if (!last) return null;
  store.remove('recons', last.id);
  return last;
}
