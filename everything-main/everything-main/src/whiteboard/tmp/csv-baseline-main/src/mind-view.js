import { mindVisibility, mindAncestors } from "./mind-visibility.js";
const EMPTY = [];

export function createMindView(api) {
  let boardId,
    mode,
    overrides = new Map(),
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
  function reveal(id) {
    const state = scene();
    if (!state.hidden.has(id)) return false;
    const node = state.items.find((i) => i.id === id),
      ids = new Set();
    for (const target of node?.type === "arrow"
      ? [node.startId, node.endId]
      : [id])
      for (const parent of mindAncestors(state.items, target))
        if (parent.mindCollapsed) ids.add(parent.id);
    return change(ids, false);
  }
  return { scene, invalidate, toggle, reveal };
}
