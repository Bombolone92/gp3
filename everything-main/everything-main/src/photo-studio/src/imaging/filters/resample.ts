// Image resizing with separable, alpha-weighted filters.
//
// Each axis uses a precomputed contribution table. When reducing, the kernel is
// stretched by the reduction factor so every output pixel integrates (area
// averages) the input it covers instead of point-sampling it, which is what
// prevents aliasing and moire. The horizontal pass writes premultiplied float
// rows into a small ring buffer that the vertical pass consumes, so memory stays
// O(width * taps) even for 8192 px images.
import type { Progress, RGBA8 } from '../types';
import { checkCancelled, rgba8 } from '../types';
import { cubicBC, lanczos3 } from './sampling';

export type ResizeMethod =
  'nearest' | 'bilinear' | 'bicubic' | 'bicubic-smoother' | 'bicubic-sharper' | 'lanczos' | 'preserve-details';

type Kernel = { radius: number; fn: (x: number) => number };
function kernelFor(method: ResizeMethod): Kernel {
  switch (method) {
    case 'bilinear':
      return { radius: 1, fn: (x) => Math.max(0, 1 - Math.abs(x)) };
    // Mitchell-Netravali: smooth with almost no ringing, best for enlarging.
    case 'bicubic-smoother':
      return { radius: 2, fn: (x) => cubicBC(x, 1 / 3, 1 / 3) };
    // Keys a = -0.75: extra overshoot keeps reductions crisp.
    case 'bicubic-sharper':
      return { radius: 2, fn: (x) => cubicBC(x, 0, 0.75) };
    case 'lanczos':
    case 'preserve-details':
      return { radius: 3, fn: lanczos3 };
    default:
      return { radius: 2, fn: (x) => cubicBC(x, 0, 0.5) };
  }
}

type Contrib = { start: Int32Array; count: Int32Array; weights: Float32Array; stride: number };
// Taps that fall outside the image are dropped and the rest renormalized, which
// behaves like edge extension without biasing toward the border pixel.
function contributions(inN: number, outN: number, k: Kernel): Contrib {
  const scale = inN / outN,
    f = Math.max(1, scale),
    support = k.radius * f;
  const stride = Math.ceil(support * 2) + 2;
  const start = new Int32Array(outN),
    count = new Int32Array(outN),
    weights = new Float32Array(outN * stride);
  for (let i = 0; i < outN; i++) {
    const c = (i + 0.5) * scale;
    let lo = Math.max(0, Math.floor(c - support)),
      hi = Math.min(inN - 1, Math.ceil(c + support));
    if (hi - lo + 1 > stride) hi = lo + stride - 1;
    let sum = 0;
    const base = i * stride;
    for (let j = lo; j <= hi; j++) {
      const wgt = k.fn((j + 0.5 - c) / f);
      weights[base + j - lo] = wgt;
      sum += wgt;
    }
    // Trim zero-weight taps at both ends to shorten the inner loops.
    let a = 0,
      b = hi - lo;
    while (a < b && weights[base + a] === 0) a++;
    while (b > a && weights[base + b] === 0) b--;
    if (sum === 0) {
      weights[base] = 1;
      a = b = 0;
      sum = 1;
    }
    for (let j = a; j <= b; j++) weights[base + j - a] = weights[base + j] / sum;
    for (let j = b - a + 1; j < stride; j++) weights[base + j] = 0;
    start[i] = lo + a;
    count[i] = b - a + 1;
  }
  return { start, count, weights, stride };
}

function resizeNearest(src: RGBA8, w: number, h: number): RGBA8 {
  const out = rgba8(w, h),
    s = new Uint32Array(src.data.buffer, src.data.byteOffset, src.width * src.height),
    d = new Uint32Array(out.data.buffer);
  const xs = new Int32Array(w);
  for (let x = 0; x < w; x++) xs[x] = Math.min(src.width - 1, Math.floor(((x + 0.5) * src.width) / w));
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor(((y + 0.5) * src.height) / h)) * src.width,
      o = y * w;
    for (let x = 0; x < w; x++) d[o + x] = s[sy + xs[x]];
  }
  return out;
}

// The row passes are separate functions so V8 optimizes each as a plain call
// rather than via on-stack replacement of one long nested loop.
function premultiplyRow(sd: Uint8ClampedArray, so: number, sw: number, pre: Float32Array) {
  for (let i = 0; i < sw * 4; i += 4) {
    const a = sd[so + i + 3],
      m = a / 255;
    pre[i] = sd[so + i] * m;
    pre[i + 1] = sd[so + i + 1] * m;
    pre[i + 2] = sd[so + i + 2] * m;
    pre[i + 3] = a;
  }
}
function horizontalRow(pre: Float32Array, c: Contrib, width: number, ring: Float32Array, ro: number) {
  const { start, count, weights, stride } = c;
  for (let x = 0; x < width; x++) {
    let r = 0,
      g = 0,
      b = 0,
      a = 0,
      p = start[x] * 4,
      q = x * stride;
    for (let n = count[x]; n > 0; n--, p += 4, q++) {
      const wt = weights[q];
      r += wt * pre[p];
      g += wt * pre[p + 1];
      b += wt * pre[p + 2];
      a += wt * pre[p + 3];
    }
    const o = ro + x * 4;
    ring[o] = r;
    ring[o + 1] = g;
    ring[o + 2] = b;
    ring[o + 3] = a;
  }
}
function verticalRow(
  ring: Float32Array,
  rows: Int32Array,
  n: number,
  weights: Float32Array,
  q0: number,
  od: Uint8ClampedArray,
  o: number,
  rowLen: number,
) {
  for (let i = 0; i < rowLen; i += 4) {
    let r = 0,
      g = 0,
      b = 0,
      a = 0;
    for (let t = 0; t < n; t++) {
      const wt = weights[q0 + t],
        k = rows[t] + i;
      r += wt * ring[k];
      g += wt * ring[k + 1];
      b += wt * ring[k + 2];
      a += wt * ring[k + 3];
    }
    if (a < 0.01) {
      od[o + i] = od[o + i + 1] = od[o + i + 2] = od[o + i + 3] = 0;
      continue;
    }
    const m = 255 / a;
    od[o + i] = r * m;
    od[o + i + 1] = g * m;
    od[o + i + 2] = b * m;
    od[o + i + 3] = a;
  }
}

export function resize(
  src: RGBA8,
  width: number,
  height: number,
  method: ResizeMethod = 'bicubic',
  progress?: Progress,
): RGBA8 {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  if (method === 'nearest') return resizeNearest(src, width, height);
  const k = kernelFor(method);
  const sw = src.width,
    sh = src.height,
    sd = src.data;
  const cx = contributions(sw, width, k),
    cy = contributions(sh, height, k);
  const ringN = cy.stride + 1,
    rowLen = width * 4;
  const ring = new Float32Array(ringN * rowLen),
    pre = new Float32Array(sw * 4),
    rows = new Int32Array(cy.stride);
  const out = rgba8(width, height),
    od = out.data;
  let next = 0;
  for (let y = 0; y < height; y++) {
    if ((y & 15) === 0) {
      checkCancelled(progress);
      progress?.report?.(y / height);
    }
    const s0 = cy.start[y],
      n = cy.count[y];
    while (next < s0 + n) {
      premultiplyRow(sd, next * sw * 4, sw, pre);
      horizontalRow(pre, cx, width, ring, (next % ringN) * rowLen);
      next++;
    }
    for (let t = 0; t < n; t++) rows[t] = ((s0 + t) % ringN) * rowLen;
    verticalRow(ring, rows, n, cy.weights, y * cy.stride, od, y * rowLen, rowLen);
  }
  progress?.report?.(1);
  if (method === 'preserve-details' && width * height > sw * sh) detailSharpen(out, 0.35);
  return out;
}

// Mild unsharp mask with a 3x3 alpha-weighted blur; restores some of the
// micro-contrast that interpolation softens when enlarging.
function detailSharpen(img: RGBA8, amount: number) {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      if (src[k + 3] === 0) continue;
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx;
          const j = (yy * w + xx) * 4,
            wt = (dx ? 1 : 2) * (dy ? 1 : 2) * src[j + 3];
          r += wt * src[j];
          g += wt * src[j + 1];
          b += wt * src[j + 2];
          a += wt;
        }
      }
      d[k] = src[k] + amount * (src[k] - r / a);
      d[k + 1] = src[k + 1] + amount * (src[k + 1] - g / a);
      d[k + 2] = src[k + 2] + amount * (src[k + 2] - b / a);
    }
  }
}
