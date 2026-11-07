import { describe, it, expect } from 'vitest';
import { agendaBucket, buildAgenda } from '../src/lib/agenda.js';

const TODAY = '2026-08-06';

const doc = (tasks, extra = {}) => ({
  id: 'p1',
  columns: [
    { id: 'c1', name: 'To do', done: false },
    { id: 'c2', name: 'Done', done: true },
  ],
  tasks,
  milestones: [],
  ...extra,
});

const task = (patch) => ({
  id: 'x', title: 'T', columnId: 'c1', priority: null, dueDate: null, ...patch,
});

describe('agendaBucket', () => {
  it('splits by how soon the date is', () => {
    expect(agendaBucket('2026-08-05', TODAY)).toBe('overdue');
    expect(agendaBucket('2026-08-06', TODAY)).toBe('today');
    expect(agendaBucket('2026-08-13', TODAY)).toBe('week');
    expect(agendaBucket('2026-08-14', TODAY)).toBe('later');
    expect(agendaBucket(null, TODAY)).toBeNull();
  });
});

describe('buildAgenda', () => {
  it('groups dated open work across projects', () => {
    const sources = [
      {
        entry: { id: 'p1', name: 'Alpha', color: '#111' },
        doc: doc([
          task({ id: 'a', dueDate: '2026-08-01' }),
          task({ id: 'b', dueDate: '2026-08-06' }),
        ]),
      },
      {
        entry: { id: 'p2', name: 'Beta', color: '#222' },
        doc: doc([task({ id: 'c', dueDate: '2026-08-09' })]),
      },
    ];
    const { groups, counts } = buildAgenda(sources, TODAY);
    expect(groups.overdue.map((r) => r.task.id)).toEqual(['a']);
    expect(groups.today.map((r) => r.task.id)).toEqual(['b']);
    expect(groups.week.map((r) => r.task.id)).toEqual(['c']);
    expect(counts).toMatchObject({ overdue: 1, today: 1, week: 1, later: 0, due: 2, total: 3 });
    expect(groups.week[0].projectName).toBe('Beta');
    expect(groups.overdue[0].column.name).toBe('To do');
  });

  it('leaves out done tasks, undated tasks, and archived projects', () => {
    const sources = [
      {
        entry: { id: 'p1', name: 'Alpha', color: '#111' },
        doc: doc([
          task({ id: 'done', columnId: 'c2', dueDate: '2026-08-01' }),
          task({ id: 'undated' }),
        ]),
      },
      {
        entry: { id: 'p2', name: 'Retired', color: '#222', archived: true },
        doc: doc([task({ id: 'hidden', dueDate: '2026-08-06' })]),
      },
    ];
    expect(buildAgenda(sources, TODAY).counts.total).toBe(0);
  });

  it('sorts by date, then priority, then project', () => {
    const sources = [
      {
        entry: { id: 'p1', name: 'Zeta', color: '#111' },
        doc: doc([
          task({ id: 'low', dueDate: '2026-08-06', priority: 'low' }),
          task({ id: 'urgent', dueDate: '2026-08-06', priority: 'urgent' }),
          task({ id: 'none', dueDate: '2026-08-06' }),
        ]),
      },
      {
        entry: { id: 'p2', name: 'Alpha', color: '#222' },
        doc: doc([task({ id: 'other', dueDate: '2026-08-06', priority: 'urgent' })]),
      },
    ];
    expect(buildAgenda(sources, TODAY).groups.today.map((r) => r.task.id))
      .toEqual(['other', 'urgent', 'low', 'none']);
  });

  it('treats the last column as done when nothing is flagged', () => {
    const sources = [{
      entry: { id: 'p1', name: 'Alpha', color: '#111' },
      doc: doc([task({ id: 'a', columnId: 'c2', dueDate: '2026-08-06' })], {
        columns: [{ id: 'c1', name: 'To do' }, { id: 'c2', name: 'Shipped' }],
      }),
    }];
    expect(buildAgenda(sources, TODAY).counts.total).toBe(0);
  });

  it('ignores projects whose document is not loaded yet', () => {
    const sources = [{ entry: { id: 'p1', name: 'Alpha', color: '#111' }, doc: null }];
    expect(buildAgenda(sources, TODAY).counts.total).toBe(0);
  });
});
