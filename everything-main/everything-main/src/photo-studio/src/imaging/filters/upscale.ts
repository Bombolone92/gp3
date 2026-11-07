// Enhanced Upscale: edge-directed enlargement for Image → Upscale.
//
// Each doubling uses directional cubic convolution interpolation (Zhou, Shen
// and Zeng, "Image zooming using directional cubic convolution
// interpolation", IET Image Processing 2012): new pixels between four known
// ones are interpolated along whichever diagonal the image changes least,
// then the remaining pixels along the horizontal or vertical, with a smooth
// blend where no direction dominates. Edges stay continuous instead of
// stair-stepping. Directions come from one luminance-like guide so all
// channels agree. Enlargements that are not a power of two double past the
// target and reduce with an area-correct cubic filter. A final detail pass
// sharpens with an unsharp mask whose result is clamped to the local range of
// the unsharpened image, so it cannot add halos.
//
// Colors are processed premultiplied by alpha so transparent pixels do not
// bleed into edges.
import { checkCancelled, type Progress, type RGBA8 } from '../types';
import { clamp, gaussianPlane } from './common';
import { cubicBC } from './sampling';

type Dirs = { w: number; h: number; t1: Uint8Array; t2: Uint8Array };
const PAD = 2;

// Pick between two interpolations from the gradient sums along each
// direction: a clear winner is used alone (ratio above 1.15), otherwise the
// weights 1 / (1 + d^5) blend them. Returns the weight of interpolation A.
function direction(dA: number, dB: number): number {
  if ((1 + dB) / (1 + dA) > 1.15) return 255;
  if ((1 + dA) / (1 + dB) > 1.15) return 0;
  const wa = 1 / (1 + dA ** 5), wb = 1 / (1 + dB ** 5);
  return Math.round((255 * wa) / (wa + wb));
}

/** One 2x step of a plane: returns a (2w)x(2h) plane where input pixel i
 * lands on output pixel 2i. Directions come from `dirs` when given (shared
 * between channels), otherwise they are measured on this plane and returned. */
function double(P: Float32Array, w: number, h: number, dirs?: Dirs): { out: Float32Array; dirs: Dirs } {
  const pw = w + 2 * PAD, ph = h + 2 * PAD;
  const W = 2 * pw - 1, H = 2 * ph - 1;
  const L = (x: number, y: number) => P[clamp(y - PAD, 0, h - 1) * w + clamp(x - PAD, 0, w - 1)];
  const Q = new Float32Array(W * H);
  // Known pixels on even positions; others start as their nearest known pixel
  // so reads near the padded border stay sensible.
  for (let Y = 0; Y < H; Y++)
    for (let X = 0; X < W; X++) Q[Y * W + X] = L(X >> 1, Y >> 1);
  const measure = !dirs;
  const t1 = dirs?.t1 ?? new Uint8Array(W * H), t2 = dirs?.t2 ?? new Uint8Array(W * H);
  // Pass 1: centers of 2x2 blocks, along the diagonals.
  for (let Y = 1; Y < H - 1; Y += 2)
    for (let X = 1; X < W - 1; X += 2) {
      const x0 = (X - 1) >> 1, y0 = (Y - 1) >> 1, k = Y * W + X;
      if (measure) {
        let d45 = 0, d135 = 0;
        for (let b = -1; b <= 1; b++)
          for (let a = -1; a <= 1; a++) {
            d45 += Math.abs(L(x0 + a + 1, y0 + b) - L(x0 + a, y0 + b + 1));
            d135 += Math.abs(L(x0 + a + 1, y0 + b + 1) - L(x0 + a, y0 + b));
          }
        t1[k] = direction(d45, d135);
      }
      const t = t1[k] / 255;
      const p45 = (-L(x0 + 2, y0 - 1) + 9 * L(x0 + 1, y0) + 9 * L(x0, y0 + 1) - L(x0 - 1, y0 + 2)) / 16;
      const p135 = (-L(x0 - 1, y0 - 1) + 9 * L(x0, y0) + 9 * L(x0 + 1, y0 + 1) - L(x0 + 2, y0 + 2)) / 16;
      Q[k] = t * p45 + (1 - t) * p135;
    }
  // Pass 2: the remaining pixels, along the rows or the columns.
  const q = (X: number, Y: number) => Q[clamp(Y, 0, H - 1) * W + clamp(X, 0, W - 1)];
  for (let Y = 1; Y < H - 1; Y++)
    for (let X = 1 + (Y & 1); X < W - 1; X += 2) {
      const k = Y * W + X;
      if (measure) {
        const dH =
          Math.abs(q(X + 1, Y) - q(X - 1, Y)) * 2 + Math.abs(q(X + 3, Y) - q(X + 1, Y)) + Math.abs(q(X - 1, Y) - q(X - 3, Y)) +
          Math.abs(q(X + 2, Y - 1) - q(X, Y - 1)) + Math.abs(q(X, Y - 1) - q(X - 2, Y - 1)) + Math.abs(q(X + 2, Y + 1) - q(X, Y + 1)) + Math.abs(q(X, Y + 1) - q(X - 2, Y + 1));
        const dV =
          Math.abs(q(X, Y + 1) - q(X, Y - 1)) * 2 + Math.abs(q(X, Y + 3) - q(X, Y + 1)) + Math.abs(q(X, Y - 1) - q(X, Y - 3)) +
          Math.abs(q(X - 1, Y + 2) - q(X - 1, Y)) + Math.abs(q(X - 1, Y) - q(X - 1, Y - 2)) + Math.abs(q(X + 1, Y + 2) - q(X + 1, Y)) + Math.abs(q(X + 1, Y) - q(X + 1, Y - 2));
        t2[k] = direction(dH, dV);
      }
      const t = t2[k] / 255;
      const pH = (-q(X - 3, Y) + 9 * q(X - 1, Y) + 9 * q(X + 1, Y) - q(X + 3, Y)) / 16;
      const pV = (-q(X, Y - 3) + 9 * q(X, Y - 1) + 9 * q(X, Y + 1) - q(X, Y + 3)) / 16;
      Q[k] = t * pH + (1 - t) * pV;
    }
  // Crop the padding: input pixel 0 sits at padded position 2, output 4.
  const ow = 2 * w, oh = 2 * h, out = new Float32Array(ow * oh), o0 = 2 * PAD;
  for (let y = 0; y < oh; y++) out.set(Q.subarray((y + o0) * W + o0, (y + o0) * W + o0 + ow), y * ow);
  return { out, dirs: { w, h, t1, t2 } };
}

type Table = { start: Int32Array; count: Int32Array; weights: Float32Array; stride: number };
// Output sample i reads the grid at `map(i)`; `stretch` widens the kernel
// when the grid is denser than the output (area-correct reduction).
function table(outN: number, map: (i: number) => number, stretch: number): Table {
  const f = Math.max(1, stretch), support = 2 * f, stride = Math.ceil(2 * support) + 2;
  const start = new Int32Array(outN), count = new Int32Array(outN), weights = new Float32Array(outN * stride);
  for (let i = 0; i < outN; i++) {
    const c = map(i), lo = Math.floor(c - support) + 1;
    let s = 0, n = 0;
    for (let j = lo; j < lo + stride && j - c < support; j++) {
      const wt = cubicBC((j - c) / f, 0, 0.5);
      weights[i * stride + n++] = wt;
      s += wt;
    }
    for (let k = 0; k < n; k++) weights[i * stride + k] /= s || 1;
    start[i] = lo;
    count[i] = n;
  }
  return { start, count, weights, stride };
}
function resamplePlane(src: Float32Array, w: number, h: number, ow: number, oh: number, tx: Table, ty: Table): Float32Array {
  const tmp = new Float32Array(ow * h), out = new Float32Array(ow * oh);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < ow; x++) {
      let s = 0;
      const b = x * tx.stride, st = tx.start[x];
      for (let k = 0; k < tx.count[x]; k++) s += tx.weights[b + k] * src[row + clamp(st + k, 0, w - 1)];
      tmp[y * ow + x] = s;
    }
  }
  for (let y = 0; y < oh; y++) {
    const b = y * ty.stride, st = ty.start[y], o = y * ow;
    for (let k = 0; k < ty.count[y]; k++) {
      const wt = ty.weights[b + k], r = clamp(st + k, 0, h - 1) * ow;
      for (let x = 0; x < ow; x++) out[o + x] += wt * tmp[r + x];
    }
  }
  return out;
}

// Unsharp mask limited to the 3x3 range of the input (plus a small margin).
function detailPass(p: Float32Array, w: number, h: number, amount: number, sigma: number) {
  if (amount <= 0) return p;
  const blur = gaussianPlane(new Float32Array(p), new Float32Array(p.length), w, h, sigma);
  const out = new Float32Array(p.length), margin = 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let lo = Infinity, hi = -Infinity;
      for (let dy = -1; dy <= 1; dy++) {
        const r = clamp(y + dy, 0, h - 1) * w;
        for (let dx = -1; dx <= 1; dx++) {
          const v = p[r + clamp(x + dx, 0, w - 1)];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      out[i] = clamp(p[i] + amount * (p[i] - blur[i]), lo - margin, hi + margin);
    }
  return out;
}

export type UpscaleOptions = {
  // 0..1 strength of the halo-free detail pass.
  sharpen?: number;
};

/** A plan shared by every plane of one image (or of masks of the same size). */
export class Upscaler {
  readonly steps: number;
  private dirs: Dirs[] = [];
  private tx: Table;
  private ty: Table;
  constructor(readonly w: number, readonly h: number, readonly ow: number, readonly oh: number, guide: Float32Array, readonly opts: UpscaleOptions = {}, progress?: Progress) {
    const f = Math.max(ow / w, oh / h);
    this.steps = f <= 1 ? 0 : Math.ceil(Math.log2(f) - 1e-9);
    let g = guide, gw = w, gh = h;
    for (let s = 0; s < this.steps; s++) {
      checkCancelled(progress);
      const r = double(g, gw, gh);
      this.dirs.push(r.dirs);
      g = r.out;
      gw *= 2;
      gh *= 2;
    }
    // Grid position of output pixel centers: input pixel i sits at i * 2^k.
    const k = 2 ** this.steps;
    this.tx = table(ow, (i) => ((i + 0.5) * (w / ow) - 0.5) * k, (w * k) / ow);
    this.ty = table(oh, (i) => ((i + 0.5) * (h / oh) - 0.5) * k, (h * k) / oh);
  }
  plane(P: Float32Array, sharpen = this.opts.sharpen ?? 0): Float32Array {
    let p = P, w = this.w, h = this.h;
    for (const d of this.dirs) {
      p = double(p, w, h, d).out;
      w *= 2;
      h *= 2;
    }
    const out = resamplePlane(p, w, h, this.ow, this.oh, this.tx, this.ty);
    return detailPass(out, this.ow, this.oh, sharpen * 1.2, 1);
  }
}

/** Enlarge an image to ow x oh (straight RGBA in and out). */
export function enhancedUpscale(src: RGBA8, ow: number, oh: number, opts: UpscaleOptions = {}, progress?: Progress): RGBA8 {
  const { width: w, height: h, data: d } = src, n = w * h;
  const A = new Float32Array(n), C = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], G = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = d[j + 3] / 255;
    A[i] = d[j + 3];
    for (let c = 0; c < 3; c++) C[c][i] = d[j + c] * a;
    G[i] = 0.299 * C[0][i] + 0.587 * C[1][i] + 0.114 * C[2][i] + 0.25 * A[i];
  }
  const up = new Upscaler(w, h, ow, oh, G, opts, progress);
  progress?.report?.(0.2);
  const outA = up.plane(A);
  const out: RGBA8 = { width: ow, height: oh, data: new Uint8ClampedArray(ow * oh * 4) }, od = out.data;
  for (let i = 0; i < ow * oh; i++) od[i * 4 + 3] = outA[i];
  for (let c = 0; c < 3; c++) {
    checkCancelled(progress);
    progress?.report?.(0.4 + 0.2 * c);
    const p = up.plane(C[c]);
    for (let i = 0, j = c; i < ow * oh; i++, j += 4) {
      const a = od[j + 3 - c];
      od[j] = a ? (p[i] * 255) / a : 0;
    }
  }
  progress?.report?.(1);
  return out;
}

/** Enlarge a single-channel mask with the same method (no detail pass). */
export function enhancedUpscaleMask(m: { width: number; height: number; data: Uint8Array }, ow: number, oh: number): { width: number; height: number; data: Uint8Array } {
  const P = Float32Array.from(m.data);
  const p = new Upscaler(m.width, m.height, ow, oh, P).plane(P, 0);
  const data = new Uint8Array(ow * oh);
  for (let i = 0; i < data.length; i++) data[i] = clamp(Math.round(p[i]), 0, 255);
  return { width: ow, height: oh, data };
}
