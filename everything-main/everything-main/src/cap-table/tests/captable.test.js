import { describe, it, expect } from 'vitest';
import { exerciseRoom } from '../src/lib/captable.js';
import {
  vestedQuantity, sharesOutstanding, optionsGranted, poolRemaining, fullyDiluted,
  issuedInClass, convertibleValue, conversionPrice, ownershipByStakeholder,
  ownershipByClass, modelRound, classPrefix, nextLabel, capitalRaised,
  impliedValuation, latestPricedIssuance, postMoneyOwnership, isPostMoneySafe,
  warrantsOutstanding, hasVesting, vestingStartDate, vestingPosition, unvestedQuantity, unvestedTotal,
  optionsDiluted, grantDiluted, certifiedByGrant, grantOutstanding, grantVested, grantExercised, grantStatus,
  currentFMV, fmvStatus, upcomingEvents, dbAsOf, issuanceHistory, unsplitQuantity, poolAsOf,
  exitWaterfall, exitBreakevens, exitBreakevenPoints,
  isISO, isoLimitValueByYear, isoOverLimitYears, isoGrantOverYears, isoBasisNote, ISO_ANNUAL_LIMIT,
  vestingTranches, acceleratedVested, hasAcceleration,
  rsuOutstanding, rsuVested, rsuSettled, rsuDiluted, rsusDiluted, rsuStatus,
  certifiedByRsu, hasLiquidityCondition, poolDrawn, countsInDiluted, dilutedShares,
  exerciseEconomics, qualifyingDispositionDate,
  vestingForecast, scheduledShares, FORECAST_MONTHS,
  attentionItems, isMatured,
  antiDilutionAdjustments, hasAntiDilution, conversionPriceOf, isAntiDilutionShares,
  poolForecast, plannedShares, POOL_FORECAST_MONTHS, poolTargetToCover,
  needs83b, deadline83b, status83b, DAYS_83B, exerciseCutoff, isClosed,
} from '../src/lib/captable.js';

/* ---------- Fixtures ---------- */

const cls = (id, name, kind = 'common') => ({ id, name, kind, authorized: 10_000_000, pricePerShare: 0.0001 });
const holder = (id, name, kind = 'founder') => ({ id, name, kind });

function makeDb() {
  const classes = [cls('c1', 'Common Stock'), cls('p1', 'Series Seed Preferred', 'preferred')];
  const stakeholders = [
    holder('h1', 'Ada'), holder('h2', 'Grace'),
    holder('h3', 'Sam', 'employee'), holder('h4', 'Nova Ventures', 'investor'),
  ];
  const securities = [
    { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 4_000_000, pricePerShare: 0.0001, date: '2023-05-20' },
    { id: 's2', kind: 'shares', label: 'CS-2', stakeholderId: 'h2', classId: 'c1', quantity: 3_000_000, pricePerShare: 0.0001, date: '2023-05-20' },
    { id: 's3', kind: 'shares', label: 'SS-1', stakeholderId: 'h4', classId: 'p1', quantity: 2_000_000, pricePerShare: 0.5, date: '2024-06-10' },
    { id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h3', quantity: 500_000, strike: 0.1, grantDate: '2024-07-01', vestingMonths: 48, cliffMonths: 12, exercised: 0, date: '2024-07-01' },
  ];
  return { company: { name: 'Test Co', poolAuthorized: 1_000_000 }, classes, stakeholders, securities };
}

/* ---------- Vesting ---------- */

describe('vestingPosition', () => {
  it('reads the position a schedule was written for, not what the record holds', () => {
    // The ordinary case: the schedule covers exactly the position.
    expect(vestingPosition({ quantity: 1000, vestingMonths: 48 })).toBe(1000);
    /* A repurchase out of the unvested tail leaves the whole schedule on a
       smaller certificate - recorded as vestingBase for a time-based
       schedule, and in the tranches themselves for a custom one. */
    expect(vestingPosition({ quantity: 900, vestingBase: 1000, vestingMonths: 48 })).toBe(1000);
    expect(vestingPosition({
      quantity: 900,
      vestingTranches: [{ date: '2025-01-01', quantity: 500 }, { date: '2026-01-01', quantity: 500 }],
    })).toBe(1000);
    // A tranche list covering less than the position is a milestone schedule,
    // and the position is still the record's own size.
    expect(vestingPosition({ quantity: 900, vestingTranches: [{ date: '2025-01-01', quantity: 400 }] })).toBe(900);
    expect(vestingPosition(null)).toBe(0);
  });
});

describe('vestedQuantity', () => {
  const grant = { quantity: 48_000, grantDate: '2024-01-15', vestingMonths: 48, cliffMonths: 12 };

  it('vests nothing before the cliff', () => {
    expect(vestedQuantity(grant, '2024-01-15')).toBe(0);
    expect(vestedQuantity(grant, '2025-01-14')).toBe(0);
  });

  it('vests the cliff fraction exactly at the cliff', () => {
    expect(vestedQuantity(grant, '2025-01-15')).toBe(12_000);
  });

  it('vests linearly by whole months after the cliff', () => {
    expect(vestedQuantity(grant, '2025-02-15')).toBe(13_000);
    // One day short of the next monthly step changes nothing.
    expect(vestedQuantity(grant, '2025-03-14')).toBe(13_000);
  });

  it('is fully vested at and after the end of the schedule', () => {
    expect(vestedQuantity(grant, '2028-01-15')).toBe(48_000);
    expect(vestedQuantity(grant, '2030-06-01')).toBe(48_000);
  });

  it('treats a grant without a schedule as fully vested', () => {
    expect(vestedQuantity({ quantity: 100, grantDate: '2024-01-01', vestingMonths: 0 }, '2024-01-02')).toBe(100);
  });

  it('floors partial shares', () => {
    const odd = { quantity: 100, grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 0 };
    // 7 months of 48: 100 * 7/48 = 14.58… → 14
    expect(vestedQuantity(odd, '2024-08-01')).toBe(14);
  });
});

describe('vesting on share certificates', () => {
  const founder = {
    kind: 'shares', quantity: 4_000_000, date: '2023-05-20',
    vestingMonths: 48, cliffMonths: 12, vestingStart: '2023-05-20',
  };

  it('runs the same schedule certificates and grants share', () => {
    expect(vestedQuantity(founder, '2024-05-19')).toBe(0);
    expect(vestedQuantity(founder, '2024-05-20')).toBe(1_000_000);
    expect(vestedQuantity(founder, '2027-05-20')).toBe(4_000_000);
    expect(unvestedQuantity(founder, '2024-05-20')).toBe(3_000_000);
  });

  it('starts the clock at vestingStart, not the issue date', () => {
    // Shares issued at incorporation, vesting from an earlier start date.
    const early = { ...founder, date: '2023-11-20', vestingStart: '2023-05-20' };
    expect(vestedQuantity(early, '2024-05-20')).toBe(1_000_000);
    // Without a vestingStart the issue date is the fallback.
    const { vestingStart, ...noStart } = early;
    expect(vestedQuantity(noStart, '2024-05-20')).toBe(0);
    expect(vestingStartDate(noStart)).toBe('2023-11-20');
  });

  it('treats a certificate with no schedule as fully vested', () => {
    const plain = { kind: 'shares', quantity: 1000, date: '2024-01-01' };
    expect(hasVesting(plain)).toBe(false);
    expect(vestedQuantity(plain, '2024-01-02')).toBe(1000);
    expect(unvestedQuantity(plain, '2024-01-02')).toBe(0);
  });

  it('leaves ownership math alone - unvested shares are still outstanding', () => {
    const db = makeDb();
    db.securities = db.securities.map((s) => (s.id === 's1'
      ? { ...s, vestingMonths: 48, cliffMonths: 12, vestingStart: '2023-05-20' }
      : s));
    expect(sharesOutstanding(db.securities)).toBe(9_000_000);
    expect(fullyDiluted(db.securities, db.company.poolAuthorized)).toBe(10_000_000);
    const { rows } = ownershipByStakeholder(db, { base: 'outstanding' });
    expect(rows.find((r) => r.stakeholderId === 'h1').shares).toBe(4_000_000);
  });

  it('totals unvested equity across certificates and grants only', () => {
    const securities = [
      { kind: 'shares', quantity: 4_000_000, date: '2023-05-20', vestingMonths: 48, cliffMonths: 12, vestingStart: '2023-05-20' },
      { kind: 'option', quantity: 48_000, grantDate: '2023-05-20', vestingMonths: 48, cliffMonths: 12 },
      { kind: 'shares', quantity: 1_000_000, date: '2023-05-20' },
      { kind: 'warrant', quantity: 100_000, date: '2023-05-20' },
      { kind: 'safe', principal: 250_000, date: '2023-05-20' },
    ];
    // One year in: both vesting instruments are 25% vested, the rest is untouched.
    expect(unvestedTotal(securities, '2024-05-20')).toBe(3_000_000 + 36_000);
  });

  it('never counts early-exercised unvested shares on both the grant and its certificate', () => {
    // 1M grant, 48-month vest from 2025-01-01, 400k early-exercised into a
    // certificate that carries the schedule. On 2026-01-01 (25% vested) the
    // true unvested balance is 750k - not 750k on the grant plus another
    // 300k on the certificate.
    const grant = {
      id: 'o1', kind: 'option', quantity: 1_000_000, exercised: 400_000,
      grantDate: '2025-01-01', vestingMonths: 48, cliffMonths: 12, earlyExercise: true,
    };
    const cert = {
      id: 'x1', kind: 'shares', quantity: 400_000, fromOptionId: 'o1', date: '2025-06-01',
      vestingMonths: 48, cliffMonths: 12, vestingStart: '2025-01-01',
    };
    const securities = [grant, cert];
    expect(unvestedQuantity(cert, '2026-01-01')).toBe(300_000);
    expect(unvestedQuantity(grant, '2026-01-01', securities)).toBe(450_000);
    expect(unvestedTotal(securities, '2026-01-01')).toBe(750_000);
    // A plain (vested) exercise takes no schedule along: everything unvested
    // stays on the grant.
    const plainCert = { id: 'x2', kind: 'shares', quantity: 100_000, fromOptionId: 'o2', date: '2026-01-02' };
    const plainGrant = {
      id: 'o2', kind: 'option', quantity: 1_000_000, exercised: 100_000,
      grantDate: '2025-01-01', vestingMonths: 48, cliffMonths: 12,
    };
    expect(unvestedTotal([plainGrant, plainCert], '2026-01-01')).toBe(750_000);
  });
});

/* ---------- Aggregates ---------- */

describe('aggregates', () => {
  const db = makeDb();

  it('counts outstanding shares (certificates only)', () => {
    expect(sharesOutstanding(db.securities)).toBe(9_000_000);
  });

  it('counts granted options and the remaining pool', () => {
    expect(optionsGranted(db.securities)).toBe(500_000);
    expect(poolRemaining(db.company.poolAuthorized, db.securities)).toBe(500_000);
  });

  it('never lets the pool go negative', () => {
    expect(poolRemaining(100, db.securities)).toBe(0);
  });

  it('computes fully diluted with and without the unallocated pool', () => {
    expect(fullyDiluted(db.securities, db.company.poolAuthorized)).toBe(10_000_000);
    expect(fullyDiluted(db.securities, db.company.poolAuthorized, { includePool: false })).toBe(9_500_000);
  });

  it('sums issuance per class', () => {
    expect(issuedInClass(db.securities, 'c1')).toBe(7_000_000);
    expect(issuedInClass(db.securities, 'p1')).toBe(2_000_000);
  });

  it('values the company at the latest preferred round price', () => {
    const db = makeDb(); // preferred SS-1 at $0.50 is the latest priced round
    expect(impliedValuation(db)).toBeCloseTo(0.5 * 10_000_000, 6);
  });

  it('does not let later par-value common reset the valuation', () => {
    const db = makeDb();
    db.securities.push({
      id: 's9', kind: 'shares', label: 'CS-3', stakeholderId: 'h3', classId: 'c1',
      quantity: 50_000, pricePerShare: 0.0001, date: '2026-01-15',
    });
    // FD grows by the new grant, but the price stays the Series Seed price.
    expect(impliedValuation(db)).toBeCloseTo(0.5 * 10_050_000, 6);
  });

  it('does not let a transfer successor reset the valuation or fake a round', () => {
    const db = makeDb();
    // A 2026 secondary sale of Series Seed stock: the original certificate
    // closes and the buyer's successor inherits the issue price under the
    // transfer's date.
    db.securities = db.securities.map((s) => (s.classId === 'p1'
      ? { ...s, closedAt: '2026-04-01', closedReason: 'transfer' }
      : s));
    db.securities.push({
      id: 's9', kind: 'shares', label: 'SS-2', stakeholderId: 'h3', classId: 'p1',
      quantity: 2_000_000, pricePerShare: 0.5, date: '2026-04-01', fromTransferId: 's3',
    });
    // The latest pricing event is still the original 2025 issuance.
    const priced = latestPricedIssuance(db.securities, new Set(['p1']));
    expect(priced.date).not.toBe('2026-04-01');
    // And a 409A recorded after the round sees no "round since".
    db.company.valuations = [{ id: 'v1', date: '2025-07-01', fmvPerShare: 0.05 }];
    expect(fmvStatus(db, '2026-05-01').roundSince).toBeNull();
  });

  it('does not let an exercise certificate reset the valuation', () => {
    const db = makeDb();
    db.securities = db.securities.filter((s) => s.classId !== 'p1');
    const before = latestPricedIssuance(db.securities);
    // 10,000 options exercised at a $0.25 strike into common, years after
    // the founders' par-value issuance: the grant's terms, not a round.
    db.securities.push({
      id: 's9', kind: 'shares', label: 'CS-9', stakeholderId: 'h3', classId: 'c1',
      quantity: 10_000, pricePerShare: 0.25, date: '2026-03-01', fromOptionId: 'o1',
    });
    expect(latestPricedIssuance(db.securities)).toEqual(before);
    const fd = fullyDiluted(db.securities, db.company.poolAuthorized);
    expect(impliedValuation(db)).toBeCloseTo(before.pricePerShare * fd, 6);
  });

  it('falls back to common pricing when no preferred was ever issued', () => {
    const db = makeDb();
    db.securities = db.securities.filter((s) => s.classId !== 'p1');
    const fd = fullyDiluted(db.securities, db.company.poolAuthorized);
    expect(impliedValuation(db)).toBeCloseTo(0.0001 * fd, 6);
  });

  it('returns null when nothing was ever priced', () => {
    const db = makeDb();
    db.securities = db.securities.map((s) => (s.kind === 'shares' ? { ...s, pricePerShare: 0 } : s));
    expect(impliedValuation(db)).toBeNull();
    expect(latestPricedIssuance(db.securities)).toBeNull();
  });

  it('grantDiluted reads the same from the array and the certifiedByGrant index', () => {
    const db = makeDb();
    db.securities.push({
      id: 'x1', kind: 'shares', label: 'CS-9', stakeholderId: 'h3', classId: 'c1',
      quantity: 100_000, pricePerShare: 0.1, date: '2026-01-01', fromOptionId: 'o1',
    });
    const grant = db.securities.find((s) => s.id === 'o1');
    const index = certifiedByGrant(db.securities);
    expect(grantDiluted(grant, index)).toBe(grantDiluted(grant, db.securities));
    expect(grantDiluted(grant, index)).toBe(400_000);
  });

  it('totals capital raised from priced shares and convertibles', () => {
    const raised = capitalRaised([
      { kind: 'shares', quantity: 100, pricePerShare: 2 },
      { kind: 'safe', principal: 1000 },
      { kind: 'note', principal: 500 },
    ]);
    expect(raised).toBe(1700);
  });

  it('counts a converted note at its principal, not with its interest', () => {
    // $1M note at 8% converting after two years alongside $5M of new money:
    // the note's certificate is sized from principal plus interest, but the
    // company only ever received the principal.
    const raised = capitalRaised([
      { id: 'n1', kind: 'note', principal: 1_000_000, interestRate: 8, date: '2024-01-01', convertedAt: '2026-01-01', convertedToId: 'c1' },
      { id: 'c1', kind: 'shares', quantity: 1_160_000, pricePerShare: 1, date: '2026-01-01', fromConvertibleId: 'n1' },
      { id: 'c2', kind: 'shares', quantity: 5_000_000, pricePerShare: 1, date: '2026-01-01' },
    ]);
    expect(raised).toBe(6_000_000);
    // With the note itself gone, the certificate is all that is left to count.
    expect(capitalRaised([
      { id: 'c1', kind: 'shares', quantity: 1_160_000, pricePerShare: 1, date: '2026-01-01', fromConvertibleId: 'n1' },
    ])).toBe(1_160_000);
  });
});

/* ---------- Option grant lifecycle ---------- */

describe('option grant lifecycle', () => {
  // OPT-1 in makeDb: 500,000 options, 4y monthly with a 1y cliff from 2024-07-01.
  const cancel = (db, patch) => {
    db.securities = db.securities.map((s) => (s.id === 'o1' ? { ...s, ...patch } : s));
    return db;
  };

  it('returns cancelled options to the pool', () => {
    const db = cancel(makeDb(), { cancelled: 375_000, cancelledDate: '2025-07-01' });
    // 125,000 vested at the one-year cliff; the other 375,000 go back.
    expect(optionsGranted(db.securities)).toBe(125_000);
    expect(poolRemaining(db.company.poolAuthorized, db.securities)).toBe(875_000);
  });

  it('counts only the surviving quantity as fully diluted', () => {
    const db = cancel(makeDb(), { cancelled: 375_000, cancelledDate: '2025-07-01' });
    expect(fullyDiluted(db.securities, db.company.poolAuthorized)).toBe(10_000_000);
    expect(fullyDiluted(db.securities, db.company.poolAuthorized, { includePool: false })).toBe(9_125_000);
    const { rows } = ownershipByStakeholder(db, { base: 'diluted', includePool: true });
    expect(rows.find((r) => r.stakeholderId === 'h3').shares).toBe(125_000);
  });

  it('drops a fully cancelled grant out of ownership entirely', () => {
    const db = cancel(makeDb(), { cancelled: 500_000, cancelledDate: '2024-12-01' });
    expect(optionsDiluted(db.securities)).toBe(0);
    expect(poolRemaining(db.company.poolAuthorized, db.securities)).toBe(1_000_000);
    const { rows } = ownershipByStakeholder(db, { base: 'diluted', includePool: true });
    expect(rows.find((r) => r.stakeholderId === 'h3')).toBeUndefined();
    expect(rows.reduce((a, r) => a + r.pct, 0)).toBeCloseTo(1, 10);
  });

  it('stops vesting on the cancellation date', () => {
    const db = cancel(makeDb(), { cancelled: 375_000, cancelledDate: '2025-07-01' });
    const grant = db.securities.find((s) => s.id === 'o1');
    // Two years on, vesting is still frozen at the cliff amount.
    expect(grantVested(grant, '2026-07-01')).toBe(125_000);
    expect(unvestedQuantity(grant, '2026-07-01')).toBe(0);
  });

  it('moves exercised shares onto the certificate instead of double-counting', () => {
    const db = makeDb();
    const before = fullyDiluted(db.securities, db.company.poolAuthorized);
    db.securities = db.securities.map((s) => (s.id === 'o1' ? { ...s, exercised: 125_000 } : s));
    // Exercising alone changes nothing - the options are still on the grant.
    expect(fullyDiluted(db.securities, db.company.poolAuthorized)).toBe(before);

    db.securities.push({
      id: 'cert1', kind: 'shares', label: 'CS-3', stakeholderId: 'h3', classId: 'c1',
      quantity: 125_000, pricePerShare: 0.1, date: '2025-08-01', fromOptionId: 'o1',
    });
    // Now the certificate carries them and the grant gives them up.
    expect(fullyDiluted(db.securities, db.company.poolAuthorized)).toBe(before);
    expect(sharesOutstanding(db.securities)).toBe(9_125_000);
    expect(optionsDiluted(db.securities)).toBe(375_000);
    // The pool stays drawn down - exercised shares never come back.
    expect(poolRemaining(db.company.poolAuthorized, db.securities)).toBe(500_000);
    const { rows } = ownershipByStakeholder(db, { base: 'diluted', includePool: true });
    expect(rows.find((r) => r.stakeholderId === 'h3').shares).toBe(500_000);
  });

  it('reports where a grant stands', () => {
    const base = { kind: 'option', quantity: 1000, grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 12 };
    expect(grantStatus(base, '2026-01-01')).toBe('active');
    expect(grantStatus({ ...base, exercised: 250 }, '2026-01-01')).toBe('partially-exercised');
    expect(grantStatus({ ...base, exercised: 1000 }, '2026-01-01')).toBe('exercised');
    expect(grantStatus({ ...base, cancelled: 1000 }, '2026-01-01')).toBe('cancelled');
    expect(grantStatus({ ...base, expires: '2025-06-30' }, '2026-01-01')).toBe('expired');
    // An expiry in the future is not a status.
    expect(grantStatus({ ...base, expires: '2034-01-01' }, '2026-01-01')).toBe('active');
    // Cancelling the unvested part leaves the rest active.
    expect(grantStatus({ ...base, cancelled: 750, cancelledDate: '2025-01-01' }, '2026-01-01')).toBe('active');
  });

  it('never lets exercised exceed what survived a cancellation', () => {
    const grant = { kind: 'option', quantity: 1000, cancelled: 800, exercised: 500, grantDate: '2024-01-01' };
    expect(grantOutstanding(grant)).toBe(200);
    expect(grantExercised(grant)).toBe(200);
  });
});

/* ---------- Vesting frequency and custom tranches ---------- */

describe('vesting frequency and custom tranches', () => {
  const grant = { quantity: 48_000, grantDate: '2024-01-15', vestingMonths: 48, cliffMonths: 12 };

  it('steps quarterly when the schedule says so', () => {
    const q = { ...grant, vestingFrequency: 'quarterly' };
    expect(vestedQuantity(q, '2025-01-15')).toBe(12_000);
    // Between quarterly steps nothing moves...
    expect(vestedQuantity(q, '2025-03-14')).toBe(12_000);
    // ...then a full quarter lands at once.
    expect(vestedQuantity(q, '2025-04-15')).toBe(15_000);
    expect(vestedQuantity(q, '2028-01-15')).toBe(48_000);
  });

  it('catches up to an off-step cliff on the cliff day', () => {
    const a = { ...grant, cliffMonths: 6, vestingFrequency: 'annual' };
    expect(vestedQuantity(a, '2024-07-14')).toBe(0);
    expect(vestedQuantity(a, '2024-07-15')).toBe(6_000);
    expect(vestedQuantity(a, '2024-12-15')).toBe(6_000);
    expect(vestedQuantity(a, '2025-01-15')).toBe(12_000);
  });

  it('vests custom tranches on their dates', () => {
    const t = {
      quantity: 10_000, date: '2024-01-01',
      vestingTranches: [
        { date: '2024-06-01', quantity: 2_500 },
        { date: '2025-06-01', quantity: 5_000 },
        { date: '2026-06-01', quantity: 2_500 },
      ],
    };
    expect(hasVesting(t)).toBe(true);
    expect(vestedQuantity(t, '2024-05-31')).toBe(0);
    expect(vestedQuantity(t, '2024-06-01')).toBe(2_500);
    expect(vestedQuantity(t, '2025-07-01')).toBe(7_500);
    expect(vestedQuantity(t, '2026-06-01')).toBe(10_000);
  });

  it('clamps tranche totals to the security and stops at cancellation', () => {
    const t = {
      kind: 'option', quantity: 4_000, grantDate: '2024-01-01',
      vestingTranches: [
        { date: '2024-02-01', quantity: 3_000 },
        { date: '2024-03-01', quantity: 3_000 },
      ],
      cancelledDate: '2024-02-15',
    };
    expect(vestedQuantity(t, '2024-12-01')).toBe(3_000);
    expect(vestedQuantity({ ...t, cancelledDate: '' }, '2024-12-01')).toBe(4_000);
  });

  it('says nothing for a cliff on which no whole share vests', () => {
    // Three options over 36 months with a six-month cliff: floor(3 x 6 / 36) is 0.
    const db = {
      company: { name: 'T', poolAuthorized: 0 },
      classes: [],
      stakeholders: [holder('h1', 'Ada')],
      securities: [{
        id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1',
        quantity: 3, strike: 0.1, grantDate: '2026-06-01', exercised: 0, vestingMonths: 36, cliffMonths: 6,
      }, {
        id: 'o2', kind: 'option', label: 'OPT-2', stakeholderId: 'h1',
        quantity: 3_600, strike: 0.1, grantDate: '2026-06-01', exercised: 0, vestingMonths: 36, cliffMonths: 6,
      }],
    };
    const events = upcomingEvents(db, { from: '2026-08-05', horizonMonths: 12 });
    const cliffs = events.filter((e) => e.type === 'cliff');
    expect(cliffs.map((e) => [e.label, e.quantity])).toEqual([['OPT-2', 600]]);
  });

  it('returns a round price free of the iteration’s residue', () => {
    // pre $8M over 4,000,000 shares + a 10% pool target: exactly $1.75 a share.
    const db = {
      company: { name: 'T', poolAuthorized: 500_000 },
      classes: [{ id: 'c1', name: 'Common Stock', kind: 'common' }],
      stakeholders: [holder('h1', 'Ada')],
      securities: [{ id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 4_000_000, pricePerShare: 0.0001, date: '2024-01-01' }],
    };
    const r = modelRound(db, { preMoney: 8_000_000, investment: 2_000_000, poolPct: 0.10, asOf: '2026-01-01' });
    expect(r.pps).toBe(1.75);
    expect(String(r.pps)).toBe('1.75');
  });

  it('feeds tranche dates into upcoming events', () => {
    const db = {
      company: { name: 'T', poolAuthorized: 0 },
      classes: [],
      stakeholders: [holder('h1', 'Ada')],
      securities: [{
        id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1',
        quantity: 4_000, strike: 0.1, grantDate: '2026-01-01', exercised: 0,
        vestingTranches: [
          { date: '2026-09-01', quantity: 1_000 },
          { date: '2026-12-01', quantity: 3_000 },
        ],
      }],
    };
    const events = upcomingEvents(db, { from: '2026-08-05', horizonMonths: 12 });
    expect(events.find((e) => e.type === 'tranche')?.date).toBe('2026-09-01');
    expect(events.find((e) => e.type === 'tranche')?.quantity).toBe(1_000);
    // The last tranche is the day the schedule completes.
    expect(events.find((e) => e.type === 'vest-complete')?.date).toBe('2026-12-01');
  });
});

/* ---------- Acceleration and unvested options at exit ---------- */

describe('acceleration and unvested options at exit', () => {
  // 900k founder common + a 100k grant halfway vested on the asOf date.
  const mkDb = (grantOver = {}) => ({
    company: { name: 'T', poolAuthorized: 0 },
    classes: [cls('c1', 'Common Stock')],
    stakeholders: [holder('h1', 'Ada'), holder('h3', 'Sam', 'employee')],
    securities: [
      { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 900_000, pricePerShare: 0.0001, date: '2023-01-01' },
      { id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h3', quantity: 100_000, strike: 0, grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 0, exercised: 0, ...grantOver },
    ],
  });
  const ASOF = '2026-01-01';

  it('computes acceleratedVested from the recorded terms', () => {
    const g = mkDb({ accelTrigger: 'single', accelPct: 50 }).securities[1];
    expect(acceleratedVested(g, ASOF)).toBe(75_000);
    expect(acceleratedVested({ ...g, accelTrigger: '' }, ASOF)).toBe(50_000);
  });

  it('lets every outstanding option participate by default', () => {
    const w = exitWaterfall(mkDb(), { exitValue: 1_000_000, asOf: ASOF });
    expect(w.rows.find((r) => r.name === 'Sam').shares).toBe(100_000);
  });

  it('cancels unvested options at close when asked', () => {
    const w = exitWaterfall(mkDb(), { exitValue: 1_000_000, asOf: ASOF, unvestedOptions: 'cancel' });
    const sam = w.rows.find((r) => r.name === 'Sam');
    expect(sam.shares).toBe(50_000);
    expect(sam.proceeds).toBeCloseTo(1_000_000 * (50_000 / 950_000), 0);
  });

  it('fires recorded acceleration under a change of control', () => {
    const w = exitWaterfall(mkDb({ accelTrigger: 'single' }), {
      exitValue: 1_000_000, asOf: ASOF, unvestedOptions: 'cancel', changeOfControl: true,
    });
    expect(w.rows.find((r) => r.name === 'Sam').shares).toBe(100_000);
  });

  it('accelerates only the stated percentage', () => {
    const w = exitWaterfall(mkDb({ accelTrigger: 'double', accelPct: 50 }), {
      exitValue: 1_000_000, asOf: ASOF, unvestedOptions: 'cancel', changeOfControl: true,
    });
    expect(w.rows.find((r) => r.name === 'Sam').shares).toBe(75_000);
  });

  it('leaves acceleration cold without a change of control', () => {
    const w = exitWaterfall(mkDb({ accelTrigger: 'single' }), {
      exitValue: 1_000_000, asOf: ASOF, unvestedOptions: 'cancel',
    });
    expect(w.rows.find((r) => r.name === 'Sam').shares).toBe(50_000);
  });

  it('nets only the vested part of an early-exercised certificate out of the cap', () => {
    // 40k early-exercised on day one; the certificate carries the schedule,
    // so on the asOf date 20k of it has vested and 20k is still restricted.
    const db = mkDb({ exercised: 40_000, earlyExercise: true });
    db.securities.push({
      id: 's2', kind: 'shares', label: 'CS-2', stakeholderId: 'h3', classId: 'c1',
      quantity: 40_000, pricePerShare: 0, date: '2024-01-02', fromOptionId: 'o1',
      vestingMonths: 48, cliffMonths: 0, vestingStart: '2024-01-01',
    });
    const w = exitWaterfall(db, { exitValue: 1_000_000, asOf: ASOF, unvestedOptions: 'cancel' });
    // 50k vested on the grant, 20k of which sits vested on the certificate:
    // 30k options survive the cancellation, plus the certificate's 40k
    // shares, which are outstanding whether vested or not.
    expect(w.awards.find((a) => a.id === 'o1').shares).toBe(30_000);
    expect(w.rows.find((r) => r.name === 'Sam').shares).toBe(70_000);
    // The same number the vesting figures report as still earning.
    expect(unvestedQuantity(db.securities[1], ASOF, db.securities)).toBe(30_000);
  });

  it('nets certified exercise shares out of the vested cap', () => {
    const db = mkDb({ exercised: 10_000 });
    db.securities.push({
      id: 's2', kind: 'shares', label: 'CS-2', stakeholderId: 'h3', classId: 'c1',
      quantity: 10_000, pricePerShare: 0, date: '2025-06-01', fromOptionId: 'o1',
    });
    const w = exitWaterfall(db, { exitValue: 1_000_000, asOf: ASOF, unvestedOptions: 'cancel' });
    // 50k vested - 10k already certified on the grant, + the 10k certificate.
    expect(w.rows.find((r) => r.name === 'Sam').shares).toBe(50_000);
  });
});

/* ---------- Transfers and closed certificates ---------- */

describe('closed certificates', () => {
  const db = () => ({
    company: { name: 'T', poolAuthorized: 0 },
    classes: [cls('c1', 'Common Stock')],
    stakeholders: [holder('h1', 'Ada'), holder('h2', 'Trust LLC', 'entity')],
    securities: [
      { id: 'cs1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 1000, pricePerShare: 1, date: '2024-01-01', closedAt: '2026-03-01', closedReason: 'transfer' },
      { id: 'cs2', kind: 'shares', label: 'CS-2', stakeholderId: 'h2', classId: 'c1', quantity: 600, pricePerShare: 1, date: '2026-03-01', fromTransferId: 'cs1', transferPricePerShare: 5 },
      { id: 'cs3', kind: 'shares', label: 'CS-3', stakeholderId: 'h1', classId: 'c1', quantity: 400, pricePerShare: 1, date: '2026-03-01', fromTransferId: 'cs1' },
    ],
  });

  it('counts only the successor legs after the transfer', () => {
    const d = db();
    expect(isClosed(d.securities[0])).toBe(true);
    expect(sharesOutstanding(d.securities)).toBe(1000);
    const own = ownershipByStakeholder(d, { base: 'outstanding' });
    expect(own.rows.find((r) => r.name === 'Trust LLC')?.shares).toBe(600);
    expect(own.rows.find((r) => r.name === 'Ada')?.shares).toBe(400);
  });

  it('keeps capital raised at the original issuance, not the secondary price', () => {
    // Successors inherit the $1 issue price; the $5 secondary is a record.
    expect(capitalRaised(db().securities)).toBe(1000);
  });

  it('leaves capital raised alone when the company buys shares back', () => {
    const d = db();
    // 100 of the 1,000 repurchased at $7: the remainder is all that survives.
    d.securities = [
      { ...d.securities[0], closedReason: 'repurchase', repurchasedQty: 100, repurchasePricePerShare: 7 },
      { id: 'cs4', kind: 'shares', label: 'CS-4', stakeholderId: 'h1', classId: 'c1', quantity: 900, pricePerShare: 1, date: '2026-03-01', fromTransferId: 'cs1' },
    ];
    expect(sharesOutstanding(d.securities)).toBe(900);
    // The $1,000 came in once and history keeps it - the buyback is a
    // separate $700 out, not $100 of the raise undone.
    expect(capitalRaised(d.securities)).toBe(1000);
    // Nor does a full buyback erase the financing that is still on record.
    expect(capitalRaised([{ ...d.securities[0], repurchasedQty: 1000 }])).toBe(1000);
  });

  it('reopens the original certificate for dates before the transfer', () => {
    const before = dbAsOf(db(), '2026-02-01');
    expect(sharesOutstanding(before.securities)).toBe(1000);
    const own = ownershipByStakeholder(before, { base: 'outstanding' });
    expect(own.rows.find((r) => r.name === 'Ada')?.shares).toBe(1000);
    expect(own.rows.some((r) => r.name === 'Trust LLC')).toBe(false);
  });
});

/* ---------- Exercised shares that later change hands ---------- */

describe('closing a certificate issued out of an option grant', () => {
  /* An exercise is permanent: those options left the grant when they were
     bought. Whatever becomes of the shares afterwards is share history, so
     the grant keeps contributing only its 600k unexercised options in every
     case below - what changes is how many issued shares survive alongside. */
  const base = () => ({
    company: { name: 'T', poolAuthorized: 0 },
    classes: [cls('c1', 'Common Stock')],
    stakeholders: [holder('h1', 'Ada'), holder('h2', 'Sam', 'employee'), holder('h3', 'Bo', 'investor')],
    securities: [
      { id: 'f1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 8_000_000, pricePerShare: 0.0001, date: '2024-01-01' },
      { id: 'g1', kind: 'option', label: 'OPT-1', stakeholderId: 'h2', quantity: 1_000_000, strike: 0.1, grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 12, exercised: 400_000, earlyExercise: true },
      { id: 'cs9', kind: 'shares', label: 'CS-9', stakeholderId: 'h2', classId: 'c1', quantity: 400_000, pricePerShare: 0.1, date: '2025-01-01', fromOptionId: 'g1' },
    ],
  });
  const close = (d, reason) => {
    const cert = d.securities.find((s) => s.id === 'cs9');
    cert.closedAt = '2026-01-01';
    cert.closedReason = reason;
    return d;
  };
  const successor = (id, stakeholderId, quantity) => ({
    id, kind: 'shares', label: id.toUpperCase(), stakeholderId, classId: 'c1',
    quantity, pricePerShare: 0.1, date: '2026-01-01', fromOptionId: 'g1', fromTransferId: 'cs9',
  });

  it('leaves the grant at its unexercised balance before anything closes', () => {
    const d = base();
    expect(optionsDiluted(d.securities)).toBe(600_000);
    expect(fullyDiluted(d.securities, 0)).toBe(9_000_000);
  });

  it('retires repurchased shares instead of returning them to the grant', () => {
    // The company buys back the unvested 300k; 100k stays with the holder.
    const d = close(base(), 'repurchase');
    d.securities.push(successor('cs10', 'h2', 100_000));
    expect(optionsDiluted(d.securities)).toBe(600_000);
    expect(sharesOutstanding(d.securities)).toBe(8_100_000);
    expect(fullyDiluted(d.securities, 0)).toBe(8_700_000);
  });

  it('retires the whole certificate when all of it is repurchased', () => {
    const d = close(base(), 'repurchase');
    expect(optionsDiluted(d.securities)).toBe(600_000);
    expect(fullyDiluted(d.securities, 0)).toBe(8_600_000);
  });

  it('changes nothing in total when the shares are sold on instead', () => {
    const d = close(base(), 'transfer');
    d.securities.push(successor('cs10', 'h3', 250_000), successor('cs11', 'h2', 150_000));
    expect(optionsDiluted(d.securities)).toBe(600_000);
    expect(fullyDiluted(d.securities, 0)).toBe(9_000_000);
  });

  it('pays a repurchase out of the exit at the surviving share count', () => {
    const d = close(base(), 'repurchase');
    d.securities.push(successor('cs10', 'h2', 100_000));
    const r = exitWaterfall(d, { exitValue: 9_100_000, asOf: '2026-06-01' });
    // 100k surviving shares + 600k unexercised options, not the 1M the grant
    // would show if the retired shares came back to it.
    expect(r.rows.find((x) => x.name === 'Sam').shares).toBe(700_000);
  });

  it('still reads the pre-repurchase picture as of an earlier date', () => {
    const d = close(base(), 'repurchase');
    d.securities.push(successor('cs10', 'h2', 100_000));
    expect(fullyDiluted(dbAsOf(d, '2025-06-01').securities, 0)).toBe(9_000_000);
  });
});

/* ---------- Post-termination exercise windows ---------- */

describe('exerciseCutoff and the post-termination window', () => {
  const base = {
    kind: 'option', quantity: 1000, grantDate: '2024-01-01',
    vestingMonths: 0, cliffMonths: 0, exercised: 0,
  };

  it('takes the earlier of the term and the departure deadline', () => {
    expect(exerciseCutoff(base)).toBe('');
    expect(exerciseCutoff({ ...base, expires: '2034-01-01' })).toBe('2034-01-01');
    expect(exerciseCutoff({ ...base, expires: '2034-01-01', exerciseBy: '2026-09-01' })).toBe('2026-09-01');
    expect(exerciseCutoff({ ...base, exerciseBy: '2026-09-01' })).toBe('2026-09-01');
  });

  it('reads as expired once the window lapses unexercised', () => {
    const g = { ...base, expires: '2034-01-01', exerciseBy: '2026-09-01' };
    expect(grantStatus(g, '2026-09-01')).toBe('active');
    expect(grantStatus(g, '2026-09-02')).toBe('expired');
    // Fully exercised in time stays exercised, not expired.
    expect(grantStatus({ ...g, exercised: 1000 }, '2027-01-01')).toBe('exercised');
  });

  it('surfaces the deadline as the expiration event', () => {
    const db = {
      company: { name: 'T', poolAuthorized: 0 },
      classes: [],
      stakeholders: [holder('h1', 'Sam', 'employee')],
      securities: [{
        ...base, id: 'o1', label: 'OPT-1', stakeholderId: 'h1',
        expires: '2034-01-01', exerciseBy: '2026-10-01',
      }],
    };
    const events = upcomingEvents(db, { from: '2026-08-05', horizonMonths: 12 });
    const e = events.find((x) => x.type === 'expiration');
    expect(e?.date).toBe('2026-10-01');
    expect(e?.quantity).toBe(1000);
    // And says which clock it is: a leaver's window, not the term running out.
    expect(e?.window).toBe(true);
    const term = upcomingEvents({
      ...db, securities: [{ ...db.securities[0], exerciseBy: '', expires: '2026-11-01' }],
    }, { from: '2026-08-05', horizonMonths: 12 }).find((x) => x.type === 'expiration');
    expect(term).toMatchObject({ date: '2026-11-01', window: false });
  });
});

/* ---------- Early exercise and 83(b) ---------- */

describe('83(b) status', () => {
  const restricted = {
    kind: 'shares', quantity: 1_000, date: '2026-08-01',
    vestingMonths: 48, cliffMonths: 12, vestingStart: '2026-08-01',
  };

  it('applies only to reverse-vesting certificates', () => {
    expect(status83b({ kind: 'shares', quantity: 100, date: '2026-08-01' }, '2026-08-10')).toBeNull();
    expect(status83b({ kind: 'option', quantity: 100, vestingMonths: 48 }, '2026-08-10')).toBeNull();
    expect(needs83b(restricted)).toBe(true);
  });

  it('runs a 30-day window from issuance', () => {
    expect(deadline83b(restricted)).toBe('2026-08-31');
    const open = status83b(restricted, '2026-08-10');
    expect(open.state).toBe('open');
    expect(open.daysLeft).toBe(21);
    expect(status83b(restricted, '2026-08-31').state).toBe('open');
    expect(status83b(restricted, '2026-09-01').state).toBe('missed');
  });

  it('reads a recorded filing regardless of the date', () => {
    const filed = { ...restricted, filed83b: '2026-08-15' };
    expect(status83b(filed, '2027-01-01')).toEqual({ state: 'filed', date: '2026-08-15' });
  });

  it('surfaces the open window in upcoming events', () => {
    const db = {
      company: { name: 'T', poolAuthorized: 0 },
      classes: [cls('c1', 'Common Stock')],
      stakeholders: [holder('h1', 'Ada')],
      securities: [{ ...restricted, id: 'cs1', label: 'CS-1', stakeholderId: 'h1', classId: 'c1' }],
    };
    const events = upcomingEvents(db, { from: '2026-08-10', horizonMonths: 12 });
    const e = events.find((x) => x.type === '83b-deadline');
    expect(e?.date).toBe('2026-08-31');
    // Once filed, the reminder disappears.
    db.securities[0] = { ...db.securities[0], filed83b: '2026-08-12' };
    expect(upcomingEvents(db, { from: '2026-08-13', horizonMonths: 12 })
      .some((x) => x.type === '83b-deadline')).toBe(false);
  });
});

/* ---------- ISO / NSO ---------- */

describe('ISO classification and the $100K limit', () => {
  const iso = (over = {}) => ({
    id: 'g1', kind: 'option', optionType: 'iso', stakeholderId: 'h3',
    quantity: 48_000, strike: 10, grantDate: '2024-01-15',
    vestingMonths: 48, cliffMonths: 12, ...over,
  });
  /* The rule measures grant-date fair market value, so the fixture records
     one - at the strike, which is where an at-the-money grant is written. */
  const isoDb = (securities, company = { valuations: [{ id: 'v1', date: '2020-01-01', fmvPerShare: 10 }] }) =>
    ({ company, securities });
  const valueByYear = (securities, holder = 'h3') => new Map(
    [...isoLimitValueByYear(isoDb(securities), holder)].map(([y, v]) => [y, v.value]));

  it('reads the opt-in field, defaulting absent to NSO', () => {
    expect(isISO(iso())).toBe(true);
    expect(isISO({ ...iso(), optionType: undefined })).toBe(false);
    expect(isISO({ kind: 'shares', optionType: 'iso' })).toBe(false);
  });

  it('attributes strike value to the year each tranche first vests', () => {
    // 48k options at $10 over 4 years with a 12-month cliff: nothing is
    // exercisable in the grant year (the cliff lands Jan 2025), the cliff
    // year catches up with 23 months' worth, and the tail lands in 2028.
    const byYear = valueByYear([iso()]);
    expect(byYear.has(2024)).toBe(false);
    expect(byYear.get(2025)).toBe(23_000 * 10);
    expect(byYear.get(2026)).toBe(12_000 * 10);
    expect(byYear.get(2028)).toBe(1_000 * 10);
    const total = [...byYear.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(480_000);
  });

  it('books a grant without a schedule entirely to its grant year', () => {
    const byYear = valueByYear([iso({ vestingMonths: 0, cliffMonths: 0 })]);
    expect(byYear.get(2024)).toBe(480_000);
    expect(byYear.size).toBe(1);
  });

  it('books an early-exercise grant entirely to its grant year', () => {
    // Exercisable in full from the grant date, so the $100K test sees all
    // $480K in 2024 - not $10K a month spread over the vesting schedule.
    const byYear = valueByYear([iso({ earlyExercise: true })]);
    expect(byYear.get(2024)).toBe(480_000);
    expect(byYear.size).toBe(1);
    expect(isoOverLimitYears(isoDb([iso({ earlyExercise: true })]), 'h3').map((o) => o.year)).toEqual([2024]);
  });

  it('ignores NSOs and other holders, and needs a per-share figure to measure', () => {
    expect(valueByYear([
      iso({ id: 'g2', optionType: undefined }),
      iso({ id: 'g3', stakeholderId: 'h9' }),
    ]).size).toBe(0);
    /* A zero strike is not a reason to skip the grant: the rule measures the
       stock's fair market value, and the recorded 409A is that figure. With
       neither a valuation nor a strike there is nothing to measure at all. */
    expect(valueByYear([iso({ id: 'g4', strike: 0, vestingMonths: 0, cliffMonths: 0 })]).get(2024))
      .toBe(480_000);
    expect(isoLimitValueByYear(isoDb([iso({ id: 'g4', strike: 0 })], { valuations: [] }), 'h3').size)
      .toBe(0);
  });

  it('books vesting credited before the grant to the grant year', () => {
    /* A schedule can start before the option does - prior service credited
       on a new hire's grant - but nothing is exercisable before the option
       exists. Both tranches of this one are exercisable the day it is
       written, which is what puts it over the limit. */
    const byYear = valueByYear([iso({
      quantity: 15_000, strike: 10, grantDate: '2025-06-01',
      vestingMonths: 0, cliffMonths: 0,
      vestingTranches: [
        { date: '2024-06-01', quantity: 7_500 },
        { date: '2025-06-01', quantity: 7_500 },
      ],
    })]);
    expect(byYear.has(2024)).toBe(false);
    expect(byYear.get(2025)).toBe(150_000);
    expect(isoOverLimitYears(isoDb([iso({
      quantity: 15_000, grantDate: '2025-06-01', vestingMonths: 0, cliffMonths: 0,
      vestingTranches: [
        { date: '2024-06-01', quantity: 7_500 },
        { date: '2025-06-01', quantity: 7_500 },
      ],
    })]), 'h3').map((o) => o.year)).toEqual([2025]);
    // A schedule entirely behind the grant is still counted, once.
    expect(valueByYear([iso({
      quantity: 15_000, grantDate: '2025-06-01', vestingMonths: 0, cliffMonths: 0,
      vestingTranches: [{ date: '2023-06-01', quantity: 15_000 }],
    })])).toEqual(new Map([[2025, 150_000]]));
    // A vesting start before the grant date moves only the years it precedes.
    const dated = valueByYear([iso({ grantDate: '2025-06-01', vestingStart: '2024-06-01' })]);
    expect(dated.has(2024)).toBe(false);
    // The cliff lands on the grant date, plus six more months to year end.
    expect(dated.get(2025)).toBe(18_000 * 10);
    expect(dated.get(2026)).toBe(12_000 * 10);
  });

  it('stops counting once a cancellation froze the schedule', () => {
    // 17 months elapsed at cancellation - 17,000 options ever became
    // exercisable, all attributed to 2025 by the cliff, and nothing after.
    const byYear = valueByYear([iso({ cancelledDate: '2025-06-15' })]);
    expect(byYear.get(2025)).toBe(17_000 * 10);
    expect(byYear.has(2026)).toBe(false);
  });

  it('flags only years past the limit, summed across grants', () => {
    // Two $60K/year ISO grants: fine alone, over together.
    const half = { ...iso(), quantity: 24_000, strike: 10, cliffMonths: 0 };
    expect(isoOverLimitYears(isoDb([half]), 'h3')).toEqual([]);
    const over = isoOverLimitYears(isoDb([half, { ...half, id: 'g2' }]), 'h3');
    expect(over.map((o) => o.year)).toContain(2025);
    expect(over.every((o) => o.value > ISO_ANNUAL_LIMIT)).toBe(true);
  });

  it('flags a grant only in over-limit years it contributes to', () => {
    // g1 vests 2024-2026; g2 alone pushes 2030 over the line.
    const g1 = { ...iso(), quantity: 6_000, strike: 10, vestingMonths: 24, cliffMonths: 0 };
    const g2 = { ...iso(), id: 'g2', quantity: 48_000, strike: 10, grantDate: '2030-01-15', vestingMonths: 0, cliffMonths: 0 };
    const securities = [g1, g2];
    expect(isoGrantOverYears(isoDb(securities), g1)).toEqual([]);
    expect(isoGrantOverYears(isoDb(securities), g2).map((o) => o.year)).toEqual([2030]);
    expect(isoGrantOverYears(isoDb(securities), { ...g1, optionType: undefined })).toEqual([]);
  });

  it('measures the limit at the grant-date 409A, not the exercise price', () => {
    /* A 10% owner's ISO must be struck at 110% of fair market value, so the
       strike overstates the basis by exactly that margin: 95,000 shares over
       a recorded $1 valuation is $95,000, under the ceiling, where the
       $1.10 strike made it $104,500 and over. */
    const owner = iso({
      quantity: 95_000, strike: 1.1, grantDate: '2025-01-01',
      vestingMonths: 0, cliffMonths: 0,
    });
    const db = isoDb([owner], { valuations: [{ id: 'v1', date: '2025-01-01', fmvPerShare: 1 }] });
    expect(isoLimitValueByYear(db, 'h3').get(2025))
      .toEqual({ value: 95_000, estimated: false });
    expect(isoOverLimitYears(db, 'h3')).toEqual([]);
  });

  it('falls back to the strike when no 409A covers the grant date, and says so', () => {
    const owner = iso({
      quantity: 95_000, strike: 1.1, grantDate: '2025-01-01',
      vestingMonths: 0, cliffMonths: 0,
    });
    // A valuation dated after the grant is not the one the rule asks for.
    const db = isoDb([owner], { valuations: [{ id: 'v1', date: '2025-06-01', fmvPerShare: 1 }] });
    expect(isoLimitValueByYear(db, 'h3').get(2025).estimated).toBe(true);
    const over = isoOverLimitYears(db, 'h3');
    expect(over[0]).toMatchObject({ year: 2025, estimated: true });
    expect(isoBasisNote(over)).toMatch(/measured at the strike/);
    expect(isoBasisNote([{ year: 2025, value: 1, estimated: false }])).toBe('');
  });
});

/* ---------- Warrants ---------- */

describe('warrants', () => {
  const warrant = { id: 'w1', kind: 'warrant', label: 'WNT-1', stakeholderId: 'h4', classId: 'p1', quantity: 250_000, strike: 0.5, date: '2025-02-01', expires: '2035-02-01' };
  const withWarrant = () => {
    const db = makeDb();
    db.securities.push({ ...warrant });
    return db;
  };

  it('counts toward fully diluted shares', () => {
    const db = withWarrant();
    expect(warrantsOutstanding(db.securities)).toBe(250_000);
    expect(fullyDiluted(db.securities, db.company.poolAuthorized)).toBe(10_250_000);
    expect(fullyDiluted(db.securities, db.company.poolAuthorized, { includePool: false })).toBe(9_750_000);
  });

  it('never draws down the option pool', () => {
    const db = withWarrant();
    expect(poolRemaining(db.company.poolAuthorized, db.securities)).toBe(500_000);
    expect(optionsGranted(db.securities)).toBe(500_000);
  });

  it('is not an issued share of its underlying class', () => {
    const db = withWarrant();
    expect(sharesOutstanding(db.securities)).toBe(9_000_000);
    expect(issuedInClass(db.securities, 'p1')).toBe(2_000_000);
  });

  it('gives its holder diluted ownership but no outstanding ownership', () => {
    const db = withWarrant();
    const diluted = ownershipByStakeholder(db, { base: 'diluted', includePool: true });
    expect(diluted.total).toBe(10_250_000);
    // Nova holds 2,000,000 preferred plus the 250,000-share warrant.
    expect(diluted.rows.find((r) => r.stakeholderId === 'h4').shares).toBe(2_250_000);
    expect(diluted.rows.reduce((a, r) => a + r.pct, 0)).toBeCloseTo(1, 10);

    const out = ownershipByStakeholder(db, { base: 'outstanding' });
    expect(out.rows.find((r) => r.stakeholderId === 'h4').shares).toBe(2_000_000);
  });

  it('appears as its own pseudo-class, never folded into the underlying class', () => {
    const db = withWarrant();
    const { rows, total } = ownershipByClass(db, { base: 'diluted', includePool: true });
    expect(rows.map((r) => r.classId)).toEqual(['c1', 'p1', 'options', 'warrants', 'pool']);
    expect(rows.find((r) => r.classId === 'warrants').shares).toBe(250_000);
    expect(rows.find((r) => r.classId === 'p1').shares).toBe(2_000_000);
    expect(rows.reduce((a, r) => a + r.pct, 0)).toBeCloseTo(1, 10);
    expect(total).toBe(10_250_000);
  });

  it('rides through a priced round like an option grant', () => {
    const db = withWarrant();
    const r = modelRound(db, { preMoney: 20_500_000, investment: 5_000_000, poolPct: 0, asOf: '2026-01-01' });
    expect(r.fdPre).toBe(10_250_000);
    expect(r.pps).toBeCloseTo(2, 10);
    // The warrant holder keeps their full pre-round share count post-round.
    const nova = r.dilution.find((d) => d.stakeholderId === 'h4');
    expect(nova.after).toBeCloseTo(2_250_000 / r.postFD, 10);
  });

  it('is not counted as capital raised until exercised', () => {
    expect(capitalRaised([{ ...warrant }])).toBe(0);
  });

  it('numbers with a WNT prefix', () => {
    expect(nextLabel(withWarrant(), 'warrant')).toBe('WNT-2');
    expect(nextLabel(makeDb(), 'warrant')).toBe('WNT-1');
  });
});

/* ---------- Fair market value ---------- */

describe('currentFMV / fmvStatus', () => {
  const company = {
    valuations: [
      { id: 'v2', date: '2025-03-01', fmvPerShare: 0.22, note: 'Post-Seed' },
      { id: 'v1', date: '2023-08-01', fmvPerShare: 0.05, note: 'Formation' },
      { id: 'v0', date: '2026-09-01', fmvPerShare: 0.4, note: 'Not yet effective' },
    ],
  };

  it('reads back the valuation in force on a date', () => {
    expect(currentFMV(company, '2026-01-01').fmvPerShare).toBe(0.22);
    expect(currentFMV(company, '2024-01-01').fmvPerShare).toBe(0.05);
    // Nothing was in force before the first valuation.
    expect(currentFMV(company, '2023-01-01')).toBeNull();
    // A future-dated valuation doesn't apply yet.
    expect(currentFMV(company, '2026-08-31').fmvPerShare).toBe(0.22);
    expect(currentFMV(company, '2026-09-01').fmvPerShare).toBe(0.4);
  });

  it('ignores entries with no usable price', () => {
    expect(currentFMV({ valuations: [{ date: '2025-01-01', fmvPerShare: 0 }] }, '2026-01-01')).toBeNull();
    expect(currentFMV({}, '2026-01-01')).toBeNull();
    expect(currentFMV(undefined, '2026-01-01')).toBeNull();
  });

  it('flags a 409A past twelve months old', () => {
    const db = { ...makeDb(), company: { ...makeDb().company, valuations: company.valuations } };
    const fresh = fmvStatus(db, '2025-06-01');
    expect(fresh.stale).toBe(false);
    expect(fresh.months).toBe(3);
    const old = fmvStatus(db, '2026-06-01');
    expect(old.stale).toBe(true);
    expect(old.months).toBe(15);
  });

  it('flags a priced round closing after the valuation', () => {
    const db = makeDb(); // preferred SS-1 issued 2024-06-10
    db.company = { ...db.company, valuations: [{ id: 'v', date: '2024-01-01', fmvPerShare: 0.05 }] };
    expect(fmvStatus(db, '2024-07-01').roundSince.date).toBe('2024-06-10');
    // A valuation set after that round is current again.
    db.company = { ...db.company, valuations: [{ id: 'v', date: '2024-07-01', fmvPerShare: 0.2 }] };
    expect(fmvStatus(db, '2024-08-01').roundSince).toBeNull();
  });

  it('does not count a round that has not closed yet', () => {
    const db = makeDb();
    db.company = { ...db.company, valuations: [{ id: 'v', date: '2026-06-01', fmvPerShare: 0.5 }] };
    // A Series Seed certificate dated for a close three months out.
    db.securities = [...db.securities, {
      id: 'later', kind: 'shares', label: 'SS-9', stakeholderId: 'h2', classId: 'p1',
      quantity: 500, pricePerShare: 4, date: '2026-11-15',
    }];
    expect(fmvStatus(db, '2026-08-22').roundSince).toBeNull();
    // And counts it once the day arrives.
    expect(fmvStatus(db, '2026-11-15').roundSince.date).toBe('2026-11-15');
  });

  it('reports nothing to refresh when no 409A exists', () => {
    const status = fmvStatus(makeDb(), '2026-01-01');
    expect(status).toMatchObject({ current: null, stale: false, roundSince: null });
  });
});

/* ---------- Ownership ---------- */

describe('ownership tables', () => {
  const db = makeDb();

  it('fractions sum to 1 on the diluted base with the pool', () => {
    const { rows, total } = ownershipByStakeholder(db, { base: 'diluted', includePool: true });
    expect(total).toBe(10_000_000);
    const sum = rows.reduce((a, r) => a + r.pct, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(rows.find((r) => r.kind === 'pool')?.shares).toBe(500_000);
  });

  it('excludes options and pool on the outstanding base', () => {
    const { rows, total } = ownershipByStakeholder(db, { base: 'outstanding' });
    expect(total).toBe(9_000_000);
    expect(rows.find((r) => r.stakeholderId === 'h3')).toBeUndefined();
    expect(rows.find((r) => r.stakeholderId === 'h1').pct).toBeCloseTo(4 / 9, 10);
  });

  it('groups by class with options and pool as pseudo-classes', () => {
    const { rows, total } = ownershipByClass(db, { base: 'diluted', includePool: true });
    expect(total).toBe(10_000_000);
    expect(rows.map((r) => r.classId)).toEqual(['c1', 'p1', 'options', 'pool']);
    expect(rows.reduce((a, r) => a + r.pct, 0)).toBeCloseTo(1, 10);
  });

  it('sorts stakeholders by descending stake', () => {
    const { rows } = ownershipByStakeholder(db, { base: 'diluted' });
    const shares = rows.map((r) => r.shares);
    expect([...shares].sort((a, b) => b - a)).toEqual(shares);
  });
});

/* ---------- Convertibles ---------- */

describe('convertibleValue', () => {
  it('returns a SAFE principal unchanged', () => {
    expect(convertibleValue({ kind: 'safe', principal: 250_000, date: '2020-01-01' }, '2026-01-01')).toBe(250_000);
  });

  it('accrues simple interest on notes', () => {
    const note = { kind: 'note', principal: 100_000, interestRate: 8, date: '2024-01-01' };
    // 366 days (2024 is a leap year) at 8% simple, actual days over 365: 100000 * (1 + 0.08 * 366/365)
    const expected = 100_000 * (1 + 0.08 * (366 / 365));
    expect(convertibleValue(note, '2025-01-01')).toBeCloseTo(expected, 6);
  });

  it('stops accruing interest the day a note converts', () => {
    const note = {
      kind: 'note', principal: 100_000, interestRate: 8, date: '2024-01-01',
      convertedAt: '2025-01-01', convertedToId: 'x1',
    };
    const atConversion = 100_000 * (1 + 0.08 * (366 / 365));
    expect(convertibleValue(note, '2026-07-01')).toBeCloseTo(atConversion, 6);
    // Before the conversion the clock still reads the asked-for date.
    const live = { kind: 'note', principal: 100_000, interestRate: 8, date: '2024-01-01' };
    expect(convertibleValue(note, '2024-07-01')).toBe(convertibleValue(live, '2024-07-01'));
  });
});

describe('conversionPrice', () => {
  const fd = 10_000_000;

  it('uses the round price when there is no cap or discount', () => {
    expect(conversionPrice({ valuationCap: 0, discount: 0 }, 2, fd)).toBe(2);
  });

  it('applies the valuation cap: cap / pre-round FD', () => {
    expect(conversionPrice({ valuationCap: 8_000_000, discount: 0 }, 2, fd)).toBeCloseTo(0.8, 10);
  });

  it('applies the discount off the round price', () => {
    expect(conversionPrice({ valuationCap: 0, discount: 20 }, 2, fd)).toBeCloseTo(1.6, 10);
  });

  it('takes whichever of cap and discount is better for the investor', () => {
    // Cap price 0.8 beats discount price 1.6.
    expect(conversionPrice({ valuationCap: 8_000_000, discount: 20 }, 2, fd)).toBeCloseTo(0.8, 10);
    // Discount price 0.9 beats cap price 3.
    expect(conversionPrice({ valuationCap: 30_000_000, discount: 55 }, 2, fd)).toBeCloseTo(0.9, 10);
  });

  it('never converts above the round price', () => {
    expect(conversionPrice({ valuationCap: 100_000_000, discount: 0 }, 2, fd)).toBe(2);
  });

  it('divides a post-money SAFE cap by the company capitalization', () => {
    const safe = { kind: 'safe', safeType: 'post', valuationCap: 10_000_000, discount: 0 };
    // Same cap, larger basis than the pre-round FD → a lower (better) price.
    expect(conversionPrice(safe, 2, fd, 12_500_000)).toBeCloseTo(0.8, 10);
    expect(conversionPrice({ ...safe, safeType: 'pre' }, 2, fd, 12_500_000)).toBeCloseTo(1, 10);
  });

  it('ignores the post-money basis for notes', () => {
    const note = { kind: 'note', safeType: 'post', valuationCap: 10_000_000, discount: 0 };
    expect(isPostMoneySafe(note)).toBe(false);
    expect(conversionPrice(note, 2, fd, 20_000_000)).toBeCloseTo(1, 10);
  });
});

describe('postMoneyOwnership', () => {
  it('is principal over cap for a capped post-money SAFE', () => {
    expect(postMoneyOwnership({ kind: 'safe', safeType: 'post', principal: 1_000_000, valuationCap: 10_000_000 }))
      .toBeCloseTo(0.1, 10);
  });

  it('is null when the instrument guarantees a price, not a percentage', () => {
    expect(postMoneyOwnership({ kind: 'safe', safeType: 'pre', principal: 1e6, valuationCap: 1e7 })).toBeNull();
    expect(postMoneyOwnership({ kind: 'safe', safeType: 'post', principal: 1e6, valuationCap: 0 })).toBeNull();
    expect(postMoneyOwnership({ kind: 'note', principal: 1e6, valuationCap: 1e7 })).toBeNull();
  });
});

/* ---------- Round modeling ---------- */

describe('modelRound', () => {
  it('prices a plain round off pre-money / fully diluted', () => {
    const db = makeDb(); // FD = 10,000,000
    const r = modelRound(db, { preMoney: 10_000_000, investment: 2_500_000, poolPct: 0, asOf: '2026-01-01' });
    expect(r.pps).toBeCloseTo(1, 10);
    expect(r.investorShares).toBe(2_500_000);
    expect(r.postFD).toBe(12_500_000);
    expect(r.investorPct).toBeCloseTo(0.2, 10);
    expect(r.postMoney).toBe(12_500_000);
    expect(r.conversionShares).toBe(0);
  });

  it('converts a capped SAFE at the cap price', () => {
    const db = makeDb();
    db.securities.push({ id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 1_000_000, valuationCap: 10_000_000, discount: 0, date: '2025-01-01' });
    const r = modelRound(db, { preMoney: 20_000_000, investment: 5_000_000, poolPct: 0, asOf: '2026-01-01' });
    // Cap price = 10M / 10M FD = $1 → 1,000,000 shares, independent of PPS.
    expect(r.conversionShares).toBe(1_000_000);
    // PPS = 20M / (10M + 1M conversion) = 1.8181…
    expect(r.pps).toBeCloseTo(20 / 11, 6);
    expect(r.investorShares).toBe(Math.round(5_000_000 / (20 / 11)));
    // New money still buys invest / post-money of the company.
    expect(r.investorPct).toBeCloseTo(5 / 25, 3);
  });

  it('totals the conversion shares the way the close will write them', () => {
    const db = makeDb(); // FD = 10,000,000
    // Cap price $0.75 → each SAFE converts into 400,001.33 shares. Rounded
    // one by one, as the certificates are, that is 800,002 shares; rounded
    // once as a total it would read 800,003, and the summary would claim a
    // share the conversion table under it never lists.
    db.securities.push(
      { id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 300_001, valuationCap: 7_500_000, discount: 0, date: '2025-01-01' },
      { id: 'sf2', kind: 'safe', label: 'SAFE-2', stakeholderId: 'h4', principal: 300_001, valuationCap: 7_500_000, discount: 0, date: '2025-01-01' });
    const r = modelRound(db, { preMoney: 20_000_000, investment: 5_000_000, poolPct: 0, asOf: '2026-01-01' });
    expect(r.conversions.map((c) => c.shares)).toEqual([400_001, 400_001]);
    expect(r.conversionShares).toBe(800_002);
    expect(r.postFD).toBe(r.fdPre + r.conversionShares + r.investorShares);
  });

  it('solves the discount-only SAFE fixed point', () => {
    const db = makeDb();
    db.securities.push({ id: 'sf2', kind: 'safe', label: 'SAFE-2', stakeholderId: 'h4', principal: 500_000, valuationCap: 0, discount: 20, date: '2025-01-01' });
    const r = modelRound(db, { preMoney: 20_000_000, investment: 5_000_000, poolPct: 0, asOf: '2026-01-01' });
    // Fixed point: pps = pre / (fd + value / (0.8 * pps))
    const reconstructed = 20_000_000 / (10_000_000 + 500_000 / (0.8 * r.pps));
    expect(r.pps).toBeCloseTo(reconstructed, 6);
  });

  it('holds its accuracy at a share price of hundredths of a cent', () => {
    /* A billion shares against a million-dollar pre-money prices the round at
       $0.0001, where an absolute convergence tolerance of 1e-9 is a tenth of
       the price itself. The solver stopped 94,046 shares short of the fixed
       point - a stock split, which changes nothing about the round, was
       enough to put it there. */
    const db = {
      company: { poolAuthorized: 0, valuations: [], splits: [] },
      classes: [{ id: 'c', name: 'Common Stock', kind: 'common' }],
      stakeholders: [{ id: 'h', name: 'Founder' }, { id: 'i', name: 'Investor' }],
      securities: [
        { id: 's', kind: 'shares', label: 'CS-1', stakeholderId: 'h', classId: 'c', quantity: 1e9, pricePerShare: 0.0001, date: '2024-01-01' },
        { id: 'sf', kind: 'safe', label: 'SAFE-1', stakeholderId: 'i', safeType: 'pre', principal: 900_000, valuationCap: 0, discount: 0, date: '2024-06-01' },
      ],
    };
    const r = modelRound(db, { preMoney: 1e6, investment: 1e6, poolPct: 0, asOf: '2025-01-01' });
    // pps = (preMoney - SAFE principal) / existing shares, exactly.
    expect(r.pps).toBeCloseTo(1e-4, 12);
    expect(r.investorShares).toBe(10_000_000_000);
  });

  it('reports the quantities the price it returns actually produces', () => {
    // The loop derives the next price from the previous pass's quantities, so
    // returning both together gave a share count the returned price does not
    // buy - and Close Round, which recalculates from the price, then issued a
    // different number than the model reviewed.
    const db = makeDb();
    db.securities.push({ id: 'sf2', kind: 'safe', label: 'SAFE-2', stakeholderId: 'h4', principal: 500_000, valuationCap: 0, discount: 20, date: '2025-01-01' });
    const r = modelRound(db, { preMoney: 20_000_000, investment: 5_000_000, poolPct: 0.12, asOf: '2026-01-01' });
    expect(r.investorShares).toBe(Math.round(5_000_000 / r.pps));
    /* And the price is the one those quantities imply, to within the whole
       shares the reported counts are rounded to. */
    const reconstructed = 20_000_000 / (r.fdPre + r.conversionShares + r.antiDilutionShares + r.poolAdd);
    expect(Math.abs(r.pps - reconstructed) / r.pps).toBeLessThan(1e-6);
  });

  it('tops the pool up to the target share of post-round FD', () => {
    const db = makeDb();
    const r = modelRound(db, { preMoney: 18_000_000, investment: 6_000_000, poolPct: 0.15, asOf: '2026-01-01' });
    expect(r.poolAfter / r.postFD).toBeCloseTo(0.15, 3);
    // The top-up is pre-money: it lowers the share price below pre/FD.
    expect(r.pps).toBeLessThan(18_000_000 / 10_000_000);
  });

  it('never shrinks an existing pool that already exceeds the target', () => {
    const db = makeDb();
    db.company.poolAuthorized = 3_000_000; // pool remaining 2.5M of FD 12M ≈ 21%
    const r = modelRound(db, { preMoney: 24_000_000, investment: 6_000_000, poolPct: 0.1, asOf: '2026-01-01' });
    expect(r.poolAdd).toBe(0);
  });

  it('reports dilution rows that sum to 1 and include new investors', () => {
    const db = makeDb();
    const r = modelRound(db, { preMoney: 10_000_000, investment: 2_500_000, poolPct: 0.1, asOf: '2026-01-01' });
    const sum = r.dilution.reduce((a, d) => a + d.after, 0);
    expect(sum).toBeCloseTo(1, 4);
    const investors = r.dilution.find((d) => d.stakeholderId === '__new__');
    expect(investors.before).toBe(0);
    expect(investors.after).toBeGreaterThan(0);
    // Every existing holder is diluted by the round.
    for (const d of r.dilution) {
      if (d.stakeholderId !== '__new__' && d.stakeholderId !== '__pool__' && d.before > 0) {
        expect(d.after).toBeLessThan(d.before);
      }
    }
  });

  it('gives a post-money SAFE exactly principal / cap of the capitalization', () => {
    const db = makeDb(); // FD = 10,000,000
    db.securities.push({ id: 'sf3', kind: 'safe', safeType: 'post', label: 'SAFE-3', stakeholderId: 'h4', principal: 1_000_000, valuationCap: 10_000_000, discount: 0, date: '2025-01-01' });
    const r = modelRound(db, { preMoney: 20_000_000, investment: 5_000_000, poolPct: 0, asOf: '2026-01-01' });
    // Capitalization solves CC = 10M + 0.1 * CC → 11,111,111.
    expect(r.companyCap).toBeCloseTo(10_000_000 / 0.9, 3);
    expect(r.conversionShares).toBe(Math.round(10_000_000 / 0.9) - 10_000_000);
    expect(r.conversions[0].shares / r.companyCap).toBeCloseTo(0.1, 6);
  });

  it('makes a post-money cap more dilutive than the same pre-money cap', () => {
    const withType = (safeType) => {
      const db = makeDb();
      db.securities.push({ id: 'sf4', kind: 'safe', safeType, label: 'SAFE-4', stakeholderId: 'h4', principal: 1_000_000, valuationCap: 10_000_000, discount: 0, date: '2025-01-01' });
      return modelRound(db, { preMoney: 20_000_000, investment: 5_000_000, poolPct: 0, asOf: '2026-01-01' });
    };
    const post = withType('post');
    const pre = withType('pre');
    expect(pre.conversionShares).toBe(1_000_000);
    expect(post.conversionShares).toBeGreaterThan(pre.conversionShares);
    // Founders keep less of the company under the post-money cap.
    const founder = (r) => r.dilution.find((d) => d.stakeholderId === 'h1').after;
    expect(founder(post)).toBeLessThan(founder(pre));
  });

  it('handles a mixed pre / post round', () => {
    const db = makeDb();
    db.securities.push(
      { id: 'sf5', kind: 'safe', safeType: 'pre', label: 'SAFE-5', stakeholderId: 'h4', principal: 1_000_000, valuationCap: 10_000_000, discount: 0, date: '2025-01-01' },
      { id: 'sf6', kind: 'safe', safeType: 'post', label: 'SAFE-6', stakeholderId: 'h3', principal: 1_000_000, valuationCap: 10_000_000, discount: 0, date: '2025-06-01' });
    const r = modelRound(db, { preMoney: 30_000_000, investment: 5_000_000, poolPct: 0, asOf: '2026-01-01' });
    // Pre-money SAFE: 10M cap / 10M FD = $1 → 1,000,000 shares, fixed.
    // Capitalization then solves CC = 10M + 1M + 0.1 * CC → 12,222,222.
    const pre = r.conversions.find((c) => c.label === 'SAFE-5');
    const post = r.conversions.find((c) => c.label === 'SAFE-6');
    expect(pre.shares).toBe(1_000_000);
    expect(r.companyCap).toBeCloseTo(11_000_000 / 0.9, 3);
    expect(post.shares / r.companyCap).toBeCloseTo(0.1, 6);
  });

  it('lets a discount beat a post-money cap when the round prices low', () => {
    const db = makeDb();
    db.securities.push({ id: 'sf7', kind: 'safe', safeType: 'post', label: 'SAFE-7', stakeholderId: 'h4', principal: 500_000, valuationCap: 100_000_000, discount: 20, date: '2025-01-01' });
    const r = modelRound(db, { preMoney: 10_000_000, investment: 3_000_000, poolPct: 0, asOf: '2026-01-01' });
    // A $100M cap on a $10M-pre round never binds; the 20% discount does.
    expect(r.conversions[0].price).toBeCloseTo(r.pps * 0.8, 8);
  });

  it('returns null when there is nothing to price', () => {
    const db = makeDb();
    expect(modelRound(db, { preMoney: 0, investment: 1, poolPct: 0, asOf: '2026-01-01' })).toBeNull();
    const emptyCo = { ...db, securities: [], company: { ...db.company, poolAuthorized: 0 } };
    expect(modelRound(emptyCo, { preMoney: 1, investment: 1, poolPct: 0, asOf: '2026-01-01' })).toBeNull();
  });

  it('refuses post-money SAFEs that promise (nearly) the whole company', () => {
    // A $250k SAFE against an $80k cap - a $8M cap short two zeros - claims
    // 312% of the company. No round price satisfies that; the model must
    // say so rather than iterate into garbage.
    const db = makeDb();
    db.securities.push({ id: 'sf8', kind: 'safe', safeType: 'post', label: 'SAFE-8', stakeholderId: 'h4', principal: 250_000, valuationCap: 80_000, discount: 0, date: '2025-01-01' });
    const r = modelRound(db, { preMoney: 18_000_000, investment: 5_000_000, poolPct: 0.1, asOf: '2026-01-01' });
    expect(r.overclaim).toBeCloseTo(3.125, 6);
    expect(r.pps).toBeUndefined();

    // Several SAFEs summing past the line trip the same guard.
    const many = makeDb();
    for (let i = 0; i < 4; i++) {
      many.securities.push({ id: `sf9${i}`, kind: 'safe', safeType: 'post', label: `SAFE-9${i}`, stakeholderId: 'h4', principal: 1_000_000, valuationCap: 4_000_000, discount: 0, date: '2025-01-01' });
    }
    expect(modelRound(many, { preMoney: 18_000_000, investment: 5_000_000, poolPct: 0, asOf: '2026-01-01' }).overclaim).toBeCloseTo(1, 6);

    // A heavy-but-real claim still models: pre-money SAFEs never trip it.
    const heavy = makeDb();
    heavy.securities.push(
      { id: 'sfA', kind: 'safe', safeType: 'post', label: 'SAFE-A', stakeholderId: 'h4', principal: 2_000_000, valuationCap: 5_000_000, discount: 0, date: '2025-01-01' },
      { id: 'sfB', kind: 'safe', safeType: 'pre', label: 'SAFE-B', stakeholderId: 'h4', principal: 2_000_000, valuationCap: 1_000_000, discount: 0, date: '2025-01-01' });
    const ok = modelRound(heavy, { preMoney: 18_000_000, investment: 5_000_000, poolPct: 0, asOf: '2026-01-01' });
    expect(ok.overclaim).toBeUndefined();
    expect(ok.pps).toBeGreaterThan(0);
    const capped = ok.conversions.find((c) => c.label === 'SAFE-A');
    expect(capped.shares / ok.companyCap).toBeCloseTo(0.4, 4);
  });

  it('refuses convertibles whose discounted value reaches the pre-money', () => {
    // A $3M uncapped SAFE into a $2M-pre round absorbs 150% of the
    // pre-money: the price equation has no positive solution, and the
    // iteration used to slide into its runaway clamp and report a
    // stakeholder owning 120% of the company.
    const db = makeDb();
    db.securities.push({ id: 'sfC', kind: 'safe', safeType: 'pre', label: 'SAFE-C', stakeholderId: 'h4', principal: 3_000_000, valuationCap: 0, discount: 0, date: '2025-01-01' });
    const r = modelRound(db, { preMoney: 2_000_000, investment: 500_000, poolPct: 0, asOf: '2026-01-01' });
    expect(r.valueClaim).toBeCloseTo(1.5, 6);
    expect(r.pps).toBeUndefined();

    // The discount leg counts at its floor: $7.6M at 20% off claims
    // exactly 95% of a $10M pre-money, which is the refusal line.
    const atLine = makeDb();
    atLine.securities.push({ id: 'sfD', kind: 'safe', safeType: 'pre', label: 'SAFE-D', stakeholderId: 'h4', principal: 7_600_000, valuationCap: 0, discount: 20, date: '2025-01-01' });
    expect(modelRound(atLine, { preMoney: 10_000_000, investment: 1_000_000, poolPct: 0, asOf: '2026-01-01' }).valueClaim).toBeCloseTo(0.95, 6);
  });

  it('stays exact for discount-heavy bridges just inside the refusal line', () => {
    // Uncapped claims make the iteration converge slowly; the closed form
    // is pps = (pre - value / (1 - discount)) / FD, and a bridge claiming
    // 93.75% of the pre-money must still land on it.
    const db = makeDb(); // FD = 10,000,000
    db.securities.push({ id: 'sfE', kind: 'safe', safeType: 'pre', label: 'SAFE-E', stakeholderId: 'h4', principal: 7_500_000, valuationCap: 0, discount: 20, date: '2025-01-01' });
    const r = modelRound(db, { preMoney: 10_000_000, investment: 1_000_000, poolPct: 0, asOf: '2026-01-01' });
    expect(r.pps).toBeCloseTo((10_000_000 - 7_500_000 / 0.8) / 10_000_000, 6);
    expect(r.dilution.reduce((a, d) => a + d.after, 0)).toBeCloseTo(1, 4);
  });

  it('refuses a pool target the pre-money cannot fund', () => {
    // A 20% post-round pool on a raise five times the pre-money needs more
    // new pool shares than the whole pre-money can pay for - no positive
    // price exists even with no convertibles on the table.
    const db = makeDb();
    const r = modelRound(db, { preMoney: 1_000_000, investment: 5_000_000, poolPct: 0.2, asOf: '2026-01-01' });
    expect(r.unpriceable).toBe(true);
    expect(r.pps).toBeUndefined();
  });
});

/* ---------- Point in time ---------- */

describe('dbAsOf', () => {
  // makeDb: founder common 2023-05-20, preferred 2024-06-10, OPT-1 2024-07-01.
  it('drops securities issued after the date', () => {
    const early = dbAsOf(makeDb(), '2023-12-31');
    expect(early.securities.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(sharesOutstanding(early.securities)).toBe(7_000_000);
    expect(fullyDiluted(early.securities, early.company.poolAuthorized)).toBe(8_000_000);
  });

  it('includes securities issued exactly on the date', () => {
    expect(dbAsOf(makeDb(), '2024-06-10').securities.map((s) => s.id))
      .toEqual(['s1', 's2', 's3']);
  });

  it('leaves the snapshot alone without a date', () => {
    const db = makeDb();
    expect(dbAsOf(db, '')).toBe(db);
  });

  it('computes vesting as of the chosen date', () => {
    const db = dbAsOf(makeDb(), '2025-07-01');
    const grant = db.securities.find((s) => s.id === 'o1');
    expect(grantVested(grant, '2025-07-01')).toBe(125_000);
    expect(unvestedTotal(db.securities, '2025-07-01')).toBe(375_000);
  });

  it('rolls back a cancellation that had not happened yet', () => {
    const db = makeDb();
    db.securities = db.securities.map((s) => (s.id === 'o1'
      ? { ...s, cancelled: 375_000, cancelledDate: '2026-01-01' }
      : s));
    // Before the cancellation the whole grant is live and vesting is running.
    const before = dbAsOf(db, '2025-12-31');
    const beforeGrant = before.securities.find((s) => s.id === 'o1');
    expect(beforeGrant).not.toHaveProperty('cancelled');
    expect(grantOutstanding(beforeGrant)).toBe(500_000);
    // 17 whole months of 48 on the full 500,000.
    expect(grantVested(beforeGrant, '2025-12-31')).toBe(177_083);
    // On and after it, the cancellation stands.
    expect(grantOutstanding(dbAsOf(db, '2026-01-01').securities.find((s) => s.id === 'o1')))
      .toBe(125_000);
  });

  it('rolls back only the forfeitures that had not happened yet', () => {
    const db = makeDb();
    db.securities = db.securities.map((s) => (s.id === 'o1'
      ? {
        ...s,
        cancelled: 500_000,
        cancelledDate: '2026-01-01',
        cancellations: [
          { quantity: 375_000, date: '2026-01-01' },
          { quantity: 125_000, date: '2026-04-01' },
        ],
      }
      : s));
    const on = (d) => dbAsOf(db, d).securities.find((s) => s.id === 'o1');
    expect(grantOutstanding(on('2025-12-31'))).toBe(500_000);
    expect(on('2025-12-31')).not.toHaveProperty('cancelled');
    // The January departure stands in February; the April lapse does not.
    expect(grantOutstanding(on('2026-02-01'))).toBe(125_000);
    expect(on('2026-02-01')).not.toHaveProperty('cancellations');
    expect(grantOutstanding(on('2026-04-01'))).toBe(0);
  });

  it('rolls back a departure that had not happened yet, both halves of it', () => {
    const db = makeDb();
    // A departure stamps the holder and sets the post-termination deadline on
    // the grant, cancelling the unvested balance - all in one commit.
    db.stakeholders = db.stakeholders.map((h) => (h.id === 'h3' ? { ...h, departed: '2026-06-01' } : h));
    db.securities = db.securities.map((s) => (s.id === 'o1'
      ? { ...s, cancelled: 300_000, cancelledDate: '2026-06-01', exerciseBy: '2026-09-01' }
      : s));

    const before = dbAsOf(db, '2026-05-01');
    const grant = before.securities.find((s) => s.id === 'o1');
    expect(before.stakeholders.find((h) => h.id === 'h3')).not.toHaveProperty('departed');
    expect(grant).not.toHaveProperty('exerciseBy');
    expect(exerciseCutoff(grant)).toBe('');
    // Without the rollback this reported an expiration on the full grant a
    // month before the departure that created the deadline.
    expect(upcomingEvents(before, { from: '2026-05-01', horizonMonths: 12 })
      .filter((e) => e.type === 'expiration')).toEqual([]);

    // On and after the departure date it all stands again.
    const after = dbAsOf(db, '2026-07-01').securities.find((s) => s.id === 'o1');
    expect(after.exerciseBy).toBe('2026-09-01');
    expect(grantOutstanding(after)).toBe(200_000);
  });

  it('keeps an expiration the grant itself carries through that rollback', () => {
    const db = makeDb();
    db.stakeholders = db.stakeholders.map((h) => (h.id === 'h3' ? { ...h, departed: '2026-06-01' } : h));
    db.securities = db.securities.map((s) => (s.id === 'o1'
      ? { ...s, expires: '2034-07-01', exerciseBy: '2026-09-01' }
      : s));
    // The ten-year term is the grant's own, not the departure's.
    expect(exerciseCutoff(dbAsOf(db, '2026-05-01').securities.find((s) => s.id === 'o1')))
      .toBe('2034-07-01');
  });

  it('reads the option pool at the size it had on the date', () => {
    const db = makeDb();
    /* The pool was reserved at the seed round and topped up later; the
       founders' snapshot from before the round has no pool in it at all. */
    db.company = {
      ...db.company,
      poolAuthorized: 1_000_000,
      poolHistory: [
        { date: '2024-06-10', before: 0, after: 600_000, seq: 1 },
        { date: '2025-03-01', before: 600_000, after: 1_000_000, seq: 2 },
      ],
    };
    expect(poolAsOf(db.company, '2024-06-09')).toBe(0);
    expect(poolAsOf(db.company, '2024-06-10')).toBe(600_000);
    expect(poolAsOf(db.company, '2025-02-28')).toBe(600_000);
    expect(poolAsOf(db.company, '2025-03-01')).toBe(1_000_000);
    expect(poolAsOf(db.company, '')).toBe(1_000_000);
    const founders = dbAsOf(db, '2023-12-31');
    expect(founders.company.poolAuthorized).toBe(0);
    expect(fullyDiluted(founders.securities, founders.company.poolAuthorized)).toBe(7_000_000);
    expect(ownershipByStakeholder(founders).rows.map((r) => [r.name, r.pct]))
      .toEqual([['Ada', 4 / 7], ['Grace', 3 / 7]]);
    // A pool with no recorded history reads as it stands, as it always did.
    expect(poolAsOf({ poolAuthorized: 1_000_000 }, '2020-01-01')).toBe(1_000_000);
    expect(dbAsOf(makeDb(), '2023-12-31').company.poolAuthorized).toBe(1_000_000);
  });

  it('walks a resize and a split back together, each in the units of its day', () => {
    const db = makeDb();
    // Reserved 500,000 in March, then a 1-for-10 reverse split in June rounded it to 50,000.
    db.company = {
      ...db.company,
      poolAuthorized: 50_000,
      poolHistory: [{ date: '2026-03-01', before: 1_000_000, after: 500_000, seq: 1 }],
      splits: [{ id: 'jun', date: '2026-06-01', num: 1, den: 10, seq: 2 }],
    };
    expect(poolAsOf(db.company, '2026-02-01')).toBe(1_000_000);
    expect(poolAsOf(db.company, '2026-04-01')).toBe(500_000);
    expect(poolAsOf(db.company, '2026-06-01')).toBe(50_000);
    // The other way round: the split first, then a resize entered in post-split units but dated before it.
    db.company = {
      ...db.company,
      poolAuthorized: 80_000,
      poolHistory: [{ date: '2026-03-01', before: 100_000, after: 80_000, seq: 2 }],
      splits: [{ id: 'jun', date: '2026-06-01', num: 1, den: 10, seq: 1 }],
    };
    expect(poolAsOf(db.company, '2026-02-01')).toBe(1_000_000);
    expect(poolAsOf(db.company, '2026-04-01')).toBe(800_000);
    expect(poolAsOf(db.company, '2026-06-01')).toBe(80_000);
  });

  it('walks splits back in the order they were recorded, not the order of their dates', () => {
    /* A 1-for-3 split recorded first (dated June), then a historical 7-for-3
       dated February recorded behind it. The records carry both in that
       order, and each split's rounding note describes the record as it stood
       when that split ran: undone by date, the June note was read against the
       February arithmetic and every date before both came out a split short. */
    const db = makeDb();
    db.company = {
      ...db.company,
      poolAuthorized: 777_777,
      splits: [
        { id: 'feb', date: '2026-02-01', num: 7, den: 3, seq: 2, poolBefore: 333_333, poolAfter: 777_777 },
        { id: 'jun', date: '2026-06-01', num: 1, den: 3, seq: 1, poolBefore: 1_000_000, poolAfter: 333_333 },
      ],
    };
    db.securities = db.securities.map((s) => {
      if (s.id === 's1') return { ...s, quantity: 3_111_110, preSplit: [{ id: 'jun', quantity: 4_000_000 }, { id: 'feb', quantity: 1_333_333 }] };
      if (s.id === 's2') return { ...s, quantity: 2_333_333, preSplit: [{ id: 'feb', quantity: 1_000_000 }] };
      if (s.id === 's3') return { ...s, quantity: 1_555_556, pricePerShare: 0.5 * 3 * (3 / 7), preSplit: [{ id: 'jun', quantity: 2_000_000 }, { id: 'feb', quantity: 666_667 }] };
      return s;
    });
    const before = dbAsOf(db, '2025-12-31');
    const at = (snap, id) => snap.securities.find((s) => s.id === id);
    expect(at(before, 's1').quantity).toBe(4_000_000);
    expect(at(before, 's2').quantity).toBe(3_000_000);
    expect(at(before, 's3')).toMatchObject({ quantity: 2_000_000, pricePerShare: 0.5 });
    expect(before.company.poolAuthorized).toBe(1_000_000);
    expect(unsplitQuantity(at(db, 's1'), db.company, '2025-12-31')).toBe(4_000_000);
    expect(unsplitQuantity(at(db, 's1'), db.company, '2026-04-01')).toBe(9_333_333);
    // Between the two: the February split had happened, the June one had not.
    const between = dbAsOf(db, '2026-04-01');
    expect(at(between, 's1').quantity).toBe(9_333_333);
    expect(at(between, 's2').quantity).toBe(7_000_000);
    expect(at(between, 's3')).toMatchObject({ quantity: 4_666_667 });
    expect(at(between, 's3').pricePerShare).toBeCloseTo(0.5 / (7 / 3), 9);
    expect(between.company.poolAuthorized).toBe(2_333_333);
    // On and after the June date nothing is undone.
    expect(at(dbAsOf(db, '2026-06-01'), 's1').quantity).toBe(3_111_110);
  });

  it('gives a grant its shares back when the exercise certificate is in the future', () => {
    const db = makeDb();
    db.securities = db.securities.map((s) => (s.id === 'o1' ? { ...s, exercised: 125_000 } : s));
    db.securities.push({
      id: 'cert1', kind: 'shares', label: 'CS-3', stakeholderId: 'h3', classId: 'c1',
      quantity: 125_000, pricePerShare: 0.1, date: '2026-03-01', fromOptionId: 'o1',
    });
    const before = dbAsOf(db, '2026-02-28');
    expect(sharesOutstanding(before.securities)).toBe(9_000_000);
    expect(optionsDiluted(before.securities)).toBe(500_000);
    // Fully diluted is the same on both sides of the exercise.
    expect(fullyDiluted(before.securities, before.company.poolAuthorized)).toBe(10_000_000);
    expect(fullyDiluted(db.securities, db.company.poolAuthorized)).toBe(10_000_000);
  });
});

describe('issuanceHistory', () => {
  it('clusters securities by issue date, newest first', () => {
    const history = issuanceHistory(makeDb());
    expect(history.map((h) => h.date)).toEqual(['2024-07-01', '2024-06-10', '2023-05-20']);
    expect(history.at(-1)).toMatchObject({ count: 2, shares: 7_000_000, kinds: ['shares'] });
    // The preferred round records the cash that came in with it.
    expect(history[1]).toMatchObject({ count: 1, shares: 2_000_000, amount: 1_000_000 });
  });

  it('counts convertible principal as amount rather than shares', () => {
    const db = makeDb();
    db.securities = [{ id: 'sf', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 250_000, date: '2025-01-01' }];
    expect(issuanceHistory(db)).toEqual([
      { date: '2025-01-01', count: 1, shares: 0, amount: 250_000, kinds: ['safe'] },
    ]);
  });

  it('is empty for an empty cap table', () => {
    expect(issuanceHistory({ ...makeDb(), securities: [] })).toEqual([]);
  });

  it('reads a past date in the units of its day when taken off a snapshot', () => {
    /* Stored records carry post-split units, so the live history describes a
       2023 issuance in today's shares. Read off the snapshot of its own date -
       which is how the cap table's financing chips label themselves, and what
       the table those chips open shows - it reads in the units of 2023. */
    const db = makeDb();
    db.company = { ...db.company, splits: [{ id: 'sp', date: '2026-01-01', num: 10, den: 1 }] };
    db.securities = db.securities.map((x) => (x.kind === 'shares'
      ? { ...x, quantity: x.quantity * 10, pricePerShare: x.pricePerShare / 10 }
      : x));
    const live = issuanceHistory(db).find((h) => h.date === '2023-05-20');
    expect(live.shares).toBe(70_000_000);
    const onTheDay = issuanceHistory(dbAsOf(db, '2023-05-20')).find((h) => h.date === '2023-05-20');
    expect(onTheDay.shares).toBe(7_000_000);
    // The money that came in that day is the same either way.
    expect(onTheDay.amount).toBeCloseTo(live.amount, 6);
  });

  it('does not bill a round for money its convertibles already brought in', () => {
    const db = makeDb();
    db.securities = [
      { id: 'sf', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 250_000, valuationCap: 8_000_000, date: '2025-01-01', convertedAt: '2026-03-01', convertedToId: 'sa2' },
      // The round: new money, plus the certificate the SAFE became.
      { id: 'sa1', kind: 'shares', label: 'SA-1', stakeholderId: 'h4', classId: 'p1', quantity: 2_000_000, pricePerShare: 1, date: '2026-03-01' },
      { id: 'sa2', kind: 'shares', label: 'SA-2', stakeholderId: 'h4', classId: 'p1', quantity: 500_000, pricePerShare: 0.5, date: '2026-03-01', fromConvertibleId: 'sf' },
    ];
    const history = issuanceHistory(db);
    expect(history[1]).toMatchObject({ date: '2025-01-01', amount: 250_000 });
    // Both certificates' shares, but only the new money's dollars.
    expect(history[0]).toMatchObject({ date: '2026-03-01', count: 2, shares: 2_500_000, amount: 2_000_000 });
  });

  it('does not report a secondary sale as a new financing', () => {
    const db = makeDb();
    // 400k of the 2023 founder stock sold on in 2026: the original closes at
    // full size, two successors carry the shares under the transfer date.
    db.securities = db.securities.map((s) => (s.id === 's1'
      ? { ...s, closedAt: '2026-08-01', closedReason: 'transfer' }
      : s));
    db.securities.push(
      { id: 't1', kind: 'shares', label: 'CS-3', stakeholderId: 'h4', classId: 'c1', quantity: 400_000, pricePerShare: 0.0001, date: '2026-08-01', fromTransferId: 's1', transferPricePerShare: 2 },
      { id: 't2', kind: 'shares', label: 'CS-4', stakeholderId: 'h1', classId: 'c1', quantity: 3_600_000, pricePerShare: 0.0001, date: '2026-08-01', fromTransferId: 's1' },
    );
    const history = issuanceHistory(db);
    // The 2023 issuance still reads at full original size; the transfer day
    // adds no phantom 4M-share issuance.
    expect(history.some((h) => h.date === '2026-08-01')).toBe(false);
    expect(history.at(-1)).toMatchObject({ date: '2023-05-20', shares: 7_000_000 });
  });
});

/* ---------- Upcoming events ---------- */

describe('upcomingEvents', () => {
  // OPT-1: 500,000 options, 48/12 from 2024-07-01 → cliff 2025-07-01, full vest 2028-07-01.
  const types = (events) => events.map((e) => `${e.type}:${e.date}`);

  it('finds the cliff and the full-vest date of a grant', () => {
    const db = makeDb();
    expect(types(upcomingEvents(db, { from: '2025-01-01', horizonMonths: 12 })))
      .toEqual(['cliff:2025-07-01']);
    expect(types(upcomingEvents(db, { from: '2028-01-01', horizonMonths: 12 })))
      .toEqual(['vest-complete:2028-07-01']);
  });

  it('reports how many shares the cliff releases', () => {
    const [cliff] = upcomingEvents(makeDb(), { from: '2025-01-01', horizonMonths: 12 });
    expect(cliff).toMatchObject({ label: 'OPT-1', name: 'Sam', quantity: 125_000 });
  });

  it('includes the boundaries and excludes what falls outside them', () => {
    const db = makeDb();
    // The cliff lands exactly on `from` and exactly on the horizon edge.
    expect(types(upcomingEvents(db, { from: '2025-07-01', horizonMonths: 1 }))).toEqual(['cliff:2025-07-01']);
    expect(types(upcomingEvents(db, { from: '2025-06-01', horizonMonths: 1 }))).toEqual(['cliff:2025-07-01']);
    // A horizon ending the day before, and a start the day after, both miss it.
    expect(types(upcomingEvents(db, { from: '2025-05-31', horizonMonths: 1 }))).toEqual([]);
    expect(types(upcomingEvents(db, { from: '2025-07-02', horizonMonths: 1 }))).toEqual([]);
  });

  it('collapses a cliff that is the whole schedule into the full-vest event', () => {
    const db = makeDb();
    db.securities = db.securities.map((s) => (s.id === 'o1' ? { ...s, vestingMonths: 12, cliffMonths: 12 } : s));
    expect(types(upcomingEvents(db, { from: '2025-01-01', horizonMonths: 12 })))
      .toEqual(['vest-complete:2025-07-01']);
  });

  it('names the day a repurchase remainder actually finishes vesting', () => {
    // 700 shares kept out of 1,000 after a buyback of the unvested tail: the
    // schedule still runs 48 months against the 1,000, so the remainder is
    // fully vested 33.6 months in, not at month 48.
    const db = {
      company: { name: 'Test Co', poolAuthorized: 0 },
      classes: [{ id: 'c1', name: 'Common Stock', kind: 'common' }],
      stakeholders: [holder('h1', 'Ada')],
      securities: [{
        id: 'r1', kind: 'shares', label: 'CS-2', stakeholderId: 'h1', classId: 'c1',
        quantity: 700, vestingBase: 1000, pricePerShare: 0.01, date: '2024-01-01',
        vestingMonths: 48, cliffMonths: 0, vestingStart: '2024-01-01',
      }],
    };
    const events = upcomingEvents(db, { from: '2026-06-01', horizonMonths: 24 });
    const done = events.filter((e) => e.type === 'vest-complete');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ date: '2026-11-01', quantity: 700 });
    expect(vestedQuantity(db.securities[0], '2026-11-01')).toBe(700);
    expect(vestedQuantity(db.securities[0], '2026-10-01')).toBeLessThan(700);

    // The same clamp on a tranche schedule kept whole against a smaller
    // position: it completes at the tranche that reaches the position.
    const tranched = {
      ...db,
      securities: [{
        id: 'r2', kind: 'shares', label: 'CS-3', stakeholderId: 'h1', classId: 'c1',
        quantity: 700, pricePerShare: 0.01, date: '2024-01-01',
        vestingTranches: [
          { date: '2026-07-01', quantity: 400 },
          { date: '2027-01-01', quantity: 400 },
          { date: '2027-07-01', quantity: 200 },
        ],
      }],
    };
    const tevents = upcomingEvents(tranched, { from: '2026-06-01', horizonMonths: 24 });
    expect(tevents.map((e) => [e.type, e.date])).toEqual([
      ['tranche', '2026-07-01'],
      ['vest-complete', '2027-01-01'],
    ]);
  });

  it('degrades gracefully when the optional fields are absent', () => {
    const db = makeDb();
    // No schedule, no expiry, no maturity → nothing to say.
    db.securities = db.securities.map((s) => (s.id === 'o1' ? { ...s, vestingMonths: 0, cliffMonths: 0 } : s));
    db.securities.push({ id: 'sf', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 1e6, date: '2025-01-01' });
    expect(upcomingEvents(db, { from: '2025-01-01', horizonMonths: 120 })).toEqual([]);
  });

  it('surfaces note maturities and expirations', () => {
    const db = makeDb();
    db.securities.push(
      { id: 'n1', kind: 'note', label: 'CN-1', stakeholderId: 'h4', principal: 100_000, interestRate: 0, date: '2025-01-01', maturityDate: '2026-07-01' },
      { id: 'w1', kind: 'warrant', label: 'WNT-1', stakeholderId: 'h4', classId: 'p1', quantity: 50_000, strike: 0.5, date: '2025-01-01', expires: '2026-09-01' });
    db.securities = db.securities.map((s) => (s.id === 'o1' ? { ...s, expires: '2026-08-01' } : s));
    const events = upcomingEvents(db, { from: '2026-06-01', horizonMonths: 6 });
    expect(types(events)).toEqual(['maturity:2026-07-01', 'expiration:2026-08-01', 'expiration:2026-09-01']);
    expect(events[0].amount).toBe(100_000);
    expect(events[1].quantity).toBe(500_000);
  });

  it('goes quiet for a cancelled or fully exercised grant', () => {
    const db = makeDb();
    db.securities = db.securities.map((s) => (s.id === 'o1'
      ? { ...s, cancelled: 500_000, cancelledDate: '2025-01-01', expires: '2026-08-01' }
      : s));
    expect(upcomingEvents(db, { from: '2025-01-02', horizonMonths: 60 })).toEqual([]);

    const exercised = makeDb();
    exercised.securities = exercised.securities.map((s) => (s.id === 'o1'
      ? { ...s, exercised: 500_000, expires: '2026-08-01' }
      : s));
    expect(types(upcomingEvents(exercised, { from: '2026-01-01', horizonMonths: 12 })))
      .toEqual([]);
  });

  it('announces a partly early-exercised grant once, not twice', () => {
    /* The certificate an early exercise wrote carries its share of the same
       schedule and announces those shares itself, so the grant must announce
       only what is left on it. Announced whole, the calendar promised more
       than the unvested balance actually falls by. */
    const db = {
      company: { name: 'Test Co', poolAuthorized: 0 },
      classes: [{ id: 'c1', name: 'Common Stock', kind: 'common' }],
      stakeholders: [holder('h1', 'Ada')],
      securities: [
        {
          id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1', quantity: 1000,
          strike: 0.1, grantDate: '2025-01-01', date: '2025-01-01', exercised: 500,
          vestingMonths: 48, cliffMonths: 12, expires: '2035-01-01',
        },
        {
          id: 'x1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1',
          quantity: 500, pricePerShare: 0.1, date: '2025-02-01', fromOptionId: 'o1',
          vestingMonths: 48, cliffMonths: 12, vestingStart: '2025-01-01',
        },
      ],
    };
    const cliffs = upcomingEvents(db, { from: '2025-12-01', horizonMonths: 12 })
      .filter((e) => e.type === 'cliff');
    expect(cliffs.map((e) => [e.label, e.quantity])).toEqual([['CS-1', 125], ['OPT-1', 125]]);
    // Exactly the fall in the unvested balance on the day.
    expect(unvestedTotal(db.securities, '2025-12-31') - unvestedTotal(db.securities, '2026-01-01'))
      .toBe(250);
  });

  it('nets a tranche schedule against the certificate that took part of it', () => {
    const tranches = (q) => [1, 2, 3, 4].map((m) => ({ date: `2026-0${m}-01`, quantity: q }));
    const db = {
      company: { name: 'Test Co', poolAuthorized: 0 },
      classes: [{ id: 'c1', name: 'Common Stock', kind: 'common' }],
      stakeholders: [holder('h1', 'Ada')],
      securities: [
        {
          id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h1', quantity: 1000,
          strike: 0.1, grantDate: '2025-01-01', date: '2025-01-01', exercised: 400,
          expires: '2035-01-01', vestingTranches: tranches(250),
        },
        {
          id: 'x1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1',
          quantity: 400, pricePerShare: 0.1, date: '2025-02-01', fromOptionId: 'o1',
          vestingTranches: tranches(100),
        },
      ],
    };
    const events = upcomingEvents(db, { from: '2025-12-01', horizonMonths: 12 });
    const onJan = events.filter((e) => e.date === '2026-01-01');
    expect(onJan.map((e) => [e.label, e.quantity])).toEqual([['CS-1', 100], ['OPT-1', 150]]);
    expect(unvestedTotal(db.securities, '2025-12-31') - unvestedTotal(db.securities, '2026-01-01'))
      .toBe(250);
  });

  it('returns nothing without a starting date', () => {
    expect(upcomingEvents(makeDb(), {})).toEqual([]);
  });
});

/* ---------- Exit waterfall ---------- */

describe('exitWaterfall', () => {
  /**
   * 8,000,000 founder common and $4,000,000 of Series A at $2.00
   * (2,000,000 shares). No options, so the arithmetic stays checkable by hand.
   */
  function exitDb({ multiple = 1, participating = false } = {}) {
    return {
      company: { name: 'Test Co', poolAuthorized: 0 },
      classes: [
        { id: 'c1', name: 'Common Stock', kind: 'common', liquidationMultiple: 0, participating: false, seniority: 0 },
        { id: 'p1', name: 'Series A Preferred', kind: 'preferred', liquidationMultiple: multiple, participating, seniority: 1 },
      ],
      stakeholders: [holder('h1', 'Ada'), holder('h4', 'Nova Ventures', 'investor')],
      securities: [
        { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 8_000_000, pricePerShare: 0.0001, date: '2023-01-01' },
        { id: 's2', kind: 'shares', label: 'SA-1', stakeholderId: 'h4', classId: 'p1', quantity: 2_000_000, pricePerShare: 2, date: '2024-01-01' },
      ],
    };
  }
  const proceeds = (r, id) => r.rows.find((x) => x.stakeholderId === id)?.proceeds ?? 0;

  it('pays the preference first and leaves the rest to common', () => {
    const r = exitWaterfall(exitDb(), { exitValue: 10_000_000, asOf: '2026-01-01' });
    // 1x on $4M invested; the remaining $6M goes to 8M common shares.
    expect(r.preferencePaid).toBe(4_000_000);
    expect(r.pricePerShare).toBeCloseTo(0.75, 10);
    expect(proceeds(r, 'h4')).toBeCloseTo(4_000_000, 6);
    expect(proceeds(r, 'h1')).toBeCloseTo(6_000_000, 6);
    expect(r.distributed).toBeCloseTo(10_000_000, 6);
  });

  it('gives preferred nothing but the preference in a downside exit', () => {
    const r = exitWaterfall(exitDb(), { exitValue: 3_000_000, asOf: '2026-01-01' });
    expect(proceeds(r, 'h4')).toBeCloseTo(3_000_000, 6);
    expect(proceeds(r, 'h1')).toBe(0);
    expect(r.residual).toBe(0);
  });

  it('reports exactly zero paid on preferences when there is no preferred stock', () => {
    // Two SAFEs with cents, no preferred classes: the tier arithmetic used to
    // leave a float residue a hair below zero, which the exit view printed
    // as "-$0". The figure is the sum of what the stack was paid, so it is 0.
    const db = {
      company: { name: 'T', poolAuthorized: 0 },
      classes: [{ id: 'c1', name: 'Common', kind: 'common' }],
      stakeholders: [{ id: 'h1', name: 'Ada', kind: 'founder' }, { id: 'h2', name: 'Angel', kind: 'investor' }],
      securities: [
        { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 8_000_000, pricePerShare: 0.0001, date: '2023-01-01' },
        { id: 'sf', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h2', principal: 251086.83, valuationCap: 0, discount: 20, safeType: 'post', date: '2025-01-01' },
        { id: 'sf2', kind: 'safe', label: 'SAFE-2', stakeholderId: 'h2', principal: 92968.86, valuationCap: 0, discount: 0, safeType: 'pre', date: '2025-01-01' },
      ],
    };
    const r = exitWaterfall(db, { exitValue: 407230.24, asOf: '2026-01-01' });
    expect(r.preferencePaid).toBe(0);
    expect(Object.is(r.preferencePaid, -0)).toBe(false);
  });

  it('lets a SAFE convert on its own when the joint conversion with another has no answer', () => {
    /* Two uncapped discount SAFEs whose joint conversion claims more than
       is left after the preference, one of which converts comfortably once
       the other takes its money back. The joint conversion's unanswerable
       solve left a price set over the common alone, the preferred converted
       on it, and the two elections then chased each other two states apart
       until the passes ran out: the table paid the 20%-discount SAFE its
       $3,000,000 back beside a conversion it said was worth $3,750,000. */
    const db = {
      company: { name: 'Test Co', poolAuthorized: 0 },
      classes: [
        { id: 'c1', name: 'Common Stock', kind: 'common', liquidationMultiple: 0, participating: false, seniority: 0 },
        { id: 'p1', name: 'Series A Preferred', kind: 'preferred', liquidationMultiple: 1, participating: false, seniority: 1 },
      ],
      stakeholders: [holder('h1', 'Ada'), holder('h2', 'Nova Ventures', 'investor'),
        holder('h3', 'Steep Fund', 'investor'), holder('h4', 'Gentle Fund', 'investor')],
      securities: [
        { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 1_000_000, pricePerShare: 1, date: '2023-01-01' },
        { id: 's2', kind: 'shares', label: 'SA-1', stakeholderId: 'h2', classId: 'p1', quantity: 1_000_000, pricePerShare: 2, date: '2024-01-01' },
        { id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h3', principal: 3_000_000, valuationCap: 0, discount: 40, safeType: 'post', date: '2025-01-01' },
        { id: 'sf2', kind: 'safe', label: 'SAFE-2', stakeholderId: 'h4', principal: 3_000_000, valuationCap: 0, discount: 20, safeType: 'pre', date: '2025-01-01' },
      ],
    };
    const r = exitWaterfall(db, { exitValue: 10_000_000, asOf: '2026-01-01' });
    const safe = (label) => r.convertibles.find((c) => c.label === label);
    // $8M after the $2M preference: the 40% SAFE's $5M claim leaves the 20%
    // SAFE's $3.75M no room, and alone it would take the whole $5M residual
    // after the other's money back - no answer either. It takes its money.
    expect(safe('SAFE-1')).toMatchObject({ elected: 'cash', proceeds: 3_000_000 });
    // The 20% SAFE converts alone into $5M of residual: $3.75M, $1.25M to common.
    expect(safe('SAFE-2').elected).toBe('converted');
    expect(safe('SAFE-2').proceeds).toBeCloseTo(3_750_000, 0);
    expect(r.classes[0]).toMatchObject({ classId: 'p1', converted: false, paid: 2_000_000 });
    expect(proceeds(r, 'h1')).toBeCloseTo(1_250_000, 0);
    expect(r.pricePerShare).toBeCloseTo(1.25, 6);
    expect(r.distributed).toBeCloseTo(10_000_000, 6);
    // At every exit, a SAFE paid its money back is never shown a conversion
    // the rule says it should have taken.
    for (let exit = 3_000_000; exit <= 16_000_000; exit += 250_000) {
      const w = exitWaterfall(db, { exitValue: exit, asOf: '2026-01-01' });
      for (const c of w.convertibles.filter((c) => c.elected === 'cash')) {
        expect(c.asConverted, `at ${exit}`).toBeLessThanOrEqual(c.proceeds + 1 + c.proceeds * 1e-6);
      }
      expect(w.distributed).toBeCloseTo(exit, 3);
    }
  });

  it('converts to common once that pays more than the preference', () => {
    // At $100M, 20% of the company beats a $4M preference.
    const r = exitWaterfall(exitDb(), { exitValue: 100_000_000, asOf: '2026-01-01' });
    expect(r.classes[0].converted).toBe(true);
    expect(r.preferencePaid).toBe(0);
    expect(proceeds(r, 'h4')).toBeCloseTo(20_000_000, 6);
    expect(proceeds(r, 'h1')).toBeCloseTo(80_000_000, 6);
  });

  it('takes a 2x preference until conversion beats it', () => {
    const r = exitWaterfall(exitDb({ multiple: 2 }), { exitValue: 20_000_000, asOf: '2026-01-01' });
    // 2x = $8M off the top; $12M over 8M common shares.
    expect(r.classes[0].converted).toBe(false);
    expect(proceeds(r, 'h4')).toBeCloseTo(8_000_000, 6);
    expect(proceeds(r, 'h1')).toBeCloseTo(12_000_000, 6);
    // At $50M, converting is worth 20% = $10M, which beats $8M.
    const big = exitWaterfall(exitDb({ multiple: 2 }), { exitValue: 50_000_000, asOf: '2026-01-01' });
    expect(big.classes[0].converted).toBe(true);
    expect(proceeds(big, 'h4')).toBeCloseTo(10_000_000, 6);
  });

  it('lets participating preferred double dip', () => {
    const r = exitWaterfall(exitDb({ participating: true }), { exitValue: 20_000_000, asOf: '2026-01-01' });
    // $4M preference, then 20% of the remaining $16M on top.
    expect(r.classes[0].converted).toBe(false);
    expect(proceeds(r, 'h4')).toBeCloseTo(4_000_000 + 3_200_000, 6);
    expect(proceeds(r, 'h1')).toBeCloseTo(12_800_000, 6);
    expect(r.distributed).toBeCloseTo(20_000_000, 6);
  });

  it('pays senior preferences before junior ones when money is short', () => {
    const db = exitDb();
    db.classes.push({ id: 'p2', name: 'Series B Preferred', kind: 'preferred', liquidationMultiple: 1, participating: false, seniority: 2 });
    db.stakeholders.push(holder('h5', 'Beacon', 'investor'));
    db.securities.push({ id: 's3', kind: 'shares', label: 'SB-1', stakeholderId: 'h5', classId: 'p2', quantity: 1_000_000, pricePerShare: 6, date: '2025-01-01' });
    // $5M against $6M of Series B and $4M of Series A: B is senior and takes it all.
    const r = exitWaterfall(db, { exitValue: 5_000_000, asOf: '2026-01-01' });
    expect(proceeds(r, 'h5')).toBeCloseTo(5_000_000, 6);
    expect(proceeds(r, 'h4')).toBe(0);
    expect(proceeds(r, 'h1')).toBe(0);
  });

  it('splits pro rata inside a seniority tier that runs short', () => {
    const db = exitDb();
    db.classes.push({ id: 'p2', name: 'Series A-1 Preferred', kind: 'preferred', liquidationMultiple: 1, participating: false, seniority: 1 });
    db.stakeholders.push(holder('h5', 'Beacon', 'investor'));
    db.securities.push({ id: 's3', kind: 'shares', label: 'SA1-1', stakeholderId: 'h5', classId: 'p2', quantity: 1_000_000, pricePerShare: 4, date: '2025-01-01' });
    // $6M against $4M + $4M of equally senior preferences: each gets 75%.
    const r = exitWaterfall(db, { exitValue: 6_000_000, asOf: '2026-01-01' });
    expect(proceeds(r, 'h4')).toBeCloseTo(3_000_000, 6);
    expect(proceeds(r, 'h5')).toBeCloseTo(3_000_000, 6);
  });

  it('splits a class preference by invested capital, not share count', () => {
    const db = exitDb();
    // A SAFE that converted at $1.00 into the same class as $2.00 new money:
    // same share count as SA-1, half the dollars in.
    db.stakeholders.push(holder('h5', 'Beacon', 'investor'));
    db.securities.push({ id: 's3', kind: 'shares', label: 'SA-2', stakeholderId: 'h5', classId: 'p1', quantity: 2_000_000, pricePerShare: 1, date: '2024-01-01' });
    // $6M covers the $6M preference exactly: each holder gets their money back.
    const r = exitWaterfall(db, { exitValue: 6_000_000, asOf: '2026-01-01' });
    expect(proceeds(r, 'h4')).toBeCloseTo(4_000_000, 6);
    expect(proceeds(r, 'h5')).toBeCloseTo(2_000_000, 6);
    // Short of the stack, the split keeps the same proportions.
    const short = exitWaterfall(db, { exitValue: 3_000_000, asOf: '2026-01-01' });
    expect(proceeds(short, 'h4')).toBeCloseTo(2_000_000, 6);
    expect(proceeds(short, 'h5')).toBeCloseTo(1_000_000, 6);
  });

  it('pays option holders the money net of their strike', () => {
    const db = exitDb();
    db.stakeholders.push(holder('h3', 'Sam', 'employee'));
    db.securities.push(
      { id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h3', quantity: 1_000_000, strike: 0.5, grantDate: '2024-01-01', vestingMonths: 0 },
      { id: 'o2', kind: 'option', label: 'OPT-2', stakeholderId: 'h3', quantity: 1_000_000, strike: 50, grantDate: '2024-01-01', vestingMonths: 0 });
    const r = exitWaterfall(db, { exitValue: 14_000_000, asOf: '2026-01-01' });
    // $4M preference, then $10M plus $500k of exercise money over 9M shares.
    expect(r.pricePerShare).toBeCloseTo(10_500_000 / 9_000_000, 8);
    expect(proceeds(r, 'h3')).toBeCloseTo(1_000_000 * (r.pricePerShare - 0.5), 6);
    // The $50 strike is deep underwater and takes nothing.
    expect(r.pricePerShare).toBeLessThan(50);
    expect(proceeds(r, 'h3')).toBeCloseTo(666_666.67, 1);
    // Exercise money is internal: it goes in and comes straight back out, so
    // holders still divide exactly the exit value between them.
    expect(r.distributed).toBeCloseTo(14_000_000, 6);
  });

  it('excludes cancelled options and the unallocated pool', () => {
    const db = exitDb();
    db.company.poolAuthorized = 5_000_000;
    db.stakeholders.push(holder('h3', 'Sam', 'employee'));
    db.securities.push({ id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h3', quantity: 1_000_000, strike: 0, grantDate: '2024-01-01', vestingMonths: 0, cancelled: 1_000_000, cancelledDate: '2025-01-01' });
    const r = exitWaterfall(db, { exitValue: 12_000_000, asOf: '2026-01-01' });
    expect(proceeds(r, 'h3')).toBe(0);
    // 8M common only - the 5M pool holds nothing for anybody.
    expect(r.pricePerShare).toBeCloseTo(1, 10);
  });

  it('counts an exercised grant on its certificate, never on both', () => {
    const db = exitDb();
    db.stakeholders.push(holder('h3', 'Sam', 'employee'));
    // 1M options at a $0 strike, 400k of them exercised into a certificate.
    db.securities.push(
      { id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h3', quantity: 1_000_000, strike: 0, grantDate: '2024-01-01', vestingMonths: 0, exercised: 400_000 },
      { id: 's9', kind: 'shares', label: 'CS-9', stakeholderId: 'h3', classId: 'c1', quantity: 400_000, pricePerShare: 0, date: '2025-01-01', fromOptionId: 'o1' });
    const r = exitWaterfall(db, { exitValue: 13_000_000, asOf: '2026-01-01' });
    // 8.4M common + 600k still-unexercised options = 9M participating shares,
    // dividing the $9M residual - the exercised 400k counted once, not twice.
    expect(r.pricePerShare).toBeCloseTo(1, 10);
    expect(proceeds(r, 'h3')).toBeCloseTo(1_000_000, 6);
    expect(r.distributed).toBeCloseTo(13_000_000, 6);
  });

  it('converts a capped SAFE at the exit price and pays it from the residual', () => {
    const db = exitDb();
    db.securities.push({ id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 500_000, valuationCap: 8e6, discount: 0, safeType: 'post', date: '2025-01-01' });
    const r = exitWaterfall(db, { exitValue: 20_000_000, asOf: '2026-01-01' });
    const safe = r.convertibles.find((c) => c.id === 'sf1');
    // $500k against an $8M post-money cap is 6.25% of the capitalization the
    // SAFE's own shares are part of: 666,667 shares on 10M pre.
    expect(safe.elected).toBe('converted');
    expect(safe.shares).toBeCloseTo(666_666.67, 1);
    expect(r.pricePerShare).toBeCloseTo(16_000_000 / 8_666_666.67, 6);
    expect(safe.proceeds).toBeCloseTo(safe.shares * r.pricePerShare, 6);
    // Nothing is lost: every dollar of the sale is still distributed.
    expect(r.distributed).toBeCloseTo(20_000_000, 6);
  });

  it('takes the money back when converting pays a SAFE less', () => {
    const db = exitDb();
    db.securities.push({ id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 500_000, valuationCap: 8e6, discount: 0, safeType: 'post', date: '2025-01-01' });
    // $4.2M: the $4M preference clears and only $200k is left to share, so
    // 666,667 converted shares would be worth far less than $500k.
    const r = exitWaterfall(db, { exitValue: 4_200_000, asOf: '2026-01-01' });
    const safe = r.convertibles.find((c) => c.id === 'sf1');
    expect(safe.elected).toBe('cash');
    /* Its money back, on par with the preferred: $4.2M cannot cover the $4M
       preference and the $500k cash-out together, so the two share it pro
       rata by claim - and common gets nothing. */
    expect(safe.proceeds).toBeCloseTo(4_200_000 * (500_000 / 4_500_000), 6);
    expect(r.cashedOut).toBeCloseTo(4_200_000 * (500_000 / 4_500_000), 6);
    expect(r.preferencePaid).toBeCloseTo(4_200_000 * (4_000_000 / 4_500_000), 6);
    expect(r.residual).toBeCloseTo(0, 6);
    expect(proceeds(r, 'h1')).toBe(0);
  });

  it('reports no shares when converting has no price to settle on', () => {
    const db = exitDb();
    /* A discounted SAFE whose money is several times the residual: every pass
       of the conversion buys more shares at a lower price than the last, so
       there is no share count consistent with the price it produces. What the
       holder gets is their money back as far as it stretches - not a share
       count with nineteen digits in it. */
    db.securities.push({ id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 500_000, valuationCap: 8e6, discount: 20, safeType: 'post', date: '2025-01-01' });
    const r = exitWaterfall(db, { exitValue: 4_100_000, asOf: '2026-01-01' });
    const safe = r.convertibles.find((c) => c.id === 'sf1');
    expect(safe.elected).toBe('cash');
    expect(safe.shares).toBe(0);
    expect(safe.conversionPrice).toBe(0);
    // Its share of a $4.1M pool it ranks in beside the $4M preference.
    expect(safe.proceeds).toBeCloseTo(4_100_000 * (500_000 / 4_500_000), 6);
    // Every dollar still lands somewhere, which is the part that has to hold.
    expect(r.distributed).toBeCloseTo(4_100_000, 6);
  });

  it('lets a SAFE convert once the others have taken their money off the top', () => {
    /* Two SAFEs against $3,500 and a founder's 1,000 shares. Everything
       converting has no fixed point - the SAFEs' money outruns the sale - so
       the first pass moves both to cash. SAFE-B's $2,000 leaves $1,500, which
       is more than enough for SAFE-A's discounted conversion, and the model's
       own report said so: it printed asConverted $1,111 beside proceeds of
       $1,000 and left it in cash, because a cashed SAFE holds no shares and
       the election read that as "cannot convert". */
    const db = {
      company: { poolAuthorized: 0 },
      classes: [{ id: 'c', kind: 'common' }],
      stakeholders: [{ id: 'f', name: 'Founder' }, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      securities: [
        { id: 'cs', kind: 'shares', classId: 'c', stakeholderId: 'f', quantity: 1000, pricePerShare: 0.01 },
        { id: 'a', label: 'SAFE-A', kind: 'safe', safeType: 'pre', stakeholderId: 'a', principal: 1000, discount: 10 },
        { id: 'b', label: 'SAFE-B', kind: 'safe', safeType: 'pre', stakeholderId: 'b', principal: 2000, discount: 20 },
      ],
    };
    const r = exitWaterfall(db, { exitValue: 3500, asOf: '2025-01-01' });
    const a = r.convertibles.find((c) => c.id === 'a');
    const b = r.convertibles.find((c) => c.id === 'b');
    expect(b.elected).toBe('cash');
    expect(b.proceeds).toBeCloseTo(2000, 6);
    expect(a.elected).toBe('converted');
    // 1,000 at a 10% discount off a $0.3889 residual price.
    expect(a.proceeds).toBeCloseTo(1000 / 0.9, 4);
    expect(proceeds(r, 'f')).toBeCloseTo(3500 - 2000 - 1000 / 0.9, 4);
    expect(r.distributed).toBeCloseTo(3500, 6);
    // Whatever each SAFE elected, it is never worse than the other leg the
    // same model reports beside it.
    for (const c of r.convertibles) expect(c.proceeds).toBeGreaterThanOrEqual(c.asConverted - 1e-6);
  });

  it('reads a SAFE with nothing left to convert into as money owed', () => {
    const db = exitDb();
    db.securities.push({ id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 500_000, valuationCap: 8e6, discount: 0, safeType: 'post', date: '2025-01-01' });
    /* The $4M preference and the $500k cash-out outrun the whole sale, so
       nothing is left to convert into and the SAFE takes its share of the
       pool it ranks in with the preferred. */
    const r = exitWaterfall(db, { exitValue: 3_000_000, asOf: '2026-01-01' });
    const safe = r.convertibles.find((c) => c.id === 'sf1');
    expect(safe.elected).toBe('cash');
    expect(safe.shares).toBe(0);
    expect(safe.proceeds).toBeCloseTo(3_000_000 * (500_000 / 4_500_000), 6);
    expect(r.distributed).toBeCloseTo(3_000_000, 6);
  });

  it('repays a note off the top, ahead of the preference stack', () => {
    const db = exitDb();
    db.securities.push({ id: 'n1', kind: 'note', label: 'CN-1', stakeholderId: 'h4', principal: 1_000_000, valuationCap: 0, discount: 0, interestRate: 0, date: '2025-01-01' });
    const r = exitWaterfall(db, { exitValue: 4_000_000, asOf: '2026-01-01' });
    expect(r.debtRepaid).toBeCloseTo(1_000_000, 6);
    // Only $3M of the $4M preference is left to pay.
    expect(r.preferencePaid).toBeCloseTo(3_000_000, 6);
    expect(r.residual).toBeCloseTo(0, 6);
    expect(proceeds(r, 'h4')).toBeCloseTo(4_000_000, 6);
    expect(r.convertibles[0]).toMatchObject({ elected: 'repaid', kind: 'note' });
  });

  it('accrues note interest to the closing date and pays notes pro rata when short', () => {
    const db = exitDb();
    db.securities.push(
      { id: 'n1', kind: 'note', label: 'CN-1', stakeholderId: 'h4', principal: 1_000_000, valuationCap: 0, discount: 0, interestRate: 10, date: '2025-01-01' },
      { id: 'n2', kind: 'note', label: 'CN-2', stakeholderId: 'h1', principal: 1_000_000, valuationCap: 0, discount: 0, interestRate: 0, date: '2025-01-01' },
    );
    const owed = convertibleValue(db.securities.find((x) => x.id === 'n1'), '2026-01-01');
    expect(owed).toBeGreaterThan(1_000_000);
    // A sale that cannot even cover the debt splits it in proportion.
    const r = exitWaterfall(db, { exitValue: 1_000_000, asOf: '2026-01-01' });
    expect(r.debtRepaid).toBeCloseTo(1_000_000, 6);
    expect(r.preferencePaid).toBe(0);
    const first = r.convertibles.find((c) => c.id === 'n1');
    const second = r.convertibles.find((c) => c.id === 'n2');
    expect(first.proceeds + second.proceeds).toBeCloseTo(1_000_000, 6);
    expect(first.proceeds / second.proceeds).toBeCloseTo(owed / 1_000_000, 6);
  });

  it('converts an uncapped SAFE rather than reading a tie as money back', () => {
    const db = exitDb();
    /* No cap and no discount, so the exit price is the conversion price and
       the two legs pay the same to the cent. That tie belongs to converting -
       and it is the ordinary shape of a SAFE at a healthy exit, so getting it
       wrong would report almost every one of them as taking its money back
       off the top instead of holding shares. */
    db.securities.push({ id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 500_000, valuationCap: 0, discount: 0, safeType: 'post', date: '2025-01-01' });
    const r = exitWaterfall(db, { exitValue: 40_000_000, asOf: '2026-01-01' });
    const safe = r.convertibles.find((c) => c.id === 'sf1');
    expect(safe.elected).toBe('converted');
    expect(safe.shares).toBeGreaterThan(0);
    expect(safe.proceeds).toBeCloseTo(500_000, 2);
    // The money-back leg is empty, so nothing ranks ahead of common here.
    expect(r.cashedOut).toBe(0);
    expect(r.distributed).toBeCloseTo(40_000_000, 6);
  });

  it('still converts on the tie when the SAFE is most of what is left to share', () => {
    const db = exitDb();
    /* $5M of SAFE money against $8M left to share after the preference. The
       fixed point behind the conversion settles at a rate of money / residual
       per pass, so a SAFE this large was still short of its own money after
       two dozen passes and read as taking its money back - with no shares -
       from a cap table where converting pays it exactly the same. */
    db.securities.push({ id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 5_000_000, valuationCap: 0, discount: 0, safeType: 'post', date: '2025-01-01' });
    const r = exitWaterfall(db, { exitValue: 12_000_000, asOf: '2026-01-01' });
    const safe = r.convertibles.find((c) => c.id === 'sf1');
    expect(safe.elected).toBe('converted');
    expect(safe.proceeds).toBeCloseTo(5_000_000, 0);
    expect(safe.shares * r.pricePerShare).toBeCloseTo(5_000_000, 0);
    expect(r.distributed).toBeCloseTo(12_000_000, 6);
    // And the breakeven names the exit where converting starts to tie the
    // money back, not a point 1.7x above it.
    const flip = exitBreakevens(db, { asOf: '2026-01-01' }).find((p) => p.type === 'safe-converts');
    expect(flip.exitValue).toBeLessThan(4_000_000 + 5_000_000 * 1.01);
  });

  it('converts a capped SAFE the exit has already priced above its cap basis', () => {
    const db = exitDb();
    /* A cap so high the exit price never reaches it: the cap does not bind,
       the conversion is at the exit price, and the legs tie again. */
    db.securities.push({ id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 500_000, valuationCap: 500e6, discount: 0, safeType: 'post', date: '2025-01-01' });
    const r = exitWaterfall(db, { exitValue: 40_000_000, asOf: '2026-01-01' });
    expect(r.convertibles.find((c) => c.id === 'sf1').elected).toBe('converted');
  });

  it('always converts a discounted SAFE - it buys shares below the exit price', () => {
    const db = exitDb();
    db.securities.push({ id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 500_000, valuationCap: 0, discount: 20, safeType: 'post', date: '2025-01-01' });
    const r = exitWaterfall(db, { exitValue: 20_000_000, asOf: '2026-01-01' });
    const safe = r.convertibles.find((c) => c.id === 'sf1');
    expect(safe.elected).toBe('converted');
    // 20% off the exit price is 25% more value than the money back.
    expect(safe.proceeds).toBeCloseTo(500_000 / 0.8, 4);
    expect(r.distributed).toBeCloseTo(20_000_000, 6);
  });

  it('prices the residual over the awards it reports in the money, however many cascade', () => {
    /* Thirty grants whose strikes step down by a factor of three, each pass
       of the fixed point dropping exactly one: more passes than the fixed
       count allowed, and a price below a millionth of a dollar that an
       absolute tolerance read as out of the money for every award. Both
       returned a price set over one set of awards beside another. */
    const db = exitDb();
    db.classes = [db.classes[0]];
    db.securities = [
      { ...db.securities[0], quantity: 1_000 },
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `o${i}`, kind: 'option', label: `OPT-${i}`, stakeholderId: 'h4', quantity: 1_000_000,
        strike: 3 ** (i - 29), grantDate: '2020-01-01', date: '2020-01-01', vestingMonths: 0, exercised: 0,
      })),
    ];
    for (const exitValue of [1, 10, 1_000, 10_000]) {
      const r = exitWaterfall(db, { exitValue, asOf: '2026-01-01' });
      expect(r.distributed).toBeCloseTo(exitValue, 6);
      for (const a of r.awards) {
        if (a.inMoney) expect(a.strike).toBeLessThan(r.pricePerShare);
        else expect(a.strike).toBeGreaterThanOrEqual(r.pricePerShare * (1 - 1e-9));
      }
    }
  });

  it('never leaves a SAFE converted into nothing when two cannot both convert', () => {
    /* Two discounted SAFEs whose claims together ($625k at 20% off) exceed
       the residual: the joint conversion has no answer. Judged one at a time
       with the other in cash, each would rather convert, and moving both
       back at once sent them into that joint conversion and straight back to
       cash on the next pass, a cycle the pass count ended on the converting
       side - both SAFEs "converted" into no shares and paid nothing, while
       common took the whole $600k. */
    const db = exitDb();
    db.classes = [db.classes[0]];
    db.securities = [
      db.securities[0],
      { id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 250_000, valuationCap: 0, discount: 20, safeType: 'post', date: '2025-01-01' },
      { id: 'sf2', kind: 'safe', label: 'SAFE-2', stakeholderId: 'h4', principal: 250_000, valuationCap: 0, discount: 20, safeType: 'post', date: '2025-01-01' },
    ];
    for (const exitValue of [575_000, 600_000, 620_000]) {
      const r = exitWaterfall(db, { exitValue, asOf: '2026-01-01' });
      const safes = r.convertibles.filter((c) => c.kind === 'safe');
      // Every SAFE is paid at least its money back, and none reads converted for nothing.
      for (const c of safes) {
        expect(c.proceeds).toBeGreaterThanOrEqual(250_000 - 1e-6);
        if (c.elected === 'converted') expect(c.shares).toBeGreaterThan(0);
      }
      // One converts at the discount, the other takes its money back; common gets the rest.
      expect(safes.map((c) => c.elected).sort()).toEqual(['cash', 'converted']);
      expect(safes.find((c) => c.elected === 'converted').proceeds).toBeCloseTo(312_500, 4);
      expect(proceeds(r, 'h1')).toBeCloseTo(exitValue - 562_500, 4);
      expect(r.distributed).toBeCloseTo(exitValue, 6);
    }
    // Either side of the band the two agree: both cash below it, both converting above.
    const below = exitWaterfall(db, { exitValue: 560_000, asOf: '2026-01-01' });
    expect(below.convertibles.every((c) => c.elected === 'cash')).toBe(true);
    const above = exitWaterfall(db, { exitValue: 630_000, asOf: '2026-01-01' });
    expect(above.convertibles.every((c) => c.elected === 'converted' && c.shares > 0)).toBe(true);
  });

  it('marks where the debt is covered and where a SAFE flips to converting', () => {
    const db = exitDb();
    db.securities.push(
      { id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 500_000, valuationCap: 8e6, discount: 0, safeType: 'post', date: '2025-01-01' },
      { id: 'n1', kind: 'note', label: 'CN-1', stakeholderId: 'h4', principal: 1_000_000, valuationCap: 0, discount: 0, interestRate: 0, date: '2025-01-01' },
    );
    const points = exitBreakevens(db, { asOf: '2026-01-01' });
    const debt = points.find((p) => p.type === 'debt-repaid');
    const cleared = points.find((p) => p.type === 'stack-cleared');
    const flip = points.find((p) => p.type === 'safe-converts');
    expect(debt.exitValue).toBeCloseTo(1_000_000, 6);
    // The notes come off the top, so the stack clears $1M later than the
    // preference alone - and the SAFE, taking its money back below its flip,
    // is paid ahead of common too, so common earns nothing until $5.5M.
    expect(cleared.exitValue).toBeCloseTo(5_500_000, -1);
    const justBelow = exitWaterfall(db, { exitValue: 5_400_000, asOf: '2026-01-01' });
    expect(justBelow.rows.find((r) => r.stakeholderId === 'h1')?.proceeds || 0).toBe(0);
    expect(flip).toBeTruthy();
    expect(flip.securityId).toBe('sf1');
    // Below the flip it takes the money; above it, shares.
    const below = exitWaterfall(db, { exitValue: flip.exitValue * 0.9, asOf: '2026-01-01' });
    const above = exitWaterfall(db, { exitValue: flip.exitValue * 1.1, asOf: '2026-01-01' });
    expect(below.convertibles.find((c) => c.id === 'sf1').elected).toBe('cash');
    expect(above.convertibles.find((c) => c.id === 'sf1').elected).toBe('converted');
  });

  it('distributes nothing at a zero exit', () => {
    const r = exitWaterfall(exitDb(), { exitValue: 0, asOf: '2026-01-01' });
    expect(r.rows).toEqual([]);
    expect(r.distributed).toBe(0);
  });

  /* A cap table with no common issued yet (mid-setup, or investors-first):
     the conversion election must still be able to bootstrap, or everything
     above the preference stack silently vanishes from the payout. */
  describe('with only preferred outstanding', () => {
    const preferredOnly = () => ({
      company: { name: 'Test Co', poolAuthorized: 0 },
      classes: [
        { id: 'p1', name: 'Series Seed', kind: 'preferred', liquidationMultiple: 1, participating: false, seniority: 1 },
      ],
      stakeholders: [holder('h4', 'Nova Ventures', 'investor')],
      securities: [
        { id: 's2', kind: 'shares', label: 'SS-1', stakeholderId: 'h4', classId: 'p1', quantity: 1_750_000, pricePerShare: 1, date: '2024-01-01' },
      ],
    });

    it('converts and distributes the whole exit when that beats the preference', () => {
      const r = exitWaterfall(preferredOnly(), { exitValue: 60_000_000, asOf: '2026-01-01' });
      expect(r.classes[0].converted).toBe(true);
      expect(proceeds(r, 'h4')).toBeCloseTo(60_000_000, 6);
      expect(r.distributed).toBeCloseTo(60_000_000, 6);
    });

    it('still takes the preference in a downside exit', () => {
      const r = exitWaterfall(preferredOnly(), { exitValue: 1_000_000, asOf: '2026-01-01' });
      expect(r.classes[0].converted).toBe(false);
      expect(proceeds(r, 'h4')).toBeCloseTo(1_000_000, 6);
    });
  });
});

describe('post-money SAFE fixed point', () => {
  const db = (principal, cap) => ({
    company: { name: 'Test Co', poolAuthorized: 0 },
    classes: [{ id: 'c1', name: 'Common Stock', kind: 'common' }],
    stakeholders: [holder('h1', 'Ada'), holder('h4', 'Nova', 'investor')],
    securities: [
      { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 10_000_000, pricePerShare: 0.0001, date: '2023-01-01' },
      { id: 'sf', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal, valuationCap: cap, discount: 0, safeType: 'post', date: '2025-01-01' },
    ],
  });

  it('lands the capped shares exactly whatever the size of the claim', () => {
    // A post-money cap fixes the holder's percentage: principal / cap of the
    // capitalization after conversion, so shares = claim x FD / (1 - claim).
    for (const claim of [0.1, 0.5, 0.85, 0.9, 0.94]) {
      const r = modelRound(db(claim * 10_000_000, 10_000_000), {
        preMoney: 500_000_000, investment: 1_000_000, poolPct: 0, asOf: '2026-01-01',
      });
      const exact = (claim * 10_000_000) / (1 - claim);
      expect(r.overclaim).toBeFalsy();
      expect(Math.abs(r.conversionShares - exact)).toBeLessThan(1);
    }
  });
});

describe('exit table alternatives', () => {
  const db = {
    company: { name: 'Test Co', poolAuthorized: 0 },
    classes: [
      { id: 'c1', name: 'Common Stock', kind: 'common', liquidationMultiple: 0, participating: false, seniority: 0 },
      { id: 'p1', name: 'Series A Preferred', kind: 'preferred', liquidationMultiple: 1, participating: false, seniority: 1 },
    ],
    stakeholders: [holder('h1', 'Ada'), holder('h4', 'Nova', 'investor')],
    securities: [
      { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 8_000_000, pricePerShare: 0.0001, date: '2023-01-01' },
      { id: 's2', kind: 'shares', label: 'SA-1', stakeholderId: 'h4', classId: 'p1', quantity: 2_000_000, pricePerShare: 2, date: '2024-01-01' },
    ],
  };

  it('reports what converting would have paid a class that took its preference', () => {
    const r = exitWaterfall(db, { exitValue: 10_000_000, asOf: '2026-01-01' });
    const a = r.classes[0];
    expect(a.converted).toBe(false);
    expect(a.paid).toBeCloseTo(4_000_000, 6);
    // Converted, its 2M shares would share the whole $10M with 8M common:
    // $2M - not the $1.5M its shares fetch at the price it declined.
    expect(a.asConverted).toBeCloseTo(2_000_000, 6);
    const forced = exitWaterfall({
      ...db, classes: [db.classes[0], { ...db.classes[1], liquidationMultiple: 0 }],
    }, { exitValue: 10_000_000, asOf: '2026-01-01' });
    expect(forced.rows.find((x) => x.stakeholderId === 'h4').proceeds).toBeCloseTo(a.asConverted, 6);
  });

  it('reports what converting would have paid a SAFE that took its money back', () => {
    const withSafe = {
      ...db,
      securities: [...db.securities,
        { id: 'sf', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 500_000, valuationCap: 8_000_000, discount: 0, safeType: 'post', date: '2025-01-01' }],
    };
    const r = exitWaterfall(withSafe, { exitValue: 4_400_000, asOf: '2026-01-01' });
    const sf = r.convertibles.find((c) => c.id === 'sf');
    expect(sf.elected).toBe('cash');
    // Its share of the $4.4M it ranks in beside the $4M preference.
    expect(sf.proceeds).toBeCloseTo(4_400_000 * (500_000 / 4_500_000), 6);
    /* Converting instead would leave the preference paid in full and $400k
       of residual that cannot cover the SAFE's money - so converting takes
       the whole residual, the $400k the column reports rather than the "$0"
       it used to, and less than the money back pays. */
    expect(sf.asConverted).toBeCloseTo(400_000, 6);
    expect(sf.asConverted).toBeLessThan(sf.proceeds);
  });
});

describe('exitBreakevens', () => {
  const db = {
    company: { name: 'Test Co', poolAuthorized: 0 },
    classes: [
      { id: 'c1', name: 'Common Stock', kind: 'common', liquidationMultiple: 0, participating: false, seniority: 0 },
      { id: 'p1', name: 'Series A Preferred', kind: 'preferred', liquidationMultiple: 1, participating: false, seniority: 1 },
    ],
    stakeholders: [holder('h1', 'Ada'), holder('h4', 'Nova', 'investor')],
    securities: [
      { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 8_000_000, pricePerShare: 0.0001, date: '2023-01-01' },
      { id: 's2', kind: 'shares', label: 'SA-1', stakeholderId: 'h4', classId: 'p1', quantity: 2_000_000, pricePerShare: 2, date: '2024-01-01' },
    ],
  };

  it('reports where the stack clears and where the class converts', () => {
    const points = exitBreakevens(db, { asOf: '2026-01-01' });
    expect(points.map((p) => p.type)).toEqual(['stack-cleared', 'converts']);
    expect(points[0].exitValue).toBe(4_000_000);
    // Converting wins once 20% of the exit beats the $4M preference: $20M.
    expect(points[1].exitValue).toBeCloseTo(20_000_000, -2);
  });

  it('is the exact point the election flips', () => {
    const [, flip] = exitBreakevens(db, { asOf: '2026-01-01' });
    const at = (v) => exitWaterfall(db, { exitValue: v, asOf: '2026-01-01' }).classes[0].converted;
    expect(at(flip.exitValue * 1.001)).toBe(true);
    expect(at(flip.exitValue * 0.999)).toBe(false);
  });

  it('still finds the class flip when a converting SAFE pushes it past the usual bracket', () => {
    /* A pre-money SAFE with a cap typed three zeros short converts into a
       billion shares at the exit, so Series A converts only once the exit
       runs past two and a half billion - well outside a bracket sized from
       the shares on the table today. The point was silently dropped. */
    const wide = {
      ...db,
      stakeholders: [...db.stakeholders, holder('h5', 'Beacon', 'investor')],
      securities: [
        { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 248_000_000, pricePerShare: 0.0001, date: '2023-01-01' },
        { id: 's2', kind: 'shares', label: 'SA-1', stakeholderId: 'h4', classId: 'p1', quantity: 2_000_000, pricePerShare: 2, date: '2024-01-01' },
        { id: 'sf1', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h5', principal: 4_000_000, valuationCap: 1_000_000, discount: 0, date: '2025-01-01', safeType: 'pre' },
      ],
    };
    const flip = exitBreakevens(wide, { asOf: '2026-01-01' }).find((p) => p.type === 'converts');
    expect(flip).toBeTruthy();
    expect(flip.exitValue).toBeGreaterThan(1e9);
    const at = (v) => exitWaterfall(wide, { exitValue: v, asOf: '2026-01-01' }).classes[0].converted;
    expect(at(flip.exitValue * 1.001)).toBe(true);
    expect(at(flip.exitValue * 0.999)).toBe(false);
  });

  it('clears the stack only once SAFEs taking their money back are paid too', () => {
    // A $500k uncapped post-money SAFE behind the $4M preference: below $4.5M
    // it takes its money back ahead of common, so common still gets nothing
    // at the $4M the preference alone would suggest.
    const withSafe = {
      ...db,
      securities: [...db.securities,
        { id: 'sf', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 500_000, valuationCap: 0, discount: 0, safeType: 'post', date: '2025-01-01' }],
    };
    const cleared = exitBreakevens(withSafe, { asOf: '2026-01-01' }).find((p) => p.type === 'stack-cleared');
    expect(cleared.exitValue).toBeCloseTo(4_500_000, -1);
    expect(cleared.detail).toMatch(/SAFEs taking their money back/);
    const common = (v) => exitWaterfall(withSafe, { exitValue: v, asOf: '2026-01-01' })
      .rows.find((r) => r.stakeholderId === 'h1')?.proceeds || 0;
    expect(common(4_400_000)).toBe(0);
    expect(common(cleared.exitValue + 1000)).toBeGreaterThan(0);
  });

  it('yields the same points one at a time', () => {
    const withSafe = {
      ...db,
      securities: [...db.securities,
        { id: 'sf', kind: 'safe', label: 'SAFE-1', stakeholderId: 'h4', principal: 500_000, valuationCap: 0, discount: 0, safeType: 'post', date: '2025-01-01' }],
    };
    const all = exitBreakevens(withSafe, { asOf: '2026-01-01' });
    const yielded = [...exitBreakevenPoints(withSafe, { asOf: '2026-01-01' })];
    // Between points the generator yields nothing, once per waterfall evaluation, so a caller can hand the thread back mid-bisection.
    expect(yielded.filter((p) => p === undefined).length).toBeGreaterThan(all.length);
    const streamed = yielded.filter(Boolean);
    expect(streamed.length).toBe(all.length);
    expect(streamed.slice().sort((a, b) => a.exitValue - b.exitValue)).toEqual(all);
  });

  it('has nothing to report without preferred stock', () => {
    const common = { ...db, classes: [db.classes[0]], securities: [db.securities[0]] };
    expect(exitBreakevens(common, { asOf: '2026-01-01' })).toEqual([]);
  });

  it('finds a breakeven far above the old fixed search ceiling', () => {
    // 10,000 preferred shares at $400 beside 11M common: converting beats
    // the $4M preference only past ~$4.4B, which a fixed $1B ceiling
    // silently dropped from the card.
    const sliver = {
      ...db,
      securities: [
        { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 11_000_000, pricePerShare: 0.0001, date: '2023-01-01' },
        { id: 's2', kind: 'shares', label: 'SA-1', stakeholderId: 'h4', classId: 'p1', quantity: 10_000, pricePerShare: 400, date: '2024-01-01' },
      ],
    };
    const flip = exitBreakevens(sliver, { asOf: '2026-01-01' }).find((p) => p.type === 'converts');
    // Converting wins once shares/(all shares) of the exit beats $4M.
    expect(flip).toBeTruthy();
    const at = (v) => exitWaterfall(sliver, { exitValue: v, asOf: '2026-01-01' })
      .classes[0].converted;
    expect(at(flip.exitValue * 1.001)).toBe(true);
    expect(at(flip.exitValue * 0.999)).toBe(false);
  });
});

/* ---------- Labels ---------- */

describe('certificate labels', () => {
  it('derives class prefixes from names', () => {
    expect(classPrefix('Common Stock')).toBe('CS');
    expect(classPrefix('Series A Preferred')).toBe('SA');
    expect(classPrefix('Founders')).toBe('FO');
    expect(classPrefix('')).toBe('SH');
  });

  it('never splits a surrogate pair when a name opens with an emoji or a rare ideograph', () => {
    // Whole code points: an astral character is one letter, not two halves.
    expect(classPrefix('🚀 Rockets')).toBe('🚀R');
    expect(classPrefix('𠀀')).toBe('𠀀');
    expect(classPrefix('𠀀𠀁𠀂')).toBe('𠀀𠀁');
    for (const label of [classPrefix('🚀 Rockets'), classPrefix('𠀀𠀁𠀂')]) {
      expect(label.isWellFormed()).toBe(true);
    }
    const db = { classes: [{ id: 'c', name: '🚀 Rockets' }], securities: [] };
    expect(nextLabel(db, 'shares', 'c')).toBe('🚀R-1');
  });

  it('numbers within a class prefix and within other kinds', () => {
    const db = makeDb();
    expect(nextLabel(db, 'shares', 'c1')).toBe('CS-3');
    expect(nextLabel(db, 'shares', 'p1')).toBe('SS-2');
    expect(nextLabel(db, 'option')).toBe('OPT-2');
    expect(nextLabel(db, 'safe')).toBe('SAFE-1');
  });
});


/* ---------- Restricted stock units ---------- */

describe('RSU awards', () => {
  /** The base db plus a 100k RSU award vesting 4 years, 1 year cliff. */
  function withAward(extra = {}) {
    const db = makeDb();
    db.securities = [...db.securities, {
      id: 'r1', kind: 'rsu', label: 'RSU-1', stakeholderId: 'h3', classId: 'c1',
      quantity: 100_000, grantDate: '2025-01-01', date: '2025-01-01',
      vestingMonths: 48, cliffMonths: 12, settled: 0, ...extra,
    }];
    return db;
  }

  it('counts unsettled units in the diluted base, never in outstanding shares', () => {
    const db = withAward();
    const base = makeDb();
    expect(sharesOutstanding(db.securities)).toBe(sharesOutstanding(base.securities));
    expect(rsusDiluted(db.securities)).toBe(100_000);
    expect(countsInDiluted(db.securities.at(-1))).toBe(true);
    // Excluding the pool, the award adds its units to the base.
    expect(fullyDiluted(db.securities, db.company.poolAuthorized, { includePool: false }))
      .toBe(fullyDiluted(base.securities, base.company.poolAuthorized, { includePool: false }) + 100_000);
    /* Including it, the total is unchanged: granting an award moves shares
       out of the unallocated pool and into the award, which is exactly what a
       pool reservation is for. */
    expect(fullyDiluted(db.securities, db.company.poolAuthorized))
      .toBe(fullyDiluted(base.securities, base.company.poolAuthorized));
  });

  it('appears as its own pseudo-class, so both groupings share one base', () => {
    const db = withAward();
    const byClass = ownershipByClass(db, { base: 'diluted', includePool: true });
    const byHolder = ownershipByStakeholder(db, { base: 'diluted', includePool: true });
    expect(byClass.rows.map((r) => r.classId))
      .toEqual(['c1', 'p1', 'options', 'rsus', 'pool']);
    expect(byClass.rows.find((r) => r.classId === 'rsus').shares).toBe(100_000);
    // The units settle into c1, but they are not shares in it yet.
    expect(byClass.rows.find((r) => r.classId === 'c1').shares)
      .toBe(issuedInClass(db.securities, 'c1'));
    expect(byClass.rows.reduce((a, r) => a + r.pct, 0)).toBeCloseTo(1, 10);
    expect(byClass.total).toBe(fullyDiluted(db.securities, db.company.poolAuthorized));
    expect(byClass.total).toBe(byHolder.total);
  });

  it('draws the option pool like an option grant does', () => {
    const db = withAward();
    // 500k of options and 100k of units against a 1M pool.
    expect(poolDrawn(db.securities)).toBe(600_000);
    expect(poolRemaining(db.company.poolAuthorized, db.securities)).toBe(400_000);
  });

  it('returns cancelled units to the pool and out of the diluted base', () => {
    const db = withAward({ cancelled: 40_000, cancelledDate: '2026-06-01' });
    expect(rsuOutstanding(db.securities.at(-1))).toBe(60_000);
    expect(rsusDiluted(db.securities)).toBe(60_000);
    expect(poolRemaining(db.company.poolAuthorized, db.securities)).toBe(440_000);
  });

  it('vests on the shared schedule machinery, cliff included', () => {
    const award = withAward().securities.at(-1);
    expect(rsuVested(award, '2025-12-31')).toBe(0);
    expect(rsuVested(award, '2026-01-01')).toBe(25_000);
    expect(rsuVested(award, '2029-01-01')).toBe(100_000);
  });

  it('moves settled units onto the certificate rather than counting both', () => {
    const db = withAward({ settled: 25_000 });
    db.securities = [...db.securities, {
      id: 'c-set', kind: 'shares', label: 'CS-9', stakeholderId: 'h3', classId: 'c1',
      quantity: 25_000, pricePerShare: 0, date: '2026-01-05', fromRsuId: 'r1',
    }];
    const award = db.securities.find((x) => x.id === 'r1');
    expect(rsuSettled(award)).toBe(25_000);
    // The award still holds 100k units, but only 75k of them still dilute.
    expect(rsuOutstanding(award)).toBe(100_000);
    expect(rsuDiluted(award, db.securities)).toBe(75_000);
    expect(rsuDiluted(award, certifiedByRsu(db.securities))).toBe(75_000);
    expect(dilutedShares(award, certifiedByRsu(db.securities))).toBe(75_000);
    // Diluted total is unchanged by settling: the shares took the slot.
    expect(fullyDiluted(db.securities, db.company.poolAuthorized))
      .toBe(fullyDiluted(withAward().securities, db.company.poolAuthorized));
    // And the pool stays drawn - those shares left it for good.
    expect(poolRemaining(db.company.poolAuthorized, db.securities)).toBe(400_000);
  });

  it('nets settled units out of the ownership tables, not just the totals', () => {
    const db = withAward({ settled: 25_000 });
    db.securities = [...db.securities, {
      id: 'c-set', kind: 'shares', label: 'CS-9', stakeholderId: 'h3', classId: 'c1',
      quantity: 25_000, pricePerShare: 0, date: '2026-01-05', fromRsuId: 'r1',
    }];
    const fd = fullyDiluted(db.securities, db.company.poolAuthorized);
    const byHolder = ownershipByStakeholder(db, { base: 'diluted', includePool: true });
    // The rows have to sum to the same base every other figure in the app uses.
    expect(byHolder.total).toBe(fd);
    expect(byHolder.total).toBe(ownershipByClass(db, { base: 'diluted', includePool: true }).total);
    // Sam's 500k option grant, plus 75k units still outstanding and the 25k
    // they became - not the settled units a second time.
    expect(byHolder.rows.find((r) => r.stakeholderId === 'h3').shares).toBe(600_000);
  });

  it('models a round against the netted count, before and after', () => {
    const db = withAward({ settled: 25_000 });
    db.securities = [...db.securities, {
      id: 'c-set', kind: 'shares', label: 'CS-9', stakeholderId: 'h3', classId: 'c1',
      quantity: 25_000, pricePerShare: 0, date: '2026-01-05', fromRsuId: 'r1',
    }];
    const fd = fullyDiluted(db.securities, db.company.poolAuthorized);
    const result = modelRound(db, {
      preMoney: 20_000_000, investment: 5_000_000, poolPct: 0, asOf: '2026-06-01',
    });
    const sam = result.dilution.find((d) => d.stakeholderId === 'h3');
    expect(sam.before).toBeCloseTo(600_000 / fd, 9);
    expect(sam.after).toBeCloseTo(600_000 / result.postFD, 9);
  });

  it('reports where an award stands', () => {
    expect(rsuStatus(withAward().securities.at(-1), '2026-06-01')).toBe('active');
    expect(rsuStatus(withAward({ settled: 40_000 }).securities.at(-1), '2026-06-01')).toBe('partially-settled');
    expect(rsuStatus(withAward({ settled: 100_000 }).securities.at(-1), '2026-06-01')).toBe('settled');
    expect(rsuStatus(withAward({ cancelled: 100_000, cancelledDate: '2026-06-01' }).securities.at(-1), '2026-06-01')).toBe('cancelled');
  });

  it('reports a liquidity condition only when one was recorded', () => {
    expect(hasLiquidityCondition(withAward().securities.at(-1))).toBe(false);
    expect(hasLiquidityCondition(withAward({ liquidityCondition: true }).securities.at(-1))).toBe(true);
  });

  it('counts unvested units as equity still being earned', () => {
    const db = withAward();
    const base = unvestedTotal(makeDb().securities, '2026-01-01');
    // 100k units, 25k vested at the cliff.
    expect(unvestedTotal(db.securities, '2026-01-01')).toBe(base + 75_000);
  });

  it('puts award vesting on the upcoming events list', () => {
    const db = withAward();
    const events = upcomingEvents(db, { from: '2025-12-01', horizonMonths: 3 });
    const cliff = events.find((e) => e.securityId === 'r1');
    expect(cliff).toMatchObject({ type: 'cliff', date: '2026-01-01', kind: 'rsu', quantity: 25_000 });
  });

  it('settles at the exit price with no strike to net out', () => {
    const db = withAward();
    const result = exitWaterfall(db, { exitValue: 50_000_000, asOf: '2026-06-01' });
    const award = result.awards.find((a) => a.label === 'RSU-1');
    expect(award).toMatchObject({ kind: 'rsu', shares: 100_000, strike: 0, inMoney: true, cost: 0 });
    expect(award.proceeds).toBeCloseTo(100_000 * result.pricePerShare, 6);
    // The option grant beside it still has to pay its strike in.
    const grant = result.awards.find((a) => a.label === 'OPT-1');
    expect(grant.strike).toBe(0.1);
    expect(grant.cost).toBeCloseTo(500_000 * 0.1, 6);
  });

  it('is in the money at any price, unlike an option', () => {
    const db = withAward();
    // A small sale: the $0.10 options are out of the money, but units with
    // nothing to pay in still get paid.
    const result = exitWaterfall(db, { exitValue: 500_000, asOf: '2026-06-01' });
    const award = result.awards.find((a) => a.label === 'RSU-1');
    const grant = result.awards.find((a) => a.label === 'OPT-1');
    expect(result.pricePerShare).toBeLessThan(0.1);
    expect(award.inMoney).toBe(true);
    expect(grant.inMoney).toBe(false);
    expect(grant.proceeds).toBe(0);
  });

  it('caps an award at its vested units when unvested awards are cancelled', () => {
    const db = withAward();
    const result = exitWaterfall(db, {
      exitValue: 50_000_000, asOf: '2026-01-01', unvestedOptions: 'cancel',
    });
    expect(result.awards.find((a) => a.label === 'RSU-1').shares).toBe(25_000);
  });

  it('accelerates units on a change of control when the award says so', () => {
    const db = withAward({ accelTrigger: 'single', accelPct: 100 });
    const result = exitWaterfall(db, {
      exitValue: 50_000_000, asOf: '2026-01-01',
      unvestedOptions: 'cancel', changeOfControl: true,
    });
    expect(result.awards.find((a) => a.label === 'RSU-1').shares).toBe(100_000);
  });

  it('restates units through a split and reads pre-split dates in old units', () => {
    const db = withAward();
    db.company = { ...db.company, splits: [{ id: 'sp', date: '2026-06-01', num: 10, den: 1 }] };
    const before = dbAsOf(db, '2026-01-01');
    expect(before.securities.find((x) => x.id === 'r1').quantity).toBe(10_000);
  });
});

/* ---------- Exercise economics ---------- */

describe('exerciseEconomics', () => {
  /** The base db with a 409A history and an ISO grant beside the NSO one. */
  function priced() {
    const db = makeDb();
    db.company = {
      ...db.company,
      valuations: [
        { id: 'v2', date: '2026-01-01', fmvPerShare: 0.42 },
        { id: 'v1', date: '2024-06-01', fmvPerShare: 0.09 },
      ],
    };
    db.securities = [...db.securities, {
      id: 'o2', kind: 'option', label: 'OPT-2', stakeholderId: 'h3', quantity: 100_000,
      strike: 0.1, grantDate: '2025-03-01', date: '2025-03-01',
      vestingMonths: 48, cliffMonths: 12, exercised: 0, optionType: 'iso',
    }];
    return db;
  }

  it('reports the cost, the FMV in force, and the spread between them', () => {
    const db = priced();
    const grant = db.securities.find((s) => s.id === 'o1');
    const e = exerciseEconomics(db, grant, { quantity: 100_000, date: '2026-03-01' });
    expect(e.cost).toBeCloseTo(10_000, 6);
    expect(e.fmv.fmvPerShare).toBe(0.42);
    expect(e.spreadPerShare).toBeCloseTo(0.32, 6);
    expect(e.spread).toBeCloseTo(32_000, 6);
    expect(e.iso).toBe(false);
    expect(e.qualifyingDate).toBe('');
  });

  it('reads the valuation in force on the exercise date, not the newest one', () => {
    const db = priced();
    const grant = db.securities.find((s) => s.id === 'o1');
    const e = exerciseEconomics(db, grant, { quantity: 1000, date: '2025-06-01' });
    expect(e.fmv.date).toBe('2024-06-01');
    expect(e.spread).toBeCloseTo(1000 * (0.09 - 0.1), 6);
    // Underwater: a negative spread is reported rather than floored at zero.
    expect(e.spread).toBeLessThan(0);
  });

  it('has no spread to report when no 409A was in force', () => {
    const db = priced();
    const grant = db.securities.find((s) => s.id === 'o1');
    const e = exerciseEconomics(db, grant, { quantity: 1000, date: '2024-01-01' });
    expect(e.fmv).toBeNull();
    expect(e.spread).toBeNull();
    expect(e.spreadPerShare).toBeNull();
    // The cost is arithmetic on the strike alone, so it still stands.
    expect(e.cost).toBeCloseTo(100, 6);
  });

  it('takes the strike from the certificate when one is given', () => {
    const db = priced();
    const grant = db.securities.find((s) => s.id === 'o1');
    // What that certificate says was paid wins over the grant's current strike.
    const e = exerciseEconomics(db, grant, { quantity: 1000, date: '2026-03-01', strike: 0.02 });
    expect(e.strike).toBe(0.02);
    expect(e.cost).toBeCloseTo(20, 6);
    expect(e.spread).toBeCloseTo(1000 * 0.4, 6);
  });

  it('dates an ISO qualifying disposition by whichever holding period ends later', () => {
    const db = priced();
    const iso = db.securities.find((s) => s.id === 'o2');
    // Exercised soon after grant: two years from grant is the binding one.
    expect(exerciseEconomics(db, iso, { quantity: 10, date: '2026-01-15' }).qualifyingDate)
      .toBe('2027-03-01');
    // Exercised late: one year from exercise binds instead.
    expect(exerciseEconomics(db, iso, { quantity: 10, date: '2027-06-01' }).qualifyingDate)
      .toBe('2028-06-01');
    expect(exerciseEconomics(db, iso, { quantity: 10, date: '2027-06-01' }).iso).toBe(true);
  });

  it('has no qualifying date without both dates', () => {
    expect(qualifyingDispositionDate({ kind: 'option' }, '2026-01-01')).toBe('');
    expect(qualifyingDispositionDate({ grantDate: '2025-01-01' }, '')).toBe('');
  });
});

/* ---------- Vesting forecast ---------- */

describe('vestingForecast', () => {
  const grant = {
    id: 'g1', kind: 'option', label: 'OPT-9', stakeholderId: 'h3', quantity: 48_000,
    strike: 0.1, grantDate: '2026-01-01', date: '2026-01-01',
    vestingMonths: 48, cliffMonths: 12, exercised: 0,
  };

  it('buckets vesting by calendar month over the horizon', () => {
    const f = vestingForecast([grant], { from: '2026-11-15', months: 6 });
    expect(f.granted).toBe(48_000);
    expect(f.rows).toHaveLength(6);
    expect(f.rows.map((r) => r.month)).toEqual([
      '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04',
    ]);
    // Nothing until the cliff, which lands in January and pays 12 months.
    expect(f.rows[0].vesting).toBe(0);
    expect(f.rows[1].vesting).toBe(0);
    expect(f.rows[2]).toMatchObject({ month: '2027-01', vesting: 12_000, vested: 12_000, unvested: 36_000 });
    expect(f.rows[3].vesting).toBe(1000);
    expect(f.peak.month).toBe('2027-01');
    expect(f.vestingTotal).toBe(15_000);
  });

  it('counts nothing that vested earlier in the first month as upcoming', () => {
    // The cliff falls on Jan 1; a forecast started mid-January has it behind.
    const f = vestingForecast([grant], { from: '2027-01-20', months: 3 });
    expect(f.vestedNow).toBe(12_000);
    expect(f.rows[0]).toMatchObject({ month: '2027-01', vesting: 0, vested: 12_000 });
    expect(f.rows[1].vesting).toBe(1000);
  });

  it('respects custom tranches, quarterly steps, and a stopped clock', () => {
    const tranched = {
      id: 't1', kind: 'option', label: 'OPT-T', stakeholderId: 'h3', quantity: 10_000,
      grantDate: '2026-01-01', date: '2026-01-01', exercised: 0,
      vestingTranches: [
        { date: '2026-06-30', quantity: 4000 },
        { date: '2026-09-30', quantity: 6000 },
      ],
    };
    const quarterly = {
      ...grant, id: 'q1', label: 'OPT-Q', quantity: 4000,
      vestingMonths: 12, cliffMonths: 3, vestingFrequency: 'quarterly',
    };
    const cancelled = {
      ...grant, id: 'x1', label: 'OPT-X', cancelled: 48_000, cancelledDate: '2026-03-01',
    };
    const f = vestingForecast([tranched, quarterly, cancelled], { from: '2026-05-01', months: 6 });
    // A fully cancelled grant is off the schedule entirely.
    expect(f.granted).toBe(14_000);
    const byMonth = Object.fromEntries(f.rows.map((r) => [r.month, r.vesting]));
    // Each tranche lands in the month it is dated; the quarterly grant steps
    // on the quarter (Jul 1, Oct 1), and its April cliff is already behind.
    expect(byMonth['2026-05']).toBe(0);
    expect(byMonth['2026-06']).toBe(4000);
    expect(byMonth['2026-07']).toBe(1000);
    expect(byMonth['2026-08']).toBe(0);
    expect(byMonth['2026-09']).toBe(6000);
    expect(byMonth['2026-10']).toBe(1000);
  });

  it('covers founder restricted stock and RSU awards, not just grants', () => {
    const cert = {
      id: 'c1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1',
      quantity: 4_800_000, pricePerShare: 0.0001, date: '2026-01-01',
      vestingMonths: 48, cliffMonths: 0, vestingStart: '2026-01-01',
    };
    const award = {
      id: 'r1', kind: 'rsu', label: 'RSU-1', stakeholderId: 'h3', classId: 'c1',
      quantity: 24_000, grantDate: '2026-01-01', date: '2026-01-01',
      vestingMonths: 24, cliffMonths: 0, settled: 0,
    };
    const f = vestingForecast([cert, award], { from: '2026-06-01', months: 2 });
    expect(f.granted).toBe(4_824_000);
    /* Both step on the first of the month, so the June step is already vested
       on a forecast that starts June 1 and the first bucket to move is July -
       the month its step falls in. */
    expect(f.rows[0]).toMatchObject({ month: '2026-06', vesting: 0 });
    expect(f.rows[1]).toMatchObject({ month: '2026-07', vesting: 100_000 + 1000 });
    expect(scheduledShares([cert, award])).toBe(4_824_000);
  });

  it('does not double count an early-exercised certificate against its grant', () => {
    const early = { ...grant, earlyExercise: true, exercised: 12_000 };
    const cert = {
      id: 'ec', kind: 'shares', label: 'CS-9', stakeholderId: 'h3', classId: 'c1',
      quantity: 12_000, pricePerShare: 0.1, date: '2026-02-01', fromOptionId: 'g1',
      vestingMonths: 48, cliffMonths: 12, vestingStart: '2026-01-01',
    };
    const f = vestingForecast([early, cert], { from: '2026-06-01', months: 12 });
    // The grant keeps 36k on its schedule; the certificate carries 12k.
    expect(f.granted).toBe(48_000);
    // The unvested balance matches the number the rest of the app shows.
    expect(f.unvestedNow).toBe(unvestedTotal([early, cert], '2026-06-01'));
    const cliff = f.rows.find((r) => r.month === '2027-01');
    expect(cliff.vesting).toBe(12_000);
  });

  it('nets settled RSU units out of what is still on a schedule', () => {
    // A two-year monthly award, half vested and every vested unit settled.
    const award = {
      id: 'r2', kind: 'rsu', label: 'RSU-2', stakeholderId: 'h3', classId: 'c1',
      quantity: 2_400, grantDate: '2025-01-01', date: '2025-01-01',
      vestingMonths: 24, cliffMonths: 0, settled: 1_200,
    };
    const cert = {
      id: 'rc', kind: 'shares', label: 'CS-8', stakeholderId: 'h3', classId: 'c1',
      quantity: 1_200, pricePerShare: 0, date: '2026-01-01', fromRsuId: 'r2',
    };
    const f = vestingForecast([award, cert], { from: '2026-01-01', months: 3 });
    // The settled half left for its certificate; 1,200 is still being earned,
    // none of it vested yet - the same reading a half-exercised grant gets.
    expect(f.granted).toBe(1_200);
    expect(f.vestedNow).toBe(0);
    expect(f.unvestedNow).toBe(unvestedTotal([award, cert], '2026-01-01'));
    expect(f.rows[1].vesting).toBe(100);
    expect(scheduledShares([award, cert])).toBe(1_200);

    /* Redated after the settlement, the award reads as having vested less by
       today than it has settled. The settled units are shares already, so they
       are not still being earned - the dashboard's figure and the forecast's
       have to say the same thing. */
    const redated = { ...award, grantDate: '2025-12-01', date: '2025-12-01' };
    const g = vestingForecast([redated, cert], { from: '2026-01-01', months: 3 });
    expect(rsuVested(redated, '2026-01-01')).toBe(100);
    expect(g.unvestedNow).toBe(1_200);
    expect(unvestedTotal([redated, cert], '2026-01-01')).toBe(1_200);
    expect(unvestedQuantity(redated, '2026-01-01', [redated, cert])).toBe(1_200);
    // Read on its own, without the certificates, the award still answers.
    expect(unvestedQuantity(redated, '2026-01-01')).toBe(2_300);
  });

  it('is empty when nothing vests, and defaults to a two-year horizon', () => {
    expect(vestingForecast([], { from: '2026-01-01' }).rows).toEqual([]);
    const plain = { id: 'p', kind: 'shares', label: 'CS-2', stakeholderId: 'h1', classId: 'c1', quantity: 100, date: '2026-01-01' };
    expect(vestingForecast([plain], { from: '2026-01-01' }).granted).toBe(0);
    expect(vestingForecast([grant], { from: '2026-01-01' }).rows).toHaveLength(FORECAST_MONTHS);
  });

  it('ignores a certificate a transfer has closed', () => {
    const closed = {
      id: 'c2', kind: 'shares', label: 'CS-3', stakeholderId: 'h1', classId: 'c1',
      quantity: 1000, date: '2026-01-01', vestingMonths: 48, cliffMonths: 0,
      vestingStart: '2026-01-01', closedAt: '2026-03-01', closedReason: 'transfer',
    };
    expect(vestingForecast([closed], { from: '2026-04-01', months: 3 }).granted).toBe(0);
  });
});

/* ---------- Needs attention ---------- */

describe('attentionItems', () => {
  const today = '2026-08-20';

  /** A db with one of each overdue record. */
  function overdue() {
    const db = makeDb();
    db.company = {
      ...db.company,
      valuations: [{ id: 'v1', date: '2024-01-01', fmvPerShare: 0.09 }],
    };
    db.securities = [
      ...db.securities,
      // Expired term, options still unexercised.
      {
        id: 'g-term', kind: 'option', label: 'OPT-T', stakeholderId: 'h3', quantity: 10_000,
        strike: 0.1, grantDate: '2016-01-01', date: '2016-01-01', vestingMonths: 48,
        cliffMonths: 12, exercised: 0, expires: '2026-01-01',
      },
      // Post-termination window closed, half exercised.
      {
        id: 'g-pte', kind: 'option', label: 'OPT-P', stakeholderId: 'h3', quantity: 8000,
        strike: 0.1, grantDate: '2023-01-01', date: '2023-01-01', vestingMonths: 48,
        cliffMonths: 12, exercised: 2000, expires: '2033-01-01', exerciseBy: '2026-05-01',
      },
      // A note past maturity.
      {
        id: 'n1', kind: 'note', label: 'CN-1', stakeholderId: 'h4', principal: 100_000,
        valuationCap: 5_000_000, discount: 0, interestRate: 10, date: '2024-01-01',
        maturityDate: '2026-01-01',
      },
      // Restricted stock whose 83(b) window closed unfiled.
      {
        id: 'rs1', kind: 'shares', label: 'CS-8', stakeholderId: 'h1', classId: 'c1',
        quantity: 100_000, pricePerShare: 0.0001, date: '2026-01-01',
        vestingMonths: 48, cliffMonths: 0, vestingStart: '2026-01-01',
      },
    ];
    return db;
  }

  it('names a class holding more shares than its authorized count, dated the day it went over', () => {
    const db = makeDb();
    db.classes = [{ id: 'c1', name: 'Common', kind: 'common', authorized: 1000 }, { id: 'c2', name: 'Open', kind: 'common', authorized: 0 }];
    db.securities = [
      { id: 'a', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 600, pricePerShare: 1, date: '2024-01-01' },
      { id: 'b', kind: 'shares', label: 'CS-2', stakeholderId: 'h1', classId: 'c1', quantity: 300, pricePerShare: 1, date: '2024-06-01' },
      { id: 'c', kind: 'shares', label: 'CS-3', stakeholderId: 'h1', classId: 'c1', quantity: 300, pricePerShare: 1, date: '2025-03-01' },
      // Closed by a transfer, so it no longer counts; its successor does.
      { id: 'd', kind: 'shares', label: 'CS-4', stakeholderId: 'h1', classId: 'c1', quantity: 500, pricePerShare: 1, date: '2023-01-01', closedAt: '2023-06-01', closedReason: 'repurchase', repurchasedQty: 500 },
      { id: 'e', kind: 'shares', label: 'CS-5', stakeholderId: 'h1', classId: 'c2', quantity: 1e9, pricePerShare: 1, date: '2023-01-01' },
    ];
    const items = attentionItems(db, { asOf: today }).filter((i) => i.type === 'class-over-authorized');
    expect(items).toEqual([{
      type: 'class-over-authorized', id: 'class-over-authorized:c1', classId: 'c1', date: '2025-03-01',
      quantity: 200, issued: 1200, authorized: 1000,
      title: 'Common holds more shares than it is authorized to issue',
      detail: 'That is what a charter amendment is for; raise the authorized shares under Share classes once it is signed',
    }]);
    // Exactly at the count is not over it.
    db.securities = db.securities.filter((s) => s.id !== 'c').concat({ ...db.securities[2], quantity: 100 });
    expect(attentionItems(db, { asOf: today }).some((i) => i.type === 'class-over-authorized')).toBe(false);
  });

  it('lists every overdue record, most overdue first', () => {
    const items = attentionItems(overdue(), { asOf: today });
    // Oldest date first: the 409A has been stale since 2024, and the two
    // records dated the same day sort by their own titles.
    expect(items.map((i) => i.type)).toEqual([
      'fmv-stale', 'note-matured', 'grant-expired', '83b-missed', 'grant-expired',
    ]);
    // The 409A item is dated by what overtook it - the Series Seed close -
    // rather than by the valuation itself.
    expect(items.map((i) => i.date)).toEqual([
      '2024-06-10', '2026-01-01', '2026-01-01', '2026-01-31', '2026-05-01',
    ]);
  });

  it('flags an RSU award still vesting for a holder who has departed', () => {
    const db = makeDb();
    db.stakeholders = db.stakeholders.map((h) => (h.id === 'h3' ? { ...h, departed: '2026-03-01' } : h));
    const award = {
      id: 'r1', kind: 'rsu', label: 'RSU-1', stakeholderId: 'h3', classId: 'c1', quantity: 4800,
      grantDate: '2025-03-01', date: '2025-03-01', vestingMonths: 48, cliffMonths: 0, settled: 0,
    };
    const flagged = (extra = {}, others = []) => attentionItems(
      { ...db, securities: [...db.securities.filter((x) => x.kind !== 'option'), { ...award, ...extra }, ...others] },
      { asOf: today }).find((i) => i.type === 'rsu-departed');
    // A year in, 1,200 had vested when they left; the other 3,600 are still on the award.
    expect(flagged()).toMatchObject({ securityId: 'r1', date: '2026-03-01', quantity: 3600 });
    // Settled units are theirs whatever the schedule says.
    expect(flagged({ settled: 2000 }).quantity).toBe(2800);
    // Cancelling the unvested balance on the day clears it; a partial cancellation leaves the rest.
    expect(flagged({ cancelled: 3600, cancelledDate: '2026-03-01' })).toBeUndefined();
    expect(flagged({ cancelled: 1000, cancelledDate: '2026-03-01' }).quantity).toBe(2600);
    // Fully vested by the departure, nothing to forfeit; not yet departed as of the date, nothing to say.
    expect(flagged({ grantDate: '2021-01-01', date: '2021-01-01' })).toBeUndefined();
    expect(attentionItems({ ...db, securities: [award] }, { asOf: '2026-02-01' })
      .find((i) => i.type === 'rsu-departed')).toBeUndefined();
    // An award granted after the departure was never theirs to forfeit on it.
    expect(flagged({ grantDate: '2026-06-01', date: '2026-06-01' })).toBeUndefined();
  });

  it('flags an option grant still vesting for a holder who has departed', () => {
    const db = makeDb();
    db.stakeholders = db.stakeholders.map((h) => (h.id === 'h3' ? { ...h, departed: '2026-03-01' } : h));
    const grant = {
      id: 'g1', kind: 'option', label: 'OPT-1', stakeholderId: 'h3', quantity: 4800, strike: 0.1,
      grantDate: '2025-03-01', date: '2025-03-01', vestingMonths: 48, cliffMonths: 0, exercised: 0,
      expires: '2035-03-01',
    };
    const items = (extra = {}) => attentionItems(
      { ...db, securities: [...db.securities.filter((x) => x.kind !== 'option'), { ...grant, ...extra }] },
      { asOf: today });
    const flagged = (extra = {}) => items(extra).find((i) => i.type === 'grant-departed');
    // A year in, 1,200 had vested when they left; the other 3,600 are still on the grant.
    expect(flagged()).toMatchObject({ securityId: 'g1', date: '2026-03-01', quantity: 3600 });
    expect(flagged().detail).toMatch(/departed with options unvested/);
    // Exercised options were bought, whatever the schedule says.
    expect(flagged({ exercised: 2000 }).quantity).toBe(2800);
    // What the departure flow writes clears it; a partial cancellation leaves the rest.
    expect(flagged({ cancelled: 3600, cancelledDate: '2026-03-01', exerciseBy: '2026-05-30' })).toBeUndefined();
    expect(flagged({ cancelled: 1000, cancelledDate: '2026-03-01' }).quantity).toBe(2600);
    // Fully vested by the departure, granted after it, or not yet departed: nothing to say.
    expect(flagged({ grantDate: '2021-01-01', date: '2021-01-01' })).toBeUndefined();
    expect(flagged({ grantDate: '2026-06-01', date: '2026-06-01' })).toBeUndefined();
    expect(attentionItems({ ...db, securities: [grant] }, { asOf: '2026-02-01' })
      .find((i) => i.type === 'grant-departed')).toBeUndefined();
    // A grant whose window has already closed is the expired item's to clear, not this one's.
    const lapsed = items({ exerciseBy: '2026-05-30' });
    expect(lapsed.find((i) => i.type === 'grant-departed')).toBeUndefined();
    expect(lapsed.find((i) => i.type === 'grant-expired')).toMatchObject({ securityId: 'g1', quantity: 4800 });
  });

  it('says which clock ran out on an expired grant', () => {
    const items = attentionItems(overdue(), { asOf: today });
    const term = items.find((i) => i.securityId === 'g-term');
    const pte = items.find((i) => i.securityId === 'g-pte');
    expect(term.detail).toMatch(/end of its term/);
    expect(term.quantity).toBe(10_000);
    expect(pte.detail).toMatch(/post-termination/);
    // Exercised options are not waiting to be cancelled.
    expect(pte.quantity).toBe(6000);
  });

  it('leaves alone what is not overdue, cancelled, converted, or settled', () => {
    const db = overdue();
    db.securities = db.securities.map((s) => {
      if (s.id === 'g-term') return { ...s, cancelled: 10_000, cancelledDate: '2026-02-01' };
      if (s.id === 'g-pte') return { ...s, exercised: 8000 };
      if (s.id === 'n1') return { ...s, maturedAt: '2026-01-15' };
      if (s.id === 'rs1') return { ...s, filed83b: '2026-01-10' };
      return s;
    });
    db.company = {
      ...db.company,
      valuations: [{ id: 'v2', date: today, fmvPerShare: 0.5 }],
    };
    expect(attentionItems(db, { asOf: today })).toEqual([]);
    expect(isMatured(db.securities.find((s) => s.id === 'n1'))).toBe(true);
  });

  it('stops asking about an 83(b) the holder confirmed was never filed', () => {
    const db = overdue();
    db.securities = db.securities.map((s) => (s.id === 'rs1' ? { ...s, missed83b: true } : s));
    const items = attentionItems(db, { asOf: today });
    expect(items.some((i) => i.type === '83b-missed')).toBe(false);
    // The certificate still reports that no election is on file.
    expect(status83b(db.securities.find((s) => s.id === 'rs1'), today))
      .toMatchObject({ state: 'missed', acknowledged: true });
  });

  it('flags a 409A overtaken by a round as well as one that has aged out', () => {
    const db = makeDb();
    // Fresh valuation, but the Series Seed closed after it.
    db.company = {
      ...db.company,
      valuations: [{ id: 'v1', date: '2024-01-01', fmvPerShare: 0.09 }],
    };
    const items = attentionItems(db, { asOf: '2024-08-01' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'fmv-stale', date: '2024-06-10' });
    expect(items[0].title).toMatch(/predates/);
  });

  it('flags expired unexercised warrants for review without diluting ownership', () => {
    const db = makeDb();
    db.securities = [...db.securities, {
      id: 'w-old', kind: 'warrant', label: 'WNT-9', stakeholderId: 'h4', classId: 'c1',
      quantity: 250_000, strike: 0.5, date: '2020-01-01', expires: '2025-02-01',
    }];
    expect(warrantsOutstanding(db.securities)).toBe(0);
    const item = attentionItems(db, { asOf: today }).find((i) => i.securityId === 'w-old');
    expect(item).toMatchObject({
      type: 'warrant-expired', date: '2025-02-01', quantity: 250_000, title: 'WNT-9 expired',
    });
    expect(item.detail).toMatch(/lapsed unexercised/);
    // Not yet expired, and expiring today, are both still live.
    for (const expires of ['2035-02-01', today]) {
      const live = db.securities.map((x) => (x.id === 'w-old' ? { ...x, expires } : x));
      expect(attentionItems({ ...db, securities: live }, { asOf: today })
        .some((i) => i.type === 'warrant-expired')).toBe(false);
    }
    // A warrant with no expiry never lapses.
    const perpetual = db.securities.map((x) => (x.id === 'w-old' ? { ...x, expires: '' } : x));
    expect(attentionItems({ ...db, securities: perpetual }, { asOf: today })
      .some((i) => i.type === 'warrant-expired')).toBe(false);
  });

  it('is empty with no date to measure against', () => {
    expect(attentionItems(overdue(), {})).toEqual([]);
  });

  it('drops a settled maturity off the coming-up list too', () => {
    const db = overdue();
    const future = db.securities.map((s) => (s.id === 'n1'
      ? { ...s, maturityDate: '2026-10-01' } : s));
    expect(upcomingEvents({ ...db, securities: future }, { from: today, horizonMonths: 6 })
      .some((e) => e.type === 'maturity')).toBe(true);
    const settled = future.map((s) => (s.id === 'n1' ? { ...s, maturedAt: '2026-10-02' } : s));
    expect(upcomingEvents({ ...db, securities: settled }, { from: today, horizonMonths: 6 })
      .some((e) => e.type === 'maturity')).toBe(false);
  });
});

/* ---------- Anti-dilution ---------- */

describe('anti-dilution', () => {
  /** 8M common, plus 2M Series A bought at $1.00 with the given protection. */
  function protectedDb(antiDilution, extra = {}) {
    return {
      company: { name: 'Test Co', poolAuthorized: 0 },
      classes: [
        { id: 'c1', name: 'Common Stock', kind: 'common', pricePerShare: 0.0001, liquidationMultiple: 0, participating: false, seniority: 0 },
        {
          id: 'p1', name: 'Series A Preferred', kind: 'preferred', pricePerShare: 1,
          liquidationMultiple: 1, participating: false, seniority: 1, antiDilution, ...extra,
        },
      ],
      stakeholders: [holder('h1', 'Ada'), holder('h4', 'Nova Ventures', 'investor')],
      securities: [
        { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 8_000_000, pricePerShare: 0.0001, date: '2023-01-01' },
        { id: 's2', kind: 'shares', label: 'SA-1', stakeholderId: 'h4', classId: 'p1', quantity: 2_000_000, pricePerShare: 1, date: '2024-01-01' },
      ],
    };
  }

  it('recognizes the terms and the conversion price in force', () => {
    expect(hasAntiDilution(protectedDb('ratchet').classes[1])).toBe(true);
    expect(hasAntiDilution(protectedDb('none').classes[1])).toBe(false);
    // Common never carries protection, whatever a hand-edited import says.
    expect(hasAntiDilution({ kind: 'common', antiDilution: 'ratchet' })).toBe(false);
    expect(conversionPriceOf(protectedDb('ratchet').classes[1])).toBe(1);
    expect(conversionPriceOf(protectedDb('ratchet', { conversionPrice: 0.5 }).classes[1])).toBe(0.5);
  });

  it('does nothing at or above the conversion price', () => {
    const db = protectedDb('ratchet');
    expect(antiDilutionAdjustments(db, { pps: 1, investment: 5e6 })).toEqual([]);
    expect(antiDilutionAdjustments(db, { pps: 2, investment: 5e6 })).toEqual([]);
    // And nothing at all for a class without protection.
    expect(antiDilutionAdjustments(protectedDb('none'), { pps: 0.5, investment: 5e6 })).toEqual([]);
  });

  it('ratchets the conversion price all the way down to the new price', () => {
    const db = protectedDb('ratchet');
    const [a] = antiDilutionAdjustments(db, { pps: 0.5, investment: 1_000_000 });
    expect(a).toMatchObject({
      classId: 'p1', terms: 'ratchet', conversionPriceBefore: 1, conversionPriceAfter: 0.5,
    });
    // $1.00 of stock converting at $0.50 is two shares for one: 2M more.
    expect(a.shares).toBe(2_000_000);
    expect(a.holders).toEqual([{ stakeholderId: 'h4', quantity: 2_000_000 }]);
  });

  it('weights the average against every fully diluted share', () => {
    const db = protectedDb('broad');
    // A = 10M, B = $2M at $1.00 = 2M, C = $2M at $0.50 = 4M.
    // CP2 = 1 x (10M + 2M) / (10M + 4M) = 0.857142...
    const [a] = antiDilutionAdjustments(db, { pps: 0.5, investment: 2_000_000 });
    expect(a.conversionPriceAfter).toBeCloseTo(12 / 14, 10);
    // 2M shares at $1.00 converting at $0.857 is 2,333,333 shares.
    expect(a.shares).toBe(Math.round(2_000_000 / (12 / 14)) - 2_000_000);
    // Far milder than the ratchet on the same round.
    const [ratchet] = antiDilutionAdjustments(protectedDb('ratchet'), { pps: 0.5, investment: 2_000_000 });
    expect(a.shares).toBeLessThan(ratchet.shares);
  });

  it('measures from the adjusted price once a round has already cut it', () => {
    const db = protectedDb('ratchet', { conversionPrice: 0.5 });
    // Already at $0.50: a $0.60 round is above it and triggers nothing.
    expect(antiDilutionAdjustments(db, { pps: 0.6, investment: 1e6 })).toEqual([]);
    const [a] = antiDilutionAdjustments(db, { pps: 0.25, investment: 1e6 });
    expect(a.conversionPriceBefore).toBe(0.5);
    expect(a.shares).toBe(8_000_000 - 2_000_000);
  });

  it('counts shares a previous adjustment minted, and never mints them twice', () => {
    const db = protectedDb('ratchet', { conversionPrice: 0.5 });
    db.securities.push({
      id: 's3', kind: 'shares', label: 'SA-2', stakeholderId: 'h4', classId: 'p1',
      quantity: 2_000_000, pricePerShare: 0, date: '2025-01-01', antiDilution: true,
    });
    expect(isAntiDilutionShares(db.securities[2])).toBe(true);
    // 2M bought at $1.00 converting at $0.25 is 8M as-converted; 4M is held.
    const [a] = antiDilutionAdjustments(db, { pps: 0.25, investment: 1e6 });
    expect(a.shares).toBe(4_000_000);
    // The minted shares carried no price, so the preference is untouched.
    const r = exitWaterfall(db, { exitValue: 50_000_000, asOf: '2026-01-01' });
    expect(r.classes[0].invested).toBe(2_000_000);
  });

  it('splits an adjustment across the class holders, to the last share', () => {
    const db = protectedDb('ratchet');
    db.stakeholders.push(holder('h5', 'Angel', 'investor'));
    // A third of the class, and a share count that cannot divide evenly.
    db.securities.push({ id: 's4', kind: 'shares', label: 'SA-2', stakeholderId: 'h5', classId: 'p1', quantity: 999_999, pricePerShare: 1, date: '2024-01-01' });
    const [a] = antiDilutionAdjustments(db, { pps: 0.7, investment: 1e6 });
    // Largest remainder: the parts add up to the whole, never one short.
    expect(a.holders.reduce((x, h) => x + h.quantity, 0)).toBe(a.shares);
    expect(a.holders.map((h) => h.stakeholderId).sort()).toEqual(['h4', 'h5']);
    const angel = a.holders.find((h) => h.stakeholderId === 'h5');
    expect(angel.quantity).toBeGreaterThan(a.shares / 3 - 2);
  });

  it('protects only the shares bought at the class price, not a discounted conversion', () => {
    /* The Series A was created by a round that also converted a SAFE at a
       discount: 5,000,000 shares bought at $1.00 and 2,000,000 issued at
       $0.50 in the same class. A $0.50 round is a down round for the lead
       and nothing of the kind for the SAFE holder, whose shares already
       carry their discount - and the waterfall prices them at $0.50. */
    const db = protectedDb('broad');
    db.stakeholders.push(holder('h5', 'Beacon Angels', 'investor'));
    db.securities = [
      db.securities[0],
      { id: 's2', kind: 'shares', label: 'SA-1', stakeholderId: 'h4', classId: 'p1', quantity: 5_000_000, pricePerShare: 1, date: '2024-01-01' },
      { id: 's3', kind: 'shares', label: 'SA-2', stakeholderId: 'h5', classId: 'p1', quantity: 2_000_000, pricePerShare: 0.5, date: '2024-01-01', fromConvertibleId: 'sf1' },
    ];
    const [a] = antiDilutionAdjustments(db, { pps: 0.5, investment: 2_000_000 });
    // CP2 = 1 x (15M + 2M) / (15M + 4M) over the 15M fully diluted base.
    expect(a.conversionPriceAfter).toBeCloseTo(17 / 19, 9);
    expect(a.shares).toBe(Math.round(5_000_000 / (17 / 19)) - 5_000_000);
    expect(a.holders).toEqual([{ stakeholderId: 'h4', quantity: a.shares }]);
    // Below the conversion certificate's own price, still only the lead's
    // shares are the ones the class's protection measures.
    const [deep] = antiDilutionAdjustments(db, { pps: 0.25, investment: 1_000_000 });
    expect(deep.holders.map((h) => h.stakeholderId)).toEqual(['h4']);
  });

  it('prices a down round with the adjustment in the pre-money denominator', () => {
    const db = protectedDb('ratchet');
    const plain = modelRound(protectedDb('none'), { preMoney: 5_000_000, investment: 1_000_000, asOf: '2026-01-01' });
    const guarded = modelRound(db, { preMoney: 5_000_000, investment: 1_000_000, asOf: '2026-01-01' });
    // The unprotected model prices at pre-money over 10M shares.
    expect(plain.pps).toBeCloseTo(0.5, 10);
    expect(plain.antiDilutionShares).toBe(0);
    // With a ratchet, the shares it mints are in the denominator, so the
    // price is lower and the new investor's stake is not diluted by it.
    expect(guarded.pps).toBeLessThan(plain.pps);
    expect(guarded.antiDilutionShares).toBeGreaterThan(0);
    expect(guarded.investorPct).toBeCloseTo(plain.investorPct, 3);
    /* Solving the fixed point by hand for a ratchet gives
       PPS = (pre-money - protected capital) / (FD - protected shares):
       ($5M - $2M) / (10M - 2M) = $0.375. */
    expect(guarded.pps).toBeCloseTo(0.375, 6);
    expect(guarded.antiDilutionShares).toBe(Math.round(2_000_000 / 0.375) - 2_000_000);
    expect(guarded.postFD).toBe(
      guarded.fdPre + guarded.antiDilutionShares + guarded.investorShares);
  });

  it('lands the adjustment on the protected holders, not on the new money', () => {
    const guarded = modelRound(protectedDb('broad'), {
      preMoney: 5_000_000, investment: 2_000_000, asOf: '2026-01-01',
    });
    const [a] = guarded.antiDilution;
    expect(a.classId).toBe('p1');
    const nova = guarded.dilution.find((d) => d.stakeholderId === 'h4');
    const ada = guarded.dilution.find((d) => d.stakeholderId === 'h1');
    // The protected investor's share of the company falls by less than the
    // unprotected founder's, which is what the protection buys.
    expect(nova.before - nova.after).toBeLessThan(ada.before - ada.after);
    expect(guarded.dilution.find((d) => d.stakeholderId === '__new__').after)
      .toBeCloseTo(2_000_000 / (5_000_000 + 2_000_000), 3);
  });

  it('reports an unsatisfiable ratchet rather than a runaway price', () => {
    // A pre-money below what the ratcheted class paid has no positive price:
    // the adjustment mints shares faster than the valuation can carry them.
    const out = modelRound(protectedDb('ratchet'), {
      preMoney: 1_500_000, investment: 500_000, asOf: '2026-01-01',
    });
    expect(out.unpriceable).toBe(true);
  });
});

/* ---------- Option pool forecast ---------- */

describe('poolForecast', () => {
  /* The base db has a 1M pool with 500k of options granted, so 500k is
     unallocated. */
  const from = '2026-08-20';
  const role = (over) => ({
    id: over.id || 'r1', role: 'Engineer', headcount: 1, sizeMode: 'shares', ...over,
  });

  it('sizes a row by headcount, in shares or as a percentage', () => {
    const db = makeDb();
    expect(plannedShares(db, role({ shares: 25_000, headcount: 3 }))).toBe(75_000);
    // 1% of the 10,000,000 fully diluted count, twice over.
    const fd = fullyDiluted(db.securities, db.company.poolAuthorized);
    expect(plannedShares(db, role({ sizeMode: 'pct', pct: 0.01, headcount: 2 })))
      .toBe(Math.round(0.01 * fd) * 2);
  });

  it('draws each planned grant in the month its hire starts', () => {
    const db = makeDb();
    const plan = [
      role({ id: 'a', shares: 200_000, startMonth: '2026-09' }),
      role({ id: 'b', shares: 100_000, headcount: 2, startMonth: '2026-11' }),
    ];
    const f = poolForecast(db, plan, { from, months: 4 });
    expect(f.available).toBe(500_000);
    expect(f.planned).toBe(400_000);
    expect(f.rows.map((r) => [r.month, r.granted, r.remaining])).toEqual([
      ['2026-08', 0, 500_000],
      ['2026-09', 200_000, 300_000],
      ['2026-10', 0, 300_000],
      ['2026-11', 200_000, 100_000],
    ]);
    expect(f.dryMonth).toBeNull();
    expect(f.shortfall).toBe(0);
  });

  it('names the month the pool runs dry and what it is short', () => {
    const db = makeDb();
    const plan = [
      role({ id: 'a', shares: 300_000, startMonth: '2026-09' }),
      role({ id: 'b', shares: 400_000, startMonth: '2026-10' }),
    ];
    const f = poolForecast(db, plan, { from, months: 4 });
    expect(f.dryMonth).toBe('2026-10');
    expect(f.shortfall).toBe(200_000);
    // Remaining never reads negative; the gap is reported as a shortfall.
    expect(f.rows[2]).toMatchObject({ month: '2026-10', remaining: 0, short: 200_000 });
  });

  it('names the part of the plan that starts past the months shown', () => {
    const db = { company: { poolAuthorized: 100_000 }, classes: [], stakeholders: [], securities: [] };
    const plan = [
      { id: 'a', role: 'Engineer', headcount: 1, sizeMode: 'shares', shares: 60_000, startMonth: '2026-11' },
      { id: 'b', role: 'Designer', headcount: 2, sizeMode: 'shares', shares: 40_000, startMonth: '2029-01' },
    ];
    const f = poolForecast(db, plan, { from: '2026-09-06', months: 18 });
    expect(f.planned).toBe(140_000);
    expect(f.shortfall).toBe(40_000);
    // The chart's columns only ever draw the engineer; the designers are past them.
    expect(f.rows.reduce((a, r) => a + r.granted, 0)).toBe(60_000);
    expect(f.beyond).toBe(80_000);
    expect(f.rows[f.rows.length - 1].short).toBe(0);
    expect(poolForecast(db, plan.slice(0, 1), { from: '2026-09-06', months: 18 }).beyond).toBe(0);
  });

  it('draws an unscheduled or already-due hire in the first month', () => {
    const db = makeDb();
    const plan = [
      role({ id: 'a', shares: 100_000, startMonth: '' }),
      role({ id: 'b', shares: 50_000, startMonth: '2026-01' }),
    ];
    const f = poolForecast(db, plan, { from, months: 3 });
    expect(f.rows[0]).toMatchObject({ month: '2026-08', granted: 150_000, remaining: 350_000 });
    expect(f.unscheduled).toBe(150_000);
  });

  it('counts the whole plan in the shortfall, horizon or not', () => {
    const db = makeDb();
    const plan = [
      role({ id: 'a', shares: 400_000, startMonth: '2026-09' }),
      // Beyond the three-month window below, but the shares are still needed.
      role({ id: 'b', shares: 500_000, startMonth: '2028-01' }),
    ];
    const f = poolForecast(db, plan, { from, months: 3 });
    expect(f.planned).toBe(900_000);
    expect(f.shortfall).toBe(400_000);
    expect(f.dryMonth).toBeNull();
  });

  it('is empty without a plan or a date, and defaults its horizon', () => {
    const db = makeDb();
    expect(poolForecast(db, [], { from }).rows).toEqual([]);
    expect(poolForecast(db, [role({ shares: 1000 })], {}).rows).toEqual([]);
    expect(poolForecast(db, [role({ shares: 1000 })], { from }).rows)
      .toHaveLength(POOL_FORECAST_MONTHS);
    // A plan of nothing is not a plan.
    expect(poolForecast(db, [role({ shares: 0 })], { from }).planned).toBe(0);
  });

  it('never lets a planned grant touch the cap table', () => {
    const db = makeDb();
    const before = fullyDiluted(db.securities, db.company.poolAuthorized);
    const drawn = poolDrawn(db.securities);
    poolForecast(db, [role({ shares: 400_000 })], { from });
    expect(fullyDiluted(db.securities, db.company.poolAuthorized)).toBe(before);
    expect(poolDrawn(db.securities)).toBe(drawn);
  });
});

describe('poolTargetToCover', () => {
  /* The base db: 10M fully diluted with 500k of pool unallocated. */
  const asOf = '2026-09-01';
  const terms = { preMoney: 18_000_000, investment: 5_000_000, asOf };

  it('finds the smallest field value that leaves the plan unallocated', () => {
    const db = makeDb();
    const { poolPct, model } = poolTargetToCover(db, { ...terms, planned: 2_000_000 });
    expect(model.poolAfter).toBeGreaterThanOrEqual(2_000_000);
    // Not by more than the hundredth of a percent the field can hold.
    expect(model.poolAfter - 2_000_000).toBeLessThan(0.0002 * model.postFD);
    expect(model.poolAfter / model.postFD).toBeCloseTo(poolPct, 4);
    // A value the field holds as written: two decimals of a percent.
    expect(Math.round(poolPct * 10000) / 10000).toBe(poolPct);
    // And the same model the form shows once the value is typed back.
    expect(modelRound(db, { ...terms, poolPct }).poolAfter).toBe(model.poolAfter);
  });

  it('covers the plan when the raise dwarfs the pre-money', () => {
    /* The post-round count here grows faster than the target that drives
       it, so target = planned / count overshoots on every pass. Iterated,
       it handed back 1.7% and called a 10M plan covered with 500k. */
    const db = makeDb();
    const { poolPct, model } = poolTargetToCover(db, {
      preMoney: 4_000_000, investment: 12_000_000, planned: 10_000_000, asOf,
    });
    expect(poolPct).toBeGreaterThan(0.1);
    expect(model.poolAfter).toBeGreaterThanOrEqual(10_000_000);
    expect(model.poolAfter / model.postFD).toBeCloseTo(poolPct, 4);
  });

  it('asks for no top-up when the pool already covers the plan', () => {
    const db = makeDb();
    const { poolPct, model } = poolTargetToCover(db, { ...terms, planned: 400_000 });
    expect(model.poolAdd).toBe(0);
    expect(model.poolAfter).toBe(500_000);
    // The plan as a share of the post-round count, rounded up to the field.
    expect(poolPct).toBeGreaterThanOrEqual(400_000 / model.postFD);
    expect(poolPct - 400_000 / model.postFD).toBeLessThan(0.0001);
  });

  it('says when no target the model accepts can carry the plan', () => {
    /* The model refuses a pool past a thousand times today's count, so a
       plan of twenty billion shares has no target under it. */
    const db = makeDb();
    expect(poolTargetToCover(db, { ...terms, planned: 20_000_000_000 }))
      .toEqual({ poolPct: null, priceable: true });
  });

  it('says when the terms themselves do not price', () => {
    const db = makeDb();
    // A post-money cap short two zeros: the model refuses with no top-up at all.
    db.securities.push({ id: 'sf', kind: 'safe', safeType: 'post', label: 'SAFE-1', stakeholderId: 'h4', principal: 250_000, valuationCap: 80_000, discount: 0, date: '2025-01-01' });
    expect(poolTargetToCover(db, { ...terms, planned: 2_000_000 }))
      .toEqual({ poolPct: null, priceable: false });
  });
});

describe('exerciseRoom', () => {
  // 100 options vesting monthly over 2025 with no cliff: 25 by April, 75 by October.
  const grant = {
    id: 'g', kind: 'option', quantity: 100, strike: 1, date: '2025-01-01', grantDate: '2025-01-01',
    vestingMonths: 12, cliffMonths: 0, exercised: 0,
  };
  const cert = (quantity, date, extra = {}) => ({
    id: `c-${date}`, kind: 'shares', fromOptionId: 'g', stakeholderId: 'h', classId: 'c1', quantity, date, ...extra,
  });

  it('is the vesting of the day net of the exercises dated on or before it', () => {
    expect(exerciseRoom(grant, [], '2025-04-01')).toEqual({ room: 25, on: '2025-04-01' });
    expect(exerciseRoom({ ...grant, exercised: 10 }, [cert(10, '2025-02-01')], '2025-04-01'))
      .toEqual({ room: 15, on: '2025-04-01' });
    // A later exercise that the new one leaves within its vesting does not bind.
    expect(exerciseRoom({ ...grant, exercised: 50 }, [cert(50, '2026-01-01')], '2025-04-01'))
      .toEqual({ room: 25, on: '2025-04-01' });
  });

  it('is bounded by a later exercise the new one would put ahead of its vesting, and names its day', () => {
    expect(exerciseRoom({ ...grant, exercised: 75 }, [cert(75, '2025-10-01')], '2025-04-01'))
      .toEqual({ room: 0, on: '2025-10-01' });
    expect(exerciseRoom({ ...grant, exercised: 60 }, [cert(60, '2025-10-01')], '2025-04-01'))
      .toEqual({ room: 15, on: '2025-10-01' });
  });

  it('holds an exercise recorded on the counter alone ahead of every date, until it is certified', () => {
    expect(exerciseRoom({ ...grant, exercised: 50 }, [], '2025-04-01')).toEqual({ room: 0, on: '2025-04-01' });
    expect(exerciseRoom({ ...grant, exercised: 50 }, [], '2026-01-01')).toEqual({ room: 50, on: '2026-01-01' });
    expect(exerciseRoom({ ...grant, exercised: 50 }, [], '2025-04-01', { certifying: 50 }))
      .toEqual({ room: 25, on: '2025-04-01' });
  });

  it('reads a transfer successor as the shares already counted on its source', () => {
    const certs = [cert(25, '2025-04-01'), cert(25, '2025-05-01', { id: 'succ', fromTransferId: 'c-2025-04-01' })];
    expect(exerciseRoom({ ...grant, exercised: 25 }, certs, '2025-10-01')).toEqual({ room: 50, on: '2025-10-01' });
  });

  it('measures an RSU award the same way, in units', () => {
    const rsu = { ...grant, kind: 'rsu', settled: 50, exercised: undefined };
    const settled = { ...cert(50, '2026-01-01'), fromOptionId: undefined, fromRsuId: 'g' };
    expect(exerciseRoom(rsu, [settled], '2025-04-01')).toEqual({ room: 25, on: '2025-04-01' });
    expect(exerciseRoom({ ...rsu, settled: 75 }, [{ ...settled, quantity: 75, date: '2025-10-01' }], '2025-04-01'))
      .toEqual({ room: 0, on: '2025-10-01' });
  });
});

describe('modelRound reads the table as of the model date', () => {
  const db = {
    company: { poolAuthorized: 0 },
    classes: [{ id: 'c', name: 'Common Stock', kind: 'common' }],
    stakeholders: [{ id: 'f', name: 'Founder' }, { id: 'l', name: 'Later' }],
    securities: [
      { id: 'a', kind: 'shares', label: 'CS-1', stakeholderId: 'f', classId: 'c', quantity: 1_000_000, pricePerShare: 0.01, date: '2024-01-01' },
      { id: 'b', kind: 'shares', label: 'CS-2', stakeholderId: 'l', classId: 'c', quantity: 500_000, pricePerShare: 0.01, date: '2026-06-01' },
    ],
  };

  it('leaves a certificate dated after the model date out of the pre-round base', () => {
    const m = modelRound(db, { preMoney: 1_500_000, investment: 500_000, asOf: '2025-06-01' });
    expect(m.fdPre).toBe(1_000_000);
    expect(m.pps).toBeCloseTo(1.5, 9);
    expect(m.dilution.find((r) => r.stakeholderId === 'l')).toBeUndefined();
  });

  it('counts it once the model date reaches it', () => {
    const m = modelRound(db, { preMoney: 1_500_000, investment: 500_000, asOf: '2026-06-01' });
    expect(m.fdPre).toBe(1_500_000);
    expect(m.pps).toBeCloseTo(1, 9);
  });
});
