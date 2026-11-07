import { remapMindMap } from "./mind-map.js";
import { assertUnlocked, protectedIds } from "./locking.js";
import { shapeAnchor } from "./shapes.js";
import { imageContentBox } from "./image-crop.js";
import { rotationOf, localPoint, worldPoint } from "./geometry.js";
import { uid, clone, bounds, item } from "./model.js";
import { remapObjectLink } from "./object-link-data.js";
export const isConnector = (i) =>
  i.type === "arrow" && Boolean(i.startId || i.endId);
export function safeURL(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
export function descendants(items, ids, { groups = true } = {}) {
  const result = new Set(ids),
    children = new Map(),
    groupMembers = new Map(),
    byId = new Map();
  for (const i of items) {
    byId.set(i.id, i);
    for (const parent of [i.parentId, i.mindMap?.parent].filter(Boolean)) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(i.id);
    }
    if (groups && i.groupId) {
      if (!groupMembers.has(i.groupId)) groupMembers.set(i.groupId, []);
      groupMembers.get(i.groupId).push(i.id);
    }
  }
  const queue = [...ids],
    visitedGroups = new Set();
  for (let n = 0; n < queue.length; n++) {
    const id = queue[n],
      group = byId.get(id)?.groupId;
    const next = [...(children.get(id) || [])];
    if (groups && group && !visitedGroups.has(group)) {
      visitedGroups.add(group);
      next.push(...groupMembers.get(group));
    }
    for (const child of next)
      if (!result.has(child)) {
        result.add(child);
        queue.push(child);
      }
  }
  return result;
}
// A selected group can also contain later-added frame contents or mind-map
// descendants without giving those children the group's own id.
export function selectionGroupId(chosen) {
  const groupId = chosen.find((i) => i.groupId)?.groupId;
  if (!groupId) return null;
  if (chosen.every((i) => i.groupId === groupId)) return groupId;
  const roots = new Set(
    chosen.filter((i) => i.groupId === groupId).map((i) => i.id),
  );
  const members = descendants(chosen, roots, { groups: false });
  return chosen.every((i) => members.has(i.id)) ? groupId : null;
}
// Partial selections inside a group must not recreate that group when copied,
// or combine independently selected members into one alignment unit.
export function completeGroups(items, ids) {
  const selected = new Set(),
    partial = new Set();
  for (const i of items) {
    if (!i.groupId) continue;
    (ids.has(i.id) ? selected : partial).add(i.groupId);
  }
  for (const id of partial) selected.delete(id);
  return selected;
}
export function unlockedSelection(items, ids, { expand = true } = {}) {
  const blocked = protectedIds(items);
  const candidates = new Set([...ids].filter((id) => !blocked.has(id)));
  if (!expand) return candidates;
  return new Set(
    [...descendants(items, candidates)].filter((id) => !blocked.has(id)),
  );
}
export function frameItems(items, id) {
  return descendants(items, new Set([id]), { groups: false });
}
// frameItems for many frames at once: the board is indexed once, so a board
// with thousands of frames takes one pass instead of one per frame. Each
// frame's set lists its objects in board order.
export function framesItems(items, ids) {
  const children = new Map(),
    order = new Map();
  items.forEach((i, n) => {
    order.set(i.id, n);
    for (const parent of [i.parentId, i.mindMap?.parent].filter(Boolean)) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(i.id);
    }
  });
  const result = new Map();
  for (const id of ids) {
    const found = new Set([id]),
      queue = [id];
    for (let n = 0; n < queue.length; n++)
      for (const child of children.get(queue[n]) || [])
        if (!found.has(child)) (found.add(child), queue.push(child));
    result.set(
      id,
      new Set(
        [...found]
          .filter((m) => order.has(m))
          .sort((a, b) => order.get(a) - order.get(b)),
      ),
    );
  }
  return result;
}
export function group(items, ids, options) {
  assertUnlocked(items, ids);
  const members = descendants(items, ids, options);
  if (members.size < 2) throw Error("Select at least two objects to group.");
  const id = uid();
  items.filter((i) => members.has(i.id)).forEach((i) => (i.groupId = id));
  return members;
}
export function ungroup(items, ids) {
  assertUnlocked(items, ids);
  const groups = new Set(
    items.filter((i) => ids.has(i.id)).map((i) => i.groupId),
  );
  for (const i of items) if (groups.has(i.groupId)) delete i.groupId;
}
export function attachToFrame(items, ids, parentId) {
  assertUnlocked(items, ids);
  const frame = items.find((i) => i.id === parentId && i.type === "frame");
  if (parentId && !frame) throw Error("Choose a valid frame.");
  for (const i of items.filter((i) => ids.has(i.id))) {
    if (i.type === "frame") continue;
    if (parentId) i.parentId = parentId;
    else delete i.parentId;
  }
}
// Frames in `skip`, such as frames hidden from this person, never take in
// objects: what someone adds over them stays theirs to see.
export function inferParents(
  items,
  ids,
  { includeLocked = false, skip = null } = {},
) {
  const frames = items
    .filter((i) => i.type === "frame" && !skip?.has(i.id))
    .sort((a, b) => a.w * a.h - b.w * b.h);
  for (const i of items) {
    if (
      (!includeLocked && i.locked) ||
      i.type === "frame" ||
      (ids && !ids.has(i.id))
    )
      continue;
    const cx = i.x + i.w / 2,
      cy = i.y + i.h / 2;
    const parent = frames.find(
      (f) => cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h,
    );
    if (parent) i.parentId = parent.id;
    else delete i.parentId;
  }
}
// After objects move, turn, or change size, each whose frame did not move
// with it belongs to the frame its middle is now in. What a moved frame
// holds stays with it, even where it reaches past the frame's edge.
export function inferMovedParents(items, ids, options) {
  const roots = new Set(
    items.filter((i) => ids.has(i.id) && !ids.has(i.parentId)).map((i) => i.id),
  );
  if (roots.size) inferParents(items, roots, options);
}
function anchor(box, toward) {
  if (rotationOf(box))
    return worldPoint(
      box,
      anchor({ ...box, rotation: 0 }, localPoint(box, toward)),
    );
  if (box.type === "image" && box.crop?.sourceAspect)
    box = { ...box, ...imageContentBox(box) };
  if (box.type === "rect" && box.shape) return shapeAnchor(box, toward);
  const cx = box.x + box.w / 2,
    cy = box.y + box.h / 2,
    dx = toward.x - cx,
    dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const rx = Math.abs(dx) / (box.w / 2 || 1),
    ry = Math.abs(dy) / (box.h / 2 || 1);
  const scale =
    1 /
    (box.type === "ellipse" ||
    (box.type === "image" && box.crop?.mask === "ellipse")
      ? Math.hypot(rx, ry)
      : Math.max(rx, ry));
  return { x: cx + dx * scale, y: cy + dy * scale };
}
export function updateConnectors(items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const i of items.filter(isConnector)) {
    const start = byId.get(i.startId),
      end = byId.get(i.endId);
    if (!start) delete i.startId;
    if (!end) delete i.endId;
    const startCenter = start
      ? { x: start.x + start.w / 2, y: start.y + start.h / 2 }
      : { x: i.x, y: i.y };
    const endCenter = end
      ? { x: end.x + end.w / 2, y: end.y + end.h / 2 }
      : { x: i.x + i.w, y: i.y + i.h };
    // Orthogonal and curved lines meet the middle of a side so their tangents
    // do not skim or cut through a node boundary.
    if (i.lineType && i.lineType !== "straight")
      i.routeAxis =
        Math.abs(endCenter.x - startCenter.x) >=
        Math.abs(endCenter.y - startCenter.y)
          ? "x"
          : "y";
    const toward = (from, to) =>
      !i.lineType || i.lineType === "straight"
        ? to
        : i.routeAxis === "x"
          ? { x: to.x, y: from.y }
          : { x: from.x, y: to.y };
    const a = start
      ? anchor(start, toward(startCenter, endCenter))
      : startCenter;
    const b = end ? anchor(end, toward(endCenter, startCenter)) : endCenter;
    i.x = a.x;
    i.y = a.y;
    i.w = b.x - a.x;
    i.h = b.y - a.y;
  }
}
export function connectObjects(items, ids) {
  const nodes = items.filter(
    (i) => ids.has(i.id) && !["arrow", "pen", "frame"].includes(i.type),
  );
  if (nodes.length !== 2) throw Error("Select exactly two objects to connect.");
  const arrow = item("arrow", 0, 0, {
    startId: nodes[0].id,
    endId: nodes[1].id,
  });
  items.unshift(arrow);
  updateConnectors(items);
  return arrow;
}
export function moveItems(items, ids, dx, dy, options) {
  assertUnlocked(items, ids);
  const expanded = descendants(items, ids, options);
  for (const i of items) {
    if (expanded.has(i.id) && !isConnector(i)) {
      i.x += dx;
      i.y += dy;
    }
  }
  updateConnectors(items);
  return expanded;
}
export function duplicateItems(items, ids, offset = 30, options) {
  const expanded = descendants(items, ids, options),
    chosen = items.filter((i) => expanded.has(i.id)),
    map = new Map(chosen.map((i) => [i.id, uid()])),
    groups = new Map(),
    wholeGroups = completeGroups(items, expanded);
  const copies = chosen.map((i) => {
    const c = clone(i);
    c.id = map.get(i.id);
    remapObjectLink(c, map);
    remapMindMap(c, map);
    c.x += offset;
    c.y += offset;
    if (c.groupId && !wholeGroups.has(c.groupId)) delete c.groupId;
    if (c.groupId) {
      if (!groups.has(c.groupId)) groups.set(c.groupId, uid());
      c.groupId = groups.get(c.groupId);
    }
    if (c.parentId) c.parentId = map.get(c.parentId) || c.parentId;
    if (c.startId) c.startId = map.get(c.startId) || c.startId;
    if (c.endId) c.endId = map.get(c.endId) || c.endId;
    return c;
  });
  items.push(...copies);
  updateConnectors(items);
  return new Set(copies.map((i) => i.id));
}
export function removeItems(items, ids, options) {
  assertUnlocked(items, ids, { deleting: true });
  const expanded = descendants(items, ids, options);
  return items.filter(
    (i) =>
      !expanded.has(i.id) && !expanded.has(i.startId) && !expanded.has(i.endId),
  );
}
export function createFrame(items, ids, title = "Section", options) {
  assertUnlocked(items, ids);
  const selected = descendants(items, ids, options),
    b = bounds(items.filter((i) => selected.has(i.id)));
  const f = item("frame", b.x - 30, b.y - 65, {
    w: b.w + 60,
    h: b.h + 95,
    text: title,
    order: items.filter((i) => i.type === "frame").length,
  });
  items.unshift(f);
  attachToFrame(items, selected, f.id);
  return f;
}
export function orderedFrames(items) {
  return items
    .filter((i) => i.type === "frame")
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}
// Groups and selected frames form atomic layout units. Attached connectors
// follow their endpoints and never contribute their own layout bounds.
export function layoutUnits(items, ids, options) {
  const selected = descendants(items, ids, options);
  const parents = new Map();
  const roots = new Map();
  const wholeGroups = completeGroups(items, selected);
  const find = (id) => {
    if (!parents.has(id)) parents.set(id, id);
    let root = id;
    while (parents.get(root) !== root) root = parents.get(root);
    while (id !== root) {
      const next = parents.get(id);
      parents.set(id, root);
      id = next;
    }
    return root;
  };
  const join = (a, b) => parents.set(find(a), find(b));
  for (const i of items) {
    if (!selected.has(i.id)) continue;
    find(i.id);
    if (i.parentId && selected.has(i.parentId)) join(i.id, i.parentId);
    if (
      i.groupId &&
      i.groupId !== options?.withinGroup &&
      wholeGroups.has(i.groupId)
    ) {
      if (roots.has(i.groupId)) join(i.id, roots.get(i.groupId));
      else roots.set(i.groupId, i.id);
    }
  }
  const units = new Map();
  for (const i of items) {
    if (!selected.has(i.id)) continue;
    const root = find(i.id);
    if (!units.has(root)) units.set(root, { ids: new Set(), items: [] });
    const unit = units.get(root);
    unit.ids.add(i.id);
    if (!isConnector(i)) unit.items.push(i);
  }
  return [...units.values()]
    .filter((unit) => unit.items.length)
    .map((unit) => ({ ids: unit.ids, box: bounds(unit.items) }));
}

// Plan first so commands that cannot move anything don't consume undo history.
export function layoutMoves(items, ids, mode, options) {
  assertUnlocked(items, ids);
  const units = layoutUnits(items, ids, options);
  const distribute = ["horizontal", "vertical"].includes(mode);
  if (units.length < (distribute ? 3 : 2)) return [];
  const b = bounds(units.map((unit) => unit.box));
  if (distribute) {
    const axis = mode === "horizontal" ? "x" : "y";
    const size = mode === "horizontal" ? "w" : "h";
    units.sort((a, b) => a.box[axis] - b.box[axis]);
    // Keep the first and last objects anchored, even when objects overlap.
    const first = units[0].box,
      last = units.at(-1).box;
    const gap =
      (last[axis] -
        first[axis] -
        units.slice(0, -1).reduce((sum, unit) => sum + unit.box[size], 0)) /
      (units.length - 1);
    let position = first[axis] + first[size] + gap;
    return units
      .slice(1, -1)
      .map((unit) => {
        const delta = position - unit.box[axis];
        position += unit.box[size] + gap;
        return {
          ids: unit.ids,
          dx: axis === "x" ? delta : 0,
          dy: axis === "y" ? delta : 0,
        };
      })
      .filter((move) => Math.abs(move.dx) > 1e-9 || Math.abs(move.dy) > 1e-9);
  }
  return units
    .map(({ ids, box: i }) => ({
      ids,
      dx:
        mode === "left"
          ? b.x - i.x
          : mode === "center"
            ? b.x + b.w / 2 - i.x - i.w / 2
            : mode === "right"
              ? b.x + b.w - i.x - i.w
              : 0,
      dy:
        mode === "top"
          ? b.y - i.y
          : mode === "middle"
            ? b.y + b.h / 2 - i.y - i.h / 2
            : mode === "bottom"
              ? b.y + b.h - i.y - i.h
              : 0,
    }))
    .filter((move) => Math.abs(move.dx) > 1e-9 || Math.abs(move.dy) > 1e-9);
}
export function applyLayout(items, moves) {
  assertUnlocked(items, new Set(moves.flatMap((move) => [...move.ids])));
  const offsets = new Map();
  for (const { ids, dx, dy } of moves)
    for (const id of ids) offsets.set(id, { dx, dy });
  for (const i of items) {
    const offset = offsets.get(i.id);
    if (!offset || isConnector(i)) continue;
    i.x += offset.dx;
    i.y += offset.dy;
  }
  updateConnectors(items);
}
export function alignItems(items, ids, mode, options) {
  applyLayout(items, layoutMoves(items, ids, mode, options));
}

export function reorderItems(items, ids, direction, options) {
  assertUnlocked(items, ids);
  const selected = descendants(items, ids, options);
  const objects = items.filter((i) => i.type !== "frame");
  let ordered = objects.slice();
  if (direction === "front" || direction === "back") {
    const chosen = objects.filter((i) => selected.has(i.id));
    const rest = objects.filter((i) => !selected.has(i.id));
    ordered =
      direction === "front" ? [...rest, ...chosen] : [...chosen, ...rest];
  } else if (direction === "forward") {
    for (let n = ordered.length - 2; n >= 0; n--)
      if (selected.has(ordered[n].id) && !selected.has(ordered[n + 1].id))
        [ordered[n], ordered[n + 1]] = [ordered[n + 1], ordered[n]];
  } else if (direction === "backward") {
    for (let n = 1; n < ordered.length; n++)
      if (selected.has(ordered[n].id) && !selected.has(ordered[n - 1].id))
        [ordered[n], ordered[n - 1]] = [ordered[n - 1], ordered[n]];
  }
  if (ordered.every((i, n) => i === objects[n])) return items;
  let n = 0;
  return items.map((i) => (i.type === "frame" ? i : ordered[n++]));
}
