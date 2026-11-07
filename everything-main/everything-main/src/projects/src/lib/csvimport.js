/**
 * CSV import: Asana's export, and any spreadsheet with a header row.
 *
 * Nobody adopts a project management tool empty-handed, and until now the only
 * way in was retyping. This half reads the file and turns rows into a project
 * *document* — the same shape a backup carries — so the store's existing
 * normalization (`prepareImportedProject`) is what actually writes it, path
 * traversal guard and all.
 *
 * Pure, and deliberately narrow: a header row, one row per task, and a mapping
 * from column to field that the user can correct before anything is written.
 */

import { uid } from './util.js';
import { PRIORITIES, LABEL_COLORS, PROJECT_COLORS } from './store.js';
import { isValidISO, todayISO } from './dates.js';

/** Fields a CSV column can become. `null` is "skip this column". */
export const CSV_FIELDS = [
  { key: 'title', label: 'Task title', hint: 'Required. A row with no title is skipped' },
  { key: 'description', label: 'Description' },
  { key: 'column', label: 'Column or section' },
  { key: 'due', label: 'Due date' },
  { key: 'start', label: 'Start date' },
  { key: 'priority', label: 'Priority' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'labels', label: 'Labels or tags' },
  { key: 'milestone', label: 'Milestone' },
  { key: 'done', label: 'Done or completed' },
];

/* What each field is usually called, in the exports people actually have.
   Longest match wins, so "Due Date" beats "Date". */
const HEADER_HINTS = {
  title: ['task name', 'task title', 'name', 'title', 'task', 'summary', 'subject'],
  description: ['description', 'notes', 'note', 'details', 'body'],
  column: ['section/column', 'section', 'column', 'list', 'status', 'stage', 'bucket'],
  due: ['due date', 'due at', 'due on', 'due', 'deadline', 'end date'],
  start: ['start date', 'start at', 'start on', 'start', 'begin'],
  priority: ['priority', 'importance'],
  assignee: ['assignee', 'assigned to', 'owner', 'responsible'],
  labels: ['labels', 'label', 'tags', 'tag', 'categories'],
  milestone: ['milestone', 'epic', 'phase', 'release'],
  done: ['completed at', 'completed', 'complete', 'done', 'is done', 'finished'],
};

/**
 * Split CSV text into rows of cells (RFC 4180: quoted cells may hold commas,
 * newlines, and doubled quotes). A BOM, CRLF, and a trailing newline are all
 * things real exports contain, so all three are handled here rather than by
 * every caller.
 */
export function parseCsv(text) {
  const source = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let i = 0;

  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { endCell(); rows.push(row); row = []; };

  while (i < source.length) {
    const char = source[i];

    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false;
        i++;
        continue;
      }
      cell += char;
      i++;
      continue;
    }

    if (char === '"' && cell === '') { quoted = true; i++; continue; }
    if (char === ',') { endCell(); i++; continue; }
    if (char === '\r') { i++; continue; }
    if (char === '\n') { endRow(); i++; continue; }
    cell += char;
    i++;
  }

  // Whatever is left is a final row, unless the file ended on a newline.
  if (cell !== '' || row.length) endRow();
  // Rows of nothing but empty cells are blank lines, not tasks.
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

const norm = (text) => String(text ?? '').trim().toLowerCase();

/**
 * Guess what each header is. Only the first column that matches a field takes
 * it, so a file with both "Name" and "Task Name" does not map two columns onto
 * the title.
 */
export function detectColumns(headers) {
  const taken = new Set();
  const mapping = headers.map(() => null);
  // Fields in order of how much a wrong guess would cost.
  for (const field of ['title', 'column', 'due', 'start', 'description', 'assignee',
    'labels', 'priority', 'milestone', 'done']) {
    const hints = HEADER_HINTS[field] ?? [];
    let best = -1;
    let bestScore = -1;
    headers.forEach((header, index) => {
      if (mapping[index] || taken.has(field)) return;
      const name = norm(header);
      const hit = hints.find((hint) => name === hint) ? 2
        : hints.find((hint) => name.includes(hint)) ? 1 : 0;
      if (hit > bestScore) { bestScore = hit; best = index; }
    });
    if (bestScore > 0 && best >= 0) { mapping[best] = field; taken.add(field); }
  }
  return mapping;
}

const TRUTHY = new Set(['yes', 'true', '1', 'y', 'done', 'complete', 'completed', 'x']);
const FALSY = new Set(['', 'no', 'false', '0', 'n', 'incomplete', 'not done']);

/** Whether a "done" cell means done. A date in it counts as yes. */
export function meansDone(value) {
  const text = norm(value);
  if (FALSY.has(text)) return false;
  if (TRUTHY.has(text)) return true;
  // Asana writes a completion *timestamp*, so anything else non-empty is a yes.
  return text.length > 0;
}

const PRIORITY_ALIASES = new Map([
  ['urgent', 'urgent'], ['critical', 'urgent'], ['highest', 'urgent'], ['p0', 'urgent'],
  ['high', 'high'], ['p1', 'high'],
  ['medium', 'medium'], ['normal', 'medium'], ['med', 'medium'], ['p2', 'medium'],
  ['low', 'low'], ['lowest', 'low'], ['minor', 'low'], ['p3', 'low'],
]);

/** A priority this app has, or null — with `false` meaning "said something we
 *  could not use", so the report can count it. */
export function readPriority(value) {
  const text = norm(value);
  if (!text) return null;
  const mapped = PRIORITY_ALIASES.get(text)
    ?? PRIORITIES.find((p) => p.value === text)?.value;
  return mapped ?? false;
}

/**
 * A date-only ISO string, or null; `false` for a value that meant something
 * this app will not guess at. Only unambiguous forms are accepted — "03/04/26"
 * is either March or April depending on where you live, and silently choosing
 * one is worse than saying it was skipped.
 */
export function readDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const iso = text.slice(0, 10).replace(/\//g, '-');
  if (isValidISO(iso)) return iso;
  return false;
}

const splitList = (value) => String(value ?? '')
  .split(/[,;|]/).map((v) => v.trim()).filter(Boolean);

/**
 * csvToProject(rows, mapping, { name }) → { doc, report }
 *
 * `rows[0]` is the header row; `mapping[i]` is the field column i becomes, or
 * null to skip it. The document uses its own ids: the store regenerates every
 * one of them on the way in.
 */
export function csvToProject(rows, mapping, { name = 'Imported project', now = Date.now() } = {}) {
  const [, ...body] = rows;
  const field = (row, key) => {
    const index = mapping.indexOf(key);
    return index >= 0 ? row[index] : undefined;
  };

  const report = {
    tasks: 0,
    skippedRows: 0,
    unreadableDates: 0,
    unreadablePriorities: 0,
    notes: [],
  };

  const columns = new Map();   // name → column
  const labels = new Map();
  const members = new Map();
  const milestones = new Map();
  const tasks = [];
  let doneColumn = null;

  const columnFor = (label) => {
    const key = norm(label) || 'imported';
    if (!columns.has(key)) {
      columns.set(key, { id: uid(), name: String(label ?? '').trim() || 'Imported', done: false });
    }
    return columns.get(key);
  };

  for (const row of body) {
    const title = String(field(row, 'title') ?? '').trim();
    if (!title) { report.skippedRows++; continue; }

    const done = mapping.includes('done') ? meansDone(field(row, 'done')) : false;
    let column;
    if (done) {
      // A finished task needs somewhere finished to be, and a column is how
      // this app knows what "done" means.
      if (!doneColumn) doneColumn = { id: uid(), name: 'Done', done: true };
      column = doneColumn;
    } else {
      column = columnFor(mapping.includes('column') ? field(row, 'column') : 'Imported');
    }

    const due = readDate(field(row, 'due'));
    const start = readDate(field(row, 'start'));
    if (due === false || start === false) report.unreadableDates++;

    const priority = mapping.includes('priority') ? readPriority(field(row, 'priority')) : null;
    if (priority === false) report.unreadablePriorities++;

    const assigneeIds = [];
    for (const person of splitList(field(row, 'assignee'))) {
      const key = norm(person);
      if (!members.has(key)) {
        members.set(key, {
          id: uid(),
          name: person,
          color: PROJECT_COLORS[members.size % PROJECT_COLORS.length],
        });
      }
      assigneeIds.push(members.get(key).id);
    }

    const labelIds = [];
    for (const tag of splitList(field(row, 'labels'))) {
      const key = norm(tag);
      if (!labels.has(key)) {
        labels.set(key, {
          id: uid(), name: tag, color: LABEL_COLORS[labels.size % LABEL_COLORS.length],
        });
      }
      labelIds.push(labels.get(key).id);
    }

    let milestoneId = null;
    const milestoneName = String(field(row, 'milestone') ?? '').trim();
    if (milestoneName) {
      const key = norm(milestoneName);
      if (!milestones.has(key)) {
        milestones.set(key, { id: uid(), name: milestoneName, date: null, done: false });
      }
      const milestone = milestones.get(key);
      // A milestone in this app is a *dated* target, so it takes the latest
      // due date of the work pointing at it.
      if (due && (!milestone.date || due > milestone.date)) milestone.date = due;
      milestoneId = milestone.id;
    }

    tasks.push({
      id: uid(),
      title: title.slice(0, 200),
      description: String(field(row, 'description') ?? '').trim(),
      columnId: column.id,
      order: (tasks.length + 1) * 1024,
      assigneeIds,
      labelIds,
      priority: priority || null,
      startDate: start || null,
      dueDate: due || null,
      milestoneId,
      checklist: [],
      comments: [],
      attachments: [],
      createdAt: now,
      updatedAt: now,
    });
    report.tasks++;
  }

  const columnList = [...columns.values()];
  if (!columnList.length && !doneColumn) columnList.push({ id: uid(), name: 'Imported', done: false });
  if (doneColumn) columnList.push(doneColumn);

  // Undated milestones would be targets with no target date; today is the
  // least misleading stand-in, and the report says it happened.
  const undated = [...milestones.values()].filter((m) => !m.date);
  for (const milestone of undated) milestone.date = todayISO();
  if (undated.length) {
    const one = undated.length === 1;
    report.notes.push(`${undated.length} milestone${one ? '' : 's'} had no date of `
      + `${one ? 'its' : 'their'} own, so ${one ? 'it was' : 'they were'} dated today`);
  }
  if (report.unreadableDates) {
    const one = report.unreadableDates === 1;
    report.notes.push(`${report.unreadableDates} date${one ? '' : 's'} could not be read `
      + `(only YYYY-MM-DD is unambiguous) and ${one ? 'was' : 'were'} left empty`);
  }
  if (report.unreadablePriorities) {
    const one = report.unreadablePriorities === 1;
    report.notes.push(`${report.unreadablePriorities} priorit${one ? 'y' : 'ies'} did not match `
      + `Urgent, High, Medium, or Low and ${one ? 'was' : 'were'} left unset`);
  }
  const skippedFields = mapping.filter((m) => m === null).length;
  if (skippedFields) {
    const one = skippedFields === 1;
    report.notes.push(`${skippedFields} column${one ? '' : 's'} in the file `
      + `${one ? 'was' : 'were'} not imported`);
  }

  return {
    doc: {
      v: 1,
      id: uid(),
      name,
      color: PROJECT_COLORS[0],
      brief: '',
      members: [...members.values()],
      labels: [...labels.values()],
      columns: columnList,
      tasks,
      milestones: [...milestones.values()],
      archive: [],
      trash: [],
    },
    report: {
      ...report,
      columns: columnList.length,
      labels: labels.size,
      members: members.size,
      milestones: milestones.size,
    },
  };
}
