// HDR Toning: compress a wide tonal range into a displayable image. The local
// method splits log luminance into a base layer (an edge-preserving guided
// filter) and detail; the base is compressed, detail is boosted, and color
// ratios are kept. Global methods (exposure and gamma, highlight compression,
// histogram equalization) are offered too. Works on linear float input (merged
// HDR) or on ordinary 8-bit images, which it linearizes first.
import { checkCancelled, type ImageOperation, type ParamSpec, type ParamValues, type Progress, type RGBA8, type RGBAF } from '../types';
import { guidedFilterGray } from '../segment/filters';
import { monotoneSpline } from './curves';
import { linearToSrgb, srgbToLinear } from './color-math';

export type ToningMethod = 'local' | 'exposure-gamma' | 'highlight-compression' | 'equalize';
export type HdrToningParams = {
  method: ToningMethod;
  // Edge glow: radius in pixels of the base layer and how far it bleeds across edges.
  radius: number;
  strength: number;
  // Tone and detail.
  gamma: number;
  exposure: number;
  detail: number;
  // Advanced: -100..100.
  shadow: number;
  highlight: number;
  vibrance: number;
  saturation: number;
  // Toning curve: a preset name or JSON [[in, out], ...] in 0..255 codes.
  curve: string;
};
export const DEFAULT_HDR_TONING: HdrToningParams = {
  method: 'local',
  radius: 40,
  strength: 0.6,
  gamma: 1,
  exposure: 0,
  detail: 30,
  shadow: 0,
  highlight: 0,
  vibrance: 0,
  saturation: 20,
  curve: 'linear',
};
export const TONING_CURVES: Record<string, { label: string; points: [number, number][] }> = {
  linear: { label: 'Linear', points: [[0, 0], [255, 255]] },
  medium: { label: 'Medium Contrast', points: [[0, 0], [64, 54], [192, 202], [255, 255]] },
  strong: { label: 'Strong Contrast', points: [[0, 0], [64, 44], [192, 212], [255, 255]] },
  lighter: { label: 'Lighter', points: [[0, 0], [128, 150], [255, 255]] },
  darker: { label: 'Darker', points: [[0, 0], [128, 106], [255, 255]] },
  matte: { label: 'Faded Shadows', points: [[0, 24], [64, 70], [255, 250]] },
};

/** Parse a curve preset or JSON points into a 256-entry table (codes). */
export function toningCurveTable(curve: string): Float32Array {
  let pts: [number, number][] | undefined = TONING_CURVES[curve]?.points;
  if (!pts) {
    try {
      const parsed = JSON.parse(curve) as [number, number][];
      if (Array.isArray(parsed) && parsed.length >= 2 && parsed.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) pts = parsed;
    } catch {
      pts = undefined;
    }
  }
  const f = monotoneSpline(pts ?? TONING_CURVES.linear.points);
  return Float32Array.from({ length: 256 }, (_, i) => Math.max(0, Math.min(255, f(i))));
}

const LR = 0.2126,
  LG = 0.7152,
  LB = 0.0722;

function percentile(values: Float32Array, q: number) {
  // Histogram percentile over a fixed log range keeps this O(n).
  const lo = -20,
    hi = 12,
    bins = 2048;
  const hist = new Uint32Array(bins);
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    hist[Math.max(0, Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo)) * bins)))]++;
    n++;
  }
  let acc = 0;
  for (let b = 0; b < bins; b++) {
    acc += hist[b];
    if (acc >= q * n) return lo + ((b + 0.5) / bins) * (hi - lo);
  }
  return hi;
}

/** Tone-map linear RGB (alpha kept) to 8-bit display values. `scale` shrinks
 * the radius for previews computed on smaller images. */
export function toneMap(src: RGBAF, p: HdrToningParams, scale = 1, progress?: Progress): RGBA8 {
  const { width: w, height: h, data } = src;
  const n = w * h;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = Math.max(0, LR * data[i * 4] + LG * data[i * 4 + 1] + LB * data[i * 4 + 2]);
  const lum = new Float32Array(n);
  const ev = Math.pow(2, p.exposure);
  checkCancelled(progress);
  if (p.method === 'local') {
    const log = new Float32Array(n);
    for (let i = 0; i < n; i++) log[i] = Math.log2(L[i] + 1e-4);
    const r = Math.max(1, Math.round(p.radius * scale));
    const eps = Math.pow(0.08 + 0.3 * p.strength, 2);
    const base = guidedFilterGray(log, log, w, h, r, eps);
    progress?.report?.(0.6);
    checkCancelled(progress);
    const hi = percentile(base, 0.995),
      lo = percentile(base, 0.005);
    // Fit the base range into about seven stops, then apply gamma (lower
    // values increase contrast) and the detail boost.
    const c = Math.min(1, 7 / Math.max(1e-3, hi - lo)) / Math.max(0.05, p.gamma);
    const d = 1 + p.detail / 100;
    const white = Math.log2(0.9);
    for (let i = 0; i < n; i++) lum[i] = Math.pow(2, (base[i] - hi) * c + (log[i] - base[i]) * d + white) * ev;
  } else if (p.method === 'exposure-gamma') {
    for (let i = 0; i < n; i++) lum[i] = Math.pow(Math.max(0, L[i] * ev), 1 / Math.max(0.05, p.gamma));
  } else if (p.method === 'highlight-compression') {
    let max = 0;
    for (let i = 0; i < n; i++) max = Math.max(max, L[i] * ev);
    const w2 = Math.max(1, max) ** 2;
    for (let i = 0; i < n; i++) {
      const x = L[i] * ev;
      lum[i] = (x * (1 + x / w2)) / (1 + x);
    }
  } else {
    // Equalize: luminance follows the cumulative histogram of its logarithm.
    const log = new Float32Array(n);
    for (let i = 0; i < n; i++) log[i] = Math.log2(L[i] * ev + 1e-5);
    const lo = percentile(log, 0),
      hi = percentile(log, 1);
    const bins = 1024,
      hist = new Float64Array(bins);
    for (let i = 0; i < n; i++) hist[Math.max(0, Math.min(bins - 1, Math.floor(((log[i] - lo) / Math.max(1e-6, hi - lo)) * (bins - 1))))]++;
    for (let b = 1; b < bins; b++) hist[b] += hist[b - 1];
    for (let i = 0; i < n; i++) {
      const b = Math.max(0, Math.min(bins - 1, Math.floor(((log[i] - lo) / Math.max(1e-6, hi - lo)) * (bins - 1))));
      lum[i] = srgbToLinear(hist[b] / n);
    }
  }
  progress?.report?.(0.8);
  const curve = toningCurveTable(p.curve);
  const sat = 1 + p.saturation / 100,
    vib = p.vibrance / 100;
  const sh = (0.9 * p.shadow) / 100,
    hl = (0.9 * p.highlight) / 100;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const k = L[i] > 1e-8 ? lum[i] / L[i] : 0;
    let r = linearToSrgb(Math.max(0, data[o] * k)),
      g = linearToSrgb(Math.max(0, data[o + 1] * k)),
      b = linearToSrgb(Math.max(0, data[o + 2] * k));
    if (L[i] <= 1e-8) r = g = b = linearToSrgb(Math.max(0, lum[i]));
    // Shadows and highlights: smooth lifts that stay monotone for |amount| <= 1.
    const tone = (v: number) => {
      const x = Math.max(0, Math.min(1, v));
      return x + sh * 1.5 * x * (1 - x) * (1 - x) + hl * 1.5 * x * x * (1 - x);
    };
    r = tone(r);
    g = tone(g);
    b = tone(b);
    // Vibrance boosts muted colors more than saturated ones; saturation is uniform.
    const y = LR * r + LG * g + LB * b;
    const s = Math.max(r, g, b) - Math.min(r, g, b);
    const f = sat * (1 + vib * (1 - Math.min(1, s * 1.5)));
    r = y + (r - y) * f;
    g = y + (g - y) * f;
    b = y + (b - y) * f;
    const code = (v: number) => {
      const x = Math.max(0, Math.min(255, v * 255));
      const j = Math.min(254, Math.floor(x));
      return curve[j] + (curve[j + 1] - curve[j]) * (x - j);
    };
    out[o] = code(r);
    out[o + 1] = code(g);
    out[o + 2] = code(b);
    out[o + 3] = Math.round(Math.max(0, Math.min(1, data[o + 3])) * 255);
  }
  progress?.report?.(1);
  return { width: w, height: h, data: out };
}

/** HDR Toning on an 8-bit image (its codes are decoded to linear light first). */
export function hdrToning(src: RGBA8, p: HdrToningParams, scale = 1, progress?: Progress): RGBA8 {
  const lin = new Float32Array(256);
  for (let z = 0; z < 256; z++) lin[z] = srgbToLinear(z / 255);
  const f = new Float32Array(src.data.length);
  for (let i = 0; i < f.length; i += 4) {
    f[i] = lin[src.data[i]];
    f[i + 1] = lin[src.data[i + 1]];
    f[i + 2] = lin[src.data[i + 2]];
    f[i + 3] = src.data[i + 3] / 255;
  }
  return toneMap({ width: src.width, height: src.height, data: f }, p, scale, progress);
}

const PARAMS: ParamSpec[] = [
  {
    key: 'method',
    label: 'Method',
    type: 'select',
    default: 'local',
    options: [
      { value: 'local', label: 'Local Adaptation' },
      { value: 'exposure-gamma', label: 'Exposure and Gamma' },
      { value: 'highlight-compression', label: 'Highlight Compression' },
      { value: 'equalize', label: 'Equalize Histogram' },
    ],
  },
  { key: 'radius', label: 'Glow Radius', type: 'number', min: 1, max: 500, default: DEFAULT_HDR_TONING.radius, unit: 'px' },
  { key: 'strength', label: 'Glow Strength', type: 'number', min: 0.1, max: 4, step: 0.05, default: DEFAULT_HDR_TONING.strength },
  { key: 'gamma', label: 'Gamma', type: 'number', min: 0.1, max: 2, step: 0.01, default: 1 },
  { key: 'exposure', label: 'Exposure', type: 'number', min: -5, max: 5, step: 0.05, default: 0, unit: 'EV' },
  { key: 'detail', label: 'Detail', type: 'number', min: -100, max: 300, default: DEFAULT_HDR_TONING.detail, unit: '%' },
  { key: 'shadow', label: 'Shadows', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
  { key: 'highlight', label: 'Highlights', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
  { key: 'vibrance', label: 'Vibrance', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
  { key: 'saturation', label: 'Saturation', type: 'number', min: -100, max: 100, default: DEFAULT_HDR_TONING.saturation, unit: '%' },
  {
    key: 'curve',
    label: 'Toning Curve',
    type: 'select',
    default: 'linear',
    options: Object.entries(TONING_CURVES).map(([value, c]) => ({ value, label: c.label })),
  },
];

/** Read sanitized parameters (missing values fall back to the defaults). */
export function toningParams(v: ParamValues): HdrToningParams {
  const p = { ...DEFAULT_HDR_TONING } as Record<string, unknown>;
  for (const spec of PARAMS) {
    const x = v[spec.key];
    if (spec.type === 'number' && typeof x === 'number' && Number.isFinite(x)) p[spec.key] = Math.max(spec.min, Math.min(spec.max, x));
    if (spec.type === 'select' && typeof x === 'string' && (spec.options.some((o) => o.value === x) || spec.key === 'curve')) p[spec.key] = x;
  }
  // A custom curve (JSON points) overrides the preset.
  if (typeof v.curvePoints === 'string' && v.curvePoints) p.curve = v.curvePoints;
  return p as HdrToningParams;
}

export const hdrToningOperation: ImageOperation = {
  id: 'adjust.hdr-toning',
  label: 'HDR Toning',
  category: 'Adjustments',
  params: PARAMS,
  apply(src, values, ctx, progress) {
    const out = hdrToning(src, toningParams(values), ctx.scale ?? 1, progress);
    if (!ctx.selection) return out;
    const s = ctx.selection.data;
    for (let i = 0; i < s.length; i++) {
      const k = s[i] / 255;
      if (k >= 1) continue;
      for (let c = 0; c < 4; c++) out.data[i * 4 + c] = src.data[i * 4 + c] + (out.data[i * 4 + c] - src.data[i * 4 + c]) * k;
    }
    return out;
  },
};
