import type { RGBA8 } from '../types';
import {
  hsbToRgb,
  labToSrgb,
  linearToOklab,
  linearToSrgb,
  mulberry32,
  oklabToLinear,
  rgbToHsb,
  srgbToLinear,
  type RGB,
} from './color';

export type StopColor = RGB | 'foreground' | 'background';
// `midpoint` (percent, 5..95, default 50) sits between this stop and the next:
// it is where the blend between the two reaches half way.
export type ColorStop = { location: number; color: StopColor; midpoint?: number };
export type OpacityStop = { location: number; opacity: number; midpoint?: number };
export type SolidGradient = {
  kind: 'solid';
  name?: string;
  colorStops: ColorStop[];
  opacityStops: OpacityStop[];
  // Percent, 0..100. 0 interpolates segments linearly; 100 eases into and out
  // of every stop.
  smoothness?: number;
};
// Noise gradients draw random color curves within per-channel ranges of the
// chosen model. Ranges are normalized to [0, 1] of each channel: RGB 0..255,
// HSB hue 0..360 / saturation / brightness, Lab L 0..100 and a/b -128..127.
export type NoiseGradient = {
  kind: 'noise';
  name?: string;
  roughness: number; // percent, 0..100
  model: 'rgb' | 'hsb' | 'lab';
  min: [number, number, number];
  max: [number, number, number];
  restrictColors: boolean;
  addTransparency: boolean;
  seed: number;
};
export type Gradient = SolidGradient | NoiseGradient;
export type GradientType = 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';
// classic: interpolate encoded sRGB; linear: interpolate linear light;
// perceptual: interpolate in Oklab (even perceived steps, no muddy middles).
export type GradientMethod = 'perceptual' | 'linear' | 'classic';
export type GradientContext = {
  foreground?: RGB;
  background?: RGB;
  method?: GradientMethod;
  reverse?: boolean;
};

export const RAMP_SIZE = 4096;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function resolve(c: StopColor, ctx: GradientContext): RGB {
  if (c === 'foreground') return ctx.foreground ?? [0, 0, 0];
  if (c === 'background') return ctx.background ?? [255, 255, 255];
  return c;
}
// Segment-local easing: the midpoint maps t = m to one half with the rational
// bias t / (t + k (1 - t)), k = m / (1 - m) (m = 0.5 is the identity). Unlike a
// power curve it mirrors exactly (midpoint m reversed is 1 - m), so reversing
// a gradient keeps its look. Smoothness then blends toward smoothstep.
export function segmentEase(t: number, midpointPercent = 50, smoothness = 0): number {
  const m = Math.min(0.95, Math.max(0.05, midpointPercent / 100));
  let u = m === 0.5 ? t : t / (t + (m / (1 - m)) * (1 - t));
  if (smoothness > 0) u += smoothness * (u * u * (3 - 2 * u) - u);
  return u;
}
function locate<T extends { location: number }>(stops: T[], t: number): [number, number] {
  // Returns the segment index i (stops[i]..stops[i+1]) and local parameter.
  const n = stops.length;
  if (t <= stops[0].location) return [0, 0];
  if (t >= stops[n - 1].location) return [n - 2, 1];
  let i = 0;
  while (i < n - 2 && t > stops[i + 1].location) i++;
  const a = stops[i].location, b = stops[i + 1].location;
  return [i, b > a ? (t - a) / (b - a) : 1];
}
const sortStops = <T extends { location: number }>(s: T[]) =>
  [...s].sort((a, b) => a.location - b.location);

// Mixes two encoded colors with the given method, into out (0..255 floats).
export function mixColor(c0: RGB, c1: RGB, t: number, method: GradientMethod, out: number[]) {
  if (method === 'classic') {
    for (let i = 0; i < 3; i++) out[i] = c0[i] + (c1[i] - c0[i]) * t;
    return out;
  }
  const l0 = [srgbToLinear(c0[0]), srgbToLinear(c0[1]), srgbToLinear(c0[2])];
  const l1 = [srgbToLinear(c1[0]), srgbToLinear(c1[1]), srgbToLinear(c1[2])];
  if (method === 'linear') {
    for (let i = 0; i < 3; i++) out[i] = linearToSrgb(l0[i] + (l1[i] - l0[i]) * t);
    return out;
  }
  const a = linearToOklab(l0[0], l0[1], l0[2]), b = linearToOklab(l1[0], l1[1], l1[2]);
  const lin = oklabToLinear(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  for (let i = 0; i < 3; i++) out[i] = linearToSrgb(Math.min(1, Math.max(0, lin[i])));
  return out;
}

// Samples a solid gradient at t in [0, 1]: [r, g, b, a] all as 0..255 floats.
export function sampleSolid(g: SolidGradient, t: number, ctx: GradientContext = {}, out: number[] = [0, 0, 0, 0]) {
  const cs = g.colorStops, os = g.opacityStops;
  const smooth = clamp01((g.smoothness ?? 0) / 100);
  if (cs.length === 0) out[0] = out[1] = out[2] = 0;
  else if (cs.length === 1) {
    const c = resolve(cs[0].color, ctx);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  } else {
    const [i, u] = locate(cs, t);
    const e = segmentEase(u, cs[i].midpoint, smooth);
    mixColor(resolve(cs[i].color, ctx), resolve(cs[i + 1].color, ctx), e, ctx.method ?? 'perceptual', out);
  }
  if (os.length === 0) out[3] = 255;
  else if (os.length === 1) out[3] = os[0].opacity * 255;
  else {
    const [i, u] = locate(os, t);
    const e = segmentEase(u, os[i].midpoint, smooth);
    out[3] = (os[i].opacity + (os[i + 1].opacity - os[i].opacity) * e) * 255;
  }
  return out;
}

// One smooth random curve per channel through K knots; low roughness uses few
// knots with cosine easing, high roughness many knots with near-linear joins.
function noiseCurves(g: NoiseGradient, n: number): Float32Array[] {
  const rand = mulberry32(g.seed);
  const r = clamp01(g.roughness / 100);
  const knots = 3 + Math.round(Math.pow(r, 1.5) * 60);
  const ease = 1 - r;
  const curves: Float32Array[] = [];
  for (let c = 0; c < 4; c++) {
    const lo = c < 3 ? clamp01(Math.min(g.min[c], g.max[c])) : 0;
    const hi = c < 3 ? clamp01(Math.max(g.min[c], g.max[c])) : 1;
    const k = new Float32Array(knots);
    for (let i = 0; i < knots; i++) k[i] = lo + (hi - lo) * rand();
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = (i / (n - 1)) * (knots - 1);
      const j = Math.min(knots - 2, Math.floor(p));
      const f = p - j;
      const fe = f + ease * ((1 - Math.cos(Math.PI * f)) / 2 - f);
      out[i] = k[j] + (k[j + 1] - k[j]) * fe;
    }
    curves.push(out);
  }
  return curves;
}

const rampCache = new WeakMap<Gradient, { key: string; ramp: Float32Array }>();
// Precomputes RAMP_SIZE RGBA samples (0..255 floats) for fast rendering.
export function gradientRamp(g: Gradient, ctx: GradientContext = {}): Float32Array {
  const key = JSON.stringify([g, ctx.foreground, ctx.background, ctx.method, ctx.reverse]);
  const hit = rampCache.get(g);
  if (hit && hit.key === key) return hit.ramp;
  const n = RAMP_SIZE;
  const ramp = new Float32Array(n * 4);
  const px = [0, 0, 0, 0];
  if (g.kind === 'solid') {
    const sorted: SolidGradient = { ...g, colorStops: sortStops(g.colorStops), opacityStops: sortStops(g.opacityStops) };
    for (let i = 0; i < n; i++) {
      sampleSolid(sorted, i / (n - 1), ctx, px);
      ramp.set(px, i * 4);
    }
  } else {
    const [c0, c1, c2, ca] = noiseCurves(g, n);
    for (let i = 0; i < n; i++) {
      let rgb: RGB;
      if (g.model === 'rgb') rgb = [c0[i] * 255, c1[i] * 255, c2[i] * 255];
      else if (g.model === 'hsb') rgb = hsbToRgb(c0[i], c1[i], c2[i]);
      else rgb = labToSrgb(c0[i] * 100, c1[i] * 255 - 128, c2[i] * 255 - 128);
      for (let c = 0; c < 3; c++) rgb[c] = Math.min(255, Math.max(0, rgb[c]));
      if (g.restrictColors) {
        // Keep colors printable-looking: cap saturation and avoid pure extremes.
        const [h, s, v] = rgbToHsb(rgb[0], rgb[1], rgb[2]);
        rgb = hsbToRgb(h, Math.min(s, 0.85), 0.06 + v * 0.9);
      }
      ramp[i * 4] = rgb[0];
      ramp[i * 4 + 1] = rgb[1];
      ramp[i * 4 + 2] = rgb[2];
      ramp[i * 4 + 3] = g.addTransparency ? ca[i] * 255 : 255;
    }
  }
  if (ctx.reverse)
    for (let i = 0, j = n - 1; i < j; i++, j--)
      for (let c = 0; c < 4; c++) {
        const t = ramp[i * 4 + c];
        ramp[i * 4 + c] = ramp[j * 4 + c];
        ramp[j * 4 + c] = t;
      }
  rampCache.set(g, { key, ramp });
  return ramp;
}

export type GradientRenderOptions = GradientContext & {
  type: GradientType;
  start: { x: number; y: number };
  end: { x: number; y: number };
  dither?: boolean;
  // Multiplies the start-to-end length (1 = as drawn); scaled about `start`.
  scale?: number;
};

// 8x8 Bayer matrix, used as an ordered dither threshold.
const BAYER = (() => {
  // Recursive construction: M(2n) = [[4M, 4M+2], [4M+3, 4M+1]].
  let m = [0], n = 1;
  while (n < 8) {
    const next = new Array(4 * n * n);
    for (let y = 0; y < 2 * n; y++)
      for (let x = 0; x < 2 * n; x++)
        next[y * 2 * n + x] = 4 * m[(y % n) * n + (x % n)] + [0, 2, 3, 1][(y >= n ? 2 : 0) + (x >= n ? 1 : 0)];
    m = next;
    n *= 2;
  }
  return Float32Array.from(m, (v) => (v + 0.5) / 64 - 0.5);
})();

// Gradient parameter t (unclamped) at pixel center (px, py) for a geometry.
// Conventions: linear and reflected project onto start->end; radial is the
// distance from start over |end - start|; diamond is the L1 distance in the
// frame rotated to start->end (end is a corner); angle sweeps one full turn
// counterclockwise on screen starting from the start->end direction.
export function gradientParameter(type: GradientType, dx: number, dy: number, ux: number, uy: number, len: number): number {
  switch (type) {
    case 'linear': return (dx * ux + dy * uy) / len;
    case 'reflected': return Math.abs(dx * ux + dy * uy) / len;
    case 'radial': return Math.sqrt(dx * dx + dy * dy) / len;
    case 'diamond': return (Math.abs(dx * ux + dy * uy) + Math.abs(-dx * uy + dy * ux)) / len;
    case 'angle': {
      // Screen y points down, so counterclockwise is the negated cross term.
      const a = Math.atan2(-(dy * ux - dx * uy), dx * ux + dy * uy);
      return (a < 0 ? a + 2 * Math.PI : a) / (2 * Math.PI);
    }
  }
}

// Renders a gradient into a new RGBA8. Coordinates are in pixels; pixel (x, y)
// is sampled at its center (x + 0.5, y + 0.5).
export function renderGradient(w: number, h: number, g: Gradient, opts: GradientRenderOptions): RGBA8 {
  const data = new Uint8ClampedArray(w * h * 4);
  const out: RGBA8 = { width: w, height: h, data };
  renderGradientInto(out, g, opts);
  return out;
}
export function renderGradientInto(out: RGBA8, g: Gradient, opts: GradientRenderOptions, origin = { x: 0, y: 0 }) {
  const { width: w, height: h, data } = out;
  const ramp = gradientRamp(g, opts);
  const sx = opts.start.x, sy = opts.start.y;
  let ex = opts.end.x - sx, ey = opts.end.y - sy;
  let len = Math.hypot(ex, ey);
  if (len < 1e-6) { ex = 1; ey = 0; len = 1e-6; }
  const ux = ex / Math.max(len, 1e-12), uy = ey / Math.max(len, 1e-12);
  len *= opts.scale ?? 1;
  const n1 = RAMP_SIZE - 1;
  const dither = !!opts.dither;
  const type = opts.type;
  for (let y = 0; y < h; y++) {
    const dy = y + origin.y + 0.5 - sy;
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      const dx = x + origin.x + 0.5 - sx;
      let t = type === 'linear' ? (dx * ux + dy * uy) / len : gradientParameter(type, dx, dy, ux, uy, len);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const k = Math.round(t * n1) * 4;
      if (dither) {
        const d = BAYER[((y + origin.y) & 7) * 8 + ((x + origin.x) & 7)];
        data[i] = Math.floor(ramp[k] + d + 0.5);
        data[i + 1] = Math.floor(ramp[k + 1] + d + 0.5);
        data[i + 2] = Math.floor(ramp[k + 2] + d + 0.5);
        data[i + 3] = Math.floor(ramp[k + 3] + d + 0.5);
      } else {
        data[i] = ramp[k];
        data[i + 1] = ramp[k + 1];
        data[i + 2] = ramp[k + 2];
        data[i + 3] = ramp[k + 3];
      }
    }
  }
  return out;
}
