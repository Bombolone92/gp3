/**
 * Snapping and alignment guides.
 *
 * A SnapIndex is built once per drag from the visible, unselected artwork:
 * anchor points, object bounds (corners, edge midpoints, centers),
 * artboard edges and centers, and ruler guides. Lookups use x- and y-sorted
 * arrays with binary search, so dragging stays cheap with large documents.
 *
 * snapPoint() snaps a single point (drawing tools, anchors) and snapBox()
 * snaps a moving box (Selection tool drags), both returning the guide
 * lines and labels the overlay draws.
 */
import { nodeBounds, rectsIntersect } from '../model/geometry.js';
import { liveDef } from '../model/live.js';

const MAX_POINTS = 20000;

/**
 * Features add snap points with hook(editor, points, { exclude, visible });
 * a point's `label` names it in alignment guide feedback (e.g. glyph guides).
 */
export const snapHooks = new Set();

function lowerBound(arr, v) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class SnapIndex {
  constructor(points) {
    this.points = points; // [{ x, y, kind }]
    this.byX = points.slice().sort((a, b) => a.x - b.x);
    this.byY = points.slice().sort((a, b) => a.y - b.y);
    this.xs = this.byX.map((p) => p.x);
    this.ys = this.byY.map((p) => p.y);
  }

  /** Nearest point within tolerance (Euclidean). */
  nearest(x, y, t) {
    let best = null;
    let bestD = t;
    const i0 = lowerBound(this.xs, x - t);
    for (let i = i0; i < this.byX.length && this.byX[i].x <= x + t; i++) {
      const p = this.byX[i];
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Points whose x is within t of x: the closest x value and the points sharing it. */
  alignX(x, t) {
    const i0 = lowerBound(this.xs, x - t);
    let best = null;
    let bestD = t;
    for (let i = i0; i < this.byX.length && this.byX[i].x <= x + t; i++) {
      const d = Math.abs(this.byX[i].x - x);
      if (d < bestD) {
        bestD = d;
        best = this.byX[i];
      }
    }
    return best;
  }

  alignY(y, t) {
    const i0 = lowerBound(this.ys, y - t);
    let best = null;
    let bestD = t;
    for (let i = i0; i < this.byY.length && this.byY[i].y <= y + t; i++) {
      const d = Math.abs(this.byY[i].y - y);
      if (d < bestD) {
        bestD = d;
        best = this.byY[i];
      }
    }
    return best;
  }
}

/** Build the snap index for an editor, excluding the given ids (and their descendants). */
export function buildSnapIndex(editor, exclude = new Set()) {
  const { doc, view } = editor;
  const points = [];
  const visible = view.visibleRect(view.width * 0.5);
  // visit() walks top-down and stops at an excluded node, so descendants of
  // excluded objects are never reached: a set lookup is enough (dragging a
  // selection of thousands used to test every pair).
  const excluded = (id) => exclude.has(id);
  const addBox = (b, kind = 'bounds') => {
    if (!b) return;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    points.push(
      { x: b.x, y: b.y, kind },
      { x: b.x + b.w, y: b.y, kind },
      { x: b.x, y: b.y + b.h, kind },
      { x: b.x + b.w, y: b.y + b.h, kind },
      { x: cx, y: b.y, kind },
      { x: cx, y: b.y + b.h, kind },
      { x: b.x, y: cy, kind },
      { x: b.x + b.w, y: cy, kind },
      { x: cx, y: cy, kind: 'center' },
    );
  };
  for (const a of doc.artboards) addBox(a, 'artboard');
  const visit = (node) => {
    if (points.length > MAX_POINTS) return;
    if (!node || node.hidden || excluded(node.id)) return;
    // Objects whose contents live in their own space (perspective) snap by their bounds.
    if (node.type === 'layer' || (node.type === 'group' && !liveDef(node)?.ownSpace)) {
      for (const c of node.children) visit(doc.get(c));
      return;
    }
    const b = nodeBounds(doc, node);
    if (!b || !rectsIntersect(b, visible)) return;
    addBox(b);
    const paths = node.type === 'path' ? [node] : node.type === 'compound' ? node.children.map((c) => doc.get(c)).filter(Boolean) : [];
    for (const p of paths) for (const a of p.anchors) points.push({ x: a.x, y: a.y, kind: 'anchor' });
  };
  for (const id of doc.root.children) visit(doc.get(id));
  for (const hook of snapHooks) if (points.length <= MAX_POINTS) hook(editor, points, { exclude, visible });
  const guides = editor.viewOptions.guides ? doc.root.guides || [] : [];
  return { index: new SnapIndex(points), guides };
}

function gridSnap(editor, v) {
  const grid = editor.doc.root.grid || { spacing: 72, subdivisions: 8 };
  const step = grid.spacing / grid.subdivisions;
  return Math.round(v / step) * step;
}

/**
 * Snap a point. Returns { x, y, lines, labels, snapped }.
 * `snap` is the result of buildSnapIndex (may be null).
 */
export function snapPoint(editor, x, y, snap, { tolPx = editor.prefs?.get('snapTolerance') || 5 } = {}) {
  const t = tolPx / editor.view.zoom;
  const opts = editor.viewOptions;
  const out = { x, y, lines: [], labels: [], snapped: false };
  if (opts.snapToGrid && opts.grid !== undefined) {
    out.x = gridSnap(editor, x);
    out.y = gridSnap(editor, y);
    out.snapped = true;
    return out;
  }
  if (snap && (opts.snapToPoint || opts.alignmentGuides)) {
    const p = snap.index.nearest(x, y, t);
    if (p) {
      out.x = p.x;
      out.y = p.y;
      out.snapped = true;
      if (opts.alignmentGuides) out.labels.push({ x: p.x, y: p.y, text: p.label ? p.label : p.kind === 'center' ? 'center' : p.kind === 'anchor' ? 'anchor' : p.kind === 'artboard' ? 'artboard' : 'point' });
      return out;
    }
  }
  if (snap && opts.alignmentGuides) {
    const ax = snap.index.alignX(x, t);
    const ay = snap.index.alignY(y, t);
    if (ax) {
      out.x = ax.x;
      out.lines.push({ x1: ax.x, y1: Math.min(ax.y, y), x2: ax.x, y2: Math.max(ax.y, y) });
      out.snapped = true;
    }
    if (ay) {
      out.y = ay.y;
      out.lines.push({ x1: Math.min(ay.x, x), y1: ay.y, x2: Math.max(ay.x, x), y2: ay.y });
      out.snapped = true;
      if (ay.label && !ax) out.labels.push({ x: out.x, y: ay.y, text: ay.label });
    }
    if (ax && ay) out.labels.push({ x: out.x, y: out.y, text: 'intersect' });
  }
  if (snap) {
    for (const g of snap.guides) {
      if (g.axis === 'x' && Math.abs(g.pos - out.x) < t) {
        out.x = g.pos;
        out.snapped = true;
      }
      if (g.axis === 'y' && Math.abs(g.pos - out.y) < t) {
        out.y = g.pos;
        out.snapped = true;
      }
    }
  }
  if (opts.snapToPixel) {
    out.x = Math.round(out.x);
    out.y = Math.round(out.y);
  }
  return out;
}

/**
 * Snap a moving box (its edges and center) to the index. Returns the
 * corrected delta { dx, dy, lines, labels }.
 */
export function snapBox(editor, box, dx, dy, snap, { tolPx = editor.prefs?.get('snapTolerance') || 5 } = {}) {
  const t = tolPx / editor.view.zoom;
  const opts = editor.viewOptions;
  const out = { dx, dy, lines: [], labels: [] };
  const b = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
  if (opts.snapToGrid) {
    out.dx += gridSnap(editor, b.x) - b.x;
    out.dy += gridSnap(editor, b.y) - b.y;
    return out;
  }
  if (!snap || !(opts.alignmentGuides || opts.snapToPoint)) {
    if (opts.snapToPixel) {
      out.dx += Math.round(b.x) - b.x;
      out.dy += Math.round(b.y) - b.y;
    }
    return out;
  }
  const xs = [b.x, b.x + b.w / 2, b.x + b.w];
  const ys = [b.y, b.y + b.h / 2, b.y + b.h];
  let bestX = null;
  for (const x of xs) {
    const p = snap.index.alignX(x, t);
    if (p && (!bestX || Math.abs(p.x - x) < Math.abs(bestX.d))) bestX = { d: p.x - x, p };
  }
  for (const g of snap.guides) {
    if (g.axis !== 'x') continue;
    for (const x of xs) if (Math.abs(g.pos - x) < t && (!bestX || Math.abs(g.pos - x) < Math.abs(bestX.d))) bestX = { d: g.pos - x, p: { x: g.pos, y: b.y } };
  }
  let bestY = null;
  for (const y of ys) {
    const p = snap.index.alignY(y, t);
    if (p && (!bestY || Math.abs(p.y - y) < Math.abs(bestY.d))) bestY = { d: p.y - y, p };
  }
  for (const g of snap.guides) {
    if (g.axis !== 'y') continue;
    for (const y of ys) if (Math.abs(g.pos - y) < t && (!bestY || Math.abs(g.pos - y) < Math.abs(bestY.d))) bestY = { d: g.pos - y, p: { x: b.x, y: g.pos } };
  }
  if (bestX) {
    out.dx += bestX.d;
    const x = bestX.p.x;
    if (opts.alignmentGuides) out.lines.push({ x1: x, y1: Math.min(bestX.p.y, b.y), x2: x, y2: Math.max(bestX.p.y, b.y + b.h) });
  }
  if (bestY) {
    out.dy += bestY.d;
    const y = bestY.p.y;
    if (opts.alignmentGuides) out.lines.push({ x1: Math.min(bestY.p.x, b.x + out.dx - dx), y1: y, x2: Math.max(bestY.p.x, b.x + b.w + out.dx - dx), y2: y });
    if (opts.alignmentGuides && bestY.p.label) out.labels.push({ x: bestY.p.x, y, text: bestY.p.label });
  }
  if (opts.snapToPixel) {
    const nx = box.x + out.dx;
    const ny = box.y + out.dy;
    out.dx += Math.round(nx) - nx;
    out.dy += Math.round(ny) - ny;
  }
  return out;
}
