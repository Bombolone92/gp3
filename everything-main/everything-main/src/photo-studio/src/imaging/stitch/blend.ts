// Blending aligned images into one picture while keeping each image on its
// own layer: seams become hard-edged layer masks and, optionally, a smooth
// tonal correction is baked into each layer so the seams disappear.
//
// Panorama seams start from the distance to each image's edge (the seam runs
// through the middle of overlaps) and are refined by a minimum cut through the
// pixels where overlapping images disagree least. Stacks pick, per pixel, the
// image with the most local detail (focus stacking).
import { checkCancelled, mask8, type IRect, type Mask8, type Progress, type RGBA8 } from '../types';
import { edtSquared } from '../segment/mask-ops';
import { GridGraph } from '../segment/maxflow';
import { gaussianPlane } from '../filters/common';

/** An image placed on the output canvas at (x, y); alpha is coverage. */
export type Placed = { image: RGBA8; x: number; y: number };
export type BlendOptions = {
  // Bake gain compensation and a smooth correction near seams into the layers.
  seamless?: boolean;
  // Refine panorama seams with a minimum cut (otherwise distance-based).
  graphCut?: boolean;
  progress?: Progress;
};
/** Per input: a mask covering its rectangle and, with `seamless`, corrected pixels. */
export type BlendResult = { masks: Mask8[]; images: RGBA8[] };

const sub = (p: Progress | undefined, a: number, b: number): Progress | undefined =>
  p && { cancelled: p.cancelled, report: (f) => p.report?.(a + (b - a) * f) };

type Work = {
  W: number;
  H: number;
  ox: number;
  oy: number;
  // Output pixels per work pixel.
  k: number;
  // Per image at work scale: coverage (1 = fully covered) and premultiplied RGB.
  cov: Uint8Array[];
  rgb: Float32Array[];
};

/** Downsample every placed image onto a shared low-resolution grid. */
function workGrid(items: Placed[], canvas: IRect, maxPixels: number): Work {
  const k = Math.max(1, Math.sqrt((canvas.width * canvas.height) / maxPixels));
  const W = Math.max(1, Math.ceil(canvas.width / k)),
    H = Math.max(1, Math.ceil(canvas.height / k));
  const cov: Uint8Array[] = [],
    rgb: Float32Array[] = [];
  for (const it of items) {
    const c = new Uint8Array(W * H),
      col = new Float32Array(W * H * 3);
    const { width: iw, height: ih, data } = it.image;
    const x0 = Math.max(0, Math.floor((it.x - canvas.x) / k)),
      y0 = Math.max(0, Math.floor((it.y - canvas.y) / k));
    const x1 = Math.min(W, Math.ceil((it.x + iw - canvas.x) / k)),
      y1 = Math.min(H, Math.ceil((it.y + ih - canvas.y) / k));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        // Output footprint of this work pixel in image coordinates.
        const sx0 = Math.floor(canvas.x + x * k - it.x),
          sy0 = Math.floor(canvas.y + y * k - it.y);
        const sx1 = Math.ceil(canvas.x + (x + 1) * k - it.x),
          sy1 = Math.ceil(canvas.y + (y + 1) * k - it.y);
        let n = 0,
          a = 0,
          r = 0,
          g = 0,
          b = 0,
          full = 1;
        for (let sy = sy0; sy < sy1; sy++)
          for (let sx = sx0; sx < sx1; sx++) {
            n++;
            if (sx < 0 || sy < 0 || sx >= iw || sy >= ih) {
              full = 0;
              continue;
            }
            const o = (sy * iw + sx) * 4;
            const al = data[o + 3];
            if (al < 250) full = 0;
            a += al;
            r += data[o] * al;
            g += data[o + 1] * al;
            b += data[o + 2] * al;
          }
        if (!n || !a) continue;
        const i = y * W + x;
        c[i] = full;
        col[i * 3] = r / a;
        col[i * 3 + 1] = g / a;
        col[i * 3 + 2] = b / a;
      }
    cov.push(c);
    rgb.push(col);
  }
  return { W, H, ox: canvas.x, oy: canvas.y, k, cov, rgb };
}

/** Initial labels: each work pixel goes to the covering image whose edge is farthest. */
function distanceLabels(w: Work): Int16Array {
  const { W, H, cov } = w;
  const label = new Int16Array(W * H).fill(-1);
  const best = new Float32Array(W * H).fill(-1);
  cov.forEach((c, k) => {
    const outside = new Uint8Array(W * H);
    for (let i = 0; i < outside.length; i++) outside[i] = c[i] ? 0 : 1;
    // Distances to the image border (pixels beyond the grid count as outside).
    const d = edtSquared(outside, W, H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!c[i]) continue;
        const edge = Math.min(x + 1, y + 1, W - x, H - y);
        const v = Math.min(d[i], edge * edge);
        if (v > best[i]) {
          best[i] = v;
          label[i] = k;
        }
      }
  });
  return label;
}

/** Move seams within each overlap to where the images agree (minimum cut). */
function refineSeams(w: Work, label: Int16Array, progress?: Progress) {
  const { W, H, cov, rgb } = w;
  const n = cov.length;
  for (let k = 0; k < n; k++) {
    checkCancelled(progress);
    progress?.report?.(k / n);
    // Region where image k competes with the others: pixels it covers whose
    // current owner is another covering image, plus its own pixels there.
    const inRegion = new Uint8Array(W * H);
    let count = 0;
    for (let i = 0; i < W * H; i++) {
      if (!cov[k][i] || label[i] < 0) continue;
      let shared = false;
      for (let j = 0; j < n && !shared; j++) if (j !== k && cov[j][i]) shared = true;
      if (shared) (inRegion[i] = 1), count++;
    }
    if (count < 4) continue;
    // Bounding box of the region keeps the graph small.
    let x0 = W,
      y0 = H,
      x1 = 0,
      y1 = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (inRegion[y * W + x]) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
    // One pixel of margin brings the pinned neighbours into the graph.
    x0 = Math.max(0, x0 - 1);
    y0 = Math.max(0, y0 - 1);
    x1 = Math.min(W - 1, x1 + 1);
    y1 = Math.min(H - 1, y1 + 1);
    const gw = x1 - x0 + 1,
      gh = y1 - y0 + 1;
    const g = new GridGraph(gw, gh, 4);
    const other = new Int16Array(gw * gh).fill(-1);
    const diff = (i: number, a: number, b: number) => {
      const p = rgb[a],
        q = rgb[b];
      return Math.abs(p[i * 3] - q[i * 3]) + Math.abs(p[i * 3 + 1] - q[i * 3 + 1]) + Math.abs(p[i * 3 + 2] - q[i * 3 + 2]);
    };
    const HARD = 1 << 24;
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const gi = y * gw + x,
          i = (y + y0) * W + x + x0;
        if (!inRegion[i]) {
          // Outside the contested area: pin to whoever owns it (source = k).
          g.tr[gi] = label[i] === k ? HARD : -HARD;
          other[gi] = label[i] === k ? -1 : label[i];
          continue;
        }
        // The competitor is the current owner, or for pixels k owns, the
        // covering image with the farthest edge besides k.
        let o = label[i] !== k ? label[i] : -1;
        if (o < 0) for (let j = 0; j < n; j++) if (j !== k && cov[j][i]) (o = j);
        other[gi] = o;
        // Weak preference for the distance-based choice keeps seams centered
        // where images agree everywhere.
        g.tr[gi] = label[i] === k ? 1 : -1;
      }
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const gi = y * gw + x,
          i = (y + y0) * W + x + x0;
        const o = other[gi];
        for (const [kk, dx, dy] of [
          [0, 1, 0],
          [2, 0, 1],
        ] as const) {
          if (x + dx >= gw || y + dy >= gh) continue;
          const gj = gi + dy * gw + dx,
            j = i + dy * W + dx;
          const oj = other[gj];
          // Cost of a seam between these pixels: how much k and the
          // competitor differ on both sides.
          // A side where only one image exists counts like the other side,
          // so coverage borders are not cheaper places to cut.
          const di = o >= 0 && cov[o][i] && cov[k][i] ? diff(i, k, o) : -1;
          const dj = oj >= 0 && cov[oj][j] && cov[k][j] ? diff(j, k, oj) : -1;
          const c = 1 + (di >= 0 && dj >= 0 ? di + dj : 2 * Math.max(0, di, dj));
          g.setEdge(gi, kk, Math.round(c * 4) + 1);
        }
      }
    g.maxflow();
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const gi = y * gw + x,
          i = (y + y0) * W + x + x0;
        if (!inRegion[i]) continue;
        if (g.isSource(gi)) label[i] = k;
        else if (label[i] === k && other[gi] >= 0) label[i] = other[gi];
      }
  }
}

/** Global per-image, per-channel gains that equalize overlaps (least squares
 * with a prior towards 1). */
export function gainCompensation(w: Work): Float64Array[] {
  const { cov, rgb } = w;
  const n = cov.length;
  const gains: Float64Array[] = [];
  for (let ch = 0; ch < 3; ch++) {
    const A = new Float64Array(n * n),
      b = new Float64Array(n);
    const sigmaN = 10,
      sigmaG = 0.1;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        let N = 0,
          Ii = 0,
          Ij = 0;
        for (let p = 0; p < cov[i].length; p++)
          if (cov[i][p] && cov[j][p]) {
            N++;
            Ii += rgb[i][p * 3 + ch];
            Ij += rgb[j][p * 3 + ch];
          }
        if (!N) continue;
        Ii /= N;
        Ij /= N;
        // d/dg_i of N (g_i Ii - g_j Ij)^2 / sigmaN^2.
        A[i * n + i] += (N * Ii * Ii) / (sigmaN * sigmaN);
        A[i * n + j] -= (N * Ii * Ij) / (sigmaN * sigmaN);
        A[i * n + i] += N / (sigmaG * sigmaG);
        b[i] += N / (sigmaG * sigmaG);
      }
    for (let i = 0; i < n; i++)
      if (!A[i * n + i]) {
        A[i * n + i] = 1;
        b[i] = 1;
      }
    gains.push(solve(A, b, n));
  }
  // Per image [r, g, b].
  return Array.from({ length: n }, (_, i) => Float64Array.from([gains[0][i], gains[1][i], gains[2][i]]));
}

function solve(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const M = Float64Array.from(A),
    x = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]) > Math.abs(M[p * n + c])) p = r;
    if (Math.abs(M[p * n + c]) < 1e-12) continue;
    for (let k = 0; k < n; k++) [M[c * n + k], M[p * n + k]] = [M[p * n + k], M[c * n + k]];
    [x[c], x[p]] = [x[p], x[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r * n + c] / M[c * n + c];
      if (!f) continue;
      for (let k = c; k < n; k++) M[r * n + k] -= f * M[c * n + k];
      x[r] -= f * x[c];
    }
  }
  for (let c = 0; c < n; c++) x[c] = M[c * n + c] ? x[c] / M[c * n + c] : 1;
  return x;
}

/** Bilinear sample of a work-grid plane at an output coordinate. */
function sampler(plane: Float32Array, w: Work, stride: number) {
  const { W, H, ox, oy, k } = w;
  return (x: number, y: number, c: number) => {
    const fx = Math.max(0, Math.min(W - 1, (x + 0.5 - ox) / k - 0.5)),
      fy = Math.max(0, Math.min(H - 1, (y + 0.5 - oy) / k - 0.5));
    const ix = Math.min(W - 2, Math.floor(fx)),
      iy = Math.min(H - 2, Math.floor(fy));
    if (ix < 0 || iy < 0) return plane[(Math.max(0, iy) * W + Math.max(0, ix)) * stride + c];
    const ax = fx - ix,
      ay = fy - iy;
    const i = iy * W + ix;
    const a = plane[i * stride + c],
      b = plane[(i + 1) * stride + c],
      cc = plane[(i + W) * stride + c],
      d = plane[(i + W + 1) * stride + c];
    return (a * (1 - ax) + b * ax) * (1 - ay) + (cc * (1 - ax) + d * ax) * ay;
  };
}

/** Alpha-normalized Gaussian blur of an RGB work plane restricted to a weight. */
function blurWeighted(rgb: Float32Array, weight: Float32Array, W: number, H: number, sigma: number) {
  const tmp = new Float32Array(W * H);
  const wsum = Float32Array.from(weight);
  gaussianPlane(wsum, tmp, W, H, sigma);
  const out = new Float32Array(W * H * 3);
  const plane = new Float32Array(W * H);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < W * H; i++) plane[i] = rgb[i * 3 + c] * weight[i];
    gaussianPlane(plane, tmp, W, H, sigma);
    for (let i = 0; i < W * H; i++) out[i * 3 + c] = wsum[i] > 1e-6 ? plane[i] / wsum[i] : 0;
  }
  return { out, wsum };
}

/** Smooth multiplicative corrections per image so that, near seams, each
 * image's low frequencies match the seam-weighted average of its neighbours. */
function toneCorrections(w: Work, label: Int16Array, gains: Float64Array[], sigma: number): Float32Array[] {
  const { W, H, cov, rgb } = w;
  const n = cov.length;
  const lows: Float32Array[] = [],
    weights: Float32Array[] = [];
  const tmp = new Float32Array(W * H);
  // `rgb` is already gain compensated; the gains are folded into the result.
  for (let k = 0; k < n; k++) {
    const cw = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) cw[i] = cov[k][i];
    lows.push(blurWeighted(rgb[k], cw, W, H, sigma).out);
    const ind = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) ind[i] = label[i] === k ? 1 : 0;
    gaussianPlane(ind, tmp, W, H, sigma);
    weights.push(ind);
  }
  // The target low frequencies blend every image's (extrapolated) low-pass
  // by its smoothed seam weight. Both vary smoothly, so the target has no
  // steps where another image's coverage begins.
  const target = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    let ws = 0;
    for (let k = 0; k < n; k++) ws += weights[k][i];
    if (ws <= 1e-6) continue;
    for (let k = 0; k < n; k++) {
      const f = weights[k][i] / ws;
      if (!f) continue;
      for (let c = 0; c < 3; c++) target[i * 3 + c] += f * lows[k][i * 3 + c];
    }
  }
  return lows.map((low, k) => {
    const ratio = new Float32Array(W * H * 3);
    for (let i = 0; i < W * H; i++)
      for (let c = 0; c < 3; c++) {
        const l = low[i * 3 + c];
        const r = cov[k][i] && l > 1 ? target[i * 3 + c] / l : 1;
        ratio[i * 3 + c] = Math.max(0.25, Math.min(4, r)) * gains[k][c];
      }
    // Extend ratios beyond coverage so partially covered edge pixels sample sensibly.
    const cw = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) cw[i] = cov[k][i];
    const spread = blurWeighted(ratio, cw, W, H, 2).out;
    for (let i = 0; i < W * H; i++) if (!cov[k][i]) for (let c = 0; c < 3; c++) ratio[i * 3 + c] = spread[i * 3 + c] || gains[k][c];
    return ratio;
  });
}

function applyCorrection(p: Placed, ratio: Float32Array, w: Work): RGBA8 {
  const { image } = p;
  const out = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  const s = sampler(ratio, w, 3);
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      const o = (y * image.width + x) * 4;
      if (!image.data[o + 3]) continue;
      for (let c = 0; c < 3; c++) out.data[o + c] = image.data[o + c] * s(p.x + x, p.y + y, c);
    }
  return out;
}

/** Hard masks from work labels: each output pixel goes to the covering image
 * with the largest bilinear label weight (smooth seams, no blocky steps). */
function masksFromLabels(items: Placed[], w: Work, label: Int16Array): Mask8[] {
  const { W, H } = w;
  const ind = items.map((_, k) => {
    const f = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) f[i] = label[i] === k ? 1 : 0;
    return sampler(f, w, 1);
  });
  // Compute each output pixel's owner once over the union of rectangles.
  return items.map((it, k) => {
    const m = mask8(it.image.width, it.image.height);
    for (let y = 0; y < it.image.height; y++)
      for (let x = 0; x < it.image.width; x++) {
        const o = y * it.image.width + x;
        if (!it.image.data[o * 4 + 3]) continue;
        const X = it.x + x,
          Y = it.y + y;
        const mine = ind[k](X, Y, 0);
        // Fully opaque pixels beat partially covered edge pixels, so the
        // antialiased border of a warped image never shows a seam line.
        const mineOpaque = it.image.data[o * 4 + 3] === 255;
        let win = true;
        for (let j = 0; j < items.length && win; j++) {
          if (j === k) continue;
          const q = items[j];
          const lx = X - q.x,
            ly = Y - q.y;
          if (lx < 0 || ly < 0 || lx >= q.image.width || ly >= q.image.height) continue;
          const a = q.image.data[(ly * q.image.width + lx) * 4 + 3];
          if (!a) continue;
          const theirsOpaque = a === 255;
          if (mineOpaque !== theirsOpaque) {
            if (theirsOpaque) win = false;
            continue;
          }
          const theirs = ind[j](X, Y, 0);
          if (theirs > mine || (theirs === mine && j > k)) win = false;
        }
        m.data[o] = win ? 255 : 0;
      }
    return m;
  });
}

/** Panorama blending: hard seam masks per image (and tone-corrected pixels). */
export function blendPanorama(items: Placed[], canvas: IRect, opts: BlendOptions = {}): BlendResult {
  const progress = opts.progress;
  const w = workGrid(items, canvas, 1_000_000);
  checkCancelled(progress);
  // Compare and correct images after equalizing their overall exposure, so
  // seams follow content rather than brightness differences.
  const gains = items.length > 1 ? gainCompensation(w) : [Float64Array.from([1, 1, 1])];
  w.rgb = w.rgb.map((rgb, k) => rgb.map((v, i) => v * gains[k][i % 3]));
  const label = distanceLabels(w);
  progress?.report?.(0.15);
  if (opts.graphCut !== false && items.length > 1) refineSeams(w, label, sub(progress, 0.15, 0.6));
  const masks = masksFromLabels(items, w, label);
  progress?.report?.(0.75);
  let images = items.map((p) => p.image);
  if (opts.seamless !== false && items.length > 1) {
    const sigma = Math.max(3, Math.min(w.W, w.H) / 12);
    const ratios = toneCorrections(w, label, gains, sigma);
    images = items.map((p, k) => applyCorrection(p, ratios[k], w));
  }
  progress?.report?.(1);
  return { masks, images };
}

/** Per-pixel focus measure: smoothed magnitude of the Laplacian of luma. */
export function sharpness(img: RGBA8, sigma: number): Float32Array {
  const { width: w, height: h, data } = img;
  const g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const tmp = new Float32Array(w * h);
  // A slight pre-blur keeps sensor noise from looking like detail.
  gaussianPlane(g, tmp, w, h, 0.8);
  const s = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      s[i] = lap * lap;
    }
  gaussianPlane(s, tmp, w, h, sigma);
  for (let i = 0; i < s.length; i++) if (data[i * 4 + 3] < 250) s[i] = -1;
  return s;
}

/** Focus stacking: for same-size aligned images (index 0 at the bottom of the
 * layer stack), masks that keep each pixel from its sharpest image with soft
 * transitions. Stacking the layers with these masks gives the weighted blend. */
export function blendStack(images: RGBA8[], opts: BlendOptions & { transition?: number } = {}): BlendResult {
  const progress = opts.progress;
  const n = images.length;
  const { width: w, height: h } = images[0];
  const sigma = Math.max(2, Math.min(w, h) / 250);
  const best = new Float32Array(w * h).fill(-Infinity);
  const label = new Int16Array(w * h).fill(-1);
  for (let k = 0; k < n; k++) {
    checkCancelled(progress);
    progress?.report?.((0.6 * k) / n);
    const s = sharpness(images[k], sigma);
    for (let i = 0; i < s.length; i++)
      if (s[i] >= 0 && s[i] > best[i] * 1.0001) {
        best[i] = s[i];
        label[i] = k;
      }
  }
  // Soft transitions between decisions; in flat areas, where the choice is
  // arbitrary, the images agree, so mixing them is harmless.
  const tmp = new Float32Array(w * h);
  const transition = opts.transition ?? Math.max(1.5, sigma);
  const masks: Mask8[] = new Array(n);
  // Top-down conversion of weights to stacking masks: m_k = w_k / (1 - above).
  const above = new Float32Array(w * h);
  for (let k = n - 1; k >= 0; k--) {
    checkCancelled(progress);
    progress?.report?.(0.6 + (0.3 * (n - 1 - k)) / n);
    const wk = new Float32Array(w * h);
    for (let i = 0; i < wk.length; i++) wk[i] = label[i] === k ? 1 : 0;
    gaussianPlane(wk, tmp, w, h, transition);
    const m = mask8(w, h);
    const covered = images[k].data;
    for (let i = 0; i < wk.length; i++) {
      if (covered[i * 4 + 3] === 0) continue;
      const rest = 1 - above[i];
      const v = k === 0 ? 1 : rest > 1e-3 ? Math.min(1, wk[i] / rest) : 0;
      m.data[i] = Math.round(v * 255);
      above[i] = Math.min(1, above[i] + wk[i]);
    }
    masks[k] = m;
  }
  let out = images;
  if (opts.seamless !== false && n > 1) {
    // Match each image's overall brightness to the bottom (reference) image.
    const ref = images[0];
    out = images.map((img, k) => {
      if (!k) return img;
      const sum = [0, 0, 0],
        sumRef = [0, 0, 0];
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 3] < 250 || ref.data[i + 3] < 250) continue;
        for (let c = 0; c < 3; c++) (sum[c] += img.data[i + c]), (sumRef[c] += ref.data[i + c]);
      }
      const g = sum.map((s, c) => (s > 0 ? Math.max(0.5, Math.min(2, sumRef[c] / s)) : 1));
      if (g.every((v) => Math.abs(v - 1) < 0.002)) return img;
      const o = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
      for (let i = 0; i < o.data.length; i += 4) for (let c = 0; c < 3; c++) o.data[i + c] = img.data[i + c] * g[c];
      return o;
    });
  }
  progress?.report?.(1);
  return { masks, images: out };
}

/** Composite placed images with their masks in order (normal blending), for
 * tests and previews. */
export function compositeMasked(items: Placed[], masks: Mask8[], canvas: IRect): RGBA8 {
  const out = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  const acc = new Float32Array(canvas.width * canvas.height * 4);
  items.forEach((it, k) => {
    const { image } = it;
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        const X = it.x + x - canvas.x,
          Y = it.y + y - canvas.y;
        if (X < 0 || Y < 0 || X >= canvas.width || Y >= canvas.height) continue;
        const s = (y * image.width + x) * 4;
        const a = (image.data[s + 3] / 255) * (masks[k].data[y * image.width + x] / 255);
        if (!a) continue;
        const o = (Y * canvas.width + X) * 4;
        const ab = acc[o + 3];
        const ao = a + ab * (1 - a);
        for (let c = 0; c < 3; c++) acc[o + c] = (image.data[s + c] * a + acc[o + c] * ab * (1 - a)) / ao;
        acc[o + 3] = ao;
      }
  });
  for (let i = 0; i < acc.length; i += 4) {
    out[i] = acc[i];
    out[i + 1] = acc[i + 1];
    out[i + 2] = acc[i + 2];
    out[i + 3] = acc[i + 3] * 255;
  }
  return { width: canvas.width, height: canvas.height, data: out };
}
