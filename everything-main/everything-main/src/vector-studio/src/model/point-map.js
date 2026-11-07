/**
 * Mapping outlines through a point function (x, y) -> { x, y } while
 * keeping them smooth Bezier curves: Warp, Twist, Free Distort and
 * envelopes bend artwork this way.
 *
 * Each segment maps its end points exactly and its handles through the
 * function's local linear approximation (a numeric Jacobian), which keeps
 * tangents continuous wherever the source was smooth. A segment whose
 * mapped curve strays from the mapped points by more than the tolerance is
 * split in half and each half mapped again (adaptive subdivision), so
 * straight edges under a strong bend come out as a few well-fitted curves
 * instead of a polyline.
 */
import { segmentCount, segmentPoints, isLine, pointAt, split } from './bezier.js';

const MAX_DEPTH = 9;
const MAX_SEGMENTS = 20000;

/** Numeric Jacobian of f at (x, y) with step h: [dx/dx, dy/dx, dx/dy, dy/dy]. */
function jacobian(f, x, y, h) {
  const a = f(x + h, y);
  const b = f(x - h, y);
  const c = f(x, y + h);
  const d = f(x, y - h);
  return [(a.x - b.x) / (2 * h), (a.y - b.y) / (2 * h), (c.x - d.x) / (2 * h), (c.y - d.y) / (2 * h)];
}

/**
 * Map one cubic (8 numbers) through f, appending mapped cubics to `out`.
 * `ctx` carries { f, tol, h, budget }.
 */
function mapCubic(c, ctx, out, depth = 0) {
  const { f, tol, h } = ctx;
  // A straight segment's implied handles sit at its thirds.
  let c1x = c[2];
  let c1y = c[3];
  let c2x = c[4];
  let c2y = c[5];
  if (isLine(c)) {
    c1x = c[0] + (c[6] - c[0]) / 3;
    c1y = c[1] + (c[7] - c[1]) / 3;
    c2x = c[6] + (c[0] - c[6]) / 3;
    c2y = c[7] + (c[1] - c[7]) / 3;
  }
  const p0 = f(c[0], c[1]);
  const p3 = f(c[6], c[7]);
  const j0 = jacobian(f, c[0], c[1], h);
  const j3 = jacobian(f, c[6], c[7], h);
  const d0x = c1x - c[0];
  const d0y = c1y - c[1];
  const d3x = c2x - c[6];
  const d3y = c2y - c[7];
  const m = [p0.x, p0.y, p0.x + j0[0] * d0x + j0[2] * d0y, p0.y + j0[1] * d0x + j0[3] * d0y, p3.x + j3[0] * d3x + j3[2] * d3y, p3.y + j3[1] * d3x + j3[3] * d3y, p3.x, p3.y];
  if (depth < MAX_DEPTH && ctx.budget > 0) {
    const src = [c[0], c[1], c1x, c1y, c2x, c2y, c[6], c[7]];
    let err = 0;
    for (const t of [0.25, 0.5, 0.75]) {
      const s = pointAt(src, t);
      const want = f(s.x, s.y);
      const got = pointAt(m, t);
      err = Math.max(err, Math.hypot(want.x - got.x, want.y - got.y));
    }
    if (!(err <= tol)) {
      ctx.budget -= 1;
      const [l, r] = split(src, 0.5);
      mapCubic(l, ctx, out, depth + 1);
      mapCubic(r, ctx, out, depth + 1);
      return;
    }
  }
  out.push(m);
}

/** A mapped cubic whose handles lie on its chord is a straight line: retract them. */
function straight(m, tol) {
  const dx = m[6] - m[0];
  const dy = m[7] - m[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return false;
  const off = (x, y) => Math.abs((x - m[0]) * dy - (y - m[1]) * dx) / len;
  const along = (x, y) => ((x - m[0]) * dx + (y - m[1]) * dy) / (len * len);
  const t1 = along(m[2], m[3]);
  const t2 = along(m[4], m[5]);
  return off(m[2], m[3]) < tol && off(m[4], m[5]) < tol && t1 >= -1e-6 && t1 <= 1 + 1e-6 && t2 >= -1e-6 && t2 <= 1 + 1e-6 && t1 <= t2 + 1e-6;
}

/**
 * Map subpaths [{ anchors, closed, ... }] through f(x, y) -> { x, y }.
 * Options: tolerance (max deviation in document units, default 0.1),
 * step (Jacobian step; default scales with the outlines). Other subpath
 * fields (paint) are kept.
 */
export function mapSubpaths(subpaths, f, { tolerance = 0.1, step = null } = {}) {
  let size = 0;
  for (const s of subpaths) for (const a of s.anchors) size = Math.max(size, Math.abs(a.x), Math.abs(a.y));
  const ctx = { f, tol: Math.max(1e-4, tolerance), h: step || Math.max(1e-4, size * 1e-6), budget: MAX_SEGMENTS };
  return subpaths.map((s) => ({ ...s, anchors: mapAnchors(s.anchors, s.closed, ctx) }));
}

function mapAnchors(anchors, closed, ctx) {
  const n = anchors.length;
  if (!n) return [];
  const { f, h } = ctx;
  const first = anchors[0];
  const p = f(first.x, first.y);
  const out = [{ x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y }];
  if (n === 1) return out;
  // An open path's outer handles map through the local linear approximation.
  const handle = (a, hx, hy, target, kx, ky) => {
    if (hx === a.x && hy === a.y) return;
    const j = jacobian(f, a.x, a.y, h);
    const dx = hx - a.x;
    const dy = hy - a.y;
    target[kx] = target.x + j[0] * dx + j[2] * dy;
    target[ky] = target.y + j[1] * dx + j[3] * dy;
  };
  if (!closed) handle(first, first.ix, first.iy, out[0], 'ix', 'iy');
  const segs = segmentCount(anchors, closed);
  for (let i = 0; i < segs; i++) {
    const pieces = [];
    mapCubic(segmentPoints(anchors, i), ctx, pieces);
    const last = closed && i === segs - 1;
    for (let k = 0; k < pieces.length; k++) {
      const m = pieces[k];
      const line = straight(m, ctx.tol * 0.05);
      const prev = out[out.length - 1];
      if (!line) {
        prev.ox = m[2];
        prev.oy = m[3];
      }
      if (last && k === pieces.length - 1) {
        // The closing segment ends on the first anchor.
        if (!line) {
          out[0].ix = m[4];
          out[0].iy = m[5];
        }
      } else {
        const a = { x: m[6], y: m[7], ix: m[6], iy: m[7], ox: m[6], oy: m[7] };
        if (!line) {
          a.ix = m[4];
          a.iy = m[5];
        }
        out.push(a);
      }
    }
  }
  if (!closed) {
    const lastSrc = anchors[n - 1];
    handle(lastSrc, lastSrc.ox, lastSrc.oy, out[out.length - 1], 'ox', 'oy');
  }
  return out;
}
