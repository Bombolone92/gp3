import { describe, it, expect, afterEach } from 'vitest';
import { localDate, formatDate } from '../src/core/dates.js';

const tz = process.env.TZ;
afterEach(() => {
  process.env.TZ = tz;
});

describe('timestamps as dates', () => {
  it("shows a timestamp on the device's own date", () => {
    process.env.TZ = 'America/Los_Angeles';
    // 9:30 PM on Oct 12 in California is already Oct 13 in UTC.
    expect(localDate('2026-10-13T04:30:00.000Z')).toBe('2026-10-12');
    expect(formatDate('2026-10-13T04:30:00.000Z', { month: 'short', day: 'numeric' })).toMatch(/12/);
    process.env.TZ = 'Asia/Tokyo';
    expect(localDate('2026-10-12T20:00:00.000Z')).toBe('2026-10-13');
  });

  it('reads a date picked for a log entry as that date in every time zone', () => {
    for (const zone of ['Pacific/Auckland', 'Pacific/Kiritimati', 'America/Los_Angeles', 'Pacific/Pago_Pago']) {
      process.env.TZ = zone;
      expect(localDate('2026-10-05T12:00:00.000Z'), zone).toBe('2026-10-05');
    }
  });

  it('leaves plain dates alone', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(localDate('2026-10-12')).toBe('2026-10-12');
    expect(localDate('')).toBe('');
    expect(formatDate('2026-10-12', { month: 'short', day: 'numeric' })).toMatch(/12/);
  });
});
