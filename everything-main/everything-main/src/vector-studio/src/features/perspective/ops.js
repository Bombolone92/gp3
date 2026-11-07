/**
 * Document operations on objects in perspective (all run inside an open
 * transaction): attach to a plane, release, move within a plane and
 * perpendicular to it, match the grid plane to an object, edit type.
 */
import { nodeBounds, transformNodes, transformFromOriginals, collectOriginals, selectionBounds } from '../../model/geometry.js';
import { expandLive, isLive } from '../../model/live.js';
import { createGroup } from '../../model/nodes.js';
import { apply, multiply, scale, translate } from '../../lib/matrix.js';
import { replaceRange } from '../../model/text-runs.js';
import { toDoc, toFlat, localScale, jacobian, depthOf, planeDocPoint } from './grid-math.js';
import { isPerspective, gridOf, ensureGrid, setGrid, frameFor, frameOfObject, flatBounds, planeOffset, createPerspectiveGroup, cameraOf } from './model.js';

const centerOf = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/**
 * How large flat artwork looks at flat point (x, y) of a frame: on the
 * walls its height (verticals stay true), on the floor its area.
 */
export function apparentScale(frame, x, y) {
  if (frame.plane === 'floor') return localScale(frame, x, y);
  const J = jacobian(frame.H, x, y);
  return J ? Math.hypot(J[2], J[3]) : 1;
}

/**
 * The flat matrix that moves artwork centered at document point `from` onto
 * a plane frame, centered under document point `c`, keeping its apparent
 * size: null when `c` is beyond the plane's horizon.
 */
export function placementMatrix(frame, c, from = c) {
  const f = toFlat(frame, c.x, c.y);
  if (!f) return null;
  const s = 1 / Math.max(1e-6, apparentScale(frame, f.x, f.y));
  return multiply(translate(f.x, f.y), multiply(scale(s, s), translate(-from.x, -from.y)));
}

/** Center of the page box of rect b placed by flat matrix m on a frame. */
function projectedBoxCenter(frame, b, m) {
  const pts = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ].map(([x, y]) => {
    const f = apply(m, x, y);
    return toDoc(frame, f.x, f.y);
  });
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** A fallback point on a plane when the object sits beyond its horizon: the middle of the plane's grid. */
function planeCenter(g, plane, offset) {
  const cam = cameraOf(g).cam;
  const u = plane === 'left' ? g.extent.left / 2 : g.extent.right / 2;
  const v = plane === 'floor' ? g.extent.left / 2 : g.extent.height / 2;
  return planeDocPoint(cam, plane, offset, u, v);
}

/**
 * Attach objects to a plane. Ordinary artwork keeps its position and
 * apparent size; artwork already in perspective moves to the new plane
 * keeping its flat shape. `at` places the artwork's center at a document
 * point instead. Returns the ids of the perspective objects.
 */
export function attachToPlane(doc, ids, plane, { at = null, offset = null } = {}) {
  ensureGrid(doc);
  const g = gridOf(doc);
  const off = offset ?? planeOffset(g, plane);
  const frame = frameFor(g, plane, off);
  const out = [];
  for (const id of ids) {
    const node = doc.get(id);
    if (!node || node.type === 'layer' || node.type === 'root') continue;
    if (isPerspective(node)) {
      out.push(reattach(doc, node, plane, off, at));
      continue;
    }
    const b = nodeBounds(doc, node);
    if (!b) continue;
    const want = at || centerOf(b);
    const from = centerOf(b);
    let m = placementMatrix(frame, want, from);
    if (m) {
      // Perspective shifts the box off the projected center: aim so the box lands centered where asked.
      let target = want;
      for (let i = 0; i < 3; i++) {
        const q = projectedBoxCenter(frame, b, m);
        target = { x: target.x + want.x - q.x, y: target.y + want.y - q.y };
        const next = placementMatrix(frame, target, from);
        if (!next) break;
        m = next;
      }
    } else {
      const c = planeCenter(g, plane, off) || want;
      m = placementMatrix(frame, c, from) || translate(0, 0);
    }
    transformNodes(doc, [id], m);
    out.push(wrap(doc, id, g, plane, off));
  }
  return out;
}

/** Put a node inside a new perspective group at its place in the stacking order. */
export function wrap(doc, id, g, plane, offset) {
  const node = doc.get(id);
  const parent = doc.get(node.parent);
  const index = parent.children.indexOf(id);
  const group = createPerspectiveGroup(g, plane, offset, []);
  doc.insert(group, parent.id, index);
  doc.move(id, group.id);
  return group.id;
}

/** Move a perspective object to another plane, keeping its flat shape and where it shows. */
function reattach(doc, node, plane, offset, at) {
  const fb = flatBounds(doc, node);
  if (!fb) return node.id;
  const from = frameOfObject(doc, node);
  const fc = centerOf(fb);
  const c = at || toDoc(from, fc.x, fc.y);
  const g = gridOf(doc);
  const to = frameFor(g, plane, offset);
  const nf = toFlat(to, c.x, c.y);
  if (!nf) return node.id;
  const s = apparentScale(from, fc.x, fc.y) / Math.max(1e-6, apparentScale(to, nf.x, nf.y));
  const m = multiply(translate(nf.x, nf.y), multiply(scale(s, s), translate(-fc.x, -fc.y)));
  transformNodes(doc, node.children, m);
  doc.update(node.id, { live: { ...node.live, plane, offset, ox: g.ox, oy: g.oy } });
  return node.id;
}

/**
 * Release objects from perspective: each becomes ordinary artwork that
 * keeps its projected look. A single released object is unwrapped from
 * its group. Returns the ids of the released artwork.
 */
export function releaseWithPerspective(doc, ids) {
  const out = [];
  for (const id of ids) {
    const node = doc.get(id);
    if (!isPerspective(node)) continue;
    const g = expandLive(doc, id);
    if (!g) continue;
    const plain = (g.opacity ?? 1) === 1 && (!g.blendMode || g.blendMode === 'normal') && !g.effects?.length && !g.name;
    if (plain && g.children.length === 1) {
      const child = g.children[0];
      const parent = doc.get(g.parent);
      doc.move(child, parent.id, parent.children.indexOf(g.id));
      doc.remove(g.id);
      out.push(child);
    } else out.push(g.id);
  }
  return out;
}

/**
 * Ungroup objects in perspective: each piece of artwork becomes its own
 * object on the same plane (a single group inside is split instead).
 * Returns the resulting perspective objects.
 */
export function splitPerspective(doc, ids) {
  const out = [];
  for (const id of ids) {
    const p = doc.get(id);
    if (!isPerspective(p)) continue;
    const only = p.children.length === 1 ? doc.get(p.children[0]) : null;
    if (only && only.type === 'group' && !only.clip && !isLive(only)) {
      const at = p.children.indexOf(only.id);
      only.children.slice().forEach((c, k) => doc.move(c, p.id, at + k));
      doc.remove(only.id);
    }
    const kids = doc.get(id).children.slice();
    if (kids.length <= 1) {
      out.push(id);
      continue;
    }
    const parent = doc.get(p.parent);
    let index = parent.children.indexOf(id);
    for (const c of kids) {
      const g = createGroup([], { live: { ...p.live } });
      doc.insert(g, parent.id, index++);
      doc.move(c, g.id);
      out.push(g.id);
    }
    doc.remove(id);
  }
  return out;
}

/** Move an object's grid plane to the object's plane position. Returns the plane, or null. */
export function movePlaneToMatch(doc, id) {
  const node = doc.get(id);
  if (!isPerspective(node)) return null;
  const g = gridOf(doc);
  setGrid(doc, { ...g, planes: { ...g.planes, [node.live.plane]: node.live.offset || 0 } });
  return node.live.plane;
}

/**
 * Move a grid plane to a new position. With `moveObjects`, objects on that
 * plane at its old position move with it ('copy' leaves copies behind).
 */
export function movePlane(doc, plane, offset, moveObjects = false) {
  ensureGrid(doc);
  const g = gridOf(doc);
  const old = planeOffset(g, plane);
  setGrid(doc, { ...g, planes: { ...g.planes, [plane]: offset } });
  if (!moveObjects) return [];
  const moved = [];
  doc.walk((n) => {
    if (isPerspective(n)) {
      if (n.live.plane === plane && Math.abs((n.live.offset || 0) - old) < 1e-6) moved.push(n.id);
      return false;
    }
    return true;
  });
  for (const id of moved) {
    if (moveObjects === 'copy') {
      const n = doc.get(id);
      const parent = doc.get(n.parent);
      const { node, descendants } = doc.cloneSubtree(id);
      doc.insert(node, parent.id, parent.children.indexOf(id), descendants);
    }
    const n = doc.get(id);
    doc.update(id, { live: { ...n.live, offset } });
  }
  return moved;
}

/** Set the plane position of objects (moving them perpendicular to their plane). */
export function setObjectOffset(doc, id, offset) {
  const n = doc.get(id);
  if (isPerspective(n)) doc.update(id, { live: { ...n.live, offset } });
}

/**
 * Move perspective objects within their planes by a flat matrix built per
 * object (from originals, for drags): originals is collectOriginals() of
 * the objects' children.
 */
export function transformInPlane(doc, originals, m) {
  transformFromOriginals(doc, originals, m);
}

/** Originals of the children of perspective objects (for transformInPlane). */
export function childOriginals(doc, ids) {
  const kids = [];
  for (const id of ids) {
    const n = doc.get(id);
    if (isPerspective(n)) kids.push(...n.children);
  }
  return collectOriginals(doc, kids);
}

/** Text objects inside a perspective object. */
export function perspectiveTexts(doc, id) {
  const out = [];
  const visit = (nid) => {
    const n = doc.get(nid);
    if (!n) return;
    if (n.type === 'text') out.push(n);
    for (const c of n.children || []) visit(c);
  };
  const n = doc.get(id);
  if (isPerspective(n)) for (const c of n.children) visit(c);
  return out;
}

/** Replace the content of a text object keeping the styles of the unchanged parts. */
export function setTextContent(doc, id, text) {
  const n = doc.get(id);
  if (!n || n.type !== 'text') return;
  const old = String(n.text ?? '');
  const next = String(text ?? '');
  if (old === next) return;
  let a = 0;
  while (a < old.length && a < next.length && old[a] === next[a]) a++;
  let b = 0;
  while (b < old.length - a && b < next.length - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b++;
  doc.update(id, replaceRange(n, a, old.length - b, next.slice(a, next.length - b)));
}

/** True when moving flat point p of a frame keeps it in front of the viewer. */
export function inFront(frame, p) {
  return depthOf(frame, p.x, p.y) > 1 / 50;
}

/** Projected bounds of several objects (for feedback). */
export function projectedBounds(doc, ids) {
  return selectionBounds(doc, ids, false);
}
