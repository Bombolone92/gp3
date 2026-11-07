// 2D feature tracker: pyramidal Lucas–Kanade (Gauss–Newton with Levenberg damping) on grayscale
// image regions, with an optional brute-force normalized-cross-correlation prepass and a final
// NCC acceptance test. Pure functions (no DOM) so it runs in a worker and in unit tests.
//
// Image coordinates are full-frame pixels with the origin at the top-left corner, x right and
// y down; pixel (i, j) covers [i, i+1) × [j, j+1) so its center is (i + 0.5, j + 0.5). A region
// stores a crop of a frame: pixel (i, j) of the region is pixel (x0 + i, y0 + j) of the frame.
import type { MotionModel } from './types';

export interface GrayRegion {
  x0: number;
  y0: number;
  w: number;
  h: number;
  data: Float32Array;
}

export type P2 = [number, number];

/** Bilinear sample at frame coordinates (clamped to the region border). */
export function sample(img: GrayRegion, x: number, y: number): number {
  let u = x - img.x0 - 0.5,
    v = y - img.y0 - 0.5;
  const w = img.w,
    h = img.h;
  if (u < 0) u = 0;
  else if (u > w - 1) u = w - 1;
  if (v < 0) v = 0;
  else if (v > h - 1) v = h - 1;
  const i = Math.min(w - 2, Math.floor(u)),
    j = Math.min(h - 2, Math.floor(v));
  if (i < 0 || j < 0) return img.data[Math.max(0, Math.min(w * h - 1, Math.round(v) * w + Math.round(u)))] ?? 0;
  const fx = u - i,
    fy = v - j;
  const d = img.data,
    k = j * w + i;
  const a = d[k] + (d[k + 1] - d[k]) * fx;
  const b = d[k + w] + (d[k + w + 1] - d[k + w]) * fx;
  return a + (b - a) * fy;
}

/** Half-resolution region (binomial [1 3 3 1]/8 filter, centers stay aligned). Requires even x0/y0. */
export function downsample(img: GrayRegion): GrayRegion {
  const w = Math.max(1, img.w >> 1),
    h = Math.max(1, img.h >> 1);
  const src = img.data,
    W = img.w,
    H = img.h;
  const tmp = new Float32Array(w * H);
  const cx = (i: number) => (i < 0 ? 0 : i >= W ? W - 1 : i);
  const cy = (j: number) => (j < 0 ? 0 : j >= H ? H - 1 : j);
  for (let y = 0; y < H; y++) {
    const r = y * W;
    for (let x = 0; x < w; x++) {
      const s = 2 * x;
      tmp[y * w + x] = (src[r + cx(s - 1)] + 3 * src[r + cx(s)] + 3 * src[r + cx(s + 1)] + src[r + cx(s + 2)]) / 8;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const s = 2 * y;
    for (let x = 0; x < w; x++) out[y * w + x] = (tmp[cy(s - 1) * w + x] + 3 * tmp[cy(s) * w + x] + 3 * tmp[cy(s + 1) * w + x] + tmp[cy(s + 2) * w + x]) / 8;
  }
  return { x0: img.x0 / 2, y0: img.y0 / 2, w, h, data: out };
}

export function buildPyramid(img: GrayRegion, levels: number): GrayRegion[] {
  const out = [img];
  for (let l = 1; l < levels; l++) {
    const prev = out[l - 1];
    if (prev.w < 8 || prev.h < 8) break;
    out.push(downsample(prev));
  }
  return out;
}

/** Normalized cross correlation of two equally sized sample vectors (−1…1). */
export function ncc(a: Float32Array | number[], b: Float32Array | number[]): number {
  const n = a.length;
  let ma = 0,
    mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let sab = 0,
    saa = 0,
    sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma,
      db = b[i] - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  if (saa < 1e-12 || sbb < 1e-12) return saa < 1e-12 && sbb < 1e-12 ? 1 : 0;
  return sab / Math.sqrt(saa * sbb);
}

/** Solve A x = b for a small dense system (Gaussian elimination with partial pivoting). */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

// ---------------------------------------------------------------------------
// warp models: x = c + A·o, where o is a template offset relative to the reference anchor

type Mat2 = [number, number, number, number]; // a00 a01 a10 a11

interface Model {
  n: number;
  /** parameters → [cx, cy, A] */
  unpack(p: number[]): { cx: number; cy: number; A: Mat2 };
  /** d(x)/d(p_i) for offset o, written into out (2 * n) */
  jac(p: number[], ox: number, oy: number, out: Float64Array): void;
  init(cx: number, cy: number, A: Mat2): number[];
}

function projectModel(model: MotionModel, A: Mat2): Mat2 {
  switch (model) {
    case 'Loc':
      return [1, 0, 0, 1];
    case 'LocScale': {
      const s = Math.sqrt(Math.abs(A[0] * A[3] - A[1] * A[2])) || 1;
      return [s, 0, 0, s];
    }
    case 'LocRot': {
      const t = Math.atan2(A[2] - A[1], A[0] + A[3]);
      return [Math.cos(t), -Math.sin(t), Math.sin(t), Math.cos(t)];
    }
    case 'LocRotScale': {
      const a = (A[0] + A[3]) / 2,
        b = (A[2] - A[1]) / 2;
      return [a, -b, b, a];
    }
    default:
      return A;
  }
}

function makeModel(model: MotionModel, fixedA: Mat2): Model {
  switch (model) {
    case 'Loc':
      return {
        n: 2,
        unpack: (p) => ({ cx: p[0], cy: p[1], A: fixedA }),
        jac: (_p, _ox, _oy, o) => {
          o[0] = 1;
          o[1] = 0;
          o[2] = 0;
          o[3] = 1;
        },
        init: (cx, cy) => [cx, cy],
      };
    case 'LocScale':
      return {
        n: 3,
        unpack: (p) => ({ cx: p[0], cy: p[1], A: [p[2], 0, 0, p[2]] }),
        jac: (_p, ox, oy, o) => {
          o[0] = 1; o[1] = 0; o[2] = ox; // x row
          o[3] = 0; o[4] = 1; o[5] = oy; // y row
        },
        init: (cx, cy, A) => [cx, cy, Math.sqrt(Math.abs(A[0] * A[3] - A[1] * A[2])) || 1],
      };
    case 'LocRot':
      return {
        n: 3,
        unpack: (p) => {
          const c = Math.cos(p[2]),
            s = Math.sin(p[2]);
          return { cx: p[0], cy: p[1], A: [c, -s, s, c] };
        },
        jac: (p, ox, oy, o) => {
          const c = Math.cos(p[2]),
            s = Math.sin(p[2]);
          o[0] = 1; o[1] = 0; o[2] = -s * ox - c * oy;
          o[3] = 0; o[4] = 1; o[5] = c * ox - s * oy;
        },
        init: (cx, cy, A) => [cx, cy, Math.atan2(A[2] - A[1], A[0] + A[3])],
      };
    case 'LocRotScale':
      return {
        n: 4,
        unpack: (p) => ({ cx: p[0], cy: p[1], A: [p[2], -p[3], p[3], p[2]] }),
        jac: (_p, ox, oy, o) => {
          o[0] = 1; o[1] = 0; o[2] = ox; o[3] = -oy;
          o[4] = 0; o[5] = 1; o[6] = oy; o[7] = ox;
        },
        init: (cx, cy, A) => [cx, cy, (A[0] + A[3]) / 2, (A[2] - A[1]) / 2],
      };
    default:
      return {
        n: 6,
        unpack: (p) => ({ cx: p[0], cy: p[1], A: [p[2], p[3], p[4], p[5]] }),
        jac: (_p, ox, oy, o) => {
          o[0] = 1; o[1] = 0; o[2] = ox; o[3] = oy; o[4] = 0; o[5] = 0;
          o[6] = 0; o[7] = 1; o[8] = 0; o[9] = 0; o[10] = ox; o[11] = oy;
        },
        init: (cx, cy, A) => [cx, cy, A[0], A[1], A[2], A[3]],
      };
  }
}

/** Least-squares linear map taking reference corner offsets to current corner offsets. */
export function fitLinear(src: P2[], dst: P2[]): Mat2 {
  let sxx = 0,
    sxy = 0,
    syy = 0,
    axx = 0,
    axy = 0,
    ayx = 0,
    ayy = 0;
  for (let i = 0; i < src.length; i++) {
    const [x, y] = src[i],
      [u, v] = dst[i];
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    axx += u * x;
    axy += u * y;
    ayx += v * x;
    ayy += v * y;
  }
  const det = sxx * syy - sxy * sxy;
  if (Math.abs(det) < 1e-12) return [1, 0, 0, 1];
  const i00 = syy / det,
    i01 = -sxy / det,
    i11 = sxx / det;
  return [axx * i00 + axy * i01, axx * i01 + axy * i11, ayx * i00 + ayy * i01, ayx * i01 + ayy * i11];
}

// ---------------------------------------------------------------------------
// tracking

export interface TrackParams {
  model: MotionModel;
  /** anchor (marker position) and pattern corners in the reference frame */
  refCenter: P2;
  refCorners: P2[];
  /** anchor and corners in the previous frame (initial guess for the current frame) */
  prevCenter: P2;
  prevCorners: P2[];
  /** search area in the current frame (absolute pixel rect) */
  searchMin: P2;
  searchMax: P2;
  frameSize: P2;
  useBrute: boolean;
  useNormalization: boolean;
  correlationMin: number;
  margin: number;
}

export interface TrackResult {
  ok: boolean;
  center: P2;
  corners: P2[];
  correlation: number;
  reason?: string;
}

const MAX_SAMPLES = 41;

function templateOffsets(refCenter: P2, refCorners: P2[]): { ox: Float32Array; oy: Float32Array } {
  const [c0, c1, c2, c3] = refCorners;
  const edge = Math.max(Math.hypot(c1[0] - c0[0], c1[1] - c0[1]), Math.hypot(c2[0] - c1[0], c2[1] - c1[1]), Math.hypot(c3[0] - c2[0], c3[1] - c2[1]), Math.hypot(c0[0] - c3[0], c0[1] - c3[1]));
  const n = Math.max(5, Math.min(MAX_SAMPLES, Math.round(edge)));
  const ox = new Float32Array(n * n),
    oy = new Float32Array(n * n);
  let k = 0;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n,
        v = (j + 0.5) / n;
      const a = (1 - u) * (1 - v),
        b = u * (1 - v),
        c = u * v,
        d = (1 - u) * v;
      ox[k] = a * c0[0] + b * c1[0] + c * c2[0] + d * c3[0] - refCenter[0];
      oy[k] = a * c0[1] + b * c1[1] + c * c2[1] + d * c3[1] - refCenter[1];
      k++;
    }
  return { ox, oy };
}

function sampleTemplate(img: GrayRegion, scale: number, cx: number, cy: number, A: Mat2, ox: Float32Array, oy: Float32Array, out: Float32Array) {
  for (let k = 0; k < ox.length; k++) out[k] = sample(img, (cx + A[0] * ox[k] + A[1] * oy[k]) * scale, (cy + A[2] * ox[k] + A[3] * oy[k]) * scale);
}

function meanStd(a: Float32Array): [number, number] {
  let m = 0;
  for (let i = 0; i < a.length; i++) m += a[i];
  m /= a.length;
  let v = 0;
  for (let i = 0; i < a.length; i++) v += (a[i] - m) ** 2;
  return [m, Math.sqrt(v / a.length) || 1e-6];
}

/** Gauss–Newton/Levenberg refinement at one pyramid level. Returns the refined parameters. */
function refineLevel(cur: GrayRegion, T: Float32Array, scale: number, model: Model, p0: number[], ox: Float32Array, oy: Float32Array, normalize: boolean, maxIter = 40): number[] {
  const n = model.n,
    N = ox.length;
  let p = p0.slice();
  const I = new Float32Array(N);
  const jac = new Float64Array(2 * n);
  let Tn = T;
  if (normalize) {
    const [mt, st] = meanStd(T);
    Tn = new Float32Array(N);
    for (let k = 0; k < N; k++) Tn[k] = (T[k] - mt) / st;
  }
  const evalCost = (q: number[]) => {
    const { cx, cy, A } = model.unpack(q);
    sampleTemplate(cur, scale, cx, cy, A, ox, oy, I);
    let c = 0;
    if (normalize) {
      const [m, s] = meanStd(I);
      for (let k = 0; k < N; k++) c += ((I[k] - m) / s - Tn[k]) ** 2;
    } else for (let k = 0; k < N; k++) c += (I[k] - T[k]) ** 2;
    return c;
  };
  let cost = evalCost(p);
  let lambda = 1e-3;
  const H: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const g = new Array(n).fill(0);
  for (let it = 0; it < maxIter; it++) {
    const { cx, cy, A } = model.unpack(p);
    for (let a = 0; a < n; a++) {
      g[a] = 0;
      for (let b = 0; b < n; b++) H[a][b] = 0;
    }
    let m = 0,
      s = 1;
    sampleTemplate(cur, scale, cx, cy, A, ox, oy, I);
    if (normalize) [m, s] = meanStd(I);
    for (let k = 0; k < N; k++) {
      const x = (cx + A[0] * ox[k] + A[1] * oy[k]) * scale,
        y = (cy + A[2] * ox[k] + A[3] * oy[k]) * scale;
      const gx = (sample(cur, x + 1, y) - sample(cur, x - 1, y)) / 2,
        gy = (sample(cur, x, y + 1) - sample(cur, x, y - 1)) / 2;
      const r = normalize ? (I[k] - m) / s - Tn[k] : I[k] - T[k];
      model.jac(p, ox[k], oy[k], jac);
      const inv = normalize ? scale / s : scale;
      for (let a = 0; a < n; a++) {
        const ja = (gx * jac[a] + gy * jac[n + a]) * inv;
        g[a] += ja * r;
        for (let b = a; b < n; b++) H[a][b] += ja * (gx * jac[b] + gy * jac[n + b]) * inv;
      }
    }
    for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];
    let accepted = false;
    for (let tries = 0; tries < 8 && !accepted; tries++) {
      const Hd = H.map((r, i) => r.map((v, j) => (i === j ? v * (1 + lambda) + 1e-9 : v)));
      const d = solve(Hd, g.map((v) => -v));
      if (!d || d.some((v) => !Number.isFinite(v))) {
        lambda *= 10;
        continue;
      }
      const q = p.map((v, i) => v + d[i]);
      const c = evalCost(q);
      if (c <= cost) {
        const step = Math.hypot(d[0], d[1]) * scale;
        p = q;
        cost = c;
        lambda = Math.max(1e-7, lambda / 3);
        accepted = true;
        if (step < 1e-4 && d.slice(2).every((v) => Math.abs(v) < 1e-6)) return p;
      } else lambda *= 4;
    }
    if (!accepted) break;
  }
  return p;
}

/** Brute-force translation search (NCC) over the search area at one pyramid level. */
function brutePrepass(cur: GrayRegion, T: Float32Array, scale: number, A: Mat2, ox: Float32Array, oy: Float32Array, start: P2, lo: P2, hi: P2): P2 {
  const N = ox.length;
  // offsets of the warped template relative to the anchor, in level pixels
  const dx = new Float32Array(N),
    dy = new Float32Array(N);
  let minx = Infinity,
    maxx = -Infinity,
    miny = Infinity,
    maxy = -Infinity;
  for (let k = 0; k < N; k++) {
    dx[k] = (A[0] * ox[k] + A[1] * oy[k]) * scale;
    dy[k] = (A[2] * ox[k] + A[3] * oy[k]) * scale;
    minx = Math.min(minx, dx[k]);
    maxx = Math.max(maxx, dx[k]);
    miny = Math.min(miny, dy[k]);
    maxy = Math.max(maxy, dy[k]);
  }
  const sx = start[0] * scale,
    sy = start[1] * scale;
  // anchor range such that the template stays inside the search area
  const ax0 = Math.ceil(lo[0] * scale - minx - sx),
    ax1 = Math.floor(hi[0] * scale - maxx - sx);
  const ay0 = Math.ceil(lo[1] * scale - miny - sy),
    ay1 = Math.floor(hi[1] * scale - maxy - sy);
  const [mt, st] = meanStd(T);
  const Tn = new Float32Array(N);
  for (let k = 0; k < N; k++) Tn[k] = (T[k] - mt) / st;
  const buf = new Float32Array(N);
  // integer shifts keep the fractional parts: precompute bilinear weights and base indices once
  const w = cur.w,
    d = cur.data;
  const base = new Int32Array(N),
    w00 = new Float32Array(N),
    w10 = new Float32Array(N),
    w01 = new Float32Array(N),
    w11 = new Float32Array(N);
  let iminx = Infinity,
    imaxx = -Infinity,
    iminy = Infinity,
    imaxy = -Infinity;
  for (let k = 0; k < N; k++) {
    const u = sx + dx[k] - cur.x0 - 0.5,
      v = sy + dy[k] - cur.y0 - 0.5;
    const i = Math.floor(u),
      j = Math.floor(v);
    const fx = u - i,
      fy = v - j;
    base[k] = j * w + i;
    w00[k] = (1 - fx) * (1 - fy);
    w10[k] = fx * (1 - fy);
    w01[k] = (1 - fx) * fy;
    w11[k] = fx * fy;
    iminx = Math.min(iminx, i);
    imaxx = Math.max(imaxx, i + 1);
    iminy = Math.min(iminy, j);
    imaxy = Math.max(imaxy, j + 1);
  }
  let best = -Infinity,
    bx = 0,
    by = 0;
  for (let oyi = ay0; oyi <= ay1; oyi++)
    for (let oxi = ax0; oxi <= ax1; oxi++) {
      let m = 0;
      if (iminx + oxi >= 0 && imaxx + oxi < w && iminy + oyi >= 0 && imaxy + oyi < cur.h) {
        const off = oyi * w + oxi;
        for (let k = 0; k < N; k++) {
          const b = base[k] + off;
          const v = w00[k] * d[b] + w10[k] * d[b + 1] + w01[k] * d[b + w] + w11[k] * d[b + w + 1];
          buf[k] = v;
          m += v;
        }
      } else
        for (let k = 0; k < N; k++) {
          const v = sample(cur, sx + oxi + dx[k], sy + oyi + dy[k]);
          buf[k] = v;
          m += v;
        }
      m /= N;
      let sab = 0,
        sbb = 0;
      for (let k = 0; k < N; k++) {
        const d = buf[k] - m;
        sab += d * Tn[k];
        sbb += d * d;
      }
      const score = sbb > 1e-12 ? sab / Math.sqrt(sbb) : -Infinity;
      // prefer the smallest motion on ties
      if (score > best + 1e-9 || (Math.abs(score - best) <= 1e-9 && oxi * oxi + oyi * oyi < bx * bx + by * by)) {
        best = score;
        bx = oxi;
        by = oyi;
      }
    }
  if (best === -Infinity) return start;
  return [start[0] + bx / scale, start[1] + by / scale];
}

/** Number of pyramid levels to use for a search radius / pattern size. */
export function pyramidLevels(searchRadius: number, patternHalf: number): number {
  let L = 1;
  while (L < 4 && searchRadius / 2 ** L > 6 && patternHalf / 2 ** L >= 4) L++;
  return L;
}

/**
 * Track one marker from the reference frame into the current frame.
 * `refPyr`/`curPyr` are pyramids of regions that cover the pattern (reference) and the search
 * area (current) with some border.
 */
export function trackMarker(refPyr: GrayRegion[], curPyr: GrayRegion[], prm: TrackParams): TrackResult {
  const fail = (reason: string, corr = 0): TrackResult => ({ ok: false, center: prm.prevCenter, corners: prm.prevCorners, correlation: corr, reason });
  const { ox, oy } = templateOffsets(prm.refCenter, prm.refCorners);
  const N = ox.length;
  const refOff = prm.refCorners.map((c) => [c[0] - prm.refCenter[0], c[1] - prm.refCenter[1]] as P2);
  const prevOff = prm.prevCorners.map((c) => [c[0] - prm.prevCenter[0], c[1] - prm.prevCenter[1]] as P2);
  const A0 = projectModel(prm.model, fitLinear(refOff, prevOff));
  const model = makeModel(prm.model, A0);
  const levels = Math.min(refPyr.length, curPyr.length);
  // templates per level (sampled from the reference pyramid at the reference pose)
  const templates: Float32Array[] = [];
  for (let l = 0; l < levels; l++) {
    const t = new Float32Array(N);
    sampleTemplate(refPyr[l], 1 / 2 ** l, prm.refCenter[0], prm.refCenter[1], [1, 0, 0, 1], ox, oy, t);
    templates.push(t);
  }
  const [, tstd] = meanStd(templates[0]);
  if (tstd < 1e-4) return fail('pattern has no texture');
  let start: P2 = [prm.prevCenter[0], prm.prevCenter[1]];
  let top = levels - 1;
  if (prm.useBrute) {
    // choose the finest level whose search grid stays small
    const span = Math.max(prm.searchMax[0] - prm.searchMin[0], prm.searchMax[1] - prm.searchMin[1]);
    let lb = 0;
    while (lb < levels - 1 && span / 2 ** lb > 40) lb++;
    start = brutePrepass(curPyr[lb], templates[lb], 1 / 2 ** lb, A0, ox, oy, start, prm.searchMin, prm.searchMax);
    top = Math.min(top, lb);
  }
  let p = model.init(start[0], start[1], A0);
  for (let l = top; l >= 0; l--) p = refineLevel(curPyr[l], templates[l], 1 / 2 ** l, model, p, ox, oy, prm.useNormalization);
  const { cx, cy, A } = model.unpack(p);
  if (![cx, cy, ...A].every(Number.isFinite)) return fail('diverged');
  const det = A[0] * A[3] - A[1] * A[2];
  if (!(det > 0.04 && det < 25)) return fail('degenerate pattern');
  const corners = refOff.map(([x, y]) => [cx + A[0] * x + A[1] * y, cy + A[2] * x + A[3] * y] as P2);
  const I = new Float32Array(N);
  sampleTemplate(curPyr[0], 1, cx, cy, A, ox, oy, I);
  const corr = ncc(templates[0], I);
  const eps = 0.5;
  for (const [x, y] of corners) {
    if (x < prm.searchMin[0] - eps || y < prm.searchMin[1] - eps || x > prm.searchMax[0] + eps || y > prm.searchMax[1] + eps) return { ...fail('left the search area', corr) };
    if (x < prm.margin || y < prm.margin || x > prm.frameSize[0] - prm.margin || y > prm.frameSize[1] - prm.margin) return { ...fail('reached the frame margin', corr) };
  }
  if (corr < prm.correlationMin) return { ...fail('correlation below the minimum', corr) };
  return { ok: true, center: [cx, cy], corners, correlation: corr };
}

/** Pixel rect (aligned to 2^levels) that a region must cover for the given bounds plus border. */
export function regionRect(minx: number, miny: number, maxx: number, maxy: number, W: number, H: number, levels: number, border = 4): [number, number, number, number] {
  const a = 2 ** levels;
  const b = border * a;
  let x0 = Math.floor((minx - b) / a) * a,
    y0 = Math.floor((miny - b) / a) * a;
  let x1 = Math.ceil((maxx + b) / a) * a,
    y1 = Math.ceil((maxy + b) / a) * a;
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(Math.ceil(W / a) * a, x1);
  y1 = Math.min(Math.ceil(H / a) * a, y1);
  return [x0, y0, Math.max(a, x1 - x0), Math.max(a, y1 - y0)];
}

/** Crop a region out of a full grayscale frame (values outside the frame are clamped). */
export function cropRegion(frame: { w: number; h: number; data: Float32Array | Uint8Array; scale?: number }, x0: number, y0: number, w: number, h: number): GrayRegion {
  const out = new Float32Array(w * h);
  const s = frame.scale ?? (frame.data instanceof Uint8Array ? 1 / 255 : 1);
  for (let j = 0; j < h; j++) {
    const y = Math.max(0, Math.min(frame.h - 1, y0 + j));
    for (let i = 0; i < w; i++) {
      const x = Math.max(0, Math.min(frame.w - 1, x0 + i));
      out[j * w + i] = frame.data[y * frame.w + x] * s;
    }
  }
  return { x0, y0, w, h, data: out };
}
