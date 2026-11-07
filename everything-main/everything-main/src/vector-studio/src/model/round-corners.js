/**
 * Round Corners (live effect geometry): corner anchors whose two adjacent
 * segments are straight lines are replaced by a pair of anchors joined by a
 * circular-arc Bezier of the given radius (clamped so neighboring fillets
 * never overlap). Smooth points and curved corners are left as they are.
 * The effect is applied at render time; the stored anchors do not change.
 */
import { anchor, hasIn, hasOut } from './bezier.js';

export function roundCornerAnchors(anchors, closed, radius) {
  const n = anchors.length;
  if (!(radius > 0) || n < 3) return anchors;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = anchors[i];
    const isEnd = !closed && (i === 0 || i === n - 1);
    if (isEnd || hasIn(a) || hasOut(a)) {
      out.push(a);
      continue;
    }
    const p = anchors[(i - 1 + n) % n];
    const q = anchors[(i + 1) % n];
    // Both neighboring segments must be straight.
    if (hasOut(p) || hasIn(q)) {
      out.push(a);
      continue;
    }
    const v1x = p.x - a.x;
    const v1y = p.y - a.y;
    const v2x = q.x - a.x;
    const v2y = q.y - a.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-9 || l2 < 1e-9) {
      out.push(a);
      continue;
    }
    const u1x = v1x / l1;
    const u1y = v1y / l1;
    const u2x = v2x / l2;
    const u2y = v2y / l2;
    const cos = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
    const theta = Math.acos(cos); // interior angle between the two edges
    if (theta < 1e-3 || Math.PI - theta < 1e-3) {
      out.push(a);
      continue;
    }
    let d = radius / Math.tan(theta / 2);
    // Neighboring corners share each edge, so each may use at most half of it.
    d = Math.min(d, l1 / 2, l2 / 2);
    const r = d * Math.tan(theta / 2);
    const phi = Math.PI - theta; // turning angle of the arc
    const k = (4 / 3) * Math.tan(phi / 4) * r;
    const sx = a.x + u1x * d;
    const sy = a.y + u1y * d;
    const ex = a.x + u2x * d;
    const ey = a.y + u2y * d;
    out.push(anchor(sx, sy, sx, sy, sx - u1x * k, sy - u1y * k));
    out.push(anchor(ex, ey, ex - u2x * k, ey - u2y * k, ex, ey));
  }
  return out;
}

/** Radius of the visible Round Corners effects on a node (summed), or 0. */
export function roundCornersRadius(node) {
  let r = 0;
  for (const e of node.effects || []) if (!e.hidden && e.type === 'roundCorners') r += Math.max(0, e.radius || 0);
  return r;
}
