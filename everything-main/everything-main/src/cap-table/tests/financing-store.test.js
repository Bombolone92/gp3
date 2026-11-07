import { beforeEach, describe, expect, it } from 'vitest';
import { Store, ListFullError, MAX_SECURITIES, SCENARIOS_MAX } from '../src/lib/store.js';
import { modelRound, exitWaterfall, fullyDiluted, topUpReserve } from '../src/lib/captable.js';
import { capTableDigest, dividendAccrual, electMFN } from '../src/lib/financing.js';
import { puterBackend } from './helpers/puter-kv.js';

let store, common, founder, investor, cert, right, inputs;
beforeEach(async () => {
  puterBackend().install(); store = new Store(); await store.init();
  common = await store.addClass({ name: 'Common', kind: 'common' });
  founder = await store.addStakeholder({ name: 'Founder' }); investor = await store.addStakeholder({ name: 'Investor' });
  await store.addSecurity({ kind: 'shares', classId: common.id, stakeholderId: founder.id, quantity: 900000, pricePerShare: 0.01, date: '2024-01-01' });
  right = { id: 'right1', agreement: 'Side letter', start: '2024-01-01', basis: 'fixed', fraction: .1, financings: ['A'] };
  cert = await store.addSecurity({ kind: 'shares', classId: common.id, stakeholderId: investor.id, quantity: 100000, pricePerShare: 1, date: '2024-01-01', proRata: [right] });
  inputs = { preMoney: 8000000, investment: 2000000, asOf: '2025-01-01', financing: { id: 'A', roundMode: 'fixed', elections: [{ rightId: 'right1', amount: 200000 }], mfnElections: [] } };
});
/* What the close sheet hands the store for this model, fingerprinting the table as it stands now. */
function closing(result) {
  return { date: inputs.asOf, newClass: { name: 'Series A', kind: 'preferred', liquidationMultiple: 1 },
    modeling: { id: 'A', basisDigest: capTableDigest(store.db), inputs: result.modelInputs },
    investors: [
      { stakeholderId: investor.id, amount: 200000, quantity: 25000, pricePerShare: 8, rightIds: ['right1'] },
      { newHolder: { name: 'Lead' }, amount: 1800000, quantity: 225000, pricePerShare: 8 },
    ] };
}
const dividends = { rate: .08, start: '2024-01-01', cumulative: true, convention: 'simple', dayCount: 'actual/365', atConversion: 'forfeit', atLiquidation: 'add' };
const amendment = { id: 'a1', date: '2024-01-01', agreement: 'Charter', dividends };

describe('scenario and close integrity', () => {
  it('persists dated assumptions with the table fingerprint, which a later edit invalidates and a save refreshes', async () => {
    const saved = await store.saveScenario({ name: 'A', ...inputs });
    expect(saved.asOf).toBe(inputs.asOf); expect(saved.financing).toEqual(inputs.financing);
    expect(saved.basisDigest).toBe(capTableDigest(store.db));
    await store.updateSecurity(cert.id, { quantity: 110000 });
    expect(saved.basisDigest).not.toBe(capTableDigest(store.db));
    const fresh = new Store(); await fresh.init();
    expect(fresh.scenarios[0].basisDigest).toBe(saved.basisDigest);
    expect(fresh.scenarios[0].financing).toEqual(inputs.financing);
    const refreshed = await store.saveScenario({ ...saved });
    expect(refreshed.id).toBe(saved.id);
    expect(refreshed.basisDigest).toBe(capTableDigest(store.db));
    expect(store.scenarios).toHaveLength(1);
  });
  it('closes exactly the elected allocation, retains evidence and refuses repeated closing', async () => {
    const out = modelRound(store.db, inputs); const close = closing(out);
    const issued = await store.closeRound(close);
    expect(issued.certificates).toHaveLength(2);
    expect(issued.certificates.reduce((a, s) => a + s.cashInvested, 0)).toBe(2000000);
    expect(issued.certificates.every((s) => s.roundId === 'A')).toBe(true);
    expect(issued.certificates[0].financingEvidence).toMatchObject({ rightIds: ['right1'], asOf: '2025-01-01', investment: 2000000, roundMode: 'fixed' });
    expect(issued.certificates[1].financingEvidence.rightIds).toEqual([]);
    expect(fullyDiluted(store.securities, store.company)).toBe(out.postFD);
    await expect(store.closeRound(close)).rejects.toThrow(/already been closed/);
    expect(store.securities.filter((s) => s.roundId === 'A')).toHaveLength(2);
    const journal = await store.auditPage({ operation: 'closeRound' });
    expect(journal.entries.length).toBeGreaterThan(0);
  });
  it('records financing evidence on anti-dilution certificates as well as new money', async () => {
    const seed = await store.addClass({ name: 'Seed', kind: 'preferred', pricePerShare: 20, antiDilution: 'broad' });
    await store.addSecurity({ kind: 'shares', classId: seed.id, stakeholderId: investor.id,
      quantity: 10000, pricePerShare: 20, date: '2024-01-01' });
    const result = modelRound(store.db, inputs);
    expect(result.antiDilutionShares).toBeGreaterThan(0);
    const close = closing(result);
    close.investors = close.investors.map((i) => ({ ...i, quantity: Math.round(i.amount / result.pps), pricePerShare: result.pps }));
    close.adjustments = result.antiDilution.map((a) => ({ classId: a.classId, conversionPrice: a.conversionPriceAfter, holders: a.holders }));
    const { certificates } = await store.closeRound(close);
    const adjustment = certificates.find((s) => s.antiDilution);
    expect(adjustment).toBeDefined();
    expect(adjustment.roundId).toBe('A');
    expect(adjustment.cashInvested).toBe(0);
    expect(adjustment.financingEvidence).toMatchObject({ asOf: inputs.asOf, preMoney: inputs.preMoney, investment: inputs.investment });
    await store.transferShares(adjustment.id, { date: '2025-02-01', quantity: adjustment.quantity, to: { stakeholderId: founder.id } });
    const successor = store.securities.find((s) => s.fromTransferId === adjustment.id);
    expect(successor.roundId).toBe('A');
    expect(successor.financingEvidence).toEqual(adjustment.financingEvidence);
  });
  it('rejects stale basis, altered/omitted confirmed checks and a moved date without partial writes', async () => {
    const result = modelRound(store.db, inputs); const close = closing(result); const count = store.securities.length;
    const without = (patch) => ({ ...close, investors: close.investors.map((i, n) => (n === 0 ? { ...i, ...patch } : i)) });
    await expect(store.closeRound(without({ rightIds: [] }))).rejects.toThrow(/pro-rata allocation/);
    const moved = { ...close, investors: [{ ...close.investors[0], amount: 200001 }, { ...close.investors[1], amount: 1799999 }] };
    await expect(store.closeRound(moved)).rejects.toThrow(/pro-rata allocation/);
    await expect(store.closeRound(without({ quantity: 25001 }))).rejects.toThrow(/do not reconcile/);
    await expect(store.closeRound({ ...close, date: '2025-01-02' })).rejects.toThrow(/different date/);
    await expect(store.closeRound({ ...close, conversions: [{ securityId: 'x', quantity: 1, pricePerShare: 8 }] })).rejects.toThrow(/Conversion allocations/);
    expect(store.securities.length).toBe(count);
    await store.updateSecurity(cert.id, { quantity: 110000 });
    await expect(store.closeRound(close)).rejects.toThrow(/changed/);
    expect(store.classes.some((c) => c.name === 'Series A')).toBe(false);
  });
  it('holds a close to the company-wide record ceiling like every other issuing path', async () => {
    const backup = store.exportAll();
    const filler = Array.from({ length: MAX_SECURITIES - backup.securities.length - 1 }, (_, i) => ({
      id: `o${i}`, label: `OPT-${i}`, kind: 'option', stakeholderId: founder.id, quantity: 1, strike: 1, date: '2024-01-01',
    }));
    await store.importAll({ ...backup, securities: [...backup.securities, ...filler] }, { label: 'x' });
    expect(store.securities).toHaveLength(MAX_SECURITIES - 1);
    // Room for one certificate: two investors would take the company past what it keeps.
    const investor1 = { stakeholderId: investor.id, amount: 1000, quantity: 100, pricePerShare: 10 };
    const before = structuredClone(store.db);
    await expect(store.closeRound({ classId: common.id, date: '2025-01-01', investors: [investor1, { ...investor1, stakeholderId: founder.id }] }))
      .rejects.toThrow(ListFullError);
    expect(store.db).toEqual(before);
    expect(store.restorePoints.some((p) => p.label === 'Before closing a round')).toBe(false);
    await store.closeRound({ classId: common.id, date: '2025-01-01', investors: [investor1] });
    expect(store.securities).toHaveLength(MAX_SECURITIES);
  });
  it('keeps saved scenarios under a ceiling, at the import and on the strip', async () => {
    const backup = store.exportAll();
    const many = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `Round ${i}`, preMoney: 1_000_000 + i, investment: 100_000 }));
    await expect(store.importAll({ ...backup, scenarios: many(SCENARIOS_MAX + 1) })).rejects.toThrow(/201 saved scenarios, more than the 200/);
    await expect(store.importAll({ ...backup, exits: many(SCENARIOS_MAX + 1).map((s) => ({ ...s, exitValue: 1 })) })).rejects.toThrow(/201 saved exits/);
    expect(store.scenarios).toHaveLength(0);
    await store.importAll({ ...backup, scenarios: many(SCENARIOS_MAX) }, { label: 'x' });
    expect(store.scenarios).toHaveLength(SCENARIOS_MAX);
    await expect(store.saveScenario({ name: 'One more', ...inputs })).rejects.toThrow(ListFullError);
    // Revising one on the strip is not an addition.
    const revised = await store.saveScenario({ id: 's0', name: 'Round 0 revised', ...inputs });
    expect(revised.name).toBe('Round 0 revised');
    expect(store.scenarios).toHaveLength(SCENARIOS_MAX);
  });
  it('takes no restore point for a close its checks refuse', async () => {
    /* The checks used to run inside the commit, after the snapshot: every
       refused close captured a point and rolled it back in a second write,
       and when that write failed the point stayed while the oldest real one
       was gone. Refused up front, nothing touches the list at all. */
    const close = closing(modelRound(store.db, inputs));
    close.modeling.basisDigest = 'stale';
    const kv = globalThis.puter.kv;
    const touched = [];
    for (const method of ['set', 'add']) {
      const original = kv[method];
      kv[method] = async (key, value) => { touched.push(key); return original(key, value); };
    }
    await expect(store.closeRound(close)).rejects.toThrow(/changed/);
    expect(touched.filter((key) => key.includes('restorePoints'))).toEqual([]);
    expect(store.restorePoints).toHaveLength(0);
  });
  it('refuses a close stamped with a different financing ID than its elections', async () => {
    const close = closing(modelRound(store.db, inputs));
    close.modeling.id = 'B';
    const before = structuredClone(store.db);
    await expect(store.closeRound(close)).rejects.toThrow(/financing ID/);
    expect(store.db).toEqual(before);
  });
  it('cannot count one confirmed check toward two participation elections', async () => {
    await store.updateSecurity(cert.id, { proRata: [right, { ...right, id: 'right2' }] });
    inputs.financing.elections.push({ rightId: 'right2', amount: 200000 });
    const result = modelRound(store.db, inputs);
    expect(result.financing.allocations.reduce((total, a) => total + a.elected, 0)).toBe(400000);
    const close = closing(result);
    close.investors[0].rightIds = ['right1', 'right2'];
    const before = structuredClone(store.db);
    await expect(store.closeRound(close)).rejects.toThrow(/pro-rata allocation/);
    expect(store.db).toEqual(before);
    close.investors = [
      { ...close.investors[0], rightIds: ['right1'] },
      { ...close.investors[0], rightIds: ['right2'] },
      { ...close.investors[1], amount: 1600000, quantity: 200000 },
    ];
    const { certificates } = await store.closeRound(close);
    expect(certificates.filter((s) => s.stakeholderId === investor.id).reduce((total, s) => total + s.cashInvested, 0)).toBe(400000);
    expect(fullyDiluted(store.securities, store.company)).toBe(result.postFD);
  });
  it('holds the checks to the model within the sheet’s dollar tolerance, not to the cent', async () => {
    const result = modelRound(store.db, inputs); const close = closing(result);
    const shifted = (cents) => ({ ...close, investors: close.investors.map((i, n) => (n === 1 ? { ...i, amount: i.amount + cents } : i)) });
    await expect(store.closeRound(shifted(0.6))).rejects.toThrow(/do not reconcile/);
    const issued = await store.closeRound(shifted(0.3));
    expect(issued.certificates[1].cashInvested).toBeCloseTo(1800000.3);
  });
  it('cannot redirect an elected check to a new holder', async () => {
    const close = closing(modelRound(store.db, inputs));
    close.investors[0].newHolder = { name: 'Different investor' };
    const before = structuredClone(store.db);
    await expect(store.closeRound(close)).rejects.toThrow(/pro-rata allocation/);
    expect(store.db).toEqual(before);
  });
  it('holds elected share counts to the model even within the cash tolerance', async () => {
    inputs.preMoney = 100000;
    const result = modelRound(store.db, inputs);
    const close = closing(result);
    close.investors = close.investors.map((i) => {
      const amount = i.amount + (i.rightIds ? 0.1 : -0.1);
      return { ...i, amount, pricePerShare: result.pps, quantity: Math.round(amount / result.pps) };
    });
    expect(close.investors[0].quantity).not.toBe(result.financing.allocations[0].shares);
    const before = structuredClone(store.db);
    await expect(store.closeRound(close)).rejects.toThrow(/pro-rata allocation/);
    expect(store.db).toEqual(before);
  });
  it('refuses a historical close that would convert an instrument already converted later', async () => {
    const safe = await store.addSecurity({ kind: 'safe', stakeholderId: investor.id, principal: 100000,
      valuationCap: 5000000, date: '2024-01-01' });
    await store.closeRound({ classId: common.id, date: '2025-06-01',
      conversions: [{ securityId: safe.id, quantity: 20000, pricePerShare: 5 }] });
    const result = modelRound(store.db, inputs);
    const close = closing(result);
    close.investors = close.investors.map((i) => ({ ...i, quantity: Math.round(i.amount / result.pps), pricePerShare: result.pps }));
    close.conversions = result.conversions.map((c) => ({ securityId: c.securityId, quantity: c.shares, pricePerShare: c.price }));
    expect(close.conversions.some((c) => c.securityId === safe.id)).toBe(true);
    const before = structuredClone(store.db);
    await expect(store.closeRound(close)).rejects.toThrow(/already converted/);
    expect(store.db).toEqual(before);
  });
  it('refuses a close dated before a recorded anti-dilution adjustment, whose lowered price the snapshot cannot rewind', async () => {
    const seed = await store.addClass({ name: 'Seed', kind: 'preferred', pricePerShare: 1, antiDilution: 'broad' });
    await store.addSecurity({ kind: 'shares', classId: seed.id, stakeholderId: investor.id, quantity: 2_000_000, pricePerShare: 1, date: '2024-01-01' });
    // Round B, a down round closed on Sept 1: Seed's conversion price falls and shares are minted.
    inputs.asOf = '2026-09-01'; inputs.preMoney = 1_500_000; inputs.financing.id = 'B'; inputs.financing.elections = [];
    const b = modelRound(store.db, inputs);
    expect(b.antiDilution).toHaveLength(1);
    await store.closeRound({ date: inputs.asOf, newClass: { name: 'Series B', kind: 'preferred', liquidationMultiple: 1 },
      modeling: { id: 'B', basisDigest: capTableDigest(store.db), inputs: b.modelInputs },
      investors: [{ newHolder: { name: 'Lead' }, amount: 2_000_000, quantity: Math.round(2_000_000 / b.pps), pricePerShare: b.pps }],
      adjustments: b.antiDilution.map((a) => ({ classId: a.classId, conversionPrice: a.conversionPriceAfter, holders: a.holders })) });
    const lowered = store.shareClass(seed.id).conversionPrice;
    expect(lowered).toBeLessThan(1);
    /* Round A, dated March: the snapshot has none of B's shares, yet Seed reads
       B's lowered price - the model measures protection from a price that was
       not in force that day. Refused, like a close before a recorded split. */
    inputs.asOf = '2026-03-01'; inputs.preMoney = 1_200_000; inputs.financing.id = 'A';
    const a = modelRound(store.db, inputs);
    expect(a.antiDilution[0]?.conversionPriceBefore).toBe(lowered);
    const before = structuredClone(store.db);
    await expect(store.closeRound({ date: inputs.asOf, newClass: { name: 'Series A', kind: 'preferred', liquidationMultiple: 1 },
      modeling: { id: 'A', basisDigest: capTableDigest(store.db), inputs: a.modelInputs },
      investors: [{ newHolder: { name: 'Lead 2' }, amount: 2_000_000, quantity: Math.round(2_000_000 / a.pps), pricePerShare: a.pps }],
      adjustments: a.antiDilution.map((x) => ({ classId: x.classId, conversionPrice: x.conversionPriceAfter, holders: x.holders })) }))
      .rejects.toThrow(/before the anti-dilution adjustment of 2026-09-01/);
    expect(store.db).toEqual(before);
    // On or after B's day the table is whole again, and the close goes through.
    inputs.asOf = '2026-09-01';
    const later = modelRound(store.db, inputs);
    await store.closeRound({ date: inputs.asOf, newClass: { name: 'Series A', kind: 'preferred', liquidationMultiple: 1 },
      modeling: { id: 'A', basisDigest: capTableDigest(store.db), inputs: later.modelInputs },
      investors: [{ newHolder: { name: 'Lead 2' }, amount: 2_000_000, quantity: Math.round(2_000_000 / later.pps), pricePerShare: later.pps }],
      adjustments: later.antiDilution.map((x) => ({ classId: x.classId, conversionPrice: x.conversionPriceAfter, holders: x.holders })) });
    expect(store.securities.filter((s) => s.roundId === 'A').length).toBeGreaterThan(0);
  });
  it('refuses a pool top-up into a plan that expired before the closing date', async () => {
    const expired = await store.addPlan({ name: '2020 Plan', adopted: '2020-01-01', expires: '2025-12-31', classId: common.id, reserve: 50_000 });
    inputs.poolPct = 0.1; inputs.asOf = '2026-03-01'; inputs.financing.elections = [];
    const result = modelRound(store.db, inputs);
    expect(result.poolAdd).toBeGreaterThan(0);
    const payload = () => ({ date: inputs.asOf, newClass: { name: 'Series A', kind: 'preferred', liquidationMultiple: 1 },
      modeling: { id: 'A', basisDigest: capTableDigest(store.db), inputs: result.modelInputs },
      investors: [{ newHolder: { name: 'Lead' }, amount: 2_000_000, quantity: Math.round(2_000_000 / result.pps), pricePerShare: result.pps }] });
    const before = structuredClone(store.db);
    await expect(store.closeRound({ ...payload(), topUp: { planId: expired.id, reserve: topUpReserve(store.db, expired.id, result.poolAfter) } }))
      .rejects.toThrow(/2020 Plan expired on 2025-12-31, so the round can’t top it up on 2026-03-01/);
    expect(store.db).toEqual(before);
    // A plan still open on the day takes it.
    const open = await store.addPlan({ name: '2026 Plan', adopted: '2026-01-01', classId: common.id, reserve: 0 });
    const again = modelRound(store.db, inputs);
    await store.closeRound({ ...payload(), modeling: { id: 'A', basisDigest: capTableDigest(store.db), inputs: again.modelInputs },
      investors: [{ newHolder: { name: 'Lead' }, amount: 2_000_000, quantity: Math.round(2_000_000 / again.pps), pricePerShare: again.pps }],
      topUp: { planId: open.id, reserve: topUpReserve(store.db, open.id, again.poolAfter) } });
    expect(store.plan(open.id).reserve).toBe(again.poolAdd);
    expect(store.plan(expired.id).reserve).toBe(50_000);
  });
  it('refuses to write historical share units across a later recorded stock split', async () => {
    await store.recordSplit({ num: 2, den: 1, date: '2025-06-01' });
    const result = modelRound(store.db, inputs);
    expect(result.pps).toBe(8);
    expect(result.postFD).toBe(1250000);
    const before = structuredClone(store.db);
    await expect(store.closeRound(closing(result))).rejects.toThrow(/stock split/);
    expect(store.db).toEqual(before);
    inputs.asOf = '2025-06-01';
    const afterSplit = modelRound(store.db, inputs);
    const close = closing(afterSplit);
    close.investors = close.investors.map((i) => ({ ...i, quantity: Math.round(i.amount / afterSplit.pps), pricePerShare: afterSplit.pps }));
    await store.closeRound(close);
    expect(fullyDiluted(store.securities, store.company)).toBe(afterSplit.postFD);
  });
  it('refuses a right or election ID already recorded on another instrument, wherever it arrives', async () => {
    const row = (name, id) => ({ kind: 'shares', stakeholderName: name, className: 'Common', quantity: 10, pricePerShare: 1, date: '2024-02-01', proRata: [{ ...right, id }] });
    await expect(store.addSecurity({ kind: 'shares', classId: common.id, stakeholderId: founder.id, quantity: 10, pricePerShare: 1, date: '2024-02-01', proRata: [right] }))
      .rejects.toThrow(/already recorded/);
    await expect(store.importRecords({ securities: [row('Founder', 'shared'), row('Investor', 'shared')] })).rejects.toThrow(/already recorded/);
    const other = await store.addSecurity({ kind: 'shares', classId: common.id, stakeholderId: founder.id, quantity: 10, pricePerShare: 1, date: '2024-02-01' });
    await expect(store.updateSecurity(other.id, { proRata: [right] })).rejects.toThrow(/already recorded/);
    expect(store.securities.filter((s) => s.proRata)).toHaveLength(1);
    expect(store.security(other.id).proRata).toBeUndefined();
    const backup = store.exportAll();
    const mfn = { agreement: 'MFN', start: '2024-01-01', scope: ['valuationCap'], eligibleKinds: ['safe'],
      elections: [{ id: 'shared', sourceId: 'source', sourceDate: '2024-06-01', date: '2024-07-01', agreement: 'Notice', financings: ['*'], terms: { valuationCap: 1 } }] };
    backup.securities = [...backup.securities, ...['s1', 's2'].map((id) => ({ id, label: id, kind: 'safe', stakeholderId: investor.id, principal: 1000, valuationCap: 8000000, date: '2024-01-01', mfn }))];
    await expect(store.importAll(backup)).rejects.toThrow(/already recorded/);
    expect(modelRound(store.db, inputs).unsupported).toBeUndefined();
  });
  it('refuses a CSV row that carries MFN elections, as the security sheet does', async () => {
    const mfn = { agreement: 'MFN', start: '2024-01-01', scope: ['valuationCap'], eligibleKinds: ['safe'],
      elections: [{ id: 'e1', sourceId: 'source', sourceDate: '2024-06-01', date: '2024-07-01', agreement: 'Notice', financings: ['*'], terms: { valuationCap: 1 } }] };
    const before = structuredClone(store.db);
    await expect(store.importRecords({ securities: [{ kind: 'safe', stakeholderName: 'Investor', principal: 100000, valuationCap: 8000000, date: '2024-01-01', mfn }] }))
      .rejects.toThrow(/original instrument first/);
    expect(store.db).toEqual(before);
    await store.importRecords({ securities: [{ kind: 'safe', stakeholderName: 'Investor', principal: 100000, valuationCap: 8000000, date: '2024-01-01', mfn: { ...mfn, elections: [] } }] });
    expect(store.securities.find((s) => s.mfn).mfn.elections).toEqual([]);
  });
  it('refuses financing evidence a file nests too deeply or makes too large, as a refusal', async () => {
    const backup = store.exportAll();
    const nested = (n) => { let v = { leaf: true }; for (let i = 0; i < n; i++) v = { inner: v }; return v; };
    const withEvidence = (financingEvidence) => ({ ...backup, securities: [...backup.securities,
      { id: 'ev', label: 'CS-9', kind: 'shares', classId: common.id, stakeholderId: founder.id, quantity: 10, pricePerShare: 1, date: '2024-02-01', roundId: 'A', financingEvidence }] });
    const before = structuredClone(store.db);
    await expect(store.importAll(withEvidence(nested(60)))).rejects.toThrow(/nests too deeply/);
    await expect(store.importAll(withEvidence({ note: 'x'.repeat(60_000) }))).rejects.toThrow(/too large/);
    expect(store.db).toEqual(before);
    // What the app itself writes - a few fields a few levels deep - is kept as it is.
    await store.importAll(withEvidence({ asOf: '2024-02-01', appliedMFN: [{ terms: { valuationCap: 1 }, originalTerms: { valuationCap: 2 } }] }), { label: 'x' });
    expect(store.security('ev').financingEvidence.appliedMFN[0].terms.valuationCap).toBe(1);
  });
  it('rejects invalid JSON imports without overwriting the dataset', async () => {
    const backup = store.exportAll(); const invalid = structuredClone(backup);
    invalid.securities.find((s) => s.id === cert.id).proRata[0].basis = 'arbitrary legal clause';
    await expect(store.importAll(invalid)).rejects.toThrow(/unsupported/);
    expect(store.security(cert.id).proRata).toEqual([right]);
    const restored = new Store(); await restored.init();
    expect(restored.security(cert.id).proRata).toEqual([right]);
  });
  it.each([
    ['option', 0, 'common'], ['rsu', 0, 'common'], ['warrant', 0, 'common'],
    ['rsu', 100, 'missing'], ['warrant', 100, 'missing'],
  ])('refuses imports that would discard a %s with recorded rights (%s, %s)', async (kind, quantity, className) => {
    const backup = store.exportAll();
    backup.securities = [...backup.securities, { id: 'bad-award', label: 'Invalid award', kind, quantity,
      classId: className === 'common' ? common.id : 'missing', stakeholderId: investor.id, date: '2024-01-01',
      proRata: [{ ...right, id: 'award-right' }] }];
    const before = structuredClone(store.db);
    await expect(store.importAll(backup)).rejects.toThrow(/financing terms/);
    expect(store.db).toEqual(before);
    const fresh = new Store(); await fresh.init();
    expect(fresh.db).toEqual(before);
  });
  it('refuses an import that would discard amendments on an unnamed class', async () => {
    const backup = store.exportAll();
    backup.classes = [...backup.classes, { id: 'unnamed', name: '', kind: 'preferred', preferredTerms: [amendment] }];
    const before = structuredClone(store.db);
    await expect(store.importAll(backup)).rejects.toThrow(/financing terms/);
    expect(store.db).toEqual(before);
  });
});

describe('permanent amendments, elections and economic basis', () => {
  it('records preferred amendments and dividend events in audit history; later edits preserve past calculations', async () => {
    const pref = await store.addClass({ name: 'Preferred', kind: 'preferred', liquidationMultiple: 1, participating: true, preferredTerms: [amendment] });
    const s = await store.addSecurity({ kind: 'shares', classId: pref.id, stakeholderId: investor.id, quantity: 100, pricePerShare: 10000, date: '2024-01-01' });
    const original = dividendAccrual(s, pref, '2024-12-31');
    await store.updateClass(pref.id, { preferredTerms: [amendment, { ...amendment, id: 'a2', date: '2025-01-01', dividends: { ...dividends, rate: .2 } }] });
    expect(dividendAccrual(store.security(s.id), store.shareClass(pref.id), '2024-12-31')).toEqual(original);
    await expect(store.updateClass(pref.id, { preferredTerms: [{ ...amendment, dividends: { ...dividends, rate: .9 } }] })).rejects.toThrow(/permanent/);
    const event = { id: 'paid', date: '2024-12-31', amount: 30000, type: 'payment', evidence: 'Receipt' };
    await store.updateSecurity(s.id, { dividendEvents: [event] });
    expect(dividendAccrual(store.security(s.id), store.shareClass(pref.id), '2024-12-31').balance).toBeCloseTo(50000);
    await expect(store.updateSecurity(s.id, { dividendEvents: [] })).rejects.toThrow(/permanent/);
    expect((await store.auditPage({ operation: 'updateClass' })).entries.length).toBeGreaterThan(0);
    await store.transferShares(s.id, { date: '2025-01-01', quantity: 30, to: { stakeholderId: founder.id } });
    const successors = store.securities.filter((c) => c.fromTransferId === s.id);
    expect(successors).toHaveLength(2);
    expect(successors.reduce((a, c) => a + c.economicBasis.principal, 0)).toBe(1000000);
    expect(successors.reduce((a, c) => a + dividendAccrual(c, store.shareClass(pref.id), '2024-12-31').balance, 0)).toBeCloseTo(50000);
  });
  it('refuses an amendment that would leave a recorded dividend payment exceeding the balance', async () => {
    const pref = await store.addClass({ name: 'Preferred', kind: 'preferred', liquidationMultiple: 1, participating: true, preferredTerms: [amendment] });
    const s = await store.addSecurity({ kind: 'shares', classId: pref.id, stakeholderId: investor.id, quantity: 100, pricePerShare: 10000, date: '2024-01-01' });
    await store.updateSecurity(s.id, { dividendEvents: [{ id: 'paid', date: '2024-12-31', amount: 30000, type: 'payment', evidence: 'Receipt' }] });
    // Dropping the dividend terms from February leaves December's payment over a balance that stopped accruing.
    await expect(store.updateClass(pref.id, { preferredTerms: [amendment, { id: 'a2', date: '2024-02-01', agreement: 'Amendment' }] }))
      .rejects.toThrow(/exceeds the balance.*Date the amendment after/s);
    expect(store.shareClass(pref.id).preferredTerms).toHaveLength(1);
    expect(exitWaterfall(store.db, { exitValue: 5_000_000, asOf: '2025-06-01' }).unsupported).toBeFalsy();
    // Dated after the payment, the same amendment stands.
    await store.updateClass(pref.id, { preferredTerms: [amendment, { id: 'a2', date: '2025-01-01', agreement: 'Amendment' }] });
    expect(store.shareClass(pref.id).preferredTerms).toHaveLength(2);
  });
  it('dates a basis derived after a transfer at the original purchase, whichever was recorded first', async () => {
    const pref = await store.addClass({ name: 'Preferred', kind: 'preferred', liquidationMultiple: 1, participating: true });
    const s = await store.addSecurity({ kind: 'shares', classId: pref.id, stakeholderId: investor.id, quantity: 100, pricePerShare: 10000, date: '2024-01-01' });
    await store.transferShares(s.id, { date: '2024-07-01', quantity: 30, to: { stakeholderId: founder.id } });
    await store.updateClass(pref.id, { preferredTerms: [amendment] });
    const successors = store.securities.filter((c) => c.fromTransferId === s.id);
    expect(successors.map((c) => c.economicBasis)).toEqual([{ principal: 300000, date: '2024-01-01' }, { principal: 700000, date: '2024-01-01' }]);
    const accrued = successors.reduce((a, c) => a + dividendAccrual(c, store.shareClass(pref.id), '2025-01-01').balance, 0);
    expect(accrued).toBeCloseTo(1000000 * .08 * 366 / 365);
    // A backup written without the bases derives the same dates on load.
    const stripped = store.securities.map(({ economicBasis, ...c }) => c);
    expect(Store.sanitizeSecurities(stripped, store).filter((c) => c.fromTransferId === s.id).map((c) => c.economicBasis.date)).toEqual(['2024-01-01', '2024-01-01']);
  });
  it('validates MFN source evidence and preserves original terms when closing an election', async () => {
    const mfn = { agreement: 'MFN letter', start: '2024-01-01', scope: ['valuationCap'], eligibleKinds: ['safe'], elections: [] };
    const s = await store.addSecurity({ kind: 'safe', stakeholderId: investor.id, principal: 100000, valuationCap: 8000000, date: '2024-01-01', mfn });
    const source = await store.addSecurity({ kind: 'safe', stakeholderId: investor.id, principal: 10000, valuationCap: 5000000, date: '2024-06-01' });
    const e = electMFN(store.db, s, { id: 'e1', sourceId: source.id, date: '2024-07-01', agreement: 'Election notice', financings: ['A'] });
    await expect(store.updateSecurity(s.id, { mfn: { ...mfn, elections: [{ ...e, terms: { valuationCap: 1 } }] } })).rejects.toThrow(/match/);
    await store.updateSecurity(s.id, { mfn: { ...mfn, elections: [e] } });
    await expect(store.updateSecurity(s.id, { mfn })).rejects.toThrow(/permanent/);
    inputs.financing.mfnElections = ['e1'];
    const result = modelRound(store.db, inputs);
    const close = closing(result);
    close.investors = close.investors.map((i) => ({ ...i, quantity: Math.round(i.amount / result.pps), pricePerShare: result.pps }));
    close.conversions = result.conversions.map((c) => ({ securityId: c.securityId, quantity: c.shares, pricePerShare: c.price }));
    await store.closeRound(close);
    expect(store.security(s.id).valuationCap).toBe(8000000);
    const certificate = store.security(store.security(s.id).convertedToId);
    expect(certificate.financingEvidence.appliedMFN[0].terms.valuationCap).toBe(5000000);
  });
});
