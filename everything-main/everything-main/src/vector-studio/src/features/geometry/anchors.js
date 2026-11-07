/**
 * Anchor editing that keeps shape: Add Anchor Points (exact midpoints) and
 * Remove Anchor Points (refits one cubic across each run of removed anchors,
 * keeping the neighbors' tangent directions, least squares as in
 * Schneider's curve fitting).
 */
import { segmentPoints, segmentCount, pointAt, derivativeAt, insertAnchor, hasIn, hasOut, fitCurve } from '../../model/bezier.js';

/** Anchors with a midpoint added on every segment. */
export function addMidpoints(anchors, closed) {
  let out = anchors;
  const n = segmentCount(anchors, closed);
  // Insert from the end so indices stay valid.
  for (let i = n - 1; i >= 0; i--) out = insertAnchor(out, closed, i, 0.5);
  return out;
}

function unit(x, y) {
  const l = Math.hypot(x, y);
  return l > 1e-12 ? [x / l, y / l] : null;
}

/** Sample points along consecutive segments from anchor `from` to anchor `to` (indices, wrapping). */
function sampleChain(anchors, from, to, closed) {
  const n = anchors.length;
  const pts = [];
  let i = from;
  let guard = 0;
  while (i !== to && guard++ < n) {
    const c = segmentPoints(anchors, i);
    const k = 16;
    for (let s = pts.length ? 1 : 0; s <= k; s++) pts.push(pointAt(c, s / k));
    i = closed ? (i + 1) % n : i + 1;
  }
  return pts;
}

/**
 * Fit a cubic from p0 to p3 with tangent directions t1 (leaving p0) and t2
 * (arriving at p3, pointing back from p3) to sample points. Returns [c1, c2].
 */
export function fitWithTangents(pts, t1, t2) {
  const p0 = pts[0];
  const p3 = pts[pts.length - 1];
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  // Chord-length parameters, refined by Newton steps (Schneider).
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = u[u.length - 1] || 1;
  for (let i = 0; i < u.length; i++) u[i] /= total;
  let al = chord / 3;
  let ar = chord / 3;
  for (let iter = 0; iter < 6; iter++) {
    let c00 = 0;
    let c01 = 0;
    let c11 = 0;
    let x0 = 0;
    let x1 = 0;
    for (let i = 0; i < pts.length; i++) {
      const t = u[i];
      const mt = 1 - t;
      const b1 = 3 * t * mt * mt;
      const b2 = 3 * t * t * mt;
      const a1 = [t1[0] * b1, t1[1] * b1];
      const a2 = [t2[0] * b2, t2[1] * b2];
      c00 += a1[0] * a1[0] + a1[1] * a1[1];
      c01 += a1[0] * a2[0] + a1[1] * a2[1];
      c11 += a2[0] * a2[0] + a2[1] * a2[1];
      const b0 = mt * mt * mt + b1;
      const b3 = b2 + t * t * t;
      const tx = pts[i].x - (p0.x * b0 + p3.x * b3);
      const ty = pts[i].y - (p0.y * b0 + p3.y * b3);
      x0 += a1[0] * tx + a1[1] * ty;
      x1 += a2[0] * tx + a2[1] * ty;
    }
    const det = c00 * c11 - c01 * c01;
    al = det ? (x0 * c11 - x1 * c01) / det : 0;
    ar = det ? (c00 * x1 - c01 * x0) / det : 0;
    if (!(al > chord * 1e-6) || !(ar > chord * 1e-6) || al > chord * 3 || ar > chord * 3) {
      al = ar = chord / 3;
      break;
    }
    const c = [p0.x, p0.y, p0.x + t1[0] * al, p0.y + t1[1] * al, p3.x + t2[0] * ar, p3.y + t2[1] * ar, p3.x, p3.y];
    for (let i = 1; i < u.length - 1; i++) {
      const t = u[i];
      const p = pointAt(c, t);
      const d1 = derivativeAt(c, t);
      const mt = 1 - t;
      const d2x = 6 * mt * (c[4] - 2 * c[2] + c[0]) + 6 * t * (c[6] - 2 * c[4] + c[2]);
      const d2y = 6 * mt * (c[5] - 2 * c[3] + c[1]) + 6 * t * (c[7] - 2 * c[5] + c[3]);
      const fx = p.x - pts[i].x;
      const fy = p.y - pts[i].y;
      const den = d1.x * d1.x + d1.y * d1.y + fx * d2x + fy * d2y;
      if (den) u[i] = Math.min(1, Math.max(0, t - (fx * d1.x + fy * d1.y) / den));
    }
  }
  return [
    { x: p0.x + t1[0] * al, y: p0.y + t1[1] * al },
    { x: p3.x + t2[0] * ar, y: p3.y + t2[1] * ar },
  ];
}

/**
 * Remove anchors at `indices`, keeping the shape as well as possible.
 * Endpoints of open paths are kept. Returns new anchors, or null when too
 * few anchors would remain.
 */
export function removeAnchorsKeepingShape(anchors, closed, indices) {
  const n = anchors.length;
  const remove = new Set([...indices].filter((i) => i >= 0 && i < n && (closed || (i !== 0 && i !== n - 1))));
  if (!remove.size) return anchors;
  const kept = anchors.map((_, i) => i).filter((i) => !remove.has(i));
  if (kept.length < 2 || (closed && kept.length < 2)) return null;
  const out = kept.map((i) => ({ ...anchors[i] }));
  const m = kept.length;
  const pairs = closed ? m : m - 1;
  for (let k = 0; k < pairs; k++) {
    const a = kept[k];
    const b = kept[(k + 1) % m];
    const gap = closed ? (b - a + n) % n : b - a;
    if (gap <= 1) continue;
    const pts = sampleChain(anchors, a, b, closed);
    const A = anchors[a];
    const B = anchors[b];
    const t1 = (hasOut(A) && unit(A.ox - A.x, A.oy - A.y)) || unit(pts[1].x - A.x, pts[1].y - A.y) || [1, 0];
    const t2 = (hasIn(B) && unit(B.ix - B.x, B.iy - B.y)) || unit(pts[pts.length - 2].x - B.x, pts[pts.length - 2].y - B.y) || [-1, 0];
    const [c1, c2] = fitWithTangents(pts, t1, t2);
    out[k].ox = c1.x;
    out[k].oy = c1.y;
    const nb = out[(k + 1) % m];
    nb.ix = c2.x;
    nb.iy = c2.y;
  }
  return out;
}

/**
 * Smooth a polygonal subpath (no handles) for Simplify: split at corners
 * that turn more than `cornerDeg`, fit Beziers to each run within
 * `accuracy` (Schneider). Curve fitting on raw polylines gives poor results
 * otherwise, because a polyline has no curvature between its vertices.
 */
export function fitPolygon(anchors, closed, accuracy, cornerDeg = 30) {
  const n = anchors.length;
  if (n < 3) return anchors;
  const pts = anchors.map((a) => ({ x: a.x, y: a.y }));
  const turn = (i) => {
    const p = pts[(i - 1 + n) % n];
    const q = pts[i];
    const r = pts[(i + 1) % n];
    const a1 = Math.atan2(q.y - p.y, q.x - p.x);
    const a2 = Math.atan2(r.y - q.y, r.x - q.x);
    let d = Math.abs(a2 - a1);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return (d * 180) / Math.PI;
  };
  const corners = [];
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) if (turn(i) > cornerDeg) corners.push(i);
  // Runs between corners (closed paths wrap around).
  const runs = [];
  if (closed) {
    if (!corners.length) runs.push([...pts, pts[0]]);
    else {
      for (let k = 0; k < corners.length; k++) {
        const a = corners[k];
        const b = corners[(k + 1) % corners.length];
        const run = [];
        let i = a;
        do {
          run.push(pts[i]);
          i = (i + 1) % n;
        } while (i !== b);
        run.push(pts[b]);
        runs.push(run);
      }
    }
  } else {
    const cuts = [0, ...corners, n - 1];
    for (let k = 0; k + 1 < cuts.length; k++) runs.push(pts.slice(cuts[k], cuts[k + 1] + 1));
  }
  const out = [];
  for (const run of runs) {
    const fitted = run.length > 2 ? fitCurve(run, accuracy * accuracy) : run.map((p) => anchorAt(p));
    if (out.length) {
      const last = out[out.length - 1];
      last.ox = fitted[0].ox;
      last.oy = fitted[0].oy;
      out.push(...fitted.slice(1).map((a) => ({ ...a })));
    } else out.push(...fitted.map((a) => ({ ...a })));
  }
  if (closed && out.length > 1) {
    const last = out.pop();
    out[0] = { ...out[0], ix: last.ix, iy: last.iy };
  }
  return out;
}

function anchorAt(p) {
  return { x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y };
}
