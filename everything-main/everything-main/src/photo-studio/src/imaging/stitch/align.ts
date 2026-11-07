// Aligning overlapping images: features per image, pairwise robust fits, a
// maximum spanning tree of the strongest pairs from a reference image, and
// the projection that places every image in the reference's frame.
import { checkCancelled, type IRect, type Progress, type RGBA8 } from '../types';
import { applyMat3, mat3Invert, mat3Multiply, type Mat3, type Point } from '../filters/warp';
import { warpImage, type CoordMap, type Interp } from '../filters/sampling';
import { detectFeatures, grayOf, matchFeatures, scaleGray, type Features, type Match } from './features';
import { IDENTITY, fitModel, ransac, type Model, type Pair } from './estimate';

export type Projection = 'auto' | 'perspective' | 'cylindrical' | 'reposition';
export type Placement =
  | { kind: 'matrix'; m: Mat3 }
  // Image pixels → cylinder coordinates about (cx, cy) with focal length f,
  // then `m` (a similarity) into the output frame.
  | { kind: 'cylinder'; f: number; cx: number; cy: number; m: Mat3 };
export type AlignResult = {
  placements: Placement[];
  reference: number;
  projection: Exclude<Projection, 'auto'> | 'similarity';
  // Images that matched no other image keep an identity placement.
  aligned: boolean[];
  inliers: number[];
};
export type AlignOptions = {
  projection?: Projection;
  reference?: number;
  // Longest side of the images features are detected on.
  workSize?: number;
  progress?: Progress;
};

type ImageFeatures = Features & { center: Point; scale: number };

const sub = (p: Progress | undefined, a: number, b: number): Progress | undefined =>
  p && { cancelled: p.cancelled, report: (f) => p.report?.(a + (b - a) * f) };

function alphaBounds(img: RGBA8): IRect {
  const { width: w, height: h, data } = img;
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? { x: 0, y: 0, width: w, height: h } : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Features of one image in its full-resolution pixel coordinates. */
export function imageFeatures(img: RGBA8, workSize = 1200): ImageFeatures {
  const s = Math.min(1, workSize / Math.max(img.width, img.height));
  const valid = new Uint8Array(img.width * img.height);
  let g = grayOf(img, valid);
  let v = valid;
  if (s < 1) {
    const small = scaleGray(g, s);
    const sv = new Uint8Array(small.width * small.height);
    const fx = img.width / small.width,
      fy = img.height / small.height;
    for (let y = 0; y < small.height; y++)
      for (let x = 0; x < small.width; x++) {
        let ok = 1;
        const ys = Math.floor(y * fy),
          xs = Math.floor(x * fx);
        for (let yy = ys; yy < Math.min(img.height, Math.ceil((y + 1) * fy)) && ok; yy++)
          for (let xx = xs; xx < Math.min(img.width, Math.ceil((x + 1) * fx)); xx++) if (!valid[yy * img.width + xx]) (ok = 0);
        sv[y * small.width + x] = ok;
      }
    g = small;
    v = sv;
  }
  const b = alphaBounds(img);
  const k = img.width / g.width;
  // Detect on a cylindrical view of the image (focal length guessed from its
  // size). Wide-angle overlaps then differ mostly by a shift, which binary
  // descriptors match far better than the perspective stretch of the raw
  // frames; points are mapped back, so models are fitted on the originals.
  const c = { x: (b.x + b.width / 2) / k, y: (b.y + b.height / 2) / k };
  const focal = 0.9 * Math.max(b.width, b.height) / k;
  const view = cylindricalView(g, v, focal, c);
  const f = detectFeatures(view.gray, { valid: view.valid });
  const points = f.points.flatMap((p, i) => {
    // Continuous coordinates (pixel centers at .5), as transforms and warps use.
    const q = fromCylinder(p.x + 0.5, p.y + 0.5, focal, c);
    return q ? [{ p: { ...p, x: q.x * k, y: q.y * k }, i }] : [];
  });
  const descriptors = new Uint32Array(points.length * 8);
  points.forEach(({ i }, j) => descriptors.set(f.descriptors.subarray(i * 8, i * 8 + 8), j * 8));
  return { points: points.map((x) => x.p), descriptors, width: img.width, height: img.height, center: { x: b.x + b.width / 2, y: b.y + b.height / 2 }, scale: s };
}

/** Resample a gray plane (and its validity) into cylinder coordinates. */
function cylindricalView(g: { width: number; height: number; data: Float32Array }, valid: Uint8Array, f: number, c: Point) {
  const { width: w, height: h, data } = g;
  const out = new Float32Array(w * h),
    ok = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const q = fromCylinder(x + 0.5, y + 0.5, f, c);
      if (!q) continue;
      const fx = q.x - 0.5,
        fy = q.y - 0.5;
      const ix = Math.floor(fx),
        iy = Math.floor(fy);
      if (ix < 0 || iy < 0 || ix >= w - 1 || iy >= h - 1) continue;
      const i = iy * w + ix;
      if (!valid[i] || !valid[i + 1] || !valid[i + w] || !valid[i + w + 1]) continue;
      const ax = fx - ix,
        ay = fy - iy;
      out[y * w + x] = (data[i] * (1 - ax) + data[i + 1] * ax) * (1 - ay) + (data[i + w] * (1 - ax) + data[i + w + 1] * ax) * ay;
      ok[y * w + x] = 1;
    }
  return { gray: { width: w, height: h, data: out }, valid: ok };
}

/** Focal length from a rotation-only homography between centered images
 * (Szeliski and Shum's closed form; the geometric mean of both estimates). */
export function focalFromHomography(m: Mat3): number | null {
  const h = m.map((v) => v / m[8]);
  const pick = (d1: number, d2: number, v1: number, v2: number) => {
    if (!Number.isFinite(v1)) v1 = -1;
    if (!Number.isFinite(v2)) v2 = -1;
    if (v1 < v2) [v1, v2] = [v2, v1];
    const v = v1 > 0 && v2 > 0 ? (Math.abs(d1) > Math.abs(d2) ? v1 : v2) : v1 > 0 ? v1 : -1;
    return v > 0 && Number.isFinite(v) ? Math.sqrt(v) : null;
  };
  let d1 = h[6] * h[7],
    d2 = (h[7] - h[6]) * (h[7] + h[6]);
  const f1 = pick(d1, d2, -(h[0] * h[1] + h[3] * h[4]) / d1, (h[0] * h[0] + h[3] * h[3] - h[1] * h[1] - h[4] * h[4]) / d2);
  d1 = h[0] * h[3] + h[1] * h[4];
  d2 = h[0] * h[0] + h[1] * h[1] - h[3] * h[3] - h[4] * h[4];
  const f0 = pick(d1, d2, (-h[2] * h[5]) / d1, (h[5] * h[5] - h[2] * h[2]) / d2);
  if (f0 && f1) return Math.sqrt(f0 * f1);
  return f0 ?? f1;
}

/** Image point to its cylinder coordinates (center kept fixed). */
export function toCylinder(x: number, y: number, f: number, c: Point): Point {
  const dx = x - c.x,
    dy = y - c.y;
  return { x: c.x + f * Math.atan2(dx, f), y: c.y + (f * dy) / Math.hypot(dx, f) };
}
export function fromCylinder(x: number, y: number, f: number, c: Point): Point | null {
  const t = (x - c.x) / f;
  if (Math.abs(t) >= Math.PI / 2 - 1e-3) return null;
  const h = (y - c.y) / f;
  return { x: c.x + f * Math.tan(t), y: c.y + (f * h) / Math.cos(t) };
}

/** Source point (image pixels) of an output point, or null when none. */
export function placementInverse(p: Placement): (x: number, y: number) => Point | null {
  const inv = mat3Invert(p.m);
  if (!inv) return () => null;
  if (p.kind === 'matrix')
    return (x, y) => {
      const w = inv[6] * x + inv[7] * y + inv[8];
      return w > 1e-9 ? applyMat3(inv, x, y) : null;
    };
  const c = { x: p.cx, y: p.cy };
  return (x, y) => {
    const q = applyMat3(inv, x, y);
    return fromCylinder(q.x, q.y, p.f, c);
  };
}
export function placementForward(p: Placement): (x: number, y: number) => Point {
  if (p.kind === 'matrix') return (x, y) => applyMat3(p.m, x, y);
  const c = { x: p.cx, y: p.cy };
  return (x, y) => {
    const q = toCylinder(x, y, p.f, c);
    return applyMat3(p.m, q.x, q.y);
  };
}

/** Output-space bounds of an image rectangle (sampled along its edges). */
export function placementBounds(p: Placement, rect: IRect): IRect {
  const fwd = placementForward(p);
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const steps = p.kind === 'matrix' && p.m[6] === 0 && p.m[7] === 0 ? 1 : 16;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    for (const [x, y] of [
      [rect.x + t * rect.width, rect.y],
      [rect.x + t * rect.width, rect.y + rect.height],
      [rect.x, rect.y + t * rect.height],
      [rect.x + rect.width, rect.y + t * rect.height],
    ]) {
      const q = fwd(x, y);
      if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) continue;
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x);
      y1 = Math.max(y1, q.y);
    }
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.floor(x0),
    y = Math.floor(y0);
  return { x, y, width: Math.ceil(x1) - x, height: Math.ceil(y1) - y };
}

/** Render an image through its placement into the output rectangle. The
 * image's pixel (0, 0) sits at `offset` in the placement's input space (for
 * layer content that does not start at the document origin). */
export function warpPlacement(src: RGBA8, p: Placement, out: IRect, method: Interp = 'bicubic', progress?: Progress, offset = { x: 0, y: 0 }): RGBA8 {
  const inv = placementInverse(p);
  const map: CoordMap = (x, y, o) => {
    const q = inv(x, y);
    if (!q) {
      o[0] = -1e9;
      o[1] = -1e9;
      return;
    }
    o[0] = q.x - offset.x;
    o[1] = q.y - offset.y;
  };
  checkCancelled(progress);
  const linear = p.kind === 'matrix' && p.m[6] === 0 && p.m[7] === 0;
  return warpImage(src, out.width, out.height, map, { method, edge: 'transparent', gridStep: linear ? 16 : 4, offsetX: out.x, offsetY: out.y });
}

type Edge = { a: number; b: number; m: Mat3; inliers: number; matches: Match[] };

function pairsOf(fa: Features, fb: Features, matches: Match[], map?: (i: number, p: Point) => Point): Pair[] {
  return matches.map((m) => ({
    a: map ? map(0, fa.points[m.a]) : fa.points[m.a],
    b: map ? map(1, fb.points[m.b]) : fb.points[m.b],
  }));
}

/** Pairwise fits between images likely to overlap. */
function pairwise(feats: ImageFeatures[], model: Model, progress?: Progress, cyl?: { f: number }): Edge[] {
  const n = feats.length;
  const edges: Edge[] = [];
  const list: [number, number][] = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (n <= 12 || b - a <= 3) list.push([a, b]);
  list.forEach(([a, b], k) => {
    checkCancelled(progress);
    progress?.report?.(k / list.length);
    const fa = feats[a],
      fb = feats[b];
    const matches = matchFeatures(fa, fb);
    if (matches.length < 8) return;
    const project = cyl ? (i: number, p: Point) => toCylinder(p.x, p.y, cyl.f, (i ? fb : fa).center) : undefined;
    const pairs = pairsOf(fa, fb, matches, project);
    const threshold = Math.max(2, 2.5 / Math.min(fa.scale, fb.scale));
    const fit = ransac(model, pairs, { threshold, width: fa.width, height: fa.height, seed: 11 + a * 31 + b });
    if (!fit) return;
    const need = Math.max(model === 'homography' ? 12 : 8, Math.round(0.08 * matches.length));
    if (fit.inliers.length < need) return;
    edges.push({ a, b, m: fit.m, inliers: fit.inliers.length, matches: fit.inliers.map((i) => matches[i]) });
  });
  return edges;
}

/** Chain pairwise transforms along a maximum spanning tree from the reference. */
function spanningTree(n: number, edges: Edge[], reference: number) {
  const global: (Mat3 | null)[] = Array(n).fill(null);
  global[reference] = [...IDENTITY] as Mat3;
  const inliers = new Array(n).fill(0);
  for (;;) {
    let best: { e: Edge; from: number; to: number } | null = null;
    for (const e of edges) {
      const ain = !!global[e.a],
        bin = !!global[e.b];
      if (ain === bin) continue;
      if (!best || e.inliers > best.e.inliers) best = { e, from: ain ? e.a : e.b, to: ain ? e.b : e.a };
    }
    if (!best) break;
    const { e, from, to } = best;
    // e.m maps a → b. We need to → from, then from → reference.
    const toFrom = to === e.a ? e.m : mat3Invert(e.m);
    if (!toFrom) {
      edges = edges.filter((x) => x !== e);
      continue;
    }
    global[to] = mat3Multiply(global[from]!, toFrom);
    inliers[to] = e.inliers;
  }
  return { global, inliers };
}

function bestReference(n: number, edges: Edge[]) {
  const score = new Array(n).fill(0);
  for (const e of edges) {
    score[e.a] += e.inliers;
    score[e.b] += e.inliers;
  }
  let r = 0;
  for (let i = 1; i < n; i++) if (score[i] > score[r]) r = i;
  return r;
}

/** Largest corner offset between a homography and its best similarity. */
function nonSimilarity(m: Mat3, w: number, h: number) {
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const pairs = corners.map((c) => ({ a: c, b: applyMat3(m, c.x, c.y) }));
  const s = fitModel('similarity', pairs);
  if (!s) return Infinity;
  return Math.max(...pairs.map((p) => Math.hypot(applyMat3(s, p.a.x, p.a.y).x - p.b.x, applyMat3(s, p.a.x, p.a.y).y - p.b.y)));
}

/** Align images to a reference image. Images are full-resolution RGBA; their
 * transparent areas are ignored. */
export function alignImages(images: RGBA8[], opts: AlignOptions = {}): AlignResult {
  const n = images.length;
  const progress = opts.progress;
  const feats: ImageFeatures[] = [];
  for (let i = 0; i < n; i++) {
    checkCancelled(progress);
    progress?.report?.((0.45 * i) / n);
    feats.push(imageFeatures(images[i], opts.workSize));
  }
  const requested = opts.projection ?? 'auto';
  const model: Model = requested === 'reposition' ? 'rigid' : 'homography';
  let edges = pairwise(feats, model, sub(progress, 0.45, requested === 'cylindrical' || requested === 'auto' ? 0.7 : 0.95));
  const reference = opts.reference ?? bestReference(n, edges);
  let { global, inliers } = spanningTree(n, edges, reference);
  let projection: AlignResult['projection'] = requested === 'reposition' ? 'reposition' : 'perspective';
  let placements: Placement[] = global.map((m) => ({ kind: 'matrix', m: m ?? ([...IDENTITY] as Mat3) }));
  if (requested === 'auto') {
    // Nearly similar transforms stay similarities (no perspective resampling,
    // and embedded layers can keep a plain transform); wide panoramas whose
    // perspective stretch grows large use a cylinder.
    const ref = feats[reference];
    const pixels = Math.max(ref.width, ref.height);
    let worst = 0,
      stretch = 1;
    for (let i = 0; i < n; i++) {
      const m = global[i];
      if (!m || i === reference) continue;
      worst = Math.max(worst, nonSimilarity(m, images[i].width, images[i].height));
      const b = placementBounds({ kind: 'matrix', m }, alphaBoundsOf(feats[i]));
      stretch = Math.max(stretch, Math.max(b.width, b.height) / pixels);
    }
    if (worst < Math.max(1.5, pixels * 0.002)) {
      projection = 'similarity';
      edges = pairwise(feats, 'similarity', sub(progress, 0.7, 0.95));
      ({ global, inliers } = spanningTree(n, edges, reference));
      placements = global.map((m) => ({ kind: 'matrix', m: m ?? ([...IDENTITY] as Mat3) }));
    } else if (stretch > 1.6) projection = 'cylindrical';
  }
  if (requested === 'cylindrical' || projection === 'cylindrical') {
    projection = 'cylindrical';
    const estimates: number[] = [];
    for (const e of edges) {
      const ca = feats[e.a].center,
        cb = feats[e.b].center;
      const centered = mat3Multiply(mat3Multiply([1, 0, -cb.x, 0, 1, -cb.y, 0, 0, 1], e.m), [1, 0, ca.x, 0, 1, ca.y, 0, 0, 1]);
      const f = focalFromHomography(centered);
      if (f && f > 0.2 * feats[e.a].width && f < 20 * feats[e.a].width) estimates.push(f);
    }
    estimates.sort((a, b) => a - b);
    const f0 = estimates.length ? estimates[estimates.length >> 1] : 0.9 * Math.max(...feats.map((x) => x.width));
    const f = refineFocal(f0, edges, feats);
    const cylEdges = pairwise(feats, 'similarity', sub(progress, 0.7, 0.95), { f });
    ({ global, inliers } = spanningTree(n, cylEdges, reference));
    placements = global.map((m, i) => ({ kind: 'cylinder', f, cx: feats[i].center.x, cy: feats[i].center.y, m: m ?? ([...IDENTITY] as Mat3) }));
  }
  progress?.report?.(1);
  return { placements, reference, projection, aligned: global.map((m) => !!m), inliers };
}

/** Pick the focal length whose cylinder makes every overlap a rigid shift:
 * the inlier matches of each homography are projected and fitted with a
 * similarity, and the summed residual is minimized (coarse scan, then
 * golden-section refinement). */
function refineFocal(f0: number, edges: Edge[], feats: ImageFeatures[]): number {
  if (!edges.length) return f0;
  const cost = (f: number) => {
    let sum = 0,
      count = 0;
    for (const e of edges) {
      const fa = feats[e.a],
        fb = feats[e.b];
      const pairs = e.matches.map((m) => ({ a: toCylinder(fa.points[m.a].x, fa.points[m.a].y, f, fa.center), b: toCylinder(fb.points[m.b].x, fb.points[m.b].y, f, fb.center) }));
      const s = fitModel('similarity', pairs);
      if (!s) continue;
      for (const p of pairs) {
        const q = applyMat3(s, p.a.x, p.a.y);
        sum += Math.min(400, (q.x - p.b.x) ** 2 + (q.y - p.b.y) ** 2);
        count++;
      }
    }
    return count ? sum / count : Infinity;
  };
  let best = f0,
    bestCost = cost(f0);
  for (let i = -6; i <= 6; i++) {
    const f = f0 * Math.pow(2, i / 8);
    const c = cost(f);
    if (c < bestCost) (best = f), (bestCost = c);
  }
  let lo = best / Math.pow(2, 1 / 8),
    hi = best * Math.pow(2, 1 / 8);
  const g = (Math.sqrt(5) - 1) / 2;
  for (let it = 0; it < 18; it++) {
    const a = hi - g * (hi - lo),
      b = lo + g * (hi - lo);
    if (cost(a) < cost(b)) hi = b;
    else lo = a;
  }
  const f = (lo + hi) / 2;
  return cost(f) <= bestCost ? f : best;
}

function alphaBoundsOf(f: ImageFeatures): IRect {
  return { x: 0, y: 0, width: f.width, height: f.height };
}

/** Rendered size limit: scale a set of output bounds down so their union
 * fits within the document limits. Returns the union and the scale. */
export function fitOutput(rects: IRect[], maxSide = 8192, maxPixels = 24_000_000) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const r of rects) {
    if (r.width <= 0 || r.height <= 0) continue;
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  }
  const w = x1 - x0,
    h = y1 - y0;
  const scale = Math.min(1, maxSide / w, maxSide / h, Math.sqrt(maxPixels / (w * h)));
  return { union: { x: x0, y: y0, width: w, height: h }, scale };
}

/** Prefix a placement with a similarity in the output space. */
export function composePlacement(t: Mat3, p: Placement): Placement {
  return { ...p, m: mat3Multiply(t, p.m) };
}
