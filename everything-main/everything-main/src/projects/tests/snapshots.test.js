import { describe, it, expect } from 'vitest';
import {
  snapshotName, parseSnapshotName, weekStart, planSnapshotRetention,
  nextSnapshotName, KEEP_DAILY, KEEP_WEEKLY,
} from '../src/lib/snapshots.js';

describe('snapshot names', () => {
  it('round-trips a date, with or without a sequence', () => {
    expect(snapshotName('2026-08-06')).toBe('2026-08-06.json');
    expect(snapshotName('2026-08-06', 2)).toBe('2026-08-06-2.json');
    expect(parseSnapshotName('2026-08-06.json')).toEqual({ date: '2026-08-06', seq: 0 });
    expect(parseSnapshotName('2026-08-06-2.json')).toEqual({ date: '2026-08-06', seq: 2 });
  });

  it('rejects anything that is not one of ours', () => {
    expect(parseSnapshotName('notes.json')).toBeNull();
    expect(parseSnapshotName('2026-13-40.json')).toBeNull();
    expect(parseSnapshotName('2026-08-06.txt')).toBeNull();
    expect(parseSnapshotName(null)).toBeNull();
  });

  it('picks the next free name for a second copy the same day', () => {
    expect(nextSnapshotName([], '2026-08-06')).toBe('2026-08-06.json');
    expect(nextSnapshotName(['2026-08-06.json'], '2026-08-06')).toBe('2026-08-06-1.json');
    expect(nextSnapshotName(['2026-08-06.json', '2026-08-06-1.json'], '2026-08-06'))
      .toBe('2026-08-06-2.json');
  });
});

describe('weekStart', () => {
  it('is the Monday of that week', () => {
    expect(weekStart('2026-08-06')).toBe('2026-08-03'); // Thursday → Monday
    expect(weekStart('2026-08-03')).toBe('2026-08-03');
    expect(weekStart('2026-08-09')).toBe('2026-08-03'); // Sunday belongs back
  });
});

describe('planSnapshotRetention', () => {
  const days = (n, from = '2026-08-06') => {
    const out = [];
    const [y, m, d] = from.split('-').map(Number);
    for (let i = 0; i < n; i++) {
      const date = new Date(y, m - 1, d - i);
      out.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.json`);
    }
    return out;
  };

  it('keeps everything while there is little', () => {
    const { keep, drop } = planSnapshotRetention(days(5));
    expect(keep).toHaveLength(5);
    expect(drop).toEqual([]);
  });

  it('keeps the recent days, then one day a week, and drops the rest', () => {
    const { keep, drop } = planSnapshotRetention(days(60));
    // Seven dailies plus at most four weeklies, and nothing else.
    expect(keep.length).toBeLessThanOrEqual(KEEP_DAILY + KEEP_WEEKLY);
    expect(keep.length).toBeGreaterThanOrEqual(KEEP_DAILY);
    expect(keep.length + drop.length).toBe(60);
    // The newest seven are always kept.
    expect(keep.slice(0, KEEP_DAILY)).toEqual(days(KEEP_DAILY));
  });

  it('keeps every copy from a day it keeps', () => {
    const names = ['2026-08-06.json', '2026-08-06-1.json', '2026-08-05.json'];
    const { keep, drop } = planSnapshotRetention(names);
    expect(keep.sort()).toEqual(names.sort());
    expect(drop).toEqual([]);
  });

  it('ignores files it did not write', () => {
    const { keep, drop } = planSnapshotRetention(['2026-08-06.json', 'stray.txt']);
    expect(keep).toEqual(['2026-08-06.json']);
    expect(drop).toEqual([]);
  });

  it('never keeps more than one day per older week', () => {
    // Two days in each of six older weeks, plus a full recent week.
    const names = [
      ...days(KEEP_DAILY),
      '2026-07-28.json', '2026-07-27.json', // week of Jul 27
      '2026-07-21.json', '2026-07-20.json', // week of Jul 20
    ];
    const { keep } = planSnapshotRetention(names);
    expect(keep).toContain('2026-07-28.json');
    expect(keep).not.toContain('2026-07-27.json');
    expect(keep).toContain('2026-07-21.json');
    expect(keep).not.toContain('2026-07-20.json');
  });
});
