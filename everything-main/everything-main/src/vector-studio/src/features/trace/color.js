/**
 * Color quantization for tracing: pixels are clustered in OKLab, a
 * perceptual color space, so clusters match colors people tell apart.
 *
 * quantize(image, opts) -> { labels: Int32Array, palette: [{ r, g, b }] }
 * labels[i] is the palette index of pixel i, or -1 for transparent pixels.
 * The function is pure and deterministic (seeded sampling and k-means++),
 * so the same image and options always trace the same way.
 */

const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB bytes -> OKLab [L, a, b] (L in 0..1). */
export function rgbToOklab(r, g, b, out = [0, 0, 0]) {
  const lr = LIN[r];
  const lg = LIN[g];
  const lb = LIN[b];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  out[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return out;
}

/** Perceived lightness of sRGB bytes, 0..255 (gamma-encoded luma). */
export function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function toHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed = 0x9e3779b9) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHA_MIN = 128;

/** Up to `max` opaque pixel indices, spread evenly with a seeded jitter. */
function samplePixels(data, n, max, random) {
  const out = [];
  const step = Math.max(1, n / max);
  for (let f = 0; f < n; f += step) {
    const i = Math.min(n - 1, Math.floor(f + random() * step));
    if (data[i * 4 + 3] >= ALPHA_MIN) out.push(i);
  }
  return out;
}

/**
 * k-means in a d-dimensional space with k-means++ seeding. `pts` is a flat
 * Float64Array (n * d). Returns { centers (k * d), counts, k } where k may be
 * smaller than asked when there are fewer distinct points.
 */
export function kmeans(pts, d, k, { iterations = 12, random = rng() } = {}) {
  const n = pts.length / d;
  if (!n) return { centers: new Float64Array(0), counts: new Int32Array(0), k: 0 };
  k = Math.max(1, Math.min(k, n));
  const centers = new Float64Array(k * d);
  const dist = new Float64Array(n).fill(Infinity);
  const d2 = (i, c) => {
    let s = 0;
    for (let j = 0; j < d; j++) {
      const v = pts[i * d + j] - centers[c * d + j];
      s += v * v;
    }
    return s;
  };
  // k-means++: each new center is picked with probability proportional to its squared distance.
  let first = Math.floor(random() * n);
  for (let j = 0; j < d; j++) centers[j] = pts[first * d + j];
  let made = 1;
  for (; made < k; made++) {
    let total = 0;
    for (let i = 0; i < n; i++) {
      const v = d2(i, made - 1);
      if (v < dist[i]) dist[i] = v;
      total += dist[i];
    }
    if (total <= 1e-12) break; // every point coincides with a center already
    let r = random() * total;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      r -= dist[i];
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    for (let j = 0; j < d; j++) centers[made * d + j] = pts[pick * d + j];
  }
  k = made;
  const assign = new Int32Array(n);
  const sums = new Float64Array(k * d);
  const counts = new Int32Array(k);
  for (let it = 0; it < iterations; it++) {
    sums.fill(0);
    counts.fill(0);
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < k; c++) {
        const v = d2(i, c);
        if (v < bd) {
          bd = v;
          best = c;
        }
      }
      if (assign[i] !== best) moved++;
      assign[i] = best;
      counts[best]++;
      for (let j = 0; j < d; j++) sums[best * d + j] += pts[i * d + j];
    }
    for (let c = 0; c < k; c++) {
      if (!counts[c]) continue;
      for (let j = 0; j < d; j++) centers[c * d + j] = sums[c * d + j] / counts[c];
    }
    if (it > 0 && moved === 0) break;
  }
  return { centers: centers.slice(0, k * d), counts: counts.slice(0, k), k };
}

/**
 * Merge clusters closer than `minDist` (OKLab distance) and drop clusters
 * holding less than `minShare` of the samples, largest first. Used by the
 * automatic palette so simple artwork gets only the colors it has.
 */
function pruneCenters(centers, counts, minDist, minShare) {
  const k = counts.length;
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const order = [...Array(k).keys()].sort((a, b) => counts[b] - counts[a]);
  const kept = [];
  for (const c of order) {
    if (!counts[c]) continue;
    const P = [centers[c * 3], centers[c * 3 + 1], centers[c * 3 + 2]];
    const share = counts[c] / total;
    if (kept.some((o) => Math.hypot(o[0] - P[0], o[1] - P[1], o[2] - P[2]) < minDist)) continue;
    if (kept.length && share < minShare) continue;
    // A small cluster lying between two larger ones is their antialiased edge, not a color.
    if (share < 0.12 && kept.length >= 2 && isBlend(P, kept)) continue;
    kept.push(P);
  }
  return kept;
}

/** True when P lies near the segment between two of `colors` (OKLab). */
function isBlend(P, colors) {
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const A = colors[i];
      const B = colors[j];
      const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
      if (!len2) continue;
      const t = ((P[0] - A[0]) * ab[0] + (P[1] - A[1]) * ab[1] + (P[2] - A[2]) * ab[2]) / len2;
      if (t <= 0.05 || t >= 0.95) continue;
      if (Math.hypot(P[0] - A[0] - t * ab[0], P[1] - A[1] - t * ab[1], P[2] - A[2] - t * ab[2]) < 0.03) return true;
    }
  }
  return false;
}

/**
 * Quantize an image. opts:
 *   mode       'color' | 'gray' | 'bw'
 *   palette    'limited' | 'fullTone' | 'auto' | 'swatches' (color mode)
 *   colors     number of colors (color mode; the most for 'auto')
 *   grays      number of gray levels (gray mode)
 *   threshold  0..255: darker pixels become black (bw mode)
 *   swatches   ['#rrggbb'] for the 'swatches' palette
 * Returns { labels, palette } with palette colors as { r, g, b } bytes.
 */
export function quantize(image, opts = {}) {
  const { width, height, data } = image;
  const n = width * height;
  const labels = new Int32Array(n);
  const mode = opts.mode || 'color';
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < ALPHA_MIN) labels[i] = -1;

  if (mode === 'bw') {
    const t = opts.threshold ?? 128;
    for (let i = 0; i < n; i++) {
      if (labels[i] === -1) continue;
      labels[i] = luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < t ? 0 : 1;
    }
    return { labels, palette: [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }] };
  }

  const random = rng(0x5eed + n);
  if (mode === 'gray') {
    const levels = Math.max(2, Math.min(256, Math.round(opts.grays || 8)));
    // 1-D k-means over a luma histogram (weights = pixel counts), seeded with even levels.
    const hist = new Float64Array(256);
    for (let i = 0; i < n; i++) if (labels[i] !== -1) hist[Math.round(luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]))]++;
    const used = [];
    for (let v = 0; v < 256; v++) if (hist[v]) used.push(v);
    let centers = [];
    if (used.length <= levels) centers = used.slice();
    else {
      for (let j = 0; j < levels; j++) centers.push(used[Math.round((j * (used.length - 1)) / (levels - 1))]);
      for (let it = 0; it < 20; it++) {
        const s = new Float64Array(centers.length);
        const c = new Float64Array(centers.length);
        let ci = 0;
        for (const v of used) {
          while (ci + 1 < centers.length && Math.abs(centers[ci + 1] - v) < Math.abs(centers[ci] - v)) ci++;
          s[ci] += v * hist[v];
          c[ci] += hist[v];
        }
        const next = centers.map((v, j) => (c[j] ? s[j] / c[j] : v));
        if (next.every((v, j) => Math.abs(v - centers[j]) < 0.01)) break;
        centers = next.sort((a, b) => a - b);
      }
    }
    const lut = new Int32Array(256);
    let ci = 0;
    for (let v = 0; v < 256; v++) {
      while (ci + 1 < centers.length && Math.abs(centers[ci + 1] - v) <= Math.abs(centers[ci] - v)) ci++;
      lut[v] = ci;
    }
    for (let i = 0; i < n; i++) if (labels[i] !== -1) labels[i] = lut[Math.round(luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]))];
    return { labels, palette: centers.map((v) => ({ r: v, g: v, b: v })) };
  }

  // ---- color ----
  let centers; // OKLab triples
  const palette = opts.palette || 'limited';
  const lab = [0, 0, 0];
  if (palette === 'swatches' && opts.swatches?.length) {
    centers = opts.swatches.map(parseHex).filter(Boolean).map((c) => rgbToOklab(c.r, c.g, c.b, [0, 0, 0]));
  } else {
    const want = Math.max(2, Math.min(64, Math.round(opts.colors || 6)));
    const sample = samplePixels(data, n, 60000, random);
    const pts = new Float64Array(sample.length * 3);
    sample.forEach((i, s) => {
      rgbToOklab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], lab);
      pts[s * 3] = lab[0];
      pts[s * 3 + 1] = lab[1];
      pts[s * 3 + 2] = lab[2];
    });
    const auto = palette === 'auto';
    const res = kmeans(pts, 3, auto ? Math.min(64, want + 8) : want, { random, iterations: 14 });
    if (auto) centers = pruneCenters(res.centers, res.counts, 0.07, 0.004).slice(0, want);
    else {
      centers = [];
      for (let c = 0; c < res.k; c++) centers.push([res.centers[c * 3], res.centers[c * 3 + 1], res.centers[c * 3 + 2]]);
    }
  }
  if (!centers.length) centers = [[1, 0, 0]];
  // Nearest center for every pixel, memoized on 15-bit RGB.
  const memo = new Int16Array(32768).fill(-1);
  const k = centers.length;
  const nearest = (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let v = memo[key];
    if (v >= 0) return v;
    rgbToOklab((r & 0xf8) | 4, (g & 0xf8) | 4, (b & 0xf8) | 4, lab);
    let bd = Infinity;
    v = 0;
    for (let c = 0; c < k; c++) {
      const C = centers[c];
      const d = (C[0] - lab[0]) ** 2 + (C[1] - lab[1]) ** 2 + (C[2] - lab[2]) ** 2;
      if (d < bd) {
        bd = d;
        v = c;
      }
    }
    memo[key] = v;
    return v;
  };
  const sums = new Float64Array(k * 3);
  const counts = new Float64Array(k);
  for (let i = 0; i < n; i++) {
    if (labels[i] === -1) continue;
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const c = nearest(r, g, b);
    labels[i] = c;
    sums[c * 3] += r;
    sums[c * 3 + 1] += g;
    sums[c * 3 + 2] += b;
    counts[c]++;
  }
  // Output colors: swatches stay exact; clusters take the mean color of their pixels.
  const swatchRgb = palette === 'swatches' && opts.swatches?.length ? opts.swatches.map(parseHex).filter(Boolean) : null;
  const out = centers.map((_, c) => (swatchRgb ? swatchRgb[c] : counts[c] ? { r: sums[c * 3] / counts[c], g: sums[c * 3 + 1] / counts[c], b: sums[c * 3 + 2] / counts[c] } : { r: 0, g: 0, b: 0 }));
  return { labels, palette: out };
}
