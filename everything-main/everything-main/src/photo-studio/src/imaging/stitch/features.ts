// Feature points for aligning overlapping photos: Harris corners on a small
// image pyramid, an intensity-centroid orientation per corner and a rotated
// 256-bit binary descriptor (pairs of smoothed intensity comparisons),
// matched by Hamming distance with a ratio test and a mutual check.
import type { RGBA8 } from '../types';
import { gaussianPlane } from '../filters/common';

export type Gray = { width: number; height: number; data: Float32Array };
export type Keypoint = { x: number; y: number; angle: number; score: number; level: number };
export type Features = { points: Keypoint[]; descriptors: Uint32Array; width: number; height: number };
export type Match = { a: number; b: number; distance: number };

const WORDS = 8; // 256 bits
const PATCH = 15; // descriptor sampling radius in level pixels

/** Luma in [0, 1]; fully transparent pixels read as 0 and are flagged invalid. */
export function grayOf(img: RGBA8, valid?: Uint8Array): Gray {
  const { width, height, data } = img;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
    if (valid) valid[i] = data[p + 3] > 200 ? 1 : 0;
  }
  return { width, height, data: out };
}

/** Area-averaged downscale of a gray plane by `f` (0 < f <= 1). */
export function scaleGray(g: Gray, f: number): Gray {
  if (f >= 1) return g;
  const w = Math.max(1, Math.round(g.width * f)),
    h = Math.max(1, Math.round(g.height * f));
  const out = new Float32Array(w * h);
  const sx = g.width / w,
    sy = g.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy),
      y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx),
        x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let s = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s += g.data[yy * g.width + xx];
      out[y * w + x] = s / ((y1 - y0) * (x1 - x0));
    }
  }
  return { width: w, height: h, data: out };
}

function scaleMask(m: Uint8Array, w: number, h: number, tw: number, th: number): Uint8Array {
  const out = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      // A target pixel is valid only when its whole footprint is.
      const x0 = Math.floor((x * w) / tw),
        x1 = Math.max(x0 + 1, Math.ceil(((x + 1) * w) / tw)),
        y0 = Math.floor((y * h) / th),
        y1 = Math.max(y0 + 1, Math.ceil(((y + 1) * h) / th));
      let ok = 1;
      for (let yy = y0; yy < y1 && ok; yy++) for (let xx = x0; xx < x1; xx++) if (!m[yy * w + Math.min(w - 1, xx)]) (ok = 0);
      out[y * tw + x] = ok;
    }
  return out;
}

/** Harris corner response (k = 0.04) with a Gaussian window. */
export function harris(g: Gray, sigma = 1.5): Float32Array {
  const { width: w, height: h, data } = g;
  const n = w * h;
  const xx = new Float32Array(n),
    yy = new Float32Array(n),
    xy = new Float32Array(n);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      // Sobel gradients.
      const gx = data[i - w + 1] + 2 * data[i + 1] + data[i + w + 1] - data[i - w - 1] - 2 * data[i - 1] - data[i + w - 1];
      const gy = data[i + w - 1] + 2 * data[i + w] + data[i + w + 1] - data[i - w - 1] - 2 * data[i - w] - data[i - w + 1];
      xx[i] = gx * gx;
      yy[i] = gy * gy;
      xy[i] = gx * gy;
    }
  const tmp = new Float32Array(n);
  gaussianPlane(xx, tmp, w, h, sigma);
  gaussianPlane(yy, tmp, w, h, sigma);
  gaussianPlane(xy, tmp, w, h, sigma);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = xx[i],
      b = yy[i],
      c = xy[i];
    r[i] = a * b - c * c - 0.04 * (a + b) * (a + b);
  }
  return r;
}

// Deterministic sampling pattern: 256 point pairs inside the patch, drawn
// from a clipped Gaussian by a fixed-seed generator.
const PATTERN = (() => {
  let s = 0x9e3779b9;
  const rand = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const gauss = () => {
    const u = Math.max(1e-9, rand()),
      v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const p = new Float32Array(256 * 4);
  for (let i = 0; i < p.length; i++) {
    let v = 0;
    do v = gauss() * (PATCH / 2.2);
    while (Math.abs(v) > PATCH - 1);
    p[i] = v;
  }
  return p;
})();

function bilinear(g: Gray, x: number, y: number) {
  const { width: w, height: h, data } = g;
  const fx = Math.max(0, Math.min(w - 1.001, x)),
    fy = Math.max(0, Math.min(h - 1.001, y));
  const ix = Math.floor(fx),
    iy = Math.floor(fy),
    ax = fx - ix,
    ay = fy - iy;
  const i = iy * w + ix;
  return (data[i] * (1 - ax) + data[i + 1] * ax) * (1 - ay) + (data[i + w] * (1 - ax) + data[i + w + 1] * ax) * ay;
}

/** Orientation from the intensity centroid of a disc around the point. */
function orientation(g: Gray, x: number, y: number, r: number) {
  let mx = 0,
    my = 0;
  const { width: w, data } = g;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const v = data[(y + dy) * w + x + dx];
      mx += dx * v;
      my += dy * v;
    }
  return Math.atan2(my, mx);
}

export type DetectOptions = { maxPoints?: number; levels?: number; grid?: number; valid?: Uint8Array };

/** Detect oriented corners with binary descriptors. Coordinates are in the
 * input image's pixels. `valid` (1 = usable) excludes transparent areas. */
export function detectFeatures(g: Gray, opts: DetectOptions = {}): Features {
  const maxPoints = opts.maxPoints ?? 3000,
    levels = opts.levels ?? 3,
    gridN = opts.grid ?? 12;
  const points: Keypoint[] = [];
  const descs: number[] = [];
  let level = g;
  let valid = opts.valid;
  let scale = 1;
  const perLevel = (l: number) => Math.round((maxPoints * Math.pow(0.6, l)) / ((1 - Math.pow(0.6, levels)) / 0.4));
  for (let l = 0; l < levels; l++) {
    if (l > 0) {
      const f = 0.7;
      const next = scaleGray(level, f);
      if (valid) valid = scaleMask(valid, level.width, level.height, next.width, next.height);
      level = next;
      scale /= f;
      // Effective scale relative to the input, from the actual sizes.
      scale = g.width / level.width;
    }
    const { width: w, height: h } = level;
    const border = PATCH + 3;
    if (w <= 2 * border + 2 || h <= 2 * border + 2) break;
    const r = harris(level);
    // Smoothed copy for descriptor tests (robust to noise).
    const smooth = { width: w, height: h, data: new Float32Array(level.data) };
    gaussianPlane(smooth.data, new Float32Array(w * h), w, h, 1.6);
    // Non-maximum suppression in 5x5, then the strongest per grid cell so
    // points spread over the whole image.
    let maxR = 0;
    for (let i = 0; i < r.length; i++) if (r[i] > maxR) maxR = r[i];
    // Low relative threshold: the per-cell quota keeps the strongest corners,
    // and weak-contrast corners still help in low-contrast areas.
    const threshold = Math.max(maxR * 1e-6, 1e-7);
    const cells: Keypoint[][] = Array.from({ length: gridN * gridN }, () => []);
    for (let y = border; y < h - border; y++)
      for (let x = border; x < w - border; x++) {
        const i = y * w + x;
        const v = r[i];
        if (v <= threshold) continue;
        if (valid) {
          let ok = true;
          for (let dy = -PATCH; dy <= PATCH && ok; dy += PATCH) for (let dx = -PATCH; dx <= PATCH; dx += PATCH) if (!valid[(y + dy) * w + x + dx]) (ok = false);
          if (!ok) continue;
        }
        let isMax = true;
        for (let dy = -2; dy <= 2 && isMax; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            if (!dx && !dy) continue;
            const u = r[i + dy * w + dx];
            if (u > v || (u === v && (dy < 0 || (dy === 0 && dx < 0)))) {
              isMax = false;
              break;
            }
          }
        if (!isMax) continue;
        const c = Math.min(gridN - 1, Math.floor((y / h) * gridN)) * gridN + Math.min(gridN - 1, Math.floor((x / w) * gridN));
        cells[c].push({ x, y, angle: 0, score: v, level: l });
      }
    const quota = Math.max(4, Math.ceil(perLevel(l) / (gridN * gridN)));
    const chosen: Keypoint[] = [];
    for (const c of cells) {
      c.sort((a, b) => b.score - a.score);
      chosen.push(...c.slice(0, quota));
    }
    chosen.sort((a, b) => b.score - a.score);
    for (const k of chosen.slice(0, perLevel(l))) {
      k.angle = orientation(smooth, k.x, k.y, PATCH - 2);
      const cos = Math.cos(k.angle),
        sin = Math.sin(k.angle);
      const d = new Array(WORDS).fill(0);
      for (let b = 0; b < 256; b++) {
        const o = b * 4;
        const ax = PATTERN[o],
          ay = PATTERN[o + 1],
          bx = PATTERN[o + 2],
          by = PATTERN[o + 3];
        const va = bilinear(smooth, k.x + ax * cos - ay * sin, k.y + ax * sin + ay * cos);
        const vb = bilinear(smooth, k.x + bx * cos - by * sin, k.y + bx * sin + by * cos);
        if (va < vb) d[b >> 5] |= 1 << (b & 31);
      }
      descs.push(...d);
      points.push({ x: (k.x + 0.5) * scale - 0.5, y: (k.y + 0.5) * scale - 0.5, angle: k.angle, score: k.score, level: l });
    }
  }
  return { points, descriptors: Uint32Array.from(descs.map((v) => v >>> 0)), width: g.width, height: g.height };
}

function popcount(v: number) {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function nearest(a: Features, b: Features) {
  const na = a.points.length,
    nb = b.points.length;
  const best = new Int32Array(na).fill(-1),
    d1 = new Int32Array(na).fill(1e9),
    d2 = new Int32Array(na).fill(1e9);
  const da = a.descriptors,
    db = b.descriptors;
  for (let i = 0; i < na; i++) {
    const oa = i * WORDS;
    for (let j = 0; j < nb; j++) {
      const ob = j * WORDS;
      let d = 0;
      for (let k = 0; k < WORDS && d < d2[i]; k++) d += popcount(da[oa + k] ^ db[ob + k]);
      if (d < d1[i]) {
        d2[i] = d1[i];
        d1[i] = d;
        best[i] = j;
      } else if (d < d2[i]) d2[i] = d;
    }
  }
  return { best, d1, d2 };
}

/** Mutual nearest neighbours that pass the distance-ratio test. */
export function matchFeatures(a: Features, b: Features, ratio = 0.8, maxDistance = 80): Match[] {
  if (!a.points.length || !b.points.length) return [];
  const ab = nearest(a, b),
    ba = nearest(b, a);
  const out: Match[] = [];
  for (let i = 0; i < a.points.length; i++) {
    const j = ab.best[i];
    if (j < 0 || ba.best[j] !== i) continue;
    if (ab.d1[i] > maxDistance || ab.d1[i] > ratio * ab.d2[i]) continue;
    out.push({ a: i, b: j, distance: ab.d1[i] });
  }
  return out;
}
