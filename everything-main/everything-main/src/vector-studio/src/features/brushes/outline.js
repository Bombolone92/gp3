/**
 * Swept outlines: the filled shape a pen of varying size and shape leaves
 * along a spine. Variable-width strokes sweep a line whose two halves
 * follow the width profile; calligraphic brushes sweep an elliptical nib.
 *
 *   sweepOutline(spine, { offset, cap, join, miterLimit, range })
 *     offset(side, s, nx, ny) -> { x, y }   where the outline lies for the
 *                                          unit direction (nx, ny) at arc
 *                                          length s; side is 'l' or 'r'
 *
 * The two sides are offset sample by sample. Joins are added on the outer
 * side of corners (round sweeps the pen around the corner, miter extends
 * the edges up to the miter limit, bevel connects them); the inner side
 * and places where the width shrinks faster than the path bends leave
 * small reversed loops, which are cut out (a loop is only removed when its
 * orientation shows it is such a fold, so real holes, like the inside of a
 * curl, stay). Open spines and partial ranges (dashes) get caps.
 *
 * Returns rings: [{ pts: [{ x, y, corner }] }] closed polygons, filled with
 * the nonzero rule. fitRing() turns a ring into smooth Bezier anchors.
 */
import { fitCurve, anchor } from '../../model/bezier.js';

const CORNER_COS = Math.cos((3 * Math.PI) / 180);
const ARC_STEP = Math.PI / 18;

/** The spine's samples clipped to [a, b] as pieces of consecutive samples (wrapping on closed spines). */
function clipPieces(spine, a, b) {
  const pieces = [];
  const L = spine.length;
  const laps = spine.closed ? 2 : 1;
  for (let lap = 0; lap < laps; lap++) {
    const off = lap * L;
    for (const seg of spine.segs) {
      const s0 = seg[0].s + off;
      const s1 = seg[seg.length - 1].s + off;
      if (s1 <= a + 1e-9 || s0 >= b - 1e-9) continue;
      const out = [];
      for (let i = 0; i < seg.length; i++) {
        const p = seg[i];
        const s = p.s + off;
        if (s < a || s > b) {
          // Interpolated boundary samples.
          const q = seg[i + (s < a ? 1 : -1)];
          if (!q) continue;
          const qs = q.s + off;
          const edge = s < a ? a : b;
          if ((s < a && qs > a) || (s > b && qs < b)) {
            const f = (edge - s) / (qs - s);
            const pt = { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, s: edge, tx: p.tx + (q.tx - p.tx) * f, ty: p.ty + (q.ty - p.ty) * f };
            const l = Math.hypot(pt.tx, pt.ty) || 1;
            pt.tx /= l;
            pt.ty /= l;
            out.push(pt);
          }
          continue;
        }
        out.push({ ...p, s });
      }
      if (out.length >= 2) pieces.push(out);
    }
  }
  return pieces;
}

const add = (p, o) => ({ x: p.x + o.x, y: p.y + o.y });

/** Directions rotating from unit vector u to v the short way (excluding both ends). */
function arcDirs(u, v) {
  const a0 = Math.atan2(u.y, u.x);
  let d = Math.atan2(v.y, v.x) - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const n = Math.ceil(Math.abs(d) / ARC_STEP);
  const out = [];
  for (let i = 1; i < n; i++) {
    const a = a0 + (d * i) / n;
    out.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  return out;
}

/** Intersection of lines p + u*a and q + v*b: { x, y, a, b } or null when parallel. */
function lineHit(p, u, q, v) {
  const den = u.x * v.y - u.y * v.x;
  if (Math.abs(den) < 1e-12) return null;
  const a = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / den;
  const b = ((q.x - p.x) * u.y - (q.y - p.y) * u.x) / den;
  return { x: p.x + u.x * a, y: p.y + u.y * a, a, b };
}

function segHit(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-14) return null;
  const ex = p3.x - p1.x;
  const ey = p3.y - p1.y;
  const t = (ex * d2y - ey * d2x) / den;
  const u = (ex * d1y - ey * d1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + d1x * t, y: p1.y + d1y * t, t };
}

function loopArea(pts, i, j, x) {
  // Polygon x, pts[i+1..j], back to x (y-down shoelace).
  let area = 0;
  let px = x.x;
  let py = x.y;
  for (let k = i + 1; k <= j; k++) {
    area += px * pts[k].y - pts[k].x * py;
    px = pts[k].x;
    py = pts[k].y;
  }
  area += px * x.y - x.x * py;
  return area / 2;
}

/**
 * Cut reversed loops (folds) out of one side of an outline. `sign` is the
 * orientation of a fold on this side (-1 right side, +1 left side); `window`
 * limits how far along the spine a fold can reach.
 */
export function removeFolds(pts, sign, window) {
  let out = pts;
  for (let i = 0; i < out.length - 3; i++) {
    const p1 = out[i];
    const p2 = out[i + 1];
    let jEnd = i + 2;
    while (jEnd + 1 < out.length && out[jEnd + 1].s - p1.s <= window) jEnd++;
    for (let j = jEnd - 1; j >= i + 2; j--) {
      const x = segHit(p1, p2, out[j], out[j + 1]);
      if (!x) continue;
      const area = loopArea(out, i, j, x);
      if (area * sign <= 0) continue;
      const cut = { x: x.x, y: x.y, s: p1.s + (p2.s - p1.s) * x.t, corner: true };
      out = [...out.slice(0, i + 1), cut, ...out.slice(j + 1)];
      break;
    }
  }
  return out;
}

/**
 * The outline rings of a swept pen along `spine` over `range` ([a, b] in
 * arc length, default the whole spine).
 */
export function sweepOutline(spine, { offset, cap = 'butt', join = 'round', miterLimit = 4, range = null, maxWidth = 1 } = {}) {
  const L = spine.length;
  if (!(L > 0)) return [];
  const full = !range || (range[0] <= 1e-9 && range[1] >= L - 1e-9);
  let a = range ? range[0] : 0;
  let b = range ? range[1] : L;
  let ring = false;
  if (spine.closed && full) {
    // A closed spine starts mid-way along its first segment so no corner sits on the seam.
    const s0 = spine.segs[0];
    a = s0[Math.floor(s0.length / 2)].s;
    b = a + L;
    ring = true;
  }
  const pieces = clipPieces(spine, a, b);
  if (!pieces.length) return [];
  const left = [];
  const right = [];
  const wrap = (s) => (spine.closed && s >= L ? s - L : s);
  const offL = (p, n) => add(p, offset('l', wrap(p.s), n.x, n.y));
  const offR = (p, n) => add(p, offset('r', wrap(p.s), n.x, n.y));
  const sOf = (p) => p.s;
  for (let k = 0; k < pieces.length; k++) {
    const piece = pieces[k];
    if (k > 0) {
      // Join with the previous piece.
      const prev = pieces[k - 1][pieces[k - 1].length - 1];
      const cur = piece[0];
      const dot = prev.tx * cur.tx + prev.ty * cur.ty;
      if (dot < CORNER_COS) {
        const turn = prev.tx * cur.ty - prev.ty * cur.tx;
        const nIn = { x: prev.ty, y: -prev.tx };
        const nOut = { x: cur.ty, y: -cur.tx };
        const outerLeft = turn > 0;
        const side = outerLeft ? left : right;
        const sgn = outerLeft ? 1 : -1;
        const u = { x: nIn.x * sgn, y: nIn.y * sgn };
        const v = { x: nOut.x * sgn, y: nOut.y * sgn };
        const off = outerLeft ? offL : offR;
        const pIn = off(prev, u);
        const pOut = off(cur, v);
        if (join === 'round') {
          for (const d of arcDirs(u, v)) side.push({ ...off(cur, d), s: sOf(cur) });
        } else if (join === 'miter') {
          const hit = lineHit(pIn, { x: prev.tx, y: prev.ty }, pOut, { x: -cur.tx, y: -cur.ty });
          const half = Math.hypot(pIn.x - prev.x, pIn.y - prev.y);
          if (hit && hit.a >= 0 && hit.b >= 0 && Math.hypot(hit.x - cur.x, hit.y - cur.y) <= miterLimit * Math.max(half, 1e-9)) side.push({ x: hit.x, y: hit.y, s: sOf(cur), corner: true });
          else {
            if (side.length) side[side.length - 1].corner = true;
            side.push({ ...pOut, s: sOf(cur), corner: true });
          }
        } else {
          if (side.length) side[side.length - 1].corner = true;
          side.push({ ...pOut, s: sOf(cur), corner: true });
        }
      }
    }
    for (const p of piece) {
      const n = { x: p.ty, y: -p.tx };
      left.push({ ...offL(p, n), s: sOf(p) });
      right.push({ ...offR(p, { x: -n.x, y: -n.y }), s: sOf(p) });
    }
  }
  // A fold never spans a whole ring (the ring itself would read as one loop).
  const window = ring ? Math.min(Math.max(4, maxWidth * 40), L * 0.5) : Math.max(4, maxWidth * 40);
  let l = removeFolds(dedupe(left), 1, window);
  let r = removeFolds(dedupe(right), -1, window);
  if (ring) {
    l.pop();
    r.pop();
    return [{ pts: l }, { pts: r.reverse() }].filter((x) => x.pts.length > 2);
  }
  const first = pieces[0][0];
  const last = pieces[pieces.length - 1][pieces[pieces.length - 1].length - 1];
  const pts = [];
  const endCap = capPoints(last, 1, cap, offL, offR);
  const startCap = capPoints(first, -1, cap, offL, offR);
  if (cap !== 'round') {
    l[0].corner = l[l.length - 1].corner = true;
    r[0].corner = r[r.length - 1].corner = true;
  }
  pts.push(...l, ...endCap, ...r.reverse(), ...startCap);
  return [{ pts: dedupe(pts) }];
}

/**
 * Cap points between the two sides at a spine end. dir 1: the end (from
 * left to right around the forward tangent); -1: the start (from right to
 * left around the backward tangent).
 */
function capPoints(p, dir, cap, offL, offR) {
  if (cap === 'butt') return [];
  const t = { x: p.tx * dir, y: p.ty * dir };
  const nL = { x: p.ty, y: -p.tx };
  const from = dir > 0 ? nL : { x: -nL.x, y: -nL.y };
  const startOff = dir > 0 ? offL : offR;
  const endOff = dir > 0 ? offR : offL;
  if (cap === 'square') {
    const a = startOff(p, from);
    const b = endOff(p, { x: -from.x, y: -from.y });
    const wa = Math.hypot(a.x - p.x, a.y - p.y);
    const wb = Math.hypot(b.x - p.x, b.y - p.y);
    return [
      { x: a.x + t.x * wa, y: a.y + t.y * wa, corner: true },
      { x: b.x + t.x * wb, y: b.y + t.y * wb, corner: true },
    ];
  }
  const out = [];
  const n = 18;
  for (let i = 1; i < n; i++) {
    const phi = (Math.PI * i) / n;
    const d = { x: from.x * Math.cos(phi) + t.x * Math.sin(phi), y: from.y * Math.cos(phi) + t.y * Math.sin(phi) };
    const f = i / n;
    const a = startOff(p, d);
    const b = endOff(p, d);
    out.push({ x: a.x * (1 - f) + b.x * f, y: a.y * (1 - f) + b.y * f });
  }
  return out;
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q.x - p.x) < 1e-7 && Math.abs(q.y - p.y) < 1e-7) {
      if (p.corner) q.corner = true;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * Smooth anchors for a ring: runs between corner points are fitted with
 * Beziers (within `tol` document units), corners stay sharp.
 */
export function fitRing(pts, tol = 0.05) {
  const n = pts.length;
  if (n < 3) return pts.map((p) => anchor(p.x, p.y));
  let start = pts.findIndex((p) => p.corner);
  const rotated = start < 0 ? pts : [...pts.slice(start), ...pts.slice(0, start)];
  const ring = [...rotated, rotated[0]];
  const runs = [];
  let cur = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    cur.push(ring[i]);
    if (ring[i].corner || i === ring.length - 1) {
      runs.push(cur);
      cur = [ring[i]];
    }
  }
  const err = tol * tol;
  const out = [];
  for (const run of runs) {
    const fitted = run.length <= 2 ? run.map((p) => anchor(p.x, p.y)) : fitCurve(run, err);
    if (!fitted.length) continue;
    if (out.length) {
      const last = out[out.length - 1];
      out[out.length - 1] = { ...last, ox: fitted[0].ox, oy: fitted[0].oy };
      out.push(...fitted.slice(1));
    } else out.push(...fitted);
  }
  // The ring closes on its first point: merge the duplicate end.
  if (out.length > 1) {
    const last = out.pop();
    out[0] = { ...out[0], ix: last.ix, iy: last.iy };
  }
  return out;
}
