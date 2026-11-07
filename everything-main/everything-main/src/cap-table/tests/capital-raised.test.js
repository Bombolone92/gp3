import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/lib/store.js';
import { capitalRaised, dbAsOf, issuanceHistory, modelRound } from '../src/lib/captable.js';
import { capTableDigest } from '../src/lib/financing.js';
import { puterBackend } from './helpers/puter-kv.js';

let store, common, founder, investor;
beforeEach(async () => {
  puterBackend().install();
  store = new Store();
  await store.init();
  common = await store.addClass({ name: 'Common', kind: 'common' });
  founder = await store.addStakeholder({ name: 'Founder' });
  investor = await store.addStakeholder({ name: 'Investor' });
  await store.addSecurity({ kind: 'shares', classId: common.id, stakeholderId: founder.id,
    quantity: 1000, pricePerShare: 0, date: '2024-01-01' });
});
const historyCash = (db) => issuanceHistory(db).reduce((sum, row) => sum + row.amount, 0);

describe('a split leaves paid-in capital where it stood', () => {
  it('keeps the cheque when whole-share rounding moves a certificate\'s count times price', async () => {
    await store.addSecurity({ kind: 'shares', classId: common.id, stakeholderId: founder.id, quantity: 9000, pricePerShare: 1, date: '2024-01-01' });
    const angel = await store.addSecurity({ kind: 'shares', classId: common.id, stakeholderId: investor.id, quantity: 7, pricePerShare: 100000, date: '2024-06-01' });
    expect(capitalRaised(store.securities)).toBe(709000);
    await store.recordSplit({ num: 1, den: 3, date: '2025-01-01' });
    expect(store.security(angel.id)).toMatchObject({ quantity: 2, pricePerShare: 300000, cashInvested: 700000 });
    expect(capitalRaised(store.securities)).toBe(709000);
    expect(historyCash(store.db)).toBe(709000);
    expect(capitalRaised(dbAsOf(store.db, '2024-12-01').securities)).toBe(709000);
    // A certificate that restated exactly carries nothing new.
    const founders = store.securities.find((s) => s.quantity === 3000);
    expect(founders.cashInvested).toBeUndefined();
  });
});
async function close(amount, { modeled = true } = {}) {
  const inputs = { preMoney: 1000000, investment: amount, poolPct: 0, asOf: '2025-01-01',
    financing: { id: 'round-a', roundMode: 'fixed', elections: [], mfnElections: [] } };
  const result = modelRound(store.db, inputs);
  const { certificates } = await store.closeRound({ date: inputs.asOf,
    newClass: { name: 'Series A', kind: 'preferred', liquidationMultiple: 1 },
    ...(modeled ? { modeling: { id: 'round-a', basisDigest: capTableDigest(store.db), inputs } } : {}),
    investors: [{ stakeholderId: investor.id, amount, quantity: result.investorShares, pricePerShare: result.pps }],
  });
  return certificates[0];
}

describe('capital raised uses the actual cash paid', () => {
  it.each([1500, 1499, 2000])('preserves a $%i check whether the share allocation rounds up, down, or exactly', async (amount) => {
    const cert = await close(amount);
    expect(cert.quantity).toBe(Math.round(amount / 1000));
    expect(cert.cashInvested).toBe(amount);
    expect(capitalRaised(store.securities)).toBe(amount);
    expect(historyCash(store.db)).toBe(amount);
    expect(capitalRaised(dbAsOf(store.db, '2024-12-31').securities)).toBe(0);
    const reloaded = new Store(); await reloaded.init();
    expect(capitalRaised(reloaded.securities)).toBe(amount);
    expect(historyCash(reloaded.db)).toBe(amount);
  });

  it('retains checks when closing without negotiated-model evidence', async () => {
    const cert = await close(1500, { modeled: false });
    expect(cert.cashInvested).toBe(1500);
    expect(capitalRaised(store.securities)).toBe(1500);
  });

  it('keeps confirmed cash through splits, transfers, repurchases and their undo', async () => {
    const cert = await close(1500);
    await store.recordSplit({ num: 1, den: 3, date: '2025-02-01' });
    const { buyerCert } = await store.transferShares(cert.id, { quantity: 1, date: '2025-03-01',
      pricePerShare: 9000, to: { stakeholderId: founder.id } });
    const removed = await store.deleteSecurity(buyerCert.id);
    expect(capitalRaised(store.securities)).toBe(1500);
    await removed.undo();
    expect(capitalRaised(store.securities)).toBe(1500);
    await store.transferShares(buyerCert.id, { quantity: 1, date: '2025-04-01', pricePerShare: 8000, to: 'company' });
    for (const date of ['2025-01-01', '2025-02-01', '2025-03-01', '2025-04-01']) {
      const db = dbAsOf(store.db, date);
      expect(capitalRaised(db.securities)).toBe(1500);
      expect(historyCash(db)).toBe(1500);
    }
  });

  it('keeps legacy prices, zero cash and convertible principal distinct', () => {
    const securities = [
      { id: 'legacy', kind: 'shares', quantity: 10, pricePerShare: 3, date: '2024-01-01' },
      { id: 'zero', kind: 'shares', quantity: 10, pricePerShare: 3, cashInvested: 0, date: '2024-01-01' },
      { id: 'note', kind: 'note', principal: 100, date: '2024-01-01', convertedAt: '2025-01-01' },
      { id: 'converted', kind: 'shares', fromConvertibleId: 'note', quantity: 11, pricePerShare: 10,
        cashInvested: 110, date: '2025-01-01' },
    ];
    expect(capitalRaised(securities)).toBe(130);
    expect(historyCash({ securities })).toBe(130);
    expect(capitalRaised([securities[3]])).toBe(110);
  });
});
