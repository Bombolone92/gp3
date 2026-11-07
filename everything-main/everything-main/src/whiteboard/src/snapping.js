import { bounds } from "./model.js";
import { gridMatch } from "./grid.js";
import { dimensionGuides } from "./dimensions.js";
import { isConnector } from "./scene.js";
import { spacingIndex, spacingMatch, spacingGuides } from "./spacing.js";

const anchors = (start, size) => [start + size / 2, start, start + size];
const overlaps = (a, b) =>
  a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;

// Build once per gesture. Equal coordinates are merged, so thousands of aligned
// objects don't turn each pointer update into a scan of the entire board.
export function createSnapIndex(items, selected, viewport) {
  const x = new Map(),
    y = new Map();
  const groups = new Map(),
    gapBoxes = [];
  const add = (map, position, from, to) => {
    const entry = map.get(position);
    if (entry) {
      entry.from = Math.min(entry.from, from);
      entry.to = Math.max(entry.to, to);
    } else map.set(position, { position, from, to });
  };
  for (const i of items) {
    if (selected.has(i.id)) continue;
    const b = bounds([i]);
    if (i.groupId && !isConnector(i)) {
      const previous = groups.get(i.groupId);
      groups.set(i.groupId, previous ? bounds([previous, b]) : b);
    } else if (!["arrow", "pen"].includes(i.type))
      gapBoxes.push({ ...b, frame: i.type === "frame" });
    if (["arrow", "pen"].includes(i.type)) continue;
    if (viewport && !overlaps(b, viewport)) continue;
    for (const position of anchors(b.x, b.w)) add(x, position, b.y, b.y + b.h);
    for (const position of anchors(b.y, b.h)) add(y, position, b.x, b.x + b.w);
  }
  const sort = (map) =>
    [...map.values()].sort((a, b) => a.position - b.position);
  return {
    x: sort(x),
    y: sort(y),
    spacing: spacingIndex(
      [...gapBoxes, ...groups.values()].filter(
        (b) => !viewport || overlaps(b, viewport),
      ),
    ),
  };
}
function nearest(
  entries,
  positions,
  tolerance,
  minimum = -Infinity,
  maximum = Infinity,
) {
  let best = null;
  for (const position of positions) {
    let low = 0,
      high = entries.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (entries[mid].position < position) low = mid + 1;
      else high = mid;
    }
    for (const n of [low - 1, low]) {
      const entry = entries[n];
      if (!entry || entry.position < minimum || entry.position > maximum)
        continue;
      const delta = entry.position - position;
      if (Math.abs(delta) > tolerance) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta))
        best = { ...entry, delta };
    }
  }
  return best;
}
function guide(axis, match, b) {
  return {
    axis,
    position: match.position,
    from: Math.min(match.from, axis === "x" ? b.y : b.x),
    to: Math.max(match.to, axis === "x" ? b.y + b.h : b.x + b.w),
  };
}
export function snapPoint(index, point, zoom) {
  const x = nearest(index.x, [point.x], 6 / zoom);
  const y = nearest(index.y, [point.y], 6 / zoom);
  const box = { x: point.x, y: point.y, w: 0, h: 0 };
  return {
    dx: x?.delta || 0,
    dy: y?.delta || 0,
    guides: [x && guide("x", x, box), y && guide("y", y, box)].filter(Boolean),
  };
}
export function snapMove(index, box, dx, dy, zoom, bypass = false) {
  if (!box || bypass) return { dx, dy, guides: [] };
  const b = { ...box, x: box.x + dx, y: box.y + dy };
  const x = nearest(index.x, anchors(b.x, b.w), 6 / zoom);
  const y = nearest(index.y, anchors(b.y, b.h), 6 / zoom);
  const sx = spacingMatch(index.spacing, b, 0, 6 / zoom);
  const sy = spacingMatch(index.spacing, b, 1, 6 / zoom);
  let useX = sx && (!x || Math.abs(sx.delta) < Math.abs(x.delta) - 1e-9);
  let useY = sy && (!y || Math.abs(sy.delta) < Math.abs(y.delta) - 1e-9);
  const place = () => {
    b.x = box.x + dx + (useX ? sx.delta : x?.delta || 0);
    b.y = box.y + dy + (useY ? sy.delta : y?.delta || 0);
  };
  place();
  // A perpendicular snap must not move the selection out of a spacing lane.
  for (let n = 0; n < 2; n++) {
    if (useX && !spacingGuides(sx, b, "x").length) useX = false;
    if (useY && !spacingGuides(sy, b, "y").length) useY = false;
    place();
  }
  const gapGuides = (match, axis, raw) =>
    match && Math.abs(b[axis] - raw - match.delta) < 1e-9
      ? spacingGuides(match, b, axis)
      : [];
  return {
    dx: b.x - box.x,
    dy: b.y - box.y,
    guides: [
      !useX && x && guide("x", x, b),
      !useY && y && guide("y", y, b),
      ...gapGuides(sx, "x", box.x + dx),
      ...gapGuides(sy, "y", box.y + dy),
    ].filter(Boolean),
  };
}
export function snapResize(
  index,
  box,
  w,
  h,
  zoom,
  bypass = false,
  options = {},
) {
  const {
    minW = 60,
    minH = 45,
    maxW = Infinity,
    maxH = Infinity,
    proportional = false,
    gridStep = 0,
    gridY = true,
    dimensions = null,
    dimensionY = true,
  } = options;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const low = Math.max(minW / box.w, minH / box.h),
    high = Math.min(maxW / box.w, maxH / box.h);
  let b = { ...box, w: clamp(w, minW, maxW), h: clamp(h, minH, maxH) };
  if (proportional) {
    const sx = w / box.w,
      sy = h / box.h;
    const scale = clamp(
      Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy,
      low,
      high,
    );
    b.w = box.w * scale;
    b.h = box.h * scale;
  }
  const matchEdge = (entries, sizes, start, size, min, max) => {
    if (bypass) return null;
    const edge = nearest(
      entries,
      [start + size],
      6 / zoom,
      start + min,
      start + max,
    );
    const dimension = nearest(sizes || [], [size], 6 / zoom, min, max);
    if (
      dimension &&
      (!edge || Math.abs(dimension.delta) < Math.abs(edge.delta) - 1e-9)
    )
      return {
        ...dimension,
        position: start + dimension.position,
        dimension: dimension.box,
      };
    return edge;
  };
  const x =
    matchEdge(index.x, dimensions?.width, b.x, b.w, minW, maxW) ||
    gridMatch(b.x + b.w, gridStep, b.x + minW, b.x + maxW);
  const y =
    matchEdge(
      index.y,
      dimensionY ? dimensions?.height : null,
      b.y,
      b.h,
      minH,
      maxH,
    ) ||
    (gridY && gridMatch(b.y + b.h, gridStep, b.y + minH, b.y + maxH));
  if (proportional) {
    const candidates = [
      x && { scale: (b.w + x.delta) / box.w, grid: !!x.grid },
      y && { scale: (b.h + y.delta) / box.h, grid: !!y.grid },
    ]
      .filter((s) => s && s.scale >= low && s.scale <= high)
      .map(({ scale, grid }) => ({
        scale,
        grid,
        distance: Math.hypot(box.w * scale - b.w, box.h * scale - b.h),
      }))
      .filter((c) => c.grid || c.distance * zoom <= 6 + 1e-9)
      .sort(
        (a, b) => Number(a.grid) - Number(b.grid) || a.distance - b.distance,
      );
    if (candidates.length) {
      b.w = box.w * candidates[0].scale;
      b.h = box.h * candidates[0].scale;
    }
  } else {
    b.w += x?.delta || 0;
    b.h += y?.delta || 0;
  }
  const widthMatch = !bypass && nearest(dimensions?.width || [], [b.w], 1e-9);
  const heightMatch =
    !bypass && dimensionY && nearest(dimensions?.height || [], [b.h], 1e-9);
  return {
    w: b.w,
    h: b.h,
    guides: [
      x &&
        !x.grid &&
        !x.dimension &&
        Math.abs(b.x + b.w - x.position) < 1e-9 &&
        guide("x", x, b),
      y &&
        !y.grid &&
        !y.dimension &&
        Math.abs(b.y + b.h - y.position) < 1e-9 &&
        guide("y", y, b),
      ...dimensionGuides({ dimension: widthMatch?.box }, b, "x", zoom),
      ...dimensionGuides({ dimension: heightMatch?.box }, b, "y", zoom),
    ].filter(Boolean),
  };
}
