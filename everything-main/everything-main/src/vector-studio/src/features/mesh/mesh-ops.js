/**
 * Mesh operations on the document: converting paths to meshes (Object >
 * Create Gradient Mesh and the Mesh tool), and adding and removing mesh
 * lines. Each runs inside the caller's transaction.
 */
import { createMesh, meshFromOutline, addPointAt, removeColumn, removeRow, rowCol } from './mesh-model.js';
import { gradientGeometry, nodeBounds } from '../../model/geometry.js';
import { sampleStops } from '../../model/gradients.js';
import { isMesh } from './mesh-live.js';

/** Closed, single-outline paths that can become meshes. */
export function canMesh(node) {
  return Boolean(node && node.type === 'path' && node.anchors?.length >= 2 && !node.locked);
}

/** The color and opacity of a paint at a document point (gradients are sampled). */
export function paintAt(paint, bounds, x, y) {
  if (!paint) return { color: '#ffffff', opacity: 1 };
  if (paint.type === 'solid') return { color: paint.color, opacity: paint.opacity ?? 1 };
  if (paint.type === 'linear' || paint.type === 'radial') {
    const g = gradientGeometry(paint, bounds);
    let t;
    if (paint.type === 'linear') {
      const dx = g.x2 - g.x1;
      const dy = g.y2 - g.y1;
      const l2 = dx * dx + dy * dy || 1;
      t = ((x - g.x1) * dx + (y - g.y1) * dy) / l2;
    } else {
      const aspect = paint.aspect > 0 ? paint.aspect : 1;
      const ang = Math.atan2(g.y2 - g.y1, g.x2 - g.x1);
      const c = Math.cos(-ang);
      const s = Math.sin(-ang);
      const u = (x - g.x1) * c - (y - g.y1) * s;
      const v = ((x - g.x1) * s + (y - g.y1) * c) / aspect;
      t = Math.hypot(u, v) / Math.max(g.r, 1e-9);
    }
    return sampleStops(paint.stops, Math.max(0, Math.min(1, t)));
  }
  return { color: '#ffffff', opacity: 1 };
}

/**
 * Replace a path by a mesh (inside a transaction). Options as
 * meshFromOutline; without `color` the path's fill gives every point's
 * color (a gradient fill is sampled at each point). Returns the mesh node.
 */
export function convertToMesh(doc, id, opts = {}) {
  const node = doc.get(id);
  if (!canMesh(node)) return null;
  const color = opts.color || (node.fill?.type === 'solid' ? node.fill.color : '#ffffff');
  const g = meshFromOutline(node.anchors, { ...opts, color });
  if (!opts.color && node.fill && node.fill.type !== 'solid') {
    const b = nodeBounds(doc, node);
    const hi = opts.appearance && opts.appearance !== 'flat';
    for (const p of g.points) {
      const s = paintAt(node.fill, b, p.x, p.y);
      if (!hi) p.c = s.color;
      p.a = s.opacity;
    }
  } else if (node.fill?.type === 'solid' && node.fill.opacity != null) {
    for (const p of g.points) p.a = node.fill.opacity;
  }
  const { name, opacity, blendMode, effects, hidden, locked, frameAngle } = node;
  const mesh = createMesh(g.rows, g.cols, g.points, { name: name || '', opacity: opacity ?? 1, blendMode: blendMode || 'normal', effects: effects || [], hidden: Boolean(hidden), locked: Boolean(locked), ...(frameAngle !== undefined ? { frameAngle } : {}) });
  const parent = doc.get(node.parent);
  const index = parent ? parent.children.indexOf(id) : Infinity;
  doc.remove(id);
  return doc.insert(mesh, node.parent, index);
}

/**
 * Add a mesh point at a document point (inside a transaction): on a mesh
 * line within `tolerance` one line is added across it, elsewhere inside the
 * mesh a row and a column line. The new point takes `color` when given.
 * Returns the new point index or -1.
 */
export function addMeshPoint(doc, id, x, y, { tolerance = 0, color = null } = {}) {
  const node = doc.get(id);
  if (!isMesh(node)) return -1;
  const r = addPointAt(node, x, y, tolerance);
  if (!r) return -1;
  const points = r.mesh.points.slice();
  if (color) points[r.k] = { ...points[r.k], c: color, a: 1 };
  doc.update(id, { rows: r.mesh.rows, cols: r.mesh.cols, points });
  return r.k;
}

/** Remove the line(s) through a mesh point or along an edge (inside a transaction). Returns true when changed. */
export function removeMeshLines(doc, id, { k = null, edge = null } = {}) {
  const node = doc.get(id);
  if (!isMesh(node)) return false;
  let m = node;
  if (k != null) {
    const [i, j] = rowCol(m, k);
    if (j > 0 && j < m.cols) m = removeColumn(m, j);
    if (i > 0 && i < m.rows) m = removeRow(m, i);
  } else if (edge) {
    // A horizontal edge lies on a row line; a vertical one on a column line.
    if (edge.kind === 'h' && edge.i > 0 && edge.i < m.rows) m = removeRow(m, edge.i);
    else if (edge.kind === 'v' && edge.j > 0 && edge.j < m.cols) m = removeColumn(m, edge.j);
  }
  if (m === node) return false;
  doc.update(id, { rows: m.rows, cols: m.cols, points: m.points });
  return true;
}

/** Remove the interior lines through several mesh points at once (inside a transaction). Returns true when changed. */
export function removeLinesThrough(doc, id, points) {
  const node = doc.get(id);
  if (!isMesh(node)) return false;
  const rows = new Set();
  const cols = new Set();
  for (const k of points) {
    const [i, j] = rowCol(node, k);
    if (i > 0 && i < node.rows) rows.add(i);
    if (j > 0 && j < node.cols) cols.add(j);
  }
  if (!rows.size && !cols.size) return false;
  let m = node;
  for (const j of [...cols].sort((a, b) => b - a)) m = removeColumn(m, j);
  for (const i of [...rows].sort((a, b) => b - a)) m = removeRow(m, i);
  doc.update(id, { rows: m.rows, cols: m.cols, points: m.points });
  return true;
}
