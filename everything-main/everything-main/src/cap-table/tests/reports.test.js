import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/kv.js', async (importOriginal) =>
  (await import('./helpers/conditional-kv.js')).conditionalKVMock(importOriginal));
import {
  normalCdf, blackScholesCall, vestingSteps, contractYears, expectedTermYears, awardFairValue,
  awardExpenseSchedule, expenseReport, expenseReady, reportingOf, DEFAULT_REPORTING, DEFAULT_CONTRACT_YEARS,
  fiscalYearOf, fiscalPeriod, lastFiscalYearEnd, fiscalYearsAvailable,
  compensatorySales, trailingWindowStart, rule701ClassOutstanding, rule701Report, RULE_701,
  isoExercises, form3921Report, form3921Deadlines,
} from '../src/lib/reports.js';
import { upcomingEvents } from '../src/lib/captable.js';
import { Store } from '../src/lib/store.js';

/* ---------- Fixtures ---------- */

const reporting = (patch = {}) => ({
  ...DEFAULT_REPORTING, volatility: 60, riskFreeRate: 4, ...patch,
});

function makeDb(patch = {}) {
  const company = {
    name: 'Test Co', currency: 'USD', poolAuthorized: 1_000_000,
    valuations: [
      { id: 'v1', date: '2024-01-01', fmvPerShare: 0.5 },
      { id: 'v2', date: '2025-06-01', fmvPerShare: 2 },
    ],
    reporting: reporting(),
    ...patch.company,
  };
  const classes = [
    { id: 'c1', name: 'Common Stock', kind: 'common' },
    { id: 'p1', name: 'Series Seed Preferred', kind: 'preferred' },
  ];
  const stakeholders = [
    { id: 'h1', name: 'Ada', kind: 'founder' },
    { id: 'h2', name: 'Sam', kind: 'employee', email: 'sam@example.com' },
    { id: 'h3', name: 'Nova', kind: 'investor' },
    { id: 'h4', name: 'Lin', kind: 'advisor' },
  ];
  const securities = patch.securities || [
    { id: 's1', kind: 'shares', label: 'CS-1', stakeholderId: 'h1', classId: 'c1', quantity: 4_000_000, pricePerShare: 0.0001, date: '2023-05-20' },
    { id: 's2', kind: 'shares', label: 'SS-1', stakeholderId: 'h3', classId: 'p1', quantity: 2_000_000, pricePerShare: 0.5, date: '2024-06-10' },
    // 48 monthly steps from 2024-07-01 with a 12-month cliff, ten-year term.
    { id: 'o1', kind: 'option', label: 'OPT-1', stakeholderId: 'h2', quantity: 48_000, strike: 0.5, grantDate: '2024-07-01', date: '2024-07-01', vestingMonths: 48, cliffMonths: 12, exercised: 0, expires: '2034-07-01', optionType: 'iso' },
  ];
  return { company, classes, stakeholders, securities };
}

/* ---------- Black-Scholes ---------- */

describe('normalCdf', () => {
  it('matches the standard normal table', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021, 6);
    expect(normalCdf(-1.96)).toBeCloseTo(0.0249979, 6);
    expect(normalCdf(3)).toBeCloseTo(0.9986501, 6);
  });
});

describe('blackScholesCall', () => {
  it('prices the textbook at-the-money call', () => {
    // S = K = 100, one year, 5% rate, 20% volatility: 10.4506.
    expect(blackScholesCall({ spot: 100, strike: 100, years: 1, rate: 0.05, volatility: 0.2 })).toBeCloseTo(10.4506, 3);
  });

  it('is worth its discounted intrinsic value with no time or no volatility left', () => {
    expect(blackScholesCall({ spot: 120, strike: 100, years: 0, rate: 0.05, volatility: 0.2 })).toBeCloseTo(20, 9);
    expect(blackScholesCall({ spot: 120, strike: 100, years: 2, rate: 0.05, volatility: 0 }))
      .toBeCloseTo(120 - 100 * Math.exp(-0.1), 9);
    expect(blackScholesCall({ spot: 80, strike: 100, years: 0, rate: 0.05, volatility: 0.2 })).toBe(0);
  });

  it('converges on the share price for a free option and nothing for a worthless share', () => {
    expect(blackScholesCall({ spot: 3, strike: 0, years: 5, rate: 0.04, volatility: 0.6 })).toBe(3);
    expect(blackScholesCall({ spot: 0, strike: 1, years: 5, rate: 0.04, volatility: 0.6 })).toBe(0);
  });

  it('rises with volatility and with time, as an option must', () => {
    const base = { spot: 0.5, strike: 0.5, years: 6, rate: 0.04 };
    const low = blackScholesCall({ ...base, volatility: 0.4 });
    const high = blackScholesCall({ ...base, volatility: 0.8 });
    expect(high).toBeGreaterThan(low);
    expect(blackScholesCall({ ...base, volatility: 0.6, years: 8 }))
      .toBeGreaterThan(blackScholesCall({ ...base, volatility: 0.6, years: 3 }));
  });
});

/* ---------- Schedules and expected term ---------- */

describe('vestingSteps', () => {
  it('reads a cliff-then-monthly schedule as its dated steps', () => {
    const [grant] = makeDb().securities.filter((s) => s.kind === 'option');
    const steps = vestingSteps(grant);
    expect(steps).toHaveLength(37);
    expect(steps[0]).toEqual({ date: '2025-07-01', quantity: 12_000 });
    expect(steps[1]).toEqual({ date: '2025-08-01', quantity: 1_000 });
    expect(steps.at(-1)).toEqual({ date: '2028-07-01', quantity: 1_000 });
    expect(steps.reduce((a, s) => a + s.quantity, 0)).toBe(48_000);
  });

  it('honors quarterly steps and custom tranches', () => {
    const quarterly = { kind: 'option', quantity: 16_000, grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 12, vestingFrequency: 'quarterly' };
    const steps = vestingSteps(quarterly);
    expect(steps).toHaveLength(13);
    expect(steps[1]).toEqual({ date: '2025-04-01', quantity: 1_000 });
    const custom = { kind: 'rsu', quantity: 300, grantDate: '2024-01-01', vestingTranches: [{ date: '2024-06-01', quantity: 100 }, { date: '2025-06-01', quantity: 200 }] };
    expect(vestingSteps(custom)).toEqual([{ date: '2024-06-01', quantity: 100 }, { date: '2025-06-01', quantity: 200 }]);
  });

  it('vests an unscheduled award in full on its grant date, and nothing before the grant', () => {
    expect(vestingSteps({ kind: 'option', quantity: 500, grantDate: '2024-03-01', vestingMonths: 0 }))
      .toEqual([{ date: '2024-03-01', quantity: 500 }]);
    // Vesting credited from a hire date six months before the board granted it.
    const backdated = { kind: 'option', quantity: 48_000, grantDate: '2024-07-01', vestingStart: '2024-01-01', vestingMonths: 48, cliffMonths: 12 };
    const steps = vestingSteps(backdated);
    expect(steps[0].date >= '2024-07-01').toBe(true);
    expect(steps.reduce((a, s) => a + s.quantity, 0)).toBe(48_000);
  });

  it('reads the schedule as granted, not as a cancellation shortened it', () => {
    const [grant] = makeDb().securities.filter((s) => s.kind === 'option');
    const cancelled = { ...grant, cancelled: 30_000, cancelledDate: '2026-01-01' };
    expect(vestingSteps(cancelled)).toEqual(vestingSteps(grant));
  });
});

describe('expectedTermYears', () => {
  it('uses the term set in the assumptions when there is one', () => {
    const [grant] = makeDb().securities.filter((s) => s.kind === 'option');
    expect(expectedTermYears(grant, reporting({ expectedTermYears: 6.25 }))).toBe(6.25);
  });

  it('applies the simplified method: the midpoint of each vesting date and the contractual term', () => {
    // Fully vested at grant with a ten-year term: (0 + 10) / 2. Years are
    // counted in 365.25-day units, so a decade of calendar dates is 10.0014.
    expect(expectedTermYears({ kind: 'option', quantity: 100, grantDate: '2024-01-01', expires: '2034-01-01' }, reporting()))
      .toBeCloseTo(5, 2);
    // Two equal tranches at 1 and 3 years, 10-year term: average of 5.5 and 6.5.
    const two = {
      kind: 'option', quantity: 200, grantDate: '2024-01-01', expires: '2034-01-01',
      vestingTranches: [{ date: '2025-01-01', quantity: 100 }, { date: '2027-01-01', quantity: 100 }],
    };
    expect(expectedTermYears(two, reporting())).toBeCloseTo(6, 2);
  });

  it('assumes the default contractual term when no expiration is recorded', () => {
    expect(contractYears({ grantDate: '2024-01-01' })).toBe(DEFAULT_CONTRACT_YEARS);
    expect(contractYears({ grantDate: '2024-01-01', expires: '2031-01-01' })).toBeCloseTo(7, 2);
  });
});

/* ---------- Fair value ---------- */

describe('awardFairValue', () => {
  it('values an option with the 409A in force on the grant date', () => {
    const db = makeDb();
    const [grant] = db.securities.filter((s) => s.kind === 'option');
    const v = awardFairValue(db, grant);
    expect(v.spot).toBe(0.5);
    expect(v.perUnit).toBeGreaterThan(0);
    expect(v.perUnit).toBeLessThan(0.5);
    expect(v.notes).toEqual([]);
  });

  it('lets the strike stand in for the share price when no 409A covered the grant, and says so', () => {
    const db = makeDb({ company: { valuations: [] } });
    const [grant] = db.securities.filter((s) => s.kind === 'option');
    const v = awardFairValue(db, grant);
    expect(v.spot).toBe(0.5);
    expect(v.notes[0]).toMatch(/strike stands in/);
  });

  it('notes an assumed term and values an RSU at the 409A itself', () => {
    const db = makeDb();
    const [grant] = db.securities.filter((s) => s.kind === 'option');
    expect(awardFairValue(db, { ...grant, expires: undefined }).notes[0]).toMatch(/10-year term/);
    // An expiry on or before the grant date is no term either, and says so the same way.
    expect(awardFairValue(db, { ...grant, expires: grant.grantDate }).flags).toEqual(['term-assumed']);
    expect(awardFairValue(db, { ...grant, expires: '2020-01-01' }).flags).toEqual(['term-assumed']);
    expect(awardFairValue(db, grant).flags).toEqual([]);
    const rsu = { id: 'r1', kind: 'rsu', label: 'RSU-1', stakeholderId: 'h2', classId: 'c1', quantity: 1_000, grantDate: '2025-07-01', vestingMonths: 12, cliffMonths: 0, settled: 0 };
    expect(awardFairValue(db, rsu).perUnit).toBe(2);
    const bare = makeDb({ company: { valuations: [] } });
    expect(awardFairValue(bare, rsu).perUnit).toBeNull();
  });
});

/* ---------- Attribution ---------- */

describe('awardExpenseSchedule', () => {
  const db = makeDb();
  const [grant] = db.securities.filter((s) => s.kind === 'option');

  it('recognizes nothing before the grant and everything by the final vesting date, either way', () => {
    for (const attribution of ['straight', 'graded']) {
      const sched = awardExpenseSchedule(db, grant, reporting({ attribution }));
      expect(sched.recognized('2024-06-30')).toBe(0);
      expect(sched.recognized('2028-07-01')).toBeCloseTo(sched.totalFairValue, 6);
      expect(sched.recognized('2030-01-01')).toBeCloseTo(sched.totalFairValue, 6);
    }
  });

  it('spreads straight-line but never below the value already vested', () => {
    const sched = awardExpenseSchedule(db, grant, reporting({ attribution: 'straight' }));
    // A quarter of the way through the four years, a quarter of the value.
    expect(sched.recognized('2025-07-01') / sched.totalFairValue).toBeCloseTo(0.25, 2);
    // Halfway.
    expect(sched.recognized('2026-07-01') / sched.totalFairValue).toBeCloseTo(0.5, 2);
  });

  it('front-loads under graded attribution', () => {
    const straight = awardExpenseSchedule(db, grant, reporting({ attribution: 'straight' }));
    const graded = awardExpenseSchedule(db, grant, reporting({ attribution: 'graded' }));
    expect(graded.recognized('2025-07-01')).toBeGreaterThan(straight.recognized('2025-07-01'));
    expect(graded.recognized('2026-07-01')).toBeGreaterThan(straight.recognized('2026-07-01'));
  });

  it('floors straight-line at the vested value when a cliff vests more than the line has reached', () => {
    // 50% at a one-year cliff, the rest monthly over the next three: the cliff
    // day vests half while straight-line has reached a quarter.
    const front = {
      kind: 'option', quantity: 1_000, grantDate: '2024-01-01', expires: '2034-01-01', strike: 0.5,
      vestingTranches: [{ date: '2025-01-01', quantity: 500 }, { date: '2028-01-01', quantity: 500 }],
    };
    const sched = awardExpenseSchedule(db, front, reporting({ attribution: 'straight' }));
    expect(sched.recognized('2025-01-01') / sched.totalFairValue).toBeCloseTo(0.5, 9);
    expect(sched.recognized('2024-12-31') / sched.totalFairValue).toBeCloseTo(0.25, 2);
  });

  it('forfeits what had not vested at a cancellation and reverses its cost that day', () => {
    // Left after 18 months: 18/48 vested, the rest cancelled.
    const cancelled = { ...grant, cancelled: 30_000, cancelledDate: '2026-01-01' };
    for (const attribution of ['straight', 'graded']) {
      const sched = awardExpenseSchedule(db, cancelled, reporting({ attribution }));
      const vestedValue = sched.tranches.filter((t) => t.date <= '2026-01-01').reduce((a, t) => a + t.fairValue, 0);
      expect(sched.forfeitedValue).toBeCloseTo(sched.totalFairValue - vestedValue, 6);
      // The day before, the full schedule was still accruing.
      expect(sched.recognized('2025-12-31')).toBeGreaterThan(vestedValue);
      // From the cancellation on, only what vested is on the books.
      expect(sched.recognized('2026-01-01')).toBeCloseTo(vestedValue, 6);
      expect(sched.recognized('2029-01-01')).toBeCloseTo(vestedValue, 6);
      expect(sched.remainingYears('2026-01-01')).toBe(0);
    }
  });

  it('leaves the cost of vested options that lapsed unexercised where it is', () => {
    // Fully vested, then cancelled after expiry: nothing was forfeited.
    const lapsed = { ...grant, cancelled: 48_000, cancelledDate: '2034-07-01' };
    const sched = awardExpenseSchedule(db, lapsed, reporting());
    expect(sched.forfeitedValue).toBe(0);
    expect(sched.recognized('2035-01-01')).toBeCloseTo(sched.totalFairValue, 6);
  });
});

describe('expenseReport', () => {
  it('slices one award into periods that add back up to the whole', () => {
    const db = makeDb();
    const total = awardExpenseSchedule(db, db.securities[2], reportingOf(db.company)).totalFairValue;
    let sum = 0;
    for (let y = 2024; y <= 2028; y++) {
      const { totals } = expenseReport(db, fiscalPeriod(y, 12));
      sum += totals.expense;
    }
    expect(sum).toBeCloseTo(total, 6);
    const fy2028 = expenseReport(db, fiscalPeriod(2028, 12));
    expect(fy2028.totals.cumulative).toBeCloseTo(total, 6);
    expect(fy2028.totals.unrecognized).toBe(0);
    expect(fy2028.totals.remainingYears).toBe(0);
  });

  it('adds quarters up to the year and reports the unrecognized balance with its remaining period', () => {
    const db = makeDb();
    const year = expenseReport(db, fiscalPeriod(2026, 12));
    const quarters = [1, 2, 3, 4].map((q) => expenseReport(db, fiscalPeriod(2026, 12, q)).totals.expense);
    expect(quarters.reduce((a, b) => a + b, 0)).toBeCloseTo(year.totals.expense, 6);
    expect(year.totals.unrecognized).toBeGreaterThan(0);
    // 2026-12-31 to 2028-07-01: a year and a half left on the schedule.
    expect(year.totals.remainingYears).toBeCloseTo(1.5, 1);
    expect(year.rows[0]).toMatchObject({ stakeholderId: 'h2', granted: '2024-07-01', units: 48_000 });
  });

  it('shows a forfeiture as a reversal in the period it happens', () => {
    const db = makeDb();
    db.securities = db.securities.map((s) => (s.id === 'o1' ? { ...s, cancelled: 30_000, cancelledDate: '2026-01-15' } : s));
    const q1 = expenseReport(db, fiscalPeriod(2026, 12, 1));
    expect(q1.rows[0].forfeitedInPeriod).toBeGreaterThan(0);
    expect(q1.totals.expense).toBeLessThan(0);
    const q2 = expenseReport(db, fiscalPeriod(2026, 12, 2));
    expect(q2.totals.expense).toBe(0);
    expect(q2.rows[0].forfeitedInPeriod).toBe(0);
  });

  it('leaves out awards granted after the period and values RSUs without a volatility', () => {
    const db = makeDb();
    db.securities.push({ id: 'r1', kind: 'rsu', label: 'RSU-1', stakeholderId: 'h2', classId: 'c1', quantity: 1_000, grantDate: '2027-01-01', vestingMonths: 12, cliffMonths: 0, settled: 0 });
    expect(expenseReport(db, fiscalPeriod(2026, 12)).rows).toHaveLength(1);
    const later = expenseReport(db, fiscalPeriod(2027, 12));
    expect(later.rows).toHaveLength(2);
    // The 409A in force in 2027 is $2: a thousand units are worth $2,000.
    expect(later.rows.find((r) => r.security.id === 'r1').fairValue).toBe(2_000);
    const rsuOnly = makeDb({ company: { reporting: { ...DEFAULT_REPORTING } }, securities: db.securities.filter((s) => s.kind !== 'option') });
    expect(expenseReady(rsuOnly)).toBe(true);
    expect(expenseReady(makeDb({ company: { reporting: { ...DEFAULT_REPORTING } } }))).toBe(false);
  });

  it('returns an empty report for a period that makes no sense', () => {
    expect(expenseReport(makeDb(), { start: '2026-12-31', end: '2026-01-01' }).rows).toEqual([]);
    expect(expenseReport(makeDb(), {}).totals.expense).toBe(0);
  });
});

/* ---------- Fiscal periods ---------- */

describe('fiscal periods', () => {
  it('names a fiscal year by the calendar year it ends in', () => {
    expect(fiscalYearOf('2026-03-15', 12)).toBe(2026);
    expect(fiscalYearOf('2026-03-15', 6)).toBe(2026);
    expect(fiscalYearOf('2026-09-15', 6)).toBe(2027);
  });

  it('runs a year and its quarters between the right dates', () => {
    expect(fiscalPeriod(2026, 12)).toMatchObject({ start: '2026-01-01', end: '2026-12-31', label: 'FY2026' });
    expect(fiscalPeriod(2026, 6)).toMatchObject({ start: '2025-07-01', end: '2026-06-30', label: 'FY2026' });
    expect(fiscalPeriod(2026, 6, 1)).toMatchObject({ start: '2025-07-01', end: '2025-09-30', label: 'Q1 FY2026' });
    expect(fiscalPeriod(2026, 12, 4)).toMatchObject({ start: '2026-10-01', end: '2026-12-31', label: 'Q4 FY2026' });
    expect(fiscalPeriod(2024, 2)).toMatchObject({ start: '2023-03-01', end: '2024-02-29' });
  });

  it('finds the most recent fiscal year end on or before a date', () => {
    expect(lastFiscalYearEnd('2026-09-03', 12)).toBe('2025-12-31');
    expect(lastFiscalYearEnd('2025-12-31', 12)).toBe('2025-12-31');
    expect(lastFiscalYearEnd('2026-09-03', 6)).toBe('2026-06-30');
    expect(lastFiscalYearEnd('2026-03-03', 6)).toBe('2025-06-30');
  });

  it('looks no further ahead than ten fiscal years', () => {
    // A grant typed into 2999 for 2029 put nine hundred years in the picker.
    const far = makeDb();
    far.securities.push({
      id: 'far', kind: 'option', label: 'OPT-9', stakeholderId: far.stakeholders[0].id,
      quantity: 100, strike: 1, grantDate: '2999-01-01', exercised: 0, vestingMonths: 48, cliffMonths: 12,
    });
    const years = fiscalYearsAvailable(far, '2026-09-03', 12);
    expect(years[0]).toBe(2024);
    expect(years[years.length - 1]).toBe(2036);
  });

  it('lists every fiscal year from the first award to today, at least', () => {
    expect(fiscalYearsAvailable(makeDb(), '2026-09-03', 12)).toEqual([2024, 2025, 2026]);
    expect(fiscalYearsAvailable(makeDb({ securities: [] }), '2026-09-03', 12)).toEqual([2026]);
    // Every award still ahead: today's year is on the list all the same.
    const ahead = makeDb();
    ahead.securities = ahead.securities.map((s) => (s.kind === 'option' ? { ...s, grantDate: '2028-03-01', date: '2028-03-01' } : s));
    expect(fiscalYearsAvailable(ahead, '2026-09-03', 12)).toEqual([2026, 2027, 2028]);
  });
});

/* ---------- Rule 701 ---------- */

describe('compensatorySales', () => {
  it('counts options at strike, RSUs at the 409A, and stock sold to employees and advisors, and nothing else', () => {
    const db = makeDb();
    db.securities.push(
      { id: 'r1', kind: 'rsu', label: 'RSU-1', stakeholderId: 'h2', classId: 'c1', quantity: 1_000, grantDate: '2025-07-01', vestingMonths: 12, cliffMonths: 0, settled: 0 },
      { id: 's3', kind: 'shares', label: 'CS-2', stakeholderId: 'h4', classId: 'c1', quantity: 10_000, pricePerShare: 0.5, date: '2025-08-01' },
      // An exercise certificate re-presents the grant already counted.
      { id: 's4', kind: 'shares', label: 'CS-3', stakeholderId: 'h2', classId: 'c1', quantity: 5_000, pricePerShare: 0.5, date: '2026-01-10', fromOptionId: 'o1' },
    );
    const sales = compensatorySales(db);
    expect(sales.map((s) => [s.security.label, s.shares, s.price])).toEqual([
      ['OPT-1', 48_000, 24_000],
      ['RSU-1', 1_000, 2_000],
      ['CS-2', 10_000, 5_000],
    ]);
  });

  it('reports an RSU granted with no 409A in force as unpriced rather than free', () => {
    const db = makeDb({ company: { valuations: [] } });
    db.securities.push({ id: 'r1', kind: 'rsu', label: 'RSU-1', stakeholderId: 'h2', classId: 'c1', quantity: 1_000, grantDate: '2025-07-01', vestingMonths: 12, cliffMonths: 0, settled: 0 });
    expect(compensatorySales(db).find((s) => s.security.id === 'r1').price).toBeNull();
  });
});

describe('rule701Report', () => {
  it('builds the trailing twelve months and measures the class at the last fiscal year end', () => {
    const db = makeDb();
    expect(trailingWindowStart('2025-06-30')).toBe('2024-07-01');
    const report = rule701Report(db, { asOf: '2025-06-30' });
    expect(report.sales.map((s) => s.security.label)).toEqual(['OPT-1']);
    expect(report.salesPrice).toBe(24_000);
    expect(report.sharesSold).toBe(48_000);
    expect(report.measuredAt).toBe('2024-12-31');
    // Common plus preferred outstanding at the year end; the Rule 701 grant itself is not in the base.
    expect(report.classOutstanding).toBe(6_000_000);
    expect(report.limits.classShares).toBe(900_000);
    expect(report.passes).toEqual({ floor: true, assets: false, classShares: true });
    expect(report.compliant).toBe(true);
    expect(report.disclosureRequired).toBe(false);
    // The day after the window closes the grant drops out of it.
    expect(rule701Report(db, { asOf: '2025-07-01' }).sales).toEqual([]);
  });

  it('counts warrants in the outstanding class and skips the assets test until assets are set', () => {
    const db = makeDb();
    db.securities.push({ id: 'w1', kind: 'warrant', label: 'WNT-1', stakeholderId: 'h3', classId: 'p1', quantity: 100_000, strike: 0.5, date: '2024-03-01', expires: '2034-03-01' });
    expect(rule701ClassOutstanding(db, '2024-12-31')).toBe(6_100_000);
    expect(rule701Report(db, { asOf: '2025-06-30' }).limits.assets).toBeNull();
    db.company.reporting = reporting({ totalAssets: 2_000_000 });
    const report = rule701Report(db, { asOf: '2025-06-30' });
    expect(report.limits.assets).toBe(300_000);
    expect(report.passes.assets).toBe(true);
  });

  it('counts the class in the same units as the sales tested against it', () => {
    const db = makeDb();
    const before = rule701Report(db, { asOf: '2025-06-30' });
    // A 10-for-1 split after the window restates every stored quantity; the
    // fiscal-year-end denominator has to move with them or the 15% test
    // compares post-split grants with a pre-split class.
    db.company.splits = [{ id: 'sp1', date: '2025-09-01', num: 10, den: 1 }];
    db.securities = db.securities.map((s) => (s.kind === 'safe' || s.kind === 'note'
      ? s
      : { ...s, quantity: s.quantity * 10, strike: s.strike ? s.strike / 10 : s.strike, pricePerShare: s.pricePerShare ? s.pricePerShare / 10 : s.pricePerShare }));
    const after = rule701Report(db, { asOf: '2025-06-30' });
    expect(after.sharesSold).toBe(before.sharesSold * 10);
    expect(after.classOutstanding).toBe(before.classOutstanding * 10);
    expect(after.passes.classShares).toBe(before.passes.classShares);
    expect(after.compliant).toBe(before.compliant);
  });

  it('flags a window that clears no ceiling, and one that crosses the disclosure threshold', () => {
    const db = makeDb();
    // A grant of two million options at $6 is $12 million of sales price and a third of the class.
    db.securities.push({ id: 'o2', kind: 'option', label: 'OPT-2', stakeholderId: 'h2', quantity: 2_000_000, strike: 6, grantDate: '2025-03-01', date: '2025-03-01', vestingMonths: 48, cliffMonths: 12, exercised: 0 });
    db.company.reporting = reporting({ totalAssets: 2_000_000 });
    const report = rule701Report(db, { asOf: '2025-06-30' });
    expect(report.salesPrice).toBe(12_024_000);
    expect(report.passes).toEqual({ floor: false, assets: false, classShares: false });
    expect(report.compliant).toBe(false);
    expect(report.disclosureRequired).toBe(true);
    expect(report.history.map((h) => [h.date, h.compliant, h.disclosureRequired])).toEqual([
      ['2024-07-01', true, false],
      ['2025-03-01', false, true],
    ]);
    expect(report.peak).toMatchObject({ date: '2025-03-01', salesPrice: 12_024_000 });
    // In dollars: the thresholds the report compares against.
    expect(RULE_701).toEqual({ floor: 1_000_000, ratio: 0.15, disclosure: 10_000_000 });
  });

  it('is quiet without a date', () => {
    expect(rule701Report(makeDb(), {}).sales).toEqual([]);
  });
});

/* ---------- Form 3921 ---------- */

describe('form3921Report', () => {
  function withExercises() {
    const db = makeDb();
    db.securities = db.securities.map((s) => (s.id === 'o1' ? { ...s, exercised: 15_000 } : s));
    db.securities.push(
      { id: 'x1', kind: 'shares', label: 'CS-2', stakeholderId: 'h2', classId: 'c1', quantity: 5_000, pricePerShare: 0.5, date: '2025-09-15', fromOptionId: 'o1' },
      { id: 'x2', kind: 'shares', label: 'CS-3', stakeholderId: 'h2', classId: 'c1', quantity: 4_000, pricePerShare: 0.5, date: '2026-02-01', fromOptionId: 'o1' },
      // The 2025 shares sold on: a transfer successor is not a new exercise.
      { id: 'x3', kind: 'shares', label: 'CS-4', stakeholderId: 'h1', classId: 'c1', quantity: 5_000, pricePerShare: 0.5, date: '2026-03-01', fromOptionId: 'o1', fromTransferId: 't1' },
      // An NSO exercise never reaches the form.
      { id: 'o2', kind: 'option', label: 'OPT-2', stakeholderId: 'h4', quantity: 1_000, strike: 0.5, grantDate: '2025-01-01', date: '2025-01-01', vestingMonths: 0, cliffMonths: 0, exercised: 1_000 },
      { id: 'x4', kind: 'shares', label: 'CS-5', stakeholderId: 'h4', classId: 'c1', quantity: 1_000, pricePerShare: 0.5, date: '2025-10-01', fromOptionId: 'o2' },
    );
    return db;
  }

  it('lists each ISO exercise certificate with the figures the boxes ask for', () => {
    const db = withExercises();
    expect(isoExercises(db).map((e) => e.certificate.label)).toEqual(['CS-2', 'CS-3']);
    const report = form3921Report(db, { year: 2025 });
    expect(report.years).toEqual([2025, 2026]);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      stakeholderId: 'h2', grantDate: '2024-07-01', exerciseDate: '2025-09-15', strike: 0.5, fmv: 2, shares: 5_000, early: false,
    });
    expect(report.shares).toBe(5_000);
    expect(report.missingFmv).toBe(0);
    expect(report.deadlines).toEqual(form3921Deadlines(2025));
  });

  it('reports exercises recorded without a certificate, since nothing dates them', () => {
    const report = form3921Report(withExercises(), { year: 2026 });
    // 15,000 exercised on the grant, 9,000 of it certified.
    expect(report.undated).toEqual([{ grant: expect.objectContaining({ id: 'o1' }), quantity: 6_000 }]);
    expect(report.rows.map((r) => r.certificate.label)).toEqual(['CS-3']);
  });

  it('lists an exercise certificate that carries no date as undated rather than losing it', () => {
    const db = withExercises();
    // An import can leave a certificate with no date; nothing says which year it is filed for.
    db.securities.push({ id: 'x5', kind: 'shares', label: 'CS-6', stakeholderId: 'h2', classId: 'c1', quantity: 2_000, pricePerShare: 0.5, date: '', fromOptionId: 'o1' });
    db.securities = db.securities.map((s) => (s.id === 'o1' ? { ...s, exercised: 17_000 } : s));
    const report = form3921Report(db, { year: 2026 });
    expect(report.rows.map((r) => r.certificate.label)).toEqual(['CS-3']);
    // 17,000 exercised, 9,000 of it on dated certificates.
    expect(report.undated).toEqual([{ grant: expect.objectContaining({ id: 'o1' }), quantity: 8_000 }]);
  });

  it('reads original exercise quantities through rounded and offsetting splits', () => {
    const db = withExercises();
    const cert = db.securities.find((s) => s.fromOptionId && s.date.startsWith('2025'));
    cert.quantity = 15;
    const before = form3921Report(db, { year: 2025 }).rows[0];
    db.company.splits = [{ id: 'reverse', date: '2026-06-01', num: 1, den: 10 }];
    cert.quantity = 2;
    cert.pricePerShare *= 10;
    cert.preSplit = [{ id: 'reverse', quantity: 15 }];
    db.company.valuations = db.company.valuations.map((v) => ({ ...v, fmvPerShare: v.fmvPerShare * 10 }));
    let after = form3921Report(db, { year: 2025 }).rows[0];
    expect({ shares: after.shares, strike: after.strike, fmv: after.fmv })
      .toEqual({ shares: 15, strike: before.strike, fmv: before.fmv });
    expect(after.issued).toBe(2);
    db.company.splits.push({ id: 'forward', date: '2027-06-01', num: 10, den: 1 });
    cert.quantity = 20;
    cert.pricePerShare /= 10;
    db.company.valuations = db.company.valuations.map((v) => ({ ...v, fmvPerShare: v.fmvPerShare / 10 }));
    after = form3921Report(db, { year: 2025 }).rows[0];
    expect(after.shares).toBe(15);
    expect(after.issued).toBe(20);
  });

  it('reports a completed year in the units and prices of the exercise date', () => {
    const db = withExercises();
    const before = form3921Report(db, { year: 2025 }).rows[0];
    // A 10-for-1 split a year later restates every stored quantity and price.
    db.company.splits = [{ id: 'sp1', date: '2026-06-01', num: 10, den: 1 }];
    db.company.valuations = db.company.valuations.map((v) => ({ ...v, fmvPerShare: v.fmvPerShare / 10 }));
    db.securities = db.securities.map((s) => (s.kind === 'shares'
      ? { ...s, quantity: s.quantity * 10, pricePerShare: s.pricePerShare / 10 }
      : s));
    const after = form3921Report(db, { year: 2025 }).rows[0];
    // The form's boxes describe one completed transaction; a later split
    // cannot rewrite what the filed return said.
    expect({ shares: after.shares, strike: after.strike, fmv: after.fmv })
      .toEqual({ shares: before.shares, strike: before.strike, fmv: before.fmv });
    expect(after.shares).toBe(5_000);
  });

  it('does not read the shares a split added as an undocumented exercise', () => {
    const db = withExercises();
    // Every exercise on o1 documented: 9,000 exercised, 9,000 certified.
    db.securities = db.securities.map((s) => (s.id === 'o1' ? { ...s, exercised: 9_000 } : s));
    expect(form3921Report(db, { year: 2026 }).undated).toEqual([]);
    // A 10-for-1 split restates the grant's counter and its certificates alike.
    db.company.splits = [{ id: 'sp1', date: '2026-06-01', num: 10, den: 1 }];
    db.securities = db.securities.map((s) => {
      if (s.id === 'o1') return { ...s, quantity: s.quantity * 10, exercised: 90_000 };
      return s.kind === 'shares' ? { ...s, quantity: s.quantity * 10, pricePerShare: s.pricePerShare / 10 } : s;
    });
    const report = form3921Report(db, { year: 2026 });
    // The row still reads in 2026 units; the reconciliation reads in today's.
    expect(report.rows[0].shares).toBe(4_000);
    expect(report.undated).toEqual([]);
  });

  it('marks an exercise the 409A history does not reach', () => {
    const db = withExercises();
    db.company.valuations = [];
    const report = form3921Report(db, { year: 2025 });
    expect(report.rows[0].fmv).toBeNull();
    expect(report.missingFmv).toBe(1);
  });

  it('moves a deadline off a weekend onto the following Monday', () => {
    // 31 January and 28 February 2026 are both Saturdays, which is what the
    // IRS instructions for the 2025 forms say: 2 February and 2 March.
    expect(form3921Deadlines(2025))
      .toEqual({ furnish: '2026-02-02', filePaper: '2026-03-02', fileElectronic: '2026-03-31' });
    // 31 March 2024 is a Sunday - one day forward, not two.
    expect(form3921Deadlines(2023).fileElectronic).toBe('2024-04-01');
    // A year where all three land on weekdays is left alone.
    expect(form3921Deadlines(2024))
      .toEqual({ furnish: '2025-01-31', filePaper: '2025-02-28', fileElectronic: '2025-03-31' });
  });

  it('puts the January deadline on the calendar for a year with ISO exercises', () => {
    const db = withExercises();
    const events = upcomingEvents(db, { from: '2025-12-01', horizonMonths: 3 });
    const filing = events.find((e) => e.type === 'form-3921');
    // The calendar and the report have to name the same adjusted day.
    expect(filing).toMatchObject({
      date: form3921Deadlines(2025).furnish, year: 2025, quantity: 1, label: 'Form 3921',
    });
    expect(filing.date).toBe('2026-02-02');
    // Not for a year that had none, and only while the deadline is ahead.
    expect(upcomingEvents(makeDb(), { from: '2025-12-01', horizonMonths: 3 }).some((e) => e.type === 'form-3921')).toBe(false);
    expect(upcomingEvents(db, { from: '2026-02-03', horizonMonths: 3 }).some((e) => e.type === 'form-3921')).toBe(false);
  });
});

/* ---------- Store round trip ---------- */

describe('reporting assumptions in the store', () => {
  function liveStore() {
    const kv = new Map();
    globalThis.puter = {
      kv: {
        get: async (k) => (kv.has(k) ? kv.get(k) : null),
        set: async (k, v) => { kv.set(k, v); return true; },
        del: async (k) => { kv.delete(k); return true; },
      },
      auth: { getUser: async () => ({ uuid: 't', username: 'test' }) },
    };
    return new Store();
  }
  const assumptions = { volatility: 55, riskFreeRate: 3.9, attribution: 'graded', fiscalYearEnd: 9, totalAssets: 750_000 };
  const expected = { volatility: 55, riskFreeRate: 3.9, expectedTermYears: 0, attribution: 'graded', fiscalYearEnd: 9, totalAssets: 750_000 };

  it('travel through an export and an import into another company', async () => {
    const a = liveStore();
    await a.updateCompany({ name: 'Round Trip', reporting: assumptions });
    expect(a.company.reporting).toEqual(expected);
    const exported = JSON.parse(JSON.stringify(a.exportAll()));
    const b = liveStore();
    await b.importAll(exported, { label: 'Import' });
    expect(b.company.reporting).toEqual(expected);
  });

  it('count as data worth a restore point, so a wipe can be undone', async () => {
    const s = liveStore();
    await s.updateCompany({ reporting: assumptions });
    expect(s.restorePoints).toHaveLength(0);
    await s.wipeAll();
    expect(s.company.reporting).toEqual(Store.defaultReporting());
    expect(s.restorePoints).toHaveLength(1);
    await s.restoreFromPoint(s.restorePoints[0].id);
    expect(s.company.reporting).toEqual(expected);
    // Untouched assumptions are not data: an empty company still takes no snapshot.
    const empty = liveStore();
    await empty.wipeAll();
    expect(empty.restorePoints).toHaveLength(0);
  });
});
