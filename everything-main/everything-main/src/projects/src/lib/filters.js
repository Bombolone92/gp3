/**
 * Task filtering, kept pure so it can be unit-tested and shared by every
 * task view (board today, list later).
 *
 * Semantics: values inside one facet are OR-ed, facets are AND-ed together
 * — the arrangement people expect from every filter bar. Text matches task
 * titles only; descriptions, comments, and attachments are out of scope, so
 * a plain includes() over the in-memory doc is all this needs.
 */

import { diffDays, todayISO } from './dates.js';

export const DUE_FILTERS = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'Due this week' },
  { value: 'none', label: 'No due date' },
];

export function emptyFilter() {
  return { text: '', labelIds: [], assigneeIds: [], priorities: [], due: [] };
}

/** Number of facets in play; 0 means the view is unfiltered. */
export function activeFacets(f) {
  return (f.text.trim() ? 1 : 0)
    + (f.labelIds.length ? 1 : 0)
    + (f.assigneeIds.length ? 1 : 0)
    + (f.priorities.length ? 1 : 0)
    + (f.due.length ? 1 : 0);
}

export function isFilterActive(f) {
  return activeFacets(f) > 0;
}

/**
 * Due buckets. "Overdue" respects done columns (a finished task is late for
 * nobody), while the date buckets are literal so a filter never hides a
 * card whose badge says it is due today.
 */
export function matchesDue(task, bucket, { done = false, today = todayISO() } = {}) {
  if (bucket === 'none') return !task.dueDate;
  if (!task.dueDate) return false;
  const d = diffDays(today, task.dueDate);
  if (bucket === 'overdue') return !done && d < 0;
  if (bucket === 'today') return d === 0;
  if (bucket === 'week') return d >= 0 && d <= 7;
  return false;
}

export function matchesFilter(task, filter, { doneIds = new Set(), today = todayISO() } = {}) {
  const text = filter.text.trim().toLowerCase();
  if (text && !String(task.title || '').toLowerCase().includes(text)) return false;

  if (filter.labelIds.length
    && !filter.labelIds.some((id) => task.labelIds?.includes(id))) return false;

  if (filter.assigneeIds.length
    && !filter.assigneeIds.some((id) => task.assigneeIds?.includes(id))) return false;

  // A null entry is the "no priority" choice, so `?? null` must not be dropped.
  if (filter.priorities.length
    && !filter.priorities.includes(task.priority ?? null)) return false;

  if (filter.due.length) {
    const done = doneIds.has(task.columnId);
    if (!filter.due.some((b) => matchesDue(task, b, { done, today }))) return false;
  }
  return true;
}

export function filterTasks(tasks, filter, ctx) {
  if (!isFilterActive(filter)) return tasks;
  return tasks.filter((t) => matchesFilter(t, filter, ctx));
}
