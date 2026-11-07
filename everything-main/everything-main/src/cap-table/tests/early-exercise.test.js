import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/kv.js', async (importOriginal) =>
  (await import('./helpers/conditional-kv.js')).conditionalKVMock(importOriginal));
import { Store } from '../src/lib/store.js';
import { vestedQuantity, unvestedTotal, dbAsOf, fullyDiluted, sharesOutstanding } from '../src/lib/captable.js';
import { addMonthsISO } from '../src/lib/util.js';

function fresh() {
  const values = new Map();
  globalThis.puter = { kv: {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); return true; },
  }, auth: { getUser: async () => ({ uuid: 'test', username: 'test' }) } };
  const s = new Store();
  s.stakeholders = Store.sanitizeStakeholders([{ id: 'holder', name: 'Holder' }, { id: 'buyer', name: 'Buyer' }]);
  s.classes = Store.sanitizeClasses([{ id: 'common', name: 'Common', kind: 'common' }]);
  return s;
}
const terms = { kind: 'option', stakeholderId: 'holder', quantity: 1000, strike: 1,
  date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 12, earlyExercise: true };
const exercise = (s, grant, quantity, date = '2026-01-01') => s.exerciseOption(grant.id, { quantity, date, classId: 'common' });

function expectSchedule(s, original, from = 24) {
  for (let m = from; m <= 48; m += 1) {
    const date = addMonthsISO('2024-01-01', m);
    const snapshot = dbAsOf(s.db, date);
    expect(unvestedTotal(snapshot.securities, date), `month ${m}`).toBe(1000 - vestedQuantity(original, date));
    expect(fullyDiluted(snapshot.securities, snapshot.company)).toBe(1000);
  }
}

describe('exercise vesting allocation', () => {
  it.each(['monthly', 'quarterly', 'annual', 'custom'])('preserves %s vesting regardless of exercise batching', async (frequency) => {
    for (const batches of [[1000], [500, 500], [100, 200, 700], [333, 333, 334], [250, 750]]) {
      const s = fresh();
      const grant = await s.addSecurity({ ...terms, vestingFrequency: frequency,
        ...(frequency === 'custom' ? { vestingTranches: [
          { date: '2025-01-01', quantity: 300 }, { date: '2026-01-01', quantity: 300 },
          { date: '2027-01-01', quantity: 400 },
        ] } : {}),
      });
      for (const quantity of batches) await exercise(s, grant, quantity);
      expect(sharesOutstanding(s.securities)).toBe(1000);
      expectSchedule(s, grant);
    }
  });

  it('keeps already vested installments vested in a partial early exercise', async () => {
    const s = fresh(); const grant = await s.addSecurity(terms);
    const cert = await exercise(s, grant, 600);
    expect(vestedQuantity(cert, '2026-01-01')).toBe(500);
    expect(unvestedTotal(s.securities, '2026-01-01')).toBe(500);
    expectSchedule(s, grant);
  });

  it('allocates earlier installments first on a partial custom exercise', async () => {
    const s = fresh(); const grant = await s.addSecurity({ ...terms, vestingTranches: [
      { date: '2025-01-01', quantity: 500 }, { date: '2026-01-01', quantity: 500 },
    ] });
    const cert = await exercise(s, grant, 400, '2024-06-01');
    expect(cert.vestingTranches).toEqual([{ date: '2025-01-01', quantity: 400 }]);
    expect(unvestedTotal(s.securities, '2025-01-01')).toBe(500);
  });

  it('uses the same allocation when an earlier exercise is certified later', async () => {
    const s = fresh(); const grant = await s.addSecurity(terms);
    await exercise(s, grant, 500);
    await s.exerciseOption(grant.id, { quantity: 500, date: '2026-01-01' });
    await s.certifyExercise(grant.id, { quantity: 500, date: '2026-01-01', classId: 'common' });
    expectSchedule(s, grant);
  });

  it('conserves vesting when exercises are entered out of date order', async () => {
    const s = fresh(); const grant = await s.addSecurity(terms);
    await exercise(s, grant, 500);
    await exercise(s, grant, 500, '2025-01-01');
    expectSchedule(s, grant, 12);
  });

  it('does not reuse installments after exercised shares transfer, and survives a split and reload', async () => {
    const s = fresh(); const grant = await s.addSecurity(terms);
    const first = await exercise(s, grant, 500);
    await s.transferShares(first.id, { date: '2026-01-01', quantity: 200, pricePerShare: 1, to: { stakeholderId: 'buyer' } });
    await exercise(s, grant, 500);
    expectSchedule(s, grant);
    await s.recordSplit({ num: 2, den: 1, date: '2026-02-01' });
    const reloaded = Store.sanitizeSnapshot(JSON.parse(JSON.stringify(s.exportAll())));
    expect(unvestedTotal(reloaded.securities, '2026-02-01')).toBe(2000 - Math.floor(2000 * 25 / 48));
    expect(unvestedTotal(dbAsOf(reloaded, '2026-01-01').securities, '2026-01-01')).toBe(500);
  });

  it('keeps the original allocation when a certificate is deleted and the exercise re-entered', async () => {
    const s = fresh(); const grant = await s.addSecurity(terms);
    const first = await exercise(s, grant, 500); await exercise(s, grant, 500);
    await s.deleteSecurity(first.id);
    expectSchedule(s, grant);
    await s.certifyExercise(grant.id, { quantity: 500, date: '2026-01-01', classId: 'common' });
    expectSchedule(s, grant);
  });
  it('reallocates a resized certificate without overlapping later exercises', async () => {
    const s = fresh(); const grant = await s.addSecurity(terms);
    const first = await exercise(s, grant, 500); await exercise(s, grant, 300);
    await s.updateSecurity(first.id, { quantity: 600 });
    expectSchedule(s, grant);
  });

  it('keeps an offset through a repurchase, reverse split, and historical reload', async () => {
    const s = fresh(); const grant = await s.addSecurity(terms);
    await exercise(s, grant, 500); const later = await exercise(s, grant, 500);
    const result = await s.transferShares(later.id, { date: '2026-01-01', quantity: 100, pricePerShare: 1, to: 'company' });
    expect(result.remainderCert.vestingOffset).toBe(500);
    expect(vestedQuantity(result.remainderCert, '2027-01-01')).toBe(250);
    await s.recordSplit({ num: 1, den: 3, date: '2026-02-01' });
    const reloaded = Store.sanitizeSnapshot(JSON.parse(JSON.stringify(s.exportAll())));
    const historic = dbAsOf(reloaded, '2026-01-01');
    const remainder = historic.securities.find((s) => s.id === result.remainderCert.id);
    expect(remainder.vestingOffset).toBe(500);
    expect(unvestedTotal(historic.securities, '2026-01-01')).toBe(400);
  });

});
