// Perspective Planes: geometry for editing flat surfaces seen in perspective.
// A plane is four image points (corners of a rectangle on the surface, in
// order: top-left, top-right, bottom-right, bottom-left as seen on the
// surface) and the homography from the unit square (u, v in 0..1) to them.
// Cloning, pasting and brushing go through plane coordinates so content keeps
// the surface's perspective.
import type { Mask8, RGBA8 } from '../types';
import { applyMat3, homography, mat3Invert, type Mat3 } from './warp';
import { sampleBilinear } from './sampling';

export type Vec2 = [number, number];
export type Quad = [Vec2, Vec2, Vec2, Vec2];
export type PlaneMap = { forward: Mat3; inverse: Mat3 };

const UNIT = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Homography from plane coordinates (unit square) to the image and back. */
export function planeHomography(quad: Quad): PlaneMap {
  const forward = homography(UNIT, quad.map(([x, y]) => ({ x, y })));
  const inverse = mat3Invert(forward);
  if (!inverse) throw new Error('degenerate plane');
  return { forward, inverse };
}
export function planeToImage(map: PlaneMap, u: number, v: number): Vec2 {
  const p = applyMat3(map.forward, u, v);
  return [p.x, p.y];
}
export function imageToPlane(map: PlaneMap, x: number, y: number): Vec2 {
  const p = applyMat3(map.inverse, x, y);
  return [p.x, p.y];
}
/** Plane coordinates (u, v) of an image point. */
export function planeCoords(quad: Quad, x: number, y: number): Vec2 {
  return imageToPlane(planeHomography(quad), x, y);
}

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
export function quadArea(q: Quad): number {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i],
      b = q[(i + 1) % 4];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
/** True for a convex, non-degenerate quad (either winding). */
export function validQuad(q: Quad, minArea = 4, minEdge = 1): boolean {
  if (q.length !== 4 || !q.every((p) => p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return false;
  if (Math.abs(quadArea(q)) < minArea) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i],
      b = q[(i + 1) % 4],
      c = q[(i + 2) % 4];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minEdge) return false;
    const z = cross(a, b, c);
    if (Math.abs(z) < 1e-9) return false;
    const s = Math.sign(z);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** Grid lines of a plane (u = i / cu and v = j / cv) as image-space segments. */
export function planeGrid(quad: Quad, cells: number | [number, number]): [Vec2, Vec2][] {
  const [cu, cv] = typeof cells === 'number' ? [cells, cells] : cells;
  const m = planeHomography(quad);
  const out: [Vec2, Vec2][] = [];
  for (let i = 0; i <= Math.max(1, Math.round(cu)); i++) {
    const u = i / Math.max(1, Math.round(cu));
    out.push([planeToImage(m, u, 0), planeToImage(m, u, 1)]);
  }
  for (let j = 0; j <= Math.max(1, Math.round(cv)); j++) {
    const v = j / Math.max(1, Math.round(cv));
    out.push([planeToImage(m, 0, v), planeToImage(m, 1, v)]);
  }
  return out;
}

// Edges: 0 top (corner 0 -> 1, v = 0), 1 right (u = 1), 2 bottom (v = 1), 3 left (u = 0).
export type PlaneEdge = 0 | 1 | 2 | 3;
/** Move one edge outward by `distance` plane units (1 = the plane's size in
 * that direction; negative shrinks), keeping the perspective. */
export function extendPlane(quad: Quad, edge: PlaneEdge, distance: number): Quad {
  const m = planeHomography(quad);
  let u0 = 0,
    u1 = 1,
    v0 = 0,
    v1 = 1;
  if (edge === 0) v0 = -distance;
  else if (edge === 1) u1 = 1 + distance;
  else if (edge === 2) v1 = 1 + distance;
  else u0 = -distance;
  const out = quad.map((p) => [p[0], p[1]]) as Quad;
  if (u1 - u0 < 1e-3 || v1 - v0 < 1e-3) return out;
  // Only the moved edge's corners change, so the others stay exact.
  const corners: Vec2[] = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
  for (const k of [edge, (edge + 1) % 4]) out[k] = planeToImage(m, corners[k][0], corners[k][1]);
  return out;
}
/** Move one edge so it passes through the plane line containing image point (x, y). */
export function extendPlaneTo(quad: Quad, edge: PlaneEdge, x: number, y: number): Quad {
  const [u, v] = planeCoords(quad, x, y);
  const d = edge === 0 ? -v : edge === 1 ? u - 1 : edge === 2 ? v - 1 : -u;
  return extendPlane(quad, edge, d);
}

function lineIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = [b[0] - a[0], b[1] - a[1]],
    s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  const scale = Math.hypot(r[0], r[1]) * Math.hypot(s[0], s[1]);
  if (Math.abs(den) < 1e-6 * scale) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

export type PlaneMetrics = {
  aspect: number; // width / height of the surface rectangle
  focal?: number; // focal length (pixels) implied by the vanishing points, if any
  vanishing: [Vec2 | null, Vec2 | null]; // of the u (top/bottom) and v (left/right) edge directions
};
/**
 * Estimated proportions of the surface rectangle. Assumes square pixels, a
 * principal point at `principal` (default: the quad's centroid; pass the
 * image center when known) and that the quad's edges are perpendicular on the
 * surface. With two finite vanishing points the focal length follows from
 * their orthogonality; otherwise `focal` (or a guess of 1.2x the quad's extent)
 * is used. With parallel opposite edges the ratio of edge lengths is exact.
 */
export function planeMetrics(quad: Quad, opts: { principal?: Vec2; focal?: number } = {}): PlaneMetrics {
  const vu = lineIntersection(quad[0], quad[1], quad[3], quad[2]);
  const vv = lineIntersection(quad[0], quad[3], quad[1], quad[2]);
  const avg = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) => (Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(d[0] - c[0], d[1] - c[1])) / 2;
  const fallback = avg(quad[0], quad[1], quad[3], quad[2]) / Math.max(1e-9, avg(quad[0], quad[3], quad[1], quad[2]));
  if (!vu && !vv) return { aspect: fallback, vanishing: [null, null] };
  const c: Vec2 = opts.principal ?? [(quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4, (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4];
  let f = opts.focal;
  if (!f && vu && vv) {
    const f2 = -((vu[0] - c[0]) * (vv[0] - c[0]) + (vu[1] - c[1]) * (vv[1] - c[1]));
    if (f2 > 0) f = Math.sqrt(f2);
  }
  if (!f) {
    const xs = quad.map((p) => p[0]),
      ys = quad.map((p) => p[1]);
    f = 1.2 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  }
  // H = K [w r1, h r2, t] up to scale: |K^-1 h1| / |K^-1 h2| = w / h.
  const H = planeHomography(quad).forward;
  const col = (k: number) => {
    const hx = H[k],
      hy = H[3 + k],
      hw = H[6 + k];
    return Math.hypot((hx - c[0] * hw) / f!, (hy - c[1] * hw) / f!, hw);
  };
  const aspect = col(0) / Math.max(1e-12, col(1));
  return { aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : fallback, focal: f, vanishing: [vu, vv] };
}

// Metric frame of a plane: plane coordinates scaled by the aspect so a unit
// is the same length in both directions, and normalized so one unit is about
// one image pixel at the quad's centroid. Planes therefore exchange content at
// matching scale near their centers.
type Metric = { map: PlaneMap; sx: number; sy: number };
function metricFrame(quad: Quad): Metric {
  const map = planeHomography(quad);
  const { aspect } = planeMetrics(quad);
  const [ju, jv] = jacobian(map, 0.5, 0.5);
  // Image pixels per plane unit along u and v at the center.
  const lu = Math.hypot(ju[0], ju[1]),
    lv = Math.hypot(jv[0], jv[1]);
  // Metric units per plane unit: aspect : 1, scaled to ~pixels.
  const k = Math.sqrt((lu * lv) / Math.max(1e-12, aspect));
  return { map, sx: k * aspect, sy: k };
}
function jacobian(map: PlaneMap, u: number, v: number): [Vec2, Vec2] {
  const h = 1e-4;
  const p = planeToImage(map, u, v),
    pu = planeToImage(map, u + h, v),
    pv = planeToImage(map, u, v + h);
  return [
    [(pu[0] - p[0]) / h, (pu[1] - p[1]) / h],
    [(pv[0] - p[0]) / h, (pv[1] - p[1]) / h],
  ];
}

/** For cloning: maps an image point near `dst` (on plane B) to the source
 * point near `src` (on plane A), offsetting in the planes' metric frames so
 * content shrinks and turns with the surfaces. */
export function cloneMapping(planeA: Quad, src: Vec2, planeB: Quad, dst: Vec2): (x: number, y: number) => Vec2 {
  const A = metricFrame(planeA),
    B = metricFrame(planeB);
  const [su, sv] = imageToPlane(A.map, src[0], src[1]);
  const [du, dv] = imageToPlane(B.map, dst[0], dst[1]);
  const ma: Vec2 = [su * A.sx, sv * A.sy],
    mb: Vec2 = [du * B.sx, dv * B.sy];
  return (x, y) => {
    const [u, v] = imageToPlane(B.map, x, y);
    const mx = u * B.sx - mb[0] + ma[0],
      my = v * B.sy - mb[1] + ma[1];
    return planeToImage(A.map, mx / A.sx, my / A.sy);
  };
}

/** Local ellipse of a round dab of diameter `size` (metric units, about
 * pixels at the plane's center) painted on the plane at image point (x, y):
 * radii in pixels and the major axis angle in radians. */
export function dabFootprint(quad: Quad, x: number, y: number, size: number): { rx: number; ry: number; angle: number } {
  const M = metricFrame(quad);
  const [u, v] = imageToPlane(M.map, x, y);
  const [ju, jv] = jacobian(M.map, u, v);
  // Image displacement per metric unit: J = [ju / sx, jv / sy] as columns.
  const a = ju[0] / M.sx,
    b = jv[0] / M.sy,
    c = ju[1] / M.sx,
    d = jv[1] / M.sy;
  // Singular values of [[a, b], [c, d]].
  const e = (a + d) / 2,
    f = (a - d) / 2,
    g = (c + b) / 2,
    h = (c - b) / 2;
  const q = Math.hypot(e, h),
    r = Math.hypot(f, g);
  const s1 = q + r,
    s2 = Math.abs(q - r);
  const angle = (Math.atan2(g, f) + Math.atan2(h, e)) / 2;
  const half = size / 2;
  return { rx: s1 * half, ry: s2 * half, angle };
}

export type PasteOptions = {
  opacity?: number; // 0..1
  rotation?: number; // degrees, about the plane's center in its metric frame
  fit?: 'fill' | 'contain';
};
/** Composite `srcImg` onto `dst` in place, mapped into the plane with
 * perspective; edges are antialiased by 4x4 supersampled coverage. */
export function pasteIntoPlane(srcImg: RGBA8, quad: Quad, dst: RGBA8, opts: PasteOptions = {}): RGBA8 {
  const map = planeHomography(quad);
  const opacity = Math.max(0, Math.min(1, opts.opacity ?? 1));
  const { aspect } = planeMetrics(quad, { principal: [dst.width / 2, dst.height / 2] });
  // Placement of the image in plane units: [u0, v0] + scale, centered.
  const imgAspect = srcImg.width / Math.max(1, srcImg.height);
  let pw = 1,
    ph = 1;
  if (opts.fit === 'contain') {
    if (imgAspect > aspect) ph = aspect / imgAspect;
    else pw = imgAspect / aspect;
  }
  const rot = ((opts.rotation ?? 0) * Math.PI) / 180,
    cos = Math.cos(rot),
    sin = Math.sin(rot);
  // Plane (u, v) -> image sample position, or null outside the placed image.
  const toSrc = (u: number, v: number): Vec2 | null => {
    // Rotate about the center in metric units (u scaled by aspect).
    let mx = (u - 0.5) * aspect,
      my = v - 0.5;
    if (rot) [mx, my] = [mx * cos + my * sin, -mx * sin + my * cos];
    const pu = mx / aspect / pw + 0.5,
      pv = my / ph + 0.5;
    if (pu < 0 || pv < 0 || pu > 1 || pv > 1) return null;
    return [pu * srcImg.width, pv * srcImg.height];
  };
  const xs = quad.map((p) => p[0]),
    ys = quad.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))),
    x1 = Math.min(dst.width - 1, Math.ceil(Math.max(...xs))),
    y0 = Math.max(0, Math.floor(Math.min(...ys))),
    y1 = Math.min(dst.height - 1, Math.ceil(Math.max(...ys)));
  const px = new Float32Array(4);
  const d = dst.data;
  const N = 4;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      let hits = 0;
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const [u, v] = imageToPlane(map, x + (i + 0.5) / N, y + (j + 0.5) / N);
          if (toSrc(u, v)) hits++;
        }
      if (!hits) continue;
      const [u, v] = imageToPlane(map, x + 0.5, y + 0.5);
      // Center outside: clamp to the image edge for the edge color.
      let s = toSrc(u, v);
      if (!s) s = toSrc(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v)));
      if (!s) continue;
      sampleBilinear(srcImg, s[0], s[1], 'clamp', px, 0);
      const a = (px[3] / 255) * opacity * (hits / (N * N));
      if (a <= 0) continue;
      const o = (y * dst.width + x) * 4;
      const ba = d[o + 3] / 255,
        oa = a + ba * (1 - a);
      for (let k = 0; k < 3; k++) d[o + k] = (px[k] * a + d[o + k] * ba * (1 - a)) / oa;
      d[o + 3] = oa * 255;
    }
  return dst;
}

/** Clone-stamp one dab: for every covered pixel of `mask` (placed with its
 * top-left at (maskX, maskY) in `dst`), sample `src` at `mapping` of the
 * pixel center and composite with coverage x opacity. Returns the number of
 * pixels written. */
export function perspectiveStamp(dst: RGBA8, src: RGBA8, mapping: (x: number, y: number) => Vec2, mask: Mask8, maskX: number, maskY: number, opacity = 1): number {
  const px = new Float32Array(4);
  const d = dst.data;
  let n = 0;
  for (let j = 0; j < mask.height; j++) {
    const y = maskY + j;
    if (y < 0 || y >= dst.height) continue;
    for (let i = 0; i < mask.width; i++) {
      const x = maskX + i;
      const cov = mask.data[j * mask.width + i];
      if (!cov || x < 0 || x >= dst.width) continue;
      const [sx, sy] = mapping(x + 0.5, y + 0.5);
      sampleBilinear(src, sx, sy, 'transparent', px, 0);
      const a = (px[3] / 255) * (cov / 255) * opacity;
      if (a <= 0) continue;
      const o = (y * dst.width + x) * 4;
      const ba = d[o + 3] / 255,
        oa = a + ba * (1 - a);
      for (let k = 0; k < 3; k++) d[o + k] = (px[k] * a + d[o + k] * ba * (1 - a)) / oa;
      d[o + 3] = oa * 255;
      n++;
    }
  }
  return n;
}

/** Round dab coverage as a mask centered at (x, y), shaped by the plane's
 * local footprint; returns the mask and its top-left. */
export function planeDab(quad: Quad, x: number, y: number, size: number, hardness = 0.8): { mask: Mask8; x: number; y: number } {
  const { rx, ry, angle } = dabFootprint(quad, x, y, size);
  const R = Math.ceil(Math.max(rx, ry)) + 1;
  const mx = Math.floor(x) - R,
    my = Math.floor(y) - R,
    w = 2 * R + 1;
  const data = new Uint8Array(w * w);
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const inner = Math.max(0, Math.min(0.999, hardness));
  for (let j = 0; j < w; j++)
    for (let i = 0; i < w; i++) {
      const dx = mx + i + 0.5 - x,
        dy = my + j + 0.5 - y;
      const a = (dx * c + dy * s) / Math.max(1e-6, rx),
        b = (-dx * s + dy * c) / Math.max(1e-6, ry);
      const r = Math.hypot(a, b);
      if (r >= 1) continue;
      const t = r <= inner ? 1 : 1 - (r - inner) / (1 - inner);
      data[j * w + i] = Math.round(255 * t);
    }
  return { mask: { width: w, height: w, data }, x: mx, y: my };
}
