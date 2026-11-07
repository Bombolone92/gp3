import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/lib/store.js';
import { dbAsOf, grantVested, grantOutstanding, vestingForecast, upcomingEvents, isoLimitValueByYear } from '../src/lib/captable.js';
import { awardExpenseSchedule, expenseReport } from '../src/lib/reports.js';
import { puterBackend } from './helpers/puter-kv.js';

let store, common, holder, plan;
beforeEach(async () => {
  puterBackend().install(); store = new Store(); await store.init();
  common = await store.addClass({ name: 'Common', kind: 'common' });
  holder = await store.addStakeholder({ name: 'Employee', kind: 'employee' });
  plan = await store.addPlan({ name: 'Plan', adopted: '2024-01-01', classId: common.id, reserve: 10000 });
  await store.addValuation({ date: '2024-01-01', fmvPerShare: 1 });
});
const grant = (extra = {}) => store.addSecurity({ kind: 'option', classId: common.id, stakeholderId: holder.id,
  planId: plan.id, quantity: 4800, strike: 1, date: '2024-01-01', vestingMonths: 48, cliffMonths: 12, ...extra });
const cancel = (id, quantity, date) => store.updateSecurity(id, { cancellations: [
  ...(store.security(id).cancellations || (store.security(id).cancelled ? [{ quantity: store.security(id).cancelled, date: store.security(id).cancelledDate }] : [])),
  { quantity, date },
] });

describe('partial cancellation leaves the surviving award vesting', () => {
  it.each(['option', 'rsu'])('continues vesting, exercises or settles, and reloads a partially cancelled %s', async (kind) => {
    const award = await grant({ kind });
    await cancel(award.id, 100, '2025-01-01');
    expect(grantOutstanding(store.security(award.id))).toBe(4700);
    expect(grantVested(store.security(award.id), '2025-01-01')).toBe(1200);
    expect(grantVested(store.security(award.id), '2026-01-01')).toBe(2400);
    expect(grantVested(store.security(award.id), '2028-01-01')).toBe(4700);
    const exercise = (quantity, date) => kind === 'option'
      ? store.exerciseOption(award.id, { quantity, date, classId: common.id })
      : store.settleRSU(award.id, { quantity, date });
    await expect(exercise(1300, '2025-01-01')).rejects.toThrow(/Only vested/);
    const certificate = await exercise(2000, '2026-01-01');
    expect(certificate.quantity).toBe(2000);
    const reloaded = new Store(); await reloaded.init();
    expect(grantVested(reloaded.security(award.id), '2028-01-01')).toBe(4700);
    expect(grantOutstanding(dbAsOf(reloaded.db, '2024-12-31').securities.find((s) => s.id === award.id))).toBe(4800);
  });

  it.each(['quarterly', 'annual', 'custom'])('keeps the surviving %s installments, removing the last ones first', async (schedule) => {
    const award = await grant(schedule === 'custom' ? { vestingTranches: [
      { date: '2025-01-01', quantity: 1200 }, { date: '2026-01-01', quantity: 1200 },
      { date: '2027-01-01', quantity: 1200 }, { date: '2028-01-01', quantity: 1200 },
    ] } : { vestingFrequency: schedule });
    await cancel(award.id, 100, '2025-01-01');
    await cancel(award.id, 100, '2026-01-01');
    expect(grantVested(store.security(award.id), '2027-01-01')).toBe(3600);
    expect(grantVested(store.security(award.id), '2028-01-01')).toBe(4600);
  });

  it('keeps full forfeitures and a subsequent departure stopped, with the exercise window enforced', async () => {
    const full = await grant();
    await cancel(full.id, 3600, '2025-01-01');
    expect(grantVested(store.security(full.id), '2028-01-01')).toBe(1200);
    const partial = await grant();
    await cancel(partial.id, 100, '2025-01-01');
    await store.markDeparted(holder.id, { date: '2026-01-01', grants: [
      { id: partial.id, cancelQty: 2300, exerciseBy: '2026-04-01' },
    ] });
    expect(grantVested(store.security(partial.id), '2028-01-01')).toBe(2400);
    expect(grantVested(dbAsOf(store.db, '2025-06-01').securities.find((s) => s.id === partial.id), '2025-06-01')).toBe(1700);
    await expect(store.exerciseOption(partial.id, { quantity: 1, date: '2026-04-02', classId: common.id })).rejects.toThrow(/could not be exercised after/);
    await store.exerciseOption(partial.id, { quantity: 2400, date: '2026-04-01', classId: common.id });
  });

  it('keeps incomplete custom schedules consistent with their expense tranches', async () => {
    const award = await grant({ kind: 'rsu', vestingTranches: [
      { date: '2025-01-01', quantity: 1200 }, { date: '2026-01-01', quantity: 1200 },
    ] });
    await cancel(award.id, 100, '2025-01-01');
    const current = store.security(award.id);
    expect(grantVested(current, '2025-01-01')).toBe(1200);
    expect(grantVested(current, '2026-01-01')).toBe(2300);
    expect(awardExpenseSchedule(store.db, current).recognized('2026-01-01')).toBe(2300);
  });

  it('persists an explicit departure stop even if the user leaves some unvested units outstanding', async () => {
    const award = await grant();
    await store.markDeparted(holder.id, { date: '2025-01-01', grants: [
      { id: award.id, cancelQty: 100, exerciseBy: '2025-04-01' },
    ] });
    const reloaded = new Store(); await reloaded.init();
    expect(reloaded.security(award.id).vestingStoppedAt).toBe('2025-01-01');
    expect(grantVested(reloaded.security(award.id), '2028-01-01')).toBe(1200);
    expect(dbAsOf(reloaded.db, '2024-12-31').securities.find((s) => s.id === award.id).vestingStoppedAt).toBeUndefined();
    await expect(reloaded.updateSecurity(award.id, { vestingStoppedAt: '2023-12-31' })).rejects.toThrow(/before the award/);
  });

  it('preserves the stop on legacy departures recorded before the explicit field existed', async () => {
    const award = await grant();
    const legacy = store.exportAll();
    legacy.stakeholders = legacy.stakeholders.map((h) => ({ ...h, departed: '2025-01-01' }));
    legacy.securities = legacy.securities.map((s) => ({ ...s, cancelled: 100,
      cancelledDate: '2025-01-01', exerciseBy: '2025-04-01' }));
    await store.importAll(legacy);
    expect(grantVested(store.security(award.id), '2028-01-01')).toBe(1200);
    expect(store.security(award.id).vestingStoppedAt).toBe('2025-01-01');
  });

  it('reports future vesting and the earlier completion after cancelling the last installment', async () => {
    const award = await grant();
    await cancel(award.id, 100, '2025-01-01');
    const events = upcomingEvents(store.db, { from: '2027-01-01', horizonMonths: 12 });
    expect(events.find((e) => e.securityId === award.id && e.type === 'vest-complete'))
      .toMatchObject({ date: '2027-12-01', quantity: 4700 });
    const forecast = vestingForecast(store.securities, { from: '2025-01-01', months: 12 });
    expect(forecast.rows.some((r) => r.vesting > 0 || r.vested > 1200)).toBe(true);
  });

  it('preserves partial cancellation through a split and historical rewind', async () => {
    const award = await grant();
    await cancel(award.id, 100, '2025-01-01');
    await store.recordSplit({ num: 2, den: 1, date: '2026-01-01' });
    expect(grantVested(store.security(award.id), '2028-01-01')).toBe(9400);
    const historical = dbAsOf(store.db, '2025-06-01').securities.find((s) => s.id === award.id);
    expect(grantVested(historical, '2025-06-01')).toBe(1700);
  });

  it('forfeits only the cancelled unvested units, on each cancellation date, in expense reports', async () => {
    const award = await grant({ kind: 'rsu' });
    await cancel(award.id, 100, '2025-01-01');
    await cancel(award.id, 200, '2026-01-01');
    const schedule = awardExpenseSchedule(store.db, store.security(award.id));
    expect(schedule.liveFairValue('2024-12-31')).toBe(4800);
    expect(schedule.liveFairValue('2025-01-01')).toBe(4700);
    expect(schedule.liveFairValue('2026-01-01')).toBe(4500);
    expect(schedule.recognized('2028-01-01')).toBe(4500);
    expect(expenseReport(store.db, { start: '2025-01-01', end: '2025-12-31' }).totals.forfeited).toBe(100);
    expect(expenseReport(store.db, { start: '2026-01-01', end: '2026-12-31' }).totals.forfeited).toBe(200);
  });

  it('stops recognizing cost at a departure that cancelled nothing, and at the stop rather than a later lapse', async () => {
    /* Service ends on the departure day whatever the sheet cancelled: the
       vesting math caps the award at what had vested by then, and the
       expense report has to agree - read from the cancellation date alone,
       a departure that cancelled nothing kept the whole award accruing, and
       a lapse recorded at the exercise deadline kept the installments
       between the two as earned. */
    await store.updateCompany({ reporting: { volatility: 60, riskFreeRate: 4, expectedTermYears: 0, attribution: 'graded', fiscalYearEnd: 12, totalAssets: 0 } });
    const award = await grant();
    await store.markDeparted(holder.id, { date: '2025-07-01', grants: [{ id: award.id, cancelQty: 0, exerciseBy: '2025-10-01' }] });
    let sched = awardExpenseSchedule(store.db, store.security(award.id));
    const perUnit = sched.value.perUnit;
    expect(grantVested(store.security(award.id), '2030-01-01')).toBe(1800);
    expect(sched.recognized('2030-01-01') / perUnit).toBeCloseTo(1800, 6);
    expect(sched.liveFairValue('2030-01-01') / perUnit).toBeCloseTo(1800, 6);
    expect(sched.forfeitures.map((f) => [f.date, f.quantity])).toEqual([['2025-07-01', 3000]]);
    expect(sched.forfeitures[0].fairValue).toBeCloseTo(3000 * perUnit, 6);
    expect(expenseReport(store.db, { start: '2026-01-01', end: '2026-12-31' }).rows[0].expense).toBe(0);
    await store.cancelLapsedGrants([award.id]);
    sched = awardExpenseSchedule(store.db, store.security(award.id));
    expect(sched.recognized('2030-01-01') / perUnit).toBeCloseTo(1800, 6);
    expect(sched.forfeitures.map((f) => [f.date, f.quantity])).toEqual([['2025-07-01', 3000]]);
  });

  it('counts the continuing ISO vesting without reversing already vested options at expiration', async () => {
    const award = await grant({ optionType: 'iso', expires: '2034-01-01' });
    await cancel(award.id, 100, '2025-01-01');
    const years = isoLimitValueByYear(store.db, holder.id);
    expect([...years.values()].reduce((sum, row) => sum + row.value, 0)).toBe(4700);
    await cancel(award.id, 4700, '2034-01-01');
    expect([...isoLimitValueByYear(store.db, holder.id).values()].reduce((sum, row) => sum + row.value, 0)).toBe(4700);
  });
});
