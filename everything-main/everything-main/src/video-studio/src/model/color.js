/**
 * Color grading model: the slider groups of the Color tab, the optional
 * clip.grade object (section bypass, LUT, HSL ranges, curves, color wheels),
 * keyframed adjust values, curve interpolation and the numbers the
 * compositor uploads. Pure functions, no DOM.
 *
 * clip.grade = {
 *   off:    { color?, light?, detail?, lut?, hsl?, curves?, wheels? }  true = bypassed
 *   lut:    { id, name, intensity 0..100 } | null
 *   hsl:    { [range]: { h, s, l } }               each -100..100
 *   curves: { master?, red?, green?, blue?: [[x, y], ...] }   0..1, sorted by x
 *   wheels: { intensity 0..100, shadows, midtones, highlights, offset: { x, y, l } }
 * }
 * Every part is optional; a missing grade (or part) means "neutral".
 */
import { valueAt } from './keyframes.js';

/** Basic sliders, grouped. min defaults to -100, max to 100. */
export const ADJUST_SECTIONS = [
  {
    id: 'color',
    title: 'Color',
    keys: [
      { key: 'temperature', label: 'Temperature', track: 'temp' },
      { key: 'tint', label: 'Tint', track: 'tint' },
      { key: 'saturation', label: 'Saturation', track: 'sat' },
      { key: 'vibrance', label: 'Vibrance', track: 'sat' },
    ],
  },
  {
    id: 'light',
    title: 'Light',
    keys: [
      { key: 'exposure', label: 'Exposure' },
      { key: 'brightness', label: 'Brightness' },
      { key: 'contrast', label: 'Contrast' },
      { key: 'highlights', label: 'Highlights' },
      { key: 'shadows', label: 'Shadows' },
      { key: 'whites', label: 'Whites' },
      { key: 'blacks', label: 'Blacks' },
      { key: 'brilliance', label: 'Brilliance' },
    ],
  },
  {
    id: 'detail',
    title: 'Detail and finish',
    keys: [
      { key: 'sharpen', label: 'Sharpen', min: 0 },
      { key: 'clarity', label: 'Clarity' },
      { key: 'grain', label: 'Grain', min: 0 },
      { key: 'fade', label: 'Fade' },
      { key: 'vignette', label: 'Vignette' },
    ],
  },
];

/** Adjust key -> section id. */
export const SECTION_OF = Object.fromEntries(ADJUST_SECTIONS.flatMap((s) => s.keys.map((k) => [k.key, s.id])));

export const ADJUST_PREFIX = 'adjust.';
export const adjustProp = (key) => `${ADJUST_PREFIX}${key}`;

/** Hue ranges for HSL, centers in degrees. */
export const HSL_RANGES = [
  { id: 'red', label: 'Reds', hue: 0, swatch: '#e5484d' },
  { id: 'orange', label: 'Oranges', hue: 30, swatch: '#f08c2e' },
  { id: 'yellow', label: 'Yellows', hue: 60, swatch: '#f2d43d' },
  { id: 'green', label: 'Greens', hue: 120, swatch: '#46b35a' },
  { id: 'aqua', label: 'Aquas', hue: 180, swatch: '#3cc4c9' },
  { id: 'blue', label: 'Blues', hue: 220, swatch: '#3f73e0' },
  { id: 'purple', label: 'Purples', hue: 270, swatch: '#8a52d9' },
  { id: 'magenta', label: 'Magentas', hue: 310, swatch: '#d64bb8' },
];

export const CURVE_CHANNELS = [
  { id: 'master', label: 'Luma', color: '#e8e8ea' },
  { id: 'red', label: 'Red', color: '#ef5350' },
  { id: 'green', label: 'Green', color: '#4caf50' },
  { id: 'blue', label: 'Blue', color: '#4f8ff7' },
];

export const WHEELS = [
  { id: 'shadows', label: 'Shadows', hint: 'Lift' },
  { id: 'midtones', label: 'Midtones', hint: 'Gamma' },
  { id: 'highlights', label: 'Highlights', hint: 'Gain' },
  { id: 'offset', label: 'Offset', hint: 'All tones' },
];

export const GRADE_SECTIONS = ['color', 'light', 'detail', 'lut', 'hsl', 'curves', 'wheels'];

const IDENTITY = [[0, 0], [1, 1]];
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clampN = (v, lo, hi, d = 0) => clamp(num(v, d), lo, hi);

export const neutralWheel = () => ({ x: 0, y: 0, l: 0 });

/** A complete, neutral grade object (what the editor creates on first edit). */
export function emptyGrade() {
  return {
    off: {},
    lut: null,
    hsl: {},
    curves: {},
    wheels: { intensity: 100, shadows: neutralWheel(), midtones: neutralWheel(), highlights: neutralWheel(), offset: neutralWheel() },
  };
}

/** Fill the missing parts of clip.grade in place and return it (for editing). */
export function ensureGrade(clip) {
  const g = (clip.grade && typeof clip.grade === 'object') ? clip.grade : (clip.grade = emptyGrade());
  const d = emptyGrade();
  g.off ||= d.off;
  if (g.lut === undefined) g.lut = null;
  g.hsl ||= d.hsl;
  g.curves ||= d.curves;
  g.wheels ||= d.wheels;
  for (const w of WHEELS) g.wheels[w.id] ||= neutralWheel();
  if (!Number.isFinite(g.wheels.intensity)) g.wheels.intensity = 100;
  return g;
}

export function isIdentityCurve(points) {
  if (!Array.isArray(points) || points.length < 2) return true;
  return points.every(([x, y]) => Math.abs(x - y) < 1e-4);
}

export function normalizeCurve(raw) {
  if (!Array.isArray(raw)) return null;
  const pts = raw
    .filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
    .map((p) => [clamp(Number(p[0]), 0, 1), clamp(Number(p[1]), 0, 1)])
    .sort((a, b) => a[0] - b[0])
    .slice(0, 32);
  // Points closer than a hair in x would make the slope blow up.
  const out = [];
  for (const p of pts) if (!out.length || p[0] - out[out.length - 1][0] > 1e-3) out.push(p);
  return out.length >= 2 ? out : null;
}

function normWheel(w) {
  const x = clampN(w?.x, -1, 1);
  const y = clampN(w?.y, -1, 1);
  const m = Math.hypot(x, y);
  return { x: m > 1 ? x / m : x, y: m > 1 ? y / m : y, l: clampN(w?.l, -100, 100) };
}

/**
 * Validate untrusted grade JSON. Returns a compact object with only the
 * parts that do something, or null when the grade is entirely neutral.
 */
export function normalizeGrade(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  const off = {};
  for (const s of GRADE_SECTIONS) if (raw.off?.[s] === true) off[s] = true;
  if (Object.keys(off).length) out.off = off;
  const lut = raw.lut;
  if (lut && typeof lut === 'object' && typeof lut.id === 'string' && /^[a-z0-9_-]{1,128}$/i.test(lut.id)) {
    out.lut = { id: lut.id, name: String(lut.name ?? 'LUT').slice(0, 120), intensity: clampN(lut.intensity, 0, 100, 100) };
  }
  const hsl = {};
  for (const r of HSL_RANGES) {
    const v = raw.hsl?.[r.id];
    if (!v || typeof v !== 'object') continue;
    const e = { h: clampN(v.h, -100, 100), s: clampN(v.s, -100, 100), l: clampN(v.l, -100, 100) };
    if (e.h || e.s || e.l) hsl[r.id] = e;
  }
  if (Object.keys(hsl).length) out.hsl = hsl;
  const curves = {};
  for (const c of CURVE_CHANNELS) {
    const pts = normalizeCurve(raw.curves?.[c.id]);
    if (pts && !isIdentityCurve(pts)) curves[c.id] = pts;
  }
  if (Object.keys(curves).length) out.curves = curves;
  if (raw.wheels && typeof raw.wheels === 'object') {
    const w = { intensity: clampN(raw.wheels.intensity, 0, 100, 100) };
    let any = false;
    for (const { id } of WHEELS) {
      w[id] = normWheel(raw.wheels[id]);
      if (w[id].x || w[id].y || w[id].l) any = true;
    }
    if (any) out.wheels = w;
  }
  return Object.keys(out).length ? out : null;
}

/** Adjust values with keyframes applied at clip-local time (the same object when nothing is keyed). */
export function keyedAdjust(clip, local) {
  const a = clip.adjust;
  const k = clip.keyframes;
  if (!a || !k) return a;
  let out = null;
  for (const prop in k) {
    if (!prop.startsWith(ADJUST_PREFIX) || !k[prop]?.length) continue;
    const key = prop.slice(ADJUST_PREFIX.length);
    if (!(key in a)) continue;
    out ||= { ...a };
    out[key] = valueAt(k, prop, local, a[key]);
  }
  return out || a;
}

/* Curves ------------------------------------------------------------------------ */

/**
 * Monotone cubic (Fritsch-Carlson) interpolation through points sorted by x.
 * Returns f(x) with flat extension outside the first and last point.
 */
export function monotoneCurve(points) {
  const pts = points && points.length >= 2 ? points : IDENTITY;
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d = [];
  const m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const hgt = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / hgt;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hgt * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hgt * m[i + 1];
  };
}

/** n samples of a curve over 0..1. */
export function sampleCurve(points, n = 256) {
  const f = monotoneCurve(points);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = clamp(f(i / (n - 1)), 0, 1);
  return out;
}

/** 256 x 1 RGBA table: master, red, green, blue lookups. */
export function bakeCurves(curves, n = 256) {
  const out = new Float32Array(n * 4);
  CURVE_CHANNELS.forEach((c, ch) => {
    const s = sampleCurve(curves?.[c.id] || IDENTITY, n);
    for (let i = 0; i < n; i++) out[i * 4 + ch] = s[i];
  });
  return out;
}

/* Colors -------------------------------------------------------------------------- */

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function hsvToRgb(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

export function rgbToHsv(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx > 0 ? d / mx : 0, mx];
}

/** The HSL range whose hue center is closest to the color (r, g, b in 0..1). */
export function nearestHslRange(r, g, b) {
  const [h] = rgbToHsv(r, g, b);
  let best = HSL_RANGES[0];
  let bestD = Infinity;
  for (const range of HSL_RANGES) {
    const d = Math.min(Math.abs(h - range.hue), 360 - Math.abs(h - range.hue));
    if (d < bestD) {
      best = range;
      bestD = d;
    }
  }
  return best.id;
}

/** Hue angle (degrees) of a wheel puck; 0 points right, counterclockwise. */
export const wheelHue = (w) => ((Math.atan2(w.y, w.x) * 180) / Math.PI + 360) % 360;

/** Zero-luma color direction for a wheel position, scaled by its distance from the center. */
export function wheelChroma(w) {
  const m = Math.min(1, Math.hypot(w.x, w.y));
  if (m < 1e-6) return [0, 0, 0];
  const [r, g, b] = hsvToRgb(wheelHue(w), 1, 1);
  const l = luma(r, g, b);
  return [(r - l) * m, (g - l) * m, (b - l) * m];
}

/** How strongly each wheel moves color and light (chroma, luminance). */
const WHEEL_SCALE = { shadows: [0.3, 0.25], midtones: [0.45, 0.4], highlights: [0.5, 0.5], offset: [0.2, 0.15] };

/** Per-channel amounts for one wheel (what the shader adds), already scaled by intensity. */
export function wheelVector(id, w, intensity = 100) {
  if (!w) return [0, 0, 0];
  const [cs, ls] = WHEEL_SCALE[id];
  const k = intensity / 100;
  const c = wheelChroma(w);
  const l = ((w.l || 0) / 100) * ls;
  return c.map((v) => (v * cs + l) * k);
}

/* Shader parameters -------------------------------------------------------------- */

const HSL_SCALE = [30, 0.01, 0.006]; // hue degrees, saturation factor, value factor per slider unit

/**
 * Pack the grade parts the shader needs. Returns null when nothing beyond
 * the basic sliders is active, so ordinary clips skip all of it.
 *   hsl: Float32Array(24) or null; wheels: { lift, gamma, gain, offset } or null;
 *   curves: the curve object (baked by the compositor, cached by curvesKey) or null;
 *   lut: { id, mix } or null
 */
export function packGrade(grade) {
  if (!grade) return null;
  const off = grade.off || {};
  const out = { hsl: null, wheels: null, curves: null, curvesKey: '', lut: null };
  if (!off.hsl && grade.hsl) {
    const arr = new Float32Array(24);
    let any = false;
    HSL_RANGES.forEach((r, i) => {
      const e = grade.hsl[r.id];
      if (!e) return;
      arr[i * 3] = (e.h || 0) / 100 * HSL_SCALE[0];
      arr[i * 3 + 1] = (e.s || 0) * HSL_SCALE[1];
      arr[i * 3 + 2] = (e.l || 0) * HSL_SCALE[2];
      if (e.h || e.s || e.l) any = true;
    });
    if (any) out.hsl = arr;
  }
  if (!off.wheels && grade.wheels && grade.wheels.intensity > 0) {
    const w = grade.wheels;
    const v = {
      lift: wheelVector('shadows', w.shadows, w.intensity),
      gamma: wheelVector('midtones', w.midtones, w.intensity),
      gain: wheelVector('highlights', w.highlights, w.intensity),
      offset: wheelVector('offset', w.offset, w.intensity),
    };
    if (Object.values(v).some((a) => a.some((x) => Math.abs(x) > 1e-6))) out.wheels = v;
  }
  if (!off.curves && grade.curves) {
    const live = {};
    for (const c of CURVE_CHANNELS) {
      const pts = grade.curves[c.id];
      if (pts && !isIdentityCurve(pts)) live[c.id] = pts;
    }
    if (Object.keys(live).length) {
      out.curves = live;
      out.curvesKey = JSON.stringify(live);
    }
  }
  if (!off.lut && grade.lut?.id && (grade.lut.intensity ?? 100) > 0) out.lut = { id: grade.lut.id, mix: (grade.lut.intensity ?? 100) / 100 };
  return out.hsl || out.wheels || out.curves || out.lut ? out : null;
}

/** Adjust values with bypassed sections zeroed (what actually renders). */
export function effectiveAdjust(adjust, grade) {
  const off = grade?.off;
  if (!adjust || !off || !(off.color || off.light || off.detail)) return adjust;
  const out = { ...adjust };
  for (const k of Object.keys(out)) if (off[SECTION_OF[k]]) out[k] = 0;
  return out;
}

/* Auto adjust ------------------------------------------------------------------ */

/**
 * Statistics of an RGBA8 pixel buffer (optionally a sub-rectangle), sampling
 * about `samples` pixels: luma percentiles, mean luma and the mean color of
 * the mid-tones (for white balance).
 */
export function pixelStats(data, width, height, { rect = null, samples = 40000 } = {}) {
  const x0 = Math.max(0, Math.floor(rect?.x ?? 0));
  const y0 = Math.max(0, Math.floor(rect?.y ?? 0));
  const x1 = Math.min(width, Math.ceil(rect ? rect.x + rect.w : width));
  const y1 = Math.min(height, Math.ceil(rect ? rect.y + rect.h : height));
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  const step = Math.max(1, Math.floor(Math.sqrt(area / samples)));
  const hist = new Uint32Array(256);
  let n = 0;
  let sum = 0;
  let mr = 0;
  let mg = 0;
  let mb = 0;
  let mn = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const l = luma(r, g, b);
      hist[Math.min(255, Math.round(l * 255))]++;
      sum += l;
      n++;
      if (l > 0.15 && l < 0.85) {
        mr += r;
        mg += g;
        mb += b;
        mn++;
      }
    }
  }
  const pct = (p) => {
    const target = p * n;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i / 255;
    }
    return 1;
  };
  return {
    count: n,
    mean: n ? sum / n : 0,
    low: pct(0.005),
    high: pct(0.995),
    median: pct(0.5),
    rgb: mn ? [mr / mn, mg / mn, mb / mn] : null,
  };
}

const round = (v) => Math.round(v);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Corrected values from frame statistics: exposure toward a mid-grey
 * median, black and white points toward the ends of the range, a little
 * contrast for flat images and a gray-world white balance. Returns a patch
 * for clip.adjust.
 */
export function autoAdjustValues(stats) {
  if (!stats || stats.count < 16) return null;
  const patch = { exposure: 0, contrast: 0, whites: 0, blacks: 0, temperature: 0, tint: 0 };
  // Exposure multiplies by 2^(exposure * 0.015) in the shader.
  const median = Math.max(0.02, stats.median);
  const gain = clamp(0.46 / median, 0.5, 2.6);
  patch.exposure = round(clamp(Math.log2(gain) / 0.015, -60, 60) * 0.8);
  const k = 2 ** (patch.exposure * 0.015);
  const low = stats.low * k;
  const high = Math.min(1.2, stats.high * k);
  // Per-unit effect of the Whites and Blacks sliders at a luma (as in the shader).
  const whiteGain = (l) => 0.0035 * Math.max(0.15, smoothstep(0.5, 1.05, l));
  const blackGain = (l) => 0.003 * Math.max(0.15, 1 - smoothstep(-0.05, 0.4, l));
  if (low > 0.03) patch.blacks = round(clamp(-(low - 0.02) / blackGain(low), -50, 0));
  if (high < 0.94) patch.whites = round(clamp((0.97 - high) / whiteGain(high), 0, 50));
  else if (high > 1.02) patch.whites = round(clamp(-(high - 0.98) / whiteGain(high), -40, 0));
  const spread = Math.max(0.05, high - low);
  if (spread < 0.75) patch.contrast = round(clamp((0.8 / spread - 1) * 30, 0, 30));
  if (stats.rgb) {
    const [r, g, b] = stats.rgb;
    // Temperature adds 0.0011 per unit to red and removes it from blue.
    patch.temperature = round(clamp(((b - r) / 0.0022) * 0.5, -30, 30));
    // Tint removes 0.0009 per unit from green and adds 0.0003 to red and blue.
    patch.tint = round(clamp(((g - (r + b) / 2) / 0.0012) * 0.6, -30, 30));
  }
  return patch;
}
