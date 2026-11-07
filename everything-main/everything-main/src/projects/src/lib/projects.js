/**
 * Arranging the project index: pin, order, and find.
 *
 * `pm:projects:v1` is a flat array in creation order, which stops being an
 * arrangement at about a dozen projects — the two you open every day sit
 * wherever they happened to land. Two fields on the index entry fix that:
 * `pinned` lifts a project above the rest, and `order` holds the arrangement
 * the user made by hand.
 *
 * Order lives per entry rather than as a list of ids, so the merge-by-id rule
 * the index already follows still holds: two windows reordering (or creating)
 * at once cannot lose a project.
 *
 * Pure, so the sidebar, the home grid, and the command palette all read the
 * same answer.
 */

/** An entry never placed by hand sorts after every entry that was. */
const rank = (entry) => (Number.isFinite(entry?.order) ? entry.order : Number.MAX_SAFE_INTEGER);

/**
 * orderedProjects(entries) → pinned first, then the arrangement the user set,
 * then anything never placed (in creation order, which is where it used to be).
 */
export function orderedProjects(entries) {
  return [...(entries ?? [])].sort((a, b) =>
    (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
    || rank(a) - rank(b)
    || (a.createdAt ?? 0) - (b.createdAt ?? 0)
    || String(a.id).localeCompare(String(b.id)));
}

/** The two groups every list of projects draws, in order. */
export function projectGroups(entries) {
  const ordered = orderedProjects(entries);
  return {
    pinned: ordered.filter((p) => p.pinned),
    rest: ordered.filter((p) => !p.pinned),
  };
}

/**
 * planProjectMove(entries, id, toIndex) → [{ id, order }] rewrites.
 *
 * A project moves within its own group: pinning is what crosses between them,
 * so a drag can never silently unpin something. The whole group is renumbered
 * (tens of projects, not thousands), which keeps the values tidy and leaves
 * every other entry — including one created in another window mid-drag —
 * exactly as it was.
 */
export function planProjectMove(entries, id, toIndex) {
  const { pinned, rest } = projectGroups(entries);
  const group = pinned.some((p) => p.id === id) ? pinned : rest;
  const from = group.findIndex((p) => p.id === id);
  if (from < 0) return [];
  const next = [...group];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved);
  if (next.every((p, i) => p.id === group[i].id)) return [];
  return next.map((p, i) => ({ id: p.id, order: i }));
}

/**
 * The filter box above the sidebar list. A name match, nothing more: this is
 * "which of my projects is this again", not the task search.
 */
export function matchesProjectQuery(entry, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  return String(entry?.name ?? '').toLowerCase().includes(q);
}

/**
 * How many projects it takes before a filter box is worth its space. Below
 * this a small account never sees one.
 */
export const FIND_PROJECTS_FROM = 9;
