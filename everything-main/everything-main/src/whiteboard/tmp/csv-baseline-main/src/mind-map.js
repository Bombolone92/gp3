// Mind-map nodes remain ordinary editable canvas objects. Relationships carry
// the hierarchy; branch lines are derived so concurrent node edits cannot leave
// duplicate or disconnected stored connectors behind.
export const MIND_DIRECTIONS = ["right", "left", "down", "up"];
export function validMindMap(i) {
  const m = i.mindMap;
  return (
    m &&
    typeof m === "object" &&
    !Array.isArray(m) &&
    ["note", "text", "rect", "ellipse"].includes(i.type) &&
    Object.keys(m).every((k) =>
      ["parent", "direction", "auto", "line"].includes(k),
    ) &&
    (m.parent === null ||
      (typeof m.parent === "string" &&
        m.parent.length > 0 &&
        m.parent.length <= 100 &&
        m.parent !== i.id)) &&
    MIND_DIRECTIONS.includes(m.direction) &&
    typeof m.auto === "boolean" &&
    ["curved", "straight"].includes(m.line)
  );
}
export function mindIndex(items) {
  const nodes = new Map(items.filter((i) => i.mindMap).map((i) => [i.id, i]));
  const children = new Map();
  for (const i of nodes.values()) {
    const parent = i.mindMap.parent;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(i);
  }
  // Stable across Yjs ordering ties and after copying/reloading.
  for (const rows of children.values())
    rows.sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
    );
  return { nodes, children };
}
export function mindBranch(index, id) {
  const result = new Set(),
    queue = [id];
  for (let n = 0; n < queue.length; n++) {
    const id = queue[n];
    if (result.has(id) || !index.nodes.has(id)) continue;
    result.add(id);
    for (const child of index.children.get(id) || []) queue.push(child.id);
  }
  return result;
}
export function mindRoot(index, id) {
  let i = index.nodes.get(id);
  const seen = new Set();
  while (i?.mindMap.parent && !seen.has(i.id)) {
    seen.add(i.id);
    const parent = index.nodes.get(i.mindMap.parent);
    if (!parent) break;
    i = parent;
  }
  return i;
}
export function validateMindTrees(items) {
  const { nodes } = mindIndex(items),
    done = new Set();
  for (const node of nodes.values()) {
    if (!validMindMap(node)) throw Error("Invalid mind map node.");
    let i = node;
    const path = new Set();
    while (i && !done.has(i.id)) {
      if (path.has(i.id))
        throw Error("Mind map branches cannot contain cycles.");
      path.add(i.id);
      const parent = i.mindMap.parent;
      if (parent && !nodes.has(parent)) throw Error("Invalid mind map parent.");
      i = nodes.get(parent);
    }
    for (const id of path) done.add(id);
  }
}
export function repairMindTrees(items) {
  const nodes = new Map(items.filter(validMindMap).map((i) => [i.id, i]));
  const done = new Set();
  for (const node of nodes.values()) {
    let i = node;
    const path = [],
      seen = new Map();
    while (i && !done.has(i.id)) {
      if (seen.has(i.id)) {
        const cycle = path
          .slice(seen.get(i.id))
          .sort((a, b) => a.id.localeCompare(b.id));
        const cut = cycle[cycle.length - 1];
        cut.mindMap = { ...cut.mindMap, parent: null };
        break;
      }
      seen.set(i.id, path.length);
      path.push(i);
      if (i.mindMap.parent && !nodes.has(i.mindMap.parent))
        i.mindMap = { ...i.mindMap, parent: null };
      i = nodes.get(i.mindMap.parent);
    }
    for (const row of path) done.add(row.id);
  }
}
export function remapMindMap(i, ids) {
  if (i.mindMap)
    i.mindMap = {
      ...i.mindMap,
      parent: ids.get(i.mindMap.parent) || null,
      ...(i.mindMap.parent && !ids.has(i.mindMap.parent)
        ? { auto: false }
        : {}),
    };
}
export function trimMindMap(i, ids) {
  if (i.mindMap?.parent && !ids.has(i.mindMap.parent))
    i.mindMap = { ...i.mindMap, parent: null, auto: false };
}
// Iterative tree layout, including very deep maps. Measure each branch once,
// then place it without comparing every pair of nodes or inspecting node text.
export function mindLayout(items, rootId) {
  const index = mindIndex(items),
    root = index.nodes.get(rootId),
    positions = new Map();
  if (!root) return positions;
  const gap = 80,
    spacing = 28;
  for (const direction of MIND_DIRECTIONS) {
    const horizontal = ["left", "right"].includes(direction),
      positive = ["right", "down"].includes(direction);
    const along = horizontal ? "x" : "y",
      across = horizontal ? "y" : "x";
    const size = horizontal ? "w" : "h",
      breadth = horizontal ? "h" : "w";
    const first = (index.children.get(root.id) || []).filter(
      (i) => i.mindMap.direction === direction,
    );
    const queue = [...first],
      seen = new Set([root.id]);
    for (let n = 0; n < queue.length; n++) {
      const i = queue[n];
      if (seen.has(i.id))
        throw Error("Mind map branches cannot contain cycles.");
      seen.add(i.id);
      queue.push(...(index.children.get(i.id) || []));
    }
    const spans = new Map();
    for (let n = queue.length - 1; n >= 0; n--) {
      const i = queue[n],
        children = index.children.get(i.id) || [];
      spans.set(
        i.id,
        Math.max(
          i[breadth],
          children.reduce((sum, c) => sum + spans.get(c.id), 0) +
            Math.max(0, children.length - 1) * spacing,
        ),
      );
    }
    const place = (parent, children, parentPosition) => {
      const total =
        children.reduce((sum, c) => sum + spans.get(c.id), 0) +
        Math.max(0, children.length - 1) * spacing;
      let cursor = parentPosition[across] + parent[breadth] / 2 - total / 2;
      for (const child of children) {
        const span = spans.get(child.id);
        const p = {
          [along]:
            parentPosition[along] +
            (positive ? parent[size] + gap : -gap - child[size]),
          [across]: cursor + (span - child[breadth]) / 2,
        };
        if (
          !Object.values(p).every(
            (n) => Number.isFinite(n) && Math.abs(n) <= 1e6,
          )
        )
          throw Error(
            "The mind map is too large. Move it closer to the center or split a branch.",
          );
        positions.set(child.id, p);
        cursor += span + spacing;
      }
    };
    place(root, first, root);
    for (const i of queue)
      place(i, index.children.get(i.id) || [], positions.get(i.id));
  }
  return positions;
}
export function applyMindLayout(items, rootId) {
  const plan = mindLayout(items, rootId);
  for (const i of items) if (plan.has(i.id)) Object.assign(i, plan.get(i.id));
}
export function mindLines(items) {
  const nodes = new Map(items.filter((i) => i.mindMap).map((i) => [i.id, i])),
    lines = [];
  for (const child of nodes.values()) {
    const parent = nodes.get(child.mindMap.parent);
    if (!parent) continue;
    const direction = child.mindMap.direction,
      horizontal = ["right", "left"].includes(direction),
      positive = ["right", "down"].includes(direction);
    const start = horizontal
      ? { x: parent.x + (positive ? parent.w : 0), y: parent.y + parent.h / 2 }
      : { x: parent.x + parent.w / 2, y: parent.y + (positive ? parent.h : 0) };
    const end = horizontal
      ? { x: child.x + (positive ? 0 : child.w), y: child.y + child.h / 2 }
      : { x: child.x + child.w / 2, y: child.y + (positive ? 0 : child.h) };
    lines.push({
      id: `mind-line:${child.id}`,
      type: "arrow",
      ...start,
      w: end.x - start.x,
      h: end.y - start.y,
      color: "#687169",
      lineWidth: 2,
      lineType: child.mindMap.line,
      routeAxis: horizontal ? "x" : "y",
      startCap: "none",
      endCap: "none",
      text: "",
    });
  }
  return lines;
}
export function mindNavigate(index, id, key) {
  const node = index.nodes.get(id);
  const toward = {
    ArrowRight: "right",
    ArrowLeft: "left",
    ArrowDown: "down",
    ArrowUp: "up",
  }[key];
  if (!node || !toward) return null;
  const children = index.children.get(id) || [],
    parent = index.nodes.get(node.mindMap.parent);
  // Branches leave a root in every direction; each arrow opens its own side.
  // Sideways keys never jump to another map's root.
  if (!parent)
    return children.find((c) => c.mindMap.direction === toward) || null;
  const direction = node.mindMap.direction;
  const backward = { right: "left", left: "right", down: "up", up: "down" }[
    direction
  ];
  if (toward === direction) return children[0] || null;
  if (toward === backward) return parent;
  // A root's children are drawn per side, so siblings share this direction.
  const siblings = (index.children.get(parent.id) || []).filter(
    (s) =>
      index.nodes.has(parent.mindMap.parent) ||
      s.mindMap.direction === direction,
  );
  const n = siblings.findIndex((i) => i.id === id),
    delta = toward === "up" || toward === "left" ? -1 : 1;
  return siblings[n + delta] || null;
}

export function autoLayoutMindMaps(items) {
  const index = mindIndex(items);
  for (const root of index.nodes.values()) {
    if (root.mindMap.parent || !root.mindMap.auto || !validMindMap(root))
      continue;
    const tree = [...mindBranch(index, root.id)].map((id) =>
      index.nodes.get(id),
    );
    if (!tree.every(validMindMap)) continue;
    // Concurrent growth can exceed the coordinate envelope even when each
    // contribution was valid separately. Retain stored positions in that case.
    try {
      applyMindLayout(tree, root.id);
    } catch {}
  }
}
export function preserveManualMindMoves(before, items) {
  const old = new Map(before.filter((i) => i.mindMap).map((i) => [i.id, i]));
  if (!old.size) return;
  const index = mindIndex(items),
    roots = new Map();
  for (const root of index.nodes.values())
    if (!root.mindMap.parent)
      for (const id of mindBranch(index, root.id)) roots.set(id, root);
  for (const node of index.nodes.values()) {
    const previous = old.get(node.id),
      root = roots.get(node.id),
      originalRoot = old.get(root?.id);
    if (
      !previous ||
      !root?.mindMap.auto ||
      !originalRoot ||
      node === root ||
      previous.mindMap.parent !== node.mindMap.parent
    )
      continue;
    if (
      Math.abs(node.x - previous.x - (root.x - originalRoot.x)) > 1e-6 ||
      Math.abs(node.y - previous.y - (root.y - originalRoot.y)) > 1e-6 ||
      node.w !== previous.w ||
      node.h !== previous.h
    )
      root.mindMap = { ...root.mindMap, auto: false };
  }
}

export function autoMindChildren(items) {
  const index = mindIndex(items),
    ids = new Set();
  for (const root of index.nodes.values())
    if (!root.mindMap.parent && root.mindMap.auto)
      for (const id of mindBranch(index, root.id))
        if (id !== root.id) ids.add(id);
  return ids;
}
