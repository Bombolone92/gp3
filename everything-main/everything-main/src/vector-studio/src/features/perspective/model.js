/**
 * The perspective grid of a document and objects in perspective.
 *
 * The grid lives in the document root (`root.perspective`, see
 * grid-math.js) so it is saved with the file and every edit is undoable.
 * Documents that never defined one use a default two-point grid on the
 * first artboard; creating the first object in perspective writes that
 * grid into the document so later artboard edits cannot move the object.
 *
 * An object in perspective is a group
 *   { type: 'group', live: { kind: 'perspective', plane, offset, ox, oy }, children }
 * whose children keep their flat (unprojected) geometry in plane
 * coordinates. It draws as live artwork (see project.js); `offset` is the
 * position of its own plane, so moving a grid plane leaves it in place, and
 * (ox, oy) is the flat point on the grid's corner, so moving the whole grid
 * carries it along.
 */
import { createGroup } from '../../model/nodes.js';
import { nodeBounds, unionRect } from '../../model/geometry.js';
import { camera, planeFrame, normalizeGrid, defaultGrid, PLANES } from './grid-math.js';

export const KIND = 'perspective';

export function isPerspective(node) {
  return Boolean(node && node.type === 'group' && node.live?.kind === KIND);
}

/** The perspective object a node belongs to (itself, or the closest one above it), or null. */
export function perspectiveOwner(doc, id) {
  let n = doc.get(id);
  while (n && n.type !== 'layer' && n.type !== 'root') {
    if (isPerspective(n)) return n;
    n = n.parent ? doc.get(n.parent) : null;
  }
  return null;
}

const normalized = new WeakMap();
const defaults = new WeakMap();

/** The document's grid (normalized; the same object until the grid changes). */
export function gridOf(doc) {
  const raw = doc.root?.perspective;
  if (raw) {
    let g = normalized.get(raw);
    if (!g) normalized.set(raw, (g = normalizeGrid(raw, doc.artboards?.[0])));
    return g;
  }
  const key = doc.artboards || doc.root || doc;
  let g = defaults.get(key);
  if (!g) defaults.set(key, (g = defaultGrid('two', doc.artboards?.[0])));
  return g;
}

/** True once the document stores its own grid. */
export function hasStoredGrid(doc) {
  return Boolean(doc.root?.perspective);
}

/** Write the grid into the document (inside a transaction). */
export function setGrid(doc, grid) {
  doc.updateRoot({ perspective: { ...grid } });
}

/** Make sure the document stores its grid (inside a transaction). */
export function ensureGrid(doc) {
  if (!hasStoredGrid(doc)) setGrid(doc, gridOf(doc));
}

const cameras = new WeakMap();

/** Camera of a grid (cached per grid object). */
export function cameraOf(g) {
  let c = cameras.get(g);
  if (!c) cameras.set(g, (c = { cam: camera(g), frames: new Map() }));
  return c;
}

/**
 * The flat-to-document frame of a plane at an offset (cached per grid).
 * `ref` is the flat point on the corner, by default the grid's ground point.
 */
export function frameFor(g, plane, offset = 0, ref = null) {
  const c = cameraOf(g);
  const r = ref && Number.isFinite(ref.ox) && Number.isFinite(ref.oy) ? ref : { ox: g.ox, oy: g.oy };
  const key = `${plane}|${offset}|${r.ox}|${r.oy}`;
  let f = c.frames.get(key);
  if (!f) {
    if (c.frames.size > 256) c.frames.clear();
    c.frames.set(key, (f = planeFrame(g, plane, offset, c.cam, r)));
  }
  return f;
}

/** The frame a perspective object draws through. */
export function frameOfObject(doc, node) {
  return frameFor(gridOf(doc), node.live.plane, node.live.offset || 0, node.live);
}

/** The grid plane position of a plane. */
export function planeOffset(g, plane) {
  return g.planes?.[plane] || 0;
}

/** Flat bounds of a perspective object's contents. */
export function flatBounds(doc, node) {
  let b = null;
  for (const c of node.children || []) {
    const cn = doc.get(c);
    if (cn && !cn.hidden) b = unionRect(b, nodeBounds(doc, cn));
  }
  return b;
}

/** A new perspective group on a plane of grid g (the caller inserts it). */
export function createPerspectiveGroup(g, plane, offset, children = [], extra = {}) {
  if (!PLANES.includes(plane)) throw new Error(`Unknown plane ${plane}`);
  return createGroup(children, { ...extra, live: { kind: KIND, plane, offset, ox: g.ox, oy: g.oy } });
}
