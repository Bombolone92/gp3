import { describe, it, expect } from 'vitest';
import { ACC, defaultAccounts } from '../src/core/accounts.js';
import { buildCharge, buildPayment, buildBill, buildBillPayment, buildOwnerTransaction, buildTransfer, buildExpense, buildApplyPrepayment } from '../src/core/ledger.js';
import {
  incomeStatement,
  balanceSheet,
  cashFlow,
  trialBalance,
  generalLedger,
  ownerStatement,
  budgetVsActual,
  budgetForMonth,
  monthlyIncomeExpense,
  propertyCash,
  accountBalance,
  unreconciledLines,
  clearedBalance,
  reconciledIds,
  lastReconciliation,
} from '../src/core/financials.js';
import { buildSampleData } from '../src/core/sample.js';

/** Minimal read-only store over plain arrays. */
function fakeStore(colls) {
  const data = { accounts: defaultAccounts(), transactions: [], properties: [], owners: [], budgets: [], reconciliations: [], ...colls };
  return { all: (c) => data[c] || [], get: (c, id) => (data[c] || []).find((r) => r.id === id) || null };
}

const L1 = { id: 'L1', propertyId: 'P1', unitId: 'U1' };
const L2 = { id: 'L2', propertyId: 'P2', unitId: 'U2' };

function ledger() {
  const bill = buildBill({ id: 'B1', vendorId: 'V1', date: '2026-02-03', items: [{ accountId: ACC.repairs, amount: 20000, propertyId: 'P1' }] });
  return [
    buildCharge({ lease: L1, date: '2026-01-01', items: [{ accountId: ACC.rent, amount: 100000 }] }),
    buildPayment({ id: 'PAY1', lease: L1, date: '2026-01-03', amount: 100000, allocations: [{ accountId: ACC.rent, amount: 100000 }] }),
    buildCharge({ lease: L2, date: '2026-01-01', items: [{ accountId: ACC.rent, amount: 50000 }] }),
    buildPayment({ id: 'PAY2', lease: L2, date: '2026-01-05', amount: 50000, allocations: [{ accountId: ACC.rent, amount: 50000 }] }),
    buildCharge({ lease: L1, date: '2026-02-01', items: [{ accountId: ACC.rent, amount: 100000 }, { accountId: ACC.lateFees, amount: 5000 }] }),
    bill,
    buildBillPayment({ id: 'BP1', vendorId: 'V1', date: '2026-02-10', allocations: [{ billId: 'B1', amount: 20000 }], bills: { B1: bill } }),
    buildOwnerTransaction({ id: 'D1', kind: 'distribution', ownerId: 'O1', propertyId: 'P1', date: '2026-02-20', amount: 30000 }),
    buildOwnerTransaction({ id: 'C1', kind: 'contribution', ownerId: 'O1', propertyId: 'P1', date: '2026-01-02', amount: 10000 }),
    { ...buildExpense({ date: '2026-02-11', items: [{ accountId: 'acc-supplies', amount: 99999, propertyId: 'P1' }] }), voided: true },
  ];
}

describe('incomeStatement', () => {
  it('sums income and expense with natural signs and skips voids', () => {
    const s = incomeStatement(fakeStore({ transactions: ledger() }), { from: '2026-01-01', to: '2026-02-28' });
    expect(s.totalIncome).toBe(255000);
    expect(s.income.find((r) => r.accountId === ACC.rent).amount).toBe(250000);
    expect(s.totalExpense).toBe(20000);
    expect(s.expense.some((r) => r.accountId === 'acc-supplies')).toBe(false);
    expect(s.net).toBe(235000);
  });

  it('filters by date and property', () => {
    const s = incomeStatement(fakeStore({ transactions: ledger() }), { from: '2026-02-01', to: '2026-02-28', propertyIds: ['P1'] });
    expect(s.totalIncome).toBe(105000);
    const p2 = incomeStatement(fakeStore({ transactions: ledger() }), { propertyIds: ['P2'] });
    expect(p2.totalIncome).toBe(50000);
    expect(p2.totalExpense).toBe(0);
  });
});

describe('balanceSheet', () => {
  it('balances: assets = liabilities + equity (including net income)', () => {
    const b = balanceSheet(fakeStore({ transactions: ledger() }), { asOf: '2026-12-31' });
    expect(b.totalAssets).toBe(b.totalLiabilities + b.totalEquity);
    expect(b.equity.find((r) => r.accountId === null).amount).toBe(235000);
    expect(b.assets.find((r) => r.accountId === ACC.ar).amount).toBe(105000);
  });

  it('balances on the demo portfolio as of any date', () => {
    const data = buildSampleData('2026-10-12');
    const store = fakeStore(data.collections);
    for (const asOf of ['2025-12-31', '2026-06-30', '2026-10-12']) {
      const b = balanceSheet(store, { asOf });
      expect(b.totalAssets).toBe(b.totalLiabilities + b.totalEquity);
    }
  });

  it('respects the as-of date', () => {
    const b = balanceSheet(fakeStore({ transactions: ledger() }), { asOf: '2026-01-31' });
    expect(b.assets.find((r) => r.accountId === ACC.ar)).toBeUndefined();
    expect(b.totalAssets).toBe(160000);
  });
});

describe('cashFlow', () => {
  it('groups bank movements and reconciles opening to closing', () => {
    const c = cashFlow(fakeStore({ transactions: ledger() }), { from: '2026-02-01', to: '2026-02-28' });
    expect(c.opening).toBe(160000);
    expect(c.outflows.find((r) => r.label === 'Bill payments').amount).toBe(20000);
    expect(c.outflows.find((r) => r.label === 'Owner distributions').amount).toBe(30000);
    expect(c.closing).toBe(c.opening + c.net);
    expect(c.closing).toBe(110000);
  });

  it('ignores transfers between bank accounts in the totals', () => {
    const tx = buildTransfer({ date: '2026-03-01', fromAccountId: ACC.operating, toAccountId: ACC.depositsBank, amount: 5000 });
    const c = cashFlow(fakeStore({ transactions: [tx] }), {});
    expect(c.net).toBe(0);
    expect(c.inflows).toEqual([]);
  });
});

describe('trialBalance', () => {
  it('has equal debits and credits', () => {
    const t = trialBalance(fakeStore({ transactions: ledger() }), { to: '2026-12-31' });
    expect(t.totalDebit).toBe(t.totalCredit);
    expect(t.rows.find((r) => r.accountId === ACC.rent).credit).toBe(250000);
  });

  it('carries balance sheet accounts into a period and closes earlier income', () => {
    const store = fakeStore({ transactions: ledger() });
    const t = trialBalance(store, { from: '2026-02-01', to: '2026-02-28' });
    expect(t.totalDebit).toBe(t.totalCredit);
    const row = (id) => t.rows.find((r) => r.accountId === id);
    // The bank balance ties to the balance sheet, not just February's activity.
    const bank = balanceSheet(store, { asOf: '2026-02-28' }).assets.find((r) => r.accountId === ACC.operating).amount;
    expect(row(ACC.operating).debit).toBe(bank);
    expect(row(ACC.rent).credit).toBe(100000); // February rent only
    expect(row(ACC.retained).credit).toBe(150000); // January's rent, closed
  });
});

describe('generalLedger', () => {
  it('carries an opening balance and a running balance in natural sign', () => {
    const g = generalLedger(fakeStore({ transactions: ledger() }), { from: '2026-02-01', to: '2026-02-28', accountIds: [ACC.operating] });
    expect(g).toHaveLength(1);
    expect(g[0].opening).toBe(160000);
    expect(g[0].rows.map((r) => r.amount)).toEqual([-20000, -30000]);
    expect(g[0].closing).toBe(110000);
    expect(g[0].rows.at(-1).balance).toBe(110000);
  });

  it('shows income as positive when credited', () => {
    const g = generalLedger(fakeStore({ transactions: ledger() }), { accountIds: [ACC.rent] });
    expect(g[0].closing).toBe(250000);
  });
});

describe('ownerStatement', () => {
  it('scales by ownership share and estimates the management fee', () => {
    const store = fakeStore({
      transactions: ledger(),
      owners: [{ id: 'O1', managementFee: 10 }],
      properties: [{ id: 'P1', owners: [{ ownerId: 'O1', pct: 50 }] }, { id: 'P2', owners: [{ ownerId: 'O2', pct: 100 }] }],
    });
    const s = ownerStatement(store, { ownerId: 'O1', from: '2026-02-01', to: '2026-02-28' });
    expect(s.properties).toHaveLength(1);
    const p = s.properties[0];
    expect(p.pct).toBe(50);
    // P1 bank before Feb: half the 100000 payment, plus O1's own 10000 contribution.
    expect(p.opening).toBe(60000);
    expect(p.income).toBe(52500);
    expect(p.expenses).toBe(10000);
    // The distribution was tagged with O1, so it counts in full.
    expect(p.distributions).toBe(30000);
    // P1 bank after Feb: half of 100000 - 20000, plus O1's 10000 in, less O1's 30000 out.
    expect(p.closing).toBe(20000);
    expect(s.totals.income).toBe(52500);

    const jan = ownerStatement(store, { ownerId: 'O1', from: '2026-01-01', to: '2026-01-31' });
    expect(jan.properties[0].managementFee).toBe(5000);
    expect(jan.properties[0].contributions).toBe(10000);
  });
});

describe('ownerStatement management fee', () => {
  it('counts rent paid from prepaid credit in the month it is applied', () => {
    const store = fakeStore({
      transactions: [
        buildPayment({ lease: L1, date: '2026-01-25', amount: 100000, allocations: [] }),
        buildCharge({ lease: L1, date: '2026-02-01', items: [{ accountId: ACC.rent, amount: 100000 }] }),
        buildApplyPrepayment({ lease: L1, date: '2026-02-01', items: [{ accountId: ACC.rent, amount: 100000 }] }),
      ],
      owners: [{ id: 'O1', managementFee: 10 }],
      properties: [{ id: 'P1', owners: [{ ownerId: 'O1', pct: 100 }] }],
    });
    const fee = (from, to) => ownerStatement(store, { ownerId: 'O1', from, to }).properties[0].managementFee;
    expect(fee('2026-01-01', '2026-01-31')).toBe(0);
    expect(fee('2026-02-01', '2026-02-28')).toBe(10000);
  });
});

describe('ownerStatement with co-owners', () => {
  it("one owner's draw comes out of that owner's cash only", () => {
    const store = fakeStore({
      transactions: [
        buildPayment({ lease: L1, date: '2026-01-03', amount: 200000, allocations: [] }),
        buildOwnerTransaction({ kind: 'distribution', ownerId: 'A', propertyId: 'P1', date: '2026-01-20', amount: 100000 }),
      ],
      owners: [{ id: 'A' }, { id: 'B' }],
      properties: [{ id: 'P1', owners: [{ ownerId: 'A', pct: 50 }, { ownerId: 'B', pct: 50 }] }],
    });
    const cash = (ownerId) => ownerStatement(store, { ownerId, from: '2026-01-01', to: '2026-01-31' }).properties[0];
    expect(cash('A')).toMatchObject({ distributions: 100000, closing: 0 });
    expect(cash('B')).toMatchObject({ distributions: 0, closing: 100000 });
  });
});

describe('budgetVsActual', () => {
  it('compares budget months in range with actuals and signs variance as favorable', () => {
    const store = fakeStore({
      transactions: ledger(),
      budgets: [{ id: 'BG', propertyId: 'P1', year: 2026, lines: [{ accountId: ACC.rent, monthly: 90000 }, { accountId: ACC.repairs, months: [0, 30000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }] }],
    });
    const r = budgetVsActual(store, { budgetId: 'BG', from: '2026-01-01', to: '2026-02-28' });
    const rent = r.rows.find((x) => x.accountId === ACC.rent);
    expect(rent).toMatchObject({ budget: 180000, actual: 200000, variance: 20000 });
    const repairs = r.rows.find((x) => x.accountId === ACC.repairs);
    expect(repairs).toMatchObject({ budget: 30000, actual: 20000, variance: 10000 });
    const late = r.rows.find((x) => x.accountId === ACC.lateFees);
    expect(late.budget).toBe(0);
    expect(r.totals.net.actual).toBe(r.totals.income.actual - r.totals.expense.actual);
    expect(budgetForMonth({ monthly: 5 }, 3)).toBe(5);
  });
});

describe('trends and cash', () => {
  it('returns one row per month, oldest first', () => {
    const rows = monthlyIncomeExpense(fakeStore({ transactions: ledger() }), { months: 3, today: '2026-02-15' });
    expect(rows.map((r) => r.month)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(rows[1].income).toBe(150000);
    expect(rows[2].expense).toBe(20000);
  });

  it('computes property cash and account balances', () => {
    const store = fakeStore({ transactions: ledger() });
    expect(propertyCash(store, 'P1')).toBe(60000);
    expect(propertyCash(store, 'P1', '2026-01-31')).toBe(110000);
    expect(accountBalance(store, ACC.operating)).toBe(110000);
  });
});

describe('reconciliation helpers', () => {
  it('lists uncleared lines and computes the cleared balance', () => {
    const txs = ledger();
    const store = fakeStore({ transactions: txs, reconciliations: [{ id: 'R1', accountId: ACC.operating, statementDate: '2026-01-31', statementBalance: 160000, cleared: ['PAY1', 'PAY2', 'C1'], status: 'reconciled' }] });
    expect(reconciledIds(store, ACC.operating).size).toBe(3);
    expect(lastReconciliation(store, ACC.operating).id).toBe('R1');
    const open = unreconciledLines(store, ACC.operating, '2026-02-28');
    expect(open.map((x) => x.tx.id)).toEqual(['BP1', 'D1']);
    expect(open[0].amount).toBe(-20000);
    expect(clearedBalance(store, ACC.operating, [])).toBe(160000);
    expect(clearedBalance(store, ACC.operating, ['BP1'])).toBe(140000);
    expect(unreconciledLines(store, ACC.operating, '2026-02-15').map((x) => x.tx.id)).toEqual(['BP1']);
  });
});
