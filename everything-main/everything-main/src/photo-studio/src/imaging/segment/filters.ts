// Small float-buffer filters shared by the selection and retouching code. All
// work on single-channel Float32Array planes, clamp to the edge and run in O(n)
// per pixel regardless of radius (running sums).
import type { Mask8, RGBA8 } from '../types';

// Mean over a (2r+1) window, clamped at the borders: the window shrinks rather
// than replicating edge pixels, which is what the guided filter's statistics need.
export function boxMean(src: Float32Array, w: number, h: number, r: number, out = new Float32Array(w * h)) {
  if (r <= 0) {
    if (out !== src) out.set(src);
    return out;
  }
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    const e0 = Math.min(r, w - 1);
    for (let x = 0; x <= e0; x++) acc += src[row + x];
    for (let x = 0; x < w; x++) {
      const lo = Math.max(0, x - r), hi = Math.min(w - 1, x + r);
      tmp[row + x] = acc / (hi - lo + 1);
      if (x + r + 1 < w) acc += src[row + x + r + 1];
      if (x - r >= 0) acc -= src[row + x - r];
    }
  }
  const acc = new Float64Array(w);
  const e0 = Math.min(r, h - 1);
  for (let y = 0; y <= e0; y++) for (let x = 0, o = y * w; x < w; x++) acc[x] += tmp[o + x];
  for (let y = 0; y < h; y++) {
    const lo = Math.max(0, y - r), hi = Math.min(h - 1, y + r), inv = 1 / (hi - lo + 1), o = y * w;
    for (let x = 0; x < w; x++) out[o + x] = acc[x] * inv;
    if (y + r + 1 < h) for (let x = 0, a = (y + r + 1) * w; x < w; x++) acc[x] += tmp[a + x];
    if (y - r >= 0) for (let x = 0, s = (y - r) * w; x < w; x++) acc[x] -= tmp[s + x];
  }
  return out;
}

// Box pass with replicated edges and an odd width, so repeated passes stay
// exactly symmetric (needed for a symmetric feather).
function boxReplicate(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (2 * r + 1);
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w, last = row + w - 1;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(Math.max(k, 0), w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * inv;
      acc += src[Math.min(row + x + r + 1, last)] - src[row + Math.max(x - r, 0)];
    }
  }
  const acc = new Float64Array(w);
  for (let k = -r; k <= r; k++) {
    const o = Math.min(Math.max(k, 0), h - 1) * w;
    for (let x = 0; x < w; x++) acc[x] += tmp[o + x];
  }
  for (let y = 0; y < h; y++) {
    const o = y * w, a = Math.min(y + r + 1, h - 1) * w, s = Math.max(y - r, 0) * w;
    for (let x = 0; x < w; x++) {
      dst[o + x] = acc[x] * inv;
      acc[x] += tmp[a + x] - tmp[s + x];
    }
  }
}

// Gaussian approximated by three box passes of odd widths (Kovesi, "Fast almost-
// Gaussian filtering", 2010). In place.
export function gaussianBlurF32(buf: Float32Array, w: number, h: number, sigma: number) {
  if (!(sigma > 0.2) || w === 0 || h === 0) return buf;
  const n = 3;
  let wl = Math.floor(Math.sqrt((12 * sigma * sigma) / n + 1));
  if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  for (let i = 0; i < n; i++) {
    const width = i < m ? wl : wl + 2;
    boxReplicate(buf, buf, w, h, (width - 1) >> 1);
  }
  return buf;
}

// Rec. 601 luma in [0, 1], premultiplied by alpha so transparent pixels read black.
export function lumaF32(img: RGBA8) {
  const { data, width, height } = img, out = new Float32Array(width * height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++)
    out[j] = ((0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * data[i + 3]) / (255 * 255);
  return out;
}

// Guided filter (He, Sun and Tang 2010/2013) with a gray guide: an edge-preserving
// smoother whose output is locally a linear function of the guide, which makes it
// a cheap matting refinement of a rough mask.
export function guidedFilterGray(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number) {
  const n = w * h, Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Ip[i] = I[i] * p[i];
    II[i] = I[i] * I[i];
  }
  const mI = boxMean(I, w, h, r), mp = boxMean(p, w, h, r), mIp = boxMean(Ip, w, h, r), mII = boxMean(II, w, h, r, II);
  const a = Ip, b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = mII[i] - mI[i] * mI[i], c = mIp[i] - mI[i] * mp[i];
    const ai = c / (v + eps);
    a[i] = ai;
    b[i] = mp[i] - ai * mI[i];
  }
  const ma = boxMean(a, w, h, r, mIp), mb = boxMean(b, w, h, r, mp);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}

// Fast guided filter (He and Sun 2015): solve for the local linear coefficients
// on a low-resolution guide/input pair, then apply them, bilinearly upsampled, to
// the full-resolution luma row by row (no full-size float planes, so it scales
// to very large documents). `remap` turns the filtered value into coverage.
export function guidedUpsample(Ilow: Float32Array, plow: Float32Array, lw: number, lh: number, img: RGBA8, r: number, eps: number, remap: (v: number) => number): Mask8 {
  const n = lw * lh, Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Ip[i] = Ilow[i] * plow[i];
    II[i] = Ilow[i] * Ilow[i];
  }
  const mI = boxMean(Ilow, lw, lh, r), mp = boxMean(plow, lw, lh, r), mIp = boxMean(Ip, lw, lh, r), mII = boxMean(II, lw, lh, r, II);
  const a = Ip, b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ai = (mIp[i] - mI[i] * mp[i]) / (mII[i] - mI[i] * mI[i] + eps);
    a[i] = ai;
    b[i] = mp[i] - ai * mI[i];
  }
  const A = boxMean(a, lw, lh, r, mIp), B = boxMean(b, lw, lh, r, mp);
  const { width: W, height: H, data } = img, out: Mask8 = { width: W, height: H, data: new Uint8Array(W * H) };
  const sx = lw / W, sy = lh / H, xa = new Int32Array(W), xb = new Int32Array(W), tx = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const f = Math.min(Math.max((x + 0.5) * sx - 0.5, 0), lw - 1), x0 = Math.floor(f);
    xa[x] = x0;
    xb[x] = Math.min(x0 + 1, lw - 1);
    tx[x] = f - x0;
  }
  for (let y = 0; y < H; y++) {
    const f = Math.min(Math.max((y + 0.5) * sy - 0.5, 0), lh - 1), y0 = Math.floor(f), y1 = Math.min(y0 + 1, lh - 1), ty = f - y0;
    const r0 = y0 * lw, r1 = y1 * lw;
    for (let x = 0, i = y * W * 4; x < W; x++, i += 4) {
      const t = tx[x], p0 = r0 + xa[x], p1 = r0 + xb[x], q0 = r1 + xa[x], q1 = r1 + xb[x];
      const av = (A[p0] + (A[p1] - A[p0]) * t) * (1 - ty) + (A[q0] + (A[q1] - A[q0]) * t) * ty;
      const bv = (B[p0] + (B[p1] - B[p0]) * t) * (1 - ty) + (B[q0] + (B[q1] - B[q0]) * t) * ty;
      const I = ((0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * data[i + 3]) / 65025;
      out.data[y * W + x] = remap(av * I + bv);
    }
  }
  return out;
}

// Color-guide variant: per-window 3x3 covariance solve. Several times slower than
// the gray guide, so callers use it at reduced resolution.
export function guidedFilterColor(img: RGBA8, p: Float32Array, r: number, eps: number) {
  const { width: w, height: h, data } = img, n = w * h;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const a = data[i + 3] / 65025;
    R[j] = data[i] * a;
    G[j] = data[i + 1] * a;
    B[j] = data[i + 2] * a;
  }
  const prod = (x: Float32Array, y: Float32Array) => {
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) o[i] = x[i] * y[i];
    return boxMean(o, w, h, r, o);
  };
  const mR = boxMean(R, w, h, r), mG = boxMean(G, w, h, r), mB = boxMean(B, w, h, r), mp = boxMean(p, w, h, r);
  const mRp = prod(R, p), mGp = prod(G, p), mBp = prod(B, p);
  const vRR = prod(R, R), vRG = prod(R, G), vRB = prod(R, B), vGG = prod(G, G), vGB = prod(G, B), vBB = prod(B, B);
  const aR = mRp, aG = mGp, aB = mBp, b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cR = mRp[i] - mR[i] * mp[i], cG = mGp[i] - mG[i] * mp[i], cB = mBp[i] - mB[i] * mp[i];
    const rr = vRR[i] - mR[i] * mR[i] + eps, rg = vRG[i] - mR[i] * mG[i], rb = vRB[i] - mR[i] * mB[i];
    const gg = vGG[i] - mG[i] * mG[i] + eps, gb = vGB[i] - mG[i] * mB[i], bb = vBB[i] - mB[i] * mB[i] + eps;
    // Symmetric 3x3 inverse by cofactors.
    const i00 = gg * bb - gb * gb, i01 = gb * rb - rg * bb, i02 = rg * gb - gg * rb;
    const i11 = rr * bb - rb * rb, i12 = rb * rg - rr * gb, i22 = rr * gg - rg * rg;
    const det = rr * i00 + rg * i01 + rb * i02, inv = det !== 0 ? 1 / det : 0;
    const a0 = (cR * i00 + cG * i01 + cB * i02) * inv;
    const a1 = (cR * i01 + cG * i11 + cB * i12) * inv;
    const a2 = (cR * i02 + cG * i12 + cB * i22) * inv;
    aR[i] = a0;
    aG[i] = a1;
    aB[i] = a2;
    b[i] = mp[i] - a0 * mR[i] - a1 * mG[i] - a2 * mB[i];
  }
  boxMean(aR, w, h, r, aR);
  boxMean(aG, w, h, r, aG);
  boxMean(aB, w, h, r, aB);
  boxMean(b, w, h, r, b);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = aR[i] * R[i] + aG[i] * G[i] + aB[i] * B[i] + b[i];
  return q;
}

// Area-average downscale by an arbitrary factor (premultiplied, so transparent
// pixels do not bleed color). Returns straight-alpha RGBA8.
export function downscaleRGBA(img: RGBA8, tw: number, th: number): RGBA8 {
  const { width: w, height: h, data } = img;
  if (tw === w && th === h) return { width: w, height: h, data: new Uint8ClampedArray(data) };
  const acc = new Float64Array(tw * th * 4), cnt = new Float64Array(tw * th);
  const sx = tw / w, sy = th / h;
  // Pixel-to-cell assignment is nearest-cell; for integer-ish factors this is a box filter.
  const cx = new Int32Array(w), cy = new Int32Array(h);
  for (let x = 0; x < w; x++) cx[x] = Math.min(tw - 1, Math.floor((x + 0.5) * sx));
  for (let y = 0; y < h; y++) cy[y] = Math.min(th - 1, Math.floor((y + 0.5) * sy));
  for (let y = 0; y < h; y++) {
    const ro = cy[y] * tw;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      const c = ro + cx[x], a = data[i + 3], o = c * 4;
      acc[o] += data[i] * a;
      acc[o + 1] += data[i + 1] * a;
      acc[o + 2] += data[i + 2] * a;
      acc[o + 3] += a;
      cnt[c]++;
    }
  }
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let c = 0, o = 0; c < cnt.length; c++, o += 4) {
    const a = acc[o + 3];
    if (a > 0) {
      out[o] = acc[o] / a;
      out[o + 1] = acc[o + 1] / a;
      out[o + 2] = acc[o + 2] / a;
    }
    out[o + 3] = cnt[c] ? Math.round(a / cnt[c]) : 0;
  }
  return { width: tw, height: th, data: out };
}

// Bilinear resample of a float plane to a new size (pixel-center aligned).
export function resizePlane(src: Float32Array, w: number, h: number, tw: number, th: number) {
  const out = new Float32Array(tw * th), sx = w / tw, sy = h / th;
  const x0s = new Int32Array(tw), x1s = new Int32Array(tw), fxs = new Float32Array(tw);
  for (let x = 0; x < tw; x++) {
    const fx = Math.min(Math.max((x + 0.5) * sx - 0.5, 0), w - 1), x0 = Math.floor(fx);
    x0s[x] = x0;
    x1s[x] = Math.min(x0 + 1, w - 1);
    fxs[x] = fx - x0;
  }
  for (let y = 0; y < th; y++) {
    const fy = Math.min(Math.max((y + 0.5) * sy - 0.5, 0), h - 1), y0 = Math.floor(fy), y1 = Math.min(y0 + 1, h - 1), ty = fy - y0;
    const r0 = y0 * w, r1 = y1 * w, o = y * tw;
    for (let x = 0; x < tw; x++) {
      const a = src[r0 + x0s[x]], b = src[r0 + x1s[x]], c = src[r1 + x0s[x]], d = src[r1 + x1s[x]], tx = fxs[x];
      out[o + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

// Deterministic PRNG (mulberry32) so seeded operations re-render identically.
export function rng(seed: number) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
