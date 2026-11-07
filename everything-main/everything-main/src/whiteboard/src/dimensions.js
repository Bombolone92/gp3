import { bounds, resizeBounds } from "./model.js";
import { isConnector } from "./scene.js";
import { objectBounds, rotationOf } from "./geometry.js";

export const DIMENSIONS_STORAGE_KEY = "whiteboard-dimensions";
export const readDimensions = (value) => value === "true";
export const dimensionLabel = (box) =>
  `${Math.round(box.w * 10) / 10} × ${Math.round(box.h * 10) / 10} px`;
export function dimensionBounds(items, selection, frameId) {
  const box = resizeBounds(items, selection, frameId);
  if (box) return box;
  const chosen = items.filter((i) => selection.has(i.id));
  return chosen.length === 1 && chosen[0].type === "pen"
    ? bounds(chosen)
    : null;
}

// One representative per size keeps pointer-time lookups logarithmic even when
// thousands of objects share a size. Prefer the closest visible reference.
export function createDimensionIndex(items, selected, viewport, origin) {
  const groups = new Map(),
    boxes = [];
  for (const i of items) {
    if (selected.has(i.id) || isConnector(i)) continue;
    const b = bounds([i]);
    if (i.groupId) {
      const previous = groups.get(i.groupId);
      groups.set(i.groupId, previous ? bounds([previous, b]) : b);
    }
    // A turned object's width and height are not those of the box around
    // it, and an axis-aligned bar cannot show them, so it is no reference.
    else if (i.type !== "arrow" && !rotationOf(i)) boxes.push(b);
  }
  const width = new Map(),
    height = new Map();
  const distance = (b) =>
    Math.hypot(
      b.x + b.w / 2 - origin.x - origin.w / 2,
      b.y + b.h / 2 - origin.y - origin.h / 2,
    );
  const add = (map, position, box) => {
    if (!(position > 0)) return;
    const previous = map.get(position),
      d = distance(box);
    if (
      !previous ||
      d < previous.distance ||
      (d === previous.distance &&
        (box.x < previous.box.x ||
          (box.x === previous.box.x && box.y < previous.box.y)))
    )
      map.set(position, { position, box, distance: d });
  };
  for (const b of [...boxes, ...groups.values()]) {
    if (
      viewport &&
      (b.x > viewport.x + viewport.w ||
        b.x + b.w < viewport.x ||
        b.y > viewport.y + viewport.h ||
        b.y + b.h < viewport.y)
    )
      continue;
    add(width, b.w, b);
    add(height, b.h, b);
  }
  const sorted = (map) =>
    [...map.values()].sort((a, b) => a.position - b.position);
  return { width: sorted(width), height: sorted(height) };
}

export function dimensionGuides(match, box, axis, zoom) {
  if (!match?.dimension) return [];
  const horizontal = axis === "x",
    size = horizontal ? "w" : "h";
  if (Math.abs(box[size] - match.dimension[size]) > 1e-9) return [];
  return [box, match.dimension].map((b) => ({
    kind: "dimension",
    axis,
    position: (horizontal ? b.y : b.x) - 14 / zoom,
    from: b[axis],
    to: b[axis] + b[size],
    size: b[size],
  }));
}

export function dimensionBadge(box, view, viewport) {
  if (!box || viewport.width < 180 || viewport.height < 120) return null;
  const narrow = viewport.width <= 760,
    minimumY = narrow ? 220 : 130,
    maximumY = viewport.height - (narrow ? 190 : 102);
  if (maximumY < minimumY) return null;
  const visual = objectBounds(box, box.rotation || 0);
  const left = view.x + visual.x * view.z,
    top = view.y + visual.y * view.z,
    right = left + visual.w * view.z,
    bottom = top + visual.h * view.z;
  if (right < 0 || bottom < 0 || left > viewport.width || top > viewport.height)
    return null;
  return {
    label: dimensionLabel(box),
    x: Math.max(90, Math.min(viewport.width - 90, (left + right) / 2)),
    // Quick-connect handles occupy the first 52 pixels outside the object.
    // Keep the badge beyond those hit areas, or above when the bottom is full.
    y: Math.max(
      minimumY,
      Math.min(
        maximumY,
        bottom + 58 <= maximumY
          ? bottom + 58
          : top - 86 >= minimumY
            ? top - 86
            : bottom + 58,
      ),
    ),
  };
}
