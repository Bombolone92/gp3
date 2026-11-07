// Geometric models between matched points and robust fitting (RANSAC with a
// least-squares refit on the inliers). Matrices are row-major 3x3 mapping
// points of image A into image B: B ~ M * A.
import { applyMat3, type Mat3, type Point } from '../filters/warp';

export type Model = 'translation' | 'rigid' | 'similarity' | 'affine' | 'homography';
export type Pair = { a: Point; b: Point };
export type Fit = { m: Mat3; inliers: number[]; error: number };

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const minSamples: Record<Model, number> = { translation: 1, rigid: 2, similarity: 2, affine: 3, homography: 4 };

/** Eigen-decomposition of a symmetric n×n matrix (cyclic Jacobi). Returns
 * eigenvalues and column eigenvectors (row-major n×n). */
export function symmetricEigen(a: Float64Array, n: number): { values: Float64Array; vectors: Float64Array } {
  const A = Float64Array.from(a);
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q] * A[p * n + q];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (A[q * n + q] - A[p * n + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1),
          s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p],
            akq = A[k * n + q];
          A[k * n + p] = c * akp - s * akq;
          A[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k],
            aqk = A[q * n + k];
          A[p * n + k] = c * apk - s * aqk;
          A[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p],
            vkq = V[k * n + q];
          V[k * n + p] = c * vkp - s * vkq;
          V[k * n + q] = s * vkp + c * vkq;
        }
      }
  }
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) values[i] = A[i * n + i];
  return { values, vectors: V };
}

/** Solve a dense linear system (Gaussian elimination, partial pivoting). */
export function solveLinear(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const M = Float64Array.from(A),
    x = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]) > Math.abs(M[p * n + c])) p = r;
    if (Math.abs(M[p * n + c]) < 1e-12) return null;
    if (p !== c) {
      for (let k = 0; k < n; k++) [M[c * n + k], M[p * n + k]] = [M[p * n + k], M[c * n + k]];
      [x[c], x[p]] = [x[p], x[c]];
    }
    for (let r = c + 1; r < n; r++) {
      const f = M[r * n + c] / M[c * n + c];
      if (!f) continue;
      for (let k = c; k < n; k++) M[r * n + k] -= f * M[c * n + k];
      x[r] -= f * x[c];
    }
  }
  for (let c = n - 1; c >= 0; c--) {
    let s = x[c];
    for (let k = c + 1; k < n; k++) s -= M[c * n + k] * x[k];
    x[c] = s / M[c * n + c];
  }
  return x;
}

function centroid(pts: Point[]) {
  let x = 0,
    y = 0;
  for (const p of pts) (x += p.x), (y += p.y);
  return { x: x / pts.length, y: y / pts.length };
}
/** Hartley normalization: centroid to the origin, mean distance √2. */
function normalizer(pts: Point[]): Mat3 {
  const c = centroid(pts);
  let d = 0;
  for (const p of pts) d += Math.hypot(p.x - c.x, p.y - c.y);
  const s = d > 0 ? (pts.length * Math.SQRT2) / d : 1;
  return [s, 0, -s * c.x, 0, s, -s * c.y, 0, 0, 1];
}
const mul = (a: Mat3, b: Mat3): Mat3 => {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
};
function invertSimilarityNormalizer(t: Mat3): Mat3 {
  const s = t[0];
  return [1 / s, 0, -t[2] / s, 0, 1 / s, -t[5] / s, 0, 0, 1];
}

/** Least-squares fit of a model to point pairs (at least minSamples). */
export function fitModel(model: Model, pairs: Pair[]): Mat3 | null {
  const n = pairs.length;
  if (n < minSamples[model]) return null;
  const A = pairs.map((p) => p.a),
    B = pairs.map((p) => p.b);
  if (model === 'translation') {
    const ca = centroid(A),
      cb = centroid(B);
    return [1, 0, cb.x - ca.x, 0, 1, cb.y - ca.y, 0, 0, 1];
  }
  if (model === 'rigid' || model === 'similarity') {
    // Umeyama / Procrustes in closed form for 2D.
    const ca = centroid(A),
      cb = centroid(B);
    let sxx = 0,
      sxy = 0,
      va = 0;
    for (let i = 0; i < n; i++) {
      const ax = A[i].x - ca.x,
        ay = A[i].y - ca.y,
        bx = B[i].x - cb.x,
        by = B[i].y - cb.y;
      sxx += ax * bx + ay * by;
      sxy += ax * by - ay * bx;
      va += ax * ax + ay * ay;
    }
    const theta = Math.atan2(sxy, sxx);
    const s = model === 'similarity' ? (va > 0 ? Math.hypot(sxx, sxy) / va : 1) : 1;
    const c = Math.cos(theta) * s,
      si = Math.sin(theta) * s;
    return [c, -si, cb.x - (c * ca.x - si * ca.y), si, c, cb.y - (si * ca.x + c * ca.y), 0, 0, 1];
  }
  const Ta = normalizer(A),
    Tb = normalizer(B);
  const na = A.map((p) => applyMat3(Ta, p.x, p.y)),
    nb = B.map((p) => applyMat3(Tb, p.x, p.y));
  let m: Mat3;
  if (model === 'affine') {
    // Two independent 3-parameter least-squares problems sharing A^T A.
    const ata = new Float64Array(9),
      atx = new Float64Array(3),
      aty = new Float64Array(3);
    for (let i = 0; i < n; i++) {
      const r = [na[i].x, na[i].y, 1];
      for (let j = 0; j < 3; j++) {
        for (let k = 0; k < 3; k++) ata[j * 3 + k] += r[j] * r[k];
        atx[j] += r[j] * nb[i].x;
        aty[j] += r[j] * nb[i].y;
      }
    }
    const px = solveLinear(ata, atx, 3),
      py = solveLinear(ata, aty, 3);
    if (!px || !py) return null;
    m = [px[0], px[1], px[2], py[0], py[1], py[2], 0, 0, 1];
  } else {
    // Direct linear transform: h is the eigenvector of A^T A with the
    // smallest eigenvalue.
    const ata = new Float64Array(81);
    const row = new Float64Array(9);
    const add = () => {
      for (let j = 0; j < 9; j++) for (let k = j; k < 9; k++) ata[j * 9 + k] += row[j] * row[k];
    };
    for (let i = 0; i < n; i++) {
      const { x, y } = na[i],
        u = nb[i].x,
        v = nb[i].y;
      row.set([x, y, 1, 0, 0, 0, -u * x, -u * y, -u]);
      add();
      row.set([0, 0, 0, x, y, 1, -v * x, -v * y, -v]);
      add();
    }
    for (let j = 0; j < 9; j++) for (let k = 0; k < j; k++) ata[j * 9 + k] = ata[k * 9 + j];
    const { values, vectors } = symmetricEigen(ata, 9);
    let best = 0;
    for (let i = 1; i < 9; i++) if (values[i] < values[best]) best = i;
    m = Array.from({ length: 9 }, (_, i) => vectors[i * 9 + best]) as Mat3;
  }
  let out = mul(invertSimilarityNormalizer(Tb), mul(m, Ta));
  if (!out.every(Number.isFinite) || Math.abs(out[8]) < 1e-12) return null;
  out = out.map((v) => v / out[8]) as Mat3;
  return out;
}

export function reprojectionError(m: Mat3, p: Pair) {
  const w = m[6] * p.a.x + m[7] * p.a.y + m[8];
  if (w <= 1e-9) return Infinity;
  const q = applyMat3(m, p.a.x, p.a.y);
  return Math.hypot(q.x - p.b.x, q.y - p.b.y);
}

/** Small deterministic generator (xorshift32) so fits are reproducible. */
export function seeded(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** True when a homography keeps a reasonable shape (no flips or collapse). */
export function plausible(m: Mat3, model: Model, width: number, height: number) {
  if (model !== 'homography' && model !== 'affine') return true;
  const corners = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([x, y]) => {
    const w = m[6] * x + m[7] * y + m[8];
    return w > 0 ? applyMat3(m, x, y) : null;
  });
  if (corners.some((c) => !c)) return false;
  const q = corners as Point[];
  // Convex with consistent orientation and an area within a sane range.
  let sign = 0,
    area = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i],
      b = q[(i + 1) % 4],
      c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (!sign) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
    area += a.x * b.y - b.x * a.y;
  }
  const ratio = Math.abs(area / 2) / (width * height);
  return sign > 0 && ratio > 0.1 && ratio < 10;
}

export type RansacOptions = { threshold?: number; iterations?: number; confidence?: number; seed?: number; width?: number; height?: number };

/** Robust fit: random minimal samples, consensus by reprojection error, then
 * iterated least squares on the inliers. */
export function ransac(model: Model, pairs: Pair[], opts: RansacOptions = {}): Fit | null {
  const k = minSamples[model];
  const n = pairs.length;
  if (n < k) return null;
  const threshold = opts.threshold ?? 3,
    confidence = opts.confidence ?? 0.995;
  let maxIter = opts.iterations ?? 2000;
  const rand = seeded(opts.seed ?? 7);
  let best: number[] = [];
  let bestErr = Infinity;
  const pick = new Array<number>(k);
  for (let it = 0; it < maxIter; it++) {
    for (let j = 0; j < k; j++) {
      let r: number;
      do r = Math.floor(rand() * n);
      while (pick.slice(0, j).includes(r));
      pick[j] = r;
    }
    const m = fitModel(model, pick.map((i) => pairs[i]));
    if (!m || (opts.width && !plausible(m, model, opts.width, opts.height ?? opts.width))) continue;
    const inl: number[] = [];
    let err = 0;
    for (let i = 0; i < n; i++) {
      const e = reprojectionError(m, pairs[i]);
      if (e < threshold) {
        inl.push(i);
        err += e;
      }
    }
    if (inl.length > best.length || (inl.length === best.length && err < bestErr)) {
      best = inl;
      bestErr = err;
      // Adaptive stopping once the inlier ratio is known well enough.
      const w = inl.length / n;
      const p = Math.pow(w, k);
      if (p > 0 && p < 1) maxIter = Math.min(maxIter, Math.ceil(Math.log(1 - confidence) / Math.log(1 - p)) + 10);
      else if (p >= 1) break;
    }
  }
  if (best.length < k) return null;
  let m = fitModel(model, best.map((i) => pairs[i]));
  if (!m) return null;
  for (let round = 0; round < 3; round++) {
    const inl: number[] = [];
    for (let i = 0; i < n; i++) if (reprojectionError(m, pairs[i]) < threshold) inl.push(i);
    if (inl.length < k) break;
    const next = fitModel(model, inl.map((i) => pairs[i]));
    if (!next) break;
    m = next;
    best = inl;
  }
  let error = 0;
  for (const i of best) error += reprojectionError(m, pairs[i]) ** 2;
  return { m, inliers: best, error: Math.sqrt(error / Math.max(1, best.length)) };
}
