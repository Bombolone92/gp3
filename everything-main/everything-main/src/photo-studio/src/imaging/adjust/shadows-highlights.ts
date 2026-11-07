// Shadows/Highlights: a local tone correction. The blurred luma estimates
// each pixel's neighborhood brightness; pixels in dark neighborhoods are
// lifted and pixels in bright neighborhoods pulled down with a gamma-like
// curve, so local contrast (detail) survives while global range compresses.
import { checkCancelled, cloneRGBA8, type Mask8, type Progress, type RGBA8 } from '../types';
import { blurChannel } from './blur';
import { gain } from './curves';

export type ShadowsHighlightsParams = {
  shadowsAmount: number; // 0..100
  shadowsTone: number; // 0..100, width of the tonal range treated as shadows
  shadowsRadius: number; // px, neighborhood size
  highlightsAmount: number;
  highlightsTone: number;
  highlightsRadius: number;
  colorCorrection: number; // -100..100, saturation of corrected areas
  midtoneContrast: number; // -100..100
};
export const DEFAULT_SHADOWS_HIGHLIGHTS: ShadowsHighlightsParams = {
  shadowsAmount: 35,
  shadowsTone: 50,
  shadowsRadius: 30,
  highlightsAmount: 0,
  highlightsTone: 50,
  highlightsRadius: 30,
  colorCorrection: 20,
  midtoneContrast: 0,
};

// Rational lift through (0, 0) and (1, 1) with slope 1 + k at black: brightens
// shadows like a gamma below one, but with finite slope so near-black noise
// is not blown up, and with one division instead of Math.pow.
const lift = (x: number, k: number) => (x * (1 + k)) / (1 + k * x);

// Neighborhood brightness: a Gaussian-like blur. Wide blurs run on a
// box-downsampled copy and are upsampled bilinearly; the result is smooth by
// construction, so this loses nothing visible and is much faster.
export function localMean(lum: Float32Array, w: number, h: number, sigma: number, progress?: Progress): Float32Array {
  const f = Math.max(1, Math.min(16, Math.floor(sigma / 3)));
  if (f === 1) return blurChannel(lum, w, h, sigma, progress);
  const sw = Math.ceil(w / f),
    sh = Math.ceil(h / f);
  const small = new Float32Array(sw * sh),
    count = new Float32Array(sw * sh);
  for (let y = 0; y < h; y++) {
    const srow = ((y / f) | 0) * sw;
    for (let x = 0; x < w; x++) {
      const j = srow + ((x / f) | 0);
      small[j] += lum[y * w + x];
      count[j]++;
    }
  }
  for (let j = 0; j < small.length; j++) small[j] /= count[j];
  const blurred = blurChannel(small, sw, sh, sigma / f, progress);
  checkCancelled(progress);
  // Bilinear upsampling; small pixel j covers big pixels [j*f, (j+1)*f).
  const x0 = new Int32Array(w),
    fx = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const p = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5));
    x0[x] = Math.min(sw - 2, p | 0);
    fx[x] = p - x0[x];
    if (sw === 1) (x0[x] = 0), (fx[x] = 0);
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const p = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5));
    const y0 = sh === 1 ? 0 : Math.min(sh - 2, p | 0),
      fy = sh === 1 ? 0 : p - y0;
    const r0 = y0 * sw,
      r1 = sh === 1 ? r0 : r0 + sw;
    for (let x = 0; x < w; x++) {
      const a = x0[x],
        t = fx[x],
        b = sw === 1 ? a : a + 1;
      const top = blurred[r0 + a] + (blurred[r0 + b] - blurred[r0 + a]) * t;
      const bottom = blurred[r1 + a] + (blurred[r1 + b] - blurred[r1 + a]) * t;
      out[y * w + x] = top + (bottom - top) * fy;
    }
  }
  return out;
}

// `scale` multiplies the radii (reduced-size previews).
export function shadowsHighlights(
  src: RGBA8,
  p: ShadowsHighlightsParams,
  selection?: Mask8,
  progress?: Progress,
  scale = 1,
): RGBA8 {
  const out = cloneRGBA8(src);
  const { width: w, height: h } = src;
  const n = w * h,
    s = src.data,
    d = out.data,
    sel = selection?.data;
  const as = Math.max(0, Math.min(100, p.shadowsAmount)) / 100,
    ah = Math.max(0, Math.min(100, p.highlightsAmount)) / 100;
  const mc = Math.max(-100, Math.min(100, p.midtoneContrast)) / 100;
  if (!as && !ah && !mc) return out;
  const lum = new Float32Array(n);
  for (let i = 0, q = 0; q < n; q++, i += 4) lum[q] = (0.2126 * s[i] + 0.7152 * s[i + 1] + 0.0722 * s[i + 2]) / 255;
  // Radius ~ two standard deviations of the neighborhood.
  const sigS = (Math.max(0, p.shadowsRadius) * scale) / 2,
    sigH = (Math.max(0, p.highlightsRadius) * scale) / 2;
  const meanS = as ? localMean(lum, w, h, sigS, progress) : lum;
  const meanH = ah ? (sigH === sigS && as ? meanS : localMean(lum, w, h, sigH, progress)) : lum;
  progress?.report?.(0.6);
  const ts = Math.max(0.01, Math.min(100, p.shadowsTone) / 100),
    th = Math.max(0.01, Math.min(100, p.highlightsTone) / 100);
  // 0 = brightness changes only (gray-ish), 1 = full multiplicative (keeps ratios).
  const colorMix = (Math.max(-100, Math.min(100, p.colorCorrection)) + 100) / 200;
  const g = 0.5 + mc * 0.2;
  for (let y = 0; y < h; y++) {
    if ((y & 31) === 0) checkCancelled(progress);
    for (let x = 0; x < w; x++) {
      const q = y * w + x,
        i = q * 4;
      const m = sel ? sel[q] : 255;
      if (m === 0) continue;
      const l = lum[q];
      let nl = l;
      if (as) {
        const t = meanS[q] < ts ? 1 - meanS[q] / ts : 0;
        const k = 4 * as * t * t;
        if (k > 0) nl = lift(nl, k);
      }
      if (ah) {
        const t = meanH[q] > 1 - th ? (meanH[q] - (1 - th)) / th : 0;
        const k = 4 * ah * t * t;
        if (k > 0) nl = 1 - lift(1 - nl, k);
      }
      if (mc) nl = gain(nl, g);
      const dl = nl - l;
      // Ratio scaling keeps hue and boosts chroma in lifted shadows; cap it
      // so near-black noise is not amplified without bound.
      const ratio = l > 1e-4 ? Math.min(4, nl / l) : 1;
      const k = m / 255;
      for (let c = 0; c < 3; c++) {
        const v = s[i + c] / 255;
        const add = v + dl,
          mul = v * ratio;
        let nv = add + (mul - add) * colorMix;
        nv = nv < 0 ? 0 : nv > 1 ? 1 : nv;
        d[i + c] = (v + (nv - v) * k) * 255;
      }
    }
  }
  progress?.report?.(1);
  return out;
}
