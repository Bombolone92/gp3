import { hitTest, validateBoard } from "./model.js";
import { assertUnlocked } from "./locking.js";
import { mindAncestors } from "./mind-visibility.js";
import {
  mindIndex,
  mindBranch,
  mindRoot,
  applyMindLayout,
} from "./mind-map.js";

const relationship = (node) =>
  JSON.stringify([node.mindMap, node.groupId, node.parentId]);
const geometry = (node) => JSON.stringify([node.x, node.y, node.w, node.h]);

export function createMindDrag(items, id, selection) {
  const index = mindIndex(items),
    branch = mindBranch(index, id);
  // A mixed selection or an atomic group retains ordinary movement semantics.
  if (
    !branch.size ||
    branch.size !== selection.size ||
    [...branch].some((key) => !selection.has(key))
  )
    return null;
  return {
    id,
    branch,
    relationships: new Map(
      [...branch].map((key) => [key, relationship(index.nodes.get(key))]),
    ),
    geometry: new Map(
      [...branch].map((key) => [key, geometry(index.nodes.get(key))]),
    ),
  };
}

export function validMindDrag(items, gesture, checkGeometry = false) {
  const index = mindIndex(items),
    branch = mindBranch(index, gesture.id);
  return (
    branch.size === gesture.branch.size &&
    [...branch].every(
      (id) =>
        gesture.relationships.get(id) === relationship(index.nodes.get(id)) &&
        (!checkGeometry ||
          gesture.geometry.get(id) === geometry(index.nodes.get(id))),
    )
  );
}

export function mindDragCandidate(items, gesture, point, zoom) {
  const target = hitTest(
    items,
    point,
    12 / zoom,
    (i) =>
      !gesture.branch.has(i.id) && !["arrow", "pen", "frame"].includes(i.type),
  );
  const source = items.find((i) => i.id === gesture.id);
  if (!target?.mindMap || !source || target.id === source.mindMap.parent)
    return null;
  let direction = target.mindMap.direction;
  if (!target.mindMap.parent) {
    const dx = (point.x - target.x - target.w / 2) / Math.max(1, target.w / 2);
    const dy = (point.y - target.y - target.h / 2) / Math.max(1, target.h / 2);
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 0.15)
      direction =
        Math.abs(dx) >= Math.abs(dy)
          ? dx < 0
            ? "left"
            : "right"
          : dy < 0
            ? "up"
            : "down";
  }
  return { id: target.id, direction };
}

// Shared by pointer drops and the accessible parent chooser. Plan and validate
// before touching the live scene so layout/lock failures remain atomic.
export function planMindReparent(
  board,
  id,
  target,
  direction,
  { validate = true } = {},
) {
  const next = board.items.map((i) =>
    i.mindMap ? { ...i, mindMap: { ...i.mindMap } } : i,
  );
  const index = mindIndex(next),
    node = index.nodes.get(id),
    parent = index.nodes.get(target);
  if (!node || (target && !parent))
    throw Error("This mind map changed. Reopen its controls.");
  const branch = mindBranch(index, id);
  if (branch.has(target))
    throw Error("A branch cannot be moved inside itself.");
  assertUnlocked(board.items, new Set([id, ...(target ? [target] : [])]));
  if (node.mindMap.parent === target) return { items: next, patch: [] };
  const oldRoot = mindRoot(index, id);
  node.mindMap.parent = target;
  if (parent) {
    for (const ancestor of [parent, ...mindAncestors(next, parent.id)])
      if (ancestor.mindCollapsed) ancestor.mindCollapsed = false;
    node.order =
      Math.max(
        0,
        ...(index.children.get(target) || []).map((i) => i.order || 0),
      ) + 1;
    const nextDirection = parent.mindMap.parent
      ? parent.mindMap.direction
      : direction || parent.mindMap.direction;
    for (const child of branch)
      index.nodes.get(child).mindMap.direction = nextDirection;
  }
  const newRoot = mindRoot(mindIndex(next), id);
  if (oldRoot.id !== id && oldRoot.id !== newRoot.id && oldRoot.mindMap.auto)
    applyMindLayout(next, oldRoot.id);
  if (newRoot.mindMap.auto) applyMindLayout(next, newRoot.id);
  if (validate) validateBoard({ ...board, items: next });
  const before = new Map(board.items.map((i) => [i.id, i]));
  const patch = next.filter(
    (i) =>
      i.mindMap &&
      ["x", "y", "order", "mindMap", "mindCollapsed"].some(
        (key) =>
          JSON.stringify(i[key]) !== JSON.stringify(before.get(i.id)[key]),
      ),
  );
  assertUnlocked(board.items, new Set(patch.map((i) => i.id)));
  return { items: next, patch };
}
