import { describe, it, expect } from 'vitest';
import { addDays, addMonths, diffDays, startOfWeek, endOfMonth, timeToMinutes, minutesToTime, relativeDay } from '../src/core/dates.js';

describe('dates', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('clamps month arithmetic to the last day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('measures whole days, including across DST changes', () => {
    expect(diffDays('2026-03-01', '2026-03-31')).toBe(30);
    expect(diffDays('2026-11-10', '2026-11-01')).toBe(-9);
  });

  it('finds the start of the week for either week start', () => {
    expect(startOfWeek('2026-10-14', 0)).toBe('2026-10-11');
    expect(startOfWeek('2026-10-14', 1)).toBe('2026-10-12');
    expect(startOfWeek('2026-10-11', 1)).toBe('2026-10-05');
  });

  it('handles month ends and times', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(timeToMinutes('09:30')).toBe(570);
    expect(minutesToTime(570)).toBe('09:30');
    expect(minutesToTime(2000)).toBe('23:59');
  });

  it('describes nearby days', () => {
    expect(relativeDay('2026-10-12', '2026-10-12')).toBe('Today');
    expect(relativeDay('2026-10-13', '2026-10-12')).toBe('Tomorrow');
    expect(relativeDay('2026-10-09', '2026-10-12')).toBe('3 days ago');
  });
});
