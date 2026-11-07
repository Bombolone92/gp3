import { mindVisibility, mindAncestors } from "./mind-visibility.js";
const EMPTY = [];

export function createMindView(api) {
  let boardId,
    mode,
    overrides = new Map(),
    // Branches opened only to show a search result, with what each was
    // before, closed again when the search ends.
    previewed = new Map(),
    cache;
  function invalidate() {
    cache = null;
  }
  function scene() {
    const board = api.board(),
      readOnly = api.readOnly(),
      editing = api.editing?.();
    if (boardId !== board?.id || mode !== readOnly) {
      boardId = board?.id;
      mode = readOnly;
      overrides.clear();
      previewed.clear();
      invalidate();
    }
    const items = board?.items || EMPTY;
    if (
      cache?.items === items &&
      cache.length === items.length &&
      cache.updated === board?.updated &&
      cache.comments === board?.comments &&
      cache.editing === editing
    )
      return cache.value;
    // A remote collapse must not hide an active local text draft. Its ancestors
    // stay open locally until editing finishes, without changing the shared flag.
    const active = editing && items.find((i) => i.id === editing);
    const targets =
      active?.type === "arrow"
        ? [active.startId, active.endId]
        : editing
          ? [editing]
          : [];
    const open = new Set(
      targets.flatMap((id) => mindAncestors(items, id).map((i) => i.id)),
    );
    const effective =
      overrides.size || open.size
        ? items.map((i) =>
            open.has(i.id)
              ? { ...i, mindCollapsed: false }
              : overrides.has(i.id)
                ? { ...i, mindCollapsed: overrides.get(i.id) }
                : i,
          )
        : items;
    const value = {
      ...mindVisibility(effective, board?.comments),
      items: effective,
    };
    cache = {
      items,
      length: items.length,
      updated: board?.updated,
      comments: board?.comments,
      editing,
      value,
    };
    return value;
  }
  function change(ids, collapsed) {
    if (!ids.size) return false;
    // A branch opened only for a search result takes the change asked for
    // now, and keeps it once the search ends.
    for (const id of ids)
      if (previewed.has(id)) {
        const before = previewed.get(id);
        previewed.delete(id);
        if (before === undefined) overrides.delete(id);
        else overrides.set(id, before);
      }
    if (api.readOnly()) {
      for (const id of ids) overrides.set(id, collapsed);
      invalidate();
      api.redraw();
    } else
      api.persist(() => {
        for (const i of api.board().items)
          if (ids.has(i.id)) i.mindCollapsed = collapsed;
        invalidate();
      });
    return true;
  }
  function toggle(id) {
    const state = scene(),
      node = state.visible.find((i) => i.id === id);
    if (!node || !state.branches.has(id)) return false;
    return change(new Set([id]), !node.mindCollapsed);
  }
  // The collapsed branches holding an object.
  function closedAround(id) {
    const state = scene();
    if (!state.hidden.has(id)) return new Set();
    const node = state.items.find((i) => i.id === id),
      ids = new Set();
    for (const target of node?.type === "arrow"
      ? [node.startId, node.endId]
      : [id])
      for (const parent of mindAncestors(state.items, target))
        if (parent.mindCollapsed) ids.add(parent.id);
    return ids;
  }
  function reveal(id) {
    return change(closedAround(id), false);
  }
  // Opens the branches around an object on this screen only, as stepping
  // through search results does: the board, its history and everyone else's
  // view stay as they are.
  function preview(id) {
    const ids = closedAround(id);
    if (!ids.size) return false;
    for (const branch of ids) {
      if (!previewed.has(branch))
        previewed.set(
          branch,
          overrides.has(branch) ? overrides.get(branch) : undefined,
        );
      overrides.set(branch, false);
    }
    invalidate();
    api.redraw();
    return true;
  }
  function endPreview() {
    if (!previewed.size) return;
    for (const [branch, before] of previewed)
      if (before === undefined) overrides.delete(branch);
      else overrides.set(branch, before);
    previewed.clear();
    invalidate();
    api.redraw();
  }
  return { scene, invalidate, toggle, reveal, preview, endPreview };
}
