/**
 * Planar maps: the arrangement of a set of curves (open or closed paths)
 * as vertices, edges and faces, for Paint Regions.
 *
 *   buildPlanarMap(curves, { gap }) -> { vertices, edges, faces, gaps }
 *
 * `curves` are cubic segments [{ c: [x0,y0,x1,y1,x2,y2,x3,y3], owner }].
 * Every pair is intersected (recursive subdivision down to flat pieces,
 * then a line intersection; collinear overlaps split at the overlap
 * ends), each curve is cut at its intersections, end points closer than
 * a small tolerance are merged into one vertex, and duplicate edges (the
 * same piece of two coincident paths) are kept once with both owners.
 *
 * Faces come from the half-edge structure: around every vertex the edges
 * are sorted by direction and each face is traced by turning to the
 * neighboring edge. Cycles that wind one way are bounded faces; the others
 * are the outer boundaries of connected pieces, which become holes of the
 * smallest face containing them (a ring inside a square leaves a hole in
 * the square's face). Dangling edges stay edges: they can be stroked but
 * enclose nothing.
 *
 * Gap closing: with `gap` > 0 every free end (a vertex with one edge) is
 * joined by a straight, invisible gap edge to the nearest free end or edge
 * point within that distance, before the faces are traced.
 */
import { split, pointAt, derivativeAt, isLine, nearestOnCubic, flattenCubic } from '../../model/bezier.js';

/** Vertex merge tolerance (document units). */
export const VERTEX_EPS = 1e-2;
const FLAT = 1e-3;
const MAX_DEPTH = 48;

// ---- small helpers ----

function hull(c) {
  let x0 = c[0];
  let y0 = c[1];
  let x1 = c[0];
  let y1 = c[1];
  for (let i = 2; i < 8; i += 2) {
    if (c[i] < x0) x0 = c[i];
    if (c[i] > x1) x1 = c[i];
    if (c[i + 1] < y0) y0 = c[i + 1];
    if (c[i + 1] > y1) y1 = c[i + 1];
  }
  return { x0, y0, x1, y1 };
}

const overlaps = (a, b, e) => a.x0 <= b.x1 + e && b.x0 <= a.x1 + e && a.y0 <= b.y1 + e && b.y0 <= a.y1 + e;

/** Largest distance of the inner control points from the chord. */
function flatness(c) {
  const dx = c[6] - c[0];
  const dy = c[7] - c[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return Math.max(Math.hypot(c[2] - c[0], c[3] - c[1]), Math.hypot(c[4] - c[0], c[5] - c[1]));
  const d1 = Math.abs((c[2] - c[0]) * dy - (c[3] - c[1]) * dx) / len;
  const d2 = Math.abs((c[4] - c[0]) * dy - (c[5] - c[1]) * dx) / len;
  return Math.max(d1, d2);
}

export function reverseCubic(c) {
  return [c[6], c[7], c[4], c[5], c[2], c[3], c[0], c[1]];
}

/** Sub-curve of c between parameters t0 < t1. */
function subCurve(c, t0, t1) {
  let r = c;
  if (t1 < 1) r = split(r, t1)[0];
  if (t0 > 0) r = split(r, t0 / t1)[1];
  return r;
}

/**
 * Intersections of two straight chords (with a little slack at the ends).
 * Collinear overlapping chords report the overlap's end points.
 */
function chordHits(a, b, out, ta0, ta1, tb0, tb1) {
  const ax = a[0];
  const ay = a[1];
  const adx = a[6] - ax;
  const ady = a[7] - ay;
  const bx = b[0];
  const by = b[1];
  const bdx = b[6] - bx;
  const bdy = b[7] - by;
  const den = adx * bdy - ady * bdx;
  const la = Math.hypot(adx, ady);
  const lb = Math.hypot(bdx, bdy);
  const slackA = la > 0 ? 1e-7 + FLAT / la : 0;
  const slackB = lb > 0 ? 1e-7 + FLAT / lb : 0;
  if (Math.abs(den) > 1e-12 * Math.max(1, la * lb)) {
    const u = ((bx - ax) * bdy - (by - ay) * bdx) / den;
    const v = ((bx - ax) * ady - (by - ay) * adx) / den;
    if (u >= -slackA && u <= 1 + slackA && v >= -slackB && v <= 1 + slackB) {
      const uu = Math.max(0, Math.min(1, u));
      const vv = Math.max(0, Math.min(1, v));
      out.push({ ta: ta0 + (ta1 - ta0) * uu, tb: tb0 + (tb1 - tb0) * vv, x: ax + adx * uu, y: ay + ady * uu, ta0, ta1, tb0, tb1 });
    }
    return;
  }
  // Parallel: collinear only if b's start lies on a's line.
  if (la < 1e-12 || lb < 1e-12) return;
  const dist = Math.abs((bx - ax) * ady - (by - ay) * adx) / la;
  if (dist > FLAT) return;
  const proj = (x, y) => ((x - ax) * adx + (y - ay) * ady) / (la * la);
  const projB = (x, y) => ((x - bx) * bdx + (y - by) * bdy) / (lb * lb);
  const pts = [];
  const b0 = proj(bx, by);
  const b1 = proj(b[6], b[7]);
  const a0 = projB(ax, ay);
  const a1 = projB(a[6], a[7]);
  if (b0 >= -slackA && b0 <= 1 + slackA) pts.push([b0, 0]);
  if (b1 >= -slackA && b1 <= 1 + slackA) pts.push([b1, 1]);
  if (a0 >= -slackB && a0 <= 1 + slackB) pts.push([0, a0]);
  if (a1 >= -slackB && a1 <= 1 + slackB) pts.push([1, a1]);
  for (const [u, v] of pts) {
    const uu = Math.max(0, Math.min(1, u));
    const vv = Math.max(0, Math.min(1, v));
    out.push({ ta: ta0 + (ta1 - ta0) * uu, tb: tb0 + (tb1 - tb0) * vv, x: ax + adx * uu, y: ay + ady * uu, ta0, ta1, tb0, tb1 });
  }
}

/**
 * The parameter in [t0, t1] where cubic c comes closest to (x, y), from a
 * guess: chord fractions are not curve parameters (a straight cubic with
 * retracted handles speeds up and slows down), so hits are refined.
 */
function paramNear(c, x, y, guess, t0, t1) {
  let t = guess;
  let best = t;
  let bestD = Infinity;
  for (let k = 0; k <= 8; k++) {
    const tk = t0 + ((t1 - t0) * k) / 8;
    const p = pointAt(c, tk);
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = tk;
    }
  }
  t = best;
  for (let i = 0; i < 12; i++) {
    const p = pointAt(c, t);
    const d = derivativeAt(c, t);
    const den = d.x * d.x + d.y * d.y;
    if (den < 1e-18) break;
    const nt = Math.max(t0, Math.min(t1, t - ((p.x - x) * d.x + (p.y - y) * d.y) / den));
    if (Math.abs(nt - t) < 1e-12) {
      t = nt;
      break;
    }
    t = nt;
  }
  return t;
}

/** Parameter pairs [ta, tb] where cubics a and b meet. */
export function intersectCubics(a, b, out = []) {
  const raw = [];
  const rec = (ca, ta0, ta1, cb, tb0, tb1, depth) => {
    if (!overlaps(hull(ca), hull(cb), FLAT)) return;
    const fa = flatness(ca) <= FLAT;
    const fb = flatness(cb) <= FLAT;
    if ((fa && fb) || depth >= MAX_DEPTH) {
      chordHits(ca, cb, raw, ta0, ta1, tb0, tb1);
      return;
    }
    const ha = hull(ca);
    const hb = hull(cb);
    const sa = fa ? 0 : Math.max(ha.x1 - ha.x0, ha.y1 - ha.y0);
    const sb = fb ? 0 : Math.max(hb.x1 - hb.x0, hb.y1 - hb.y0);
    if (sa >= sb) {
      const [l, r] = split(ca, 0.5);
      const tm = (ta0 + ta1) / 2;
      rec(l, ta0, tm, cb, tb0, tb1, depth + 1);
      rec(r, tm, ta1, cb, tb0, tb1, depth + 1);
    } else {
      const [l, r] = split(cb, 0.5);
      const tm = (tb0 + tb1) / 2;
      rec(ca, ta0, ta1, l, tb0, tm, depth + 1);
      rec(ca, ta0, ta1, r, tm, tb1, depth + 1);
    }
  };
  rec(a, 0, 1, b, 0, 1, 0);
  // Refine to true curve parameters and drop repeats (a crossing found in two neighboring pieces).
  const pts = [];
  for (const r of raw) {
    const ta = paramNear(a, r.x, r.y, r.ta, Math.max(0, r.ta0 - 1e-3), Math.min(1, r.ta1 + 1e-3));
    const tb = paramNear(b, r.x, r.y, r.tb, Math.max(0, r.tb0 - 1e-3), Math.min(1, r.tb1 + 1e-3));
    const p = pointAt(a, ta);
    if (pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < VERTEX_EPS * 0.5)) continue;
    pts.push(p);
    out.push([ta, tb]);
  }
  return out;
}

/** A self-intersection of one cubic (a loop), as parameter pairs. */
function selfHits(c, out) {
  if (isLine(c)) return;
  // A cubic loops at most once: split at the middle and intersect the halves.
  const [l, r] = split(c, 0.5);
  const hits = [];
  intersectCubics(l, r, hits);
  for (const [u, v] of hits) {
    const t1 = u * 0.5;
    const t2 = 0.5 + v * 0.5;
    if (t2 - t1 > 1e-4) out.push(t1, t2);
  }
}

// ---- vertices ----

class VertexIndex {
  constructor(eps) {
    this.eps = eps;
    this.cells = new Map();
    this.list = [];
  }

  key(x, y) {
    return `${Math.floor(x / this.eps)},${Math.floor(y / this.eps)}`;
  }

  find(x, y) {
    const cx = Math.floor(x / this.eps);
    const cy = Math.floor(y / this.eps);
    let best = -1;
    let bestD = this.eps;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const ids = this.cells.get(`${cx + i},${cy + j}`);
        if (!ids) continue;
        for (const id of ids) {
          const v = this.list[id];
          const d = Math.hypot(v.x - x, v.y - y);
          if (d <= bestD) {
            bestD = d;
            best = id;
          }
        }
      }
    }
    return best;
  }

  add(x, y) {
    const found = this.find(x, y);
    if (found >= 0) return found;
    const id = this.list.length;
    this.list.push({ id, x, y });
    const k = this.key(x, y);
    if (!this.cells.has(k)) this.cells.set(k, []);
    this.cells.get(k).push(id);
    return id;
  }
}

// ---- flattening and polygons ----

function curvePoints(c, tol, out, skipFirst) {
  if (!skipFirst) out.push([c[0], c[1]]);
  flattenCubic(c, tol, (x0, y0, x1, y1) => out.push([x1, y1]));
  return out;
}

/** Polygon of a cycle of half-edges (flattened). */
function cyclePolygon(map, cycle, tol = 0.1) {
  const pts = [];
  for (const h of cycle) curvePoints(halfCurve(map, h), tol, pts, pts.length > 0);
  return pts;
}

const GL_T = [0.5 - 0.5 * Math.sqrt(0.6), 0.5, 0.5 + 0.5 * Math.sqrt(0.6)];
const GL_W = [5 / 18, 8 / 18, 5 / 18];

/** Exact signed area contribution of a cubic, 1/2 ∫ x dy - y dx (3-point Gauss is exact for degree 5). */
function cubicArea(c) {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const p = pointAt(c, GL_T[i]);
    const d = derivativeAt(c, GL_T[i]);
    s += GL_W[i] * (p.x * d.y - p.y * d.x);
  }
  return s / 2;
}

/** Exact signed area of a cycle of half-edges. */
function cycleArea(map, cycle) {
  let s = 0;
  for (const h of cycle) s += cubicArea(halfCurve(map, h));
  return s;
}

function polyBounds(pts) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Even-odd point in polygons. */
export function pointInPolys(polys, x, y) {
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Nonzero winding number of polygons around a point. */
export function windingNumber(polys, x, y) {
  let w = 0;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xa, ya] = poly[j];
      const [xb, yb] = poly[i];
      if (ya <= y) {
        if (yb > y && (xb - xa) * (y - ya) - (x - xa) * (yb - ya) > 0) w++;
      } else if (yb <= y && (xb - xa) * (y - ya) - (x - xa) * (yb - ya) < 0) w--;
    }
  }
  return w;
}

/**
 * Interior sample points of a region given as polygons (even-odd), spread
 * over it: on `rows` horizontal scan lines, `perRow` points spread along
 * the inside spans. The first point is the middle of the widest span (the
 * one deepest inside); the rest follow row by row.
 */
export function interiorPoints(polys, bounds, rows = 5, perRow = 3) {
  if (!bounds || bounds.h <= 0 || bounds.w <= 0) return [];
  let deepest = null;
  const spread = [];
  for (let r = 0; r < rows; r++) {
    // Scan lines avoid exact vertex heights by a tiny irrational shift.
    const y = bounds.y + (bounds.h * (r + 0.5)) / rows + bounds.h * 1e-7 * Math.SQRT2;
    const xs = [];
    for (const poly of polys) {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
      }
    }
    xs.sort((a, b) => a - b);
    const spans = [];
    let total = 0;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i];
      if (w <= 1e-6) continue;
      spans.push([xs[i], w]);
      total += w;
      if (!deepest || w > deepest.w) deepest = { x: xs[i] + w / 2, y, w };
    }
    // Points at even shares of the row's inside length.
    for (let k = 0; k < perRow && total > 0; k++) {
      let at = (total * (2 * k + 1)) / (2 * perRow);
      for (const [x0, w] of spans) {
        if (at <= w) {
          spread.push([x0 + at, y]);
          break;
        }
        at -= w;
      }
    }
  }
  return deepest ? [[deepest.x, deepest.y], ...spread] : [];
}

// ---- half-edges ----

/** The cubic of half-edge h (edge h >> 1, reversed when h is odd). */
export function halfCurve(map, h) {
  const e = map.edges[h >> 1];
  return h & 1 ? reverseCubic(e.c) : e.c;
}

function halfOrigin(map, h) {
  const e = map.edges[h >> 1];
  return h & 1 ? e.b : e.a;
}

/** Leaving direction of a curve at its start: tangent, with a second look a bit further for ties. */
function leaving(c) {
  let dx = c[2] - c[0];
  let dy = c[3] - c[1];
  if (Math.hypot(dx, dy) < 1e-9) {
    dx = c[4] - c[0];
    dy = c[5] - c[1];
  }
  if (Math.hypot(dx, dy) < 1e-9) {
    dx = c[6] - c[0];
    dy = c[7] - c[1];
  }
  const p = pointAt(c, 0.05);
  return { a: Math.atan2(dy, dx), b: Math.atan2(p.y - c[1], p.x - c[0]) };
}

// ---- building ----

/** Cut curves at all their intersections into edges between merged vertices. */
function arrange(curves) {
  const n = curves.length;
  const params = curves.map(() => []);
  const boxes = curves.map((cv) => hull(cv.c));
  // Sweep along x to skip pairs whose boxes cannot meet.
  const order = [...curves.keys()].sort((i, j) => boxes[i].x0 - boxes[j].x0);
  for (let oi = 0; oi < n; oi++) {
    const i = order[oi];
    for (let oj = oi + 1; oj < n; oj++) {
      const j = order[oj];
      if (boxes[j].x0 > boxes[i].x1 + FLAT) break;
      if (!overlaps(boxes[i], boxes[j], FLAT)) continue;
      const hits = intersectCubics(curves[i].c, curves[j].c);
      for (const [ta, tb] of hits) {
        params[i].push(ta);
        params[j].push(tb);
      }
    }
    selfHits(curves[i].c, params[i]);
  }
  const vix = new VertexIndex(VERTEX_EPS);
  const edges = [];
  curves.forEach((cv, i) => {
    const ts = [...new Set(params[i].filter((t) => t > 1e-9 && t < 1 - 1e-9))].sort((a, b) => a - b);
    const cuts = [];
    for (const t of ts) {
      // Merge parameters whose points coincide.
      const p = pointAt(cv.c, t);
      const last = cuts[cuts.length - 1];
      if (last && Math.hypot(last.p.x - p.x, last.p.y - p.y) < VERTEX_EPS) continue;
      const first = pointAt(cv.c, 0);
      const end = pointAt(cv.c, 1);
      if (Math.hypot(first.x - p.x, first.y - p.y) < VERTEX_EPS || Math.hypot(end.x - p.x, end.y - p.y) < VERTEX_EPS) continue;
      cuts.push({ t, p });
    }
    let prev = 0;
    const bounds = [...cuts.map((x) => x.t), 1];
    for (const t of bounds) {
      const piece = subCurve(cv.c, prev, t);
      prev = t;
      const a = vix.add(piece[0], piece[1]);
      const b = vix.add(piece[6], piece[7]);
      // Snap the ends to the vertices so cycles close exactly.
      const va = vix.list[a];
      const vb = vix.list[b];
      const c = piece.slice();
      c[2] += va.x - c[0];
      c[3] += va.y - c[1];
      c[4] += vb.x - c[6];
      c[5] += vb.y - c[7];
      c[0] = va.x;
      c[1] = va.y;
      c[6] = vb.x;
      c[7] = vb.y;
      const len = Math.hypot(c[6] - c[0], c[7] - c[1]) + Math.hypot(c[2] - c[0], c[3] - c[1]) + Math.hypot(c[4] - c[6], c[5] - c[7]);
      if (a === b && len < VERTEX_EPS * 4) continue;
      edges.push({ c, a, b, owner: cv.owner, owners: [cv.owner], kind: cv.kind || 'path' });
    }
  });
  // Coincident pieces of different curves: keep one edge with every owner.
  const byEnds = new Map();
  const out = [];
  for (const e of edges) {
    const key = e.a < e.b ? `${e.a}:${e.b}` : `${e.b}:${e.a}`;
    const m = pointAt(e.c, 0.5);
    const list = byEnds.get(key) || [];
    const dup = list.find((o) => {
      const q = pointAt(o.c, 0.5);
      return Math.hypot(q.x - m.x, q.y - m.y) < VERTEX_EPS * 5;
    });
    if (dup) {
      if (!dup.owners.includes(e.owner)) dup.owners.push(e.owner);
      // A path edge wins over a gap edge on the same spot.
      if (dup.kind === 'gap' && e.kind !== 'gap') {
        dup.kind = e.kind;
        dup.owner = e.owner;
      } else if (e.kind !== 'gap') dup.owner = e.owner; // topmost owner (curves come in paint order)
      continue;
    }
    list.push(e);
    byEnds.set(key, list);
    out.push(e);
  }
  out.forEach((e, i) => (e.id = i));
  return { vertices: vix.list, edges: out };
}

/** Straight gap edges from free ends to the nearest end or edge point within `gap`. */
function findGaps(map, gap) {
  const deg = new Map();
  for (const e of map.edges) {
    deg.set(e.a, (deg.get(e.a) || 0) + 1);
    deg.set(e.b, (deg.get(e.b) || 0) + 1);
  }
  const free = map.vertices.filter((v) => deg.get(v.id) === 1);
  const gaps = [];
  const seen = new Set();
  for (const v of free) {
    let best = null;
    for (const w of free) {
      if (w.id === v.id) continue;
      const d = Math.hypot(w.x - v.x, w.y - v.y);
      if (d <= gap && (!best || d < best.d)) best = { d, x: w.x, y: w.y, key: v.id < w.id ? `${v.id}:${w.id}` : `${w.id}:${v.id}` };
    }
    for (const e of map.edges) {
      if (e.a === v.id || e.b === v.id) continue;
      const hb = hull(e.c);
      if (v.x < hb.x0 - gap || v.x > hb.x1 + gap || v.y < hb.y0 - gap || v.y > hb.y1 + gap) continue;
      const r = nearestOnCubic(e.c, v.x, v.y);
      // An end point of the edge is a free end (handled above) or a junction; both are fine targets.
      if (r.d <= gap && r.d > VERTEX_EPS && (!best || r.d < best.d - 1e-9)) best = { d: r.d, x: r.x, y: r.y, key: `${v.id}@${e.id}:${r.t.toFixed(4)}` };
    }
    if (!best || seen.has(best.key)) continue;
    seen.add(best.key);
    gaps.push({ c: [v.x, v.y, v.x, v.y, best.x, best.y, best.x, best.y], owner: null, kind: 'gap', length: best.d });
  }
  return gaps;
}

/**
 * Build the planar map of `curves` ({ c, owner } in paint order, back to
 * front). Options: `gap` (close gaps up to this size, 0 = off).
 */
export function buildPlanarMap(curves, { gap = 0 } = {}) {
  const clean = curves.filter((cv) => {
    if (!cv.c.every(Number.isFinite)) return false;
    const b = hull(cv.c);
    return b.x1 - b.x0 + b.y1 - b.y0 > VERTEX_EPS * 0.5;
  });
  let base = arrange(clean);
  let gaps = [];
  if (gap > 0) {
    gaps = findGaps(base, gap);
    if (gaps.length) base = arrange([...clean, ...gaps]);
  }
  const map = { vertices: base.vertices, edges: base.edges, faces: [], gaps };
  traceFaces(map);
  return map;
}

function traceFaces(map) {
  const { vertices, edges } = map;
  const H = edges.length * 2;
  // Outgoing half-edges around each vertex, sorted by direction.
  const around = vertices.map(() => []);
  const dir = new Array(H);
  for (let h = 0; h < H; h++) {
    dir[h] = leaving(halfCurve(map, h));
    around[halfOrigin(map, h)].push(h);
  }
  const pos = new Int32Array(H);
  for (const list of around) {
    list.sort((x, y) => {
      const d = dir[x].a - dir[y].a;
      if (Math.abs(d) > 1e-9) return d;
      return dir[x].b - dir[y].b;
    });
    list.forEach((h, i) => (pos[h] = i));
  }
  // next(h): at h's end, the outgoing edge just before h's twin in the sorted ring.
  const next = (h) => {
    const twin = h ^ 1;
    const v = halfOrigin(map, twin);
    const ring = around[v];
    return ring[(pos[twin] - 1 + ring.length) % ring.length];
  };
  const visited = new Uint8Array(H);
  const cycles = [];
  for (let h0 = 0; h0 < H; h0++) {
    if (visited[h0]) continue;
    const cycle = [];
    let h = h0;
    let guard = 0;
    while (!visited[h] && guard++ <= H) {
      visited[h] = 1;
      cycle.push(h);
      h = next(h);
    }
    const poly = cyclePolygon(map, cycle);
    cycles.push({ halfs: cycle, poly, area: cycleArea(map, cycle) });
  }
  // Connected pieces (union-find over edges) to give every outer boundary its component.
  const parent = vertices.map((v) => v.id);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (const e of edges) parent[find(e.a)] = find(e.b);
  // With y pointing down and directions sorted by atan2, bounded faces wind positive.
  const bounded = [];
  const outer = [];
  for (const cy of cycles) {
    cy.comp = find(halfOrigin(map, cy.halfs[0]));
    if (cy.area > 1e-9) bounded.push(cy);
    else outer.push(cy);
  }
  const faces = bounded.map((cy, i) => ({ id: i, outer: cy, holes: [], comp: cy.comp, bounds: polyBounds(cy.poly) }));
  for (const o of outer) {
    // The smallest face of another piece that contains this piece.
    const v = vertices[halfOrigin(map, o.halfs[0])];
    let best = null;
    for (const f of faces) {
      if (f.comp === o.comp) continue;
      const b = f.bounds;
      if (v.x < b.x || v.x > b.x + b.w || v.y < b.y || v.y > b.y + b.h) continue;
      if (!pointInPolys([f.outer.poly], v.x, v.y)) continue;
      if (!best || f.outer.area < best.outer.area) best = f;
    }
    if (best) best.holes.push(o);
  }
  for (const f of faces) {
    f.polys = [f.outer.poly, ...f.holes.map((hc) => hc.poly)];
    f.area = f.outer.area + f.holes.reduce((s, hc) => s + hc.area, 0);
    f.cycles = [f.outer.halfs, ...f.holes.map((hc) => hc.halfs)];
  }
  map.faces = faces.filter((f) => f.area > 1e-6);
  map.faces.forEach((f, i) => (f.id = i));
  // Faces on each side of every edge (-1 for the outside).
  const faceOf = new Int32Array(H).fill(-1);
  for (const f of map.faces) for (const cyc of f.cycles) for (const h of cyc) faceOf[h] = f.id;
  map.faceOfHalf = faceOf;
}

// ---- queries ----

/** The face containing a point, or null. */
export function faceAt(map, x, y) {
  let best = null;
  for (const f of map.faces) {
    const b = f.bounds;
    if (x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) continue;
    if (pointInPolys(f.polys, x, y) && (!best || f.area < best.area)) best = f;
  }
  return best;
}

const edgePolyCache = new WeakMap();

/** Flattened points of an edge (cached). */
export function edgePolyline(e) {
  let p = edgePolyCache.get(e);
  if (!p) edgePolyCache.set(e, (p = curvePoints(e.c, 0.1, [], false)));
  return p;
}

/** Distance from a point to an edge. */
export function edgeDistance(e, x, y) {
  const pts = edgePolyline(e);
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

/** The nearest edge within `tol` of a point (gap edges only with `gaps`), or null. */
export function edgeAt(map, x, y, tol, { gaps = false } = {}) {
  let best = null;
  let bestD = tol;
  for (const e of map.edges) {
    if (e.kind === 'gap' && !gaps) continue;
    const hb = hull(e.c);
    if (x < hb.x0 - tol || x > hb.x1 + tol || y < hb.y0 - tol || y > hb.y1 + tol) continue;
    const d = edgeDistance(e, x, y);
    if (d <= bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** Anchors for a chain of cubics that join end to start. */
export function cubicsToAnchors(cubics, closed) {
  if (!cubics.length) return [];
  const out = [{ x: cubics[0][0], y: cubics[0][1], ix: cubics[0][0], iy: cubics[0][1], ox: cubics[0][2], oy: cubics[0][3] }];
  for (const c of cubics) {
    const last = out[out.length - 1];
    last.ox = c[2];
    last.oy = c[3];
    out.push({ x: c[6], y: c[7], ix: c[4], iy: c[5], ox: c[6], oy: c[7] });
  }
  if (closed && out.length > 1) {
    const end = out.pop();
    out[0].ix = end.ix;
    out[0].iy = end.iy;
  }
  return out;
}

/** Subpaths (anchors, closed) outlining a face: its outer boundary and holes. */
export function faceSubpaths(map, face) {
  return face.cycles.map((cyc) => ({ anchors: cubicsToAnchors(cyc.map((h) => halfCurve(map, h)), true), closed: true }));
}

/** Faces on both sides of an edge: [left, right] ids (-1 outside). */
export function edgeFaces(map, e) {
  return [map.faceOfHalf[e.id * 2], map.faceOfHalf[e.id * 2 + 1]];
}
