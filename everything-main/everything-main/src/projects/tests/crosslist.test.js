import { describe, it, expect } from 'vitest';
import {
  crossContext, groupCrossTasks, localFilter, nameKey, CROSS_GROUPS,
} from '../src/lib/crosslist.js';
import { sortTasks } from '../src/lib/list.js';
import { emptyFilter } from '../src/lib/filters.js';

const TODAY = '2026-08-20';

/* Two projects that share a column name, a label name, and a member name —
   the case the whole module exists for. */
const sources = () => [
  {
    entry: { id: 'p1', name: 'Launch', color: '#111', order: 0 },
    doc: {
      id: 'p1',
      columns: [
        { id: 'p1c1', name: 'To do' },
        { id: 'p1c2', name: 'Done', done: true },
      ],
      labels: [{ id: 'p1l1', name: 'Design', color: '#a1a' }],
      members: [{ id: 'p1m1', name: 'Maya', color: '#0a0' }],
      milestones: [{ id: 'p1ms1', name: 'Beta', date: '2026-09-10' }],
      tasks: [
        {
          id: 'a', title: 'Wireframes', columnId: 'p1c1', order: 1024,
          labelIds: ['p1l1'], assigneeIds: ['p1m1'], milestoneId: 'p1ms1',
          priority: 'high', dueDate: '2026-08-21', updatedAt: 5,
        },
        {
          id: 'b', title: 'Shipped thing', columnId: 'p1c2', order: 1024,
          labelIds: [], assigneeIds: [], milestoneId: null, updatedAt: 9,
        },
      ],
    },
  },
  {
    entry: { id: 'p2', name: 'Support', color: '#222', order: 1 },
    doc: {
      id: 'p2',
      columns: [
        { id: 'p2c1', name: 'To do' },
        { id: 'p2c2', name: 'Waiting' },
        { id: 'p2c3', name: 'Closed', done: true },
      ],
      labels: [{ id: 'p2l1', name: 'design', color: '#b2b' }, { id: 'p2l2', name: 'Bug', color: '#c00' }],
      members: [{ id: 'p2m1', name: 'maya' }, { id: 'p2m2', name: 'Leo' }],
      milestones: [{ id: 'p2ms1', name: 'Beta', date: '2026-09-01' }],
      tasks: [
        {
          id: 'c', title: 'Answer the backlog', columnId: 'p2c1', order: 1024,
          labelIds: ['p2l2'], assigneeIds: ['p2m2'], milestoneId: null, updatedAt: 7,
        },
        {
          id: 'd', title: 'Chase the vendor', columnId: 'p2c2', order: 1024,
          labelIds: ['p2l1'], assigneeIds: ['p2m1'], milestoneId: 'p2ms1',
          priority: 'urgent', dueDate: '2026-08-19', updatedAt: 3,
        },
      ],
    },
  },
];

const allTasks = (list = sources()) => list.flatMap((s) => s.doc.tasks);
const ctxOf = (list = sources()) => crossContext(list, TODAY);

describe('crossContext', () => {
  it('unions labels, members, and milestones by name, keeping the projects', () => {
    const ctx = ctxOf();
    expect(ctx.labels.map((l) => l.label).sort())
      .toEqual(['Bug', 'Design (2 projects)']);
    expect(ctx.members.map((m) => m.label).sort())
      .toEqual(['Leo', 'Maya (2 projects)']);
    // The nearer of two same-named milestones is where it sorts.
    expect(ctx.milestones).toEqual([expect.objectContaining({
      id: 'beta', label: 'Beta (2 projects)', date: '2026-09-01',
    })]);
  });

  it('unions columns by name, in the order the boards show them', () => {
    const ctx = ctxOf();
    expect(ctx.columns.map((c) => c.name)).toEqual(['To do', 'Done', 'Waiting', 'Closed']);
    const todo = ctx.columns.find((c) => c.name === 'To do');
    expect([...todo.ids].sort()).toEqual(['p1c1', 'p2c1']);
    expect(ctx.columns.find((c) => c.name === 'Done').done).toBe(true);
  });

  it('leaves out archived projects and anything not loaded', () => {
    const list = sources();
    list[1].entry.archived = true;
    expect(ctxOf(list).projects.map((p) => p.entry.id)).toEqual(['p1']);
    expect(crossContext([{ entry: { id: 'x', name: 'X' }, doc: null }]).projects).toEqual([]);
    expect(crossContext(undefined).projects).toEqual([]);
  });

  it('says which project a task came from', () => {
    const ctx = ctxOf();
    expect(ctx.projectEntry({ id: 'd' }).name).toBe('Support');
    expect(ctx.projectDoc({ id: 'a' }).id).toBe('p1');
    expect(ctx.projectOf({ id: 'nope' })).toBe(null);
  });

  it('collects every done column so date buckets stay honest', () => {
    expect([...ctxOf().doneIds].sort()).toEqual(['p1c2', 'p2c3']);
  });
});

describe('sorting across projects', () => {
  it('board order means project, then column, then card', () => {
    const ctx = ctxOf();
    expect(sortTasks(allTasks(), { key: 'board' }, ctx).map((t) => t.id))
      .toEqual(['a', 'b', 'c', 'd']);
  });

  it('follows the sidebar arrangement rather than the order docs arrived in', () => {
    const list = sources();
    list[0].entry.order = 5; // Launch moved below Support
    const ctx = crossContext(list, TODAY);
    expect(sortTasks(allTasks(list), { key: 'board' }, ctx).map((t) => t.id))
      .toEqual(['c', 'd', 'a', 'b']);
  });

  it('field sorts work unchanged, and empties still sink', () => {
    const ctx = ctxOf();
    expect(sortTasks(allTasks(), { key: 'due', dir: 'asc' }, ctx).map((t) => t.id))
      .toEqual(['d', 'a', 'b', 'c']);
    expect(sortTasks(allTasks(), { key: 'updated', dir: 'desc' }, ctx).map((t) => t.id))
      .toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('groupCrossTasks', () => {
  it('groups by project, in the sidebar order', () => {
    const ctx = ctxOf();
    const groups = groupCrossTasks(allTasks(), 'project', ctx);
    expect(groups.map((g) => [g.label, g.tasks.map((t) => t.id)]))
      .toEqual([['Launch', ['a', 'b']], ['Support', ['c', 'd']]]);
  });

  it('groups by column name, so one name is one group', () => {
    const ctx = ctxOf();
    const groups = groupCrossTasks(allTasks(), 'column', ctx);
    expect(groups.map((g) => g.label)).toEqual(['To do', 'Done', 'Waiting']);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['a', 'c']);
    expect(groups[0].projects).toHaveLength(2);
  });

  it('groups by assignee name across projects, with the unassigned last', () => {
    const ctx = ctxOf();
    const groups = groupCrossTasks(allTasks(), 'assignee', ctx);
    expect(groups.map((g) => [g.label, g.tasks.map((t) => t.id)])).toEqual([
      ['Maya (2 projects)', ['a', 'd']],
      ['Leo', ['c']],
      ['Unassigned', ['b']],
    ]);
  });

  it('groups by milestone name, nearest first, with the rest after', () => {
    const ctx = ctxOf();
    const groups = groupCrossTasks(allTasks(), 'milestone', ctx);
    expect(groups.map((g) => [g.label, g.tasks.map((t) => t.id)])).toEqual([
      ['Beta (2 projects)', ['a', 'd']],
      ['No milestone', ['b', 'c']],
    ]);
  });

  it('hands date buckets and "nothing" to the list view grouper', () => {
    const ctx = ctxOf();
    const due = groupCrossTasks(allTasks(), 'due', ctx);
    expect(due.map((g) => g.label))
      .toEqual(['Overdue', 'This week', 'No due date', 'Done']);
    expect(due[0].tasks.map((t) => t.id)).toEqual(['d']);
    expect(groupCrossTasks(allTasks(), 'none', ctx).map((g) => g.tasks.length)).toEqual([4]);
  });

  it('drops empty groups, and every option has a grouper', () => {
    const ctx = crossContext([sources()[0]], TODAY);
    for (const g of CROSS_GROUPS) {
      const groups = groupCrossTasks(allTasks([sources()[0]]), g.key, ctx);
      expect(groups.every((group) => group.tasks.length > 0)).toBe(true);
    }
  });
});

describe('localFilter', () => {
  const [p1, p2] = sources();

  it('translates a label name into whichever id that project uses', () => {
    const filter = { ...emptyFilter(), labelIds: ['design'] };
    expect(localFilter(filter, p1.doc).labelIds).toEqual(['p1l1']);
    expect(localFilter(filter, p2.doc).labelIds).toEqual(['p2l1']);
  });

  it('excludes a project that has no such label at all', () => {
    expect(localFilter({ ...emptyFilter(), labelIds: ['bug'] }, p1.doc)).toBe(null);
    expect(localFilter({ ...emptyFilter(), assigneeIds: ['leo'] }, p1.doc)).toBe(null);
  });

  it('leaves a filter with no name facets untouched', () => {
    const filter = { ...emptyFilter(), text: 'wire', priorities: ['high'] };
    expect(localFilter(filter, p1.doc)).toEqual(filter);
  });
});

describe('nameKey', () => {
  it('makes a name into an identity that survives a project boundary', () => {
    expect(nameKey('  Design ')).toBe('design');
    expect(nameKey(null)).toBe('');
  });
});
