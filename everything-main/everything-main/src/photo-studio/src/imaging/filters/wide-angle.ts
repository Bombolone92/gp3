// Wide Angle Correction: straightens lines bent by wide lenses. Each pixel is
// back-projected through a camera model (fisheye, rectilinear or full
// spherical) onto the unit sphere, where a straight world line is a great
// circle. A grid mesh over the image is then placed by a sparse least-squares
// solve: every triangle keeps the shape it has under a content-preserving base
// projection (as-similar-as-possible), while samples along each user
// constraint are pulled onto one straight output line (optionally horizontal
// or vertical). The line direction is fixed for each linear solve and
// re-estimated between solves. Rendering inverse-maps every output triangle
// affinely to the input and samples bilinearly.
//
// Coordinates: pixel centers are at i + 0.5, image y points down, sphere
// directions use x right, y down, z forward (the optical axis).
import { checkCancelled, rgba8, type Progress, type RGBA8 } from '../types';
import { sampleBilinear } from './sampling';

export type WideAngleModel = 'auto' | 'fisheye' | 'perspective' | 'spherical';
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Camera = { model: WideAngleModel; width: number; height: number; focalPx: number };
export type ConstraintOrientation = 'any' | 'horizontal' | 'vertical';
/** A constraint in image pixels. */
export type PixelConstraint = { a: Vec2; b: Vec2; orient?: ConstraintOrientation };
/** A constraint in normalized coordinates (0..1 of width and height). */
export type WideAngleConstraint = { a: Vec2; b: Vec2; orient?: ConstraintOrientation };
export type WideAngleParams = {
  model: WideAngleModel;
  focalLength: number; // millimeters
  cropFactor: number; // sensor crop relative to a 36 x 24 mm frame
  scale: number; // percent
  constraints: WideAngleConstraint[];
};
export type WideAngleMesh = {
  width: number;
  height: number;
  cols: number; // cells
  rows: number;
  // Vertex positions, (cols + 1) * (rows + 1) pairs, row-major.
  src: Float64Array; // input image
  dst: Float64Array; // output image
};

export const defaultWideAngleParams = (): WideAngleParams => ({ model: 'fisheye', focalLength: 12, cropFactor: 1, scale: 100, constraints: [] });

// Diagonal of a 36 x 24 mm frame.
const FRAME_DIAGONAL_MM = Math.hypot(36, 24);
/** Focal length in pixels for a lens of `focalLength` mm on a sensor with `cropFactor`. */
export function focalLengthToPixels(focalLength: number, cropFactor: number, width: number, height: number): number {
  return (Math.max(0.1, focalLength) * Math.max(0.1, cropFactor) * Math.hypot(width, height)) / FRAME_DIAGONAL_MM;
}
export function cameraFor(params: Pick<WideAngleParams, 'model' | 'focalLength' | 'cropFactor'>, width: number, height: number): Camera {
  return { model: params.model, width, height, focalPx: focalLengthToPixels(params.focalLength, params.cropFactor, width, height) };
}
const modelOf = (cam: Camera) => (cam.model === 'auto' ? 'fisheye' : cam.model);

/** Unit viewing direction of an image point. */
export function imageToSphere(cam: Camera, x: number, y: number): Vec3 {
  const m = modelOf(cam);
  if (m === 'spherical') {
    const lon = (x / cam.width - 0.5) * 2 * Math.PI,
      lat = (0.5 - y / cam.height) * Math.PI;
    return [Math.cos(lat) * Math.sin(lon), -Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
  }
  const dx = x - cam.width / 2,
    dy = y - cam.height / 2,
    f = cam.focalPx;
  if (m === 'perspective') {
    const n = Math.hypot(dx, dy, f);
    return [dx / n, dy / n, f / n];
  }
  const r = Math.hypot(dx, dy);
  if (r < 1e-12) return [0, 0, 1];
  const t = r / f,
    s = Math.sin(t) / r;
  return [dx * s, dy * s, Math.cos(t)];
}
/** Image point of a viewing direction ([NaN, NaN] when the model cannot show it). */
export function sphereToImage(cam: Camera, d: Vec3): Vec2 {
  const m = modelOf(cam);
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  const x = d[0] / n,
    y = d[1] / n,
    z = d[2] / n;
  if (m === 'spherical') {
    const lon = Math.atan2(x, z),
      lat = Math.asin(Math.max(-1, Math.min(1, -y)));
    return [(lon / (2 * Math.PI) + 0.5) * cam.width, (0.5 - lat / Math.PI) * cam.height];
  }
  const cx = cam.width / 2,
    cy = cam.height / 2,
    f = cam.focalPx;
  if (m === 'perspective') {
    if (z <= 1e-9) return [NaN, NaN];
    return [cx + (f * x) / z, cy + (f * y) / z];
  }
  const s = Math.hypot(x, y);
  if (s < 1e-12) return [cx, cy];
  const r = f * Math.atan2(s, z);
  return [cx + (x / s) * r, cy + (y / s) * r];
}

/** Samples of the great-circle arc through two image points: the curve a
 * straight world line follows in the image. */
export function fitConstraintArc(cam: Camera, a: Vec2, b: Vec2, samples = 32): Vec2[] {
  const da = imageToSphere(cam, a[0], a[1]),
    db = imageToSphere(cam, b[0], b[1]);
  const dot = Math.max(-1, Math.min(1, da[0] * db[0] + da[1] * db[1] + da[2] * db[2]));
  const omega = Math.acos(dot);
  const n = Math.max(2, Math.round(samples));
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    if (i === 0) out.push([a[0], a[1]]);
    else if (i === n - 1) out.push([b[0], b[1]]);
    else if (omega < 1e-9) out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    else {
      const sa = Math.sin((1 - t) * omega) / Math.sin(omega),
        sb = Math.sin(t * omega) / Math.sin(omega);
      out.push(sphereToImage(cam, [da[0] * sa + db[0] * sb, da[1] * sa + db[1] * sb, da[2] * sa + db[2] * sb]));
    }
  }
  return out;
}

/** Content-preserving base placement of an input point before constraints:
 * fisheye images go to a stereographic (conformal) projection normalized so
 * the middles of the longer edges stay put (the corners spread past the frame
 * rather than the frame caving in); rectilinear and spherical inputs keep
 * their geometry. */
export function baseProjection(cam: Camera): (x: number, y: number) => Vec2 {
  const m = modelOf(cam);
  if (m !== 'fisheye') return (x, y) => [x, y];
  const cx = cam.width / 2,
    cy = cam.height / 2,
    f = cam.focalPx;
  const R = Math.max(cx, cy);
  const thetaR = Math.min(0.95 * Math.PI, R / f);
  const fs = R / (2 * Math.tan(thetaR / 2));
  return (x, y) => {
    const dx = x - cx,
      dy = y - cy,
      r = Math.hypot(dx, dy);
    if (r < 1e-12) return [cx, cy];
    const t = Math.min(0.98 * Math.PI, r / f);
    const r2 = 2 * fs * Math.tan(t / 2);
    return [cx + (dx / r) * r2, cy + (dy / r) * r2];
  };
}

// ----------------------------------------------------------------- solver

// Sparse least-squares rows: sum(coef * x[idx]) = rhs, with a weight.
class Rows {
  start: number[] = [0];
  idx: number[] = [];
  val: number[] = [];
  rhs: number[] = [];
  w: number[] = [];
  private acc = new Map<number, number>();
  add(i: number, v: number) {
    if (v) this.acc.set(i, (this.acc.get(i) ?? 0) + v);
  }
  end(rhs: number, w: number) {
    for (const [i, v] of this.acc) {
      if (!v) continue;
      this.idx.push(i);
      this.val.push(v);
    }
    this.acc.clear();
    this.start.push(this.idx.length);
    this.rhs.push(rhs);
    this.w.push(w);
  }
  get count() {
    return this.rhs.length;
  }
}

// Minimizes sum w_r (a_r . x - b_r)^2 by Jacobi-preconditioned conjugate
// gradients on the normal equations, starting from x (updated in place).
function solveLeastSquares(rows: Rows, x: Float64Array, iterations: number, progress?: Progress) {
  const n = x.length,
    m = rows.count;
  const { start, idx, val, rhs, w } = rows;
  const diag = new Float64Array(n);
  for (let r = 0; r < m; r++) for (let k = start[r]; k < start[r + 1]; k++) diag[idx[k]] += w[r] * val[k] * val[k];
  for (let i = 0; i < n; i++) diag[i] = diag[i] > 1e-12 ? 1 / diag[i] : 0;
  const tmp = new Float64Array(m);
  // y = A^T W (A x - c * b)
  const normal = (v: Float64Array, out: Float64Array, withRhs: boolean) => {
    for (let r = 0; r < m; r++) {
      let s = withRhs ? -rhs[r] : 0;
      for (let k = start[r]; k < start[r + 1]; k++) s += val[k] * v[idx[k]];
      tmp[r] = s * w[r];
    }
    out.fill(0);
    for (let r = 0; r < m; r++) {
      const t = tmp[r];
      if (t) for (let k = start[r]; k < start[r + 1]; k++) out[idx[k]] += val[k] * t;
    }
  };
  const g = new Float64Array(n),
    z = new Float64Array(n),
    p = new Float64Array(n),
    q = new Float64Array(n);
  normal(x, g, true); // gradient: A^T W (A x - b); residual = -g
  for (let i = 0; i < n; i++) {
    g[i] = -g[i];
    z[i] = g[i] * diag[i];
    p[i] = z[i];
  }
  let rz = 0;
  for (let i = 0; i < n; i++) rz += g[i] * z[i];
  const rz0 = rz;
  for (let it = 0; it < iterations && rz > 1e-18 * Math.max(1, rz0); it++) {
    if ((it & 15) === 0) checkCancelled(progress);
    normal(p, q, false);
    let pq = 0;
    for (let i = 0; i < n; i++) pq += p[i] * q[i];
    if (pq <= 1e-30) break;
    const alpha = rz / pq;
    let rz2 = 0;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      g[i] -= alpha * q[i];
      z[i] = g[i] * diag[i];
      rz2 += g[i] * z[i];
    }
    const beta = rz2 / rz;
    rz = rz2;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }
}

export type SolveOptions = {
  width: number;
  height: number;
  model: WideAngleModel;
  focalPx: number;
  scale?: number; // percent
  constraints: PixelConstraint[];
  cols?: number; // mesh cells across (default 48)
  progress?: Progress;
};

const SHAPE_WEIGHT = 1;
const ANCHOR_WEIGHT = 0.02;
const LINE_WEIGHT = 40;
const OUTER_ITERATIONS = 5;
const ARC_SAMPLES = 32;

/** Place the correction mesh for a camera and its line constraints. */
export function solveWideAngle(opts: SolveOptions): WideAngleMesh {
  const { width: W, height: H } = opts;
  const cols = Math.max(2, Math.round(opts.cols ?? 48));
  const rows = Math.max(2, Math.round((cols * H) / W));
  const nx = cols + 1,
    ny = rows + 1,
    nv = nx * ny;
  const cam: Camera = { model: opts.model, width: W, height: H, focalPx: opts.focalPx };
  const base = baseProjection(cam);
  const src = new Float64Array(nv * 2),
    B = new Float64Array(nv * 2);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const v = j * nx + i,
        x = (i * W) / cols,
        y = (j * H) / rows;
      src[2 * v] = x;
      src[2 * v + 1] = y;
      const [bx, by] = base(x, y);
      B[2 * v] = bx;
      B[2 * v + 1] = by;
    }
  const X = new Float64Array(B);

  // Fixed rows: triangle similarity and a weak anchor to the base placement.
  const shape = new Rows();
  const tri = (a: number, b: number, c: number) => {
    // c = a + u (b - a) + v R90 (b - a), R90(x, y) = (-y, x), from the base shape.
    const ex = B[2 * b] - B[2 * a],
      ey = B[2 * b + 1] - B[2 * a + 1];
    const dx = B[2 * c] - B[2 * a],
      dy = B[2 * c + 1] - B[2 * a + 1];
    const e2 = ex * ex + ey * ey;
    if (e2 < 1e-12) return;
    const u = (dx * ex + dy * ey) / e2,
      v = (dx * -ey + dy * ex) / e2;
    // x: Cx - Ax - u (Bx - Ax) + v (By - Ay) = 0
    shape.add(2 * c, 1);
    shape.add(2 * a, -1 + u);
    shape.add(2 * b, -u);
    shape.add(2 * b + 1, v);
    shape.add(2 * a + 1, -v);
    shape.end(0, SHAPE_WEIGHT);
    // y: Cy - Ay - u (By - Ay) - v (Bx - Ax) = 0
    shape.add(2 * c + 1, 1);
    shape.add(2 * a + 1, -1 + u);
    shape.add(2 * b + 1, -u);
    shape.add(2 * b, -v);
    shape.add(2 * a, v);
    shape.end(0, SHAPE_WEIGHT);
  };
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = j * nx + i,
        b = a + 1,
        c = a + nx + 1,
        d = a + nx;
      for (const [p, q, r] of [
        [a, b, c],
        [b, c, d],
        [c, d, a],
        [d, a, b],
      ])
        for (const [s, t, o] of [
          [p, q, r],
          [q, r, p],
          [r, p, q],
        ])
          tri(s, t, o);
    }
  for (let v = 0; v < nv; v++) {
    shape.add(2 * v, 1);
    shape.end(B[2 * v], ANCHOR_WEIGHT);
    shape.add(2 * v + 1, 1);
    shape.end(B[2 * v + 1], ANCHOR_WEIGHT);
  }

  // Constraint samples as bilinear combinations of mesh vertices.
  type Sample = { v: number[]; w: number[] };
  const sampleAt = (x: number, y: number): Sample | null => {
    if (!(x >= 0 && y >= 0 && x <= W && y <= H)) return null;
    const gx = Math.min(cols - 1e-9, (x / W) * cols),
      gy = Math.min(rows - 1e-9, (y / H) * rows);
    const i = Math.floor(gx),
      j = Math.floor(gy),
      fx = gx - i,
      fy = gy - j;
    const a = j * nx + i;
    return { v: [a, a + 1, a + nx, a + nx + 1], w: [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy] };
  };
  const lines = opts.constraints
    .map((c) => ({ orient: c.orient ?? 'any', samples: fitConstraintArc(cam, c.a, c.b, ARC_SAMPLES).map(([x, y]) => sampleAt(x, y)).filter((s): s is Sample => !!s) }))
    .filter((l) => l.samples.length >= 2);
  const pos = (s: Sample): Vec2 => {
    let x = 0,
      y = 0;
    for (let k = 0; k < 4; k++) {
      x += s.w[k] * X[2 * s.v[k]];
      y += s.w[k] * X[2 * s.v[k] + 1];
    }
    return [x, y];
  };

  if (lines.length) {
    for (let outer = 0; outer < OUTER_ITERATIONS; outer++) {
      checkCancelled(opts.progress);
      opts.progress?.report?.(outer / OUTER_ITERATIONS);
      const all = new Rows();
      all.start = shape.start.slice();
      all.idx = shape.idx.slice();
      all.val = shape.val.slice();
      all.rhs = shape.rhs.slice();
      all.w = shape.w.slice();
      for (const l of lines) {
        const s0 = l.samples[0],
          sN = l.samples[l.samples.length - 1];
        let n: Vec2;
        if (l.orient === 'horizontal') n = [0, 1];
        else if (l.orient === 'vertical') n = [1, 0];
        else {
          const p0 = pos(s0),
            pN = pos(sN);
          const dx = pN[0] - p0[0],
            dy = pN[1] - p0[1],
            len = Math.hypot(dx, dy) || 1;
          n = [-dy / len, dx / len];
        }
        const w = LINE_WEIGHT / Math.sqrt(l.samples.length);
        for (let k = 1; k < l.samples.length; k++) {
          const s = l.samples[k];
          for (let q = 0; q < 4; q++) {
            all.add(2 * s.v[q], n[0] * s.w[q]);
            all.add(2 * s.v[q] + 1, n[1] * s.w[q]);
            all.add(2 * s0.v[q], -n[0] * s0.w[q]);
            all.add(2 * s0.v[q] + 1, -n[1] * s0.w[q]);
          }
          all.end(0, w);
        }
      }
      solveLeastSquares(all, X, 300, opts.progress);
    }
  }
  const s = (opts.scale ?? 100) / 100,
    cx = W / 2,
    cy = H / 2;
  const dst = new Float64Array(nv * 2);
  for (let v = 0; v < nv; v++) {
    dst[2 * v] = cx + (X[2 * v] - cx) * s;
    dst[2 * v + 1] = cy + (X[2 * v + 1] - cy) * s;
  }
  opts.progress?.report?.(1);
  return { width: W, height: H, cols, rows, src, dst };
}

// ---------------------------------------------------------------- render

/** Resample `src` through the mesh: each output triangle maps affinely to its
 * input triangle. Output has the mesh's size; uncovered pixels are transparent. */
export function renderWideAngle(src: RGBA8, mesh: WideAngleMesh, progress?: Progress): RGBA8 {
  const W = mesh.width,
    H = mesh.height;
  const out = rgba8(W, H),
    od = out.data;
  // The mesh may be solved at another size than the image (previews).
  const ksx = src.width / W,
    ksy = src.height / H;
  const filled = new Uint8Array(W * H);
  const px = new Float32Array(4);
  const nx = mesh.cols + 1;
  const { src: S, dst: D } = mesh;
  const total = mesh.cols * mesh.rows;
  const raster = (a: number, b: number, c: number) => {
    const x0 = D[2 * a], y0 = D[2 * a + 1], x1 = D[2 * b], y1 = D[2 * b + 1], x2 = D[2 * c], y2 = D[2 * c + 1];
    const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(det) < 1e-9) return;
    // Affine output -> input from barycentric coordinates.
    const u0 = S[2 * a] * ksx, v0 = S[2 * a + 1] * ksy;
    const du1 = S[2 * b] * ksx - u0, dv1 = S[2 * b + 1] * ksy - v0;
    const du2 = S[2 * c] * ksx - u0, dv2 = S[2 * c + 1] * ksy - v0;
    const ymin = Math.max(0, Math.ceil(Math.min(y0, y1, y2) - 0.5)),
      ymax = Math.min(H - 1, Math.floor(Math.max(y0, y1, y2) - 0.5));
    const eps = 1e-7;
    for (let y = ymin; y <= ymax; y++) {
      const yc = y + 0.5;
      let lo = Infinity,
        hi = -Infinity;
      for (const [ax, ay, bx, by] of [
        [x0, y0, x1, y1],
        [x1, y1, x2, y2],
        [x2, y2, x0, y0],
      ]) {
        if ((yc < Math.min(ay, by) - eps) || (yc > Math.max(ay, by) + eps)) continue;
        if (Math.abs(by - ay) < 1e-12) {
          lo = Math.min(lo, ax, bx);
          hi = Math.max(hi, ax, bx);
        } else {
          const xi = ax + ((yc - ay) * (bx - ax)) / (by - ay);
          lo = Math.min(lo, xi);
          hi = Math.max(hi, xi);
        }
      }
      if (!(hi >= lo)) continue;
      const xs = Math.max(0, Math.ceil(lo - 0.5 - eps)),
        xe = Math.min(W - 1, Math.floor(hi - 0.5 + eps));
      for (let x = xs; x <= xe; x++) {
        const i = y * W + x;
        if (filled[i]) continue;
        const xc = x + 0.5;
        const l1 = ((xc - x0) * (y2 - y0) - (x2 - x0) * (yc - y0)) / det,
          l2 = ((x1 - x0) * (yc - y0) - (xc - x0) * (y1 - y0)) / det;
        sampleBilinear(src, u0 + du1 * l1 + du2 * l2, v0 + dv1 * l1 + dv2 * l2, 'transparent', px, 0);
        filled[i] = 1;
        const o = i * 4;
        od[o] = px[0];
        od[o + 1] = px[1];
        od[o + 2] = px[2];
        od[o + 3] = px[3];
      }
    }
  };
  for (let j = 0; j < mesh.rows; j++) {
    checkCancelled(progress);
    progress?.report?.((j * mesh.cols) / total);
    for (let i = 0; i < mesh.cols; i++) {
      const a = j * nx + i;
      raster(a, a + 1, a + nx + 1);
      raster(a, a + nx + 1, a + nx);
    }
  }
  progress?.report?.(1);
  return out;
}

/** Normalize untrusted settings (recorded actions, saved projects). */
export function sanitizeWideAngleParams(p: Partial<WideAngleParams> | undefined): WideAngleParams {
  const d = defaultWideAngleParams();
  const num = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
  const vec = (v: unknown): Vec2 | null => (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [Math.min(1, Math.max(0, v[0])), Math.min(1, Math.max(0, v[1]))] : null);
  const constraints: WideAngleConstraint[] = [];
  for (const c of Array.isArray(p?.constraints) ? p!.constraints.slice(0, 64) : []) {
    const a = vec(c?.a),
      b = vec(c?.b);
    if (!a || !b) continue;
    const orient = c.orient === 'horizontal' || c.orient === 'vertical' ? c.orient : 'any';
    constraints.push({ a, b, orient });
  }
  return {
    model: p?.model && ['auto', 'fisheye', 'perspective', 'spherical'].includes(p.model) ? p.model : d.model,
    focalLength: num(p?.focalLength, 1, 200, d.focalLength),
    cropFactor: num(p?.cropFactor, 0.1, 10, d.cropFactor),
    scale: num(p?.scale, 50, 150, d.scale),
    constraints,
  };
}

/** Wide Angle Correction with serializable settings (constraints normalized
 * to the image), for the filter worker and scaled previews. */
export function applyWideAngle(src: RGBA8, params: WideAngleParams, progress?: Progress): RGBA8 {
  const p = sanitizeWideAngleParams(params);
  const W = src.width,
    H = src.height;
  const mesh = solveWideAngle({
    width: W,
    height: H,
    model: p.model,
    focalPx: focalLengthToPixels(p.focalLength, p.cropFactor, W, H),
    scale: p.scale,
    constraints: p.constraints.map((c) => ({ a: [c.a[0] * W, c.a[1] * H], b: [c.b[0] * W, c.b[1] * H], orient: c.orient })),
    progress: progress && { cancelled: progress.cancelled, report: progress.report && ((f) => progress.report!(f * 0.5)) },
  });
  return renderWideAngle(src, mesh, progress && { cancelled: progress.cancelled, report: progress.report && ((f) => progress.report!(0.5 + f * 0.5)) });
}

/** Map a point through the mesh, input to output (`forward`) or back, by
 * locating its triangle and interpolating barycentrically; null outside. */
export function meshMap(mesh: WideAngleMesh, x: number, y: number, forward: boolean): Vec2 | null {
  const from = forward ? mesh.src : mesh.dst,
    to = forward ? mesh.dst : mesh.src;
  const nx = mesh.cols + 1;
  let best: Vec2 | null = null;
  for (let r = 0; r < mesh.rows; r++)
    for (let c = 0; c < mesh.cols; c++) {
      const i00 = r * nx + c,
        i10 = i00 + 1,
        i01 = i00 + nx,
        i11 = i01 + 1;
      for (const [a, b, d] of [[i00, i10, i11], [i00, i11, i01]] as const) {
        const ax = from[a * 2], ay = from[a * 2 + 1], bx = from[b * 2], by = from[b * 2 + 1], dx = from[d * 2], dy = from[d * 2 + 1];
        const det = (by - dy) * (ax - dx) + (dx - bx) * (ay - dy);
        if (Math.abs(det) < 1e-12) continue;
        const l1 = ((by - dy) * (x - dx) + (dx - bx) * (y - dy)) / det,
          l2 = ((dy - ay) * (x - dx) + (ax - dx) * (y - dy)) / det,
          l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        best = [l1 * to[a * 2] + l2 * to[b * 2] + l3 * to[d * 2], l1 * to[a * 2 + 1] + l2 * to[b * 2 + 1] + l3 * to[d * 2 + 1]];
        return best;
      }
    }
  return best;
}
