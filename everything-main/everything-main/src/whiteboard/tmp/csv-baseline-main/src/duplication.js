import { remapMindMap } from "./mind-map.js";
import { bounds, clone, uid } from "./model.js";
import { remapObjectLink } from "./object-link-data.js";
import { unlinkCopiedJira } from "./planning/task.js";
import {
  descendants,
  completeGroups,
  inferParents,
  updateConnectors,
} from "./scene.js";

export function duplicateSourceIds(items, selection, options) {
  const ids = descendants(items, selection, options);
  for (const i of items)
    if (i.startId && ids.has(i.startId) && ids.has(i.endId)) ids.add(i.id);
  return ids;
}

export function checkDuplicateGeometry(items) {
  if (
    items.some((i) =>
      ["x", "y", "w", "h"].some(
        (key) => !Number.isFinite(i[key]) || Math.abs(i[key]) > 1e6,
      ),
    )
  )
    throw Error("The duplicate would be outside the board limits.");
}

// Build a complete, independent fragment before changing the board or history.
// Only relationships within the fragment are retained; its new location decides
// membership in existing frames. Connections between copied nodes come along.
export function planDuplication(
  items,
  selection,
  { direction, dx = 30, dy = 30, hidden, ...options } = {},
) {
  // Hidden objects stay out even when their visible frame or group is copied.
  const source = hidden?.size ? items.filter((i) => !hidden.has(i.id)) : items;
  const ids = duplicateSourceIds(source, selection, options),
    chosen = source.filter((i) => ids.has(i.id));
  if (items.length + chosen.length > 5000)
    throw Error("A board can contain at most 5,000 objects.");
  if (direction) {
    const box = bounds(chosen),
      gap = 24;
    if (!["left", "right", "up", "down"].includes(direction))
      throw Error("Invalid duplication direction.");
    dx =
      direction === "left"
        ? -box.w - gap
        : direction === "right"
          ? box.w + gap
          : 0;
    dy =
      direction === "up"
        ? -box.h - gap
        : direction === "down"
          ? box.h + gap
          : 0;
  }
  const idMap = new Map(chosen.map((i) => [i.id, uid()])),
    groups = new Map(),
    wholeGroups = completeGroups(source, ids);
  const copies = chosen.map((i) => {
    const copy = clone(i);
    copy.id = idMap.get(i.id);
    remapObjectLink(copy, idMap);
    remapMindMap(copy, idMap);
    copy.x += dx;
    copy.y += dy;
    if (copy.groupId && !wholeGroups.has(copy.groupId)) delete copy.groupId;
    if (copy.groupId) {
      if (!groups.has(copy.groupId)) groups.set(copy.groupId, uid());
      copy.groupId = groups.get(copy.groupId);
    }
    for (const key of ["parentId", "startId", "endId"])
      if (idMap.has(copy[key])) copy[key] = idMap.get(copy[key]);
      else delete copy[key];
    return copy;
  });
  unlinkCopiedJira(copies, items);
  updateConnectors(copies);
  checkDuplicateGeometry(copies);
  return { copies, selection: new Set(idMap.values()), idMap };
}

export function placeDuplicates(items, ids, skip = null) {
  // Preserve copied containers, including contents extending beyond their edge.
  const roots = new Set(
    items.filter((i) => ids.has(i.id) && !ids.has(i.parentId)).map((i) => i.id),
  );
  // These are new objects, so their retained locks do not prevent placement.
  inferParents(items, roots, { includeLocked: true, skip });
  updateConnectors(items);
}
