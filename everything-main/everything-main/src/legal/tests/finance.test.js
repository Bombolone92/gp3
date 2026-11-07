import { describe, it, expect } from 'vitest';
import {
  activityAmount,
  isUnbilled,
  rateFor,
  sumActivities,
  lineFromActivity,
  billTotals,
  billBalance,
  billStatus,
  draftBill,
  agingBuckets,
  accountBalance,
  trustBalance,
  ledger,
  checkTrustWithdrawal,
  matterFinancials,
} from '../src/core/finance.js';
import { defaultSettings } from '../src/core/settings.js';

const settings = defaultSettings();
const time = (o) => ({ id: o.id || 'a', kind: 'time', date: '2026-10-01', minutes: 60, rateCents: 30000, billable: true, matterId: 'm1', ...o });
const expense = (o) => ({ id: o.id || 'e', kind: 'expense', date: '2026-10-02', qty: 1, priceCents: 5000, billable: true, matterId: 'm1', ...o });

describe('activities', () => {
  it('computes amounts per kind', () => {
    expect(activityAmount(time({ minutes: 90 }))).toBe(45000);
    expect(activityAmount(expense({ qty: 3, priceCents: 1250 }))).toBe(3750);
    expect(activityAmount({ kind: 'flat', amountCents: 150000 })).toBe(150000);
    expect(activityAmount(null)).toBe(0);
  });

  it('knows what is unbilled', () => {
    expect(isUnbilled(time({}))).toBe(true);
    expect(isUnbilled(time({ billId: 'b1' }))).toBe(false);
    expect(isUnbilled(time({ billable: false }))).toBe(false);
  });

  it('picks the matter rate, then the user rate, then the firm default', () => {
    expect(rateFor({ matter: { billing: { method: 'hourly', rateCents: 50000 } }, user: { rateCents: 30000 }, settings })).toBe(50000);
    expect(rateFor({ matter: { billing: { method: 'flat', rateCents: 50000 } }, user: { rateCents: 30000 }, settings })).toBe(30000);
    expect(rateFor({ matter: null, user: null, settings })).toBe(settings.billing.defaultRateCents);
  });

  it('uses the client’s own rate when neither the matter nor the user sets one', () => {
    const client = { rateCents: 18000 };
    expect(rateFor({ matter: { billing: { method: 'flat' } }, user: { rateCents: 0 }, client, settings })).toBe(18000);
    expect(rateFor({ matter: null, user: { rateCents: 30000 }, client, settings })).toBe(30000);
    expect(rateFor({ matter: { billing: { method: 'hourly', rateCents: 50000 } }, user: null, client, settings })).toBe(50000);
    expect(rateFor({ matter: null, user: null, client: { rateCents: null }, settings })).toBe(settings.billing.defaultRateCents);
  });

  it('sums billable and non-billable work separately', () => {
    const t = sumActivities([time({ minutes: 60 }), time({ minutes: 30, billable: false }), expense({})]);
    expect(t.minutes).toBe(90);
    expect(t.billableMinutes).toBe(60);
    expect(t.amount).toBe(30000 + 15000 + 5000);
    expect(t.billableAmount).toBe(35000);
  });
});

describe('bills', () => {
  const bill = (o = {}) => ({
    id: 'b1',
    matterId: 'm1',
    status: 'issued',
    dueDate: '2026-10-31',
    lines: [lineFromActivity(time({ minutes: 120 })), lineFromActivity(expense({ priceCents: 10000 }))],
    discount: { type: 'percent', value: 0 },
    taxRate: 0,
    ...o,
  });

  it('snapshots activities into lines', () => {
    const l = lineFromActivity(time({ id: 'x', minutes: 30, description: 'Call' }));
    expect(l).toMatchObject({ activityId: 'x', kind: 'time', minutes: 30, rateCents: 30000, amountCents: 15000, description: 'Call' });
  });

  it('applies discounts to fees only and taxes fees', () => {
    const t = billTotals(bill({ discount: { type: 'percent', value: 10 }, taxRate: 5 }));
    expect(t.fees).toBe(60000);
    expect(t.expenses).toBe(10000);
    expect(t.discount).toBe(6000);
    expect(t.tax).toBe(2700); // 5% of 54,000
    expect(t.total).toBe(60000 + 10000 - 6000 + 2700);
  });

  it('can tax expenses and caps a fixed discount at the fees', () => {
    expect(billTotals(bill({ taxRate: 10, taxExpenses: true })).tax).toBe(7000);
    expect(billTotals(bill({ discount: { type: 'amount', value: 999999 } })).discount).toBe(60000);
  });

  it('never turns a discount into a charge when credits exceed the fees', () => {
    const credit = { lines: [{ kind: 'expense', qty: 1, priceCents: 20000 }, { kind: 'adjustment', amountCents: -5000 }] };
    expect(billTotals({ ...credit, discount: { type: 'amount', value: 1000 } }).total).toBe(15000);
    expect(billTotals({ ...credit, discount: { type: 'percent', value: 10 } }).total).toBe(15000);
  });

  it('derives status from payments and the due date', () => {
    const b = bill();
    const total = billTotals(b).total;
    expect(billStatus(b, [], '2026-10-15')).toBe('unpaid');
    expect(billStatus(b, [], '2026-11-01')).toBe('overdue');
    expect(billStatus(b, [{ billId: 'b1', amountCents: 100 }], '2026-10-15')).toBe('partial');
    expect(billStatus(b, [{ billId: 'b1', amountCents: total }], '2026-11-01')).toBe('paid');
    expect(billStatus({ ...b, status: 'draft' }, [], '2026-11-01')).toBe('draft');
    expect(billStatus({ ...b, status: 'void' }, [], '2026-11-01')).toBe('void');
  });

  it('owes nothing on drafts, pending, and void bills', () => {
    expect(billBalance(bill({ status: 'draft' }), [])).toBe(0);
    expect(billBalance(bill({ status: 'void' }), [])).toBe(0);
    expect(billBalance(bill(), [{ billId: 'b1', amountCents: 20000 }])).toBe(70000 - 20000);
  });

  it('drafts a bill from unbilled work in the period, oldest first', () => {
    const acts = [
      time({ id: 'a2', date: '2026-10-05' }),
      time({ id: 'a1', date: '2026-09-01' }),
      time({ id: 'a3', date: '2026-10-20' }),
      time({ id: 'a4', billId: 'old' }),
      time({ id: 'a5', matterId: 'other' }),
    ];
    const out = draftBill({ matter: { id: 'm1', clientId: 'c1', billing: { method: 'hourly' } }, activities: acts, settings, number: 7, issueDate: '2026-10-25', to: '2026-10-10' });
    expect(out.activityIds).toEqual(['a1', 'a2']);
    expect(out.bill).toMatchObject({ number: 7, status: 'draft', clientId: 'c1', dueDate: '2026-11-24', periodFrom: '2026-09-01', periodTo: '2026-10-10' });
    expect(out.bill.lines).toHaveLength(2);
  });

  it('adds the agreed flat fee once', () => {
    const matter = { id: 'm1', description: 'Will', billing: { method: 'flat', flatFeeCents: 120000 } };
    const out = draftBill({ matter, activities: [], settings, number: 1, issueDate: '2026-10-01' });
    expect(out.bill.lines[0]).toMatchObject({ kind: 'flat', amountCents: 120000 });
    expect(draftBill({ matter: { ...matter, billing: { ...matter.billing, flatFeeBilled: true } }, activities: [], settings, number: 2, issueDate: '2026-10-01' })).toBeNull();
  });

  it('ages open balances by days past due', () => {
    const mk = (id, dueDate, cents) => ({ id, status: 'issued', dueDate, lines: [{ kind: 'flat', amountCents: cents }] });
    const a = agingBuckets(
      [mk('1', '2026-10-20', 100), mk('2', '2026-10-01', 200), mk('3', '2026-08-20', 300), mk('4', '2026-07-01', 400), mk('5', '2026-09-01', 500)],
      [{ billId: '5', amountCents: 500 }],
      '2026-10-15',
    );
    expect(a).toEqual({ current: 100, d30: 200, d60: 300, d90: 0, d90plus: 400 });
  });
});

describe('accounts and trust', () => {
  const accounts = [
    { id: 'op', type: 'operating', openingBalanceCents: 1000 },
    { id: 'tr', type: 'trust', openingBalanceCents: 0 },
  ];
  const tx = [
    { id: 't1', accountId: 'tr', type: 'deposit', amountCents: 50000, matterId: 'm1', date: '2026-09-01' },
    { id: 't2', accountId: 'tr', type: 'withdrawal', amountCents: 20000, matterId: 'm1', date: '2026-09-15' },
    { id: 't3', accountId: 'tr', type: 'deposit', amountCents: 9000, matterId: 'm2', date: '2026-09-10' },
    { id: 't4', accountId: 'op', type: 'deposit', amountCents: 20000, matterId: 'm1', date: '2026-09-15' },
  ];

  it('computes balances from transactions', () => {
    expect(accountBalance(accounts[0], tx)).toBe(21000);
    expect(accountBalance(accounts[1], tx)).toBe(39000);
    expect(trustBalance('m1', tx, accounts)).toBe(30000);
    expect(trustBalance('m2', tx, accounts)).toBe(9000);
  });

  it('builds a running ledger in date order', () => {
    const rows = ledger(tx, { accountId: 'tr' });
    expect(rows.map((r) => r.id)).toEqual(['t1', 't3', 't2']);
    expect(rows.map((r) => r.balance)).toEqual([50000, 59000, 39000]);
  });

  it('never lets a matter overdraw its trust funds', () => {
    expect(checkTrustWithdrawal({ matterId: 'm1', accountId: 'tr', amountCents: 30000, transactions: tx }).ok).toBe(true);
    const over = checkTrustWithdrawal({ matterId: 'm1', accountId: 'tr', amountCents: 30001, transactions: tx });
    expect(over.ok).toBe(false);
    expect(over.available).toBe(30000);
    // Another matter's money is not available.
    expect(checkTrustWithdrawal({ matterId: 'm2', accountId: 'tr', amountCents: 10000, transactions: tx }).ok).toBe(false);
    expect(checkTrustWithdrawal({ matterId: '', accountId: 'tr', amountCents: 1, transactions: tx }).ok).toBe(false);
    expect(checkTrustWithdrawal({ matterId: 'm1', accountId: 'tr', amountCents: 0, transactions: tx }).ok).toBe(false);
  });

  it('summarizes a matter', () => {
    const matter = { id: 'm1', trustMinimumCents: 50000, billing: { budgetCents: 100000 } };
    const activities = [time({ minutes: 60 }), time({ id: 'b', minutes: 60, billId: 'b1' }), time({ id: 'c', minutes: 30, billable: false })];
    const bills = [{ id: 'b1', matterId: 'm1', status: 'issued', lines: [{ kind: 'flat', amountCents: 30000 }] }];
    const payments = [{ billId: 'b1', matterId: 'm1', amountCents: 10000 }];
    const f = matterFinancials(matter, { activities, bills, payments, transactions: tx, accounts });
    expect(f).toMatchObject({ wip: 30000, wipMinutes: 60, workedMinutes: 150, billed: 30000, outstanding: 20000, paid: 10000, trust: 30000, trustLow: true, budgetUsedPct: 60 });
  });
});
