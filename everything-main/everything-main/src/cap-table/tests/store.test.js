import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('../src/lib/kv.js', async (importOriginal) =>
  (await import('./helpers/conditional-kv.js')).conditionalKVMock(importOriginal));
import { Store, CompanyChangedError, ListFullError, StaleWriteError, isRefusal, MAX_SECURITIES, MAX_STAKEHOLDERS, MAX_VESTING_TRANCHES } from '../src/lib/store.js';
import {
  convertibles, capitalRaised, sharesOutstanding, modelRound, dbAsOf, status83b, vestedQuantity,
  antiDilutionAdjustments, conversionPriceOf, grantOutstanding, acceleratedVested,
  certifiedByGrant, poolDrawn, fullyDiluted, repurchaseTerms, vestingPosition, vestingCeiling, rsuOutstanding, rsuVested, grantVested,
  exerciseAheadOfVesting, grantExercised, grantStatus, grantDiluted, attentionItems, MAX_VESTING_MONTHS,
  hasVesting,
} from '../src/lib/captable.js';
import { form3921Report } from '../src/lib/reports.js';

/** A live Store against an in-memory Puter KV stub. */
function makeStore() {
  const kv = new Map();
  globalThis.puter = {
    kv: {
      get: async (k) => (kv.has(k) ? kv.get(k) : null),
      set: async (k, v) => { kv.set(k, v); return true; },
    },
    auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
  };
  const s = new Store();
  s.stakeholders = Store.sanitizeStakeholders([
    { id: 'h1', name: 'Ada', kind: 'founder' },
    { id: 'h2', name: 'Grace', kind: 'founder' },
  ]);
  s.classes = Store.sanitizeClasses([{ id: 'c1', name: 'Common Stock', kind: 'common' }]);
  s.securities = Store.sanitizeSecurities([
    { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 100, date: '2024-01-01' },
    { id: 's2', kind: 'shares', label: 'CS-2', stakeholderId: 'h2', classId: 'c1', quantity: 50, date: '2024-01-02' },
  ], { classes: s.classes, stakeholders: s.stakeholders });
  return s;
}

describe('the company-wide record ceilings', () => {
  it('refuses a backup or an import that would put a company past what it keeps', async () => {
    /* The JSON import is bounded by bytes, and a minimal record is a few
       dozen of them: a 20 MB backup brought in 250,000 securities, stored
       across 140 parts and rewritten whole on every later edit. */
    const s = makeStore();
    const many = (n) => Array.from({ length: n }, (_, i) => ({ kind: 'option', stakeholderId: 'h1', quantity: 1, strike: 1, date: '2024-01-01', id: `o${i}`, label: `OPT-${i}` }));
    const base = { company: s.company, classes: s.classes, stakeholders: s.stakeholders };
    await expect(s.importAll({ ...base, securities: many(MAX_SECURITIES + 1) }))
      .rejects.toThrow('This company would hold 25,001 securities, more than the 25,000 it can keep.');
    expect(s.securities).toHaveLength(2);
    const holders = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Person ${i}`, kind: 'employee' }));
    await expect(s.importAll({ ...base, stakeholders: holders(MAX_STAKEHOLDERS + 1), securities: [] }))
      .rejects.toThrow(/10,001 stakeholders, more than the 10,000/);
    await s.importAll({ ...base, securities: many(MAX_SECURITIES) }, { label: 'x' });
    expect(s.securities).toHaveLength(MAX_SECURITIES);
    await expect(s.addSecurity({ kind: 'option', stakeholderId: 'h1', quantity: 1, strike: 1, date: '2024-01-01' }))
      .rejects.toThrow(/25,001 securities/);
    await expect(s.importRecords({ securities: [{ kind: 'option', stakeholderName: 'Ada', quantity: 1, strike: 1, date: '2024-01-01' }] }))
      .rejects.toThrow(/25,001 securities/);
    expect(s.securities).toHaveLength(MAX_SECURITIES);
  });
});

describe('sanitizer primitives over hostile JSON', () => {
  it('reads an object where a text or a figure belongs as nothing, not a TypeError', () => {
    /* String() and Number() throw on {"toString": 1}; a backup carrying one
       in any field took the import down with a TypeError that the settings
       sheet reported as a connection problem. */
    const hostile = { toString: 1 };
    expect(Store.sanitizeStakeholders([{ name: hostile, kind: 'founder' }])).toEqual([]);
    expect(Store.sanitizeStakeholders([{ name: 'Ada', email: hostile, kind: ['x'] }])[0]).toMatchObject({ name: 'Ada', email: '', kind: 'employee' });
    expect(Store.sanitizeClasses([{ name: 'Common', kind: 'common', pricePerShare: hostile, authorized: [1, 2] }])[0])
      .toMatchObject({ name: 'Common', pricePerShare: 0 });
    const company = Store.sanitizeCompany({ name: hostile, poolAuthorized: hostile, valuations: [{ id: 'v', date: '2026-01-01', fmvPerShare: hostile, note: hostile }] });
    expect(company.name).toBe('');
    expect(company.poolAuthorized).toBe(0);
    expect(Store.sanitizeActivity([{ text: hostile, icon: hostile, at: hostile }])).toEqual([]);
  });
});

describe('security writes after a reference changes in another tab', () => {
  async function tabs() {
    makeStore();
    const first = new Store();
    await first.init();
    const cls = await first.addClass({ name: 'Common Stock', kind: 'common' });
    const holder = await first.addStakeholder({ name: 'Ada', kind: 'founder' });
    const grant = await first.addSecurity({ kind: 'option', stakeholderId: holder.id,
      quantity: 100, strike: 1, date: '2025-01-01', vestingMonths: 0 });
    const second = new Store();
    await second.init();
    return { first, second, cls, holder, grant };
  }

  it.each(['shares', 'warrant', 'rsu'])('refuses issuing %s into a deleted class before saving', async (kind) => {
    const { first, second, cls, holder } = await tabs();
    await first.deleteClass(cls.id);
    const before = JSON.stringify(second.securities);
    await expect(second.addSecurity({ kind, stakeholderId: holder.id, classId: cls.id,
      quantity: 10, date: '2025-02-01',
    })).rejects.toThrow(/changed somewhere else/);
    expect(second.isStale).toBe(true);
    expect(JSON.stringify(second.securities)).toBe(before);
    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.classes).toEqual([]);
    expect(reloaded.securities).toEqual(first.securities);
  });

  it('refuses exercising into a deleted class without consuming options', async () => {
    const { first, second, cls, grant } = await tabs();
    await first.deleteClass(cls.id);
    await expect(second.exerciseOption(grant.id, { quantity: 10, date: '2025-02-01',
      classId: cls.id,
    })).rejects.toThrow(/changed somewhere else/);
    expect(second.security(grant.id).exercised).toBe(0);
    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.securities).toEqual(first.securities);
  });

  it('continues to issue and exercise after reloading the current classes', async () => {
    const { first, second, cls, holder, grant } = await tabs();
    await first.updateClass(cls.id, { name: 'Common' });
    await second.init();
    await second.addSecurity({ kind: 'shares', stakeholderId: holder.id, classId: cls.id,
      quantity: 10, date: '2025-02-01' });
    await second.exerciseOption(grant.id, { quantity: 10, date: '2025-02-01', classId: cls.id });
    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.securities).toEqual(second.securities);
    expect(sharesOutstanding(reloaded.securities)).toBe(20);
  });

  it('refuses moving a certificate into a class deleted by another tab', async () => {
    const { first, second, cls, holder } = await tabs();
    const other = await first.addClass({ name: 'Other Common', kind: 'common' });
    const cert = await first.addSecurity({ kind: 'shares', stakeholderId: holder.id,
      classId: cls.id, quantity: 10, date: '2025-02-01' });
    await second.init();
    await first.deleteClass(other.id);
    await expect(second.updateSecurity(cert.id, { classId: other.id }))
      .rejects.toThrow(/changed somewhere else/);
    expect(second.security(cert.id).classId).toBe(cls.id);
  });

  it('refuses issuing to a deleted holder even when the securities key did not change', async () => {
    const { first, second, cls } = await tabs();
    const other = await first.addStakeholder({ name: 'Grace' });
    await second.init();
    const key = `captable:${first.activeCompanyId}:securities:v1`;
    const before = await puter.kv.get(key);
    await first.deleteStakeholder(other.id);
    expect(await puter.kv.get(key)).toBe(before);
    await expect(second.addSecurity({ kind: 'shares', stakeholderId: other.id,
      classId: cls.id, quantity: 10, date: '2025-02-01',
    })).rejects.toThrow(/changed somewhere else/);
    expect(second.isStale).toBe(true);
    expect(await puter.kv.get(key)).toBe(before);
  });
});

describe('offsetting splits', () => {
  it('restores rounded holdings even when the combined ratio is one', async () => {
    const s = makeStore();
    await s.updateSecurity('s1', { quantity: 15, pricePerShare: 2 });
    const original = dbAsOf(s.db, '2024-06-01');
    await s.recordSplit({ num: 1, den: 10, date: '2025-01-01' });
    await s.recordSplit({ num: 10, den: 1, date: '2026-01-01' });
    const old = dbAsOf(s.db, '2024-06-01');
    expect(sharesOutstanding(old.securities)).toBe(sharesOutstanding(original.securities));
    expect(capitalRaised(old.securities)).toBe(capitalRaised(original.securities));
    expect(s.security('s1').quantity).toBe(20);
  });
});

describe('historical custom vesting after splits', () => {
  it.each(['shares', 'option', 'rsu'])('preserves the original %s schedule through rounding and reload', async (kind) => {
    const s = makeStore();
    const tranches = [{ date: '2024-02-01', quantity: 1 }, { date: '2024-12-01', quantity: 99 }];
    const award = await s.addSecurity({ kind, stakeholderId: 'h1', classId: 'c1',
      quantity: 100, strike: 1, date: '2024-01-01', vestingTranches: tranches });
    await s.recordSplit({ num: 1, den: 2, date: '2025-01-01' });
    expect(s.security(award.id).vestingTranches).toEqual([{ date: '2024-12-01', quantity: 50 }]);
    await s.recordSplit({ num: 2, den: 1, date: '2026-01-01' });
    const reloaded = Store.sanitizeSnapshot(JSON.parse(JSON.stringify(s.exportAll())));
    const old = dbAsOf(reloaded, '2024-06-01').securities.find((a) => a.id === award.id);
    expect(old.quantity).toBe(100);
    expect(old.vestingTranches).toEqual(tranches);
    expect(vestedQuantity(old, '2024-06-01')).toBe(1);
    const between = dbAsOf(reloaded, '2025-06-01').securities.find((a) => a.id === award.id);
    expect(between.quantity).toBe(50);
    expect(between.vestingTranches).toEqual([{ date: '2024-12-01', quantity: 50 }]);
  });
});

describe('custom vesting tranche limit', () => {
  it('saves every supported tranche and refuses an extra tranche without changing the award', async () => {
    const s = makeStore();
    const tranches = Array.from({ length: MAX_VESTING_TRANCHES }, (_, i) => ({
      date: `${2010 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-01`, quantity: 1,
    }));
    const award = await s.addSecurity({ kind: 'option', stakeholderId: 'h1',
      quantity: MAX_VESTING_TRANCHES + 1, strike: 1, date: '2010-01-01', vestingTranches: tranches });
    expect(s.security(award.id).vestingTranches).toEqual(tranches);
    const before = JSON.stringify(s.securities);
    const tooMany = [...tranches, { date: '2020-01-01', quantity: 1 }];
    await expect(s.updateSecurity(award.id, { vestingTranches: tooMany })).rejects.toThrow(/600.*tranches/);
    expect(JSON.stringify(s.securities)).toBe(before);
    expect(() => Store.sanitizeSnapshot({ ...s.exportAll(),
      securities: [{ ...award, vestingTranches: tooMany }],
    })).toThrow(/600.*tranches/);
  });
});

describe('resizing custom vesting awards', () => {
  const tranches = [{ date: '2025-01-01', quantity: 50 }, { date: '2026-01-01', quantity: 50 }];

  it.each(['shares', 'option', 'rsu'])('requires resizing a %s schedule along with its holding', async (kind) => {
    const s = makeStore();
    const award = await s.addSecurity({ kind, stakeholderId: 'h1', classId: 'c1',
      quantity: 100, strike: 1, date: '2024-01-01', vestingTranches: tranches });
    await expect(s.updateSecurity(award.id, { quantity: 50 })).rejects.toThrow(/tranches.*more than/i);
    expect(s.security(award.id).quantity).toBe(100);
    expect(s.security(award.id).vestingTranches).toEqual(tranches);
    await s.updateSecurity(award.id, { quantity: 50,
      vestingTranches: tranches.map((t) => ({ ...t, quantity: 25 })),
    });
    expect(vestedQuantity(s.security(award.id), '2025-01-01')).toBe(25);
  });

  it('rejects an oversized new schedule but preserves the schedule left by a repurchase', async () => {
    const s = makeStore();
    const input = { kind: 'shares', stakeholderId: 'h1', classId: 'c1',
      quantity: 50, date: '2024-01-01', pricePerShare: 1, vestingTranches: tranches };
    await expect(s.addSecurity(input)).rejects.toThrow(/tranches.*more than/i);
    const cert = await s.addSecurity({ ...input, quantity: 100 });
    await s.transferShares(cert.id, { quantity: 20, to: 'company', date: '2024-06-01', pricePerShare: 1 });
    const remainder = s.securities.find((a) => a.fromTransferId === cert.id);
    expect(remainder.quantity).toBe(80);
    await s.updateSecurity(remainder.id, { pricePerShare: 2 });
    expect(s.security(remainder.id).vestingTranches).toEqual(tranches);
    expect(vestedQuantity(s.security(remainder.id), '2025-01-01')).toBe(50);
    await expect(s.updateSecurity(remainder.id, { vestingTranches: [...tranches,
      { date: '2027-01-01', quantity: 1 }],
    })).rejects.toThrow(/tranches.*more than/i);
  });
});

describe('stock split history limit', () => {
  it('refuses a 41st split before changing holdings or restore points', async () => {
    const s = makeStore();
    for (let i = 0; i < 40; i++) {
      await s.recordSplit({ num: i % 2 ? 1 : 2, den: i % 2 ? 2 : 1,
        date: `${2020 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-01` });
    }
    expect(s.company.splits).toHaveLength(40);
    const before = Store.sanitizeSnapshot(s.exportAll());
    const restores = JSON.stringify(s.restorePoints);
    await expect(s.recordSplit({ num: 2, den: 1, date: '2025-01-01' })).rejects.toThrow(/40.*splits/);
    expect(Store.sanitizeSnapshot(s.exportAll())).toEqual(before);
    expect(JSON.stringify(s.restorePoints)).toBe(restores);
    expect(() => Store.sanitizeCompany({ ...s.company,
      splits: [...s.company.splits, { date: '2025-01-01', num: 2, den: 1 }],
    })).toThrow(/40.*splits/);
  });
});

describe('certificate date edits', () => {
  it.each(['option', 'rsu'])('keeps a %s certificate on or after its award date', async (kind) => {
    const s = makeStore();
    const award = await s.addSecurity({ kind, stakeholderId: 'h1', classId: 'c1',
      quantity: 100, strike: 1, date: '2025-01-01', vestingMonths: 0 });
    const cert = kind === 'option'
      ? await s.exerciseOption(award.id, { quantity: 10, date: '2025-06-01', classId: 'c1' })
      : await s.settleRSU(award.id, { quantity: 10, date: '2025-06-01' });
    await expect(s.updateSecurity(cert.id, { date: '2024-12-31' })).rejects.toThrow(/precede.*award/i);
    expect(s.security(cert.id).date).toBe('2025-06-01');
    await s.updateSecurity(cert.id, { date: '2025-01-01' });
    expect(s.security(cert.id).date).toBe('2025-01-01');
  });

  it('refuses an exercise window that closes before an exercise already recorded', async () => {
    /* A departure entered after the fact with a deadline before an exercise
       that had already happened, or an expiration edited back past one, left
       the grant reading as expired - on the needs-attention list, offering
       to cancel options that had in fact been bought. */
    const s = makeStore();
    const g = await s.addSecurity({ kind: 'option', stakeholderId: 'h1', quantity: 1000, strike: 1, date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 12, expires: '2034-01-01' });
    const cert = await s.exerciseOption(g.id, { quantity: 200, date: '2025-08-15', classId: 'c1' });
    await expect(s.markDeparted('h1', { date: '2025-06-01', grants: [{ id: g.id, cancelQty: 646, exerciseBy: '2025-07-01' }] }))
      .rejects.toThrow(`${cert.label} was exercised from OPT-1 on 2025-08-15, after the exercise deadline of 2025-07-01.`);
    expect(s.stakeholder('h1').departed).toBeUndefined();
    expect(s.security(g.id).cancelled).toBeUndefined();
    await expect(s.updateSecurity(g.id, { expires: '2025-02-01' })).rejects.toThrow(/after the expiration of 2025-02-01/);
    expect(s.security(g.id).expires).toBe('2034-01-01');
    // The exercise date itself is inside the window, and an edit that leaves
    // the window alone never trips over the rule.
    await s.markDeparted('h1', { date: '2025-06-01', grants: [{ id: g.id, cancelQty: 646, exerciseBy: '2025-08-15' }] });
    expect(s.security(g.id).exerciseBy).toBe('2025-08-15');
    await s.updateSecurity(g.id, { strike: 1.5 });
    expect(s.security(g.id).strike).toBe(1.5);
  });

  it('keeps an exercise certificate inside the window it was exercised in', async () => {
    /* The mirror of the window guard above: an exercise is refused after the
       cutoff and a window is refused that closes before an exercise, but the
       certificate's own date could still be moved past the window - leaving
       the grant expired with unexercised options beside its own certificate
       saying they were bought after the right to buy them had lapsed. */
    const s = makeStore();
    const g = await s.addSecurity({ kind: 'option', stakeholderId: 'h1', quantity: 1000, strike: 1, date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 0, expires: '2026-06-30' });
    const cert = await s.exerciseOption(g.id, { quantity: 100, date: '2025-01-01', classId: 'c1' });
    await expect(s.updateSecurity(cert.id, { date: '2026-07-01' }))
      .rejects.toThrow(`${cert.label} can’t be dated after the expiration of OPT-1, 2026-06-30.`);
    expect(s.security(cert.id).date).toBe('2025-01-01');
    // The last day of the window is fine.
    await s.updateSecurity(cert.id, { date: '2026-06-30' });
    expect(s.security(cert.id).date).toBe('2026-06-30');
    // A post-termination deadline closes the window earlier, and binds the same way.
    await s.updateSecurity(cert.id, { date: '2025-01-01' });
    await s.markDeparted('h1', { date: '2025-02-01', grants: [{ id: g.id, cancelQty: 0, exerciseBy: '2025-04-01' }] });
    await expect(s.updateSecurity(cert.id, { date: '2025-05-01' }))
      .rejects.toThrow(`${cert.label} can’t be dated after the exercise deadline of OPT-1, 2025-04-01.`);
    expect(s.security(cert.id).date).toBe('2025-01-01');
    // A certificate imported already past the window keeps its other fields editable.
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'late', kind: 'shares', label: 'CS-9', stakeholderId: 'h1', classId: 'c1', quantity: 10, pricePerShare: 1, date: '2026-09-01', fromOptionId: g.id },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    await s.updateSecurity('late', { pricePerShare: 2 });
    expect(s.security('late')).toMatchObject({ pricePerShare: 2, date: '2026-09-01' });
  });

  it('refuses a post-termination deadline dated before the departure that set it', async () => {
    const s = makeStore();
    const g = await s.addSecurity({ kind: 'option', stakeholderId: 'h1', quantity: 1000, strike: 1, date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 12 });
    await s.markDeparted('h1', { date: '2025-06-01', grants: [{ id: g.id, cancelQty: 646, exerciseBy: '2025-08-30' }] });
    await expect(s.updateSecurity(g.id, { exerciseBy: '2025-05-15' }))
      .rejects.toThrow('Ada departed on 2025-06-01, so OPT-1’s exercise deadline can’t precede it.');
    expect(s.security(g.id).exerciseBy).toBe('2025-08-30');
    // Moving it later, or editing something else with the deadline as it stands, is fine.
    await s.updateSecurity(g.id, { exerciseBy: '2025-09-30' });
    await s.updateSecurity(g.id, { strike: 2 });
    expect(s.security(g.id)).toMatchObject({ exerciseBy: '2025-09-30', strike: 2 });
    // A deadline imported before the departure stays editable otherwise.
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'imp', kind: 'option', label: 'OPT-9', stakeholderId: 'h1', quantity: 10, strike: 1, grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 0, exerciseBy: '2025-03-01' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    await s.updateSecurity('imp', { strike: 3 });
    expect(s.security('imp')).toMatchObject({ strike: 3, exerciseBy: '2025-03-01' });
  });

  it('refuses to move an award past a forfeiture or deadline already recorded on it', async () => {
    /* A departure dated before a grant and a cancellation before its award
       are both refused, but moving the award afterwards walked over that: a
       grant re-dated past its own forfeiture read as expired with nothing
       ever vested, and its forfeiture predated it. */
    const s = makeStore();
    const g = await s.addSecurity({ kind: 'option', stakeholderId: 'h1', quantity: 1000, strike: 1, date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 12 });
    await s.markDeparted('h1', { date: '2025-06-01', grants: [{ id: g.id, cancelQty: 646, exerciseBy: '2025-08-30' }] });
    await expect(s.updateSecurity(g.id, { date: '2025-06-02', grantDate: '2025-06-02' }))
      .rejects.toThrow(/OPT-1 had 646 options cancelled on 2025-06-01, so its date can’t move past it/);
    expect(s.security(g.id).grantDate).toBe('2024-01-01');
    // Up to the forfeiture is fine, and past the deadline alone is refused too.
    await s.updateSecurity(g.id, { date: '2025-06-01', grantDate: '2025-06-01' });
    await s.updateSecurity(g.id, { cancelled: 0, cancelledDate: '', cancellations: [] });
    await expect(s.updateSecurity(g.id, { date: '2025-09-01', grantDate: '2025-09-01' }))
      .rejects.toThrow(/deadline is 2025-08-30, so its date can’t move past it/);
    expect(s.security(g.id).grantDate).toBe('2025-06-01');
    // An RSU award, the same way.
    const a = await s.addSecurity({ kind: 'rsu', stakeholderId: 'h2', classId: 'c1', quantity: 100, date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 12 });
    await s.updateSecurity(a.id, { cancellations: [{ quantity: 40, date: '2024-06-01' }] });
    await expect(s.updateSecurity(a.id, { date: '2024-07-01', grantDate: '2024-07-01' }))
      .rejects.toThrow(/RSU-1 had 40 units cancelled on 2024-06-01/);
    expect(s.security(a.id).grantDate).toBe('2024-01-01');
  });

  it('moves a conversion date with the certificate the instrument became', async () => {
    /* Moved apart, every snapshot between the two dates showed the SAFE's
       money nowhere (certificate later) or twice (certificate earlier), and
       the issuance history grew a zero-dollar financing on the new day. */
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'sf', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h2', principal: 100_000, valuationCap: 4_000_000, safeType: 'post', date: '2025-01-01', convertedAt: '2026-01-01', convertedToId: 'x1' },
      { id: 'x1', kind: 'shares', label: 'CS-3', stakeholderId: 'h2', classId: 'c1', quantity: 25_000, pricePerShare: 4, date: '2026-01-01', fromConvertibleId: 'sf' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    const between = (asOf) => {
      const db = dbAsOf(s.db, asOf);
      return { live: convertibles(db.securities).length, shares: sharesOutstanding(db.securities) - 150 };
    };
    await s.updateSecurity('x1', { date: '2026-06-01' });
    expect(s.security('sf').convertedAt).toBe('2026-06-01');
    expect(between('2026-03-01')).toEqual({ live: 1, shares: 0 });
    expect(between('2026-06-01')).toEqual({ live: 0, shares: 25_000 });
    await s.updateSecurity('x1', { date: '2025-06-01' });
    expect(s.security('sf').convertedAt).toBe('2025-06-01');
    expect(between('2025-09-01')).toEqual({ live: 0, shares: 25_000 });
    expect(between('2025-05-01')).toEqual({ live: 1, shares: 0 });
    // Never before the instrument was signed, and the instrument itself is
    // left alone by an edit that does not touch the date.
    await expect(s.updateSecurity('x1', { date: '2024-12-31' })).rejects.toThrow(/precede the SAFE it converted from/);
    await s.updateSecurity('x1', { pricePerShare: 5 });
    expect(s.security('sf').convertedAt).toBe('2025-06-01');
    // A transfer successor of the certificate carries the link but not the
    // conversion; its date is settled by the transfer anyway.
    const { buyerCert } = await s.transferShares('x1', { date: '2026-02-01', quantity: 5_000, to: { stakeholderId: 'h1' } });
    await s.updateSecurity(buyerCert.id, { date: '2026-03-01' });
    expect(s.security('sf').convertedAt).toBe('2025-06-01');
  });

  it.each(['option', 'rsu'])('refuses a forfeiture dated before the %s award it forfeits', async (kind) => {
    /* The cancel form and the departure flow both refuse the date; the store
       accepted it, froze the vesting clock on a day it had not started, and
       read the award as never vesting a single unit. */
    const s = makeStore();
    const a = await s.addSecurity({ kind, stakeholderId: 'h1', classId: 'c1', quantity: 1000, strike: 1, date: '2024-06-01', grantDate: '2024-06-01', vestingMonths: 48, cliffMonths: 0 });
    await expect(s.updateSecurity(a.id, { cancellations: [{ quantity: 100, date: '2024-01-01' }] }))
      .rejects.toThrow(`${a.label} was granted on 2024-06-01, so 100 ${kind === 'rsu' ? 'units' : 'options'} can’t be cancelled from it on 2024-01-01.`);
    expect(s.security(a.id).cancelled).toBeUndefined();
    expect(vestedQuantity(s.security(a.id), '2026-06-01')).toBe(500);
    // On the grant date, or after it, is fine.
    await s.updateSecurity(a.id, { cancellations: [{ quantity: 100, date: '2024-06-01' }] });
    expect(s.security(a.id)).toMatchObject({ cancelled: 100, cancelledDate: '2024-06-01' });
    // An award imported with an earlier forfeiture stays editable, and its
    // history is left as it stands.
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'imp', kind, label: 'IMP-1', stakeholderId: 'h2', classId: 'c1', quantity: 100, strike: 1, date: '2024-06-01', grantDate: '2024-06-01', vestingMonths: 12, cancellations: [{ quantity: 10, date: '2024-01-01' }] },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    await s.updateSecurity('imp', { quantity: 120 });
    expect(s.security('imp')).toMatchObject({ quantity: 120, cancelled: 10, cancelledDate: '2024-01-01' });
    await s.updateSecurity('imp', { cancellations: [{ quantity: 10, date: '2024-01-01' }, { quantity: 20, date: '2025-01-01' }] });
    expect(s.security('imp').cancelled).toBe(30);
  });

  it('keeps a converted instrument and its certificate on the same side of the conversion', async () => {
    /* Dated past its own conversion, a note left a snapshot between the two
       dates showing its shares outstanding with no note anywhere, and capital
       raised swapped the cheque for shares x conversion price - the accrued
       interest counted as money received. */
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'n1', kind: 'note', label: 'CN-1', stakeholderId: 'h1', principal: 100_000, interestRate: 8, date: '2025-01-01', convertedAt: '2026-01-01', convertedToId: 'x1' },
      { id: 'x1', kind: 'shares', label: 'CS-3', stakeholderId: 'h1', classId: 'c1', quantity: 108_000, pricePerShare: 1, date: '2026-01-01', fromConvertibleId: 'n1' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    await expect(s.updateSecurity('n1', { date: '2026-03-01' })).rejects.toThrow(/converted on 2026-01-01, so its date can’t move past it/);
    expect(s.security('n1').date).toBe('2025-01-01');
    await expect(s.updateSecurity('x1', { date: '2024-12-31' })).rejects.toThrow(/precede the note it converted from \(2025-01-01\)/);
    expect(s.security('x1').date).toBe('2026-01-01');
    // Up to the conversion date on one side, and from the signing on the other, is fine.
    await s.updateSecurity('n1', { date: '2026-01-01' });
    await s.updateSecurity('x1', { date: '2026-01-01' });
    // The note's principal, never the certificate's shares x price.
    expect(capitalRaised(s.securities)).toBe(100_000);
    // An edit that leaves the date alone never trips over a record imported in that state.
    s.securities = Store.sanitizeSecurities(s.securities.map((x) => (x.id === 'n1' ? { ...x, date: '2026-06-01' } : x)),
      { classes: s.classes, stakeholders: s.stakeholders });
    await s.updateSecurity('n1', { maturedAt: '2026-07-01' });
    expect(s.security('n1').maturedAt).toBe('2026-07-01');
  });
});

describe('Store.sanitizeCompany', () => {
  it('fills defaults for missing or malformed input', () => {
    expect(Store.sanitizeCompany(null)).toEqual({
      name: '', entityType: 'C-Corp', jurisdiction: 'Delaware', currency: 'USD',
      incorporated: '', plans: [], poolAuthorized: 0, poolHistory: [], valuations: [], splits: [],
      reporting: {
        volatility: 0, riskFreeRate: 0, expectedTermYears: 0, attribution: 'straight',
        fiscalYearEnd: 12, totalAssets: 0,
      },
    });
  });

  it('keeps the pool history that dates each resize, and drops what is not one', () => {
    const { poolHistory } = Store.sanitizeCompany({
      poolAuthorized: 900,
      poolHistory: [
        { date: '2024-06-10', before: 0, after: 500, seq: 1 },
        { date: '2025-01-01', before: 500, after: 500 },   // not a change
        { before: 500, after: 900 },                        // undated
        null,
        { date: '2026-01-01T12:00:00Z', before: '500', after: 900 },
      ],
    });
    expect(poolHistory).toEqual([
      { date: '2024-06-10', before: 0, after: 500, seq: 1 },
      { date: '2026-01-01', before: 500, after: 900 },
    ]);
  });

  it('bounds the reporting assumptions and falls back where they make no sense', () => {
    const { reporting } = Store.sanitizeCompany({
      reporting: {
        volatility: '65', riskFreeRate: 4.2, expectedTermYears: 6.25,
        attribution: 'graded', fiscalYearEnd: 6, totalAssets: '2100000',
      },
    });
    expect(reporting).toEqual({
      volatility: 65, riskFreeRate: 4.2, expectedTermYears: 6.25, attribution: 'graded',
      fiscalYearEnd: 6, totalAssets: 2_100_000,
    });
    const wild = Store.sanitizeCompany({
      reporting: { volatility: 9_000, riskFreeRate: -50, expectedTermYears: -1, attribution: 'linear', fiscalYearEnd: 13, totalAssets: -5 },
    }).reporting;
    expect(wild).toEqual({
      volatility: 500, riskFreeRate: -10, expectedTermYears: 0, attribution: 'straight', fiscalYearEnd: 12, totalAssets: 0,
    });
    // A company written before the field existed reads as "not set yet".
    expect(Store.sanitizeCompany({ name: 'Old Co' }).reporting).toEqual(Store.defaultReporting());
  });

  it('keeps a well-formed currency code and falls back to USD otherwise', () => {
    expect(Store.sanitizeCompany({ currency: 'gbp' }).currency).toBe('GBP');
    expect(Store.sanitizeCompany({ currency: 'ZZZ' }).currency).toBe('USD');
    expect(Store.sanitizeCompany({ currency: 'dollars' }).currency).toBe('USD');
    expect(Store.sanitizeCompany({}).currency).toBe('USD');
  });

  it('coerces the pool to a non-negative integer', () => {
    expect(Store.sanitizeCompany({ poolAuthorized: '1500000.7' }).poolAuthorized).toBe(1500001);
    expect(Store.sanitizeCompany({ poolAuthorized: -5 }).poolAuthorized).toBe(0);
  });

  it('keeps 409A history newest first and drops priceless entries', () => {
    const { valuations } = Store.sanitizeCompany({
      valuations: [
        { date: '2023-06-01', fmvPerShare: 0.02 },
        { date: '2025-01-01', fmvPerShare: 0.22, note: 'Post-Seed' },
        { date: '2024-01-01', fmvPerShare: 0 },
        { fmvPerShare: 0.5 },
        'nope',
      ],
    });
    expect(valuations.map((v) => v.date)).toEqual(['2025-01-01', '2023-06-01']);
    expect(valuations[0]).toMatchObject({ fmvPerShare: 0.22, note: 'Post-Seed' });
    expect(valuations.every((v) => v.id)).toBe(true);
  });
});

describe('Store.sanitizeClasses', () => {
  it('drops nameless entries and normalizes kinds', () => {
    const out = Store.sanitizeClasses([
      { name: 'Common Stock', kind: 'weird' },
      { name: '' },
      null,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('common');
    expect(out[0].id).toBeTruthy();
  });

  it('keeps preference terms only on preferred classes', () => {
    const [common] = Store.sanitizeClasses([{ name: 'Common', kind: 'common', liquidationMultiple: 2 }]);
    expect(common.liquidationMultiple).toBe(0);
    const [pref] = Store.sanitizeClasses([{ name: 'Series A', kind: 'preferred', liquidationMultiple: 2 }]);
    expect(pref.liquidationMultiple).toBe(2);
  });
});

describe('Store.sanitizeSecurities', () => {
  it('holds a time-based schedule to the longest one a record keeps', () => {
    /* Unbounded, a 1e9-month import kept the expense report walking the
       schedule month by month for as long as the tab stayed open. */
    const ctx = { classes: [{ id: 'c1', name: 'C' }], stakeholders: [{ id: 'h1', name: 'Ada' }] };
    const [cert, grant, award] = Store.sanitizeSecurities([
      { kind: 'shares', stakeholderId: 'h1', classId: 'c1', quantity: 10, vestingMonths: 1e9, cliffMonths: 1e8 },
      { kind: 'option', stakeholderId: 'h1', quantity: 10, vestingMonths: 1e9, cliffMonths: 12 },
      { kind: 'rsu', stakeholderId: 'h1', classId: 'c1', quantity: 10, vestingMonths: 601, cliffMonths: 601 },
    ], ctx);
    expect(MAX_VESTING_MONTHS).toBe(600);
    expect([cert.vestingMonths, cert.cliffMonths]).toEqual([600, 600]);
    expect([grant.vestingMonths, grant.cliffMonths]).toEqual([600, 12]);
    expect([award.vestingMonths, award.cliffMonths]).toEqual([600, 600]);
    // A schedule inside the limit is kept as written.
    expect(Store.sanitizeSecurities([{ kind: 'option', stakeholderId: 'h1', quantity: 10, vestingMonths: 600, cliffMonths: 12 }], ctx)[0].vestingMonths).toBe(600);
  });

  const ctx = {
    classes: [{ id: 'c1', name: 'Common' }],
    stakeholders: [{ id: 'h1', name: 'Ada' }],
  };

  it('drops securities whose holder or class is missing', () => {
    const out = Store.sanitizeSecurities([
      { kind: 'shares', stakeholderId: 'h1', classId: 'c1', quantity: 100 },
      { kind: 'shares', stakeholderId: 'ghost', classId: 'c1', quantity: 100 },
      { kind: 'shares', stakeholderId: 'h1', classId: 'ghost', quantity: 100 },
    ], ctx);
    expect(out).toHaveLength(1);
  });

  it('drops zero-quantity and zero-principal instruments', () => {
    const out = Store.sanitizeSecurities([
      { kind: 'shares', stakeholderId: 'h1', classId: 'c1', quantity: 0 },
      { kind: 'safe', stakeholderId: 'h1', principal: 0 },
    ], ctx);
    expect(out).toHaveLength(0);
  });

  it('clamps exercised options to the granted quantity', () => {
    const [opt] = Store.sanitizeSecurities([
      { kind: 'option', stakeholderId: 'h1', quantity: 100, exercised: 500 },
    ], ctx);
    expect(opt.exercised).toBe(100);
  });

  it('keeps custom tranches sorted, and lets them displace the time-based fields', () => {
    const [opt] = Store.sanitizeSecurities([{
      kind: 'option', stakeholderId: 'h1', quantity: 100, vestingMonths: 48, cliffMonths: 12,
      vestingTranches: [
        { date: '2026-06-01', quantity: 60 },
        { date: '2025-06-01', quantity: 40 },
        { date: '2025-07-01', quantity: 0 },
        { quantity: 10 },
      ],
    }], ctx);
    expect(opt.vestingTranches).toEqual([
      { date: '2025-06-01', quantity: 40 },
      { date: '2026-06-01', quantity: 60 },
    ]);
    expect(opt.vestingMonths).toBe(0);
  });

  it('stores frequency and acceleration only alongside a schedule', () => {
    const [stepped, flat] = Store.sanitizeSecurities([
      { kind: 'option', stakeholderId: 'h1', quantity: 100, vestingMonths: 48, vestingFrequency: 'quarterly', accelTrigger: 'double', accelPct: 50 },
      { kind: 'option', stakeholderId: 'h1', quantity: 100, vestingMonths: 0, vestingFrequency: 'quarterly', accelTrigger: 'single' },
    ], ctx);
    expect(stepped.vestingFrequency).toBe('quarterly');
    expect(stepped.accelTrigger).toBe('double');
    expect(stepped.accelPct).toBe(50);
    expect(flat.vestingFrequency).toBeUndefined();
    expect(flat.accelTrigger).toBeUndefined();
  });

  it('defaults acceleration to 100% and rides it on vesting certificates too', () => {
    const [cert] = Store.sanitizeSecurities([{
      kind: 'shares', stakeholderId: 'h1', classId: 'c1', quantity: 100,
      vestingMonths: 48, accelTrigger: 'single',
    }], ctx);
    expect(cert.accelTrigger).toBe('single');
    expect(cert.accelPct).toBe(100);
  });

  it('keeps cancellation and exercise disjoint, and only writes them when real', () => {
    const [clean, cancelled] = Store.sanitizeSecurities([
      { kind: 'option', stakeholderId: 'h1', quantity: 100, date: '2024-01-01' },
      { kind: 'option', stakeholderId: 'h1', quantity: 100, date: '2024-01-01', cancelled: 60, exercised: 90, expires: '2034-01-01' },
    ], ctx);
    expect(clean).not.toHaveProperty('cancelled');
    // 60 cancelled leaves 40; the claimed 90 exercised can't exceed that.
    expect(cancelled).toMatchObject({ cancelled: 60, exercised: 40, cancelledDate: '2024-01-01', expires: '2034-01-01' });
  });

  it('records where an exercised certificate came from', () => {
    const [cert] = Store.sanitizeSecurities([
      { kind: 'shares', stakeholderId: 'h1', classId: 'c1', quantity: 100, fromOptionId: 'o1' },
    ], ctx);
    expect(cert.fromOptionId).toBe('o1');
  });

  it('writes certificate vesting fields only when a schedule exists', () => {
    const [plain, vesting] = Store.sanitizeSecurities([
      { kind: 'shares', stakeholderId: 'h1', classId: 'c1', quantity: 100, date: '2024-01-01' },
      { kind: 'shares', stakeholderId: 'h1', classId: 'c1', quantity: 100, date: '2024-01-01', vestingMonths: 48, cliffMonths: 60 },
    ], ctx);
    expect(plain).not.toHaveProperty('vestingMonths');
    // A cliff longer than the schedule is clamped, and the start defaults to issuance.
    expect(vesting).toMatchObject({ vestingMonths: 48, cliffMonths: 48, vestingStart: '2024-01-01' });
  });

  it('keeps warrants with a real underlying class and drops the rest', () => {
    const out = Store.sanitizeSecurities([
      { kind: 'warrant', stakeholderId: 'h1', classId: 'c1', quantity: 1000, strike: 0.85, expires: '2035-01-01' },
      { kind: 'warrant', stakeholderId: 'h1', classId: 'ghost', quantity: 1000 },
      { kind: 'warrant', stakeholderId: 'h1', classId: 'c1', quantity: 0 },
    ], ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'warrant', classId: 'c1', quantity: 1000, strike: 0.85, expires: '2035-01-01' });
  });

  it('reads a SAFE without a type as pre-money, and keeps an explicit post', () => {
    const [legacy, post] = Store.sanitizeSecurities([
      { kind: 'safe', stakeholderId: 'h1', principal: 1000, valuationCap: 5e6 },
      { kind: 'safe', stakeholderId: 'h1', principal: 1000, valuationCap: 5e6, safeType: 'post' },
    ], ctx);
    expect(legacy.safeType).toBe('pre');
    expect(post.safeType).toBe('post');
  });

  it('keeps note interest and caps the discount below 100', () => {
    const [note] = Store.sanitizeSecurities([
      { kind: 'note', stakeholderId: 'h1', principal: 1000, interestRate: 8, discount: 150 },
    ], ctx);
    expect(note.interestRate).toBe(8);
    expect(note.discount).toBe(99);
  });
});

describe('Store undo semantics', () => {
  let s;
  beforeEach(() => { s = makeStore(); });

  it('undo of a security delete restores it', async () => {
    const { undo } = await s.deleteSecurity('s1');
    expect(s.security('s1')).toBeNull();
    await undo();
    expect(s.security('s1')).not.toBeNull();
    expect(s.securities).toHaveLength(2);
  });

  it('undo keeps securities issued while the toast was showing', async () => {
    const { undo } = await s.deleteSecurity('s1');
    const fresh = await s.addSecurity({ kind: 'shares', stakeholderId: 'h2', classId: 'c1', quantity: 10, date: '2026-01-01' });
    await undo();
    expect(s.security('s1')).not.toBeNull();
    expect(s.security(fresh.id)).not.toBeNull();
    expect(s.securities).toHaveLength(3);
  });

  it('undo puts back records a queued write added before the delete applied', async () => {
    /* The cascade is computed when the queue reaches the delete, so a record
       a write queued just ahead of it issued to the holder is removed too -
       and was missing from the undo, which was built from a list read at call
       time, before that write had applied. Gone, with no way back. */
    let release;
    const gate = new Promise((r) => { release = r; });
    const set = puter.kv.set;
    puter.kv.set = async (k, v) => { await gate; return set(k, v); };
    const added = s.addSecurity({ kind: 'warrant', stakeholderId: 'h1', classId: 'c1', quantity: 9, strike: 1, date: '2026-01-01' });
    const deleted = s.deleteStakeholder('h1');
    release();
    const warrant = await added;
    const { undo } = await deleted;
    expect(s.security(warrant.id)).toBeNull();
    expect(s.security('s1')).toBeNull();
    await undo();
    expect(s.stakeholder('h1')).not.toBeNull();
    expect(s.security('s1')).not.toBeNull();
    expect(s.security(warrant.id)).toMatchObject({ kind: 'warrant', quantity: 9 });
  });

  it('undo of a security delete puts back the record as a queued edit left it', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const set = puter.kv.set;
    puter.kv.set = async (k, v) => { await gate; return set(k, v); };
    const edited = s.updateSecurity('s1', { pricePerShare: 9 });
    const deleted = s.deleteSecurity('s1');
    release();
    await edited;
    const { undo } = await deleted;
    expect(s.security('s1')).toBeNull();
    await undo();
    expect(s.security('s1').pricePerShare).toBe(9);
  });

  it('undo is idempotent - running it twice never duplicates', async () => {
    const { undo } = await s.deleteSecurity('s1');
    await undo();
    await undo();
    expect(s.securities.filter((x) => x.id === 's1')).toHaveLength(1);
  });

  it('undo refuses after a split has restated every quantity', async () => {
    const { undo } = await s.deleteSecurity('s1');
    await s.recordSplit({ num: 10, den: 1, date: '2026-06-01' });
    await expect(undo()).rejects.toThrow(/changed/);
    // The pre-split certificate (100 shares in old units) stays out of a
    // cap table now denominated 10x.
    expect(s.security('s1')).toBeNull();
    expect(s.securities).toHaveLength(1);
  });

  it('undo still works after a split that failed and rolled back', async () => {
    const { undo } = await s.deleteSecurity('s1');
    const set = puter.kv.set;
    puter.kv.set = async (k, v) => {
      if (k.includes(':securities:')) throw new Error('offline');
      return set(k, v);
    };
    await expect(s.recordSplit({ num: 10, den: 1, date: '2026-06-01' })).rejects.toThrow('offline');
    puter.kv.set = set;
    // Nothing changed, so the undo built before the attempt still applies.
    expect(s.security('s2').quantity).toBe(50);
    await undo();
    expect(s.security('s1')).not.toBeNull();
  });

  it('undo refuses once another company’s dataset is loaded', async () => {
    const kv = new Map();
    globalThis.puter = {
      kv: {
        get: async (k) => (kv.has(k) ? kv.get(k) : null),
        set: async (k, v) => { kv.set(k, v); return true; },
        del: async (k) => kv.delete(k),
      },
      auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
    };
    const a = new Store();
    await a.init();
    await a.addStakeholder({ name: 'Ada', kind: 'founder' });
    const ada = a.stakeholders[0];

    const { undo } = await a.deleteStakeholder(ada.id);
    await a.createCompany('Other Co');
    await expect(undo()).rejects.toThrow(/changed/);
    // Company A's holder must not surface inside Other Co.
    expect(a.stakeholders).toHaveLength(0);
  });

  it('reopens a convertible when the certificate it converted into is deleted', async () => {
    /* Deleting the certificate alone left the SAFE marked converted into
       nothing: out of the convertibles the round model converts, with its
       shares gone - a $500,000 instrument counted in capital raised and
       standing nowhere on the cap table. */
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h2', principal: 500_000, valuationCap: 5_000_000, discount: 0, safeType: 'post', date: '2025-01-01', convertedAt: '2026-02-01', convertedToId: 'x1' },
      { id: 'x1', kind: 'shares', label: 'CS-3', stakeholderId: 'h2', classId: 'c1', quantity: 400, pricePerShare: 1.25, date: '2026-02-01', fromConvertibleId: 'sf1' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    expect(convertibles(s.securities)).toHaveLength(0);

    const { undo } = await s.deleteSecurity('x1');
    expect(s.security('x1')).toBeNull();
    expect(convertibles(s.securities).map((c) => c.label)).toEqual(['SAFE-1']);
    expect(s.security('sf1').convertedAt).toBeUndefined();
    expect(s.security('sf1').convertedToId).toBeUndefined();

    // Undo puts the certificate and the conversion mark back together.
    await undo();
    expect(s.security('x1').quantity).toBe(400);
    expect(s.security('sf1')).toMatchObject({ convertedAt: '2026-02-01', convertedToId: 'x1' });
    expect(convertibles(s.securities)).toHaveLength(0);
  });

  it('refuses the undo once a later round converted the reopened convertible again', async () => {
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h2', principal: 500_000, safeType: 'post', date: '2025-01-01', convertedAt: '2026-02-01', convertedToId: 'x1' },
      { id: 'x1', kind: 'shares', label: 'CS-3', stakeholderId: 'h2', classId: 'c1', quantity: 400, pricePerShare: 1.25, date: '2026-02-01', fromConvertibleId: 'sf1' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    const { undo } = await s.deleteSecurity('x1');
    // The reopened SAFE converts in a new round while the toast is up.
    await s.closeRound({
      classId: 'c1', date: '2026-03-01',
      conversions: [{ securityId: 'sf1', quantity: 500, pricePerShare: 1 }],
    });
    const again = s.security('sf1');
    expect(again.convertedAt).toBe('2026-03-01');
    /* Re-inserting CS-3 would put one SAFE's money on the table twice: its
       400 shares beside the 500 the new round issued for the same $500,000.
       The SAFE stays with the round that converted it last, and CS-3 stays
       gone. */
    await expect(undo()).rejects.toThrow('The cap table has changed since the delete.');
    expect(s.security('x1')).toBeNull();
    expect(s.security('sf1')).toMatchObject({ convertedAt: '2026-03-01', convertedToId: again.convertedToId });
    expect(s.securities.filter((c) => c.fromConvertibleId === 'sf1')).toHaveLength(1);
  });

  it('refuses undoing a conversion certificate while its instrument is gone, in either order', async () => {
    const seed = () => {
      const t = makeStore();
      t.securities = Store.sanitizeSecurities([
        ...t.securities,
        { id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h2', principal: 100_000, safeType: 'post', date: '2025-01-01', convertedAt: '2026-02-01', convertedToId: 'x1' },
        { id: 'x1', kind: 'shares', label: 'CS-3', stakeholderId: 'h2', classId: 'c1', quantity: 100, pricePerShare: 1, date: '2026-02-01', fromConvertibleId: 'sf1' },
      ], { classes: t.classes, stakeholders: t.stakeholders });
      return t;
    };
    // Certificate deleted (SAFE reopens), then the live SAFE deleted.
    const t = seed();
    const cert = await t.deleteSecurity('x1');
    const safe = await t.deleteSecurity('sf1');
    // Certificate first: its instrument is gone, so it stays gone too.
    await expect(cert.undo()).rejects.toThrow('The cap table has changed since the delete.');
    expect(t.security('x1')).toBeNull();
    // Instrument first, then the certificate: both back, the SAFE re-marked.
    await safe.undo();
    expect(t.security('sf1')).toMatchObject({ kind: 'safe' });
    expect(t.security('sf1').convertedAt).toBeUndefined();
    await cert.undo();
    expect(t.security('x1')).not.toBeNull();
    expect(t.security('sf1')).toMatchObject({ convertedAt: '2026-02-01', convertedToId: 'x1' });
    expect(convertibles(t.securities)).toHaveLength(0);
  });

  it('refuses an undo whose certificate would land on the wrong side of a rule its award was edited past', async () => {
    const grant = { id: 'g1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1', quantity: 1000, strike: 1, grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 0, cliffMonths: 0, exercised: 100, expires: '2034-01-01' };
    const cert = { id: 'x1', kind: 'shares', label: 'CS-3', stakeholderId: 'h1', classId: 'c1', quantity: 100, pricePerShare: 1, date: '2024-06-01', fromOptionId: 'g1' };
    const seed = (extra = {}) => {
      const t = makeStore();
      t.securities = Store.sanitizeSecurities([...t.securities, { ...grant, ...extra }, cert],
        { classes: t.classes, stakeholders: t.stakeholders });
      return t;
    };
    const changed = 'The cap table has changed since the delete.';
    // The grant re-dated past the exercise while its certificate was gone.
    let t = seed();
    let u = await t.deleteSecurity('x1');
    await t.updateSecurity('g1', { grantDate: '2024-09-01', date: '2024-09-01' });
    await expect(u.undo()).rejects.toThrow(changed);
    expect(t.security('x1')).toBeNull();
    // The window closed before the exercise by a departure recorded meanwhile.
    t = seed();
    u = await t.deleteSecurity('x1');
    await t.markDeparted('h1', { date: '2024-04-01', grants: [{ id: 'g1', cancelQty: 0, exerciseBy: '2024-05-01' }] });
    await expect(u.undo()).rejects.toThrow(changed);
    // Early exercise turned off behind an exercise that used it.
    t = seed({ earlyExercise: true, vestingMonths: 48, cliffMonths: 12 });
    u = await t.deleteSecurity('x1');
    await t.updateSecurity('g1', { earlyExercise: false });
    await expect(u.undo()).rejects.toThrow(changed);
    // The grant itself gone: the pool's record of where the shares came from.
    t = seed();
    u = await t.deleteSecurity('x1');
    await t.deleteSecurity('g1');
    await expect(u.undo()).rejects.toThrow(changed);
    // The holder departed while their grant was deleted: it comes back with
    // no forfeiture and no window, so it stays gone.
    t = seed();
    await t.deleteSecurity('x1');
    u = await t.deleteSecurity('g1');
    await t.markDeparted('h1', { date: '2024-04-01', grants: [] });
    await expect(u.undo()).rejects.toThrow(changed);
    // Unrelated edits leave the undo alone.
    t = seed();
    u = await t.deleteSecurity('x1');
    await t.updateSecurity('g1', { strike: 2, quantity: 1200 });
    await u.undo();
    expect(t.security('x1')).not.toBeNull();
  });

  it('refuses an undo whose conversion certificate no longer matches the reopened instrument', async () => {
    const t = makeStore();
    t.securities = Store.sanitizeSecurities([
      ...t.securities,
      { id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h2', principal: 100_000, safeType: 'post', date: '2025-01-01', convertedAt: '2026-02-01', convertedToId: 'x1' },
      { id: 'x1', kind: 'shares', label: 'CS-3', stakeholderId: 'h2', classId: 'c1', quantity: 100, pricePerShare: 1, date: '2026-02-01', fromConvertibleId: 'sf1' },
    ], { classes: t.classes, stakeholders: t.stakeholders });
    const u = await t.deleteSecurity('x1');
    // Reopened, the SAFE's terms are editable again - and the certificate was sized from the old ones.
    await t.updateSecurity('sf1', { principal: 250_000 });
    await expect(u.undo()).rejects.toThrow('The cap table has changed since the delete.');
    expect(t.security('x1')).toBeNull();
    expect(t.security('sf1').convertedAt).toBeUndefined();
  });

  it('names a repurchase’s restore point for the repurchase', async () => {
    const t = makeStore();
    await t.transferShares('s1', { quantity: 20, to: 'company', date: '2024-06-01', pricePerShare: 1 });
    await t.transferShares('s2', { quantity: 20, to: { stakeholderId: 'h1' }, date: '2024-06-01' });
    expect(t.restorePoints.map((p) => p.label)).toEqual(['Before transferring CS-2', 'Before repurchasing CS-1']);
  });

  it('refuses an edit of a record that is gone rather than saving nothing', async () => {
    const t = makeStore();
    await expect(t.updateSecurity('nope', { pricePerShare: 2 })).rejects.toThrow('That security is gone.');
    await expect(t.updateStakeholder('nope', { name: 'X' })).rejects.toThrow('That stakeholder is gone.');
    await expect(t.updateClass('nope', { name: 'X' })).rejects.toThrow('That share class is gone.');
    let refused = null;
    try { await t.updateSecurity('nope', {}); } catch (err) { refused = err; }
    expect(isRefusal(refused)).toBe(true);
  });

  it('refuses the leg undo once the reopened source was repriced', async () => {
    const t = makeStore();
    const { buyerCert } = await t.transferShares('s1', { date: '2024-06-01', quantity: 40, pricePerShare: 0.001, to: { stakeholderId: 'h2' } });
    // Deleting the leg undoes the transfer; the source reopens at its old price.
    const { undo } = await t.deleteSecurity(buyerCert.id);
    expect(t.security('s1').closedAt).toBeUndefined();
    await t.updateSecurity('s1', { pricePerShare: 0.5 });
    // The legs would come back at the old price under a source now closed at the new one.
    await expect(undo()).rejects.toThrow('The cap table has changed since the delete.');
    expect(t.security('s1')).toMatchObject({ pricePerShare: 0.5 });
    expect(t.security('s1').closedAt).toBeUndefined();
    expect(t.securities.filter((c) => c.fromTransferId)).toHaveLength(0);
  });

  it('refuses restoring a settlement certificate once the award froze below it', async () => {
    const t = makeStore();
    t.securities = Store.sanitizeSecurities([
      ...t.securities,
      { id: 'r1', kind: 'rsu', label: 'RSU-1', stakeholderId: 'h1', classId: 'c1', quantity: 1000, grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 48, cliffMonths: 0 },
    ], { classes: t.classes, stakeholders: t.stakeholders });
    const cert = await t.settleRSU('r1', { quantity: 250, date: '2025-01-01', classId: 'c1' });
    // While the certificate stands, freezing vesting under it is refused.
    await expect(t.updateSecurity('r1', { vestingStoppedAt: '2024-06-01', cancellations: [{ quantity: 700, date: '2024-06-01' }] })).rejects.toThrow();
    const { undo } = await t.deleteSecurity(cert.id);
    expect(t.security('r1').settled).toBe(0);
    await t.updateSecurity('r1', { vestingStoppedAt: '2024-06-01', cancellations: [{ quantity: 700, date: '2024-06-01' }] });
    // Only 104 units had vested when vesting stopped; 250 settled can't come back.
    await expect(undo()).rejects.toThrow('The cap table has changed since the delete.');
    expect(t.security('r1').settled).toBe(0);
    expect(t.certificatesFrom('r1')).toHaveLength(0);
  });

  it('refuses the stakeholder undo once an exercise it restores was certified again', async () => {
    const t = makeStore();
    t.securities = Store.sanitizeSecurities([
      ...t.securities,
      // Grace's grant, exercised into a certificate that stayed with Ada (a wrong-holder correction).
      { id: 'g1', kind: 'option', label: 'OPT-1', stakeholderId: 'h2', quantity: 1000, strike: 1, grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 0, exercised: 100 },
      { id: 'x1', kind: 'shares', label: 'CS-3', stakeholderId: 'h1', classId: 'c1', quantity: 100, pricePerShare: 1, date: '2024-06-01', fromOptionId: 'g1' },
    ], { classes: t.classes, stakeholders: t.stakeholders });
    const { undo } = await t.deleteStakeholder('h1');
    expect(t.uncertifiedExercises(t.security('g1'))).toBe(100);
    await t.certifyExercise('g1', { quantity: 100, date: '2024-06-01', classId: 'c1' });
    await expect(undo()).rejects.toThrow('The cap table has changed since the delete.');
    expect(t.certificatesFrom('g1')).toHaveLength(1);
    expect(t.stakeholder('h1')).toBeNull();
  });

  it('reopens a convertible held by someone else when a holder’s certificates go', async () => {
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      // Grace's SAFE converted into a certificate that was then sold on to Ada
      // and reissued in her name - so the shares are Ada's, the SAFE Grace's.
      { id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h2', principal: 100_000, safeType: 'post', date: '2025-01-01', convertedAt: '2026-02-01', convertedToId: 'x1' },
      { id: 'x1', kind: 'shares', label: 'CS-3', stakeholderId: 'h1', classId: 'c1', quantity: 100, pricePerShare: 1, date: '2026-02-01', fromConvertibleId: 'sf1' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    const { undo } = await s.deleteStakeholder('h1');
    expect(s.security('sf1').convertedAt).toBeUndefined();
    expect(convertibles(s.securities).map((c) => c.label)).toEqual(['SAFE-1']);
    await undo();
    expect(s.security('x1')).not.toBeNull();
    expect(s.security('sf1')).toMatchObject({ convertedAt: '2026-02-01', convertedToId: 'x1' });
  });

  it('refuses to delete an award while the shares it became are on the table', async () => {
    s.company = Store.sanitizeCompany({ ...s.company, poolAuthorized: 1000 });
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'g1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1', quantity: 1000, strike: 1, grantDate: '2024-01-01', vestingMonths: 0, exercised: 1000 },
      { id: 'x1', kind: 'shares', label: 'CS-3', stakeholderId: 'h1', classId: 'c1', quantity: 1000, pricePerShare: 1, date: '2026-01-01', fromOptionId: 'g1' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    // The grant is the pool's record of where CS-3 came from: deleting it
    // alone offered the pool 1,000 shares that are already outstanding.
    await expect(s.deleteSecurity('g1')).rejects.toThrow(/CS-3/);
    expect(s.security('g1')).not.toBeNull();
    expect(s.certificatesFrom('g1').map((c) => c.label)).toEqual(['CS-3']);
    // Certificate first, then the grant.
    await s.deleteSecurity('x1');
    await s.deleteSecurity('g1');
    expect(s.security('g1')).toBeNull();
  });

  it('refuses to delete a converted instrument while the shares it became are on the table', async () => {
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'n1', kind: 'note', label: 'CN-1', stakeholderId: 'h2', principal: 100_000, interestRate: 8, date: '2025-01-01', convertedAt: '2026-01-01', convertedToId: 'x1' },
      { id: 'x1', kind: 'shares', label: 'CS-3', stakeholderId: 'h2', classId: 'c1', quantity: 108_000, pricePerShare: 1, date: '2026-01-01', fromConvertibleId: 'n1' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    const raised = capitalRaised(s.securities);
    /* With the note gone the certificate stood in for it at shares x price -
       principal plus a year of interest the company never received - and the
       securities list showed plain shares that came from nowhere. */
    await expect(s.deleteSecurity('n1')).rejects.toThrow(/converted into CS-3\. Delete that certificate first/);
    expect(s.security('n1')).not.toBeNull();
    expect(capitalRaised(s.securities)).toBe(raised);
    expect(s.convertedInto(s.security('n1')).label).toBe('CS-3');
    // A live instrument, and one whose certificate is already gone, still go.
    await s.deleteSecurity('x1');
    expect(convertibles(s.securities).map((c) => c.label)).toEqual(['CN-1']);
    await s.deleteSecurity('n1');
    expect(s.security('n1')).toBeNull();
  });

  it('refuses a holder whose convertible became a certificate someone else holds', async () => {
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      // Grace's SAFE converted into shares the record now puts in Ada's hands.
      { id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h2', principal: 500_000, safeType: 'post', date: '2025-01-01', convertedAt: '2026-02-01', convertedToId: 'x1' },
      { id: 'x1', kind: 'shares', label: 'CS-3', stakeholderId: 'h1', classId: 'c1', quantity: 400, pricePerShare: 1.25, date: '2026-02-01', fromConvertibleId: 'sf1' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    await expect(s.deleteStakeholder('h2')).rejects.toThrow(/CS-3 came off\. Delete those certificates first/);
    expect(s.stakeholder('h2')).not.toBeNull();
    expect(s.security('sf1')).not.toBeNull();
    // When the holder also holds the certificate, both go together.
    await s.updateSecurity('x1', { stakeholderId: 'h2' });
    await s.deleteStakeholder('h2');
    expect(s.securities.map((x) => x.id)).toEqual(['s1']);
  });

  it('refuses to delete a certificate a transfer drew successors off', async () => {
    s.company = Store.sanitizeCompany({ ...s.company, poolAuthorized: 1000 });
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'g1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1', quantity: 1000, strike: 1, grantDate: '2024-01-01', vestingMonths: 0, exercised: 1000 },
      { id: 'x1', kind: 'shares', label: 'CS-3', stakeholderId: 'h1', classId: 'c1', quantity: 1000, pricePerShare: 1, date: '2026-01-01', fromOptionId: 'g1' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    await s.transferShares('x1', {
      date: '2026-03-01', quantity: 500, pricePerShare: 2, to: { stakeholderId: 'h2' },
    });
    const before = fullyDiluted(s.securities, 0);
    /* The exercise nets against the closed original, not its successors, so
       deleting it revived 1,000 exercised options while all 1,000 successor
       shares stayed outstanding - the same equity twice. */
    await expect(s.deleteSecurity('x1'))
      .rejects.toThrow('CS-3 was transferred into CS-4, CS-5. Delete one of those certificates first, which undoes the transfer.');
    expect(fullyDiluted(s.securities, 0)).toBe(before);
    // Deleting a leg undoes the transfer, which reopens the certificate they
    // came off; open and with no successors, it can then go itself.
    await s.deleteSecurity(s.successorsOf('x1')[0].id);
    expect(s.successorsOf('x1')).toEqual([]);
    expect(s.security('x1').closedAt).toBeUndefined();
    await s.deleteSecurity('x1');
    expect(s.security('x1')).toBeNull();
  });

  it('hands settled units back to the award when a settlement certificate is deleted', async () => {
    /* The counter stayed at 400 with the shares gone: the units were back in
       the diluted base, yet the award would neither settle them again (the
       counter said it had) nor cancel them (settled units never are). */
    s.company = Store.sanitizeCompany({ ...s.company, poolAuthorized: 1000 });
    const award = await s.addSecurity({ kind: 'rsu', stakeholderId: 'h1', classId: 'c1', quantity: 1000,
      date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 0 });
    const cert = await s.settleRSU(award.id, { quantity: 400, date: '2026-01-01' });
    const before = fullyDiluted(s.securities, 1000);
    const { undo } = await s.deleteSecurity(cert.id);
    expect(s.security(award.id).settled).toBe(0);
    expect(fullyDiluted(s.securities, 1000)).toBe(before);
    // Settleable again, exactly as before the settlement was recorded.
    await undo();
    expect(s.security(award.id).settled).toBe(400);
    expect(s.security(cert.id)).toMatchObject({ quantity: 400 });
    await s.deleteSecurity(cert.id);
    const again = await s.settleRSU(award.id, { quantity: 400, date: '2026-01-01' });
    expect(again.quantity).toBe(400);
    expect(s.security(award.id).settled).toBe(400);
  });

  it('refuses to put settled units back on an award cancelled down meanwhile', async () => {
    s.company = Store.sanitizeCompany({ ...s.company, poolAuthorized: 1000 });
    const award = await s.addSecurity({ kind: 'rsu', stakeholderId: 'h1', classId: 'c1', quantity: 1000,
      date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 0 });
    const cert = await s.settleRSU(award.id, { quantity: 400, date: '2026-01-01' });
    const { undo } = await s.deleteSecurity(cert.id);
    // Everything but 300 units cancelled while the toast was up.
    await s.updateSecurity(award.id, { cancellations: [{ quantity: 700, date: '2026-02-01' }] });
    await expect(undo()).rejects.toThrow('The cap table has changed since the delete.');
    expect(s.security(cert.id)).toBeNull();
    expect(s.security(award.id)).toMatchObject({ cancelled: 700 });
    expect(s.security(award.id).settled).toBe(0);
  });

  it('hands units back through a stakeholder delete, and takes them again on undo', async () => {
    s.company = Store.sanitizeCompany({ ...s.company, poolAuthorized: 1000 });
    const award = await s.addSecurity({ kind: 'rsu', stakeholderId: 'h1', classId: 'c1', quantity: 1000,
      date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 0 });
    const cert = await s.settleRSU(award.id, { quantity: 400, date: '2026-01-01' });
    // The certificate corrected onto another holder, whose deletion cascades to it.
    await s.updateSecurity(cert.id, { stakeholderId: 'h2' });
    const { undo } = await s.deleteStakeholder('h2');
    expect(s.security(cert.id)).toBeNull();
    expect(s.security(award.id).settled).toBe(0);
    await undo();
    expect(s.security(cert.id)).toMatchObject({ stakeholderId: 'h2', quantity: 400 });
    expect(s.security(award.id).settled).toBe(400);
  });

  it('undoes a transfer when one of its legs is deleted, and undo redoes it', async () => {
    /* Deleting a leg alone left the source closed against legs that were no
       longer there: 40 of 100 shares gone with nothing repurchased, and once
       both legs were deleted the source still read closed - a certificate
       nobody could reopen short of a restore point. */
    const { buyerCert, remainderCert } = await s.transferShares('s1', {
      date: '2025-01-01', quantity: 40, pricePerShare: 2, to: { stakeholderId: 'h2' },
    });
    expect(sharesOutstanding(s.securities)).toBe(150);
    const { undo, removed, reopened } = await s.deleteSecurity(buyerCert.id);
    expect(removed.map((c) => c.label).sort()).toEqual([buyerCert.label, remainderCert.label].sort());
    expect(reopened.label).toBe('CS-1');
    expect(s.security(buyerCert.id)).toBeNull();
    expect(s.security(remainderCert.id)).toBeNull();
    expect(s.security('s1')).toMatchObject({ quantity: 100, stakeholderId: 'h1' });
    expect(s.security('s1').closedAt).toBeUndefined();
    expect(s.security('s1').closedReason).toBeUndefined();
    expect(sharesOutstanding(s.securities)).toBe(150);
    // Undo puts both legs back and closes the source again, as it was.
    await undo();
    expect(s.security(buyerCert.id)).toMatchObject({ quantity: 40, stakeholderId: 'h2' });
    expect(s.security(remainderCert.id)).toMatchObject({ quantity: 60, stakeholderId: 'h1' });
    expect(s.security('s1')).toMatchObject({ closedAt: '2025-01-01', closedReason: 'transfer' });
    expect(sharesOutstanding(s.securities)).toBe(150);
    // And twice is once.
    await undo();
    expect(s.securities.filter((c) => c.fromTransferId === 's1')).toHaveLength(2);
    // Deleting the remainder undoes it just the same.
    await s.deleteSecurity(remainderCert.id);
    expect(s.successorsOf('s1')).toEqual([]);
    expect(s.security('s1').closedAt).toBeUndefined();
  });

  it('undoes a repurchase when its remainder is deleted', async () => {
    const { remainderCert } = await s.transferShares('s1', {
      date: '2025-01-01', quantity: 30, pricePerShare: 1.5, to: 'company',
    });
    expect(sharesOutstanding(s.securities)).toBe(120);
    expect(repurchaseTerms(s.security('s1'))).toMatchObject({ quantity: 30, consideration: 45 });
    const { undo, reopened } = await s.deleteSecurity(remainderCert.id);
    expect(reopened.label).toBe('CS-1');
    expect(sharesOutstanding(s.securities)).toBe(150);
    expect(repurchaseTerms(s.security('s1'))).toBeNull();
    await undo();
    expect(sharesOutstanding(s.securities)).toBe(120);
    expect(repurchaseTerms(s.security('s1'))).toMatchObject({ quantity: 30, pricePerShare: 1.5 });
  });

  it('leaves a transfer alone when its other leg has moved on or been bought back', async () => {
    const { buyerCert, remainderCert } = await s.transferShares('s1', {
      date: '2025-01-01', quantity: 40, pricePerShare: 2, to: { stakeholderId: 'h2' },
    });
    // The remainder transferred on: its own legs stand in the way.
    await s.transferShares(remainderCert.id, {
      date: '2025-06-01', quantity: 60, pricePerShare: 3, to: { stakeholderId: 'h2' },
    });
    const before = JSON.stringify(s.securities);
    await expect(s.deleteSecurity(buyerCert.id))
      .rejects.toThrow(`${remainderCert.label}, issued by the same transfer, was transferred into CS-5. Delete that certificate first, which undoes the transfer.`);
    // A repurchase remainder is named as what it is.
    await expect(s.deleteSecurity(remainderCert.id))
      .rejects.toThrow(`${remainderCert.label} was transferred into CS-5. Delete that certificate first, which undoes the transfer.`);
    expect(JSON.stringify(s.securities)).toBe(before);

    // A sibling since repurchased: undoing the transfer would erase the buyback.
    const t = makeStore();
    const second = await t.transferShares('s1', {
      date: '2025-01-01', quantity: 40, pricePerShare: 2, to: { stakeholderId: 'h2' },
    });
    await t.transferShares(second.buyerCert.id, { date: '2025-06-01', quantity: 40, pricePerShare: 1, to: 'company' });
    await expect(t.deleteSecurity(second.remainderCert.id))
      .rejects.toThrow(/issued by the same transfer, was since repurchased, so the transfer can’t be undone here/);
    /* Nor does the repurchased leg go on its own: deleted first, the source
       stood closed against the remainder alone, and deleting that then
       "undid" the transfer at the source's full 100 - the 40 shares the
       company had retired were outstanding again. */
    await expect(t.deleteSecurity(second.buyerCert.id))
      .rejects.toThrow(`${second.buyerCert.label} came off CS-1 in a transfer and was since repurchased in full, so it can’t be deleted on its own: CS-1 would stay closed against fewer shares than it held. Restore the point taken before the repurchase instead.`);
    // The buyer's cascade is refused on the same grounds, before the confirm.
    expect(t.stakeholderDeleteRefusal('h2')).toMatch(/Grace’s CS-3 came off CS-1 in a transfer and was since repurchased in full/);
    await expect(t.deleteStakeholder('h2')).rejects.toThrow(/since repurchased in full/);
    expect(t.security('s1').closedAt).toBe('2025-01-01');
    expect(t.security(second.buyerCert.id)).not.toBeNull();
    expect(t.security(second.remainderCert.id)).not.toBeNull();

    /* And a leg repurchased in part: the buyer keeps a remainder, so the leg
       has a successor - one the cascade would take too. Not refused, the
       cascade removed both, the source stayed closed against the seller's
       remainder alone, and the shares the company retired left the cap table
       with no record of where they went. */
    const u = makeStore();
    const sale = await u.transferShares('s1', {
      date: '2025-01-01', quantity: 40, pricePerShare: 2, to: { stakeholderId: 'h2' },
    });
    await u.transferShares(sale.buyerCert.id, { date: '2025-06-01', quantity: 10, pricePerShare: 1, to: 'company' });
    const outstanding = sharesOutstanding(u.securities);
    const held = u.securities.filter((x) => x.stakeholderId === 'h2').length;
    expect(u.stakeholderDeleteRefusal('h2')).toMatch(/Grace’s CS-3 came off CS-1 in a transfer and was since repurchased in part, so it can’t be deleted on its own/);
    await expect(u.deleteStakeholder('h2')).rejects.toThrow(/since repurchased in part/);
    expect(u.securities.filter((x) => x.stakeholderId === 'h2')).toHaveLength(held);
    expect(sharesOutstanding(u.securities)).toBe(outstanding);
    expect(sharesOutstanding(t.securities)).toBe(110);
    // A repurchase that kept a remainder is one transfer: deleting the
    // remainder undoes that buyback and the leg reopens under its source.
    const v = makeStore();
    const third = await v.transferShares('s1', {
      date: '2025-01-01', quantity: 40, pricePerShare: 2, to: { stakeholderId: 'h2' },
    });
    const partial = await v.transferShares(third.buyerCert.id, { date: '2025-06-01', quantity: 10, pricePerShare: 1, to: 'company' });
    expect(sharesOutstanding(v.securities)).toBe(140);
    const { reopened } = await v.deleteSecurity(partial.remainderCert.id);
    expect(reopened.id).toBe(third.buyerCert.id);
    expect(v.security(third.buyerCert.id).closedAt).toBeUndefined();
    expect(v.security('s1').closedAt).toBe('2025-01-01');
    expect(sharesOutstanding(v.securities)).toBe(150);
  });

  it('undo of an exercise certificate delete refuses once the exercise was certified again', async () => {
    /* Deleting the certificate leaves the grant's counter alone so the
       exercise can be papered again - and an undo after that put both
       certificates on the table for one exercise. */
    const t = makeStore();
    t.securities = Store.sanitizeSecurities([
      ...t.securities,
      { id: 'g1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1', quantity: 1000, strike: 0.5, grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 0, cliffMonths: 0 },
    ], { classes: t.classes, stakeholders: t.stakeholders });
    const cert = await t.exerciseOption('g1', { quantity: 100, date: '2025-01-01', classId: 'c1' });
    const { undo } = await t.deleteSecurity(cert.id);
    expect(t.uncertifiedExercises(t.security('g1'))).toBe(100);
    const again = await t.certifyExercise('g1', { quantity: 100, date: '2025-01-01', classId: 'c1' });
    await expect(undo()).rejects.toThrow('The cap table has changed since the delete.');
    expect(t.certificatesFrom('g1').map((c) => c.id)).toEqual([again.id]);
    expect(t.security('g1').exercised).toBe(100);
    // With the exercise still uncertified the undo goes through as before.
    const u = makeStore();
    u.securities = t.securities.filter((x) => x.id === 'g1' || x.kind !== 'shares' || !x.fromOptionId).map((x) => (x.id === 'g1' ? { ...x, exercised: 0 } : x));
    u.securities = Store.sanitizeSecurities(u.securities, { classes: u.classes, stakeholders: u.stakeholders });
    const c2 = await u.exerciseOption('g1', { quantity: 100, date: '2025-01-01', classId: 'c1' });
    const del = await u.deleteSecurity(c2.id);
    await del.undo();
    expect(u.certificatesFrom('g1')).toHaveLength(1);
  });

  it('undo of a leg delete refuses once the reopened source has changed', async () => {
    const { buyerCert } = await s.transferShares('s1', {
      date: '2025-01-01', quantity: 40, pricePerShare: 2, to: { stakeholderId: 'h2' },
    });
    const { undo } = await s.deleteSecurity(buyerCert.id);
    // Resized while the toast was up: the legs were sized against 100.
    await s.updateSecurity('s1', { quantity: 90 });
    await expect(undo()).rejects.toThrow('The cap table has changed since the delete.');
    expect(s.security(buyerCert.id)).toBeNull();
    expect(s.security('s1')).toMatchObject({ quantity: 90 });
    expect(s.security('s1').closedAt).toBeUndefined();
  });

  it('undo of a leg delete refuses once the reopened source changed hands or schedule', async () => {
    /* The seller's remainder carries the source's holder, schedule and 83(b)
       record. Re-closed under a source moved to another holder, it read as
       that holder's remainder under the old name. */
    const cases = [
      { stakeholderId: 'h2' },
      { vestingMonths: 24, cliffMonths: 0, vestingStart: '2024-01-01' },
      { filed83b: '' },
    ];
    for (const patch of cases) {
      const t = makeStore();
      t.stakeholders = Store.sanitizeStakeholders([...t.stakeholders, { id: 'h3', name: 'Linus', kind: 'employee' }]);
      await t.updateSecurity('s1', { vestingMonths: 48, cliffMonths: 12, vestingStart: '2024-01-01', filed83b: '2024-01-10' });
      const { buyerCert } = await t.transferShares('s1', {
        date: '2025-01-01', quantity: 40, pricePerShare: 2, to: { stakeholderId: 'h3' },
      });
      const { undo } = await t.deleteSecurity(buyerCert.id);
      await t.updateSecurity('s1', patch);
      await expect(undo()).rejects.toThrow('The cap table has changed since the delete.');
      expect(t.security(buyerCert.id)).toBeNull();
      expect(t.security('s1').closedAt).toBeUndefined();
    }
    // Unchanged, the undo still re-closes the source under its legs.
    const t = makeStore();
    await t.updateSecurity('s1', { vestingMonths: 48, cliffMonths: 12, vestingStart: '2024-01-01' });
    const { buyerCert } = await t.transferShares('s1', {
      date: '2025-01-01', quantity: 40, pricePerShare: 2, to: { stakeholderId: 'h2' },
    });
    const { undo } = await t.deleteSecurity(buyerCert.id);
    await t.updateSecurity('s1', { notes: 'seller kept the rest' });
    await undo();
    expect(t.security(buyerCert.id)).not.toBeNull();
    expect(t.security('s1').closedAt).toBe('2025-01-01');
  });

  it('refuses to delete a holder whose certificate is a leg of another holder’s transfer', async () => {
    const { buyerCert } = await s.transferShares('s1', {
      date: '2025-01-01', quantity: 40, pricePerShare: 2, to: { stakeholderId: 'h2' },
    });
    const before = sharesOutstanding(s.securities);
    await expect(s.deleteStakeholder('h2'))
      .rejects.toThrow(`Grace holds ${buyerCert.label}, which came off CS-1 in a transfer. Delete that certificate first, which undoes the transfer.`);
    expect(s.stakeholder('h2')).not.toBeNull();
    expect(sharesOutstanding(s.securities)).toBe(before);
    // A repurchase remainder is the seller's own and goes with the seller.
    const t = makeStore();
    await t.transferShares('s1', { date: '2025-01-01', quantity: 30, pricePerShare: 1, to: 'company' });
    await t.deleteStakeholder('h1');
    expect(t.securities.filter((c) => c.stakeholderId === 'h1')).toEqual([]);
  });

  it('undo refuses to put a warrant back over a class deleted meanwhile', async () => {
    s.securities = Store.sanitizeSecurities([
      { id: 'w1', kind: 'warrant', stakeholderId: 'h1', classId: 'c1', quantity: 1000 },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    const { undo } = await s.deleteSecurity('w1');
    // Nothing is over the class now, so its delete button is live while the
    // Undo toast is still up.
    await s.deleteClass('c1');
    await expect(undo()).rejects.toThrow(/changed/);
    expect(s.securities).toEqual([]);
  });

  it('undo refuses to put a certificate back for a holder deleted meanwhile', async () => {
    const { undo } = await s.deleteSecurity('s1');
    await s.deleteStakeholder('h1');
    await expect(undo()).rejects.toThrow(/changed/);
    expect(s.security('s1')).toBeNull();
    // And a holder's own undo refuses once the class their shares were in is gone.
    const { undo: undoHolder } = await s.deleteStakeholder('h2');
    await s.deleteClass('c1');
    await expect(undoHolder()).rejects.toThrow(/changed/);
    expect(s.stakeholder('h2')).toBeNull();
  });

  it('a class delete queued behind a security delete that rolls back is refused', async () => {
    s.securities = Store.sanitizeSecurities([
      { id: 'w1', kind: 'warrant', stakeholderId: 'h1', classId: 'c1', quantity: 1000 },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    const set = puter.kv.set;
    puter.kv.set = async (k, v) => {
      if (k.includes(':securities:')) throw new Error('offline');
      return set(k, v);
    };
    const del = s.deleteSecurity('w1');
    const cls = s.deleteClass('c1');
    await expect(del).rejects.toThrow('offline');
    await expect(cls).rejects.toThrow(/Warrants/);
    puter.kv.set = set;
    expect(s.security('w1')).not.toBeNull();
    expect(s.classes).toHaveLength(1);
  });

  it('refuses a holder whose records another holder\u2019s certificate came off', async () => {
    s.company = Store.sanitizeCompany({ ...s.company, poolAuthorized: 100 });
    const grant = await s.addSecurity({
      kind: 'option', stakeholderId: 'h1', quantity: 100, strike: 1,
      grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 0, cliffMonths: 0,
    });
    await s.exerciseOption(grant.id, { quantity: 100, date: '2024-06-01', classId: 'c1' });
    const cert = s.securities.find((x) => x.fromOptionId === grant.id);
    await s.transferShares(cert.id, {
      date: '2024-07-01', quantity: 100, pricePerShare: 1, to: { stakeholderId: 'h2' },
    });
    const before = fullyDiluted(s.securities, s.company.poolAuthorized);
    await expect(s.deleteStakeholder('h1')).rejects.toThrow(/Delete those certificates first/);
    expect(s.stakeholder('h1')).not.toBeNull();
    // Cascading would have freed the pool the sold shares were drawn from.
    expect(fullyDiluted(s.securities, s.company.poolAuthorized)).toBe(before);
    // The buyer's certificate gone, the source records are nobody's dependency.
    await s.deleteSecurity(s.securities.find((x) => x.stakeholderId === 'h2' && x.fromTransferId).id);
    await s.deleteStakeholder('h1');
    expect(s.stakeholder('h1')).toBeNull();
  });

  it('undo of a stakeholder delete restores holder and securities without clobbering new records', async () => {
    const { undo } = await s.deleteStakeholder('h1');
    expect(s.stakeholder('h1')).toBeNull();
    expect(s.securities).toHaveLength(1);
    const bo = await s.addStakeholder({ name: 'Bo', kind: 'investor' });
    await undo();
    expect(s.stakeholder('h1')?.name).toBe('Ada');
    expect(s.stakeholder(bo.id)?.name).toBe('Bo');
    expect(s.security('s1')).not.toBeNull();
    expect(s.securities).toHaveLength(2);
  });
});

describe('Store valuations', () => {
  it('records and removes a 409A against the list as it stands when the write runs', async () => {
    const s = makeStore();
    s.company = Store.sanitizeCompany({
      ...s.company,
      valuations: [{ id: 'v1', date: '2024-01-01', fmvPerShare: 1 }, { id: 'v2', date: '2023-01-01', fmvPerShare: 0.5 }],
    });
    // The first write to the profile fails; the delete rolls back.
    let failOnce = true;
    const set = puter.kv.set;
    puter.kv.set = async (k, v) => {
      if (failOnce && k.includes(':company:')) { failOnce = false; throw new Error('offline'); }
      return set(k, v);
    };
    const del = s.deleteValuation('v2');
    const add = s.addValuation({ date: '2026-01-01', fmvPerShare: 2, note: 'Post-Seed' });
    await expect(del).rejects.toThrow('offline');
    await add;
    puter.kv.set = set;
    // The 2023 valuation the failed delete said was still there really is,
    // and the new one sits on top of it.
    expect(s.company.valuations.map((v) => v.date)).toEqual(['2026-01-01', '2024-01-01', '2023-01-01']);
    await s.deleteValuation('v1');
    expect(s.company.valuations.map((v) => v.date)).toEqual(['2026-01-01', '2023-01-01']);
    await expect(s.addValuation({ date: '2026-02-01', fmvPerShare: 0 })).rejects.toThrow(/price/);
  });

  it('refuses a valuation past the limit instead of dropping the oldest', async () => {
    const s = makeStore();
    for (let i = 0; i < 40; i++) {
      const date = `${2023 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`;
      await s.addValuation({ date, fmvPerShare: i + 1 });
    }
    expect(s.company.valuations).toHaveLength(40);
    const oldest = s.company.valuations[s.company.valuations.length - 1];
    await expect(s.addValuation({ date: '2030-01-01', fmvPerShare: 99 }))
      .rejects.toThrow(/already holds 40 valuations/);
    expect(s.company.valuations).toHaveLength(40);
    expect(s.company.valuations.map((v) => v.id)).toContain(oldest.id);
    // Room again once one is deleted.
    await s.deleteValuation(oldest.id);
    await s.addValuation({ date: '2030-01-01', fmvPerShare: 99 });
    expect(s.company.valuations[0].date).toBe('2030-01-01');
  });
});

describe('Store.saveHire limits', () => {
  it('refuses a role past the limit instead of displacing another', async () => {
    const s = makeStore();
    for (let i = 0; i < 100; i++) {
      await s.saveHire({
        role: `Role ${String(i).padStart(3, '0')}`, startMonth: '2026-10',
        headcount: 1, sizeMode: 'shares', shares: 100,
      });
    }
    expect(s.hiring).toHaveLength(100);
    // A role sorting before the last one displaced that one, not itself.
    await expect(s.saveHire({
      role: 'AA First role', startMonth: '2026-01', headcount: 1, sizeMode: 'shares', shares: 7,
    })).rejects.toThrow(/already holds 100 roles/);
    expect(s.hiring).toHaveLength(100);
    expect(s.hiring.some((h) => h.role === 'Role 099')).toBe(true);
    // Editing a row already in the plan is not an addition.
    const edited = await s.saveHire({ ...s.hiring[0], shares: 777 });
    expect(s.hiring).toHaveLength(100);
    expect(s.hiring.find((h) => h.id === edited.id).shares).toBe(777);
  });
});

describe('Store.deleteClass guards', () => {
  it('refuses a class that still backs issued shares or warrants', async () => {
    const s = makeStore();
    await expect(s.deleteClass('c1')).rejects.toThrow(/issued shares/);

    s.securities = Store.sanitizeSecurities([
      { id: 'w1', kind: 'warrant', stakeholderId: 'h1', classId: 'c1', quantity: 1000 },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    await expect(s.deleteClass('c1')).rejects.toThrow(/Warrants/);

    s.securities = [];
    await s.deleteClass('c1');
    expect(s.classes).toHaveLength(0);
  });

  it('refuses a class another tab has since issued shares into', async () => {
    /* This commit writes only the classes, so the stale-write guard - which
       compares the key it is about to write - never looks at the securities.
       A second tab loaded before the issuance saw the class as unused and
       deleted it, and the certificate was validated away on the next load. */
    const kv = new Map();
    globalThis.puter = {
      kv: {
        get: async (k) => (kv.has(k) ? kv.get(k) : null),
        set: async (k, v) => { kv.set(k, v); return true; },
      },
      auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
    };
    const tabA = new Store();
    await tabA.init();
    const cls = await tabA.addClass({ name: 'Common Stock', kind: 'common' });
    const holder = await tabA.addStakeholder({ name: 'Ada', kind: 'founder' });

    const tabB = new Store();
    await tabB.init();
    expect(tabB.securities).toHaveLength(0);

    await tabA.addSecurity({
      kind: 'shares', stakeholderId: holder.id, classId: cls.id,
      quantity: 100, pricePerShare: 1, date: '2025-01-01',
    });
    await expect(tabB.deleteClass(cls.id)).rejects.toThrow(/issued shares/);

    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.classes).toHaveLength(1);
    expect(reloaded.securities).toHaveLength(1);
  });

  it('sees the other tab’s certificates when the list is stored in parts', async () => {
    /* A securities list too large for one KV value is written across
       numbered parts behind a marker. The check above read the marker as the
       collection - an object where a list was expected, so an empty one -
       and let the class go while thousands of stored certificates were in it. */
    const kv = new Map();
    globalThis.puter = {
      kv: {
        get: async (k) => (kv.has(k) ? kv.get(k) : null),
        set: async (k, v) => { kv.set(k, v); return true; },
      },
      auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
    };
    const tabA = new Store();
    await tabA.init();
    const cls = await tabA.addClass({ name: 'Common Stock', kind: 'common' });
    const holder = await tabA.addStakeholder({ name: 'Ada', kind: 'founder' });

    const tabB = new Store();
    await tabB.init();
    expect(tabB.securities).toHaveLength(0);

    const securities = [];
    for (let i = 0; i < 3000; i++) {
      securities.push({
        id: `s${i}`, kind: 'shares', label: `CS-${i + 1}`, stakeholderId: holder.id, classId: cls.id,
        quantity: 100, pricePerShare: 1, date: '2025-01-01',
        attachments: [{
          id: `a${i}`, name: `Subscription agreement ${i}.pdf`, size: 1, addedAt: 1,
          path: `captable-attachments/${tabA.activeCompanyId}/s${i}/agreement.pdf`,
        }],
      });
    }
    await tabA.importAll({
      company: tabA.company, classes: tabA.classes, stakeholders: tabA.stakeholders, securities,
    });
    const key = `captable:${tabA.activeCompanyId}:securities:v1`;
    expect(JSON.parse(kv.get(key)).__parts).toBeGreaterThan(1);

    await expect(tabB.deleteClass(cls.id)).rejects.toThrow(/issued shares/);

    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.classes).toHaveLength(1);
    expect(reloaded.securities).toHaveLength(3000);
  });
});

describe('Store.closeRound', () => {
  /** A store mid-raise: founder common, an option pool, and one SAFE. */
  function raising() {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ name: 'Test Co', poolAuthorized: 1_000_000 });
    s.securities = Store.sanitizeSecurities([
      { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 9_000_000, pricePerShare: 0.0001, date: '2024-01-01' },
      { id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h2', principal: 1_000_000, valuationCap: 10_000_000, discount: 0, safeType: 'pre', date: '2024-06-01' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    return s;
  }

  it.each([0, -1, 0.4])('refuses an investor allocated %s shares without partially closing the round', async (quantity) => {
    const s = raising();
    const before = Store.sanitizeSnapshot(s.exportAll());
    await expect(s.closeRound({
      date: '2025-01-01', newClass: { name: 'Seed', kind: 'preferred', pricePerShare: 10000 },
      investors: [
        { newHolder: { name: 'Lead' }, quantity: 10, pricePerShare: 10000 },
        { newHolder: { name: 'Small investor' }, quantity, pricePerShare: 10000 },
      ],
      conversions: [{ securityId: 'sf1', quantity: 100, pricePerShare: 10000 }],
      poolAuthorized: 2000000,
    })).rejects.toThrow(/at least one whole share/);
    expect(Store.sanitizeSnapshot(s.exportAll())).toEqual(before);
    expect(s.restorePoints).toEqual([]);
  });

  it('issues certificates, converts instruments, and resizes the pool in one commit', async () => {
    const s = raising();
    const { classId, certificates } = await s.closeRound({
      date: '2026-01-15',
      newClass: { name: 'Series A Preferred', kind: 'preferred', authorized: 3_000_000, pricePerShare: 2, liquidationMultiple: 1, seniority: 1 },
      investors: [
        { stakeholderId: 'h1', quantity: 1_000_000, pricePerShare: 2 },
        { newHolder: { name: 'Nova Ventures', kind: 'investor' }, quantity: 500_000, pricePerShare: 2 },
      ],
      conversions: [{ securityId: 'sf1', quantity: 1_000_000, pricePerShare: 1 }],
      poolAuthorized: 1_400_000,
    });

    expect(certificates).toHaveLength(3);
    // Every certificate got its own label in the new class.
    expect(certificates.map((c) => c.label)).toEqual(['SA-1', 'SA-2', 'SA-3']);
    expect(certificates.every((c) => c.classId === classId && c.date === '2026-01-15')).toBe(true);
    expect(s.stakeholder(certificates[1].stakeholderId)?.name).toBe('Nova Ventures');
    expect(certificates[2].fromConvertibleId).toBe('sf1');
    expect(s.company.poolAuthorized).toBe(1_400_000);

    const safe = s.security('sf1');
    expect(safe.convertedAt).toBe('2026-01-15');
    expect(safe.convertedToId).toBe(certificates[2].id);

    /* The top-up is dated the close. The day before, the table reads the
       pool the company had - not a reserve the round had yet to create - and
       the fully diluted count and every percentage under it follow. */
    expect(s.company.poolHistory).toEqual([{ date: '2026-01-15', before: 1_000_000, after: 1_400_000, seq: 1 }]);
    const eve = dbAsOf(s.db, '2026-01-14');
    expect(eve.company.poolAuthorized).toBe(1_000_000);
    expect(fullyDiluted(eve.securities, eve.company.poolAuthorized)).toBe(10_000_000);
    const day = dbAsOf(s.db, '2026-01-15');
    expect(day.company.poolAuthorized).toBe(1_400_000);
    expect(fullyDiluted(day.securities, day.company.poolAuthorized)).toBe(9_000_000 + 2_500_000 + 1_400_000);
  });

  it('refuses to convert an instrument that did not exist on the closing date', async () => {
    const s = raising();
    // SAFE-1 was signed 2024-06-01; a round that closed in January cannot be
    // the round that priced it.
    await expect(s.closeRound({
      date: '2024-01-01',
      newClass: { name: 'Series A Preferred', kind: 'preferred', pricePerShare: 2 },
      investors: [{ stakeholderId: 'h1', quantity: 1_000_000, pricePerShare: 2 }],
      conversions: [{ securityId: 'sf1', quantity: 1_000_000, pricePerShare: 1 }],
      poolAuthorized: null,
    })).rejects.toThrow('SAFE-1 was issued on 2024-06-01, after this closing date.');
    // Nothing landed: not the class, not the new money, not the conversion.
    expect(s.security('sf1').convertedAt).toBeFalsy();
    expect(s.classes).toHaveLength(1);
    expect(sharesOutstanding(s.securities)).toBe(9_000_000);
    // The same round on the SAFE's own day is fine.
    await s.closeRound({
      date: '2024-06-01',
      newClass: { name: 'Series A Preferred', kind: 'preferred', pricePerShare: 2 },
      investors: [{ stakeholderId: 'h1', quantity: 1_000_000, pricePerShare: 2 }],
      conversions: [{ securityId: 'sf1', quantity: 1_000_000, pricePerShare: 1 }],
      poolAuthorized: null,
    });
    expect(s.security('sf1').convertedAt).toBe('2024-06-01');
  });

  it('takes converted instruments out of every aggregate', async () => {
    const s = raising();
    expect(convertibles(s.securities)).toHaveLength(1);
    expect(capitalRaised(s.securities)).toBe(1_000_000 + 900);

    await s.closeRound({
      date: '2026-01-15',
      newClass: { name: 'Series A Preferred', kind: 'preferred', pricePerShare: 2 },
      investors: [{ stakeholderId: 'h1', quantity: 1_000_000, pricePerShare: 2 }],
      conversions: [{ securityId: 'sf1', quantity: 1_000_000, pricePerShare: 1 }],
      poolAuthorized: null,
    });

    expect(convertibles(s.securities)).toHaveLength(0);
    expect(modelRound(s.db, { preMoney: 30e6, investment: 5e6, poolPct: 0, asOf: '2026-02-01' }).conversions)
      .toHaveLength(0);
    // The SAFE's money is now in its certificate, counted once.
    expect(capitalRaised(s.securities)).toBe(900 + 2_000_000 + 1_000_000);
    expect(sharesOutstanding(s.securities)).toBe(11_000_000);
  });

  it('never converts the same instrument twice', async () => {
    const s = raising();
    const args = {
      date: '2026-01-15',
      newClass: { name: 'Series A Preferred', kind: 'preferred', pricePerShare: 2 },
      investors: [],
      conversions: [{ securityId: 'sf1', quantity: 1_000_000, pricePerShare: 1 }],
      poolAuthorized: null,
    };
    await s.closeRound(args);
    const firstCert = s.security('sf1').convertedToId;
    await s.closeRound({ ...args, date: '2026-02-01' });

    expect(s.securities.filter((x) => x.fromConvertibleId === 'sf1')).toHaveLength(1);
    expect(s.security('sf1').convertedAt).toBe('2026-01-15');
    expect(s.security('sf1').convertedToId).toBe(firstCert);
  });

  it('refuses to close without a date - a falsy convertedAt would unconvert on reload', async () => {
    const s = raising();
    await expect(s.closeRound({
      date: '',
      newClass: { name: 'Series A Preferred', kind: 'preferred', pricePerShare: 2 },
      investors: [{ stakeholderId: 'h1', quantity: 1_000_000, pricePerShare: 2 }],
    })).rejects.toThrow(/date/);
    expect(s.classes.some((c) => c.name === 'Series A Preferred')).toBe(false);
  });

  it('rolls everything back when the write fails', async () => {
    const s = raising();
    const before = JSON.stringify({ c: s.classes, s: s.securities, co: s.company, h: s.stakeholders });
    globalThis.puter.kv.set = async () => { throw new Error('offline'); };

    await expect(s.closeRound({
      date: '2026-01-15',
      newClass: { name: 'Series A Preferred', kind: 'preferred', pricePerShare: 2 },
      investors: [{ newHolder: { name: 'Nova Ventures', kind: 'investor' }, quantity: 1_000_000, pricePerShare: 2 }],
      conversions: [{ securityId: 'sf1', quantity: 1_000_000, pricePerShare: 1 }],
      poolAuthorized: 1_400_000,
    })).rejects.toThrow('offline');

    expect(JSON.stringify({ c: s.classes, s: s.securities, co: s.company, h: s.stakeholders })).toBe(before);
  });

  it('puts the stored copies back in step when only one key fails', async () => {
    // deleteStakeholder writes stakeholders and securities as two independent
    // kv.set calls. The first lands, the second doesn't.
    const kv = new Map();
    globalThis.puter = {
      kv: {
        get: async (k) => (kv.has(k) ? kv.get(k) : null),
        set: async (k, v) => { kv.set(k, v); return true; },
        del: async (k) => kv.delete(k),
      },
      auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
    };
    const s = new Store();
    await s.init();
    await s.addStakeholder({ id: 'h1', name: 'Ada', kind: 'founder' });
    const ada = s.stakeholders[0];
    await s.addClass({ name: 'Common Stock', kind: 'common' });
    await s.addSecurity({
      kind: 'shares', stakeholderId: ada.id, classId: s.classes[0].id,
      quantity: 100, date: '2024-01-01',
    });

    const set = puter.kv.set;
    puter.kv.set = async (k, v) => {
      if (k.endsWith(':securities:v1')) throw new Error('offline');
      return set(k, v);
    };
    await expect(s.deleteStakeholder(ada.id)).rejects.toThrow('offline');
    puter.kv.set = set;

    // Memory is back, as it always was.
    expect(s.stakeholders.map((h) => h.name)).toEqual(['Ada']);
    expect(s.securities).toHaveLength(1);

    // And so is the stored copy: left holding the delete, the next boot would
    // load a securities list whose holder is gone and drop the certificate.
    const s2 = new Store();
    await s2.init();
    expect(s2.stakeholders.map((h) => h.name)).toEqual(['Ada']);
    expect(s2.securities).toHaveLength(1);
  });

  it('puts the stored copies back in step when a set lands but its acknowledgement is lost', async () => {
    /* The connection can drop after the server committed a set, so the
       promise rejects over a value that did land. The compensating rewrite
       then found the key holding exactly what this session had sent and
       read it as another tab's change: refused as stale, it left one
       collection with the delete applied and the other without. */
    const kv = new Map();
    globalThis.puter = {
      kv: {
        get: async (k) => (kv.has(k) ? kv.get(k) : null),
        set: async (k, v) => { kv.set(k, v); return true; },
        del: async (k) => kv.delete(k),
      },
      auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
    };
    const s = new Store();
    await s.init();
    await s.addStakeholder({ id: 'h1', name: 'Ada', kind: 'founder' });
    const ada = s.stakeholders[0];
    await s.addClass({ name: 'Common Stock', kind: 'common' });
    await s.addSecurity({
      kind: 'shares', stakeholderId: ada.id, classId: s.classes[0].id,
      quantity: 100, date: '2024-01-01',
    });
    let stale = false;
    s.addEventListener('stale', () => { stale = true; });

    const set = puter.kv.set;
    puter.kv.set = async (k, v) => {
      await set(k, v);
      if (k.endsWith(':securities:v1')) throw new Error('lost ack');
      return true;
    };
    await expect(s.deleteStakeholder(ada.id)).rejects.toThrow('lost ack');
    puter.kv.set = set;

    expect(s.stakeholders.map((h) => h.name)).toEqual(['Ada']);
    expect(s.securities).toHaveLength(1);
    // Its own landed bytes are not another tab's change.
    expect(stale).toBe(false);
    expect(s.isStale).toBe(false);
    const s2 = new Store();
    await s2.init();
    expect(s2.stakeholders.map((h) => h.name)).toEqual(['Ada']);
    expect(s2.securities).toHaveLength(1);
    /* The rewrite lost its acknowledgement too, so it is owed until the key
       is read back holding it. */
    expect(s.unsaved).toBe(true);
    expect(await s.retryUnsaved()).toBe(true);
    // A change made elsewhere is still caught.
    kv.set(`captable:${s.activeCompanyId}:securities:v1`, '[]');
    await expect(s.addSecurity({
      kind: 'shares', stakeholderId: ada.id, classId: s.classes[0].id, quantity: 5, date: '2024-01-02',
    })).rejects.toThrow(StaleWriteError);
  });

  it('a failed write cannot erase a commit issued while it was in flight', async () => {
    const kv = new Map();
    globalThis.puter = {
      kv: {
        get: async (k) => (kv.has(k) ? kv.get(k) : null),
        set: async (k, v) => { kv.set(k, v); return true; },
        del: async (k) => kv.delete(k),
      },
      auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
    };
    const s = new Store();
    await s.init();
    await s.addStakeholder({ name: 'Ada', kind: 'founder' });
    await s.addStakeholder({ name: 'Grace', kind: 'founder' });
    const [ada, grace] = s.stakeholders;

    // The first rename's write stalls and then fails; the second is issued
    // while the first is still in flight. Unserialized, the first's rollback
    // would restore its pre-commit snapshot over the second's confirmed save,
    // in memory and on disk.
    const set = puter.kv.set;
    let release;
    const gate = new Promise((r) => { release = r; });
    let stalled = false;
    puter.kv.set = async (k, v) => {
      if (!stalled && k.endsWith(':stakeholders:v1')) {
        stalled = true;
        await gate;
        throw new Error('offline');
      }
      return set(k, v);
    };

    const first = s.updateStakeholder(ada.id, { name: 'Ada Prime' });
    const second = s.updateStakeholder(grace.id, { name: 'Grace Prime' });
    release();
    await expect(first).rejects.toThrow('offline');
    await second;

    expect(s.stakeholder(ada.id).name).toBe('Ada');
    expect(s.stakeholder(grace.id).name).toBe('Grace Prime');

    // The stored copy agrees: only the failed rename is missing.
    const s2 = new Store();
    await s2.init();
    expect(s2.stakeholders.map((h) => h.name).sort()).toEqual(['Ada', 'Grace Prime']);
  });

  it('rolls everything back when a record part-way through cannot be written', async () => {
    const s = raising();
    const before = JSON.stringify({ c: s.classes, s: s.securities, co: s.company, h: s.stakeholders });

    // The second investor is unissuable, and only turns out to be so after the
    // class and the first certificate have already landed.
    await expect(s.closeRound({
      date: '2026-01-15',
      newClass: { name: 'Series A Preferred', kind: 'preferred', pricePerShare: 2 },
      investors: [
        { stakeholderId: 'h1', quantity: 1_000_000, pricePerShare: 2 },
        { newHolder: { name: '   ', kind: 'investor' }, quantity: 500_000, pricePerShare: 2 },
      ],
      poolAuthorized: 1_400_000,
    })).rejects.toThrow();

    expect(JSON.stringify({ c: s.classes, s: s.securities, co: s.company, h: s.stakeholders })).toBe(before);
  });
});

describe('Store.exerciseOption', () => {
  /** A store holding one vested grant beside the base certificates. */
  function granted() {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1', quantity: 1000, strike: 0.5, grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 0, cliffMonths: 0, exercised: 0 },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    return s;
  }

  it('records the exercise and issues the certificate in one commit', async () => {
    const s = granted();
    const cert = await s.exerciseOption('o1', { quantity: 400, date: '2026-03-01', classId: 'c1' });
    expect(s.security('o1').exercised).toBe(400);
    expect(cert).toMatchObject({
      kind: 'shares', classId: 'c1', quantity: 400, pricePerShare: 0.5,
      fromOptionId: 'o1', date: '2026-03-01', label: 'CS-3',
    });
    expect(s.security(cert.id)).toBeTruthy();
  });

  it('records a certificate-less exercise when no class is given', async () => {
    const s = granted();
    const cert = await s.exerciseOption('o1', { quantity: 400, date: '2026-03-01' });
    expect(cert).toBeNull();
    expect(s.security('o1').exercised).toBe(400);
    expect(s.securities.some((x) => x.fromOptionId === 'o1')).toBe(false);
  });

  it('accumulates onto a previous exercise', async () => {
    const s = granted();
    await s.exerciseOption('o1', { quantity: 100, date: '2026-03-01', classId: 'c1' });
    await s.exerciseOption('o1', { quantity: 200, date: '2026-04-01', classId: 'c1' });
    expect(s.security('o1').exercised).toBe(300);
    expect(s.securities.filter((x) => x.fromOptionId === 'o1')).toHaveLength(2);
  });

  it('keeps the exercise and its certificate together when the write fails', async () => {
    const s = granted();
    const before = JSON.stringify(s.securities);
    globalThis.puter.kv.set = async () => { throw new Error('offline'); };
    await expect(s.exerciseOption('o1', { quantity: 400, date: '2026-03-01', classId: 'c1' }))
      .rejects.toThrow('offline');
    expect(JSON.stringify(s.securities)).toBe(before);
  });

  it('rolls the exercise back when the certificate cannot be issued', async () => {
    const s = granted();
    const before = JSON.stringify(s.securities);
    // An unknown class makes the certificate unissuable after the grant
    // update has already applied.
    await expect(s.exerciseOption('o1', { quantity: 400, date: '2026-03-01', classId: 'nope' }))
      .rejects.toThrow();
    expect(JSON.stringify(s.securities)).toBe(before);
  });

  it('refuses an exercise dated after the grant expired', async () => {
    const s = granted();
    s.securities = s.securities.map((x) => (x.id === 'o1' ? { ...x, expires: '2026-01-01' } : x));
    const before = JSON.stringify(s.securities);
    await expect(s.exerciseOption('o1', { quantity: 400, date: '2026-03-01', classId: 'c1' }))
      .rejects.toThrow(/could not be exercised after 2026-01-01/);
    expect(JSON.stringify(s.securities)).toBe(before);
    // The same exercise while the grant was still live is recorded.
    await s.exerciseOption('o1', { quantity: 400, date: '2025-12-31', classId: 'c1' });
    expect(s.security('o1').exercised).toBe(400);
  });

  it('refuses an exercise past the post-termination deadline', async () => {
    // A departure's window closes before the ten-year expiration, so it is
    // the deadline that counts.
    const s = granted();
    s.securities = s.securities.map((x) => (x.id === 'o1'
      ? { ...x, expires: '2034-01-01', exerciseBy: '2026-02-01' } : x));
    await expect(s.exerciseOption('o1', { quantity: 400, date: '2026-03-01', classId: 'c1' }))
      .rejects.toThrow(/could not be exercised after 2026-02-01/);
    await s.exerciseOption('o1', { quantity: 400, date: '2026-02-01', classId: 'c1' });
    expect(s.security('o1').exercised).toBe(400);
  });

  it('refuses an exercise dated before the grant, or not dated at all', async () => {
    /* The form refuses both, but the record is where the invariant lives: a
       certificate's date is already held to its award's when it is edited,
       and issuing one before the grant - or with no date to file a Form 3921
       under - walked straight past that. */
    const s = granted();
    const before = JSON.stringify(s.securities);
    await expect(s.exerciseOption('o1', { quantity: 100, date: '2023-12-31', classId: 'c1' }))
      .rejects.toThrow(/granted on 2024-01-01/);
    await expect(s.exerciseOption('o1', { quantity: 100, date: '', classId: 'c1' }))
      .rejects.toThrow(/exercise date/);
    expect(JSON.stringify(s.securities)).toBe(before);
    // On the grant date itself is fine: an immediately vested grant can be
    // exercised the day it is signed.
    const cert = await s.exerciseOption('o1', { quantity: 100, date: '2024-01-01', classId: 'c1' });
    expect(cert.date).toBe('2024-01-01');
  });

  it('refuses to exercise more than the grant has left', async () => {
    // The sanitizer clamps the grant's own counter, so without the guard an
    // over-exercise would silently mint a certificate for shares the grant
    // never held: 800 + 600 off a 1,000 grant left 1,400 certified shares.
    const s = granted();
    await s.exerciseOption('o1', { quantity: 800, date: '2026-03-01', classId: 'c1' });
    const before = JSON.stringify(s.securities);
    await expect(s.exerciseOption('o1', { quantity: 600, date: '2026-04-01', classId: 'c1' }))
      .rejects.toThrow(/more than this grant/);
    expect(JSON.stringify(s.securities)).toBe(before);
    // The remainder still exercises cleanly.
    await s.exerciseOption('o1', { quantity: 200, date: '2026-04-01', classId: 'c1' });
    expect(s.security('o1').exercised).toBe(1000);
    const certified = s.securities.filter((x) => x.fromOptionId === 'o1')
      .reduce((a, x) => a + x.quantity, 0);
    expect(certified).toBe(1000);
  });

  /** A half-vested grant: 48 months from 2024-03-01, no cliff. */
  function vesting(extra = {}) {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      {
        id: 'o2', kind: 'option', label: 'OPT-2', stakeholderId: 'h1', quantity: 4800,
        strike: 0.5, grantDate: '2024-03-01', date: '2024-03-01',
        vestingMonths: 48, cliffMonths: 0, exercised: 0, ...extra,
      },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    return s;
  }

  it('refuses an exercise past the vested balance unless early exercise is allowed', async () => {
    const s = vesting();
    // 24/48 vested on 2026-03-01 = 2,400.
    await expect(s.exerciseOption('o2', { quantity: 3000, date: '2026-03-01', classId: 'c1' }))
      .rejects.toThrow(/Only vested options/);
    await s.exerciseOption('o2', { quantity: 2400, date: '2026-03-01', classId: 'c1' });
    expect(s.security('o2').exercised).toBe(2400);
  });

  it('carries the remaining schedule onto an early-exercise certificate', async () => {
    const s = vesting({ earlyExercise: true });
    const cert = await s.exerciseOption('o2', { quantity: 4800, date: '2026-03-01', classId: 'c1' });
    // The certificate reverse-vests on the grant's own clock: half vested
    // today, fully vested when the grant would have been.
    expect(cert.vestingMonths).toBe(48);
    expect(cert.vestingStart).toBe('2024-03-01');
    expect(cert.filed83b).toBeUndefined();
  });

  it('carries the grant\u2019s acceleration terms onto an early-exercise certificate', async () => {
    const s = vesting({ earlyExercise: true, accelTrigger: 'single', accelPct: 100 });
    const cert = await s.exerciseOption('o2', { quantity: 4800, date: '2026-03-01', classId: 'c1' });
    // The reverse-vesting schedule is the grant's, and so is what
    // accelerates it: buying early is not an amendment striking the term.
    expect(cert).toMatchObject({ accelTrigger: 'single', accelPct: 100 });
    expect(acceleratedVested(cert, '2026-03-01', 'single')).toBe(4800);
  });

  it('issues a plain certificate when the exercise stays inside the vested balance', async () => {
    const s = vesting({ earlyExercise: true });
    const cert = await s.exerciseOption('o2', { quantity: 2000, date: '2026-03-01', classId: 'c1' });
    expect(cert.vestingMonths).toBeUndefined();
  });

  it('allocates the earliest custom installments to the early-exercised portion', async () => {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      {
        id: 'o3', kind: 'option', label: 'OPT-3', stakeholderId: 'h1', quantity: 1_000_000,
        strike: 0.1, grantDate: '2025-01-01', date: '2025-01-01', earlyExercise: true,
        vestingTranches: [
          { date: '2026-01-01', quantity: 500_000 },
          { date: '2027-01-01', quantity: 500_000 },
        ],
      },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    const cert = await s.exerciseOption('o3', { quantity: 400_000, date: '2025-06-01', classId: 'c1' });
    // The first 400k purchased take the earliest installments; the other
    // 100k of this tranche remain on the grant for a subsequent exercise.
    expect(cert.vestingTranches).toEqual([
      { date: '2026-01-01', quantity: 400_000 },
    ]);
    expect(vestedQuantity(cert, '2026-06-01')).toBe(400_000);
    expect(vestedQuantity(cert, '2027-06-01')).toBe(400_000);
  });
});

describe('Store.updateSecurity against its award', () => {
  /** A store holding one vested grant beside the base certificates. */
  function granted() {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ ...s.company, poolAuthorized: 1000 });
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1', quantity: 1000, strike: 0.5, grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 0, cliffMonths: 0, exercised: 0 },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    return s;
  }

  it('moves the grant\u2019s exercised counter with the certificate it sized', async () => {
    const s = granted();
    const cert = await s.exerciseOption('o1', { quantity: 100, date: '2024-06-01', classId: 'c1' });
    await s.updateSecurity(cert.id, { quantity: 900 });
    expect(s.security('o1').exercised).toBe(900);
    // Left unreconciled, the grant would have issued another 900 shares.
    await expect(s.exerciseOption('o1', { quantity: 900, date: '2024-08-01', classId: 'c1' }))
      .rejects.toThrow(/more than this grant has left/);
    expect(sharesOutstanding(s.securities)).toBe(1050);
    // Shrinking hands the balance back, and an edit that leaves the size
    // alone leaves the counter alone.
    await s.updateSecurity(cert.id, { quantity: 40 });
    expect(s.security('o1').exercised).toBe(40);
    await s.updateSecurity(cert.id, { pricePerShare: 2 });
    expect(s.security('o1').exercised).toBe(40);
  });

  it('refuses a certificate bigger than the grant it came out of', async () => {
    const s = granted();
    const cert = await s.exerciseOption('o1', { quantity: 100, date: '2024-06-01', classId: 'c1' });
    await expect(s.updateSecurity(cert.id, { quantity: 1100 }))
      .rejects.toThrow('OPT-1 has 1000 options left to exercise.');
    expect(s.security(cert.id).quantity).toBe(100);
    expect(s.security('o1').exercised).toBe(100);
  });

  it('reconciles an RSU settlement the same way', async () => {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ ...s.company, poolAuthorized: 1000 });
    const award = await s.addSecurity({
      kind: 'rsu', stakeholderId: 'h1', classId: 'c1', quantity: 1000,
      grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 0, cliffMonths: 0,
    });
    const cert = await s.settleRSU(award.id, { quantity: 100, date: '2024-06-01', classId: 'c1' });
    await s.updateSecurity(cert.id, { quantity: 900 });
    expect(s.security(award.id).settled).toBe(900);
    await expect(s.settleRSU(award.id, { quantity: 900, date: '2024-08-01', classId: 'c1' }))
      .rejects.toThrow(/more than this award has left/);
  });

  it('refuses to move an award past the shares already drawn off it', async () => {
    const s = granted();
    await s.exerciseOption('o1', { quantity: 100, date: '2024-06-01', classId: 'c1' });
    await expect(s.updateSecurity('o1', { grantDate: '2025-01-01' }))
      .rejects.toThrow(/exercised out of this award on 2024-06-01/);
    expect(s.security('o1').grantDate).toBe('2024-01-01');
    // Anything that still leaves the exercise after the grant is fine.
    await s.updateSecurity('o1', { grantDate: '2024-05-31' });
    expect(s.security('o1').grantDate).toBe('2024-05-31');
    await s.updateSecurity('o1', { grantDate: '2023-01-01' });
    expect(s.security('o1').grantDate).toBe('2023-01-01');
  });

  it('applies the same rule to an RSU award and its settlements', async () => {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ ...s.company, poolAuthorized: 1000 });
    const award = await s.addSecurity({
      kind: 'rsu', stakeholderId: 'h1', classId: 'c1', quantity: 1000,
      grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 0, cliffMonths: 0,
    });
    await s.settleRSU(award.id, { quantity: 100, date: '2024-06-01', classId: 'c1' });
    await expect(s.updateSecurity(award.id, { grantDate: '2025-01-01' }))
      .rejects.toThrow(/settled out of this award on 2024-06-01/);
    expect(s.security(award.id).grantDate).toBe('2024-01-01');
  });

  it('refuses moving a grant past the departure that set its exercise deadline', async () => {
    /* The departure flow refuses a grant dated after the termination date,
       and a grant that forfeited nothing on it carried only the deadline,
       which the date could walk up to: the holder read as departed before
       the grant existed, with that departure's window on it. */
    const s = granted();
    await s.markDeparted('h1', { date: '2025-06-01', grants: [{ id: 'o1', cancelQty: 0, exerciseBy: '2025-09-01' }] });
    await expect(s.updateSecurity('o1', { grantDate: '2025-07-01', date: '2025-07-01' }))
      .rejects.toThrow('Ada departed on 2025-06-01, which set OPT-1’s exercise deadline, so its date can’t move past it.');
    expect(s.security('o1').grantDate).toBe('2024-01-01');
    // Up to the departure day is fine.
    await s.updateSecurity('o1', { grantDate: '2025-06-01', date: '2025-06-01' });
    expect(s.security('o1').grantDate).toBe('2025-06-01');
  });

  it('refuses to shrink a grant below what has already left it', async () => {
    const s = granted();
    await s.exerciseOption('o1', { quantity: 400, date: '2024-06-01', classId: 'c1' });
    await s.updateSecurity('o1', { cancellations: [{ quantity: 100, date: '2024-07-01' }] });
    const before = JSON.stringify(s.securities);
    // The sanitizer would have clamped the exercised counter to 200 while the
    // 400-share certificate stayed outstanding.
    await expect(s.updateSecurity('o1', { quantity: 300 }))
      .rejects.toThrow('OPT-1 has 400 options exercised and 100 cancelled already, so it can’t go below 500.');
    expect(JSON.stringify(s.securities)).toBe(before);
    expect(s.security('o1').exercised).toBe(400);
    // Exactly the floor is fine, and so is any edit that leaves the size alone.
    await s.updateSecurity('o1', { quantity: 500 });
    expect(s.security('o1')).toMatchObject({ quantity: 500, exercised: 400, cancelled: 100 });
    await s.updateSecurity('o1', { strike: 0.75 });
    expect(s.security('o1').exercised).toBe(400);
  });

  it('refuses to shrink an award below what it has cancelled, with nothing exercised', async () => {
    /* The guard only fired when the exercised counter dropped, so with
       nothing exercised the sanitizer clamped the forfeiture history into
       the new total: 300 and 300 cancelled became 300 and 200. */
    const s = granted();
    await s.updateSecurity('o1', { cancellations: [{ quantity: 300, date: '2025-01-01' }, { quantity: 300, date: '2025-06-01' }] });
    const before = JSON.stringify(s.securities);
    await expect(s.updateSecurity('o1', { quantity: 500 }))
      .rejects.toThrow('OPT-1 has 600 options cancelled already, so it can’t go below 600.');
    expect(JSON.stringify(s.securities)).toBe(before);
    await s.updateSecurity('o1', { quantity: 600 });
    expect(s.security('o1')).toMatchObject({ quantity: 600, cancelled: 600 });
    expect(s.security('o1').cancellations).toEqual([
      { quantity: 300, date: '2025-01-01' }, { quantity: 300, date: '2025-06-01' },
    ]);
  });

  it('refuses a cancellation that would reach into the exercised balance', async () => {
    const s = granted();
    await s.exerciseOption('o1', { quantity: 400, date: '2024-06-01', classId: 'c1' });
    await expect(s.updateSecurity('o1', { cancellations: [{ quantity: 700, date: '2024-07-01' }] }))
      .rejects.toThrow('OPT-1 has 400 options exercised already; only 600 are left to cancel.');
    expect(s.security('o1')).toMatchObject({ quantity: 1000, exercised: 400 });
    expect(s.security('o1').cancelled).toBeUndefined();
    await s.updateSecurity('o1', { cancellations: [{ quantity: 600, date: '2024-07-01' }] });
    expect(s.security('o1')).toMatchObject({ exercised: 400, cancelled: 600 });
  });

  it('holds an RSU award to its settled units the same way', async () => {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ ...s.company, poolAuthorized: 1000 });
    const award = await s.addSecurity({
      kind: 'rsu', stakeholderId: 'h1', classId: 'c1', quantity: 1000,
      grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 0, cliffMonths: 0,
    });
    await s.settleRSU(award.id, { quantity: 300, date: '2024-06-01', classId: 'c1' });
    await expect(s.updateSecurity(award.id, { quantity: 200 }))
      .rejects.toThrow(/has 300 units settled already, so it can’t go below 300/);
    await expect(s.updateSecurity(award.id, { cancellations: [{ quantity: 800, date: '2024-07-01' }] }))
      .rejects.toThrow(/only 700 are left to cancel/);
    expect(s.security(award.id)).toMatchObject({ quantity: 1000, settled: 300 });
    await s.updateSecurity(award.id, { quantity: 300 });
    expect(s.security(award.id)).toMatchObject({ quantity: 300, settled: 300 });
  });

  it('leaves the counter alone for a transfer successor', async () => {
    const s = granted();
    const cert = await s.exerciseOption('o1', { quantity: 500, date: '2024-06-01', classId: 'c1' });
    await s.transferShares(cert.id, {
      date: '2024-07-01', quantity: 200, pricePerShare: 1, to: { stakeholderId: 'h2' },
    });
    const successor = s.securities.find((x) => x.fromTransferId === cert.id && x.stakeholderId === 'h2');
    // Successors carry fromOptionId for lineage, but were never drawn off the
    // grant - certifiedByGrant counts the original, not them. Their own size
    // is settled against the transfer, so the edit changes nothing at all.
    await s.updateSecurity(successor.id, { quantity: 150 });
    expect(s.security(successor.id).quantity).toBe(200);
    expect(s.security('o1').exercised).toBe(500);
  });
});

describe('Store.updateSecurity on a transfer successor', () => {
  it('holds the size, class, and date a transfer sized them against', async () => {
    const s = makeStore();
    const { buyerCert, remainderCert } = await s.transferShares('s1', {
      quantity: 40, date: '2024-02-01', to: { stakeholderId: 'h2' },
    });
    expect(sharesOutstanding(s.securities)).toBe(150);

    await s.updateSecurity(buyerCert.id, { quantity: 400, date: '2023-12-01' });
    expect(s.security(buyerCert.id)).toMatchObject({ quantity: 40, date: '2024-02-01' });
    // Neither leg can drift out from under the 100 shares that were issued.
    await s.updateSecurity(remainderCert.id, { quantity: 5 });
    expect(s.security(remainderCert.id).quantity).toBe(60);
    expect(sharesOutstanding(s.securities)).toBe(150);
    expect(sharesOutstanding(dbAsOf(s.db, '2023-12-31').securities)).toBe(0);

    // What is not part of the transaction still saves.
    await s.updateSecurity(buyerCert.id, { pricePerShare: 3 });
    expect(s.security(buyerCert.id).pricePerShare).toBe(3);
  });

  it('carries a price correction across the whole transfer family', async () => {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities(
      s.securities.map((c) => (c.id === 's1' ? { ...c, pricePerShare: 0.85 } : c)),
      { classes: s.classes, stakeholders: s.stakeholders });
    const { buyerCert, remainderCert } = await s.transferShares('s1', {
      quantity: 40, date: '2024-02-01', pricePerShare: 1.2, to: { stakeholderId: 'h2' },
    });
    // The remainder is sold on too, so the family runs two transfers deep.
    const onward = await s.transferShares(remainderCert.id, {
      quantity: 10, date: '2024-03-01', to: { stakeholderId: 'h2' },
    });
    const family = [buyerCert.id, remainderCert.id, onward.buyerCert.id, onward.remainderCert.id];
    for (const id of family) expect(s.security(id).pricePerShare).toBe(0.85);

    // Corrected on the closed source, every leg follows - the capital the
    // issuance raised and the preference its live shares return agree again.
    await s.updateSecurity('s1', { pricePerShare: 0.8 });
    for (const id of ['s1', ...family]) expect(s.security(id).pricePerShare).toBe(0.8);
    expect(capitalRaised(s.securities)).toBeCloseTo(100 * 0.8, 6);
    // What the buyer paid is the transfer's own figure and stays put.
    expect(s.security(buyerCert.id).transferPricePerShare).toBe(1.2);

    // Corrected on a leg instead, the source and the other legs follow too.
    await s.updateSecurity(onward.buyerCert.id, { pricePerShare: 0.9 });
    for (const id of ['s1', ...family]) expect(s.security(id).pricePerShare).toBe(0.9);

    // A member already on a price of its own (an import) is left alone.
    s.securities = s.securities.map((c) => (c.id === buyerCert.id ? { ...c, pricePerShare: 2 } : c));
    await s.updateSecurity('s1', { pricePerShare: 1 });
    expect(s.security(buyerCert.id).pricePerShare).toBe(2);
    for (const id of ['s1', remainderCert.id, onward.buyerCert.id, onward.remainderCert.id]) {
      expect(s.security(id).pricePerShare).toBe(1);
    }
    // An open certificate that was never transferred is nobody's family.
    await s.updateSecurity('s2', { pricePerShare: 7 });
    expect(s.security('s1').pricePerShare).toBe(1);
  });

  it('lets the transfer’s own consideration be corrected where it is recorded', async () => {
    const s = makeStore();
    const { buyerCert, remainderCert } = await s.transferShares('s1', {
      quantity: 40, date: '2024-02-01', pricePerShare: 1.2, to: { stakeholderId: 'h2' },
    });
    // The buyer's price is the leg's own figure: it moves alone, and the
    // issue price beside it stays where the family holds it.
    await s.updateSecurity(buyerCert.id, { transferPricePerShare: 1.5 });
    expect(s.security(buyerCert.id).transferPricePerShare).toBe(1.5);
    expect(s.security(buyerCert.id).pricePerShare).toBe(s.security('s1').pricePerShare);
    // Cleared, it reads as the gift the transfer sheet would have written.
    await s.updateSecurity(buyerCert.id, { transferPricePerShare: 0 });
    expect(s.security(buyerCert.id).transferPricePerShare).toBeUndefined();
    // The seller's remainder changed no hands, so it never got one.
    expect(remainderCert.transferPricePerShare).toBeUndefined();

    // A repurchase records its price on the certificate it closed, and that
    // is where it is corrected; the retired count stays what the remainder
    // was sized against.
    await s.transferShares('s2', { quantity: 20, date: '2024-03-01', pricePerShare: 2, to: 'company' });
    expect(repurchaseTerms(s.security('s2'))).toMatchObject({ quantity: 20, pricePerShare: 2 });
    await s.updateSecurity('s2', { repurchasePricePerShare: 2.5 });
    expect(repurchaseTerms(s.security('s2'))).toMatchObject({ quantity: 20, pricePerShare: 2.5, consideration: 50 });
  });
});

describe('Store company switching', () => {
  it('refuses a save composed against the company being left', async () => {
    const kv = new Map();
    let held = null;
    let holding = null;
    globalThis.puter = {
      kv: {
        get: async (k) => {
          if (held && held(k)) await holding;
          return kv.has(k) ? kv.get(k) : null;
        },
        set: async (k, v) => { kv.set(k, v); return true; },
      },
      auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
    };
    const s = new Store();
    await s.init();
    await s.updateCompany({ name: 'Alpha' });
    const alpha = s.activeCompanyId;
    const beta = await s.createCompany('Beta');
    await s.updateCompany({ name: 'Beta' });
    await s.switchCompany(alpha);

    // A form opens against the loaded company, which is the one on screen.
    const openedFor = s.loadedCompanyId;
    expect(openedFor).toBe(alpha);

    let release;
    holding = new Promise((r) => { release = r; });
    held = (k) => k === `captable:${beta.id}:company:v1`;
    const switching = s.switchCompany(beta.id);
    await Promise.resolve();
    // The pointer has moved; the data has not.
    expect(s.activeCompanyId).toBe(beta.id);
    expect(s.loadedCompanyId).toBe(alpha);
    expect(s.switching).toBe(true);

    /* Queued behind the switch, like a form submitted while the swap is
       still in flight - so it lands after the pointer has moved. */
    const save = s.updateCompany({ name: 'Alpha renamed' }, { companyId: openedFor });
    release();
    held = null;
    await switching;
    await expect(save).rejects.toThrow(CompanyChangedError);
    expect(s.switching).toBe(false);
    expect(JSON.parse(kv.get(`captable:${alpha}:company:v1`)).name).toBe('Alpha');
    expect(JSON.parse(kv.get(`captable:${beta.id}:company:v1`)).name).toBe('Beta');

    // Naming the company that is loaded saves as usual.
    await s.updateCompany({ name: 'Beta Inc' }, { companyId: s.loadedCompanyId });
    expect(s.company.name).toBe('Beta Inc');
  });

  it('refuses a switch to a company whose delete was queued ahead of it', async () => {
    const kv = new Map();
    let held = null;
    let holding = null;
    globalThis.puter = {
      kv: {
        get: async (k) => (kv.has(k) ? kv.get(k) : null),
        set: async (k, v) => {
          if (held && held(k)) await holding;
          kv.set(k, v);
          return true;
        },
        del: async (k) => kv.delete(k),
      },
      auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
    };
    const s = new Store();
    await s.init();
    await s.updateCompany({ name: 'Alpha' });
    const alpha = s.activeCompanyId;
    const beta = await s.createCompany('Beta');
    await s.updateCompany({ name: 'Beta' });
    await s.switchCompany(alpha);
    let release;
    holding = new Promise((r) => { release = r; });
    held = (k) => k === `captable:${alpha}:hiring:v1`;
    const slow = s.saveHire({ role: 'Engineer', headcount: 1, sizeMode: 'shares', shares: 100 });
    await Promise.resolve();
    // Beta is still in the list when the switcher is pressed, so the
    // call-time check passes; its delete (queued once it has read the
    // attachment paths) runs first.
    const deleting = s.deleteCompany(beta.id);
    await new Promise((r) => setTimeout(r, 0));
    expect(s.companies.map((c) => c.id)).toEqual([alpha, beta.id]);
    const switching = s.switchCompany(beta.id);
    release();
    held = null;
    await slow;
    await deleting;
    await expect(switching).rejects.toThrow('That company is gone.');
    expect(s.activeCompanyId).toBe(alpha);
    expect(s.activeCompany?.id).toBe(alpha);
    expect(s.companies.map((c) => c.id)).toEqual([alpha]);
    expect(JSON.parse(kv.get('captable:companies:v1')).activeId).toBe(alpha);
    // The session is not stale and keeps writing to Alpha.
    await s.addStakeholder({ name: 'Ada', kind: 'founder' });
    expect(s.isStale).toBe(false);
  });

  it('refuses every write queued behind a switch that has not started yet', async () => {
    const kv = new Map();
    let held = null;
    let holding = null;
    globalThis.puter = {
      kv: {
        get: async (k) => (kv.has(k) ? kv.get(k) : null),
        set: async (k, v) => {
          if (held && held(k)) await holding;
          kv.set(k, v);
          return true;
        },
      },
      auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
    };
    const s = new Store();
    await s.init();
    await s.updateCompany({ name: 'Alpha' });
    const alpha = s.activeCompanyId;
    const beta = await s.createCompany('Beta');
    await s.switchCompany(alpha);
    const cls = await s.addClass({ name: 'Common Stock', kind: 'common' });

    /* A write of Alpha's is in flight when the switcher is pressed, so the
       switch waits behind it - and the pointer, the loaded data and the view
       all still say Alpha while the user goes on saving. */
    let release;
    holding = new Promise((r) => { release = r; });
    held = (k) => k === `captable:${alpha}:hiring:v1`;
    const slow = s.saveHire({ role: 'Engineer', headcount: 1, sizeMode: 'shares', shares: 100 });
    await Promise.resolve();
    const switching = s.switchCompany(beta.id);
    expect(s.activeCompanyId).toBe(alpha);
    expect(s.loadedCompanyId).toBe(alpha);
    // Out of service from the press, not from the switch's turn on the queue.
    expect(s.switching).toBe(true);
    const holder = s.addStakeholder({ name: 'Ghost Holder', kind: 'investor' });
    const klass = s.addClass({ name: 'Ghost Class', kind: 'preferred' });
    const valuation = s.addValuation({ date: '2024-01-01', fmvPerShare: 1.5 });
    const scenario = s.saveScenario({ name: 'Ghost Round', preMoney: 1e6, investment: 1e5 });
    const onboarded = s.updateSettings({ onboarded: true });
    const security = s.addSecurity({ kind: 'shares', stakeholderId: 'nobody', classId: cls.id, quantity: 1, date: '2024-01-01' });
    // The theme is the account's, so it lands whichever company is open by then.
    const theme = s.updateSettings({ theme: 'dark' });
    release();
    held = null;
    await slow;
    await switching;
    for (const write of [holder, klass, valuation, scenario, onboarded, security]) {
      await expect(write).rejects.toThrow(CompanyChangedError);
    }
    await theme;
    expect(s.switching).toBe(false);
    expect(s.activeCompanyId).toBe(beta.id);
    expect(s.settings.theme).toBe('dark');
    // Nothing of Alpha's landed on Beta, and nothing was lost from Alpha.
    const fresh = new Store();
    await fresh.init();
    expect(fresh.stakeholders).toEqual([]);
    expect(fresh.classes).toEqual([]);
    expect(fresh.company.valuations).toEqual([]);
    expect(fresh.scenarios).toEqual([]);
    expect(fresh.settings.onboarded).toBeUndefined();
    await fresh.switchCompany(alpha);
    expect(fresh.hiring.map((h) => h.role)).toEqual(['Engineer']);
    expect(fresh.stakeholders).toEqual([]);
  });

  it('holds a deleted scenario\'s undo to the company it was saved in', async () => {
    /* The toast's Undo used to save the scenario again as an ordinary save,
       which lands in whichever company is loaded when it is pressed: a round
       deleted in Alpha and undone after a switch turned up in Beta. */
    makeStore();
    const s = new Store();
    await s.init();
    await s.updateCompany({ name: 'Alpha' });
    const alpha = s.activeCompanyId;
    const beta = await s.createCompany('Beta');
    await s.switchCompany(alpha);
    const round = await s.saveScenario({ name: 'Series A', preMoney: 1e7, investment: 2e6 });
    const exit = await s.saveExitScenario({ name: 'Sale', exitValue: 5e7 });
    const { undo: undoRound } = await s.deleteScenario(round.id);
    const { undo: undoExit } = await s.deleteExitScenario(exit.id);
    expect(s.scenarios).toEqual([]);
    expect(s.exits).toEqual([]);
    await s.switchCompany(beta.id);
    await expect(undoRound()).rejects.toThrow('The cap table has changed since the delete.');
    await expect(undoExit()).rejects.toThrow('The cap table has changed since the delete.');
    expect(s.scenarios).toEqual([]);
    expect(s.exits).toEqual([]);
    // In its own company the undo puts the very record back, once.
    await s.switchCompany(alpha);
    const { undo } = await s.deleteScenario((await s.saveScenario({ name: 'Seed', preMoney: 4e6, investment: 1e6 })).id);
    await undo();
    await undo();
    expect(s.scenarios.map((x) => x.name)).toEqual(['Seed']);
  });
});

describe('Store KV values over the size limit', () => {
  async function chunkedStore() {
    const kv = new Map();
    globalThis.puter = {
      auth: { getUser: async () => ({ username: 'test' }) },
      kv: { get: async (k) => kv.get(k) ?? null,
        set: async (k, v) => { kv.set(k, v); return true; },
        del: async (k) => kv.delete(k) },
    };
    const s = new Store(); await s.init();
    await s.importAll({
      classes: [{ id: 'c', name: 'Common' }], stakeholders: [{ id: 'h', name: 'Ada' }],
      securities: Array.from({ length: 4000 }, (_, i) => ({
        id: `s${i}`, label: `CS-${i}`, kind: 'shares', classId: 'c', stakeholderId: 'h',
        quantity: 100, pricePerShare: 1, date: '2020-01-01',
      })),
    });
    return { s, kv, key: `captable:${s.activeCompanyId}:securities:v1` };
  }

  it('retries a read overtaken by cleanup and remembers the root actually loaded', async () => {
    const { s, kv, key } = await chunkedStore();
    const old = JSON.parse(kv.get(key));
    const firstPart = `${key}:generation:${old.generation}:part1`;
    let release, entered;
    const gate = new Promise((r) => { release = r; });
    const reading = new Promise((r) => { entered = r; });
    const get = puter.kv.get;
    puter.kv.get = async (k) => {
      if (k === firstPart) { entered(); await gate; }
      return get(k);
    };
    const other = new Store(); const load = other.init();
    await reading;
    try { await s.updateSecurity('s0', { pricePerShare: 2 }); }
    finally { release(); }
    await load;
    expect(other.security('s0').pricePerShare).toBe(2);
    await other.updateSecurity('s1', { pricePerShare: 3 });
    expect(other.isStale).toBe(false);
    expect(kv.has(firstPart)).toBe(false);
  });

  it('keeps the old value after a failed chunk write and removes unpublished parts', async () => {
    const { s, kv, key } = await chunkedStore();
    const set = puter.kv.set;
    let fail = true;
    puter.kv.set = async (k, v) => {
      if (fail && k.startsWith(`${key}:`) && k.endsWith(':part2')) {
        fail = false; throw new Error('offline');
      }
      return set(k, v);
    };
    await expect(s.updateSecurity('s0', { pricePerShare: 2 })).rejects.toThrow('offline');
    const other = new Store(); await other.init();
    expect(other.securities.every((x) => x.pricePerShare === 1)).toBe(true);
    const marker = JSON.parse(kv.get(key));
    expect([...kv.keys()].filter((k) => k.startsWith(`${key}:`))).toHaveLength(marker.__parts);
  });

  it('keeps a published generation when the marker set lands but loses its acknowledgement', async () => {
    const { s, kv, key } = await chunkedStore();
    const set = puter.kv.set;
    let lose = true;
    puter.kv.set = async (k, v) => {
      await set(k, v);
      /* The root's set commits on the server and the connection drops: the
         marker is stored, the caller hears a failure. Cleaning the new parts
         up on that failure left the stored marker pointing at nothing, and
         every load from then on threw CorruptDataError. */
      if (lose && k === key) { lose = false; throw new Error('lost ack'); }
      return true;
    };
    // The compensating rewrite fails outright, so the landed marker is what stays.
    let compensations = 0;
    const setAfter = puter.kv.set;
    puter.kv.set = async (k, v) => {
      if (!lose && k === key && compensations++ === 0) throw new Error('offline');
      return setAfter(k, v);
    };
    await expect(s.updateSecurity('s0', { pricePerShare: 2 })).rejects.toThrow();
    const marker = JSON.parse(kv.get(key));
    expect([...kv.keys()].filter((k) => k.startsWith(`${key}:generation:${marker.generation}:`))).toHaveLength(marker.__parts);
    const other = new Store();
    await other.init();
    // A reload projects the durable before-state until recovery completes.
    expect(other.securities.find((x) => x.id === 's0').pricePerShare).toBe(1);
    expect(await other.retryUnsaved()).toBe(true);
    expect(other.securities.find((x) => x.id === 's0').pricePerShare).toBe(1);
  });

  it('reads legacy parts, migrates them on save, and detects altered valid JSON', async () => {
    const { s, kv, key } = await chunkedStore();
    const { generation, ...legacy } = JSON.parse(kv.get(key));
    for (let n = 1; n <= legacy.__parts; n++) {
      const versioned = `${key}:generation:${generation}:part${n}`;
      kv.set(`${key}:part${n}`, kv.get(versioned)); kv.delete(versioned);
    }
    kv.set(key, JSON.stringify(legacy));
    const other = new Store(); await other.init();
    expect(other.securities).toHaveLength(4000);
    await other.updateSecurity('s0', { pricePerShare: 2 });
    expect(kv.has(`${key}:part1`)).toBe(false);
    const marker = JSON.parse(kv.get(key));
    const part = `${key}:generation:${marker.generation}:part1`;
    kv.set(part, kv.get(part).replace('"pricePerShare":2', '"pricePerShare":9'));
    await expect(new Store().init()).rejects.toThrow(/could not be read/);
    expect(s.securities).toHaveLength(4000);
  });

  it('publishes a complete collection while another tab reads between chunk writes', async () => {
    const kv = new Map();
    let pause = false, release, reached;
    const gate = new Promise((r) => { release = r; });
    const writing = new Promise((r) => { reached = r; });
    globalThis.puter = {
      auth: { getUser: async () => ({ username: 'test' }) },
      kv: {
        get: async (k) => kv.get(k) ?? null,
        set: async (k, v) => {
          if (pause && k.includes(':securities:v1:') && k.endsWith(':part2')) {
            reached(); await gate;
          }
          kv.set(k, v); return true;
        },
        del: async (k) => kv.delete(k),
      },
    };
    const s = new Store(); await s.init();
    const data = {
      classes: [{ id: 'c', name: 'Common' }], stakeholders: [{ id: 'h', name: 'Ada' }],
      securities: Array.from({ length: 4000 }, (_, i) => ({
        id: `s${i}`, label: `CS-${i}`, kind: 'shares', classId: 'c', stakeholderId: 'h',
        quantity: 100, pricePerShare: 1, date: '2020-01-01',
      })),
    };
    await s.importAll(data);
    const replacement = s.exportAll();
    replacement.securities = replacement.securities.map((x) => ({ ...x, pricePerShare: 2 }));
    pause = true;
    const save = s.importAll(replacement);
    await writing;
    let during;
    try {
      during = new Store(); await during.init();
    } finally {
      release(); await save;
    }
    expect(during.securities.every((x) => x.pricePerShare === 1)).toBe(true);
    const after = new Store(); await after.init();
    expect(after.securities.every((x) => x.pricePerShare === 2)).toBe(true);
  });

  it('writes a snapshot too large for one entry across parts and reads it back', async () => {
    /* Puter takes 400 KB in one KV value. A cap table whose collections each
       fit can still have a restore point - one value carrying all of them -
       that does not, and every guarded operation writes its snapshot before
       it will go ahead: transfer, split, round close, import, even wipe. */
    const kv = new Map();
    const refused = [];
    globalThis.puter = {
      kv: {
        get: async (k) => (kv.has(k) ? kv.get(k) : null),
        set: async (k, v) => {
          if (new TextEncoder().encode(String(v)).length > 400 * 1024) {
            refused.push(k);
            throw new Error('KV size exceeded');
          }
          kv.set(k, v);
          return true;
        },
      },
      auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
    };
    const s = new Store();
    await s.init();
    const stakeholders = [];
    const securities = [];
    for (let i = 0; i < 1200; i++) {
      const id = `h${i}`;
      stakeholders.push({
        id, kind: 'investor',
        name: `Stakeholder Number ${String(i).padStart(4, '0')} ${'Ünïcødé'.repeat(8)}`.slice(0, 95),
        email: `s${i}.${'y'.repeat(50)}@example.com`.slice(0, 70),
      });
      securities.push({
        id: `s${i}`, kind: 'shares', label: `CS-${i}`, stakeholderId: id, classId: 'c1',
        quantity: 100 + i, pricePerShare: 1, date: '2025-01-01',
      });
    }
    await s.importAll({
      app: 'captable', version: 1, company: { name: 'Big Co' },
      classes: [{ id: 'c1', name: 'Common Stock', kind: 'common' }], stakeholders, securities,
    });

    await s.transferShares('s0', { quantity: 10, date: '2025-06-01', to: { stakeholderId: 'h1' } });
    expect(refused).toEqual([]);
    expect(s.securities).toHaveLength(1202);
    // The snapshot lives in numbered parts behind a marker at its own key.
    const key = `captable:${s.activeCompanyId}:restorePoints:v1`;
    expect(JSON.parse(kv.get(key)).__parts).toBeGreaterThan(1);
    expect([...kv.keys()].filter((k) => k.startsWith(`${key}:`) && /:part\d+$/.test(k)).length).toBeGreaterThan(1);

    // A fresh session rejoins the parts, byte for byte.
    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.restorePoints).toHaveLength(1);
    const snapshot = reloaded.restorePoints[0].data;
    expect(snapshot.stakeholders).toHaveLength(1200);
    expect(snapshot.securities).toHaveLength(1200);
    expect(snapshot.stakeholders[5].name).toBe(s.stakeholders[5].name);

    // And it still restores, and the company can still be wiped.
    await reloaded.restoreFromPoint(reloaded.restorePoints[0].id);
    expect(reloaded.securities).toHaveLength(1200);
    await reloaded.wipeAll();
    expect(reloaded.securities).toHaveLength(0);
    expect(refused).toEqual([]);
  });

  it('cuts text into parts that fit, without splitting a surrogate pair', () => {
    const text = `${'a'.repeat(50)}😀${'b'.repeat(50)}😀${'ç'.repeat(50)}`;
    const parts = Store.chunkText(text, 40);
    expect(parts.join('')).toBe(text);
    for (const part of parts) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(40);
      expect(part).not.toMatch(/[\uD800-\uDBFF]$/);
    }
  });
});

describe('Store.trimRestorePoints', () => {
  /* A point of `holders` stakeholders, each about 300 bytes of ASCII - or
     420 bytes when the name is spelt in two-byte letters. */
  const point = (i, holders, letter = 'N') => ({
    id: `p${i}`, at: 1000 - i, label: `Point ${i}`, sampleData: false,
    data: Store.sanitizeSnapshot({
      stakeholders: Array.from({ length: holders }, (_, n) => ({
        id: `h${n}`, name: letter.repeat(120), email: 'e'.repeat(120), kind: 'employee', createdAt: 1,
      })),
    }),
  });
  const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

  it('keeps the newest points that fit under the KV value cap, measured in bytes', () => {
    // Puter takes 400 KB per value; the budget sits under it, so three
    // 150 KB points cannot all ride together and the oldest goes.
    const kept = Store.trimRestorePoints([point(1, 500), point(2, 500), point(3, 500)]);
    expect(kept.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(bytes(kept)).toBeLessThan(400 * 1024);

    // Counted as the UTF-8 the value is sent as: two points of accented
    // names are 300k string units, which the old budget would have taken,
    // and 420 KB on the wire, which the platform would not.
    const wide = [point(1, 500, 'é'), point(2, 500, 'é')];
    expect(JSON.stringify(wide).length).toBeLessThan(350_000);
    expect(bytes(wide)).toBeGreaterThan(400 * 1024);
    expect(Store.trimRestorePoints(wide).map((p) => p.id)).toEqual(['p1']);
  });

  it('always keeps the newest point, even one over the budget on its own', () => {
    expect(Store.trimRestorePoints([point(1, 1500), point(2, 5)]).map((p) => p.id)).toEqual(['p1']);
  });
});

describe('Store attachments', () => {
  /** makeStore plus an in-memory puter.fs. */
  function withFs() {
    const s = makeStore();
    const files = new Map();
    globalThis.puter.fs = {
      write: async (path, data) => { files.set(path, data); return { path }; },
      read: async (path) => { if (!files.has(path)) throw new Error('missing'); return files.get(path); },
      delete: async (path) => files.delete(path),
    };
    return { s, files };
  }

  it('keeps only paths shaped like the ones it writes', () => {
    const kept = (path) => Store.sanitizeAttachments([{ id: 'a', name: 'f.pdf', path }]).length;
    expect(kept('captable-attachments/co1/s1/abc-spa.pdf')).toBe(1);
    // Directory-shaped: fs.delete on any of these removes every file beneath it.
    expect(kept('captable-attachments/')).toBe(0);
    expect(kept('captable-attachments/co1')).toBe(0);
    expect(kept('captable-attachments/co1/s1')).toBe(0);
    expect(kept('captable-attachments/co1/s1/')).toBe(0);
    expect(kept('captable-attachments//s1/f.pdf')).toBe(0);
    expect(kept('captable-attachments/co1/./f.pdf')).toBe(0);
    expect(kept('captable-attachments/co1/../f.pdf')).toBe(0);
    // Outside the app's directory, or one level too deep.
    expect(kept('other/co1/s1/f.pdf')).toBe(0);
    expect(kept('/captable-attachments/co1/s1/f.pdf')).toBe(0);
    expect(kept('captable-attachments/co1/s1/sub/f.pdf')).toBe(0);
  });

  it('never hands a directory to fs.delete when a company goes', async () => {
    const kv = new Map();
    const files = new Map([
      ['captable-attachments/', 'dir'],
      ['captable-attachments/co2/s1/abc-spa.pdf', 'pdf'],
    ]);
    globalThis.puter = {
      kv: {
        get: async (k) => (kv.has(k) ? kv.get(k) : null),
        set: async (k, v) => { kv.set(k, v); return true; },
        del: async (k) => kv.delete(k),
      },
      fs: { delete: async (path) => files.delete(path) },
      auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
    };
    const s = new Store();
    await s.init();
    const alpha = s.activeCompanyId;
    const beta = await s.createCompany('Beta');
    // Beta's stored records, written raw as a hand-edited backup could have
    // left them before the shape rule: two directory-shaped paths and a file.
    kv.set(`captable:${beta.id}:securities:v1`, JSON.stringify([{
      id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 10, date: '2024-01-01',
      attachments: [
        { id: 'a1', name: 'root', path: 'captable-attachments/' },
        { id: 'a2', name: 'folder', path: 'captable-attachments/co2' },
        { id: 'a3', name: 'spa.pdf', path: 'captable-attachments/co2/s1/abc-spa.pdf' },
      ],
    }]));
    await s.switchCompany(alpha);
    await s.deleteCompany(beta.id);
    expect(files.has('captable-attachments/')).toBe(true);
    expect(files.has('captable-attachments/co2/s1/abc-spa.pdf')).toBe(false);
  });

  it('keeps attachment references through the sanitizer on every kind', () => {
    const atts = [{ id: 'a1', name: 'spa.pdf', path: 'captable-attachments/co1/x/a1-spa.pdf' }];
    const out = Store.sanitizeSecurities([
      { kind: 'shares', stakeholderId: 'h1', classId: 'c1', quantity: 10, attachments: atts },
      { kind: 'safe', stakeholderId: 'h1', principal: 1000, attachments: atts },
      { kind: 'option', stakeholderId: 'h1', quantity: 10, attachments: [{ name: 'no-path' }] },
    ], { classes: [{ id: 'c1', name: 'C' }], stakeholders: [{ id: 'h1', name: 'Ada' }] });
    expect(out[0].attachments).toHaveLength(1);
    expect(out[0].attachments[0]).toMatchObject({ id: 'a1', name: 'spa.pdf' });
    expect(out[1].attachments).toHaveLength(1);
    // A reference without a path is a dead link, not an attachment.
    expect(out[2].attachments).toBeUndefined();
  });

  it('uploads the file before referencing it, and removes both', async () => {
    const { s, files } = withFs();
    const att = await s.attachToSecurity('s1', { name: 'stock purchase.pdf', size: 1234 });
    expect(files.has(att.path)).toBe(true);
    expect(s.security('s1').attachments).toHaveLength(1);
    expect(s.exportAll().attachmentManifest).toEqual([
      { record: 'CS-1', securityId: 's1', name: 'stock purchase.pdf', path: att.path },
    ]);
    await s.removeSecurityAttachment('s1', att.id);
    expect(s.security('s1').attachments).toBeUndefined();
    expect(files.has(att.path)).toBe(false);
  });

  it('keeps an imported record id from steering the file out of the app directory', async () => {
    const { s, files } = withFs();
    // Ids arrive verbatim through a backup, and this one is shaped like a
    // directory climb.
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: '../../evil', kind: 'shares', label: 'CS-9', stakeholderId: 'h1', classId: 'c1', quantity: 10, date: '2024-01-01' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    const att = await s.attachToSecurity('../../evil', { name: 'SPA.pdf', size: 10 });
    expect(att.path.startsWith('captable-attachments/')).toBe(true);
    expect(att.path.split('/')).not.toContain('..');
    expect(files.has(att.path)).toBe(true);
    // And the reference landed - the sanitizer had nothing to refuse.
    expect(s.security('../../evil').attachments.map((a) => a.id)).toEqual([att.id]);
  });

  it('keeps both references when two uploads on one record overlap', async () => {
    const { s, files } = withFs();
    // A big file and a small one, finishing in the opposite order they began.
    const done = new Map();
    globalThis.puter.fs.write = async (path, data) => {
      await new Promise((r) => { done.set(path, r); });
      files.set(path, data);
      return { path };
    };
    const slow = s.attachToSecurity('s1', { name: 'big-scan.pdf', size: 9e6 });
    const fast = s.attachToSecurity('s1', { name: 'side-letter.pdf', size: 40 });
    await Promise.resolve();
    const [slowPath, fastPath] = [...done.keys()];
    done.get(fastPath)();
    await fast;
    done.get(slowPath)();
    await slow;

    // Snapshotting the list before the upload lost whichever landed first.
    expect(s.security('s1').attachments.map((a) => a.name).sort())
      .toEqual(['big-scan.pdf', 'side-letter.pdf']);
    expect(files.size).toBe(2);
  });

  it('refuses a twenty-first attachment before uploading it', async () => {
    const { s, files } = withFs();
    for (let i = 0; i < 20; i++) {
      await s.attachToSecurity('s1', { name: `doc${i}.pdf`, size: 10 });
    }
    await expect(s.attachToSecurity('s1', { name: 'doc20.pdf', size: 10 })).rejects.toThrow(/up to 20/);
    expect(s.security('s1').attachments).toHaveLength(20);
    // Nothing was written to the cloud for the one that was refused.
    expect(files.size).toBe(20);
  });

  for (const kind of ['security', 'valuation']) {
    const prepare = async () => {
      const { s, files } = withFs();
      s.company = Store.sanitizeCompany({ valuations: [{ id: 'v1', date: '2026-01-01', fmvPerShare: 1 }] });
      const original = s.exportAll();
      await s.init();
      await s.importAll(original);
      return { s, files, original,
        upload: () => kind === 'security'
          ? s.attachToSecurity('s1', { name: 'agreement.pdf', size: 10 })
          : s.attachToValuation('v1', { name: 'report.pdf', size: 10 }),
        attachments: () => kind === 'security'
          ? s.security('s1')?.attachments : s.company.valuations[0]?.attachments,
      };
    };

    it(`does not attach a pending ${kind} upload to another company with the same record ids`, async () => {
      const { s, files, original, upload, attachments } = await prepare();
      const write = puter.fs.write;
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      puter.fs.write = async (...args) => { await gate; return write(...args); };
      const pending = upload().catch((error) => error);
      await s.createCompany('Another company');
      await s.importAll(original);
      release();
      expect(await pending).toBeInstanceOf(Error);
      expect(attachments()).toBeUndefined();
      expect(files.size).toBe(0);
    });

    it(`cleans up a ${kind} upload when saving its reference fails`, async () => {
      const { files, upload, attachments } = await prepare();
      puter.kv.set = async () => { throw new Error('offline'); };
      await expect(upload()).rejects.toThrow('offline');
      expect(attachments()).toBeUndefined();
      expect(files.size).toBe(0);
    });

    it(`rejects a ${kind} upload after the dataset is replaced with the same record ids`, async () => {
      const { s, files, original, upload, attachments } = await prepare();
      const write = puter.fs.write;
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      puter.fs.write = async (...args) => { await gate; return write(...args); };
      const pending = upload().catch((error) => error);
      await s.importAll(original);
      release();
      expect(await pending).toBeInstanceOf(Error);
      expect(attachments()).toBeUndefined();
      expect(files.size).toBe(0);
    });
  }

  it('attaches to a 409A valuation and survives the company sanitizer', async () => {
    const { s, files } = withFs();
    s.company = Store.sanitizeCompany({
      ...s.company, valuations: [{ id: 'v1', date: '2026-01-01', fmvPerShare: 0.5 }],
    });
    const att = await s.attachToValuation('v1', { name: '409a-report.pdf', size: 99 });
    expect(s.company.valuations[0].attachments).toHaveLength(1);
    expect(s.attachmentManifest()[0]).toMatchObject({ record: '409A 2026-01-01', name: '409a-report.pdf' });
    await s.removeValuationAttachment('v1', att.id, { deleteFile: false });
    expect(s.company.valuations[0].attachments).toBeUndefined();
    // deleteFile: false keeps the file for the "keep files" path.
    expect(files.has(att.path)).toBe(true);
  });

  /** A store over an in-memory Puter, with companies to switch between. */
  async function twoCompanyFs() {
    const kv = new Map();
    const files = new Map();
    globalThis.puter = {
      kv: {
        get: async (k) => (kv.has(k) ? kv.get(k) : null),
        set: async (k, v) => { kv.set(k, v); return true; },
        del: async (k) => kv.delete(k),
      },
      fs: {
        write: async (path, data) => { files.set(path, data); return { path }; },
        delete: async (path) => files.delete(path),
      },
      auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
    };
    const s = new Store();
    await s.init();
    const holder = await s.addStakeholder({ name: 'Ada', kind: 'founder' });
    const cls = await s.addClass({ name: 'Common Stock', kind: 'common' });
    const cert = await s.addSecurity({ kind: 'shares', stakeholderId: holder.id, classId: cls.id, quantity: 100, date: '2025-01-01' });
    const valuation = await s.addValuation({ date: '2025-06-01', fmvPerShare: 2 });
    return { s, files, cert, valuation, original: s.activeCompanyId };
  }

  it('keeps a file the original company still names when the imported copy’s reference is removed', async () => {
    /* A backup imported into a second company carries the same attachment
       paths. Removing the copied reference deleted the file behind it, and
       the original company kept a reference to a file that was gone. */
    const { s, files, cert, valuation, original } = await twoCompanyFs();
    const spa = await s.attachToSecurity(cert.id, { name: 'signed SPA.pdf', size: 10 });
    const report = await s.attachToValuation(valuation.id, { name: '409a-report.pdf', size: 10 });
    const backup = structuredClone(s.exportAll());
    await s.createCompany('Copy');
    await s.importAll(backup, { label: 'Before importing' });
    expect(s.security(cert.id).attachments[0].path).toBe(spa.path);

    await s.removeSecurityAttachment(cert.id, spa.id);
    await s.removeValuationAttachment(valuation.id, report.id);
    expect(s.security(cert.id).attachments).toBeUndefined();
    expect(files.has(spa.path)).toBe(true);
    expect(files.has(report.path)).toBe(true);

    await s.switchCompany(original);
    expect(s.security(cert.id).attachments[0].path).toBe(spa.path);
    expect(s.company.valuations[0].attachments[0].path).toBe(report.path);
    // The last reference takes the file with it.
    await s.removeSecurityAttachment(cert.id, spa.id);
    await s.removeValuationAttachment(valuation.id, report.id);
    expect(files.has(spa.path)).toBe(false);
    expect(files.has(report.path)).toBe(false);
  });

  it('deletes the files behind a deleted record except one another company still names', async () => {
    /* The views delete the files of a deleted record when asked to, and did
       so path by path with no look at the other companies. */
    const { s, files, cert, original } = await twoCompanyFs();
    const shared = await s.attachToSecurity(cert.id, { name: 'shared.pdf', size: 10 });
    const backup = structuredClone(s.exportAll());
    await s.createCompany('Copy');
    await s.importAll(backup, { label: 'Before importing' });
    await s.switchCompany(original);
    const own = await s.attachToSecurity(cert.id, { name: 'own.pdf', size: 10 });
    const attachments = s.security(cert.id).attachments;
    expect(attachments).toHaveLength(2);

    await s.deleteSecurity(cert.id);
    await s.deleteAttachmentFiles(attachments);
    expect(files.has(shared.path)).toBe(true);
    expect(files.has(own.path)).toBe(false);
    // Paths a hand-edited backup could carry are never handed to fs.delete.
    files.set('captable-attachments/', 'dir');
    await s.deleteAttachmentFiles([{ path: 'captable-attachments/' }, { path: '../elsewhere.pdf' }, null]);
    expect(files.has('captable-attachments/')).toBe(true);
  });
});

describe('Store multi-company', () => {
  /** A live KV harness seeded with initial entries, returned for inspection. */
  function kvHarness(initial = {}) {
    const kv = new Map(Object.entries(initial));
    globalThis.puter = {
      kv: {
        get: async (k) => (kv.has(k) ? kv.get(k) : null),
        set: async (k, v) => { kv.set(k, v); return true; },
        del: async (k) => kv.delete(k),
      },
      auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
    };
    return kv;
  }

  it('migrates legacy singleton keys into company #1 exactly once', async () => {
    const kv = kvHarness({
      'captable:settings:v1': JSON.stringify({ theme: 'dark', onboarded: true, sampleData: false }),
      'captable:company:v1': JSON.stringify({ name: 'Acme', poolAuthorized: 100 }),
      'captable:stakeholders:v1': JSON.stringify([{ id: 'h1', name: 'Ada', kind: 'founder' }]),
    });
    const s = new Store();
    await s.init();
    expect(s.companies).toHaveLength(1);
    expect(s.activeCompany.label).toBe('Acme');
    expect(s.company.name).toBe('Acme');
    expect(s.stakeholders.map((h) => h.name)).toEqual(['Ada']);
    // Theme stays account-wide; the flags moved onto the company.
    expect(s.settings.theme).toBe('dark');
    expect(s.settings.onboarded).toBe(true);
    // Singletons are gone, namespaced keys and the registry exist.
    expect(kv.has('captable:company:v1')).toBe(false);
    expect(kv.has(`captable:${s.activeCompanyId}:company:v1`)).toBe(true);
    expect(kv.has('captable:companies:v1')).toBe(true);
    // A second boot loads the same company without re-migrating.
    const s2 = new Store();
    await s2.init();
    expect(s2.companies).toHaveLength(1);
    expect(s2.company.name).toBe('Acme');
  });

  it('finishes the migration when the registry write landed but its acknowledgement was lost', async () => {
    const kv = kvHarness({
      'captable:company:v1': JSON.stringify({ name: 'Acme', poolAuthorized: 100 }),
      'captable:stakeholders:v1': JSON.stringify([{ id: 'h1', name: 'Ada', kind: 'founder' }]),
    });
    const set = puter.kv.set;
    let lost = true;
    puter.kv.set = async (k, v) => {
      await set(k, v);
      if (k === 'captable:companies:v1' && lost) { lost = false; throw new Error('connection reset'); }
      return true;
    };
    const s = new Store();
    await s.init();
    puter.kv.set = set;
    // Cleaned up as a failure, the next boot found the registry, skipped the
    // migration, and loaded an empty company while the singletons still held
    // the cap table.
    expect(s.company.name).toBe('Acme');
    expect(s.stakeholders.map((h) => h.name)).toEqual(['Ada']);
    expect(kv.has('captable:company:v1')).toBe(false);
    const s2 = new Store();
    await s2.init();
    expect(s2.companies).toHaveLength(1);
    expect(s2.company.name).toBe('Acme');
    expect(s2.stakeholders.map((h) => h.name)).toEqual(['Ada']);
  });

  it('leaves no orphaned copy behind when the migration fails at the registry write', async () => {
    const kv = kvHarness({
      'captable:company:v1': JSON.stringify({ name: 'Acme', poolAuthorized: 100 }),
      'captable:stakeholders:v1': JSON.stringify([{ id: 'h1', name: 'Ada', kind: 'founder' }]),
    });
    const set = puter.kv.set;
    puter.kv.set = async (k, v) => {
      if (k === 'captable:companies:v1') throw new Error('offline');
      return set(k, v);
    };
    await expect(new Store().init()).rejects.toThrow('offline');
    puter.kv.set = set;
    // The singletons stand for the retry; the half-made namespaced copy is gone.
    expect(kv.has('captable:company:v1')).toBe(true);
    expect([...kv.keys()].filter((k) => /^captable:[^:]+:company:v1$/.test(k))).toEqual([]);
    const s = new Store();
    await s.init();
    expect(s.company.name).toBe('Acme');
    expect(s.stakeholders.map((h) => h.name)).toEqual(['Ada']);
    // Exactly one namespaced copy, the one the registry names.
    expect([...kv.keys()].filter((k) => /^captable:[^:]+:company:v1$/.test(k)))
      .toEqual([`captable:${s.activeCompanyId}:company:v1`]);
    expect(kv.has('captable:company:v1')).toBe(false);
  });

  it('drops a duplicate entry from the registry', async () => {
    kvHarness({
      'captable:companies:v1': JSON.stringify({
        activeId: 'a',
        companies: [{ id: 'a', label: 'A', createdAt: 1 }, { id: 'a', label: 'A again', createdAt: 2 }],
      }),
    });
    const s = new Store();
    await s.init();
    expect(s.companies.map((c) => c.id)).toEqual(['a']);
    // Deleting the one company is refused rather than reading the first of nothing.
    await expect(s.deleteCompany('a')).rejects.toThrow(/must remain/);
    expect(s.companies.map((c) => c.id)).toEqual(['a']);
  });

  it('starts a fresh account with one empty slot', async () => {
    kvHarness();
    const s = new Store();
    await s.init();
    expect(s.companies).toHaveLength(1);
    expect(s.company.name).toBe('');
    expect(s.securities).toEqual([]);
  });

  it('follows the profile name onto the registry label, including when it is cleared', async () => {
    kvHarness();
    const s = new Store();
    await s.init();
    await s.updateCompany({ name: 'Acme Robotics, Inc.' });
    expect(s.activeCompany.label).toBe('Acme Robotics, Inc.');

    // A wipe leaves an empty cap table; a label left behind would keep naming
    // it after the company that was just deleted.
    await s.wipeAll();
    expect(s.company.name).toBe('');
    expect(s.activeCompany.label).toBe('');

    const s2 = new Store();
    await s2.init();
    expect(s2.activeCompany.label).toBe('');
  });

  it('a failed non-active delete leaves the company everywhere, not just on disk', async () => {
    kvHarness();
    const s = new Store();
    await s.init();
    const first = s.activeCompanyId;
    await s.createCompany('Second Co');

    const set = puter.kv.set;
    puter.kv.set = async (k, v) => {
      if (k === 'captable:companies:v1') throw new Error('offline');
      return set(k, v);
    };
    await expect(s.deleteCompany(first)).rejects.toThrow('offline');
    puter.kv.set = set;

    // Memory still lists it - otherwise the switcher shows it gone while the
    // caller was told nothing changed...
    expect(s.companies.some((c) => c.id === first)).toBe(true);

    // ...and a later unrelated registry write must not commit the deletion.
    await s.updateCompany({ name: 'Renamed Second' });
    await s.updateSettings({ onboarded: true });
    const s2 = new Store();
    await s2.init();
    expect(s2.companies.some((c) => c.id === first)).toBe(true);
  });

  it('finishes a guarded write on the company it started on when a switch is clicked mid-way', async () => {
    const kv = kvHarness();
    const s = new Store();
    await s.init();
    const first = s.activeCompanyId;
    await s.updateCompany({ name: 'First Co', poolAuthorized: 5000 });
    await s.addStakeholder({ name: 'Ada', kind: 'founder' });
    const second = await s.createCompany('Second Co');
    await s.updateCompany({ name: 'Second Co', poolAuthorized: 300 });
    await s.addStakeholder({ name: 'Bob', kind: 'founder' });
    await s.switchCompany(first);

    // A slow connection: every KV write takes a moment, which is exactly
    // when someone reaches for the company switcher.
    const set = puter.kv.set;
    puter.kv.set = (k, v) => new Promise((resolve) => setTimeout(() => resolve(set(k, v)), 5));
    const wipe = s.wipeAll();
    const sw = s.switchCompany(second.id);
    await Promise.allSettled([wipe, sw]);
    puter.kv.set = set;

    // The wipe landed on First Co, the company it was started on...
    const other = new Store();
    await other.init();
    expect(other.activeCompanyId).toBe(second.id);
    expect(other.company.name).toBe('Second Co');
    expect(other.company.poolAuthorized).toBe(300);
    expect(other.stakeholders.map((h) => h.name)).toEqual(['Bob']);
    // ...with its restore point, and Second Co was never touched.
    expect(JSON.parse(kv.get(`captable:${first}:stakeholders:v1`))).toEqual([]);
    expect(JSON.parse(kv.get(`captable:${first}:restorePoints:v1`))).toHaveLength(1);
    expect(JSON.parse(kv.get(`captable:${first}:settings:v1`)).onboarded).toBe(false);
    expect(other.restorePoints).toEqual([]);
    expect(other.settings.onboarded).not.toBe(false);
  });

  it('labels the company a rename committed on when a switch is clicked mid-way', async () => {
    kvHarness();
    const s = new Store();
    await s.init();
    const first = s.activeCompanyId;
    await s.updateCompany({ name: 'Acme Robotics' });
    const second = await s.createCompany('Beta Labs');
    await s.updateCompany({ name: 'Beta Labs' });
    await s.switchCompany(first);

    const set = puter.kv.set;
    puter.kv.set = (k, v) => new Promise((resolve) => setTimeout(() => resolve(set(k, v)), 5));
    const rename = s.updateCompany({ name: 'Acme Robotics, Inc.' });
    const sw = s.switchCompany(second.id);
    await Promise.allSettled([rename, sw]);
    // And a company created while a rename is in flight must not carry the
    // list as it stood at click time over the rename's label.
    const rename2 = s.updateCompany({ name: 'Beta Labs Ltd' });
    const created = s.createCompany('Gamma');
    await Promise.allSettled([rename2, created]);
    puter.kv.set = set;
    // The relabel's own registry write is queued behind the create; let it land.
    await s.updateSettings({});

    const label = (store, id) => store.companies.find((c) => c.id === id).label;
    expect(label(s, first)).toBe('Acme Robotics, Inc.');
    expect(label(s, second.id)).toBe('Beta Labs Ltd');
    expect(s.companies).toHaveLength(3);
    const other = new Store();
    await other.init();
    expect(label(other, first)).toBe('Acme Robotics, Inc.');
    expect(label(other, second.id)).toBe('Beta Labs Ltd');
    expect(other.companies).toHaveLength(3);
  });

  it('restores on the company the restore point belongs to when a switch is clicked mid-way', async () => {
    const kv = kvHarness();
    const s = new Store();
    await s.init();
    const first = s.activeCompanyId;
    await s.updateCompany({ name: 'First Co' });
    await s.addStakeholder({ name: 'Ada', kind: 'founder' });
    await s.recordSplit({ num: 2, den: 1, date: '2026-01-01' });
    const second = await s.createCompany('Second Co');
    await s.updateCompany({ name: 'Second Co' });
    await s.addStakeholder({ name: 'Bob', kind: 'founder' });
    await s.switchCompany(first);

    const set = puter.kv.set;
    puter.kv.set = (k, v) => new Promise((resolve) => setTimeout(() => resolve(set(k, v)), 5));
    const restore = s.restoreFromPoint(s.restorePoints[0].id);
    const sw = s.switchCompany(second.id);
    await Promise.allSettled([restore, sw]);
    puter.kv.set = set;

    expect(JSON.parse(kv.get(`captable:${first}:company:v1`)).splits).toEqual([]);
    expect(JSON.parse(kv.get(`captable:${second.id}:company:v1`)).name).toBe('Second Co');
    expect(JSON.parse(kv.get(`captable:${second.id}:stakeholders:v1`)).map((h) => h.name)).toEqual(['Bob']);
    expect(s.companies.find((c) => c.id === second.id).label).toBe('Second Co');
  });

  it('keeps companies fully separate across create and switch', async () => {
    kvHarness();
    const s = new Store();
    await s.init();
    const first = s.activeCompanyId;
    await s.updateCompany({ name: 'First Co' });
    await s.addStakeholder({ name: 'Ada', kind: 'founder' });

    await s.createCompany('Second Co');
    expect(s.activeCompanyId).not.toBe(first);
    expect(s.stakeholders).toEqual([]);
    expect(s.company.name).toBe('');
    await s.addStakeholder({ name: 'Bob', kind: 'founder' });

    await s.switchCompany(first);
    expect(s.company.name).toBe('First Co');
    expect(s.stakeholders.map((h) => h.name)).toEqual(['Ada']);
    // Registry labels follow the profile name.
    expect(s.companies.map((c) => c.label).sort()).toEqual(['First Co', 'Second Co']);

    // Another boot lands on the last active company.
    const s2 = new Store();
    await s2.init();
    expect(s2.activeCompanyId).toBe(first);
    expect(s2.company.name).toBe('First Co');
  });

  it('deletes a company and its keys, but never the last one', async () => {
    const kv = kvHarness();
    const s = new Store();
    await s.init();
    const first = s.activeCompanyId;
    await expect(s.deleteCompany(first)).rejects.toThrow(/must remain/);

    const doomed = await s.createCompany('Doomed');
    await s.addStakeholder({ name: 'Bob', kind: 'founder' });
    expect(kv.has(`captable:${doomed.id}:stakeholders:v1`)).toBe(true);
    await s.deleteCompany(doomed.id);
    expect(s.activeCompanyId).toBe(first);
    expect(s.companies).toHaveLength(1);
    expect(kv.has(`captable:${doomed.id}:stakeholders:v1`)).toBe(false);
  });

  it('deletes the parts of a collection stored in parts along with the company', async () => {
    /* A collection too large for one KV value is a marker at its own key and
       the value itself in numbered part keys. Deleting the keys alone removed
       the markers and left every part - the whole dataset, plus the restore
       points behind it - in the user's cloud with nothing pointing at it. */
    const kv = kvHarness();
    const s = new Store();
    await s.init();
    const first = s.activeCompanyId;
    const doomed = await s.createCompany('Doomed');
    const securities = [];
    for (let i = 0; i < 3000; i++) {
      securities.push({
        id: `s${i}`, kind: 'shares', label: `CS-${i + 1}`, stakeholderId: 'h1', classId: 'c1',
        quantity: 100, pricePerShare: 1, date: '2025-01-01',
        attachments: [{
          id: `a${i}`, name: `Subscription agreement ${i}.pdf`, size: 1, addedAt: 1,
          path: `captable-attachments/${doomed.id}/s${i}/agreement.pdf`,
        }],
      });
    }
    await s.importAll({
      company: { name: 'Doomed' },
      classes: [{ id: 'c1', name: 'Common Stock', kind: 'common' }],
      stakeholders: [{ id: 'h1', name: 'Ada', kind: 'founder' }],
      securities,
    });
    // The list itself, and the restore point a guarded write then takes of
    // it, are both written in parts.
    await s.transferShares('s0', { quantity: 10, date: '2025-06-01', to: 'company' });
    const owned = () => [...kv.keys()].filter((k) => k.includes(`:${doomed.id}:`));
    expect(owned().filter((k) => /:part\d+$/.test(k)).length).toBeGreaterThan(2);

    await s.deleteCompany(doomed.id);
    expect(s.activeCompanyId).toBe(first);
    expect(owned()).toEqual([]);
  });

  it('deletes the files behind a deleted company’s attachments, except ones another company still names', async () => {
    /* Every KV key of the company went, but the signed agreements and 409A
       reports its records pointed at stayed in the user's cloud with nothing
       pointing at them, while the confirmation said its data was gone. */
    kvHarness();
    const deleted = [];
    globalThis.puter.fs = { write: async () => ({}), delete: async (p) => { deleted.push(p); } };
    const s = new Store();
    await s.init();
    const first = s.activeCompanyId;
    const doomed = await s.createCompany('Doomed');
    const path = (n) => `captable-attachments/${doomed.id}/s1/${n}.pdf`;
    const file = (n) => ({ id: n, name: `${n}.pdf`, path: path(n), size: 1, addedAt: 1 });
    const dataset = (attachments) => ({
      company: { name: 'Doomed', valuations: [{ id: 'v1', date: '2025-01-01', fmvPerShare: 1, attachments: [file('409a')] }] },
      classes: [{ id: 'c1', name: 'Common Stock', kind: 'common' }],
      stakeholders: [{ id: 'h1', name: 'Ada', kind: 'founder' }],
      securities: [{
        id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1',
        quantity: 100, pricePerShare: 1, date: '2025-01-01', attachments,
      }],
    });
    await s.importAll(dataset([file('spa'), file('shared')]));
    // A file only a restore point still names is this company's too.
    await s.importAll(dataset([file('spa')]));
    // The first company imported this one's backup, so it names one of the files.
    await s.switchCompany(first);
    await s.importAll({ ...dataset([file('shared')]), company: { name: 'Clone' } });

    await s.deleteCompany(doomed.id);
    expect(s.companies.map((c) => c.id)).toEqual([first]);
    expect(deleted.sort()).toEqual([path('409a'), path('spa')]);
  });

  it('removes no file when a surviving company cannot be read', async () => {
    const kv = kvHarness();
    const deleted = [];
    globalThis.puter.fs = { write: async () => ({}), delete: async (p) => { deleted.push(p); } };
    const s = new Store();
    await s.init();
    const first = s.activeCompanyId;
    const doomed = await s.createCompany('Doomed');
    await s.importAll({
      company: { name: 'Doomed' },
      classes: [{ id: 'c1', name: 'Common Stock', kind: 'common' }],
      stakeholders: [{ id: 'h1', name: 'Ada', kind: 'founder' }],
      securities: [{
        id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 100, date: '2025-01-01',
        attachments: [{ id: 'a', name: 'a.pdf', path: `captable-attachments/${doomed.id}/s1/a.pdf`, size: 1, addedAt: 1 }],
      }],
    });
    await s.switchCompany(first);
    // The survivor's securities are damaged: whether it names the file is unknowable.
    kv.set(`captable:${first}:securities:v1`, '{not json');
    await s.deleteCompany(doomed.id);
    expect(s.companies.map((c) => c.id)).toEqual([first]);
    expect(deleted).toEqual([]);
  });

  it('waits for late writes before rolling a failed deletion back', async () => {
    const kv = kvHarness();
    const s = new Store();
    await s.init();
    const holder = await s.addStakeholder({ name: 'Ada', kind: 'founder' });
    const cls = await s.addClass({ name: 'Common' });
    await s.addSecurity({ kind: 'shares', stakeholderId: holder.id, classId: cls.id, quantity: 100, date: '2024-01-01' });
    const set = puter.kv.set;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    puter.kv.set = async (key, value) => {
      if (key.endsWith(':securities:v1') && value === '[]') throw new Error('offline');
      if (key.endsWith(':stakeholders:v1') && value === '[]') await gate;
      return set(key, value);
    };
    const deletion = s.deleteStakeholder(holder.id).catch((error) => error);
    // Let the rejection and any premature rollback finish before the late write.
    await new Promise((resolve) => setImmediate(resolve));
    release();
    expect(await deletion).toMatchObject({ message: 'offline' });
    puter.kv.set = set;
    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.stakeholders).toEqual(s.stakeholders);
    expect(reloaded.securities).toEqual(s.securities);
    expect(reloaded.securities).toHaveLength(1);
  });

  it('waits for both settings keys before rolling back a failed settings save', async () => {
    const kv = kvHarness();
    const s = new Store();
    await s.init();
    await s.updateSettings({ onboarded: true });
    const set = puter.kv.set;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    puter.kv.set = async (key, value) => {
      if (key === 'captable:settings:v1' && JSON.parse(value).theme === 'dark') {
        throw new Error('offline');
      }
      if (key !== 'captable:settings:v1' && JSON.parse(value).onboarded === false) await gate;
      return set(key, value);
    };
    const save = s.updateSettings({ theme: 'dark', onboarded: false }).catch((error) => error);
    await new Promise((resolve) => setImmediate(resolve));
    release();
    expect(await save).toMatchObject({ message: 'offline' });
    puter.kv.set = set;
    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.settings).toEqual(s.settings);
    expect(reloaded.settings.onboarded).toBe(true);
  });

  it('refuses to boot past an unreadable record rather than replacing it', async () => {
    const kv = kvHarness();
    const s = new Store();
    await s.init();
    await s.updateCompany({ name: 'Acme' });
    await s.addStakeholder({ name: 'Ada', kind: 'founder' });
    const registry = kv.get('captable:companies:v1');

    // The registry value is damaged - a truncated write, say.
    kv.set('captable:companies:v1', '{"activeId":"abc","compa');
    const s2 = new Store();
    await expect(s2.init()).rejects.toThrow(/could not be read/);
    // Untouched: reading it as a fresh account would have overwritten the
    // registry and orphaned every company's data behind it.
    expect(kv.get('captable:companies:v1')).toBe('{"activeId":"abc","compa');

    // A damaged collection is refused the same way, not read as empty.
    kv.set('captable:companies:v1', registry);
    const id = JSON.parse(registry).activeId;
    kv.set(`captable:${id}:securities:v1`, 'not json');
    await expect(new Store().init()).rejects.toThrow(/could not be read/);

    // Repaired, everything loads as before.
    kv.set(`captable:${id}:securities:v1`, '[]');
    const s3 = new Store();
    await s3.init();
    expect(s3.company.name).toBe('Acme');
    expect(s3.stakeholders.map((h) => h.name)).toEqual(['Ada']);
  });

  it.each(['{}', '[]', 'false', 'null', '{"companies":[]}'])(
    'refuses a stored registry with an invalid shape (%s) without overwriting it', async (raw) => {
      const kv = kvHarness({ 'captable:companies:v1': raw });
      await expect(new Store().init()).rejects.toThrow(/could not be read/);
      expect(kv.get('captable:companies:v1')).toBe(raw);
      expect(kv.size).toBe(1);
    });

  it.each(['{}', 'false', 'null', '"not a collection"'])(
    'refuses a stored collection with an invalid shape (%s)', async (raw) => {
      const kv = kvHarness();
      const s = new Store();
      await s.init();
      await s.addStakeholder({ name: 'Ada' });
      const key = `captable:${s.activeCompanyId}:stakeholders:v1`;
      kv.set(key, raw);
      const before = [...kv];
      await expect(new Store().init()).rejects.toThrow(/could not be read/);
      expect([...kv]).toEqual(before);
    });

  it('refuses malformed legacy data before creating a registry or deleting the original', async () => {
    const raw = '{}';
    const kv = kvHarness({ 'captable:securities:v1': raw });
    await expect(new Store().init()).rejects.toThrow(/could not be read/);
    expect([...kv]).toEqual([['captable:securities:v1', raw]]);
  });

  it('starts anyway when only the stored theme is unreadable', async () => {
    const kv = kvHarness();
    const s = new Store();
    await s.init();
    await s.updateCompany({ name: 'Acme' });

    kv.set('captable:settings:v1', '{oops');
    const s2 = new Store();
    await s2.init();
    expect(s2.settings.theme).toBe('system');
    expect(s2.company.name).toBe('Acme');
  });

  it('keeps the pointer with the loaded data when a switch fails', async () => {
    const kv = kvHarness();
    const s = new Store();
    await s.init();
    const first = s.activeCompanyId;
    await s.updateCompany({ name: 'First Co' });
    await s.addStakeholder({ name: 'Ada', kind: 'founder' });

    const second = await s.createCompany('Second Co');
    await s.updateCompany({ name: 'Second Co' });
    await s.addStakeholder({ name: 'Bob', kind: 'founder' });
    await s.switchCompany(first);

    // The connection drops midway through switching back.
    const get = puter.kv.get;
    puter.kv.get = async (k) => {
      if (k === `captable:${second.id}:securities:v1`) throw new Error('offline');
      return get(k);
    };
    await expect(s.switchCompany(second.id)).rejects.toThrow(/offline/);
    puter.kv.get = get;

    // The failed switch must leave the pointer on the company still in memory,
    // or the next write lands First Co's collections on Second Co's keys.
    expect(s.activeCompanyId).toBe(first);
    expect(s.company.name).toBe('First Co');
    expect(s.stakeholders.map((h) => h.name)).toEqual(['Ada']);

    await s.addStakeholder({ name: 'Cy', kind: 'employee' });
    expect(JSON.parse(kv.get(`captable:${second.id}:stakeholders:v1`)).map((h) => h.name))
      .toEqual(['Bob']);

    // And Second Co is still intact on the next boot.
    await s.switchCompany(second.id);
    expect(s.company.name).toBe('Second Co');
    expect(s.stakeholders.map((h) => h.name)).toEqual(['Bob']);
  });
});

describe('Store concurrent sessions', () => {
  /** Two Stores over one KV backend: two tabs on the same company. */
  async function twoTabs() {
    const kv = new Map();
    globalThis.puter = {
      kv: {
        get: async (k) => (kv.has(k) ? kv.get(k) : null),
        set: async (k, v) => { kv.set(k, v); return true; },
      },
      auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
    };
    const a = new Store();
    await a.init();
    const b = new Store();
    await b.init();
    return { a, b };
  }

  it('refuses a save over a change another session confirmed', async () => {
    const { a, b } = await twoTabs();
    await a.addStakeholder({ name: 'Saved from tab A' });
    /* B still holds the list from before A's save, and a collection is
       persisted by replacing it whole - so this write would put B's copy
       straight over A's confirmed record and report success. */
    await expect(b.addStakeholder({ name: 'Saved from tab B' })).rejects.toThrow(/changed somewhere else/);
    expect(b.isStale).toBe(true);
    // Nothing of B's landed, and A's record survives a reload.
    const reload = new Store();
    await reload.init();
    expect(reload.stakeholders.map((h) => h.name)).toEqual(['Saved from tab A']);
  });

  it('lets a backup import through after another session flipped a company flag', async () => {
    /* Two tabs on a new company, both on the Welcome sheet. Tab A closes it,
       which writes onboarded onto the company's settings key alone; tab B
       imports a backup, which writes the same flag beside the data. The
       flags describe the dataset, whose keys carry their own guards, so a
       flag flipped elsewhere is nothing to refuse - refused, the import
       rewrote every data key empty and flagged B as behind. */
    const { a, b } = await twoTabs();
    await a.updateSettings({ onboarded: true });
    await b.importAll({
      company: { name: 'Imported' },
      classes: [{ id: 'c1', name: 'Common Stock', kind: 'common' }],
      stakeholders: [{ id: 'h1', name: 'Ada', kind: 'founder' }],
      securities: [{ id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 100, date: '2024-01-01' }],
    }, { settings: { onboarded: true, sampleData: false } });
    expect(b.isStale).toBe(false);
    expect(b.company.name).toBe('Imported');
    const reload = new Store();
    await reload.init();
    expect(reload.company.name).toBe('Imported');
    expect(reload.settings.onboarded).toBe(true);
    // Data keys keep their guard: A, which never saw the import, is refused.
    await b.addStakeholder({ name: 'Grace' });
    await expect(a.addStakeholder({ name: 'Linus' })).rejects.toThrow(/changed somewhere else/);
  });

  it('lets a settings save through after another session changed the theme', async () => {
    /* The theme is account-wide and syncs across devices; the rest of the
       settings belong to the company. Every settings save used to write
       both, so a theme switched on a phone made the next onboarding, sample
       load, or backup import on the laptop fail as "changed somewhere else"
       and marked that session stale - over a preference it never meant to
       touch. */
    const { a, b } = await twoTabs();
    await a.updateSettings({ theme: 'dark' });
    await b.updateSettings({ onboarded: true });
    expect(b.isStale).toBe(false);
    expect(b.settings.onboarded).toBe(true);
    // A's choice stands: B did not put its older theme back.
    expect(JSON.parse(await puter.kv.get('captable:settings:v1'))).toEqual({ theme: 'dark' });
    // The writes that carry settings with a dataset go through too.
    await b.importAll({ company: { name: 'Imported' } }, {
      label: 'Before importing a backup', settings: { onboarded: true, sampleData: false },
    });
    expect(b.isStale).toBe(false);
    expect(b.company.name).toBe('Imported');
    expect(JSON.parse(await puter.kv.get('captable:settings:v1'))).toEqual({ theme: 'dark' });
    // A theme change of B's own is last-write-wins, never a stale refusal.
    await b.updateSettings({ theme: 'light' });
    expect(b.isStale).toBe(false);
    expect(JSON.parse(await puter.kv.get('captable:settings:v1'))).toEqual({ theme: 'light' });
    const reload = new Store();
    await reload.init();
    expect(reload.settings.theme).toBe('light');
    expect(reload.settings.onboarded).toBe(true);
  });

  it('merges the activity log with another session’s instead of refusing', async () => {
    /* The log is append-only, and the one collection two sessions can both
       add to without either being wrong. Refused like any other collision,
       this session's line was dropped and the session marked stale - "your
       last change wasn't saved" over a share class that had just been saved
       in a collection the other tab never touched. */
    const { a, b } = await twoTabs();
    const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
    await a.addStakeholder({ name: 'Ada' });
    a.logActivity('Ada added as founder');
    await settle();
    await b.addClass({ name: 'Common' });
    b.logActivity('Share class Common created');
    await settle();

    expect(b.isStale).toBe(false);
    const texts = (list) => list.map((e) => e.text).sort();
    expect(texts(b.activity)).toEqual(['Ada added as founder', 'Share class Common created']);
    const reload = new Store();
    await reload.init();
    expect(texts(reload.activity)).toEqual(['Ada added as founder', 'Share class Common created']);
    expect(reload.classes).toHaveLength(1);
    expect(reload.stakeholders).toHaveLength(1);
  });

  it('lands a line logged during a company switch in the company it describes', async () => {
    /* The form logs its line once its save resolves - and if the user spent
       that round trip switching company, the switch is already queued. The
       line was prepended to the old company's list in memory and its write
       queued behind the switch, which replaced the list before the write ran:
       the line vanished, and the write put the new company's own log back over
       itself. */
    makeStore();
    const s = new Store();
    await s.init();
    const acme = s.activeCompanyId;
    await s.updateCompany({ name: 'Acme' });
    const switching = s.createCompany('Beta');
    s.logActivity('Company profile created: Acme', 'building');
    await switching;
    const beta = s.activeCompanyId;
    expect(beta).not.toBe(acme);
    // Not on the company that was being opened.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(s.activity).toEqual([]);
    const reloadBeta = new Store();
    await reloadBeta.init();
    expect(reloadBeta.activity).toEqual([]);
    // On the one it was logged against.
    await s.switchCompany(acme);
    expect(s.activity.map((a) => a.text)).toEqual(['Company profile created: Acme']);
  });

  it('drops a line logged against a company deleted before it was written', async () => {
    makeStore();
    const s = new Store();
    await s.init();
    const first = s.activeCompanyId;
    const second = await s.createCompany('Second');
    await s.switchCompany(first);
    const deleting = s.deleteCompany(second.id);
    // Logged against the first company while its own deletion of the other
    // is in flight: ordinary, and it must land on the first company.
    s.logActivity('Kept', 'x');
    await deleting;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(s.activity.map((a) => a.text)).toEqual(['Kept']);
    const reload = new Store();
    await reload.init();
    expect(reload.activity.map((a) => a.text)).toEqual(['Kept']);
  });

  it('leaves a session that has read the change free to save', async () => {
    const { a } = await twoTabs();
    await a.addStakeholder({ name: 'Saved from tab A' });
    const b = new Store();
    await b.init();
    await b.addStakeholder({ name: 'Saved from tab B' });
    const reload = new Store();
    await reload.init();
    expect(reload.stakeholders.map((h) => h.name)).toEqual(['Saved from tab A', 'Saved from tab B']);
    // A key this session has never touched has nothing to be stale against.
    expect(b.isStale).toBe(false);
  });

  it('rolls its own change back and keeps the other session\u2019s', async () => {
    const { a, b } = await twoTabs();
    const before = JSON.stringify(b.stakeholders);
    await a.addStakeholder({ name: 'Ada' });
    await expect(b.addStakeholder({ name: 'Grace' })).rejects.toThrow(/changed somewhere else/);
    expect(JSON.stringify(b.stakeholders)).toBe(before);
    const reload = new Store();
    await reload.init();
    expect(reload.stakeholders.map((h) => h.name)).toEqual(['Ada']);
  });
});

describe('Store.importRecords', () => {
  it('creates classes, stakeholders, and securities additively in one commit', async () => {
    const s = makeStore();
    const before = s.securities.length;
    const result = await s.importRecords({
      stakeholders: [
        { name: 'New Investor', kind: 'investor' },
        { name: 'Ada', kind: 'founder' },            // already exists: skipped
      ],
      classNames: ['Series A Preferred', 'Common Stock'], // Common exists
      securities: [
        { kind: 'shares', stakeholderName: 'new investor', className: 'series a preferred', quantity: 1000, pricePerShare: 2, date: '2026-01-01' },
        { kind: 'option', stakeholderName: 'Ada', quantity: 500, strike: 0.5, grantDate: '2026-01-01', date: '2026-01-01', vestingMonths: 48, cliffMonths: 12 },
      ],
    });
    expect(result).toEqual({ stakeholders: 1, securities: 2 });
    expect(s.classes.map((c) => c.name)).toContain('Series A Preferred');
    expect(s.classes.filter((c) => c.name === 'Common Stock')).toHaveLength(1);
    // The series-named class reads as preferred.
    expect(s.classes.find((c) => c.name === 'Series A Preferred').kind).toBe('preferred');
    expect(s.securities.length).toBe(before + 2);
    const cert = s.securities.find((x) => x.kind === 'shares' && x.quantity === 1000);
    expect(cert.label).toBe('SA-1');
  });

  it('refuses a row whose holder name belongs to two stakeholders', async () => {
    const s = makeStore();
    await s.addStakeholder({ name: 'Ada', kind: 'investor', email: 'ada.two@example.com' });
    const before = JSON.stringify(s.securities);
    // Keyed by name alone, the later Ada simply overwrote the earlier one and
    // the shares went to whoever happened to be stored last.
    await expect(s.importRecords({
      securities: [
        { kind: 'shares', stakeholderName: 'Ada', className: 'Common Stock', quantity: 100, pricePerShare: 1, date: '2026-01-01' },
      ],
    })).rejects.toThrow('More than one stakeholder is named "Ada".');
    expect(JSON.stringify(s.securities)).toBe(before);
    // Grace is still hers alone.
    await s.importRecords({
      securities: [
        { kind: 'shares', stakeholderName: 'Grace', className: 'Common Stock', quantity: 100, pricePerShare: 1, date: '2026-01-01' },
      ],
    });
    expect(s.securities.at(-1).stakeholderId).toBe('h2');
  });

  it('rolls the whole import back when any row cannot be written', async () => {
    const s = makeStore();
    const before = JSON.stringify({ c: s.classes, h: s.stakeholders, x: s.securities });
    await expect(s.importRecords({
      securities: [
        { kind: 'shares', stakeholderName: 'Ada', className: 'Common Stock', quantity: 100, pricePerShare: 1, date: '2026-01-01' },
        { kind: 'shares', stakeholderName: 'Ghost', className: 'Common Stock', quantity: 100, pricePerShare: 1, date: '2026-01-01' },
      ],
    })).rejects.toThrow(/Unknown stakeholder/);
    expect(JSON.stringify({ c: s.classes, h: s.stakeholders, x: s.securities })).toBe(before);
  });
});

describe('a reverse split and an award behind its vesting', () => {
  it('keeps a live award\'s certificates behind what had vested on their dates', async () => {
    /* Certificates round to nearest one by one while vesting floors: 250
       and 125 units settled exactly as they vested went 1-for-3 to 83 and
       42 against 124 vested on the second certificate's date, and every
       later cancellation, departure and certification was refused for an
       award nobody had touched. */
    const s = makeStore();
    const rsu = await s.addSecurity({ kind: 'rsu', stakeholderId: 'h2', classId: 'c1', quantity: 1000, date: '2024-01-01', vestingMonths: 48, cliffMonths: 0 });
    const c1 = await s.settleRSU(rsu.id, { quantity: 250, date: '2025-01-01' });
    const c2 = await s.settleRSU(rsu.id, { quantity: 125, date: '2025-07-01' });
    expect(exerciseAheadOfVesting(s.security(rsu.id), s.securities)).toBeNull();
    await s.recordSplit({ num: 1, den: 3, date: '2025-08-01' });
    const a = s.security(rsu.id);
    expect(exerciseAheadOfVesting(a, s.securities)).toBeNull();
    // The share the second certificate gave up is a unit not yet settled; the award's total rounded on its own.
    expect([s.security(c1.id).quantity, s.security(c2.id).quantity, a.settled, a.quantity]).toEqual([83, 41, 124, 333]);
    // Earlier dates still read the certificate whole.
    expect(dbAsOf(s.db, '2025-07-15').securities.find((x) => x.id === c2.id).quantity).toBe(125);
    const unvested = rsuOutstanding(a) - Math.max(rsuVested(a, '2025-07-01'), a.settled);
    await s.updateSecurity(rsu.id, { cancellations: [{ quantity: unvested, date: '2025-07-01' }] });
    expect(exerciseAheadOfVesting(s.security(rsu.id), s.securities)).toBeNull();
  });

  it('gives the share to the drift when the award had nothing left, and lets the departure through', async () => {
    const s = makeStore();
    const grant = await s.addSecurity({ kind: 'option', stakeholderId: 'h2', quantity: 1000, strike: 1, date: '2024-01-01', vestingMonths: 48, cliffMonths: 0 });
    await s.exerciseOption(grant.id, { quantity: 250, date: '2025-01-01', classId: 'c1' });
    await s.exerciseOption(grant.id, { quantity: 125, date: '2025-07-01', classId: 'c1' });
    await s.exerciseOption(grant.id, { quantity: 625, date: '2028-01-01', classId: 'c1' });
    expect(grantOutstanding(s.security(grant.id)) - grantExercised(s.security(grant.id))).toBe(0);
    await s.recordSplit({ num: 1, den: 3, date: '2025-09-01' });
    const g = s.security(grant.id);
    expect(exerciseAheadOfVesting(g, s.securities)).toBeNull();
    // Fully exercised before, fully exercised after: the trimmed share left the cap table.
    expect([g.quantity, g.exercised, grantOutstanding(g) - grantExercised(g)]).toEqual([332, 332, 0]);
    const t = makeStore();
    const live = await t.addSecurity({ kind: 'option', stakeholderId: 'h2', quantity: 1000, strike: 1, date: '2024-01-01', vestingMonths: 48, cliffMonths: 0 });
    await t.exerciseOption(live.id, { quantity: 250, date: '2025-01-01', classId: 'c1' });
    await t.exerciseOption(live.id, { quantity: 125, date: '2025-07-01', classId: 'c1' });
    await t.recordSplit({ num: 1, den: 3, date: '2025-09-01' });
    const l = t.security(live.id);
    const cancelQty = grantOutstanding(l) - Math.max(grantVested(l, '2025-07-01'), grantExercised(l));
    await t.markDeparted('h2', { date: '2025-07-01', grants: [{ id: l.id, cancelQty, exerciseBy: '2025-10-01' }] });
    expect(t.stakeholder('h2').departed).toBe('2025-07-01');
  });

  it('leaves an award that was already ahead of its vesting as it was', async () => {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'g', kind: 'option', label: 'OPT-1', stakeholderId: 'h2', quantity: 1000, strike: 1, date: '2024-01-01', vestingMonths: 48, cliffMonths: 0, exercised: 500 },
      { id: 'x', kind: 'shares', label: 'CS-3', stakeholderId: 'h2', classId: 'c1', quantity: 500, pricePerShare: 1, date: '2025-01-01', fromOptionId: 'g' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    expect(exerciseAheadOfVesting(s.security('g'), s.securities)).not.toBeNull();
    await s.recordSplit({ num: 1, den: 3, date: '2025-09-01' });
    expect([s.security('x').quantity, s.security('g').exercised]).toEqual([167, 167]);
  });
});

describe('as-of forfeitures through a reverse split', () => {
  it('reads a fully forfeited award as fully forfeited on every earlier date', async () => {
    /* Each forfeiture entry unwinds through the splits on its own rounding:
       67 of 67 units, the whole award, divided back to 268 on an award that
       had held 269, so the as-of cap table showed one unit outstanding and
       drawn from the pool on a fully forfeited award - or more cancelled
       than granted on another. */
    for (const q of [269, 266, 267, 1001]) {
      const s = makeStore();
      const rsu = await s.addSecurity({ kind: 'rsu', stakeholderId: 'h2', classId: 'c1', quantity: q, date: '2024-01-01', vestingMonths: 48, cliffMonths: 0 });
      await s.recordSplit({ num: 1, den: 4, date: '2025-06-01' });
      await s.updateSecurity(rsu.id, { cancellations: [{ quantity: rsuOutstanding(s.security(rsu.id)), date: '2025-01-01' }] });
      const x = dbAsOf(s.db, '2025-03-01').securities.find((y) => y.id === rsu.id);
      expect([x.quantity, x.cancelled, rsuOutstanding(x)]).toEqual([q, q, 0]);
    }
  });

  it('reads a spent award against its certificates, not a counter rounded on its own', async () => {
    /* 100 granted, 40 exercised as one certificate, 60 cancelled: nothing
       left. 1-for-3 kept the certificate at 13 (noted 40) and rounded the
       counter to 13 as well; read back as 39 against a 40-share certificate,
       the history was then sized to the room above 39 - one option
       outstanding, one more committed and one fewer in the pool on every
       date before the split, on a grant with nothing left. */
    for (const [kind, claim] of [['option', 'exerciseOption'], ['rsu', 'settleRSU']]) {
      const s = makeStore();
      const award = await s.addSecurity({ kind, stakeholderId: 'h2', classId: 'c1', quantity: 100, strike: 1, date: '2024-02-01', vestingMonths: 0, cliffMonths: 0, expires: '2034-02-01' });
      await s[claim](award.id, { quantity: 40, date: '2024-03-01', classId: 'c1' });
      await s.updateSecurity(award.id, { cancellations: [{ quantity: 60, date: '2024-06-01' }] });
      const before = dbAsOf(s.db, '2024-08-01');
      await s.recordSplit({ num: 1, den: 3, date: '2024-09-01' });
      const after = dbAsOf(s.db, '2024-08-01');
      const read = (db) => {
        const x = db.securities.find((y) => y.id === award.id);
        return [x.quantity, kind === 'rsu' ? x.settled : x.exercised, x.cancelled, kind === 'rsu' ? rsuOutstanding(x) : grantOutstanding(x), fullyDiluted(db.securities, db.company)];
      };
      expect(read(before)).toEqual([100, 40, 60, 40, 190]);
      expect(read(after)).toEqual(read(before));
    }
  });
});

describe('Store.resizePool', () => {
  it('dates the reserve, so earlier snapshots read the pool as it was', async () => {
    const s = makeStore();
    expect(s.company.poolAuthorized).toBe(0);
    await s.resizePool({ size: 1000, date: '2025-06-10' });
    await s.resizePool({ size: 1500, date: '2026-03-01' });
    expect(s.company.poolAuthorized).toBe(1500);
    expect(s.company.poolHistory).toEqual([
      { date: '2025-06-10', before: 0, after: 1000, seq: 1 },
      { date: '2026-03-01', before: 1000, after: 1500, seq: 2 },
    ]);
    const pool = (d) => dbAsOf(s.db, d).company.poolAuthorized;
    expect(pool('2025-06-09')).toBe(0);
    expect(pool('2025-06-10')).toBe(1000);
    expect(pool('2026-02-28')).toBe(1000);
    expect(pool('2026-03-01')).toBe(1500);
    // Before the pool existed, the founders owned all of it.
    const before = dbAsOf(s.db, '2025-01-01');
    expect(fullyDiluted(before.securities, before.company.poolAuthorized)).toBe(150);
    expect(dbAsOf(s.db, '2025-01-01').company.poolAuthorized).toBe(0);
  });

  it('records nothing when the size does not change, and refuses what is not a dated whole count', async () => {
    const s = makeStore();
    await s.resizePool({ size: 500, date: '2025-01-01' });
    await s.resizePool({ size: 500, date: '2025-06-01' });
    expect(s.company.poolHistory).toHaveLength(1);
    await expect(s.resizePool({ size: 600, date: '' })).rejects.toThrow('Pick an effective date.');
    await expect(s.resizePool({ size: 600, date: '2999-01-01' })).rejects.toThrow(/future date/);
    await expect(s.resizePool({ size: 12.5, date: '2025-06-01' })).rejects.toThrow(/whole shares/);
    await expect(s.resizePool({ size: -1, date: '2025-06-01' })).rejects.toThrow(/whole shares/);
    expect(s.company.poolAuthorized).toBe(500);
    expect(s.company.poolHistory).toHaveLength(1);
  });

  it('refuses a pool smaller than what the plan has granted', async () => {
    /* The sheet checks this against the grants as they stood when it opened;
       a grant put back by an Undo underneath it, or issued in another tab,
       was not in that count, and a pool of one share was saved under 261,000
       granted options. Zero stays a deliberate "no pool". */
    const s = makeStore();
    await s.resizePool({ size: 1000, date: '2025-01-01' });
    await s.addSecurity({ kind: 'option', stakeholderId: 'h2', quantity: 600, strike: 1, date: '2025-02-01', vestingMonths: 48, cliffMonths: 12 });
    await s.addSecurity({ kind: 'rsu', stakeholderId: 'h2', classId: 'c1', quantity: 100, date: '2025-02-01', vestingMonths: 48, cliffMonths: 12 });
    await expect(s.resizePool({ size: 699, date: '2025-06-01' }))
      .rejects.toThrow('The pool can’t be smaller than the 700 shares already granted.');
    expect(s.company.poolAuthorized).toBe(1000);
    await s.resizePool({ size: 700, date: '2025-06-01' });
    expect(s.company.poolAuthorized).toBe(700);
    await s.resizePool({ size: 0, date: '2025-07-01' });
    expect(s.company.poolAuthorized).toBe(0);
  });

  it('dates a plain profile edit of the pool today', async () => {
    const s = makeStore();
    await s.updateCompany({ name: 'Renamed', poolAuthorized: 250 });
    expect(s.company.name).toBe('Renamed');
    expect(s.company.poolHistory).toEqual([{ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), before: 0, after: 250, seq: 1 }]);
    // Re-saving the profile with the same pool is not an event.
    await s.updateCompany({ name: 'Renamed again', poolAuthorized: 250 });
    expect(s.company.poolHistory).toHaveLength(1);
    expect(dbAsOf(s.db, '2020-01-01').company.poolAuthorized).toBe(0);
  });
});

describe('Store.recordSplit', () => {
  /** Store with a grant, a warrant, a pool, and a 409A beside the base certs. */
  function splittable() {
    const s = makeStore();
    s.company = Store.sanitizeCompany({
      ...s.company, name: 'T', poolAuthorized: 500,
      valuations: [{ id: 'v1', date: '2025-06-01', fmvPerShare: 0.9 }],
    });
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1', quantity: 40, strike: 0.9, grantDate: '2025-01-01', date: '2025-01-01', vestingMonths: 48, cliffMonths: 12, exercised: 10 },
      { id: 'w1', kind: 'warrant', label: 'WNT-1', stakeholderId: 'h2', classId: 'c1', quantity: 25, strike: 2, date: '2025-02-01' },
      { id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h2', principal: 100_000, valuationCap: 5_000_000, discount: 0, safeType: 'post', date: '2025-03-01' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    s.classes = Store.sanitizeClasses([{ id: 'c1', name: 'Common Stock', kind: 'common', authorized: 1000, pricePerShare: 1 }]);
    return s;
  }

  it('keeps a transfer family adding up through a split that rounds', async () => {
    /* Rounded one by one, 500 sold as 453 and 47 went 3-for-2 to 750 against
       680 and 71: the outstanding count moved by a share on the split date,
       and undoing the transfer moved it back. */
    const s = makeStore();
    await s.updateSecurity('s1', { quantity: 500 });
    const { buyerCert } = await s.transferShares('s1', {
      date: '2024-06-01', quantity: 453, pricePerShare: 1, to: { stakeholderId: 'h2' },
    });
    const remainder = s.securities.find((c) => c.fromTransferId === 's1' && c.stakeholderId === 'h1');
    const before = sharesOutstanding(s.securities);
    await s.recordSplit({ num: 3, den: 2, date: '2026-06-01' });
    expect(s.security('s1').quantity).toBe(750);
    expect(s.security(buyerCert.id).quantity + s.security(remainder.id).quantity).toBe(750);
    expect(sharesOutstanding(s.securities)).toBe(before * 1.5);
    await s.deleteSecurity(buyerCert.id);
    expect(sharesOutstanding(s.securities)).toBe(before * 1.5);
  });

  it('keeps a repurchase’s retired count and remainder adding up to the source', async () => {
    const s = makeStore();
    await s.updateSecurity('s1', { quantity: 650 });
    await s.transferShares('s1', { date: '2024-06-01', quantity: 429, pricePerShare: 1, to: 'company' });
    await s.recordSplit({ num: 3, den: 2, date: '2026-06-01' });
    const source = s.security('s1');
    const remainder = s.securities.find((c) => c.fromTransferId === 's1');
    expect(source.quantity).toBe(975);
    expect(source.repurchasedQty + remainder.quantity).toBe(975);
    expect(repurchaseTerms(source).quantity).toBe(source.repurchasedQty);
  });

  it('reads the count a repurchase retired back as of a date before a reverse split', async () => {
    const s = makeStore();
    await s.updateSecurity('s1', { quantity: 8 });
    await s.transferShares('s1', { date: '2024-06-01', quantity: 4, pricePerShare: 1, to: 'company' });
    await s.recordSplit({ num: 1, den: 3, date: '2026-06-01' });
    expect(s.security('s1')).toMatchObject({ quantity: 3, repurchasedQty: 1 });
    // Divided back, 1 retired of 3 read as 3 of 8 where 4 had been.
    const then = dbAsOf(s.db, '2024-08-31').securities.find((c) => c.id === 's1');
    expect(then).toMatchObject({ quantity: 8, repurchasedQty: 4 });
  });

  it('reads dates before a historical split recorded behind a later one in their own units', async () => {
    const s = splittable();
    await s.recordSplit({ num: 1, den: 3, date: '2026-06-01' });
    await s.recordSplit({ num: 7, den: 3, date: '2026-02-01' });
    // Stored by date, numbered by recording order.
    expect(s.company.splits.map((sp) => [sp.date, sp.seq])).toEqual([['2026-02-01', 2], ['2026-06-01', 1]]);
    expect(s.security('s1').quantity).toBe(77);
    /* Walked back by date, the June note (100) was read first and the
       February note (33) last: 33 shares on every date before both. */
    const before = dbAsOf(s.db, '2025-12-31');
    const at = (snap, id) => snap.securities.find((x) => x.id === id);
    expect(at(before, 's1').quantity).toBe(100);
    expect(at(before, 's2').quantity).toBe(50);
    expect(at(before, 'o1')).toMatchObject({ quantity: 40 });
    expect(at(before, 'o1').strike).toBeCloseTo(0.9, 10);
    expect(at(before, 'w1').quantity).toBe(25);
    expect(before.company.poolAuthorized).toBe(500);
    expect(before.classes[0].pricePerShare).toBeCloseTo(1, 10);
    expect(sharesOutstanding(before.securities)).toBe(150);
    // Between the two dates the February split had happened and the June one had not.
    const between = dbAsOf(s.db, '2026-04-01');
    expect(at(between, 's1').quantity).toBe(233);
    expect(at(between, 'w1').quantity).toBe(58);
    expect(between.company.poolAuthorized).toBe(1167);
    expect(at(between, 'o1').strike).toBeCloseTo(0.9 / (7 / 3), 10);
  });

  it('rescales every per-share number together on a forward split', async () => {
    const s = splittable();
    const { drift } = await s.recordSplit({ num: 10, den: 1, date: '2026-06-01' });
    expect(drift).toBe(0);
    expect(s.security('s1').quantity).toBe(1000);
    const grant = s.security('o1');
    expect(grant.quantity).toBe(400);
    expect(grant.exercised).toBe(100);
    expect(grant.strike).toBeCloseTo(0.09);
    expect(s.security('w1').quantity).toBe(250);
    // Dollar instruments stay put.
    expect(s.security('sf1').principal).toBe(100_000);
    expect(s.company.poolAuthorized).toBe(5000);
    expect(s.company.valuations[0].fmvPerShare).toBeCloseTo(0.09);
    expect(s.classes[0].authorized).toBe(10_000);
    expect(s.classes[0].pricePerShare).toBeCloseTo(0.1);
    expect(s.company.splits).toHaveLength(1);
    expect(s.company.splits[0]).toMatchObject({ date: '2026-06-01', num: 10, den: 1 });
  });

  it('keeps a frozen grant’s schedule reaching what was exercised through a reverse split', async () => {
    /* 250 exercised of 1,000 frozen at month 12 went 1-for-7 to 36 certified
       against a ceiling of floor(143 x 12 / 48) = 35: the grant read 97%
       vested beside a certificate for all of it. */
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([...s.securities, {
      id: 'g1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1', quantity: 1000, strike: 1,
      grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 48, cliffMonths: 12, exercised: 0,
    }], { classes: s.classes, stakeholders: s.stakeholders });
    await s.exerciseOption('g1', { quantity: 250, date: '2025-01-01', classId: 'c1' });
    await s.updateSecurity('g1', { cancellations: [{ quantity: 750, date: '2025-01-01' }] });
    await s.recordSplit({ num: 1, den: 7, date: '2026-06-01' });
    const g = s.security('g1');
    expect(grantExercised(g)).toBe(36);
    expect(grantOutstanding(g)).toBe(36);
    expect(vestingCeiling(g)).toBe(36);
    expect(vestedQuantity(g, '2026-09-01')).toBe(36);
    expect(exerciseAheadOfVesting(g, s.securities)).toBeNull();
  });

  it('moves a frozen award’s shortfall into the tranche that had vested', async () => {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([...s.securities, {
      id: 'r1', kind: 'rsu', label: 'RSU-1', stakeholderId: 'h1', classId: 'c1', quantity: 1001,
      grantDate: '2024-01-01', date: '2024-01-01', settled: 0,
      vestingTranches: [{ date: '2024-06-01', quantity: 333 }, { date: '2026-06-01', quantity: 668 }],
    }], { classes: s.classes, stakeholders: s.stakeholders });
    await s.settleRSU('r1', { quantity: 333, date: '2024-06-01', classId: 'c1' });
    await s.updateSecurity('r1', { cancellations: [{ quantity: 668, date: '2024-09-01' }] });
    await s.recordSplit({ num: 3, den: 2, date: '2026-06-01' });
    const r = s.security('r1');
    expect(r.settled).toBe(500);
    expect(vestingCeiling(r)).toBe(500);
    expect(r.vestingTranches.reduce((a, t) => a + t.quantity, 0)).toBe(r.quantity);
    expect(exerciseAheadOfVesting(r, s.securities)).toBeNull();
  });

  it('reports rounding drift on a reverse split instead of dropping shares', async () => {
    const s = splittable();
    // 100 and 50 shares 1-for-3: exact 33.33 + 16.67 → 33 + 17, drift ≈ 0.
    // The 25-share warrant → 8.33 → 8, and the 40-option grant → 13.33 → 13.
    const { drift } = await s.recordSplit({ num: 1, den: 3, date: '2026-06-01' });
    expect(s.security('s1').quantity).toBe(33);
    expect(s.security('s2').quantity).toBe(17);
    expect(s.security('w1').quantity).toBe(8);
    expect(Math.abs(drift)).toBeLessThan(1.5);
    // A one-share holding never rounds to zero.
    expect(s.securities.every((x) => x.kind === 'safe' || x.quantity >= 1)).toBe(true);
  });

  it('keeps an exercise and its forfeiture through a reverse split that rounds them together', async () => {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ ...s.company, name: 'T', poolAuthorized: 100 });
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1', quantity: 3, strike: 1, grantDate: '2025-01-01', date: '2025-01-01', vestingMonths: 0, cliffMonths: 0, exercised: 1, cancelled: 1, cancelledDate: '2025-07-01' },
      { id: 'x1', kind: 'shares', label: 'CS-3', stakeholderId: 'h1', classId: 'c1', quantity: 1, pricePerShare: 1, date: '2025-06-01', fromOptionId: 'o1' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    await s.recordSplit({ num: 1, den: 3, date: '2026-01-01' });
    const grant = s.security('o1');
    /* Every counter rounds up to at least one whole share, so the total has
       to hold both: rounded to 1 on its own it would have to erase the
       exercise, whose certificate is still outstanding. */
    expect(grant).toMatchObject({ quantity: 2, exercised: 1, cancelled: 1 });
    expect(certifiedByGrant(s.securities).get('o1')).toBe(1);
    expect(poolDrawn(s.securities)).toBe(1);
  });

  it('keeps a repurchase remainder’s vesting base for the as-of view when a split lands it on the holding', async () => {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      // 995 shares left of 1,000 after a repurchase out of the unvested tail, 48 months from 2024-01-01.
      { id: 'r1', kind: 'shares', label: 'CS-9', stakeholderId: 'h1', classId: 'c1', quantity: 995, pricePerShare: 1, date: '2024-01-01', vestingMonths: 48, cliffMonths: 0, vestingBase: 1000 },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    expect(vestedQuantity(s.security('r1'), '2026-01-01')).toBe(500);
    await s.recordSplit({ num: 1, den: 10, date: '2026-07-01' });
    /* 1,000 over 995 restates to 100 over 100 exactly, and a base no larger
       than the holding is the ordinary state, so the record drops it. Read
       as of a date before the split, the 995 then measured against itself:
       497 vested where the certificate had read 500. */
    expect(s.security('r1').vestingBase).toBeUndefined();
    const before = dbAsOf(s.db, '2026-01-01').securities.find((c) => c.id === 'r1');
    expect(before).toMatchObject({ quantity: 995, vestingBase: 1000 });
    expect(vestedQuantity(before, '2026-01-01')).toBe(500);
    expect(vestedQuantity(before, '2025-01-01')).toBe(250);
  });

  it('leaves a departed holder’s grant with nothing unvested through a reverse split', async () => {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ ...s.company, name: 'T', poolAuthorized: 5000 });
    const g = await s.addSecurity({ kind: 'option', stakeholderId: 'h1', quantity: 1000, strike: 1, date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 0 });
    // Departed at month 12: 250 vested, the other 750 forfeited.
    await s.markDeparted('h1', { date: '2025-01-01', grants: [{ id: g.id, cancelQty: 750, exerciseBy: '2025-04-01' }] });
    expect(grantOutstanding(s.security(g.id))).toBe(vestingCeiling(s.security(g.id)));
    expect(attentionItems(s.db, { asOf: '2025-02-01' }).filter((i) => i.type === 'grant-departed')).toHaveLength(0);
    await s.recordSplit({ num: 1, den: 7, date: '2025-03-01' });
    /* 143 less 107 forfeited held 36 over the 35 the stopped schedule will
       ever vest: one option still vesting after a departure, on the forecast
       and the needs-attention list, on a grant nobody had touched. */
    const grant = s.security(g.id);
    expect(grant.quantity).toBe(143);
    expect(grantOutstanding(grant)).toBe(vestingCeiling(grant));
    expect(attentionItems(s.db, { asOf: '2025-03-15' }).filter((i) => i.type === 'grant-departed')).toHaveLength(0);
    // And the forfeiture as it stood is written down for the as-of view.
    expect(grant.preSplit[0].cancellations).toEqual([{ date: '2025-01-01', quantity: 750 }]);
    expect(dbAsOf(s.db, '2025-02-01').securities.find((x) => x.id === g.id)).toMatchObject({ quantity: 1000, cancelled: 750 });
  });

  it('keeps a fully papered or fully forfeited award at nothing left through a reverse split', async () => {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ ...s.company, name: 'T', poolAuthorized: 5000 });
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1', quantity: 2000, strike: 1, grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 0, cliffMonths: 0, exercised: 2000 },
      { id: 'x1', kind: 'shares', label: 'CS-3', stakeholderId: 'h1', classId: 'c1', quantity: 1000, pricePerShare: 1, date: '2024-06-01', fromOptionId: 'o1' },
      { id: 'x2', kind: 'shares', label: 'CS-4', stakeholderId: 'h1', classId: 'c1', quantity: 1000, pricePerShare: 1, date: '2024-07-01', fromOptionId: 'o1' },
      { id: 'o2', kind: 'option', label: 'OPT-2', stakeholderId: 'h2', quantity: 1002, strike: 1, grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 48, cliffMonths: 12,
        cancellations: [{ quantity: 501, date: '2024-06-01' }, { quantity: 501, date: '2024-09-01' }] },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    expect(s.uncertifiedExercises(s.security('o1'))).toBe(0);
    await s.recordSplit({ num: 1, den: 3, date: '2025-01-01' });
    /* Two 1,000-share certificates round to 333 each. The counter, rounded
       whole, came out at 667 over 666 certified: an exercise with no
       certificate, offered for certifying, and an option left to exercise
       on a grant that had none. */
    const papered = s.security('o1');
    expect(certifiedByGrant(s.securities).get('o1')).toBe(666);
    expect(papered).toMatchObject({ quantity: 666, exercised: 666 });
    expect(s.uncertifiedExercises(papered)).toBe(0);
    expect(grantStatus(papered, '2025-06-01')).toBe('exercised');
    // And a grant forfeited in full stays forfeited in full (250.5 rounds to 251 over 125 + 125).
    await s.recordSplit({ num: 1, den: 4, date: '2025-06-01' });
    const forfeited = s.security('o2');
    expect(forfeited.cancelled).toBe(forfeited.quantity);
    expect(grantStatus(forfeited, '2025-07-01')).toBe('cancelled');
    expect(grantDiluted(forfeited, s.securities)).toBe(0);
  });

  it('raises the exercise counter to the certificates that each rounded on their own', async () => {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ ...s.company, name: 'T', poolAuthorized: 4 });
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1', quantity: 4, strike: 1, grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 0, cliffMonths: 0, exercised: 0 },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    await s.exerciseOption('o1', { quantity: 1, date: '2024-06-01', classId: 'c1' });
    await s.exerciseOption('o1', { quantity: 1, date: '2024-07-01', classId: 'c1' });
    await s.recordSplit({ num: 1, den: 2, date: '2025-01-01' });
    /* Neither certificate may round away, so the two of them still hold two
       whole shares - while the grant's aggregate counter of 2 rounds to 1.
       Left there, the 2-option grant read as having an option left over a
       position it had already certified in full. */
    expect(certifiedByGrant(s.securities).get('o1')).toBe(2);
    expect(s.security('o1')).toMatchObject({ quantity: 2, exercised: 2 });
    await expect(s.exerciseOption('o1', { quantity: 1, date: '2025-02-01', classId: 'c1' }))
      .rejects.toThrow(/more than this grant has left/);
    expect(sharesOutstanding(s.securities)).toBe(2 + 75);
  });

  it('raises an RSU settlement counter the same way', async () => {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ ...s.company, name: 'T', poolAuthorized: 4 });
    const award = await s.addSecurity({
      kind: 'rsu', stakeholderId: 'h1', classId: 'c1', quantity: 4,
      grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 0, cliffMonths: 0,
    });
    await s.settleRSU(award.id, { quantity: 1, date: '2024-06-01', classId: 'c1' });
    await s.settleRSU(award.id, { quantity: 1, date: '2024-07-01', classId: 'c1' });
    await s.recordSplit({ num: 1, den: 2, date: '2025-01-01' });
    expect(s.security(award.id)).toMatchObject({ quantity: 2, settled: 2 });
    await expect(s.settleRSU(award.id, { quantity: 1, date: '2025-02-01', classId: 'c1' }))
      .rejects.toThrow(/more than this award has left/);
  });

  it('keeps a custom schedule adding up to the award it restates', async () => {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ ...s.company, name: 'T', poolAuthorized: 100 });
    const monthly = [];
    for (let m = 2; m <= 11; m++) monthly.push({ date: `2025-${String(m).padStart(2, '0')}-01`, quantity: 1 });
    const grant = await s.addSecurity({
      kind: 'option', stakeholderId: 'h1', quantity: 10, strike: 1,
      grantDate: '2025-01-01', date: '2025-01-01', vestingTranches: monthly,
    });
    await s.recordSplit({ num: 1, den: 2, date: '2025-01-15' });
    const after = s.security(grant.id);
    expect(after.quantity).toBe(5);
    /* Rounded one by one, every tranche kept its floor of one whole share
       and the schedule still added to ten - which read as fully vested five
       months before the last tranche. */
    expect(after.vestingTranches.reduce((a, t) => a + t.quantity, 0)).toBe(5);
    expect(vestedQuantity(after, '2025-06-01')).toBeLessThan(5);
    // The last tranche is still the day it finishes.
    expect(after.vestingTranches.at(-1).date).toBe('2025-11-01');
    expect(vestedQuantity(after, '2025-11-01')).toBe(5);

    // A lopsided pair the same way: 1 and 99 of 100 cannot become 1 and 50.
    const s2 = makeStore();
    s2.company = Store.sanitizeCompany({ ...s2.company, name: 'T', poolAuthorized: 100 });
    const lopsided = await s2.addSecurity({
      kind: 'option', stakeholderId: 'h1', quantity: 100, strike: 1,
      grantDate: '2025-01-01', date: '2025-01-01',
      vestingTranches: [{ date: '2025-06-01', quantity: 1 }, { date: '2026-01-01', quantity: 99 }],
    });
    await s2.recordSplit({ num: 1, den: 2, date: '2025-01-15' });
    const g2 = s2.security(lopsided.id);
    expect(g2.quantity).toBe(50);
    expect(g2.vestingTranches.reduce((a, t) => a + t.quantity, 0)).toBe(50);
  });

  it('keeps a schedule left larger than its holding in proportion', async () => {
    // A repurchase out of the unvested tail leaves the whole schedule behind
    // on a smaller certificate, and that ratio has to survive a split.
    const s = makeStore();
    const cert = await s.addSecurity({
      kind: 'shares', stakeholderId: 'h1', classId: 'c1', quantity: 1000, pricePerShare: 0.01,
      date: '2024-01-01',
      vestingTranches: [
        { date: '2024-07-01', quantity: 400 },
        { date: '2025-01-01', quantity: 400 },
        { date: '2025-07-01', quantity: 200 },
      ],
    });
    await s.transferShares(cert.id, { quantity: 300, date: '2024-06-01', to: 'company', pricePerShare: 0.01 });
    const remainder = s.securities.find((x) => x.fromTransferId === cert.id);
    expect(remainder.quantity).toBe(700);
    await s.recordSplit({ num: 1, den: 3, date: '2025-08-01' });
    const after = s.security(remainder.id);
    expect(after.quantity).toBe(233);
    expect(vestingPosition(after)).toBe(333);
  });

  it('reads a rounded holding back at the number it was rounded from', async () => {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ ...s.company, name: 'T' });
    s.securities = Store.sanitizeSecurities([
      { id: 'x1', kind: 'shares', label: 'CS-9', stakeholderId: 'h1', classId: 'c1', quantity: 15, pricePerShare: 2, date: '2024-01-01' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    expect(capitalRaised(dbAsOf(s.db, '2024-12-31').securities)).toBe(30);

    await s.recordSplit({ num: 1, den: 10, date: '2025-01-01' });
    expect(s.security('x1')).toMatchObject({ quantity: 2, pricePerShare: 20 });
    /* 2 multiplied back by ten is 20, which is not what anyone held: the
       split wrote down the 15 it rounded, and the date before it reads that. */
    const before = dbAsOf(s.db, '2024-12-31');
    expect(before.securities[0]).toMatchObject({ quantity: 15, pricePerShare: 2 });
    expect(sharesOutstanding(before.securities)).toBe(15);
    expect(capitalRaised(before.securities)).toBe(30);

    // And still after a second split, which rounds it again.
    await s.recordSplit({ num: 7, den: 3, date: '2025-06-01' });
    expect(s.security('x1').quantity).toBe(5);
    expect(sharesOutstanding(dbAsOf(s.db, '2024-12-31').securities)).toBe(15);
    expect(capitalRaised(dbAsOf(s.db, '2024-12-31').securities)).toBe(30);
    // The era between the two splits reads its own rounded holding.
    expect(sharesOutstanding(dbAsOf(s.db, '2025-03-01').securities)).toBe(2);

    // A quantity retyped over the one the split produced is a new number,
    // and what the splits recorded against the old one no longer applies.
    await s.updateSecurity('x1', { quantity: 50 });
    expect(s.security('x1').preSplit).toBeUndefined();
  });

  it('reads a rounded forfeiture history and vesting base back at their pre-split counts', async () => {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ ...s.company, name: 'T' });
    s.securities = Store.sanitizeSecurities([
      // 100 granted, 10 cancelled one day and 20 another: neither divides by 3.
      { id: 'g1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1', quantity: 100, strike: 1, grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 0, cliffMonths: 0, cancellations: [{ quantity: 10, date: '2024-06-01' }, { quantity: 20, date: '2025-01-01' }] },
      // A repurchase remainder: 700 held against the 1,000-share schedule it was written for.
      { id: 'r1', kind: 'shares', label: 'CS-9', stakeholderId: 'h1', classId: 'c1', quantity: 700, pricePerShare: 1, date: '2024-01-01', vestingMonths: 48, cliffMonths: 0, vestingStart: '2024-01-01', vestingBase: 1000 },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    expect(grantOutstanding(s.security('g1'))).toBe(70);
    expect(vestedQuantity(s.security('r1'), '2026-01-01')).toBe(500);

    await s.recordSplit({ num: 1, den: 3, date: '2026-02-01' });
    const grant = s.security('g1');
    expect(grant.quantity).toBe(33);
    expect(grant.cancellations).toEqual([{ quantity: 3, date: '2024-06-01' }, { quantity: 7, date: '2025-01-01' }]);
    expect(grant.preSplit[0].cancellations).toEqual([{ date: '2024-06-01', quantity: 10 }, { date: '2025-01-01', quantity: 20 }]);
    const remainder = s.security('r1');
    expect(remainder).toMatchObject({ quantity: 233, vestingBase: 333 });
    expect(remainder.preSplit[0].vestingBase).toBe(1000);

    /* Divided back, 3 and 7 read as 9 and 21 - an option the grant had
       forfeited counted as outstanding on every date before the split - and
       the 333 the schedule is measured against read as 999. */
    const before = dbAsOf(s.db, '2026-01-01');
    const then = before.securities.find((x) => x.id === 'g1');
    expect(then).toMatchObject({ quantity: 100, cancelled: 30, cancelledDate: '2024-06-01' });
    expect(then.cancellations).toEqual([{ quantity: 10, date: '2024-06-01' }, { quantity: 20, date: '2025-01-01' }]);
    expect(grantOutstanding(then)).toBe(70);
    const held = before.securities.find((x) => x.id === 'r1');
    expect(held).toMatchObject({ quantity: 700, vestingBase: 1000 });
    expect(vestedQuantity(held, '2026-01-01')).toBe(500);

    // A date between the two forfeitures reads only the first, at its own count.
    const early = dbAsOf(s.db, '2024-09-01').securities.find((x) => x.id === 'g1');
    expect(early).toMatchObject({ quantity: 100, cancelled: 10 });
    expect(early.cancellations).toBeUndefined();
    expect(grantOutstanding(early)).toBe(90);

    // A lapse recorded after the split, dated before it, is in restated units and divides.
    await s.updateSecurity('g1', { cancellations: [...grant.cancellations, { quantity: 6, date: '2025-06-01' }] });
    const late = dbAsOf(s.db, '2026-01-01').securities.find((x) => x.id === 'g1');
    expect(late.cancellations).toEqual([{ quantity: 10, date: '2024-06-01' }, { quantity: 20, date: '2025-01-01' }, { quantity: 18, date: '2025-06-01' }]);
    expect(grantOutstanding(late)).toBe(52);

    // The history survives a round trip through the sanitizer.
    const again = Store.sanitizeSecurities(JSON.parse(JSON.stringify(s.securities)), s);
    expect(again.find((x) => x.id === 'g1').preSplit).toEqual(s.security('g1').preSplit);
  });

  it('records nothing for a holding the ratio divides exactly', async () => {
    const s = splittable();
    await s.recordSplit({ num: 10, den: 1, date: '2026-06-01' });
    expect(s.securities.every((x) => x.preSplit === undefined)).toBe(true);
  });

  it('renders pre-split dates in pre-split units through dbAsOf', async () => {
    const s = splittable();
    await s.recordSplit({ num: 10, den: 1, date: '2026-06-01' });
    const before = dbAsOf(s.db, '2026-01-01');
    expect(before.securities.find((x) => x.id === 's1').quantity).toBe(100);
    expect(before.securities.find((x) => x.id === 'o1').strike).toBeCloseTo(0.9);
    expect(before.company.poolAuthorized).toBe(500);
    expect(before.classes[0].pricePerShare).toBeCloseTo(1);
    // On or after the effective date, post-split units stand.
    const after = dbAsOf(s.db, '2026-07-01');
    expect(after.securities.find((x) => x.id === 's1').quantity).toBe(1000);
  });

  it('reads the option pool back at its pre-split size when a split rounded it', async () => {
    const s = splittable();
    const fdBefore = fullyDiluted(s.securities, s.company.poolAuthorized);
    // 500 x 3/7 is 214.29: the pool rounds to 214, and dividing 214 back by
    // the ratio reads 499, a share short on every date before the split.
    await s.recordSplit({ num: 3, den: 7, date: '2026-06-01' });
    expect(s.company.poolAuthorized).toBe(214);
    const split = s.company.splits[0];
    expect(split.poolBefore).toBe(500);
    expect(split.poolAfter).toBe(214);
    const before = dbAsOf(s.db, '2026-01-01');
    expect(before.company.poolAuthorized).toBe(500);
    expect(fullyDiluted(before.securities, before.company.poolAuthorized)).toBe(fdBefore);
    // The pair survives the sanitizer a reload or an import runs it through.
    expect(Store.sanitizeCompany(JSON.parse(JSON.stringify(s.company))).splits[0])
      .toEqual({ id: split.id, date: '2026-06-01', num: 3, den: 7, seq: 1, poolBefore: 500, poolAfter: 214 });
    // A second split that divides exactly writes nothing down.
    await s.recordSplit({ num: 2, den: 1, date: '2026-07-01' });
    expect(s.company.splits[1]).not.toHaveProperty('poolBefore');
    expect(dbAsOf(s.db, '2026-01-01').company.poolAuthorized).toBe(500);
    expect(dbAsOf(s.db, '2026-06-15').company.poolAuthorized).toBe(214);
  });

  it('reads a pool resized since the split back through the resize, then the split', async () => {
    const s = splittable();
    await s.recordSplit({ num: 3, den: 7, date: '2026-06-01' });
    await s.updateCompany({ poolAuthorized: 300 });
    /* The resize is on record with its date, so a date before it reads the
       214 the split produced, and the split then reads back the 500 it wrote
       down. Divided instead, the pool read 700 on a date it had been 500. */
    expect(s.company.poolHistory).toEqual([{ date: expect.any(String), before: 214, after: 300, seq: 2 }]);
    expect(dbAsOf(s.db, '2026-01-01').company.poolAuthorized).toBe(500);
    expect(dbAsOf(s.db, '2026-06-15').company.poolAuthorized).toBe(214);
  });

  it('divides a pool resized without a record of it, as before the history existed', async () => {
    const s = splittable();
    await s.recordSplit({ num: 3, den: 7, date: '2026-06-01' });
    /* A record written before plans existed, resized before resizes were
       recorded: one pool figure, no history entry to read. */
    s.company = Store.sanitizeCompany({ ...s.company, plans: [], poolAuthorized: 300 });
    // The pool is a new number the split never saw: 300 x 7/3 = 700.
    expect(dbAsOf(s.db, '2026-01-01').company.poolAuthorized).toBe(700);
  });

  it('reads a pool resized before a split back at the size it had on either side', async () => {
    const s = splittable();
    await s.resizePool({ size: 800, date: '2026-03-01' });
    await s.recordSplit({ num: 1, den: 10, date: '2026-06-01' });
    expect(s.company.poolAuthorized).toBe(80);
    expect(dbAsOf(s.db, '2026-02-01').company.poolAuthorized).toBe(500);
    expect(dbAsOf(s.db, '2026-03-01').company.poolAuthorized).toBe(800);
    expect(dbAsOf(s.db, '2026-05-31').company.poolAuthorized).toBe(800);
    expect(dbAsOf(s.db, '2026-06-01').company.poolAuthorized).toBe(80);
    // And the fully diluted count under it agrees on every one of those dates.
    const fd = (d) => { const db = dbAsOf(s.db, d); return fullyDiluted(db.securities, db.company.poolAuthorized); };
    // 150 shares, 40 options, 25 warrant shares, and the pool less the 40 drawn.
    expect(fd('2026-02-01')).toBe(150 + 40 + 25 + 460);
    expect(fd('2026-05-31')).toBe(150 + 40 + 25 + 760);
  });

  it('scales a resize recorded after a later split back through it on the dates between', async () => {
    const s = splittable();
    await s.recordSplit({ num: 1, den: 10, date: '2026-06-01' });
    // Recorded after the split, in post-split units, but effective before it.
    await s.resizePool({ size: 80, date: '2026-03-01' });
    expect(s.company.poolAuthorized).toBe(80);
    expect(dbAsOf(s.db, '2026-02-01').company.poolAuthorized).toBe(500);
    // Between: the 80 of today, in the units of a day the split had not reached.
    expect(dbAsOf(s.db, '2026-04-01').company.poolAuthorized).toBe(800);
    expect(dbAsOf(s.db, '2026-06-01').company.poolAuthorized).toBe(80);
  });

  it('records nothing about a pool the split divides exactly, or that does not exist', async () => {
    const s = splittable();
    await s.recordSplit({ num: 10, den: 1, date: '2026-06-01' });
    expect(s.company.splits[0]).toEqual({ id: expect.any(String), date: '2026-06-01', num: 10, den: 1, seq: 1 });
    const none = makeStore();
    await none.recordSplit({ num: 3, den: 7, date: '2026-06-01' });
    expect(none.company.poolAuthorized).toBe(0);
    expect(none.company.splits[0]).not.toHaveProperty('poolBefore');
    expect(dbAsOf(none.db, '2026-01-01').company.poolAuthorized).toBe(0);
  });

  it.each([[3, 1], [7, 3], [3, 2], [1, 3]])('reads every price back exactly through a %d-for-%d split', async (num, den) => {
    /* tidy keeps twelve digits, and a third does not fit in twelve: $0.0001
       went 3-for-1 to $0.0000333333333333 and read back $0.0000999999999999
       on every earlier date, which the as-of export printed as it was. */
    const s = splittable();
    await s.updateSecurity('s1', { pricePerShare: 0.0001 });
    await s.recordSplit({ num, den, date: '2026-06-01' });
    const before = dbAsOf(s.db, '2026-01-01');
    expect(before.securities.find((x) => x.id === 's1').pricePerShare).toBe(0.0001);
    expect(before.securities.find((x) => x.id === 'o1').strike).toBe(0.9);
    expect(before.securities.find((x) => x.id === 'w1').strike).toBe(2);
    expect(before.classes[0].pricePerShare).toBe(1);
    expect(before.company.valuations[0].fmvPerShare).toBe(0.9);
    // The restated figures themselves stand, in current units.
    expect(s.security('s1').pricePerShare).toBeCloseTo(0.0001 * den / num, 12);
  });

  it('restates an adjusted conversion price so protection survives the split', async () => {
    const s = splittable();
    // A preferred class a past down round already ratcheted: issued at $1.00,
    // converting at $0.60.
    s.classes = Store.sanitizeClasses([
      ...s.classes,
      {
        id: 'p1', name: 'Series A', kind: 'preferred', authorized: 500, pricePerShare: 1,
        liquidationMultiple: 1, seniority: 1, antiDilution: 'broad', conversionPrice: 0.6,
      },
    ]);
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'sa1', kind: 'shares', label: 'SA-1', stakeholderId: 'h2', classId: 'p1', quantity: 100, pricePerShare: 1, date: '2025-04-01' },
    ], { classes: s.classes, stakeholders: s.stakeholders });

    await s.recordSplit({ num: 10, den: 1, date: '2026-06-01' });
    const cls = s.shareClass('p1');
    expect(cls.pricePerShare).toBeCloseTo(0.1);
    expect(conversionPriceOf(cls)).toBeCloseTo(0.06);

    // The same economics as a $0.30 round against a $0.60 conversion price:
    // left unrestated, the stale price reads as unadjusted and the weighted
    // average mints nothing at all.
    const adjusted = antiDilutionAdjustments(s.db, { pps: 0.03, investment: 1000 });
    expect(adjusted).toHaveLength(1);
    expect(adjusted[0].shares).toBeGreaterThan(0);
    expect(adjusted[0].conversionPriceBefore).toBeCloseTo(0.06);

    // And a pre-split date reads the conversion price of its own day.
    const before = dbAsOf(s.db, '2026-01-01').classes.find((c) => c.id === 'p1');
    expect(before.pricePerShare).toBeCloseTo(1);
    expect(conversionPriceOf(before)).toBeCloseTo(0.6);
  });

  it('refuses a do-nothing or malformed ratio', async () => {
    const s = splittable();
    await expect(s.recordSplit({ num: 1, den: 1, date: '2026-06-01' })).rejects.toThrow(/1-for-1/);
    await expect(s.recordSplit({ num: 0, den: 1, date: '2026-06-01' })).rejects.toThrow(/ratio/);
    await expect(s.recordSplit({ num: 10, den: 1, date: '' })).rejects.toThrow(/date/);
  });

  it('rolls the whole split back when the write fails', async () => {
    const s = splittable();
    const before = JSON.stringify({ c: s.company, k: s.classes, x: s.securities });
    globalThis.puter.kv.set = async () => { throw new Error('offline'); };
    await expect(s.recordSplit({ num: 10, den: 1, date: '2026-06-01' })).rejects.toThrow('offline');
    expect(JSON.stringify({ c: s.company, k: s.classes, x: s.securities })).toBe(before);
  });
});

describe('Store.recordSplit and the hiring plan', () => {
  it('restates planned grants sized in shares along with the pool', async () => {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ ...s.company, name: 'Acme', poolAuthorized: 100_000 });
    await s.saveHire({ role: 'Engineer', headcount: 2, sizeMode: 'shares', shares: 40_000, startMonth: '2026-10' });
    await s.saveHire({ role: 'Designer', headcount: 1, sizeMode: 'pct', pct: 0.01, startMonth: '2026-11' });
    await s.recordSplit({ num: 10, den: 1, date: '2026-09-01' });
    expect(s.company.poolAuthorized).toBe(1_000_000);
    expect(s.hiring.find((h) => h.role === 'Engineer').shares).toBe(400_000);
    // A percentage is a percentage in any unit.
    expect(s.hiring.find((h) => h.role === 'Designer').pct).toBe(0.01);
    // The snapshot taken first holds the plan in the old units.
    expect(s.restorePoints[0].data.hiring.find((h) => h.role === 'Engineer').shares).toBe(40_000);
  });
});

describe('Store.certifyExercise', () => {
  /** A grant whose exercise was recorded on the counter alone. */
  function recorded(extra = {}) {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      {
        id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1', quantity: 1000, strike: 0.5,
        grantDate: '2024-01-01', date: '2024-01-01', vestingMonths: 48, cliffMonths: 12,
        exercised: 400, optionType: 'iso', ...extra,
      },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    return s;
  }

  it('issues the certificate for an exercise recorded without one, leaving the counter alone', async () => {
    const s = recorded();
    const diluted = fullyDiluted(s.securities, 0);
    expect(s.uncertifiedExercises(s.security('o1'))).toBe(400);
    const cert = await s.certifyExercise('o1', { quantity: 300, date: '2026-03-01', classId: 'c1' });
    expect(cert).toMatchObject({
      kind: 'shares', classId: 'c1', quantity: 300, pricePerShare: 0.5,
      fromOptionId: 'o1', date: '2026-03-01', label: 'CS-3',
    });
    expect(cert.vestingMonths).toBeUndefined();
    expect(s.security('o1').exercised).toBe(400);
    expect(s.uncertifiedExercises(s.security('o1'))).toBe(100);
    // The shares moved from the grant's side of the diluted base to the
    // certificate's; the count itself did not move.
    expect(fullyDiluted(s.securities, 0)).toBe(diluted);
    // And Form 3921 now has a dated exercise to file, with the rest still listed.
    const report = form3921Report(s.db, { year: 2026 });
    expect(report.rows.map((r) => r.shares)).toEqual([300]);
    expect(report.undated.map((u) => u.quantity)).toEqual([100]);
  });

  it('refuses more than the uncertified balance, and a grant with nothing left to paper', async () => {
    const s = recorded();
    await expect(s.certifyExercise('o1', { quantity: 500, date: '2026-03-01', classId: 'c1' }))
      .rejects.toThrow(/Only 400/);
    await s.certifyExercise('o1', { quantity: 400, date: '2026-03-01', classId: 'c1' });
    await expect(s.certifyExercise('o1', { quantity: 1, date: '2026-03-01', classId: 'c1' }))
      .rejects.toThrow(/already has its certificate/);
    expect(s.securities.filter((x) => x.fromOptionId === 'o1')).toHaveLength(1);
  });

  it('holds the certificate to the grant date and the exercise cutoff', async () => {
    const s = recorded({ expires: '2026-06-01' });
    const before = JSON.stringify(s.securities);
    await expect(s.certifyExercise('o1', { quantity: 100, date: '2023-12-31', classId: 'c1' }))
      .rejects.toThrow(/granted on 2024-01-01/);
    await expect(s.certifyExercise('o1', { quantity: 100, date: '2026-06-02', classId: 'c1' }))
      .rejects.toThrow(/after 2026-06-01/);
    await expect(s.certifyExercise('o1', { quantity: 100, date: '', classId: 'c1' }))
      .rejects.toThrow(/exercise date/);
    await expect(s.certifyExercise('o1', { quantity: 100, date: '2026-03-01', classId: 'nope' }))
      .rejects.toThrow();
    expect(JSON.stringify(s.securities)).toBe(before);
  });

  it('carries the schedule when the exercise was early, and refuses one the grant never allowed', async () => {
    // Twelve months in, 250 of the 1,000 had vested: 400 exercised is 150 early.
    const s = recorded();
    await expect(s.certifyExercise('o1', { quantity: 400, date: '2025-01-01', classId: 'c1' }))
      .rejects.toThrow(/vested/);
    const e = recorded({ earlyExercise: true });
    const cert = await e.certifyExercise('o1', { quantity: 400, date: '2025-01-01', classId: 'c1' });
    expect(cert).toMatchObject({ vestingMonths: 48, cliffMonths: 12, vestingStart: '2024-01-01' });
    // The 250 installments already vested are part of these 400 shares.
    expect(vestedQuantity(cert, '2025-01-01')).toBe(250);
    expect(status83b(cert, '2025-01-15')).toMatchObject({ state: 'open' });
  });

  it('counts only certificates drawn from the grant, at issued size', async () => {
    const s = recorded({ exercised: 0, vestingMonths: 0, cliffMonths: 0 });
    await s.exerciseOption('o1', { quantity: 100, date: '2026-01-01', classId: 'c1' });
    await s.exerciseOption('o1', { quantity: 200, date: '2026-02-01' });
    expect(s.uncertifiedExercises(s.security('o1'))).toBe(200);
    // Selling the first certificate on does not free its options up again.
    const cert = s.securities.find((x) => x.fromOptionId === 'o1');
    await s.transferShares(cert.id, { date: '2026-03-01', quantity: 100, to: { stakeholderId: 'h2' } });
    expect(s.uncertifiedExercises(s.security('o1'))).toBe(200);
    expect(s.uncertifiedExercises(s.security('s1'))).toBe(0);
  });
});

describe('Store.settleRSU', () => {
  function withAward(extra = {}) {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      {
        id: 'r1', kind: 'rsu', label: 'RSU-1', stakeholderId: 'h1', classId: 'c1',
        quantity: 1000, grantDate: '2025-01-01', date: '2025-01-01',
        vestingMonths: 48, cliffMonths: 12, settled: 0, ...extra,
      },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    return s;
  }

  it('keeps the award and its certificate in one commit', async () => {
    const s = withAward();
    const cert = await s.settleRSU('r1', { quantity: 250, date: '2026-01-05' });
    expect(cert).toMatchObject({
      kind: 'shares', classId: 'c1', quantity: 250, pricePerShare: 0, fromRsuId: 'r1',
    });
    expect(s.security('r1').settled).toBe(250);
    // Outstanding shares grew by the settled units; the award still holds them.
    expect(sharesOutstanding(s.securities)).toBe(400);
  });

  it('refuses more than has vested on the settlement date', async () => {
    const s = withAward();
    await expect(s.settleRSU('r1', { quantity: 300, date: '2026-01-05' }))
      .rejects.toThrow(/vested/);
    // Nothing was written: no certificate, no counter moved.
    expect(s.security('r1').settled).toBe(0);
    expect(s.securities.filter((x) => x.fromRsuId)).toHaveLength(0);
  });

  it('refuses a settlement dated before the award', async () => {
    // Nothing had vested on such a date anyway, but an award with no
    // schedule settles in full from day one - and that day is the grant date.
    const s = withAward({ vestingMonths: 0, cliffMonths: 0 });
    await expect(s.settleRSU('r1', { quantity: 100, date: '2024-12-31' }))
      .rejects.toThrow(/awarded on 2025-01-01/);
    expect(s.security('r1').settled).toBe(0);
    const cert = await s.settleRSU('r1', { quantity: 100, date: '2025-01-01' });
    expect(cert.date).toBe('2025-01-01');
  });

  it('refuses more than the award has left, and a missing date', async () => {
    const s = withAward({ settled: 900, vestingMonths: 0, cliffMonths: 0 });
    await expect(s.settleRSU('r1', { quantity: 200, date: '2026-01-05' }))
      .rejects.toThrow(/left to settle/);
    await expect(s.settleRSU('r1', { quantity: 50, date: '' })).rejects.toThrow(/date/);
  });

  it('settles into the class the award named', async () => {
    const s = withAward({ vestingMonths: 0, cliffMonths: 0 });
    const cert = await s.settleRSU('r1', { quantity: 1000, date: '2026-01-05' });
    expect(cert.classId).toBe('c1');
    expect(s.security('r1').settled).toBe(1000);
  });

  it('sanitizes an award: class required, counters clamped, flags opt-in', () => {
    const ctx = {
      classes: [{ id: 'c1', name: 'Common Stock', kind: 'common' }],
      stakeholders: [{ id: 'h1', name: 'Ada' }],
    };
    const out = Store.sanitizeSecurities([
      // No class: an RSU promises shares of something in particular.
      { id: 'a', kind: 'rsu', label: 'RSU-1', stakeholderId: 'h1', quantity: 10 },
      {
        id: 'b', kind: 'rsu', label: 'RSU-2', stakeholderId: 'h1', classId: 'c1',
        quantity: 100, cancelled: 40, settled: 90, liquidityCondition: 'yes',
        vestingMonths: 24, cliffMonths: 36, date: '2026-01-01',
      },
      {
        id: 'c', kind: 'rsu', label: 'RSU-3', stakeholderId: 'h1', classId: 'c1',
        quantity: 50, liquidityCondition: true, date: '2026-01-01',
      },
    ], ctx);
    expect(out.map((x) => x.id)).toEqual(['b', 'c']);
    const [award, conditional] = out;
    // Settled units can never exceed what survived cancellation.
    expect(award).toMatchObject({ quantity: 100, cancelled: 40, settled: 60, cliffMonths: 24 });
    expect(award.liquidityCondition).toBeUndefined();
    expect(award.grantDate).toBe('2026-01-01');
    expect(conditional.liquidityCondition).toBe(true);
  });
});

describe('Store hiring plan', () => {
  it('sanitizes a planned grant and keeps one sizing, not both', () => {
    const rows = Store.sanitizeHiring([
      { id: 'a', role: 'Engineer', headcount: '3', sizeMode: 'shares', shares: '25000', pct: 0.5, startMonth: '2026-09' },
      { id: 'b', role: 'Designer', headcount: 0, sizeMode: 'pct', pct: 0.005, shares: 999, startMonth: 'nope' },
      { id: 'c', role: '', shares: 100 },
      { id: 'd', role: 'Nothing', sizeMode: 'shares', shares: 0 },
      'nope',
    ]);
    // Chronological, with the undated rows last.
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    const [engineer, designer] = rows;
    expect(engineer).toMatchObject({
      role: 'Engineer', headcount: 3, sizeMode: 'shares', shares: 25_000, startMonth: '2026-09',
    });
    expect(engineer.pct).toBeUndefined();
    // A malformed month is no month, and headcount floors at one.
    expect(designer).toMatchObject({ sizeMode: 'pct', pct: 0.005, headcount: 1, startMonth: '' });
    expect(designer.shares).toBeUndefined();
  });

  it('saves, updates and removes a row without touching securities', async () => {
    const s = makeStore();
    const row = await s.saveHire({ role: 'Engineer', headcount: 2, sizeMode: 'shares', shares: 20_000, startMonth: '2026-10' });
    expect(s.hiring).toHaveLength(1);
    const securities = s.securities;
    await s.saveHire({ ...row, headcount: 4 });
    expect(s.hiring).toHaveLength(1);
    expect(s.hiring[0].headcount).toBe(4);
    // A plan is a forecast: the cap table is untouched by all of it.
    expect(s.securities).toBe(securities);
    await s.deleteHire(row.id);
    expect(s.hiring).toEqual([]);
  });

  it('refuses a row with no size', async () => {
    const s = makeStore();
    await expect(s.saveHire({ role: 'Engineer', sizeMode: 'shares', shares: 0 }))
      .rejects.toThrow(/role and a size/);
  });

  it('travels with an export, a restore point, and an import', async () => {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ ...s.company, name: 'Acme' });
    await s.saveHire({ role: 'Engineer', headcount: 1, sizeMode: 'shares', shares: 20_000, startMonth: '2026-10' });
    expect(s.exportAll().hiring).toHaveLength(1);
    await s.importAll({ company: { name: 'Other' } }, { label: 'Before importing a backup' });
    expect(s.hiring).toEqual([]);
    await s.restoreFromPoint(s.restorePoints.find((p) => p.label === 'Before importing a backup').id);
    expect(s.hiring).toHaveLength(1);
    expect(s.hiring[0].role).toBe('Engineer');
  });
});

describe('Store.closeRound anti-dilution', () => {
  /** Common plus a ratcheted Series A bought at $1.00. */
  function protectedStore() {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ ...s.company, name: 'Acme' });
    s.classes = Store.sanitizeClasses([
      { id: 'c1', name: 'Common Stock', kind: 'common', pricePerShare: 0.0001 },
      {
        id: 'p1', name: 'Series A Preferred', kind: 'preferred', pricePerShare: 1,
        liquidationMultiple: 1, seniority: 1, antiDilution: 'ratchet',
      },
    ]);
    s.securities = Store.sanitizeSecurities([
      { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 8_000_000, pricePerShare: 0.0001, date: '2024-01-01' },
      { id: 's2', kind: 'shares', label: 'SA-1', stakeholderId: 'h2', classId: 'p1', quantity: 2_000_000, pricePerShare: 1, date: '2024-06-01' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    return s;
  }

  it('keeps the terms and the adjusted conversion price on the class', () => {
    const [cls] = Store.sanitizeClasses([{
      name: 'Series A', kind: 'preferred', pricePerShare: 1,
      antiDilution: 'ratchet', conversionPrice: 0.5,
    }]);
    expect(cls).toMatchObject({ antiDilution: 'ratchet', conversionPrice: 0.5 });
    // Unadjusted is the absent state, and common never carries either field.
    expect(Store.sanitizeClasses([{ name: 'A', kind: 'preferred', pricePerShare: 1, conversionPrice: 1 }])[0].conversionPrice)
      .toBeUndefined();
    const [common] = Store.sanitizeClasses([{
      name: 'Common', kind: 'common', antiDilution: 'ratchet', conversionPrice: 0.2,
    }]);
    expect(common.antiDilution).toBeUndefined();
    expect(common.conversionPrice).toBeUndefined();
    // A term nobody offers is no term at all.
    expect(Store.sanitizeClasses([{ name: 'A', kind: 'preferred', antiDilution: 'narrow' }])[0].antiDilution)
      .toBeUndefined();
  });

  it('issues the adjustment shares and writes the new conversion price', async () => {
    const s = protectedStore();
    await s.closeRound({
      date: '2026-03-01',
      newClass: { name: 'Series B Preferred', kind: 'preferred', pricePerShare: 0.5 },
      investors: [{ stakeholderId: 'h1', quantity: 1_000_000, pricePerShare: 0.5 }],
      adjustments: [{
        classId: 'p1',
        conversionPrice: 0.5,
        holders: [{ stakeholderId: 'h2', quantity: 2_000_000 }],
      }],
    });
    const minted = s.securities.filter((x) => x.antiDilution === true);
    expect(minted).toHaveLength(1);
    expect(minted[0]).toMatchObject({
      classId: 'p1', quantity: 2_000_000, pricePerShare: 0, date: '2026-03-01',
      stakeholderId: 'h2',
    });
    // Labelled in its own class's series, like any other certificate.
    expect(minted[0].label).toBe('SA-2');
    expect(s.shareClass('p1').conversionPrice).toBe(0.5);
    // The class now holds twice the shares for the same money in.
    expect(sharesOutstanding(s.securities)).toBe(13_000_000);
  });

  it('rolls the adjustment back with the rest of a failed close', async () => {
    const s = protectedStore();
    globalThis.puter.kv.set = async () => { throw new Error('offline') };
    await expect(s.closeRound({
      date: '2026-03-01',
      classId: 'p1',
      investors: [{ stakeholderId: 'h1', quantity: 10, pricePerShare: 0.5 }],
      adjustments: [{ classId: 'p1', conversionPrice: 0.5, holders: [{ stakeholderId: 'h2', quantity: 2_000_000 }] }],
    })).rejects.toThrow('offline');
    expect(s.securities.some((x) => x.antiDilution)).toBe(false);
    expect(s.shareClass('p1').conversionPrice).toBeUndefined();
  });

  it('skips an adjustment naming a class or holder that is gone', async () => {
    const s = protectedStore();
    await s.closeRound({
      date: '2026-03-01',
      classId: 'p1',
      investors: [{ stakeholderId: 'h1', quantity: 10, pricePerShare: 0.5 }],
      adjustments: [
        { classId: 'nope', conversionPrice: 0.5, holders: [{ stakeholderId: 'h2', quantity: 100 }] },
        { classId: 'p1', conversionPrice: 0.5, holders: [{ stakeholderId: 'gone', quantity: 100 }] },
      ],
    });
    expect(s.securities.some((x) => x.antiDilution)).toBe(false);
  });
});

describe('Store.cancelLapsedGrants', () => {
  function withGrants() {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ ...s.company, name: 'Acme' });
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      {
        id: 'g1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1', quantity: 100,
        strike: 0.1, grantDate: '2020-01-01', date: '2020-01-01', vestingMonths: 48,
        cliffMonths: 12, exercised: 0, expires: '2030-01-01', exerciseBy: '2026-03-01',
      },
      {
        id: 'g2', kind: 'option', label: 'OPT-2', stakeholderId: 'h2', quantity: 60,
        strike: 0.1, grantDate: '2020-01-01', date: '2020-01-01', vestingMonths: 48,
        cliffMonths: 12, exercised: 10, expires: '2026-02-01',
      },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    return s;
  }

  it('cancels each grant as of its own closing date, in one commit', async () => {
    const s = withGrants();
    const { cancelled, quantity } = await s.cancelLapsedGrants(['g1', 'g2']);
    expect({ cancelled, quantity }).toEqual({ cancelled: 2, quantity: 100 + 50 });
    // The post-termination window closed first on OPT-1; OPT-2 hit its term.
    expect(s.security('g1')).toMatchObject({ cancelled: 100, cancelledDate: '2026-03-01' });
    expect(s.security('g2')).toMatchObject({ cancelled: 50, cancelledDate: '2026-02-01' });
    // Exercised options were bought and are never cancelled back.
    expect(s.security('g2').exercised).toBe(10);
  });

  it('skips grants already dealt with rather than failing the batch', async () => {
    const s = withGrants();
    await s.cancelLapsedGrants(['g1']);
    const { cancelled } = await s.cancelLapsedGrants(['g1', 'g2']);
    expect(cancelled).toBe(1);
    await expect(s.cancelLapsedGrants(['g1', 'gone'])).rejects.toThrow(/already been dealt with/);
  });

  it('keeps an earlier forfeiture and its date when the rest lapses', async () => {
    // A departure cancels the unvested balance in January; the vested rest
    // lapses in March. A February snapshot must still show the January
    // position, not the whole grant put back.
    const s = withGrants();
    await s.markDeparted('h1', {
      date: '2026-01-01',
      grants: [{ id: 'g1', cancelQty: 25, exerciseBy: '2026-03-01' }],
    });
    await s.cancelLapsedGrants(['g1']);
    expect(s.security('g1')).toMatchObject({
      cancelled: 100,
      cancelledDate: '2026-01-01',
      cancellations: [
        { quantity: 25, date: '2026-01-01' },
        { quantity: 75, date: '2026-03-01' },
      ],
    });
    const outstandingOn = (d) => grantOutstanding(dbAsOf(s.db, d).securities.find((x) => x.id === 'g1'));
    expect(outstandingOn('2025-12-31')).toBe(100);
    expect(outstandingOn('2026-02-01')).toBe(75);
    expect(outstandingOn('2026-04-01')).toBe(0);
  });

  it('refuses a lapse that would freeze vesting below what was exercised', async () => {
    // The exercise was checked against the schedule as it stood (fully vested
    // by 2024), and the schedule was then lengthened - allowed, since the
    // final ceiling still covers every exercise. Lapsing the grant freezes its
    // vesting on the day the window closed, where the longer schedule had
    // vested less than was bought: the same contradiction the cancel sheet,
    // the departure flow and the edit sheet refuse.
    const s = withGrants();
    await s.exerciseOption('g2', { quantity: 40, date: '2024-01-01' });
    await s.updateSecurity('g2', { vestingMonths: 120 });
    expect(grantExercised(s.security('g2'))).toBe(50);
    await expect(s.cancelLapsedGrants(['g1', 'g2'])).rejects.toThrow(/OPT-2 has 50 options exercised, but only 36 had vested/);
    // Nothing in the batch landed, and no restore point stayed behind for it.
    expect(s.security('g1').cancelled).toBeUndefined();
    expect(s.security('g2').cancelled).toBeUndefined();
    expect(s.restorePoints).toHaveLength(0);
    // The other grant on its own still lapses as before.
    expect(await s.cancelLapsedGrants(['g1'])).toEqual({ cancelled: 1, quantity: 100 });
  });

  it('takes a restore point before the batch, and none for an empty one', async () => {
    const s = withGrants();
    expect(await s.cancelLapsedGrants([])).toEqual({ cancelled: 0, quantity: 0 });
    expect(s.restorePoints).toHaveLength(0);
    await s.cancelLapsedGrants(['g1', 'g2']);
    expect(s.restorePoints[0].label).toBe('Before cancelling lapsed grants');
  });
});

describe('restore points', () => {
  /** A company with a name, so there is something worth snapshotting. */
  function named() {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ ...s.company, name: 'Acme', poolAuthorized: 100 });
    return s;
  }

  it('covers a company whose only data is a hiring plan or a pool', async () => {
    const s = makeStore();
    s.stakeholders = [];
    s.securities = [];
    s.classes = [];
    await s.saveHire({ role: 'Engineer', headcount: 1, sizeMode: 'shares', shares: 1000, startMonth: '2026-10' });
    await s.wipeAll();
    expect(s.hiring).toEqual([]);
    expect(s.restorePoints).toHaveLength(1);
    expect(s.restorePoints[0].data.hiring).toHaveLength(1);
  });

  it('snapshots the dataset before a split, labelled with the operation', async () => {
    const s = named();
    await s.recordSplit({ num: 10, den: 1, date: '2026-06-01' });
    expect(s.restorePoints).toHaveLength(1);
    expect(s.restorePoints[0].label).toBe('Before the 10-for-1 split');
    // The snapshot holds pre-split units, whatever the live records now say.
    expect(s.restorePoints[0].data.securities.find((x) => x.id === 's1').quantity).toBe(100);
    expect(s.security('s1').quantity).toBe(1000);
  });

  it('restores the snapshot and takes one of the state left behind', async () => {
    const s = named();
    await s.recordSplit({ num: 10, den: 1, date: '2026-06-01' });
    await s.restoreFromPoint(s.restorePoints[0].id);
    expect(s.security('s1').quantity).toBe(100);
    expect(s.company.splits).toHaveLength(0);
    // The point restored from, plus the one covering the restore itself.
    expect(s.restorePoints.map((p) => p.label)).toEqual([
      'Before restoring an earlier point', 'Before the 10-for-1 split',
    ]);
    // And that one goes back to the post-split state, so the restore is
    // itself reversible.
    await s.restoreFromPoint(s.restorePoints[0].id);
    expect(s.security('s1').quantity).toBe(1000);
  });

  it('snapshots before closing a round, an import, and a wipe', async () => {
    const s = named();
    await s.closeRound({
      newClass: { name: 'Series A Preferred', kind: 'preferred' },
      date: '2026-03-01',
      investors: [{ stakeholderId: 'h1', quantity: 10, pricePerShare: 1 }],
    });
    await s.importAll({ company: { name: 'Other' } }, { label: 'Before importing a backup' });
    await s.wipeAll();
    expect(s.restorePoints.map((p) => p.label)).toEqual([
      'Before deleting all data', 'Before importing a backup', 'Before closing a round',
    ]);
    // An import replaces the dataset, never the snapshots covering it.
    expect(s.restorePoints[2].data.stakeholders).toHaveLength(2);
  });

  it('carries the sample-data flag with the dataset it describes', async () => {
    const s = named();
    // Exploring the sample set, then importing a backup over it.
    await s.updateSettings({ sampleData: true });
    await s.importAll({ company: { name: 'Other' } }, { label: 'Before importing a backup' });
    await s.updateSettings({ sampleData: false });
    expect(s.restorePoints[0].sampleData).toBe(true);

    // Going back puts the banner back with the data it belongs to.
    await s.restoreFromPoint(s.restorePoints[0].id);
    expect(s.company.name).toBe('Acme');
    expect(s.settings.sampleData).toBe(true);

    /* And forward again: the point covering the restore was taken over the
       imported dataset, which was nobody's sample data - so a real cap table
       never comes back under "explore freely, nothing here is yours". */
    await s.restoreFromPoint(s.restorePoints[0].id);
    expect(s.company.name).toBe('Other');
    expect(s.settings.sampleData).toBe(false);
  });

  it('snapshots before a transfer and before a departure, naming the record', async () => {
    const s = named();
    await s.transferShares('s1', { date: '2026-02-01', quantity: 40, to: { stakeholderId: 'h2' } });
    await s.markDeparted('h2', { date: '2026-03-01', grants: [] });
    expect(s.restorePoints.map((p) => p.label)).toEqual([
      'Before Grace departed', 'Before transferring CS-1',
    ]);
  });

  it('keeps only the newest five', async () => {
    const s = named();
    for (let i = 1; i <= 7; i++) {
      await s.importAll({ company: { name: `Co ${i}` } }, { label: `Import ${i}` });
    }
    expect(s.restorePoints).toHaveLength(5);
    expect(s.restorePoints.map((p) => p.label)).toEqual(['Import 7', 'Import 6', 'Import 5', 'Import 4', 'Import 3']);
  });

  it('takes no snapshot of an empty company', async () => {
    const s = makeStore();
    s.company = Store.defaultCompany();
    s.classes = [];
    s.stakeholders = [];
    s.securities = [];
    await s.importAll({ company: { name: 'First' } });
    expect(s.restorePoints).toHaveLength(0);
  });

  it('drops the snapshot when the operation it covered failed', async () => {
    const s = named();
    await expect(s.closeRound({ date: '2026-03-01', investors: [] })).rejects.toThrow(/share class/);
    expect(s.restorePoints).toHaveLength(0);
  });

  it('refuses the operation when the snapshot itself cannot be stored', async () => {
    const s = named();
    globalThis.puter.kv.set = async () => { throw new Error('offline'); };
    await expect(s.recordSplit({ num: 10, den: 1, date: '2026-06-01' })).rejects.toThrow('offline');
    // Nothing was rewritten, and no half-saved snapshot was left behind.
    expect(s.security('s1').quantity).toBe(100);
    expect(s.restorePoints).toHaveLength(0);
  });

  it('deletes a point on request', async () => {
    const s = named();
    await s.recordSplit({ num: 10, den: 1, date: '2026-06-01' });
    const { id } = s.restorePoints[0];
    await s.deleteRestorePoint(id);
    expect(s.restorePoints).toHaveLength(0);
    await expect(s.restoreFromPoint(id)).rejects.toThrow(/gone/);
  });

  it('reads stored points back, dropping ones with no payload', async () => {
    const points = Store.sanitizeRestorePoints([
      { id: 'p1', at: 2, label: 'Newer', data: { company: { name: 'A' }, stakeholders: [{ id: 'h1', name: 'Ada' }] } },
      { id: 'p2', at: 1, label: '', data: { company: { name: 'B' } } },
      { id: 'p3', at: 3 },
      'nope',
    ]);
    expect(points.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(points[1].label).toBe('Snapshot');
    expect(points[0].data.stakeholders).toHaveLength(1);
    expect(points[0].data.securities).toEqual([]);
  });
});

describe('Store.transferShares', () => {
  it('holds a closed certificate to its settled size, class, and date', async () => {
    const s = makeStore();
    await s.transferShares('s1', {
      date: '2026-03-01', quantity: 60, pricePerShare: 5, to: { stakeholderId: 'h2' },
    });
    const before = s.security('s1');

    await s.updateSecurity('s1', {
      quantity: 999_999, date: '2030-01-01', pricePerShare: 2.5,
    });
    const after = s.security('s1');
    // The successors were drawn from these; the point-in-time view reopens
    // the original at this size, and 60 + 40 has to keep adding to 100.
    expect(after.quantity).toBe(before.quantity);
    expect(after.classId).toBe(before.classId);
    expect(after.date).toBe(before.date);
    expect(after.quantity).toBe(60 + 40);
    // Everything else about it stays editable.
    expect(after.pricePerShare).toBe(2.5);
  });

  it('holds a closed certificate to the closing the legs were issued against', async () => {
    const s = makeStore();
    await s.transferShares('s2', { date: '2026-03-01', quantity: 20, pricePerShare: 2, to: 'company' });
    const before = s.security('s2');
    expect(before).toMatchObject({ closedAt: '2026-03-01', closedReason: 'repurchase', repurchasedQty: 20 });

    // Reopening it, re-dating the buyback, or retiring more than the 30-share
    // remainder was sized against would put shares on the table twice.
    await s.updateSecurity('s2', {
      closedAt: '', closedReason: 'transfer', repurchasedQty: 50, repurchasePricePerShare: 3,
    });
    const after = s.security('s2');
    expect(after).toMatchObject({ closedAt: '2026-03-01', closedReason: 'repurchase', repurchasedQty: 20 });
    expect(sharesOutstanding(s.securities)).toBe(100 + 30);
    // The price it paid is the one figure of the event that stays open.
    expect(repurchaseTerms(after)).toMatchObject({ quantity: 20, pricePerShare: 3, consideration: 60 });
  });

  it('keeps the anti-dilution mark on both legs of a transfer', async () => {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      {
        id: 'ad1', kind: 'shares', label: 'CS-7', stakeholderId: 'h1', classId: 'c1',
        quantity: 100, pricePerShare: 0, date: '2025-06-01', antiDilution: true,
      },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    const result = await s.transferShares('ad1', {
      date: '2026-03-01', quantity: 60, pricePerShare: 1, to: { stakeholderId: 'h2' },
    });
    // Minted shares carry no capital whoever holds them; a successor without
    // the mark would count as bought in the next down round's adjustment.
    expect(result.buyerCert.antiDilution).toBe(true);
    expect(result.remainderCert.antiDilution).toBe(true);
  });

  it('records what a repurchase paid, on the certificate it closed', async () => {
    const s = makeStore();
    await s.transferShares('s1', {
      date: '2026-03-01', quantity: 60, pricePerShare: 7, to: 'company',
    });
    // A repurchase issues no buyer certificate, so its terms have nowhere
    // else to live; without them the entered price was previewed and dropped.
    expect(repurchaseTerms(s.security('s1')))
      .toEqual({ quantity: 60, pricePerShare: 7, consideration: 420 });
    // A full repurchase leaves no remainder either, and keeps its terms.
    await s.transferShares('s2', {
      date: '2026-03-01', quantity: 50, pricePerShare: 3, to: 'company',
    });
    expect(repurchaseTerms(s.security('s2')))
      .toEqual({ quantity: 50, pricePerShare: 3, consideration: 150 });
    // A sale records its price on the buyer's certificate, not here.
    const { buyerCert } = await s.transferShares(s.securities.at(-1).id, {
      date: '2026-04-01', quantity: 10, pricePerShare: 5, to: { stakeholderId: 'h2' },
    });
    expect(buyerCert.transferPricePerShare).toBe(5);
    expect(repurchaseTerms(buyerCert)).toBeNull();
  });

  it('keeps the seller remainder\u2019s acceleration and 83(b) acknowledgement', async () => {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      {
        id: 'rs1', kind: 'shares', label: 'CS-7', stakeholderId: 'h1', classId: 'c1',
        quantity: 1000, pricePerShare: 0.001, date: '2024-01-01',
        vestingMonths: 48, cliffMonths: 12, accelTrigger: 'single', accelPct: 100,
        missed83b: true,
      },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    const { remainderCert } = await s.transferShares('rs1', {
      date: '2025-01-01', quantity: 100, pricePerShare: 1, to: { stakeholderId: 'h2' },
    });
    // Selling a tenth of the position is not an amendment striking the
    // acceleration provision or reopening a closed election window.
    expect(remainderCert).toMatchObject({
      quantity: 900, accelTrigger: 'single', accelPct: 100, missed83b: true,
    });
    expect(acceleratedVested(remainderCert, '2025-01-01', 'single')).toBe(900);
    expect(status83b(remainderCert, '2025-01-01').acknowledged).toBe(true);
  });

  it('leaves an open certificate fully editable', async () => {
    const s = makeStore();
    await s.updateSecurity('s1', { quantity: 250, date: '2024-02-02' });
    expect(s.security('s1')).toMatchObject({ quantity: 250, date: '2024-02-02' });
  });

  it('closes the original and issues both legs of a partial sale', async () => {
    const s = makeStore();
    const result = await s.transferShares('s1', {
      date: '2026-03-01', quantity: 60, pricePerShare: 5, to: { stakeholderId: 'h2' },
    });
    const original = s.security('s1');
    expect(original.closedAt).toBe('2026-03-01');
    expect(original.closedReason).toBe('transfer');
    expect(result.buyerCert).toMatchObject({
      stakeholderId: 'h2', quantity: 60, fromTransferId: 's1', transferPricePerShare: 5,
    });
    // The buyer's preference basis is the original issue price, not the $5.
    expect(result.buyerCert.pricePerShare).toBe(original.pricePerShare);
    expect(result.remainderCert).toMatchObject({ stakeholderId: 'h1', quantity: 40 });
  });

  it('retires the shares on a repurchase and keeps the remainder unrestricted', async () => {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      {
        id: 'rs1', kind: 'shares', label: 'CS-9', stakeholderId: 'h1', classId: 'c1',
        quantity: 100, pricePerShare: 0.01, date: '2025-01-01',
        vestingMonths: 48, cliffMonths: 0, vestingStart: '2025-01-01', filed83b: '2025-01-10',
      },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    const before = sharesOutstanding(s.securities);
    const result = await s.transferShares('rs1', {
      date: '2026-01-01', quantity: 75, pricePerShare: 0.01, to: 'company',
    });
    expect(result.buyerCert).toBeNull();
    expect(result.remainderCert.quantity).toBe(25);
    // The kept shares are the vested ones: no schedule, no 83(b) baggage.
    expect(result.remainderCert.vestingMonths).toBeUndefined();
    expect(result.remainderCert.filed83b).toBeUndefined();
    expect(sharesOutstanding(s.securities)).toBe(before - 75);
  });

  it('keeps the schedule when a repurchase takes less than the unvested balance', async () => {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      {
        id: 'rs5', kind: 'shares', label: 'CS-5', stakeholderId: 'h1', classId: 'c1',
        quantity: 1000, pricePerShare: 0.01, date: '2025-01-01',
        vestingMonths: 48, cliffMonths: 0, vestingStart: '2025-01-01', filed83b: '2025-01-10',
      },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    // 250 of the 1,000 are vested a year in, so 750 are still being earned.
    expect(vestedQuantity(s.security('rs5'), '2026-01-01')).toBe(250);
    const { remainderCert } = await s.transferShares('rs5', {
      date: '2026-01-01', quantity: 100, pricePerShare: 0.01, to: 'company',
    });
    /* The buyback took 100 of them, so the holder is still earning the rest:
       dropping the schedule would report all 900 remaining shares as vested
       and lose the 83(b) election with it. */
    expect(remainderCert.quantity).toBe(900);
    expect(remainderCert.vestingMonths).toBe(48);
    expect(remainderCert.vestingStart).toBe('2025-01-01');
    expect(remainderCert.filed83b).toBe('2025-01-10');
    expect(remainderCert.date83b).toBe('2025-01-01');
    /* The shares came off the unvested tail, so the 250 already earned are
       untouched and the schedule goes on being measured against the whole
       1,000-share position. */
    expect(remainderCert.vestingBase).toBe(1000);
    expect(vestedQuantity(remainderCert, '2026-01-01')).toBe(250);
    // 650 left to earn, on the original dates, until the position runs out -
    // which is 44 months in rather than the full 48, because the last 100
    // shares on the schedule are the ones the company bought back.
    expect(vestedQuantity(remainderCert, '2027-01-01')).toBe(500);
    expect(vestedQuantity(remainderCert, '2028-05-01')).toBe(833);
    expect(vestedQuantity(remainderCert, '2028-09-01')).toBe(900);
    expect(vestedQuantity(remainderCert, '2029-01-01')).toBe(900);
  });

  it('takes a tranche buyback off the tail too', async () => {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      {
        id: 'rs6', kind: 'shares', label: 'CS-6', stakeholderId: 'h1', classId: 'c1',
        quantity: 1000, pricePerShare: 0.01, date: '2025-01-01',
        vestingTranches: [
          { date: '2026-01-01', quantity: 250 },
          { date: '2027-01-01', quantity: 250 },
          { date: '2028-01-01', quantity: 250 },
          { date: '2029-01-01', quantity: 250 },
        ],
      },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    const { remainderCert } = await s.transferShares('rs6', {
      date: '2026-01-01', quantity: 100, pricePerShare: 0.01, to: 'company',
    });
    expect(remainderCert.quantity).toBe(900);
    // The tranches stand as written; the clamp is what drops the tail.
    expect(remainderCert.vestingTranches.map((t) => t.quantity)).toEqual([250, 250, 250, 250]);
    expect(vestedQuantity(remainderCert, '2026-01-01')).toBe(250);
    expect(vestedQuantity(remainderCert, '2028-01-01')).toBe(750);
    expect(vestedQuantity(remainderCert, '2029-01-01')).toBe(900);
  });

  it('scales a sale remainder pro rata, tail buyback rules aside', async () => {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      {
        id: 'rs7', kind: 'shares', label: 'CS-7', stakeholderId: 'h1', classId: 'c1',
        quantity: 1000, pricePerShare: 0.01, date: '2025-01-01',
        vestingMonths: 48, cliffMonths: 0, vestingStart: '2025-01-01',
      },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    const { remainderCert } = await s.transferShares('rs7', {
      date: '2026-01-01', quantity: 100, pricePerShare: 1, to: { stakeholderId: 'h2' },
    });
    // A buyer takes a pro-rata slice of both halves, so the schedule scales.
    expect(remainderCert.quantity).toBe(900);
    expect(remainderCert.vestingBase).toBeUndefined();
    expect(vestedQuantity(remainderCert, '2026-01-01')).toBe(225);
  });

  it('carries exercise provenance and the schedule onto a sale remainder', async () => {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      {
        id: 'rs2', kind: 'shares', label: 'CS-8', stakeholderId: 'h1', classId: 'c1',
        quantity: 100, pricePerShare: 0.5, date: '2025-01-01', fromOptionId: 'o9',
        vestingMonths: 48, cliffMonths: 0, vestingStart: '2025-01-01', filed83b: '2025-01-10',
      },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    const { buyerCert, remainderCert } = await s.transferShares('rs2', {
      date: '2026-01-01', quantity: 30, pricePerShare: 2, to: { stakeholderId: 'h2' },
    });
    expect(buyerCert.fromOptionId).toBe('o9');
    expect(remainderCert.fromOptionId).toBe('o9');
    expect(remainderCert.vestingMonths).toBe(48);
    expect(remainderCert.filed83b).toBe('2025-01-10');
    // The buyer bought outright; no schedule follows them.
    expect(buyerCert.vestingMonths).toBeUndefined();
  });

  it('creates the receiving party inline when asked', async () => {
    const s = makeStore();
    const { buyerId } = await s.transferShares('s1', {
      date: '2026-03-01', quantity: 100, to: { newHolder: { name: 'Family Trust', kind: 'entity' } },
    });
    expect(s.stakeholder(buyerId)?.name).toBe('Family Trust');
  });

  it('scales a tranche schedule onto the sale remainder', async () => {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      {
        id: 'rs4', kind: 'shares', label: 'CS-6', stakeholderId: 'h1', classId: 'c1',
        quantity: 1_000_000, pricePerShare: 0.01, date: '2025-01-01',
        vestingTranches: [
          { date: '2026-01-01', quantity: 500_000 },
          { date: '2027-01-01', quantity: 500_000 },
        ],
      },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    const { remainderCert } = await s.transferShares('rs4', {
      date: '2025-06-01', quantity: 600_000, pricePerShare: 1, to: { stakeholderId: 'h2' },
    });
    // 400k kept out of 1M: the schedule follows at 40%, not at quantities
    // that would clamp the remainder fully vested on the first tranche.
    expect(remainderCert.vestingTranches).toEqual([
      { date: '2026-01-01', quantity: 200_000 },
      { date: '2027-01-01', quantity: 200_000 },
    ]);
    expect(vestedQuantity(remainderCert, '2026-06-01')).toBe(200_000);
  });

  it('a partial sale never restarts the remainder’s 83(b) window', async () => {
    const s = makeStore();
    // Founder restricted stock from 2023, 83(b) never filed - long missed.
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      {
        id: 'rs3', kind: 'shares', label: 'CS-7', stakeholderId: 'h1', classId: 'c1',
        quantity: 4_000_000, pricePerShare: 0.0001, date: '2023-05-20',
        vestingMonths: 48, cliffMonths: 12, vestingStart: '2023-05-20',
      },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    expect(status83b(s.security('rs3'), '2026-08-01')).toMatchObject({ state: 'missed' });

    const { remainderCert } = await s.transferShares('rs3', {
      date: '2026-08-01', quantity: 400_000, pricePerShare: 2, to: { stakeholderId: 'h2' },
    });
    // The remainder continues the 2023 purchase: still missed, never 'open'
    // with a fresh deadline that would prompt a filing three years too late.
    expect(remainderCert.date83b).toBe('2023-05-20');
    expect(status83b(remainderCert, '2026-08-02')).toMatchObject({ state: 'missed' });

    // And the anchor survives a save/load round trip.
    const [reloaded] = Store.sanitizeSecurities(
      [remainderCert], { classes: s.classes, stakeholders: s.stakeholders });
    expect(reloaded.date83b).toBe('2023-05-20');
  });

  it('refuses bad transfers where the records are written', async () => {
    const s = makeStore();
    await expect(s.transferShares('s1', { date: '2026-03-01', quantity: 500, to: { stakeholderId: 'h2' } }))
      .rejects.toThrow(/only holds/);
    await expect(s.transferShares('s1', { date: '2026-03-01', quantity: 50, to: { stakeholderId: 'h1' } }))
      .rejects.toThrow(/already belong/);
    await expect(s.transferShares('s1', { date: '2023-01-01', quantity: 50, to: { stakeholderId: 'h2' } }))
      .rejects.toThrow(/precede/);
    await s.transferShares('s1', { date: '2026-03-01', quantity: 100, to: { stakeholderId: 'h2' } });
    await expect(s.transferShares('s1', { date: '2026-04-01', quantity: 100, to: { stakeholderId: 'h2' } }))
      .rejects.toThrow(/already transferred/);
  });

  it('rolls the whole transfer back when the write fails', async () => {
    const s = makeStore();
    const before = JSON.stringify({ h: s.stakeholders, x: s.securities });
    globalThis.puter.kv.set = async () => { throw new Error('offline'); };
    await expect(s.transferShares('s1', {
      date: '2026-03-01', quantity: 60, to: { newHolder: { name: 'Family Trust', kind: 'entity' } },
    })).rejects.toThrow('offline');
    expect(JSON.stringify({ h: s.stakeholders, x: s.securities })).toBe(before);
  });
});

describe('Store.markDeparted', () => {
  /** A holder with one half-vested grant (2,400 of 4,800 on 2026-03-01). */
  function employed() {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      {
        id: 'o2', kind: 'option', label: 'OPT-2', stakeholderId: 'h1', quantity: 4800,
        strike: 0.5, grantDate: '2024-03-01', date: '2024-03-01',
        vestingMonths: 48, cliffMonths: 0, exercised: 0, expires: '2034-03-01',
      },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    return s;
  }

  it('stamps the holder, cancels unvested, and sets the deadline atomically', async () => {
    const s = employed();
    await s.markDeparted('h1', {
      date: '2026-03-01',
      grants: [{ id: 'o2', cancelQty: 2400, exerciseBy: '2026-05-30' }],
    });
    expect(s.stakeholder('h1').departed).toBe('2026-03-01');
    const grant = s.security('o2');
    expect(grant.cancelled).toBe(2400);
    expect(grant.cancelledDate).toBe('2026-03-01');
    expect(grant.exerciseBy).toBe('2026-05-30');
  });

  it('refuses to cancel options the holder already bought', async () => {
    const s = employed();
    await s.exerciseOption('o2', { quantity: 2400, date: '2026-03-01' });
    const before = JSON.stringify({ h: s.stakeholders, x: s.securities });
    await expect(s.markDeparted('h1', {
      date: '2026-03-01',
      grants: [{ id: 'o2', cancelQty: 3000, exerciseBy: '2026-05-30' }],
    })).rejects.toThrow(/left to cancel/);
    expect(JSON.stringify({ h: s.stakeholders, x: s.securities })).toBe(before);
  });

  it('refuses a termination dated before a grant it would forfeit', async () => {
    const s = employed();
    const before = JSON.stringify({ h: s.stakeholders, x: s.securities });
    // Vesting measured before the grant existed read all 4,800 as unvested.
    await expect(s.markDeparted('h1', {
      date: '2024-01-01',
      grants: [{ id: 'o2', cancelQty: 4800, exerciseBy: '' }],
    })).rejects.toThrow('OPT-2 was granted on 2024-03-01, after this termination date.');
    expect(JSON.stringify({ h: s.stakeholders, x: s.securities })).toBe(before);
    // The grant date itself is the first day a departure can touch it.
    await s.markDeparted('h1', {
      date: '2024-03-01',
      grants: [{ id: 'o2', cancelQty: 4800, exerciseBy: '' }],
    });
    expect(s.security('o2')).toMatchObject({ cancelled: 4800, cancelledDate: '2024-03-01' });
  });

  it('refuses an exercise deadline that precedes the termination', async () => {
    const s = employed();
    const before = JSON.stringify({ h: s.stakeholders, x: s.securities });
    await expect(s.markDeparted('h1', {
      date: '2026-03-01',
      grants: [{ id: 'o2', cancelQty: 2400, exerciseBy: '2026-02-01' }],
    })).rejects.toThrow(/exercise deadline can’t precede the termination date/);
    expect(JSON.stringify({ h: s.stakeholders, x: s.securities })).toBe(before);
  });

  it('rolls the whole departure back when the write fails', async () => {
    const s = employed();
    const before = JSON.stringify({ h: s.stakeholders, x: s.securities });
    globalThis.puter.kv.set = async () => { throw new Error('offline'); };
    await expect(s.markDeparted('h1', {
      date: '2026-03-01',
      grants: [{ id: 'o2', cancelQty: 2400, exerciseBy: '2026-05-30' }],
    })).rejects.toThrow('offline');
    expect(JSON.stringify({ h: s.stakeholders, x: s.securities })).toBe(before);
  });
});

describe('Store vesting ceiling', () => {
  /** A 48-month grant with half of it exercised at the two-year mark. */
  async function halfExercised(kind = 'option', extra = {}) {
    const s = makeStore();
    const a = await s.addSecurity({ kind, stakeholderId: 'h1', classId: 'c1', quantity: 1000, strike: 1,
      date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 0, ...extra });
    if (kind === 'rsu') await s.settleRSU(a.id, { quantity: 500, date: '2026-01-01' });
    else await s.exerciseOption(a.id, { quantity: 500, date: '2026-01-01', classId: 'c1' });
    return { s, a };
  }

  it('finds the exercise a grant made ahead of its vesting', () => {
    const grant = { id: 'g', kind: 'option', label: 'OPT-1', quantity: 1000, grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 0 };
    const cert = (id, date, quantity, extra = {}) => ({ id, kind: 'shares', fromOptionId: 'g', date, quantity, ...extra });
    // 250 vested a year in: an exercise of exactly that is covered, one more is not.
    expect(exerciseAheadOfVesting(grant, [cert('a', '2025-01-01', 250)])).toBeNull();
    expect(exerciseAheadOfVesting(grant, [cert('a', '2025-01-01', 250), cert('b', '2025-01-01', 1)]))
      .toMatchObject({ exercised: 251, vested: 250, certificate: { id: 'b' } });
    // Read in date order, whatever order the array holds.
    expect(exerciseAheadOfVesting(grant, [cert('late', '2027-01-01', 500), cert('early', '2024-02-01', 100)]))
      .toMatchObject({ certificate: { id: 'early' }, exercised: 100, vested: 20 });
    // Transfer successors and other grants' certificates are not exercises of this one.
    expect(exerciseAheadOfVesting(grant, [
      cert('a', '2025-01-01', 250),
      cert('t', '2025-06-01', 250, { fromTransferId: 'a' }),
      cert('o', '2024-02-01', 900, { fromOptionId: 'other' }),
    ])).toBeNull();
    expect(exerciseAheadOfVesting({ ...grant, kind: 'rsu' }, [cert('a', '2024-02-01', 900)])).toBeNull();
  });

  it('reads what an award will ever vest as its record stands', () => {
    const grant = { kind: 'option', quantity: 1000, grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 0 };
    expect(vestingCeiling(grant)).toBe(1000);
    expect(vestingCeiling({ ...grant, cancelled: 500, cancelledDate: '2025-01-01' })).toBe(500);
    expect(vestingCeiling({ ...grant, cancelled: 500, cancelledDate: '2025-01-01', vestingStoppedAt: '2025-01-01' })).toBe(250);
    expect(vestingCeiling({ ...grant, cancelled: 800, cancelledDate: '2026-01-01' })).toBe(200);
    expect(vestingCeiling({ ...grant, vestingMonths: 0, vestingTranches: [{ date: '2025-01-01', quantity: 400 }] })).toBe(400);
    expect(vestingCeiling({ ...grant, kind: 'rsu', cancelled: 500, cancelledDate: '2025-01-01' })).toBe(500);
    expect(vestingCeiling({ ...grant, kind: 'rsu', cancelled: 500, cancelledDate: '2025-01-01', vestingStoppedAt: '2025-01-01' })).toBe(250);
  });

  it('refuses stopping vesting below what was already exercised', async () => {
    /* Backdated a year, the cancellation stopped the clock at 250 options
       while 500 stood exercised on the grant and its certificate - a holder
       who had bought twice what they would ever earn, and an expense report
       reversing the cost of options that had been paid for. */
    const { s, a } = await halfExercised();
    const before = JSON.stringify(s.securities);
    await expect(s.updateSecurity(a.id, { vestingStoppedAt: '2025-01-01', cancellations: [{ quantity: 500, date: '2025-01-01' }] }))
      .rejects.toThrow('OPT-1 has 500 options exercised, but only 250 had vested when its vesting stopped on 2025-01-01.');
    expect(JSON.stringify(s.securities)).toBe(before);
    // Dated the day the exercise was made - or any later day - it is fine.
    await s.updateSecurity(a.id, { vestingStoppedAt: '2026-01-01', cancellations: [{ quantity: 500, date: '2026-01-01' }] });
    expect(s.security(a.id)).toMatchObject({ exercised: 500, cancelled: 500, cancelledDate: '2026-01-01' });
    expect(vestingCeiling(s.security(a.id))).toBe(500);
  });

  it('refuses a departure that does the same once the deadline is cleared', async () => {
    /* With a deadline the window guard already catches an exercise dated
       after it; cleared, only the vesting says the dates disagree. */
    const { s, a } = await halfExercised();
    await expect(s.markDeparted('h1', { date: '2025-01-01', grants: [{ id: a.id, cancelQty: 500, exerciseBy: '' }] }))
      .rejects.toThrow(/OPT-1 has 500 options exercised, but only 250 had vested when its vesting stopped on 2025-01-01/);
    expect(s.stakeholder('h1').departed).toBeUndefined();
    expect(s.security(a.id).cancelled).toBeUndefined();
    await s.markDeparted('h1', { date: '2026-01-01', grants: [{ id: a.id, cancelQty: 500, exerciseBy: '' }] });
    expect(s.stakeholder('h1').departed).toBe('2026-01-01');
    expect(s.security(a.id)).toMatchObject({ cancelled: 500, cancelledDate: '2026-01-01' });
  });

  it('holds an RSU award to its settled units the same way', async () => {
    const { s, a } = await halfExercised('rsu');
    await expect(s.updateSecurity(a.id, { vestingStoppedAt: '2025-01-01', cancellations: [{ quantity: 500, date: '2025-01-01' }] }))
      .rejects.toThrow('RSU-1 has 500 units settled, but only 250 had vested when its vesting stopped on 2025-01-01.');
    expect(s.security(a.id).cancelled).toBeUndefined();
    await s.updateSecurity(a.id, { vestingStoppedAt: '2026-01-01', cancellations: [{ quantity: 500, date: '2026-01-01' }] });
    expect(s.security(a.id)).toMatchObject({ settled: 500, cancelled: 500 });
  });

  it('refuses a schedule rewritten to vest less than has been exercised', async () => {
    const s = makeStore();
    const a = await s.addSecurity({ kind: 'option', stakeholderId: 'h1', quantity: 1000, strike: 1,
      date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 0,
      vestingTranches: [{ date: '2025-01-01', quantity: 500 }, { date: '2026-01-01', quantity: 500 }] });
    await s.exerciseOption(a.id, { quantity: 500, date: '2025-06-01', classId: 'c1' });
    await expect(s.updateSecurity(a.id, { vestingTranches: [{ date: '2025-01-01', quantity: 400 }] }))
      .rejects.toThrow('OPT-1 has 500 options exercised, but its vesting schedule only ever reaches 400.');
    expect(s.security(a.id).vestingTranches).toHaveLength(2);
    await s.updateSecurity(a.id, { vestingTranches: [{ date: '2025-01-01', quantity: 500 }] });
    expect(s.security(a.id).vestingTranches).toEqual([{ date: '2025-01-01', quantity: 500 }]);
  });

  it('refuses a note maturity settled before the note was signed', async () => {
    const s = makeStore();
    const n = await s.addSecurity({ kind: 'note', stakeholderId: 'h1', principal: 1000, interestRate: 5,
      date: '2025-01-01', maturityDate: '2026-01-01' });
    await expect(s.updateSecurity(n.id, { maturedAt: '2024-12-31' }))
      .rejects.toThrow('CN-1 was issued on 2025-01-01, so its maturity can’t have been settled on 2024-12-31.');
    expect(s.security(n.id).maturedAt).toBeUndefined();
    // Settled early (repaid ahead of maturity) or on time is fine, and a
    // record imported already in that state keeps every other field editable.
    await s.updateSecurity(n.id, { maturedAt: '2025-06-01' });
    expect(s.security(n.id).maturedAt).toBe('2025-06-01');
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'imp', kind: 'note', label: 'CN-9', stakeholderId: 'h2', principal: 500, date: '2025-01-01', maturityDate: '2026-01-01', maturedAt: '2024-01-01' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    await s.updateSecurity('imp', { interestRate: 3 });
    expect(s.security('imp')).toMatchObject({ interestRate: 3, maturedAt: '2024-01-01' });
  });

  it('refuses turning early exercise off while an early exercise stands', async () => {
    /* With the flag cleared, the certificate read as options bought before
       they had vested on a grant that no longer allows that - and the next
       cancellation was refused for freezing vesting below what was bought,
       with nothing left to correct but a flag the form had let through. */
    const s = makeStore();
    const a = await s.addSecurity({ kind: 'option', stakeholderId: 'h1', quantity: 1000, strike: 1,
      date: '2026-01-01', grantDate: '2026-01-01', vestingMonths: 48, cliffMonths: 12, earlyExercise: true });
    const cert = await s.exerciseOption(a.id, { quantity: 800, date: '2026-03-01', classId: 'c1' });
    await expect(s.updateSecurity(a.id, { earlyExercise: false }))
      .rejects.toThrow(`${cert.label} was exercised from OPT-1 on 2026-03-01 with 800 exercised and 0 vested, so early exercise can’t be turned off while it stands.`);
    expect(s.security(a.id).earlyExercise).toBe(true);
    // Every other edit stays open, and a departure can still cancel the rest.
    await s.updateSecurity(a.id, { strike: 2 });
    expect(s.security(a.id)).toMatchObject({ strike: 2, earlyExercise: true });
    // Once the exercise is covered by the schedule the flag can go.
    await s.updateSecurity(cert.id, { date: '2030-03-01' });
    await s.updateSecurity(a.id, { earlyExercise: false });
    expect(s.security(a.id).earlyExercise).toBeUndefined();
  });

  it('refuses editing an exercise certificate into an exercise ahead of vesting', async () => {
    /* exerciseOption refuses buying more than had vested on the day, and
       the certificate could then be moved to an earlier day, or grown, into
       exactly the exercise that was refused - a record saying the holder
       bought before vesting on a grant that allows no such thing. */
    const { s, a } = await halfExercised();
    const cert = s.securities.find((c) => c.fromOptionId === a.id);
    // 250 had vested a year in, and 500 were bought.
    await expect(s.updateSecurity(cert.id, { date: '2025-01-01' }))
      .rejects.toThrow(`${cert.label} was exercised from OPT-1 on 2025-01-01, when only 250 of the 500 bought had vested. Only vested options can be exercised on this grant.`);
    // 500 had vested on its own day, and 800 is more than that.
    await expect(s.updateSecurity(cert.id, { quantity: 800 }))
      .rejects.toThrow(`${cert.label} was exercised from OPT-1 on 2026-01-01, when only 500 of the 800 bought had vested.`);
    expect(s.security(cert.id)).toMatchObject({ date: '2026-01-01', quantity: 500 });
    expect(s.security(a.id).exercised).toBe(500);
    // Later, smaller, or covered by the schedule is fine, and the counter follows.
    await s.updateSecurity(cert.id, { date: '2027-01-01', quantity: 700 });
    expect(s.security(cert.id)).toMatchObject({ date: '2027-01-01', quantity: 700 });
    expect(s.security(a.id).exercised).toBe(700);
    await s.updateSecurity(cert.id, { date: '2026-01-01', quantity: 500 });
    expect(s.security(a.id).exercised).toBe(500);
  });

  it('holds an RSU settlement certificate to the units vested on its day', async () => {
    /* settleRSU refuses settling more than had vested on the day, and the
       certificate could then be moved earlier, or grown, into exactly the
       settlement that was refused - with the award's counter following it. */
    const { s, a } = await halfExercised('rsu');
    const cert = s.securities.find((c) => c.fromRsuId === a.id);
    // 250 had vested a year in, and 500 were settled.
    await expect(s.updateSecurity(cert.id, { date: '2025-01-01' }))
      .rejects.toThrow(`${cert.label} was settled from ${a.label} on 2025-01-01, when only 250 of the 500 settled had vested. Only vested units can be settled.`);
    await expect(s.updateSecurity(cert.id, { quantity: 800 }))
      .rejects.toThrow(`${cert.label} was settled from ${a.label} on 2026-01-01, when only 500 of the 800 settled had vested.`);
    expect(s.security(cert.id)).toMatchObject({ date: '2026-01-01', quantity: 500 });
    expect(s.security(a.id).settled).toBe(500);
    // Later, smaller, or covered by the schedule is fine, and the counter follows.
    await s.updateSecurity(cert.id, { date: '2027-01-01', quantity: 700 });
    expect(s.security(a.id).settled).toBe(700);
    await s.updateSecurity(cert.id, { date: '2026-01-01', quantity: 500 });
    expect(s.security(a.id).settled).toBe(500);
  });

  it('reads exercises ahead of vesting across every certificate of the grant', async () => {
    const { s, a } = await halfExercised();
    // A second exercise, a year later: 250 vested a year in, 500 two years in, 750 three.
    const second = await s.exerciseOption(a.id, { quantity: 250, date: '2027-01-01', classId: 'c1' });
    // Moved to the first exercise's day the two together outrun what had vested then.
    await expect(s.updateSecurity(second.id, { date: '2026-01-01' }))
      .rejects.toThrow(`${second.label} was exercised from OPT-1 on 2026-01-01, when only 500 of the 750 bought had vested.`);
    // A day the cumulative balance is covered on is fine: 770 had vested 37 months in.
    await s.updateSecurity(second.id, { date: '2027-02-01' });
    expect(s.security(second.id).date).toBe('2027-02-01');
  });

  it('leaves early-exercise grants and imported certificates ahead of vesting alone', async () => {
    const { s, a } = await halfExercised('option', { earlyExercise: true });
    const cert = s.securities.find((c) => c.fromOptionId === a.id);
    await s.updateSecurity(cert.id, { date: '2024-02-01', quantity: 900 });
    expect(s.security(cert.id)).toMatchObject({ date: '2024-02-01', quantity: 900 });
    // A certificate imported already ahead of its grant's vesting keeps
    // every other field editable, and moving it later only helps.
    const imported = makeStore();
    const g = await imported.addSecurity({ kind: 'option', stakeholderId: 'h1', quantity: 1000, strike: 1,
      date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 12, exercised: 400 });
    imported.securities = Store.sanitizeSecurities([
      ...imported.securities,
      { id: 'imp', kind: 'shares', label: 'CS-9', stakeholderId: 'h1', classId: 'c1', quantity: 400, pricePerShare: 1, date: '2024-06-01', fromOptionId: g.id },
    ], { classes: imported.classes, stakeholders: imported.stakeholders });
    expect(exerciseAheadOfVesting(imported.security(g.id), imported.securities)).toMatchObject({ exercised: 400, vested: 0 });
    await imported.updateSecurity('imp', { pricePerShare: 2, date: '2024-05-01' });
    expect(imported.security('imp')).toMatchObject({ pricePerShare: 2, date: '2024-05-01' });
    await imported.updateSecurity('imp', { date: '2026-01-01' });
    expect(imported.security('imp').date).toBe('2026-01-01');
  });

  it('leaves early-exercise grants and records imported past the ceiling alone', async () => {
    // Buying ahead of the schedule is what early exercise means.
    const { s, a } = await halfExercised('option', { earlyExercise: true });
    await s.updateSecurity(a.id, { cancellations: [{ quantity: 500, date: '2025-01-01' }] });
    expect(s.security(a.id)).toMatchObject({ exercised: 500, cancelled: 500, cancelledDate: '2025-01-01' });
    // A grant imported already over its ceiling keeps every other field
    // editable, and a cancellation moved later only raises the ceiling.
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'imp', kind: 'option', label: 'IMP-1', stakeholderId: 'h2', quantity: 1000, strike: 1, date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 48, exercised: 500, cancelled: 500, cancelledDate: '2025-01-01', vestingStoppedAt: '2025-01-01' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    expect(vestingCeiling(s.security('imp'))).toBe(250);
    await s.updateSecurity('imp', { strike: 2 });
    expect(s.security('imp').strike).toBe(2);
    await s.updateSecurity('imp', { vestingStoppedAt: '2025-07-01', cancellations: [{ quantity: 500, date: '2025-07-01' }] });
    expect(s.security('imp').cancelledDate).toBe('2025-07-01');
  });
});

describe('Store update hardening', () => {
  let s;
  beforeEach(() => { s = makeStore(); });

  it('keeps the record when a patch would blank a stakeholder name', async () => {
    await s.updateStakeholder('h1', { name: '   ' });
    expect(s.stakeholder('h1')?.name).toBe('Ada');
    expect(s.stakeholders.every(Boolean)).toBe(true);
  });

  it('keeps the record when a patch would blank a class name', async () => {
    await s.updateClass('c1', { name: '' });
    expect(s.shareClass('c1')?.name).toBe('Common Stock');
    expect(s.classes.every(Boolean)).toBe(true);
  });
});

describe('renaming a stakeholder', () => {
  it('keeps the name being left behind, once, and never the current one', async () => {
    /* The holder's page finds their history by the name in the log's lines,
       so correcting "Ada" to "Ada Chen" emptied Ada Chen's History card while
       the log itself still held every line. */
    const s = makeStore();
    await s.updateStakeholder('h1', { name: 'Ada Chen' });
    expect(s.stakeholder('h1')).toMatchObject({ name: 'Ada Chen', formerNames: ['Ada'] });
    // A second rename stacks, newest first.
    await s.updateStakeholder('h1', { name: 'Ada Chen-Okafor' });
    expect(s.stakeholder('h1').formerNames).toEqual(['Ada Chen', 'Ada']);
    // Back to an earlier name: that name is current again, not former.
    await s.updateStakeholder('h1', { name: 'Ada' });
    expect(s.stakeholder('h1').formerNames).toEqual(['Ada Chen-Okafor', 'Ada Chen']);
    // Capitalization alone is the same name, and an edit that leaves the name
    // alone records nothing.
    await s.updateStakeholder('h1', { name: 'ADA' });
    await s.updateStakeholder('h1', { email: 'ada@example.com' });
    expect(s.stakeholder('h1')).toMatchObject({ name: 'ADA', formerNames: ['Ada Chen-Okafor', 'Ada Chen'] });
  });

  it('caps and cleans the list on the way in', () => {
    const [h] = Store.sanitizeStakeholders([{
      id: 'x', name: 'Now', formerNames: ['now', 'A', 'a', ' B ', '', 3, ...'CDEFGHIJKLMN'],
    }]);
    // The current name and duplicates drop out, whitespace is trimmed, and
    // ten is the most a record keeps.
    expect(h.formerNames).toEqual(['A', 'B', '3', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
    expect(Store.sanitizeStakeholders([{ id: 'y', name: 'Plain' }])[0].formerNames).toBeUndefined();
  });
});

describe('a converted instrument keeps its terms', () => {
  function converted() {
    const s = makeStore();
    s.securities = Store.sanitizeSecurities([
      ...s.securities,
      { id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h2', principal: 250_000, valuationCap: 8_000_000, discount: 20, safeType: 'post', date: '2025-01-01', convertedAt: '2026-01-01', convertedToId: 'c2' },
      { id: 'c2', kind: 'shares', label: 'CS-3', stakeholderId: 'h2', classId: 'c1', quantity: 100_000, pricePerShare: 2.5, date: '2026-01-01', fromConvertibleId: 'sf1' },
      { id: 'n1', kind: 'note', label: 'CN-1', stakeholderId: 'h2', principal: 100_000, valuationCap: 5_000_000, discount: 10, interestRate: 8, date: '2025-02-01', maturityDate: '2027-02-01', convertedAt: '2026-01-01', convertedToId: 'c3' },
      { id: 'c3', kind: 'shares', label: 'CS-4', stakeholderId: 'h2', classId: 'c1', quantity: 40_000, pricePerShare: 2.5, date: '2026-01-01', fromConvertibleId: 'n1' },
      { id: 'sf2', kind: 'safe', label: 'SAFE-2', stakeholderId: 'h1', principal: 50_000, valuationCap: 0, discount: 0, safeType: 'pre', date: '2025-03-01' },
    ], { classes: s.classes, stakeholders: s.stakeholders });
    return s;
  }

  it('holds a converted SAFE to the principal, cap, discount and type its certificate was sized from', async () => {
    /* Raised from $250,000 to $300,000 after the round, the extra $50,000 went
       into capital raised and the issuance history while CS-3 still held the
       shares $250,000 bought. */
    const s = converted();
    const raised = capitalRaised(s.securities);
    await s.updateSecurity('sf1', { principal: 300_000, valuationCap: 6_000_000, discount: 30, safeType: 'pre' });
    expect(s.security('sf1')).toMatchObject({ principal: 250_000, valuationCap: 8_000_000, discount: 20, safeType: 'post' });
    expect(capitalRaised(s.securities)).toBe(raised);
  });

  it('holds a converted note to its interest rate too, while the rest stays editable', async () => {
    const s = converted();
    await s.updateSecurity('n1', { principal: 120_000, interestRate: 12, maturityDate: '2028-02-01' });
    expect(s.security('n1')).toMatchObject({ principal: 100_000, interestRate: 8, maturityDate: '2028-02-01' });
  });

  it('leaves a live instrument editable, and reopens a converted one when its certificate goes', async () => {
    const s = converted();
    await s.updateSecurity('sf2', { principal: 75_000, discount: 15 });
    expect(s.security('sf2')).toMatchObject({ principal: 75_000, discount: 15 });
    await s.deleteSecurity('c2');
    expect(s.security('sf1').convertedAt).toBeUndefined();
    await s.updateSecurity('sf1', { principal: 300_000 });
    expect(s.security('sf1').principal).toBe(300_000);
  });
});

describe('Store export / import round trip', () => {
  it('restores everything an export carries, activity log included', async () => {
    const s = makeStore();
    s.company = Store.sanitizeCompany({ name: 'Test Co', poolAuthorized: 500 });
    await s.saveScenario({ name: 'Series A', preMoney: 10_000_000, investment: 2_000_000, poolPct: 0.1 });
    await s.saveExitScenario({ name: 'Acquisition', exitValue: 40_000_000 });
    s.logActivity('CS-1 issued to Ada (100 shares)', 'file-text');

    const backup = JSON.parse(JSON.stringify(s.exportAll()));
    await s.wipeAll();
    expect(s.activity).toHaveLength(0);

    await s.importAll(backup);
    expect(s.company.name).toBe('Test Co');
    expect(s.securities).toHaveLength(2);
    expect(s.scenarios.map((x) => x.name)).toEqual(['Series A']);
    expect(s.exits.map((x) => x.name)).toEqual(['Acquisition']);
    expect(s.activity.map((a) => a.text)).toEqual(['CS-1 issued to Ada (100 shares)']);
  });
});

describe('Store.sanitizeExits', () => {
  it('keeps the assumptions that decide the waterfall', async () => {
    const s = makeStore();
    const saved = await s.saveExitScenario({
      name: 'Acquisition', exitValue: 1_000_000, unvestedOptions: 'cancel', changeOfControl: true,
    });
    expect(saved).toMatchObject({ unvestedOptions: 'cancel', changeOfControl: true });
    expect(Store.sanitizeExits(s.exits)[0])
      .toMatchObject({ unvestedOptions: 'cancel', changeOfControl: true });
  });

  it('reads a scenario saved before they were recorded on the view defaults', () => {
    const [old] = Store.sanitizeExits([{ id: 'e1', name: 'Old', exitValue: 5 }]);
    expect(old).toMatchObject({ unvestedOptions: 'participate', changeOfControl: false });
    // Anything that isn't the cancel option is participation.
    expect(Store.sanitizeExits([{ name: 'X', exitValue: 1, unvestedOptions: 'nonsense' }])[0]
      .unvestedOptions).toBe('participate');
  });
});

describe('Store.sanitizeScenarios', () => {
  it('coerces the numbers a round scenario is loaded with', () => {
    const [s] = Store.sanitizeScenarios([{ name: 'A', preMoney: '18000000', investment: -5, poolPct: 3 }]);
    expect(s).toMatchObject({ name: 'A', preMoney: 18_000_000, investment: 0, poolPct: 0.9 });
    expect(s.id).toBeTruthy();
  });

  it('drops non-objects and names the nameless', () => {
    const out = Store.sanitizeScenarios(['nope', null, {}]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Untitled round');
  });

  it('hardens scenarios arriving through import', async () => {
    const s = makeStore();
    await s.importAll({ scenarios: [{ id: 'x', name: 42, preMoney: 'lots', investment: 1e6, poolPct: 'half' }] });
    expect(s.scenarios).toEqual([expect.objectContaining({
      id: 'x', name: '42', preMoney: 0, investment: 1e6, poolPct: 0,
    })]);
  });
});

describe('Store.sanitizeActivity', () => {
  it('keeps the newest entries when a log arrives oldest first', () => {
    const raw = Array.from({ length: 70 }, (_, i) => ({ id: `a${i}`, at: 1000 + i, text: `event ${i}` }));
    const kept = Store.sanitizeActivity(raw);
    expect(kept).toHaveLength(60);
    expect(kept[0].text).toBe('event 69');
    expect(kept.at(-1).text).toBe('event 10');
  });

  it('coerces entries into the exact shape logActivity writes', () => {
    const [entry] = Store.sanitizeActivity([{ text: 123, at: '1700000000000' }]);
    expect(entry.text).toBe('123');
    expect(entry.at).toBe(1_700_000_000_000);
    expect(entry.icon).toBe('activity');
    expect(entry.id).toBeTruthy();
  });

  it('drops non-objects and textless entries, and caps the log', () => {
    expect(Store.sanitizeActivity(['nope', null, { icon: 'x' }, { text: '' }])).toEqual([]);
    const long = Array.from({ length: 100 }, (_, i) => ({ text: `entry ${i}` }));
    expect(Store.sanitizeActivity(long)).toHaveLength(60);
  });

  it('hardens the log arriving through import so views can search it', async () => {
    const s = makeStore();
    await s.importAll({ activity: [{ text: 123 }, { text: 'CS-1 issued', at: 5, icon: 'file-text' }] });
    // Every view that filters the log calls text.toLowerCase() - it must
    // never throw, whatever the file carried.
    expect(() => s.activity.filter((a) => a.text.toLowerCase().includes('ada'))).not.toThrow();
    expect(s.activity[1]).toMatchObject({ text: 'CS-1 issued', at: 5, icon: 'file-text' });
  });
});

describe('refusals are told apart from failed writes', () => {
  it('marks a rule the store declined inside apply(), and not a write that failed to land', async () => {
    const s = makeStore();
    await s.init();
    const holder = await s.addStakeholder({ name: 'Sam', kind: 'employee' });
    const grant = await s.addSecurity({ kind: 'option', stakeholderId: holder.id, quantity: 100,
      strike: 1, date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 12 });
    // Nothing had vested: refused for a reason written for the user.
    const refused = await s.exerciseOption(grant.id, { quantity: 10, date: '2024-06-01' }).catch((e) => e);
    expect(refused).toBeInstanceOf(Error);
    expect(isRefusal(refused)).toBe(true);
    expect(refused.message).toMatch(/Only vested options/);
    expect(s.security(grant.id).exercised).toBe(0);
    // The platform failing to store the write is not a refusal.
    const set = puter.kv.set;
    puter.kv.set = async () => { throw new Error('Failed to fetch'); };
    const failed = await s.exerciseOption(grant.id, { quantity: 10, date: '2026-01-01' }).catch((e) => e);
    puter.kv.set = set;
    expect(failed).toBeInstanceOf(Error);
    expect(isRefusal(failed)).toBe(false);
    expect(s.security(grant.id).exercised).toBe(0);
    // The typed errors are refusals by nature, whichever way they were thrown.
    expect(isRefusal(new ListFullError('full'))).toBe(true);
    expect(isRefusal(new CompanyChangedError())).toBe(true);
    expect(isRefusal(new StaleWriteError('k'))).toBe(true);
    expect(isRefusal(new TypeError('x'))).toBe(false);
    expect(isRefusal(null)).toBe(false);
  });
});

describe('Store sanitizers on imported ids and figures', () => {
  const long = (c) => c.repeat(64);

  it('cuts ids and the references to them to one length', async () => {
    /* Ids arrived as written while references were cut to 40 characters, so
       a grant imported under a 64-character id never matched the
       fromOptionId its exercise certificate carried: the grant could be
       deleted under a standing certificate, and the exercise was offered
       for certifying a second time. */
    const s = makeStore();
    await s.init();
    await s.importAll({
      company: { name: 'Long Ids Co' },
      classes: [{ id: long('c'), name: 'Common Stock', kind: 'common', authorized: 10_000_000 }],
      stakeholders: [{ id: long('h'), name: 'Ada', kind: 'founder' }],
      securities: [{
        id: long('g'), kind: 'option', label: 'OPT-1', stakeholderId: long('h'), quantity: 1000, strike: 0.5,
        date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 0, cliffMonths: 0,
      }],
    });
    const [holder] = s.stakeholders;
    const [cls] = s.classes;
    const [grant] = s.securities;
    expect([holder.id, cls.id, grant.id].map((id) => id.length)).toEqual([40, 40, 40]);
    expect(grant.stakeholderId).toBe(holder.id);
    const cert = await s.exerciseOption(grant.id, { quantity: 100, date: '2025-01-01', classId: cls.id });
    expect(cert.fromOptionId).toBe(grant.id);
    expect(cert.classId).toBe(cls.id);
    expect(s.certificatesFrom(grant.id)).toHaveLength(1);
    expect(s.uncertifiedExercises(s.security(grant.id))).toBe(0);
    await expect(s.deleteSecurity(grant.id)).rejects.toThrow('was exercised into');
  });

  it('gives a second record under the same id one of its own', () => {
    /* A backup carrying two records under one id kept both, and every edit
       or delete of that id then touched both. */
    const holders = Store.sanitizeStakeholders([
      { id: 'dup', name: 'Ada', kind: 'founder' }, { id: 'dup', name: 'Grace', kind: 'founder' },
    ]);
    expect(holders.map((h) => h.name)).toEqual(['Ada', 'Grace']);
    expect(holders[0].id).toBe('dup');
    expect(holders[1].id).not.toBe('dup');
    const classes = Store.sanitizeClasses([
      { id: 'dup', name: 'Common Stock', kind: 'common' }, { id: 'dup', name: 'Series A', kind: 'preferred' },
    ]);
    expect(new Set(classes.map((c) => c.id)).size).toBe(2);
    const securities = Store.sanitizeSecurities([
      { id: 'dup', kind: 'shares', label: 'CS-1', stakeholderId: 'dup', classId: 'dup', quantity: 100, date: '2024-01-01' },
      { id: 'dup', kind: 'shares', label: 'CS-2', stakeholderId: 'dup', classId: 'dup', quantity: 200, date: '2024-01-01' },
    ], { classes, stakeholders: holders });
    expect(securities.map((x) => x.quantity)).toEqual([100, 200]);
    expect(securities[0].id).toBe('dup');
    expect(securities[1].id).not.toBe('dup');
    // References keep naming the first record, the only one they ever could.
    expect(securities.map((x) => x.stakeholderId)).toEqual(['dup', 'dup']);
    expect(Store.sanitizeValuations([
      { id: 'v', date: '2024-01-01', fmvPerShare: 1 }, { id: 'v', date: '2025-01-01', fmvPerShare: 2 },
    ]).map((v) => v.id === 'v')).toEqual([false, true]);
  });

  it('keeps imported figures inside the range arithmetic stays exact in', () => {
    const [cert] = Store.sanitizeSecurities([
      { id: 'x', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 1e308, pricePerShare: 1e300, date: '2024-01-01' },
    ], { classes: [{ id: 'c1' }], stakeholders: [{ id: 'h1' }] });
    expect(Number.isSafeInteger(cert.quantity)).toBe(true);
    expect(Number.isFinite(cert.quantity * cert.pricePerShare)).toBe(true);
    expect(sharesOutstanding([cert, cert])).toBe(cert.quantity * 2);
  });
});

describe('Store restore points around a failed write', () => {
  async function fivePoints() {
    const kv = new Map();
    const puter = {
      kv: {
        get: async (k) => (kv.has(k) ? kv.get(k) : null),
        set: async (k, v) => { kv.set(k, v); return true; },
        del: async (k) => kv.delete(k),
      },
      auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
    };
    globalThis.puter = puter;
    const s = new Store();
    await s.init();
    await s.addClass({ name: 'Common Stock', kind: 'common', authorized: 10_000_000 });
    await s.addStakeholder({ name: 'Ada', kind: 'founder' });
    await s.addSecurity({ kind: 'shares', stakeholderId: s.stakeholders[0].id, classId: s.classes[0].id, quantity: 100, date: '2024-01-01' });
    for (let i = 1; i <= 5; i++) await s.recordSplit({ num: 2, den: 1, date: `2025-0${i}-01` });
    expect(s.restorePoints).toHaveLength(5);
    const failSecurities = () => {
      const set = puter.kv.set;
      puter.kv.set = async (k, v) => {
        if (k.endsWith(':securities:v1')) throw new Error('offline');
        return set(k, v);
      };
      return () => { puter.kv.set = set; };
    };
    return { s, failSecurities };
  }

  it('keeps the point a failed restore was reaching for', async () => {
    /* With five points held, the snapshot taken before a restore pushed the
       oldest off the list - and when that was the point being restored, a
       write that failed left a snapshot of where the user still was and no
       way back to where they were going. */
    const { s, failSecurities } = await fivePoints();
    const before = s.restorePoints.map((p) => p.id);
    const oldest = before[before.length - 1];
    const restore = failSecurities();
    await expect(s.restoreFromPoint(oldest)).rejects.toThrow('offline');
    restore();
    expect(s.restorePoints.map((p) => p.id)).toEqual(before);
    expect(s.securities[0].quantity).toBe(3200);
    // The list on disk agrees.
    const s2 = new Store();
    await s2.init();
    expect(s2.restorePoints.map((p) => p.id)).toEqual(before);
    // And the restore goes through once the write does.
    await s.restoreFromPoint(oldest);
    expect(s.securities[0].quantity).toBe(100);
  });

  it('keeps the point a failed guarded write displaced', async () => {
    const { s, failSecurities } = await fivePoints();
    const before = s.restorePoints.map((p) => p.id);
    const restore = failSecurities();
    await expect(s.recordSplit({ num: 3, den: 1, date: '2025-08-01' })).rejects.toThrow('offline');
    restore();
    expect(s.restorePoints.map((p) => p.id)).toEqual(before);
  });
});

describe('Store undo and reissued labels', () => {
  it('refuses an undo whose label a record issued meanwhile has taken', async () => {
    const s = makeStore();
    const { undo } = await s.deleteSecurity('s2');
    // CS-2 is free again, so the next certificate in the class takes it.
    const fresh = await s.addSecurity({ kind: 'shares', stakeholderId: 'h1', classId: 'c1', quantity: 10, date: '2024-02-01' });
    expect(fresh.label).toBe('CS-2');
    await expect(undo()).rejects.toThrow('The cap table has changed since the delete.');
    expect(s.securities.filter((x) => x.label === 'CS-2')).toHaveLength(1);
    // The same for a holder's cascade.
    const t = makeStore();
    const cascade = await t.deleteStakeholder('h2');
    await t.addSecurity({ kind: 'shares', stakeholderId: 'h1', classId: 'c1', quantity: 10, date: '2024-02-01' });
    await expect(cascade.undo()).rejects.toThrow('The cap table has changed since the delete.');
    expect(t.stakeholder('h2')).toBeNull();
    // With the label still free the undo goes through.
    const u = makeStore();
    const { undo: back } = await u.deleteSecurity('s2');
    await back();
    expect(u.security('s2')).toMatchObject({ label: 'CS-2' });
  });
});

describe('Store company profile fields', () => {
  it('keeps an emptied entity type or jurisdiction empty, defaulting only an absent one', () => {
    expect(Store.sanitizeCompany({ name: 'Acme', entityType: '', jurisdiction: '  ' }))
      .toMatchObject({ entityType: '', jurisdiction: '' });
    expect(Store.sanitizeCompany({ name: 'Acme' }))
      .toMatchObject({ entityType: 'C-Corp', jurisdiction: 'Delaware' });
    expect(Store.sanitizeCompany(null)).toMatchObject({ entityType: 'C-Corp', jurisdiction: 'Delaware' });
  });
});

describe('a rollback the connection refuses too', () => {
  /** A holder with one certificate, over a KV that can be taken offline. */
  async function seeded() {
    const kv = new Map();
    const live = {
      get: async (k) => (kv.has(k) ? kv.get(k) : null),
      set: async (k, v) => { kv.set(k, v); return true; },
      del: async (k) => kv.delete(k),
    };
    const down = async () => { throw new Error('offline'); };
    globalThis.puter = { kv: { ...live }, auth: { getUser: async () => ({ uuid: 't', username: 'test' }) } };
    const s = new Store();
    await s.init();
    const ada = await s.addStakeholder({ name: 'Ada', kind: 'founder' });
    const cls = await s.addClass({ name: 'Common Stock', kind: 'common' });
    await s.addSecurity({ kind: 'shares', stakeholderId: ada.id, classId: cls.id, quantity: 100, date: '2024-01-01' });
    const key = (field) => `captable:${s.activeCompanyId}:${field}:v1`;
    const online = () => { Object.assign(puter.kv, live); };
    const offline = () => { Object.assign(puter.kv, { get: down, set: down }); };
    /* The stakeholders set lands; the connection is gone by the securities
       set, and stays gone for the rewrite. */
    const halfDelete = async () => {
      puter.kv.set = async (k, v) => {
        if (k.endsWith(':securities:v1')) {
          offline();
          return down();
        }
        return live.set(k, v);
      };
      await expect(s.deleteStakeholder(ada.id)).rejects.toThrow('offline');
    };
    return { s, kv, live, ada, cls, key, online, offline, halfDelete };
  }

  it('keeps memory, says so, and writes the rollback once the connection is back', async () => {
    const { s, kv, ada, key, online, halfDelete } = await seeded();
    const flips = [];
    s.addEventListener('unsaved', () => flips.push(s.unsaved));
    await halfDelete();
    // Memory is back; storage holds half the delete; the session knows.
    expect(s.stakeholders.map((h) => h.name)).toEqual(['Ada']);
    expect(s.securities).toHaveLength(1);
    expect(JSON.parse(kv.get(key('stakeholders')))).toEqual([]);
    expect(s.unsaved).toBe(true);
    expect(flips).toEqual([true]);
    expect(s.isStale).toBe(false);
    // Still offline: nothing lands and the debt stands.
    expect(await s.retryUnsaved()).toBe(false);
    expect(s.unsaved).toBe(true);
    online();
    expect(await s.retryUnsaved()).toBe(true);
    expect(s.unsaved).toBe(false);
    expect(flips).toEqual([true, false]);
    const reload = new Store();
    await reload.init();
    expect(reload.stakeholders.map((h) => h.name)).toEqual(['Ada']);
    expect(reload.securities.map((x) => x.stakeholderId)).toEqual([ada.id]);
  });

  it('owes nothing when the commit never reached storage', async () => {
    const { s, ada, online, offline } = await seeded();
    offline();
    await expect(s.deleteStakeholder(ada.id)).rejects.toThrow('offline');
    expect(s.stakeholders).toHaveLength(1);
    expect(s.unsaved).toBe(false);
    online();
    expect(await s.retryUnsaved()).toBe(true);
  });

  it('a later save of the same key settles its debt', async () => {
    const { s, kv, ada, key, online, halfDelete } = await seeded();
    await halfDelete();
    online();
    // The restored holder, renamed: the stakeholders key is written with them in it.
    await s.updateStakeholder(ada.id, { name: 'Ada L.' });
    expect(JSON.parse(kv.get(key('stakeholders'))).map((h) => h.name)).toEqual(['Ada L.']);
    // The durable transaction is recovered as a unit before accepting the
    // new edit, including its securities dependency.
    expect(s.unsaved).toBe(false);
    expect(await s.retryUnsaved()).toBe(true);
    expect(JSON.parse(kv.get(key('securities')))).toHaveLength(1);
  });

  it('drops the debt, and flags the session, when the key has moved on elsewhere', async () => {
    const { s, kv, key, online, halfDelete } = await seeded();
    await halfDelete();
    online();
    // Another tab has since saved holders of its own over the half-applied delete.
    kv.set(key('stakeholders'), JSON.stringify([{ id: 'x', name: 'Grace', kind: 'founder' }]));
    let stale = false;
    s.addEventListener('stale', () => { stale = true; });
    expect(await s.retryUnsaved()).toBe(true);
    expect(s.unsaved).toBe(false);
    expect(stale).toBe(true);
    expect(s.isStale).toBe(true);
    expect(JSON.parse(kv.get(key('stakeholders'))).map((h) => h.name)).toEqual(['Grace']);
  });

  it('passes its own unacknowledged bytes on the retry, however many rewrites failed', async () => {
    const { s, kv, live, ada, key } = await seeded();
    /* The stakeholders set lands but loses its acknowledgement; the securities
       set fails outright; the rewrite of the stakeholders fails too. */
    let holderSets = 0;
    puter.kv.set = async (k, v) => {
      if (k.endsWith(':securities:v1')) throw new Error('offline');
      if (k.endsWith(':stakeholders:v1')) {
        holderSets += 1;
        if (holderSets === 1) {
          await live.set(k, v);
          throw new Error('lost ack');
        }
        throw new Error('offline');
      }
      return live.set(k, v);
    };
    await expect(s.deleteStakeholder(ada.id)).rejects.toThrow('lost ack');
    expect(JSON.parse(kv.get(key('stakeholders')))).toEqual([]);
    expect(s.unsaved).toBe(true);
    puter.kv.set = live.set;
    let stale = false;
    s.addEventListener('stale', () => { stale = true; });
    /* The key holds the bytes of the first send, which the failed rewrite
       had displaced from the record of what this session sent. */
    expect(await s.retryUnsaved()).toBe(true);
    expect(stale).toBe(false);
    expect(JSON.parse(kv.get(key('stakeholders'))).map((h) => h.name)).toEqual(['Ada']);
  });

  it('loads the owed value, not the half-applied one, when the company is switched back to', async () => {
    const { s, online, halfDelete } = await seeded();
    await halfDelete();
    online();
    const first = s.activeCompanyId;
    await s.createCompany('Beta');
    expect(s.activeCompanyId).not.toBe(first);
    expect(s.unsaved).toBe(true);
    await s.switchCompany(first);
    expect(s.stakeholders.map((h) => h.name)).toEqual(['Ada']);
    expect(s.securities).toHaveLength(1);
    expect(s.recoveredHolders).toEqual([]);
    expect(await s.retryUnsaved()).toBe(true);
    const reload = new Store();
    await reload.init();
    expect(reload.stakeholders.map((h) => h.name)).toEqual(['Ada']);
    expect(reload.securities).toHaveLength(1);
  });

  it('owes nothing to a company that has been deleted', async () => {
    const { s, online, halfDelete } = await seeded();
    await halfDelete();
    online();
    const first = s.activeCompanyId;
    await s.createCompany('Beta');
    await s.deleteCompany(first);
    expect(s.unsaved).toBe(false);
  });
});

describe('Store load with securities whose holder is missing', () => {
  function stored(records) {
    const kv = new Map();
    kv.set('captable:companies:v1', JSON.stringify({ activeId: 'co', companies: [{ id: 'co', label: 'Acme', createdAt: 1 }] }));
    for (const [field, value] of Object.entries(records)) kv.set(`captable:co:${field}:v1`, JSON.stringify(value));
    globalThis.puter = {
      kv: {
        get: async (k) => (kv.has(k) ? kv.get(k) : null),
        set: async (k, v) => { kv.set(k, v); return true; },
        del: async (k) => kv.delete(k),
      },
      auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
    };
    return kv;
  }
  const common = [{ id: 'c1', name: 'Common Stock', kind: 'common', authorized: 10_000 }];

  it('keeps them under a stand-in holder instead of dropping them', async () => {
    stored({
      classes: common,
      stakeholders: [{ id: 'h1', name: 'Ada', kind: 'founder' }],
      securities: [
        { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 100, date: '2024-01-01' },
        { id: 's2', kind: 'shares', label: 'CS-2', stakeholderId: 'gone', classId: 'c1', quantity: 50, date: '2024-01-02' },
        { id: 's3', kind: 'option', label: 'OPT-3', stakeholderId: 'gone', quantity: 10, date: '2024-01-03' },
      ],
    });
    const s = new Store();
    let announced = 0;
    s.addEventListener('recovered', () => { announced += 1; });
    await s.init();
    expect(s.stakeholders.map((h) => h.name)).toEqual(['Ada', 'Unknown holder']);
    expect(s.stakeholder('gone')).toMatchObject({ name: 'Unknown holder', kind: 'entity' });
    expect(s.securities.map((x) => x.id)).toEqual(['s1', 's2', 's3']);
    expect(s.recoveredHolders.map((h) => h.id)).toEqual(['gone']);
    expect(announced).toBe(1);
    // Saved with the next write of the holders, the stand-in reads back as an ordinary holder.
    await s.updateStakeholder('gone', { name: 'Grace' });
    const again = new Store();
    await again.init();
    expect(again.stakeholders.map((h) => h.name)).toEqual(['Ada', 'Grace']);
    expect(again.securities).toHaveLength(3);
    expect(again.recoveredHolders).toEqual([]);
  });

  it('numbers several stand-ins, and makes none for a record dropped for a reason of its own', async () => {
    stored({
      classes: common,
      stakeholders: [],
      securities: [
        { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'a', classId: 'c1', quantity: 100, date: '2024-01-01' },
        { id: 's2', kind: 'shares', label: 'CS-2', stakeholderId: 'b', classId: 'c1', quantity: 50, date: '2024-01-02' },
        // Its class is missing too, so it goes as before - and no holder is made for it.
        { id: 's3', kind: 'shares', label: 'CS-3', stakeholderId: 'c', classId: 'ghost', quantity: 5, date: '2024-01-03' },
      ],
    });
    const s = new Store();
    await s.init();
    expect(s.stakeholders.map((h) => [h.id, h.name])).toEqual([['a', 'Unknown holder'], ['b', 'Unknown holder 2']]);
    expect(s.securities.map((x) => x.id)).toEqual(['s1', 's2']);
  });

  it('is the load’s doing only: a backup or import refuses them by name instead', async () => {
    stored({ classes: common, stakeholders: [{ id: 'h1', name: 'Ada', kind: 'founder' }], securities: [] });
    const s = new Store();
    await s.init();
    /* No stand-in and no silent drop: the file is the thing to fix, and the
       import says which record and why, taking nothing. */
    await expect(s.importAll({
      classes: common,
      stakeholders: [{ id: 'h1', name: 'Ada', kind: 'founder' }],
      securities: [{ id: 's9', kind: 'shares', label: 'CS-9', stakeholderId: 'nobody', classId: 'c1', quantity: 1, date: '2024-01-01' }],
    })).rejects.toThrow(/CS-9 names a stakeholder or share class the file does not include/);
    expect(s.securities).toEqual([]);
    expect(s.stakeholders.map((h) => h.name)).toEqual(['Ada']);
  });
});

describe('an exercise history entered out of date order', () => {
  /* 100 awarded 2025-01-01, vesting monthly over a year with no cliff: 25 had
     vested by April, 75 by October, all 100 by the next January. */
  const award = (s, kind, extra = {}) => s.addSecurity({
    kind, stakeholderId: 'h1', classId: 'c1', quantity: 100, strike: 1,
    date: '2025-01-01', vestingMonths: 12, cliffMonths: 0, ...extra,
  });
  const take = (s, a, quantity, date, classId = 'c1') => (a.kind === 'rsu'
    ? s.settleRSU(a.id, { quantity, date, classId })
    : s.exerciseOption(a.id, { quantity, date, classId }));
  const refusal = (kind) => (kind === 'rsu' ? /Only vested units/ : /Only vested options/);
  const counter = (s, a) => (a.kind === 'rsu' ? s.security(a.id).settled : s.security(a.id).exercised);

  for (const kind of ['option', 'rsu']) {
    it(`accepts a valid ${kind} history whichever transaction is recorded first`, async () => {
      /* Recorded in date order both went through. Recorded January first,
         April's 25 - exactly what had vested by April - were refused as
         unvested: the check netted every exercise on the counter, January's
         50 included, against April's balance. */
      const s = makeStore();
      const a = await award(s, kind);
      await take(s, a, 50, '2026-01-01');
      const cert = await take(s, a, 25, '2025-04-01');
      expect(cert).toMatchObject({ quantity: 25, date: '2025-04-01' });
      expect(counter(s, a)).toBe(75);
      // The shares were vested when they were bought, so nothing reverse-vests.
      expect(hasVesting(cert)).toBe(false);
      expect(exerciseAheadOfVesting(s.security(a.id), s.securities)).toBeNull();
    });

    it(`still refuses a backfilled ${kind} that would put a later one ahead of its vesting`, async () => {
      /* October's 75 were the whole of what had vested by October. An April
         exercise slipped in before it would leave 76 or more bought by October
         against 75 vested - the position the store refuses when the two are
         entered in order, and one nothing on the record could then explain. */
      const s = makeStore();
      const a = await award(s, kind);
      await take(s, a, 75, '2025-10-01');
      const before = JSON.stringify(s.securities);
      await expect(take(s, a, 25, '2025-04-01')).rejects.toThrow(refusal(kind));
      await expect(take(s, a, 1, '2025-04-01')).rejects.toThrow(refusal(kind));
      expect(JSON.stringify(s.securities)).toBe(before);
      // With room left under October's vesting, April may take exactly that much.
      const t = makeStore();
      const b = await award(t, kind);
      await take(t, b, 60, '2025-10-01');
      await expect(take(t, b, 16, '2025-04-01')).rejects.toThrow(refusal(kind));
      await take(t, b, 15, '2025-04-01');
      expect(counter(t, b)).toBe(75);
      expect(exerciseAheadOfVesting(t.security(b.id), t.securities)).toBeNull();
    });
  }

  it('holds an exercise recorded without a certificate against every date', async () => {
    // Undated on the record, so nothing says January's 50 came after April.
    const s = makeStore();
    const a = await award(s, 'option');
    await s.exerciseOption(a.id, { quantity: 50, date: '2026-01-01', classId: null });
    await expect(s.exerciseOption(a.id, { quantity: 25, date: '2025-04-01', classId: 'c1' }))
      .rejects.toThrow(/Only vested options/);
  });

  it('certifies an earlier exercise once a later one is on file', async () => {
    /* April's 25 were recorded on the counter alone and January's 50 with
       its certificate. Papering April's afterwards measured them against
       April's vesting net of the whole counter - January's 50 included - and
       refused a certificate for options that were vested when they were
       bought. */
    const s = makeStore();
    const a = await award(s, 'option');
    await s.exerciseOption(a.id, { quantity: 25, date: '2025-04-01', classId: null });
    await s.exerciseOption(a.id, { quantity: 50, date: '2026-01-01', classId: 'c1' });
    expect(s.uncertifiedExercises(s.security(a.id))).toBe(25);
    const cert = await s.certifyExercise(a.id, { quantity: 25, date: '2025-04-01', classId: 'c1' });
    expect(cert).toMatchObject({ quantity: 25, date: '2025-04-01' });
    expect(hasVesting(cert)).toBe(false);
    expect(s.uncertifiedExercises(s.security(a.id))).toBe(0);
    expect(exerciseAheadOfVesting(s.security(a.id), s.securities)).toBeNull();
  });

  it('still refuses an exercise past what had vested on its own date', async () => {
    const s = makeStore();
    const a = await award(s, 'option');
    await expect(s.exerciseOption(a.id, { quantity: 26, date: '2025-04-01', classId: 'c1' }))
      .rejects.toThrow(/Only vested options/);
    await s.exerciseOption(a.id, { quantity: 25, date: '2025-04-01', classId: 'c1' });
    await expect(s.exerciseOption(a.id, { quantity: 51, date: '2025-10-01', classId: 'c1' }))
      .rejects.toThrow(/Only vested options/);
    await s.exerciseOption(a.id, { quantity: 50, date: '2025-10-01', classId: 'c1' });
    expect(s.security(a.id).exercised).toBe(75);
  });
});
