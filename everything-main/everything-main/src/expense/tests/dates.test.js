import { describe, it, expect } from 'vitest';
import { parseLooseDate, detectDayFirst, isValidISO, daysBetween, addDays, monthKey, shiftMonth, friendlyDay, endOfMonthISO } from '../src/lib/dates.js';

const now = new Date(2026, 7, 26); // 26 Aug 2026

describe('parseLooseDate', () => {
  it('accepts ISO and ISO-like dates', () => {
    expect(parseLooseDate('2026-08-03')).toBe('2026-08-03');
    expect(parseLooseDate('2026/8/3')).toBe('2026-08-03');
    expect(parseLooseDate('2026-08-03T14:22:00Z')).toBe('2026-08-03');
  });
  it('disambiguates numeric dates by value and by hint', () => {
    expect(parseLooseDate('31/12/2025')).toBe('2025-12-31');
    expect(parseLooseDate('12/31/2025')).toBe('2025-12-31');
    expect(parseLooseDate('03/04/2026')).toBe('2026-03-04');
    expect(parseLooseDate('03/04/2026', { dayFirst: true })).toBe('2026-04-03');
    expect(parseLooseDate('03.04.26', { dayFirst: true })).toBe('2026-04-03');
  });
  it('reads written months', () => {
    expect(parseLooseDate('Aug 3, 2026')).toBe('2026-08-03');
    expect(parseLooseDate('3 Aug 2026')).toBe('2026-08-03');
    expect(parseLooseDate('03-Aug-2026')).toBe('2026-08-03');
    expect(parseLooseDate('August 3rd 2026')).toBe('2026-08-03');
    expect(parseLooseDate('Aug 3', { now })).toBe('2026-08-03');
  });
  it('rejects garbage and impossible dates', () => {
    expect(parseLooseDate('')).toBeNull();
    expect(parseLooseDate('hello')).toBeNull();
    expect(parseLooseDate('2026-02-30')).toBeNull();
    expect(parseLooseDate('13/13/2026')).toBeNull();
  });
});

describe('detectDayFirst', () => {
  it('spots a day over 12 in the first slot', () => {
    expect(detectDayFirst(['01/02/2026', '15/02/2026'])).toBe(true);
    expect(detectDayFirst(['01/02/2026', '02/15/2026'])).toBe(false);
    expect(detectDayFirst(['01/02/2026'])).toBe(false);
  });
});

describe('date arithmetic', () => {
  it('validates ISO strictly', () => {
    expect(isValidISO('2026-08-26')).toBe(true);
    expect(isValidISO('2026-8-26')).toBe(false);
    expect(isValidISO('2026-02-30')).toBe(false);
  });
  it('computes day differences and offsets', () => {
    expect(daysBetween('2026-08-01', '2026-08-04')).toBe(3);
    expect(daysBetween('2026-08-04', '2026-08-01')).toBe(-3);
    expect(addDays('2026-08-30', 3)).toBe('2026-09-02');
  });
  it('handles month keys', () => {
    expect(monthKey('2026-08-26')).toBe('2026-08');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(endOfMonthISO('2026-02')).toBe('2026-02-28');
  });
  it('labels recent days in words', () => {
    expect(friendlyDay('2026-08-26', now)).toBe('Today');
    expect(friendlyDay('2026-08-25', now)).toBe('Yesterday');
  });
});
