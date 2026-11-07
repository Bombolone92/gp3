/**
 * Due-date reminders.
 *
 * The honest constraint: there is no backend by design, so a reminder can
 * only fire while the app is running. Everything here is built around that —
 * a reminder is "pending" from the day it comes due until it is shown, so
 * opening the app on Thursday still surfaces Tuesday's reminder rather than
 * having silently missed it.
 *
 * Stored on the task, no new machinery:
 *   remindOffset  days before the due date (0 = on the day)
 *   remindedOn    the date it last fired, so it fires once a day at most
 */

import { addDays, todayISO } from './dates.js';
import { doneColumnIds } from './board.js';

export const REMINDER_OFFSETS = [
  { value: 0, label: 'On the due date' },
  { value: 1, label: 'A day before' },
  { value: 2, label: 'Two days before' },
  { value: 7, label: 'A week before' },
];

export function hasReminder(task) {
  return !!task?.dueDate && Number.isFinite(task?.remindOffset);
}

/** The day a task's reminder comes due, or null when it has none. */
export function reminderDate(task) {
  if (!hasReminder(task)) return null;
  return addDays(task.dueDate, -Math.abs(task.remindOffset));
}

/**
 * Pending = the day has arrived (or passed), the task is not finished, and
 * it has not already been shown today.
 */
export function reminderPending(task, { today = todayISO(), done = false } = {}) {
  if (done) return false;
  const at = reminderDate(task);
  if (!at) return false;
  if (at > today) return false;
  return task.remindedOn !== today;
}

/** Everything a reminder pass should raise, newest deadline first. */
export function collectReminders(sources, today = todayISO()) {
  const rows = [];
  for (const { entry, doc } of sources) {
    if (!doc || entry?.archived) continue;
    const doneIds = doneColumnIds(doc);
    for (const task of doc.tasks) {
      if (!reminderPending(task, { today, done: doneIds.has(task.columnId) })) continue;
      rows.push({ projectId: entry.id, projectName: entry.name, task });
    }
  }
  rows.sort((a, b) => String(a.task.dueDate).localeCompare(String(b.task.dueDate)));
  return rows;
}

/** How a reminder reads: relative to the due date it is about. */
export function describeReminder(task, today = todayISO()) {
  if (!hasReminder(task)) return '';
  const due = task.dueDate;
  if (due === today) return 'due today';
  if (due < today) return 'overdue';
  if (due === addDays(today, 1)) return 'due tomorrow';
  return `due ${due}`;
}
