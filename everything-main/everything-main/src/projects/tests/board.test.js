import { describe, it, expect } from 'vitest';
import {
  ORDER_GAP, columnTasks, orderForAppend, computeMove, realDropIndex,
  milestoneProgress, taskSpan, timelineRange, clampToRange,
  projectProgress, doneColumnIds, shiftTaskDates, clampSpanDelta,
  TIMELINE_MAX_PAST, TIMELINE_MAX_FUTURE,
} from '../src/lib/board.js';

const t = (id, columnId, order, extra = {}) => ({ id, columnId, order, ...extra });

describe('columnTasks', () => {
  it('returns only the column, sorted by order', () => {
    const tasks = [t('a', 'c1', 30), t('b', 'c2', 10), t('c', 'c1', 10), t('d', 'c1', 20)];
    expect(columnTasks(tasks, 'c1').map((x) => x.id)).toEqual(['c', 'd', 'a']);
  });

  it('breaks order ties deterministically by id', () => {
    const tasks = [t('b', 'c1', 10), t('a', 'c1', 10)];
    expect(columnTasks(tasks, 'c1').map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('orderForAppend', () => {
  it('starts at the gap for an empty column', () => {
    expect(orderForAppend([], 'c1')).toBe(ORDER_GAP);
  });

  it('appends one gap after the last task', () => {
    const tasks = [t('a', 'c1', 500), t('b', 'c1', 2000)];
    expect(orderForAppend(tasks, 'c1')).toBe(2000 + ORDER_GAP);
  });
});

describe('computeMove', () => {
  const tasks = [
    t('a', 'c1', 1000), t('b', 'c1', 2000), t('c', 'c1', 3000),
    t('x', 'c2', 1000),
  ];

  it('moves to the top of a column', () => {
    const { order, renormalize } = computeMove(tasks, 'c', 'c1', 0);
    expect(order).toBeLessThan(1000);
    expect(renormalize).toBeNull();
  });

  it('moves between two neighbours at their midpoint', () => {
    const { order } = computeMove(tasks, 'a', 'c1', 1);
    // Destination without 'a' is [b, c]; index 1 is between them.
    expect(order).toBe((2000 + 3000) / 2);
  });

  it('moves to the end of another column', () => {
    const { order } = computeMove(tasks, 'a', 'c2', 5);
    expect(order).toBe(1000 + ORDER_GAP);
  });

  it('drops into an empty column', () => {
    const { order, renormalize } = computeMove(tasks, 'a', 'c3', 0);
    expect(order).toBe(ORDER_GAP);
    expect(renormalize).toBeNull();
  });

  it('is stable when the same index is requested repeatedly', () => {
    // Simulate many drops between the same two cards: orders converge but
    // must renormalize before precision runs out, never produce collisions.
    let list = [t('a', 'c1', 1), t('b', 'c1', 2), t('m', 'c1', 100)];
    for (let i = 0; i < 60; i++) {
      const { order, renormalize } = computeMove(list, 'm', 'c1', 1);
      if (renormalize) {
        const map = new Map(renormalize.map((r) => [r.id, r.order]));
        list = list.map((x) => (map.has(x.id) ? { ...x, order: map.get(x.id) } : x));
      } else {
        list = list.map((x) => (x.id === 'm' ? { ...x, order } : x));
      }
      const inCol = columnTasks(list, 'c1');
      expect(inCol.map((x) => x.id)).toEqual(['a', 'm', 'b']);
      const orders = inCol.map((x) => x.order);
      expect(new Set(orders).size).toBe(orders.length);
    }
  });

  it('clamps an out-of-range index to the end', () => {
    const { order } = computeMove(tasks, 'x', 'c1', 99);
    expect(order).toBe(3000 + ORDER_GAP);
  });
});

describe('realDropIndex', () => {
  const full = [t('a', 'c1', 1000), t('b', 'c1', 2000), t('c', 'c1', 3000), t('d', 'c1', 4000)];
  const ids = full.map((x) => x.id);

  it('is a pass-through when nothing is filtered out', () => {
    expect(realDropIndex(full, ids, 0)).toBe(0);
    expect(realDropIndex(full, ids, 2)).toBe(2);
    expect(realDropIndex(full, ids, 9)).toBe(4);
  });

  it('drops before the visible card the pointer was above', () => {
    // Only b and d are visible: dropping above d means "before d" (index 3).
    expect(realDropIndex(full, ['b', 'd'], 1)).toBe(3);
  });

  it('drops above the first visible card, leaving hidden cards above it', () => {
    expect(realDropIndex(full, ['c'], 0)).toBe(2);
  });

  it('drops right after the last visible card, not after trailing hidden ones', () => {
    expect(realDropIndex(full, ['a', 'b'], 2)).toBe(2);
  });

  it('appends when the column shows nothing', () => {
    expect(realDropIndex(full, [], 0)).toBe(4);
  });

  it('skips ids that are no longer in the column', () => {
    // 'gone' is dropped, so index 1 is past the only card it can place
    // against and the task lands right after c.
    expect(realDropIndex(full, ['gone', 'c'], 1)).toBe(3);
  });
});

describe('taskSpan', () => {
  it('is null without dates', () => {
    expect(taskSpan({ startDate: null, dueDate: null })).toBeNull();
  });

  it('collapses a single date to a one-day span', () => {
    expect(taskSpan({ startDate: null, dueDate: '2026-08-05' }))
      .toEqual({ start: '2026-08-05', end: '2026-08-05' });
    expect(taskSpan({ startDate: '2026-08-05', dueDate: null }))
      .toEqual({ start: '2026-08-05', end: '2026-08-05' });
  });

  it('swaps an inverted range instead of dropping it', () => {
    expect(taskSpan({ startDate: '2026-08-10', dueDate: '2026-08-05' }))
      .toEqual({ start: '2026-08-05', end: '2026-08-10' });
  });
});

describe('shiftTaskDates', () => {
  const both = { startDate: '2026-08-10', dueDate: '2026-08-14' };

  it('moves every date the task has', () => {
    expect(shiftTaskDates(both, 'move', 3))
      .toEqual({ startDate: '2026-08-13', dueDate: '2026-08-17' });
    expect(shiftTaskDates({ startDate: null, dueDate: '2026-08-14' }, 'move', -2))
      .toEqual({ dueDate: '2026-08-12' });
    expect(shiftTaskDates({ startDate: '2026-08-10', dueDate: null }, 'move', 1))
      .toEqual({ startDate: '2026-08-11' });
  });

  it('is a no-op without a delta, dates, or a real change', () => {
    expect(shiftTaskDates(both, 'move', 0)).toBeNull();
    expect(shiftTaskDates({ startDate: null, dueDate: null }, 'move', 3)).toBeNull();
  });

  it('moves one edge without touching the other', () => {
    expect(shiftTaskDates(both, 'start', -2)).toEqual({ startDate: '2026-08-08' });
    expect(shiftTaskDates(both, 'end', 2)).toEqual({ dueDate: '2026-08-16' });
  });

  it('never lets an edge cross the other one', () => {
    expect(shiftTaskDates(both, 'start', 40)).toEqual({ startDate: '2026-08-14' });
    expect(shiftTaskDates(both, 'end', -40)).toEqual({ dueDate: '2026-08-10' });
  });

  it('gives a single-dated task the counterpart the gesture drew', () => {
    // A due-only task already anchors its right edge: stretching left only
    // needs the start date.
    expect(shiftTaskDates({ startDate: null, dueDate: '2026-08-14' }, 'start', -3))
      .toEqual({ startDate: '2026-08-11' });
    expect(shiftTaskDates({ startDate: '2026-08-10', dueDate: null }, 'end', 4))
      .toEqual({ dueDate: '2026-08-14' });
    // A start-only task has no left anchor of its own, so dragging its left
    // edge must keep the day it sat on as the due date — otherwise the bar
    // would snap back to a single day somewhere else.
    expect(shiftTaskDates({ startDate: '2026-08-10', dueDate: null }, 'start', -2))
      .toEqual({ startDate: '2026-08-08', dueDate: '2026-08-10' });
    expect(shiftTaskDates({ startDate: null, dueDate: '2026-08-14' }, 'end', 4))
      .toEqual({ startDate: '2026-08-14', dueDate: '2026-08-18' });
  });

  it('keeps the far edge of an inverted range where the bar drew it', () => {
    // Drawn as Aug 10 → Aug 20 (the pair is swapped for display).
    const inverted = { startDate: '2026-08-20', dueDate: '2026-08-10' };
    expect(shiftTaskDates(inverted, 'start', 1))
      .toEqual({ startDate: '2026-08-11', dueDate: '2026-08-20' });
    expect(shiftTaskDates(inverted, 'end', 2))
      .toEqual({ startDate: '2026-08-10', dueDate: '2026-08-22' });
  });
});

describe('clampSpanDelta', () => {
  const both = { startDate: '2026-08-10', dueDate: '2026-08-14' };

  it('leaves a whole-bar move alone', () => {
    expect(clampSpanDelta(both, 'move', -99)).toBe(-99);
  });

  it('stops an edge at the other edge', () => {
    expect(clampSpanDelta(both, 'start', 10)).toBe(4);
    expect(clampSpanDelta(both, 'start', 2)).toBe(2);
    expect(clampSpanDelta(both, 'end', -10)).toBe(-4);
    expect(clampSpanDelta(both, 'end', -1)).toBe(-1);
  });

  it('pins both edges of a one-day bar', () => {
    const oneDay = { startDate: '2026-08-10', dueDate: '2026-08-10' };
    expect(clampSpanDelta(oneDay, 'start', 5)).toBe(0);
    expect(clampSpanDelta(oneDay, 'end', -5)).toBe(0);
  });
});

describe('timelineRange', () => {
  it('spans tasks and milestones with padding', () => {
    const range = timelineRange(
      [{ startDate: '2026-08-01', dueDate: '2026-08-20' }],
      [{ date: '2026-09-10' }],
      '2026-08-05',
    );
    expect(range.start).toBe('2026-07-29'); // 3 days before earliest
    expect(range.end).toBe('2026-09-13');   // 3 days after latest
    expect(range.days).toBe(47);
  });

  it('guarantees a minimum window on an empty project', () => {
    const range = timelineRange([], [], '2026-08-05');
    expect(range.days).toBeGreaterThanOrEqual(28);
    // Today must be inside the window.
    expect(range.start <= '2026-08-05' && '2026-08-05' <= range.end).toBe(true);
  });

  it('clamps far-out dates so the window stays bounded', () => {
    const range = timelineRange(
      [{ startDate: '2126-01-01', dueDate: '2126-02-01' }],
      [{ date: '1999-12-31' }],
      '2026-08-05',
    );
    // Max possible: past bound + future bound + 6 days of padding + 1.
    expect(range.days).toBeLessThanOrEqual(TIMELINE_MAX_PAST + TIMELINE_MAX_FUTURE + 7);
    expect(range.start <= '2026-08-05' && '2026-08-05' <= range.end).toBe(true);
  });

  it('keeps near dates unclamped', () => {
    const range = timelineRange(
      [{ startDate: '2026-08-01', dueDate: '2026-08-20' }],
      [],
      '2026-08-05',
    );
    expect(range.start).toBe('2026-07-29');
    expect(range.end).toBe('2026-08-25');
  });
});

describe('clampToRange', () => {
  const range = { start: '2026-08-01', end: '2026-08-31' };

  it('passes through in-range dates and clamps the rest', () => {
    expect(clampToRange('2026-08-15', range)).toBe('2026-08-15');
    expect(clampToRange('2026-08-01', range)).toBe('2026-08-01');
    expect(clampToRange('2025-01-01', range)).toBe('2026-08-01');
    expect(clampToRange('2126-01-01', range)).toBe('2026-08-31');
  });
});

describe('milestone & project progress', () => {
  const doc = {
    columns: [
      { id: 'todo', name: 'To do', done: false },
      { id: 'done', name: 'Done', done: true },
    ],
    tasks: [
      t('a', 'todo', 1, { milestoneId: 'm1' }),
      t('b', 'done', 1, { milestoneId: 'm1' }),
      t('c', 'done', 2, { milestoneId: null }),
    ],
  };

  it('counts done vs total for a milestone', () => {
    expect(milestoneProgress(doc.tasks, 'm1', doneColumnIds(doc))).toEqual({ total: 2, done: 1 });
  });

  it('counts the whole project', () => {
    expect(projectProgress(doc)).toEqual({ total: 3, done: 2 });
  });

  it('falls back to the last column when none is flagged done', () => {
    const noFlag = {
      columns: [{ id: 'x', done: false }, { id: 'y', done: false }],
      tasks: [],
    };
    expect([...doneColumnIds(noFlag)]).toEqual(['y']);
  });
});
