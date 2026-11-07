import { describe, it, expect } from 'vitest';
import {
  normalizeRecurrence, describeRecurrence, shiftByRule, nextOccurrenceDates, isRecurring,
} from '../src/lib/recurrence.js';
import { addMonths } from '../src/lib/dates.js';

describe('normalizeRecurrence', () => {
  it('keeps sane rules and repairs the rest', () => {
    expect(normalizeRecurrence({ freq: 'weekly', interval: 2 })).toEqual({ freq: 'weekly', interval: 2 });
    expect(normalizeRecurrence({ freq: 'daily' })).toEqual({ freq: 'daily', interval: 1 });
    expect(normalizeRecurrence({ freq: 'daily', interval: 0 })).toEqual({ freq: 'daily', interval: 1 });
    expect(normalizeRecurrence({ freq: 'daily', interval: 999 })).toEqual({ freq: 'daily', interval: 30 });
    expect(normalizeRecurrence({ freq: 'daily', interval: 2.6 })).toEqual({ freq: 'daily', interval: 3 });
  });

  it('rejects anything that is not a known frequency', () => {
    for (const bad of [null, undefined, {}, { freq: 'yearly' }, 'weekly', 5]) {
      expect(normalizeRecurrence(bad)).toBeNull();
    }
  });
});

describe('describeRecurrence', () => {
  it('reads naturally at any interval', () => {
    expect(describeRecurrence({ freq: 'daily', interval: 1 })).toBe('Every day');
    expect(describeRecurrence({ freq: 'weekly', interval: 1 })).toBe('Every week');
    expect(describeRecurrence({ freq: 'monthly', interval: 3 })).toBe('Every 3 months');
    expect(describeRecurrence(null)).toBe('');
  });
});

describe('addMonths', () => {
  it('clamps to the end of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29'); // leap year
  });

  it('crosses years in both directions', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });
});

describe('shiftByRule', () => {
  it('moves by days, weeks, and months', () => {
    expect(shiftByRule('2026-08-06', { freq: 'daily', interval: 3 })).toBe('2026-08-09');
    expect(shiftByRule('2026-08-06', { freq: 'weekly', interval: 1 })).toBe('2026-08-13');
    expect(shiftByRule('2026-08-06', { freq: 'weekly', interval: 2 })).toBe('2026-08-20');
    expect(shiftByRule('2026-08-06', { freq: 'monthly', interval: 1 })).toBe('2026-09-06');
  });

  it('multiplies for repeated intervals', () => {
    expect(shiftByRule('2026-08-06', { freq: 'weekly', interval: 1 }, 3)).toBe('2026-08-27');
  });

  it('passes through when the rule or date is unusable', () => {
    expect(shiftByRule('2026-08-06', null)).toBe('2026-08-06');
    expect(shiftByRule('nonsense', { freq: 'daily', interval: 1 })).toBe('nonsense');
  });
});

describe('nextOccurrenceDates', () => {
  const weekly = { freq: 'weekly', interval: 1 };

  it('moves the due date on by one interval', () => {
    const dates = nextOccurrenceDates({ dueDate: '2026-08-06' }, weekly, '2026-08-06');
    expect(dates).toEqual({ startDate: null, dueDate: '2026-08-13' });
  });

  it('keeps the start-to-due gap', () => {
    const dates = nextOccurrenceDates(
      { startDate: '2026-08-04', dueDate: '2026-08-06' }, weekly, '2026-08-06',
    );
    expect(dates).toEqual({ startDate: '2026-08-11', dueDate: '2026-08-13' });
  });

  it('skips ahead when the task is completed long after it was due', () => {
    // Due in May, done in August: the next one is upcoming, not stale.
    const dates = nextOccurrenceDates({ dueDate: '2026-05-01' }, weekly, '2026-08-06');
    expect(dates.dueDate).toBe('2026-08-07');
  });

  it('lands on today when today is exactly an interval away', () => {
    const dates = nextOccurrenceDates({ dueDate: '2026-07-30' }, weekly, '2026-08-06');
    expect(dates.dueDate).toBe('2026-08-06');
  });

  it('walks monthly rules with clamping', () => {
    const dates = nextOccurrenceDates(
      { dueDate: '2026-01-31' }, { freq: 'monthly', interval: 1 }, '2026-03-15',
    );
    expect(dates.dueDate).toBe('2026-03-31');
  });

  it('anchors on the start date when there is no due date', () => {
    const dates = nextOccurrenceDates({ startDate: '2026-08-06' }, weekly, '2026-08-06');
    expect(dates).toEqual({ startDate: '2026-08-13', dueDate: null });
  });

  it('leaves an undated chore undated', () => {
    expect(nextOccurrenceDates({}, weekly, '2026-08-06')).toEqual({ startDate: null, dueDate: null });
  });
});

describe('isRecurring', () => {
  it('is true only for the live carrier of a series', () => {
    expect(isRecurring({ recurrence: { freq: 'daily', interval: 1 } })).toBe(true);
    expect(isRecurring({ recurrence: { freq: 'daily', interval: 1 }, recurrenceClosed: true })).toBe(false);
    expect(isRecurring({ recurrence: null })).toBe(false);
    expect(isRecurring(undefined)).toBe(false);
  });
});
