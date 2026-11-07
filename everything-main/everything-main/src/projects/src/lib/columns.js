/**
 * Column policy: what a column is allowed to hold about itself.
 *
 * A column was a name and a `done` flag, which left three everyday problems
 * with nowhere to live — a done column that grows without bound, an
 * in-progress column nothing ever pushes back on, and cards in whatever order
 * they were dragged.
 *
 * Pure, and free of the DOM: the board reads these, and they can be tested
 * directly. The normalizers live in the store beside the other document-shape
 * readers, since they guard what gets written.
 */

import { PRIORITIES, normalizeWipLimit } from './store.js';
import { columnTasks, ORDER_GAP } from './board.js';

/** The one-shot sorts a column offers. Deliberately not sticky. */
export const COLUMN_SORTS = [
  { key: 'due', label: 'Due date' },
  { key: 'priority', label: 'Priority' },
  { key: 'title', label: 'Title' },
];

/** Ages a done column can auto-archive at. `null` is off, which is default. */
export const AUTO_ARCHIVE_CHOICES = [
  { value: null, label: 'Off' },
  { value: 3, label: 'After 3 days' },
  { value: 7, label: 'After 7 days' },
  { value: 14, label: 'After 14 days' },
  { value: 30, label: 'After 30 days' },
  { value: 90, label: 'After 90 days' },
];

/**
 * What a column header has to say about its own load. Visible, never
 * enforced: a limit that refuses a drop is a policy this app has no business
 * imposing on one person's own board, and a count that reads "6 / 4" is
 * enough to change what they do next.
 */
export function wipState(column, count) {
  const limit = normalizeWipLimit(column?.wipLimit);
  return {
    count,
    limit,
    over: limit !== null && count > limit,
    at: limit !== null && count === limit,
  };
}

const rankOf = new Map(PRIORITIES.map((p, i) => [p.value, i]));
const text = (v) => String(v ?? '').trim().toLowerCase();

const SORTS = {
  due: {
    empty: (t) => !t.dueDate,
    cmp: (a, b) => String(a.dueDate).localeCompare(String(b.dueDate)),
  },
  priority: {
    empty: (t) => !t.priority,
    cmp: (a, b) => (rankOf.get(a.priority) ?? 0) - (rankOf.get(b.priority) ?? 0),
  },
  title: {
    empty: (t) => !text(t.title),
    cmp: (a, b) => text(a.title).localeCompare(text(b.title)),
  },
};

export function isColumnSortKey(key) {
  return Object.hasOwn(SORTS, key);
}

/**
 * planColumnSort(tasks, columnId, key) → [{ id, order }]
 *
 * One shot, one column: it rewrites `order` for these cards and touches
 * nothing else, so the rest of the board keeps the arrangement someone made
 * by hand. A card with nothing to sort by sinks to the bottom rather than
 * leading the column, the same rule the list view's sorts follow.
 *
 * Returns [] when the column is already in that order — a no-op should cost
 * no write, and should not offer an undo for nothing.
 */
export function planColumnSort(tasks, columnId, key) {
  const spec = SORTS[key];
  const current = columnTasks(tasks ?? [], columnId);
  if (!spec || current.length < 2) return [];

  const sorted = [...current].sort((a, b) => {
    const ea = spec.empty(a) ? 1 : 0;
    const eb = spec.empty(b) ? 1 : 0;
    if (ea !== eb) return ea - eb;
    // Title breaks every tie, so two identical due dates keep a stable,
    // explainable order rather than whichever was dragged last.
    return spec.cmp(a, b) || text(a.title).localeCompare(text(b.title));
  });

  if (sorted.every((t, i) => t.id === current[i].id)) return [];
  return sorted.map((t, i) => ({ id: t.id, order: (i + 1) * ORDER_GAP }));
}
