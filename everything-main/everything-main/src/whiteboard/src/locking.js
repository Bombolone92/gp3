import { frameWithin } from "./geometry.js";

// A locked child protects its container from indirect movement/deletion, but a
// locked frame does not make its children uneditable. Groups remain atomic.
// A frame lying within a larger one protects that one too.
export function protectedIds(items, { deleting = false } = {}) {
  const blocked = new Set(items.filter((i) => i.locked).map((i) => i.id));
  if (!blocked.size) return blocked;
  const parents = new Map(),
    groups = new Map();
  const link = (from, to) => {
    if (!parents.has(from)) parents.set(from, []);
    parents.get(from).push(to);
  };
  for (const i of items) {
    if (i.parentId) link(i.id, i.parentId);
    if (i.mindMap?.parent) link(i.id, i.mindMap.parent);
    if (i.groupId) {
      if (!groups.has(i.groupId)) groups.set(i.groupId, []);
      groups.get(i.groupId).push(i.id);
    }
    if (deleting && i.type === "arrow") {
      if (i.startId) link(i.id, i.startId);
      if (i.endId) link(i.id, i.endId);
    }
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  let frames = null;
  const queue = [...blocked],
    visitedGroups = new Set();
  for (let n = 0; n < queue.length; n++) {
    const id = queue[n],
      groupId = byId.get(id)?.groupId;
    const related = [...(parents.get(id) || [])];
    if (byId.get(id)?.type === "frame")
      for (const outer of (frames ??= items.filter((i) => i.type === "frame")))
        if (frameWithin(byId.get(id), outer)) related.push(outer.id);
    if (groupId && !visitedGroups.has(groupId)) {
      visitedGroups.add(groupId);
      related.push(...groups.get(groupId));
    }
    for (const next of related)
      if (!blocked.has(next)) {
        blocked.add(next);
        queue.push(next);
      }
  }
  return blocked;
}
export function hasLocked(items, ids, options) {
  if (!ids.size) return false;
  const blocked = protectedIds(items, options);
  return [...ids].some((id) => blocked.has(id));
}
export function assertUnlocked(items, ids, options) {
  if (hasLocked(items, ids, options))
    throw Error("Unlock protected objects before changing this selection.");
}
export function setLocked(items, ids, locked) {
  const groups = new Set(
    items.filter((i) => ids.has(i.id) && i.groupId).map((i) => i.groupId),
  );
  for (const i of items)
    if (ids.has(i.id) || (i.groupId && groups.has(i.groupId))) {
      if (locked) i.locked = true;
      else delete i.locked;
    }
}
