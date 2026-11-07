/**
 * Pure kanban/timeline logic, kept free of Puter and the DOM so it can be
 * unit-tested directly.
 *
 * Ordering model: every task carries { columnId, order }. Order values are
 * floats; inserting between two neighbours takes their midpoint, so a move
 * touches exactly one task. When midpoints run out of float precision the
 * column is renormalized to whole numbers.
 */

import { diffDays, addDays, todayISO } from './dates.js';

export const ORDER_GAP = 1024;

/** Tasks of one column, in board order. Stable for equal order values. */
export function columnTasks(tasks, columnId) {
  return tasks
    .filter((t) => t.columnId === columnId)
    .sort((a, b) => (a.order - b.order) || String(a.id).localeCompare(String(b.id)));
}

/** Order value that places a new task at the end of a column. */
export function orderForAppend(tasks, columnId) {
  const list = columnTasks(tasks, columnId);
  return list.length ? list[list.length - 1].order + ORDER_GAP : ORDER_GAP;
}

/**
 * Compute the patch that moves `taskId` into `toColumnId` at visual position
 * `toIndex` (0-based, indexes into the destination column *without* the moved
 * task). Returns { order, renormalize } — `renormalize` is a full list of
 * { id, order } rewrites for the destination column when float precision ran
 * out, and null otherwise.
 */
export function computeMove(tasks, taskId, toColumnId, toIndex) {
  const rest = columnTasks(tasks, toColumnId).filter((t) => t.id !== taskId);
  const index = Math.max(0, Math.min(toIndex, rest.length));
  const before = rest[index - 1];
  const after = rest[index];

  let order;
  if (!before && !after) order = ORDER_GAP;
  else if (!before) order = after.order - ORDER_GAP;
  else if (!after) order = before.order + ORDER_GAP;
  else order = (before.order + after.order) / 2;

  // Midpoint collided with a neighbour: rewrite the whole column with
  // fresh whole-number spacing instead.
  if ((before && order <= before.order) || (after && order >= after.order)) {
    const ids = rest.map((t) => t.id);
    ids.splice(index, 0, taskId);
    return {
      order: (index + 1) * ORDER_GAP,
      renormalize: ids.map((id, i) => ({ id, order: (i + 1) * ORDER_GAP })),
    };
  }
  return { order, renormalize: null };
}

/**
 * Translate a drop between *visible* cards into an index in the full column.
 * With a filter active the board shows a subset, so the placeholder's visual
 * position means "after the card I can see", not "after the nth task".
 *
 * `full` is the destination column in board order without the dragged task,
 * `visibleIds` the ids it currently renders, in the same order.
 */
export function realDropIndex(full, visibleIds, visibleIndex) {
  const ids = full.map((t) => t.id);
  const visible = visibleIds.filter((id) => ids.includes(id));
  if (visible.length === full.length) return Math.max(0, Math.min(visibleIndex, full.length));
  if (visibleIndex <= 0) {
    // Above the first visible card — hidden cards above it stay above.
    return visible.length ? ids.indexOf(visible[0]) : full.length;
  }
  if (visibleIndex >= visible.length) {
    // Below the last visible card, rather than below trailing hidden cards:
    // the drop should land where the user saw the gap.
    return ids.indexOf(visible[visible.length - 1]) + 1;
  }
  return ids.indexOf(visible[visibleIndex]);
}

/** Progress of a milestone: counts tasks assigned to it. */
export function milestoneProgress(tasks, milestoneId, doneColumnIds) {
  const assigned = tasks.filter((t) => t.milestoneId === milestoneId);
  const done = assigned.filter((t) => doneColumnIds.has(t.columnId));
  return { total: assigned.length, done: done.length };
}

/**
 * The effective bar for a task on the timeline. Tasks with a single date get
 * a one-day bar; an inverted range is swapped rather than dropped.
 */
export function taskSpan(task) {
  let start = task.startDate || null;
  let end = task.dueDate || null;
  if (!start && !end) return null;
  if (!start) start = end;
  if (!end) end = start;
  if (diffDays(start, end) < 0) [start, end] = [end, start];
  return { start, end };
}

/**
 * Date patch for a timeline reschedule, in whole days.
 *
 *   move   shifts every date the task actually has
 *   start  moves the bar's left edge   → writes startDate
 *   end    moves the bar's right edge  → writes dueDate
 *
 * An edge never crosses the other one, and a task holding a single date
 * gets its counterpart materialized so the bar ends up meaning exactly what
 * the gesture drew. Returns null when nothing would change.
 */
export function shiftTaskDates(task, mode, delta) {
  const span = taskSpan(task);
  if (!span || !delta) return null;

  // An inverted pair is drawn swapped, so the edge that stays put is not
  // always the date field it is drawn from: write it too whenever the stored
  // field does not already say what the bar showed, or that edge jumps.
  if (mode === 'start') {
    let next = addDays(span.start, delta);
    if (diffDays(next, span.end) < 0) next = span.end;
    if (next === span.start) return null;
    return task.dueDate === span.end ? { startDate: next } : { startDate: next, dueDate: span.end };
  }

  if (mode === 'end') {
    let next = addDays(span.end, delta);
    if (diffDays(span.start, next) < 0) next = span.start;
    if (next === span.end) return null;
    return task.startDate === span.start ? { dueDate: next } : { startDate: span.start, dueDate: next };
  }

  const patch = {};
  if (task.startDate) patch.startDate = addDays(task.startDate, delta);
  if (task.dueDate) patch.dueDate = addDays(task.dueDate, delta);
  return Object.keys(patch).length ? patch : null;
}

/**
 * How far an edge drag may travel before it would invert the bar. Preview
 * and commit share it, so the bar never previews a move it cannot make.
 */
export function clampSpanDelta(task, mode, delta) {
  const span = taskSpan(task);
  if (!span) return 0;
  const length = diffDays(span.start, span.end);
  if (mode === 'start') return Math.min(delta, length);
  if (mode === 'end') return Math.max(delta, length ? -length : 0);
  return delta;
}

/**
 * The timeline draws one cell per day, so its window must stay bounded no
 * matter what dates the data holds: one typo ("2126") would otherwise mean
 * tens of thousands of DOM nodes. Bars and markers outside the window are
 * clamped to its edges by the view.
 */
export const TIMELINE_MAX_PAST = 180;
export const TIMELINE_MAX_FUTURE = 400;

/**
 * Date window for the timeline: spans every dated task and milestone plus
 * today, clamped to the bounds above and padded so bars never touch the
 * edges. Always at least ~4 weeks so a nearly-empty project still renders
 * a usable grid.
 */
export function timelineRange(tasks, milestones, today = todayISO()) {
  let min = today;
  let max = today;
  const widen = (iso) => {
    if (!iso) return;
    if (diffDays(min, iso) < 0) min = iso;
    if (diffDays(max, iso) > 0) max = iso;
  };
  for (const t of tasks) {
    const span = taskSpan(t);
    if (span) { widen(span.start); widen(span.end); }
  }
  for (const m of milestones) widen(m.date);

  if (diffDays(min, today) > TIMELINE_MAX_PAST) min = addDays(today, -TIMELINE_MAX_PAST);
  if (diffDays(today, max) > TIMELINE_MAX_FUTURE) max = addDays(today, TIMELINE_MAX_FUTURE);

  min = addDays(min, -3);
  max = addDays(max, 3);
  const shortfall = 27 - diffDays(min, max);
  if (shortfall > 0) max = addDays(max, shortfall);
  return { start: min, end: max, days: diffDays(min, max) + 1 };
}

/** Clamp an ISO date into a timeline range (inclusive). */
export function clampToRange(iso, range) {
  if (diffDays(range.start, iso) < 0) return range.start;
  if (diffDays(iso, range.end) < 0) return range.end;
  return iso;
}

/** Sum of per-column done/total across the whole project. */
export function projectProgress(doc) {
  const doneIds = doneColumnIds(doc);
  const total = doc.tasks.length;
  const done = doc.tasks.filter((t) => doneIds.has(t.columnId)).length;
  return { total, done };
}

/** Columns flagged as "done" hold completed tasks (defaults to the last column). */
export function doneColumnIds(doc) {
  const flagged = doc.columns.filter((c) => c.done).map((c) => c.id);
  if (flagged.length) return new Set(flagged);
  const last = doc.columns[doc.columns.length - 1];
  return new Set(last ? [last.id] : []);
}
