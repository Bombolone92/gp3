import { describe, it, expect } from 'vitest';
import {
  filterActivities,
  activityTotals,
  activityBillingState,
  shiftRange,
  billTab,
  billActivityIds,
  nextApprovalStatus,
  outstandingByClient,
  openBillsForClient,
  billableMatters,
  reconcileTrust,
} from '../src/core/billing-ops.js';

const acts = [
  { id: 'a1', kind: 'time', date: '2026-10-01', userId: 'u1', matterId: 'm1', minutes: 60, rateCents: 30000, billable: true, description: 'Drafted motion' },
  { id: 'a2', kind: 'time', date: '2026-10-05', userId: 'u2', matterId: 'm1', minutes: 30, rateCents: 20000, billable: false, description: 'Internal review' },
  { id: 'a3', kind: 'expense', date: '2026-10-07', userId: 'u1', matterId: 'm2', qty: 2, priceCents: 1500, billable: true, description: 'Courier' },
  { id: 'a4', kind: 'time', date: '2026-09-20', userId: 'u1', matterId: 'm2', minutes: 90, rateCents: 20000, billable: true, billId: 'b1', description: 'Call with client' },
];

describe('activities', () => {
  it('derives billing state', () => {
    expect(acts.map(activityBillingState)).toEqual(['unbilled', 'nonbillable', 'unbilled', 'billed']);
  });

  it('filters by kind, range, user, matter, billing state, and text', () => {
    expect(filterActivities(acts, { kind: 'time' }).map((a) => a.id)).toEqual(['a1', 'a2', 'a4']);
    expect(filterActivities(acts, { from: '2026-10-01', to: '2026-10-05' }).map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(filterActivities(acts, { userId: 'u1', billed: 'unbilled' }).map((a) => a.id)).toEqual(['a1', 'a3']);
    expect(filterActivities(acts, { matterId: 'm2' }).map((a) => a.id)).toEqual(['a3', 'a4']);
    expect(filterActivities(acts, { q: 'MOTION draft' }).map((a) => a.id)).toEqual(['a1']);
  });

  it('totals billable and non-billable hours and amounts', () => {
    const t = activityTotals(acts);
    expect(t.count).toBe(4);
    expect(t.billableMinutes).toBe(150);
    expect(t.nonBillableMinutes).toBe(30);
    expect(t.billableAmount).toBe(30000 + 3000 + 30000);
    expect(t.amount).toBe(t.billableAmount + 10000);
  });
});

describe('shiftRange', () => {
  it('moves whole months by a month, keeping month ends right', () => {
    expect(shiftRange('2026-10-01', '2026-10-31', -1)).toEqual(['2026-09-01', '2026-09-30']);
    expect(shiftRange('2026-01-01', '2026-01-31', 1)).toEqual(['2026-02-01', '2026-02-28']);
  });

  it('moves quarters and years by whole quarters and years', () => {
    expect(shiftRange('2026-04-01', '2026-06-30', 1)).toEqual(['2026-07-01', '2026-09-30']);
    expect(shiftRange('2026-10-01', '2026-12-31', 1)).toEqual(['2027-01-01', '2027-03-31']);
    expect(shiftRange('2027-01-01', '2027-12-31', 1)).toEqual(['2028-01-01', '2028-12-31']);
    expect(shiftRange('2024-01-01', '2024-12-31', -1)).toEqual(['2023-01-01', '2023-12-31']);
  });

  it('moves other ranges by their length', () => {
    expect(shiftRange('2026-10-11', '2026-10-17', 1)).toEqual(['2026-10-18', '2026-10-24']);
    expect(shiftRange('2026-10-12', '2026-10-12', -1)).toEqual(['2026-10-11', '2026-10-11']);
    expect(shiftRange('', '2026-10-12', 1)).toBeNull();
  });
});

describe('bills', () => {
  it('groups statuses into tabs', () => {
    expect(billTab('unpaid').match('overdue')).toBe(true);
    expect(billTab('unpaid').match('partial')).toBe(true);
    expect(billTab('unpaid').match('paid')).toBe(false);
    expect(billTab('nonsense').id).toBe('unpaid');
  });

  it('lists the activities a bill covers and steps approval', () => {
    expect(billActivityIds({ lines: [{ activityId: 'a1' }, { activityId: null }, { activityId: 'a1' }, { activityId: 'a2' }] })).toEqual(['a1', 'a2']);
    expect(nextApprovalStatus('draft')).toBe('pending');
    expect(nextApprovalStatus('pending')).toBe('issued');
    expect(nextApprovalStatus('issued')).toBe('issued');
  });
});

describe('outstandingByClient', () => {
  const matters = [
    { id: 'm1', clientId: 'c1' },
    { id: 'm2', clientId: 'c1' },
    { id: 'm3', clientId: 'c2' },
    { id: 'm4', clientId: 'c3' },
  ];
  const bills = [
    { id: 'b1', number: 1, matterId: 'm1', clientId: 'c1', status: 'issued', dueDate: '2026-08-01', issueDate: '2026-07-01', lines: [{ kind: 'flat', amountCents: 50000 }] },
    { id: 'b2', number: 2, matterId: 'm3', clientId: 'c2', status: 'issued', dueDate: '2026-11-01', issueDate: '2026-10-01', lines: [{ kind: 'flat', amountCents: 20000 }] },
    { id: 'b3', number: 3, matterId: 'm3', clientId: 'c2', status: 'draft', dueDate: '2026-11-01', issueDate: '2026-10-01', lines: [{ kind: 'flat', amountCents: 99900 }] },
  ];
  const payments = [{ id: 'p1', billId: 'b1', contactId: 'c1', matterId: 'm1', amountCents: 10000, date: '2026-09-01' }];
  const activities = [{ id: 'a', kind: 'time', matterId: 'm2', minutes: 60, rateCents: 10000, billable: true }];
  const accounts = [{ id: 't', type: 'trust' }];
  const transactions = [
    { accountId: 't', matterId: 'm3', type: 'deposit', amountCents: 70000 },
    { accountId: 't', matterId: 'm3', type: 'withdrawal', amountCents: 5000 },
  ];

  it('rolls bills, work in progress, aging, and trust up per client', () => {
    const rows = outstandingByClient({ matters, bills, payments, activities, transactions, accounts, today: '2026-10-12' });
    expect(rows.map((r) => r.clientId)).toEqual(['c1', 'c2']);
    const c1 = rows[0];
    expect(c1.matters).toBe(2);
    expect(c1.outstanding).toBe(40000);
    expect(c1.aging.d90).toBe(40000);
    expect(c1.wip).toBe(10000);
    expect(c1.lastPayment).toBe('2026-09-01');
    const c2 = rows[1];
    expect(c2.outstanding).toBe(20000);
    expect(c2.aging.current).toBe(20000);
    expect(c2.trust).toBe(65000);
  });

  it('lists a client’s open bills for a statement', () => {
    const open = openBillsForClient('c1', bills, payments, '2026-10-12');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ total: 50000, paid: 10000, balance: 40000, status: 'overdue' });
  });
});

describe('billableMatters', () => {
  it('finds matters with unbilled work in the period and unbilled flat fees', () => {
    const matters = [
      { id: 'm1', billing: { method: 'hourly' } },
      { id: 'm2', billing: { method: 'flat', flatFeeCents: 100000 } },
      { id: 'm3', billing: { method: 'flat', flatFeeCents: 100000, flatFeeBilled: true } },
    ];
    const rows = billableMatters({ matters, activities: acts, to: '2026-10-06' });
    const m1 = rows.find((r) => r.matter.id === 'm1');
    expect(m1).toMatchObject({ minutes: 60, time: 30000, expenses: 0, total: 30000, activityIds: ['a1'] });
    const m2 = rows.find((r) => r.matter.id === 'm2');
    expect(m2).toMatchObject({ flat: 100000, total: 100000, activityIds: [] });
    expect(rows.some((r) => r.matter.id === 'm3')).toBe(false);
  });
});

describe('reconcileTrust', () => {
  const account = { id: 't', type: 'trust', openingBalanceCents: 0 };
  const tx = [
    { accountId: 't', matterId: 'm1', type: 'deposit', amountCents: 50000 },
    { accountId: 't', matterId: 'm2', type: 'deposit', amountCents: 20000 },
    { accountId: 't', matterId: 'm1', type: 'withdrawal', amountCents: 10000 },
    { accountId: 'other', matterId: 'm1', type: 'deposit', amountCents: 999 },
  ];

  it('agrees when the statement matches the ledger and client ledgers', () => {
    const r = reconcileTrust({ account, transactions: tx, statementCents: 60000 });
    expect(r).toMatchObject({ book: 60000, clients: 60000, bank: 60000, bankDiff: 0, clientsDiff: 0, balanced: true, unassigned: 0 });
  });

  it('flags a bank difference, unassigned funds, and negative matters', () => {
    const r = reconcileTrust({
      account,
      transactions: [...tx, { accountId: 't', matterId: null, type: 'deposit', amountCents: 500 }, { accountId: 't', matterId: 'm3', type: 'withdrawal', amountCents: 100 }],
      statementCents: 59000,
    });
    expect(r.book).toBe(60400);
    expect(r.unassigned).toBe(500);
    expect(r.clientsDiff).toBe(500);
    expect(r.bankDiff).toBe(59000 - 60400);
    expect(r.negative).toEqual([{ matterId: 'm3', balance: -100 }]);
    expect(r.balanced).toBe(false);
  });

  it('does not count an opening balance as client funds', () => {
    const r = reconcileTrust({ account: { ...account, openingBalanceCents: 7000 }, transactions: tx, statementCents: 67000 });
    expect(r.book).toBe(67000);
    expect(r.clients).toBe(60000);
    expect(r.unassigned).toBe(7000);
    expect(r.clientsDiff).toBe(7000);
    expect(r.balanced).toBe(false);
  });

  it('treats a missing statement as unknown', () => {
    const r = reconcileTrust({ account, transactions: tx });
    expect(r.bank).toBeNull();
    expect(r.balanced).toBe(true);
  });
});
