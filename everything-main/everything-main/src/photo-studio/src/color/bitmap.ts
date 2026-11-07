// 1-bit (Bitmap mode) conversion from gray: 50% threshold, ordered pattern
// dither, Floyd-Steinberg error diffusion and an AM halftone screen with a
// chosen frequency, angle and dot shape, rendered at the output resolution.
import { BAYER8 } from './indexed';

export type BitmapMethod = 'threshold' | 'pattern' | 'diffusion' | 'halftone';
export type HalftoneShape = 'round' | 'ellipse' | 'line' | 'square' | 'cross' | 'diamond';
export type BitmapOptions = {
  method?: BitmapMethod;
  // Threshold level (0-255) for 'threshold'.
  threshold?: number;
  // Pixels per inch of the source and of the 1-bit output.
  inputResolution?: number;
  outputResolution?: number;
  // Lines per inch, degrees and dot shape for 'halftone'.
  frequency?: number;
  angle?: number;
  shape?: HalftoneShape;
};
export type BitmapResult = {
  width: number;
  height: number;
  // One byte per pixel: 1 = black (ink), 0 = white, as PSD bitmap mode.
  bits: Uint8Array;
  resolution: number;
};

// Area-average when shrinking, bilinear when enlarging.
export function resampleGray(src: Uint8Array, w: number, h: number, w2: number, h2: number): Float32Array {
  const out = new Float32Array(w2 * h2);
  if (w2 === w && h2 === h) {
    out.set(src);
    return out;
  }
  const sx = w / w2,
    sy = h / h2;
  if (sx >= 1 && sy >= 1) {
    for (let y = 0; y < h2; y++) {
      const y0 = y * sy,
        y1 = y0 + sy;
      for (let x = 0; x < w2; x++) {
        const x0 = x * sx,
          x1 = x0 + sx;
        let sum = 0,
          area = 0;
        for (let yy = Math.floor(y0); yy < Math.min(h, Math.ceil(y1)); yy++) {
          const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
          for (let xx = Math.floor(x0); xx < Math.min(w, Math.ceil(x1)); xx++) {
            const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
            sum += src[yy * w + xx] * wx * wy;
            area += wx * wy;
          }
        }
        out[y * w2 + x] = area ? sum / area : 0;
      }
    }
    return out;
  }
  for (let y = 0; y < h2; y++) {
    const fy = Math.max(0, Math.min(h - 1, (y + 0.5) * sy - 0.5)),
      y0 = Math.floor(fy),
      y1 = Math.min(h - 1, y0 + 1),
      ty = fy - y0;
    for (let x = 0; x < w2; x++) {
      const fx = Math.max(0, Math.min(w - 1, (x + 0.5) * sx - 0.5)),
        x0 = Math.floor(fx),
        x1 = Math.min(w - 1, x0 + 1),
        tx = fx - x0;
      const a = src[y0 * w + x0] + (src[y0 * w + x1] - src[y0 * w + x0]) * tx,
        b = src[y1 * w + x0] + (src[y1 * w + x1] - src[y1 * w + x0]) * tx;
      out[y * w2 + x] = a + (b - a) * ty;
    }
  }
  return out;
}

// Spot functions on cell coordinates x, y in [-1, 1]; larger values turn
// black first. Tone accuracy comes from ranking values through the
// function's own distribution over a cell, so shapes need not be area-linear.
const SPOTS: Record<HalftoneShape, (x: number, y: number) => number> = {
  round: (x, y) => (Math.cos(Math.PI * x) + Math.cos(Math.PI * y)) / 4 + 0.5,
  ellipse: (x, y) => (Math.cos(Math.PI * x) + 0.6 * Math.cos(Math.PI * y)) / 3.2 + 0.5,
  line: (_x, y) => Math.cos(Math.PI * y) / 2 + 0.5,
  square: (x, y) => 1 - Math.max(Math.abs(x), Math.abs(y)),
  cross: (x, y) => 1 - Math.min(Math.abs(x), Math.abs(y)),
  diamond: (x, y) => 1 - (Math.abs(x) + Math.abs(y)) / 2,
};
const rankCache = new Map<HalftoneShape, Float32Array>();
function spotRanks(shape: HalftoneShape): Float32Array {
  let cdf = rankCache.get(shape);
  if (cdf) return cdf;
  const bins = 4096,
    hist = new Float64Array(bins),
    n = 256,
    f = SPOTS[shape];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const v = f(((i + 0.5) / n) * 2 - 1, ((j + 0.5) / n) * 2 - 1);
      hist[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]++;
    }
  cdf = new Float32Array(bins);
  // Fraction of the cell with a strictly higher spot value (turns black sooner).
  let above = n * n;
  for (let b = 0; b < bins; b++) {
    above -= hist[b];
    cdf[b] = (above + hist[b] / 2) / (n * n);
  }
  rankCache.set(shape, cdf);
  return cdf;
}

// gray: 0 = black, 255 = white.
export function grayToBitmap(gray: Uint8Array, width: number, height: number, opts: BitmapOptions = {}): BitmapResult {
  const inRes = opts.inputResolution ?? 72,
    outRes = opts.outputResolution ?? inRes;
  const w2 = Math.max(1, Math.round((width * outRes) / inRes)),
    h2 = Math.max(1, Math.round((height * outRes) / inRes));
  const g = resampleGray(gray, width, height, w2, h2);
  const bits = new Uint8Array(w2 * h2);
  const method = opts.method ?? 'diffusion';
  if (method === 'threshold') {
    const t = opts.threshold ?? 128;
    for (let i = 0; i < bits.length; i++) bits[i] = g[i] < t ? 1 : 0;
  } else if (method === 'pattern') {
    for (let y = 0, i = 0; y < h2; y++)
      for (let x = 0; x < w2; x++, i++) bits[i] = g[i] / 255 < BAYER8[(y & 7) * 8 + (x & 7)] ? 1 : 0;
  } else if (method === 'diffusion') {
    // Floyd-Steinberg, serpentine; error carried in a float copy.
    for (let y = 0; y < h2; y++) {
      const ltr = (y & 1) === 0,
        dir = ltr ? 1 : -1;
      for (let s = 0; s < w2; s++) {
        const x = ltr ? s : w2 - 1 - s,
          i = y * w2 + x;
        const v = g[i],
          black = v < 127.5;
        bits[i] = black ? 1 : 0;
        const e = v - (black ? 0 : 255);
        const xn = x + dir;
        if (xn >= 0 && xn < w2) g[i + dir] += (e * 7) / 16;
        if (y + 1 < h2) {
          const r = i + w2;
          if (x - dir >= 0 && x - dir < w2) g[r - dir] += (e * 3) / 16;
          g[r] += (e * 5) / 16;
          if (xn >= 0 && xn < w2) g[r + dir] += e / 16;
        }
      }
    }
  } else {
    const lpi = opts.frequency ?? 53,
      cell = Math.max(1, outRes / lpi);
    const theta = ((opts.angle ?? 45) * Math.PI) / 180,
      cs = Math.cos(theta) / cell,
      sn = Math.sin(theta) / cell;
    const shape = opts.shape ?? 'round',
      spot = SPOTS[shape],
      ranks = spotRanks(shape);
    for (let y = 0, i = 0; y < h2; y++)
      for (let x = 0; x < w2; x++, i++) {
        const X = x + 0.5,
          Y = y + 0.5;
        const u = X * cs + Y * sn,
          v = -X * sn + Y * cs;
        const fx = (u - Math.floor(u)) * 2 - 1,
          fy = (v - Math.floor(v)) * 2 - 1;
        const s = spot(fx, fy);
        const rank = ranks[Math.min(4095, Math.max(0, Math.floor(s * 4096)))];
        bits[i] = rank < 1 - g[i] / 255 ? 1 : 0;
      }
  }
  return { width: w2, height: h2, bits, resolution: outRes };
}

// Pack to 1 bit per pixel, most significant bit first, rows padded to bytes
// (PSD/TIFF bitmap layout with 1 = black).
export function packBitmap(b: BitmapResult): Uint8Array {
  const stride = Math.ceil(b.width / 8);
  const out = new Uint8Array(stride * b.height);
  for (let y = 0; y < b.height; y++)
    for (let x = 0; x < b.width; x++) if (b.bits[y * b.width + x]) out[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
  return out;
}
