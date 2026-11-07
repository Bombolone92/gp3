import { describe, it, expect } from 'vitest';
import { wipState, planColumnSort, isColumnSortKey } from '../src/lib/columns.js';
import { normalizeWipLimit, normalizeArchiveDays } from '../src/lib/store.js';
import { columnTasks, ORDER_GAP } from '../src/lib/board.js';

const task = (id, patch = {}) => ({
  id, title: id, columnId: 'c1', order: 0, dueDate: null, priority: null, ...patch,
});

describe('normalizers', () => {
  it('takes a positive whole number, or nothing', () => {
    expect(normalizeWipLimit('4')).toBe(4);
    expect(normalizeWipLimit(4.7)).toBe(4);
    expect(normalizeWipLimit(0)).toBe(null);
    expect(normalizeWipLimit(-3)).toBe(null);
    expect(normalizeWipLimit('')).toBe(null);
    expect(normalizeWipLimit('abc')).toBe(null);
    expect(normalizeWipLimit(null)).toBe(null);
  });

  it('caps both so one keypress cannot write nonsense into a header', () => {
    expect(normalizeWipLimit(1e9)).toBe(999);
    expect(normalizeArchiveDays(1e9)).toBe(3650);
    expect(normalizeArchiveDays('7')).toBe(7);
    expect(normalizeArchiveDays('')).toBe(null);
  });
});

describe('wipState', () => {
  it('reports the count against the limit without ever refusing anything', () => {
    expect(wipState({ wipLimit: 4 }, 6)).toEqual({ count: 6, limit: 4, over: true, at: false });
    expect(wipState({ wipLimit: 4 }, 4)).toEqual({ count: 4, limit: 4, over: false, at: true });
    expect(wipState({ wipLimit: 4 }, 2)).toEqual({ count: 2, limit: 4, over: false, at: false });
  });

  it('is a plain count with no limit set', () => {
    expect(wipState({}, 9)).toEqual({ count: 9, limit: null, over: false, at: false });
    expect(wipState({ wipLimit: 0 }, 9).limit).toBe(null);
  });
});

describe('planColumnSort', () => {
  const tasks = () => [
    task('a', { order: 1 * ORDER_GAP, dueDate: '2026-09-10', priority: 'low', title: 'Beta' }),
    task('b', { order: 2 * ORDER_GAP, dueDate: null, priority: 'urgent', title: 'alpha' }),
    task('c', { order: 3 * ORDER_GAP, dueDate: '2026-08-01', priority: null, title: 'Gamma' }),
    task('other', { columnId: 'c2', order: ORDER_GAP, dueDate: '2020-01-01' }),
  ];

  const applied = (key) => {
    const list = tasks();
    const orders = new Map(planColumnSort(list, 'c1', key).map((r) => [r.id, r.order]));
    return columnTasks(
      list.map((t) => (orders.has(t.id) ? { ...t, order: orders.get(t.id) } : t)),
      'c1',
    ).map((t) => t.id);
  };

  it('sorts by due date, with undated cards at the bottom', () => {
    expect(applied('due')).toEqual(['c', 'a', 'b']);
  });

  it('sorts by priority, with unset priorities at the bottom', () => {
    expect(applied('priority')).toEqual(['b', 'a', 'c']);
  });

  it('sorts by title, ignoring case', () => {
    expect(applied('title')).toEqual(['b', 'a', 'c']);
  });

  it('touches one column and nothing else', () => {
    const rewrites = planColumnSort(tasks(), 'c1', 'due');
    expect(rewrites.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('writes nothing when the column is already in that order', () => {
    const sorted = [
      task('c', { order: 1, dueDate: '2026-08-01' }),
      task('a', { order: 2, dueDate: '2026-09-10' }),
      task('b', { order: 3, dueDate: null }),
    ];
    expect(planColumnSort(sorted, 'c1', 'due')).toEqual([]);
  });

  it('writes nothing for a column with fewer than two cards, or an unknown key', () => {
    expect(planColumnSort(tasks(), 'c2', 'due')).toEqual([]);
    expect(planColumnSort(tasks(), 'c1', 'colour')).toEqual([]);
    expect(isColumnSortKey('due')).toBe(true);
    expect(isColumnSortKey('colour')).toBe(false);
  });

  it('breaks ties by title, so equal values keep an explainable order', () => {
    const same = [
      task('x', { order: 1, dueDate: '2026-08-01', title: 'Zebra' }),
      task('y', { order: 2, dueDate: '2026-08-01', title: 'Ant' }),
    ];
    expect(planColumnSort(same, 'c1', 'due').map((r) => r.id)).toEqual(['y', 'x']);
  });
});
