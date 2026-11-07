import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/kv.js', async (importOriginal) =>
  (await import('./helpers/conditional-kv.js')).conditionalKVMock(importOriginal));
import { buildSecurityPlan, autoMatch, SECURITY_FIELDS } from '../src/lib/csvimport.js';
import { Store } from '../src/lib/store.js';
import { vestedQuantity, dbAsOf, fullyDiluted, unvestedTotal, isoOverLimitYears } from '../src/lib/captable.js';
import { vestingSteps, awardFairValue, isoExercises } from '../src/lib/reports.js';

function fresh() {
  const values = new Map();
  globalThis.puter = { kv: {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); return true; },
  }, auth: { getUser: async () => ({ uuid: 'test', username: 'test' }) } };
  const s = new Store();
  s.stakeholders = Store.sanitizeStakeholders([{ id: 'holder', name: 'Employee', kind: 'employee' }]);
  s.classes = Store.sanitizeClasses([{ id: 'common', name: 'Common', kind: 'common' }]);
  return s;
}
const terms = { stakeholderId: 'holder', classId: 'common', quantity: 1000, strike: 2,
  date: '2024-01-01', grantDate: '2024-01-01', vestingStart: '2023-01-01', vestingMonths: 48, cliffMonths: 12 };
const take = (s, award, quantity, date) => award.kind === 'rsu'
  ? s.settleRSU(award.id, { quantity, date })
  : s.exerciseOption(award.id, { quantity, date, classId: 'common' });

describe('independent vesting start', () => {
  it.each(['option', 'rsu'])('preserves prior-service credit on %s through edits, backup, and historical views', async (kind) => {
    const s = fresh(); const award = await s.addSecurity({ ...terms, kind });
    expect(vestedQuantity(award, '2024-01-01')).toBe(250);
    expect(vestedQuantity(award, '2025-01-01')).toBe(500);
    expect(vestingSteps(award)[0]).toEqual({ date: '2024-01-01', quantity: 250 });
    expect(dbAsOf(s.db, '2023-12-31').securities).toEqual([]);
    await s.updateSecurity(award.id, { grantDate: '2024-02-01', date: '2024-02-01' });
    const restored = Store.sanitizeSnapshot(JSON.parse(JSON.stringify(s.exportAll())));
    expect(restored.securities[0]).toMatchObject({ vestingStart: '2023-01-01', grantDate: '2024-02-01' });
    expect(vestedQuantity(restored.securities[0], '2025-01-01')).toBe(500);
    expect(fullyDiluted(restored.securities, restored.company)).toBe(1000);
  });

  it.each(['option', 'rsu'])('holds %s exercises/settlements to both the grant date and the independent clock', async (kind) => {
    const s = fresh(); const award = await s.addSecurity({ ...terms, kind });
    await expect(take(s, award, 1, '2023-12-31')).rejects.toThrow(/before/);
    await expect(take(s, award, 251, '2024-01-01')).rejects.toThrow(/vested/);
    await take(s, award, 250, '2024-01-01');
    expect(unvestedTotal(s.securities, '2024-01-01')).toBe(750);
    expect(fullyDiluted(s.securities, s.company)).toBe(1000);
    await expect(take(s, award, 1, '2024-01-01')).rejects.toThrow(/vested/);
  });

  it.each(['option', 'rsu'])('supports a later %s vesting start without moving the grant date', async (kind) => {
    const s = fresh(); const award = await s.addSecurity({ ...terms, kind, vestingStart: '2025-01-01' });
    expect(vestedQuantity(award, '2025-12-31')).toBe(0);
    expect(vestedQuantity(award, '2026-01-01')).toBe(250);
    await expect(take(s, award, 1, '2025-12-31')).rejects.toThrow(/vested/);
    await take(s, award, 250, '2026-01-01');
    expect(s.security(award.id).grantDate).toBe('2024-01-01');
  });

  it('preserves CSV vesting dates through the actual import and backup pipeline', async () => {
    const s = fresh();
    const headers = ['Stakeholder', 'Security type', 'Class', 'Quantity', 'Strike price', 'Date', 'Vesting months', 'Cliff months', 'Vesting start'];
    const plan = buildSecurityPlan([
      ['Employee', 'Option', '', '1000', '2', '2024-01-01', '48', '12', '2023-01-01'],
      ['Employee', 'RSU', 'Common', '1000', '', '2024-01-01', '48', '12', '2023-01-01'],
    ], autoMatch(headers, SECURITY_FIELDS), s.db);
    expect(plan.errors).toEqual([]);
    await s.importRecords({ securities: plan.creates });
    const backup = Store.sanitizeSnapshot(JSON.parse(JSON.stringify(s.exportAll())));
    expect(backup.securities).toHaveLength(2);
    for (const award of backup.securities) {
      expect(award).toMatchObject({ vestingStart: '2023-01-01', grantDate: '2024-01-01', vestingMonths: 48 });
      expect(vestedQuantity(award, '2024-01-01')).toBe(250);
    }
  });

  it('continues the independent clock on early-exercise certificates and through stock splits', async () => {
    const s = fresh(); const a = await s.addSecurity({ ...terms, kind: 'option', earlyExercise: true });
    const first = await take(s, a, 500, '2024-01-01');
    const second = await take(s, a, 500, '2024-01-01');
    expect(first.vestingStart).toBe('2023-01-01');
    expect(second.vestingStart).toBe('2023-01-01');
    expect(unvestedTotal(s.securities, '2024-01-01')).toBe(750);
    await s.recordSplit({ num: 2, den: 1, date: '2024-06-01' });
    expect(unvestedTotal(s.securities, '2025-01-01')).toBe(1000);
    expect(unvestedTotal(dbAsOf(s.db, '2024-01-01').securities, '2024-01-01')).toBe(750);
  });

  it('uses grant-date FMV and the grant year for tax reports despite earlier service credit', async () => {
    const s = fresh();
    s.company = Store.sanitizeCompany({ ...s.company, valuations: [
      { id: 'old', date: '2022-01-01', fmvPerShare: 1 }, { id: 'new', date: '2024-01-01', fmvPerShare: 4 },
    ] });
    const a = await s.addSecurity({ ...terms, kind: 'option', optionType: 'iso', quantity: 40000, vestingStart: '2020-01-01' });
    expect(awardFairValue(s.db, a).spot).toBe(4);
    expect(vestingSteps(a)).toEqual([{ date: '2024-01-01', quantity: 40000 }]);
    expect(isoOverLimitYears(s.db, 'holder')).toMatchObject([{ year: 2024, value: 160000 }]);
    await take(s, a, 100, '2024-01-01');
    expect(isoExercises(s.db)[0]).toMatchObject({ grantDate: '2024-01-01', exerciseDate: '2024-01-01' });
    const rsu = await s.addSecurity({ ...terms, kind: 'rsu' });
    expect(awardFairValue(s.db, rsu).perUnit).toBe(4);
    expect(awardFairValue(s.db, rsu).flags).toContain('service-at-grant');
    expect(awardFairValue(s.db, a).notes.join(' ')).toContain('assumes service inception on the grant date');
  });

  it.each(['option', 'rsu'])('keeps legacy %s schedules unchanged and drops the clock when custom or immediate', async (kind) => {
    const s = fresh(); const a = await s.addSecurity({ ...terms, kind, vestingStart: '' });
    expect(a.vestingStart).toBeUndefined();
    expect(vestedQuantity(a, '2024-01-01')).toBe(0);
    await s.updateSecurity(a.id, { vestingStart: '2023-01-01' });
    await s.updateSecurity(a.id, { vestingTranches: [{ date: '2026-01-01', quantity: 1000 }] });
    expect(s.security(a.id).vestingStart).toBeUndefined();
    await s.updateSecurity(a.id, { vestingTranches: [], vestingMonths: 0, vestingStart: '2023-01-01' });
    expect(s.security(a.id).vestingStart).toBeUndefined();
    expect(vestedQuantity(s.security(a.id), '2024-01-01')).toBe(1000);
  });

  it('refuses invalid independent start dates without changing the record', async () => {
    const s = fresh(); const a = await s.addSecurity({ ...terms, kind: 'option' });
    for (const vestingStart of ['someday', '2024-02-30']) {
      await expect(s.updateSecurity(a.id, { vestingStart })).rejects.toThrow(/vesting start date/);
      expect(s.security(a.id).vestingStart).toBe('2023-01-01');
    }
  });
});
