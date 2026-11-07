// Stack modes: a per-pixel statistic across a stack of aligned layers (for
// example several exposures of one scene). Each color channel is reduced on
// its own over the layers that cover the pixel (alpha > 0); the result is as
// opaque as the most opaque contributing layer. Moments that are signed or
// unbounded are mapped onto 0-255 so they can be viewed as images:
// skewness and excess kurtosis are centered on 128 at 32 levels per unit,
// entropy is scaled so 255 means every layer holds a different value.
import type { StackMode } from '../model/embedded';

const clamp = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

/** Reduce `values[0..n)` (one channel of the contributing layers). `scratch`
 * is reused between calls; it must hold at least `n` entries. */
export function reduceSamples(values: Float64Array, n: number, mode: StackMode, scratch: Float64Array): number {
  if (n === 0) return 0;
  if (mode === 'none') return values[n - 1];
  let sum = 0,
    min = Infinity,
    max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  switch (mode) {
    case 'sum':
      return clamp(sum);
    case 'mean':
      return clamp(sum / n);
    case 'minimum':
      return min;
    case 'maximum':
      return max;
    case 'range':
      return max - min;
    case 'median': {
      for (let i = 0; i < n; i++) {
        // Insertion sort: stacks are short (tens of layers).
        const v = values[i];
        let j = i - 1;
        while (j >= 0 && scratch[j] > v) {
          scratch[j + 1] = scratch[j];
          j--;
        }
        scratch[j + 1] = v;
      }
      const h = n >> 1;
      return clamp(n % 2 ? scratch[h] : (scratch[h - 1] + scratch[h]) / 2);
    }
    case 'entropy': {
      if (n < 2) return 0;
      for (let i = 0; i < n; i++) scratch[i] = values[i];
      scratch.subarray(0, n).sort();
      let h = 0;
      for (let i = 0; i < n; ) {
        let j = i;
        while (j < n && scratch[j] === scratch[i]) j++;
        const p = (j - i) / n;
        h -= p * Math.log2(p);
        i = j;
      }
      return clamp((h / Math.log2(n)) * 255);
    }
  }
  const mean = sum / n;
  let m2 = 0,
    m3 = 0,
    m4 = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - mean,
      d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  if (mode === 'variance') return clamp(m2);
  if (mode === 'deviation') return clamp(Math.sqrt(m2));
  if (m2 < 1e-12) return 128;
  if (mode === 'skewness') return clamp(128 + 32 * (m3 / Math.pow(m2, 1.5)));
  return clamp(128 + 32 * (m4 / (m2 * m2) - 3));
}

/** Combine same-size straight RGBA8 layers (bottom first) pixel by pixel. */
export function stackLayers(layers: ArrayLike<number>[], pixels: number, mode: StackMode): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels * 4);
  const count = layers.length;
  const values = new Float64Array(count),
    scratch = new Float64Array(count);
  for (let p = 0, o = 0; p < pixels; p++, o += 4) {
    let alpha = 0;
    for (let c = 0; c < 3; c++) {
      let n = 0;
      for (let k = 0; k < count; k++) {
        const a = layers[k][o + 3];
        if (!a) continue;
        if (c === 0 && a > alpha) alpha = a;
        values[n++] = layers[k][o + c];
      }
      if (!n) break;
      out[o + c] = reduceSamples(values, n, mode, scratch);
    }
    out[o + 3] = alpha;
  }
  return out;
}
