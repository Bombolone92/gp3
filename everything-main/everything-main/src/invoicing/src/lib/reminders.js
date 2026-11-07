/**
 * Chasing an unpaid invoice: which reminder is due, and what was already
 * sent. Reminder history is the user's own record — it never reaches the
 * paper or the public share page, because that is a note to self, not a line
 * for the client.
 */

import { daysBetween } from './dates.js';
import { dueDateFor } from './doc.js';

/** The three escalation stages, keyed by their template. */
export const REMINDER_STAGES = {
  reminderUpcoming: { label: 'Before due', tone: 'info' },
  reminderDue: { label: 'Just overdue', tone: 'warn' },
  reminderLate: { label: '30+ days late', tone: 'bad' },
};

/**
 * How late an invoice is, in whole days (negative before the due date).
 * On a payment plan that is the earliest installment still open, so the
 * wording escalates with the part that is actually late rather than waiting
 * for the final date.
 */
export function daysLate(doc, today) {
  const due = dueDateFor(doc);
  return due ? daysBetween(due, today) : 0;
}

/** The stage whose wording fits this invoice today. */
export function reminderStage(doc, today) {
  const late = daysLate(doc, today);
  if (late <= 0) return 'reminderUpcoming';
  if (late < 30) return 'reminderDue';
  return 'reminderLate';
}

/** "1 day" / "12 days" — reminders read as prose, not as arithmetic. */
export function dayCount(n) {
  const days = Math.max(0, Math.round(Number(n) || 0));
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** Placeholder values a reminder adds on top of the document's own. */
export function reminderValues(doc, today) {
  const late = daysLate(doc, today);
  return {
    days: late > 0 ? dayCount(late) : '',
    daysUntil: late < 0 ? dayCount(-late) : '',
  };
}

export function reminders(doc) {
  return Array.isArray(doc?.reminders) ? doc.reminders : [];
}

/** The most recent reminder sent for a document, or null. */
export function lastReminder(doc) {
  const list = reminders(doc);
  if (!list.length) return null;
  return list.reduce((a, b) => ((b.date || '') >= (a.date || '') ? b : a));
}

const whenAgo = (days) => (days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`);

/**
 * The answer to "did I already chase this?", short enough for a list row.
 * Returns '' for a document nobody needs to chase.
 */
export function reminderNote(doc, today) {
  const list = reminders(doc);
  const last = lastReminder(doc);
  if (!last) return 'Not reminded yet';
  const when = whenAgo(daysBetween(last.date, today));
  return list.length > 1
    ? `Reminded ${list.length}×, last ${when}`
    : `Reminded ${when}`;
}
