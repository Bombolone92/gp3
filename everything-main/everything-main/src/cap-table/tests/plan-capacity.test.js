import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/lib/store.js';
import { dbAsOf, planBalances } from '../src/lib/captable.js';
import { puterBackend } from './helpers/puter-kv.js';

let store, holder, common, plan;
beforeEach(async () => {
  puterBackend().install(); store = new Store(); await store.init();
  common = await store.addClass({ name: 'Common', kind: 'common' });
  holder = await store.addStakeholder({ name: 'Employee' });
  plan = await store.addPlan({ name: '2024 Plan', adopted: '2024-01-01', classId: common.id, reserve: 100 });
});
const award = (quantity, date, extra = {}) => store.addSecurity({ kind: 'option', stakeholderId: holder.id,
  classId: common.id, planId: plan.id, quantity, date, strike: 1, vestingMonths: 0, ...extra });
const balance = (date) => planBalances(dbAsOf(store.db, date)).plans.find((p) => p.planId === plan.id).available;

describe('awards must fit the reserve throughout their dated history', () => {
  it.each(['option', 'rsu'])('refuses a backdated %s funded by a later top-up without saving it', async (kind) => {
    await store.resizePlanReserve(plan.id, { size: 200, date: '2025-01-01' });
    const before = structuredClone(store.db);
    await expect(award(150, '2024-06-01', { kind })).rejects.toThrow(/2024 Plan.*50.*2024-06-01/);
    expect(store.db).toEqual(before);
    const reloaded = new Store(); await reloaded.init();
    expect(reloaded.securities).toEqual(before.securities);
    await award(100, '2024-06-01', { kind });
    await award(100, '2025-01-01', { kind });
    expect(balance('2024-06-01')).toBe(0);
    expect(balance('2025-01-01')).toBe(0);
  });

  it('checks quantity, grant date and plan changes on existing awards', async () => {
    const grant = await award(100, '2024-06-01');
    await store.resizePlanReserve(plan.id, { size: 200, date: '2025-01-01' });
    await expect(store.updateSecurity(grant.id, { quantity: 150 })).rejects.toThrow(/2024-06-01/);
    const later = await award(100, '2025-01-01');
    await expect(store.updateSecurity(later.id, { date: '2024-07-01', grantDate: '2024-07-01' })).rejects.toThrow(/2024-07-01/);
    const other = await store.addPlan({ name: 'Other plan', adopted: '2024-01-01', classId: common.id, reserve: 100 });
    const moved = await award(50, '2024-08-01', { planId: other.id });
    await expect(store.updateSecurity(moved.id, { planId: plan.id })).rejects.toThrow(/2024-08-01/);
    expect(store.security(grant.id).quantity).toBe(100);
    expect(store.security(later.id).date).toBe('2025-01-01');
    expect(store.security(moved.id).planId).toBe(other.id);
  });

  it('does not spend a future cancellation before it returns shares', async () => {
    const first = await award(100, '2024-01-01');
    await store.updateSecurity(first.id, { cancelled: 100, cancelledDate: '2025-01-01' });
    await expect(award(1, '2024-06-01')).rejects.toThrow(/2024-06-01/);
    await award(100, '2025-01-01');
    expect(balance('2025-01-01')).toBe(0);
  });

  it('checks intervening events as well as the grant date and current balance', async () => {
    const first = await award(80, '2024-06-01');
    await store.updateSecurity(first.id, { cancelled: 80, cancelledDate: '2025-01-01' });
    // Thirty fit in February and today, but would leave June ten overdrawn.
    await expect(award(30, '2024-02-01')).rejects.toThrow(/10.*2024-06-01/);
    await award(20, '2024-02-01');
    expect(balance('2024-06-01')).toBe(0);
    expect(balance('2025-01-01')).toBe(80);
  });

  it('compares historical quantities in their own split units', async () => {
    const first = await award(100, '2024-06-01');
    await store.recordSplit({ num: 2, den: 1, date: '2025-01-01' });
    await store.resizePlanReserve(plan.id, { size: 400, date: '2026-01-01' });
    await expect(store.updateSecurity(first.id, { quantity: 300 })).rejects.toThrow(/50.*2024-06-01/);
    expect(balance('2024-06-01')).toBe(0);
    await award(200, '2026-01-01');
    expect(balance('2026-01-01')).toBe(0);
  });

  it('keeps imported overruns editable when a correction does not worsen them', async () => {
    const first = await award(100, '2024-06-01');
    await store.importAll({ ...store.exportAll(), securities: [{ ...first, quantity: 150 }] });
    await store.updateSecurity(first.id, { strike: 2 });
    await store.updateSecurity(first.id, { quantity: 140 });
    expect(balance('2024-06-01')).toBe(-40);
    await expect(store.updateSecurity(first.id, { quantity: 141 })).rejects.toThrow(/2024-06-01/);
    await award(1000, '2024-01-01', { planId: '', outsidePlan: true });
    expect(balance('2024-06-01')).toBe(-40);
  });

  it('validates queued grants against the balance left by the preceding write', async () => {
    const results = await Promise.allSettled([award(75, '2024-06-01'), award(75, '2024-06-01')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(balance('2024-06-01')).toBe(25);
  });
});

describe('dated reserve changes must hold on every day since them', () => {
  it('refuses a back-dated resize below what was committed on that day', async () => {
    const grant = await award(80, '2024-03-01');
    await store.updateSecurity(grant.id, { cancelled: 50, cancelledDate: '2025-03-01' });
    /* Today only 30 are committed, so 40 clears today's floor - but on
       2024-06-01 all 80 were drawn, and the resize would leave that day
       reading 40 short. */
    const before = structuredClone(store.db);
    await expect(store.resizePlanReserve(plan.id, { size: 40, date: '2024-06-01' }))
      .rejects.toThrow(/2024 Plan had 80 shares committed under it on 2024-06-01/);
    expect(store.db).toEqual(before);
    await store.resizePlanReserve(plan.id, { size: 80, date: '2024-06-01' });
    expect(balance('2024-07-01')).toBe(0);
    expect(balance('2025-04-01')).toBe(50);
    await award(1, '2025-04-01');
  });

  it('holds the one-pool resize to the same days', async () => {
    const grant = await award(80, '2024-03-01');
    await store.updateSecurity(grant.id, { cancelled: 50, cancelledDate: '2025-03-01' });
    await expect(store.resizePool({ size: 40, date: '2024-06-01' }))
      .rejects.toThrow(/80 shares granted from it on 2024-06-01/);
    await store.resizePool({ size: 80, date: '2024-06-01' });
    expect(balance('2024-07-01')).toBe(0);
  });

  it('refuses a back-dated transfer that overdraws a day between its date and today', async () => {
    const other = await store.addPlan({ name: 'Successor plan', adopted: '2024-01-01', classId: common.id, reserve: 10 });
    const grant = await award(90, '2024-09-01');
    await store.updateSecurity(grant.id, { cancelled: 90, cancelledDate: '2025-01-01' });
    // June and today both have 100 to spare; September had 10.
    await expect(store.transferReserve({ fromPlanId: plan.id, toPlanId: other.id, quantity: 60, date: '2024-06-01' }))
      .rejects.toThrow(/2024 Plan would have 50 more shares committed than reserved on 2024-09-01/);
    await store.transferReserve({ fromPlanId: plan.id, toPlanId: other.id, quantity: 10, date: '2024-06-01' });
    expect(balance('2024-09-01')).toBe(0);
    expect(planBalances(dbAsOf(store.db, '2024-09-01')).plans.find((p) => p.planId === other.id).available).toBe(20);
  });

  it('quotes the floor in today’s shares once a split has restated the day', async () => {
    const grant = await award(80, '2024-03-01');
    await store.updateSecurity(grant.id, { cancelled: 50, cancelledDate: '2024-09-01' });
    await store.recordSplit({ num: 3, den: 1, date: '2025-01-01' });
    /* Today 90 of the restated 300 are committed, so 150 clears today's
       floor - but on 2024-06-01 all 80 pre-split shares were drawn, which
       are 240 of today's. Quoted as 80, the floor was typed as 80 and
       refused again. */
    await expect(store.resizePlanReserve(plan.id, { size: 150, date: '2024-06-01' }))
      .rejects.toThrow('2024 Plan had 80 shares committed under it on 2024-06-01, 240 in today’s shares, so its reserve can’t be smaller than 240 as of that day.');
    await expect(store.resizePool({ size: 150, date: '2024-06-01' }))
      .rejects.toThrow('The pool had 80 shares granted from it on 2024-06-01, 240 in today’s shares, so it can’t be smaller than 240 as of that day.');
    await store.resizePlanReserve(plan.id, { size: 240, date: '2024-06-01' });
    expect(balance('2024-07-01')).toBe(0);
  });

  it('quotes a transfer’s overdraw in today’s shares too', async () => {
    const other = await store.addPlan({ name: 'Successor plan', adopted: '2024-01-01', classId: common.id, reserve: 10 });
    const grant = await award(90, '2024-09-01');
    await store.updateSecurity(grant.id, { cancelled: 90, cancelledDate: '2025-01-01' });
    await store.recordSplit({ num: 3, den: 1, date: '2025-02-01' });
    // June and today have 300 of today's shares to spare; September had 10 pre-split shares, 30 of today's.
    await expect(store.transferReserve({ fromPlanId: plan.id, toPlanId: other.id, quantity: 180, date: '2024-06-01' }))
      .rejects.toThrow('2024 Plan would have 50 more shares committed than reserved on 2024-09-01, 150 in today’s shares, after this transfer.');
    await store.transferReserve({ fromPlanId: plan.id, toPlanId: other.id, quantity: 30, date: '2024-06-01' });
    expect(balance('2024-09-01')).toBe(0);
  });
});

describe('the first pool is held to the same days', () => {
  it('refuses a back-dated first pool below what was drawn on a day since', async () => {
    puterBackend().install(); const s = new Store(); await s.init();
    const cls = await s.addClass({ name: 'Common', kind: 'common' });
    const h = await s.addStakeholder({ name: 'Employee' });
    const grant = await s.addSecurity({ kind: 'option', stakeholderId: h.id, classId: cls.id, quantity: 100, date: '2024-03-01', strike: 1, vestingMonths: 0 });
    await s.updateSecurity(grant.id, { cancellations: [{ quantity: 60, date: '2024-06-01' }] });
    /* Today 40 are drawn, so 50 clears today's floor - but March drew all
       100, and a pool of 50 adopted in January would read that day 50 short
       and refuse the next award dated inside it for the shortfall. */
    const before = structuredClone(s.db);
    await expect(s.resizePool({ size: 50, date: '2024-01-01' })).rejects.toThrow(/100 shares granted from it on 2024-03-01/);
    expect(s.db).toEqual(before);
    await s.resizePool({ size: 100, date: '2024-01-01' });
    expect(planBalances(dbAsOf(s.db, '2024-04-01')).plans[0].available).toBe(0);
    await s.addSecurity({ kind: 'option', stakeholderId: h.id, classId: cls.id, quantity: 1, date: '2024-07-01', strike: 1, vestingMonths: 0 });
  });

  it('is not held to the days before it existed', async () => {
    puterBackend().install(); const s = new Store(); await s.init();
    const cls = await s.addClass({ name: 'Common', kind: 'common' });
    const h = await s.addStakeholder({ name: 'Employee' });
    await s.addSecurity({ kind: 'option', stakeholderId: h.id, classId: cls.id, quantity: 100, date: '2024-03-01', strike: 1, vestingMonths: 0 });
    /* The pool comes after the grant it takes on, as the one pool always
       could. Before its adoption there was no plan to be short, so the March
       day the plan reads 100 under a reserve of nothing is not a shortfall
       the adoption writes; a 500-share pool adopted today over that grant was
       refused as smaller than the 100 "granted from it" in March. */
    await s.resizePool({ size: 500, date: '2024-06-01' });
    expect(planBalances(dbAsOf(s.db, '2024-07-01')).plans[0].available).toBe(400);
    expect(planBalances(s.db).plans[0].available).toBe(400);
  });

  it('is still held to every day from its adoption on', async () => {
    puterBackend().install(); const s = new Store(); await s.init();
    const cls = await s.addClass({ name: 'Common', kind: 'common' });
    const h = await s.addStakeholder({ name: 'Employee' });
    const grant = await s.addSecurity({ kind: 'option', stakeholderId: h.id, classId: cls.id, quantity: 100, date: '2024-03-01', strike: 1, vestingMonths: 0 });
    await s.updateSecurity(grant.id, { cancellations: [{ quantity: 60, date: '2024-09-01' }] });
    // Today 40 are drawn; on the adoption date all 100 still were.
    const before = structuredClone(s.db);
    await expect(s.resizePool({ size: 50, date: '2024-06-01' })).rejects.toThrow(/100 shares granted from it on 2024-06-01/);
    expect(s.db).toEqual(before);
    await s.resizePool({ size: 100, date: '2024-06-01' });
    expect(planBalances(dbAsOf(s.db, '2024-07-01')).plans[0].available).toBe(0);
    expect(planBalances(s.db).plans[0].available).toBe(60);
  });
});
