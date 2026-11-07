// Region measurements for Image > Analysis > Record Measurements: connected
// selection regions with area, contour perimeter, circularity, bounding box
// and gray-value statistics, plus CSV output for the Measurement Log.
import type { Mask8, RGBA8 } from '../types';

export type GrayStats = { mean: number; median: number; min: number; max: number; std: number };
export type RegionStats = GrayStats & {
  // Coverage-weighted area in square pixels.
  area: number;
  // Length of the 50% coverage contour (outer and inner boundaries), pixels.
  perimeter: number;
  // 4π·area / perimeter², 1 for a circle; clamped to [0, 1].
  circularity: number;
  // Bounding box of every covered pixel.
  x: number;
  y: number;
  width: number;
  height: number;
  // Area × mean gray value.
  integratedDensity: number;
};

/** Rec. 601 luma of each pixel (0-255). */
export function grayValues(img: RGBA8): Uint8Array {
  const out = new Uint8Array(img.width * img.height);
  const d = img.data;
  for (let p = 0, i = 0; p < out.length; p++, i += 4) out[p] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  return out;
}

/** Label 8-connected regions of nonzero coverage. Returns per-pixel labels
 * (0 = outside, 1..count) and the region count. */
export function labelRegions(mask: Mask8): { labels: Int32Array; count: number } {
  const { width: w, height: h, data } = mask;
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let count = 0;
  for (let start = 0; start < data.length; start++) {
    if (!data[start] || labels[start]) continue;
    const id = ++count;
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    while (top) {
      const p = stack[--top];
      const x = p % w,
        y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (data[q] && !labels[q]) {
            labels[q] = id;
            stack[top++] = q;
          }
        }
      }
    }
  }
  return { labels, count };
}

/** Contour length of the iso-0.5 line of a coverage field (0-1) for each
 * labelled region, using marching squares with linear interpolation. */
function contourLengths(w: number, h: number, field: Float32Array, labels: Int32Array, count: number): Float64Array {
  const out = new Float64Array(count + 1);
  const v = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : field[y * w + x]);
  const lab = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : labels[y * w + x]);
  // The region a contour cell belongs to: a labelled corner, else the
  // nearest labelled pixel around the cell (smoothing can move a contour
  // just outside its region at concave corners).
  const owner = (x: number, y: number) => {
    const direct = lab(x, y) || lab(x + 1, y) || lab(x + 1, y + 1) || lab(x, y + 1);
    if (direct) return direct;
    for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) if (lab(x + dx, y + dy)) return lab(x + dx, y + dy);
    return 0;
  };
  const pts: number[] = [];
  // Cells span pixel centers (x, y)..(x + 1, y + 1), padded by one pixel.
  for (let y = -1; y < h; y++)
    for (let x = -1; x < w; x++) {
      const a = v(x, y),
        b = v(x + 1, y),
        c = v(x + 1, y + 1),
        d = v(x, y + 1);
      const ia = a >= 0.5,
        ib = b >= 0.5,
        ic = c >= 0.5,
        id = d >= 0.5;
      if (ia === ib && ib === ic && ic === id) continue;
      const region = owner(x, y);
      if (!region) continue;
      pts.length = 0;
      const cross = (x0: number, y0: number, v0: number, x1: number, y1: number, v1: number) => {
        const t = (0.5 - v0) / (v1 - v0);
        pts.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      };
      // Edges in order: top, right, bottom, left.
      if (ia !== ib) cross(0, 0, a, 1, 0, b);
      if (ib !== ic) cross(1, 0, b, 1, 1, c);
      if (ic !== id) cross(1, 1, c, 0, 1, d);
      if (id !== ia) cross(0, 1, d, 0, 0, a);
      let len = 0;
      if (pts.length === 4) len = Math.hypot(pts[2] - pts[0], pts[3] - pts[1]);
      else if (pts.length === 8) {
        // Saddle: the center value decides which diagonal pair connects. When
        // it matches corner a, a and c join and the contour cuts off corners
        // b (top-right crossings) and d (bottom-left); otherwise a and c.
        const center = (a + b + c + d) / 4 >= 0.5;
        const seg = (i: number, j: number) => Math.hypot(pts[j * 2] - pts[i * 2], pts[j * 2 + 1] - pts[i * 2 + 1]);
        len = center === ia ? seg(0, 1) + seg(2, 3) : seg(0, 3) + seg(1, 2);
      }
      out[region] += len;
    }
  return out;
}

/** Perimeter of each labelled region. Pixel staircases along curves make a
 * raw contour about 5% too long, so the coverage is first smoothed with a
 * 3x3 binomial kernel (a disc then measures within about 1% of 2πr and
 * straight edges are unchanged). Regions too thin to survive smoothing use
 * the raw contour, which for a hard square of side n is 4n - 4 + 2√2. */
export function regionPerimeters(mask: Mask8, labels: Int32Array, count: number): Float64Array {
  const { width: w, height: h, data } = mask;
  const raw = new Float32Array(w * h);
  for (let i = 0; i < raw.length; i++) raw[i] = data[i] / 255;
  const rough = contourLengths(w, h, raw, labels, count);
  const smooth = new Float32Array(w * h);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : raw[y * w + x]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      smooth[y * w + x] =
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) + 2 * at(x - 1, y) + 4 * at(x, y) + 2 * at(x + 1, y) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) / 16;
  const fine = contourLengths(w, h, smooth, labels, count);
  const out = new Float64Array(count + 1);
  for (let r = 1; r <= count; r++) out[r] = fine[r] >= rough[r] * 0.8 ? fine[r] : rough[r];
  return out;
}

/** Statistics from a 256-bin histogram with fractional weights. */
export function histogramStats(hist: Float64Array): GrayStats {
  let total = 0,
    sum = 0,
    min = -1,
    max = -1;
  for (let i = 0; i < 256; i++) {
    const w = hist[i];
    if (w <= 0) continue;
    total += w;
    sum += w * i;
    if (min < 0) min = i;
    max = i;
  }
  if (!total) return { mean: 0, median: 0, min: 0, max: 0, std: 0 };
  const mean = sum / total;
  let acc = 0,
    median = 0,
    varSum = 0;
  for (let i = 0; i < 256; i++) varSum += hist[i] * (i - mean) ** 2;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= total / 2) {
      median = i;
      break;
    }
  }
  return { mean, median, min, max, std: Math.sqrt(varSum / total) };
}

/** Measure every connected region of `mask` (up to `limit`, largest first)
 * against the gray values of the image. */
export function measureRegions(mask: Mask8, gray: Uint8Array | null, limit = 500): RegionStats[] {
  const { width: w, data } = mask;
  const { labels, count } = labelRegions(mask);
  if (!count) return [];
  const perim = regionPerimeters(mask, labels, count);
  const area = new Float64Array(count + 1);
  const x0 = new Int32Array(count + 1).fill(2 ** 30),
    y0 = new Int32Array(count + 1).fill(2 ** 30),
    x1 = new Int32Array(count + 1).fill(-1),
    y1 = new Int32Array(count + 1).fill(-1);
  const hist = gray ? Array.from({ length: count + 1 }, () => new Float64Array(256)) : [];
  for (let p = 0; p < labels.length; p++) {
    const r = labels[p];
    if (!r) continue;
    const cov = data[p] / 255;
    area[r] += cov;
    const x = p % w,
      y = (p - x) / w;
    if (x < x0[r]) x0[r] = x;
    if (x > x1[r]) x1[r] = x;
    if (y < y0[r]) y0[r] = y;
    if (y > y1[r]) y1[r] = y;
    if (gray) hist[r][gray[p]] += cov;
  }
  const out: RegionStats[] = [];
  for (let r = 1; r <= count; r++) {
    const g = gray ? histogramStats(hist[r]) : { mean: 0, median: 0, min: 0, max: 0, std: 0 };
    out.push({
      ...g,
      area: area[r],
      perimeter: perim[r],
      circularity: circularity(area[r], perim[r]),
      x: x0[r],
      y: y0[r],
      width: x1[r] - x0[r] + 1,
      height: y1[r] - y0[r] + 1,
      integratedDensity: area[r] * g.mean,
    });
  }
  out.sort((a, b) => b.area - a.area || a.y - b.y || a.x - b.x);
  return out.slice(0, limit);
}

export function circularity(area: number, perimeter: number) {
  if (!(perimeter > 0)) return 0;
  return Math.min(1, (4 * Math.PI * area) / (perimeter * perimeter));
}

/** Combined statistics of several regions (the summary row): areas and
 * perimeters add up, gray values combine by area. */
export function summarize(regions: RegionStats[]): RegionStats | null {
  if (!regions.length) return null;
  const area = regions.reduce((s, r) => s + r.area, 0);
  const perimeter = regions.reduce((s, r) => s + r.perimeter, 0);
  const x = Math.min(...regions.map((r) => r.x)),
    y = Math.min(...regions.map((r) => r.y));
  const right = Math.max(...regions.map((r) => r.x + r.width)),
    bottom = Math.max(...regions.map((r) => r.y + r.height));
  const mean = area ? regions.reduce((s, r) => s + r.mean * r.area, 0) / area : 0;
  // Pooled standard deviation from each region's mean and spread.
  const variance = area ? regions.reduce((s, r) => s + r.area * (r.std ** 2 + (r.mean - mean) ** 2), 0) / area : 0;
  return {
    area,
    perimeter,
    circularity: circularity(area, perimeter),
    x,
    y,
    width: right - x,
    height: bottom - y,
    mean,
    // The median of medians weighted by area approximates the pooled median.
    median: weightedMedian(regions.map((r) => [r.median, r.area])),
    min: Math.min(...regions.map((r) => r.min)),
    max: Math.max(...regions.map((r) => r.max)),
    std: Math.sqrt(variance),
    integratedDensity: area * mean,
  };
}
function weightedMedian(items: [number, number][]) {
  const sorted = items.slice().sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [v, w] of sorted) {
    acc += w;
    if (acc >= total / 2) return v;
  }
  return sorted.at(-1)?.[0] ?? 0;
}

// ----- CSV -----
function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** RFC 4180 CSV with a header row; rows are keyed by column id. */
export function toCSV(columns: { id: string; label: string }[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c.id])).join(','));
  return lines.join('\r\n') + '\r\n';
}
