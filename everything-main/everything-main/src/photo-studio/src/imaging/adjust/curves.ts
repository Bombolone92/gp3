// Tone curves: monotone cubic interpolation for Curves control points and the
// Levels transfer function. Every builder returns a float map [0, 1] -> [0, 1]
// so the exact 8-bit path and the compiled 4096-entry tables share one source.
import type { CurveChannel, LevelsChannel } from './model';

export type Fn1 = (x: number) => number;

// Monotone piecewise cubic Hermite interpolation (Fritsch & Carlson, "Monotone
// Piecewise Cubic Interpolation", SIAM J. Numer. Anal. 17(2), 1980). Monotone
// data never overshoots; at local extrema the tangent is zero. Outside the
// first/last point the curve is flat, which is how endpoint dragging clips.
export function monotoneSpline(points: readonly (readonly [number, number])[]): Fn1 {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const xs: number[] = [],
    ys: number[] = [];
  for (const [x, y] of sorted) {
    if (xs.length && x - xs[xs.length - 1] < 1e-9) ys[ys.length - 1] = y;
    else xs.push(x), ys.push(y);
  }
  const n = xs.length;
  if (n === 0) return (x) => x;
  if (n === 1) return () => ys[0];
  const d = new Float64Array(n - 1),
    m = new Float64Array(n);
  for (let k = 0; k < n - 1; k++) d[k] = (ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) {
      m[k] = m[k + 1] = 0;
      continue;
    }
    const a = m[k] / d[k],
      b = m[k + 1] / d[k],
      s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[k] = t * a * d[k];
      m[k + 1] = t * b * d[k];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0,
      hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const h = xs[hi] - xs[lo],
      t = (x - xs[lo]) / h,
      t2 = t * t,
      t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo] + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * m[hi]
    );
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function isIdentityCurve(c: CurveChannel): boolean {
  if (c.mode === 'pencil' && c.values?.length === 256) return c.values.every((v, i) => Math.abs(v - i) < 1e-6);
  const p = c.points;
  return p.length >= 2 && p.every(([x, y]) => Math.abs(x - y) < 1e-6) && Math.min(...p.map((q) => q[0])) <= 0 && Math.max(...p.map((q) => q[0])) >= 255;
}

// Float map for one curve channel (codes in 0..255 inside the model).
export function curveFunction(c: CurveChannel): Fn1 {
  if (c.mode === 'pencil' && c.values && c.values.length === 256) {
    const v = Float64Array.from(c.values, (y) => clamp01(y / 255));
    return (x) => {
      const p = clamp01(x) * 255,
        i = Math.min(254, p | 0);
      return v[i] + (v[i + 1] - v[i]) * (p - i);
    };
  }
  const spline = monotoneSpline(c.points.length ? c.points : [[0, 0], [255, 255]]);
  return (x) => clamp01(spline(x * 255) / 255);
}

// Samples a curve into 256 output codes (pencil values, histogram overlays).
export function curveToValues(c: CurveChannel): number[] {
  const f = curveFunction(c);
  return Array.from({ length: 256 }, (_, i) => f(i / 255) * 255);
}

// Box-smooths free-form pencil values, keeping the two endpoints.
export function smoothCurveValues(values: readonly number[], passes = 1): number[] {
  let v = [...values];
  for (let p = 0; p < passes; p++) {
    const next = [...v];
    for (let i = 1; i < v.length - 1; i++) {
      const lo = Math.max(0, i - 2),
        hi = Math.min(v.length - 1, i + 2);
      let s = 0;
      for (let j = lo; j <= hi; j++) s += v[j];
      next[i] = s / (hi - lo + 1);
    }
    v = next;
  }
  return v;
}

export function isIdentityLevels(l: LevelsChannel): boolean {
  return l.inBlack === 0 && l.inWhite === 255 && l.gamma === 1 && l.outBlack === 0 && l.outWhite === 255;
}

// Input range -> gamma -> output range, all limits in 0..255 codes.
export function levelsFunction(l: LevelsChannel): Fn1 {
  const inB = l.inBlack / 255,
    inSpan = Math.max(1e-6, (l.inWhite - l.inBlack) / 255);
  const outB = l.outBlack / 255,
    outSpan = (l.outWhite - l.outBlack) / 255;
  const invGamma = 1 / Math.min(9.99, Math.max(0.01, l.gamma || 1));
  return (x) => {
    let t = (x - inB) / inSpan;
    t = t <= 0 ? 0 : t >= 1 ? 1 : invGamma === 1 ? t : Math.pow(t, invGamma);
    return clamp01(outB + t * outSpan);
  };
}

// Schlick's gain: a symmetric S-curve through (0.5, 0.5); g = 0.5 is identity,
// larger g increases contrast. ("Fast alternatives to Perlin's bias and gain".)
export function gain(x: number, g: number): number {
  const bias = (t: number, a: number) => t / ((1 / a - 2) * (1 - t) + 1);
  return x < 0.5 ? bias(2 * x, 1 - g) / 2 : 1 - bias(2 - 2 * x, 1 - g) / 2;
}
