/**
 * Envelopes: live groups whose contents are drawn distorted into a shape.
 *
 *   { type: 'group', live: { kind: 'envelope', mode, warp?, mesh?, top?,
 *                            frame?, options, editing? }, children }
 *
 * The contents keep their own, undistorted geometry in document space. Their
 * bounds (the source rectangle, measured in the envelope's frame) map onto
 * the envelope shape with a point function, and every outline is bent
 * through it (model/point-map.js), so the result stays smooth Bezier curves.
 *
 * mode 'warp'  warp: { style, bend, vertical, distortH, distortV } bends the
 *              source rectangle with one of the warp styles (model/warp.js),
 *              exactly like the Warp effect does over the same bounds.
 * mode 'mesh'  mesh: { rows, cols, points } is a grid of Coons patches with
 *              the gradient mesh's point layout (absolute positions and
 *              left/right/up/down handles); the source rectangle is divided
 *              into rows x cols equal cells, each mapped onto its patch.
 *              `top: true` marks an envelope made from a top object, whose
 *              outline (split into four sides) became the mesh.
 *
 * frame is the linear part [a, b, c, d, 0, 0] of the transforms applied to
 * the envelope since it was made: the contents are measured in that frame,
 * so rotating or skewing an envelope turns the source rectangle with it and
 * the result is exactly the transformed result. Mesh points are absolute
 * and transform directly.
 *
 * options: { fidelity 0-100, distortAppearance, distortGradients,
 * distortPatterns, antialias, preserve: 'clip' | 'transparency' }.
 * editing: 'contents' while the contents are edited in place.
 */
import { warpMapping, normalizeWarp, WARP_DEFAULTS } from '../../model/warp.js';
import { patchOf, evalPatch, meshBoundary, transformPoints, gridFromSides, naturalGrid, prepareOutline, chooseCorners, insertColumn, insertRow, removeColumn, removeRow } from '../mesh/mesh-model.js';
import { pathBounds, segmentPoints, nearestOnPath, insertAnchor, isLine, signedArea, reverseAnchors } from '../../model/bezier.js';
import { multiply, invert, apply } from '../../lib/matrix.js';
import { mapSubpaths } from '../../model/point-map.js';

export const KIND = 'envelope';

export const OPTION_DEFAULTS = Object.freeze({
  fidelity: 50,
  distortAppearance: true,
  distortGradients: false,
  distortPatterns: false,
  antialias: true,
  preserve: 'clip',
});

export const MESH_LIMIT = 50;

export const isEnvelope = (n) => Boolean(n && n.type === 'group' && n.live?.kind === KIND);

export const editingContents = (n) => isEnvelope(n) && n.live.editing === 'contents';

/** The envelope a node belongs to: itself or its closest envelope ancestor, or null. */
export function envelopeOf(doc, id) {
  let n = doc.get(id);
  while (n && n.type !== 'layer' && n.type !== 'root') {
    if (isEnvelope(n)) return n;
    n = n.parent ? doc.get(n.parent) : null;
  }
  return null;
}

/** Options with defaults and ranges applied. */
export function normalizeOptions(o = {}) {
  const fid = Number(o.fidelity);
  return {
    fidelity: Number.isFinite(fid) ? Math.max(0, Math.min(100, fid)) : OPTION_DEFAULTS.fidelity,
    distortAppearance: o.distortAppearance ?? OPTION_DEFAULTS.distortAppearance,
    distortGradients: Boolean(o.distortGradients),
    distortPatterns: Boolean(o.distortPatterns),
    antialias: o.antialias ?? OPTION_DEFAULTS.antialias,
    preserve: o.preserve === 'transparency' ? 'transparency' : 'clip',
  };
}

const clampCount = (v) => Math.max(1, Math.min(MESH_LIMIT, Math.round(Number(v) || 1)));

// ---- frame ----

const IDENTITY = [1, 0, 0, 1, 0, 0];

/** The envelope's frame (linear part only). */
export function frameOf(node) {
  const f = node.live?.frame;
  return Array.isArray(f) && f.length >= 4 ? [f[0], f[1], f[2], f[3], 0, 0] : IDENTITY;
}

export const isIdentityFrame = (f) => Math.abs(f[0] - 1) < 1e-12 && Math.abs(f[1]) < 1e-12 && Math.abs(f[2]) < 1e-12 && Math.abs(f[3] - 1) < 1e-12;

// ---- meshes ----

/** A mesh point without color: position and four retracted handles. */
export function bare(x, y) {
  return { x, y, lx: x, ly: y, rx: x, ry: y, ux: x, uy: y, dx: x, dy: y };
}

/**
 * Mesh points sampled from a surface S(u, v) over [0, 1]^2: positions at
 * the grid and handles a third of the way to the neighbors along the
 * surface's derivatives (central differences), so straight surfaces give
 * exact meshes and curved ones close Coons approximations.
 */
export function meshFromSurface(S, rows, cols) {
  rows = clampCount(rows);
  cols = clampCount(cols);
  const h = 1e-4;
  const d = (u, v, du, dv) => {
    const u0 = Math.max(0, u - du);
    const u1 = Math.min(1, u + du);
    const v0 = Math.max(0, v - dv);
    const v1 = Math.min(1, v + dv);
    const a = S(u1, v1);
    const b = S(u0, v0);
    const span = du ? u1 - u0 : v1 - v0;
    return { x: (a.x - b.x) / span, y: (a.y - b.y) / span };
  };
  const points = [];
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= cols; j++) {
      const u = j / cols;
      const v = i / rows;
      const p = S(u, v);
      const su = d(u, v, h, 0);
      const sv = d(u, v, 0, h);
      const hu = 1 / (3 * cols);
      const hv = 1 / (3 * rows);
      const pt = bare(p.x, p.y);
      if (j > 0) [pt.lx, pt.ly] = [p.x - su.x * hu, p.y - su.y * hu];
      if (j < cols) [pt.rx, pt.ry] = [p.x + su.x * hu, p.y + su.y * hu];
      if (i > 0) [pt.ux, pt.uy] = [p.x - sv.x * hv, p.y - sv.y * hv];
      if (i < rows) [pt.dx, pt.dy] = [p.x + sv.x * hv, p.y + sv.y * hv];
      points.push(pt);
    }
  }
  return { rows, cols, points };
}

/** Patches of a mesh (cached per mesh object). */
const patchCache = new WeakMap();
export function meshPatches(mesh) {
  let p = patchCache.get(mesh);
  if (!p) {
    p = [];
    for (let i = 0; i < mesh.rows; i++) for (let j = 0; j < mesh.cols; j++) p.push(patchOf(mesh, i, j));
    patchCache.set(mesh, p);
  }
  return p;
}

/**
 * Where the mesh lines sit in the source rectangle: { cols: [0, .., 1],
 * rows: [0, .., 1] }. Meshes divide it evenly unless lines were added
 * inside a patch (the Mesh tool), which keeps the mapping exactly as it
 * was: the new line sits where it split its patch.
 */
export function meshStops(mesh) {
  const even = (n) => Array.from({ length: n + 1 }, (_, i) => i / n);
  const ok = (a, n) => Array.isArray(a) && a.length === n + 1;
  return { cols: ok(mesh.colStops, mesh.cols) ? mesh.colStops : even(mesh.cols), rows: ok(mesh.rowStops, mesh.rows) ? mesh.rowStops : even(mesh.rows) };
}

/** Index of the span of `stops` holding t (clamped to the first and last spans). */
function span(stops, t) {
  let lo = 0;
  let hi = stops.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (stops[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The mesh surface at (u, v) in [0, 1]^2 (extrapolating past the edges). */
export function evalMesh(mesh, u, v, patches = meshPatches(mesh), stops = meshStops(mesh)) {
  const j = span(stops.cols, u);
  const i = span(stops.rows, v);
  const s = (u - stops.cols[j]) / (stops.cols[j + 1] - stops.cols[j] || 1);
  const t = (v - stops.rows[i]) / (stops.rows[i + 1] - stops.rows[i] || 1);
  return evalPatch(patches[i * mesh.cols + j], s, t);
}

/** A column line added in column j at parameter s (exact: the surface does not change). */
export function addColumn(mesh, j, s) {
  const st = meshStops(mesh);
  const m = insertColumn(withColor(mesh), j, s);
  const c = st.cols;
  return { rows: m.rows, cols: m.cols, points: bareAll(m.points), colStops: [...c.slice(0, j + 1), c[j] + s * (c[j + 1] - c[j]), ...c.slice(j + 1)], ...(mesh.rowStops ? { rowStops: st.rows } : {}) };
}

/** A row line added in row i at parameter t. */
export function addRow(mesh, i, t) {
  const st = meshStops(mesh);
  const m = insertRow(withColor(mesh), i, t);
  const r = st.rows;
  return { rows: m.rows, cols: m.cols, points: bareAll(m.points), rowStops: [...r.slice(0, i + 1), r[i] + t * (r[i + 1] - r[i]), ...r.slice(i + 1)], ...(mesh.colStops ? { colStops: st.cols } : {}) };
}

/** Interior column line j removed (the patches beside it merge). */
export function dropColumn(mesh, j) {
  if (j <= 0 || j >= mesh.cols) return mesh;
  const st = meshStops(mesh);
  const m = removeColumn(mesh, j);
  return { ...m, colStops: st.cols.filter((_, k) => k !== j), ...(mesh.rowStops ? { rowStops: st.rows } : {}) };
}

/** Interior row line i removed. */
export function dropRow(mesh, i) {
  if (i <= 0 || i >= mesh.rows) return mesh;
  const st = meshStops(mesh);
  const m = removeRow(mesh, i);
  return { ...m, rowStops: st.rows.filter((_, k) => k !== i), ...(mesh.colStops ? { colStops: st.cols } : {}) };
}

// Line insertion blends point colors; envelope meshes have none.
const withColor = (m) => ({ ...m, points: m.points.map((p) => ({ ...p, c: '#000000', a: 1 })) });
const bareAll = (points) => points.map(({ c, a, ...p }) => p);

/** A rows x cols mesh filling a parallelogram: rectangle r (frame space) through frame f. */
export function rectMesh(r, rows, cols, f = IDENTITY) {
  return meshFromSurface((u, v) => apply(f, r.x + u * r.w, r.y + v * r.h), rows, cols);
}

/** A mesh with the same surface as `mesh`, resampled to rows x cols. */
export function resampleMesh(mesh, rows, cols) {
  rows = clampCount(rows);
  cols = clampCount(cols);
  if (rows === mesh.rows && cols === mesh.cols && !mesh.colStops && !mesh.rowStops) return mesh;
  const patches = meshPatches(mesh);
  const stops = meshStops(mesh);
  return meshFromSurface((u, v) => evalMesh(mesh, u, v, patches, stops), rows, cols);
}

/** A mesh approximating a warp over source rectangle r (frame space), drawn through frame f. */
export function warpMesh(warp, r, rows, cols, f = IDENTITY) {
  const w = normalizeWarp(warp);
  const g = warpMapping(w.style, w, r);
  return meshFromSurface((u, v) => {
    const p = g(r.x + u * r.w, r.y + v * r.h);
    return apply(f, p.x, p.y);
  }, rows, cols);
}

/** Mesh patch counts that follow a warp's curvature closely enough when it becomes a mesh. */
export function warpGrid(warp) {
  const w = normalizeWarp(warp);
  if (!w.bend && !w.distortH && !w.distortV) return { rows: 1, cols: 1 };
  const along = w.style === 'wave' ? 8 : w.style === 'flag' || w.style === 'twist' || w.style === 'fisheye' ? 6 : 4;
  const across = ['fisheye', 'twist', 'inflate', 'squeeze', 'bulge'].includes(w.style) ? along : 2;
  return w.vertical ? { rows: along, cols: across } : { rows: across, cols: along };
}

// ---- top object ----

/** Tag-preserving split of a closed outline at several (segment, t) places. */
function splitOutline(anchors, splits) {
  let a = anchors.map((p, i) => ({ ...p, tag: `a${i}` }));
  const order = splits.map((s, k) => ({ ...s, k })).sort((p, q) => q.seg - p.seg || q.t - p.t);
  let lastSeg = -1;
  let lastT = 1;
  for (const s of order) {
    if (s.seg !== lastSeg) {
      lastSeg = s.seg;
      lastT = 1;
    }
    const t = s.t / lastT;
    if (t <= 1e-6 || t >= 1 - 1e-6) continue;
    a = insertAnchor(a, true, s.seg, t);
    a[s.seg + 1].tag = `s${s.k}`;
    lastT = s.t;
  }
  return a;
}

/**
 * Four corner indices (clockwise from the top left) splitting a prepared
 * outline into the sides that the source rectangle's sides map onto: the
 * anchors nearest the corners of the outline's bounding box, or new anchors
 * at the outline's points nearest them when no anchor is close (a circle
 * meets its box corners on the diagonals). Returns { anchors, corners }.
 */
export function topCorners(anchors) {
  const b = pathBounds(anchors, true);
  const diag = Math.hypot(b.w, b.h) || 1;
  const targets = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
  const picks = targets.map(([cx, cy]) => {
    let ai = 0;
    let ad = Infinity;
    anchors.forEach((p, i) => {
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < ad - 1e-9) {
        ad = d;
        ai = i;
      }
    });
    const near = nearestOnPath(anchors, true, cx, cy);
    if (!near || ad <= near.d + diag * 0.04 || near.t < 1e-3 || near.t > 1 - 1e-3) return { anchor: ai };
    return { seg: near.index, t: near.t };
  });
  const splits = picks.filter((p) => p.anchor === undefined);
  const out = splitOutline(anchors, splits.map((s) => ({ seg: s.seg, t: s.t })));
  const corners = picks.map((p) => {
    const tag = p.anchor !== undefined ? `a${p.anchor}` : `s${splits.indexOf(p)}`;
    return out.findIndex((x) => x.tag === tag);
  });
  const clean = out.map(({ tag, ...p }) => p);
  // The corners must be distinct and run clockwise around the outline.
  const n = clean.length;
  const ok = corners.every((c) => c >= 0) && new Set(corners).size === 4 && [1, 2, 3].every((k) => (corners[k] - corners[0] + n) % n > (corners[k - 1] - corners[0] + n) % n);
  if (ok) return { anchors: clean, corners };
  return { anchors: clean, corners: chooseCorners(clean) };
}

const revCubic = (c) => [c[6], c[7], c[4], c[5], c[2], c[3], c[0], c[1]];

/** A straight segment with handles at thirds, so its parameter runs evenly along it. */
function evenLine(c) {
  if (!isLine(c)) return c;
  const dx = (c[6] - c[0]) / 3;
  const dy = (c[7] - c[1]) / 3;
  return [c[0], c[1], c[0] + dx, c[1] + dy, c[6] - dx, c[7] - dy, c[6], c[7]];
}

/**
 * The envelope mesh for a top object's closed outline: its four sides
 * (see topCorners) span one Coons surface, divided into one patch per side
 * segment so the outline is kept exactly.
 */
export function topMesh(outline) {
  let a = prepareOutline(outline);
  if (signedArea(a, true) < 0) a = reverseAnchors(a);
  const { anchors, corners } = topCorners(a);
  const n = anchors.length;
  const chain = (from, to) => {
    const out = [];
    for (let i = from; i !== to; i = (i + 1) % n) out.push(evenLine(segmentPoints(anchors, i)));
    return out;
  };
  const [c0, c1, c2, c3] = corners;
  const sides = {
    top: chain(c0, c1),
    right: chain(c1, c2),
    bottom: chain(c2, c3).reverse().map(revCubic),
    left: chain(c3, c0).reverse().map(revCubic),
  };
  const nat = naturalGrid(sides);
  const rows = clampCount(nat.rows);
  const cols = clampCount(nat.cols);
  const points = gridFromSides(sides, rows, cols).map(({ c, a: alpha, ...p }) => p);
  return { rows, cols, points };
}

// ---- mapping ----

/** Curve tolerance for a fidelity over artwork of a given diagonal (fidelity 50 matches the Warp effect). */
export function toleranceFor(fidelity, diag) {
  const base = Math.max(0.02, Math.min(0.25, diag * 0.0005));
  return Math.max(0.004, base * 4 ** ((50 - fidelity) / 50));
}

/**
 * The point function of an envelope over source rectangle r (frame space):
 * (x, y) document -> { x, y } document. Returns null for empty sources.
 */
export function envelopeMapping(live, r) {
  if (!r || !(r.w > 0) || !(r.h > 0)) return null;
  const f = frameOf({ live });
  const ident = isIdentityFrame(f);
  const inv = ident ? null : invert(f);
  const toFrame = ident ? (x, y) => ({ x, y }) : (x, y) => apply(inv, x, y);
  if (live.mode === 'mesh') {
    const mesh = live.mesh;
    if (!mesh) return null;
    const patches = meshPatches(mesh);
    const stops = meshStops(mesh);
    return (x, y) => {
      const q = toFrame(x, y);
      return evalMesh(mesh, (q.x - r.x) / r.w, (q.y - r.y) / r.h, patches, stops);
    };
  }
  const w = normalizeWarp(live.warp || WARP_DEFAULTS);
  const g = warpMapping(w.style, w, r);
  if (ident) return g;
  return (x, y) => {
    const p = apply(inv, x, y);
    const q = g(p.x, p.y);
    return apply(f, q.x, q.y);
  };
}

/** The envelope's shape outline (closed anchors in document space) for a source rectangle. */
export function envelopeOutline(live, r) {
  if (live.mode === 'mesh' && live.mesh) return meshBoundary(live.mesh);
  const f = envelopeMapping(live, r);
  if (!f) return null;
  const rect = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ].map(([x, y]) => {
    const p = apply(frameOf({ live }), x, y);
    return { x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y };
  });
  return mapSubpaths([{ anchors: rect, closed: true }], f, { tolerance: toleranceFor(live.options?.fidelity ?? 50, Math.hypot(r.w, r.h)) })[0].anchors;
}

/** The mesh shown and edited for an envelope: its own, or the one its warp becomes. */
export function displayMesh(live, r) {
  if (live.mode === 'mesh' && live.mesh) return live.mesh;
  if (!r) return null;
  const g = warpGrid(live.warp || WARP_DEFAULTS);
  return warpMesh(live.warp || WARP_DEFAULTS, r, g.rows, g.cols, frameOf({ live }));
}

/** Live params after a document transform m (mesh points and frame follow it). */
export function transformLive(live, m) {
  const L = [m[0], m[1], m[2], m[3], 0, 0];
  const next = { ...live, frame: multiply(L, frameOf({ live })) };
  if (isIdentityFrame(next.frame)) delete next.frame;
  if (live.mesh) next.mesh = { ...live.mesh, points: transformPoints(live.mesh.points, m) };
  return next;
}

/** A fresh live record. */
export function envelopeLive({ mode = 'warp', warp = null, mesh = null, top = false, options = null } = {}) {
  const live = { kind: KIND, mode, options: normalizeOptions(options || {}) };
  if (mode === 'warp') live.warp = normalizeWarp(warp || WARP_DEFAULTS);
  else live.mesh = mesh;
  if (top) live.top = true;
  return live;
}
