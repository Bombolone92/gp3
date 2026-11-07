import { describe, it, expect } from 'vitest';
import { listContext, sortTasks, groupTasks, dueBucket } from '../src/lib/list.js';

const DOC = {
  columns: [
    { id: 'todo', name: 'To do' },
    { id: 'doing', name: 'Doing' },
    { id: 'done', name: 'Done', done: true },
  ],
  members: [{ id: 'm1', name: 'Maya' }, { id: 'm2', name: 'Leo' }],
  milestones: [
    { id: 'ms2', name: 'Beta', date: '2026-09-01' },
    { id: 'ms1', name: 'Alpha', date: '2026-08-01' },
  ],
};

const TODAY = '2026-08-06';
const ctx = () => listContext(DOC, TODAY);

const task = (id, patch = {}) => ({
  id,
  title: id,
  columnId: 'todo',
  order: 1000,
  assigneeIds: [],
  labelIds: [],
  priority: null,
  startDate: null,
  dueDate: null,
  milestoneId: null,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const titles = (rows) => rows.map((t) => t.id);

describe('sortTasks', () => {
  it('falls back to board order — column, then card order', () => {
    const tasks = [
      task('c', { columnId: 'done', order: 10 }),
      task('b', { columnId: 'todo', order: 20 }),
      task('a', { columnId: 'todo', order: 10 }),
    ];
    expect(titles(sortTasks(tasks, { key: 'board' }, ctx()))).toEqual(['a', 'b', 'c']);
  });

  it('sorts by due date, and keeps undated rows last in both directions', () => {
    const tasks = [
      task('none'),
      task('late', { dueDate: '2026-08-01' }),
      task('soon', { dueDate: '2026-08-10' }),
    ];
    expect(titles(sortTasks(tasks, { key: 'due', dir: 'asc' }, ctx())))
      .toEqual(['late', 'soon', 'none']);
    expect(titles(sortTasks(tasks, { key: 'due', dir: 'desc' }, ctx())))
      .toEqual(['soon', 'late', 'none']);
  });

  it('sorts by priority, urgent first, none last', () => {
    const tasks = [
      task('low', { priority: 'low' }),
      task('none'),
      task('urgent', { priority: 'urgent' }),
      task('high', { priority: 'high' }),
    ];
    expect(titles(sortTasks(tasks, { key: 'priority', dir: 'asc' }, ctx())))
      .toEqual(['urgent', 'high', 'low', 'none']);
  });

  it('sorts by title case-insensitively', () => {
    const tasks = [task('b', { title: 'beta' }), task('a', { title: 'Alpha' })];
    expect(titles(sortTasks(tasks, { key: 'title', dir: 'asc' }, ctx()))).toEqual(['a', 'b']);
  });

  it('sorts by when a task last changed', () => {
    const tasks = [task('old', { updatedAt: 10 }), task('new', { updatedAt: 99 })];
    expect(titles(sortTasks(tasks, { key: 'updated', dir: 'desc' }, ctx())))
      .toEqual(['new', 'old']);
  });

  it('never mutates the array it was given', () => {
    const tasks = [task('b', { order: 20 }), task('a', { order: 10 })];
    const copy = [...tasks];
    sortTasks(tasks, { key: 'title', dir: 'asc' }, ctx());
    expect(tasks).toEqual(copy);
  });
});

describe('groupTasks', () => {
  it('groups by column in board order and drops empty groups', () => {
    const tasks = [task('a'), task('b', { columnId: 'done' })];
    const groups = groupTasks(tasks, 'column', ctx());
    expect(groups.map((g) => [g.label, g.tasks.length])).toEqual([['To do', 1], ['Done', 1]]);
  });

  it('lists a shared task under each of its assignees', () => {
    const tasks = [
      task('shared', { assigneeIds: ['m1', 'm2'] }),
      task('mine', { assigneeIds: ['m1'] }),
      task('nobody'),
    ];
    const groups = groupTasks(tasks, 'assignee', ctx());
    expect(groups.map((g) => [g.label, titles(g.tasks)])).toEqual([
      ['Maya', ['shared', 'mine']],
      ['Leo', ['shared']],
      ['Unassigned', ['nobody']],
    ]);
  });

  it('groups by milestone in date order, with the unassigned last', () => {
    const tasks = [
      task('beta', { milestoneId: 'ms2' }),
      task('alpha', { milestoneId: 'ms1' }),
      task('loose'),
      task('stale', { milestoneId: 'gone' }),
    ];
    const groups = groupTasks(tasks, 'milestone', ctx());
    expect(groups.map((g) => [g.label, titles(g.tasks)])).toEqual([
      ['Alpha', ['alpha']],
      ['Beta', ['beta']],
      // A reference to a deleted milestone is "no milestone", not a lost row.
      ['No milestone', ['loose', 'stale']],
    ]);
  });

  it('buckets by due date, and keeps finished work out of Overdue', () => {
    const tasks = [
      task('late', { dueDate: '2026-08-01' }),
      task('now', { dueDate: TODAY }),
      task('week', { dueDate: '2026-08-10' }),
      task('later', { dueDate: '2026-12-01' }),
      task('undated'),
      task('finished', { columnId: 'done', dueDate: '2026-08-01' }),
    ];
    const groups = groupTasks(tasks, 'due', ctx());
    expect(groups.map((g) => [g.label, titles(g.tasks)])).toEqual([
      ['Overdue', ['late']],
      ['Today', ['now']],
      ['This week', ['week']],
      ['Later', ['later']],
      ['No due date', ['undated']],
      ['Done', ['finished']],
    ]);
  });

  it('collapses to one group when grouping is off', () => {
    const tasks = [task('a'), task('b', { columnId: 'done' })];
    expect(groupTasks(tasks, 'none', ctx())).toEqual([
      { key: 'all', label: 'All tasks', tasks },
    ]);
    expect(groupTasks([], 'none', ctx())).toEqual([]);
  });
});

describe('dueBucket', () => {
  it('classifies a date against today', () => {
    expect(dueBucket(task('a', { dueDate: '2026-08-05' }), ctx())).toBe('overdue');
    expect(dueBucket(task('a', { dueDate: TODAY }), ctx())).toBe('today');
    expect(dueBucket(task('a', { dueDate: '2026-08-13' }), ctx())).toBe('week');
    expect(dueBucket(task('a', { dueDate: '2026-08-14' }), ctx())).toBe('later');
    expect(dueBucket(task('a'), ctx())).toBe('none');
  });
});
