import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/kv.js', async (importOriginal) =>
  (await import('./helpers/conditional-kv.js')).conditionalKVMock(importOriginal));
import { Store, isRefusal } from '../src/lib/store.js';
import {
  plansOf, planBalances, planLedger, reserveAsOf, poolAsOf, fullyDiluted, poolRemaining, dbAsOf,
  ownershipByStakeholder, ownershipByClass, resolvePlan, awardPlanId, planAccepts, topUpReserve,
  LEGACY_PLAN_ID, DEFAULT_RECYCLING, modelRound, poolDrawn, attentionItems,
} from '../src/lib/captable.js';
import { buildSecurityPlan, SECURITY_FIELDS, autoMatch, SECURITY_TEMPLATE } from '../src/lib/csvimport.js';
import { sampleDataset } from '../src/lib/sample.js';

/** A live Store against an in-memory Puter KV stub - see store.test.js. */
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
    { id: 'h2', name: 'Grace', kind: 'employee' },
    { id: 'h3', name: 'Sam', kind: 'employee' },
  ]);
  s.classes = Store.sanitizeClasses([{ id: 'c1', name: 'Common Stock', kind: 'common' }]);
  s.securities = Store.sanitizeSecurities([
    { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 1000, date: '2023-01-01' },
  ], { classes: s.classes, stakeholders: s.stakeholders });
  return s;
}

/** Two overlapping plans: a 2024 plan with a 2026 successor. */
async function twoPlans() {
  const s = makeStore();
  const old = await s.addPlan({ name: '2024 Equity Incentive Plan', adopted: '2024-01-01', classId: 'c1', reserve: 100_000 });
  const next = await s.addPlan({ name: '2026 Equity Incentive Plan', adopted: '2026-01-01', classId: 'c1', reserve: 50_000 });
  return { s, old, next };
}

/**
 * Every plan's opening balance plus its movements is its closing balance,
 * and the plans add up to the aggregate the cap table reads. The ledger is
 * written over the live records; a snapshot of a past date is held to the
 * aggregate alone.
 */
function expectReconciled(db, { ledger = true } = {}) {
  for (const plan of ledger ? plansOf(db.company) : []) {
    const ledger = planLedger(db, plan.id);
    expect(ledger.reconciles).toBe(true);
    const sum = ledger.rows.reduce((a, r) => ({ authorized: a.authorized + r.authorized, committed: a.committed + r.committed }),
      { authorized: 0, committed: 0 });
    expect(sum.authorized).toBe(ledger.closing.authorized);
    expect(sum.committed).toBe(ledger.closing.committed);
    expect(ledger.closing.available).toBe(ledger.closing.authorized - ledger.closing.committed);
  }
  // And the plans add up to the company aggregate the cap table reads.
  const balances = planBalances(db);
  expect(balances.total.reserve).toBe(db.company.poolAuthorized);
  expect(poolRemaining(db.company, db.securities)).toBe(balances.total.unallocated);
}

describe('plans: the one pool a company had reads as one plan', () => {
  it.each([
    { poolAuthorized: 1000 },
    { poolAuthorized: 2000, poolHistory: [{ date: '2024-01-01', before: 0, after: 1000, seq: 1 }],
      splits: [{ id: 'split', date: '2025-01-01', num: 2, den: 1, seq: 2 }] },
    { poolAuthorized: 334, poolHistory: [{ date: '2024-01-01', before: 0, after: 1001, seq: 1 }],
      splits: [{ id: 'split', date: '2025-01-01', num: 1, den: 3, poolBefore: 1001, poolAfter: 334, seq: 2 }] },
  ])('reconciles a migrated reserve ledger without per-plan history for every change: %j', (raw) => {
    const s = makeStore();
    s.company = Store.sanitizeCompany(raw);
    expectReconciled(s.db);
  });

  it('reads a legacy company record as a single plan with the pool’s history', () => {
    const company = { name: 'Legacy', poolAuthorized: 1000, poolHistory: [{ date: '2024-06-10', before: 0, after: 1000, seq: 1 }] };
    const [plan] = plansOf(company);
    expect(plan.id).toBe(LEGACY_PLAN_ID);
    expect(plan.reserve).toBe(1000);
    expect(plan.reserveHistory).toEqual([{ date: '2024-06-10', before: 0, after: 1000, seq: 1, kind: 'adoption' }]);
    expect(plan.recycling).toEqual(DEFAULT_RECYCLING);
    // Adopted on no recorded date: a grant backfilled from before the first resize is still its own.
    expect(planAccepts(plan, 'option', '2020-01-01')).toBe(true);
    expect(plansOf({ poolAuthorized: 0, poolHistory: [] })).toEqual([]);
  });

  it('migrates the pool into a plan on sanitize without changing what anything reads', () => {
    const data = sampleDataset();
    const before = { company: data.company, classes: data.classes, stakeholders: data.stakeholders, securities: data.securities };
    const company = Store.sanitizeCompany(data.company);
    expect(company.plans).toHaveLength(1);
    expect(company.poolAuthorized).toBe(data.company.poolAuthorized);
    const securities = Store.sanitizeSecurities(data.securities, { classes: data.classes, stakeholders: data.stakeholders, plans: company.plans });
    for (const s of securities.filter((x) => x.kind === 'option' || x.kind === 'rsu')) expect(s.planId).toBe(company.plans[0].id);
    const after = { ...before, company, securities };
    expect(fullyDiluted(after.securities, after.company)).toBe(fullyDiluted(before.securities, before.company.poolAuthorized));
    expect(poolRemaining(after.company, after.securities)).toBe(poolRemaining(before.company.poolAuthorized, before.securities));
    for (const date of ['2023-06-01', '2024-06-09', '2024-06-10', '2025-01-01']) {
      expect(poolAsOf(after.company, date)).toBe(poolAsOf(before.company, date));
      const a = dbAsOf(after, date);
      const b = dbAsOf(before, date);
      expect(fullyDiluted(a.securities, a.company)).toBe(fullyDiluted(b.securities, b.company.poolAuthorized));
    }
    expect(ownershipByStakeholder(after).rows).toEqual(ownershipByStakeholder(before).rows.map((r) => (r.kind === 'pool'
      ? { ...r, plans: [{ planId: company.plans[0].id, name: company.plans[0].name, shares: r.shares, pct: r.pct }] }
      : r)));
    expectReconciled(after);
  });

  it('keeps the legacy pool arithmetic through a split that rounded it', () => {
    const company = Store.sanitizeCompany({
      poolAuthorized: 214_286,
      splits: [{ id: 'sp', date: '2026-01-01', num: 1, den: 7, poolBefore: 1_500_000, poolAfter: 214_286, seq: 1 }],
    });
    expect(poolAsOf(company, '2025-12-31')).toBe(1_500_000);
    expect(poolAsOf(company, '2026-01-01')).toBe(214_286);
  });

  it('keeps reading the rounding note the split left once a second plan is adopted', async () => {
    const s = makeStore();
    s.company = Store.sanitizeCompany({
      poolAuthorized: 214_286,
      poolHistory: [{ date: '2024-01-01', before: 0, after: 1_500_000, seq: 1 }],
      splits: [{ id: 'sp', date: '2026-01-01', num: 1, den: 7, poolBefore: 1_500_000, poolAfter: 214_286, seq: 2 }],
    });
    await s.addPlan({ name: '2026 Equity Incentive Plan', adopted: '2026-06-01', classId: 'c1', reserve: 1000 });
    /* The note belongs to the one reserve the split restated - the legacy
       plan - not to "the only plan": divided back, 214,286 read 1,500,002. */
    expect(reserveAsOf(s.plan(LEGACY_PLAN_ID), s.company, '2025-12-31')).toBe(1_500_000);
    expect(poolAsOf(s.company, '2025-12-31')).toBe(1_500_000);
    expect(poolAsOf(s.company, '2026-06-01')).toBe(215_286);
    expect(dbAsOf(s.db, '2025-12-31').company.poolAuthorized).toBe(1_500_000);
    expect(planLedger(s.db, LEGACY_PLAN_ID).reconciles).toBe(true);
    expectReconciled(s.db);
  });
});

describe('plans: two plans hold independent reserves and grants', () => {
  it('refuses granting under a plan deleted in another session', async () => {
    makeStore();
    const a = new Store();
    await a.init();
    const holder = await a.addStakeholder({ name: 'Employee', kind: 'employee' });
    const plan = await a.addPlan({ name: 'Plan', adopted: '2024-01-01', reserve: 1000 });
    const b = new Store();
    await b.init();
    await a.deletePlan(plan.id);
    await expect(b.addSecurity({ kind: 'option', stakeholderId: holder.id, planId: plan.id,
      quantity: 100, strike: 1, date: '2024-07-01', vestingMonths: 0 })).rejects.toThrow(/changed somewhere else/);
    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.securities).toEqual([]);
  });

  it('writes the awards down with the one plan they drew before a second plan is adopted', async () => {
    /* A record written before plans existed: a pool on the company and an
       award naming none. Loaded, it reads as one plan that every award
       draws - in memory. The stored award still says nothing, and reloaded
       against two plans it fell outside both, and its own backup was refused. */
    makeStore();
    const a = new Store();
    await a.init();
    const holder = await a.addStakeholder({ name: 'Grace', kind: 'employee' });
    await a.addClass({ name: 'Common Stock', kind: 'common' });
    const key = (field) => `captable:${a.activeCompanyId}:${field}:v1`;
    await puter.kv.set(key('company'), JSON.stringify({ name: 'Legacy', poolAuthorized: 10_000, poolHistory: [{ date: '2024-01-01', before: 0, after: 10_000, seq: 1 }] }));
    await puter.kv.set(key('securities'), JSON.stringify([{ id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: holder.id, quantity: 5_000, strike: 1, date: '2025-06-01', vestingMonths: 0, exercised: 0, createdAt: 1 }]));
    const b = new Store();
    await b.init();
    expect(b.security('o1').planId).toBe(LEGACY_PLAN_ID);
    await b.addPlan({ name: '2025 Plan', adopted: '2025-01-01', reserve: 20_000 });
    expect(JSON.parse(await puter.kv.get(key('securities')))[0].planId).toBe(LEGACY_PLAN_ID);
    const c = new Store();
    await c.init();
    expect(c.security('o1').planId).toBe(LEGACY_PLAN_ID);
    expect(planBalances(c.db).plans.find((r) => r.planId === LEGACY_PLAN_ID)).toMatchObject({ committed: 5_000, available: 5_000 });
    expect(fullyDiluted(c.securities, c.company)).toBe(5_000 + 5_000 + 20_000);
    await c.importAll(c.exportAll(), { label: 'round trip' });
    expect(c.security('o1').planId).toBe(LEGACY_PLAN_ID);
  });

  it('keeps each plan’s balance on its own and reconciles the aggregate', async () => {
    const { s, old, next } = await twoPlans();
    expect(s.company.poolAuthorized).toBe(150_000);
    expect(s.company.poolHistory).toEqual([
      { date: '2024-01-01', before: 0, after: 100_000, seq: 1 },
      { date: '2026-01-01', before: 100_000, after: 150_000, seq: 2 },
    ]);
    const g1 = await s.addSecurity({ kind: 'option', stakeholderId: 'h2', planId: old.id, quantity: 40_000, strike: 1, date: '2024-07-01', vestingMonths: 48, cliffMonths: 12 });
    const g2 = await s.addSecurity({ kind: 'rsu', stakeholderId: 'h3', classId: 'c1', planId: next.id, quantity: 10_000, date: '2026-02-01', vestingMonths: 48, cliffMonths: 12 });
    const outside = await s.addSecurity({ kind: 'option', stakeholderId: 'h3', outsidePlan: true, quantity: 5_000, strike: 1, date: '2026-03-01', vestingMonths: 0 });
    expect(s.security(g1.id).planId).toBe(old.id);
    expect(s.security(g2.id).planId).toBe(next.id);
    expect(s.security(outside.id).outsidePlan).toBe(true);
    expect(s.security(outside.id).planId).toBeUndefined();

    const balances = planBalances(s.db);
    const a = balances.plans.find((r) => r.planId === old.id);
    const b = balances.plans.find((r) => r.planId === next.id);
    expect([a.authorized, a.committed, a.available]).toEqual([100_000, 40_000, 60_000]);
    expect([b.authorized, b.committed, b.available]).toEqual([50_000, 10_000, 40_000]);
    expect(balances.total).toMatchObject({ authorized: 150_000, committed: 50_000, available: 100_000, unallocated: 100_000 });
    expect(balances.outside).toEqual({ count: 1, outstanding: 5_000 });
    // The award outside every plan counts toward ownership without drawing any reserve.
    expect(fullyDiluted(s.securities, s.company)).toBe(1000 + 40_000 + 10_000 + 5_000 + 100_000);
    expect(poolDrawn(s.securities)).toBe(55_000);
    expectReconciled(s.db);
  });

  it('refuses an award into a plan that is gone, of a kind the plan is not written for, or dated outside its life', async () => {
    const { s, old, next } = await twoPlans();
    await s.updatePlan(next.id, { awardTypes: ['rsu'] });
    const base = { kind: 'option', stakeholderId: 'h2', quantity: 100, strike: 1, vestingMonths: 0 };
    await expect(s.addSecurity({ ...base, planId: 'nope', date: '2026-02-01' })).rejects.toThrow(/That plan is gone/);
    await expect(s.addSecurity({ ...base, planId: next.id, date: '2026-02-01' })).rejects.toThrow('2026 Equity Incentive Plan is written for RSU awards only.');
    await expect(s.addSecurity({ ...base, planId: old.id, date: '2023-12-31' })).rejects.toThrow(/was adopted on 2024-01-01, after this option grant is dated/);
    await s.updatePlan(old.id, { expires: '2025-12-31' });
    await expect(s.addSecurity({ ...base, planId: old.id, date: '2026-02-01' })).rejects.toThrow(/expired on 2025-12-31/);
    const ok = await s.addSecurity({ ...base, planId: old.id, date: '2025-06-01' });
    // Moving the grant date past the expiration is refused; an edit that leaves it stays allowed.
    await expect(s.updateSecurity(ok.id, { date: '2026-02-01', grantDate: '2026-02-01' })).rejects.toThrow(/expired on 2025-12-31/);
    await s.updateSecurity(ok.id, { strike: 2 });
    expect(s.security(ok.id).strike).toBe(2);
    expect(s.securities.filter((x) => x.kind === 'option')).toHaveLength(1);
  });

  it('holds the plan a new award names to the form’s budget rule in the store: the reserve cannot shrink below what is committed', async () => {
    const { s, old } = await twoPlans();
    await s.addSecurity({ kind: 'option', stakeholderId: 'h2', planId: old.id, quantity: 40_000, strike: 1, date: '2024-07-01', vestingMonths: 0 });
    await expect(s.resizePlanReserve(old.id, { size: 39_999, date: '2026-05-01' }))
      .rejects.toThrow('2024 Equity Incentive Plan’s reserve can’t be smaller than the 40,000 shares already committed under it.');
    await expect(s.resizePlanReserve(old.id, { size: 90_000, date: '2023-06-01' })).rejects.toThrow(/adopted on 2024-01-01/);
    await s.resizePlanReserve(old.id, { size: 40_000, date: '2026-05-01', reason: 'Board resolution' });
    expect(s.plan(old.id).reserve).toBe(40_000);
    expect(s.plan(old.id).reserveHistory.at(-1)).toMatchObject({ before: 100_000, after: 40_000, kind: 'resize', reason: 'Board resolution' });
    expect(s.company.poolAuthorized).toBe(90_000);
    expectReconciled(s.db);
  });

  it('refuses a company-wide pool resize once there are several plans', async () => {
    const { s } = await twoPlans();
    await expect(s.resizePool({ size: 10, date: '2026-05-01' })).rejects.toThrow(/several equity plans/);
    let refused = null;
    try { await s.updateCompany({ poolAuthorized: 10 }); } catch (err) { refused = err; }
    expect(isRefusal(refused)).toBe(true);
    expect(s.company.poolAuthorized).toBe(150_000);
  });
});

describe('plans: recycling rules decide where a forfeiture goes', () => {
  it('preserves successor recycling rules chosen when adopting a plan', async () => {
    const s = makeStore();
    const successor = await s.addPlan({ name: 'Successor', adopted: '2024-01-01', reserve: 1000 });
    const plan = await s.addPlan({
      name: 'Older plan', adopted: '2023-01-01', reserve: 1000,
      recycling: { cancellation: successor.id },
    });
    expect(plan.recycling.cancellation).toBe(successor.id);
    const grant = await s.addSecurity({ kind: 'option', stakeholderId: 'h2', planId: plan.id,
      quantity: 100, strike: 1, date: '2024-07-01', vestingMonths: 0 });
    await s.updateSecurity(grant.id, { cancellations: [{ quantity: 100, date: '2025-01-01' }] });
    expect(planBalances(s.db).plans.find((r) => r.planId === successor.id).available).toBe(1100);
  });

  async function granted() {
    const { s, old, next } = await twoPlans();
    const grant = await s.addSecurity({
      kind: 'option', stakeholderId: 'h2', planId: old.id, quantity: 40_000, strike: 1, date: '2024-07-01',
      vestingMonths: 48, cliffMonths: 12, expires: '2034-07-01',
    });
    return { s, old, next, grant };
  }

  it('returns a cancellation to its own plan by default and leaves the successor alone', async () => {
    const { s, old, next, grant } = await granted();
    await s.updateSecurity(grant.id, { cancellations: [{ quantity: 10_000, date: '2026-03-01' }] });
    const rows = Object.fromEntries(planBalances(s.db).plans.map((r) => [r.planId, r]));
    expect([rows[old.id].committed, rows[old.id].available]).toEqual([30_000, 70_000]);
    expect([rows[next.id].authorized, rows[next.id].available]).toEqual([50_000, 50_000]);
    expectReconciled(s.db);
  });

  it('pours a cancellation over into the successor plan when the rule names it, once', async () => {
    const { s, old, next, grant } = await granted();
    await s.updatePlan(old.id, { recycling: { cancellation: next.id, expiration: next.id } });
    await s.updateSecurity(grant.id, { cancellations: [{ quantity: 10_000, date: '2026-03-01' }] });
    const rows = Object.fromEntries(planBalances(s.db).plans.map((r) => [r.planId, r]));
    // The shares leave the 2024 plan altogether and arrive in the 2026 plan's reserve.
    expect([rows[old.id].authorized, rows[old.id].committed, rows[old.id].available]).toEqual([90_000, 30_000, 60_000]);
    expect([rows[next.id].authorized, rows[next.id].committed, rows[next.id].available]).toEqual([60_000, 0, 60_000]);
    expect(planBalances(s.db).total.available).toBe(120_000);
    // The ledger names the movement on both sides.
    const out = planLedger(s.db, old.id).rows.find((r) => r.kind === 'cancellation');
    expect(out).toMatchObject({ authorized: -10_000, committed: -10_000 });
    expect(out.detail).toContain('Poured over into 2026 Equity Incentive Plan');
    const into = planLedger(s.db, next.id).rows.find((r) => r.kind === 'pour-over');
    expect(into).toMatchObject({ authorized: 10_000, committed: 0 });
    expectReconciled(s.db);
    // Before the cancellation, nothing had moved.
    const eve = planBalances(dbAsOf(s.db, '2026-02-28'));
    expect(eve.plans.find((r) => r.planId === next.id).authorized).toBe(50_000);
    expect(eve.plans.find((r) => r.planId === old.id).committed).toBe(40_000);
  });

  it('keeps retired shares drawn when the rule says so, and tells an expiration from a cancellation', async () => {
    const { s, old, grant } = await granted();
    await s.updatePlan(old.id, { recycling: { cancellation: 'retire' } });
    // A forfeiture on the day the window closes is an expiration, still returned.
    await s.updateSecurity(grant.id, { exerciseBy: '2027-01-15' });
    await s.updateSecurity(grant.id, { cancellations: [{ quantity: 4_000, date: '2026-03-01' }, { quantity: 6_000, date: '2027-01-15' }] });
    const row = planBalances(s.db).plans.find((r) => r.planId === old.id);
    // 40,000 drawn, 4,000 cancelled and kept drawn, 6,000 lapsed and returned.
    expect([row.committed, row.available, row.retired, row.returned]).toEqual([34_000, 66_000, 4_000, 6_000]);
    const ledger = planLedger(s.db, old.id);
    expect(ledger.rows.filter((r) => r.kind === 'cancellation')).toHaveLength(1);
    expect(ledger.rows.filter((r) => r.kind === 'expiration')).toHaveLength(1);
    expectReconciled(s.db);
  });

  it('refuses a rule change that would leave a plan with more committed than reserved', async () => {
    const { s, old, grant } = await granted();
    await s.updateSecurity(grant.id, { cancellations: [{ quantity: 10_000, date: '2026-03-01' }] });
    await s.resizePlanReserve(old.id, { size: 30_000, date: '2026-04-01' });
    await expect(s.updatePlan(old.id, { recycling: { cancellation: 'retire' } }))
      .rejects.toThrow('2024 Equity Incentive Plan would have 10,000 more shares committed than reserved on 2026-04-01. Resize its reserve as of that day first.');
  });

  it('follows exercises, repurchases and transfers of the shares an award produced', async () => {
    const { s, old, grant } = await granted();
    await s.updateSecurity(grant.id, { vestingMonths: 0, cliffMonths: 0 });
    const certificate = await s.exerciseOption(grant.id, { quantity: 10_000, date: '2026-01-10', classId: 'c1' });
    // Exercised options stay drawn by default.
    expect(planBalances(s.db).plans[0].committed).toBe(40_000);
    await s.updatePlan(old.id, { recycling: { exercise: 'return', repurchase: 'return' } });
    expect(planBalances(s.db).plans[0].committed).toBe(30_000);
    await s.transferShares(certificate.id, { date: '2026-02-01', quantity: 4_000, pricePerShare: 1, to: 'company' });
    expect(planBalances(s.db).plans[0].committed).toBe(30_000);
    const events = planLedger(s.db, old.id).rows.map((r) => r.kind);
    expect(events).toEqual(expect.arrayContaining(['grant', 'exercise']));
    expectReconciled(s.db);
  });

  it.each(['option', 'rsu'])('recycles each %s share only once across issuance and repurchase', async (kind) => {
    const { s, old, next } = await twoPlans();
    await s.updatePlan(old.id, { recycling: { exercise: next.id, settlement: next.id, repurchase: next.id } });
    const award = await s.addSecurity({ kind, stakeholderId: 'h2', classId: 'c1', planId: old.id,
      quantity: 100, strike: 1, date: '2024-07-01', vestingMonths: 0 });
    const cert = kind === 'option'
      ? await s.exerciseOption(award.id, { quantity: 100, date: '2026-02-01', classId: 'c1' })
      : await s.settleRSU(award.id, { quantity: 100, date: '2026-02-01', classId: 'c1' });
    await s.transferShares(cert.id, { date: '2026-03-01', quantity: 100, pricePerShare: 1, to: 'company' });
    expect(planBalances(s.db).plans.find((r) => r.planId === old.id).committed).toBe(0);
    expect(planBalances(s.db).plans.find((r) => r.planId === next.id).authorized).toBe(50_100);
  });

  it('does not recycle transferred shares again, but still recycles the retained shares', async () => {
    const { s, old } = await twoPlans();
    await s.updatePlan(old.id, { recycling: { transfer: 'return', repurchase: 'return' } });
    const award = await s.addSecurity({ kind: 'option', stakeholderId: 'h2', planId: old.id,
      quantity: 100, strike: 1, date: '2024-07-01', vestingMonths: 0 });
    const cert = await s.exerciseOption(award.id, { quantity: 100, date: '2026-02-01', classId: 'c1' });
    await s.transferShares(cert.id, { date: '2026-03-01', quantity: 40, pricePerShare: 1, to: { stakeholderId: 'h3' } });
    const children = s.securities.filter((c) => c.fromTransferId === cert.id);
    const sold = children.find((c) => c.stakeholderId === 'h3');
    const retained = children.find((c) => c.stakeholderId === 'h2');
    await s.transferShares(sold.id, { date: '2026-04-01', quantity: 40, pricePerShare: 1, to: 'company' });
    expect(planBalances(s.db).plans[0].committed).toBe(60);
    await s.transferShares(retained.id, { date: '2026-04-01', quantity: 60, pricePerShare: 1, to: 'company' });
    expect(planBalances(s.db).plans[0].committed).toBe(0);
    expect(planBalances(dbAsOf(s.db, '2026-02-28')).plans[0].committed).toBe(100);
    expect(planBalances(dbAsOf(s.db, '2026-03-01')).plans[0].committed).toBe(60);
    expectReconciled(s.db);
  });
});

describe('plans: transfers between reserves', () => {
  it('compares a backdated transfer with historical availability in current share units', async () => {
    const { s, old, next } = await twoPlans();
    const grant = await s.addSecurity({ kind: 'option', stakeholderId: 'h2', planId: old.id,
      quantity: 40_000, strike: 1, date: '2024-07-01', vestingMonths: 0 });
    await s.updateSecurity(grant.id, { cancellations: [{ quantity: 40_000, date: '2026-03-01' }] });
    await s.recordSplit({ num: 1, den: 2, date: '2026-04-01' });
    await expect(s.transferReserve({ fromPlanId: old.id, toPlanId: next.id, quantity: 40_000, date: '2026-02-01' }))
      .rejects.toThrow(/30,000 shares available/);
    await s.transferReserve({ fromPlanId: old.id, toPlanId: next.id, quantity: 30_000, date: '2026-02-01' });
    expect(planBalances(dbAsOf(s.db, '2026-02-01')).plans.find((r) => r.planId === old.id).available).toBe(0);
  });

  it('allows backdated transfers expressed in the larger units after a forward split', async () => {
    const { s, old, next } = await twoPlans();
    await s.recordSplit({ num: 2, den: 1, date: '2026-04-01' });
    await s.transferReserve({ fromPlanId: old.id, toPlanId: next.id, quantity: 150_000, date: '2026-02-01' });
    expect(planBalances(dbAsOf(s.db, '2026-02-01')).plans.find((r) => r.planId === old.id).available).toBe(25_000);
  });

  it.each(['transfer', 'retire'])('conserves shares when a plan passes recycled inflows on by %s', async (action) => {
    const { s, old, next } = await twoPlans();
    const third = await s.addPlan({ name: 'Third plan', adopted: '2026-01-01', reserve: 0 });
    await s.resizePlanReserve(next.id, { size: 0, date: '2026-01-02' });
    await s.updatePlan(old.id, { recycling: { cancellation: next.id } });
    const grant = await s.addSecurity({ kind: 'option', stakeholderId: 'h2', planId: old.id,
      quantity: 40_000, strike: 1, date: '2024-07-01', vestingMonths: 0 });
    await s.updateSecurity(grant.id, { cancellations: [{ quantity: 10_000, date: '2026-02-01' }] });
    const before = fullyDiluted(s.securities, s.company);
    if (action === 'transfer') await s.transferReserve({ fromPlanId: next.id, toPlanId: third.id, quantity: 10_000, date: '2026-03-01' });
    else await s.retirePlan(next.id, { pourOverTo: third.id, date: '2026-03-01' });
    expect(s.company.poolAuthorized).toBe(100_000);
    expect(planBalances(s.db).plans.find((r) => r.planId === next.id).available).toBe(0);
    expect(planBalances(s.db).plans.find((r) => r.planId === third.id).available).toBe(10_000);
    expect(fullyDiluted(s.securities, s.company)).toBe(before);
    expectReconciled(s.db);
    await s.recordSplit({ num: 2, den: 1, date: '2026-04-01' });
    expect(fullyDiluted(s.securities, s.company)).toBe(before * 2);
    expect(fullyDiluted(dbAsOf(s.db, '2026-03-01').securities, dbAsOf(s.db, '2026-03-01').company)).toBe(before);
    const earlier = planBalances(dbAsOf(s.db, '2026-02-01'));
    expect(earlier.plans.find((r) => r.planId === next.id).available).toBe(10_000);
    expect(earlier.plans.find((r) => r.planId === third.id).available).toBe(0);
    await s.recordSplit({ num: 1, den: 3, date: '2026-05-01' });
    expect(planBalances(s.db).plans.find((r) => r.planId === next.id).available).toBe(0);
    expectReconciled(s.db);
    const snapshot = s.exportAll();
    const balances = planBalances(s.db).total;
    await s.importAll(snapshot, { label: 'Transferred recycled shares' });
    expect(planBalances(s.db).total).toEqual(balances);
    expectReconciled(s.db);
  });

  it('moves available shares with linked entries and leaves the total and ownership unchanged', async () => {
    const { s, old, next } = await twoPlans();
    await s.addSecurity({ kind: 'option', stakeholderId: 'h2', planId: old.id, quantity: 40_000, strike: 1, date: '2024-07-01', vestingMonths: 0 });
    const before = { fd: fullyDiluted(s.securities, s.company), rows: ownershipByStakeholder(s.db).rows.map((r) => [r.name, r.shares]) };
    const { transferId } = await s.transferReserve({ fromPlanId: old.id, toPlanId: next.id, quantity: 25_000, date: '2026-02-01', reason: 'Pour-over to the 2026 plan' });
    const rows = Object.fromEntries(planBalances(s.db).plans.map((r) => [r.planId, r]));
    expect([rows[old.id].reserve, rows[old.id].available]).toEqual([75_000, 35_000]);
    expect([rows[next.id].reserve, rows[next.id].available]).toEqual([75_000, 75_000]);
    expect(planBalances(s.db).total.available).toBe(110_000);
    expect(fullyDiluted(s.securities, s.company)).toBe(before.fd);
    expect(ownershipByStakeholder(s.db).rows.map((r) => [r.name, r.shares])).toEqual(before.rows);
    const out = s.plan(old.id).reserveHistory.at(-1);
    const into = s.plan(next.id).reserveHistory.at(-1);
    expect(out).toMatchObject({ kind: 'transfer', before: 100_000, after: 75_000, transferId, planId: next.id, reason: 'Pour-over to the 2026 plan' });
    expect(into).toMatchObject({ kind: 'transfer', before: 50_000, after: 75_000, transferId, planId: old.id });
    expect(out.seq).toBe(into.seq);
    // The aggregate did not move, so its history carries no entry for the transfer.
    expect(s.company.poolAuthorized).toBe(150_000);
    expect(s.company.poolHistory).toHaveLength(2);
    // The day before, nothing had moved; the day of, it had.
    expect(reserveAsOf(s.plan(old.id), s.company, '2026-01-31')).toBe(100_000);
    expect(reserveAsOf(s.plan(next.id), s.company, '2026-01-31')).toBe(50_000);
    expect(reserveAsOf(s.plan(next.id), s.company, '2026-02-01')).toBe(75_000);
    expectReconciled(s.db);
  });

  it('refuses moving more than the source has available, into a retired plan, or before either was adopted', async () => {
    const { s, old, next } = await twoPlans();
    await s.addSecurity({ kind: 'option', stakeholderId: 'h2', planId: old.id, quantity: 90_000, strike: 1, date: '2024-07-01', vestingMonths: 0 });
    await expect(s.transferReserve({ fromPlanId: old.id, toPlanId: next.id, quantity: 10_001, date: '2026-02-01' }))
      .rejects.toThrow('2024 Equity Incentive Plan has 10,000 shares available to move as of 2026-02-01.');
    await expect(s.transferReserve({ fromPlanId: old.id, toPlanId: next.id, quantity: 1, date: '2025-06-01' }))
      .rejects.toThrow(/2026 Equity Incentive Plan was adopted on 2026-01-01, after this transfer date/);
    await expect(s.transferReserve({ fromPlanId: old.id, toPlanId: old.id, quantity: 1, date: '2026-02-01' })).rejects.toThrow(/two different plans/);
    await s.retirePlan(next.id, { date: '2026-03-01' });
    await expect(s.transferReserve({ fromPlanId: old.id, toPlanId: next.id, quantity: 1, date: '2026-03-02' }))
      .rejects.toThrow(/has been retired/);
    expect(s.plan(old.id).reserve).toBe(100_000);
  });

  it('holds a backdated transfer to what the source had available on that day', async () => {
    const { s, old, next } = await twoPlans();
    // 100,000 reserved in 2024, then 95,000 granted in 2025: on a 2024 date the plan could spare it all, today only 5,000.
    await s.addSecurity({ kind: 'option', stakeholderId: 'h2', planId: old.id, quantity: 95_000, strike: 1, date: '2025-06-01', vestingMonths: 0 });
    await expect(s.transferReserve({ fromPlanId: old.id, toPlanId: next.id, quantity: 20_000, date: '2026-02-01' }))
      .rejects.toThrow(/5,000 shares available/);
    await s.transferReserve({ fromPlanId: old.id, toPlanId: next.id, quantity: 5_000, date: '2026-02-01' });
    expect(planBalances(s.db).plans.find((r) => r.planId === old.id).available).toBe(0);
  });
});

describe('plans: as-of dates', () => {
  it('reads every balance as it stood before and after adoption, resizes, transfers, retirement and a split', async () => {
    const { s, old, next } = await twoPlans();
    const g = await s.addSecurity({ kind: 'option', stakeholderId: 'h2', planId: old.id, quantity: 40_000, strike: 1, date: '2024-07-01', vestingMonths: 0 });
    await s.resizePlanReserve(old.id, { size: 120_000, date: '2025-03-01' });
    await s.transferReserve({ fromPlanId: old.id, toPlanId: next.id, quantity: 20_000, date: '2026-02-01' });
    await s.updateSecurity(g.id, { cancellations: [{ quantity: 5_000, date: '2026-03-01' }] });
    await s.retirePlan(old.id, { date: '2026-04-01' });
    await s.recordSplit({ num: 2, den: 1, date: '2026-05-01' });

    const at = (date) => {
      const snap = dbAsOf(s.db, date);
      const b = planBalances(snap);
      const row = (id) => b.plans.find((r) => r.planId === id) || { authorized: 0, committed: 0, available: 0, unallocated: 0 };
      return { old: row(old.id), next: row(next.id), total: b.total, fd: fullyDiluted(snap.securities, snap.company), pool: snap.company.poolAuthorized };
    };
    // Before either plan: no reserve, no awards, the founder alone.
    expect(at('2023-12-31')).toMatchObject({ pool: 0, fd: 1000 });
    expect(at('2023-12-31').old).toMatchObject({ authorized: 0, committed: 0 });
    // After the 2024 adoption and the grant.
    expect(at('2024-07-01')).toMatchObject({ pool: 100_000, fd: 1000 + 40_000 + 60_000 });
    expect(at('2024-07-01').old).toMatchObject({ authorized: 100_000, committed: 40_000, available: 60_000 });
    expect(at('2024-07-01').next).toMatchObject({ authorized: 0 });
    // After the resize, before the successor.
    expect(at('2025-12-31').old).toMatchObject({ authorized: 120_000, available: 80_000 });
    expect(at('2025-12-31').pool).toBe(120_000);
    // Successor adopted; transfer not yet.
    expect(at('2026-01-31')).toMatchObject({ pool: 170_000 });
    expect(at('2026-01-31').next).toMatchObject({ authorized: 50_000 });
    // Transfer landed.
    expect(at('2026-02-01').old).toMatchObject({ authorized: 100_000, available: 60_000 });
    expect(at('2026-02-01').next).toMatchObject({ authorized: 70_000, available: 70_000 });
    expect(at('2026-02-01').pool).toBe(170_000);
    // The cancellation returned to the 2024 plan, still open that day.
    expect(at('2026-03-15').old).toMatchObject({ committed: 35_000, available: 65_000, unallocated: 65_000 });
    // Retired: the shares are still there, but leave the fully diluted count.
    expect(at('2026-04-15').old).toMatchObject({ available: 65_000, unallocated: 0, eligible: false });
    expect(at('2026-04-15').fd).toBe(1000 + 35_000 + 70_000);
    expect(at('2026-03-15').fd).toBe(1000 + 35_000 + 65_000 + 70_000);
    // After the split, everything doubled and the pre-split dates still read in their own units.
    expect(at('2026-05-01').next).toMatchObject({ authorized: 140_000 });
    expect(at('2026-05-01').old).toMatchObject({ authorized: 200_000, committed: 70_000 });
    expect(at('2026-04-30').next).toMatchObject({ authorized: 70_000 });
    expect(at('2026-04-30').old).toMatchObject({ authorized: 100_000, committed: 35_000 });
    expect(s.plan(old.id).reserveHistory.at(-1)).toMatchObject({ kind: 'split', before: 100_000, after: 200_000 });
    expect(s.plan(old.id).status).toBe('retired');
    expect(dbAsOf(s.db, '2026-03-31').company.plans.find((p) => p.id === old.id).status).toBe('active');
    expectReconciled(s.db);
  });

  it('reads an exercise or settlement dated after the snapshot as not yet made', async () => {
    const { s, old } = await twoPlans();
    await s.updatePlan(old.id, { recycling: { exercise: 'return', settlement: 'return' } });
    const g = await s.addSecurity({ kind: 'option', stakeholderId: 'h2', planId: old.id, quantity: 100, strike: 1, date: '2024-07-01', vestingMonths: 0 });
    const r = await s.addSecurity({ kind: 'rsu', stakeholderId: 'h3', classId: 'c1', planId: old.id, quantity: 100, date: '2024-07-01', vestingMonths: 0 });
    await s.exerciseOption(g.id, { quantity: 40, date: '2026-02-01', classId: 'c1' });
    await s.settleRSU(r.id, { quantity: 30, date: '2026-02-01', classId: 'c1' });
    const row = (db) => planBalances(db).plans.find((x) => x.planId === old.id);
    expect(row(s.db).committed).toBe(130);
    /* The day before: the counters read what the certificates dated by then
       say, so nothing had returned to the reserve and the awards stood whole. */
    const eve = dbAsOf(s.db, '2026-01-31');
    expect(row(eve).committed).toBe(200);
    expect(eve.securities.find((x) => x.id === g.id).exercised).toBe(0);
    expect(eve.securities.find((x) => x.id === r.id).settled).toBe(0);
    expect(fullyDiluted(eve.securities, eve.company)).toBe(1000 + 100 + 100 + (100_000 - 200) + 50_000);
    expect(row(dbAsOf(s.db, '2026-02-01')).committed).toBe(130);
    expectReconciled(eve, { ledger: false });
  });

  it('reads a reserve through a reverse split that rounded it', async () => {
    const { s, old, next } = await twoPlans();
    await s.resizePlanReserve(old.id, { size: 100_001, date: '2025-01-01' });
    await s.recordSplit({ num: 1, den: 3, date: '2026-06-01' });
    expect(s.plan(old.id).reserve).toBe(33_334);
    expect(s.plan(next.id).reserve).toBe(16_667);
    expect(s.company.poolAuthorized).toBe(50_001);
    expect(reserveAsOf(s.plan(old.id), s.company, '2026-05-31')).toBe(100_001);
    expect(reserveAsOf(s.plan(next.id), s.company, '2026-05-31')).toBe(50_000);
    expect(poolAsOf(s.company, '2026-05-31')).toBe(150_001);
    expect(poolAsOf(s.company, '2024-06-01')).toBe(100_000);
    expectReconciled(s.db);
  });

  it('reads a historical split entered behind a later-dated resize in the order they were applied', async () => {
    const { s, old } = await twoPlans();
    await s.resizePlanReserve(old.id, { size: 90_000, date: '2026-06-01' });
    await s.recordSplit({ num: 2, den: 1, date: '2026-03-01' });
    expect(s.plan(old.id).reserve).toBe(180_000);
    expect(reserveAsOf(s.plan(old.id), s.company, '2026-05-31')).toBe(200_000);
    expect(reserveAsOf(s.plan(old.id), s.company, '2026-02-28')).toBe(100_000);
    expect(reserveAsOf(s.plan(old.id), s.company, '2026-06-01')).toBe(180_000);
  });
});

describe('plans: retiring and reopening', () => {
  it.each(['delete', 'amend'])('refuses restoring an award after its plan is changed by %s', async (action) => {
    const { s, old } = await twoPlans();
    const award = await s.addSecurity({ kind: 'option', stakeholderId: 'h2', planId: old.id,
      quantity: 100, strike: 1, date: '2024-07-01', vestingMonths: 0 });
    const { undo } = await s.deleteSecurity(award.id);
    if (action === 'delete') await s.deletePlan(old.id);
    else await s.updatePlan(old.id, { awardTypes: ['rsu'] });
    await expect(undo()).rejects.toThrow(/cap table has changed since the delete/);
    expect(s.security(award.id)).toBeNull();
  });

  it('restores a deleted award its plan never held as written, but not one the plan stopped holding since', async () => {
    const { s, old, next } = await twoPlans();
    await s.updatePlan(old.id, { expires: '2025-12-31' });
    // Taken as written: the plan had expired before the award is dated. Deleting and undoing changes nothing about that.
    const data = s.exportAll();
    await s.importAll({ ...data, securities: [...data.securities, { id: 'x1', kind: 'option', label: 'OPT-9', stakeholderId: 'h2', planId: old.id, quantity: 100, strike: 1, date: '2026-02-01', vestingMonths: 0 }] }, { label: 'x' });
    const { undo } = await s.deleteSecurity('x1');
    await undo();
    expect(s.security('x1')).toMatchObject({ planId: old.id, quantity: 100 });
    // A plan retired ahead of an award it held when the award was deleted no longer takes it back.
    const g = await s.addSecurity({ kind: 'option', stakeholderId: 'h3', planId: next.id, quantity: 10, strike: 1, date: '2026-03-01', vestingMonths: 0 });
    const { undo: undoG } = await s.deleteSecurity(g.id);
    await s.retirePlan(next.id, { date: '2026-02-01' });
    await expect(undoG()).rejects.toThrow(/cap table has changed since the delete/);
    expect(s.security(g.id)).toBeNull();
  });

  it('does not pour historical returns into the successor twice on retirement', async () => {
    const { s, old, next } = await twoPlans();
    const grant = await s.addSecurity({ kind: 'option', stakeholderId: 'h2', planId: old.id,
      quantity: 40_000, strike: 1, date: '2024-07-01', vestingMonths: 0 });
    await s.updateSecurity(grant.id, { cancellations: [{ quantity: 10_000, date: '2026-02-01' }] });
    const before = fullyDiluted(s.securities, s.company);
    const result = await s.retirePlan(old.id, { date: '2026-03-01', pourOverTo: next.id, recycleTo: next.id });
    expect(result.pouredOver).toBe(60_000);
    expect(planBalances(s.db).plans.find((r) => r.planId === old.id).available).toBe(0);
    expect(planBalances(s.db).plans.find((r) => r.planId === next.id).available).toBe(120_000);
    expect(fullyDiluted(s.securities, s.company)).toBe(before);
    expectReconciled(s.db);
  });

  it('refuses to pour a retiring plan’s reserve into an expired plan, as a transfer does', async () => {
    const { s, old, next } = await twoPlans();
    await s.updatePlan(old.id, { expires: '2025-12-31' });
    await expect(s.retirePlan(next.id, { date: '2026-03-01', pourOverTo: old.id }))
      .rejects.toThrow(/expired on 2025-12-31/);
    expect(s.plan(next.id).status).not.toBe('retired');
    expect(s.plan(old.id).reserve).toBe(100_000);
  });

  it('deletes the last plan without recreating it from the legacy pool fields', async () => {
    const s = makeStore();
    const plan = await s.addPlan({ name: 'Only plan', adopted: '2024-01-01', reserve: 1000 });
    await s.deletePlan(plan.id);
    expect(s.company.plans).toEqual([]);
    expect(s.company.poolAuthorized).toBe(0);
    expect(plansOf(Store.sanitizeCompany(s.exportAll().company))).toEqual([]);
    expect(fullyDiluted(s.securities, s.company)).toBe(1000);
  });

  it('retires a plan without touching its grants, pours the available shares over, and redirects its returns', async () => {
    const { s, old, next } = await twoPlans();
    const g = await s.addSecurity({ kind: 'option', stakeholderId: 'h2', planId: old.id, quantity: 40_000, strike: 1, date: '2024-07-01', vestingMonths: 48, cliffMonths: 12 });
    await expect(s.retirePlan(old.id, { date: '2024-06-30' })).rejects.toThrow(/dated 2024-07-01, so it can’t be retired before that/);
    const { pouredOver } = await s.retirePlan(old.id, { date: '2026-02-01', pourOverTo: next.id, recycleTo: next.id });
    expect(pouredOver).toBe(60_000);
    expect(s.plan(old.id)).toMatchObject({ status: 'retired', retiredAt: '2026-02-01', reserve: 40_000 });
    expect(s.plan(old.id).recycling).toMatchObject({ cancellation: next.id, expiration: next.id, exercise: 'retire' });
    expect(s.plan(next.id).reserve).toBe(110_000);
    expect(s.security(g.id).planId).toBe(old.id);
    // Later awards fail the retirement rule. Backfilled awards must also
    // respect the reserve transferred away at retirement.
    await expect(s.addSecurity({ kind: 'option', stakeholderId: 'h3', planId: old.id, quantity: 1, strike: 1, date: '2026-03-01', vestingMonths: 0 }))
      .rejects.toThrow(/retired on 2026-02-01/);
    await expect(s.addSecurity({ kind: 'option', stakeholderId: 'h3', planId: old.id, quantity: 1, strike: 1, date: '2025-03-01', vestingMonths: 0 }))
      .rejects.toThrow(/1 more shares.*2026-02-01/);
    // A later forfeiture lands in the successor.
    await s.updateSecurity(g.id, { cancellations: [{ quantity: 10_000, date: '2026-06-01' }] });
    const rows = Object.fromEntries(planBalances(s.db).plans.map((r) => [r.planId, r]));
    expect([rows[old.id].authorized, rows[old.id].committed, rows[old.id].available]).toEqual([30_000, 30_000, 0]);
    expect(rows[next.id].authorized).toBe(120_000);
    expect(rows[old.id].unallocated).toBe(0);
    expectReconciled(s.db);
    await s.updatePlan(old.id, { status: 'active' });
    expect(s.plan(old.id).status).toBe('active');
    expect(s.plan(old.id).retiredAt).toBeUndefined();
    await expect(s.retirePlan(next.id, { date: '2999-01-01' })).rejects.toThrow(/future date/);
  });

  it('deletes only a plan nothing refers to', async () => {
    const { s, old, next } = await twoPlans();
    const g = await s.addSecurity({ kind: 'option', stakeholderId: 'h2', planId: old.id, quantity: 100, strike: 1, date: '2024-07-01', vestingMonths: 0 });
    await expect(s.deletePlan(old.id)).rejects.toThrow('1 award draws from 2024 Equity Incentive Plan. Move them to another plan, or retire the plan instead.');
    await s.updatePlan(next.id, { recycling: { cancellation: old.id } });
    await s.deleteSecurity(g.id);
    await expect(s.deletePlan(old.id)).rejects.toThrow(/pours shares over into/);
    await s.updatePlan(next.id, { recycling: { cancellation: 'return' } });
    await s.deletePlan(old.id);
    expect(s.company.plans.map((p) => p.id)).toEqual([next.id]);
    expect(s.company.poolAuthorized).toBe(50_000);
    expect(s.company.poolHistory.at(-1)).toMatchObject({ before: 150_000, after: 50_000 });
  });

  it('holds amendments to the awards already granted', async () => {
    const { s, old } = await twoPlans();
    await s.addSecurity({ kind: 'rsu', stakeholderId: 'h2', classId: 'c1', planId: old.id, quantity: 100, date: '2024-07-01', vestingMonths: 0 });
    await expect(s.updatePlan(old.id, { adopted: '2024-08-01' })).rejects.toThrow(/granted on 2024-07-01 under this plan/);
    await expect(s.updatePlan(old.id, { awardTypes: ['option'] })).rejects.toThrow(/1 RSU award draws from this plan/);
    await expect(s.updatePlan(old.id, { expires: '2024-06-30' })).rejects.toThrow(/dated 2024-07-01, so the plan can’t have expired before that/);
    await expect(s.updatePlan(old.id, { name: '2026 Equity Incentive Plan' })).rejects.toThrow(/already on file/);
    await expect(s.updatePlan(old.id, { recycling: { cancellation: old.id } })).rejects.toThrow(/into itself/);
    // A recorded adoption date is not cleared by an edit; a legacy plan that never had one stays editable.
    await expect(s.updatePlan(old.id, { adopted: '' })).rejects.toThrow(/adoption date/);
    await s.updatePlan(old.id, { name: '2024 Plan', adopted: '2023-06-01', expires: '2034-06-01' });
    expect(s.plan(old.id)).toMatchObject({ name: '2024 Plan', adopted: '2023-06-01', expires: '2034-06-01' });
    const legacy = makeStore();
    legacy.company = Store.sanitizeCompany({ poolAuthorized: 1000 });
    await legacy.updatePlan(LEGACY_PLAN_ID, { name: 'Renamed plan', adopted: '' });
    expect(legacy.plan(LEGACY_PLAN_ID)).toMatchObject({ name: 'Renamed plan', adopted: '' });
  });

  it('keeps editing and reopening a plan whose share class was deleted since, and still refuses a new pick that is gone', async () => {
    const s = makeStore();
    const cls = await s.addClass({ name: 'Plan Common', kind: 'common' });
    const plan = await s.addPlan({ name: 'Plan', adopted: '2024-01-01', classId: cls.id, reserve: 1000 });
    // The store refuses to delete the class from under the plan...
    await expect(s.deleteClass(cls.id)).rejects.toThrow('An equity plan settles its awards into this class.');
    // ...but a backup written before it did can still carry the dangling reference.
    s.classes = s.classes.filter((c) => c.id !== cls.id);
    expect(s.plan(plan.id).classId).toBe(cls.id);
    await s.retirePlan(plan.id, { date: '2024-06-01' });
    /* The reference the edit leaves alone is not the edit's to answer for;
       refused, a retired plan could never be reopened once its class went. */
    await s.updatePlan(plan.id, { status: 'active' });
    expect(s.plan(plan.id)).toMatchObject({ status: 'active', classId: cls.id });
    await s.updatePlan(plan.id, { name: 'Renamed' });
    expect(s.plan(plan.id).name).toBe('Renamed');
    await expect(s.updatePlan(plan.id, { classId: 'gone' })).rejects.toThrow(/share class is gone/);
    await s.updatePlan(plan.id, { classId: '' });
    expect(s.plan(plan.id).classId).toBe('');
  });

  it('takes on the awards already on file when the first plan is adopted, or leaves them outside', async () => {
    const s = makeStore();
    const g = await s.addSecurity({ kind: 'option', stakeholderId: 'h2', quantity: 5_000, strike: 1, date: '2024-07-01', vestingMonths: 0 });
    expect(g.planId).toBeUndefined();
    expect(fullyDiluted(s.securities, s.company)).toBe(6_000);
    await expect(s.addPlan({ name: 'Plan', adopted: '2025-01-01', reserve: 10_000 }))
      .rejects.toThrow(/OPT-1: Plan was adopted on 2025-01-01, after this option grant is dated/);
    await expect(s.addPlan({ name: 'Plan', adopted: '2024-01-01', reserve: 4_000 }))
      .rejects.toThrow(/can’t be smaller than the 5,000 shares already granted/);
    const plan = await s.addPlan({ name: 'Plan', adopted: '2024-01-01', reserve: 10_000 });
    expect(s.security(g.id).planId).toBe(plan.id);
    expect(planBalances(s.db).plans[0]).toMatchObject({ committed: 5_000, available: 5_000 });
    expect(fullyDiluted(s.securities, s.company)).toBe(1000 + 5_000 + 5_000);

    const other = makeStore();
    const h = await other.addSecurity({ kind: 'option', stakeholderId: 'h2', quantity: 5_000, strike: 1, date: '2024-07-01', vestingMonths: 0 });
    await other.addPlan({ name: 'Plan', adopted: '2026-01-01', reserve: 10_000 }, { assignExisting: false });
    expect(other.security(h.id).outsidePlan).toBe(true);
    expect(planBalances(other.db).outside).toEqual({ count: 1, outstanding: 5_000 });
    expect(fullyDiluted(other.securities, other.company)).toBe(1000 + 5_000 + 10_000);
  });
});

describe('plans: rounds, forecasts and imports', () => {
  it.each([10, -1, 50_000.5])('refuses a round top-up with an invalid new reserve of %s', async (reserve) => {
    const { s, next } = await twoPlans();
    await expect(s.closeRound({ date: '2026-03-01',
      newClass: { name: 'Series A', kind: 'preferred', pricePerShare: 1 },
      investors: [{ stakeholderId: 'h1', quantity: 100, pricePerShare: 1 }],
      topUp: { planId: next.id, reserve },
    })).rejects.toThrow(/top-up.*whole shares|top-up.*smaller/i);
    expect(s.plan(next.id).reserve).toBe(50_000);
    expect(s.securities).toHaveLength(1);
    expect(s.classes).toHaveLength(1);
  });

  it('refuses a round top-up into a plan adopted after the closing date', async () => {
    const { s, next } = await twoPlans();
    await expect(s.closeRound({ date: '2025-06-01',
      newClass: { name: 'Series A', kind: 'preferred', pricePerShare: 1 },
      investors: [{ stakeholderId: 'h1', quantity: 100, pricePerShare: 1 }],
      topUp: { planId: next.id, reserve: 90_000 },
    })).rejects.toThrow(/adopted on 2026-01-01, after this closing date/);
    // Nothing of the close landed, and the plan reads nothing before its adoption.
    expect(s.plan(next.id).reserveHistory).toHaveLength(1);
    expect(s.securities).toHaveLength(1);
    expect(s.classes).toHaveLength(1);
    expect(reserveAsOf(s.plan(next.id), s.company, '2025-12-31')).toBe(0);
  });

  it('rejects CSV rows that the single inferred plan cannot hold during preview', async () => {
    const s = makeStore();
    const plan = await s.addPlan({ name: 'RSUs only', adopted: '2026-01-01', reserve: 1000, awardTypes: ['rsu'] });
    const headers = ['Stakeholder', 'Type', 'Share class', 'Quantity', 'Date'];
    const preview = buildSecurityPlan([
      ['Grace', 'Option', '', '100', '2026-02-01'],
      ['Grace', 'RSU', 'Common Stock', '100', '2025-12-01'],
    ], autoMatch(headers, SECURITY_FIELDS), { ...s.db, plans: [plan] });
    expect(preview.creates).toEqual([]);
    expect(preview.errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/written for RSU awards only/),
      expect.stringMatching(/adopted on 2026-01-01/),
    ]);
  });

  it('tops up the plan the close names once and leaves the others alone', async () => {
    const { s, old, next } = await twoPlans();
    await s.addSecurity({ kind: 'option', stakeholderId: 'h2', planId: old.id, quantity: 60_000, strike: 1, date: '2024-07-01', vestingMonths: 0 });
    // 1,000 + 60,000 + 40,000 + 50,000 = 151,000 fully diluted.
    const result = modelRound(s.db, { preMoney: 1_510_000, investment: 500_000, poolPct: 0.6, asOf: '2026-03-01' });
    expect(result.poolAdd).toBeGreaterThan(0);
    expect(result.poolAfter).toBe(90_000 + result.poolAdd);
    const reserve = topUpReserve(s.db, next.id, result.poolAfter);
    expect(reserve).toBe(50_000 + (result.poolAfter - 90_000));
    await s.closeRound({
      date: '2026-03-01', newClass: { name: 'Series A Preferred', kind: 'preferred', pricePerShare: result.pps, liquidationMultiple: 1, seniority: 1 },
      investors: [{ newHolder: { name: 'Nova', kind: 'investor' }, quantity: result.investorShares, pricePerShare: result.pps }],
      topUp: { planId: next.id, reserve },
    });
    expect(s.plan(old.id).reserve).toBe(100_000);
    expect(s.plan(next.id).reserve).toBe(reserve);
    expect(s.plan(next.id).reserveHistory.at(-1)).toMatchObject({ kind: 'top-up', date: '2026-03-01', reason: 'Round closed' });
    expect(planBalances(s.db).total.unallocated).toBe(result.poolAfter);
    const eve = dbAsOf(s.db, '2026-02-28');
    expect(eve.company.plans.find((p) => p.id === next.id).reserve).toBe(50_000);
    expectReconciled(s.db);
    await expect(s.closeRound({
      date: '2026-04-01', classId: s.classes.at(-1).id,
      investors: [{ stakeholderId: 'h1', quantity: 10, pricePerShare: 1 }], topUp: { planId: 'gone', reserve: 1 },
    })).rejects.toThrow(/Pick the plan the pool top-up goes into/);
  });

  it('covers an overrun in the destination plan so the promised unallocated count lands', async () => {
    const { s, old, next } = await twoPlans();
    // Imported awards outran the 2026 plan: 60,000 committed against 50,000.
    s.securities = Store.sanitizeSecurities([...s.securities, {
      id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h2', planId: next.id, quantity: 60_000, strike: 1, date: '2026-01-15',
    }], { classes: s.classes, stakeholders: s.stakeholders, plans: s.company.plans });
    expect(planBalances(s.db).plans.find((r) => r.planId === next.id).available).toBe(-10_000);
    expect(planBalances(s.db).total.unallocated).toBe(100_000);
    expect(topUpReserve(s.db, next.id, 130_000)).toBe(50_000 + 10_000 + 30_000);
    expect(topUpReserve(s.db, old.id, 130_000)).toBe(130_000);
  });

  it('resolves CSV rows to a plan by name, by the one plan that could hold them, or refuses to guess', async () => {
    const { s, old, next } = await twoPlans();
    await s.updatePlan(old.id, { awardTypes: ['option'] });
    await s.updatePlan(next.id, { awardTypes: ['rsu'] });
    const headers = ['Stakeholder', 'Type', 'Share class', 'Quantity', 'Strike price', 'Date', 'Plan'];
    const mapping = autoMatch(headers, SECURITY_FIELDS);
    expect(mapping.plan).toBe(6);
    const context = { classes: s.classes, stakeholders: s.stakeholders, securities: s.securities, plans: s.company.plans };
    const plan = buildSecurityPlan([
      ['Grace', 'Option', '', '100', '1', '2024-07-01', '2024 Equity Incentive Plan'],
      ['Grace', 'Option', '', '100', '1', '2026-02-01', ''],
      ['Grace', 'RSU', 'Common Stock', '100', '', '2026-02-01', ''],
      ['Grace', 'Option', '', '100', '1', '2026-02-01', 'none'],
      ['Grace', 'Option', '', '100', '1', '2026-02-01', '2027 Plan'],
      ['Grace', 'RSU', 'Common Stock', '100', '', '2026-02-01', '2024 Equity Incentive Plan'],
      ['Grace', 'Shares', 'Common Stock', '100', '', '2026-02-01', '2024 Equity Incentive Plan'],
    ], mapping, context);
    expect(plan.creates.map((c) => c.planId || (c.outsidePlan ? 'outside' : 'unassigned'))).toEqual([old.id, old.id, next.id, 'outside']);
    expect(plan.errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/Unknown plan "2027 Plan"/),
      expect.stringMatching(/2024 Equity Incentive Plan is written for option grants only/),
      expect.stringMatching(/Shares are not granted under an equity plan/),
    ]);
    // Two plans could hold an option once both are written for options: the row has to say which.
    await s.updatePlan(next.id, { awardTypes: ['option', 'rsu'] });
    const ambiguous = buildSecurityPlan([['Grace', 'Option', '', '100', '1', '2026-02-01', '']], mapping,
      { ...context, plans: s.company.plans });
    expect(ambiguous.errors[0].message).toMatch(/2 plans could hold this option grant/);
    // With no plan column at all, a company with one plan takes every row, as the pool did.
    const single = makeStore();
    await single.resizePool({ size: 10_000, date: '2024-01-01' });
    const legacy = buildSecurityPlan([['Grace', 'Option', '', '100', '1', '2020-01-01']], autoMatch(headers.slice(0, 6), SECURITY_FIELDS),
      { classes: single.classes, stakeholders: single.stakeholders, securities: [], plans: single.company.plans });
    expect(legacy.creates[0].planId).toBe(single.company.plans[0].id);
    const written = await single.importRecords({ securities: legacy.creates });
    expect(written.securities).toBe(1);
    expect(single.securities.at(-1).planId).toBe(single.company.plans[0].id);
    expect(SECURITY_TEMPLATE[0]).toContain('Plan');
  });

  it('refuses a backup whose awards name no plan when several could hold them, and takes one that says', async () => {
    const { s, old, next } = await twoPlans();
    const data = s.exportAll();
    const award = { id: 'x1', kind: 'option', label: 'OPT-9', stakeholderId: 'h2', quantity: 100, strike: 1, date: '2026-02-01', vestingMonths: 0 };
    await expect(s.importAll({ ...data, securities: [...data.securities, award] }, { label: 'x' }))
      .rejects.toThrow(/OPT-9 names no plan, and more than one plan in the file could hold it/);
    expect(s.securities).toHaveLength(1);
    await s.importAll({ ...data, securities: [...data.securities, { ...award, planId: next.id }, { ...award, id: 'x2', label: 'OPT-10', outsidePlan: true }] }, { label: 'x' });
    expect(s.security('x1').planId).toBe(next.id);
    expect(s.security('x2').outsidePlan).toBe(true);
    expect(s.company.plans.map((p) => p.id)).toEqual([old.id, next.id]);
    // A backup written before plans existed maps its pool to one plan and every award to it.
    const legacy = makeStore();
    await legacy.importAll({
      company: { name: 'Old', poolAuthorized: 1000, poolHistory: [{ date: '2024-06-10', before: 0, after: 1000, seq: 1 }] },
      classes: legacy.classes, stakeholders: legacy.stakeholders,
      securities: [{ ...award, id: 'y1' }],
    }, { label: 'x' });
    expect(legacy.company.plans).toHaveLength(1);
    expect(legacy.security('y1').planId).toBe(legacy.company.plans[0].id);
    expect(fullyDiluted(legacy.securities, legacy.company)).toBe(1000);
    expect(awardPlanId(legacy.security('y1'), plansOf(legacy.company))).toBe(legacy.company.plans[0].id);
    // The migrated plan has no adoption date on record, and can be renamed without one.
    const migrated = await legacy.updatePlan(legacy.company.plans[0].id, { name: '2024 Plan', recycling: { exercise: 'return' } });
    expect(migrated).toMatchObject({ name: '2024 Plan', adopted: '' });
    expect(migrated.recycling.exercise).toBe('return');
    expect(resolvePlan({ kind: 'option', date: '2026-02-01' }, s.company.plans).candidates).toHaveLength(2);
  });

  it('survives an export and import round trip and a restore point', async () => {
    const { s, old, next } = await twoPlans();
    await s.addSecurity({ kind: 'option', stakeholderId: 'h2', planId: old.id, quantity: 40_000, strike: 1, date: '2024-07-01', vestingMonths: 0 });
    await s.transferReserve({ fromPlanId: old.id, toPlanId: next.id, quantity: 25_000, date: '2026-02-01' });
    const before = JSON.stringify([s.company.plans, planBalances(s.db).plans.map((r) => [r.planId, r.authorized, r.committed])]);
    const data = s.exportAll();
    await s.importAll(data, { label: 'round trip' });
    expect(JSON.stringify([s.company.plans, planBalances(s.db).plans.map((r) => [r.planId, r.authorized, r.committed])])).toBe(before);
    await s.resizePlanReserve(old.id, { size: 74_000, date: '2026-03-01' });
    await s.restoreFromPoint(s.restorePoints[0].id);
    expect(s.plan(old.id).reserve).toBe(75_000);
    expectReconciled(s.db);
  });

  it('lists an expired plan still holding unallocated shares among the things needing attention', async () => {
    const { s, old } = await twoPlans();
    await s.updatePlan(old.id, { expires: '2026-01-31' });
    const items = attentionItems(s.db, { asOf: '2026-03-01' });
    expect(items.find((i) => i.type === 'plan-expired')).toMatchObject({ planId: old.id, quantity: 100_000, date: '2026-01-31' });
    expect(attentionItems(s.db, { asOf: '2026-01-15' }).some((i) => i.type === 'plan-expired')).toBe(false);
    await s.retirePlan(old.id, { date: '2026-02-01' });
    expect(attentionItems(s.db, { asOf: '2026-03-01' }).some((i) => i.type === 'plan-expired')).toBe(false);
  });
});

describe('plans: a randomized reconciliation', () => {
  it('keeps opening + movements = closing on every plan through random lifecycle events', async () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const day = (year) => `${year}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
    const { s, old, next } = await twoPlans();
    await s.updatePlan(old.id, { recycling: { cancellation: next.id, exercise: 'return' } });
    const awards = [];
    for (let i = 0; i < 40; i++) {
      const roll = rnd();
      try {
        if (roll < 0.35 || !awards.length) {
          const plan = pick([old, next, null]);
          const kind = pick(['option', 'rsu']);
          const a = await s.addSecurity({
            kind, stakeholderId: pick(['h2', 'h3']), classId: 'c1', strike: 1, quantity: 1 + Math.floor(rnd() * 2000),
            date: day(plan === next ? 2026 : 2025), vestingMonths: 0,
            ...(plan ? { planId: plan.id } : { outsidePlan: true }),
          });
          awards.push(a);
        } else if (roll < 0.55) {
          const a = s.security(pick(awards).id);
          const left = a.quantity - (a.cancelled || 0) - (a.kind === 'rsu' ? a.settled || 0 : a.exercised || 0);
          if (left > 0) {
            await s.updateSecurity(a.id, { cancellations: [...(a.cancellations || (a.cancelled ? [{ quantity: a.cancelled, date: a.cancelledDate }] : [])),
              { quantity: 1 + Math.floor(rnd() * left), date: '2026-06-01' }] });
          }
        } else if (roll < 0.7) {
          const a = s.security(pick(awards).id);
          const left = a.quantity - (a.cancelled || 0) - (a.kind === 'rsu' ? a.settled || 0 : a.exercised || 0);
          if (left > 0 && a.kind === 'option') await s.exerciseOption(a.id, { quantity: 1 + Math.floor(rnd() * left), date: '2026-06-02', classId: 'c1' });
          if (left > 0 && a.kind === 'rsu') await s.settleRSU(a.id, { quantity: 1 + Math.floor(rnd() * left), date: '2026-06-02', classId: 'c1' });
        } else if (roll < 0.8) {
          await s.transferReserve({ fromPlanId: old.id, toPlanId: next.id, quantity: 1 + Math.floor(rnd() * 5000), date: '2026-06-03' });
        } else if (roll < 0.9) {
          await s.resizePlanReserve(pick([old, next]).id, { size: 50_000 + Math.floor(rnd() * 100_000), date: '2026-06-04' });
        } else {
          await s.recordSplit({ num: pick([2, 3]), den: pick([1, 2]), date: '2026-06-05' });
        }
      } catch (err) {
        // A refusal is the store holding its rules; the invariant has to hold either way.
        expect(isRefusal(err)).toBe(true);
      }
      expectReconciled(s.db);
      for (const date of ['2025-06-15', '2026-01-15', '2026-06-01', '2026-06-03']) expectReconciled(dbAsOf(s.db, date), { ledger: false });
    }
    expect(awards.length).toBeGreaterThan(5);
  });
});
