// Pure geometry for transform sessions, canvas operations and the sizing
// dialogs. No DOM: everything here is unit tested in Node.
import type { IRect, Mask8, RGBA8 } from '../../imaging/types';
import { applyMat3, homography, mat3Invert, mat3Multiply, type Mat3, type Point } from '../../imaging/filters/warp';
import type { Interp } from '../../imaging/filters/sampling';
import { meshKnots, type MeshGrid } from '../../imaging/filters/mesh';

export type Quad = [Point, Point, Point, Point]; // top-left, top-right, bottom-right, bottom-left
export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const RAD = Math.PI / 180;

export const translate = (x: number, y: number): Mat3 => [1, 0, x, 0, 1, y, 0, 0, 1];
export const scaleM = (sx: number, sy: number): Mat3 => [sx, 0, 0, 0, sy, 0, 0, 0, 1];
export function rotateM(deg: number): Mat3 {
  const c = Math.cos(deg * RAD),
    s = Math.sin(deg * RAD);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
export const skewM = (kx: number, ky: number): Mat3 => [1, Math.tan(kx * RAD), 0, Math.tan(ky * RAD), 1, 0, 0, 0, 1];
/** Left-to-right composition: compose(a, b, c) applies c first, then b, then a. */
export function compose(...ms: Mat3[]): Mat3 {
  return ms.reduce((acc, m) => mat3Multiply(acc, m), IDENTITY);
}
/** `m` applied around a pivot point. */
export const about = (m: Mat3, px: number, py: number) => compose(translate(px, py), m, translate(-px, -py));

export function rectQuad(r: IRect): Quad {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}
export const mapQuad = (m: Mat3, q: Quad): Quad => q.map((p) => applyMat3(m, p.x, p.y)) as Quad;
/** Homography from a source rectangle (document space) onto a quad. */
export const rectToQuad = (r: IRect, q: Quad): Mat3 => homography(rectQuad(r), q);
export function quadBounds(q: Point[]): IRect {
  const xs = q.map((p) => p.x),
    ys = q.map((p) => p.y);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
/** A quad is affine when its opposite sides are parallel and equal. */
export function isParallelogram(q: Quad, eps = 1e-6) {
  const scale = Math.max(1, quadBounds(q).width, quadBounds(q).height);
  return Math.abs(q[0].x + q[2].x - q[1].x - q[3].x) < eps * scale && Math.abs(q[0].y + q[2].y - q[1].y - q[3].y) < eps * scale;
}
/** True for a rotated, scaled rectangle (no skew, no flip), which the GPU
 * compositor can draw directly from a layer transform. */
export function isRotatedRect(q: Quad, eps = 1e-6) {
  if (!isParallelogram(q, eps)) return false;
  const ax = q[1].x - q[0].x,
    ay = q[1].y - q[0].y,
    bx = q[3].x - q[0].x,
    by = q[3].y - q[0].y;
  const n = Math.hypot(ax, ay) * Math.hypot(bx, by);
  return n > 0 && Math.abs(ax * bx + ay * by) < eps * n && ax * by - ay * bx > 0;
}
/** Layer transform (center-rotated rectangle) of a rotated-rectangle quad. */
export function quadTransform(q: Quad) {
  const width = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y),
    height = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y);
  const cx = (q[0].x + q[2].x) / 2,
    cy = (q[0].y + q[2].y) / 2;
  const rotation = Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x) / RAD;
  return { x: cx - width / 2, y: cy - height / 2, width, height, rotation };
}
/** Corners of a layer transform (x, y, width, height, rotation about the center). */
export function transformQuad(t: { x: number; y: number; width: number; height: number; rotation: number }): Quad {
  return mapQuad(about(rotateM(t.rotation), t.x + t.width / 2, t.y + t.height / 2), rectQuad(t));
}

// ----- Affine parameters (options bar fields) -----
export type AffineParams = {
  // Document position of the reference point after the transform.
  x: number;
  y: number;
  // Scale factors (1 = 100 %), rotation and skew in degrees.
  sx: number;
  sy: number;
  rotation: number;
  skewX: number;
  skewY: number;
};
export const identityParams = (r: IRect, ref: Point): AffineParams => ({
  x: r.x + ref.x * r.width,
  y: r.y + ref.y * r.height,
  sx: 1,
  sy: 1,
  rotation: 0,
  skewX: 0,
  skewY: 0,
});
/** Document-space affine matrix: scale, then skew, then rotate around the
 * reference point (`ref` in 0..1 of the source rectangle), then move it to (x, y). */
export function affineFromParams(r: IRect, ref: Point, p: AffineParams): Mat3 {
  const rx = r.x + ref.x * r.width,
    ry = r.y + ref.y * r.height;
  return compose(translate(p.x, p.y), rotateM(p.rotation), skewM(p.skewX, p.skewY), scaleM(p.sx, p.sy), translate(-rx, -ry));
}
/** Inverse of `affineFromParams` for an affine matrix, using the QR split
 * L = R(θ)·[[1, tan kx], [0, 1]]·diag(sx, sy) (vertical skew comes out as 0). */
export function paramsFromAffine(m: Mat3, r: IRect, ref: Point): AffineParams {
  const [a, b, , c, d] = m;
  const rotation = Math.atan2(c, a) / RAD;
  const sx = Math.hypot(a, c);
  const cs = Math.cos(rotation * RAD),
    sn = Math.sin(rotation * RAD);
  const b2 = cs * b + sn * d,
    d2 = -sn * b + cs * d;
  const sy = d2;
  const skewX = Math.abs(sy) > 1e-12 ? Math.atan(b2 / sy) / RAD : 0;
  const p = applyMat3(m, r.x + ref.x * r.width, r.y + ref.y * r.height);
  return { x: p.x, y: p.y, sx, sy, rotation, skewX, skewY: 0 };
}
/** Affine map that best describes a quad: exact for parallelograms, taken from
 * the top-left, top-right and bottom-left corners otherwise. */
export function quadAffine(r: IRect, q: Quad): Mat3 {
  const a = (q[1].x - q[0].x) / r.width,
    c = (q[1].y - q[0].y) / r.width,
    b = (q[3].x - q[0].x) / r.height,
    d = (q[3].y - q[0].y) / r.height;
  return [a, b, q[0].x - a * r.x - b * r.y, c, d, q[0].y - c * r.x - d * r.y, 0, 0, 1];
}

// ----- Handle edits on quads -----
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const handleUV: Record<Handle, Point> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};
const cornerIndex: Partial<Record<Handle, number>> = { nw: 0, ne: 1, se: 2, sw: 3 };
const edgeCorners: Partial<Record<Handle, [number, number]>> = { n: [0, 1], e: [1, 2], s: [2, 3], w: [3, 0] };
export const isCorner = (h: Handle) => h in cornerIndex;
/** Point on the quad surface at (u, v) through its homography. */
export function quadPoint(r: IRect, q: Quad, u: number, v: number): Point {
  return applyMat3(rectToQuad(r, q), r.x + u * r.width, r.y + v * r.height);
}
/** Scale in the quad's own frame: `start` and `current` are pointer positions,
 * the opposite handle (or `pivot` in 0..1, for Alt) stays fixed. */
export function scaleQuad(r: IRect, q: Quad, handle: Handle, start: Point, current: Point, proportional: boolean, pivot?: Point): Quad {
  const H = rectToQuad(r, q),
    inv = mat3Invert(H);
  if (!inv) return q;
  const h = handleUV[handle];
  const anchorUV = pivot ?? { x: 1 - h.x, y: 1 - h.y };
  const toLocal = (p: Point) => applyMat3(inv, p.x, p.y);
  const s0 = toLocal(start),
    s1 = toLocal(current);
  const ax = r.x + anchorUV.x * r.width,
    ay = r.y + anchorUV.y * r.height;
  const hx = r.x + h.x * r.width,
    hy = r.y + h.y * r.height;
  // Offset of the grab point from the handle, kept while dragging.
  const gx = hx + (s1.x - s0.x),
    gy = hy + (s1.y - s0.y);
  let fx = h.x === anchorUV.x ? 1 : (gx - ax) / (hx - ax),
    fy = h.y === anchorUV.y ? 1 : (gy - ay) / (hy - ay);
  if (handle === 'n' || handle === 's') fx = proportional ? fy : 1;
  else if (handle === 'e' || handle === 'w') fy = proportional ? fx : 1;
  else if (proportional) {
    const f = Math.abs(fx - 1) >= Math.abs(fy - 1) ? fx : fy;
    fx = Math.sign(fx || 1) * Math.abs(f);
    fy = Math.sign(fy || 1) * Math.abs(f);
  }
  const min = 1 / Math.max(r.width, r.height);
  if (Math.abs(fx) < min) fx = Math.sign(fx || 1) * min;
  if (Math.abs(fy) < min) fy = Math.sign(fy || 1) * min;
  return mapQuad(compose(H, about(scaleM(fx, fy), ax, ay)), rectQuad(r));
}
/** Free corner move (distort); an edge handle moves both of its corners. */
export function distortQuad(q: Quad, handle: Handle, delta: Point): Quad {
  const out = q.map((p) => ({ ...p })) as Quad;
  const ids = cornerIndex[handle] !== undefined ? [cornerIndex[handle]!] : edgeCorners[handle]!;
  for (const i of ids) {
    out[i].x += delta.x;
    out[i].y += delta.y;
  }
  return out;
}
/** Skew: an edge slides along its own direction; a corner slides along
 * whichever of its two edges is closer to the drag direction. */
export function skewQuad(q: Quad, handle: Handle, delta: Point): Quad {
  const out = q.map((p) => ({ ...p })) as Quad;
  const along = (i: number, j: number) => {
    const dx = q[j].x - q[i].x,
      dy = q[j].y - q[i].y,
      n = Math.hypot(dx, dy) || 1;
    return { x: dx / n, y: dy / n };
  };
  const project = (d: Point) => delta.x * d.x + delta.y * d.y;
  const e = edgeCorners[handle];
  if (e) {
    const d = along(e[0], e[1]),
      t = project(d);
    for (const i of e) {
      out[i].x += d.x * t;
      out[i].y += d.y * t;
    }
    return out;
  }
  const i = cornerIndex[handle]!;
  const horizontal = along(i, i ^ 1),
    vertical = along(i, 3 - i);
  const th = project(horizontal),
    tv = project(vertical);
  const d = Math.abs(th) >= Math.abs(tv) ? horizontal : vertical,
    t = Math.abs(th) >= Math.abs(tv) ? th : tv;
  out[i].x += d.x * t;
  out[i].y += d.y * t;
  return out;
}
/** Perspective: a corner moves along an edge and the other corner of that
 * edge moves the opposite way, keeping the shape symmetric (keystone). */
export function perspectiveQuad(q: Quad, handle: Handle, delta: Point): Quad {
  const i = cornerIndex[handle];
  if (i === undefined) return skewQuad(q, handle, delta);
  const out = q.map((p) => ({ ...p })) as Quad;
  // Horizontal partner shares the top or bottom edge; vertical shares a side.
  const hp = i ^ 1,
    vp = 3 - i;
  const unit = (j: number) => {
    const dx = q[j].x - q[i].x,
      dy = q[j].y - q[i].y,
      n = Math.hypot(dx, dy) || 1;
    return { x: -dx / n, y: -dy / n };
  };
  const hu = unit(hp),
    vu = unit(vp);
  const th = delta.x * hu.x + delta.y * hu.y,
    tv = delta.x * vu.x + delta.y * vu.y;
  const [partner, u, t] = Math.abs(th) >= Math.abs(tv) ? [hp, hu, th] : [vp, vu, tv];
  out[i].x += u.x * t;
  out[i].y += u.y * t;
  out[partner].x -= u.x * t;
  out[partner].y -= u.y * t;
  return out;
}
/** Convex, non-degenerate quads keep a valid homography. */
export function quadValid(q: Quad) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i],
      b = q[(i + 1) % 4],
      c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}

// ----- Mesh helpers -----
export function mapMesh(m: Mat3, g: MeshGrid): MeshGrid {
  const points = new Float64Array(g.points.length);
  for (let k = 0; k < points.length; k += 2) {
    const p = applyMat3(m, g.points[k], g.points[k + 1]);
    points[k] = p.x;
    points[k + 1] = p.y;
  }
  return { ...g, points };
}
export function cloneMesh(g: MeshGrid): MeshGrid {
  return { ...g, points: new Float64Array(g.points) };
}
export function meshCorners(g: MeshGrid): Quad {
  const P = g.points,
    C = g.cols,
    R = g.rows;
  const at = (i: number, j: number) => ({ x: P[(j * C + i) * 2], y: P[(j * C + i) * 2 + 1] });
  return [at(0, 0), at(C - 1, 0), at(C - 1, R - 1), at(0, R - 1)];
}
const bern = (t: number) => {
  const s = 1 - t;
  return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
};
/** Drag the surface of a single 4x4 Bezier patch so the point at (u, v)
 * follows `delta` exactly, spreading the motion by basis weight (the
 * minimum-norm control point change). */
export function dragBezierSurface(g: MeshGrid, u: number, v: number, delta: Point): MeshGrid {
  const out = cloneMesh(g);
  if (g.cols !== 4 || g.rows !== 4) return out;
  const bu = bern(u),
    bv = bern(v);
  let sum = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) sum += (bu[i] * bv[j]) ** 2;
  if (sum <= 0) return out;
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      const w = (bu[i] * bv[j]) / sum,
        k = (j * 4 + i) * 2;
      out.points[k] += w * delta.x;
      out.points[k + 1] += w * delta.y;
    }
  return out;
}
/** Points that follow a control point: a Bezier corner drags its two handles
 * and the inner point next to it, like a path anchor. */
export function meshDragGroup(g: MeshGrid, index: number): number[] {
  const C = g.cols,
    R = g.rows,
    i = index % C,
    j = Math.floor(index / C);
  const bezier = (g.mode ?? ((C - 1) % 3 === 0 && (R - 1) % 3 === 0 ? 'bezier' : 'smooth')) === 'bezier';
  if (!bezier || i % 3 || j % 3) return [index];
  const list = [index];
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const ni = i + di,
      nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= C || nj >= R) continue;
    if (ni % 3 === 0 && nj % 3 === 0) continue;
    list.push(nj * C + ni);
  }
  return list;
}

// ----- Warp splits and anchors -----
const isBezier = (g: MeshGrid) => (g.mode ?? ((g.cols - 1) % 3 === 0 && (g.rows - 1) % 3 === 0 ? 'bezier' : 'smooth')) === 'bezier';
/** Whether a grid is made of Bezier patches (the kind splits work on). */
export const bezierMesh = isBezier;
/** Split a Bezier warp along `axis` at the source position t (0..1): 'u'
 * adds a vertical split line (a new column of patches), 'v' a horizontal
 * one. The surface keeps its exact shape (de Casteljau subdivision). Returns
 * undefined when t is on an existing split or edge. */
export function splitMesh(g: MeshGrid, axis: 'u' | 'v', t: number): MeshGrid | undefined {
  if (!isBezier(g)) return;
  const knots = meshKnots(g, axis);
  const n = knots.length - 1;
  let i = 0;
  while (i < n - 1 && t >= knots[i + 1]) i++;
  const span = knots[i + 1] - knots[i];
  const f = (t - knots[i]) / span;
  if (!(f > 1e-3 && f < 1 - 1e-3)) return;
  const C = g.cols,
    R = g.rows,
    P = g.points;
  // Work on lines across the split: columns for 'v', rows for 'u'.
  const lines = axis === 'v' ? C : R,
    len = axis === 'v' ? R : C;
  const at = (line: number, k: number) => (axis === 'v' ? k * C + line : line * C + k) * 2;
  const OC = axis === 'v' ? C : C + 3,
    OR = axis === 'v' ? R + 3 : R;
  const out = new Float64Array(OC * OR * 2);
  const put = (line: number, k: number, x: number, y: number) => {
    const o = (axis === 'v' ? k * OC + line : line * OC + k) * 2;
    out[o] = x;
    out[o + 1] = y;
  };
  const s0 = i * 3;
  for (let line = 0; line < lines; line++) {
    for (let k = 0; k < len; k++) {
      if (k > s0 && k < s0 + 3) continue;
      const o = at(line, k);
      put(line, k <= s0 ? k : k + 3, P[o], P[o + 1]);
    }
    // de Casteljau on the four control points of the split patch.
    const c = [0, 1, 2, 3].map((j) => [P[at(line, s0 + j)], P[at(line, s0 + j) + 1]]);
    const lerp = (a: number[], b: number[]) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    const q1 = lerp(c[0], c[1]),
      m12 = lerp(c[1], c[2]),
      r2 = lerp(c[2], c[3]);
    const q2 = lerp(q1, m12),
      r1 = lerp(m12, r2);
    const mid = lerp(q2, r1);
    for (const [k, p] of [[s0 + 1, q1], [s0 + 2, q2], [s0 + 3, mid], [s0 + 4, r1], [s0 + 5, r2]] as [number, number[]][]) put(line, k, p[0], p[1]);
  }
  const nk = [...knots.slice(0, i + 1), t, ...knots.slice(i + 1)];
  return { ...g, cols: OC, rows: OR, points: out, mode: 'bezier', ...(axis === 'u' ? { uKnots: nk } : { vKnots: nk }) };
}
/** Merge the two patches on either side of split line `k` (an interior knot
 * index). Undoes a split exactly when the patches were not edited since. */
export function removeSplit(g: MeshGrid, axis: 'u' | 'v', k: number): MeshGrid | undefined {
  const knots = meshKnots(g, axis);
  if (!isBezier(g) || k <= 0 || k >= knots.length - 1) return;
  const f = (knots[k] - knots[k - 1]) / (knots[k + 1] - knots[k - 1]);
  const C = g.cols,
    R = g.rows,
    P = g.points;
  const lines = axis === 'v' ? C : R,
    len = axis === 'v' ? R : C;
  const at = (line: number, j: number) => (axis === 'v' ? j * C + line : line * C + j) * 2;
  const OC = axis === 'v' ? C : C - 3,
    OR = axis === 'v' ? R - 3 : R;
  const out = new Float64Array(OC * OR * 2);
  const put = (line: number, j: number, x: number, y: number) => {
    const o = (axis === 'v' ? j * OC + line : line * OC + j) * 2;
    out[o] = x;
    out[o + 1] = y;
  };
  const a = (k - 1) * 3,
    b = (k + 1) * 3;
  for (let line = 0; line < lines; line++) {
    for (let j = 0; j < len; j++) {
      if (j > a && j < b) continue;
      const o = at(line, j);
      put(line, j < b ? j : j - 3, P[o], P[o + 1]);
    }
    // Recover the merged curve's handles from the outer handles of the halves.
    const p0 = [P[at(line, a)], P[at(line, a) + 1]],
      q1 = [P[at(line, a + 1)], P[at(line, a + 1) + 1]],
      r2 = [P[at(line, b - 1)], P[at(line, b - 1) + 1]],
      p3 = [P[at(line, b)], P[at(line, b) + 1]];
    put(line, a + 1, p0[0] + (q1[0] - p0[0]) / f, p0[1] + (q1[1] - p0[1]) / f);
    put(line, a + 2, (r2[0] - f * p3[0]) / (1 - f), (r2[1] - f * p3[1]) / (1 - f));
  }
  const nk = knots.filter((_, i) => i !== k);
  return { ...g, cols: OC, rows: OR, points: out, ...(axis === 'u' ? { uKnots: nk } : { vKnots: nk }) };
}
/** For a handle point of a Bezier grid, its anchor and the handle on the
 * other side of that anchor along the same curve (when there is one). */
export function handlePartner(g: MeshGrid, index: number): { anchor: number; opposite?: number } | undefined {
  if (!isBezier(g)) return;
  const C = g.cols,
    R = g.rows,
    i = index % C,
    j = Math.floor(index / C);
  const ri = i % 3,
    rj = j % 3;
  if ((ri === 0) === (rj === 0)) return; // anchors and inner points
  if (ri) {
    const ai = ri === 1 ? i - 1 : i + 1,
      oi = ri === 1 ? ai - 1 : ai + 1;
    return { anchor: j * C + ai, opposite: oi >= 0 && oi < C ? j * C + oi : undefined };
  }
  const aj = rj === 1 ? j - 1 : j + 1,
    oj = rj === 1 ? aj - 1 : aj + 1;
  return { anchor: aj * C + i, opposite: oj >= 0 && oj < R ? oj * C + i : undefined };
}
/** Whether an anchor of a Bezier grid has handles on both sides along some
 * curve (it sits on a split line), so it can be smooth or a corner. */
export function convertibleAnchor(g: MeshGrid, index: number) {
  if (!isBezier(g)) return false;
  const C = g.cols,
    i = index % C,
    j = Math.floor(index / C);
  if (i % 3 || j % 3) return false;
  return (i > 0 && i < C - 1) || (j > 0 && j < g.rows - 1);
}

// ----- Interpolation -----
export type InterpolationChoice = 'nearest' | 'bilinear' | 'bicubic' | 'bicubic-smoother' | 'bicubic-sharper';
export const INTERPOLATIONS: [InterpolationChoice, string][] = [
  ['nearest', 'Nearest Neighbor'],
  ['bilinear', 'Bilinear'],
  ['bicubic', 'Bicubic'],
  ['bicubic-smoother', 'Bicubic Smoother'],
  ['bicubic-sharper', 'Bicubic Sharper'],
];
/** Point samplers available to projective and mesh warps: Mitchell is the
 * smooth cubic, Lanczos-3 the crisp one. */
export function samplerInterp(choice: string | undefined): Interp {
  switch (choice) {
    case 'nearest':
      return 'nearest';
    case 'bilinear':
      return 'bilinear';
    case 'bicubic-smoother':
      return 'mitchell';
    case 'bicubic-sharper':
      return 'lanczos';
    default:
      return 'bicubic';
  }
}

// ----- Exact pixel rearrangements -----
/** Rotate by quarter turns clockwise (k mod 4), without resampling. */
export function rotate90<T extends RGBA8 | Mask8>(img: T, k: number): T {
  k = ((k % 4) + 4) % 4;
  const w = img.width,
    h = img.height;
  const ch = img.data.length / (w * h);
  const ow = k % 2 ? h : w,
    oh = k % 2 ? w : h;
  if (ch === 4) {
    const out = new Uint8ClampedArray(w * h * 4);
    const src = new Uint32Array(img.data.buffer, img.data.byteOffset, w * h),
      dst = new Uint32Array(out.buffer);
    rearrange(src, dst, w, h, ow, k);
    return { width: ow, height: oh, data: out } as T;
  }
  const out = new Uint8Array(w * h);
  rearrange(img.data as Uint8Array, out, w, h, ow, k);
  return { width: ow, height: oh, data: out } as T;
}
function rearrange(src: ArrayLike<number>, dst: { [i: number]: number }, w: number, h: number, ow: number, k: number) {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      // Destination of source (x, y) for k clockwise quarter turns.
      const dx = k === 0 ? x : k === 1 ? h - 1 - y : k === 2 ? w - 1 - x : y;
      const dy = k === 0 ? y : k === 1 ? x : k === 2 ? h - 1 - y : w - 1 - x;
      dst[dy * ow + dx] = src[row + x];
    }
  }
}
export function flip<T extends RGBA8 | Mask8>(img: T, horizontal: boolean): T {
  const w = img.width,
    h = img.height,
    ch = img.data.length / (w * h);
  const src = ch === 4 ? new Uint32Array(img.data.buffer, img.data.byteOffset, w * h) : (img.data as Uint8Array);
  const data = ch === 4 ? new Uint8ClampedArray(w * h * 4) : new Uint8Array(w * h);
  const dst = ch === 4 ? new Uint32Array(data.buffer) : (data as Uint8Array);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) dst[y * w + x] = horizontal ? src[y * w + (w - 1 - x)] : src[(h - 1 - y) * w + x];
  return { width: w, height: h, data } as T;
}
/** Quarter turns of a rotation in degrees, or null if it is not a multiple of 90. */
export function quarterTurns(deg: number, eps = 1e-9): number | null {
  const q = deg / 90;
  const r = Math.round(q);
  return Math.abs(q - r) < eps ? ((r % 4) + 4) % 4 : null;
}
/** Where a rectangle lands after a quarter-turn rotation about a pivot,
 * rounded to whole pixels so the rearrangement stays exact. */
export function rotatedRect(r: IRect, k: number, px: number, py: number): IRect {
  const q = mapQuad(about(rotateM(k * 90), px, py), rectQuad(r));
  const b = quadBounds(q);
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
}
/** A layer transform that is the pixel bounds turned by quarter turns and
 * landing on whole pixels can be baked by rearranging pixels. */
export function exactQuarterTurn(
  t: { x: number; y: number; width: number; height: number; rotation: number },
  b: IRect,
  eps = 1e-6,
): number | null {
  const k = quarterTurns(t.rotation);
  if (k === null) return null;
  if (Math.abs(t.width - b.width) > eps || Math.abs(t.height - b.height) > eps) return null;
  const q = quadBounds(transformQuad(t));
  if (Math.abs(q.x - Math.round(q.x)) > eps || Math.abs(q.y - Math.round(q.y)) > eps) return null;
  return k;
}

// ----- Units -----
export type LengthUnit = 'px' | 'percent' | 'in' | 'cm' | 'mm' | 'pt';
export const LENGTH_UNITS: [LengthUnit, string][] = [
  ['percent', 'Percent'],
  ['px', 'Pixels'],
  ['in', 'Inches'],
  ['cm', 'Centimeters'],
  ['mm', 'Millimeters'],
  ['pt', 'Points'],
];
const perInch: Record<string, number> = { in: 1, cm: 2.54, mm: 25.4, pt: 72 };
/** Pixels for a length in `unit` at `ppi`; percent is relative to `base` pixels. */
export function toPixels(value: number, unit: LengthUnit, ppi: number, base: number): number {
  if (unit === 'px') return value;
  if (unit === 'percent') return (base * value) / 100;
  return (value / perInch[unit]) * ppi;
}
export function fromPixels(px: number, unit: LengthUnit, ppi: number, base: number): number {
  if (unit === 'px') return px;
  if (unit === 'percent') return base ? (px / base) * 100 : 100;
  return (px / ppi) * perInch[unit];
}
export const isPhysical = (u: LengthUnit) => u !== 'px' && u !== 'percent';
/** Resolution conversion between pixels per inch and pixels per centimeter. */
export const ppcmToPpi = (v: number) => v * 2.54;
export const ppiToPpcm = (v: number) => v / 2.54;
export function formatBytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)}G`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(2)}M`;
  return `${Math.max(1, Math.round(n / 1024))}K`;
}
/** Uncompressed image size: color channels times bytes per channel. */
export const imageBytes = (w: number, h: number, bits = 8, channels = 3) => w * h * channels * (bits / 8);
/** Resample method for "Automatic": the smoother cubic for enlarging, the
 * sharper one for reducing. */
export function automaticMethod(oldW: number, oldH: number, w: number, h: number): 'bicubic-smoother' | 'bicubic-sharper' | 'bicubic' {
  const f = (w * h) / (oldW * oldH);
  return f > 1 ? 'bicubic-smoother' : f < 1 ? 'bicubic-sharper' : 'bicubic';
}

// ----- Canvas geometry -----
/** Offset of the old canvas inside the new one for a 3x3 anchor (ax, ay in {0, 0.5, 1}). */
export function anchorOffset(oldW: number, oldH: number, newW: number, newH: number, ax: number, ay: number) {
  return { dx: Math.round((newW - oldW) * ax), dy: Math.round((newH - oldH) * ay) };
}
/** Canvas size after a rotation, enlarged to contain the whole image. */
export function rotatedCanvasSize(w: number, h: number, deg: number) {
  const k = quarterTurns(deg);
  if (k !== null) return k % 2 ? { width: h, height: w } : { width: w, height: h };
  const c = Math.abs(Math.cos(deg * RAD)),
    s = Math.abs(Math.sin(deg * RAD));
  return { width: Math.ceil(w * c + h * s - 1e-9), height: Math.ceil(w * s + h * c - 1e-9) };
}
/** Largest rectangle with aspect `aspect` (width / height) that fits inside a
 * W x H image when turned by `deg` (the straighten crop). */
export function inscribedSize(W: number, H: number, deg: number, aspect = W / H) {
  const c = Math.abs(Math.cos(deg * RAD)),
    s = Math.abs(Math.sin(deg * RAD));
  const r = 1 / aspect;
  const w = Math.min(W / (c + r * s), H / (s + r * c));
  return { width: w, height: w * r };
}
/** Angle (degrees) that makes a drawn line horizontal, or vertical if it is
 * closer to vertical. */
export function straightenAngle(a: Point, b: Point) {
  const deg = Math.atan2(b.y - a.y, b.x - a.x) / RAD;
  let r = -deg;
  while (r > 45) r -= 90;
  while (r <= -45) r += 90;
  return r;
}
/** Output size for a perspective crop: the longer of each pair of opposite sides. */
export function rectifiedSize(q: Quad) {
  const len = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  return {
    width: Math.max(1, Math.round(Math.max(len(q[0], q[1]), len(q[3], q[2])))),
    height: Math.max(1, Math.round(Math.max(len(q[0], q[3]), len(q[1], q[2])))),
  };
}
/** Document-space matrix of a similarity between two layer frames. */
export function frameMatrix(
  a: { x: number; y: number; width: number; height: number; rotation: number },
  b: { x: number; y: number; width: number; height: number; rotation: number },
): Mat3 {
  return compose(
    translate(b.x + b.width / 2, b.y + b.height / 2),
    rotateM(b.rotation),
    scaleM(b.width / a.width, b.height / a.height),
    rotateM(-a.rotation),
    translate(-(a.x + a.width / 2), -(a.y + a.height / 2)),
  );
}
export function isAffine(m: Mat3, eps = 1e-12) {
  return Math.abs(m[6]) < eps && Math.abs(m[7]) < eps && Math.abs(m[8] - 1) < 1e-9;
}
export function rgbaFromMask(m: Mask8): RGBA8 {
  const data = new Uint8ClampedArray(m.width * m.height * 4);
  for (let i = 0; i < m.data.length; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 255;
    data[i * 4 + 3] = m.data[i];
  }
  return { width: m.width, height: m.height, data };
}
export function maskFromRGBA(img: RGBA8): Mask8 {
  const data = new Uint8Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) data[i] = img.data[i * 4 + 3];
  return { width: img.width, height: img.height, data };
}
