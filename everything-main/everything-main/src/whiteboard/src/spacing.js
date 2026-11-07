// A bounding-volume tree supports directional neighbor searches without building
// all object pairs or scanning a long row on every pointer event.
const start = (b, axis) => (axis === 0 ? b.x : b.y);
const size = (b, axis) => (axis === 0 ? b.w : b.h);
const end = (b, axis) => start(b, axis) + size(b, axis);

export function spacingIndex(boxes) {
  if (!boxes.length) return null;
  const node = {
    min: [Infinity, Infinity],
    max: [-Infinity, -Infinity],
    minEnd: [Infinity, Infinity],
    maxStart: [-Infinity, -Infinity],
  };
  for (const b of boxes)
    for (const axis of [0, 1]) {
      node.min[axis] = Math.min(node.min[axis], start(b, axis));
      node.max[axis] = Math.max(node.max[axis], end(b, axis));
      node.minEnd[axis] = Math.min(node.minEnd[axis], end(b, axis));
      node.maxStart[axis] = Math.max(node.maxStart[axis], start(b, axis));
    }
  if (boxes.length <= 8) node.boxes = boxes;
  else {
    const axis = node.max[0] - node.min[0] >= node.max[1] - node.min[1] ? 0 : 1;
    const sorted = [...boxes].sort(
      (a, b) =>
        start(a, axis) +
          size(a, axis) / 2 -
          start(b, axis) -
          size(b, axis) / 2 ||
        start(a, 1 - axis) - start(b, 1 - axis) ||
        size(a, axis) - size(b, axis),
    );
    const middle = sorted.length >>> 1;
    node.children = [
      spacingIndex(sorted.slice(0, middle)),
      spacingIndex(sorted.slice(middle)),
    ];
  }
  return node;
}

function neighbor(tree, axis, before, limit, crossFrom, crossTo) {
  const cross = 1 - axis;
  let found = null,
    best = before ? -Infinity : Infinity;
  const score = (node) => (before ? node.max[axis] : node.min[axis]);
  const visit = (node) => {
    if (!node || node.max[cross] <= crossFrom || node.min[cross] >= crossTo)
      return;
    if (
      before
        ? node.minEnd[axis] > limit || score(node) < best
        : node.maxStart[axis] < limit || score(node) > best
    )
      return;
    if (node.boxes) {
      for (const b of node.boxes) {
        if (end(b, cross) <= crossFrom || start(b, cross) >= crossTo) continue;
        const position = before ? end(b, axis) : start(b, axis);
        if (
          before
            ? position > limit || position < best
            : position < limit || position > best
        )
          continue;
        // Equal edges prefer the closest cross-axis center, then stable geometry.
        const distance = Math.abs(
          start(b, cross) + size(b, cross) / 2 - (crossFrom + crossTo) / 2,
        );
        if (position === best && found) {
          const order =
            distance - found.distance ||
            size(b, axis) - size(found.box, axis) ||
            start(b, cross) - start(found.box, cross) ||
            size(b, cross) - size(found.box, cross);
          if (order >= 0) continue;
        }
        best = position;
        found = { box: b, distance };
      }
    } else {
      const [a, b] = node.children;
      const first = before ? score(a) >= score(b) : score(a) <= score(b);
      visit(first ? a : b);
      visit(first ? b : a);
    }
  };
  visit(tree);
  return found?.box;
}

function clearGap(tree, axis, from, to, crossFrom, crossTo) {
  if (!tree) return true;
  const cross = 1 - axis;
  if (
    tree.max[axis] <= from ||
    tree.min[axis] >= to ||
    tree.max[cross] <= crossFrom ||
    tree.min[cross] >= crossTo
  )
    return true;
  if (tree.boxes)
    return tree.boxes.every(
      (b) =>
        b.frame ||
        end(b, axis) <= from ||
        start(b, axis) >= to ||
        end(b, cross) <= crossFrom ||
        start(b, cross) >= crossTo,
    );
  return tree.children.every((node) =>
    clearGap(node, axis, from, to, crossFrom, crossTo),
  );
}

export function spacingMatch(tree, box, axis, tolerance) {
  if (!tree) return null;
  const cross = 1 - axis,
    from = start(box, cross),
    to = end(box, cross);
  const left = neighbor(tree, axis, true, start(box, axis), from, to);
  const right = neighbor(tree, axis, false, end(box, axis), from, to);
  let best = null;
  const consider = (a, b, position, gap, middle) => {
    if (!a || !b || gap <= 0) return;
    if (
      !middle &&
      ((left && position < end(left, axis) - 1e-9) ||
        (right && position + size(box, axis) > start(right, axis) + 1e-9))
    )
      return;
    const crossFrom = Math.max(start(a, cross), start(b, cross));
    const crossTo = Math.min(end(a, cross), end(b, cross));
    if (Math.max(crossFrom, from) >= Math.min(crossTo, to)) return;
    const delta = position - start(box, axis);
    if (Math.abs(delta) > tolerance + 1e-9) return;
    if (best && Math.abs(delta) >= Math.abs(best.delta) - 1e-9) return;
    const match = {
      delta,
      gap,
      crossFrom,
      crossTo,
      spans: middle
        ? [
            [end(a, axis), position],
            [position + size(box, axis), start(b, axis)],
          ]
        : position > start(b, axis)
          ? [
              [end(a, axis), start(b, axis)],
              [end(b, axis), position],
            ]
          : [
              [position + size(box, axis), start(a, axis)],
              [end(a, axis), start(b, axis)],
            ],
    };
    // Overlapping objects must not be skipped when locating the previous edge.
    // Frames are background containers and don't obstruct their contents' gaps.
    if (
      match.spans.every(([a, b]) =>
        clearGap(
          tree,
          axis,
          a,
          b,
          Math.max(crossFrom, from),
          Math.min(crossTo, to),
        ),
      )
    )
      best = match;
  };
  if (left && right) {
    const gap = (start(right, axis) - end(left, axis) - size(box, axis)) / 2;
    consider(left, right, end(left, axis) + gap, gap, true);
  }
  if (left) {
    const previous = neighbor(
      tree,
      axis,
      true,
      start(left, axis),
      Math.max(from, start(left, cross)),
      Math.min(to, end(left, cross)),
    );
    if (previous) {
      const gap = start(left, axis) - end(previous, axis);
      consider(previous, left, end(left, axis) + gap, gap, false);
    }
  }
  if (right) {
    const next = neighbor(
      tree,
      axis,
      false,
      end(right, axis),
      Math.max(from, start(right, cross)),
      Math.min(to, end(right, cross)),
    );
    if (next) {
      const gap = start(next, axis) - end(right, axis);
      consider(
        right,
        next,
        start(right, axis) - gap - size(box, axis),
        gap,
        false,
      );
    }
  }
  return best;
}

export function spacingGuides(match, box, axis) {
  if (!match) return [];
  const cross = axis === "x" ? 1 : 0;
  const from = Math.max(match.crossFrom, start(box, cross)),
    to = Math.min(match.crossTo, end(box, cross));
  if (from >= to) return [];
  return match.spans.map(([a, b]) => ({
    kind: "spacing",
    axis,
    position: (from + to) / 2,
    from: a,
    to: b,
    gap: match.gap,
  }));
}
