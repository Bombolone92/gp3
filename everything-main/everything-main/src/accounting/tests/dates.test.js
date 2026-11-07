import { describe, it, expect, beforeEach } from 'vitest';
import { addMonths, periodRange, parseDateInput, dateShortcut, fiscalYearStart, monthBuckets, startOfWeek, dayNum, fromDayNum, setDateStyle, formatRange, isISODate } from '../src/lib/dates.js';

beforeEach(() => setDateStyle('mdy'));

describe('dates', () => {
  it('clamps month arithmetic to the end of the month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });
  it('round-trips day numbers', () => {
    for (const d of ['1970-01-01', '2000-02-29', '2026-10-11']) expect(fromDayNum(dayNum(d))).toBe(d);
  });
  it('knows weeks start on Sunday', () => {
    expect(startOfWeek('2026-10-11')).toBe('2026-10-11');
    expect(startOfWeek('2026-10-14')).toBe('2026-10-11');
  });
  it('computes named periods', () => {
    const now = '2026-10-11';
    expect(periodRange('lastMonth', { now })).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodRange('thisQuarter', { now })).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(periodRange('lastQuarter', { now })).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(periodRange('thisFiscalYearToDate', { now, fiscalStartMonth: 4 })).toEqual({ from: '2026-04-01', to: now });
    expect(periodRange('lastFiscalYear', { now, fiscalStartMonth: 4 })).toEqual({ from: '2025-04-01', to: '2026-03-31' });
  });
  it('finds the fiscal year start', () => {
    expect(fiscalYearStart('2026-02-10', 4)).toBe('2025-04-01');
    expect(fiscalYearStart('2026-04-01', 4)).toBe('2026-04-01');
  });
  it('parses typed dates in the company style', () => {
    expect(parseDateInput('10/11/2026')).toBe('2026-10-11');
    expect(parseDateInput('10/11/26')).toBe('2026-10-11');
    expect(parseDateInput('2/30/2026')).toBe(null);
    expect(parseDateInput('3/4', '2026-01-01')).toBe('2026-03-04');
    setDateStyle('dmy');
    expect(parseDateInput('11/10/2026')).toBe('2026-10-11');
  });
  it('supports single-key date shortcuts', () => {
    expect(dateShortcut('2026-10-11', '+')).toBe('2026-10-12');
    expect(dateShortcut('2026-10-11', '-')).toBe('2026-10-10');
    expect(dateShortcut('2026-10-11', 'm')).toBe('2026-10-01');
    expect(dateShortcut('2026-10-11', 'h')).toBe('2026-10-31');
    expect(dateShortcut('2026-10-11', 't', '2027-01-01')).toBe('2027-01-01');
    expect(dateShortcut('2026-10-11', 'q')).toBe(null);
  });
  it('builds month buckets clipped to the range', () => {
    const b = monthBuckets('2026-01-15', '2026-03-10');
    expect(b.map((x) => [x.from, x.to])).toEqual([['2026-01-15', '2026-01-31'], ['2026-02-01', '2026-02-28'], ['2026-03-01', '2026-03-10']]);
  });
  it('formats ranges', () => {
    expect(formatRange('2026-10-01', '2026-10-11')).toBe('October 1 to 11, 2026');
    expect(isISODate('2026-13-01')).toBe(false);
  });
});
