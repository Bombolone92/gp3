// Color quantization for indexed exports (GIF, and any future 8-bit PNG).
// - Median cut: Heckbert, "Color Image Quantization for Frame Buffer
//   Display", SIGGRAPH 1982, with the population-then-volume split order of
//   modified median cut (Bloomberg, Leptonica).
// - Octree: Gervautz & Purgathofer, "A Simple Method for Color Quantization:
//   Octree Quantization", 1988, reducing the least populated nodes first.
// - NeuQuant: Dekker, "Kohonen neural networks for optimal colour
//   quantization", Network: Computation in Neural Systems 5, 1994.
// Pixels below the alpha threshold are ignored when building the palette.
import type { RGBA8 } from '../types';

export type Quantizer = 'mediancut' | 'octree' | 'neuquant';
export type PaletteOptions = {
  method?: Quantizer;
  maxColors?: number;
  alphaThreshold?: number;
  // NeuQuant sampling factor 1 (best) .. 30 (fastest), default 10.
  sampleFactor?: number;
};

// Returns RGB triplets. When the images contain no more distinct opaque
// colors than allowed, those exact colors are returned.
export function buildPalette(images: RGBA8[], opts: PaletteOptions = {}): Uint8Array {
  const maxColors = Math.max(1, Math.min(256, opts.maxColors ?? 256));
  const threshold = opts.alphaThreshold ?? 128;
  const exact = exactColors(images, maxColors, threshold);
  if (exact) return exact;
  const method = opts.method ?? 'mediancut';
  if (method === 'octree') return octree(images, maxColors, threshold);
  if (method === 'neuquant') return neuquant(images, maxColors, threshold, opts.sampleFactor ?? 10);
  return medianCut(images, maxColors, threshold);
}

// Open-addressed set of 24-bit colors; gives up past `limit` colors.
function exactColors(images: RGBA8[], limit: number, threshold: number): Uint8Array | null {
  const size = 1024;
  const table = new Int32Array(size).fill(-1);
  const found: number[] = [];
  for (const img of images) {
    const d = img.data;
    let last = -1;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < threshold) continue;
      const c = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      if (c === last) continue;
      last = c;
      let h = ((c * 2654435761) >>> 22) & (size - 1);
      while (table[h] !== -1 && table[h] !== c) h = (h + 1) & (size - 1);
      if (table[h] === c) continue;
      if (found.length >= limit) return null;
      table[h] = c;
      found.push(c);
    }
  }
  if (!found.length) found.push(0);
  const out = new Uint8Array(found.length * 3);
  found.forEach((c, i) => {
    out[i * 3] = c >> 16;
    out[i * 3 + 1] = (c >> 8) & 255;
    out[i * 3 + 2] = c & 255;
  });
  return out;
}

// Visit at most ~4M pixels so huge animations stay fast.
function sampleStep(images: RGBA8[]): number {
  let n = 0;
  for (const img of images) n += img.width * img.height;
  return Math.max(1, Math.floor(n / 4_000_000));
}

function medianCut(images: RGBA8[], maxColors: number, threshold: number): Uint8Array {
  const count = new Uint32Array(32768);
  const sum = new Float64Array(32768 * 3);
  const step = sampleStep(images) * 4;
  for (const img of images) {
    const d = img.data;
    for (let i = 0; i < d.length; i += step) {
      if (d[i + 3] < threshold) continue;
      const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      count[k]++;
      sum[k * 3] += d[i];
      sum[k * 3 + 1] += d[i + 1];
      sum[k * 3 + 2] += d[i + 2];
    }
  }
  const bins: number[] = [];
  for (let k = 0; k < 32768; k++) if (count[k]) bins.push(k);
  if (!bins.length) return new Uint8Array(3);
  type Box = { lo: number; hi: number; pop: number; vol: number; axis: number; range: number };
  const order = Int32Array.from(bins);
  const chan = (k: number, a: number) => (a === 0 ? k >> 10 : a === 1 ? (k >> 5) & 31 : k & 31);
  const makeBox = (lo: number, hi: number): Box => {
    let pop = 0;
    const mn = [31, 31, 31];
    const mx = [0, 0, 0];
    for (let i = lo; i < hi; i++) {
      const k = order[i];
      pop += count[k];
      for (let a = 0; a < 3; a++) {
        const v = chan(k, a);
        if (v < mn[a]) mn[a] = v;
        if (v > mx[a]) mx[a] = v;
      }
    }
    const r = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    // Green matters most to the eye, then red, then blue.
    const w = [r[0] * 1.0, r[1] * 1.2, r[2] * 0.8];
    const axis = w[1] >= w[0] && w[1] >= w[2] ? 1 : w[0] >= w[2] ? 0 : 2;
    return { lo, hi, pop, vol: (r[0] + 1) * (r[1] + 1) * (r[2] + 1), axis, range: r[axis] };
  };
  const boxes: Box[] = [makeBox(0, order.length)];
  const popSplits = Math.floor(maxColors * 0.75);
  while (boxes.length < maxColors) {
    let best = -1;
    let bestScore = 0;
    const byVolume = boxes.length >= popSplits;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.hi - b.lo < 2) continue;
      const score = byVolume ? b.pop * b.vol : b.pop;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    const b = boxes[best];
    const sub = Array.from(order.subarray(b.lo, b.hi)).sort((x, y) => chan(x, b.axis) - chan(y, b.axis));
    order.set(sub, b.lo);
    let acc = 0;
    let cut = b.lo + 1;
    for (let i = b.lo; i < b.hi - 1; i++) {
      acc += count[order[i]];
      cut = i + 1;
      if (acc * 2 >= b.pop) break;
    }
    boxes.splice(best, 1, makeBox(b.lo, cut), makeBox(cut, b.hi));
  }
  const out = new Uint8Array(boxes.length * 3);
  boxes.forEach((b, j) => {
    let r = 0;
    let g = 0;
    let bl = 0;
    for (let i = b.lo; i < b.hi; i++) {
      const k = order[i];
      r += sum[k * 3];
      g += sum[k * 3 + 1];
      bl += sum[k * 3 + 2];
    }
    out[j * 3] = Math.round(r / b.pop);
    out[j * 3 + 1] = Math.round(g / b.pop);
    out[j * 3 + 2] = Math.round(bl / b.pop);
  });
  return out;
}

function octree(images: RGBA8[], maxColors: number, threshold: number): Uint8Array {
  // Depth 6: leaves are 4x4x4 cubes; colors are averages so precision is kept.
  const DEPTH = 6;
  let cap = 4096;
  let child = new Int32Array(cap * 8);
  let pop = new Float64Array(cap);
  let sums = new Float64Array(cap * 3);
  let level = new Uint8Array(cap);
  let nodes = 1;
  const grow = () => {
    cap *= 2;
    const c = new Int32Array(cap * 8);
    c.set(child);
    child = c;
    const p = new Float64Array(cap);
    p.set(pop);
    pop = p;
    const s = new Float64Array(cap * 3);
    s.set(sums);
    sums = s;
    const l = new Uint8Array(cap);
    l.set(level);
    level = l;
  };
  const step = sampleStep(images) * 4;
  for (const img of images) {
    const d = img.data;
    for (let i = 0; i < d.length; i += step) {
      if (d[i + 3] < threshold) continue;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      let n = 0;
      for (let lv = 0; lv < DEPTH; lv++) {
        const sh = 7 - lv;
        const idx = (((r >> sh) & 1) << 2) | (((g >> sh) & 1) << 1) | ((b >> sh) & 1);
        let c = child[n * 8 + idx];
        if (!c) {
          if (nodes >= cap) grow();
          c = nodes++;
          level[c] = lv + 1;
          child[n * 8 + idx] = c;
        }
        n = c;
      }
      pop[n]++;
      sums[n * 3] += r;
      sums[n * 3 + 1] += g;
      sums[n * 3 + 2] += b;
    }
  }
  // Push populations up so every internal node (the root included, which a
  // small palette may collapse into) knows its subtree totals.
  for (let n = nodes - 1; n >= 0; n--) {
    // Children always have larger indices than parents, so a reverse sweep
    // accumulates bottom-up.
    for (let k = 0; k < 8; k++) {
      const c = child[n * 8 + k];
      if (c) {
        pop[n] += pop[c];
        sums[n * 3] += sums[c * 3];
        sums[n * 3 + 1] += sums[c * 3 + 1];
        sums[n * 3 + 2] += sums[c * 3 + 2];
      }
    }
  }
  const isLeaf = new Uint8Array(nodes);
  let leaves = 0;
  for (let n = 1; n < nodes; n++)
    if (level[n] === DEPTH) {
      isLeaf[n] = 1;
      leaves++;
    }
  // Reduce: collapse internal nodes, deepest level first, least populated first.
  for (let lv = DEPTH - 1; lv >= 0 && leaves > maxColors; lv--) {
    const cands: number[] = [];
    for (let n = 0; n < nodes; n++) if (level[n] === lv && !isLeaf[n] && (n > 0 || lv === 0)) cands.push(n);
    cands.sort((a, b) => pop[a] - pop[b]);
    for (const n of cands) {
      if (leaves <= maxColors) break;
      let kids = 0;
      for (let k = 0; k < 8; k++) {
        const c = child[n * 8 + k];
        if (c && isLeaf[c]) {
          kids++;
          isLeaf[c] = 0;
        }
      }
      if (!kids) continue;
      isLeaf[n] = 1;
      leaves -= kids - 1;
    }
  }
  const out: number[] = [];
  // Collect leaves reachable from the root (collapsed subtrees are skipped).
  const stack = [0];
  while (stack.length) {
    const n = stack.pop()!;
    if (isLeaf[n]) {
      if (pop[n] > 0) out.push(Math.round(sums[n * 3] / pop[n]), Math.round(sums[n * 3 + 1] / pop[n]), Math.round(sums[n * 3 + 2] / pop[n]));
      continue;
    }
    for (let k = 7; k >= 0; k--) {
      const c = child[n * 8 + k];
      if (c) stack.push(c);
    }
  }
  return out.length ? new Uint8Array(out) : new Uint8Array(3);
}

function neuquant(images: RGBA8[], netsize: number, threshold: number, sampleFactor: number): Uint8Array {
  // Gather opaque pixels (sampled for large inputs).
  const step = sampleStep(images) * 4;
  let total = 0;
  for (const img of images) total += Math.ceil(img.data.length / step);
  const px = new Float32Array(total * 3);
  let n = 0;
  for (const img of images) {
    const d = img.data;
    for (let i = 0; i < d.length; i += step)
      if (d[i + 3] >= threshold) {
        px[n * 3] = d[i];
        px[n * 3 + 1] = d[i + 1];
        px[n * 3 + 2] = d[i + 2];
        n++;
      }
  }
  if (!n) return new Uint8Array(3);
  const N = netsize;
  const net = new Float64Array(N * 3);
  const freq = new Float64Array(N).fill(1 / N);
  const bias = new Float64Array(N);
  for (let i = 0; i < N; i++) net[i * 3] = net[i * 3 + 1] = net[i * 3 + 2] = (i * 256) / N;
  const beta = 1 / 1024;
  const gamma = 1024;
  const samplefac = Math.max(1, Math.min(30, Math.round(sampleFactor)));
  const cycles = 100;
  const alphadec = 30 + (samplefac - 1) / 3;
  const samples = Math.max(1, Math.floor(n / samplefac));
  const delta = Math.max(1, Math.floor(samples / cycles));
  let alpha = 1;
  let radius = N / 8;
  // Step through the pixels with a stride coprime to their count.
  let stride = 1;
  for (const prime of [499, 491, 487, 503])
    if (n % prime) {
      stride = prime;
      break;
    }
  if (n < 503) stride = 1;
  let pos = 0;
  for (let i = 0; i < samples; i++) {
    const r = px[pos * 3];
    const g = px[pos * 3 + 1];
    const b = px[pos * 3 + 2];
    // Competitive learning with a conscience: frequent winners get a bias
    // against them so every neuron ends up used.
    let bestd = Infinity;
    let bestbiasd = Infinity;
    let best = 0;
    let bestbias = 0;
    for (let j = 0; j < N; j++) {
      const dist = Math.abs(net[j * 3] - r) + Math.abs(net[j * 3 + 1] - g) + Math.abs(net[j * 3 + 2] - b);
      if (dist < bestd) {
        bestd = dist;
        best = j;
      }
      const biasdist = dist - bias[j];
      if (biasdist < bestbiasd) {
        bestbiasd = biasdist;
        bestbias = j;
      }
      const bf = freq[j] * beta;
      freq[j] -= bf;
      bias[j] += bf * gamma;
    }
    freq[best] += beta;
    bias[best] -= beta * gamma;
    const j = bestbias;
    net[j * 3] -= alpha * (net[j * 3] - r);
    net[j * 3 + 1] -= alpha * (net[j * 3 + 1] - g);
    net[j * 3 + 2] -= alpha * (net[j * 3 + 2] - b);
    const rad = Math.floor(radius);
    if (rad > 1) {
      const lo = Math.max(0, j - rad);
      const hi = Math.min(N - 1, j + rad);
      for (let k = lo; k <= hi; k++) {
        if (k === j) continue;
        const dk = k - j;
        const a = alpha * ((rad * rad - dk * dk) / (rad * rad));
        net[k * 3] -= a * (net[k * 3] - r);
        net[k * 3 + 1] -= a * (net[k * 3 + 1] - g);
        net[k * 3 + 2] -= a * (net[k * 3 + 2] - b);
      }
    }
    pos = (pos + stride) % n;
    if ((i + 1) % delta === 0) {
      alpha -= alpha / alphadec;
      radius -= radius / 30;
    }
  }
  const out = new Uint8Array(N * 3);
  for (let i = 0; i < N * 3; i++) out[i] = Math.max(0, Math.min(255, Math.round(net[i])));
  return out;
}

export type MapOptions = {
  dither?: boolean;
  alphaThreshold?: number;
  // Index written for pixels below the alpha threshold (default 0).
  transparentIndex?: number;
};

// Maps an image to palette indices, optionally with serpentine
// Floyd–Steinberg error diffusion (Floyd & Steinberg 1976).
export function mapToPalette(img: RGBA8, palette: Uint8Array, opts: MapOptions = {}): Uint8Array {
  const { width, height, data } = img;
  const threshold = opts.alphaThreshold ?? 128;
  const tIndex = opts.transparentIndex ?? 0;
  const count = palette.length / 3;
  const out = new Uint8Array(width * height);
  // Nearest palette entry per 6-bit RGB cell, filled lazily.
  const cache = new Int16Array(1 << 18).fill(-1);
  const nearest = (r: number, g: number, b: number) => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let idx = cache[key];
    if (idx >= 0) return idx;
    const cr = (r & 0xfc) | 2;
    const cg = (g & 0xfc) | 2;
    const cb = (b & 0xfc) | 2;
    let best = Infinity;
    idx = 0;
    for (let i = 0; i < count; i++) {
      const dr = palette[i * 3] - cr;
      const dg = palette[i * 3 + 1] - cg;
      const db = palette[i * 3 + 2] - cb;
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < best) {
        best = d;
        idx = i;
      }
    }
    cache[key] = idx;
    return idx;
  };
  // Exact palette members map to themselves even when two share a cell.
  const exact = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const c = (palette[i * 3] << 16) | (palette[i * 3 + 1] << 8) | palette[i * 3 + 2];
    if (!exact.has(c)) exact.set(c, i);
  }
  const lookup = (r: number, g: number, b: number) => {
    const e = exact.get((r << 16) | (g << 8) | b);
    return e !== undefined ? e : nearest(r, g, b);
  };
  if (!opts.dither) {
    let lastC = -1;
    let lastI = 0;
    for (let i = 0, p = 0; i < out.length; i++, p += 4) {
      if (data[p + 3] < threshold) {
        out[i] = tIndex;
        continue;
      }
      const c = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
      if (c !== lastC) {
        lastC = c;
        lastI = lookup(data[p], data[p + 1], data[p + 2]);
      }
      out[i] = lastI;
    }
    return out;
  }
  let cur = new Float32Array((width + 2) * 3);
  let nxt = new Float32Array((width + 2) * 3);
  for (let y = 0; y < height; y++) {
    const ltr = (y & 1) === 0;
    nxt.fill(0);
    for (let k = 0; k < width; k++) {
      const x = ltr ? k : width - 1 - k;
      const i = y * width + x;
      const p = i * 4;
      const e = (x + 1) * 3;
      if (data[p + 3] < threshold) {
        out[i] = tIndex;
        continue;
      }
      const r = clamp255(data[p] + cur[e]);
      const g = clamp255(data[p + 1] + cur[e + 1]);
      const b = clamp255(data[p + 2] + cur[e + 2]);
      const idx = lookup(r, g, b);
      out[i] = idx;
      const er = r - palette[idx * 3];
      const eg = g - palette[idx * 3 + 1];
      const eb = b - palette[idx * 3 + 2];
      const dir = ltr ? 3 : -3;
      // 7/16 ahead, 3/16 behind-below, 5/16 below, 1/16 ahead-below.
      cur[e + dir] += (er * 7) / 16;
      cur[e + dir + 1] += (eg * 7) / 16;
      cur[e + dir + 2] += (eb * 7) / 16;
      nxt[e - dir] += (er * 3) / 16;
      nxt[e - dir + 1] += (eg * 3) / 16;
      nxt[e - dir + 2] += (eb * 3) / 16;
      nxt[e] += (er * 5) / 16;
      nxt[e + 1] += (eg * 5) / 16;
      nxt[e + 2] += (eb * 5) / 16;
      nxt[e + dir] += er / 16;
      nxt[e + dir + 1] += eg / 16;
      nxt[e + dir + 2] += eb / 16;
    }
    const t = cur;
    cur = nxt;
    nxt = t;
  }
  return out;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}
