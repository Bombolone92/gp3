/**
 * Perspective grid geometry.
 *
 * The grid is a pinhole camera looking at a box corner standing on the
 * ground. Camera space has x to the right, y down (like the document) and
 * z into the picture; the picture plane (the artboard) is z = d, so a
 * camera-space point Q lands on the document at
 *   (px + d * Qx / Qz, py + d * Qy / Qz)
 * where (px, py) is the principal point (the foot of the station point).
 *
 * Every grid has three world axes in camera space:
 *   A  the horizontal direction the right plane recedes along (to the right VP)
 *   B  the horizontal direction the left plane recedes along (to the left VP)
 *   U  up
 * and three planes through the corner O (the ground point of the grid):
 *   right  spanned by A and U, positioned along B
 *   left   spanned by B and U, positioned along A
 *   floor  spanned by A and B, positioned along U (its height)
 * One-point grids use A = depth (the single VP) and B = -x, so the left
 * plane faces the viewer and the right plane is a side wall; three-point
 * grids derive A, B and U from three mutually orthogonal vanishing points.
 *
 * Objects on a plane keep flat coordinates: document-like (x right, y down,
 * points) with the grid's ground point at (ox, oy). A plane at a given
 * offset maps flat coordinates to the document through a homography
 * (planeFrame), which projects paths exactly for straight segments and to
 * within a fraction of a point for curves (projectAnchors subdivides them
 * and matches end tangents).
 *
 * The grid model stored in the document root as `perspective`:
 *   type        'one' | 'two' | 'three'
 *   ox, oy      ground point (the corner of the planes) in document points
 *   horizon     horizon line y
 *   vx          one-point vanishing point x (on the horizon)
 *   vl, vr      left and right vanishing point x (two and three point)
 *   px          station point foot x, between vl and vr (two point)
 *   dist        viewing distance (one point)
 *   v3          { x, y } third vanishing point (three point)
 *   cell        grid cell size in points (world units at the picture plane)
 *   extent      { left, right, height } plane extents in points
 *   planes      { left, right, floor } plane positions in points
 *   colors      { left, right, floor }, opacity (0..1)
 *   units, scale, every   how the Define Grid dialog shows the cell size
 */

export const PLANES = ['left', 'right', 'floor'];
export const GRID_TYPES = ['one', 'two', 'three'];
export const PLANE_LABELS = { left: 'Left Plane', right: 'Right Plane', floor: 'Horizontal Plane', none: 'No Active Plane' };
export const TYPE_LABELS = { one: 'One Point Perspective', two: 'Two Point Perspective', three: 'Three Point Perspective' };
export const DEFAULT_COLORS = Object.freeze({ left: '#4a78f0', right: '#f08a3c', floor: '#3aa66a' });

const EPS = 1e-9;
/** Points farther than this many viewing distances behind the picture count as beyond the horizon. */
const MAX_DEPTH = 60;

// ---- small vector helpers (camera space) ----

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const neg = (a) => [-a[0], -a[1], -a[2]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ---- grid model ----

/**
 * A grid from Define Grid settings placed on an artboard: viewing angle
 * (degrees the right plane turns away from the picture plane), viewing
 * distance, horizon height above the ground, cell size, and for three
 * points the third vanishing point as an offset from the ground point.
 */
export function gridFromSettings(s, board = { x: 0, y: 0, w: 612, h: 792 }, base = null) {
  const type = GRID_TYPES.includes(s.type) ? s.type : 'two';
  const cell = clampNum(s.cell, 1, 10000, 30);
  const distance = clampNum(s.distance, 10, 1e6, 480);
  const horizonHeight = clampNum(s.horizonHeight, -1e5, 1e5, 250);
  const angle = clampNum(s.angle, 1, 89, 45);
  const ox = base?.ox ?? board.x + board.w / 2;
  const oy = base?.oy ?? board.y + board.h * 0.7;
  const horizon = oy - horizonHeight;
  const a = (angle * Math.PI) / 180;
  const g = {
    type,
    ox,
    oy,
    horizon,
    cell,
    extent: { ...(base?.extent || { left: cell * 16, right: cell * 16, height: cell * 12 }) },
    planes: { left: 0, right: 0, floor: 0, ...(base?.planes || {}) },
    colors: { ...DEFAULT_COLORS, ...(s.colors || base?.colors || {}) },
    opacity: clampNum(s.opacity, 0, 1, base?.opacity ?? 0.5),
    units: s.units || base?.units || 'pt',
    scale: clampNum(s.scale, 1e-6, 1e6, base?.scale ?? 1),
    every: s.every ?? base?.every ?? cell,
    name: s.name || '',
  };
  if (type === 'one') {
    // The corner sits right of the vanishing point so the side wall recedes toward it.
    g.ox = base?.ox ?? board.x + board.w * 0.72;
    g.vx = base?.type === 'one' && Number.isFinite(base.vx) ? base.vx : board.x + board.w / 2;
    g.dist = distance;
  } else {
    g.px = base && base.type !== 'one' && Number.isFinite(base.px) ? base.px : ox;
    g.vl = g.px - distance * Math.tan(a);
    g.vr = g.px + distance / Math.tan(a);
    if (type === 'three') {
      const v = s.third || { x: 0, y: distance * 2.5 };
      g.v3 = { x: ox + (v.x || 0), y: oy + (v.y ?? distance * 2.5) };
      g.v3.x = clampNum(g.v3.x, g.vl + 1, g.vr - 1, ox);
    }
  }
  return g;
}

/** The settings a grid was made from (for the Define Grid dialog). */
export function settingsOf(g) {
  const out = {
    type: g.type,
    cell: g.cell,
    horizonHeight: g.oy - g.horizon,
    units: g.units || 'pt',
    scale: g.scale || 1,
    every: g.every ?? g.cell,
    colors: { ...DEFAULT_COLORS, ...(g.colors || {}) },
    opacity: g.opacity ?? 0.5,
    name: g.name || '',
  };
  if (g.type === 'one') {
    out.distance = g.dist;
    out.angle = 45;
  } else {
    const cam = camera(g);
    const px = g.type === 'two' ? cam.px : clampNum(g.px ?? cam.px, g.vl + 1, g.vr - 1, (g.vl + g.vr) / 2);
    const d = Math.sqrt(Math.max(1, (px - g.vl) * (g.vr - px)));
    out.distance = d;
    out.angle = (Math.atan2(px - g.vl, d) * 180) / Math.PI;
    if (g.type === 'three' && g.v3) out.third = { x: g.v3.x - g.ox, y: g.v3.y - g.oy };
  }
  return out;
}

/** The default grid of a type for an artboard. */
export function defaultGrid(type = 'two', board) {
  return gridFromSettings({ type }, board);
}

/** A grid with every field present and sane (files, presets and pasted values). */
export function normalizeGrid(g, board) {
  if (!g || typeof g !== 'object' || !GRID_TYPES.includes(g.type)) return defaultGrid('two', board);
  const def = defaultGrid(g.type, board);
  const out = { ...def, ...g };
  out.extent = { ...def.extent, ...(g.extent || {}) };
  out.planes = { ...def.planes, ...(g.planes || {}) };
  out.colors = { ...def.colors, ...(g.colors || {}) };
  for (const k of ['ox', 'oy', 'horizon', 'cell']) if (!Number.isFinite(out[k])) out[k] = def[k];
  if (out.type === 'one') {
    if (!Number.isFinite(out.vx)) out.vx = def.vx;
    if (!(out.dist > 0)) out.dist = def.dist;
  } else {
    if (!Number.isFinite(out.vl) || !Number.isFinite(out.vr) || out.vr - out.vl < 2) Object.assign(out, { vl: def.vl, vr: def.vr });
    if (!Number.isFinite(out.px)) out.px = (out.vl + out.vr) / 2;
    if (out.type === 'three' && !(out.v3 && Number.isFinite(out.v3.x) && Number.isFinite(out.v3.y))) out.v3 = { ...def.v3 };
  }
  return out;
}

function clampNum(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

// ---- camera ----

/**
 * The camera of a grid: { px, py, d, A, B, U, O } with unit axes and the
 * ground point O in camera space. Three-point grids whose vanishing points
 * cannot come from a real camera (an obtuse triangle) fall back to two points.
 */
export function camera(g) {
  const H = g.horizon;
  if (g.type === 'one') {
    const d = Math.max(1, g.dist || 480);
    const px = g.vx;
    return { px, py: H, d, A: [0, 0, 1], B: [-1, 0, 0], U: [0, -1, 0], O: [g.ox - px, g.oy - H, d] };
  }
  const vl = Math.min(g.vl, g.vr - 2);
  const vr = Math.max(g.vr, vl + 2);
  if (g.type === 'three' && g.v3 && Math.abs(g.v3.y - H) > 1) {
    const v3 = g.v3;
    // Principal point: the orthocenter of the vanishing point triangle.
    const x = v3.x;
    const y = H - ((x - vl) * (x - vr)) / (v3.y - H);
    const d2 = (x - vl) * (vr - x) - (H - y) * (H - y);
    if (x > vl && x < vr && d2 > 1) {
      const d = Math.sqrt(d2);
      const A = norm([vr - x, H - y, d]);
      const B = norm([vl - x, H - y, d]);
      let U = norm([v3.x - x, v3.y - y, d]);
      if (U[1] > 0) U = neg(U);
      return { px: x, py: y, d, A, B, U, O: [g.ox - x, g.oy - y, d] };
    }
  }
  const px = Math.max(vl + 1, Math.min(vr - 1, Number.isFinite(g.px) ? g.px : (vl + vr) / 2));
  const d = Math.sqrt((px - vl) * (vr - px));
  return { px, py: H, d, A: norm([vr - px, 0, d]), B: norm([vl - px, 0, d]), U: [0, -1, 0], O: [g.ox - px, g.oy - H, d] };
}

/** Project a camera-space point to the document, or null behind the viewer. */
export function projectPoint(cam, q) {
  if (q[2] <= EPS) return null;
  return { x: cam.px + (cam.d * q[0]) / q[2], y: cam.py + (cam.d * q[1]) / q[2] };
}

/** Camera-space point of a plane at `offset` from world parameters u, v (see the module comment). */
export function planePoint(cam, plane, offset, u, v) {
  const { A, B, U, O } = cam;
  if (plane === 'right') return add(add(add(O, mul(B, offset)), mul(A, u)), mul(U, v));
  if (plane === 'left') return add(add(add(O, mul(A, offset)), mul(B, u)), mul(U, v));
  return add(add(add(O, mul(U, offset)), mul(A, u)), mul(B, v));
}

/** Document position of a plane point given by world parameters (null behind the viewer). */
export function planeDocPoint(cam, plane, offset, u, v) {
  return projectPoint(cam, planePoint(cam, plane, offset, u, v));
}

// ---- plane homographies ----

/**
 * The flat-to-document mapping of a plane at `offset`:
 * { plane, offset, H, Hinv, cam, ox, oy }. H is a 3x3 matrix (row-major
 * array of 9) taking flat (x, y, 1) to homogeneous document coordinates.
 * Flat point `ref` (default: the grid's ground point) sits on the corner;
 * objects keep the reference they were made with, so they stay put on the
 * grid when the grid moves.
 */
export function planeFrame(g, plane, offset = 0, cam = camera(g), ref = null) {
  const ox = ref ? ref.ox : g.ox;
  const oy = ref ? ref.oy : g.oy;
  const { A, B, U, O } = cam;
  let P0;
  let E1;
  let E2;
  if (plane === 'right') {
    P0 = add(O, mul(B, offset));
    E1 = A;
    E2 = neg(U);
  } else if (plane === 'left') {
    P0 = add(O, mul(A, offset));
    E1 = neg(B);
    E2 = neg(U);
  } else {
    P0 = add(O, mul(U, offset));
    if (g.type === 'one') {
      E1 = neg(B);
      E2 = neg(A);
    } else {
      E1 = A;
      E2 = neg(B);
    }
  }
  let H = homography(cam, P0, E1, E2, ox, oy);
  // Keep flat artwork unmirrored: the flat x axis must run the way the plane faces.
  const J = jacobian(H, ox, oy);
  if (J && J[0] * J[3] - J[1] * J[2] < 0) {
    E1 = neg(E1);
    H = homography(cam, P0, E1, E2, ox, oy);
  }
  return { plane, offset, H, Hinv: invert3(H), cam, ox, oy, P0, E1, E2 };
}

function homography(cam, P0, E1, E2, ox, oy) {
  const { d, px, py } = cam;
  const C = add(P0, add(mul(E1, -ox), mul(E2, -oy)));
  return [d * E1[0] + px * E1[2], d * E2[0] + px * E2[2], d * C[0] + px * C[2], d * E1[1] + py * E1[2], d * E2[1] + py * E2[2], d * C[1] + py * C[2], E1[2], E2[2], C[2]];
}

export function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const r = 1 / det;
  return [A * r, -(b * i - c * h) * r, (b * f - c * e) * r, B * r, (a * i - c * g) * r, -(a * f - c * d) * r, C * r, -(a * h - b * g) * r, (a * e - b * d) * r];
}

/** Depth factor of a flat point: positive in front of the viewer (1 on the picture plane). */
export function depthOf(frame, x, y) {
  const H = frame.H;
  return (H[6] * x + H[7] * y + H[8]) / frame.cam.d;
}

/** Flat point to document point. Points behind the viewer are pushed just in front of it. */
export function toDoc(frame, x, y) {
  const H = frame.H;
  let w = H[6] * x + H[7] * y + H[8];
  if (w < frame.cam.d / MAX_DEPTH / 4) w = frame.cam.d / MAX_DEPTH / 4;
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

/**
 * Document point to flat point on the plane, or null when the point lies
 * on or beyond the plane's horizon (it would be infinitely far away).
 */
export function toFlat(frame, X, Y) {
  const M = frame.Hinv;
  const w = M[6] * X + M[7] * Y + M[8];
  if (Math.abs(w) < EPS) return null;
  const x = (M[0] * X + M[1] * Y + M[2]) / w;
  const y = (M[3] * X + M[4] * Y + M[5]) / w;
  const depth = depthOf(frame, x, y);
  if (!(depth > 1 / MAX_DEPTH)) return null;
  return { x, y };
}

/** Jacobian of a homography at (x, y) as an affine linear part [a, b, c, d] (matrix.js layout). */
export function jacobian(H, x, y) {
  const X = H[0] * x + H[1] * y + H[2];
  const Y = H[3] * x + H[4] * y + H[5];
  const W = H[6] * x + H[7] * y + H[8];
  if (Math.abs(W) < EPS) return null;
  const w2 = W * W;
  return [(H[0] * W - X * H[6]) / w2, (H[3] * W - Y * H[6]) / w2, (H[1] * W - X * H[7]) / w2, (H[4] * W - Y * H[7]) / w2];
}

/** How large one flat point looks on the document at (x, y) (geometric mean of the axes). */
export function localScale(frame, x, y) {
  const J = jacobian(frame.H, x, y);
  return J ? Math.sqrt(Math.abs(J[0] * J[3] - J[1] * J[2])) : 1;
}

/** The affine matrix that best matches the projection near flat point (x, y). */
export function localAffine(frame, x, y) {
  const J = jacobian(frame.H, x, y) || [1, 0, 0, 1];
  const p = toDoc(frame, x, y);
  return [J[0], J[1], J[2], J[3], p.x - J[0] * x - J[2] * y, p.y - J[1] * x - J[3] * y];
}

// ---- projecting geometry ----

function sub(c, t0, t1) {
  // Control points of the cubic c restricted to [t0, t1].
  const at = (t) => {
    const mt = 1 - t;
    return [
      mt * mt * mt * c[0] + 3 * mt * mt * t * c[2] + 3 * mt * t * t * c[4] + t * t * t * c[6],
      mt * mt * mt * c[1] + 3 * mt * mt * t * c[3] + 3 * mt * t * t * c[5] + t * t * t * c[7],
    ];
  };
  const der = (t) => {
    const mt = 1 - t;
    return [
      3 * mt * mt * (c[2] - c[0]) + 6 * mt * t * (c[4] - c[2]) + 3 * t * t * (c[6] - c[4]),
      3 * mt * mt * (c[3] - c[1]) + 6 * mt * t * (c[5] - c[3]) + 3 * t * t * (c[7] - c[5]),
    ];
  };
  const p0 = at(t0);
  const p3 = at(t1);
  const s = (t1 - t0) / 3;
  const d0 = der(t0);
  const d1 = der(t1);
  return [p0[0], p0[1], p0[0] + d0[0] * s, p0[1] + d0[1] * s, p3[0] - d1[0] * s, p3[1] - d1[1] * s, p3[0], p3[1]];
}

const isStraight = (c) => Math.abs(c[2] - c[0]) < 1e-9 && Math.abs(c[3] - c[1]) < 1e-9 && Math.abs(c[4] - c[6]) < 1e-9 && Math.abs(c[5] - c[7]) < 1e-9;

/**
 * Project an anchor list through a plane. Straight segments stay straight
 * (exact); curved segments are split into pieces whose end points and end
 * tangents are exact, which keeps the error far below a point.
 */
export function projectAnchors(frame, anchors, closed) {
  const n = anchors.length;
  if (!n) return [];
  const H = frame.H;
  const mk = (p) => ({ x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y });
  const pts = anchors.map((a) => toDoc(frame, a.x, a.y));
  const out = [mk(pts[0])];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % n];
    const closing = closed && i === n - 1;
    const end = closing ? out[0] : mk(pts[i + 1]);
    const c = [a.x, a.y, a.ox, a.oy, b.ix, b.iy, b.x, b.y];
    if (!isStraight(c)) {
      // More pieces where depth changes a lot along the segment.
      const w0 = Math.abs(H[6] * a.x + H[7] * a.y + H[8]);
      const w1 = Math.abs(H[6] * b.x + H[7] * b.y + H[8]);
      const ratio = Math.max(w0, w1) / Math.max(EPS, Math.min(w0, w1));
      const pieces = Math.min(16, Math.max(2, Math.ceil(2 * ratio)));
      let cur = out[out.length - 1];
      for (let k = 0; k < pieces; k++) {
        const q = sub(c, k / pieces, (k + 1) / pieces);
        const p0 = toDoc(frame, q[0], q[1]);
        const p3 = toDoc(frame, q[6], q[7]);
        const J0 = jacobian(H, q[0], q[1]) || [1, 0, 0, 1];
        const J3 = jacobian(H, q[6], q[7]) || [1, 0, 0, 1];
        const d0x = q[2] - q[0];
        const d0y = q[3] - q[1];
        const d3x = q[6] - q[4];
        const d3y = q[7] - q[5];
        cur.ox = p0.x + J0[0] * d0x + J0[2] * d0y;
        cur.oy = p0.y + J0[1] * d0x + J0[3] * d0y;
        const next = k < pieces - 1 ? mk(p3) : end;
        next.ix = p3.x - (J3[0] * d3x + J3[2] * d3y);
        next.iy = p3.y - (J3[1] * d3x + J3[3] * d3y);
        if (k < pieces - 1) out.push(next);
        cur = next;
      }
    }
    if (!closing) out.push(end);
  }
  return out;
}
