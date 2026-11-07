/**
 * Bending artwork along a path.
 *
 * warpAnchors(anchors, closed, f, step) maps an anchor list through a
 * smooth (possibly nonlinear) map f(x, y) -> { x, y }. Each segment is
 * split into pieces no longer than `step` along x (the direction the art
 * runs), then every piece's end points go through f and its handles go
 * through f's local linear approximation (Jacobian) at the end they leave
 * from. Pieces stay cubic, curves stay smooth where f is smooth, and a
 * straight edge across the path stays straight.
 */
import { segmentCount, segmentPoints, split } from '../../model/bezier.js';

/** Split a cubic into n equal-parameter pieces. */
function splitN(c, n) {
  const out = [];
  let rest = c;
  for (let k = 0; k < n - 1; k++) {
    const [a, b] = split(rest, 1 / (n - k));
    out.push(a);
    rest = b;
  }
  out.push(rest);
  return out;
}

/** Numeric Jacobian of f at (x, y): [dfx/dx, dfy/dx, dfx/dy, dfy/dy]. */
function jacobian(f, x, y, h) {
  const a = f(x + h, y);
  const b = f(x - h, y);
  const c = f(x, y + h);
  const d = f(x, y - h);
  return [(a.x - b.x) / (2 * h), (a.y - b.y) / (2 * h), (c.x - d.x) / (2 * h), (c.y - d.y) / (2 * h)];
}

function mapHandle(f, J, px, py, hx, hy, base) {
  const dx = hx - px;
  const dy = hy - py;
  return { x: base.x + J[0] * dx + J[2] * dy, y: base.y + J[1] * dx + J[3] * dy };
}

/**
 * Warp an anchor list. `step` is the longest piece along x before mapping
 * (in the art's units); `h` the finite-difference step.
 */
export function warpAnchors(anchors, closed, f, step = 4, h = 1e-3) {
  if (!anchors.length) return [];
  const n = segmentCount(anchors, closed);
  if (!n) {
    const p = f(anchors[0].x, anchors[0].y);
    return [{ x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y }];
  }
  const pieces = [];
  for (let i = 0; i < n; i++) {
    const c = segmentPoints(anchors, i);
    const extent = Math.max(c[0], c[2], c[4], c[6]) - Math.min(c[0], c[2], c[4], c[6]);
    const count = Math.max(1, Math.min(256, Math.ceil(extent / Math.max(step, 1e-6))));
    for (const pc of splitN(c, count)) {
      const p0 = f(pc[0], pc[1]);
      const p3 = f(pc[6], pc[7]);
      const p1 = mapHandle(f, jacobian(f, pc[0], pc[1], h), pc[0], pc[1], pc[2], pc[3], p0);
      const p2 = mapHandle(f, jacobian(f, pc[6], pc[7], h), pc[6], pc[7], pc[4], pc[5], p3);
      pieces.push([p0, p1, p2, p3]);
    }
  }
  const out = [];
  const first = pieces[0];
  out.push({ x: first[0].x, y: first[0].y, ix: first[0].x, iy: first[0].y, ox: first[1].x, oy: first[1].y });
  for (let k = 0; k < pieces.length; k++) {
    const pc = pieces[k];
    const next = pieces[k + 1];
    if (!next && closed) {
      out[0] = { ...out[0], ix: pc[2].x, iy: pc[2].y };
      break;
    }
    out.push({ x: pc[3].x, y: pc[3].y, ix: pc[2].x, iy: pc[2].y, ox: next ? next[1].x : pc[3].x, oy: next ? next[1].y : pc[3].y });
  }
  return out;
}
