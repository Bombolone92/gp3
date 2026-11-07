import { describe, it, expect } from 'vitest';
import {
  lastMonths,
  monthsBetween,
  revenueByMonth,
  agingByClient,
  clientLedger,
  hoursByUser,
  activityByCategory,
  mattersByArea,
  mattersByMonth,
  matterProfitability,
  trustByMatter,
  trustLedgerRows,
} from '../src/core/report-calc.js';
import { defaultSettings } from '../src/core/settings.js';
import { buildSampleData } from '../src/core/sample.js';

const bill = (id, over = {}) => ({
  id,
  number: Number(id.replace(/\D/g, '')) || 1,
  matterId: 'm1',
  clientId: 'c1',
  issueDate: '2026-09-01',
  dueDate: '2026-10-01',
  status: 'issued',
  lines: [{ kind: 'time', minutes: 60, rateCents: 10000 }],
  ...over,
});

describe('months', () => {
  it('lists the last n months ending this month', () => {
    expect(lastMonths('2026-10-12', 3)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(lastMonths('2026-02-28', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
  });
  it('covers a date range', () => {
    expect(monthsBetween('2026-01-15', '2026-03-02')).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(monthsBetween('2026-03-01', '2026-01-01')).toEqual([]);
  });
});

describe('revenueByMonth', () => {
  it('counts issued bills by issue month and payments by payment month', () => {
    const bills = [bill('b1'), bill('b2', { status: 'draft' }), bill('b3', { status: 'void' }), bill('b4', { issueDate: '2026-10-03' })];
    const payments = [
      { billId: 'b1', date: '2026-10-05', amountCents: 4000 },
      { billId: 'b1', date: '2026-07-01', amountCents: 999 },
    ];
    const rows = revenueByMonth({ bills, payments, months: ['2026-09', '2026-10'] });
    expect(rows).toEqual([
      { month: '2026-09', billed: 10000, collected: 0 },
      { month: '2026-10', billed: 10000, collected: 4000 },
    ]);
  });
});

describe('agingByClient', () => {
  it('buckets open balances per client by days past due', () => {
    const bills = [bill('b1', { dueDate: '2026-10-01' }), bill('b2', { clientId: 'c2', dueDate: '2026-06-01' }), bill('b3', { clientId: 'c2', dueDate: '2026-12-01' })];
    const payments = [{ billId: 'b1', amountCents: 2500 }];
    const rows = agingByClient({ bills, payments, today: '2026-10-12' });
    const c1 = rows.find((r) => r.clientId === 'c1');
    const c2 = rows.find((r) => r.clientId === 'c2');
    expect(c1).toMatchObject({ d30: 7500, total: 7500, bills: 1 });
    expect(c2).toMatchObject({ current: 10000, d90plus: 10000, total: 20000, bills: 2 });
    expect(rows[0].clientId).toBe('c2');
  });
  it('leaves paid bills out', () => {
    const rows = agingByClient({ bills: [bill('b1')], payments: [{ billId: 'b1', amountCents: 10000 }], today: '2026-12-01' });
    expect(rows).toEqual([]);
  });
});

describe('clientLedger', () => {
  it('runs a balance of charges and credits and carries earlier rows into the opening balance', () => {
    const bills = [bill('b1', { issueDate: '2026-08-01' }), bill('b2', { issueDate: '2026-09-15' }), bill('b3', { clientId: 'other' })];
    const payments = [
      { billId: 'b1', date: '2026-08-20', amountCents: 10000 },
      { billId: 'b2', date: '2026-09-30', amountCents: 3000 },
    ];
    const all = clientLedger({ clientId: 'c1', bills, payments });
    expect(all.rows.map((r) => r.balance)).toEqual([10000, 0, 10000, 7000]);
    expect(all.closing).toBe(7000);
    const ranged = clientLedger({ clientId: 'c1', bills, payments, from: '2026-09-01' });
    expect(ranged.opening).toBe(0);
    expect(ranged.rows).toHaveLength(2);
    expect(ranged.charges).toBe(10000);
    expect(ranged.credits).toBe(3000);
    expect(ranged.closing).toBe(7000);
  });
});

describe('hoursByUser', () => {
  const users = [
    { id: 'u1', name: 'Ann', targetHours: 100 },
    { id: 'u2', name: 'Bo', targetHours: 0 },
  ];
  const activities = [
    { kind: 'time', userId: 'u1', date: '2026-10-01', minutes: 120, rateCents: 10000, billable: true, billId: 'b1' },
    { kind: 'time', userId: 'u1', date: '2026-10-02', minutes: 60, rateCents: 10000, billable: true, billId: null },
    { kind: 'time', userId: 'u1', date: '2026-10-03', minutes: 30, rateCents: 10000, billable: false },
    { kind: 'time', userId: 'u1', date: '2026-11-03', minutes: 600, rateCents: 10000, billable: true },
    { kind: 'expense', userId: 'u1', date: '2026-10-03', qty: 1, priceCents: 500 },
  ];
  it('splits billable and non-billable time and computes realization', () => {
    const [r] = hoursByUser({ activities, users, bills: [bill('b1')], from: '2026-10-01', to: '2026-10-31' });
    expect(r).toMatchObject({ userId: 'u1', billableMinutes: 180, nonBillableMinutes: 30, totalMinutes: 210, workedValue: 30000, billedValue: 20000 });
    expect(r.realization).toBeCloseTo(2 / 3);
    expect(r.targetMinutes).toBeGreaterThan(5900);
    expect(r.targetMinutes).toBeLessThan(6200);
  });
  it('prorates targets over the recorded time when the range has no start', () => {
    const list = [
      { kind: 'time', userId: 'u1', date: '2026-01-01', minutes: 600, rateCents: 10000 },
      { kind: 'time', userId: 'u1', date: '2026-10-01', minutes: 600, rateCents: 10000 },
    ];
    const [r] = hoursByUser({ activities: list, users, bills: [], from: '', to: '', today: '2026-10-31' });
    // January through October is ten months of target, not one.
    expect(r.targetMinutes).toBeGreaterThan(100 * 60 * 9.9);
    expect(r.targetMinutes).toBeLessThan(100 * 60 * 10.1);
  });
  it('never sets a negative target when the only time recorded is dated after today', () => {
    const list = [{ kind: 'time', userId: 'u1', date: '2026-10-20', minutes: 60, rateCents: 10000 }];
    const [r] = hoursByUser({ activities: list, users, bills: [], from: '', to: '', today: '2026-10-12' });
    expect(r.targetMinutes).toBe(0);
    const [s] = hoursByUser({ activities: list, users, bills: [], from: '2026-10-20', to: '', today: '2026-10-12' });
    expect(s.targetMinutes).toBe(0);
  });
  it('does not hold deactivated users to a target', () => {
    const rows = hoursByUser({ activities, users: [...users, { id: 'u3', name: 'Gone', targetHours: 150, active: false }], bills: [], from: '2026-10-01', to: '2026-10-31' });
    expect(rows.map((r) => r.userId)).toEqual(['u1']);
  });
  it('ignores draft bills for realization and drops idle users without targets', () => {
    const rows = hoursByUser({ activities, users, bills: [bill('b1', { status: 'draft' })], from: '2026-10-01', to: '2026-10-31' });
    expect(rows).toHaveLength(1);
    expect(rows[0].billedValue).toBe(0);
  });
});

describe('activityByCategory', () => {
  it('groups time and expenses by category', () => {
    const s = defaultSettings();
    const rows = activityByCategory({
      settings: s,
      from: '',
      to: '',
      activities: [
        { kind: 'time', date: '2026-10-01', categoryId: 'ac-draft', minutes: 60, rateCents: 10000 },
        { kind: 'time', date: '2026-10-02', categoryId: 'ac-draft', minutes: 30, rateCents: 10000, billable: false },
        { kind: 'expense', date: '2026-10-02', categoryId: 'ac-filing', qty: 1, priceCents: 43500 },
      ],
    });
    expect(rows[0]).toMatchObject({ name: 'Filing fee', kind: 'expense', amount: 43500 });
    expect(rows[1]).toMatchObject({ name: 'Drafting', minutes: 90, count: 2, amount: 15000, billableAmount: 10000 });
  });
});

describe('matter reports', () => {
  const s = defaultSettings();
  const matters = [
    { id: 'm1', status: 'open', practiceAreaId: 'pa-lit', stageId: 'st-intake', openDate: '2026-09-02' },
    { id: 'm2', status: 'closed', practiceAreaId: 'pa-lit', stageId: 'st-closing', openDate: '2026-08-02', closedDate: '2026-10-01' },
    { id: 'm3', status: 'pending', practiceAreaId: '', openDate: '2026-10-05' },
  ];
  it('counts matters by area, status, and stage', () => {
    const rows = mattersByArea({ matters, settings: s });
    const lit = rows.find((r) => r.practiceAreaId === 'pa-lit');
    expect(lit).toMatchObject({ name: 'Litigation', open: 1, closed: 1, total: 2 });
    expect(lit.stageList.find((x) => x.id === 'st-intake').count).toBe(1);
    expect(lit.stageList.find((x) => x.id === 'st-closing').count).toBe(0);
    const none = rows.find((r) => r.practiceAreaId === '');
    expect(none).toMatchObject({ name: 'No practice area', pending: 1 });
    expect(none.stageList.at(-1)).toMatchObject({ name: 'No stage', count: 1 });
  });
  it('counts opened and closed per month', () => {
    expect(mattersByMonth({ matters, months: ['2026-09', '2026-10'] })).toEqual([
      { month: '2026-09', opened: 1, closed: 0 },
      { month: '2026-10', opened: 1, closed: 1 },
    ]);
  });
  it('computes worked, billed, collected, and work in progress per matter', () => {
    const rows = matterProfitability({
      matters,
      activities: [
        { matterId: 'm1', kind: 'time', date: '2026-09-03', minutes: 60, rateCents: 20000, billId: 'b1' },
        { matterId: 'm1', kind: 'time', date: '2026-09-04', minutes: 30, rateCents: 20000 },
        { matterId: 'm1', kind: 'time', date: '2026-09-04', minutes: 30, rateCents: 20000, billable: false },
      ],
      bills: [bill('b1', { lines: [{ kind: 'time', minutes: 60, rateCents: 20000 }] })],
      payments: [{ matterId: 'm1', date: '2026-09-20', amountCents: 5000 }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ matterId: 'm1', worked: 30000, workedMinutes: 90, billed: 20000, collected: 5000, wip: 10000 });
    expect(rows[0].collectionRate).toBeCloseTo(0.25);
  });
});

describe('trust reports', () => {
  const accounts = [
    { id: 't', type: 'trust' },
    { id: 'o', type: 'operating' },
  ];
  const matters = [
    { id: 'm1', clientId: 'c1', trustMinimumCents: 50000 },
    { id: 'm2', clientId: 'c2' },
    { id: 'm3', clientId: 'c3' },
  ];
  const transactions = [
    { id: '1', accountId: 't', matterId: 'm1', type: 'deposit', date: '2026-08-01', amountCents: 100000 },
    { id: '2', accountId: 't', matterId: 'm1', type: 'withdrawal', date: '2026-09-01', amountCents: 70000 },
    { id: '3', accountId: 't', matterId: 'm2', type: 'deposit', date: '2026-09-15', amountCents: 20000 },
    { id: '4', accountId: 'o', matterId: 'm3', type: 'deposit', date: '2026-09-15', amountCents: 99999 },
  ];
  it('lists balances per matter and flags low ones', () => {
    const rows = trustByMatter({ matters, transactions, accounts });
    expect(rows.map((r) => [r.matterId, r.balance, r.low])).toEqual([
      ['m1', 30000, true],
      ['m2', 20000, false],
    ]);
  });
  it('builds a ledger with an opening balance for the range', () => {
    const r = trustLedgerRows({ transactions, accounts, from: '2026-09-01' });
    expect(r.opening).toBe(100000);
    expect(r.rows.map((x) => x.balance)).toEqual([30000, 50000]);
    expect(r).toMatchObject({ deposits: 20000, withdrawals: 70000, closing: 50000 });
  });
});

describe('sample firm', () => {
  it('produces sensible numbers across reports', () => {
    const today = '2026-10-12';
    const { collections: c, settings } = buildSampleData(today);
    const rev = revenueByMonth({ bills: c.bills, payments: c.payments, months: lastMonths(today, 12) });
    expect(rev.reduce((s, r) => s + r.billed, 0)).toBeGreaterThan(0);
    const hours = hoursByUser({ activities: c.activities, users: c.users, bills: c.bills, from: '2026-10-01', to: '2026-10-31' });
    expect(hours.length).toBeGreaterThan(2);
    for (const r of trustByMatter({ matters: c.matters, transactions: c.transactions, accounts: c.accounts })) expect(r.balance).toBeGreaterThanOrEqual(0);
    expect(mattersByArea({ matters: c.matters, settings }).reduce((s, r) => s + r.total, 0)).toBe(c.matters.length);
  });
});

describe('utilization targets to date', () => {
  it('prorates the target only up to today within the range', async () => {
    const { hoursByUser } = await import('../src/core/report-calc.js');
    const users = [{ id: 'u', name: 'U', targetHours: 100 }];
    const full = hoursByUser({ activities: [], users, bills: [], from: '2026-10-01', to: '2026-10-31' })[0].targetMinutes;
    const toDate = hoursByUser({ activities: [], users, bills: [], from: '2026-10-01', to: '2026-10-31', today: '2026-10-10' })[0].targetMinutes;
    expect(toDate).toBeLessThan(full / 2);
    expect(toDate).toBeGreaterThan(0);
  });
});
