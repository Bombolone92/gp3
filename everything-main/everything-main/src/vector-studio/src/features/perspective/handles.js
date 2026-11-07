/**
 * On-canvas controls of the perspective grid: where they are and how
 * dragging one changes the grid. Pure functions of the grid model so the
 * Perspective Grid tool, keyboard access and tests share them.
 *
 * Controls:
 *   vl, vr, vx, v3      vanishing points (left, right, one-point, third)
 *   station             the station point foot on the horizon (two point)
 *   horizon-l/-r        horizon line ends: drag to change the horizon height
 *   origin              ground point: drag to move the whole grid
 *   extent-left/-right  ends of the ground lines: how far the planes reach
 *   extent-height       top of the corner line: how tall the planes are
 *   cell                first grid line on the corner: the grid cell size
 *   plane-left/-right/-floor   plane positions
 */
import { planeDocPoint, toFlat, PLANES } from './grid-math.js';
import { cameraOf, frameFor } from './model.js';

export const HANDLE_LABELS = {
  vl: 'Left vanishing point',
  vr: 'Right vanishing point',
  vx: 'Vanishing point',
  v3: 'Third vanishing point',
  station: 'Station point',
  'horizon-l': 'Horizon line',
  'horizon-r': 'Horizon line',
  origin: 'Ground point (move the grid)',
  'extent-left': 'Left grid extent',
  'extent-right': 'Right grid extent',
  'extent-height': 'Grid height',
  cell: 'Grid cell size',
  'plane-left': 'Left plane position',
  'plane-right': 'Right plane position',
  'plane-floor': 'Horizontal plane height',
};

/** Control positions in document coordinates: [{ id, x, y, kind }]. */
export function gridHandles(g, { reach = 40 } = {}) {
  const { cam } = cameraOf(g);
  const out = [];
  const at = (id, p, kind) => {
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out.push({ id, x: p.x, y: p.y, kind });
  };
  const H = g.horizon;
  if (g.type === 'one') {
    at('vx', { x: g.vx, y: H }, 'vp');
    at('horizon-l', { x: Math.min(g.vx, g.ox - g.extent.left) - reach, y: H }, 'horizon');
    at('horizon-r', { x: Math.max(g.vx, g.ox) + reach, y: H }, 'horizon');
  } else {
    at('vl', { x: g.vl, y: H }, 'vp');
    at('vr', { x: g.vr, y: H }, 'vp');
    at('horizon-l', { x: g.vl - reach, y: H }, 'horizon');
    at('horizon-r', { x: g.vr + reach, y: H }, 'horizon');
    if (g.type === 'two') at('station', { x: cam.px, y: H }, 'station');
    if (g.type === 'three' && g.v3) at('v3', g.v3, 'vp');
  }
  const pl = g.planes;
  at('origin', planeDocPoint(cam, 'right', 0, 0, 0), 'origin');
  at('extent-left', planeDocPoint(cam, 'left', 0, g.extent.left, 0), 'extent');
  at('extent-right', planeDocPoint(cam, 'right', 0, g.extent.right, 0), 'extent');
  at('extent-height', planeDocPoint(cam, 'right', 0, 0, g.extent.height), 'extent');
  at('cell', planeDocPoint(cam, 'right', 0, 0, g.cell), 'cell');
  at('plane-left', planeDocPoint(cam, 'left', pl.left, g.extent.left / 2, 0), 'plane');
  at('plane-right', planeDocPoint(cam, 'right', pl.right, g.extent.right / 2, 0), 'plane');
  at('plane-floor', planeDocPoint(cam, 'floor', pl.floor, g.extent.right / 2, g.extent.left / 2), 'plane');
  return out;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** World coordinates (along A, B, U from the ground point) of a document point on a plane, or null. */
export function worldOn(g, plane, offset, p) {
  const f = frameFor(g, plane, offset);
  const q = toFlat(f, p.x, p.y);
  if (!q) return null;
  const Q = [0, 1, 2].map((i) => f.P0[i] + (q.x - f.ox) * f.E1[i] + (q.y - f.oy) * f.E2[i]);
  const { A, B, U, O } = f.cam;
  const r = [Q[0] - O[0], Q[1] - O[1], Q[2] - O[2]];
  return { a: dot(r, A), b: dot(r, B), u: dot(r, U) };
}

const snapTo = (v, step, on) => (on && step > 0 ? Math.round(v / step) * step : v);

/** Is a three-point grid valid (its vanishing points come from a real camera)? */
function validThree(g) {
  const { vl, vr, horizon: H, v3 } = g;
  if (!v3 || !(v3.x > vl + 1 && v3.x < vr - 1) || Math.abs(v3.y - H) < 4) return false;
  const y = H - ((v3.x - vl) * (v3.x - vr)) / (v3.y - H);
  return (v3.x - vl) * (vr - v3.x) - (H - y) * (H - y) > 1;
}

/**
 * The grid after dragging control `id` from its position at the start of
 * the drag to document point p. `start` is the grid when the drag began;
 * `opts`: { lockStation, snap, shift, delta: {dx, dy} from the press }.
 * Returns the new grid, or `start` when the drag would make it invalid.
 */
export function dragHandle(start, id, p, opts = {}) {
  const g = { ...start, extent: { ...start.extent }, planes: { ...start.planes }, v3: start.v3 ? { ...start.v3 } : start.v3 };
  const { dx = 0, dy = 0 } = opts.delta || {};
  const cell = g.cell;
  const min = Math.max(1, cell / 4);
  const moveAll = (mx, my) => {
    g.ox += mx;
    g.oy += my;
    g.horizon += my;
    for (const k of ['vl', 'vr', 'vx', 'px']) if (Number.isFinite(g[k])) g[k] += mx;
    if (g.v3) g.v3 = { x: g.v3.x + mx, y: g.v3.y + my };
  };
  switch (id) {
    case 'vl':
    case 'vr': {
      const sx = start[id] + dx;
      if (opts.lockStation) {
        // The viewer moves: both vanishing points and the station point travel together.
        for (const k of ['vl', 'vr', 'px']) g[k] = start[k] + dx;
        if (g.v3) g.v3.x = start.v3.x + dx;
      } else {
        const px = Number.isFinite(start.px) ? start.px : (start.vl + start.vr) / 2;
        if (id === 'vl') g.vl = Math.min(sx, px - 2);
        else g.vr = Math.max(sx, px + 2);
        if (g.type === 'three') g.px = Math.max(g.vl + 1, Math.min(g.vr - 1, px));
      }
      break;
    }
    case 'vx':
      g.vx = start.vx + dx;
      break;
    case 'station':
      g.px = Math.max(start.vl + 2, Math.min(start.vr - 2, start.px + dx));
      break;
    case 'v3':
      g.v3 = { x: start.v3.x + dx, y: start.v3.y + dy };
      break;
    case 'horizon-l':
    case 'horizon-r':
      g.horizon = start.horizon + dy;
      break;
    case 'origin': {
      let mx = dx;
      let my = dy;
      if (opts.shift) {
        if (Math.abs(mx) > Math.abs(my)) my = 0;
        else mx = 0;
      }
      moveAll(mx, my);
      break;
    }
    case 'extent-left':
    case 'extent-right': {
      const w = worldOn(start, 'floor', 0, p);
      if (!w) return start;
      const v = id === 'extent-left' ? w.b : w.a;
      g.extent[id === 'extent-left' ? 'left' : 'right'] = Math.max(cell, snapTo(v, cell, opts.snap));
      break;
    }
    case 'extent-height': {
      const w = worldOn(start, 'right', 0, p);
      if (!w) return start;
      g.extent.height = Math.max(cell, snapTo(w.u, cell, opts.snap));
      break;
    }
    case 'cell': {
      const w = worldOn(start, 'right', 0, p);
      if (!w) return start;
      g.cell = Math.max(2, Math.min(start.extent.height, w.u));
      break;
    }
    case 'plane-left':
    case 'plane-right': {
      const w = worldOn(start, 'floor', 0, p);
      if (!w) return start;
      const plane = id === 'plane-left' ? 'left' : 'right';
      // The left plane slides along the right axis (A) and the right plane along the left axis (B).
      g.planes[plane] = snapTo(plane === 'left' ? w.a : w.b, cell, opts.snap);
      break;
    }
    case 'plane-floor': {
      const w = worldOn(start, 'right', start.extent.left / 2, p);
      if (!w) return start;
      g.planes.floor = snapTo(w.u, cell, opts.snap);
      break;
    }
    default:
      return start;
  }
  if (g.type === 'three' && !validThree(g)) return start;
  if (g.type !== 'one' && !(g.vr - g.vl > 4)) return start;
  if (!(g.extent.left >= min && g.extent.right >= min && g.extent.height >= min)) return start;
  return g;
}

/** Which plane a plane control moves. */
export function planeOfHandle(id) {
  const m = /^plane-(left|right|floor)$/.exec(id);
  return m && PLANES.includes(m[1]) ? m[1] : null;
}
