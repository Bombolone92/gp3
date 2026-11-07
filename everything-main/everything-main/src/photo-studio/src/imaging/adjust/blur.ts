// Fast approximate Gaussian blur of a single float channel: three box passes
// per axis (Wells, "Efficient synthesis of Gaussian filters by cascaded
// uniform filters", 1986) with running sums, so cost is O(pixels) for any
// radius. Each horizontal pass writes its output transposed, which turns the
// vertical passes into cache-friendly row passes too.
import { checkCancelled, type Progress } from '../types';

// Box radii for `passes` boxes approximating a Gaussian with deviation sigma
// (Kovesi, "Fast almost-Gaussian filtering", 2010).
export function boxRadiiForSigma(sigma: number, passes = 3): number[] {
  const ideal = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - passes * wl * wl - 4 * passes * wl - 3 * passes) / (-4 * wl - 4));
  return Array.from({ length: passes }, (_, i) => Math.max(0, ((i < m ? wl : wu) - 1) / 2));
}

// One box pass along rows of a w x h image, writing the h x w transpose.
// Edges repeat the border sample. Rows are processed in strips of STRIP so
// the transposed writes land in consecutive floats (whole cache lines).
const STRIP = 16;
const acc = new Float64Array(STRIP);
function boxRowsTransposed(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (2 * r + 1);
  for (let y0 = 0; y0 < h; y0 += STRIP) {
    const n = Math.min(STRIP, h - y0);
    for (let k = 0; k < n; k++) {
      const row = (y0 + k) * w;
      let a = src[row] * (r + 1);
      for (let x = 1; x <= r; x++) a += src[row + (x < w ? x : w - 1)];
      acc[k] = a;
    }
    for (let x = 0; x < w; x++) {
      const add = x + r + 1 < w ? x + r + 1 : w - 1,
        sub = x - r > 0 ? x - r : 0,
        out = x * h + y0;
      for (let k = 0, row = y0 * w; k < n; k++, row += w) {
        dst[out + k] = acc[k] * inv;
        acc[k] += src[row + add] - src[row + sub];
      }
    }
  }
}

export function blurChannel(src: Float32Array, w: number, h: number, sigma: number, progress?: Progress): Float32Array {
  if (!(sigma > 0.25) || w < 2 || h < 2) return new Float32Array(src);
  const radii = boxRadiiForSigma(sigma).map((r) => Math.min(r, Math.max(w, h)));
  const a = new Float32Array(src),
    b = new Float32Array(src.length);
  // Box filters commute, so alternating axes (x then y, three times) equals
  // three x passes followed by three y passes, and every pair restores layout.
  for (const r of radii) {
    checkCancelled(progress);
    boxRowsTransposed(a, b, w, h, Math.round(r));
    boxRowsTransposed(b, a, h, w, Math.round(r));
  }
  return a;
}
