// Collapsing is a view projection, never a change to hierarchy or geometry.
// Traverse iteratively, without reading text or assets, at the 5,000-node limit.
export function mindVisibility(items, comments = []) {
  const nodes = new Map(),
    children = new Map(),
    branches = new Set();
  for (const i of items) if (i.mindMap) nodes.set(i.id, i);
  const roots = [];
  for (const i of nodes.values()) {
    const parent = i.mindMap.parent;
    if (!nodes.has(parent)) roots.push(i.id);
    else {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(i.id);
      branches.add(parent);
    }
  }
  const hidden = new Map(),
    counts = new Map(),
    visited = new Set();
  const visit = (start) => {
    const queue = [[start, null]];
    for (let at = 0; at < queue.length; at++) {
      const [id, owner] = queue[at];
      if (visited.has(id)) continue;
      visited.add(id);
      const node = nodes.get(id);
      if (owner) {
        hidden.set(id, owner);
        counts.get(owner).nodes++;
      }
      const collapsed =
        owner || (node.mindCollapsed && branches.has(id) ? id : null);
      if (collapsed && !counts.has(collapsed))
        counts.set(collapsed, { nodes: 0, comments: 0, total: 0 });
      for (const child of children.get(id) || [])
        queue.push([child, collapsed]);
    }
  };
  for (const id of roots) visit(id);
  for (const id of nodes.keys()) if (!visited.has(id)) visit(id);
  for (const i of items)
    if (i.type === "arrow") {
      const owner = hidden.get(i.startId) || hidden.get(i.endId);
      if (owner) hidden.set(i.id, owner);
    }
  for (const thread of comments) {
    const owner = hidden.get(thread.anchorId);
    if (owner && !thread.resolved && thread.messages?.some((m) => !m.deleted))
      counts.get(owner).comments++;
  }
  for (const count of counts.values())
    count.total = count.nodes + count.comments;
  return {
    visible: hidden.size ? items.filter((i) => !hidden.has(i.id)) : items,
    hidden,
    branches,
    counts,
  };
}

export function visibleMindItems(items) {
  return items.some((i) => i.mindMap && i.mindCollapsed)
    ? mindVisibility(items).visible
    : items;
}

export function mindAncestors(items, id) {
  const nodes = new Map(items.filter((i) => i.mindMap).map((i) => [i.id, i]));
  const result = [],
    seen = new Set([id]);
  let parent = nodes.get(id)?.mindMap.parent;
  while (nodes.has(parent) && !seen.has(parent)) {
    seen.add(parent);
    result.push(nodes.get(parent));
    parent = nodes.get(parent).mindMap.parent;
  }
  return result;
}
