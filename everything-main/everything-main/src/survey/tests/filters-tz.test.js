import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { applyFilters, emptyFilters } from '../src/analysis/filters.js';

describe('date range filter across a clock change', () => {
  let tz;
  beforeAll(() => {
    tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    process.env.TZ = tz;
  });

  it('includes the whole last day when it is 25 hours long', () => {
    // 1 November 2026: clocks go back an hour in New York.
    const late = { key: 'k1', at: new Date(2026, 10, 1, 23, 30).getTime(), cid: 'c', outcome: 'complete', answers: {} };
    const next = { key: 'k2', at: new Date(2026, 10, 2, 0, 15).getTime(), cid: 'c', outcome: 'complete', answers: {} };
    const out = applyFilters([late, next], { ...emptyFilters(), from: '2026-11-01', to: '2026-11-01' });
    expect(out.map((r) => r.key)).toEqual(['k1']);
  });

  it('excludes the next morning when the last day is 23 hours long', () => {
    // 8 March 2026: clocks go forward an hour.
    const after = { key: 'k3', at: new Date(2026, 2, 9, 0, 30).getTime(), cid: 'c', outcome: 'complete', answers: {} };
    expect(applyFilters([after], { ...emptyFilters(), to: '2026-03-08' })).toEqual([]);
  });
});

describe('responses over time where clocks change at midnight', async () => {
  const { responsesOverTime } = await import('../src/analysis/aggregate.js');
  let tz;
  beforeAll(() => {
    tz = process.env.TZ;
    // Santiago moves its clocks at midnight (2026-09-06 has no 00:00).
    process.env.TZ = 'America/Santiago';
  });
  afterAll(() => {
    process.env.TZ = tz;
  });

  it('counts every response, by day and by week', () => {
    const rs = Array.from({ length: 20 }, (_, i) => ({ at: new Date(2026, 8, 1 + i, 12).getTime() }));
    const days = responsesOverTime(rs);
    expect(days.unit).toBe('day');
    expect(days.buckets).toHaveLength(20);
    expect(days.buckets.every((b) => b.count === 1)).toBe(true);
    const many = Array.from({ length: 200 }, (_, i) => ({ at: new Date(2026, 6, 1 + i, 12).getTime() }));
    const weeks = responsesOverTime(many);
    expect(weeks.unit).toBe('week');
    expect(weeks.buckets.reduce((t, b) => t + b.count, 0)).toBe(200);
  });
});
