/**
 * Backup format, and the reading half of import.
 *
 *   backup.json                                      the envelope below
 *   attachments/<projectId>/<taskId>/<attId>-<name>   blobs, when included
 *
 * Envelope (version 2, and version 1 files still import):
 *   { app: 'project-management', version, exportedAt,
 *     projects: [doc, ...],            // full project documents
 *     index:    [entry, ...],          // optional: name/color/archived flags
 *     templates:[template, ...] }      // optional
 *
 * Import always *creates*: every id is regenerated, so importing the same
 * file twice gives two independent copies and can never clobber existing
 * work. That is the whole merge story, deliberately.
 */

import { uid } from './util.js';
import { unzip } from './zip.js';
import { isValidISO, todayISO } from './dates.js';
import { normalizeRecurrence } from './recurrence.js';
import { PROJECT_COLORS, LABEL_COLORS, normalizeColor } from './colors.js';

export const BACKUP_APP = 'project-management';
export const BACKUP_VERSION = 2;
export const BACKUP_JSON_NAME = 'backup.json';

export function attachmentEntryPath(projectId, taskId, att) {
  return `attachments/${projectId}/${taskId}/${att.id}-${att.name}`;
}

/**
 * Read a picked file: either the bare JSON or a zip holding it plus blobs.
 * Returns { data, files } where files maps entry path → Blob.
 */
export async function parseBackupFile(file) {
  const name = String(file.name || '').toLowerCase();
  const looksZip = name.endsWith('.zip') || await hasZipSignature(file);

  if (!looksZip) {
    return { data: parseJson(await file.text()), files: new Map() };
  }

  const entries = await unzip(file);
  const jsonEntry = entries.find((e) => e.name === BACKUP_JSON_NAME)
    || entries.find((e) => e.name.endsWith('.json'));
  if (!jsonEntry) throw new Error('That ZIP has no backup.json inside');
  const files = new Map(entries.filter((e) => e !== jsonEntry).map((e) => [e.name, e.blob]));
  return { data: parseJson(await jsonEntry.blob.text()), files };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON');
  }
}

async function hasZipSignature(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b;
}

/** Throws with a readable reason when the envelope is not ours or too new. */
export function validateBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('That file is not a Project Management backup');
  }
  if (data.app !== BACKUP_APP) {
    throw new Error('That file was not exported by this app');
  }
  const version = Number(data.version);
  if (!Number.isFinite(version) || version < 1) {
    throw new Error('That backup has no readable version');
  }
  if (version > BACKUP_VERSION) {
    throw new Error('That backup comes from a newer version of the app');
  }
  if (!Array.isArray(data.projects)) {
    throw new Error('That backup contains no projects');
  }
  return { version, projects: data.projects };
}

/**
 * Rebuild one imported document with fresh ids everywhere, keeping the parts
 * a *backup* must keep (comments, attachment metadata) — unlike duplicating a
 * project, which deliberately drops them.
 *
 * Returns { doc, entry, taskIdMap } where taskIdMap is old → new, so the
 * caller can move each attachment blob to its new path.
 */
const PRIORITY_VALUES = new Set(['urgent', 'high', 'medium', 'low']);

/* Every field a view reads without checking, given the type it reads it as.
   A backup is a file, and files arrive edited, truncated, or written by
   something else: a due date of "tomorrow" reached Intl.DateTimeFormat and
   threw out of the board, Today and All tasks alike, and a description that
   was a number stopped the task sheet opening. Nothing here rejects a file —
   the field is dropped and the task kept. */
const text = (value, fallback = '') => (typeof value === 'string' ? value : fallback);
const date = (value) => (isValidISO(value) ? value : null);
const millis = (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback);

function convertAttachment(a) {
  const kind = a?.kind === 'link' || a?.kind === 'url' ? a.kind : undefined;
  const att = {
    ...a,
    // Kept as the backup spelled them: they name the blob inside the zip.
    // The store gives the copy a fresh id and a safe name when it writes it.
    id: a?.id ?? uid(),
    name: text(a?.name, 'file'),
    size: Number.isFinite(a?.size) && a.size >= 0 ? a.size : 0,
    type: text(a?.type),
    kind,
    path: kind === 'link' ? text(a?.path) : undefined,
    url: kind === 'url' ? text(a?.url) : undefined,
    createdAt: millis(a?.createdAt, 0),
  };
  for (const key of ['kind', 'path', 'url']) if (att[key] === undefined) delete att[key];
  return att;
}

export function prepareImportedProject(raw, { entry = null, now = Date.now() } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('Not a project document');
  const docVersion = Number(raw.v ?? 1);
  if (docVersion > 1) throw new Error('This project was written by a newer version of the app');

  const map = (list, fix = () => ({})) => {
    const ids = new Map();
    const out = (Array.isArray(list) ? list : [])
      .filter((item) => item && typeof item === 'object')
      .map((item, i) => {
        const id = uid();
        ids.set(item.id, id);
        return { ...item, id, name: text(item.name), ...fix(item, i) };
      });
    return { out, ids };
  };

  const { out: members, ids: memberIds } = map(raw.members, (m, i) => ({
    color: normalizeColor(m.color, PROJECT_COLORS[i % PROJECT_COLORS.length]),
  }));
  const { out: labels, ids: labelIds } = map(raw.labels, (l, i) => ({
    color: normalizeColor(l.color, LABEL_COLORS[i % LABEL_COLORS.length]),
  }));
  const { out: columns, ids: columnIds } = map(raw.columns, (c) => ({ done: !!c.done }));
  const { out: milestones, ids: milestoneIds } = map(raw.milestones, (m) => ({
    // A milestone is a date with a name; one without a date is placed today
    // rather than dropped, the way the CSV import treats an undated one.
    date: date(m.date) ?? todayISO(),
    description: text(m.description),
    done: !!m.done,
  }));

  const projectId = uid();
  const taskIdMap = new Map();

  const convert = (task) => {
    const id = uid();
    taskIdMap.set(task?.id, id);
    const columnId = columnIds.get(task?.columnId) ?? columns[0]?.id ?? null;
    const recurrence = normalizeRecurrence(task?.recurrence);
    const out = {
      ...task,
      id,
      title: String(task?.title ?? ''),
      description: text(task?.description),
      columnId,
      order: Number.isFinite(task?.order) ? task.order : 0,
      priority: PRIORITY_VALUES.has(task?.priority) ? task.priority : null,
      startDate: date(task?.startDate),
      dueDate: date(task?.dueDate),
      assigneeIds: (Array.isArray(task?.assigneeIds) ? task.assigneeIds : [])
        .map((x) => memberIds.get(x)).filter(Boolean),
      labelIds: (Array.isArray(task?.labelIds) ? task.labelIds : [])
        .map((x) => labelIds.get(x)).filter(Boolean),
      milestoneId: milestoneIds.get(task?.milestoneId) ?? null,
      checklist: (Array.isArray(task?.checklist) ? task.checklist : [])
        .map((i) => ({ id: uid(), text: String(i?.text ?? ''), done: !!i?.done })),
      comments: (Array.isArray(task?.comments) ? task.comments : []).map((c) => ({
        id: uid(),
        author: String(c?.author ?? 'Unknown'),
        text: String(c?.text ?? ''),
        createdAt: Number(c?.createdAt) || now,
      })),
      attachments: (Array.isArray(task?.attachments) ? task.attachments : [])
        .filter((a) => a && typeof a === 'object').map(convertAttachment),
      createdAt: Number(task?.createdAt) || now,
      updatedAt: Number(task?.updatedAt) || now,
      // The rest only exist on some tasks; a bad value is dropped, not kept.
      recurrence: recurrence ?? undefined,
      recurrenceClosed: task?.recurrenceClosed === undefined ? undefined : !!task.recurrenceClosed,
      remindOffset: Number.isFinite(task?.remindOffset) ? task.remindOffset : undefined,
      remindedOn: date(task?.remindedOn) ?? undefined,
      doneAt: millis(task?.doneAt, undefined),
      deletedAt: millis(task?.deletedAt, undefined),
      archivedAt: millis(task?.archivedAt, undefined),
    };
    for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
    return out;
  };

  const doc = {
    v: 1,
    id: projectId,
    name: String(raw.name ?? entry?.name ?? 'Imported project'),
    color: normalizeColor(raw.color, normalizeColor(entry?.color, PROJECT_COLORS[0])),
    brief: typeof raw.brief === 'string' ? raw.brief : '',
    members,
    labels,
    columns: columns.length ? columns : [{ id: uid(), name: 'To do', done: false }],
    tasks: (Array.isArray(raw.tasks) ? raw.tasks : []).map(convert),
    milestones,
    archive: (Array.isArray(raw.archive) ? raw.archive : []).map(convert),
    trash: (Array.isArray(raw.trash) ? raw.trash : []).map(convert),
  };

  return {
    doc,
    entry: {
      name: doc.name,
      color: doc.color,
      archived: !!entry?.archived,
    },
    taskIdMap,
  };
}

/** Human summary for the pre-import confirmation. */
export function describeBackup(data) {
  const projects = Array.isArray(data.projects) ? data.projects : [];
  const tasks = projects.reduce((n, p) => n + (Array.isArray(p?.tasks) ? p.tasks.length : 0), 0);
  const attachments = projects.reduce((n, p) => n + (Array.isArray(p?.tasks)
    ? p.tasks.reduce((m, t) => m + (Array.isArray(t?.attachments) ? t.attachments.length : 0), 0)
    : 0), 0);
  return {
    projects: projects.length,
    tasks,
    attachments,
    exportedAt: Number(data.exportedAt) || null,
  };
}
