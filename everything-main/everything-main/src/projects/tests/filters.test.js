import { describe, it, expect } from 'vitest';
import {
  emptyFilter, isFilterActive, activeFacets, matchesDue, matchesFilter, filterTasks,
} from '../src/lib/filters.js';

const TODAY = '2026-08-06';

const task = (patch = {}) => ({
  id: 't', title: 'Task', columnId: 'c1', labelIds: [], assigneeIds: [],
  priority: null, startDate: null, dueDate: null, ...patch,
});

describe('filter state', () => {
  it('starts inactive', () => {
    const f = emptyFilter();
    expect(isFilterActive(f)).toBe(false);
    expect(activeFacets(f)).toBe(0);
  });

  it('counts each facet in play, ignoring whitespace-only text', () => {
    expect(activeFacets({ ...emptyFilter(), text: '   ' })).toBe(0);
    expect(activeFacets({ ...emptyFilter(), text: 'a', due: ['today'] })).toBe(2);
  });
});

describe('matchesDue', () => {
  const t = (dueDate) => task({ dueDate });

  it('classifies overdue, today, and the week ahead', () => {
    expect(matchesDue(t('2026-08-05'), 'overdue', { today: TODAY })).toBe(true);
    expect(matchesDue(t('2026-08-06'), 'overdue', { today: TODAY })).toBe(false);
    expect(matchesDue(t('2026-08-06'), 'today', { today: TODAY })).toBe(true);
    expect(matchesDue(t('2026-08-13'), 'week', { today: TODAY })).toBe(true);
    expect(matchesDue(t('2026-08-14'), 'week', { today: TODAY })).toBe(false);
    // Yesterday is overdue, not "this week".
    expect(matchesDue(t('2026-08-05'), 'week', { today: TODAY })).toBe(false);
  });

  it('never calls a done task overdue, but still honors literal dates', () => {
    expect(matchesDue(t('2026-08-01'), 'overdue', { today: TODAY, done: true })).toBe(false);
    expect(matchesDue(t('2026-08-06'), 'today', { today: TODAY, done: true })).toBe(true);
  });

  it('matches undated tasks only under "none"', () => {
    expect(matchesDue(t(null), 'none', { today: TODAY })).toBe(true);
    expect(matchesDue(t(null), 'today', { today: TODAY })).toBe(false);
    expect(matchesDue(t('2026-08-06'), 'none', { today: TODAY })).toBe(false);
  });
});

describe('matchesFilter', () => {
  const ctx = { doneIds: new Set(['done']), today: TODAY };

  it('matches titles case-insensitively on a substring', () => {
    const t = task({ title: 'Redesign the Dashboard' });
    expect(matchesFilter(t, { ...emptyFilter(), text: 'dash' }, ctx)).toBe(true);
    expect(matchesFilter(t, { ...emptyFilter(), text: 'DASHBOARD' }, ctx)).toBe(true);
    expect(matchesFilter(t, { ...emptyFilter(), text: 'sidebar' }, ctx)).toBe(false);
  });

  it('ORs inside a facet', () => {
    const t = task({ labelIds: ['l2'] });
    expect(matchesFilter(t, { ...emptyFilter(), labelIds: ['l1', 'l2'] }, ctx)).toBe(true);
    expect(matchesFilter(t, { ...emptyFilter(), labelIds: ['l1'] }, ctx)).toBe(false);
  });

  it('ANDs across facets', () => {
    const t = task({ title: 'Ship it', labelIds: ['l1'], priority: 'high' });
    expect(matchesFilter(t, { ...emptyFilter(), text: 'ship', priority: [], labelIds: ['l1'] }, ctx)).toBe(true);
    expect(matchesFilter(t, { ...emptyFilter(), text: 'ship', labelIds: ['l1'], priorities: ['low'] }, ctx)).toBe(false);
  });

  it('treats a null priority entry as "no priority"', () => {
    expect(matchesFilter(task({ priority: null }), { ...emptyFilter(), priorities: [null] }, ctx)).toBe(true);
    expect(matchesFilter(task({ priority: 'low' }), { ...emptyFilter(), priorities: [null] }, ctx)).toBe(false);
  });

  it('reads done-ness from the task column for the overdue bucket', () => {
    const late = task({ dueDate: '2026-08-01' });
    expect(matchesFilter(late, { ...emptyFilter(), due: ['overdue'] }, ctx)).toBe(true);
    expect(matchesFilter({ ...late, columnId: 'done' }, { ...emptyFilter(), due: ['overdue'] }, ctx)).toBe(false);
  });

  it('tolerates tasks written before labels or assignees existed', () => {
    const bare = { id: 'x', title: 'Old', columnId: 'c1' };
    expect(matchesFilter(bare, { ...emptyFilter(), labelIds: ['l1'] }, ctx)).toBe(false);
    expect(matchesFilter(bare, emptyFilter(), ctx)).toBe(true);
  });
});

describe('filterTasks', () => {
  it('returns the same array when nothing is filtered', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })];
    expect(filterTasks(tasks, emptyFilter(), {})).toBe(tasks);
  });

  it('keeps only matches', () => {
    const tasks = [task({ id: 'a', title: 'Alpha' }), task({ id: 'b', title: 'Beta' })];
    expect(filterTasks(tasks, { ...emptyFilter(), text: 'alp' }, {}).map((t) => t.id)).toEqual(['a']);
  });
});
