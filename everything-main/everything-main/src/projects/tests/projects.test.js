import { describe, it, expect } from 'vitest';
import {
  orderedProjects, projectGroups, planProjectMove, matchesProjectQuery,
} from '../src/lib/projects.js';

const entry = (id, patch = {}) => ({ id, name: id, createdAt: 0, ...patch });

describe('orderedProjects', () => {
  it('keeps creation order while nothing has been arranged by hand', () => {
    const list = [entry('a', { createdAt: 1 }), entry('b', { createdAt: 2 }), entry('c', { createdAt: 3 })];
    expect(orderedProjects(list).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('puts pinned projects first, in their own arrangement', () => {
    const list = [
      entry('a', { order: 0 }),
      entry('b', { order: 1, pinned: true }),
      entry('c', { order: 2, pinned: true }),
    ];
    expect(orderedProjects(list).map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts an entry that has never been placed after the ones that have', () => {
    const list = [entry('fresh', { createdAt: 99 }), entry('placed', { order: 3, createdAt: 1 })];
    expect(orderedProjects(list).map((p) => p.id)).toEqual(['placed', 'fresh']);
  });

  it('leaves the input untouched and copes with nothing at all', () => {
    const list = [entry('b', { order: 1 }), entry('a', { order: 0 })];
    orderedProjects(list);
    expect(list.map((p) => p.id)).toEqual(['b', 'a']);
    expect(orderedProjects(undefined)).toEqual([]);
  });
});

describe('projectGroups', () => {
  it('splits the ordered list into pinned and the rest', () => {
    const { pinned, rest } = projectGroups([
      entry('a'), entry('b', { pinned: true }), entry('c'),
    ]);
    expect(pinned.map((p) => p.id)).toEqual(['b']);
    expect(rest.map((p) => p.id)).toEqual(['a', 'c']);
  });
});

describe('planProjectMove', () => {
  const list = () => [
    entry('p1', { pinned: true, order: 0 }),
    entry('p2', { pinned: true, order: 1 }),
    entry('a', { order: 0 }),
    entry('b', { order: 1 }),
    entry('c', { order: 2 }),
  ];

  const apply = (entries, rewrites) => {
    const orders = new Map(rewrites.map((r) => [r.id, r.order]));
    return orderedProjects(entries.map((p) => (orders.has(p.id)
      ? { ...p, order: orders.get(p.id) } : p))).map((p) => p.id);
  };

  it('moves a project to the position it was dropped in', () => {
    const rewrites = planProjectMove(list(), 'c', 0);
    expect(apply(list(), rewrites)).toEqual(['p1', 'p2', 'c', 'a', 'b']);
  });

  it('renumbers only the group that moved, so pins stay put', () => {
    const rewrites = planProjectMove(list(), 'a', 2);
    expect(rewrites.map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(apply(list(), rewrites)).toEqual(['p1', 'p2', 'b', 'c', 'a']);
  });

  it('reorders inside the pinned group without unpinning anything', () => {
    const rewrites = planProjectMove(list(), 'p2', 0);
    expect(apply(list(), rewrites)).toEqual(['p2', 'p1', 'a', 'b', 'c']);
  });

  it('clamps an index past either end', () => {
    expect(apply(list(), planProjectMove(list(), 'a', 99)))
      .toEqual(['p1', 'p2', 'b', 'c', 'a']);
    expect(apply(list(), planProjectMove(list(), 'c', -5)))
      .toEqual(['p1', 'p2', 'c', 'a', 'b']);
  });

  it('has nothing to write when the move changes nothing', () => {
    expect(planProjectMove(list(), 'a', 0)).toEqual([]);
    expect(planProjectMove(list(), 'ghost', 1)).toEqual([]);
  });

  it('leaves a project created elsewhere mid-drag alone, at the end', () => {
    const withNew = [...list(), entry('new', { createdAt: 50 })];
    const rewrites = planProjectMove(withNew, 'c', 0);
    expect(rewrites.some((r) => r.id === 'new')).toBe(true);
    // It was part of the group as drawn, so it keeps its place at the end.
    expect(apply(withNew, rewrites)).toEqual(['p1', 'p2', 'c', 'a', 'b', 'new']);
  });
});

describe('matchesProjectQuery', () => {
  it('matches a name anywhere, ignoring case and surrounding space', () => {
    const p = entry('x', { name: 'Website redesign' });
    expect(matchesProjectQuery(p, 'redes')).toBe(true);
    expect(matchesProjectQuery(p, '  WEB ')).toBe(true);
    expect(matchesProjectQuery(p, 'app')).toBe(false);
  });

  it('matches everything when nothing is typed', () => {
    expect(matchesProjectQuery(entry('x'), '')).toBe(true);
    expect(matchesProjectQuery(entry('x'), '   ')).toBe(true);
  });
});
