/**
 * Deep copies with fresh ids, for duplicating a task, duplicating a project,
 * and saving a project as a template. Pure (only `uid` comes from outside)
 * so the id remapping can be unit-tested.
 *
 * Comments and attachments are never copied: a duplicate inherits the plan,
 * not the conversation or the blobs.
 */

import { uid } from './util.js';

/** The fields worth carrying from one task to its copy. */
export function cloneTaskFields(task, { resetChecklist = false } = {}) {
  return {
    description: task.description ?? '',
    priority: task.priority ?? null,
    startDate: task.startDate ?? null,
    dueDate: task.dueDate ?? null,
    milestoneId: task.milestoneId ?? null,
    assigneeIds: [...(task.assigneeIds ?? [])],
    labelIds: [...(task.labelIds ?? [])],
    recurrence: task.recurrence ?? null,
    // Whether the series has already handed over travels with the rule.
    // Without it a copy of a *finished* recurring task arrives as a second
    // live carrier sitting in a done column, and the catch-up pass on the
    // next project open dutifully spawns an occurrence nobody asked for.
    recurrenceClosed: !!task.recurrenceClosed,
    checklist: (Array.isArray(task.checklist) ? task.checklist : []).map((i) => ({
      id: uid(),
      text: i.text,
      done: resetChecklist ? false : !!i.done,
    })),
  };
}

/**
 * Copy a whole project document: every member, label, column, milestone, and
 * (optionally) task gets a new id, and every reference is remapped to match.
 * The copy starts with an empty archive and trash.
 */
export function cloneProjectDoc(source, {
  includeTasks = true, name, color, id = uid(), now = Date.now(),
} = {}) {
  const remap = (list = []) => {
    const map = new Map();
    const out = list.map((item) => {
      const fresh = uid();
      map.set(item.id, fresh);
      return { ...item, id: fresh };
    });
    return { out, map };
  };

  const { out: members, map: memberMap } = remap(source.members);
  const { out: labels, map: labelMap } = remap(source.labels);
  const { out: columns, map: columnMap } = remap(source.columns);
  const { out: milestones, map: milestoneMap } = remap(source.milestones);

  const tasks = includeTasks ? (source.tasks ?? []).map((task) => {
    const fields = cloneTaskFields(task);
    return {
      ...fields,
      id: uid(),
      title: task.title ?? '',
      columnId: columnMap.get(task.columnId) ?? columns[0]?.id ?? null,
      order: task.order,
      milestoneId: fields.milestoneId ? milestoneMap.get(fields.milestoneId) ?? null : null,
      assigneeIds: fields.assigneeIds.map((mid) => memberMap.get(mid)).filter(Boolean),
      labelIds: fields.labelIds.map((lid) => labelMap.get(lid)).filter(Boolean),
      comments: [],
      attachments: [],
      createdAt: now,
      updatedAt: now,
    };
  }) : [];

  return {
    v: 1,
    id,
    name: name ?? source.name,
    color: color ?? source.color,
    // A brief is much of what a template is for: the ground rules travel
    // with the structure.
    brief: typeof source.brief === 'string' ? source.brief : '',
    members,
    labels,
    columns,
    tasks,
    milestones,
    archive: [],
    trash: [],
  };
}

/** A template is a project's structure: no tasks, no history. */
export function templateFromDoc(doc, name) {
  const structure = cloneProjectDoc(doc, { includeTasks: false });
  return {
    id: uid(),
    name,
    createdAt: Date.now(),
    columnCount: structure.columns.length,
    labelCount: structure.labels.length,
    milestoneCount: structure.milestones.length,
    doc: structure,
  };
}
