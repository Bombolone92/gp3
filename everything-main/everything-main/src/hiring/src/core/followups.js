/**
 * Follow-ups: personal commitments hung off a candidate ("call Dana
 * Thursday"), with a due date and an optional time. Stored on the
 * candidate record; due ones feed the reminder pipeline.
 */

import { todayISO, toMinutes } from '../lib/dates.js';

/** Returns a list of human-readable problems; empty when valid. */
export function validateFollowup({ text, dueDate, dueTime }) {
  const errors = [];
  if (!String(text ?? '').trim()) errors.push('Describe the follow-up.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dueDate ?? ''))) errors.push('Pick a due date.');
  if (dueTime && toMinutes(dueTime) === null) errors.push('The due time is malformed.');
  return errors;
}

/**
 * Is this follow-up waiting on you right now? Date-only follow-ups come
 * due at the start of their day; timed ones at their time — which is the
 * only reason to offer a time at all. Null when it is not due (or is
 * done), otherwise { overdue }: lateness is as minute-accurate as
 * due-ness, so a 9:00 follow-up looked at during the afternoon is
 * overdue, not merely due.
 *
 * Every surface that calls a follow-up due reads this, so the board card,
 * the profile chip, the overview, and the notifications cannot disagree
 * about tonight's 23:00 call.
 */
export function followupDue(followup, now = new Date()) {
  if (!followup || followup.done || !followup.dueDate) return null;
  const today = todayISO(now);
  if (followup.dueDate > today) return null;
  const minutes = toMinutes(followup.dueTime);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (followup.dueDate === today && minutes !== null && minutes > nowMinutes) return null;
  return {
    overdue: followup.dueDate < today || (followup.dueDate === today && minutes !== null && minutes < nowMinutes),
  };
}

/**
 * Open follow-ups that are due or overdue right now, soonest first:
 * [{ candidate, followup, overdue }].
 */
export function dueFollowups(state, now = new Date()) {
  const due = [];
  for (const candidate of state.candidates) {
    for (const followup of candidate.followups ?? []) {
      const status = followupDue(followup, now);
      if (status) due.push({ candidate, followup, overdue: status.overdue });
    }
  }
  return due.sort((a, b) =>
    `${a.followup.dueDate} ${a.followup.dueTime ?? ''}`.localeCompare(`${b.followup.dueDate} ${b.followup.dueTime ?? ''}`)
  );
}

/** Open follow-ups first (soonest due first), completed ones last. */
export function sortFollowups(followups) {
  return [...(followups ?? [])].sort((a, b) => {
    if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
    if (a.done) return String(b.completedAt ?? '').localeCompare(String(a.completedAt ?? ''));
    return `${a.dueDate} ${a.dueTime ?? ''}`.localeCompare(`${b.dueDate} ${b.dueTime ?? ''}`);
  });
}
