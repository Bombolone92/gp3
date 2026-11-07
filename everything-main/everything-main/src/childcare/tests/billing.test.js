import { describe, it, expect } from 'vitest';
import { account, allAccounts, aging, invoiceTotal, planBillingRun, periodFor, collectedByMonth, planTotals } from '../src/core/billing.js';

const inv = (id, due, cents, extra = {}) => ({ id, number: Number(id.slice(1)), studentId: 's1', issueDate: due, dueDate: due, items: [{ amountCents: cents, qty: 1 }], status: 'open', ...extra });

describe('billing', () => {
  it('totals line items with quantities', () => {
    expect(invoiceTotal({ items: [{ amountCents: 1000, qty: 3 }, { amountCents: 250 }] })).toBe(3250);
  });

  it('applies payments to the oldest statements first', () => {
    const invoices = [inv('i2', '2026-10-05', 100000), inv('i1', '2026-09-05', 100000), inv('i3', '2026-11-05', 50000)];
    const payments = [{ studentId: 's1', amountCents: 150000 }];
    const acc = account('s1', invoices, payments, '2026-10-12');
    expect(acc.rows.map((r) => [r.invoice.id, r.status, r.balance])).toEqual([
      ['i1', 'paid', 0],
      ['i2', 'overdue', 50000],
      ['i3', 'due', 50000],
    ]);
    expect(acc).toMatchObject({ billed: 250000, paid: 150000, balance: 100000, overdue: 50000 });
  });

  it('ignores void statements and shows credit', () => {
    const acc = account('s1', [inv('i1', '2026-09-05', 100000, { status: 'void' })], [{ studentId: 's1', amountCents: 20000 }], '2026-10-12');
    expect(acc.rows[0].status).toBe('void');
    expect(acc.balance).toBe(-20000);
  });

  it('buckets receivables by age', () => {
    const invoices = [inv('i1', '2026-10-20', 100), inv('i2', '2026-10-01', 200), inv('i3', '2026-08-20', 300), inv('i4', '2026-05-01', 400)];
    const b = aging(allAccounts(invoices, [], '2026-10-12'), '2026-10-12');
    expect(b).toEqual({ current: 100, d30: 200, d60: 300, d90: 0, older: 400 });
  });

  it('plans a billing run once per child per period', () => {
    const plans = [{ id: 'm', name: 'Toddler', amountCents: 160000, frequency: 'monthly' }, { id: 'w', name: 'Part time', amountCents: 26500, frequency: 'weekly' }];
    const students = [
      { id: 'a', status: 'active', plans: [{ planId: 'm' }] },
      { id: 'b', status: 'active', plans: [{ planId: 'm', amountCents: 150000 }] },
      { id: 'c', status: 'active', plans: [{ planId: 'w' }] },
      { id: 'd', status: 'inactive', plans: [{ planId: 'm' }] },
      { id: 'e', status: 'active', plans: [{ planId: 'm' }] },
    ];
    const invoices = [{ studentId: 'e', period: 'monthly:2026-10', status: 'open' }];
    const { period, drafts } = planBillingRun({ students, plans, invoices }, { frequency: 'monthly', day: '2026-10-12', dueDays: 7 });
    expect(period.key).toBe('monthly:2026-10');
    expect(drafts.map((d) => [d.studentId, invoiceTotal(d)])).toEqual([
      ['a', 160000],
      ['b', 150000],
    ]);
    expect(drafts[0].dueDate).toBe('2026-10-19');
    expect(planBillingRun({ students, plans, invoices }, { frequency: 'weekly', day: '2026-10-14', weekStart: 1 }).drafts.map((d) => d.period)).toEqual(['weekly:2026-10-12']);
    expect(planTotals(students[1], plans)).toEqual({ weekly: 0, monthly: 150000 });
  });

  it('describes billing periods', () => {
    expect(periodFor('weekly', '2026-10-15', 1).start).toBe('2026-10-12');
    expect(periodFor('monthly', '2026-10-15').key).toBe('monthly:2026-10');
  });

  it('sums collections by month, leaving out credits', () => {
    const rows = collectedByMonth([{ date: '2026-09-03', amountCents: 100 }, { date: '2026-10-01', amountCents: 50 }, { date: '2026-10-02', amountCents: 999, kind: 'credit' }], '2026-08-01', '2026-10-12');
    expect(rows).toEqual([{ month: '2026-08', cents: 0 }, { month: '2026-09', cents: 100 }, { month: '2026-10', cents: 50 }]);
  });
});
