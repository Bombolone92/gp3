// Refine Edge: guided-filter matting in a band around the selection edge, then
// smoothing, feathering, a contrast/shift curve and optional color decontamination.
import { cloneRGBA8, mask8, type Mask8, type RGBA8 } from '../types';
import { gaussianBlurF32, guidedFilterGray, lumaF32, resizePlane } from './filters';
import { edtSquared, smooth as smoothMask } from './mask-ops';

export type RefineOptions = {
  // Width in pixels of the band, on each side of the edge, that is re-estimated from the image.
  radius?: number;
  // Majority smoothing radius applied to the input first.
  smooth?: number;
  // Gaussian feather radius (same meaning as Select > Feather).
  feather?: number;
  // 0-100: steepens the soft edge.
  contrast?: number;
  // -100..100: moves the edge inward (negative) or outward (positive).
  shiftEdge?: number;
  // 0-1 (or true for 1): replace background color fringes on soft edge pixels.
  decontaminate?: number | boolean;
};

export function refineEdge(img: RGBA8, mask: Mask8, opts: RefineOptions = {}): { mask: Mask8; image?: RGBA8 } {
  const { width: w, height: h } = mask, n = w * h;
  if (img.width !== w || img.height !== h) throw new Error('Image and mask sizes differ.');
  const m = opts.smooth && opts.smooth >= 1 ? smoothMask(mask, opts.smooth) : mask;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = m.data[i] / 255;
  const radius = Math.max(0, opts.radius ?? 0);
  if (radius >= 1) {
    // Distance from the 50% edge, measured from both sides, computed only in a
    // window around the edge pixels (farther pixels cannot be in the band).
    const inF = new Uint8Array(n);
    for (let i = 0; i < n; i++) inF[i] = m.data[i] >= 128 ? 1 : 0;
    let ex0 = w, ey0 = h, ex1 = -1, ey1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x, v = inF[i];
        if ((x + 1 < w && inF[i + 1] !== v) || (y + 1 < h && inF[i + w] !== v)) {
          if (x < ex0) ex0 = x;
          if (x + 1 > ex1) ex1 = x + 1;
          if (y < ey0) ey0 = y;
          if (y + 1 > ey1) ey1 = y + 1;
        }
      }
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    const band = new Float32Array(n);
    if (ex1 >= 0) {
      const g = 2 * Math.ceil(radius + 2), cx0 = Math.max(0, ex0 - g), cy0 = Math.max(0, ey0 - g);
      const cw = Math.min(w, ex1 + g + 1) - cx0, ch = Math.min(h, ey1 + g + 1) - cy0;
      const fin = new Uint8Array(cw * ch), fout = new Uint8Array(cw * ch);
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          const v = inF[(y + cy0) * w + x + cx0];
          fin[y * cw + x] = v;
          fout[y * cw + x] = 1 - v;
        }
      const dIn = edtSquared(fout, cw, ch), dOut = edtSquared(fin, cw, ch);
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          const j = y * cw + x, d = Math.sqrt(fin[j] ? dIn[j] : dOut[j]);
          if (d > radius + 1) continue;
          const X = x + cx0, Y = y + cy0;
          band[Y * w + X] = Math.min(1, Math.max(0, radius + 1 - d));
          if (X < x0) x0 = X;
          if (X > x1) x1 = X;
          if (Y < y0) y0 = Y;
          if (Y > y1) y1 = Y;
        }
    }
    if (x1 >= 0) {
      // Local foreground and background colors come from confidently classified
      // pixels just outside the band (normalized Gaussian convolution); each band
      // pixel's alpha is its projection onto the line between them, which is the
      // compositing equation solved in color space. A small guided filter then
      // removes noise while keeping the edge.
      const sigma = Math.max(2, radius * 0.75), pad = Math.ceil(radius + 3 * sigma);
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
      x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1, bn = bw * bh;
      const crop = { width: bw, height: bh, data: new Uint8ClampedArray(bn * 4) };
      const wB = new Float32Array(bn), wF = new Float32Array(bn);
      for (let y = 0; y < bh; y++) {
        crop.data.set(img.data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + bw) * 4), y * bw * 4);
        for (let x = 0; x < bw; x++) {
          const i = (y + y0) * w + x + x0, j = y * bw + x;
          if (band[i] > 0) continue;
          (inF[i] ? wF : wB)[j] = crop.data[j * 4 + 3] / 255;
        }
      }
      const planes = localMeans(crop, wB, wF, sigma);
      const est = new Float32Array(bn);
      for (let j = 0; j < bn; j++) {
        const i = (Math.floor(j / bw) + y0) * w + (j % bw) + x0, prior = a[i];
        est[j] = prior;
        if (!(band[i] > 0)) continue;
        const wb = planes[3][j], wf = planes[7][j];
        if (wb < 1e-4 || wf < 1e-4) continue;
        let dot = 0, len2 = 0;
        for (let c = 0; c < 3; c++) {
          const B = planes[c][j] / wb, F = planes[4 + c][j] / wf, I = crop.data[j * 4 + c];
          dot += (I - B) * (F - B);
          len2 += (F - B) * (F - B);
        }
        if (len2 < 25) continue;
        const conf = Math.min(1, len2 / 1600), alpha = Math.min(1, Math.max(0, dot / len2));
        est[j] = alpha * conf + prior * (1 - conf);
      }
      const q = guidedFilterGray(lumaF32(crop), est, bw, bh, Math.max(1, Math.round(radius / 3)), 1e-4);
      for (let y = 0; y < bh; y++)
        for (let x = 0; x < bw; x++) {
          const i = (y + y0) * w + x + x0, t = band[i];
          if (t > 0) a[i] = a[i] * (1 - t) + Math.min(1, Math.max(0, q[y * bw + x])) * t;
        }
    }
  }
  if (opts.feather && opts.feather > 0) gaussianBlurF32(a, w, h, opts.feather / 2);
  const contrast = Math.min(0.99, Math.max(0, (opts.contrast ?? 0) / 100));
  const shift = Math.min(1, Math.max(-1, (opts.shiftEdge ?? 0) / 100));
  const mid = 0.5 - shift * 0.5, width = 1 - contrast;
  const out = mask8(w, h);
  for (let i = 0; i < n; i++) {
    const v = width === 1 && shift === 0 ? a[i] : (a[i] - mid) / width + 0.5;
    out.data[i] = Math.round(255 * Math.min(1, Math.max(0, v)));
  }
  const amount = opts.decontaminate === true ? 1 : Number(opts.decontaminate || 0);
  return { mask: out, image: amount > 0 ? decontaminate(img, out, amount, Math.max(4, radius)) : undefined };
}

// Normalized Gaussian convolution of colors under two weight maps (background,
// foreground), computed at reduced resolution since the result is smooth.
// Returns 8 planes at crop size: B r,g,b,weight then F r,g,b,weight.
function localMeans(crop: RGBA8, wB: Float32Array, wF: Float32Array, sigma: number) {
  const { width: bw, height: bh, data } = crop, k = Math.max(1, Math.floor(sigma / 2));
  const lw = Math.ceil(bw / k), lh = Math.ceil(bh / k), ln = lw * lh;
  const low = Array.from({ length: 8 }, () => new Float32Array(ln));
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const j = y * bw + x, c = ((y / k) | 0) * lw + ((x / k) | 0), b = wB[j], f = wF[j];
      if (b) {
        for (let ch = 0; ch < 3; ch++) low[ch][c] += data[j * 4 + ch] * b;
        low[3][c] += b;
      }
      if (f) {
        for (let ch = 0; ch < 3; ch++) low[4 + ch][c] += data[j * 4 + ch] * f;
        low[7][c] += f;
      }
    }
  return low.map((pl) => (k === 1 ? gaussianBlurF32(pl, lw, lh, sigma) : resizePlane(gaussianBlurF32(pl, lw, lh, sigma / k), lw, lh, bw, bh)));
}

// Estimate the foreground color of soft edge pixels from the compositing equation
// I = aF + (1 - a)B, with B and F taken from nearby confidently-background and
// confidently-foreground pixels (normalized Gaussian convolution).
export function decontaminate(img: RGBA8, m: Mask8, amount: number, sigma = 6): RGBA8 {
  const { width: w, height: h } = img, out = cloneRGBA8(img);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = m.data[y * w + x];
      if (v > 0 && v < 255) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  if (x1 < 0) return out;
  const pad = Math.ceil(sigma * 3);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, bn = bw * bh;
  const crop = { width: bw, height: bh, data: new Uint8ClampedArray(bn * 4) }, wB = new Float32Array(bn), wF = new Float32Array(bn);
  for (let y = 0; y < bh; y++) {
    crop.data.set(img.data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + bw) * 4), y * bw * 4);
    for (let x = 0; x < bw; x++) {
      const j = y * bw + x, al = m.data[(y + y0) * w + x + x0] / 255, a = crop.data[j * 4 + 3] / 255;
      if (al < 0.05) wB[j] = a;
      else if (al > 0.95) wF[j] = a;
    }
  }
  const planes = localMeans(crop, wB, wF, sigma);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const i = (y + y0) * w + x + x0, j = y * bw + x, al = m.data[i] / 255;
      if (al <= 0 || al >= 1) continue;
      const o = i * 4, wb = planes[3][j], wf = planes[7][j];
      for (let c = 0; c < 3; c++) {
        const I = img.data[o + c];
        const Fp = wf > 1e-4 ? planes[4 + c][j] / wf : I;
        let F = Fp;
        if (wb > 1e-4) {
          const B = planes[c][j] / wb;
          const est = (I - (1 - al) * B) / Math.max(al, 1e-3);
          // Low alpha makes the inversion unstable; lean on the propagated color there.
          const k = Math.min(1, Math.max(0, (al - 0.1) / 0.3));
          F = Math.min(255, Math.max(0, est)) * k + Fp * (1 - k);
        }
        out.data[o + c] = Math.round(I + (F - I) * amount);
      }
    }
  return out;
}
