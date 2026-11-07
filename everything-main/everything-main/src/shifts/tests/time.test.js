import { describe, it, expect } from 'vitest';
import {
  addDays,
  dayOfWeek,
  daysInMonth,
  durationMinutes,
  formatHours,
  formatTime,
  formatTimeRange,
  isOvernight,
  isValidDate,
  isValidTime,
  isoDate,
  parseISO,
  rangesOverlap,
  relativeDayLabel,
  startOfWeek,
  toHHMM,
  toMinutes,
  weekDates,
} from '../src/lib/time.js';

describe('time parsing and validation', () => {
  it('converts HH:MM to minutes', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('09:30')).toBe(570);
    expect(toMinutes('23:59')).toBe(1439);
  });

  it('rejects malformed times', () => {
    for (const bad of ['24:00', '9:30', '12:60', '', null, undefined, '12:3', 'noon']) {
      expect(toMinutes(bad)).toBeNull();
      expect(isValidTime(bad)).toBe(false);
    }
  });

  it('round-trips minutes to HH:MM', () => {
    expect(toHHMM(570)).toBe('09:30');
    expect(toHHMM(0)).toBe('00:00');
    expect(toHHMM(1439)).toBe('23:59');
  });

  it('validates ISO dates including impossible calendar dates', () => {
    expect(isValidDate('2026-08-04')).toBe(true);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('08/04/2026')).toBe(false);
  });
});

describe('durations and overlap', () => {
  it('computes same-day durations', () => {
    expect(durationMinutes('09:00', '17:00')).toBe(480);
    expect(durationMinutes('09:00', '09:30')).toBe(30);
  });

  it('wraps past midnight when the end is earlier than the start', () => {
    expect(durationMinutes('22:00', '06:00')).toBe(480);
    expect(durationMinutes('23:30', '00:15')).toBe(45);
  });

  it('rejects zero-length ranges and invalid times', () => {
    expect(durationMinutes('09:00', '09:00')).toBeNull();
    expect(durationMinutes('bad', '09:00')).toBeNull();
  });

  it('identifies overnight ranges', () => {
    expect(isOvernight('22:00', '06:00')).toBe(true);
    expect(isOvernight('09:00', '17:00')).toBe(false);
    expect(isOvernight('09:00', '09:00')).toBe(false);
  });

  it('detects range overlap, treating touching ranges as non-overlapping', () => {
    expect(rangesOverlap(540, 1020, 600, 660)).toBe(true);
    expect(rangesOverlap(540, 600, 600, 660)).toBe(false);
    expect(rangesOverlap(600, 660, 540, 600)).toBe(false);
  });
});

describe('calendar math', () => {
  it('round-trips ISO dates in local time', () => {
    expect(isoDate(parseISO('2026-08-04'))).toBe('2026-08-04');
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('finds the Monday of any week', () => {
    expect(startOfWeek('2026-08-04')).toBe('2026-08-03'); // Tuesday -> Monday
    expect(startOfWeek('2026-08-03')).toBe('2026-08-03'); // Monday stays
    expect(startOfWeek('2026-08-09')).toBe('2026-08-03'); // Sunday belongs to prior Monday
  });

  it('produces a full week of dates', () => {
    const dates = weekDates('2026-08-03');
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe('2026-08-03');
    expect(dates[6]).toBe('2026-08-09');
    expect(dayOfWeek(dates[0])).toBe(1);
    expect(dayOfWeek(dates[6])).toBe(0);
  });
});

describe('formatting', () => {
  it('formats 12-hour times', () => {
    expect(formatTime('00:00')).toBe('12 AM');
    expect(formatTime('09:30')).toBe('9:30 AM');
    expect(formatTime('12:00')).toBe('12 PM');
    expect(formatTime('17:05')).toBe('5:05 PM');
  });

  it('labels days relative to a reference date', () => {
    expect(relativeDayLabel('2026-08-04', '2026-08-04')).toBe('Today');
    expect(relativeDayLabel('2026-08-05', '2026-08-04')).toBe('Tomorrow');
    expect(relativeDayLabel('2026-08-03', '2026-08-04')).toBe('Yesterday');
    expect(relativeDayLabel('2026-08-10', '2026-08-04')).toBe('Mon, Aug 10');
  });

  it('formats durations as hours', () => {
    expect(formatHours(480)).toBe('8h');
    expect(formatHours(90)).toBe('1.5h');
    expect(formatHours(0)).toBe('0h');
  });

  it('marks overnight ranges with +1', () => {
    expect(formatTimeRange('09:00', '17:00')).toBe('9 AM – 5 PM');
    expect(formatTimeRange('22:00', '06:00')).toBe('10 PM – 6 AM +1');
  });

  it('counts the days a month holds, from any day in it', () => {
    expect(daysInMonth('2026-08-15')).toBe(31);
    expect(daysInMonth('2026-02-01')).toBe(28);
    expect(daysInMonth('2028-02-29')).toBe(29);
    expect(daysInMonth('2026-04-30')).toBe(30);
    // Four weeks exactly in February, four and a bit in a 31-day month:
    // what a weekly target is scaled by on the employee page.
    expect(daysInMonth('2026-02-10') / 7).toBe(4);
    expect(Math.round((daysInMonth('2026-08-10') / 7) * 100) / 100).toBe(4.43);
  });
});
