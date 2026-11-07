/**
 * Compliance and financial reporting - pure functions over the same `db`
 * snapshot captable.js reads, no I/O.
 *
 *  - ASC 718 stock-based compensation: the grant-date fair value of every
 *    option grant (Black-Scholes) and RSU award (the 409A price), attributed
 *    over the service period straight-line or tranche by tranche, with
 *    forfeitures reversed in the period they happen.
 *  - Rule 701: the trailing twelve months of compensatory sales against the
 *    exemption's three ceilings and its enhanced-disclosure threshold.
 *  - Form 3921: one row per ISO exercise in a calendar year, with the figures
 *    the form's boxes ask for.
 *
 * Every figure here is inputs and arithmetic. The app reads back the 409A the
 * user recorded and the volatility and rate they chose, and multiplies. It
 * takes no position on what those inputs should be, applies no tax, and is
 * not accounting or legal advice.
 */

import {
  hasVesting, vestingTranches, vestingStartDate, vestedQuantity, currentFMV, isISO,
  sharesOutstanding, warrantsOutstanding, grantExercised, cancellationHistory, dbAsOf, unsplitFactor, unsplitQuantity,
} from './captable.js';
import { addMonthsISO, addDaysISO, daysBetween, yearsBetween, nextBusinessDay } from './util.js';

/* ---------- Assumptions ---------- */

/**
 * The company's reporting assumptions, as stored on `company.reporting`.
 * Percentages are whole numbers (60 means 60%), the way a note's interest
 * rate and a SAFE's discount are stored everywhere else in the app.
 *
 *  volatility         expected volatility of the share price, % per year
 *  riskFreeRate       the risk-free rate over the expected term, % per year
 *  expectedTermYears  0 means the simplified method; otherwise the term used
 *  attribution        'straight' over the whole award, or 'graded' by tranche
 *  fiscalYearEnd      the month the fiscal year ends in, 1..12
 *  totalAssets        at the last fiscal year end, for Rule 701 (0 = not set)
 */
export const DEFAULT_REPORTING = Object.freeze({
  volatility: 0,
  riskFreeRate: 0,
  expectedTermYears: 0,
  attribution: 'straight',
  fiscalYearEnd: 12,
  totalAssets: 0,
});

export const ATTRIBUTION_METHODS = [
  { value: 'straight', label: 'Straight-line' },
  { value: 'graded', label: 'Graded' },
];

/** An option grant with no recorded expiration is taken to run this long. */
export const DEFAULT_CONTRACT_YEARS = 10;

export function reportingOf(company) {
  return { ...DEFAULT_REPORTING, ...(company?.reporting || {}) };
}

/**
 * Whether the expense report can be run: a volatility is needed to value an
 * option, and nothing else. A company holding only RSUs needs no
 * assumption at all - a unit is worth the share it promises.
 */
export function expenseReady(db) {
  if (reportingOf(db.company).volatility > 0) return true;
  return !db.securities.some((s) => s.kind === 'option');
}

/* ---------- Black-Scholes ---------- */

/**
 * The standard normal CDF, by Abramowitz & Stegun 26.2.17 - accurate to
 * better than 1e-7, which is far inside the precision any valuation input
 * carries.
 */
export function normalCdf(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * z);
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937
    + t * (-1.821255978 + t * 1.330274429))));
  const upper = 1 - (Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI)) * poly;
  return x >= 0 ? upper : 1 - upper;
}

/**
 * The Black-Scholes value of a call: spot and strike in money, `years` the
 * expected term, `rate` and `volatility` as decimals per year (0.04, 0.6).
 * No dividends - a startup pays none.
 *
 * With no time or no volatility left the option is worth its discounted
 * intrinsic value, which is what the formula converges to and what keeps a
 * degenerate input from producing NaN.
 */
export function blackScholesCall({ spot, strike, years, rate = 0, volatility = 0 }) {
  const S = Math.max(0, Number(spot) || 0);
  const K = Math.max(0, Number(strike) || 0);
  const T = Math.max(0, Number(years) || 0);
  const r = Number(rate) || 0;
  const v = Math.max(0, Number(volatility) || 0);
  if (S <= 0) return 0;
  if (T <= 0 || v <= 0) return Math.max(0, S - K * Math.exp(-r * T));
  if (K <= 0) return S;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (v * v) / 2) * T) / (v * sqrtT);
  const d2 = d1 - v * sqrtT;
  return S * normalCdf(d1) - K * Math.exp(-r * T) * normalCdf(d2);
}

/* ---------- Award schedules ---------- */

const grantDateOf = (award) => award?.grantDate || award?.date || '';

/**
 * An award's schedule as dated steps, [{ date, quantity }], read off the
 * same vesting math every other figure in the app uses - so cliffs,
 * quarterly and annual steps, and custom tranches all come out right - but
 * on the schedule as granted. A cancellation is a forfeiture the expense
 * math accounts for itself, not a shorter schedule; and a repurchase's
 * `vestingBase` is a certificate's concern, never an award's.
 *
 * Nothing vests before the grant date: a step dated earlier (a vesting start
 * back-dated to a hire date) vests on the day of grant. An award with no
 * schedule is one step, the whole grant, on its grant date.
 */
export function vestingSteps(award) {
  const total = Math.max(0, Math.round(Number(award?.quantity) || 0));
  const granted = grantDateOf(award);
  if (total <= 0 || !granted) return [];
  const asGranted = { ...award };
  delete asGranted.cancelledDate;
  delete asGranted.vestingStoppedAt;
  delete asGranted.vestingBase;
  if (!hasVesting(asGranted)) return [{ date: granted, quantity: total }];

  const dates = new Set();
  const tranches = vestingTranches(asGranted);
  if (tranches) {
    for (const t of tranches) if (t?.date) dates.add(t.date);
  } else {
    const start = vestingStartDate(asGranted);
    const months = Math.round(Number(asGranted.vestingMonths) || 0);
    for (let m = 0; m <= months; m++) {
      const d = addMonthsISO(start, m);
      if (d) dates.add(d);
    }
  }

  const byDate = new Map();
  let previous = 0;
  for (const date of [...dates].sort()) {
    const vested = Math.min(total, vestedQuantity(asGranted, date));
    if (vested <= previous) continue;
    const on = date < granted ? granted : date;
    byDate.set(on, (byDate.get(on) || 0) + (vested - previous));
    previous = vested;
  }
  return [...byDate.entries()].map(([date, quantity]) => ({ date, quantity }));
}

/** Years from grant to expiration, or the default term when none is recorded. */
export function contractYears(award) {
  const granted = grantDateOf(award);
  if (award?.expires && granted && award.expires > granted) return yearsBetween(granted, award.expires);
  return DEFAULT_CONTRACT_YEARS;
}

/**
 * The expected term of an option, in years. A term set in the assumptions
 * wins; otherwise the simplified method (SAB Topic 14): the midpoint between
 * each tranche's vesting date and the end of the contractual term, weighted
 * by the shares in the tranche.
 */
export function expectedTermYears(award, reporting) {
  const fixed = Number(reporting?.expectedTermYears) || 0;
  if (fixed > 0) return fixed;
  const term = contractYears(award);
  const granted = grantDateOf(award);
  const steps = vestingSteps(award);
  const total = steps.reduce((a, s) => a + s.quantity, 0);
  if (!total) return term / 2;
  const weighted = steps.reduce((a, s) => (
    a + s.quantity * ((Math.min(term, yearsBetween(granted, s.date)) + term) / 2)), 0);
  return weighted / total;
}

/**
 * The grant-date fair value of one unit of an award, and how it was reached.
 *
 * An option is valued by Black-Scholes with the 409A in force on the grant
 * date as the share price. Without one, the strike stands in - a grant is
 * priced at fair market value, so the strike is the best figure on record -
 * and the row says so. An RSU is worth the 409A price itself; without one it
 * cannot be valued, and that is reported rather than guessed at.
 *
 * `perUnit` is null only when the award cannot be valued at all.
 */
export function awardFairValue(db, award, reporting = reportingOf(db.company)) {
  const granted = grantDateOf(award);
  const fmv = granted ? currentFMV(db.company, granted) : null;
  /* `notes` are the sentences a spreadsheet carries; `flags` name the same
     facts as codes, for a table cell that has room for two words. */
  const notes = [];
  const flags = [];
  if (hasVesting(award) && award.vestingStart && award.vestingStart !== granted) {
    notes.push(`Vesting starts on ${award.vestingStart}. Expense attribution assumes service inception on the grant date, ${granted}; a separate accounting service period is not modeled.`);
    flags.push('service-at-grant');
  }
  if (award.kind === 'rsu') {
    if (!fmv) {
      return {
        perUnit: null, spot: null, fmv: null,
        notes: ['No 409A was in force on the grant date, so the units cannot be valued'],
        flags: ['unvalued'],
      };
    }
    return { perUnit: fmv.fmvPerShare, spot: fmv.fmvPerShare, fmv, notes, flags };
  }
  const strike = Math.max(0, Number(award.strike) || 0);
  let spot = fmv ? fmv.fmvPerShare : null;
  if (spot === null) {
    spot = strike;
    notes.push('No 409A was in force on the grant date; the strike stands in for the share price');
    flags.push('strike-as-fmv');
  }
  /* The same test contractYears applies: an expiry on or before the grant
     date is no term at all, and falls back to the default just as an absent
     one does - so it says so just as an absent one does. */
  if (!(award.expires && award.expires > granted)) {
    notes.push(`No usable expiration recorded; a ${DEFAULT_CONTRACT_YEARS}-year term is assumed`);
    flags.push('term-assumed');
  }
  const years = expectedTermYears(award, reporting);
  const perUnit = blackScholesCall({
    spot, strike, years,
    rate: (Number(reporting.riskFreeRate) || 0) / 100,
    volatility: (Number(reporting.volatility) || 0) / 100,
  });
  return { perUnit, spot, strike, years, fmv, notes, flags };
}

/**
 * One award's expense schedule: each tranche with its grant-date fair value
 * and whether it was forfeited, plus `recognized(date)`, the cumulative cost
 * recognized through that day under the company's attribution policy.
 *
 * Attribution runs from the grant date. Straight-line spreads the whole
 * award's value evenly to its final vesting date, floored at the value of
 * whatever has already vested (ASC 718-10-35-8). Graded spreads each
 * tranche's own value from grant to its own vesting date, front-loading the
 * cost the way a cliff-and-monthly schedule really vests.
 *
 * Forfeitures are accounted for as they occur (the ASU 2016-09 election):
 * each cancellation removes its quantity from the last unvested tranches,
 * and from that day cumulative cost excludes those units, so the period
 * holding each cancellation shows its reversal.
 * Options that were vested when cancelled (an expiry, a lapse) were earned;
 * their cost stands.
 */
export function awardExpenseSchedule(db, award, reporting = reportingOf(db.company)) {
  /* Kept per award while the company and the assumptions it was built under
     stand. A schedule depends on the award, the company's 409As and the
     reporting assumptions, none of which change between two renders of the
     Reports view - which rebuilds every schedule on every store change, and
     each schedule walks its vesting month by month: a quarter of a second to
     a second for a few thousand awards, on every save made while the view is
     open. The company object is replaced whenever it is edited, as is any
     award that changes, so a stale entry is never read. */
  const company = db?.company && typeof db.company === 'object' ? db.company : null;
  const key = JSON.stringify(reporting);
  let byAward = company ? scheduleCache.get(company) : null;
  if (company && !byAward) scheduleCache.set(company, (byAward = new WeakMap()));
  const hit = award && typeof award === 'object' ? byAward?.get(award) : null;
  if (hit && hit.key === key) return hit.schedule;
  const schedule = buildExpenseSchedule(db, award, reporting);
  if (byAward && award && typeof award === 'object') byAward.set(award, { key, schedule });
  return schedule;
}

const scheduleCache = new WeakMap();

function buildExpenseSchedule(db, award, reporting) {
  const granted = grantDateOf(award);
  const value = awardFairValue(db, award, reporting);
  const perUnit = value.perUnit || 0;
  const tranches = vestingSteps(award).map((s) => ({
    date: s.date,
    quantity: s.quantity,
    fairValue: s.quantity * perUnit,
    forfeited: false,
    forfeitedAt: '',
  }));
  /* Take `quantity` units off the last installments still to vest after
     `at`, dated as forfeited on `at`. */
  const forfeit = (at, quantity) => {
    let left = quantity;
    for (let i = tranches.length - 1; i >= 0 && left > 0; i--) {
      const t = tranches[i];
      if (t.forfeited || t.date <= at) continue;
      const taken = Math.min(left, t.quantity);
      const forfeited = { ...t, quantity: taken, fairValue: taken * perUnit, forfeited: true, forfeitedAt: at };
      if (taken === t.quantity) tranches[i] = forfeited;
      else tranches.splice(i, 1, { ...t, quantity: t.quantity - taken, fairValue: (t.quantity - taken) * perUnit }, forfeited);
      left -= taken;
    }
  };
  /* Service can end before the paperwork does: a departure stops vesting on
     its day whatever the sheet cancelled, and a lapse recorded later is
     dated at the exercise deadline. The vesting math reads each forfeiture
     from the stop when the stop came first (see vestedQuantity); read from
     the cancellation date instead, the installments between the two kept
     accruing cost for months after the holder had left, and a departure
     that cancelled nothing kept the whole award live. */
  const stopped = award.vestingStoppedAt || '';
  for (const cancellation of cancellationHistory(award)) {
    forfeit(stopped && stopped < cancellation.date ? stopped : cancellation.date, cancellation.quantity);
  }
  if (stopped) forfeit(stopped, Infinity);
  /* Each day something was forfeited on, with what it took: one line per
     day in the report, so a partial cancellation reads as the part it was
     and a second forfeiture is not filed under the first one's date. */
  const forfeitures = [...tranches.reduce((byDate, t) => {
    if (!t.forfeited) return byDate;
    const f = byDate.get(t.forfeitedAt) || { date: t.forfeitedAt, quantity: 0, fairValue: 0 };
    f.quantity += t.quantity;
    f.fairValue += t.fairValue;
    return byDate.set(t.forfeitedAt, f);
  }, new Map()).values()].sort((a, b) => a.date.localeCompare(b.date));
  const forfeitDate = forfeitures[0]?.date || '';
  const totalFairValue = tranches.reduce((a, t) => a + t.fairValue, 0);
  const forfeitedValue = tranches.reduce((a, t) => a + (t.forfeited ? t.fairValue : 0), 0);
  const graded = reporting.attribution === 'graded';

  const liveOn = (date) => tranches.filter((t) => !t.forfeitedAt || t.forfeitedAt > date);

  /* A tranche's own cost through `date`, under graded attribution. */
  const trancheRecognized = (t, date) => {
    if (!date || date < granted) return 0;
    const period = Math.max(0, daysBetween(granted, t.date));
    if (period <= 0) return t.fairValue;
    return t.fairValue * Math.min(1, Math.max(0, daysBetween(granted, date)) / period);
  };

  const recognized = (date) => {
    if (!date || date < granted) return 0;
    const live = liveOn(date);
    if (graded) return live.reduce((a, t) => a + trancheRecognized(t, date), 0);
    const total = live.reduce((a, t) => a + t.fairValue, 0);
    const end = live.reduce((m, t) => (t.date > m ? t.date : m), granted);
    const period = Math.max(0, daysBetween(granted, end));
    const straight = period <= 0 ? total : total * Math.min(1, Math.max(0, daysBetween(granted, date)) / period);
    const vested = live.reduce((a, t) => a + (t.date <= date ? t.fairValue : 0), 0);
    return Math.max(straight, vested);
  };

  /* Years until the cost still unrecognized on `date` will all be in: the
     time to the final live vesting date, or under graded attribution the
     average of each tranche's own remaining time weighted by what it has
     left to recognize. */
  const remainingYears = (date) => {
    const live = liveOn(date);
    if (!graded) {
      const end = live.reduce((m, t) => (t.date > m ? t.date : m), granted);
      return recognized(date) < live.reduce((a, t) => a + t.fairValue, 0) - 1e-9 ? yearsBetween(date, end) : 0;
    }
    let weighted = 0;
    let unrecognized = 0;
    for (const t of live) {
      const left = Math.max(0, t.fairValue - trancheRecognized(t, date));
      weighted += left * yearsBetween(date, t.date);
      unrecognized += left;
    }
    return unrecognized > 0 ? weighted / unrecognized : 0;
  };

  return {
    award, granted, value, tranches, forfeitDate, forfeitures, totalFairValue, forfeitedValue,
    liveFairValue: (date) => liveOn(date).reduce((a, t) => a + t.fairValue, 0),
    recognized, remainingYears,
  };
}

/* ---------- Fiscal periods ---------- */

const pad2 = (n) => String(n).padStart(2, '0');
const lastDayOf = (year, month) => `${year}-${pad2(month)}-${pad2(new Date(year, month, 0).getDate())}`;

const fyeMonth = (fiscalYearEnd) => {
  const m = Math.round(Number(fiscalYearEnd) || 12);
  return m >= 1 && m <= 12 ? m : 12;
};

/** The fiscal year an ISO date falls in, named by the calendar year it ends in. */
export function fiscalYearOf(date, fiscalYearEnd = 12) {
  const year = Number(String(date).slice(0, 4));
  const month = Number(String(date).slice(5, 7));
  return month <= fyeMonth(fiscalYearEnd) ? year : year + 1;
}

/**
 * The dates a fiscal year (or one of its quarters, 1..4) runs between,
 * inclusive, with the label the report heads it with. FY2026 with a
 * December year end is calendar 2026; with a June year end it is July 2025
 * through June 2026.
 */
export function fiscalPeriod(fyYear, fiscalYearEnd = 12, quarter = 0) {
  const year = Math.round(Number(fyYear));
  const endMonth = fyeMonth(fiscalYearEnd);
  const end = lastDayOf(year, endMonth);
  const start = endMonth === 12 ? `${year}-01-01` : `${year - 1}-${pad2(endMonth + 1)}-01`;
  const q = Math.round(Number(quarter) || 0);
  if (q < 1 || q > 4) return { start, end, label: `FY${year}`, fyYear: year, quarter: 0 };
  const qStart = addMonthsISO(start, 3 * (q - 1));
  const qEnd = addDaysISO(addMonthsISO(qStart, 3), -1);
  return { start: qStart, end: qEnd, label: `Q${q} FY${year}`, fyYear: year, quarter: q };
}

/** The most recent fiscal year end on or before a date. */
export function lastFiscalYearEnd(date, fiscalYearEnd = 12) {
  const fy = fiscalYearOf(date, fiscalYearEnd);
  const thisEnd = lastDayOf(fy, fyeMonth(fiscalYearEnd));
  return thisEnd <= date ? thisEnd : lastDayOf(fy - 1, fyeMonth(fiscalYearEnd));
}

/**
 * Every fiscal year the expense report has something to say about: from the
 * first award's grant to the later of today and the last award, so a grant
 * dated into next year can be looked at before it happens.
 */
export function fiscalYearsAvailable(db, today, fiscalYearEnd = 12) {
  const dates = db.securities
    .filter((s) => s.kind === 'option' || s.kind === 'rsu')
    .map(grantDateOf)
    .filter(Boolean);
  const current = fiscalYearOf(today, fiscalYearEnd);
  if (!dates.length) return [current];
  const first = Math.min(current, fiscalYearOf(dates.reduce((a, b) => (a < b ? a : b)), fiscalYearEnd));
  /* Forward only as far as a plan looks: a grant typed into 2999 for 2029
     otherwise put nine hundred years in the picker. */
  const last = Math.min(current + 10,
    Math.max(current, fiscalYearOf(dates.reduce((a, b) => (a > b ? a : b)), fiscalYearEnd)));
  const years = [];
  for (let y = first; y <= last; y++) years.push(y);
  return years;
}

/* ---------- ASC 718 expense report ---------- */

/**
 * Stock-based compensation for a period: one row per option grant and RSU
 * award granted by the period's end, with the cost recognized inside the
 * period, cumulatively through its end, and still to come.
 *
 * Each row: { security, stakeholderId, granted, units, perUnit, fairValue,
 * expense, cumulative, unrecognized, remainingYears, forfeitedInPeriod,
 * notes }. `totals.remainingYears` is the weighted-average period the
 * unrecognized cost will be recognized over - the disclosure ASC 718 asks
 * for beside the unrecognized figure.
 */
export function expenseReport(db, { start, end } = {}) {
  const reporting = reportingOf(db.company);
  const empty = {
    period: { start, end }, reporting, rows: [],
    totals: { fairValue: 0, expense: 0, cumulative: 0, unrecognized: 0, remainingYears: 0, forfeited: 0 },
  };
  if (!start || !end || end < start) return empty;
  const before = addDaysISO(start, -1);
  const rows = [];
  for (const s of db.securities) {
    if (s.kind !== 'option' && s.kind !== 'rsu') continue;
    const granted = grantDateOf(s);
    if (!granted || granted > end) continue;
    const sched = awardExpenseSchedule(db, s, reporting);
    const cumulative = sched.recognized(end);
    const expense = cumulative - sched.recognized(before);
    const unrecognized = Math.max(0, sched.liveFairValue(end) - cumulative);
    const forfeitedInPeriod = sched.tranches.reduce((sum, t) => sum
      + (t.forfeitedAt && t.forfeitedAt >= start && t.forfeitedAt <= end ? t.fairValue : 0), 0);
    rows.push({
      security: s,
      stakeholderId: s.stakeholderId,
      granted,
      units: sched.tranches.reduce((a, t) => a + t.quantity, 0),
      perUnit: sched.value.perUnit,
      fairValue: sched.totalFairValue,
      expense,
      cumulative,
      unrecognized,
      remainingYears: unrecognized > 0 ? sched.remainingYears(end) : 0,
      forfeitedInPeriod,
      forfeitDate: sched.forfeitDate,
      forfeitures: sched.forfeitures,
      notes: sched.value.notes,
      flags: sched.value.flags,
    });
  }
  rows.sort((a, b) => a.granted.localeCompare(b.granted) || String(a.security.label).localeCompare(String(b.security.label)));
  const sum = (key) => rows.reduce((a, r) => a + r[key], 0);
  const unrecognized = sum('unrecognized');
  return {
    period: { start, end },
    reporting,
    rows,
    totals: {
      fairValue: sum('fairValue'),
      expense: sum('expense'),
      cumulative: sum('cumulative'),
      unrecognized,
      remainingYears: unrecognized > 0
        ? rows.reduce((a, r) => a + r.unrecognized * r.remainingYears, 0) / unrecognized
        : 0,
      forfeited: sum('forfeitedInPeriod'),
    },
  };
}

/* ---------- Rule 701 ---------- */

/**
 * The exemption's fixed figures, in US dollars: the floor every issuer may
 * sell up to in a twelve-month period whatever its size, the multiple of
 * total assets or of the outstanding class that raises it, and the sales
 * price past which enhanced disclosure has to go to every recipient.
 */
export const RULE_701 = Object.freeze({
  floor: 1_000_000,
  ratio: 0.15,
  disclosure: 10_000_000,
});

/**
 * Every compensatory sale on the cap table, oldest first, valued the way
 * Rule 701(d)(3) measures aggregate sales price:
 *
 *  - an option grant, at its strike, on the grant date - not on exercise;
 *  - an RSU award, at the 409A in force on the grant date (null when there
 *    was none, and reported as such rather than counted at zero silently);
 *  - stock sold to an employee or advisor, at its price on the issue date.
 *
 * Founder stock and investor rounds are not compensatory. Exercise and
 * settlement certificates re-present a grant already counted, conversions
 * are financings, transfers are secondary, and anti-dilution shares were
 * never sold at all.
 *
 * Each sale: { date, security, stakeholderId, shares, price, basis }.
 */
export function compensatorySales(db) {
  const kinds = new Map(db.stakeholders.map((h) => [h.id, h.kind]));
  const sales = [];
  for (const s of db.securities) {
    if (s.kind === 'option') {
      const date = grantDateOf(s);
      const shares = Math.max(0, Math.round(Number(s.quantity) || 0));
      if (!date || shares <= 0) continue;
      sales.push({
        date, security: s, stakeholderId: s.stakeholderId, shares,
        price: shares * Math.max(0, Number(s.strike) || 0), basis: 'strike',
      });
    } else if (s.kind === 'rsu') {
      const date = grantDateOf(s);
      const shares = Math.max(0, Math.round(Number(s.quantity) || 0));
      if (!date || shares <= 0) continue;
      const fmv = currentFMV(db.company, date);
      sales.push({
        date, security: s, stakeholderId: s.stakeholderId, shares,
        price: fmv ? shares * fmv.fmvPerShare : null, basis: 'fmv',
      });
    } else if (s.kind === 'shares') {
      if (s.fromOptionId || s.fromRsuId || s.fromWarrantId || s.fromConvertibleId || s.fromTransferId || s.antiDilution) continue;
      const kind = kinds.get(s.stakeholderId);
      if (kind !== 'employee' && kind !== 'advisor') continue;
      const shares = Math.max(0, Math.round(Number(s.quantity) || 0));
      if (!s.date || shares <= 0) continue;
      sales.push({
        date: s.date, security: s, stakeholderId: s.stakeholderId, shares,
        price: shares * Math.max(0, Number(s.pricePerShare) || 0), basis: 'price',
      });
    }
  }
  sales.sort((a, b) => a.date.localeCompare(b.date) || String(a.security.label).localeCompare(String(b.security.label)));
  return sales;
}

/** The first day of the twelve months ending on `asOf`. */
export function trailingWindowStart(asOf) {
  return addDaysISO(addMonthsISO(asOf, -12), 1);
}

/**
 * The class outstanding the way Rule 701(d)(3)(iii) counts it for the 15%
 * test: every share outstanding on the measurement date plus the shares
 * under warrants, which are exercisable rights not issued under the
 * exemption - and not the shares under Rule 701 options themselves.
 * Preferred counts as-converted; a share is a share here. SAFEs and notes
 * have no share count until a round prices them, so they are left out.
 */
export function rule701ClassOutstanding(db, measuredAt) {
  const snap = dbAsOf(db, measuredAt);
  const count = sharesOutstanding(snap.securities) + warrantsOutstanding(snap.securities);
  /* `dbAsOf` reads in the units of its own date, and the sales tested
     against this denominator are stored in current ones. Restated forward
     for every split since, the two sides count the same share: without it a
     10-for-1 split after the whole window compared 10,000 post-split options
     with a 10,000-share pre-split class and turned a passing year failing. */
  const f = unsplitFactor(db.company, measuredAt);
  return f === 1 ? count : Math.round(count / f);
}

/**
 * Where the company stands under Rule 701 for the twelve months ending
 * `asOf`: the sales in the window, their aggregate sales price and share
 * count, the three ceilings (any one of which is enough), and whether the
 * enhanced-disclosure threshold has been crossed.
 *
 * The outstanding class is measured at the most recent fiscal year end on
 * or before `asOf`, as the rule directs; total assets come from the
 * assumptions, entered as of that same balance sheet date.
 *
 * `history` walks every sale date up to `asOf` with the trailing totals as
 * they stood that day: a sale is tested against the twelve months ending on
 * it, so those are the days the rule actually binds. The window ending on
 * `asOf` itself says what a grant made that day would face.
 */
export function rule701Report(db, { asOf } = {}) {
  const reporting = reportingOf(db.company);
  const sales = compensatorySales(db);
  if (!asOf) {
    return {
      asOf: '', windowStart: '', sales: [], salesPrice: 0, sharesSold: 0, unpriced: 0,
      measuredAt: '', classOutstanding: 0, limits: { floor: RULE_701.floor, assets: null, classShares: 0 },
      passes: { floor: true, assets: false, classShares: true }, compliant: true, disclosureRequired: false,
      history: [], peak: null, currency: db.company?.currency || 'USD',
    };
  }
  const denominators = new Map();
  const classOutstandingAt = (date) => {
    const measuredAt = lastFiscalYearEnd(date, reporting.fiscalYearEnd);
    if (!denominators.has(measuredAt)) denominators.set(measuredAt, rule701ClassOutstanding(db, measuredAt));
    return { measuredAt, classOutstanding: denominators.get(measuredAt) };
  };
  const assetsLimit = reporting.totalAssets > 0 ? RULE_701.ratio * reporting.totalAssets : null;

  const windowAt = (end) => {
    const start = trailingWindowStart(end);
    const inWindow = sales.filter((s) => s.date >= start && s.date <= end);
    const salesPrice = inWindow.reduce((a, s) => a + (s.price || 0), 0);
    const sharesSold = inWindow.reduce((a, s) => a + s.shares, 0);
    const { measuredAt, classOutstanding } = classOutstandingAt(end);
    const classShares = Math.floor(RULE_701.ratio * classOutstanding);
    const passes = {
      floor: salesPrice <= RULE_701.floor,
      assets: assetsLimit !== null && salesPrice <= assetsLimit,
      classShares: sharesSold <= classShares,
    };
    return {
      windowStart: start, sales: inWindow, salesPrice, sharesSold,
      unpriced: inWindow.filter((s) => s.price === null).length,
      measuredAt, classOutstanding,
      limits: { floor: RULE_701.floor, assets: assetsLimit, classShares },
      passes,
      compliant: passes.floor || passes.assets || passes.classShares,
      disclosureRequired: salesPrice > RULE_701.disclosure,
    };
  };

  const current = windowAt(asOf);
  const history = [];
  for (const sale of sales) {
    if (sale.date > asOf) break;
    if (history.length && history[history.length - 1].date === sale.date) continue;
    const w = windowAt(sale.date);
    history.push({
      date: sale.date, salesPrice: w.salesPrice, sharesSold: w.sharesSold,
      compliant: w.compliant, disclosureRequired: w.disclosureRequired,
    });
  }
  const peak = history.reduce((best, h) => (!best || h.salesPrice > best.salesPrice ? h : best), null);
  return { asOf, ...current, history, peak, currency: db.company?.currency || 'USD' };
}

/* ---------- Form 3921 ---------- */

/**
 * Every ISO exercise on record, as the certificate it produced: the
 * exercise's date, the strike actually paid, and the shares transferred
 * are all on the certificate, which is why an exercise recorded without one
 * cannot be reported (see `form3921Report().undated`). Transfer successors
 * re-present shares already reported on the original certificate.
 *
 * Every figure is restated into the units in force on the exercise date.
 * The form's boxes describe one completed transaction, so a split recorded
 * years later must not rewrite what a filed return said: a 100-share
 * exercise at $1 stays that, not 1,000 at $0.10.
 *
 * `shares` is therefore historical; `issued` is the same certificate in the
 * units it is held in today, which is what any reconciliation against a
 * grant's own counters has to be done in.
 *
 * Each: { certificate, grant, stakeholderId, grantDate, exerciseDate, strike,
 * fmv, shares, issued, early }.
 */
export function isoExercises(db) {
  const grants = new Map(db.securities.filter((s) => s.kind === 'option').map((s) => [s.id, s]));
  const out = [];
  for (const s of db.securities) {
    if (s.kind !== 'shares' || !s.fromOptionId || s.fromTransferId) continue;
    const grant = grants.get(s.fromOptionId);
    if (!isISO(grant) || !s.date) continue;
    const fmv = currentFMV(db.company, s.date);
    const f = unsplitFactor(db.company, s.date);
    const issued = Math.max(0, Math.round(Number(s.quantity) || 0));
    out.push({
      certificate: s,
      grant,
      stakeholderId: s.stakeholderId,
      grantDate: grantDateOf(grant),
      exerciseDate: s.date,
      strike: Math.max(0, Number(s.pricePerShare) || 0) / f,
      fmv: fmv ? fmv.fmvPerShare / f : null,
      shares: unsplitQuantity(s, db.company, s.date),
      issued,
      early: hasVesting(s),
    });
  }
  out.sort((a, b) => a.exerciseDate.localeCompare(b.exerciseDate) || String(a.certificate.label).localeCompare(String(b.certificate.label)));
  return out;
}

/**
 * The IRS deadlines that follow a calendar year's ISO exercises: Copy B to
 * the holder by 31 January, Copy A by 28 February on paper or 31 March
 * electronically - each moved to the following Monday when it falls on a
 * weekend, which is the adjustment the instructions direct.
 */
export function form3921Deadlines(year) {
  const next = Math.round(Number(year)) + 1;
  return {
    furnish: nextBusinessDay(`${next}-01-31`),
    filePaper: nextBusinessDay(`${next}-02-28`),
    fileElectronic: nextBusinessDay(`${next}-03-31`),
  };
}

/**
 * The Form 3921 return for a calendar year: one row per ISO exercise, the
 * years that have any, the deadlines that follow this one, and the ISO
 * exercises recorded on a grant without a certificate to date them.
 */
export function form3921Report(db, { year } = {}) {
  const all = isoExercises(db);
  const years = [...new Set(all.map((e) => Number(e.exerciseDate.slice(0, 4))))].sort((a, b) => a - b);
  const y = Math.round(Number(year));
  const rows = Number.isFinite(y) ? all.filter((e) => Number(e.exerciseDate.slice(0, 4)) === y) : [];
  /* Netted against the exercises this report can actually date - not the
     certificate index the cap table uses, which also counts a certificate
     carrying no date at all. Such a certificate (an import can leave one)
     belongs in this list: nothing says which year it is filed for.

     In current units on both sides: the grant's counter is restated by every
     split, so netting the rows' historical share counts off it would read the
     part a split added as an exercise nobody documented. */
  const dated = new Map();
  for (const e of all) dated.set(e.grant.id, (dated.get(e.grant.id) || 0) + e.issued);
  const undated = db.securities
    .filter((s) => isISO(s))
    .map((g) => ({ grant: g, quantity: grantExercised(g) - (dated.get(g.id) || 0) }))
    .filter((u) => u.quantity > 0);
  return {
    year: y,
    years,
    rows,
    shares: rows.reduce((a, r) => a + r.shares, 0),
    missingFmv: rows.filter((r) => r.fmv === null).length,
    undated,
    deadlines: Number.isFinite(y) ? form3921Deadlines(y) : null,
  };
}
