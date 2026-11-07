/**
 * How a scope is arranged: the sort and the grouping, held per project (and
 * for the cross-project list) the way the filter bar holds a filter.
 *
 * It lives here rather than inside the list view because three things now read
 * and write it — the list, the cross-project list, and saved views — and a
 * saved view that could only reach one of them would not be a view of the
 * project, only of one tab of it.
 *
 * Nothing here writes a task's `order`: sorting stays a view preference, so a
 * list sorted by due date leaves the board's manual arrangement alone.
 */

const states = new Map();

const defaults = (scope) => ({
  sort: { key: 'board', dir: 'asc' },
  // The cross-project list leads with the project; a single project has none
  // to lead with, so it groups by column.
  group: scope === 'all' ? 'project' : 'column',
});

/** The live state object for a scope. Callers mutate it in place. */
export function viewStateFor(scope) {
  if (!states.has(scope)) states.set(scope, defaults(scope));
  return states.get(scope);
}

/** Apply an arrangement wholesale, as a saved view does. */
export function setViewState(scope, { sort, group } = {}) {
  const state = viewStateFor(scope);
  if (sort?.key) state.sort = { key: sort.key, dir: sort.dir === 'desc' ? 'desc' : 'asc' };
  if (group) state.group = group;
  return state;
}
