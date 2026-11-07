// Filter → Denoise and Filter → Sharpen Details: restoration filters that
// measure the image's own noise level instead of asking for it.
//
// Denoise runs non-local means (Buades, Coll and Morel, "A non-local algorithm
// for image denoising", CVPR 2005) on luma: every pixel becomes a weighted mean
// of the pixels in a small search window whose surrounding patches look alike.
// Patch distances for one offset are computed for the whole plane at once with
// a box filter, and each offset serves both pixels of a pair, so the cost is a
// few passes per offset regardless of patch size. Color noise is smoothed with
// a guided filter (He, Sun and Tang 2013) that follows the denoised luma, so
// chroma stays inside edges. "Preserve Details" puts back part of what was
// removed where the cleaned image has structure well above the noise floor.
//
// Sharpen Details is Richardson-Lucy deconvolution (Richardson 1972, Lucy 1974)
// of luma with a Gaussian or lens (disk) blur model, regularized by total
// variation (Dey et al., "Richardson-Lucy algorithm with total variation
// regularization for 3D confocal microscope deconvolution", 2006) so noise is
// not amplified, followed by coring of changes below the measured noise level.
//
// The noise level comes from the median absolute response of a Laplacian-like
// kernel that cancels smooth image content (Immerkaer, "Fast noise variance
// estimation", 1996, with a median instead of a mean so edges do not count).
import type { Progress, RGBA8 } from '../types';
import { checkCancelled } from '../types';
import { guidedFilterGray } from '../segment/filters';
import { clamp, defineOp, fillTransparent, gaussianPlane, lumaPlane, newImage, num, px, str, sub } from './common';

/** Noise standard deviation of a plane, in the plane's units. */
export function estimateNoise(Y: Float32Array, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  // Sample on a grid of at most ~250k positions; |response| histogram in 1/8 steps.
  const step = Math.max(1, Math.floor(Math.sqrt(((w - 2) * (h - 2)) / 250_000)));
  const BINS = 8192, hist = new Uint32Array(BINS);
  let count = 0;
  for (let y = 1; y < h - 1; y += step)
    for (let x = 1; x < w - 1; x += step) {
      const i = y * w + x;
      const v =
        Y[i - w - 1] - 2 * Y[i - w] + Y[i - w + 1] - 2 * Y[i - 1] + 4 * Y[i] - 2 * Y[i + 1] + Y[i + w - 1] - 2 * Y[i + w] + Y[i + w + 1];
      hist[Math.min(BINS - 1, Math.floor(Math.abs(v) * 8))]++;
      count++;
    }
  let acc = 0, k = 0;
  for (; k < BINS; k++) {
    acc += hist[k];
    if (acc * 2 >= count) break;
  }
  // The kernel's weights square-sum to 36, so its response has std 6σ;
  // the median of |N(0, s)| is 0.6745 s.
  return (k + 0.5) / 8 / (0.6745 * 6);
}

// exp(-x) for x in [0, 8], sampled finely enough for weights.
const EXP_STEPS = 64;
const EXP = Float32Array.from({ length: 8 * EXP_STEPS + 1 }, (_, i) => Math.exp(-i / EXP_STEPS));

/** Non-local means of one plane. `sigma` is the noise level and `hf` the
 * filtering strength relative to it; `search` and `patch` are radii. */
export function nlMeans(Y: Float32Array, w: number, h: number, sigma: number, hf: number, search = 2, patch = 1, progress?: Progress): Float32Array {
  const n = w * h, out = new Float32Array(Y);
  if (n === 0 || hf <= 0) return out;
  const s = Math.max(0.5, sigma), h2 = (hf * s) ** 2, floor = 2 * s * s, scale = EXP_STEPS / h2;
  const sumW = new Float32Array(n), sumV = new Float32Array(n), maxW = new Float32Array(n);
  const D = new Float32Array(n), T = new Float32Array(n);
  const offsets: [number, number][] = [];
  for (let dy = 0; dy <= search; dy++) for (let dx = -search; dx <= search; dx++) if (dy > 0 || dx > 0) offsets.push([dx, dy]);
  const inv = 1 / (2 * patch + 1) ** 2;
  for (let k = 0; k < offsets.length; k++) {
    checkCancelled(progress);
    progress?.report?.(k / offsets.length);
    const [dx, dy] = offsets[k];
    // Squared differences to the shifted plane (edge-replicated).
    for (let y = 0; y < h; y++) {
      const yy = Math.min(h - 1, y + dy) * w, o = y * w;
      for (let x = 0; x < w; x++) {
        const xx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx, d = Y[o + x] - Y[yy + xx];
        D[o + x] = d * d;
      }
    }
    // Patch sums: horizontal then vertical running sums (replicated edges).
    boxSum(D, T, w, h, patch);
    for (let y = 0; y < h; y++) {
      const qy = y + dy;
      for (let x = 0; x < w; x++) {
        const qx = x + dx;
        if (qx < 0 || qx >= w || qy >= h) continue;
        const p = y * w + x, q = qy * w + qx;
        const e = (D[p] * inv - floor) * scale;
        if (e >= 8 * EXP_STEPS) continue;
        const wt = e <= 0 ? 1 : EXP[e | 0];
        // The pair (p, q) is the same for q looking back at p.
        sumW[p] += wt;
        sumV[p] += wt * Y[q];
        if (wt > maxW[p]) maxW[p] = wt;
        sumW[q] += wt;
        sumV[q] += wt * Y[p];
        if (wt > maxW[q]) maxW[q] = wt;
      }
    }
  }
  // The center pixel weighs as much as its best match.
  for (let i = 0; i < n; i++) {
    const c = maxW[i] || 1;
    out[i] = (sumV[i] + c * Y[i]) / (sumW[i] + c);
  }
  progress?.report?.(1);
  return out;
}

// In-place (2r+1)² box sum (not mean) with replicated edges; `tmp` is scratch.
function boxSum(a: Float32Array, tmp: Float32Array, w: number, h: number, r: number) {
  if (r <= 0) return;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let s = 0;
    for (let k = -r; k <= r; k++) s += a[o + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = s;
      s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
    }
  }
  const acc = new Float64Array(w);
  for (let k = -r; k <= r; k++) {
    const o = clamp(k, 0, h - 1) * w;
    for (let x = 0; x < w; x++) acc[x] += tmp[o + x];
  }
  for (let y = 0; y < h; y++) {
    const o = y * w, ad = Math.min(h - 1, y + r + 1) * w, rm = Math.max(0, y - r) * w;
    for (let x = 0; x < w; x++) {
      a[o + x] = acc[x];
      acc[x] += tmp[ad + x] - tmp[rm + x];
    }
  }
}

export type DenoiseOptions = {
  // 0..1: luminance noise reduction (filtering strength relative to the noise).
  strength: number;
  // 0..1: color noise reduction.
  color: number;
  // 0..1: how much fine structure above the noise floor is kept.
  detail: number;
  // Search window radius in pixels; by default it grows with the noise level.
  search?: number;
  // Search twice as far (smoother flat areas, slower).
  wide?: boolean;
  // Patch radius; by default 1, or 2 for strong noise.
  patch?: number;
  // Noise level override (0..255 luma units); estimated when omitted.
  sigma?: number;
};

/** Search radius for a noise level: stronger noise needs more candidates. */
export function searchRadius(sigma: number, wide: boolean) {
  return (sigma < 6 ? 2 : sigma < 14 ? 3 : 4) + (wide ? 2 : 0);
}

/** Denoise an image (alpha unchanged). */
export function denoise(src: RGBA8, o: DenoiseOptions, progress?: Progress): RGBA8 {
  const { width: w, height: h, data: d } = src, n = w * h;
  const work = fillTransparent(src), wd = work.data;
  const Y = lumaPlane(work), Cb = new Float32Array(n), Cr = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    Cb[i] = -0.168736 * wd[j] - 0.331264 * wd[j + 1] + 0.5 * wd[j + 2];
    Cr[i] = 0.5 * wd[j] - 0.418688 * wd[j + 1] - 0.081312 * wd[j + 2];
  }
  const sigma = o.sigma ?? estimateNoise(Y, w, h);
  let den = Y;
  const search = o.search ?? searchRadius(sigma, !!o.wide), patch = o.patch ?? (sigma > 10 ? 2 : 1);
  if (o.strength > 0) den = nlMeans(Y, w, h, sigma, 0.3 + 2 * o.strength, search, patch, sub(progress, 0, 0.8));
  // Preserve Details: return part of the removed signal where the cleaned
  // image has gradients clearly above the noise.
  if (o.detail > 0 && den !== Y) {
    const s = Math.max(0.5, sigma), out = new Float32Array(den);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const g = Math.hypot(den[i + 1] - den[i - 1], den[i + w] - den[i - w]) / 2;
        const k = clamp((g - 1.5 * s) / (4 * s), 0, 1) * o.detail;
        out[i] = den[i] + k * (Y[i] - den[i]);
      }
    den = out;
  }
  checkCancelled(progress);
  if (o.color > 0) {
    const I = new Float32Array(n);
    for (let i = 0; i < n; i++) I[i] = den[i] / 255;
    const r = Math.max(1, Math.round((1 + 7 * o.color) * clamp(sigma / 8, 1, 3))), eps = 1e-3 * (0.3 + 3 * o.color);
    for (const C of [Cb, Cr]) {
      const p = new Float32Array(n);
      for (let i = 0; i < n; i++) p[i] = C[i] / 255;
      const q = guidedFilterGray(I, p, w, h, r, eps);
      for (let i = 0; i < n; i++) C[i] += o.color * (q[i] * 255 - C[i]);
    }
  }
  progress?.report?.(0.95);
  const out = newImage(src), od = out.data;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (d[j + 3] === 0) {
      od[j] = d[j]; od[j + 1] = d[j + 1]; od[j + 2] = d[j + 2];
      continue;
    }
    const y = den[i], cb = Cb[i], cr = Cr[i];
    od[j] = y + 1.402 * cr;
    od[j + 1] = y - 0.344136 * cb - 0.714136 * cr;
    od[j + 2] = y + 1.772 * cb;
    od[j + 3] = d[j + 3];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deconvolution

export type BlurModel = 'gaussian' | 'lens';

// Mean over a disk of radius r (rounded to whole pixels per row), replicated
// edges; rows are summed from prefix sums kept for a sliding band of rows.
export function diskBlur(src: Float32Array, w: number, h: number, radius: number, out = new Float32Array(w * h)): Float32Array {
  const R = Math.max(1, Math.round(radius));
  const span = Int32Array.from({ length: 2 * R + 1 }, (_, k) => Math.floor(Math.sqrt(Math.max(0, (R + 0.5) ** 2 - (k - R) ** 2))));
  let area = 0;
  for (const s of span) area += 2 * s + 1;
  const pw = w + 2 * R + 1;
  const rows = new Map<number, Float64Array>();
  const prefix = (y: number) => {
    let p = rows.get(y);
    if (p) return p;
    p = new Float64Array(pw + 1);
    const o = y * w;
    for (let k = 0; k < pw; k++) p[k + 1] = p[k] + src[o + clamp(k - R, 0, w - 1)];
    rows.set(y, p);
    return p;
  };
  for (let y = 0; y < h; y++) {
    rows.delete(y - R - 2);
    const o = y * w;
    for (let x = 0; x < w; x++) out[o + x] = 0;
    for (let k = 0; k <= 2 * R; k++) {
      const p = prefix(clamp(y + k - R, 0, h - 1)), s = span[k];
      for (let x = 0; x < w; x++) out[o + x] += p[x + R + s + 1] - p[x + R - s];
    }
    for (let x = 0; x < w; x++) out[o + x] /= area;
  }
  return out;
}

export type DeconvolveOptions = {
  model: BlurModel;
  // Gaussian sigma or lens disk radius, in pixels.
  radius: number;
  iterations: number;
  // 0..1: total-variation regularization and coring of sub-noise changes.
  noise: number;
  // 0..3: how much of the restored detail is applied.
  amount: number;
};

/** Richardson-Lucy deconvolution of a [0, 255] plane; returns the estimate. */
export function richardsonLucy(Y: Float32Array, w: number, h: number, o: Omit<DeconvolveOptions, 'amount'>, progress?: Progress): Float32Array {
  const n = w * h, OFF = 2;
  // Work on positive values with a small offset so the ratio stays defined.
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = Y[i] / 255 + OFF / 255;
  const u = new Float32Array(y), est = new Float32Array(n), tmp = new Float32Array(n);
  const blur = (src: Float32Array, dst: Float32Array<ArrayBuffer>) => {
    if (o.model === 'lens') diskBlur(src, w, h, o.radius, dst);
    else {
      dst.set(src);
      gaussianPlane(dst, tmp, w, h, o.radius);
    }
  };
  const lambda = 0.012 * o.noise;
  const div = lambda > 0 ? new Float32Array(n) : null;
  for (let it = 0; it < o.iterations; it++) {
    checkCancelled(progress);
    progress?.report?.(it / o.iterations);
    blur(u, est);
    for (let i = 0; i < n; i++) est[i] = y[i] / Math.max(est[i], 1e-4);
    // Every blur model here is symmetric, so the adjoint is the same blur.
    blur(est, est);
    if (div) tvDivergence(u, w, h, div);
    for (let i = 0; i < n; i++) {
      const denom = div ? Math.max(0.5, 1 - lambda * div[i]) : 1;
      u[i] = clamp((u[i] * est[i]) / denom, 0, 1.5);
    }
  }
  for (let i = 0; i < n; i++) u[i] = (u[i] - OFF / 255) * 255;
  progress?.report?.(1);
  return u;
}

// div(∇u / |∇u|) with forward differences for the gradient and backward for
// the divergence.
function tvDivergence(u: Float32Array, w: number, h: number, out: Float32Array) {
  const n = w * h, gx = new Float32Array(n), gy = new Float32Array(n), e = 1e-3;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dx = x < w - 1 ? u[i + 1] - u[i] : 0, dy = y < h - 1 ? u[i + w] - u[i] : 0;
      const m = Math.sqrt(dx * dx + dy * dy + e * e);
      gx[i] = dx / m;
      gy[i] = dy / m;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = gx[i] - (x > 0 ? gx[i - 1] : 0) + gy[i] - (y > 0 ? gy[i - w] : 0);
    }
}

/** Sharpen by deconvolution: luma is restored and the change is added to all
 * three channels, so colors do not shift. Alpha is unchanged. */
export function deconvolve(src: RGBA8, o: DeconvolveOptions, progress?: Progress): RGBA8 {
  const { width: w, height: h, data: d } = src, n = w * h;
  const Y = lumaPlane(fillTransparent(src));
  const out = newImage(src), od = out.data;
  if (o.amount <= 0 || o.iterations <= 0 || o.radius <= 0) {
    od.set(d);
    return out;
  }
  const sigma = estimateNoise(Y, w, h);
  const U = richardsonLucy(Y, w, h, o, sub(progress, 0, 0.95));
  // Coring: changes comparable to the noise are attenuated smoothly.
  const t = o.noise * 2.5 * Math.max(0.5, sigma), t2 = t * t;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    let delta = U[i] - Y[i];
    if (t2 > 0) delta *= (delta * delta) / (delta * delta + t2);
    delta *= o.amount;
    od[j] = d[j] + delta;
    od[j + 1] = d[j + 1] + delta;
    od[j + 2] = d[j + 2] + delta;
    od[j + 3] = d[j + 3];
    if (d[j + 3] === 0) {
      od[j] = d[j]; od[j + 1] = d[j + 1]; od[j + 2] = d[j + 2];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Operations

export const denoiseOp = defineOp({
  id: 'denoise',
  label: 'Denoise',
  category: 'Noise',
  support: (p) => (str(p, 'quality') === 'high' ? 6 : 4) + 2 + 24 + 4,
  params: [
    { key: 'strength', label: 'Luminance Noise', type: 'number', min: 0, max: 100, step: 1, default: 50, unit: '%' },
    { key: 'color', label: 'Color Noise', type: 'number', min: 0, max: 100, step: 1, default: 60, unit: '%' },
    { key: 'detail', label: 'Preserve Details', type: 'number', min: 0, max: 100, step: 1, default: 35, unit: '%' },
    {
      key: 'quality',
      label: 'Search',
      type: 'select',
      options: [
        { value: 'standard', label: 'Standard (faster)' },
        { value: 'high', label: 'Wide (smoother, slower)' },
      ],
      default: 'standard',
    },
  ],
  run: (src, p, _ctx, progress) =>
    denoise(src, { strength: num(p, 'strength') / 100, color: num(p, 'color') / 100, detail: num(p, 'detail') / 100, wide: str(p, 'quality') === 'high' }, progress),
});

export const sharpenDetailsOp = defineOp({
  id: 'sharpen-details',
  label: 'Sharpen Details',
  category: 'Sharpen',
  support: (p, ctx) => Math.ceil(px(ctx, num(p, 'radius')) * 3 + 2) * Math.min(4, Math.ceil(num(p, 'iterations') / 4)) + 4,
  params: [
    { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 300, step: 1, default: 100, unit: '%' },
    { key: 'radius', label: 'Blur Radius', type: 'number', min: 0.3, max: 8, step: 0.1, default: 1.2, unit: 'px' },
    {
      key: 'model',
      label: 'Blur Type',
      type: 'select',
      options: [
        { value: 'gaussian', label: 'Soft (Gaussian)' },
        { value: 'lens', label: 'Out of focus (lens)' },
      ],
      default: 'gaussian',
    },
    { key: 'iterations', label: 'Iterations', type: 'number', min: 1, max: 60, step: 1, default: 20 },
    { key: 'noise', label: 'Noise Suppression', type: 'number', min: 0, max: 100, step: 1, default: 30, unit: '%' },
  ],
  run: (src, p, ctx, progress) =>
    deconvolve(
      src,
      {
        model: str(p, 'model') === 'lens' ? 'lens' : 'gaussian',
        radius: Math.max(0.2, px(ctx, num(p, 'radius'))),
        iterations: Math.round(num(p, 'iterations')),
        noise: num(p, 'noise') / 100,
        amount: num(p, 'amount') / 100,
      },
      progress,
    ),
});
