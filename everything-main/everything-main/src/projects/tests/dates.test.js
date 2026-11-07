import { describe, it, expect } from 'vitest';
import {
  todayISO, parseISO, isValidISO, addDays, diffDays, dueStatus, isWeekend,
  fmtShort, fmtLong, monthLabel,
} from '../src/lib/dates.js';

describe('ISO date handling', () => {
  it('round-trips through parseISO/todayISO', () => {
    expect(todayISO(parseISO('2026-08-05'))).toBe('2026-08-05');
    expect(todayISO(parseISO('2026-01-01'))).toBe('2026-01-01');
    expect(todayISO(parseISO('2026-12-31'))).toBe('2026-12-31');
  });

  it('validates format and calendar correctness', () => {
    expect(isValidISO('2026-08-05')).toBe(true);
    expect(isValidISO('2026-02-30')).toBe(false); // rolls over → rejected
    expect(isValidISO('2026-13-01')).toBe(false);
    expect(isValidISO('05-08-2026')).toBe(false);
    expect(isValidISO('')).toBe(false);
    expect(isValidISO(null)).toBe(false);
  });
});

describe('addDays / diffDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29'); // leap year
  });

  it('diffDays is signed and inverse of addDays', () => {
    expect(diffDays('2026-08-01', '2026-08-05')).toBe(4);
    expect(diffDays('2026-08-05', '2026-08-01')).toBe(-4);
    expect(diffDays('2026-08-05', addDays('2026-08-05', 90))).toBe(90);
  });

  it('survives DST transitions (US spring forward)', () => {
    // 2026-03-08 is the US DST switch; day math must still be whole days.
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(diffDays('2026-03-07', '2026-03-09')).toBe(2);
  });
});

describe('dueStatus', () => {
  const today = '2026-08-05';

  it('classifies by distance from today', () => {
    expect(dueStatus('2026-08-01', false, today)).toBe('overdue');
    expect(dueStatus('2026-08-05', false, today)).toBe('today');
    expect(dueStatus('2026-08-07', false, today)).toBe('soon');
    expect(dueStatus('2026-08-20', false, today)).toBe('later');
  });

  it('never flags done tasks or missing dates', () => {
    expect(dueStatus('2026-08-01', true, today)).toBeNull();
    expect(dueStatus(null, false, today)).toBeNull();
  });
});

describe('isWeekend', () => {
  it('detects Saturday and Sunday', () => {
    expect(isWeekend('2026-08-08')).toBe(true);  // Saturday
    expect(isWeekend('2026-08-09')).toBe(true);  // Sunday
    expect(isWeekend('2026-08-05')).toBe(false); // Wednesday
  });
});

describe('formatting', () => {
  /* These used to call toLocaleDateString directly and now format through a
     kept Intl formatter, so the guard is that the output is character for
     character what the platform's own shorthand produces — in whatever locale
     the test happens to run in. */
  const local = (y, m, d, opts) => new Date(y, m, d).toLocaleDateString(undefined, opts);

  it('matches the platform shorthand it replaced', () => {
    const now = new Date(2026, 7, 21);
    expect(fmtShort('2026-08-05', now))
      .toBe(local(2026, 7, 5, { month: 'short', day: 'numeric' }));
    // Another year spells the year out.
    expect(fmtShort('2025-12-31', now))
      .toBe(local(2025, 11, 31, { month: 'short', day: 'numeric', year: 'numeric' }));
    expect(fmtLong('2026-08-05')).toBe(local(2026, 7, 5, {
      weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
    }));
    expect(monthLabel('2026-08-05'))
      .toBe(local(2026, 7, 5, { month: 'short', year: 'numeric' }));
  });

  it('is stable across calls, and empty for no date', () => {
    expect(fmtShort('2026-08-05')).toBe(fmtShort('2026-08-05'));
    expect(fmtLong('2026-08-05')).toBe(fmtLong('2026-08-05'));
    expect(fmtShort(null)).toBe('');
    expect(fmtLong(null)).toBe('');
  });
});
