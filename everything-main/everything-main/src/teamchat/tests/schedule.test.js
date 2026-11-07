/**
 * "Send later" and "remind me" presets: calendar days in the user's zone,
 * across the nights the clocks change.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sendPresets, remindPresets, aroundText } from '../src/lib/schedule.js';

const TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/New_York'; });
afterAll(() => { if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ; });

const local = (ts) => new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

describe('presets on the nights the clocks change', () => {
  it('"tomorrow at 9" is the next calendar day after midnight of a 25-hour day', () => {
    // 2025-11-02: clocks go back at 2:00, the day has 25 hours. Half past midnight.
    const now = Date.parse('2025-11-02T00:30:00-04:00');
    const tomorrow = sendPresets(now).find((p) => p.key === 'tomorrow');
    expect(local(tomorrow.at)).toBe('Mon, Nov 3, 9:00 AM');
    expect(local(remindPresets(now).find((p) => p.key === 'tomorrow').at)).toBe('Mon, Nov 3, 9:00 AM');
    expect(aroundText(tomorrow.at, now, 'en-US')).toBe('around 9:00 AM tomorrow');
  });

  it('"tomorrow at 9" is the next calendar day before midnight of a 23-hour day', () => {
    // 2026-03-08: clocks go forward at 2:00, the day has 23 hours. Half past eleven the night before.
    const now = Date.parse('2026-03-07T23:30:00-05:00');
    const tomorrow = sendPresets(now).find((p) => p.key === 'tomorrow');
    expect(local(tomorrow.at)).toBe('Sun, Mar 8, 9:00 AM');
    expect(aroundText(tomorrow.at, now, 'en-US')).toBe('around 9:00 AM tomorrow');
    expect(local(remindPresets(now).find((p) => p.key === 'week').at)).toBe('Sat, Mar 14, 9:00 AM');
    expect(local(sendPresets(now).find((p) => p.key === 'monday').at)).toBe('Mon, Mar 9, 9:00 AM');
  });

  it('on a Sunday "Monday at 9" is not offered beside "Tomorrow at 9", the same moment', () => {
    const sunday = Date.parse('2026-09-06T10:15:00-04:00');
    expect(sendPresets(sunday).map((p) => p.key)).toEqual(['hour', 'tonight', 'tomorrow']);
    const saturday = Date.parse('2026-09-05T10:15:00-04:00');
    expect(sendPresets(saturday).map((p) => p.key)).toEqual(['hour', 'tonight', 'tomorrow', 'monday']);
    expect(local(sendPresets(saturday).find((p) => p.key === 'monday').at)).toBe('Mon, Sep 7, 9:00 AM');
  });

  it('on an ordinary day the presets read as they always did', () => {
    const now = Date.parse('2026-08-28T10:15:00-04:00'); // a Friday
    const keys = sendPresets(now).map((p) => p.key);
    expect(keys).toEqual(['hour', 'tonight', 'tomorrow', 'monday']);
    expect(local(sendPresets(now).find((p) => p.key === 'monday').at)).toBe('Mon, Aug 31, 9:00 AM');
    expect(aroundText(Date.parse('2026-08-28T18:00:00-04:00'), now, 'en-US')).toBe('around 6:00 PM today');
    expect(aroundText(Date.parse('2026-09-02T09:00:00-04:00'), now, 'en-US')).toBe('around 9:00 AM on Wed, Sep 2');
  });
});
