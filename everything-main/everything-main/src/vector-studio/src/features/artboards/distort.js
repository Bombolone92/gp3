/**
 * Distortion math for Free Transform's Perspective Distort and Free
 * Distort: a projective map (homography) and a bilinear map from a
 * rectangle onto a quad. Quads list corners nw, ne, se, sw.
 */

/** 3x3 matrix (row-major array of 9) mapping the unit square onto a quad. */
function squareToQuad(q) {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  let g = 0;
  let h = 0;
  if (Math.abs(sx) > 1e-12 || Math.abs(sy) > 1e-12) {
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) > 1e-12) {
      g = (sx * dy2 - dx2 * sy) / den;
      h = (dx1 * sy - sx * dy1) / den;
    }
  }
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const c = p0.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  const f = p0.y;
  return [a, b, c, d, e, f, g, h, 1];
}

/** Projective map from rect r onto quad q: returns (x, y) => { x, y }. */
export function projectiveMap(r, q) {
  const m = squareToQuad(q);
  const w = r.w || 1e-9;
  const hgt = r.h || 1e-9;
  return (x, y) => {
    const u = (x - r.x) / w;
    const v = (y - r.y) / hgt;
    const z = m[6] * u + m[7] * v + m[8];
    return { x: (m[0] * u + m[1] * v + m[2]) / z, y: (m[3] * u + m[4] * v + m[5]) / z };
  };
}

/** Bilinear map from rect r onto quad q. */
export function bilinearMap(r, q) {
  const [p0, p1, p2, p3] = q;
  const w = r.w || 1e-9;
  const hgt = r.h || 1e-9;
  return (x, y) => {
    const u = (x - r.x) / w;
    const v = (y - r.y) / hgt;
    const a = (1 - u) * (1 - v);
    const b = u * (1 - v);
    const c = u * v;
    const d = (1 - u) * v;
    return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
  };
}

/** Corners of a rect as a quad. */
export function rectQuad(r) {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

/** Map every anchor and handle of an anchor list through fn. */
export function distortAnchors(anchors, fn) {
  return anchors.map((a) => {
    const p = fn(a.x, a.y);
    const i = fn(a.ix, a.iy);
    const o = fn(a.ox, a.oy);
    return { x: p.x, y: p.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y };
  });
}

/**
 * Perspective drag of corner `k` (0 nw, 1 ne, 2 se, 3 sw) of quad q0 by
 * (dx, dy): the dominant axis decides whether the horizontal or vertical
 * edge through the corner tapers; its partner corner mirrors the motion.
 */
export function perspectiveQuad(q0, k, dx, dy) {
  const q = q0.map((p) => ({ ...p }));
  if (Math.abs(dx) >= Math.abs(dy)) {
    // Move along x: the corner on the same horizontal edge mirrors.
    const partner = { 0: 1, 1: 0, 2: 3, 3: 2 }[k];
    q[k].x += dx;
    q[partner].x -= dx;
  } else {
    const partner = { 0: 3, 3: 0, 1: 2, 2: 1 }[k];
    q[k].y += dy;
    q[partner].y -= dy;
  }
  return q;
}
