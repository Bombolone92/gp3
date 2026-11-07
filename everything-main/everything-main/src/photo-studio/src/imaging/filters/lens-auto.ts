// Automatic Lens Correction settings measured from the image itself (there
// is no lens database): the rotation that makes the dominant near-vertical
// and near-horizontal edges straight, and the radial darkening toward the
// corners (vignetting). Both are estimates for batch work; the results feed
// the ordinary Lens Correction operation (lens.ts).
import type { RGBA8 } from '../types';
import { SRGB_TO_LINEAR } from './sampling';
import type { LensParams } from './lens';

const MAX = 512;
/** Linear luminance on a grid of at most 512 px on the long side. */
function luminance(img: RGBA8) {
  const s = Math.max(1, Math.ceil(Math.max(img.width, img.height) / MAX));
  const w = Math.max(1, Math.floor(img.width / s)),
    h = Math.max(1, Math.floor(img.height / s));
  const out = new Float32Array(w * h);
  const d = img.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let j = 0; j < s; j++)
        for (let i = 0; i < s; i++) {
          const o = ((y * s + j) * img.width + x * s + i) * 4;
          sum += 0.2126 * SRGB_TO_LINEAR[d[o]] + 0.7152 * SRGB_TO_LINEAR[d[o + 1]] + 0.0722 * SRGB_TO_LINEAR[d[o + 2]];
        }
      out[y * w + x] = sum / (s * s);
    }
  return { w, h, data: out };
}

/** Separable box blur with clamped edges. */
function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(src.length),
    out = new Float32Array(src.length);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[y * w + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / n;
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Degrees to rotate (Lens Correction "angle") so that the dominant edges
 * within `maxAngle` of vertical or horizontal line up with the axes; 0 when
 * the image has no clear dominant direction. */
export function estimateStraighten(img: RGBA8, maxAngle = 10): number {
  const { w, h, data } = luminance(img);
  if (w < 16 || h < 16) return 0;
  // Gamma-like compression so dark and bright edges count alike, then a
  // small blur: pixel staircases of a slanted edge would otherwise read as
  // axis-aligned steps.
  const g0 = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) g0[i] = Math.sqrt(data[i]);
  const g = boxBlur(boxBlur(g0, w, h, 2), w, h, 2);
  const bin = 0.1;
  const bins = Math.round((2 * maxAngle) / bin) + 1;
  const hist = new Float64Array(bins);
  const mags: number[] = [];
  const samples: { d: number; m: number }[] = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1];
      const gy = g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - w] - g[i - w + 1];
      const m = Math.hypot(gx, gy);
      if (m < 0.01) continue;
      // Edge direction relative to the nearest axis, in (-45, 45].
      let d = ((Math.atan2(gy, gx) * 180) / Math.PI) % 90;
      if (d > 45) d -= 90;
      if (d <= -45) d += 90;
      mags.push(m);
      samples.push({ d, m });
    }
  if (samples.length < 50) return 0;
  // Only the strongest edges vote: they are the lines of buildings and horizons.
  mags.sort((a, b) => a - b);
  const floor = mags[Math.floor(mags.length * 0.8)];
  let total = 0;
  for (const { d, m } of samples) {
    if (m < floor) continue;
    total += m;
    if (Math.abs(d) > maxAngle) continue;
    hist[Math.round((d + maxAngle) / bin)] += m;
  }
  // Smooth over ±0.5° and find the peak.
  const smooth = new Float64Array(bins);
  const r = Math.round(0.5 / bin);
  for (let i = 0; i < bins; i++) for (let k = -r; k <= r; k++) smooth[i] += hist[Math.min(bins - 1, Math.max(0, i + k))] * (1 - Math.abs(k) / (r + 1));
  let best = 0;
  for (let i = 1; i < bins; i++) if (smooth[i] > smooth[best]) best = i;
  // The peak must stand out from the rest of the directions.
  const mean = smooth.reduce((a, b) => a + b, 0) / bins;
  if (!total || smooth[best] < 3 * mean) return 0;
  // Sub-bin peak by a parabola through the neighbors.
  const a = smooth[best - 1] ?? smooth[best],
    c = smooth[best + 1] ?? smooth[best];
  const shift = a - 2 * smooth[best] + c ? (0.5 * (a - c)) / (a - 2 * smooth[best] + c) : 0;
  const tilt = (best + Math.max(-0.5, Math.min(0.5, shift))) * bin - maxAngle;
  return Math.abs(tilt) < 0.1 ? 0 : -Math.round(tilt * 100) / 100;
}

/** Lens Correction "vignetteAmount" (0..100, midpoint 50) that brightens the
 * corners back to the level of the center; 0 when no consistent darkening is found. */
export function estimateVignette(img: RGBA8): number {
  const { w, h, data } = luminance(img);
  if (w < 16 || h < 16) return 0;
  const cx = w / 2,
    cy = h / 2,
    rn = 1 / Math.hypot(cx, cy);
  const rings = 10,
    sectors = 8;
  const sum = new Float64Array(rings * sectors),
    count = new Float64Array(rings * sectors);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx,
        dy = y + 0.5 - cy;
      const r = Math.min(0.9999, Math.hypot(dx, dy) * rn);
      const k = Math.floor(r * rings) * sectors + Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * sectors) % sectors;
      sum[k] += data[y * w + x];
      count[k]++;
    }
  const median = (v: number[]) => {
    const s = v.filter(Number.isFinite).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : NaN;
  };
  // Per sector, each ring relative to the sector's center ring; median over sectors.
  const ratio: number[] = [];
  for (let ring = 0; ring < rings; ring++) {
    const v: number[] = [];
    for (let s = 0; s < sectors; s++) {
      const c0 = count[s] + count[sectors + s];
      const center = c0 ? (sum[s] + sum[sectors + s]) / c0 : NaN;
      const k = ring * sectors + s;
      v.push(count[k] && center > 1e-4 ? sum[k] / count[k] / center : NaN);
    }
    ratio.push(median(v));
  }
  // Fit gain(t) = 1 + 1.5 a t², t from the midpoint (r = 0.45) to the corner,
  // to the brightening each ring needs (1 / ratio).
  let num = 0,
    den = 0;
  const vMid = 0.45;
  for (let ring = 0; ring < rings; ring++) {
    const r = (ring + 0.5) / rings;
    if (r <= vMid || !Number.isFinite(ratio[ring]) || ratio[ring] <= 0) continue;
    const t = (r - vMid) / (1 - vMid);
    const x = 1.5 * t * t,
      y = 1 / ratio[ring] - 1;
    num += x * y;
    den += x * x;
  }
  if (!den) return 0;
  const amount = Math.round((num / den) * 100);
  // Darkening must also grow toward the corners to count as vignetting.
  const outer = ratio[rings - 1],
    middle = ratio[Math.round(rings * 0.6)];
  if (!(outer < middle) || amount < 5) return 0;
  return Math.min(100, amount);
}

/** Scale (percent) that hides the empty corners of a rotation by `angle` degrees. */
export function fillScale(width: number, height: number, angle: number) {
  const t = (Math.abs(angle) * Math.PI) / 180;
  const s = Math.max(Math.cos(t) + (height / width) * Math.sin(t), Math.cos(t) + (width / height) * Math.sin(t));
  return Math.min(150, Math.ceil(s * 1000) / 10);
}

/** Settings for one image: measured values added to the given ones. */
export function autoLensParams(img: RGBA8, base: LensParams, o: { straighten: boolean; vignette: boolean; fill: boolean }): LensParams {
  const p: LensParams = { ...base };
  if (o.straighten) {
    const angle = estimateStraighten(img);
    p.angle = (p.angle ?? 0) + angle;
    if (o.fill && p.angle) p.scale = fillScale(img.width, img.height, p.angle);
  }
  if (o.vignette) {
    const v = estimateVignette(img);
    if (v) {
      p.vignetteAmount = Math.min(100, (p.vignetteAmount ?? 0) + v);
      p.vignetteMidpoint = 50;
    }
  }
  return p;
}
