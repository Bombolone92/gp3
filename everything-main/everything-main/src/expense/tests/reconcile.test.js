import { describe, it, expect } from 'vitest';
import { scoreMatch, suggestMatches, reconcileSummary, isDuplicateLine } from '../src/lib/reconcile.js';

const exp = (id, date, amount, merchant, extra = {}) => ({ id, date, amount, merchant, currency: 'USD', reconciled: false, ...extra });
const line = (id, date, amount, description, extra = {}) => ({ id, date, amount, description, currency: 'USD', matchedExpenseId: null, ...extra });

describe('scoreMatch', () => {
  it('rewards exact amount, same day and shared merchant words', () => {
    const s = scoreMatch(line('l', '2026-08-20', 14.6, 'BLUE FERN CAFE NYC'), exp('e', '2026-08-20', 14.6, 'Blue Fern Cafe'));
    expect(s.score).toBeGreaterThanOrEqual(95);
    expect(s.reasons).toEqual(expect.arrayContaining(['Exact amount', 'Same day', 'Merchant matches']));
  });
  it('allows a posting lag of a few days but not weeks', () => {
    expect(scoreMatch(line('l', '2026-08-23', 20, 'X'), exp('e', '2026-08-20', 20, 'Y'))).not.toBeNull();
    expect(scoreMatch(line('l', '2026-08-30', 20, 'X'), exp('e', '2026-08-20', 20, 'Y'))).toBeNull();
    expect(scoreMatch(line('l', '2026-08-18', 20, 'X'), exp('e', '2026-08-20', 20, 'Y'))).toBeNull();
  });
  it('rejects different currencies and amounts outside tolerance', () => {
    expect(scoreMatch(line('l', '2026-08-20', 20, 'X', { currency: 'EUR' }), exp('e', '2026-08-20', 20, 'Y'))).toBeNull();
    expect(scoreMatch(line('l', '2026-08-20', 20.5, 'X'), exp('e', '2026-08-20', 20, 'Y'))).toBeNull();
    expect(scoreMatch(line('l', '2026-08-20', 20.5, 'X'), exp('e', '2026-08-20', 20, 'Y'), { days: 4, amount: 0.01, amountPct: 0.05 })).not.toBeNull();
  });
});

describe('suggestMatches', () => {
  it('pairs each line and expense at most once, strongest first', () => {
    const lines = [line('l1', '2026-08-20', 14.6, 'BLUE FERN CAFE'), line('l2', '2026-08-21', 14.6, 'UNKNOWN POS'), line('l3', '2026-08-10', 99, 'NOTHING')];
    const expenses = [exp('e1', '2026-08-20', 14.6, 'Blue Fern Cafe'), exp('e2', '2026-08-21', 14.6, 'Corner Deli')];
    const out = suggestMatches(lines, expenses);
    expect(out).toHaveLength(2);
    expect(out.find((m) => m.lineId === 'l1').expenseId).toBe('e1');
    expect(out.find((m) => m.lineId === 'l2').expenseId).toBe('e2');
    expect(new Set(out.map((m) => m.expenseId)).size).toBe(2);
  });
  it('skips already matched lines and reconciled expenses', () => {
    const lines = [line('l1', '2026-08-20', 10, 'A', { matchedExpenseId: 'zzz' }), line('l2', '2026-08-20', 10, 'A')];
    const expenses = [exp('e1', '2026-08-20', 10, 'A', { reconciled: true }), exp('e2', '2026-08-20', 10, 'A')];
    const out = suggestMatches(lines, expenses);
    expect(out).toEqual([expect.objectContaining({ lineId: 'l2', expenseId: 'e2' })]);
  });
});

describe('reconcileSummary / isDuplicateLine', () => {
  it('counts matched, open and unreconciled', () => {
    const s = reconcileSummary([line('l1', '2026-08-01', 1, 'a', { matchedExpenseId: 'e1' }), line('l2', '2026-08-01', 2, 'b')], [exp('e1', '2026-08-01', 1, 'a', { reconciled: true }), exp('e2', '2026-08-01', 2, 'b')]);
    expect(s).toEqual({ total: 2, matched: 1, unmatchedLines: 1, unreconciled: 1 });
  });
  it('spots a re-imported line by date, amount and words', () => {
    const existing = [line('l1', '2026-08-01', 5, 'COFFEE PLACE 123')];
    expect(isDuplicateLine(line('x', '2026-08-01', 5, 'Coffee Place 123'), existing)).toBe(true);
    expect(isDuplicateLine(line('x', '2026-08-02', 5, 'Coffee Place 123'), existing)).toBe(false);
  });
});
