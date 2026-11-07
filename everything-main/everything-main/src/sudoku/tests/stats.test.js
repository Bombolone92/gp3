import { describe, expect, it } from 'vitest';
import {
  STATS_VERSION,
  STAT_DIFFICULTIES,
  dailyStreakOn,
  emptyStats,
  isPreviousDay,
  mergeStats,
  normalizeStats,
  recordSolved,
  recordStart,
} from '../src/game/stats.js';

describe('emptyStats', () => {
  it('has a record for every difficulty, all at zero', () => {
    const stats = emptyStats();
    expect(Object.keys(stats.byDifficulty)).toEqual(STAT_DIFFICULTIES);
    for (const id of STAT_DIFFICULTIES) {
      expect(stats.byDifficulty[id]).toEqual({
        played: 0,
        solved: 0,
        flawless: 0,
        bestMs: null,
        totalMs: 0,
      });
    }
    expect(stats.daily).toEqual({ current: 0, best: 0, lastDate: null });
    expect(stats.v).toBe(STATS_VERSION);
  });
});

describe('normalizeStats', () => {
  it('returns a clean blob for anything unreadable', () => {
    for (const junk of [null, undefined, 'nope', 42, [], { v: 99 }]) {
      expect(normalizeStats(junk)).toEqual(emptyStats());
    }
  });

  it('keeps good values and discards nonsense ones', () => {
    const stats = normalizeStats({
      v: STATS_VERSION,
      byDifficulty: {
        easy: { played: 5, solved: 3, flawless: 1, bestMs: 60_000, totalMs: 300_000 },
        hard: { played: -2, solved: 'many', bestMs: -1, totalMs: null },
        nonsense: { played: 100 },
      },
      daily: { current: 4, best: 9, lastDate: '2026-08-21' },
      ts: 12,
    });
    expect(stats.byDifficulty.easy.played).toBe(5);
    expect(stats.byDifficulty.easy.bestMs).toBe(60_000);
    expect(stats.byDifficulty.hard).toEqual({
      played: 0,
      solved: 0,
      flawless: 0,
      bestMs: null,
      totalMs: 0,
    });
    expect(stats).not.toHaveProperty('byDifficulty.nonsense');
    expect(stats.daily.lastDate).toBe('2026-08-21');
  });

  it('rejects a non-string date', () => {
    expect(normalizeStats({ v: STATS_VERSION, daily: { lastDate: 20260821 } }).daily.lastDate).toBeNull();
  });
});

describe('recording games', () => {
  it('counts a game begun', () => {
    const stats = recordStart(emptyStats(), 'hard', 100);
    expect(stats.byDifficulty.hard.played).toBe(1);
    expect(stats.ts).toBe(100);
  });

  it('ignores an unknown difficulty rather than inventing a bucket', () => {
    const stats = recordStart(emptyStats(), 'nightmare', 100);
    expect(Object.keys(stats.byDifficulty)).toEqual(STAT_DIFFICULTIES);
  });

  it('records a solve with its time', () => {
    const stats = recordSolved(emptyStats(), { difficulty: 'easy', elapsedMs: 120_000 }, 1);
    expect(stats.byDifficulty.easy.solved).toBe(1);
    expect(stats.byDifficulty.easy.bestMs).toBe(120_000);
    expect(stats.byDifficulty.easy.totalMs).toBe(120_000);
    expect(stats.byDifficulty.easy.flawless).toBe(0);
  });

  it('keeps the fastest time as the best', () => {
    let stats = recordSolved(emptyStats(), { difficulty: 'easy', elapsedMs: 120_000 });
    stats = recordSolved(stats, { difficulty: 'easy', elapsedMs: 90_000 });
    stats = recordSolved(stats, { difficulty: 'easy', elapsedMs: 150_000 });
    expect(stats.byDifficulty.easy.bestMs).toBe(90_000);
    expect(stats.byDifficulty.easy.totalMs).toBe(360_000);
    expect(stats.byDifficulty.easy.solved).toBe(3);
  });

  it('counts a clean solve separately', () => {
    const stats = recordSolved(emptyStats(), {
      difficulty: 'expert',
      elapsedMs: 600_000,
      flawless: true,
    });
    expect(stats.byDifficulty.expert.flawless).toBe(1);
  });

  it('does not lose the record for a difficulty it does not know', () => {
    const before = emptyStats();
    const after = recordSolved(before, { difficulty: 'nightmare', elapsedMs: 1000 });
    expect(after.byDifficulty).toEqual(before.byDifficulty);
  });
});

describe('the daily streak', () => {
  it('starts at one on the first daily solved', () => {
    const stats = recordSolved(emptyStats(), {
      difficulty: 'medium',
      elapsedMs: 1000,
      dailyDate: '2026-08-21',
    });
    expect(stats.daily).toEqual({ current: 1, best: 1, lastDate: '2026-08-21' });
  });

  it('grows over consecutive days', () => {
    let stats = emptyStats();
    for (const date of ['2026-08-19', '2026-08-20', '2026-08-21']) {
      stats = recordSolved(stats, { difficulty: 'medium', elapsedMs: 1000, dailyDate: date });
    }
    expect(stats.daily.current).toBe(3);
    expect(stats.daily.best).toBe(3);
  });

  it('resets after a missed day but remembers the best', () => {
    let stats = emptyStats();
    for (const date of ['2026-08-19', '2026-08-20', '2026-08-21']) {
      stats = recordSolved(stats, { difficulty: 'medium', elapsedMs: 1000, dailyDate: date });
    }
    stats = recordSolved(stats, { difficulty: 'medium', elapsedMs: 1000, dailyDate: '2026-08-24' });
    expect(stats.daily.current).toBe(1);
    expect(stats.daily.best).toBe(3);
  });

  it('does not count the same day twice', () => {
    let stats = recordSolved(emptyStats(), {
      difficulty: 'medium',
      elapsedMs: 1000,
      dailyDate: '2026-08-21',
    });
    stats = recordSolved(stats, { difficulty: 'medium', elapsedMs: 900, dailyDate: '2026-08-21' });
    expect(stats.daily.current).toBe(1);
    // The solve itself still counts, only the streak is left alone.
    expect(stats.byDifficulty.medium.solved).toBe(2);
  });

  it('crosses a month and a year boundary', () => {
    let stats = recordSolved(emptyStats(), {
      difficulty: 'medium',
      elapsedMs: 1,
      dailyDate: '2026-08-31',
    });
    stats = recordSolved(stats, { difficulty: 'medium', elapsedMs: 1, dailyDate: '2026-09-01' });
    expect(stats.daily.current).toBe(2);
    stats = recordSolved(stats, { difficulty: 'medium', elapsedMs: 1, dailyDate: '2026-12-31' });
    stats = recordSolved(stats, { difficulty: 'medium', elapsedMs: 1, dailyDate: '2027-01-01' });
    expect(stats.daily.current).toBe(2);
  });

  it('goes stale once a day has been skipped', () => {
    const stats = recordSolved(emptyStats(), {
      difficulty: 'medium',
      elapsedMs: 1,
      dailyDate: '2026-08-21',
    });
    expect(dailyStreakOn(stats, '2026-08-21')).toBe(1);
    expect(dailyStreakOn(stats, '2026-08-22')).toBe(1); // still alive today
    expect(dailyStreakOn(stats, '2026-08-23')).toBe(0); // yesterday was missed
  });

  it('reports no streak before the first daily', () => {
    expect(dailyStreakOn(emptyStats(), '2026-08-21')).toBe(0);
  });
});

describe('isPreviousDay', () => {
  it('recognises consecutive days', () => {
    expect(isPreviousDay('2026-08-20', '2026-08-21')).toBe(true);
    expect(isPreviousDay('2026-08-31', '2026-09-01')).toBe(true);
    expect(isPreviousDay('2026-02-28', '2026-03-01')).toBe(true); // 2026 is not a leap year
    expect(isPreviousDay('2028-02-28', '2028-02-29')).toBe(true); // 2028 is
  });

  it('rejects gaps, the same day, and reversals', () => {
    expect(isPreviousDay('2026-08-19', '2026-08-21')).toBe(false);
    expect(isPreviousDay('2026-08-21', '2026-08-21')).toBe(false);
    expect(isPreviousDay('2026-08-22', '2026-08-21')).toBe(false);
  });

  it('rejects unparseable dates', () => {
    expect(isPreviousDay('yesterday', '2026-08-21')).toBe(false);
    expect(isPreviousDay('', '')).toBe(false);
  });
});

describe('mergeStats', () => {
  const phone = () => {
    let stats = recordStart(emptyStats(), 'easy', 1);
    stats = recordSolved(stats, { difficulty: 'easy', elapsedMs: 120_000 }, 2);
    return recordSolved(stats, { difficulty: 'medium', elapsedMs: 1, dailyDate: '2026-08-20' }, 3);
  };
  const laptop = () => {
    let stats = recordStart(emptyStats(), 'easy', 10);
    stats = recordStart(stats, 'easy', 11);
    stats = recordSolved(stats, { difficulty: 'easy', elapsedMs: 90_000, flawless: true }, 12);
    return recordSolved(stats, { difficulty: 'medium', elapsedMs: 1, dailyDate: '2026-08-21' }, 13);
  };

  it('takes the better of every field', () => {
    const merged = mergeStats(phone(), laptop());
    expect(merged.byDifficulty.easy.played).toBe(2);
    expect(merged.byDifficulty.easy.bestMs).toBe(90_000);
    expect(merged.byDifficulty.easy.flawless).toBe(1);
  });

  it('is commutative, so it does not matter which device syncs first', () => {
    expect(mergeStats(phone(), laptop())).toEqual(mergeStats(laptop(), phone()));
  });

  it('is idempotent, so repeated syncs do not inflate anything', () => {
    const merged = mergeStats(phone(), laptop());
    expect(mergeStats(merged, merged)).toEqual(merged);
    expect(mergeStats(merged, phone())).toEqual(merged);
  });

  it('takes the streak from whichever device played the daily more recently', () => {
    const merged = mergeStats(phone(), laptop());
    expect(merged.daily.lastDate).toBe('2026-08-21');
    expect(merged.daily.current).toBe(1);
  });

  it('keeps the higher best-ever streak even from the older device', () => {
    let old = emptyStats();
    for (const date of ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04']) {
      old = recordSolved(old, { difficulty: 'medium', elapsedMs: 1, dailyDate: date });
    }
    const recent = recordSolved(emptyStats(), {
      difficulty: 'medium',
      elapsedMs: 1,
      dailyDate: '2026-08-21',
    });
    const merged = mergeStats(old, recent);
    expect(merged.daily.lastDate).toBe('2026-08-21');
    expect(merged.daily.current).toBe(1);
    expect(merged.daily.best).toBe(4);
  });

  it('never loses a personal best to an empty or unreadable other side', () => {
    const mine = phone();
    for (const junk of [null, undefined, {}, { v: 99 }]) {
      expect(mergeStats(mine, junk).byDifficulty.easy.bestMs).toBe(120_000);
    }
  });
});
