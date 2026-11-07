import { describe, it, expect } from 'vitest';
import { ACC } from '../src/core/accounts.js';
import { buildCharge, buildPayment, buildCredit, buildApplyPrepayment, buildBill, computeIndex } from '../src/core/ledger.js';
import { agingBuckets, ledgerRows, accountSummary, proration, firstDueAfter, groupByVendor, journalDifference, owedRows, allocated } from '../src/views/transactions/logic.js';

const lease = { id: 'L1', propertyId: 'P1', unitId: 'U1' };
const charge = (date, amount, accountId = ACC.rent) => buildCharge({ lease, date, items: [{ accountId, amount }] });
const pay = (date, amount) => buildPayment({ lease, date, amount, allocations: [{ accountId: ACC.rent, amount }] });

describe('agingBuckets', () => {
  it('applies payments to the oldest charges first', () => {
    const txs = [charge('2026-07-01', 1000), charge('2026-08-01', 1000), charge('2026-09-01', 1000), charge('2026-10-01', 1000), pay('2026-10-05', 1500)];
    const info = computeIndex(txs).lease('L1');
    const a = agingBuckets(info.lines, '2026-10-12');
    expect(a.total).toBe(2500);
    expect(a.current).toBe(1000); // Oct 1
    expect(a.d31).toBe(1000); // Sep 1 (41 days)
    expect(a.d61).toBe(500); // half of Aug 1 (72 days)
    expect(a.d90).toBe(0);
  });

  it('puts very old charges in the over 90 bucket and ignores future ones', () => {
    const txs = [charge('2026-05-01', 700), charge('2026-11-01', 900)];
    const a = agingBuckets(computeIndex(txs).lease('L1').lines, '2026-10-12');
    expect(a).toEqual({ current: 0, d31: 0, d61: 0, d90: 700, total: 700 });
  });

  it('is empty when the lease is paid up or in credit', () => {
    const txs = [charge('2026-10-01', 1000), pay('2026-10-02', 1200)];
    expect(agingBuckets(computeIndex(txs).lease('L1').lines, '2026-10-12').total).toBe(0);
  });
});

describe('ledgerRows', () => {
  it('runs a balance oldest first and skips prepayment moves', () => {
    const txs = [
      charge('2026-09-01', 1000),
      buildPayment({ lease, date: '2026-09-02', amount: 1500, allocations: [{ accountId: ACC.rent, amount: 1000 }] }),
      charge('2026-10-01', 1000),
      buildApplyPrepayment({ lease, date: '2026-10-01', items: [{ accountId: ACC.rent, amount: 500 }] }),
    ];
    const rows = ledgerRows(txs, 'L1');
    expect(rows.map((r) => r.balance)).toEqual([1000, -500, 500]);
    expect(rows[1].credit).toBe(1500);
  });

  it('keeps voided rows without moving the balance', () => {
    const rows = ledgerRows([charge('2026-09-01', 1000), { ...charge('2026-09-02', 999), voided: true }], 'L1');
    expect(rows).toHaveLength(2);
    expect(rows[1].balance).toBe(1000);
  });

  it('ignores other leases', () => {
    expect(ledgerRows([buildCharge({ lease: { ...lease, id: 'L2' }, date: '2026-09-01', items: [{ accountId: ACC.rent, amount: 5 }] })], 'L1')).toEqual([]);
  });
});

describe('accountSummary', () => {
  it('sums charges and payments per account', () => {
    const txs = [charge('2026-10-01', 1000), charge('2026-10-01', 200, ACC.lateFees), pay('2026-10-03', 600), buildCredit({ lease, date: '2026-10-04', items: [{ accountId: ACC.lateFees, amount: 200 }] })];
    const s = Object.fromEntries(accountSummary(txs, 'L1').map((r) => [r.accountId, r]));
    expect(s[ACC.rent]).toMatchObject({ charged: 1000, paid: 600, balance: 400 });
    expect(s[ACC.lateFees]).toMatchObject({ charged: 200, paid: 200, balance: 0 });
  });
});

describe('proration', () => {
  it('prorates a mid-month start by days in that month', () => {
    const p = proration(300000, '2026-09-16', 1);
    expect(p).toMatchObject({ from: '2026-09-16', to: '2026-09-30', firstDue: '2026-10-01', days: 15, amount: 150000 });
  });

  it('is not needed when the lease starts on the due day', () => {
    expect(proration(100000, '2026-10-01', 1)).toBe(null);
    expect(proration(100000, '2026-02-28', 31)).toBe(null);
  });

  it('finds the first due date after a start', () => {
    expect(firstDueAfter('2026-10-01', 1)).toBe('2026-11-01');
    expect(firstDueAfter('2026-10-03', 15)).toBe('2026-10-15');
    expect(firstDueAfter('2026-01-31', 31)).toBe('2026-02-28');
  });
});

describe('small helpers', () => {
  it('groups bill payments by vendor and drops zero amounts', () => {
    const b1 = buildBill({ id: 'B1', vendorId: 'V1', date: '2026-10-01', items: [{ accountId: ACC.repairs, amount: 100 }] });
    const b2 = buildBill({ id: 'B2', vendorId: 'V2', date: '2026-10-01', items: [{ accountId: ACC.repairs, amount: 100 }] });
    const b3 = buildBill({ id: 'B3', vendorId: 'V1', date: '2026-10-01', items: [{ accountId: ACC.repairs, amount: 100 }] });
    const map = new Map([b1, b2, b3].map((b) => [b.id, b]));
    const g = groupByVendor([{ billId: 'B1', amount: 50 }, { billId: 'B2', amount: 0 }, { billId: 'B3', amount: 100 }], map);
    expect([...g.keys()]).toEqual(['V1']);
    expect(g.get('V1')).toHaveLength(2);
  });

  it('computes journal differences, owed rows and allocation sums', () => {
    expect(journalDifference([{ debit: 500 }, { credit: 300 }, { credit: 200 }])).toBe(0);
    expect(journalDifference([{ debit: 500 }, { credit: 300 }])).toBe(200);
    expect(owedRows(new Map([['a', 5], ['b', -2], ['c', 0]]))).toEqual([{ accountId: 'a', owed: 5 }]);
    expect(allocated([{ amount: 3 }, { amount: 4 }])).toBe(7);
  });
});

describe('restoring a voided transaction', () => {
  it('refuses when it would overpay a bill', async () => {
    const { restoreProblem } = await import('../src/views/transactions/logic.js');
    const { buildBill, buildBillPayment } = await import('../src/core/ledger.js');
    const { ACC: A } = await import('../src/core/accounts.js');
    const bill = buildBill({ id: 'B', vendorId: 'V', date: '2026-10-01', items: [{ accountId: A.repairs, amount: 10000, propertyId: 'P' }] });
    const p1 = { ...buildBillPayment({ vendorId: 'V', date: '2026-10-02', allocations: [{ billId: 'B', amount: 10000 }], bills: { B: bill } }), voided: true };
    const p2 = buildBillPayment({ vendorId: 'V', date: '2026-10-03', allocations: [{ billId: 'B', amount: 10000 }], bills: { B: bill } });
    expect(restoreProblem([bill, p1, p2], p1)).toMatch(/more than it is for/);
    expect(restoreProblem([bill, p1], p1)).toBe(null);
  });
});
