/**
 * Everything the pure list logic needs in order to run over more than one
 * project document.
 *
 * The list view's sorting and grouping (src/lib/list.js) and the filter
 * (src/lib/filters.js) are already pure functions over tasks — what was
 * missing was a *source* that spans documents, which is the job buildAgenda
 * already does for dates. This module is that source, plus the two things
 * that genuinely change when there is more than one board:
 *
 *  - identity by name, not by id. Column, label, member, and milestone ids
 *    are per document, so "everything tagged #design" has to mean the label
 *    called Design in whichever project it lives in. Grouping by column id
 *    across projects would draw "To do" five times and call it five groups.
 *  - what an operation means. Nothing here moves a task between projects;
 *    that is out of scope, and the view disables those actions with a reason.
 */

import { todayISO } from './dates.js';
import { doneColumnIds } from './board.js';
import { groupTasks } from './list.js';
import { orderedProjects } from './projects.js';

/** A name, used as an identity that survives crossing a project boundary. */
export const nameKey = (name) => String(name ?? '').trim().toLowerCase();

/** How the cross-project list can be grouped. Column is by name, never by id. */
export const CROSS_GROUPS = [
  { key: 'project', label: 'Project' },
  { key: 'column', label: 'Column' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'milestone', label: 'Milestone' },
  { key: 'due', label: 'Due date' },
  { key: 'none', label: 'Nothing' },
];

/* Every project gets a slice of the index space wide enough for its columns,
   which is what makes "board order" mean project by project, column by
   column, card by card — and lets sortTasks run unchanged. */
const PROJECT_STRIDE = 10000;

function mergeByName(map, items, entry, extra = () => ({})) {
  for (const item of items ?? []) {
    const key = nameKey(item?.name);
    if (!key) continue;
    const seen = map.get(key);
    if (seen) {
      seen.projects.push(entry.name);
      Object.assign(seen, extra(item, seen));
    } else {
      map.set(key, {
        id: key,
        name: String(item.name),
        color: item.color ?? null,
        projects: [entry.name],
        ...extra(item, null),
      });
    }
  }
}

/**
 * The union facets carry the project on their label when the same name lives
 * in more than one project, so a filter that spans boards says that it does.
 */
function withScope(entries) {
  return entries.map((e) => ({
    ...e,
    label: e.projects.length > 1 ? `${e.name} (${e.projects.length} projects)` : e.name,
  }));
}

/**
 * crossContext([{ entry, doc }], today) → the ctx sortTasks and groupTasks
 * take, widened with the cross-project unions the filter bar and the groupers
 * need. Projects follow the arrangement the sidebar shows (#29), so two views
 * of the same work never disagree about order.
 */
export function crossContext(sources, today = todayISO()) {
  const live = (sources ?? []).filter((s) => s?.doc && !s.entry?.archived);
  const ordered = orderedProjects(live.map((s) => s.entry));
  const rank = new Map(ordered.map((e, i) => [e.id, i]));
  const byId = new Map(live.map((s) => [s.entry.id, s]));

  const columnIndex = new Map();
  const doneIds = new Set();
  const taskProject = new Map();
  const columns = new Map();
  const labels = new Map();
  const members = new Map();
  const milestones = new Map();
  const projects = [];

  for (const entry of ordered) {
    const { doc } = byId.get(entry.id);
    const done = doneColumnIds(doc);
    projects.push({ entry, doc, doneIds: done });
    for (const id of done) doneIds.add(id);

    doc.columns.forEach((column, i) => {
      columnIndex.set(column.id, (rank.get(entry.id) ?? 0) * PROJECT_STRIDE + i);
      const key = nameKey(column.name);
      if (!key) return;
      const seen = columns.get(key);
      if (seen) {
        seen.projects.push(entry.name);
        seen.ids.add(column.id);
        seen.index = Math.min(seen.index, i);
        seen.done = seen.done || done.has(column.id);
      } else {
        columns.set(key, {
          id: key,
          name: String(column.name),
          ids: new Set([column.id]),
          index: i,
          done: done.has(column.id),
          projects: [entry.name],
        });
      }
    });

    for (const task of doc.tasks) taskProject.set(task.id, entry.id);
    mergeByName(labels, doc.labels, entry);
    mergeByName(members, doc.members, entry);
    // The earliest date wins, so a milestone shared by two projects sorts
    // where the nearest of them puts it.
    mergeByName(milestones, doc.milestones, entry, (item, seen) => ({
      date: !seen?.date || String(item.date) < String(seen.date) ? item.date : seen.date,
    }));
  }

  const columnList = [...columns.values()]
    .sort((a, b) => a.index - b.index || a.name.localeCompare(b.name));

  return {
    today,
    doneIds,
    columnIndex,
    projects,
    columns: columnList,
    labels: withScope([...labels.values()]),
    members: withScope([...members.values()]),
    milestones: withScope([...milestones.values()]),
    /** Which project a task came from, and that project's own lookups. */
    projectOf(task) {
      return byId.has(taskProject.get(task?.id))
        ? { ...byId.get(taskProject.get(task.id)), doneIds: doneColumnIds(byId.get(taskProject.get(task.id)).doc) }
        : null;
    },
    projectEntry(task) {
      return byId.get(taskProject.get(task?.id))?.entry ?? null;
    },
    projectDoc(task) {
      return byId.get(taskProject.get(task?.id))?.doc ?? null;
    },
  };
}

/**
 * The filter bar's label and assignee facets hold *names* in this scope, so
 * they have to be translated into ids before the per-project matcher can run.
 *
 * Returns null when this project cannot match at all — a project with no
 * label called Design contributes nothing to a filter for Design, which is
 * not at all the same as "no label facet is set".
 */
export function localFilter(filter, doc) {
  const idsFor = (list, keys) => (list ?? [])
    .filter((x) => keys.includes(nameKey(x.name))).map((x) => x.id);
  const next = { ...filter };

  if (filter.labelIds?.length) {
    next.labelIds = idsFor(doc.labels, filter.labelIds);
    if (!next.labelIds.length) return null;
  }
  if (filter.assigneeIds?.length) {
    next.assigneeIds = idsFor(doc.members, filter.assigneeIds);
    if (!next.assigneeIds.length) return null;
  }
  return next;
}

const CROSS_GROUPERS = {
  project: (tasks, ctx) => ctx.projects.map(({ entry }) => ({
    key: entry.id,
    label: entry.name,
    entry,
    tasks: tasks.filter((t) => ctx.projectEntry(t)?.id === entry.id),
  })),

  // By name: five boards with a "To do" are one group, which is the whole
  // point of looking across them.
  column: (tasks, ctx) => ctx.columns.map((column) => ({
    key: column.id,
    label: column.name,
    projects: column.projects,
    tasks: tasks.filter((t) => column.ids.has(t.columnId)),
  })),

  assignee: (tasks, ctx) => [
    ...ctx.members.map((member) => ({
      key: member.id,
      label: member.label,
      member,
      tasks: tasks.filter((t) => (t.assigneeIds ?? []).some((id) =>
        nameKey(ctx.projectDoc(t)?.members.find((m) => m.id === id)?.name) === member.id)),
    })),
    {
      key: 'none',
      label: 'Unassigned',
      tasks: tasks.filter((t) => !(t.assigneeIds ?? []).length),
    },
  ],

  milestone: (tasks, ctx) => [
    ...[...ctx.milestones]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((milestone) => ({
        key: milestone.id,
        label: milestone.label,
        milestone,
        tasks: tasks.filter((t) => nameKey(ctx.projectDoc(t)?.milestones
          .find((m) => m.id === t.milestoneId)?.name) === milestone.id),
      })),
    {
      key: 'none',
      label: 'No milestone',
      tasks: tasks.filter((t) => !ctx.projectDoc(t)?.milestones
        .some((m) => m.id === t.milestoneId)),
    },
  ],
};

/**
 * groupCrossTasks(tasks, key, ctx) → [{ key, label, tasks }]
 *
 * Date buckets and "nothing" are project-agnostic, so they come straight from
 * the list view's own grouper; the rest are the name-based ones above. Empty
 * groups are dropped, exactly as in the list view.
 */
export function groupCrossTasks(tasks, key, ctx) {
  const grouper = CROSS_GROUPERS[key];
  if (!grouper) return groupTasks(tasks, key, ctx);
  return grouper(tasks, ctx).filter((g) => g.tasks.length);
}
