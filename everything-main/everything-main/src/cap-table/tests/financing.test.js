import { describe, it, expect } from 'vitest';
import { modelRound, exitWaterfall, exitBreakevenPoints, dbAsOf, fullyDiluted } from '../src/lib/captable.js';
import { validateProRata, validateMFN, validatePreferred, validateFinancing, dividendAccrual, electMFN, capTableDigest } from '../src/lib/financing.js';
import { Store } from '../src/lib/store.js';

export const date = '2025-01-01';
export const right = { id: 'right-1', agreement: 'Signed side letter', start: '2024-01-01', basis: 'fixed', fraction: 0.1, financings: ['A'] };
export function fixture() {
  return { company: { ...Store.defaultCompany(), poolAuthorized: 0 },
    classes: Store.sanitizeClasses([{ id: 'common', name: 'Common', kind: 'common' }]),
    stakeholders: Store.sanitizeStakeholders([{ id: 'founder', name: 'Founder' }, { id: 'investor', name: 'Investor' }]),
    securities: [
      { id: 'cs1', label: 'CS-1', kind: 'shares', classId: 'common', stakeholderId: 'founder', quantity: 900000, pricePerShare: 0.01, date: '2024-01-01' },
      { id: 'cs2', label: 'CS-2', kind: 'shares', classId: 'common', stakeholderId: 'investor', quantity: 100000, pricePerShare: 1, date: '2024-01-01', proRata: [right] },
    ] };
}
export const assumptions = (amount = 200000, mode = 'fixed') => ({ preMoney: 8000000, investment: 2000000, asOf: date,
  financing: { id: 'A', roundMode: mode, elections: [{ rightId: right.id, amount }], mfnElections: [] } });
const terms = (overrides = {}) => ({ id: 'amendment-1', date: '2024-01-01', agreement: 'Signed charter', ...overrides });
const dividendTerms = (overrides = {}) => ({ rate: 0.08, start: '2024-01-01', cumulative: true, convention: 'simple', dayCount: 'actual/365', atConversion: 'forfeit', atLiquidation: 'add', ...overrides });
const cap = { multiple: 3, basis: 'invested', includesPreference: true, includesDividends: true };

describe('dated exits without negotiated preferred terms', () => {
  it('pays the holders on the exit date before and after a transfer', () => {
    const db = fixture();
    db.securities = [
      { ...db.securities[0], quantity: 1000, closedAt: '2025-06-01', closedReason: 'transfer' },
      { ...db.securities[1], quantity: 1000, date: '2025-06-01', fromTransferId: 'cs1' },
    ];
    const before = exitWaterfall(db, { exitValue: 10000, asOf: date });
    expect(before.rows.find((r) => r.stakeholderId === 'founder')?.proceeds).toBeCloseTo(10000);
    expect(before.rows.some((r) => r.stakeholderId === 'investor')).toBe(false);
    const after = exitWaterfall(db, { exitValue: 10000, asOf: '2025-06-01' });
    expect(after.rows.find((r) => r.stakeholderId === 'investor')?.proceeds).toBeCloseTo(10000);
  });
  it('excludes future preferred, notes and awards from payouts and breakevens', () => {
    const db = fixture();
    db.classes.push({ id: 'pref', name: 'Future preferred', kind: 'preferred', liquidationMultiple: 1 });
    db.securities[1] = { ...db.securities[1], classId: 'pref', date: '2025-06-01' };
    db.securities.push({ id: 'note', kind: 'note', stakeholderId: 'investor', date: '2025-06-01', principal: 100000 },
      { id: 'award', kind: 'option', stakeholderId: 'investor', date: '2025-06-01', quantity: 100000, strike: 0 });
    const out = exitWaterfall(db, { exitValue: 1000000, asOf: date });
    expect(out.rows.find((r) => r.stakeholderId === 'founder')?.proceeds).toBeCloseTo(1000000);
    expect(out.awards).toEqual([]);
    expect(out.convertibles).toEqual([]);
    expect([...exitBreakevenPoints(db, { asOf: date })]).toEqual([]);
  });
});

function preferredFixture(amendment = terms({ cap })) {
  const db = fixture(); delete db.securities[1].proRata;
  db.classes.push({ id: 'preferred', name: 'Preferred', kind: 'preferred', liquidationMultiple: 1, participating: true, seniority: 1, preferredTerms: [amendment] });
  db.securities = [ { ...db.securities[0], quantity: 1000000 }, { ...db.securities[1], classId: 'preferred', quantity: 1000000, economicBasis: { principal: 1000000, date: '2024-01-01' } } ];
  return db;
}

describe('worked participation examples', () => {
  it.each([[200000, 1800000, .10], [100000, 1900000, .09], [0, 2000000, .08]])('fixed round with %s elected', (amount, remaining, ownership) => {
    const out = modelRound(fixture(), assumptions(amount));
    expect(out.unsupported).toBeUndefined(); expect(out.pps).toBe(8);
    expect(out.financing.allocations[0].entitlement).toBe(200000);
    expect(out.financing.remaining).toBe(remaining); expect(out.postMoney).toBe(10000000);
    expect(out.dilution.find((r) => r.stakeholderId === 'investor').after).toBeCloseTo(ownership, 12);
    expect(out.dilution.reduce((a, r) => a + r.after, 0)).toBeCloseTo(1, 12);
  });
  it('refuses a round whose elected checks leave less than one share for other investors', () => {
    /* $1,000 a share; a $999,000 election out of $999,400 leaves $400 - one
       certificate of no shares, which the close would refuse at its last step. */
    const db = fixture();
    db.securities[1].proRata = [{ ...right, fraction: 1 }];
    const out = modelRound(db, { preMoney: 1_000_000_000, investment: 999_400, asOf: date,
      financing: { id: 'A', roundMode: 'fixed', elections: [{ rightId: right.id, amount: 999_000 }], mfnElections: [] } });
    expect(out.pps).toBe(1000);
    expect(out.financing.remaining).toBe(400);
    expect(out.financing.remainingShares).toBe(0);
    expect(out.unsupported).toMatch(/left for other investors.*no whole share/);
    // A round the elections take whole, and one that leaves a share, both price.
    expect(modelRound(db, { preMoney: 1_000_000_000, investment: 999_000, asOf: date,
      financing: { id: 'A', roundMode: 'fixed', elections: [{ rightId: right.id, amount: 999_000 }], mfnElections: [] } }).unsupported).toBeUndefined();
    expect(modelRound(db, { preMoney: 1_000_000_000, investment: 999_600, asOf: date,
      financing: { id: 'A', roundMode: 'fixed', elections: [{ rightId: right.id, amount: 999_000 }], mfnElections: [] } }).unsupported).toBeUndefined();
  });
  it('explicitly increases the raise in additional mode', () => {
    const out = modelRound(fixture(), assumptions(200000, 'additional'));
    expect(out.financing.investment).toBe(2200000); expect(out.financing.remaining).toBe(2000000);
    expect(out.financing.allocations[0].entitlement).toBe(220000);
    expect(out.postMoney).toBe(10200000);
  });
  it('refuses excess elections, unknown rights and invalid dates', () => {
    expect(modelRound(fixture(), assumptions(200001)).unsupported).toMatch(/exceed entitlement/);
    expect(modelRound(fixture(), assumptions(2000001)).unsupported).toMatch(/exceed the fixed/);
    const db = fixture(); db.securities[1].proRata[0] = { ...right, end: '2024-12-31' };
    expect(modelRound(db, assumptions()).unsupported).toMatch(/ineligible/);
  });
  it('mixed SAFE conventions, notes, anti-dilution and pool top-up reconcile within the same solve', () => {
    const db = fixture();
    db.classes.push({ id: 'pref', name: 'Seed', kind: 'preferred', liquidationMultiple: 1, pricePerShare: 20, conversionPrice: 20, antiDilution: 'broad' });
    db.securities.push({ id: 'seed', kind: 'shares', classId: 'pref', stakeholderId: 'investor', quantity: 10000, pricePerShare: 20, date: '2024-01-01' },
      { id: 'pre', kind: 'safe', label: 'PRE', stakeholderId: 'investor', date: '2024-01-01', principal: 100000, valuationCap: 6000000, discount: 10, safeType: 'pre' },
      { id: 'post', kind: 'safe', label: 'POST', stakeholderId: 'investor', date: '2024-01-01', principal: 100000, valuationCap: 7000000, discount: 0, safeType: 'post' },
      { id: 'note', kind: 'note', label: 'NOTE', stakeholderId: 'investor', date: '2024-01-01', principal: 50000, valuationCap: 5000000, discount: 20, interestRate: 8 });
    const out = modelRound(db, { ...assumptions(), poolPct: .1 });
    expect(out.unsupported).toBeUndefined(); expect(out.conversions).toHaveLength(3); expect(out.antiDilutionShares).toBeGreaterThan(0);
    expect(out.postFD).toBe(out.fdPre + out.conversionShares + out.antiDilutionShares + out.poolAdd + out.investorShares);
    expect(out.dilution.reduce((a, r) => a + r.after, 0)).toBeCloseTo(1, 9);
    expect(out.poolAfter / out.postFD).toBeCloseTo(.1, 5);
  });
  it('distinguishes original YC rights from post-money side letters', () => {
    const db = fixture(); delete db.securities[1].proRata;
    const safe = { id: 'safe', kind: 'safe', label: 'SAFE', stakeholderId: 'investor', date: '2024-01-01', principal: 100000, valuationCap: 5000000, safeType: 'post', proRata: [{ ...right, basis: 'yc-post-money', fraction: undefined }] };
    delete safe.proRata[0].fraction; db.securities.push(safe);
    const out = modelRound(db, assumptions(1000));
    expect(out.financing.allocations[0].fraction).toBeCloseTo(.02, 5);
    safe.proRata[0].basis = 'yc-original';
    expect(modelRound(db, assumptions(1000)).unsupported).toMatch(/after its conversion/);
  });
  it('expires a post-money side letter after its SAFE converts without blocking later rounds', () => {
    const db = fixture(); delete db.securities[1].proRata;
    const { fraction, ...sideLetter } = right;
    db.securities.push({ id: 'safe', kind: 'safe', stakeholderId: 'investor', date: '2024-01-01',
      principal: 100000, valuationCap: 5000000, safeType: 'post', convertedAt: '2024-12-01',
      proRata: [{ ...sideLetter, basis: 'yc-post-money', financings: ['*'] }] });
    const inputs = { ...assumptions(), financing: { ...assumptions().financing, id: 'B', elections: [] } };
    const later = modelRound(db, inputs);
    expect(later.unsupported).toBeUndefined();
    expect(later.financing.allocations).toEqual([]);
    expect(modelRound(db, { ...inputs, financing: { ...inputs.financing,
      elections: [{ rightId: right.id, amount: 1000 }] } }).unsupported).toMatch(/ineligible/);
    const beforeConversion = modelRound(db, { ...inputs, asOf: '2024-11-01' });
    expect(beforeConversion.unsupported).toBeUndefined();
    expect(beforeConversion.financing.allocations[0].fraction).toBeGreaterThan(0);
  });
});

describe('MFN is an explicit dated election', () => {
  it('refuses ambiguous election IDs instead of choosing an instrument by array order', () => {
    const db = fixture(); delete db.securities[1].proRata;
    for (const id of ['first', 'second']) {
      db.securities.push({ id, label: id, kind: 'safe', stakeholderId: id === 'first' ? 'founder' : 'investor',
        date: '2024-01-01', principal: 100000, valuationCap: 8000000, safeType: 'pre',
        mfn: { agreement: 'MFN', start: '2024-01-01', scope: ['valuationCap'], eligibleKinds: ['safe'],
          elections: [{ id: 'shared-id', sourceId: 'source', sourceDate: '2024-06-01', date: '2024-07-01',
            agreement: 'Election notice', financings: ['A'], terms: { valuationCap: 5000000 } }] } });
    }
    const inputs = { ...assumptions(), financing: { ...assumptions().financing, elections: [], mfnElections: ['shared-id'] } };
    expect(modelRound(db, inputs).unsupported).toMatch(/ambiguous MFN election/i);
    db.securities.reverse();
    expect(modelRound(db, inputs).unsupported).toMatch(/ambiguous MFN election/i);
    expect(modelRound(db, { ...inputs, financing: { ...inputs.financing, mfnElections: [] } }).unsupported).toBeUndefined();
  });
  it('snapshots eligible later terms and changes only the selected scenario', () => {
    const db = fixture(); delete db.securities[1].proRata;
    const original = { id: 'safe', kind: 'safe', label: 'SAFE', stakeholderId: 'investor', date: '2024-01-01', principal: 100000, valuationCap: 8000000, safeType: 'pre', discount: 0,
      mfn: { agreement: 'MFN letter', start: '2024-01-01', end: '2024-12-31', scope: ['valuationCap'], eligibleKinds: ['safe'], elections: [] } };
    const later = { ...original, id: 'later', label: 'Later', date: '2024-06-01', valuationCap: 5000000, principal: 1000, mfn: undefined };
    db.securities.push(original, later);
    const election = electMFN(db, original, { id: 'e1', sourceId: 'later', date: '2024-07-01', agreement: 'Election notice', financings: ['A'] });
    original.mfn.elections.push(election);
    const a = { ...assumptions(0), financing: { ...assumptions().financing, elections: [], mfnElections: ['e1'] } };
    const elected = modelRound(db, a);
    expect(elected.conversions.find((c) => c.securityId === 'safe').price).toBe(5);
    expect(original.valuationCap).toBe(8000000);
    later.valuationCap = 2000000;
    expect(modelRound(db, a).conversions.find((c) => c.securityId === 'safe').price).toBe(5);
    expect(modelRound(db, { ...a, asOf: '2024-06-30' }).unsupported).toMatch(/not applicable/);
    expect(modelRound(db, { ...a, financing: { ...a.financing, id: 'B' } }).unsupported).toMatch(/not applicable/);
    expect(() => electMFN(db, original, { id: 'x', sourceId: original.id, date, agreement: 'No', financings: ['A'] })).toThrow(/later instrument/);
  });
});

describe('preferred cap / conversion breakpoints and conservation', () => {
  it.each([[0, 0], [500000, 500000], [1000000, 1000000], [4000000, 2500000], [6000000, 3000000], [8000000, 4000000]])('exit %s pays preferred %s', (exitValue, preferred) => {
    const out = exitWaterfall(preferredFixture(), { exitValue, asOf: date });
    expect(out.unsupported).toBeUndefined(); expect(out.classes[0].proceeds).toBeCloseTo(preferred, 5);
    expect(out.distributed).toBeCloseTo(exitValue, 5);
  });
  it('distinguishes residual-only caps from total-return caps', () => {
    const db = preferredFixture(terms({ cap: { ...cap, includesPreference: false } }));
    const out = exitWaterfall(db, { exitValue: 7000000, asOf: date });
    expect(out.classes[0].proceeds).toBeCloseTo(4000000, 5);
  });
  it('conserves proceeds with multiple seniority tiers, caps and award strikes', () => {
    const db = preferredFixture();
    db.classes.push({ ...db.classes[1], id: 'senior', name: 'Senior', seniority: 2, preferredTerms: [terms({ cap: { ...cap, multiple: 2 } })] });
    db.securities.push({ ...db.securities[1], id: 'p2', classId: 'senior', quantity: 500000, pricePerShare: 2 },
      { id: 'option', kind: 'option', stakeholderId: 'founder', quantity: 100000, strike: 2, date: '2024-01-01' });
    for (let exitValue = 0; exitValue <= 20000000; exitValue += 125000) {
      const out = exitWaterfall(db, { exitValue, asOf: date });
      expect(out.unsupported).toBeUndefined(); expect(out.distributed).toBeCloseTo(exitValue, 4);
      for (const row of out.rows) expect(row.proceeds).toBeGreaterThanOrEqual(0);
      for (const cls of out.classes) expect(cls.proceeds + 1e-4).toBeGreaterThanOrEqual(cls.asConverted);
    }
  });
  it('lists paid holders only, largest first, the way the standard waterfall does', () => {
    const db = preferredFixture();
    db.stakeholders.push(...Store.sanitizeStakeholders([{ id: 'second', name: 'Second founder' }]));
    db.securities.push({ ...db.securities[0], id: 'cs3', label: 'CS-3', stakeholderId: 'second', quantity: 500000 });
    const under = exitWaterfall(db, { exitValue: 500000, asOf: date });
    expect(under.rows.map((r) => r.stakeholderId)).toEqual(['investor']);
    expect(under.distributed).toBeCloseTo(500000, 5);
    const over = exitWaterfall(db, { exitValue: 4000000, asOf: date });
    expect(over.rows.map((r) => r.stakeholderId)).toEqual(['investor', 'founder', 'second']);
    expect(over.rows.map((r) => r.proceeds)).toEqual([...over.rows.map((r) => r.proceeds)].sort((a, b) => b - a));
  });
  it('refuses unsupported SAFE combinations instead of approximating them', () => {
    const db = preferredFixture(); db.securities.push({ id: 'safe', kind: 'safe', principal: 100, date: '2024-01-01' });
    expect(exitWaterfall(db, { exitValue: 1e6, asOf: date }).unsupported).toMatch(/unconverted SAFEs/);
  });
  it('does not apply a future preferred amendment to an earlier exit', () => {
    const db = preferredFixture();
    delete db.classes[1].preferredTerms;
    db.securities.push({ id: 'safe', label: 'SAFE', kind: 'safe', stakeholderId: 'founder', principal: 100000, date: '2024-01-01' });
    const before = exitWaterfall(db, { exitValue: 4000000, asOf: date });
    db.classes[1].preferredTerms = [terms({ date: '2025-06-01', cap })];
    expect(exitWaterfall(db, { exitValue: 4000000, asOf: date })).toEqual(before);
    expect(exitWaterfall(db, { exitValue: 4000000, asOf: '2025-06-01' }).unsupported).toMatch(/unconverted SAFEs/);
  });
});

describe('dividend calendar, payment and amendment examples', () => {
  const calculate = (d, date, events = [], extra = []) => {
    const db = preferredFixture(terms({ dividends: d })); const cert = db.securities[1]; cert.dividendEvents = events;
    db.classes[1].preferredTerms.push(...extra);
    return dividendAccrual(cert, db.classes[1], date);
  };
  it('simple ACT/365 accrual accounts for dated payments', () => {
    const out = calculate(dividendTerms(), '2024-12-31', [{ id: 'paid', date: '2024-12-31', amount: 30000, type: 'payment', evidence: 'Bank receipt' }]);
    expect(out.accrued).toBeCloseTo(80000); expect(out.balance).toBeCloseTo(50000);
  });
  it('compound accrual is $166,400 over two 365-day years', () => {
    expect(calculate(dividendTerms({ convention: 'compound' }), '2025-12-31').balance).toBeCloseTo(166400);
  });
  it('does not accrue non-cumulative dividends and refuses overpayments', () => {
    const d = dividendTerms({ cumulative: false });
    expect(calculate(d, date).balance).toBe(0);
    expect(calculate(d, date, [{ id: 'decl', date: '2024-07-01', amount: 10000, type: 'declared', evidence: 'Board resolution' }]).balance).toBe(10000);
    expect(() => calculate(d, date, [{ id: 'pay', date: '2024-07-01', amount: 1, type: 'payment', evidence: 'Receipt' }])).toThrow(/exceeds/);
  });
  it('accepts a payment of the balance rounded to the cent and refuses a cent more', () => {
    // 366 days at 8% on $1m is $80,219.178...; the wire is $80,219.18.
    const pay = (amount) => calculate(dividendTerms(), '2025-01-01', [{ id: 'pay', date: '2025-01-01', amount, type: 'payment', evidence: 'Wire' }]);
    expect(pay(80219.18).balance).toBe(0);
    expect(pay(80219.18).paid).toBe(80219.18);
    expect(() => pay(80219.19)).toThrow(/exceeds/);
  });
  it('settles a declaration before a payment recorded on the same day, whichever was entered first', () => {
    const d = dividendTerms({ cumulative: false });
    const declared = { id: 'decl', date: '2024-07-01', amount: 10000, type: 'declared', evidence: 'Board resolution' };
    const paid = { id: 'pay', date: '2024-07-01', amount: 10000, type: 'payment', evidence: 'Receipt' };
    for (const events of [[declared, paid], [paid, declared]]) {
      const out = calculate(d, date, events);
      expect(out.balance).toBe(0); expect(out.declared).toBe(10000); expect(out.paid).toBe(10000);
    }
  });
  it('later amendments leave historical accrual unchanged and cap accrual at end', () => {
    const amendment = { id: 'amendment-2', date: '2025-01-01', agreement: 'Amended charter', dividends: dividendTerms({ rate: .2 }) };
    expect(calculate(dividendTerms(), '2024-12-31', [], [amendment]).balance).toBeCloseTo(80000);
    expect(calculate(dividendTerms({ end: '2024-12-31' }), '2026-01-01').balance).toBeCloseTo(80000);
  });
  it('preserves principal through reverse splits and pro-rata transfers', () => {
    const db = preferredFixture(terms({ dividends: dividendTerms() }));
    const before = exitWaterfall(db, { exitValue: 2e6, asOf: '2024-12-31' });
    db.securities = Store.applySplit(db.securities, { num: 1, den: 3, id: 'split' }).securities;
    expect(dividendAccrual(db.securities[1], db.classes[1], '2024-12-31').balance).toBeCloseTo(80000);
    expect(exitWaterfall(db, { exitValue: 2e6, asOf: '2024-12-31' }).preferencePaid).toBeCloseTo(before.preferencePaid);
  });
});

describe('strict financing input preservation', () => {
  it('names the dividend accrual window in its own words when its end precedes its start', () => {
    expect(() => validatePreferred([terms({ dividends: dividendTerms({ start: '2024-06-01', end: '2024-01-01' }) })]))
      .toThrow(/Dividend accrual end precedes its start/);
    expect(() => validateProRata([{ id: 'r', agreement: 'a', start: '2024-06-01', end: '2024-01-01', basis: 'fixed', fraction: 0.1, financings: ['*'] }]))
      .toThrow(/Eligibility end precedes its start/);
  });
  it('rejects unsupported fields/conventions and invalid calendar dates', () => {
    expect(() => validateProRata([{ ...right, basis: 'custom' }])).toThrow(/unsupported/);
    expect(() => validatePreferred([terms({ extra: true })])).toThrow(/unsupported/);
    expect(() => validatePreferred([terms({ date: '2025-02-30' })])).toThrow(/valid date/);
    expect(() => validateFinancing({ ...assumptions().financing, roundMode: 'implicit' })).toThrow(/unsupported/);
  });
  it('preserves all structured terms through the sanitizers, and a scenario keeps its dated assumptions', () => {
    const db = preferredFixture(terms({ cap, dividends: dividendTerms() }));
    db.securities[1].proRata = [right];
    const classes = Store.sanitizeClasses(db.classes);
    const securities = Store.sanitizeSecurities(db.securities, { classes, stakeholders: db.stakeholders });
    expect(classes[1].preferredTerms).toEqual(db.classes[1].preferredTerms);
    expect(securities[1].proRata).toEqual([right]);
    expect(securities[1].economicBasis).toEqual(db.securities[1].economicBasis);
    const digest = capTableDigest({ ...db, classes, securities });
    const scenario = Store.sanitizeScenarios([{ id: 'A', ...assumptions(), basisDigest: digest }])[0];
    expect(scenario.financing).toEqual(assumptions().financing);
    expect(scenario.asOf).toBe(date);
    expect(scenario.basisDigest).toBe(digest);
    expect(() => Store.sanitizeScenarios([{ id: 'B', ...assumptions(), asOf: '2025-02-30' }])).toThrow(/valid date/);
  });
  it('fingerprints the cap table independent of key order and notices any change', () => {
    const db = fixture();
    const reordered = { ...db, securities: db.securities.map((s) => Object.fromEntries(Object.entries(s).reverse())) };
    expect(capTableDigest(reordered)).toBe(capTableDigest(db));
    const changed = { ...db, securities: db.securities.map((s, i) => (i === 1 ? { ...s, quantity: s.quantity + 1 } : s)) };
    expect(capTableDigest(changed)).not.toBe(capTableDigest(db));
    const renamed = { ...db, stakeholders: db.stakeholders.map((h, i) => (i === 0 ? { ...h, name: 'Founder 2' } : h)) };
    expect(capTableDigest(renamed)).not.toBe(capTableDigest(db));
  });
});
