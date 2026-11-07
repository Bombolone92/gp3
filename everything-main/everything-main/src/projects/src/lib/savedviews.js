/**
 * Saved views: a named filter + sort + group, per project (or for the
 * cross-project list).
 *
 * Every way of looking at a project used to be thrown away when it closed —
 * the filter bar held a filter for the session, the list held its sort and
 * group, and neither outlived the tab. Each of those was the right call on its
 * own, and together they meant the question asked every morning had to be
 * reassembled every morning.
 *
 * Pure here: the shape, the built-ins, the comparison that decides which chip
 * is active, and the pruning that makes a view degrade honestly when the label
 * it filtered by has since been deleted.
 */

import { emptyFilter, DUE_FILTERS } from './filters.js';

/** The cross-project list's scope; every other scope is a project id. */
export const ALL_SCOPE = 'all';

const filterOf = (patch) => ({ ...emptyFilter(), ...patch });

/**
 * Views that need no setup, presented exactly like saved ones — so the
 * feature explains itself the first time it is seen.
 */
export const BUILT_IN_VIEWS = [
  {
    id: 'built-in:overdue',
    name: 'Overdue',
    builtIn: true,
    filter: filterOf({ due: ['overdue'] }),
    sort: { key: 'due', dir: 'asc' },
    group: 'column',
  },
  {
    id: 'built-in:high',
    name: 'High priority',
    builtIn: true,
    filter: filterOf({ priorities: ['urgent', 'high'] }),
    sort: { key: 'priority', dir: 'asc' },
    group: 'column',
  },
  {
    id: 'built-in:unscheduled',
    name: 'Unscheduled',
    builtIn: true,
    filter: filterOf({ due: ['none'] }),
    sort: { key: 'board', dir: 'asc' },
    group: 'column',
  },
];

const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);

/**
 * A stored view, sanitized. The due buckets are checked against the ones that
 * exist, because a bucket this app does not know is a filter that would match
 * nothing at all; sort and group keys are only checked for shape, since
 * `sortTasks` and `groupTasks` already fall back on anything they do not
 * recognize. (This module deliberately imports nothing but the filter shape:
 * the store loads views on boot, so a dependency on the store here would be a
 * cycle at the worst possible moment.)
 */
export function normalizeSavedView(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  const name = String(raw.name ?? '').trim();
  if (!name) return null;
  const filter = raw.filter ?? {};
  const dueValues = DUE_FILTERS.map((d) => d.value);
  return {
    id: raw.id,
    name: name.slice(0, 60),
    scope: typeof raw.scope === 'string' ? raw.scope : ALL_SCOPE,
    filter: {
      text: typeof filter.text === 'string' ? filter.text : '',
      labelIds: strings(filter.labelIds),
      assigneeIds: strings(filter.assigneeIds),
      // The "no priority" choice is a deliberate null, so it has to survive.
      priorities: (Array.isArray(filter.priorities) ? filter.priorities : [])
        .filter((p) => typeof p === 'string' || p === null || p === undefined)
        .map((p) => p ?? null),
      due: strings(filter.due).filter((d) => dueValues.includes(d)),
    },
    sort: {
      key: typeof raw.sort?.key === 'string' ? raw.sort.key : 'board',
      dir: raw.sort?.dir === 'desc' ? 'desc' : 'asc',
    },
    group: typeof raw.group === 'string' && raw.group ? raw.group : 'column',
    createdAt: Number(raw.createdAt) || Date.now(),
  };
}

/** Saved views for one scope, in the order the user arranged them. */
export function viewsForScope(views, scope) {
  return (Array.isArray(views) ? views : [])
    .map(normalizeSavedView)
    .filter((v) => v && v.scope === scope);
}

/** Built-ins first, then saved: the chips a scope shows, left to right. */
export function chipsForScope(views, scope) {
  return [...BUILT_IN_VIEWS, ...viewsForScope(views, scope)];
}

const sameSet = (a, b) => {
  const left = [...(a ?? [])];
  const right = [...(b ?? [])];
  if (left.length !== right.length) return false;
  return left.every((v) => right.includes(v));
};

/**
 * Which chip is lit. A view is filter *and* arrangement, but the chips sit on
 * the filter bar and what people read off the board is the filter — so the
 * filter is what decides, and changing the grouping afterwards does not make
 * the chip a lie.
 */
export function sameViewFilter(a, b) {
  return String(a?.text ?? '').trim() === String(b?.text ?? '').trim()
    && sameSet(a?.labelIds, b?.labelIds)
    && sameSet(a?.assigneeIds, b?.assigneeIds)
    && sameSet(a?.priorities, b?.priorities)
    && sameSet(a?.due, b?.due);
}

/**
 * Drop the label and assignee ids a scope no longer has, and say how many
 * went — a view that silently returns nothing because the label it filtered by
 * was deleted is the worst outcome this feature can have.
 *
 * `available` is what the scope offers now: for a project, its own label and
 * member ids; for the cross-project list, the names it unions by.
 */
export function pruneViewFilter(filter, available = {}) {
  const labels = new Set(available.labelIds ?? []);
  const members = new Set(available.assigneeIds ?? []);
  const keptLabels = (filter.labelIds ?? []).filter((id) => labels.has(id));
  const keptMembers = (filter.assigneeIds ?? []).filter((id) => members.has(id));
  const dropped = (filter.labelIds ?? []).length - keptLabels.length
    + (filter.assigneeIds ?? []).length - keptMembers.length;
  return {
    filter: { ...filter, labelIds: keptLabels, assigneeIds: keptMembers },
    dropped,
  };
}

/** Move a view within its own scope; returns the whole list, reordered. */
export function planViewReorder(views, scope, id, toIndex) {
  const list = Array.isArray(views) ? [...views] : [];
  const inScope = list.filter((v) => v?.scope === scope);
  const from = inScope.findIndex((v) => v.id === id);
  if (from < 0) return null;
  const moved = inScope.splice(from, 1)[0];
  inScope.splice(Math.max(0, Math.min(toIndex, inScope.length)), 0, moved);
  if (inScope.every((v, i) => v.id === (list.filter((x) => x?.scope === scope)[i]?.id))) return null;
  // Views of other scopes keep their places; this scope's are laid back down
  // in their new order.
  const queue = [...inScope];
  return list.map((v) => (v?.scope === scope ? queue.shift() : v));
}
