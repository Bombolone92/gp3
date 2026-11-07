import { describe, it, expect } from 'vitest';
import { makeBooks } from './helpers/books.js';
import { candidates, summarize, finishRecord, beginningBalance, undoLast } from '../src/lib/reconcile.js';
import { reconDiscrepancy } from '../src/lib/reports.js';

function setup() {
  const b = makeBooks();
  const { s, acct } = b;
  const checking = acct('Checking');
  const dep = s.saveTxn({ type: 'deposit', date: '2026-05-01', accountId: checking, lines: [{ accountId: acct("Owner's Investment"), amount: 100000 }] });
  const e1 = s.saveTxn({ type: 'expense', date: '2026-05-10', accountId: checking, lines: [{ accountId: acct('Meals'), amount: 2500 }] });
  const e2 = s.saveTxn({ type: 'expense', date: '2026-06-02', accountId: checking, lines: [{ accountId: acct('Meals'), amount: 1000 }] });
  return { ...b, checking, dep, e1, e2 };
}

describe('reconciliation', () => {
  it('lists unreconciled transactions up to the statement date', () => {
    const { s, checking } = setup();
    expect(candidates(s, checking, '2026-05-31').map((c) => c.amount)).toEqual([100000, -2500]);
  });
  it('computes the difference from the ticked items', () => {
    const { s, checking, dep, e1 } = setup();
    const items = candidates(s, checking, '2026-05-31');
    const sum = summarize(s, checking, { endingBalance: 97500, selected: new Set([dep.id, e1.id]), items });
    expect(sum).toMatchObject({ beginning: 0, increases: 100000, decreases: 2500, cleared: 97500, difference: 0 });
    const partial = summarize(s, checking, { endingBalance: 97500, selected: new Set([dep.id]), items });
    expect(partial.difference).toBe(-2500);
  });
  it('carries the reconciled balance forward and hides reconciled items', () => {
    const { s, checking, dep, e1 } = setup();
    s.put('recons', finishRecord(s, { accountId: checking, statementDate: '2026-05-31', endingBalance: 97500, selected: new Set([dep.id, e1.id]) }));
    expect(beginningBalance(s, checking)).toBe(97500);
    expect(candidates(s, checking, '2026-06-30').map((c) => c.amount)).toEqual([-1000]);
    expect(s.reconcileStatus(dep.id, checking)).toBe('R');
  });
  it('reports a reconciled transaction that was changed later, and can be undone', () => {
    const { s, checking, dep, e1, acct } = setup();
    s.put('recons', finishRecord(s, { accountId: checking, statementDate: '2026-05-31', endingBalance: 97500, selected: new Set([dep.id, e1.id]) }));
    s.saveTxn({ ...s.txn(e1.id), lines: [{ accountId: acct('Meals'), amount: 3000 }] });
    const r = reconDiscrepancy(s);
    expect(r.rows[0].values.slice(5)).toEqual([-2500, -3000, -500]);
    undoLast(s, checking);
    expect(beginningBalance(s, checking)).toBe(0);
  });
});
