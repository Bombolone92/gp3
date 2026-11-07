// Point sampling of straight-alpha RGBA8 images plus small helpers shared by the
// distort, pixelate, lens, liquify and develop filters.
//
// Coordinates are continuous image space: pixel (i, j) covers [i, i+1) x [j, j+1)
// and its center is (i + 0.5, j + 0.5), so sampling at a center returns that
// pixel exactly for every interpolating kernel. Colors are averaged with alpha
// weights (premultiplied accumulation, then divided by the accumulated alpha) so
// transparent neighbours never bleed black into edges.
import type { IRect, Mask8, ParamValues, Progress, RGBA8 } from '../types';
import { checkCancelled, rgba8 } from '../types';

export type EdgeMode = 'transparent' | 'clamp' | 'wrap' | 'mirror';
export type Interp = 'nearest' | 'bilinear' | 'bicubic' | 'mitchell' | 'lanczos';
// Writes straight RGBA in 0..255 floats to out[o..o+3].
export type Sampler = (src: RGBA8, x: number, y: number, edge: EdgeMode, out: Float32Array, o: number) => void;

// Maps an integer tap index into [0, n) or -1 for "transparent".
export function edgeIndex(i: number, n: number, edge: EdgeMode): number {
  if (i >= 0 && i < n) return i;
  if (!(i === i)) return -1;
  switch (edge) {
    case 'clamp':
      return i < 0 ? 0 : n - 1;
    case 'wrap':
      return ((i % n) + n) % n;
    case 'mirror': {
      const p = 2 * n;
      let m = ((i % p) + p) % p;
      if (m >= n) m = p - 1 - m;
      return m;
    }
    default:
      return -1;
  }
}

function zero(out: Float32Array, o: number) {
  out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
}

export function sampleNearest(src: RGBA8, x: number, y: number, edge: EdgeMode, out: Float32Array, o: number) {
  const { width: w, height: h, data: d } = src;
  const xi = edgeIndex(Math.floor(x), w, edge),
    yi = edgeIndex(Math.floor(y), h, edge);
  if (xi < 0 || yi < 0) return zero(out, o);
  const k = (yi * w + xi) * 4;
  out[o] = d[k];
  out[o + 1] = d[k + 1];
  out[o + 2] = d[k + 2];
  out[o + 3] = d[k + 3];
}

export function sampleBilinear(src: RGBA8, x: number, y: number, edge: EdgeMode, out: Float32Array, o: number) {
  const { width: w, height: h, data: d } = src;
  x -= 0.5;
  y -= 0.5;
  if (!(x === x && y === y) || (edge === 'transparent' && (x < -1 || y < -1 || x > w || y > h))) return zero(out, o);
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0;
  let i00: number, i10: number, i01: number, i11: number;
  if (x0 >= 0 && y0 >= 0 && x0 + 1 < w && y0 + 1 < h) {
    i00 = (y0 * w + x0) * 4;
    i10 = i00 + 4;
    i01 = i00 + w * 4;
    i11 = i01 + 4;
  } else {
    const xa = edgeIndex(x0, w, edge),
      xb = edgeIndex(x0 + 1, w, edge),
      ya = edgeIndex(y0, h, edge),
      yb = edgeIndex(y0 + 1, h, edge);
    i00 = xa < 0 || ya < 0 ? -1 : (ya * w + xa) * 4;
    i10 = xb < 0 || ya < 0 ? -1 : (ya * w + xb) * 4;
    i01 = xa < 0 || yb < 0 ? -1 : (yb * w + xa) * 4;
    i11 = xb < 0 || yb < 0 ? -1 : (yb * w + xb) * 4;
  }
  const a00 = i00 < 0 ? 0 : (1 - fx) * (1 - fy) * d[i00 + 3],
    a10 = i10 < 0 ? 0 : fx * (1 - fy) * d[i10 + 3],
    a01 = i01 < 0 ? 0 : (1 - fx) * fy * d[i01 + 3],
    a11 = i11 < 0 ? 0 : fx * fy * d[i11 + 3];
  const a = a00 + a10 + a01 + a11;
  if (a <= 1e-6) return zero(out, o);
  let r = 0,
    g = 0,
    b = 0;
  if (a00) ((r += a00 * d[i00]), (g += a00 * d[i00 + 1]), (b += a00 * d[i00 + 2]));
  if (a10) ((r += a10 * d[i10]), (g += a10 * d[i10 + 1]), (b += a10 * d[i10 + 2]));
  if (a01) ((r += a01 * d[i01]), (g += a01 * d[i01 + 1]), (b += a01 * d[i01 + 2]));
  if (a11) ((r += a11 * d[i11]), (g += a11 * d[i11 + 1]), (b += a11 * d[i11 + 2]));
  out[o] = r / a;
  out[o + 1] = g / a;
  out[o + 2] = b / a;
  out[o + 3] = a;
}

// Mitchell-Netravali (B, C) cubic family: B=0, C=0.5 is Catmull-Rom, B=C=1/3 is
// Mitchell (softer, less ringing), B=0, C=0.75 is a sharper Keys kernel.
export function cubicBC(x: number, B: number, C: number): number {
  x = Math.abs(x);
  if (x < 1) return ((12 - 9 * B - 6 * C) * x * x * x + (-18 + 12 * B + 6 * C) * x * x + (6 - 2 * B)) / 6;
  if (x < 2)
    return ((-B - 6 * C) * x * x * x + (6 * B + 30 * C) * x * x + (-12 * B - 48 * C) * x + (8 * B + 24 * C)) / 6;
  return 0;
}
export function lanczos3(x: number): number {
  x = Math.abs(x);
  if (x < 1e-7) return 1;
  if (x >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}

const WX = new Float64Array(6),
  WY = new Float64Array(6),
  IX = new Int32Array(6),
  IY = new Int32Array(6);

function catmullRom(f: number, w: Float64Array) {
  const f2 = f * f;
  w[0] = (-0.5 * f + 1) * f2 - 0.5 * f;
  w[1] = (1.5 * f - 2.5) * f2 + 1;
  w[2] = (-1.5 * f + 2) * f2 + 0.5 * f;
  w[3] = (0.5 * f - 0.5) * f2;
}

function sampleSeparable(
  src: RGBA8,
  x: number,
  y: number,
  edge: EdgeMode,
  out: Float32Array,
  o: number,
  taps: number,
  kind: number,
) {
  const { width: w, height: h, data: d } = src;
  x -= 0.5;
  y -= 0.5;
  const half = taps >> 1;
  if (!(x === x && y === y) || (edge === 'transparent' && (x < -half || y < -half || x > w + half || y > h + half)))
    return zero(out, o);
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0;
  if (kind === 0) {
    // Catmull-Rom weights in closed form (they sum to exactly 1).
    catmullRom(fx, WX);
    catmullRom(fy, WY);
  } else {
    let sx = 0,
      sy = 0;
    for (let k = 0; k < taps; k++) {
      const t = k - half + 1;
      const wx = kind === 1 ? cubicBC(fx - t, 1 / 3, 1 / 3) : lanczos3(fx - t),
        wy = kind === 1 ? cubicBC(fy - t, 1 / 3, 1 / 3) : lanczos3(fy - t);
      WX[k] = wx;
      WY[k] = wy;
      sx += wx;
      sy += wy;
    }
    for (let k = 0; k < taps; k++) {
      WX[k] /= sx;
      WY[k] /= sy;
    }
  }
  let r = 0,
    g = 0,
    b = 0,
    a = 0;
  const bx = x0 - half + 1,
    by = y0 - half + 1;
  if (bx >= 0 && by >= 0 && bx + taps <= w && by + taps <= h) {
    // Interior: no edge handling needed.
    for (let j = 0; j < taps; j++) {
      const wy = WY[j];
      let k = ((by + j) * w + bx) * 4;
      for (let i = 0; i < taps; i++, k += 4) {
        const wa = WX[i] * wy * d[k + 3];
        r += wa * d[k];
        g += wa * d[k + 1];
        b += wa * d[k + 2];
        a += wa;
      }
    }
  } else {
    for (let k = 0; k < taps; k++) {
      IX[k] = edgeIndex(bx + k, w, edge);
      IY[k] = edgeIndex(by + k, h, edge);
    }
    for (let j = 0; j < taps; j++) {
      const yi = IY[j];
      if (yi < 0) continue;
      const wy = WY[j],
        row = yi * w;
      for (let i = 0; i < taps; i++) {
        const xi = IX[i];
        if (xi < 0) continue;
        const k = (row + xi) * 4,
          wa = WX[i] * wy * d[k + 3];
        r += wa * d[k];
        g += wa * d[k + 1];
        b += wa * d[k + 2];
        a += wa;
      }
    }
  }
  if (a <= 1e-3) return zero(out, o);
  out[o] = r / a;
  out[o + 1] = g / a;
  out[o + 2] = b / a;
  out[o + 3] = a > 255 ? 255 : a;
}
export const sampleBicubic: Sampler = (s, x, y, e, out, o) => sampleSeparable(s, x, y, e, out, o, 4, 0);
export const sampleMitchell: Sampler = (s, x, y, e, out, o) => sampleSeparable(s, x, y, e, out, o, 4, 1);
export const sampleLanczos: Sampler = (s, x, y, e, out, o) => sampleSeparable(s, x, y, e, out, o, 6, 2);

export function samplerFor(method: Interp): Sampler {
  switch (method) {
    case 'nearest':
      return sampleNearest;
    case 'bicubic':
      return sampleBicubic;
    case 'mitchell':
      return sampleMitchell;
    case 'lanczos':
      return sampleLanczos;
    default:
      return sampleBilinear;
  }
}

const ONE = new Float32Array(4);
// Convenience single-point sampler returning a fresh [r, g, b, a].
export function sample(src: RGBA8, x: number, y: number, method: Interp = 'bilinear', edge: EdgeMode = 'clamp') {
  samplerFor(method)(src, x, y, edge, ONE, 0);
  return [ONE[0], ONE[1], ONE[2], ONE[3]];
}

// ---------------------------------------------------------------------------
// Generic inverse-mapping warp.

// Maps an output point (continuous, pixel centers at i + 0.5) to the source
// point to sample; out arrives holding (x, y), so leaving it untouched means
// identity, and NaN in out[0] means "nothing here" (transparent).
export type CoordMap = (x: number, y: number, out: Float64Array) => void;
// Precomputed source coordinates at output grid nodes (i * step, j * step).
export type MapGrid = { step: number; cols: number; rows: number; sx: Float32Array; sy: Float32Array };
export type WarpOptions = {
  method?: Interp;
  edge?: EdgeMode;
  // >1 evaluates a CoordMap only every `gridStep` output pixels and interpolates
  // the coordinates bilinearly, which is accurate for smooth maps and much cheaper.
  gridStep?: number;
  // Output pixel (0, 0) corresponds to map-space point (offsetX, offsetY).
  offsetX?: number;
  offsetY?: number;
  progress?: Progress;
};

export function buildMapGrid(map: CoordMap, outW: number, outH: number, step: number, ox = 0, oy = 0): MapGrid {
  const cols = Math.floor(outW / step) + 2,
    rows = Math.floor(outH / step) + 2;
  const sx = new Float32Array(cols * rows),
    sy = new Float32Array(cols * rows),
    t = new Float64Array(2);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      t[0] = ox + i * step;
      t[1] = oy + j * step;
      map(t[0], t[1], t);
      sx[j * cols + i] = t[0];
      sy[j * cols + i] = t[1];
    }
  return { step, cols, rows, sx, sy };
}

// Row loops live in their own functions so V8 optimizes them as ordinary
// calls instead of repeatedly entering and leaving on-stack-replaced code.
function warpRowGrid(
  src: RGBA8,
  od: Uint8ClampedArray,
  y: number,
  outW: number,
  g: MapGrid,
  sampler: Sampler,
  edge: EdgeMode,
  px: Float32Array,
) {
  const { step, cols, sx, sy } = g;
  const gv = (y + 0.5) / step,
    gj = Math.min(Math.floor(gv), g.rows - 2),
    fy = gv - gj,
    r0 = gj * cols,
    r1 = r0 + cols;
  let o = y * outW * 4;
  for (let x = 0; x < outW; x++, o += 4) {
    const gu = (x + 0.5) / step,
      gi = Math.min(Math.floor(gu), cols - 2),
      fx = gu - gi;
    const a = r0 + gi,
      b = r1 + gi;
    const x0 = sx[a] + (sx[a + 1] - sx[a]) * fx,
      x1 = sx[b] + (sx[b + 1] - sx[b]) * fx;
    const y0 = sy[a] + (sy[a + 1] - sy[a]) * fx,
      y1 = sy[b] + (sy[b + 1] - sy[b]) * fx;
    sampler(src, x0 + (x1 - x0) * fy, y0 + (y1 - y0) * fy, edge, px, 0);
    od[o] = px[0];
    od[o + 1] = px[1];
    od[o + 2] = px[2];
    od[o + 3] = px[3];
  }
}
function warpRowMap(
  src: RGBA8,
  od: Uint8ClampedArray,
  y: number,
  outW: number,
  f: CoordMap,
  ox: number,
  oy: number,
  sampler: Sampler,
  edge: EdgeMode,
  px: Float32Array,
  t: Float64Array,
) {
  const cy = oy + y + 0.5;
  let o = y * outW * 4;
  for (let x = 0; x < outW; x++, o += 4) {
    const cx = ox + x + 0.5;
    t[0] = cx;
    t[1] = cy;
    f(cx, cy, t);
    sampler(src, t[0], t[1], edge, px, 0);
    od[o] = px[0];
    od[o + 1] = px[1];
    od[o + 2] = px[2];
    od[o + 3] = px[3];
  }
}

export function warpImage(
  src: RGBA8,
  outW: number,
  outH: number,
  map: CoordMap | MapGrid,
  opts: WarpOptions = {},
): RGBA8 {
  const out = rgba8(outW, outH),
    od = out.data;
  const sampler = samplerFor(opts.method ?? 'bilinear'),
    edge = opts.edge ?? 'transparent';
  const ox = opts.offsetX ?? 0,
    oy = opts.offsetY ?? 0,
    progress = opts.progress;
  const px = new Float32Array(4),
    t = new Float64Array(2);
  let grid: MapGrid | null = null;
  if (typeof map !== 'function') grid = map;
  else if ((opts.gridStep ?? 1) > 1) grid = buildMapGrid(map, outW, outH, opts.gridStep!, ox, oy);
  for (let y = 0; y < outH; y++) {
    if ((y & 31) === 0) {
      checkCancelled(progress);
      progress?.report?.(y / outH);
    }
    if (grid) warpRowGrid(src, od, y, outW, grid, sampler, edge, px);
    else warpRowMap(src, od, y, outW, map as CoordMap, ox, oy, sampler, edge, px, t);
  }
  progress?.report?.(1);
  return out;
}

// ---------------------------------------------------------------------------
// Operation helpers (parameters, selections, deterministic randomness).

export function num(p: ParamValues, key: string, def: number): number {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : def;
}
export function str(p: ParamValues, key: string, def: string): string {
  const v = p[key];
  return typeof v === 'string' ? v : def;
}
export function bool(p: ParamValues, key: string, def: boolean): boolean {
  const v = p[key];
  return typeof v === 'boolean' ? v : def;
}
export function parseColor(v: unknown, def: [number, number, number]): [number, number, number] {
  if (typeof v !== 'string') return def;
  const m = /^#?([0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return def;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Bounding box of nonzero selection coverage; the whole image without a
// selection and null when the selection is empty.
export function selectionBounds(src: RGBA8, sel?: Mask8): IRect | null {
  if (!sel) return { x: 0, y: 0, width: src.width, height: src.height };
  const { width: w, height: h, data } = sel;
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let l = -1,
      r = -1;
    for (let x = 0; x < w; x++)
      if (data[row + x]) {
        l = x;
        break;
      }
    if (l < 0) continue;
    for (let x = w - 1; x >= l; x--)
      if (data[row + x]) {
        r = x;
        break;
      }
    if (l < x0) x0 = l;
    if (r > x1) x1 = r;
    if (y < y0) y0 = y;
    y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

// Blends `out` back toward `src` where the selection is partial or absent,
// in place; colors are mixed with alpha weights.
export function blendSelection(src: RGBA8, out: RGBA8, sel?: Mask8): RGBA8 {
  if (!sel) return out;
  const s = src.data,
    d = out.data,
    m = sel.data,
    n = m.length;
  for (let i = 0; i < n; i++) {
    const c = m[i];
    if (c === 255) continue;
    const k = i * 4;
    if (c === 0) {
      d[k] = s[k];
      d[k + 1] = s[k + 1];
      d[k + 2] = s[k + 2];
      d[k + 3] = s[k + 3];
      continue;
    }
    const t = c / 255,
      wa = s[k + 3] * (1 - t),
      wb = d[k + 3] * t,
      a = wa + wb;
    if (a > 0) {
      d[k] = (s[k] * wa + d[k] * wb) / a;
      d[k + 1] = (s[k + 1] * wa + d[k + 1] * wb) / a;
      d[k + 2] = (s[k + 2] * wa + d[k + 2] * wb) / a;
    }
    d[k + 3] = a;
  }
  return out;
}

// Copies `part` into `dst` at (x, y), clipped.
export function paste(dst: RGBA8, part: RGBA8, x: number, y: number): RGBA8 {
  const x0 = Math.max(0, x),
    y0 = Math.max(0, y),
    x1 = Math.min(dst.width, x + part.width),
    y1 = Math.min(dst.height, y + part.height);
  if (x1 <= x0) return dst;
  for (let j = y0; j < y1; j++) {
    const so = ((j - y) * part.width + (x0 - x)) * 4;
    dst.data.set(part.data.subarray(so, so + (x1 - x0) * 4), (j * dst.width + x0) * 4);
  }
  return dst;
}

// Stateless integer hash (lowbias32 by Chris Wellons) so per-cell randomness
// does not depend on iteration order or on which region is rendered.
export function hash32(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}
export function hash3(a: number, b: number, seed: number): number {
  return hash32(hash32(hash32(seed ^ 0x9e3779b9) ^ a) + Math.imul(b, 0x85ebca6b)) / 4294967296;
}
// mulberry32: small, fast, seeded sequential PRNG.
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// In-place running-sum box blur of a single float plane (one pass per axis);
// three passes approximate a Gaussian with sigma ~ sqrt((4r^2 + 4r) / 4).
export function boxBlurPlane(p: Float32Array, w: number, h: number, r: number, wrap = false, tmp?: Float32Array) {
  r = Math.round(r);
  if (r < 1) return;
  const line = tmp && tmp.length >= Math.max(w, h) ? tmp : new Float32Array(Math.max(w, h));
  const inv = 1 / (2 * r + 1);
  const pass = (n: number, stride: number, start: number) => {
    let acc = 0;
    for (let k = -r; k <= r; k++)
      acc += p[start + stride * (wrap ? ((k % n) + n) % n : k < 0 ? 0 : k >= n ? n - 1 : k)];
    for (let i = 0; i < n; i++) {
      line[i] = acc * inv;
      const add = i + r + 1,
        rem = i - r;
      acc +=
        p[start + stride * (wrap ? add % n : add >= n ? n - 1 : add)] -
        p[start + stride * (wrap ? ((rem % n) + n) % n : rem < 0 ? 0 : rem)];
    }
    for (let i = 0; i < n; i++) p[start + stride * i] = line[i];
  };
  for (let y = 0; y < h; y++) pass(w, 1, y * w);
  for (let x = 0; x < w; x++) pass(h, w, x);
}

// sRGB transfer (IEC 61966-2-1).
export const SRGB_TO_LINEAR = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();
// Indexed by sqrt(linear) so shadows get fine steps; returns 0..255 floats.
const ENC_N = 8192;
const LINEAR_TO_SRGB = (() => {
  const t = new Float32Array(ENC_N + 1);
  for (let i = 0; i <= ENC_N; i++) {
    const l = (i / ENC_N) ** 2;
    t[i] = 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
  }
  return t;
})();
export function encodeSRGB(l: number): number {
  if (!(l > 0)) return 0;
  if (l >= 1) return 255;
  return LINEAR_TO_SRGB[(Math.sqrt(l) * ENC_N + 0.5) | 0];
}
