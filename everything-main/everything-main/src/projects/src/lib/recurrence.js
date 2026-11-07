/**
 * Repeat rules: `{ freq: 'daily' | 'weekly' | 'monthly', interval: n }`.
 *
 * There is no scheduler and no backend. The next occurrence is materialized
 * at two cheap moments instead: when a recurring task reaches a done column,
 * and defensively when a project is opened. Dates are date-only strings, so
 * everything here is plain string arithmetic.
 */

import { addDays, addMonths, diffDays, todayISO, isValidISO } from './dates.js';

export const RECURRENCE_FREQS = [
  { value: 'daily', label: 'Day', plural: 'days' },
  { value: 'weekly', label: 'Week', plural: 'weeks' },
  { value: 'monthly', label: 'Month', plural: 'months' },
];

const MAX_INTERVAL = 30;
// Enough to catch up on a task nobody touched for years, without looping away
// on a nonsense date.
const MAX_ADVANCES = 400;

export function normalizeRecurrence(rule) {
  if (!rule || typeof rule !== 'object') return null;
  const freq = RECURRENCE_FREQS.find((f) => f.value === rule.freq)?.value;
  if (!freq) return null;
  const raw = Number(rule.interval);
  const interval = Number.isFinite(raw) ? Math.min(MAX_INTERVAL, Math.max(1, Math.round(raw))) : 1;
  return { freq, interval };
}

/** "Every week" / "Every 3 days" */
export function describeRecurrence(rule) {
  const normalized = normalizeRecurrence(rule);
  if (!normalized) return '';
  const info = RECURRENCE_FREQS.find((f) => f.value === normalized.freq);
  return normalized.interval === 1
    ? `Every ${info.label.toLowerCase()}`
    : `Every ${normalized.interval} ${info.plural}`;
}

/** Shift one date by `times` intervals of the rule. */
export function shiftByRule(iso, rule, times = 1) {
  const normalized = normalizeRecurrence(rule);
  if (!normalized || !isValidISO(iso)) return iso;
  const steps = normalized.interval * times;
  if (normalized.freq === 'daily') return addDays(iso, steps);
  if (normalized.freq === 'weekly') return addDays(iso, steps * 7);
  return addMonths(iso, steps);
}

/**
 * Dates for the occurrence that follows `task`.
 *
 * The anchor is the task's own due date (or its start date), advanced by whole
 * intervals until it is no longer in the past — completing a monthly task
 * three months late still produces a *next* occurrence, not a stale one. A
 * task with no dates simply has none, which is a perfectly good repeating
 * chore.
 */
export function nextOccurrenceDates(task, rule, today = todayISO()) {
  const normalized = normalizeRecurrence(rule);
  const anchor = task.dueDate || task.startDate || null;
  if (!normalized || !anchor || !isValidISO(anchor)) {
    return { startDate: task.startDate ?? null, dueDate: task.dueDate ?? null };
  }

  let times = 1;
  let next = shiftByRule(anchor, normalized, times);
  while (diffDays(today, next) < 0 && times < MAX_ADVANCES) {
    times += 1;
    next = shiftByRule(anchor, normalized, times);
  }

  // Keep the start/due gap the user set up.
  const span = task.startDate && task.dueDate && isValidISO(task.startDate)
    ? diffDays(task.startDate, task.dueDate) : null;

  if (!task.dueDate) return { startDate: next, dueDate: null };
  return {
    startDate: span === null ? (task.startDate ?? null) : addDays(next, -span),
    dueDate: next,
  };
}

/** A task is the live carrier of its series until it spawns a successor. */
export function isRecurring(task) {
  return !!normalizeRecurrence(task?.recurrence) && !task?.recurrenceClosed;
}
