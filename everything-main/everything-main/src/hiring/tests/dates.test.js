import { describe, it, expect } from 'vitest';
import { addDays, daysBetween, daysSince, formatDate, formatDateLong, formatDateTime, formatTimestamp, parseISODate, relativeDays, toMinutes, todayISO } from '../src/lib/dates.js';

describe('formatTimestamp', () => {
  it('formats the local calendar day of a timestamp', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      // 03:30 UTC on Mar 21 is still Mar 20 in Los Angeles.
      expect(formatTimestamp('2026-03-21T03:30:00.000Z', new Date('2026-03-21T03:31:00.000Z'))).toBe('Mar 20');
      expect(formatTimestamp('2025-03-21T03:30:00.000Z', new Date('2026-03-21T03:31:00.000Z'))).toBe('Mar 20, 2025');
    } finally {
      process.env.TZ = tz;
    }
  });

  it('is empty for missing or malformed input', () => {
    expect(formatTimestamp(null)).toBe('');
    expect(formatTimestamp('')).toBe('');
    expect(formatTimestamp('not-a-date')).toBe('');
  });
});

describe('formatDateTime', () => {
  it('separates two timestamps that share a day', () => {
    // The snapshot list is the case: several copies can land on one date,
    // and the row is how a user picks which one to restore.
    const morning = formatDateTime('2026-03-21T09:30:00.000Z');
    const evening = formatDateTime('2026-03-21T21:45:00.000Z');
    expect(morning).not.toBe('');
    expect(morning).not.toBe(evening);
    // Both name the same day; only the clock time differs.
    expect(morning.split(',')[0]).toBe(evening.split(',')[0]);
  });

  it('is empty for missing or malformed input', () => {
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime('')).toBe('');
    expect(formatDateTime('not-a-date')).toBe('');
  });
});

describe('formatDate / formatDateLong', () => {
  it('renders malformed or empty dates as blank instead of throwing', () => {
    // A restored backup is only structurally validated; a bad date must
    // not take a whole view down at render time or print year 1900.
    expect(formatDateLong('')).toBe('');
    expect(formatDateLong(null)).toBe('');
    expect(formatDateLong('TBD')).toBe('');
    expect(formatDate('bogus')).toBe('');
    // Valid dates still render (exact text is locale/zone dependent).
    expect(formatDateLong('2026-03-10')).not.toBe('');
    expect(formatDate('2026-03-10')).not.toBe('');
  });
});

describe('toMinutes', () => {
  it('parses HH:MM into minutes since midnight', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('09:30')).toBe(570);
    expect(toMinutes('23:59')).toBe(1439);
  });

  it('is null for malformed or out-of-range values', () => {
    expect(toMinutes('24:00')).toBeNull();
    expect(toMinutes('9am')).toBeNull();
    expect(toMinutes('')).toBeNull();
    expect(toMinutes(null)).toBeNull();
    // Out-of-range minutes must not carry into the hour ('9:75' ≠ 10:15).
    expect(toMinutes('9:75')).toBeNull();
    expect(toMinutes('0:99')).toBeNull();
  });
});

describe('date arithmetic', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
    expect(addDays('2026-12-30', 5)).toBe('2027-01-04');
    expect(addDays('2026-03-10', -10)).toBe('2026-02-28');
  });

  it('measures whole days between dates, signed', () => {
    expect(daysBetween('2026-03-10', '2026-03-15')).toBe(5);
    expect(daysBetween('2026-03-15', '2026-03-10')).toBe(-5);
    expect(daysBetween('2026-03-10', '2026-03-10')).toBe(0);
  });

  it('parses ISO dates as local dates', () => {
    const d = parseISODate('2026-03-10');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(10);
  });

  it('daysSince counts calendar days and never goes negative', () => {
    const now = new Date('2026-03-20T12:00:00');
    expect(daysSince('2026-03-18', now)).toBe(2);
    expect(daysSince('2026-03-25', now)).toBe(0);
    expect(daysSince('garbage', now)).toBe(0);
  });

  it('daysSince stays on the same calendar day across a DST fall-back', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      // Nov 1 2026 is 25 hours long in Los Angeles: 00:30 and 23:30 are
      // more than 24h apart but the same local day.
      const created = new Date(2026, 10, 1, 0, 30);
      const evening = new Date(2026, 10, 1, 23, 30);
      expect(daysSince(created.toISOString(), evening)).toBe(0);
      expect(daysSince('2026-11-01', evening)).toBe(0);
    } finally {
      process.env.TZ = tz;
    }
  });

  it('todayISO reflects the provided clock', () => {
    expect(todayISO(new Date(2026, 2, 5, 23, 30))).toBe('2026-03-05');
  });

  it('relativeDays scales from days to months to years', () => {
    const now = new Date(2026, 7, 21, 12, 0);
    const ago = (days) => relativeDays(addDays(todayISO(now), -days), now);
    expect(ago(0)).toBe('today');
    expect(ago(1)).toBe('yesterday');
    expect(ago(5)).toBe('5d ago');
    expect(ago(29)).toBe('29d ago');
    expect(ago(30)).toBe('1mo ago');
    expect(ago(364)).toBe('12mo ago');
    // Past a year the reader should not have to divide by twelve.
    expect(ago(365)).toBe('1y ago');
    expect(ago(400)).toBe('1y ago');
    expect(ago(730)).toBe('2y ago');
  });
});
