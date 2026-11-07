import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { timeAgo, formatDate } from '../src/core/dates.js';

// Dates shown to people are in their own time zone, not UTC.
describe('dates in a time zone behind UTC', () => {
  const tz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/Los_Angeles';
  });
  afterAll(() => {
    process.env.TZ = tz;
  });

  it('shows the local day for an old timestamp', () => {
    // 8 PM on July 31 in California is already August 1 in UTC.
    const when = '2026-08-01T03:00:00.000Z';
    expect(new Date(when).getDate()).toBe(31);
    expect(timeAgo(when, Date.parse('2026-10-12T12:00:00Z'))).toBe(formatDate('2026-07-31'));
  });
});
