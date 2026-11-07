import { describe, it, expect } from 'vitest';
import { revenueByMonth, agedReceivables, revenueByItem, topClients, quoteFunnel, leadSources, visitsByMember, expensesByCategory, monthBuckets } from '../src/core/reports.js';

const inv = (id, issueDate, dueDate, amount, extra = {}) => ({ id, issueDate, dueDate, sentAt: issueDate, items: [{ name: 'Mowing', qty: 1, unitPrice: amount }], ...extra });

describe('reports', () => {
  it('buckets months inclusively', () => {
    expect(monthBuckets('2026-01-15', '2026-03-02').map((m) => m.key)).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('splits collected and invoiced revenue by month', () => {
    const invoices = [inv('a', '2026-08-03', '2026-09-02', 10000), inv('b', '2026-09-10', '2026-10-10', 5000), inv('c', '2026-09-11', '2026-10-11', 999, { sentAt: null })];
    const payments = [{ invoiceId: 'a', amount: 10000, date: '2026-09-01' }, { invoiceId: 'b', amount: 2000, date: '2026-09-20', voided: true }];
    const rows = revenueByMonth({ payments, invoices }, '2026-08-01', '2026-09-30');
    expect(rows.map((r) => [r.key, r.invoiced, r.collected])).toEqual([
      ['2026-08', 10000, 0],
      ['2026-09', 5000, 10000],
    ]);
  });

  it('ages receivables by days late', () => {
    const invoices = [inv('a', '2026-09-01', '2026-10-20', 100), inv('b', '2026-08-01', '2026-09-30', 200), inv('c', '2026-05-01', '2026-06-01', 300), inv('d', '2026-05-01', '2026-06-01', 400)];
    const payments = [{ invoiceId: 'd', amount: 400, date: '2026-06-02' }];
    const b = agedReceivables({ invoices, payments }, '2026-10-12');
    expect(b.map((x) => x.amount)).toEqual([100, 200, 0, 0, 300]);
  });

  it('ranks services, clients and sources', () => {
    const invoices = [inv('a', '2026-09-01', '2026-09-30', 100), { ...inv('b', '2026-09-02', '2026-09-30', 0), items: [{ name: 'Hedges', qty: 2, unitPrice: 300 }, { name: 'Extra', qty: 1, unitPrice: 50, optional: true }] }];
    expect(revenueByItem(invoices, '2026-09-01', '2026-09-30')).toEqual([{ label: 'Hedges', amount: 600 }, { label: 'Mowing', amount: 100 }]);
    const payments = [{ clientId: 'x', amount: 5, date: '2026-09-01' }, { clientId: 'y', amount: 9, date: '2026-09-02' }, { clientId: 'x', amount: 6, date: '2026-09-03' }];
    expect(topClients(payments, '2026-09-01', '2026-09-30')).toEqual([{ clientId: 'x', amount: 11 }, { clientId: 'y', amount: 9 }]);
    expect(leadSources([{ createdAt: '2026-09-01T00:00', leadSource: 'Google' }, { createdAt: '2026-09-02T00:00' }, { createdAt: '2026-09-03T00:00', leadSource: 'Google' }], '2026-09-01', '2026-09-30')).toEqual([{ label: 'Google', count: 2 }, { label: 'Not specified', count: 1 }]);
  });

  it('computes the quote funnel', () => {
    const quotes = [
      { createdAt: '2026-09-01T10:00', status: 'draft', items: [{ qty: 1, unitPrice: 100 }] },
      { createdAt: '2026-09-02T10:00', status: 'awaiting_response', sentAt: 'x', items: [{ qty: 1, unitPrice: 200 }] },
      { createdAt: '2026-09-03T10:00', status: 'approved', sentAt: 'x', jobId: 'j', items: [{ qty: 1, unitPrice: 300 }] },
    ];
    expect(quoteFunnel(quotes, '2026-09-01', '2026-09-30')).toMatchObject({ created: 3, sent: 2, won: 1, rate: 50, wonValue: 300 });
  });

  it('counts completed visits per person and expenses per category', () => {
    const jobs = [{ visits: [{ date: '2026-09-01', completedAt: 'x', assignees: ['a', 'b'] }, { date: '2026-09-02', completedAt: 'x', assignees: [] }, { date: '2026-09-03', assignees: ['a'] }] }];
    const m = visitsByMember(jobs, '2026-09-01', '2026-09-30');
    expect(Object.fromEntries(m)).toEqual({ a: 1, b: 1, unassigned: 1 });
    expect(expensesByCategory([{ date: '2026-09-01', category: 'Fuel', amount: 5 }, { date: '2026-09-02', amount: 7 }], '2026-09-01', '2026-09-30')).toEqual([{ label: 'Other', amount: 7 }, { label: 'Fuel', amount: 5 }]);
  });
});
