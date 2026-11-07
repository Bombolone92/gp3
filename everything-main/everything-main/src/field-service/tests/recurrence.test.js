import { describe, it, expect } from 'vitest';
import { generateVisitDates, describeSchedule } from '../src/core/recurrence.js';

describe('recurrence', () => {
  it('returns the start for a one-off job', () => {
    expect(generateVisitDates({ start: '2026-10-12', repeat: 'none' })).toEqual(['2026-10-12']);
  });

  it('repeats weekly on several weekdays', () => {
    const dates = generateVisitDates({
      start: '2026-10-12', // Monday
      repeat: 'weekly',
      weekdays: [1, 4],
      end: { type: 'count', count: 5 },
    });
    expect(dates).toEqual(['2026-10-12', '2026-10-15', '2026-10-19', '2026-10-22', '2026-10-26']);
  });

  it('skips weekdays before the start in the first week', () => {
    const dates = generateVisitDates({ start: '2026-10-14', repeat: 'weekly', weekdays: [1, 3], end: { type: 'count', count: 3 } });
    expect(dates).toEqual(['2026-10-14', '2026-10-19', '2026-10-21']);
  });

  it('repeats every two weeks until a date', () => {
    const dates = generateVisitDates({ start: '2026-10-12', repeat: 'weekly', interval: 2, end: { type: 'until', date: '2026-11-30' } });
    expect(dates).toEqual(['2026-10-12', '2026-10-26', '2026-11-09', '2026-11-23']);
  });

  it('repeats monthly by day of month, clamped to short months', () => {
    const dates = generateVisitDates({ start: '2026-01-31', repeat: 'monthly', end: { type: 'count', count: 3 } });
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('repeats monthly by weekday occurrence', () => {
    // 2026-10-13 is the second Tuesday of October.
    const dates = generateVisitDates({ start: '2026-10-13', repeat: 'monthly', monthlyBy: 'weekday', end: { type: 'count', count: 3 } });
    expect(dates).toEqual(['2026-10-13', '2026-11-10', '2026-12-08']);
  });

  it('caps runaway schedules', () => {
    const dates = generateVisitDates({ start: '2026-01-01', repeat: 'daily', end: { type: 'until', date: '2030-01-01' } });
    expect(dates.length).toBe(400);
  });

  it('describes schedules in plain words', () => {
    expect(describeSchedule({ start: '2026-10-12', repeat: 'weekly', interval: 2, weekdays: [4, 1] })).toBe('Every 2 weeks on Monday, Thursday');
    expect(describeSchedule({ start: '2026-10-13', repeat: 'monthly', monthlyBy: 'weekday' })).toBe('Every month on the second Tuesday');
    expect(describeSchedule({ repeat: 'none' })).toBe('One-off');
    const weekly = { start: '2026-10-12', repeat: 'weekly', weekdays: [1, 4], end: { type: 'count', count: 8 } };
    expect(describeSchedule(weekly)).toBe('Every week on Monday, Thursday, 8 visits');
    expect(describeSchedule(weekly, { end: false })).toBe('Every week on Monday, Thursday');
  });
});
