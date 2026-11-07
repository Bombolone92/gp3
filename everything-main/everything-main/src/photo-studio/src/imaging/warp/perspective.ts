// Perspective planes: quadrilaterals laid over an image (sharing corners
// where they touch), then moved to new corner positions. Each plane maps
// through its own homography; outside every plane the source position is a
// distance-weighted blend of the planes' maps, so the whole layer moves
// continuously with the planes.
import type { IRect } from '../types';
import { applyMat3, homography, mat3Invert, type Mat3, type Point } from '../filters/warp';
import type { CoordMap } from '../filters/sampling';

/** Corner indices of one plane: top-left, top-right, bottom-right, bottom-left. */
export type Plane = [number, number, number, number];
export type PlaneSet = { points: Point[]; planes: Plane[] };

export const emptyPlanes = (): PlaneSet => ({ points: [], planes: [] });
export const planeQuad = (points: Point[], plane: Plane): [Point, Point, Point, Point] => plane.map((i) => points[i]) as [Point, Point, Point, Point];

/** A convex, non-degenerate quad with a consistent winding. */
export function convexQuad(q: Point[], minArea = 1) {
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
  return Math.abs(polygonArea(q)) >= minArea;
}
export function polygonArea(q: Point[]) {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i],
      b = q[(i + 1) % q.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Add a plane from four corners; corners within `snap` of an existing point
 * reuse that point, so touching planes share an edge. */
export function addPlane(set: PlaneSet, quad: Point[], snap: number): PlaneSet {
  const points = set.points.slice();
  const plane = quad.map((p) => {
    const near = nearestPoint(points, p, snap);
    if (near >= 0) return near;
    points.push({ ...p });
    return points.length - 1;
  }) as Plane;
  if (new Set(plane).size < 4) return set;
  return { points, planes: [...set.planes, plane] };
}
/** Index of the nearest point within `radius`, or -1. */
export function nearestPoint(points: Point[], p: Point, radius: number, skip = -1) {
  let best = radius * radius,
    index = -1;
  points.forEach((q, i) => {
    if (i === skip) return;
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d <= best) [best, index] = [d, i];
  });
  return index;
}
/** Merge point `i` into a point within `snap` (dropping `i`), unless that
 * would collapse a plane. Returns the set and the surviving index. */
export function snapPoint(set: PlaneSet, i: number, snap: number): { set: PlaneSet; index: number } {
  const j = nearestPoint(set.points, set.points[i], snap, i);
  if (j < 0) return { set, index: i };
  const planes = set.planes.map((pl) => pl.map((k) => (k === i ? j : k)) as Plane);
  if (planes.some((pl) => new Set(pl).size < 4)) return { set, index: i };
  return compact({ points: set.points, planes }, j);
}
/** Remove plane `k` and any points no other plane uses. */
export function removePlane(set: PlaneSet, k: number): PlaneSet {
  return compact({ points: set.points, planes: set.planes.filter((_, i) => i !== k) }).set;
}
/** Drop unused points and renumber; `keep` is an index to follow through. */
function compact(set: PlaneSet, keep = -1): { set: PlaneSet; index: number } {
  const used = new Set(set.planes.flat());
  const map = new Map<number, number>();
  const points: Point[] = [];
  set.points.forEach((p, i) => {
    if (!used.has(i)) return;
    map.set(i, points.length);
    points.push(p);
  });
  return { set: { points, planes: set.planes.map((pl) => pl.map((i) => map.get(i)!) as Plane) }, index: map.get(keep) ?? -1 };
}
/** Plane under a point (last drawn first), or -1. */
export function planeAt(points: Point[], planes: Plane[], p: Point) {
  for (let k = planes.length - 1; k >= 0; k--) if (insidePolygon(planeQuad(points, planes[k]), p)) return k;
  return -1;
}
export function insidePolygon(q: Point[], p: Point) {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const a = q[i],
      b = q[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** Unique edges of all planes as point index pairs. */
export function planeEdges(planes: Plane[]): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const pl of planes)
    for (let e = 0; e < 4; e++) {
      const a = pl[e],
        b = pl[(e + 1) % 4];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([a, b]);
    }
  return out;
}

// ----- Straightening -----
export type StraightenAxis = 'vertical' | 'horizontal' | 'both';
/** Make edges within `maxAngle` degrees of vertical (or horizontal) exactly
 * so. Points joined by such edges move to their average coordinate, which
 * satisfies every constraint at once, also across shared corners. */
export function straighten(points: Point[], planes: Plane[], axis: StraightenAxis, maxAngle = 30): Point[] {
  let out = points.map((p) => ({ ...p }));
  const tan = Math.tan((maxAngle * Math.PI) / 180);
  const pass = (vertical: boolean) => {
    const parent = out.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const [a, b] of planeEdges(planes)) {
      const dx = Math.abs(out[b].x - out[a].x),
        dy = Math.abs(out[b].y - out[a].y);
      if (vertical ? dx <= dy * tan : dy <= dx * tan) parent[find(a)] = find(b);
    }
    const sum = new Map<number, [number, number]>();
    out.forEach((p, i) => {
      const r = find(i),
        s = sum.get(r) ?? [0, 0];
      s[0] += vertical ? p.x : p.y;
      s[1]++;
      sum.set(r, s);
    });
    out = out.map((p, i) => {
      const [total, count] = sum.get(find(i))!;
      return vertical ? { x: total / count, y: p.y } : { x: p.x, y: total / count };
    });
  };
  if (axis !== 'horizontal') pass(true);
  if (axis !== 'vertical') pass(false);
  return out;
}
/** Make one edge vertical or horizontal, whichever it is closer to, by
 * moving both ends to their average coordinate. */
export function straightenEdge(points: Point[], a: number, b: number): Point[] {
  const out = points.map((p) => ({ ...p }));
  const vertical = Math.abs(out[b].x - out[a].x) < Math.abs(out[b].y - out[a].y);
  if (vertical) out[a].x = out[b].x = (out[a].x + out[b].x) / 2;
  else out[a].y = out[b].y = (out[a].y + out[b].y) / 2;
  return out;
}

// ----- Mapping -----
export type PlaneMaps = { forward: Mat3; inverse: Mat3; rest: Point[]; quad: Point[] }[];
/** Homographies from each rest plane to its warped plane (and back). Planes
 * whose warped quad is not convex are skipped. */
export function planeMaps(rest: Point[], warped: Point[], planes: Plane[]): PlaneMaps {
  const out: PlaneMaps = [];
  for (const pl of planes) {
    const from = planeQuad(rest, pl),
      to = planeQuad(warped, pl);
    if (!convexQuad(from, 1e-6) || !convexQuad(to, 1e-6)) continue;
    try {
      const forward = homography(from, to);
      const inverse = mat3Invert(forward);
      if (inverse) out.push({ forward, inverse, rest: from, quad: to });
    } catch {
      /* Degenerate planes do not contribute. */
    }
  }
  return out;
}
function distToQuad(q: Point[], x: number, y: number) {
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const a = q[i],
      b = q[(i + 1) % 4];
    const dx = b.x - a.x,
      dy = b.y - a.y,
      l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l)) : 0;
    best = Math.min(best, (a.x + t * dx - x) ** 2 + (a.y + t * dy - y) ** 2);
  }
  return best;
}
/** Destination -> source map (in the planes' coordinate space). Inside a
 * warped plane it is that plane's inverse homography; elsewhere a blend of
 * all planes weighted by the inverse fourth power of the distance, which
 * agrees with each plane's map on its border. */
export function perspectiveMap(maps: PlaneMaps): CoordMap {
  const inside = (q: Point[], x: number, y: number) => insidePolygon(q, { x, y });
  return (x, y, out) => {
    if (!maps.length) return;
    for (let k = maps.length - 1; k >= 0; k--)
      if (inside(maps[k].quad, x, y)) {
        const m = maps[k].inverse;
        const w = m[6] * x + m[7] * y + m[8];
        out[0] = (m[0] * x + m[1] * y + m[2]) / w;
        out[1] = (m[3] * x + m[4] * y + m[5]) / w;
        return;
      }
    let sx = 0,
      sy = 0,
      sw = 0;
    for (const { inverse: m, quad } of maps) {
      const w = m[6] * x + m[7] * y + m[8];
      // Beyond a plane's horizon its map has no meaning.
      if (w <= 1e-9) continue;
      const d2 = distToQuad(quad, x, y);
      const weight = 1 / (d2 * d2 + 1e-9);
      sx += weight * ((m[0] * x + m[1] * y + m[2]) / w);
      sy += weight * ((m[3] * x + m[4] * y + m[5]) / w);
      sw += weight;
    }
    if (sw > 0) {
      out[0] = sx / sw;
      out[1] = sy / sw;
    } else out[0] = NaN;
  };
}
/** Source -> destination map, the counterpart of `perspectiveMap`: inside a
 * rest plane its homography, elsewhere a blend weighted the same way by the
 * distance to the rest planes. Undefined beyond every plane's horizon. */
export function perspectiveForward(maps: PlaneMaps): (x: number, y: number) => Point | undefined {
  return (x, y) => {
    if (!maps.length) return { x, y };
    for (let k = maps.length - 1; k >= 0; k--) if (insidePolygon(maps[k].rest, { x, y })) return applyMat3(maps[k].forward, x, y);
    let sx = 0,
      sy = 0,
      sw = 0;
    for (const { forward: m, rest } of maps) {
      const w = m[6] * x + m[7] * y + m[8];
      if (w <= 1e-9) continue;
      const d2 = distToQuad(rest, x, y);
      const weight = 1 / (d2 * d2 + 1e-9);
      sx += weight * ((m[0] * x + m[1] * y + m[2]) / w);
      sy += weight * ((m[3] * x + m[4] * y + m[5]) / w);
      sw += weight;
    }
    return sw > 0 ? { x: sx / sw, y: sy / sw } : undefined;
  };
}
/** Approximate destination bounds of the rectangle `rect` (rest space): its
 * border is pushed forward through the nearest rest plane's homography. */
export function warpedBounds(maps: PlaneMaps, rect: IRect): IRect {
  const pts: Point[] = [];
  const N = 32;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push(
      { x: rect.x + t * rect.width, y: rect.y },
      { x: rect.x + t * rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + t * rect.height },
      { x: rect.x + rect.width, y: rect.y + t * rect.height },
    );
  }
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const add = (p: Point) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  };
  for (const m of maps) for (const p of m.quad) add(p);
  for (const p of pts) {
    let best = Infinity,
      k = -1;
    maps.forEach((m, i) => {
      const d = insidePolygon(m.rest, p) ? 0 : distToQuad(m.rest, p.x, p.y);
      if (d < best) [best, k] = [d, i];
    });
    if (k < 0) {
      add(p);
      continue;
    }
    const f = maps[k].forward;
    const w = f[6] * p.x + f[7] * p.y + f[8];
    if (w > 1e-9) add(applyMat3(f, p.x, p.y));
  }
  if (!(x1 >= x0)) return { ...rect };
  const x = Math.floor(x0),
    y = Math.floor(y0);
  return { x, y, width: Math.ceil(x1) - x, height: Math.ceil(y1) - y };
}
