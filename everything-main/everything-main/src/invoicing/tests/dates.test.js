import { describe, it, expect } from 'vitest';
import {
  isISODate, MIN_DATE, MAX_DATE,
  addDays, addMonthsClamped, daysBetween, nextOccurrence, dueOccurrences, yearOf,
  ruleCompleted, remainingOccurrences, issuedCount,
} from '../src/lib/dates.js';

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('addMonthsClamped', () => {
  it('clamps to shorter months', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('recovers the anchor day after a clamped month', () => {
    const feb = addMonthsClamped('2026-01-31', 1, 31);
    expect(feb).toBe('2026-02-28');
    expect(addMonthsClamped(feb, 1, 31)).toBe('2026-03-31');
  });

  it('crosses year boundaries', () => {
    expect(addMonthsClamped('2026-11-15', 3)).toBe('2027-02-15');
  });
});

describe('daysBetween', () => {
  it('is signed and DST-safe', () => {
    expect(daysBetween('2026-08-01', '2026-08-04')).toBe(3);
    expect(daysBetween('2026-08-04', '2026-08-01')).toBe(-3);
    // A range crossing a DST change must still count whole days.
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });
});

describe('nextOccurrence', () => {
  it('advances by each supported frequency', () => {
    expect(nextOccurrence('2026-08-04', 'weekly')).toBe('2026-08-11');
    expect(nextOccurrence('2026-08-04', 'monthly')).toBe('2026-09-04');
    expect(nextOccurrence('2026-08-04', 'quarterly')).toBe('2026-11-04');
    expect(nextOccurrence('2026-08-04', 'yearly')).toBe('2027-08-04');
  });

  it('ignores an anchor day that is not a real day of the month', () => {
    // A restored backup can put anything in anchorDay; a negative one used
    // to send setDate() into the previous month and stall the date forever.
    expect(nextOccurrence('2026-01-26', 'monthly', -5)).toBe('2026-02-26');
    expect(nextOccurrence('2026-01-26', 'monthly', '31')).toBe('2026-02-26');
    expect(nextOccurrence('2026-01-26', 'monthly', 99)).toBe('2026-02-26');
    expect(nextOccurrence('2026-01-26', 'monthly', 31)).toBe('2026-02-28');
  });
});

describe('dueOccurrences', () => {
  it('collects every missed date and advances past today', () => {
    const rule = { nextDue: '2026-06-01', freq: 'monthly', anchorDay: 1 };
    const { dates, nextDue } = dueOccurrences(rule, '2026-08-04');
    expect(dates).toEqual(['2026-06-01', '2026-07-01', '2026-08-01']);
    expect(nextDue).toBe('2026-09-01');
  });

  it('returns nothing when the schedule is in the future', () => {
    const { dates, nextDue } = dueOccurrences({ nextDue: '2026-09-01', freq: 'monthly' }, '2026-08-04');
    expect(dates).toEqual([]);
    expect(nextDue).toBe('2026-09-01');
  });

  it('includes a schedule due today', () => {
    const { dates } = dueOccurrences({ nextDue: '2026-08-04', freq: 'weekly' }, '2026-08-04');
    expect(dates).toEqual(['2026-08-04']);
  });

  it('drafts nothing from a rule whose date cannot advance', () => {
    // Belt to the anchor-day braces: if any degenerate rule ever stalls the
    // occurrence arithmetic again, the catch-up loop must neither hang the
    // boot that runs it nor re-draft the same invoice at every launch.
    const rule = { nextDue: '2026-01-26', freq: 'monthly', anchorDay: -5 };
    const { dates, nextDue } = dueOccurrences(rule, '2026-08-04');
    expect(nextDue > '2026-01-26' || dates.length === 0).toBe(true);
  });

  it('caps a long-neglected schedule instead of flooding', () => {
    const rule = { nextDue: '2020-01-05', freq: 'weekly' };
    const { dates, nextDue } = dueOccurrences(rule, '2026-08-04', 12);
    expect(dates).toHaveLength(12);
    expect(nextDue > '2026-08-04').toBe(true);
    // The kept dates are the most recent ones, not the ancient backlog.
    expect(dates[dates.length - 1] <= '2026-08-04').toBe(true);
    expect(dates[0] >= '2026-05-01').toBe(true);
  });
});

describe('isISODate', () => {
  it('accepts the dates the app stores', () => {
    expect(isISODate('2026-09-05')).toBe(true);
    expect(isISODate('2024-02-29')).toBe(true);
    expect(isISODate(MIN_DATE)).toBe(true);
  });
  it('refuses the five- and six-digit years a date field lets through', () => {
    expect(isISODate('20260-09-05')).toBe(false);
    expect(isISODate('275760-09-13')).toBe(false);
  });
  it('refuses a year under 1000, which a Date writes back with three digits', () => {
    expect(isISODate('0999-01-01')).toBe(false);
    expect(isISODate('0099-01-01')).toBe(false);
  });
  it('refuses anything that is not a real calendar day', () => {
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('2026-13-01')).toBe(false);
    expect(isISODate('2026-9-5')).toBe(false);
    expect(isISODate('')).toBe(false);
    expect(isISODate(null)).toBe(false);
    expect(isISODate('Sep 5, 2026')).toBe(false);
  });
  it('is the shape every year-reading helper assumes', () => {
    expect(MIN_DATE).toBe('1000-01-01');
    expect(MAX_DATE).toBe('9999-12-31');
    expect(isISODate(MAX_DATE)).toBe(true);
  });
});

describe('yearOf', () => {
  it('slices the year key used for storage files', () => {
    expect(yearOf('2026-08-04')).toBe('2026');
  });
});

describe('dueOccurrences with an end date', () => {
  const rule = (over = {}) => ({
    nextDue: '2026-06-01', freq: 'monthly', anchorDay: 1, endMode: 'date', ...over,
  });

  it('never draws a date past the end date', () => {
    const { dates, nextDue } = dueOccurrences(rule({ endDate: '2026-07-15' }), '2026-08-04');
    expect(dates).toEqual(['2026-06-01', '2026-07-01']);
    expect(nextDue).toBe('2026-08-01');          // past the boundary, so nothing more runs
    expect(ruleCompleted({ ...rule({ endDate: '2026-07-15' }), nextDue })).toBe(true);
  });

  it('includes an occurrence falling exactly on the end date', () => {
    const { dates } = dueOccurrences(rule({ endDate: '2026-08-01' }), '2026-08-04');
    expect(dates).toEqual(['2026-06-01', '2026-07-01', '2026-08-01']);
  });

  it('keeps running while the end date is still ahead', () => {
    const r = rule({ nextDue: '2026-09-01', endDate: '2026-12-01' });
    expect(dueOccurrences(r, '2026-08-04').dates).toEqual([]);
    expect(ruleCompleted(r)).toBe(false);
    expect(remainingOccurrences(r)).toBe(4);     // Sep, Oct, Nov, Dec
  });

  it('is complete once its next date is past the end date', () => {
    expect(ruleCompleted(rule({ nextDue: '2027-01-01', endDate: '2026-12-01' }))).toBe(true);
    expect(remainingOccurrences(rule({ nextDue: '2027-01-01', endDate: '2026-12-01' }))).toBe(0);
  });

  it('does not flood the catch-up path past the boundary', () => {
    // Neglected for years, but the engagement ended in 2020.
    const { dates, nextDue } = dueOccurrences(
      rule({ nextDue: '2020-01-01', freq: 'weekly', endDate: '2020-02-15' }), '2026-08-04');
    expect(dates).toEqual(['2020-01-01', '2020-01-08', '2020-01-15', '2020-01-22', '2020-01-29', '2020-02-05', '2020-02-12']);
    expect(nextDue).toBe('2020-02-19');
  });
});

describe('dueOccurrences with an occurrence cap', () => {
  const rule = (over = {}) => ({
    nextDue: '2026-06-01', freq: 'monthly', anchorDay: 1, endMode: 'count', endCount: 6, ...over,
  });

  it('draws no more than the cap allows', () => {
    const { dates } = dueOccurrences(rule({ nextDue: '2020-01-01' }), '2026-08-04');
    expect(dates).toHaveLength(6);
    expect(dates[0]).toBe('2020-01-01');
  });

  it('counts what has already been issued', () => {
    const { dates } = dueOccurrences(rule({ nextDue: '2026-05-01', issued: 4 }), '2026-08-04');
    expect(dates).toEqual(['2026-05-01', '2026-06-01']);
    expect(remainingOccurrences(rule({ issued: 4 }))).toBe(2);
  });

  it('draws nothing once the cap is reached', () => {
    const done = rule({ issued: 6 });
    expect(dueOccurrences(done, '2026-08-04').dates).toEqual([]);
    expect(ruleCompleted(done)).toBe(true);
    expect(remainingOccurrences(done)).toBe(0);
  });

  it('treats an over-issued schedule as complete rather than negative', () => {
    expect(remainingOccurrences(rule({ issued: 9 }))).toBe(0);
    expect(ruleCompleted(rule({ issued: 9 }))).toBe(true);
  });

  it('reactivates when the cap is raised', () => {
    const extended = rule({ issued: 6, endCount: 12 });
    expect(ruleCompleted(extended)).toBe(false);
    expect(remainingOccurrences(extended)).toBe(6);
  });
});

describe('schedules without an end condition', () => {
  it('behave exactly as before', () => {
    const rule = { nextDue: '2026-06-01', freq: 'monthly', anchorDay: 1 };
    const { dates, nextDue } = dueOccurrences(rule, '2026-08-04');
    expect(dates).toEqual(['2026-06-01', '2026-07-01', '2026-08-01']);
    expect(nextDue).toBe('2026-09-01');
    expect(ruleCompleted(rule)).toBe(false);
    expect(remainingOccurrences(rule)).toBe(null);
    expect(ruleCompleted({ ...rule, endMode: 'never', issued: 99 })).toBe(false);
    expect(issuedCount(rule)).toBe(0);
    expect(issuedCount({ issued: 3 })).toBe(3);
    expect(issuedCount({ issued: -2 })).toBe(0);
  });

  it('ignores an end mode with nothing behind it', () => {
    expect(ruleCompleted({ nextDue: '2026-06-01', endMode: 'date', endDate: '' })).toBe(false);
    expect(ruleCompleted({ nextDue: '2026-06-01', endMode: 'count', endCount: 0 })).toBe(false);
    expect(remainingOccurrences({ nextDue: '2026-06-01', endMode: 'date', endDate: '' })).toBe(null);
  });
});
