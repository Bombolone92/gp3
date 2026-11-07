/**
 * Repeats: live groups that draw their contents (the source) several times.
 *
 *   node.live = { kind: 'repeat', mode: 'radial', cx, cy, count, span, reverse, ccw }
 *   node.live = { kind: 'repeat', mode: 'grid', cols, rows, hSpacing, vSpacing,
 *                 gridType: 'grid'|'brickRow'|'brickCol', flipRowH, flipRowV,
 *                 flipColH, flipColV, frame: [ux, uy, vx, vy] }
 *   node.live = { kind: 'repeat', mode: 'mirror', x1, y1, x2, y2 }
 *
 * The source stays where it is and draws as itself as the first instance,
 * so it can be edited in place (in isolation mode) while every other
 * instance follows:
 *
 *  - Radial: instance i is the source turned by i steps about (cx, cy).
 *    The radius and start angle are where the source sits; `span` (degrees,
 *    360 = full circle) spreads the instances over an arc; `reverse` flips
 *    which neighbor overlaps which.
 *  - Grid: tiles of the source's size plus spacing, laid out along the
 *    frame axes from the source; brick types offset alternate rows or
 *    columns by half a tile; the flip flags mirror alternate rows/columns.
 *  - Mirror: the source plus its reflection in the axis through (x1, y1)
 *    and (x2, y2).
 */
import { registerLive } from '../../model/live.js';
import { createGroup } from '../../model/nodes.js';
import { multiply, rotate, translate, scale, apply, applyVector, invert } from '../../lib/matrix.js';
import { transformPatches } from '../../model/geometry.js';
import { transformedCopy, childrenBounds, childrenBoundsIn } from './virtual.js';

export const REPEAT_MODES = ['radial', 'grid', 'mirror'];

export const REPEAT_DEFAULTS = Object.freeze({
  radial: Object.freeze({ count: 8, span: 360, reverse: false }),
  grid: Object.freeze({ cols: 3, rows: 3, hSpacing: 10, vSpacing: 10, gridType: 'grid', flipRowH: false, flipRowV: false, flipColH: false, flipColV: false }),
  mirror: Object.freeze({}),
});

export const MAX_INSTANCES = 1000;
export const MAX_GRID = 200;

export const isRepeat = (n) => n?.type === 'group' && n.live?.kind === 'repeat';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Reflection across the line through (x1, y1) and (x2, y2). */
export function reflectMatrix(x1, y1, x2, y2) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const a = ux * ux - uy * uy;
  const b = 2 * ux * uy;
  const L = [a, b, b, -a, 0, 0];
  const p = apply(L, x1, y1);
  return [a, b, b, -a, x1 - p.x, y1 - p.y];
}

// ---- radial ----

/** Angle step between radial instances in degrees (clockwise on screen unless ccw). */
export function radialStep(live) {
  const n = clamp(Math.round(live.count || 1), 1, MAX_INSTANCES);
  const span = clamp(live.span ?? 360, 0, 360);
  const step = span >= 360 ? 360 / n : n > 1 ? span / (n - 1) : 0;
  return live.ccw ? -step : step;
}

/** Radius and start angle (degrees, screen clockwise from +x) of a radial repeat: where the source sits. */
export function radialGeometry(doc, node) {
  const b = childrenBounds(doc, node);
  const L = node.live;
  if (!b) return { radius: 0, angle: -90, c: { x: L.cx, y: L.cy }, src: { x: L.cx, y: L.cy } };
  const s = center(b);
  const radius = Math.hypot(s.x - L.cx, s.y - L.cy);
  const angle = radius > 1e-9 ? (Math.atan2(s.y - L.cy, s.x - L.cx) * 180) / Math.PI : -90;
  return { radius, angle, c: { x: L.cx, y: L.cy }, src: s, bounds: b };
}

function radialMatrices(live) {
  const n = clamp(Math.round(live.count || 1), 1, MAX_INSTANCES);
  const step = radialStep(live);
  const out = [];
  for (let i = 0; i < n; i++) out.push(i ? rotate(i * step, live.cx, live.cy) : null);
  return out;
}

// ---- grid ----

/** The grid's frame matrix (axes u, v through the origin). */
export function gridFrame(live) {
  const f = live.frame || [1, 0, 0, 1];
  return [f[0], f[1], f[2], f[3], 0, 0];
}

/**
 * Grid layout in frame coordinates: { tile, cols, rows, cellW, cellH, box, F, Fi }.
 * `tile` is the source's box measured along the frame axes.
 */
export function gridLayout(doc, node) {
  const L = { ...REPEAT_DEFAULTS.grid, ...node.live };
  const F = gridFrame(L);
  const Fi = invert(F);
  const tile = childrenBoundsIn(doc, node, Fi);
  if (!tile) return null;
  const cols = clamp(Math.round(L.cols), 1, MAX_GRID);
  const rows = clamp(Math.round(L.rows), 1, MAX_GRID);
  const cellW = Math.max(1e-6, tile.w + L.hSpacing);
  const cellH = Math.max(1e-6, tile.h + L.vSpacing);
  const brickX = L.gridType === 'brickRow' && rows > 1 ? cellW / 2 : 0;
  const brickY = L.gridType === 'brickCol' && cols > 1 ? cellH / 2 : 0;
  const box = { x: tile.x, y: tile.y, w: (cols - 1) * cellW + tile.w + brickX, h: (rows - 1) * cellH + tile.h + brickY };
  return { L, tile, cols, rows, cellW, cellH, box, F, Fi };
}

function gridMatrices(doc, node) {
  const g = gridLayout(doc, node);
  if (!g) return [null];
  const { L, tile, cols, rows, cellW, cellH, F, Fi } = g;
  const cx = tile.x + tile.w / 2;
  const cy = tile.y + tile.h / 2;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dx = c * cellW + (L.gridType === 'brickRow' && r % 2 ? cellW / 2 : 0);
      const dy = r * cellH + (L.gridType === 'brickCol' && c % 2 ? cellH / 2 : 0);
      const fh = (L.flipRowH && r % 2 === 1) !== (L.flipColH && c % 2 === 1);
      const fv = (L.flipRowV && r % 2 === 1) !== (L.flipColV && c % 2 === 1);
      if (!dx && !dy && !fh && !fv) {
        out.push(null);
        continue;
      }
      let m = translate(dx, dy);
      if (fh || fv) m = multiply(m, scale(fh ? -1 : 1, fv ? -1 : 1, cx, cy));
      out.push(multiply(F, multiply(m, Fi)));
    }
  }
  return out;
}

// ---- mirror ----

function mirrorMatrices(live) {
  return [null, reflectMatrix(live.x1, live.y1, live.x2, live.y2)];
}

/** Instance matrices of a repeat in paint order; null is the source drawn as itself. */
export function repeatMatrices(doc, node) {
  const L = node.live;
  if (L.mode === 'radial') {
    const ms = radialMatrices(L);
    return L.reverse ? ms.reverse() : ms;
  }
  if (L.mode === 'grid') return gridMatrices(doc, node);
  if (L.mode === 'mirror') return mirrorMatrices(L);
  return [null];
}

const LABELS = { radial: '<Radial Repeat>', grid: '<Grid Repeat>', mirror: '<Mirror Repeat>' };

registerLive('repeat', {
  label: (n) => LABELS[n.live?.mode] || '<Repeat>',
  generate(doc, node) {
    const items = [];
    const extra = new Map();
    const kids = node.children.map((c) => doc.get(c)).filter((n) => n && !n.hidden);
    for (const m of repeatMatrices(doc, node)) {
      for (const k of kids) {
        if (!m) {
          items.push(k.id);
          continue;
        }
        const v = transformedCopy(doc, k, m, extra, { base: 'rep' });
        v.parent = node.id;
        extra.set(v.id, v);
        items.push(v.id);
      }
    }
    return { items, extra };
  },
  transformParams(node, m) {
    const L = node.live;
    const det = m[0] * m[3] - m[1] * m[2];
    if (L.mode === 'radial') {
      const c = apply(m, L.cx, L.cy);
      return { live: { ...L, cx: c.x, cy: c.y, ccw: det < 0 ? !L.ccw : Boolean(L.ccw) } };
    }
    if (L.mode === 'mirror') {
      const a = apply(m, L.x1, L.y1);
      const b = apply(m, L.x2, L.y2);
      return { live: { ...L, x1: a.x, y1: a.y, x2: b.x, y2: b.y } };
    }
    if (L.mode === 'grid') {
      const f = L.frame || [1, 0, 0, 1];
      const u = applyVector(m, f[0], f[1]);
      const v = applyVector(m, f[2], f[3]);
      const lu = Math.hypot(u.x, u.y) || 1;
      const lv = Math.hypot(v.x, v.y) || 1;
      const frame = [u.x / lu, u.y / lu, v.x / lv, v.y / lv];
      const round = (x) => (Math.abs(x) < 1e-12 ? 0 : Math.abs(Math.abs(x) - 1) < 1e-12 ? Math.sign(x) : x);
      return { live: { ...L, frame: frame.map(round), hSpacing: (L.hSpacing ?? 0) * lu, vSpacing: (L.vSpacing ?? 0) * lv } };
    }
    return null;
  },
});

// ---- making, changing and releasing ----

/** Parameters for a new repeat of `mode` around source bounds b (merged with options). */
export function initialParams(mode, b, opts = {}) {
  const o = { ...REPEAT_DEFAULTS[mode], ...opts };
  if (mode === 'radial') {
    const n = clamp(Math.round(o.count), 1, MAX_INSTANCES);
    const fit = n > 1 ? b.w / (2 * Math.sin(Math.PI / Math.max(2, n))) : b.h;
    const radius = o.radius > 0 ? o.radius : Math.max(fit, b.h * 0.75, 1);
    const c = center(b);
    return { mode, count: n, span: clamp(o.span ?? 360, 1, 360), reverse: Boolean(o.reverse), cx: c.x, cy: c.y + radius };
  }
  if (mode === 'grid') {
    return {
      mode,
      cols: clamp(Math.round(o.cols), 1, MAX_GRID),
      rows: clamp(Math.round(o.rows), 1, MAX_GRID),
      hSpacing: o.hSpacing,
      vSpacing: o.vSpacing,
      gridType: o.gridType,
      flipRowH: Boolean(o.flipRowH),
      flipRowV: Boolean(o.flipRowV),
      flipColH: Boolean(o.flipColH),
      flipColV: Boolean(o.flipColV),
      frame: [1, 0, 0, 1],
    };
  }
  // Mirror: a vertical axis along the source's right edge, a little longer than the source.
  const x = b.x + b.w;
  const pad = Math.max(b.h * 0.25, 12);
  return { mode, x1: x, y1: b.y - pad, x2: x, y2: b.y + b.h + pad };
}

/** Wrap objects in a new repeat (inside a transaction). Returns the repeat group id. */
export function makeRepeat(doc, ids, mode, opts = {}) {
  const sorted = doc.sortByPaintOrder(ids).filter((id) => doc.has(id));
  if (!sorted.length) return null;
  let b = null;
  for (const id of sorted) {
    const nb = childrenBounds(doc, { children: [id] });
    if (nb) b = b ? { x: Math.min(b.x, nb.x), y: Math.min(b.y, nb.y), w: Math.max(b.x + b.w, nb.x + nb.w) - Math.min(b.x, nb.x), h: Math.max(b.y + b.h, nb.y + nb.h) - Math.min(b.y, nb.y) } : nb;
  }
  if (!b) return null;
  const top = doc.get(sorted[sorted.length - 1]);
  const parent = doc.get(top.parent);
  const index = parent.children.indexOf(top.id) + 1;
  const g = createGroup([], { live: { kind: 'repeat', ...initialParams(mode, b, opts) } });
  doc.insert(g, parent.id, index);
  for (const id of sorted) doc.move(id, g.id);
  return g.id;
}

/**
 * Switch a repeat to another mode (inside a transaction), keeping the
 * source where it is. Settings the new mode shares with `opts` apply.
 */
export function setRepeatMode(doc, id, mode, opts = {}) {
  const g = doc.get(id);
  if (!isRepeat(g) || g.live.mode === mode) return;
  const b = childrenBounds(doc, g);
  if (!b) return;
  doc.update(id, { live: { kind: 'repeat', ...initialParams(mode, b, opts) } });
}

/** Change repeat parameters (inside a transaction). Radius and start angle move the source. */
export function setRepeatParams(doc, id, patch) {
  const g = doc.get(id);
  if (!isRepeat(g)) return;
  const { radius, angle, ...rest } = patch;
  if (g.live.mode === 'radial' && (radius !== undefined || angle !== undefined)) moveRadialSource(doc, id, radius, angle);
  if (Object.keys(rest).length) doc.update(id, { live: { ...doc.get(id).live, ...rest } });
}

/**
 * Put a radial repeat's source at `radius` from the center and turn it to
 * `angle` (degrees), moving and rotating the source objects.
 */
export function moveRadialSource(doc, id, radius, angle) {
  const g = doc.get(id);
  const geo = radialGeometry(doc, g);
  const L = g.live;
  let m = [1, 0, 0, 1, 0, 0];
  if (angle !== undefined && Number.isFinite(angle)) m = rotate(angle - geo.angle, L.cx, L.cy);
  if (radius !== undefined && Number.isFinite(radius)) {
    const a = (((angle ?? geo.angle) * Math.PI) / 180);
    const r = Math.max(0, radius);
    m = multiply(translate(Math.cos(a) * (r - geo.radius), Math.sin(a) * (r - geo.radius)), m);
  }
  transformChildren(doc, g, m);
}

/** Apply a matrix to a live group's children (not to the group's own parameters). */
export function transformChildren(doc, g, m) {
  const patches = new Map();
  for (const c of g.children) {
    const n = doc.get(c);
    if (n) transformPatches(doc, n, m, {}, patches);
  }
  for (const [nid, patch] of patches) doc.update(nid, patch);
}

/** Release repeats: the source objects go back to the parent (inside a transaction). */
export function releaseRepeat(doc, id) {
  const g = doc.get(id);
  if (!isRepeat(g)) return [];
  const parent = doc.get(g.parent);
  let index = parent.children.indexOf(id);
  const kids = g.children.slice();
  for (const c of kids) doc.move(c, parent.id, index++);
  doc.remove(id);
  return kids;
}
