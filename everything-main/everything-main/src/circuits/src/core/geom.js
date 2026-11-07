// Plane geometry shared by the editors, hit testing, connectivity and export.
// Points are {x, y} objects or flat [x0, y0, x1, y1, ...] arrays. Angles are
// degrees, counter-clockwise, with +y up (the design coordinate system).

export const DEG = Math.PI / 180;

export const bboxEmpty = () => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

export function bboxAdd(b, x, y, pad = 0) {
  if (x - pad < b.minX) b.minX = x - pad;
  if (y - pad < b.minY) b.minY = y - pad;
  if (x + pad > b.maxX) b.maxX = x + pad;
  if (y + pad > b.maxY) b.maxY = y + pad;
  return b;
}

export function bboxUnion(a, b) {
  return {
    minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
  };
}

export const bboxValid = (b) => b && b.minX <= b.maxX && b.minY <= b.maxY;

export function bboxIntersects(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function bboxContains(outer, inner) {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

export function bboxInflate(b, d) {
  return { minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d };
}

export function bboxOfFlat(pts, pad = 0) {
  const b = bboxEmpty();
  for (let i = 0; i < pts.length; i += 2) bboxAdd(b, pts[i], pts[i + 1], pad);
  return b;
}

/** Rotates (x, y) by deg about the origin. Quarter turns are exact. */
export function rotate(x, y, deg) {
  const r = ((deg % 360) + 360) % 360;
  if (r === 0) return [x, y];
  if (r === 90) return [-y, x];
  if (r === 180) return [-x, -y];
  if (r === 270) return [y, -x];
  const c = Math.cos(r * DEG), s = Math.sin(r * DEG);
  return [x * c - y * s, x * s + y * c];
}

/**
 * Placement transform used by symbols and footprints: optionally mirror
 * across the local y axis (x -> -x), then rotate, then translate.
 */
export function makeTransform(tx, ty, rot = 0, mirror = false) {
  const r = ((rot % 360) + 360) % 360;
  let c, s;
  if (r === 0) { c = 1; s = 0; } else if (r === 90) { c = 0; s = 1; } else if (r === 180) { c = -1; s = 0; } else if (r === 270) { c = 0; s = -1; } else { c = Math.cos(r * DEG); s = Math.sin(r * DEG); }
  const m = mirror ? -1 : 1;
  // [a c e; b d f] applied to (x, y)
  return { a: c * m, b: s * m, c: -s, d: c, e: tx, f: ty, rot: r, mirror };
}

export function apply(t, x, y) {
  return [t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f];
}

/** Applies a transform to an angle (for arcs and pin directions). */
export function applyAngle(t, deg) {
  const a = t.mirror ? 180 - deg : deg;
  return norm360(a + t.rot);
}

export function invert(t) {
  const det = t.a * t.d - t.b * t.c;
  const a = t.d / det, b = -t.b / det, c = -t.c / det, d = t.a / det;
  return { a, b, c, d, e: -(a * t.e + c * t.f), f: -(b * t.e + d * t.f), rot: norm360(-t.rot), mirror: t.mirror };
}

export const norm360 = (deg) => ((deg % 360) + 360) % 360;

export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

/** Distance from point p to segment ab. */
export function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Closest point on segment ab to p, plus its parameter t. */
export function closestOnSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: ax + t * dx, y: ay + t * dy, t };
}

function orient(ax, ay, bx, by, cx, cy) {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function onSeg(ax, ay, bx, by, px, py) {
  return Math.min(ax, bx) <= px && px <= Math.max(ax, bx) && Math.min(ay, by) <= py && py <= Math.max(ay, by);
}

export function segsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const o1 = orient(ax, ay, bx, by, cx, cy), o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay), o4 = orient(cx, cy, dx, dy, bx, by);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSeg(ax, ay, bx, by, cx, cy)) return true;
  if (o2 === 0 && onSeg(ax, ay, bx, by, dx, dy)) return true;
  if (o3 === 0 && onSeg(cx, cy, dx, dy, ax, ay)) return true;
  if (o4 === 0 && onSeg(cx, cy, dx, dy, bx, by)) return true;
  return false;
}

export function distSegSeg(ax, ay, bx, by, cx, cy, dx, dy) {
  if (segsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    distPointSeg(ax, ay, cx, cy, dx, dy), distPointSeg(bx, by, cx, cy, dx, dy),
    distPointSeg(cx, cy, ax, ay, bx, by), distPointSeg(dx, dy, ax, ay, bx, by),
  );
}

/** Even-odd point in polygon test on a flat point array. */
export function pointInPoly(px, py, pts) {
  let inside = false;
  const n = pts.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Signed area (positive when counter-clockwise). */
export function polyArea(pts) {
  let a = 0;
  const n = pts.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) a += (pts[j] * pts[i + 1]) - (pts[i] * pts[j + 1]);
  return a / 2;
}

/** Distance from a point to a polygon's boundary (0 when inside if filled). */
export function distPointPoly(px, py, pts, filled = true) {
  if (filled && pointInPoly(px, py, pts)) return 0;
  let d = Infinity;
  const n = pts.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) d = Math.min(d, distPointSeg(px, py, pts[j], pts[j + 1], pts[i], pts[i + 1]));
  return d;
}

/** Corners of an oriented rectangle as a flat array (counter-clockwise). */
export function rectCorners(cx, cy, w, h, rot = 0) {
  const hw = w / 2, hh = h / 2;
  const out = [];
  for (const [x, y] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
    const [rx, ry] = rotate(x, y, rot);
    out.push(cx + rx, cy + ry);
  }
  return out;
}

/** Distance from p to a rounded/oriented rectangle (0 inside). */
export function distPointRect(px, py, cx, cy, w, h, rot = 0, radius = 0) {
  const [lx, ly] = rotate(px - cx, py - cy, -rot);
  const qx = Math.abs(lx) - (w / 2 - radius), qy = Math.abs(ly) - (h / 2 - radius);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.max(Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius, 0);
}

/** Is angle a (deg) inside the CCW sweep starting at a0 spanning sweep degrees? */
export function angleInSweep(a, a0, sweep) {
  if (sweep >= 360) return true;
  const d = norm360(a - a0);
  return d <= sweep + 1e-9;
}

export function distPointArc(px, py, cx, cy, r, a0, sweep) {
  const a = Math.atan2(py - cy, px - cx) / DEG;
  if (angleInSweep(a, a0, sweep)) return Math.abs(Math.hypot(px - cx, py - cy) - r);
  const e0x = cx + r * Math.cos(a0 * DEG), e0y = cy + r * Math.sin(a0 * DEG);
  const e1x = cx + r * Math.cos((a0 + sweep) * DEG), e1y = cy + r * Math.sin((a0 + sweep) * DEG);
  return Math.min(Math.hypot(px - e0x, py - e0y), Math.hypot(px - e1x, py - e1y));
}

/** Bounding box of an arc centerline. */
export function arcBBox(cx, cy, r, a0, sweep, pad = 0) {
  const b = bboxEmpty();
  bboxAdd(b, cx + r * Math.cos(a0 * DEG), cy + r * Math.sin(a0 * DEG), pad);
  bboxAdd(b, cx + r * Math.cos((a0 + sweep) * DEG), cy + r * Math.sin((a0 + sweep) * DEG), pad);
  for (let q = 0; q < 360; q += 90) if (angleInSweep(q, a0, sweep)) bboxAdd(b, cx + r * Math.cos(q * DEG), cy + r * Math.sin(q * DEG), pad);
  return b;
}

/** Splits an arc into a polyline with at most maxErr chord deviation. */
export function arcToPoints(cx, cy, r, a0, sweep, maxErr = 1000) {
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (2 * Math.acos(Math.max(-1, 1 - maxErr / Math.max(r, 1))) / DEG)));
  const n = Math.min(steps, 720);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + (sweep * i) / n) * DEG;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return out;
}

/** Circle approximated as a closed polygon (no repeated last point). */
export function circleToPoly(cx, cy, r, maxErr = 1000) {
  const pts = arcToPoints(cx, cy, r, 0, 360, maxErr);
  pts.length -= 2;
  return pts;
}

/**
 * Orthogonal and 45-degree routing helper: returns the corner point that joins
 * a to b with the requested corner style. 'any' returns null (straight line).
 * Styles: '90start' (horizontal/vertical first), '90end', '45start', '45end'.
 */
export function cornerPoint(ax, ay, bx, by, style) {
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 || dy === 0 || style === 'any') return null;
  switch (style) {
    case '90start': return Math.abs(dx) >= Math.abs(dy) ? [bx, ay] : [ax, by];
    case '90end': return Math.abs(dx) >= Math.abs(dy) ? [ax, by] : [bx, ay];
    case '45start': {
      const d = Math.min(Math.abs(dx), Math.abs(dy));
      return [ax + Math.sign(dx) * d, ay + Math.sign(dy) * d];
    }
    case '45end': {
      const d = Math.min(Math.abs(dx), Math.abs(dy));
      return [bx - Math.sign(dx) * d, by - Math.sign(dy) * d];
    }
    default: return null;
  }
}

/** Removes zero-length segments and merges collinear runs of a polyline. */
export function simplifyPolyline(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    const n = out.length;
    if (n >= 2 && out[n - 2] === x && out[n - 1] === y) continue;
    if (n >= 4) {
      const ax = out[n - 4], ay = out[n - 3], bx = out[n - 2], by = out[n - 1];
      const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      const dot = (bx - ax) * (x - bx) + (by - ay) * (y - by);
      if (cross === 0 && dot >= 0) { out[n - 2] = x; out[n - 1] = y; continue; }
    }
    out.push(x, y);
  }
  return out;
}
