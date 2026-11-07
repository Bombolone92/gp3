/**
 * Exports a person can read: Markdown and CSV.
 *
 * The backup (#4) is a `.zip` whose only reader is this app's own importer,
 * which makes "your data lives in your own account" a weaker promise than it
 * sounds: with collaboration deliberately absent, export is the only route
 * work has *out* of here. These two are that route — a document to paste into
 * an email, and a table to open in a spreadsheet.
 *
 * Pure: both take a document and the tasks to include, so a filtered view can
 * hand over exactly what it is showing. Attachment bytes belong in the backup
 * zip and are named here, never embedded.
 */

import { fmtShort } from './dates.js';
import { doneColumnIds, columnTasks, milestoneProgress } from './board.js';
import { docBrief, taskChecklist, PRIORITIES } from './store.js';

const priorityLabel = (value) =>
  PRIORITIES.find((p) => p.value === value)?.label ?? null;

/** Tasks in board order, column by column, from the set the caller allows. */
function byColumn(doc, tasks) {
  const allowed = new Set(tasks.map((t) => t.id));
  return doc.columns.map((column) => ({
    column,
    tasks: columnTasks(doc.tasks, column.id).filter((t) => allowed.has(t.id)),
  }));
}

const nameOf = (list, id) => list.find((x) => x.id === id)?.name ?? null;

/** The day this document was written, spelled out with its year. */
export function exportedOn(now = new Date()) {
  return now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Indent every line, blank ones included, so a block stays inside its item. */
function indent(text, pad = '  ') {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
    .map((line) => (line ? pad + line : line)).join('\n');
}

/**
 * One project as a Markdown document: what it is, what is planned, and where
 * everything stands. Descriptions are already Markdown (#10), so this is
 * mostly concatenation rather than conversion.
 */
export function projectMarkdown(doc, {
  tasks = doc.tasks, name = doc.name, now = new Date(),
} = {}) {
  const doneIds = doneColumnIds(doc);
  const lines = [`# ${name ?? 'Project'}`, ''];

  const brief = docBrief(doc).trim();
  if (brief) lines.push(brief, '');

  const total = tasks.length;
  const done = tasks.filter((t) => doneIds.has(t.columnId)).length;
  lines.push(`*${total} task${total === 1 ? '' : 's'}, ${done} done. `
    + `Exported ${exportedOn(now)}.*`, '');

  if (doc.milestones?.length) {
    lines.push('## Milestones', '');
    for (const milestone of [...doc.milestones]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
      const progress = milestoneProgress(doc.tasks, milestone.id, doneIds);
      lines.push(`- **${milestone.name}** — ${fmtShort(milestone.date, now)}`
        + ` · ${progress.done}/${progress.total} done`
        + (milestone.done ? ' · reached' : ''));
      if (milestone.description?.trim()) lines.push(indent(milestone.description.trim(), '  '));
    }
    lines.push('');
  }

  for (const { column, tasks: inColumn } of byColumn(doc, tasks)) {
    if (!inColumn.length) continue;
    lines.push(`## ${column.name} (${inColumn.length})`, '');
    for (const task of inColumn) {
      const isDone = doneIds.has(task.columnId);
      const meta = [
        task.startDate && `starts ${fmtShort(task.startDate, now)}`,
        task.dueDate && `due ${fmtShort(task.dueDate, now)}`,
        priorityLabel(task.priority),
        ...(task.assigneeIds ?? []).map((id) => {
          const who = nameOf(doc.members, id);
          return who ? `@${who}` : null;
        }),
        ...(task.labelIds ?? []).map((id) => {
          const label = nameOf(doc.labels, id);
          return label ? `#${label}` : null;
        }),
        task.milestoneId && nameOf(doc.milestones, task.milestoneId)
          && `milestone: ${nameOf(doc.milestones, task.milestoneId)}`,
      ].filter(Boolean);

      lines.push(`- [${isDone ? 'x' : ' '}] **${task.title || 'Untitled task'}**`
        + (meta.length ? ` — ${meta.join(' · ')}` : ''));

      if (task.description?.trim()) lines.push('', indent(task.description.trim()), '');

      const checklist = taskChecklist(task);
      if (checklist.length) {
        const ticked = checklist.filter((i) => i.done).length;
        lines.push(indent(`Checklist ${ticked}/${checklist.length}:`));
        for (const item of checklist) {
          lines.push(indent(`- [${item.done ? 'x' : ' '}] ${item.text}`, '    '));
        }
      }

      const attachments = (task.attachments ?? []).map((a) => a.name).filter(Boolean);
      // Named, not embedded: the bytes live in the backup zip.
      if (attachments.length) lines.push(indent(`Attachments: ${attachments.join(', ')}`));
    }
    lines.push('');
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

export const CSV_COLUMNS = [
  'Project', 'Task', 'Column', 'Done', 'Priority', 'Assignees', 'Labels',
  'Milestone', 'Start', 'Due', 'Created', 'Updated',
];

/**
 * A cell, quoted only when it has to be. Values are written as they are:
 * this is the user's own text going into the user's own spreadsheet, and
 * mangling a title that happens to start with "=" would be its own bug.
 */
export function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const stamp = (ts) => (Number.isFinite(ts) ? new Date(ts).toISOString() : '');

/**
 * One row per task, flat — the shape a spreadsheet, a timesheet, or an
 * invoice actually wants. Dates stay ISO so a spreadsheet can sort them.
 */
export function projectCsv(doc, { tasks = doc.tasks, name = doc.name } = {}) {
  const doneIds = doneColumnIds(doc);
  const rows = [CSV_COLUMNS.join(',')];

  for (const { column, tasks: inColumn } of byColumn(doc, tasks)) {
    for (const task of inColumn) {
      rows.push([
        name ?? '',
        task.title ?? '',
        column.name,
        doneIds.has(column.id) ? 'yes' : 'no',
        priorityLabel(task.priority) ?? '',
        (task.assigneeIds ?? []).map((id) => nameOf(doc.members, id)).filter(Boolean).join('; '),
        (task.labelIds ?? []).map((id) => nameOf(doc.labels, id)).filter(Boolean).join('; '),
        nameOf(doc.milestones, task.milestoneId) ?? '',
        task.startDate ?? '',
        task.dueDate ?? '',
        stamp(task.createdAt),
        stamp(task.updatedAt),
      ].map(csvCell).join(','));
    }
  }

  // A trailing newline: every tool that reads CSV expects one.
  return `${rows.join('\n')}\n`;
}
