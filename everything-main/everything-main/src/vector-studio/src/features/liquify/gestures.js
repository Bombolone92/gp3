/**
 * Gesture recognition for the Sketch Shape tool: a hand-drawn stroke
 * becomes a clean live shape (line, rectangle, ellipse or circle, regular
 * polygon, triangle) or a scribble, which the tool uses to merge, punch or
 * delete shapes. All measures are relative to the gesture's size, so the
 * recognizer behaves the same at any zoom.
 */
import { simplifyPolyline } from '../../model/bezier.js';

const DEG = 180 / Math.PI;

function bbox(pts) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function length(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return l;
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Turning angle in degrees at b for the path a -> b -> c (0 = straight). */
function turn(a, b, c) {
  const a1 = Math.atan2(b.y - a.y, b.x - a.x);
  const a2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = (a2 - a1) * DEG;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/** Snap an angle (degrees) to the nearest multiple of 90 when within `tol` degrees. */
function snapAngle(deg, tol = 10) {
  const r = Math.round(deg / 90) * 90;
  return Math.abs(deg - r) <= tol ? 0 : deg - r;
}

/** Number of sharp reversals (turns over 140 degrees) along a simplified stroke. */
export function reversals(pts, size) {
  const s = simplifyPolyline(pts, size * 0.04);
  let n = 0;
  for (let i = 1; i < s.length - 1; i++) if (Math.abs(turn(s[i - 1], s[i], s[i + 1])) > 140) n++;
  return n;
}

/**
 * Corners of a closed gesture: where the outline turns sharply, found on a
 * finely simplified copy (turns close together are merged into one corner).
 * Returns { corners, share } where share is the part of the total turning
 * that happens at corners: near 1 for polygons, low for smooth curves.
 */
function corners(pts, size) {
  const s = simplifyPolyline([...pts, pts[0]], size * 0.015);
  if (s.length > 2 && Math.hypot(s[0].x - s[s.length - 1].x, s[0].y - s[s.length - 1].y) < size * 0.05) s.pop();
  const n = s.length;
  if (n < 3) return { corners: [], share: 0 };
  const turns = s.map((p, i) => turn(s[(i - 1 + n) % n], p, s[(i + 1) % n]));
  // Net turning (about 360 degrees for a closed outline); hand jitter cancels out.
  const total = Math.max(300, Math.abs(turns.reduce((acc, t) => acc + t, 0)));
  // Group consecutive vertices closer than 8% of the size; a group is a corner when it turns over 40 degrees.
  const groups = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const prev = s[(i - 1 + n) % n];
    if (cur && Math.hypot(s[i].x - prev.x, s[i].y - prev.y) < size * 0.08) {
      cur.turn += turns[i];
      cur.pts.push(s[i]);
    } else {
      cur = { turn: turns[i], pts: [s[i]] };
      groups.push(cur);
    }
  }
  if (groups.length > 1) {
    const first = groups[0];
    const last = groups[groups.length - 1];
    if (Math.hypot(first.pts[0].x - last.pts[last.pts.length - 1].x, first.pts[0].y - last.pts[last.pts.length - 1].y) < size * 0.08) {
      first.turn += last.turn;
      first.pts.unshift(...last.pts);
      groups.pop();
    }
  }
  const sharp = groups.filter((g) => Math.abs(g.turn) > 40);
  const share = sharp.reduce((acc, g) => acc + Math.abs(g.turn), 0) / total;
  // The corner point of a group: where its two straight neighbors would meet, approximated by the sharpest vertex.
  const out = sharp.map((g) => {
    let best = g.pts[0];
    let bestT = -1;
    for (const p of g.pts) {
      const i = s.indexOf(p);
      if (Math.abs(turns[i]) > bestT) {
        bestT = Math.abs(turns[i]);
        best = p;
      }
    }
    return best;
  });
  return { corners: out, share };
}

/** How well the points fit the ellipse inscribed in their principal box: mean |r - 1|. */
function ellipseFit(pts) {
  const n = pts.length;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - cx) ** 2;
    syy += (p.y - cy) ** 2;
    sxy += (p.x - cx) * (p.y - cy);
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  const local = pts.map((p) => ({ x: (p.x - cx) * c - (p.y - cy) * s, y: (p.x - cx) * s + (p.y - cy) * c }));
  const b = bbox(local);
  const rx = Math.max(1e-6, b.w / 2);
  const ry = Math.max(1e-6, b.h / 2);
  const ox = b.x + rx;
  const oy = b.y + ry;
  let err = 0;
  for (const p of local) err += Math.abs(Math.hypot((p.x - ox) / rx, (p.y - oy) / ry) - 1);
  // Center of the fitted box back in document space.
  const cc = Math.cos(angle);
  const ss = Math.sin(angle);
  return { err: err / n, cx: cx + ox * cc - oy * ss, cy: cy + ox * ss + oy * cc, w: rx * 2, h: ry * 2, angle: angle * DEG };
}

/**
 * Recognize a stroke (array of { x, y } in document space). Returns
 *   { type: 'shape', shape, anchors?, closed }   a live shape (see model/shapes.js)
 *   { type: 'scribble' }                          a back-and-forth scribble
 *   null                                          not recognized
 */
export function recognizeGesture(points) {
  const pts = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 1e-6);
  if (pts.length < 2) return null;
  const b = bbox(pts);
  const size = Math.max(b.w, b.h);
  if (size < 1e-3) return null;
  const total = length(pts);
  const a = pts[0];
  const z = pts[pts.length - 1];
  const gap = Math.hypot(z.x - a.x, z.y - a.y);

  // A straight stroke is a line (snapped to 45 degree steps when close).
  const maxDev = Math.max(...pts.map((p) => distToSegment(p, a, z)));
  if (gap > total * 0.85 && maxDev < Math.max(gap * 0.08, 0.5)) {
    let ang = Math.atan2(z.y - a.y, z.x - a.x) * DEG;
    const snapped = Math.round(ang / 45) * 45;
    if (Math.abs(ang - snapped) < 6) ang = snapped;
    const r = (ang * Math.PI) / 180;
    const x2 = a.x + Math.cos(r) * gap;
    const y2 = a.y + Math.sin(r) * gap;
    return { type: 'shape', closed: false, shape: { kind: 'line', x1: a.x, y1: a.y, x2, y2 } };
  }

  // Scribbles reverse direction many times without closing into a shape.
  if (reversals(pts, size) >= 3 && total > size * 3) return { type: 'scribble' };

  // Closed shapes end near where they began.
  if (gap > size * 0.3) return null;
  const ring = pts.slice();
  const ell = ellipseFit(ring);
  const { corners: found, share } = corners(ring, size);
  // Smooth outlines (most turning spread along the curve) are not polygons.
  const cs = share > 0.7 ? found : [];

  if (cs.length === 4) {
    // Rectangles: four corners with roughly right angles.
    const right = cs.every((c, i) => {
      const t = Math.abs(turn(cs[(i + 3) % 4], c, cs[(i + 1) % 4]));
      return t > 60 && t < 120;
    });
    if (right) {
      const e0 = Math.atan2(cs[1].y - cs[0].y, cs[1].x - cs[0].x) * DEG;
      const angle = snapAngle(e0);
      const r = (-angle * Math.PI) / 180;
      const cx = cs.reduce((s, p) => s + p.x, 0) / 4;
      const cy = cs.reduce((s, p) => s + p.y, 0) / 4;
      const local = cs.map((p) => ({ x: (p.x - cx) * Math.cos(r) - (p.y - cy) * Math.sin(r), y: (p.x - cx) * Math.sin(r) + (p.y - cy) * Math.cos(r) }));
      const lb = bbox(local);
      let w = lb.w;
      let h = lb.h;
      if (Math.abs(w - h) < Math.max(w, h) * 0.1) w = h = (w + h) / 2;
      return { type: 'shape', closed: true, shape: { kind: 'rect', cx, cy, w, h, radii: [0, 0, 0, 0], angle } };
    }
  }
  if (cs.length === 3) {
    // Triangles keep their drawn corners.
    return { type: 'shape', closed: true, anchors: cs.map((p) => ({ x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y })) };
  }
  if (cs.length >= 5 && cs.length <= 8) {
    // Regular polygons: corners at similar distances from the center.
    const cx = cs.reduce((s, p) => s + p.x, 0) / cs.length;
    const cy = cs.reduce((s, p) => s + p.y, 0) / cs.length;
    const rs = cs.map((p) => Math.hypot(p.x - cx, p.y - cy));
    const rMean = rs.reduce((s, v) => s + v, 0) / rs.length;
    if (rs.every((v) => Math.abs(v - rMean) < rMean * 0.25)) {
      const first = Math.atan2(cs[0].y - cy, cs[0].x - cx) * DEG + 90;
      const step = 360 / cs.length;
      let angle = ((first % step) + step) % step;
      if (angle > step / 2) angle -= step;
      if (Math.abs(angle) < 8) angle = 0;
      return { type: 'shape', closed: true, shape: { kind: 'polygon', cx, cy, r: rMean, sides: cs.length, angle } };
    }
  }
  if (ell.err < 0.12) {
    let { w, h, angle } = ell;
    if (Math.abs(w - h) < Math.max(w, h) * 0.12) w = h = (w + h) / 2;
    angle = snapAngle(angle, 12);
    if (w === h) angle = 0;
    // An ellipse turned by 90 degrees is the same ellipse with its sides swapped.
    const turned = Math.abs(Math.round(ell.angle / 90) % 2) === 1 && angle === 0;
    return { type: 'shape', closed: true, shape: { kind: 'ellipse', cx: ell.cx, cy: ell.cy, w: turned ? h : w, h: turned ? w : h, angle } };
  }
  return null;
}
