import { describe, it, expect } from 'vitest';
import { ACC } from '../src/core/accounts.js';
import {
  buildCharge,
  buildPayment,
  buildCredit,
  buildRefund,
  buildApplyDeposit,
  buildBill,
  buildBillPayment,
  buildJournal,
  buildOwnerTransaction,
  computeIndex,
  isBalanced,
  suggestAllocation,
  billStatus,
  leaseEffect,
  leaseBalanceAsOf,
} from '../src/core/ledger.js';
import { computePostings } from '../src/core/leases.js';
import { defaultSettings } from '../src/core/settings.js';

const lease = { id: 'L1', propertyId: 'P1', unitId: 'U1' };

describe('transaction builders', () => {
  it('always produce balanced transactions', () => {
    const txs = [
      buildCharge({ lease, date: '2026-10-01', items: [{ accountId: ACC.rent, amount: 120000 }, { accountId: 'acc-parking', amount: 5000 }] }),
      buildPayment({ lease, date: '2026-10-02', amount: 130000, allocations: [{ accountId: ACC.rent, amount: 120000 }] }),
      buildCredit({ lease, date: '2026-10-03', items: [{ accountId: 'acc-parking', amount: 5000 }] }),
      buildRefund({ lease, date: '2026-10-04', amount: 10000 }),
      buildApplyDeposit({ lease, date: '2026-10-05', items: [{ accountId: ACC.rent, amount: 50000 }] }),
      buildBill({ vendorId: 'V1', date: '2026-10-01', items: [{ accountId: ACC.repairs, amount: 33333, propertyId: 'P1' }, { accountId: ACC.repairs, amount: 66667, propertyId: 'P2' }] }),
      buildOwnerTransaction({ kind: 'distribution', ownerId: 'O1', propertyId: 'P1', date: '2026-10-31', amount: 100000 }),
    ];
    for (const tx of txs) expect(isBalanced(tx)).toBe(true);
  });

  it('rejects an unbalanced journal entry', () => {
    expect(() => buildJournal({ date: '2026-10-01', lines: [{ accountId: ACC.operating, debit: 100 }, { accountId: ACC.rent, credit: 99 }] })).toThrow();
    const ok = buildJournal({ date: '2026-10-01', lines: [{ accountId: ACC.operating, debit: 100 }, { accountId: ACC.rent, credit: 100 }] });
    expect(isBalanced(ok)).toBe(true);
  });

  it('refuses to apply more than the payment', () => {
    expect(() => buildPayment({ lease, date: '2026-10-02', amount: 100, allocations: [{ accountId: ACC.rent, amount: 101 }] })).toThrow();
  });

  it('splits a bill payment across the bill properties and adds up exactly', () => {
    const bill = buildBill({ id: 'B1', vendorId: 'V1', date: '2026-10-01', items: [{ accountId: ACC.repairs, amount: 10000, propertyId: 'P1' }, { accountId: ACC.repairs, amount: 20001, propertyId: 'P2' }] });
    const pay = buildBillPayment({ vendorId: 'V1', date: '2026-10-10', allocations: [{ billId: 'B1', amount: 15001 }], bills: new Map([['B1', bill]]) });
    expect(isBalanced(pay)).toBe(true);
    const bank = pay.lines.filter((l) => l.accountId === ACC.operating);
    expect(bank.reduce((s, l) => s + l.amount, 0)).toBe(-15001);
    expect(new Set(bank.map((l) => l.propertyId))).toEqual(new Set(['P1', 'P2']));
  });
});

describe('ledger index', () => {
  it('tracks lease balances by account, prepayments, and deposits', () => {
    const txs = [
      buildCharge({ lease, date: '2026-09-01', items: [{ accountId: ACC.depositsHeld, amount: 150000 }] }),
      buildCharge({ lease, date: '2026-10-01', items: [{ accountId: ACC.rent, amount: 150000 }] }),
      buildPayment({ lease, date: '2026-10-02', amount: 320000, allocations: [{ accountId: ACC.depositsHeld, amount: 150000 }, { accountId: ACC.rent, amount: 150000 }] }),
    ];
    const ix = computeIndex(txs);
    const l = ix.lease('L1');
    expect(l.ar).toBe(0);
    expect(l.prepaid).toBe(20000);
    expect(l.balance).toBe(-20000);
    expect(l.deposits).toBe(150000);
    expect(l.lastPayment.date).toBe('2026-10-02');
    expect(ix.account(ACC.operating)).toBe(320000);
    expect(ix.account(ACC.rent)).toBe(-150000);
  });

  it('ignores voided transactions', () => {
    const c = buildCharge({ lease, date: '2026-10-01', items: [{ accountId: ACC.rent, amount: 1000 }] });
    expect(computeIndex([{ ...c, voided: true }]).lease('L1').balance).toBe(0);
  });

  it('applying a deposit reduces both the deposit held and the balance', () => {
    const txs = [
      buildCharge({ lease, date: '2026-01-01', items: [{ accountId: ACC.depositsHeld, amount: 100000 }] }),
      buildPayment({ lease, date: '2026-01-01', amount: 100000, allocations: [{ accountId: ACC.depositsHeld, amount: 100000 }] }),
      buildCharge({ lease, date: '2026-10-01', items: [{ accountId: 'acc-chargebacks', amount: 30000 }] }),
      buildApplyDeposit({ lease, date: '2026-10-05', items: [{ accountId: 'acc-chargebacks', amount: 30000 }] }),
    ];
    const l = computeIndex(txs).lease('L1');
    expect(l.balance).toBe(0);
    expect(l.deposits).toBe(70000);
  });

  it('computes bill balances and status', () => {
    const bill = buildBill({ id: 'B1', vendorId: 'V1', date: '2026-10-01', dueDate: '2026-10-15', items: [{ accountId: ACC.repairs, amount: 10000, propertyId: 'P1' }] });
    const pay = buildBillPayment({ vendorId: 'V1', date: '2026-10-10', allocations: [{ billId: 'B1', amount: 4000 }], bills: { B1: bill } });
    const ix = computeIndex([bill, pay]);
    expect(ix.bill('B1')).toMatchObject({ total: 10000, paid: 4000, balance: 6000 });
    expect(ix.vendorOwed('V1')).toBe(6000);
    expect(billStatus(bill, ix.bill('B1'), '2026-10-12')).toBe('partial');
    expect(billStatus(bill, ix.bill('B1'), '2026-10-16')).toBe('overdue');
  });

  it('reports what a transaction does to a lease balance', () => {
    const p = buildPayment({ lease, date: '2026-10-02', amount: 500, allocations: [{ accountId: ACC.rent, amount: 300 }] });
    expect(leaseEffect(p, 'L1')).toBe(-500);
  });
});

describe('bill payments across properties', () => {
  it('part payments leave nothing owed on any property once the bill is paid', () => {
    const bill = buildBill({ id: 'B1', vendorId: 'V1', date: '2026-10-01', items: [{ accountId: ACC.repairs, amount: 33333, propertyId: 'P1' }, { accountId: ACC.repairs, amount: 33333, propertyId: 'P2' }, { accountId: ACC.repairs, amount: 33334, propertyId: 'P3' }] });
    const bills = new Map([['B1', bill]]);
    const first = buildBillPayment({ vendorId: 'V1', date: '2026-10-05', allocations: [{ billId: 'B1', amount: 50000 }], bills });
    const second = buildBillPayment({ vendorId: 'V1', date: '2026-10-06', allocations: [{ billId: 'B1', amount: 50000 }], bills, previous: [first] });
    for (const tx of [first, second]) expect(isBalanced(tx)).toBe(true);
    const owedOn = (prop) => 0 - [bill, first, second].flatMap((t) => t.lines).filter((l) => l.accountId === ACC.ap && l.propertyId === prop).reduce((s, l) => s + l.amount, 0);
    expect(['P1', 'P2', 'P3'].map((p) => owedOn(p) + 0)).toEqual([0, 0, 0]);
    expect(computeIndex([bill, first, second]).bill('B1').balance).toBe(0);
  });
});

describe('suggestAllocation', () => {
  it('pays deposits, then fees, then rent', () => {
    const owed = new Map([
      [ACC.rent, 100000],
      [ACC.lateFees, 5000],
      [ACC.depositsHeld, 50000],
    ]);
    expect(suggestAllocation(owed, 120000)).toEqual([
      { accountId: ACC.depositsHeld, amount: 50000 },
      { accountId: ACC.lateFees, amount: 5000 },
      { accountId: ACC.rent, amount: 65000 },
    ]);
  });

  it('never applies to accounts with a credit', () => {
    expect(suggestAllocation(new Map([[ACC.rent, -100]]), 500)).toEqual([]);
  });
});

describe('deposits held', () => {
  it('counts a deposit only once it is paid', () => {
    const charge = buildCharge({ lease, date: '2026-10-01', items: [{ accountId: ACC.depositsHeld, amount: 150000 }] });
    expect(computeIndex([charge]).lease('L1')).toMatchObject({ deposits: 0, depositsCharged: 150000 });
    const part = buildPayment({ lease, date: '2026-10-02', amount: 50000, allocations: [{ accountId: ACC.depositsHeld, amount: 50000 }] });
    expect(computeIndex([charge, part]).lease('L1').deposits).toBe(50000);
  });
});

describe('prepaid rent charged up front', () => {
  const charge = buildCharge({ lease, date: '2026-10-01', items: [{ accountId: ACC.prepaid, amount: 100000 }] });

  it('is owed until paid, then held as credit', () => {
    const owed = computeIndex([charge]).lease('L1');
    expect(owed).toMatchObject({ balance: 100000, prepaid: 0 });
    expect(leaseBalanceAsOf(owed, '2026-10-01')).toBe(100000);
    const pay = buildPayment({ lease, date: '2026-10-03', amount: 100000, allocations: [{ accountId: ACC.prepaid, amount: 100000 }] });
    const paid = computeIndex([charge, pay]).lease('L1');
    expect(paid).toMatchObject({ balance: -100000, prepaid: 100000 });
    expect(leaseBalanceAsOf(paid, '2026-10-02')).toBe(100000);
    expect(leaseBalanceAsOf(paid, '2026-10-03')).toBe(-100000);
  });

  it('is not applied to rent before it is paid', () => {
    const l = { ...lease, recurring: [{ id: 'r', accountId: ACC.rent, amount: 100000, day: 1, start: '2026-11-01', postedThrough: null }], start: '2026-10-01', type: 'at-will', lateFee: { enabled: false } };
    const out = computePostings({ leases: [l], index: computeIndex([charge]), settings: defaultSettings(), today: '2026-11-02' });
    expect(out.transactions.filter((t) => t.kind === 'apply-prepayment')).toEqual([]);
  });

  it('waiving it leaves nothing owed and no credit', () => {
    const waive = buildCredit({ lease, date: '2026-10-05', items: [{ accountId: ACC.prepaid, amount: 100000 }] });
    expect(computeIndex([charge, waive]).lease('L1')).toMatchObject({ balance: 0, prepaid: 0 });
    expect(leaseBalanceAsOf(computeIndex([charge, waive]).lease('L1'), '2026-10-05')).toBe(0);
  });
});

describe('journal entries', () => {
  it('keep lease links on their lines', () => {
    const tx = buildJournal({ date: '2026-10-01', lines: [{ accountId: ACC.depositsHeld, debit: 500, leaseId: 'L1' }, { accountId: ACC.depositsHeld, credit: 500, leaseId: 'L2' }] });
    const ix = computeIndex([tx]);
    expect(ix.lease('L2').depositsCharged).toBe(500);
    expect(tx.lines.map((l) => l.leaseId)).toEqual(['L1', 'L2']);
  });
});
