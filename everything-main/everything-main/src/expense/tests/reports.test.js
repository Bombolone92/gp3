import { describe, it, expect } from 'vitest';
import { nextStatus, canTransition, applyTransition, reportTotals, isEditable, transitionLabel } from '../src/lib/reports.js';

describe('report lifecycle', () => {
  it('moves forward one step at a time and ends at reimbursed', () => {
    expect(nextStatus('draft')).toBe('submitted');
    expect(nextStatus('approved')).toBe('reimbursed');
    expect(nextStatus('reimbursed')).toBeNull();
  });
  it('allows withdrawing a submitted report but no other skips', () => {
    expect(canTransition('draft', 'submitted')).toBe(true);
    expect(canTransition('submitted', 'draft')).toBe(true);
    expect(canTransition('draft', 'approved')).toBe(false);
    expect(canTransition('reimbursed', 'draft')).toBe(false);
    expect(canTransition('nope', 'draft')).toBe(false);
  });
  it('stamps timestamps on transition and clears them on withdraw', () => {
    const r = applyTransition({ id: 'r', status: 'draft', submittedAt: null }, 'submitted', 123);
    expect(r).toMatchObject({ status: 'submitted', submittedAt: 123, updatedAt: 123 });
    expect(applyTransition(r, 'draft', 456).submittedAt).toBeNull();
  });
  it('only drafts are editable and labels follow status', () => {
    expect(isEditable({ status: 'draft' })).toBe(true);
    expect(isEditable({ status: 'submitted' })).toBe(false);
    expect(transitionLabel('approved')).toBe('Mark reimbursed');
    expect(transitionLabel('reimbursed')).toBeNull();
  });
});

describe('reportTotals', () => {
  it('sums only the report’s expenses, per currency', () => {
    const report = { id: 'r1' };
    const expenses = [
      { reportId: 'r1', amount: 10, currency: 'USD', receiptPath: 'p', reconciled: true },
      { reportId: 'r1', amount: 5, currency: 'EUR', receiptPath: null, reconciled: false },
      { reportId: 'r2', amount: 99, currency: 'USD' },
    ];
    const t = reportTotals(report, expenses);
    expect(t.count).toBe(2);
    expect(t.byCurrency.get('USD')).toBe(10);
    expect(t.byCurrency.get('EUR')).toBe(5);
    expect(t.withReceipt).toBe(1);
    expect(t.reconciled).toBe(1);
  });
});
