// Focus Area: select the in-focus parts of a photo from local sharpness.
//
// Sharpness is the local energy of fine detail (the image minus a slightly
// blurred copy), pooled over a neighborhood and taken at two scales so both
// fine texture and larger crisp edges count. A noise floor (raised by the
// Noise Level setting) is subtracted, the result is normalized by a high
// percentile, thresholded by the In-Focus Range, cleaned of small islands and
// holes, and optionally softened along color edges.
import { checkCancelled, type Mask8, type Progress, type RGBA8 } from '../types';
import { gaussianBlurF32, guidedFilterColor } from './filters';

export type FocusAreaOptions = {
  // 0..100: higher includes less sharp areas.
  range: number;
  // 0..100: image noise to ignore.
  noise: number;
  softenEdges?: boolean;
};

function luma(img: RGBA8): Float32Array {
  const { data, width, height } = img, out = new Float32Array(width * height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    // Transparent pixels read as mid gray so their edges are not "detail".
    const a = data[i + 3] / 255;
    out[j] = ((0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255) * a + 0.5 * (1 - a);
  }
  return out;
}
function percentile(v: Float32Array, q: number): number {
  // Histogram percentile over the value range (exact enough for normalizing).
  let max = 0;
  for (const x of v) if (x > max) max = x;
  if (max <= 0) return 0;
  const bins = 4096, hist = new Uint32Array(bins);
  for (const x of v) hist[Math.min(bins - 1, Math.floor((x / max) * (bins - 1)))]++;
  const target = q * v.length;
  let acc = 0;
  for (let b = 0; b < bins; b++) {
    acc += hist[b];
    if (acc >= target) return ((b + 0.5) / (bins - 1)) * max;
  }
  return max;
}

/** Normalized sharpness in [0, 1] per pixel (before thresholding). */
export function sharpnessMap(img: RGBA8, noise: number, progress?: Progress): Float32Array {
  const { width: w, height: h } = img, n = w * h;
  const L = luma(img);
  const pool = Math.max(3, Math.min(w, h) / 40);
  const energy = new Float32Array(n);
  let s = 0;
  for (const sigma of [1, 2.5]) {
    checkCancelled(progress);
    const blurred = gaussianBlurF32(Float32Array.from(L), w, h, sigma);
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = (L[i] - blurred[i]) ** 2;
    gaussianBlurF32(d, w, h, pool);
    // Finer detail weighs more: defocus removes it first.
    const k = sigma === 1 ? 1 : 0.5;
    for (let i = 0; i < n; i++) energy[i] += k * Math.sqrt(d[i]);
    progress?.report?.(0.15 + 0.2 * ++s);
  }
  // Noise floor (luma units): a small allowance for sensor noise and grain,
  // raised by the setting. Normalizing by a high percentile, but never by
  // less than clearly visible detail, keeps an all-soft image unselected.
  const floor = 0.004 + (noise / 100) * 0.08;
  for (let i = 0; i < n; i++) energy[i] = Math.max(0, energy[i] - floor);
  const top = Math.max(0.03, percentile(energy, 0.98));
  for (let i = 0; i < n; i++) energy[i] = Math.min(1, energy[i] / top);
  return energy;
}

const rangeToThreshold = (range: number) => 0.03 + 0.6 * (1 - Math.min(100, Math.max(0, range)) / 100) ** 2;
const thresholdToRange = (t: number) => 100 * (1 - Math.sqrt(Math.max(0, Math.min(1, (t - 0.03) / 0.6))));

// Connected components of `on` (4-connected); components smaller than
// `minArea` flip. Background holes touching the border are kept.
function removeSmall(bin: Uint8Array, w: number, h: number, value: 0 | 1, minArea: number) {
  const seen = new Uint8Array(w * h), stack: number[] = [], comp: number[] = [];
  for (let start = 0; start < bin.length; start++) {
    if (seen[start] || bin[start] !== value) continue;
    stack.push(start);
    seen[start] = 1;
    comp.length = 0;
    let border = false;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % w, y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x > 0 && !seen[i - 1] && bin[i - 1] === value) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && !seen[i + 1] && bin[i + 1] === value) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !seen[i - w] && bin[i - w] === value) { seen[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && !seen[i + w] && bin[i + w] === value) { seen[i + w] = 1; stack.push(i + w); }
    }
    if (comp.length < minArea && !(value === 0 && border)) for (const i of comp) bin[i] = 1 - value;
  }
}

export function focusAreaMask(img: RGBA8, opts: FocusAreaOptions, progress?: Progress): Mask8 {
  const { width: w, height: h } = img, n = w * h;
  const out: Mask8 = { width: w, height: h, data: new Uint8Array(n) };
  if (!n) return out;
  const sharp = sharpnessMap(img, opts.noise, progress);
  const t = rangeToThreshold(opts.range);
  // Majority vote over a neighborhood closes gaps between textured spots.
  const vote = new Float32Array(n);
  for (let i = 0; i < n; i++) vote[i] = sharp[i] > t ? 1 : 0;
  gaussianBlurF32(vote, w, h, Math.max(2, Math.min(w, h) / 60));
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) bin[i] = vote[i] > 0.5 ? 1 : 0;
  checkCancelled(progress);
  const minArea = Math.max(4, Math.round(n * 0.004));
  removeSmall(bin, w, h, 1, minArea);
  removeSmall(bin, w, h, 0, minArea);
  progress?.report?.(0.8);
  if (opts.softenEdges) {
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = bin[i];
    const r = Math.max(2, Math.round(Math.min(w, h) / 100));
    const q = guidedFilterColor(img, p, r, 1e-3);
    for (let i = 0; i < n; i++) out.data[i] = Math.round(Math.min(1, Math.max(0, q[i])) * 255);
  } else for (let i = 0; i < n; i++) out.data[i] = bin[i] * 255;
  progress?.report?.(1);
  return out;
}

/** A default In-Focus Range for the image: Otsu's threshold of its sharpness
 * distribution, mapped back onto the range scale. */
export function autoFocusRange(img: RGBA8, noise = 0): number {
  const n = img.width * img.height;
  if (!n) return 50;
  const sharp = sharpnessMap(img, noise);
  const bins = 256, hist = new Float64Array(bins);
  for (const v of sharp) hist[Math.min(bins - 1, Math.floor(v * bins))]++;
  let sum = 0;
  for (let b = 0; b < bins; b++) sum += b * hist[b];
  let wB = 0, sumB = 0, best = 0, bestT = bins / 2;
  for (let b = 0; b < bins; b++) {
    wB += hist[b];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += b * hist[b];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      bestT = b + 1;
    }
  }
  return Math.round(thresholdToRange(bestT / bins));
}
