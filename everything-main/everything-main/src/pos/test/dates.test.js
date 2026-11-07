import { describe, it, expect } from 'vitest';
import { monthKeyOf, monthKeysInRange, datesInRange, todayISO } from '../src/lib/dates.js';

describe('monthKeyOf', () => {
  it('extracts the YYYY-MM prefix', () => {
    expect(monthKeyOf('2026-08-04')).toBe('2026-08');
  });
});

describe('monthKeysInRange', () => {
  it('covers a single month', () => {
    expect(monthKeysInRange('2026-08-01', '2026-08-31')).toEqual(['2026-08']);
  });

  it('spans a year boundary', () => {
    expect(monthKeysInRange('2025-11-15', '2026-02-03'))
      .toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('datesInRange', () => {
  it('is inclusive on both ends', () => {
    expect(datesInRange('2026-08-01', '2026-08-03'))
      .toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
  });

  it('crosses month boundaries', () => {
    const days = datesInRange('2026-01-30', '2026-02-02');
    expect(days).toEqual(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
  });

  it('handles a leap February', () => {
    expect(datesInRange('2028-02-28', '2028-03-01'))
      .toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });
});

describe('todayISO', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayISO(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
