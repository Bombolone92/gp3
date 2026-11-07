/**
 * Calendar export: an RFC 5545 file of all-day events for dated work.
 *
 * Reminders (#17) only fire while the app is open, which is an honest
 * consequence of having no backend of our own — and the one place that costs
 * the user something real. Everyone using this app already carries a device
 * with a calendar on it that notifies reliably, so this hands the problem to
 * software that solved it.
 *
 * Two decisions carry the whole file:
 *
 *  - **All-day events.** Dates here are date-only by deliberate choice (#8),
 *    which maps exactly onto all-day events: no timezone arithmetic, no
 *    invented times, nothing to be wrong about in another zone.
 *  - **Stable UIDs, and a SEQUENCE that moves.** Re-importing an updated file
 *    then *updates* events instead of stacking duplicates, which is the whole
 *    difference between a useful export and a calendar full of triplicates.
 *
 * Pure, and unaware of Puter: it takes documents and returns text.
 */

import { addDays } from './dates.js';
import { taskSpan, doneColumnIds } from './board.js';

/** Where UIDs live. Never a real host — it only has to be stable and ours. */
const UID_DOMAIN = 'project-management.puter';

const PRODID = '-//Puter//Project Management//EN';

/** Escape the four characters RFC 5545 gives meaning to inside a value. */
export function escapeIcsText(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n?|\n/g, '\\n');
}

const byteLength = (text) => (typeof TextEncoder === 'function'
  ? new TextEncoder().encode(text).length
  : Buffer.byteLength(text, 'utf8'));

/**
 * Fold a content line to 75 octets, continuing with CRLF + one space. The
 * limit is in bytes, not characters, so a line of emoji folds where the bytes
 * run out — and a multi-byte character is never split down the middle.
 */
export function foldIcsLine(line) {
  const text = String(line ?? '');
  if (byteLength(text) <= 75) return text;
  const out = [];
  let current = '';
  let limit = 75;
  for (const char of text) {
    if (byteLength(current) + byteLength(char) > limit) {
      out.push(current);
      current = char;
      limit = 74; // the leading space of a continuation line counts
    } else {
      current += char;
    }
  }
  out.push(current);
  return out.join('\r\n ');
}

/** "2026-08-25" → "20260825", the DATE value form. */
export function icsDate(iso) {
  return String(iso ?? '').slice(0, 10).replace(/-/g, '');
}

/** A UTC timestamp for DTSTAMP: "20260820T091500Z". */
export function icsStamp(date = new Date()) {
  return `${date.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

/* Minutes since 2020, so SEQUENCE stays a small, monotonic integer rather
   than an epoch millisecond count no calendar wants to read. */
const SEQ_EPOCH = Date.UTC(2020, 0, 1);

export function icsSequence(updatedAt) {
  const ts = Number(updatedAt);
  if (!Number.isFinite(ts) || ts <= SEQ_EPOCH) return 0;
  return Math.floor((ts - SEQ_EPOCH) / 60000);
}

export const taskUid = (projectId, taskId) => `task-${projectId}-${taskId}@${UID_DOMAIN}`;
export const milestoneUid = (projectId, milestoneId) =>
  `milestone-${projectId}-${milestoneId}@${UID_DOMAIN}`;

const nameOf = (list, id) => (list ?? []).find((x) => x.id === id)?.name ?? null;

/**
 * The events one project contributes: every dated task that is not finished,
 * plus every milestone.
 *
 * A task with both dates spans them; one with a single date is a one-day
 * event, exactly as the timeline draws it. DTEND is exclusive, as the spec
 * requires — an all-day event on the 25th ends on the 26th.
 */
export function projectEvents(doc, {
  entry = null, tasks = doc.tasks, includeTasks = true, includeMilestones = true, baseUrl = '',
} = {}) {
  const projectName = entry?.name ?? doc.name ?? 'Project';
  const projectId = entry?.id ?? doc.id;
  const doneIds = doneColumnIds(doc);
  const events = [];

  if (includeTasks) {
    for (const task of tasks) {
      if (doneIds.has(task.columnId)) continue;
      const span = taskSpan(task);
      if (!span) continue;
      const labels = (task.labelIds ?? []).map((id) => nameOf(doc.labels, id)).filter(Boolean);
      const people = (task.assigneeIds ?? []).map((id) => nameOf(doc.members, id)).filter(Boolean);
      const milestone = nameOf(doc.milestones, task.milestoneId);
      events.push({
        uid: taskUid(projectId, task.id),
        summary: `${projectName}: ${task.title || 'Untitled task'}`,
        start: span.start,
        // Exclusive end: the day after the last day the bar covers.
        end: addDays(span.end, 1),
        sequence: icsSequence(task.updatedAt),
        categories: labels,
        description: [
          task.description?.trim() || null,
          people.length ? `Assigned to ${people.join(', ')}` : null,
          milestone ? `Milestone: ${milestone}` : null,
          baseUrl ? `${baseUrl}#/p/${projectId}/t/${task.id}` : null,
        ].filter(Boolean).join('\n\n'),
        url: baseUrl ? `${baseUrl}#/p/${projectId}/t/${task.id}` : null,
      });
    }
  }

  if (includeMilestones) {
    for (const milestone of doc.milestones ?? []) {
      if (!milestone.date) continue;
      events.push({
        uid: milestoneUid(projectId, milestone.id),
        summary: `${projectName}: ${milestone.name} (milestone)`,
        start: milestone.date,
        end: addDays(milestone.date, 1),
        // Milestones carry no updatedAt, so the date is what changes them.
        sequence: icsSequence(Date.parse(`${milestone.date}T00:00:00Z`)),
        categories: ['Milestone'],
        description: [
          milestone.description?.trim() || null,
          baseUrl ? `${baseUrl}#/p/${projectId}/milestones` : null,
        ].filter(Boolean).join('\n\n'),
        url: baseUrl ? `${baseUrl}#/p/${projectId}/milestones` : null,
      });
    }
  }

  return events;
}

/** Events from several projects, in the order they were given. */
export function calendarEvents(sources, options = {}) {
  return (sources ?? []).flatMap(({ entry, doc }) => (doc
    ? projectEvents(doc, { ...options, entry })
    : []));
}

/**
 * The file itself. TRANSP:TRANSPARENT because a due date is not a meeting:
 * it should not make anyone look busy for the day.
 */
export function buildCalendar(events, { name = 'Projects', now = new Date() } = {}) {
  const stamp = icsStamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(name)}`,
  ];

  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `SEQUENCE:${Math.max(0, Math.floor(event.sequence ?? 0))}`,
      `DTSTART;VALUE=DATE:${icsDate(event.start)}`,
      `DTEND;VALUE=DATE:${icsDate(event.end)}`,
      `SUMMARY:${escapeIcsText(event.summary)}`,
    );
    if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    if (event.url) lines.push(`URL:${event.url}`);
    if (event.categories?.length) {
      lines.push(`CATEGORIES:${event.categories.map(escapeIcsText).join(',')}`);
    }
    lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  // CRLF throughout, and a trailing one: the spec asks for it, and the
  // stricter importers enforce it.
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

/** What the dialog says it is about to write. */
export function countEvents(events) {
  const milestones = events.filter((e) => e.uid.startsWith('milestone-')).length;
  return { total: events.length, milestones, tasks: events.length - milestones };
}
