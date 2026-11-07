/**
 * The cross-project agenda: every dated, unfinished task from every project
 * you have not archived, bucketed by when it is due.
 *
 * Pure — it takes loaded documents and returns rows — so the view, the
 * sidebar badge, and (later) reminders all read the same answer.
 */

import { todayISO, diffDays } from './dates.js';
import { doneColumnIds } from './board.js';
import { PRIORITIES } from './store.js';

export const AGENDA_GROUPS = [
  { key: 'overdue', label: 'Overdue', tone: 'overdue' },
  { key: 'today', label: 'Today', tone: 'today' },
  { key: 'week', label: 'This week', tone: 'soon' },
  { key: 'later', label: 'Later', tone: '' },
];

/** Which group a due date falls in, or null when it is not dated. */
export function agendaBucket(dueISO, today = todayISO()) {
  if (!dueISO) return null;
  const d = diffDays(today, dueISO);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= 7) return 'week';
  return 'later';
}

const PRIORITY_RANK = new Map(PRIORITIES.map((p, i) => [p.value, i]));
const rank = (task) => PRIORITY_RANK.get(task.priority) ?? PRIORITIES.length;

/**
 * buildAgenda([{ entry, doc }]) → { groups, counts }
 *
 * Archived projects are left out (that is what archiving is for), as is
 * anything already sitting in a done column.
 */
export function buildAgenda(sources, today = todayISO()) {
  const groups = { overdue: [], today: [], week: [], later: [] };

  for (const { entry, doc } of sources) {
    if (!doc || entry?.archived) continue;
    const doneIds = doneColumnIds(doc);
    for (const task of doc.tasks) {
      if (doneIds.has(task.columnId)) continue;
      const bucket = agendaBucket(task.dueDate, today);
      if (!bucket) continue;
      groups[bucket].push({
        projectId: entry.id,
        projectName: entry.name,
        projectColor: entry.color,
        column: doc.columns.find((c) => c.id === task.columnId) ?? null,
        task,
      });
    }
  }

  for (const list of Object.values(groups)) {
    list.sort((a, b) =>
      String(a.task.dueDate).localeCompare(String(b.task.dueDate))
      || rank(a.task) - rank(b.task)
      || String(a.projectName).localeCompare(String(b.projectName)));
  }

  const counts = {
    overdue: groups.overdue.length,
    today: groups.today.length,
    week: groups.week.length,
    later: groups.later.length,
  };
  // What a badge should shout about: late, or due right now.
  counts.due = counts.overdue + counts.today;
  counts.total = counts.due + counts.week + counts.later;
  return { groups, counts };
}
