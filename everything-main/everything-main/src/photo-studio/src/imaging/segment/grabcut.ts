// GrabCut (Rother, Kolmogorov and Blake 2004): alternate between fitting
// foreground/background Gaussian mixture color models and a graph-cut labeling.
// Runs on whatever resolution it is given; callers downscale first.
import type { RGBA8 } from '../types';
import { rng } from './filters';
import { GridGraph, INF_CAP } from './maxflow';

export const BG = 0, PR_BG = 1, PR_FG = 2, FG = 3;

// Full-covariance Gaussian mixture over RGB in [0, 255].
export class GMM {
  readonly w: Float64Array;
  readonly mean: Float64Array;
  readonly icov: Float64Array;
  readonly lnorm: Float64Array;
  private readonly scratch: Float64Array;
  constructor(readonly K: number) {
    this.scratch = new Float64Array(K);
    this.w = new Float64Array(K);
    this.mean = new Float64Array(K * 3);
    this.icov = new Float64Array(K * 9);
    this.lnorm = new Float64Array(K);
  }
  // Fit from samples (RGB triples) given a component label per sample.
  learn(px: Float32Array, idx: Int32Array, count: number, labels: Uint8Array) {
    const K = this.K, s = new Float64Array(K * 13);
    for (let t = 0; t < count; t++) {
      const p = idx[t] * 3, k = labels[t], o = k * 13, r = px[p], g = px[p + 1], b = px[p + 2];
      s[o]++;
      s[o + 1] += r; s[o + 2] += g; s[o + 3] += b;
      s[o + 4] += r * r; s[o + 5] += r * g; s[o + 6] += r * b;
      s[o + 7] += g * g; s[o + 8] += g * b; s[o + 9] += b * b;
    }
    for (let k = 0; k < K; k++) {
      const o = k * 13, c = s[o];
      if (c < 1) {
        this.w[k] = 0;
        continue;
      }
      this.w[k] = c / count;
      const mr = s[o + 1] / c, mg = s[o + 2] / c, mb = s[o + 3] / c;
      this.mean[k * 3] = mr;
      this.mean[k * 3 + 1] = mg;
      this.mean[k * 3 + 2] = mb;
      // A noise floor on the diagonal keeps flat-color components invertible.
      const reg = 4;
      const a = s[o + 4] / c - mr * mr + reg, bq = s[o + 5] / c - mr * mg, cq = s[o + 6] / c - mr * mb;
      const d = s[o + 7] / c - mg * mg + reg, e = s[o + 8] / c - mg * mb, f = s[o + 9] / c - mb * mb + reg;
      const i00 = d * f - e * e, i01 = e * cq - bq * f, i02 = bq * e - d * cq;
      const i11 = a * f - cq * cq, i12 = cq * bq - a * e, i22 = a * d - bq * bq;
      const det = a * i00 + bq * i01 + cq * i02;
      const ic = this.icov, q = k * 9;
      ic[q] = i00 / det; ic[q + 1] = i01 / det; ic[q + 2] = i02 / det;
      ic[q + 3] = i01 / det; ic[q + 4] = i11 / det; ic[q + 5] = i12 / det;
      ic[q + 6] = i02 / det; ic[q + 7] = i12 / det; ic[q + 8] = i22 / det;
      this.lnorm[k] = Math.log(this.w[k]) - 0.5 * Math.log(Math.max(det, 1e-12)) - 2.756815599614018; // 1.5 ln(2 pi)
    }
  }
  // Log-likelihood of component k (including its weight).
  logComp(k: number, r: number, g: number, b: number) {
    if (!this.w[k]) return -Infinity;
    const m = this.mean, q = k * 9, c = this.icov;
    const x = r - m[k * 3], y = g - m[k * 3 + 1], z = b - m[k * 3 + 2];
    const md = x * (c[q] * x + c[q + 1] * y + c[q + 2] * z) + y * (c[q + 3] * x + c[q + 4] * y + c[q + 5] * z) + z * (c[q + 6] * x + c[q + 7] * y + c[q + 8] * z);
    return this.lnorm[k] - 0.5 * md;
  }
  // Negative log-likelihood of the mixture (log-sum-exp for stability).
  nll(r: number, g: number, b: number) {
    let mx = -Infinity;
    const l = this.scratch;
    for (let k = 0; k < this.K; k++) mx = Math.max(mx, (l[k] = this.logComp(k, r, g, b)));
    if (mx === -Infinity) return 50;
    let s = 0;
    for (let k = 0; k < this.K; k++) s += Math.exp(l[k] - mx);
    return Math.min(50, -(mx + Math.log(s)));
  }
  best(r: number, g: number, b: number) {
    let bk = 0, bv = -Infinity;
    for (let k = 0; k < this.K; k++) {
      const v = this.logComp(k, r, g, b);
      if (v > bv) {
        bv = v;
        bk = k;
      }
    }
    return bk;
  }
}

// Deterministic k-means++ initialization followed by a few Lloyd iterations.
function kmeans(px: Float32Array, idx: Int32Array, count: number, K: number, seed: number) {
  const labels = new Uint8Array(count), cent = new Float64Array(K * 3), rand = rng(seed);
  if (!count) return labels;
  // Subsample for seeding speed.
  const step = Math.max(1, Math.floor(count / 4000));
  const pick = (t: number, k: number) => {
    const p = idx[t] * 3;
    cent[k * 3] = px[p];
    cent[k * 3 + 1] = px[p + 1];
    cent[k * 3 + 2] = px[p + 2];
  };
  pick(Math.floor(rand() * count), 0);
  const dmin = new Float64Array(Math.ceil(count / step)).fill(Infinity);
  for (let k = 1; k < K; k++) {
    let total = 0;
    for (let t = 0, u = 0; t < count; t += step, u++) {
      const p = idx[t] * 3, o = (k - 1) * 3;
      const dr = px[p] - cent[o], dg = px[p + 1] - cent[o + 1], db = px[p + 2] - cent[o + 2];
      dmin[u] = Math.min(dmin[u], dr * dr + dg * dg + db * db);
      total += dmin[u];
    }
    let r = rand() * total, chosen = 0;
    for (let t = 0, u = 0; t < count; t += step, u++) {
      r -= dmin[u];
      if (r <= 0) {
        chosen = t;
        break;
      }
    }
    pick(chosen, k);
  }
  const sum = new Float64Array(K * 4);
  for (let it = 0; it < 6; it++) {
    sum.fill(0);
    for (let t = 0; t < count; t++) {
      const p = idx[t] * 3;
      let bk = 0, bd = Infinity;
      for (let k = 0; k < K; k++) {
        const dr = px[p] - cent[k * 3], dg = px[p + 1] - cent[k * 3 + 1], db = px[p + 2] - cent[k * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) {
          bd = d;
          bk = k;
        }
      }
      labels[t] = bk;
      sum[bk * 4] += px[p];
      sum[bk * 4 + 1] += px[p + 1];
      sum[bk * 4 + 2] += px[p + 2];
      sum[bk * 4 + 3]++;
    }
    for (let k = 0; k < K; k++)
      if (sum[k * 4 + 3]) for (let c = 0; c < 3; c++) cent[k * 3 + c] = sum[k * 4 + c] / sum[k * 4 + 3];
  }
  return labels;
}

export function rgbPlanes(img: RGBA8) {
  const n = img.width * img.height, px = new Float32Array(n * 3), d = img.data;
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3] / 255;
    px[i * 3] = d[i * 4] * a;
    px[i * 3 + 1] = d[i * 4 + 1] * a;
    px[i * 3 + 2] = d[i * 4 + 2] * a;
  }
  return px;
}

// Contrast-sensitive smoothness weights (Boykov and Jolly 2001), shared by GrabCut
// and Quick Selection. beta = 1 / (2 <|dz|^2>).
export function setSmoothness(g: GridGraph, px: Float32Array, gamma: number, scale: number) {
  const { w, h, K } = g;
  let sum = 0, cnt = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      for (let k = 0; k < K; k += 2) {
        const xx = x + GridGraph.dx(k), yy = y + GridGraph.dy(k);
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = (yy * w + xx) * 3, p = i * 3;
        const dr = px[p] - px[j], dg = px[p + 1] - px[j + 1], db = px[p + 2] - px[j + 2];
        sum += dr * dr + dg * dg + db * db;
        cnt++;
      }
    }
  const beta = cnt && sum ? cnt / (2 * sum) : 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      for (let k = 0; k < K; k += 2) {
        const xx = x + GridGraph.dx(k), yy = y + GridGraph.dy(k);
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = (yy * w + xx) * 3, p = i * 3;
        const dr = px[p] - px[j], dg = px[p + 1] - px[j + 1], db = px[p + 2] - px[j + 2];
        const wgt = (gamma / (k >= 4 ? Math.SQRT2 : 1)) * Math.exp(-beta * (dr * dr + dg * dg + db * db));
        g.setEdge(i, k, Math.max(1, Math.round(wgt * scale)));
      }
    }
}

export type GrabCutOptions = { iterations?: number; components?: number; gamma?: number; seed?: number };

// `trimap` uses BG / PR_BG / PR_FG / FG per pixel. Returns 1 for foreground.
export function grabCut(img: RGBA8, trimap: Uint8Array, opts: GrabCutOptions = {}): Uint8Array {
  const { iterations = 5, components = 5, gamma = 50, seed = 1 } = opts;
  const { width: w, height: h } = img, n = w * h, px = rgbPlanes(img);
  const label = new Uint8Array(n);
  for (let i = 0; i < n; i++) label[i] = trimap[i] >= PR_FG ? 1 : 0;
  const fg = new GMM(components), bg = new GMM(components);
  const fIdx = new Int32Array(n), bIdx = new Int32Array(n);
  const SCALE = 100;
  let fN = 0, bN = 0;
  const gather = () => {
    fN = bN = 0;
    for (let i = 0; i < n; i++) if (label[i]) fIdx[fN++] = i; else bIdx[bN++] = i;
  };
  gather();
  if (!fN || !bN) return label;
  fg.learn(px, fIdx, fN, kmeans(px, fIdx, fN, components, seed));
  bg.learn(px, bIdx, bN, kmeans(px, bIdx, bN, components, seed + 1));
  // Edges depend only on the image; build once and copy per iteration.
  const proto = new GridGraph(w, h, 8);
  setSmoothness(proto, px, gamma, SCALE);
  const edges = new Int32Array(proto.cap);
  for (let it = 0; it < iterations; it++) {
    if (it > 0) {
      gather();
      if (!fN || !bN) break;
      const fl = new Uint8Array(fN), bl = new Uint8Array(bN);
      for (let t = 0; t < fN; t++) { const p = fIdx[t] * 3; fl[t] = fg.best(px[p], px[p + 1], px[p + 2]); }
      for (let t = 0; t < bN; t++) { const p = bIdx[t] * 3; bl[t] = bg.best(px[p], px[p + 1], px[p + 2]); }
      fg.learn(px, fIdx, fN, fl);
      bg.learn(px, bIdx, bN, bl);
    }
    const g = it === 0 ? proto : new GridGraph(w, h, 8);
    if (it > 0) g.cap.set(edges);
    for (let i = 0; i < n; i++) {
      const t = trimap[i];
      if (t === FG) g.tr[i] = INF_CAP;
      else if (t === BG) g.tr[i] = -INF_CAP;
      else {
        const p = i * 3, r = px[p], gg = px[p + 1], b = px[p + 2];
        // Source link = cost of calling it background, and vice versa.
        g.tr[i] = Math.round((bg.nll(r, gg, b) - fg.nll(r, gg, b)) * SCALE);
      }
    }
    g.maxflow();
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const v = g.isSource(i) ? 1 : 0;
      if (v !== label[i]) changed++;
      label[i] = v;
    }
    if (it > 0 && changed < n * 0.001) break;
  }
  return label;
}
