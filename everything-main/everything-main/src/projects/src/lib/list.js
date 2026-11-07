/**
 * Sorting and grouping for the list view, kept pure so the arrangement can
 * be unit-tested and can never drift from what the column header claims it
 * is doing.
 *
 * Sorting is a *view* preference: nothing here writes the `order` field the
 * board arranges itself by, so a list sorted by due date leaves the board's
 * manual arrangement exactly as it was.
 */

import { todayISO, diffDays } from './dates.js';
import { doneColumnIds } from './board.js';
import { PRIORITIES } from './store.js';

export const LIST_GROUPS = [
  { key: 'column', label: 'Column' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'milestone', label: 'Milestone' },
  { key: 'due', label: 'Due date' },
  { key: 'none', label: 'Nothing' },
];

export const LIST_SORTS = [
  { key: 'board', label: 'Board order' },
  { key: 'title', label: 'Title' },
  { key: 'column', label: 'Column' },
  { key: 'due', label: 'Due date' },
  { key: 'priority', label: 'Priority' },
  { key: 'created', label: 'Created' },
  { key: 'updated', label: 'Last updated' },
];

const PRIORITY_RANK = new Map(PRIORITIES.map((p, i) => [p.value, i]));

/** Shared lookups every sorter and grouper needs, built once per render. */
export function listContext(doc, today = todayISO()) {
  return {
    columns: doc.columns,
    columnIndex: new Map(doc.columns.map((c, i) => [c.id, i])),
    members: doc.members,
    milestones: doc.milestones,
    doneIds: doneColumnIds(doc),
    today,
  };
}

/** The order the board itself shows: column left to right, then card order. */
function boardCompare(a, b, ctx) {
  const ai = ctx.columnIndex.get(a.columnId) ?? Number.MAX_SAFE_INTEGER;
  const bi = ctx.columnIndex.get(b.columnId) ?? Number.MAX_SAFE_INTEGER;
  return ai - bi
    || (a.order ?? 0) - (b.order ?? 0)
    || String(a.id).localeCompare(String(b.id));
}

const text = (v) => String(v ?? '').trim().toLowerCase();

const COMPARATORS = {
  title: {
    empty: (t) => !text(t.title),
    cmp: (a, b) => text(a.title).localeCompare(text(b.title)),
  },
  column: {
    cmp: (a, b, ctx) =>
      (ctx.columnIndex.get(a.columnId) ?? 0) - (ctx.columnIndex.get(b.columnId) ?? 0),
  },
  due: {
    empty: (t) => !t.dueDate,
    cmp: (a, b) => String(a.dueDate).localeCompare(String(b.dueDate)),
  },
  priority: {
    empty: (t) => !t.priority,
    cmp: (a, b) => (PRIORITY_RANK.get(a.priority) ?? 0) - (PRIORITY_RANK.get(b.priority) ?? 0),
  },
  created: { cmp: (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) },
  updated: { cmp: (a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0) },
};

export function isSortKey(key) {
  return key === 'board' || Object.hasOwn(COMPARATORS, key);
}

/**
 * sortTasks(tasks, { key, dir }, ctx) → a new array.
 *
 * Board order is both the default and the tie-breaker, so two rows that
 * compare equal keep the arrangement the user made by hand.
 */
export function sortTasks(tasks, sort, ctx) {
  const rows = [...tasks];
  const spec = COMPARATORS[sort?.key];
  if (!spec) return rows.sort((a, b) => boardCompare(a, b, ctx));
  const dir = sort.dir === 'desc' ? -1 : 1;
  return rows.sort((a, b) => {
    // A missing value is not "the smallest one": it sorts last in both
    // directions, so reversing a sort never buries the rows that have one.
    const ea = spec.empty?.(a) ? 1 : 0;
    const eb = spec.empty?.(b) ? 1 : 0;
    if (ea !== eb) return ea - eb;
    return spec.cmp(a, b, ctx) * dir || boardCompare(a, b, ctx);
  });
}

/**
 * Which due bucket a task belongs to. A task in a done column is finished
 * rather than late — the same rule the filter bar's "Overdue" facet uses —
 * so it gets its own bucket instead of poisoning the ones about deadlines.
 */
export function dueBucket(task, ctx) {
  if (ctx.doneIds.has(task.columnId)) return 'done';
  if (!task.dueDate) return 'none';
  const d = diffDays(ctx.today, task.dueDate);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= 7) return 'week';
  return 'later';
}

const DUE_BUCKETS = [
  { key: 'overdue', label: 'Overdue', tone: 'overdue' },
  { key: 'today', label: 'Today', tone: 'today' },
  { key: 'week', label: 'This week', tone: 'soon' },
  { key: 'later', label: 'Later', tone: '' },
  { key: 'none', label: 'No due date', tone: '' },
  { key: 'done', label: 'Done', tone: '' },
];

const GROUPERS = {
  column: (tasks, ctx) => ctx.columns.map((c) => ({
    key: c.id,
    label: c.name,
    tasks: tasks.filter((t) => t.columnId === c.id),
  })),

  // A task with two assignees is listed under both: that is what the data
  // says, and selection is by id, so ticking it in one group ticks it in
  // the other rather than acting twice.
  assignee: (tasks, ctx) => [
    ...ctx.members.map((m) => ({
      key: m.id,
      label: m.name,
      member: m,
      tasks: tasks.filter((t) => t.assigneeIds?.includes(m.id)),
    })),
    {
      key: 'none',
      label: 'Unassigned',
      tasks: tasks.filter((t) => !t.assigneeIds?.length),
    },
  ],

  milestone: (tasks, ctx) => [
    ...[...ctx.milestones]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((m) => ({
        key: m.id,
        label: m.name,
        milestone: m,
        tasks: tasks.filter((t) => t.milestoneId === m.id),
      })),
    {
      key: 'none',
      label: 'No milestone',
      tasks: tasks.filter((t) => !t.milestoneId
        || !ctx.milestones.some((m) => m.id === t.milestoneId)),
    },
  ],

  due: (tasks, ctx) => {
    const byKey = new Map(DUE_BUCKETS.map((b) => [b.key, { ...b, tasks: [] }]));
    for (const task of tasks) byKey.get(dueBucket(task, ctx)).tasks.push(task);
    return [...byKey.values()];
  },
};

/**
 * groupTasks(tasks, key, ctx) → [{ key, label, tone?, tasks }]
 *
 * Empty groups are dropped: a header with nothing under it is noise, and
 * the board is where the shape of the project lives.
 */
export function groupTasks(tasks, key, ctx) {
  const grouper = GROUPERS[key];
  if (!grouper) return tasks.length ? [{ key: 'all', label: 'All tasks', tasks }] : [];
  return grouper(tasks, ctx).filter((g) => g.tasks.length);
}
