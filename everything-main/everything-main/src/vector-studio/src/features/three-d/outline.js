/**
 * 2D outline helpers for building meshes: flattening curves into polylines,
 * sorting closed rings into regions (outer ring plus holes), triangulating
 * regions, insetting rings for bevels, distances to an outline and a
 * Delaunay triangulation for puffed (inflated) surfaces.
 *
 * Points are [x, y] arrays. A ring is a closed polyline without a repeated
 * last point. Orientation: area() is positive for rings that turn
 * clockwise on screen (y down); regions keep outer rings positive and
 * holes negative.
 */
import { flattenPath } from '../../model/bezier.js';

/**
 * Subpaths [{ anchors, closed }] as polylines [{ pts, closed }]. Curves are
 * flattened to within `tolerance`; repeated points and a closing point equal
 * to the first are dropped. Open subpaths that end where they start count
 * as closed, and so do all of them with `closeOpen` (filled artwork paints
 * open paths as if closed).
 */
export function flattenSubpaths(subpaths, tolerance = 0.5, { closeOpen = false } = {}) {
  const out = [];
  for (const s of subpaths || []) {
    if (!s?.anchors || s.anchors.length < 2) continue;
    const raw = flattenPath(s.anchors, s.closed, tolerance);
    const pts = [];
    for (const p of raw) {
      const last = pts[pts.length - 1];
      if (!last || Math.abs(last[0] - p.x) > 1e-6 || Math.abs(last[1] - p.y) > 1e-6) pts.push([p.x, p.y]);
    }
    let closed = Boolean(s.closed) || closeOpen;
    if (pts.length > 2) {
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) {
        pts.pop();
        closed = true;
      }
    }
    closed = closed && pts.length > 2;
    if (pts.length >= 2) out.push({ pts: simplify(pts, closed, tolerance * 0.05), closed });
  }
  return out;
}

/** Drop points that lie on the line between their neighbors. */
function simplify(pts, closed, eps) {
  if (pts.length < 3) return pts;
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(pts[i]);
      continue;
    }
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    const along = (b[0] - a[0]) * (c[0] - a[0]) + (b[1] - a[1]) * (c[1] - a[1]);
    if (Math.abs(cr) / len < eps && along > 0 && along < len * len) continue;
    out.push(b);
  }
  return out.length >= (closed ? 3 : 2) ? out : pts;
}

/** Signed area (positive for clockwise rings on screen, y down). */
export function area(ring) {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function pointInRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Even-odd inside test against several rings. */
export function insideRings(rings, x, y) {
  let inside = false;
  for (const r of rings) if (pointInRing(r, x, y)) inside = !inside;
  return inside;
}

export function ringsBounds(rings) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rings) {
    for (const p of r) {
      if (p[0] < x0) x0 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[0] > x1) x1 = p[0];
      if (p[1] > y1) y1 = p[1];
    }
  }
  return x0 <= x1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** A point strictly inside a ring (for nesting tests): a vertex nudged inward, else the centroid. */
function samplePoint(ring) {
  const s = Math.sign(area(ring)) || 1;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[(i - 1 + ring.length) % ring.length];
    const b = ring[i];
    const c = ring[(i + 1) % ring.length];
    const mx = (a[0] + c[0]) / 2;
    const my = (a[1] + c[1]) / 2;
    const p = [b[0] + (mx - b[0]) * 0.01, b[1] + (my - b[1]) * 0.01];
    // Convex corners point inward toward the neighbors' midpoint.
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cr * s > 0 && pointInRing(ring, p[0], p[1])) return p;
  }
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

/**
 * Closed rings sorted into regions [{ outer, holes }] by nesting (even-odd:
 * a ring inside an odd number of others is a hole of the innermost one).
 * Outer rings come back with positive area, holes negative.
 */
export function regionsFromRings(rings) {
  const rs = rings.filter((r) => r.length >= 3 && Math.abs(area(r)) > 1e-9);
  const info = rs.map((r) => ({ ring: r, a: Math.abs(area(r)), p: samplePoint(r), parents: [] }));
  for (let i = 0; i < info.length; i++) {
    for (let j = 0; j < info.length; j++) {
      if (i === j || info[j].a <= info[i].a) continue;
      if (pointInRing(info[j].ring, info[i].p[0], info[i].p[1])) info[i].parents.push(j);
    }
  }
  const regions = [];
  const regionOf = new Map();
  info.forEach((r, i) => {
    if (r.parents.length % 2 === 0) {
      const outer = area(r.ring) < 0 ? [...r.ring].reverse() : r.ring;
      regionOf.set(i, regions.length);
      regions.push({ outer, holes: [] });
    }
  });
  info.forEach((r, i) => {
    if (r.parents.length % 2 === 0) return;
    // The innermost containing ring is the parent with the smallest area.
    let best = -1;
    for (const p of r.parents) if (best < 0 || info[p].a < info[best].a) best = p;
    const reg = regions[regionOf.get(best)];
    if (!reg) return;
    reg.holes.push(area(r.ring) > 0 ? [...r.ring].reverse() : r.ring);
  });
  return regions;
}

// ---- triangulation (ear clipping with hole bridges) ----

const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function inTriangle(a, b, c, p) {
  const d1 = cross2(a, b, p);
  const d2 = cross2(b, c, p);
  const d3 = cross2(c, a, p);
  return d1 >= 0 && d2 >= 0 && d3 >= 0;
}

function segmentsCross(a, b, c, d) {
  const d1 = cross2(c, d, a);
  const d2 = cross2(c, d, b);
  const d3 = cross2(a, b, c);
  const d4 = cross2(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Join holes into the outer ring with zero-width bridges so the region is
 * one ring of vertex indices into `points`. Returns { points, ring }.
 */
function bridgeHoles(outer, holes) {
  const points = [...outer];
  let ring = outer.map((_, i) => i);
  const sorted = holes
    .filter((h) => h.length >= 3)
    .map((h) => {
      let k = 0;
      for (let i = 1; i < h.length; i++) if (h[i][0] > h[k][0]) k = i;
      return { h, k };
    })
    .sort((a, b) => b.h[b.k][0] - a.h[a.k][0]);
  for (const { h, k } of sorted) {
    const base = points.length;
    points.push(...h);
    const hp = h[k];
    // The nearest ring vertex the hole's rightmost point can see without crossing an edge.
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const q = points[ring[i]];
      const d = (q[0] - hp[0]) ** 2 + (q[1] - hp[1]) ** 2;
      if (d >= bestD) continue;
      let blocked = false;
      for (let j = 0; j < ring.length && !blocked; j++) {
        const a = points[ring[j]];
        const b = points[ring[(j + 1) % ring.length]];
        if (segmentsCross(hp, q, a, b)) blocked = true;
      }
      for (let j = 0; j < h.length && !blocked; j++) {
        if (segmentsCross(hp, q, h[j], h[(j + 1) % h.length])) blocked = true;
      }
      if (!blocked) {
        best = i;
        bestD = d;
      }
    }
    if (best < 0) best = 0;
    const holeIdx = [];
    for (let j = 0; j <= h.length; j++) holeIdx.push(base + ((k + j) % h.length));
    ring = [...ring.slice(0, best + 1), ...holeIdx, ring[best], ...ring.slice(best + 1)];
  }
  return { points, ring };
}

/**
 * Triangulate a region (outer ring positive, holes negative). Returns
 * { points, tris } with tris as index triples, all wound like the outer ring.
 */
export function triangulate(outer, holes = []) {
  const { points, ring } = bridgeHoles(outer, holes);
  const tris = [];
  const idx = [...ring];
  let guard = idx.length * idx.length + 10;
  let i = 0;
  while (idx.length > 3 && guard-- > 0) {
    const n = idx.length;
    const ia = idx[(i - 1 + n) % n];
    const ib = idx[i % n];
    const ic = idx[(i + 1) % n];
    const a = points[ia];
    const b = points[ib];
    const c = points[ic];
    let ear = cross2(a, b, c) > 1e-12;
    if (ear) {
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        const p = points[j];
        // Bridge duplicates share coordinates with the ear's corners; they do not block it.
        if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1]) || (p[0] === c[0] && p[1] === c[1])) continue;
        if (inTriangle(a, b, c, p)) {
          ear = false;
          break;
        }
      }
    }
    if (ear) {
      tris.push([ia, ib, ic]);
      idx.splice(i % n, 1);
      guard = idx.length * idx.length + 10;
      i = Math.max(0, (i % n) - 1);
    } else if (Math.abs(cross2(a, b, c)) <= 1e-12) {
      // Collinear or doubled-back points (bridges) carry no area.
      idx.splice(i % n, 1);
      i = Math.max(0, (i % n) - 1);
    } else i = (i + 1) % idx.length;
  }
  if (idx.length === 3 && cross2(points[idx[0]], points[idx[1]], points[idx[2]]) > 1e-12) tris.push([idx[0], idx[1], idx[2]]);
  return { points, tris };
}

// ---- insetting (bevels) ----

/** Distance from p to segment ab. */
export function segmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 1e-12 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Distance from (x, y) to the nearest edge of any ring. */
export function distanceToRings(rings, x, y) {
  let best = Infinity;
  const p = [x, y];
  for (const r of rings) {
    for (let i = 0, n = r.length; i < n; i++) {
      const d = segmentDistance(p, r[i], r[(i + 1) % n]);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Unit inset directions of a ring's vertices (pointing into the region
 * for outer rings wound positive and holes wound negative) and the miter
 * factor 1/cos(half angle), capped at `limit`.
 */
export function insetDirections(ring, limit = 3) {
  const n = ring.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n];
    const b = ring[i];
    const c = ring[(i + 1) % n];
    let e1x = b[0] - a[0];
    let e1y = b[1] - a[1];
    let e2x = c[0] - b[0];
    let e2y = c[1] - b[1];
    const l1 = Math.hypot(e1x, e1y) || 1;
    const l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1;
    e1y /= l1;
    e2x /= l2;
    e2y /= l2;
    // Clockwise on screen (y down): the inside is to the right of travel, i.e. (-ey, ex).
    const n1 = [-e1y, e1x];
    const n2 = [-e2y, e2x];
    let mx = n1[0] + n2[0];
    let my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) {
      mx = n2[0];
      my = n2[1];
    } else {
      mx /= ml;
      my /= ml;
    }
    const cosHalf = mx * n2[0] + my * n2[1];
    out.push({ dir: [mx, my], miter: Math.min(limit, 1 / Math.max(1e-6, cosHalf)) });
  }
  return out;
}

/**
 * How far each vertex of a region's rings can move inward before it runs
 * into the far side: half the distance to the nearest edge not touching
 * the vertex, measured along the inset direction. Keeps deep bevels on
 * thin parts from folding over.
 */
export function insetLimits(rings, dirs) {
  const all = [];
  rings.forEach((r, ri) => r.forEach((_, i) => all.push([ri, i])));
  return rings.map((r, ri) =>
    r.map((p, i) => {
      const d = dirs[ri][i].dir;
      let best = Infinity;
      for (let rj = 0; rj < rings.length; rj++) {
        const q = rings[rj];
        for (let j = 0, n = q.length; j < n; j++) {
          if (rj === ri && (j === i || (j + 1) % n === i)) continue;
          const a = q[j];
          const b = q[(j + 1) % n];
          // Ray p + t*d against segment ab.
          const ex = b[0] - a[0];
          const ey = b[1] - a[1];
          const den = d[0] * ey - d[1] * ex;
          if (Math.abs(den) < 1e-12) continue;
          const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den;
          const u = ((a[0] - p[0]) * d[1] - (a[1] - p[1]) * d[0]) / den;
          if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
        }
      }
      return best / 2;
    }),
  );
}

// ---- Delaunay (Bowyer-Watson) ----

/**
 * Delaunay triangulation of points [[x, y], ...]. Returns index triples
 * wound clockwise on screen (positive area).
 */
export function delaunay(points) {
  const n = points.length;
  if (n < 3) return [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  const d = Math.max(x1 - x0, y1 - y0) || 1;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const pts = [...points, [mx - 20 * d, my - d], [mx, my + 20 * d], [mx + 20 * d, my - d]];
  const circum = (a, b, c) => {
    const A = pts[a];
    const B = pts[b];
    const C = pts[c];
    const D = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
    if (Math.abs(D) < 1e-18) return { x: 0, y: 0, r2: Infinity };
    const a2 = A[0] * A[0] + A[1] * A[1];
    const b2 = B[0] * B[0] + B[1] * B[1];
    const c2 = C[0] * C[0] + C[1] * C[1];
    const x = (a2 * (B[1] - C[1]) + b2 * (C[1] - A[1]) + c2 * (A[1] - B[1])) / D;
    const y = (a2 * (C[0] - B[0]) + b2 * (A[0] - C[0]) + c2 * (B[0] - A[0])) / D;
    return { x, y, r2: (A[0] - x) ** 2 + (A[1] - y) ** 2 };
  };
  let tris = [{ v: [n, n + 1, n + 2], c: circum(n, n + 1, n + 2) }];
  // Insert in a spatially coherent order (rows) for fewer bad triangles per step.
  const order = points.map((_, i) => i).sort((a, b) => points[a][1] - points[b][1] || points[a][0] - points[b][0]);
  for (const i of order) {
    const p = pts[i];
    const bad = [];
    const keep = [];
    for (const t of tris) {
      const dx = p[0] - t.c.x;
      const dy = p[1] - t.c.y;
      if (dx * dx + dy * dy < t.c.r2 * (1 + 1e-12)) bad.push(t);
      else keep.push(t);
    }
    const edges = new Map();
    for (const t of bad) {
      for (let k = 0; k < 3; k++) {
        const a = t.v[k];
        const b = t.v[(k + 1) % 3];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (edges.has(key)) edges.delete(key);
        else edges.set(key, [a, b]);
      }
    }
    for (const [a, b] of edges.values()) keep.push({ v: [a, b, i], c: circum(a, b, i) });
    tris = keep;
  }
  const out = [];
  for (const t of tris) {
    if (t.v.some((k) => k >= n)) continue;
    let [a, b, c] = t.v;
    if (cross2(points[a], points[b], points[c]) < 0) [b, c] = [c, b];
    if (Math.abs(cross2(points[a], points[b], points[c])) > 1e-12) out.push([a, b, c]);
  }
  return out;
}

/** Points along a ring spaced about `step` apart (keeps every original vertex). */
export function resampleRing(ring, step) {
  const out = [];
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    out.push(a);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.floor(len / step);
    for (let j = 1; j < k; j++) {
      const t = j / k;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}
