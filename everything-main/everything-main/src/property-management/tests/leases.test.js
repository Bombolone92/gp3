import { describe, it, expect } from 'vitest';
import { ACC } from '../src/core/accounts.js';
import { defaultSettings } from '../src/core/settings.js';
import { computeIndex, buildPayment, buildCharge } from '../src/core/ledger.js';
import { leaseStatus, daysLeft, isExpiring, dueDates, computePostings, postDue, defaultPostingStart, occupancy, monthlyRent } from '../src/core/leases.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

const settings = defaultSettings();
const rent = (extra = {}) => ({ id: 'r', accountId: ACC.rent, amount: 100000, day: 1, start: '2026-01-01', postedThrough: null, ...extra });
const mkLease = (extra = {}) => ({ id: 'L1', propertyId: 'P1', unitId: 'U1', type: 'fixed-rollover', start: '2026-01-01', end: '2026-12-31', recurring: [rent()], lateFee: { enabled: false }, ...extra });

describe('lease status', () => {
  it('derives draft, future, active and past', () => {
    expect(leaseStatus(mkLease({ draft: true }), '2026-05-01')).toBe('draft');
    expect(leaseStatus(mkLease(), '2025-12-31')).toBe('future');
    expect(leaseStatus(mkLease(), '2026-05-01')).toBe('active');
    expect(leaseStatus(mkLease(), '2027-03-01')).toBe('active'); // rolls over
    expect(leaseStatus(mkLease({ type: 'fixed' }), '2027-03-01')).toBe('past');
    expect(leaseStatus(mkLease({ moveOut: { date: '2026-06-30' } }), '2026-07-01')).toBe('past');
  });

  it('counts days left on the term and flags expiring leases', () => {
    expect(daysLeft(mkLease(), '2026-12-01')).toBe(30);
    expect(daysLeft(mkLease({ type: 'at-will' }), '2026-12-01')).toBe(null);
    expect(isExpiring(mkLease(), '2026-12-01', 60)).toBe(true);
    expect(isExpiring(mkLease(), '2026-06-01', 60)).toBe(false);
  });

  it('builds an occupancy map of active leases', () => {
    const occ = occupancy([mkLease(), mkLease({ id: 'L2', unitId: 'U2', start: '2027-01-01' })], '2026-05-01');
    expect([...occ.keys()]).toEqual(['U1']);
  });
});

describe('monthlyRent', () => {
  const lease = {
    recurring: [
      { id: 'a', accountId: ACC.rent, amount: 100000, start: '2026-01-01', end: '2026-10-31' },
      { id: 'b', accountId: ACC.rent, amount: 110000, start: '2026-11-01' },
      { id: 'p', accountId: 'acc-parking', amount: 5000, start: '2026-01-01' },
    ],
  };
  it('counts a scheduled change only from its start', () => {
    expect(monthlyRent(lease, '2026-10-12')).toBe(100000);
    expect(monthlyRent(lease, '2026-10-31')).toBe(100000);
    expect(monthlyRent(lease, '2026-11-01')).toBe(110000);
  });
  it('uses the first rent to come before rent starts, and the last after it stops', () => {
    expect(monthlyRent(lease, '2025-12-01')).toBe(100000);
    const ended = { recurring: [{ ...lease.recurring[0] }, { ...lease.recurring[1], end: '2027-01-31' }] };
    expect(monthlyRent(ended, '2027-06-01')).toBe(110000);
    expect(monthlyRent({ recurring: [] }, '2026-10-12')).toBe(0);
  });
});

describe('dueDates', () => {
  it('clamps the due day to short months', () => {
    expect(dueDates({ day: 31, start: '2026-01-01' }, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('starts after the last posted date and respects the item end', () => {
    expect(dueDates({ day: 1, start: '2026-01-01', end: '2026-03-15' }, '2026-01-01', '2026-12-31')).toEqual(['2026-02-01', '2026-03-01']);
  });

  it('includes the start date itself when nothing was posted yet', () => {
    expect(dueDates({ day: 1, start: '2026-01-01' }, '2025-12-31', '2026-01-31')).toEqual(['2026-01-01']);
  });
});

describe('posting recurring charges', () => {
  it('posts every due month once, with ids that make reposting harmless', () => {
    const lease = mkLease();
    const out = computePostings({ leases: [lease], index: computeIndex([]), settings, today: '2026-03-15' });
    const charges = out.transactions.filter((t) => t.kind === 'charge');
    expect(charges.map((t) => t.date)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
    expect(charges[0].id).toBe('rc-L1-r-2026-01-01');
    expect(out.leasePatches.get('L1').recurring[0].postedThrough).toBe('2026-03-01');

    const again = computePostings({ leases: [{ ...lease, ...out.leasePatches.get('L1') }], index: computeIndex(charges), settings, today: '2026-03-15' });
    expect(again.transactions).toEqual([]);
  });

  it('changing the due day never charges a month twice', () => {
    const lease = mkLease({ recurring: [rent({ postedThrough: '2026-10-01', day: 15 })] });
    const out = computePostings({ leases: [lease], index: computeIndex([]), settings, today: '2026-11-20' });
    expect(out.transactions.filter((t) => t.kind === 'charge').map((t) => t.date)).toEqual(['2026-11-15']);
  });

  it('stops at the end of a fixed lease or a move-out', () => {
    const out = computePostings({ leases: [mkLease({ moveOut: { date: '2026-02-15' } })], index: computeIndex([]), settings, today: '2026-06-01' });
    expect(out.transactions.map((t) => t.date)).toEqual(['2026-01-01', '2026-02-01']);
  });

  it('skips drafts', () => {
    expect(computePostings({ leases: [mkLease({ draft: true })], index: computeIndex([]), settings, today: '2026-06-01' }).transactions).toEqual([]);
  });

  it('applies prepaid rent to new charges', () => {
    const lease = mkLease({ recurring: [rent({ postedThrough: '2026-01-01' })] });
    const prepay = buildPayment({ lease, date: '2026-01-20', amount: 60000, allocations: [] });
    const out = computePostings({ leases: [lease], index: computeIndex([prepay]), settings, today: '2026-02-01' });
    const apply = out.transactions.find((t) => t.kind === 'apply-prepayment');
    expect(apply.lines[0]).toMatchObject({ accountId: ACC.prepaid, amount: 60000 });
    const ix = computeIndex([prepay, ...out.transactions]);
    expect(ix.lease('L1').balance).toBe(40000);
  });

  it('posts a late fee once when rent is unpaid after the grace period', () => {
    const lease = mkLease({ lateFee: { enabled: true, graceDays: 5, kind: 'flat', amount: 5000, minBalance: 1 }, recurring: [rent({ postedThrough: '2025-12-31' })] });
    const first = computePostings({ leases: [lease], index: computeIndex([]), settings, today: '2026-01-07' });
    const fees = first.transactions.filter((t) => t.id.startsWith('lf-'));
    expect(fees).toHaveLength(1);
    expect(fees[0].date).toBe('2026-01-07');
    expect(first.leasePatches.get('L1').lateFeesThrough).toBe('2026-01');
  });

  it('does not charge a late fee when rent was paid within the grace period', () => {
    const lease = mkLease({ lateFee: { enabled: true, graceDays: 5, kind: 'flat', amount: 5000, minBalance: 1 }, recurring: [rent({ postedThrough: '2026-01-01' })] });
    const charges = computePostings({ leases: [mkLease({ recurring: [rent()] })], index: computeIndex([]), settings, today: '2026-01-01' }).transactions;
    const pay = buildPayment({ lease, date: '2026-01-04', amount: 100000, allocations: [{ accountId: ACC.rent, amount: 100000 }] });
    const out = computePostings({ leases: [lease], index: computeIndex([...charges, pay]), settings, today: '2026-01-20' });
    expect(out.transactions.filter((t) => t.id.startsWith('lf-'))).toEqual([]);
    expect(out.leasePatches.get('L1').lateFeesThrough).toBe('2026-01');
  });

  it('keeps charging late fees after a rent change, on the new rent', () => {
    const lateFee = { enabled: true, graceDays: 5, kind: 'percent', percent: 10, minBalance: 1 };
    const lease = mkLease({
      lateFee,
      lateFeesThrough: '2026-06',
      recurring: [rent({ end: '2026-06-30', postedThrough: '2026-06-01' }), rent({ id: 'r2', amount: 110000, start: '2026-07-01' })],
    });
    const out = computePostings({ leases: [lease], index: computeIndex([]), settings, today: '2026-08-20' });
    const fees = out.transactions.filter((t) => t.id.startsWith('lf-'));
    expect(fees.map((t) => t.id)).toEqual(['lf-L1-2026-07', 'lf-L1-2026-08']);
    expect(fees[0].lines[0].amount).toBe(11000);
    expect(out.leasePatches.get('L1').lateFeesThrough).toBe('2026-08');
  });

  it('does not count rent that is already posted twice when the lease record is behind', async () => {
    const lateFee = { enabled: true, graceDays: 5, kind: 'flat', amount: 5000, minBalance: 1 };
    const posted = mkLease({ lateFee, recurring: [rent()] });
    const charges = computePostings({ leases: [posted], index: computeIndex([]), settings, today: '2026-01-01' }).transactions;
    const pay = buildPayment({ lease: posted, date: '2026-01-02', amount: 100000, allocations: [{ accountId: ACC.rent, amount: 100000 }] });
    // The lease still says nothing was posted (saved from a copy opened earlier).
    const store = createStore({ backend: createMemoryBackend({ collections: { leases: [posted], transactions: [...charges, pay] } }) });
    await store.init();
    postDue(store, { index: computeIndex(store.all('transactions')), settings, today: '2026-01-10' });
    expect(store.all('transactions').filter((t) => t.id.startsWith('lf-'))).toEqual([]);
    expect(store.get('leases', 'L1').recurring[0].postedThrough).toBe('2026-01-01');
  });

  it("charges the late fee for an ended lease's last month", () => {
    const lateFee = { enabled: true, graceDays: 5, kind: 'flat', amount: 5000, minBalance: 1 };
    const lease = mkLease({ type: 'fixed', end: '2026-06-01', lateFee, lateFeesThrough: '2026-05', recurring: [rent({ postedThrough: '2026-06-01' })] });
    // June's rent posted on June 1, while the lease was still active, and is unpaid.
    const june = computePostings({ leases: [mkLease({ recurring: [rent({ postedThrough: '2026-05-01' })] })], index: computeIndex([]), settings, today: '2026-06-01' }).transactions;
    const out = computePostings({ leases: [lease], index: computeIndex(june), settings, today: '2026-06-10' });
    expect(out.transactions.map((t) => t.id)).toEqual(['lf-L1-2026-06']);
    // Once evaluated, the past lease is left alone.
    const done = { ...lease, ...out.leasePatches.get('L1') };
    expect(computePostings({ leases: [done], index: computeIndex([...june, ...out.transactions]), settings, today: '2026-07-10' }).transactions).toEqual([]);
  });

  it('never back-bills late fees for months long past', () => {
    const lateFee = { enabled: true, graceDays: 5, kind: 'flat', amount: 5000, minBalance: 1 };
    // A lease that ended in 2024 with its last month unchecked.
    const old = mkLease({ type: 'fixed', start: '2024-01-01', end: '2024-06-03', lateFee, lateFeesThrough: '2024-05', recurring: [rent({ start: '2024-01-01', postedThrough: '2024-06-01' })] });
    const june = buildCharge({ lease: old, date: '2024-06-01', items: [{ accountId: ACC.rent, amount: 100000 }] });
    expect(computePostings({ leases: [old], index: computeIndex([june]), settings, today: '2026-10-12' }).transactions).toEqual([]);
    // A rent change long ago left fees unchecked since: they are marked
    // checked, and only a recent month can get a fee.
    const changed = mkLease({ lateFee, lateFeesThrough: '2025-12', end: '2027-12-31', recurring: [rent({ start: '2025-01-01', end: '2025-12-31', postedThrough: '2025-12-01' }), rent({ id: 'r2', start: '2026-01-01', postedThrough: '2026-10-01' })] });
    // Every month of 2026 posted and unpaid.
    const charges = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].map((m) => buildCharge({ lease: changed, date: `2026-${m}-01`, items: [{ accountId: ACC.rent, amount: 100000 }] }));
    const out = computePostings({ leases: [changed], index: computeIndex(charges), settings, today: '2026-10-12' });
    expect(out.transactions.filter((t) => t.id.startsWith('lf-')).map((t) => t.id)).toEqual(['lf-L1-2026-09', 'lf-L1-2026-10']);
    expect(out.leasePatches.get('L1').lateFeesThrough).toBe('2026-10');
  });

  it('computes percentage late fees from rent', () => {
    const lease = mkLease({ lateFee: { enabled: true, graceDays: 0, kind: 'percent', percent: 10, minBalance: 1 }, recurring: [rent({ postedThrough: '2025-12-31' })] });
    const out = computePostings({ leases: [lease], index: computeIndex([]), settings, today: '2026-01-03' });
    const fee = out.transactions.find((t) => t.id.startsWith('lf-'));
    expect(fee.lines[0].amount).toBe(10000);
  });

  it('two devices posting at once produce no duplicates', async () => {
    const backend = createMemoryBackend({ collections: { leases: [mkLease()] } });
    const a = createStore({ backend, flushDelay: 0, timeoutMs: 0 });
    const b = createStore({ backend, flushDelay: 0, timeoutMs: 0 });
    await a.init();
    await b.init();
    postDue(a, { index: computeIndex(a.all('transactions')), settings, today: '2026-03-02' });
    postDue(b, { index: computeIndex(b.all('transactions')), settings, today: '2026-03-02' });
    await a.flush();
    await b.flush();
    await a.sync({ force: true });
    expect(a.all('transactions').filter((t) => t.kind === 'charge')).toHaveLength(3);
  });
});

describe('defaultPostingStart', () => {
  it('does not back-charge months before the current one', () => {
    expect(defaultPostingStart({ start: '2025-06-01' }, '2026-10-12')).toBe('2026-10-01');
    expect(defaultPostingStart({ start: '2026-10-05' }, '2026-10-12')).toBe('2026-10-05');
    expect(defaultPostingStart({ start: '2026-11-01' }, '2026-10-12')).toBe('2026-11-01');
  });
});
