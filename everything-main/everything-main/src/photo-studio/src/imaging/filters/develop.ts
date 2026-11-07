// Develop: a raw-converter-style tone and color filter for rendered images.
//
// Pipeline per pixel, in linear light where the physics is linear:
//   decode sRGB -> white balance gains -> exposure (2^stops) -> dehaze (haze
//   model I = J t + A (1 - t)) -> local contrast (clarity, texture) and the
//   tone curve on a perceptual luminance (Y^(1/2.2)), applied to RGB as a
//   luminance ratio so hues hold -> vibrance/saturation -> gamut compression
//   toward luminance instead of per-channel clipping -> vignette -> encode ->
//   grain.
// The tone curve only compresses highlights or shadows when an adjustment
// actually pushes values out of range, so neutral settings are the identity.
import type { ImageOperation, OperationContext, ParamValues, Progress, RGBA8 } from '../types';
import { checkCancelled, cloneRGBA8 } from '../types';
import { resize } from './resample';
import { SRGB_TO_LINEAR, blendSelection, boxBlurPlane, encodeSRGB, hash3, num } from './sampling';

const PERCEPTUAL = 1 / 2.2;
const KR = 0.2126,
  KG = 0.7152,
  KB = 0.0722;

const params = [
  ['temperature', 'Temperature', -100, 100],
  ['tint', 'Tint', -100, 100],
  ['exposure', 'Exposure', -5, 5],
  ['contrast', 'Contrast', -100, 100],
  ['highlights', 'Highlights', -100, 100],
  ['shadows', 'Shadows', -100, 100],
  ['whites', 'Whites', -100, 100],
  ['blacks', 'Blacks', -100, 100],
  ['texture', 'Texture', -100, 100],
  ['clarity', 'Clarity', -100, 100],
  ['dehaze', 'Dehaze', -100, 100],
  ['vibrance', 'Vibrance', -100, 100],
  ['saturation', 'Saturation', -100, 100],
  ['vignette', 'Vignette', -100, 100],
  ['grain', 'Grain', 0, 100],
] as const;

// Tone curve in the perceptual domain, tabulated over [0, xmax]; `xreach` is
// the largest input expected in practice and sizes the highlight shoulder.
function toneLUT(p: ParamValues, xmax: number, xreach: number, n: number): Float32Array {
  const c = num(p, 'contrast', 0) / 100,
    hl = num(p, 'highlights', 0) / 100,
    sh = num(p, 'shadows', 0) / 100,
    wh = num(p, 'whites', 0) / 100,
    bl = num(p, 'blacks', 0) / 100;
  const g = Math.pow(2, 0.8 * c),
    m = Math.pow(0.18, PERCEPTUAL);
  const lut = new Float32Array(n + 1);
  let hi = -Infinity,
    lo = Infinity;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * xmax,
      t = Math.min(1, x);
    // Contrast pivots on middle gray with matching slopes on both sides.
    let y = x <= m ? m * Math.pow(x / m, g) : x <= 1 ? 1 - (1 - m) * Math.pow((1 - x) / (1 - m), g) : x;
    // Band-limited bumps: zero at both ends, so black and white stay put.
    y += (sh > 0 ? 1.6 : 0.95) * sh * t * (1 - t) ** 3;
    y += (hl > 0 ? 1.6 : 0.95) * hl * t ** 3 * (1 - t);
    y += 0.25 * wh * t ** 4 + 0.25 * bl * (1 - t) ** 4;
    lut[i] = y;
    if (x <= xreach) {
      if (y > hi) hi = y;
      if (y < lo) lo = y;
    }
  }
  // Soft shoulder/toe sized by how far the curve overshoots [0, 1].
  const kh = hi > 1 ? 1 - Math.min(0.3, (hi - 1) * 0.5) : 1,
    kl = lo < 0 ? Math.min(0.3, -lo * 0.5) : 0;
  let prev = 0;
  for (let i = 0; i <= n; i++) {
    let y = lut[i];
    if (y > kh) y = kh + (1 - kh) * Math.tanh((y - kh) / (1 - kh));
    else if (y < kl) y = kl - kl * Math.tanh((kl - y) / kl);
    y = Math.max(prev, Math.min(1, Math.max(0, y)));
    lut[i] = prev = y;
  }
  return lut;
}

// Fast guided filter (He et al. 2010, 2015): coefficients a, b computed at low
// resolution and later applied as q = a * I + b with the full-resolution guide.
function guidedCoefficients(I: Float32Array, P: Float32Array, w: number, h: number, r: number, eps: number) {
  const n = w * h,
    mI = new Float32Array(I),
    mP = new Float32Array(P),
    mIP = new Float32Array(n),
    mII = new Float32Array(n),
    tmp = new Float32Array(Math.max(w, h));
  for (let i = 0; i < n; i++) ((mIP[i] = I[i] * P[i]), (mII[i] = I[i] * I[i]));
  for (const a of [mI, mP, mIP, mII]) boxBlurPlane(a, w, h, r, false, tmp);
  const A = new Float32Array(n),
    B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = mII[i] - mI[i] * mI[i],
      cov = mIP[i] - mI[i] * mP[i];
    A[i] = cov / (v + eps);
    B[i] = mP[i] - A[i] * mI[i];
  }
  boxBlurPlane(A, w, h, r, false, tmp);
  boxBlurPlane(B, w, h, r, false, tmp);
  return { A, B };
}

// Bilinear upsampling of a low-resolution plane (lw x lh, lw, lh >= 2) that
// covers the whole image, one full-resolution row at a time.
type Upsampler = { p: Float32Array; lw: number; lh: number; fy: number; col: Int32Array; frac: Float32Array };
function upsampler(p: Float32Array, lw: number, lh: number, w: number, h: number): Upsampler {
  const col = new Int32Array(w),
    frac = new Float32Array(w),
    fx = lw / w;
  for (let x = 0; x < w; x++) {
    const u = Math.min(lw - 1, Math.max(0, (x + 0.5) * fx - 0.5)),
      i = Math.min(lw - 2, u | 0);
    col[x] = i;
    frac[x] = u - i;
  }
  return { p, lw, lh, fy: lh / h, col, frac };
}
function upsampleRow(u: Upsampler, y: number, out: Float32Array) {
  const { p, lw, col, frac } = u;
  const v = Math.min(u.lh - 1, Math.max(0, (y + 0.5) * u.fy - 0.5)),
    j = Math.min(u.lh - 2, v | 0),
    b = v - j,
    r0 = j * lw,
    r1 = r0 + lw;
  for (let x = 0; x < out.length; x++) {
    const i = col[x],
      a = frac[x];
    out[x] = (p[r0 + i] * (1 - a) + p[r0 + i + 1] * a) * (1 - b) + (p[r1 + i] * (1 - a) + p[r1 + i + 1] * a) * b;
  }
}

// Linear luminance -> perceptual (Y^(1/2.2)) through a table indexed by sqrt(Y).
type PLut = { toP: Float32Array; scale: number; ymax: number };
function perceptual(l: PLut, Y: number) {
  const u = Math.sqrt(Y < 0 ? 0 : Y > l.ymax ? l.ymax : Y) * l.scale,
    ui = u | 0;
  return l.toP[ui] + (l.toP[ui + 1] - l.toP[ui]) * (u - ui);
}

function linearRow(
  sd: Uint8ClampedArray,
  y: number,
  w: number,
  gr: number,
  gg: number,
  gb: number,
  haze: Haze | null,
  hzA: Upsampler | null,
  hzB: Upsampler | null,
  rowA: Float32Array,
  rowB: Float32Array,
  pl: PLut,
  out: Float32Array,
) {
  const amt = haze ? haze.amount : 0,
    Ar = haze ? haze.A[0] : 0,
    Ag = haze ? haze.A[1] : 0,
    Ab = haze ? haze.A[2] : 0;
  if (hzA && hzB) {
    upsampleRow(hzA, y, rowA);
    upsampleRow(hzB, y, rowB);
  }
  for (let x = 0, k = y * w * 4, o = 0; x < w; x++, k += 4, o += 3) {
    let r = SRGB_TO_LINEAR[sd[k]] * gr,
      g = SRGB_TO_LINEAR[sd[k + 1]] * gg,
      b = SRGB_TO_LINEAR[sd[k + 2]] * gb;
    if (amt !== 0) {
      const l = KR * r + KG * g + KB * b,
        t0 = rowA[x] * perceptual(pl, l > 1 ? 1 : l) + rowB[x],
        t = t0 < 0.05 ? 0.05 : t0 > 1 ? 1 : t0;
      if (amt > 0) {
        // Invert the haze model with a transmission scaled by the amount.
        const tt = Math.max(0.1, 1 - amt * (1 - t));
        r = Math.max(0, (r - Ar) / tt + Ar);
        g = Math.max(0, (g - Ag) / tt + Ag);
        b = Math.max(0, (b - Ab) / tt + Ab);
      } else {
        const veil = -amt * (0.25 + 0.5 * (1 - t));
        r += (Ar - r) * veil;
        g += (Ag - g) * veil;
        b += (Ab - b) * veil;
      }
    }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}

type Haze = { A: [number, number, number]; ca: Float32Array; cb: Float32Array; lw: number; lh: number; amount: number };

// Dark channel prior (He, Sun, Tang 2009), simplified: estimated on a
// downsampled copy, refined with the fast guided filter.
function estimateHaze(src: RGBA8, gains: [number, number, number], amount: number): Haze {
  const s = Math.min(1, 384 / Math.max(src.width, src.height));
  // At least 2 x 2 so the upsampler always has a cell to interpolate in.
  const tw = Math.max(2, Math.round(src.width * s)),
    th = Math.max(2, Math.round(src.height * s));
  const small = tw !== src.width || th !== src.height ? resize(src, tw, th, 'bilinear') : src;
  const lw = small.width,
    lh = small.height,
    n = small.width * small.height,
    d = small.data;
  const lin = new Float32Array(n * 3),
    dark = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = SRGB_TO_LINEAR[d[i * 4]] * gains[0],
      g = SRGB_TO_LINEAR[d[i * 4 + 1]] * gains[1],
      b = SRGB_TO_LINEAR[d[i * 4 + 2]] * gains[2];
    lin[i * 3] = r;
    lin[i * 3 + 1] = g;
    lin[i * 3 + 2] = b;
    dark[i] = Math.min(r, g, b);
  }
  const rad = Math.max(2, Math.round(Math.max(small.width, small.height) / 40));
  const minFilter = (p: Float32Array) => {
    const w = small.width,
      h = small.height,
      t = new Float32Array(n);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let m = Infinity;
        for (let k = Math.max(0, x - rad); k <= Math.min(w - 1, x + rad); k++) m = Math.min(m, p[y * w + k]);
        t[y * w + x] = m;
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let m = Infinity;
        for (let k = Math.max(0, y - rad); k <= Math.min(h - 1, y + rad); k++) m = Math.min(m, t[k * w + x]);
        p[y * w + x] = m;
      }
  };
  minFilter(dark);
  // Atmospheric light: mean color of the haziest 0.1% (brightest dark channel).
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => dark[b] - dark[a]);
  const top = Math.max(1, Math.round(n * 0.001));
  const A: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < top; k++) for (let c = 0; c < 3; c++) A[c] += lin[order[k] * 3 + c] / top;
  for (let c = 0; c < 3; c++) A[c] = Math.max(A[c], 0.05);
  const t = new Float32Array(n),
    guide = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = Math.min(lin[i * 3] / A[0], lin[i * 3 + 1] / A[1], lin[i * 3 + 2] / A[2]);
    guide[i] = Math.pow(Math.min(1, KR * lin[i * 3] + KG * lin[i * 3 + 1] + KB * lin[i * 3 + 2]), PERCEPTUAL);
  }
  minFilter(t);
  for (let i = 0; i < n; i++) t[i] = 1 - 0.95 * t[i];
  const { A: ca, B: cb } = guidedCoefficients(guide, t, small.width, small.height, rad * 2, 1e-3);
  return { A, ca, cb, lw, lh, amount };
}

export function develop(src: RGBA8, p: ParamValues, ctx: OperationContext, progress?: Progress): RGBA8 {
  const v = (k: string) => num(p, k, 0);
  if (params.every(([k]) => v(k) === 0)) return cloneRGBA8(src);
  const w = src.width,
    h = src.height,
    sd = src.data,
    N = w * h;
  // White balance as channel gains normalized to keep luminance constant.
  const temp = v('temperature') / 100,
    tint = v('tint') / 100;
  let gr = Math.pow(2, 0.6 * temp + 0.25 * tint),
    gg = Math.pow(2, -0.5 * tint),
    gb = Math.pow(2, -0.6 * temp + 0.25 * tint);
  const gl = KR * gr + KG * gg + KB * gb,
    ev = Math.pow(2, v('exposure'));
  gr *= ev / gl;
  gg *= ev / gl;
  gb *= ev / gl;
  const dehaze = Math.max(-1, Math.min(1, v('dehaze') / 100));
  const haze = dehaze ? estimateHaze(src, [gr, gg, gb], dehaze) : null;
  const hzA = haze ? upsampler(haze.ca, haze.lw, haze.lh, w, h) : null,
    hzB = haze ? upsampler(haze.cb, haze.lw, haze.lh, w, h) : null,
    rowA = new Float32Array(w),
    rowB = new Float32Array(w);
  const linRow = new Float32Array(w * 3);
  // Linear RGB after white balance, exposure and dehaze for row y.
  const linear = (y: number) => linearRow(sd, y, w, gr, gg, gb, haze, hzA, hzB, rowA, rowB, plut, linRow);
  // Upper bound of linear luminance reaching the tone curve.
  const ymax = Math.max(1, Math.max(gr, gg, gb) * (haze && haze.amount > 0 ? 10 : 1)) * 1.05;
  const xmax = Math.pow(ymax, PERCEPTUAL) + 0.5;
  // White reaches luminance 2^exposure (gains are luminance-normalized); dehaze
  // and local contrast can push a little further.
  let yreach = ev;
  if (haze && haze.amount > 0) yreach = Math.min(ymax, ev * (1 + 2 * haze.amount));
  const xreach = Math.min(
    xmax,
    Math.pow(yreach, PERCEPTUAL) * (1 + 0.3 * Math.abs(v('clarity') / 100) + 0.3 * Math.abs(v('texture') / 100)),
  );
  const NT = 4096,
    tone = toneLUT(p, xmax, xreach, NT);
  // Y -> perceptual x, indexed by sqrt(Y) for shadow precision.
  const NP = 8192,
    sqrtYmax = Math.sqrt(ymax),
    toP = new Float32Array(NP + 2);
  for (let i = 0; i <= NP + 1; i++) toP[i] = Math.pow(((i / NP) * sqrtYmax) ** 2, PERCEPTUAL);
  const plut: PLut = { toP, scale: NP / sqrtYmax, ymax };
  const NE = 4096,
    toY = new Float32Array(NE + 2);
  for (let i = 0; i <= NE + 1; i++) toY[i] = Math.pow(i / NE, 1 / PERCEPTUAL);

  const clarity = v('clarity') / 100,
    texture = v('texture') / 100;
  let X: Float32Array | null = null,
    blurT: Float32Array | null = null,
    blurC: Float32Array | null = null,
    cw = 0,
    ch = 0;
  if (clarity || texture) {
    const Xp = (X = new Float32Array(N));
    const xRow = (y: number) => {
      linear(y);
      for (let x = 0, i = y * w; x < w; x++, i++)
        Xp[i] = perceptual(plut, KR * linRow[x * 3] + KG * linRow[x * 3 + 1] + KB * linRow[x * 3 + 2]);
    };
    for (let y = 0; y < h; y++) {
      if ((y & 63) === 0) checkCancelled(progress);
      xRow(y);
    }
    const long = Math.max(w, h),
      tmp = new Float32Array(long);
    if (texture) {
      blurT = new Float32Array(X);
      const rt = Math.max(1, Math.round(long * 0.0025));
      for (let k = 0; k < 3; k++) boxBlurPlane(blurT, w, h, rt, false, tmp);
    }
    if (clarity) {
      // Large radius: blur a 1/f copy, then upsample bilinearly per pixel.
      const rc = Math.max(2, long * 0.02),
        f = Math.max(1, Math.floor(rc / 4));
      cw = Math.max(2, Math.ceil(w / f));
      ch = Math.max(2, Math.ceil(h / f));
      const small = new Float32Array(cw * ch),
        cnt = new Float32Array(cw * ch);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const k = Math.min(ch - 1, (y / f) | 0) * cw + Math.min(cw - 1, (x / f) | 0);
          small[k] += X[y * w + x];
          cnt[k]++;
        }
      for (let i = 0; i < small.length; i++) small[i] = cnt[i] ? small[i] / cnt[i] : 0;
      // Fill cells that received no pixels (tiny images) from their neighbour.
      for (let i = 0; i < small.length; i++) if (!cnt[i]) small[i] = small[Math.max(0, i - 1)];
      const r = Math.max(1, Math.round(rc / f));
      for (let k = 0; k < 3; k++) boxBlurPlane(small, cw, ch, r, false, new Float32Array(Math.max(cw, ch)));
      blurC = small;
    }
  }

  const vib = v('vibrance') / 100,
    sat = v('saturation') / 100,
    vig = v('vignette') / 100,
    grain = v('grain') / 100;
  const cx = w / 2,
    cy = h / 2,
    rn = 1 / Math.hypot(cx, cy);
  const grainTile = grain
    ? grainTexture(Math.max(0.5, (1 + (num(p, 'grainSize', 25) / 100) * 3) * (ctx.scale ?? 1)), (ctx.seed ?? 0) | 0)
    : null;
  const clarUp = blurC ? upsampler(blurC, cw, ch, w, h) : null,
    rowC = new Float32Array(w);
  const out = cloneRGBA8(src),
    od = out.data;
  // One function per row keeps V8 from bouncing in and out of OSR code.
  const row = (y: number) => {
    linear(y);
    if (clarUp) upsampleRow(clarUp, y, rowC);
    const gRow = (y & (GRAIN_T - 1)) * GRAIN_T;
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        k = i * 4;
      let r = linRow[x * 3],
        g = linRow[x * 3 + 1],
        b = linRow[x * 3 + 2];
      const Y = KR * r + KG * g + KB * b;
      // Perceptual luminance through local contrast and the tone curve.
      let px = X ? X[i] : perceptual(plut, Y);
      if (blurT) px += texture * 0.8 * (px - blurT[i]);
      if (clarUp) {
        const base = rowC[x],
          mid = Math.max(0, 1 - (2 * Math.min(1, px) - 1) ** 2);
        px += clarity * 0.7 * (px - base) * mid;
      }
      const tx = (Math.min(xmax, Math.max(0, px)) / xmax) * NT,
        ti = Math.min(NT - 1, tx | 0),
        xo = tone[ti] + (tone[ti + 1] - tone[ti]) * (tx - ti);
      const ye = xo * NE,
        yi = ye | 0,
        Yn = toY[yi] + (toY[yi + 1] - toY[yi]) * (ye - yi);
      if (Y > 1e-7) {
        const s = Yn / Y;
        r *= s;
        g *= s;
        b *= s;
      } else r = g = b = Yn;
      // Vibrance favors muted colors; saturation scales chroma uniformly.
      if (vib || sat) {
        const mx = Math.max(r, g, b),
          mn = Math.min(r, g, b),
          s0 = mx > 1e-6 ? (mx - mn) / mx : 0,
          f = Math.max(0, 1 + sat + vib * (1 - s0) * (vib > 0 ? 1 : 0.5 + 0.5 * s0));
        r = Yn + (r - Yn) * f;
        g = Yn + (g - Yn) * f;
        b = Yn + (b - Yn) * f;
      }
      // Compress out-of-range colors toward their luminance (keeps hue).
      const mx = Math.max(r, g, b),
        mn = Math.min(r, g, b);
      if (mx > 1 && Yn < 1) {
        const q = (1 - Yn) / (mx - Yn);
        r = Yn + (r - Yn) * q;
        g = Yn + (g - Yn) * q;
        b = Yn + (b - Yn) * q;
      }
      if (mn < 0 && Yn > 0) {
        const q = Yn / (Yn - mn);
        r = Yn + (r - Yn) * q;
        g = Yn + (g - Yn) * q;
        b = Yn + (b - Yn) * q;
      }
      if (vig) {
        const d = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) * rn,
          t = Math.min(1, Math.max(0, (d - 0.35) / 0.7)),
          gain = Math.pow(2, 1.5 * vig * t * t * (3 - 2 * t));
        r *= gain;
        g *= gain;
        b *= gain;
      }
      let R = encodeSRGB(r),
        G = encodeSRGB(g),
        B = encodeSRGB(b);
      if (grainTile) {
        // Strongest in the midtones.
        const n = grainTile[gRow + (x & (GRAIN_T - 1))],
          l = (0.299 * R + 0.587 * G + 0.114 * B) / 255,
          a = n * grain * 70 * (0.3 + 2.8 * l * (1 - l));
        R += a;
        G += a;
        B += a;
      }
      od[k] = R;
      od[k + 1] = G;
      od[k + 2] = B;
    }
  };
  for (let y = 0; y < h; y++) {
    if ((y & 31) === 0) {
      checkCancelled(progress);
      progress?.report?.(y / h);
    }
    row(y);
  }
  progress?.report?.(1);
  return blendSelection(src, out, ctx.selection);
}

// Grain is looked up in a tileable 512 x 512 texture of two-octave value noise
// (centered on zero) instead of hashing every pixel; the repeat is invisible in
// random grain.
const GRAIN_T = 512;
function grainTexture(cell: number, seed: number): Float32Array {
  const t = new Float32Array(GRAIN_T * GRAIN_T);
  // Lattice periods that divide the tile keep it seamless.
  const p1 = Math.max(1, Math.round(GRAIN_T / cell)),
    p2 = Math.max(1, Math.round((2 * GRAIN_T) / cell));
  for (let y = 0; y < GRAIN_T; y++)
    for (let x = 0; x < GRAIN_T; x++)
      t[y * GRAIN_T + x] =
        valueNoise((x * p1) / GRAIN_T, (y * p1) / GRAIN_T, p1, seed) * 0.7 +
        valueNoise((x * p2) / GRAIN_T, (y * p2) / GRAIN_T, p2, seed + 1) * 0.3 -
        0.5;
  return t;
}

function valueNoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    fx = x - xi,
    fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  const x0 = xi % period,
    y0 = yi % period,
    x1 = (xi + 1) % period,
    y1 = (yi + 1) % period;
  const a = hash3(x0, y0, seed),
    b = hash3(x1, y0, seed),
    c = hash3(x0, y1, seed),
    d = hash3(x1, y1, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

export const developOp: ImageOperation = {
  id: 'develop',
  label: 'Develop',
  category: 'Adjustments',
  params: [
    ...params.map(([key, label, min, max]) => ({
      key,
      label,
      type: 'number' as const,
      min,
      max,
      step: key === 'exposure' ? 0.05 : 1,
      default: 0,
      unit: key === 'exposure' ? 'EV' : undefined,
    })),
    { key: 'grainSize', label: 'Grain size', type: 'number', min: 0, max: 100, default: 25 },
  ],
  apply: develop,
};
