import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/kv.js', async (importOriginal) =>
  (await import('./helpers/conditional-kv.js')).conditionalKVMock(importOriginal));
import { Store } from '../src/lib/store.js';
import { dbAsOf, fullyDiluted, warrantsOutstanding, sharesOutstanding, warrantExercised,
  ownershipByStakeholder, ownershipByClass, capitalRaised, exitWaterfall, poolRemaining, modelRound, latestPricedIssuance } from '../src/lib/captable.js';

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
const terms = { kind: 'warrant', stakeholderId: 'holder', classId: 'common', quantity: 100,
  strike: 2, date: '2024-01-01', expires: '2025-12-31' };
const snapshot = (s, date) => dbAsOf(s.db, date);
const fd = (s, date) => { const d = snapshot(s, date); return fullyDiluted(d.securities, d.company); };
const exercise = (s, w, quantity, date = '2025-01-01') => s.exerciseWarrant(w.id, { quantity, date });

describe('dated warrant lifecycle', () => {
  it('expires after the final exercise day without erasing earlier ownership', async () => {
    const s = fresh(); const w = await s.addSecurity(terms);
    for (const date of ['2024-06-01', '2025-12-31']) expect(fd(s, date)).toBe(100);
    expect(fd(s, '2023-12-31')).toBe(0);
    expect(fd(s, '2026-01-01')).toBe(0);
    expect(s.security(w.id)).toEqual(w);
    expect(fd(s, '2024-06-01')).toBe(100);
  });

  it('reconciles partial exercises, ownership, cash and expiration on their dates', async () => {
    const s = fresh(); const w = await s.addSecurity(terms);
    const cert = await exercise(s, w, 40);
    expect(cert).toMatchObject({ fromWarrantId: w.id, quantity: 40, pricePerShare: 2 });
    for (const [date, rights, stock] of [['2024-12-31', 100, 0], ['2025-01-01', 60, 40], ['2026-01-01', 0, 40]]) {
      const d = snapshot(s, date);
      expect(warrantsOutstanding(d.securities)).toBe(rights);
      expect(sharesOutstanding(d.securities)).toBe(stock);
      expect(fullyDiluted(d.securities, d.company)).toBe(rights + stock);
      expect(ownershipByStakeholder(d).total).toBe(rights + stock);
      expect(ownershipByClass(d).total).toBe(rights + stock);
      expect(capitalRaised(d.securities)).toBe(stock * 2);
    }
    expect(poolRemaining(s.company, s.securities)).toBe(0);
  });

  it('excludes expired rights from financing and exit proceeds, and never treats an exercise as a new pricing round', async () => {
    const s = fresh();
    await s.addSecurity({ kind: 'shares', stakeholderId: 'buyer', classId: 'common', quantity: 1000, pricePerShare: 1, date: '2024-01-01' });
    const w = await s.addSecurity(terms);
    await exercise(s, w, 40);
    const before = exitWaterfall(s.db, { exitValue: 10000, asOf: '2025-12-31' });
    const after = exitWaterfall(s.db, { exitValue: 10000, asOf: '2026-01-01' });
    expect(before.awards.find((a) => a.id === w.id)?.shares).toBe(60);
    expect(after.awards.some((a) => a.id === w.id)).toBe(false);
    expect(modelRound(s.db, { preMoney: 104000, investment: 10400, asOf: '2026-01-01' }).pps).toBe(100);
    expect(latestPricedIssuance(s.securities)).toEqual({ pricePerShare: 1, date: '2024-01-01' });
  });

  it('nets a future-dated exercise certificate out of the live position, as a grant does', async () => {
    /* The certificate is already among the shares outstanding whatever its
       date; netted only up to today, the same 40 shares sat in the shares
       total and inside the warrant's remaining rights at once. */
    const s = fresh(); const w = await s.addSecurity({ ...terms, expires: '2030-12-31' });
    await s.addSecurity({ kind: 'shares', stakeholderId: 'buyer', classId: 'common', quantity: 1000, pricePerShare: 1, date: '2024-01-01' });
    await exercise(s, w, 40, '2029-06-01');
    expect(fullyDiluted(s.securities, s.company)).toBe(1100);
    expect(warrantsOutstanding(s.securities)).toBe(60);
    expect(fd(s, '2026-09-10')).toBe(1100);
    expect(fd(s, '2029-06-01')).toBe(1100);
  });

  it('keeps multiple cancellations on their actual dates', async () => {
    const s = fresh(); const w = await s.addSecurity(terms);
    await s.cancelWarrant(w.id, { quantity: 20, date: '2024-05-01' });
    await s.cancelWarrant(w.id, { quantity: 30, date: '2024-07-01' });
    await exercise(s, w, 40);
    expect(fd(s, '2024-04-30')).toBe(100);
    expect(fd(s, '2024-05-01')).toBe(80);
    expect(fd(s, '2024-07-01')).toBe(50);
    expect(fd(s, '2025-01-01')).toBe(50);
    expect(fd(s, '2026-01-01')).toBe(40);
    await expect(s.cancelWarrant(w.id, { quantity: 11, date: '2025-01-01' })).rejects.toThrow(/balance/);
  });

  it('rejects overspending, bad dates, and edits that contradict exercise certificates', async () => {
    const s = fresh(); const w = await s.addSecurity(terms);
    const cert = await exercise(s, w, 40);
    const before = JSON.stringify(s.securities);
    for (const [quantity, date] of [[1e15, '2025-01-01'], [61, '2025-01-01'], [1, '2023-12-31'], [1, '2026-01-01'], [1.5, '2025-01-01'], [1, '2025-02-30']]) {
      await expect(exercise(s, w, quantity, date)).rejects.toThrow();
      expect(JSON.stringify(s.securities)).toBe(before);
    }
    for (const patch of [{ quantity: 39 }, { date: '2025-02-01' }, { expires: '2024-12-31' }, { cancelled: 61, cancelledDate: '2025-01-01' }]) {
      await expect(s.updateSecurity(w.id, patch)).rejects.toThrow();
      expect(JSON.stringify(s.securities)).toBe(before);
    }
    for (const patch of [{ quantity: 101 }, { date: '2026-01-01' }]) await expect(s.updateSecurity(cert.id, patch)).rejects.toThrow();
    await s.updateSecurity(cert.id, { quantity: 50 });
    expect(warrantExercised(w, s.securities)).toBe(50);
    expect(fd(s, '2025-06-01')).toBe(100);
  });

  it('rolls back a failed exercise write without losing rights or leaving shares', async () => {
    const s = fresh(); const w = await s.addSecurity(terms);
    const before = JSON.stringify(s.securities);
    globalThis.puter.kv.set = async () => { throw new Error('Offline'); };
    await expect(exercise(s, w, 40)).rejects.toThrow();
    expect(JSON.stringify(s.securities)).toBe(before);
  });

  it('undoes a mistaken cancellation and refuses a stale undo', async () => {
    const s = fresh(); const w = await s.addSecurity(terms);
    const first = await s.cancelWarrant(w.id, { quantity: 20, date: '2025-01-01' });
    await first.undo(); expect(fd(s, '2025-06-01')).toBe(100);
    const second = await s.cancelWarrant(w.id, { quantity: 20, date: '2025-01-01' });
    await s.cancelWarrant(w.id, { quantity: 30, date: '2025-02-01' });
    await expect(second.undo()).rejects.toThrow(/changed/);
    expect(fd(s, '2025-06-01')).toBe(50);
  });

  it('undoes an exercise when its certificate is deleted, with a guarded delete undo', async () => {
    const s = fresh(); const w = await s.addSecurity(terms);
    const c = await exercise(s, w, 40);
    await expect(s.deleteSecurity(w.id)).rejects.toThrow(/Delete those certificates first/);
    const deleted = await s.deleteSecurity(c.id);
    expect(warrantExercised(w, s.securities)).toBe(0);
    expect(fd(s, '2025-06-01')).toBe(100);
    await deleted.undo();
    expect(warrantExercised(w, s.securities)).toBe(40);
    const again = await s.deleteSecurity(c.id);
    await s.cancelWarrant(w.id, { quantity: 80, date: '2025-02-01' });
    await expect(again.undo()).rejects.toThrow();
    expect(sharesOutstanding(s.securities)).toBe(0);
  });

  it('does not restore exercised rights after transfers or repurchases', async () => {
    const s = fresh(); const w = await s.addSecurity(terms);
    const c = await exercise(s, w, 40);
    await s.transferShares(c.id, { date: '2025-03-01', quantity: 20, pricePerShare: 3, to: { stakeholderId: 'buyer' } });
    expect(s.securities.filter((x) => x.fromTransferId === c.id).every((x) => x.fromWarrantId === w.id)).toBe(true);
    expect(warrantExercised(w, s.securities)).toBe(40);
    expect(fd(s, '2025-06-01')).toBe(100);
    await expect(s.deleteStakeholder('holder')).rejects.toThrow();
    const leg = s.securities.find((x) => x.fromTransferId === c.id && x.stakeholderId === 'holder');
    await s.transferShares(leg.id, { date: '2025-04-01', quantity: 20, pricePerShare: 2, to: 'company' });
    expect(fd(s, '2025-06-01')).toBe(80);
    expect(fd(s, '2025-02-01')).toBe(100);
  });

  it.each([[2, 1], [1, 3], [1, 100]])('survives a %i-for-%i split, reload, and historical rewind', async (num, den) => {
    const s = fresh(); const w = await s.addSecurity(terms);
    await exercise(s, w, 30, '2024-06-01');
    await exercise(s, w, 30, '2024-07-01');
    await s.cancelWarrant(w.id, { quantity: 10, date: '2024-08-01' });
    await s.recordSplit({ num, den, date: '2025-02-01' });
    const data = Store.sanitizeSnapshot(JSON.parse(JSON.stringify(s.exportAll())));
    const before = dbAsOf(data, '2025-01-01');
    expect(fullyDiluted(before.securities, before.company)).toBe(90);
    const current = dbAsOf(data, '2025-06-01');
    expect(warrantsOutstanding(current.securities)).toBe(Math.max(1, Math.round(30 * num / den)));
    expect(fd(s, '2026-01-01')).toBe(sharesOutstanding(s.securities));
  });
});
