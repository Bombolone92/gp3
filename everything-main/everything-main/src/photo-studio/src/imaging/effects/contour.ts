// Contours are transfer curves (input falloff -> output strength) on [0, 1].
// Points are joined with monotone cubic Hermite segments (Fritsch & Carlson,
// 1980), so curves never overshoot; `corner` points join with straight
// tangents for crisp peaks.
export type ContourPoint = { x: number; y: number; corner?: boolean };
export type Contour = { name?: string; points: ContourPoint[] };

export const CONTOUR_LUT_SIZE = 1024;
const cache = new WeakMap<Contour, { aa: boolean; lut: Float32Array }>();

export function contourLut(contour: Contour | undefined, antiAliased = false): Float32Array {
  const c = contour ?? linearContour;
  const hit = cache.get(c);
  if (hit && hit.aa === antiAliased) return hit.lut;
  const n = CONTOUR_LUT_SIZE;
  const lut = new Float32Array(n);
  const pts = [...c.points].sort((a, b) => a.x - b.x);
  if (pts.length === 0) for (let i = 0; i < n; i++) lut[i] = i / (n - 1);
  else if (pts.length === 1) lut.fill(pts[0].y);
  else {
    const k = pts.length;
    const sec: number[] = [];
    for (let i = 0; i + 1 < k; i++) {
      const dx = pts[i + 1].x - pts[i].x;
      sec.push(dx > 0 ? (pts[i + 1].y - pts[i].y) / dx : 0);
    }
    // Tangents: one-sided at the ends and at corners (left and right differ).
    const left: number[] = [], right: number[] = [];
    for (let i = 0; i < k; i++) {
      if (i === 0) { left[i] = right[i] = sec[0]; continue; }
      if (i === k - 1) { left[i] = right[i] = sec[k - 2]; continue; }
      if (pts[i].corner) { left[i] = sec[i - 1]; right[i] = sec[i]; continue; }
      const a = sec[i - 1], b = sec[i];
      left[i] = right[i] = a * b <= 0 ? 0 : (a + b) / 2;
    }
    // Fritsch-Carlson limiter keeps each segment monotone.
    for (let i = 0; i + 1 < k; i++) {
      const s = sec[i];
      if (s === 0) { right[i] = 0; left[i + 1] = 0; continue; }
      const a = right[i] / s, b = left[i + 1] / s;
      const r = a * a + b * b;
      if (r > 9) {
        const t = 3 / Math.sqrt(r);
        right[i] = t * a * s;
        left[i + 1] = t * b * s;
      }
    }
    let seg = 0;
    for (let j = 0; j < n; j++) {
      const x = j / (n - 1);
      if (x <= pts[0].x) { lut[j] = pts[0].y; continue; }
      if (x >= pts[k - 1].x) { lut[j] = pts[k - 1].y; continue; }
      while (seg < k - 2 && x > pts[seg + 1].x) seg++;
      const p0 = pts[seg], p1 = pts[seg + 1], h = p1.x - p0.x;
      if (h <= 0) { lut[j] = p1.y; continue; }
      const t = (x - p0.x) / h, t2 = t * t, t3 = t2 * t;
      lut[j] =
        (2 * t3 - 3 * t2 + 1) * p0.y + (t3 - 2 * t2 + t) * h * right[seg] +
        (-2 * t3 + 3 * t2) * p1.y + (t3 - t2) * h * left[seg + 1];
    }
  }
  if (antiAliased) {
    // Light box filter over the table rounds corners and sawtooth edges.
    const r = 16, src = Float32Array.from(lut);
    for (let j = 0; j < n; j++) {
      let s = 0, c2 = 0;
      for (let d = -r; d <= r; d++) {
        const q = j + d;
        if (q >= 0 && q < n) { s += src[q]; c2++; }
      }
      lut[j] = s / c2;
    }
  }
  for (let j = 0; j < n; j++) lut[j] = Math.min(1, Math.max(0, lut[j]));
  cache.set(c, { aa: antiAliased, lut });
  return lut;
}
export function applyContour(lut: Float32Array, v: number): number {
  const i = v <= 0 ? 0 : v >= 1 ? CONTOUR_LUT_SIZE - 1 : v * (CONTOUR_LUT_SIZE - 1);
  const i0 = i | 0, f = i - i0;
  return i0 + 1 < CONTOUR_LUT_SIZE ? lut[i0] + (lut[i0 + 1] - lut[i0]) * f : lut[i0];
}
export const isLinearContour = (c: Contour | undefined) =>
  !c || (c.points.length === 2 && c.points[0].x === 0 && c.points[0].y === 0 && c.points[1].x === 1 && c.points[1].y === 1);

// Original contour presets for this project.
export const linearContour: Contour = { name: 'Linear', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
export const contourPresets: Contour[] = [
  linearContour,
  { name: 'Cone', points: [{ x: 0, y: 0 }, { x: 0.5, y: 1, corner: true }, { x: 1, y: 0 }] },
  { name: 'Soft Bell', points: [{ x: 0, y: 0 }, { x: 0.28, y: 0.07 }, { x: 0.5, y: 0.5 }, { x: 0.72, y: 0.93 }, { x: 1, y: 1 }] },
  { name: 'Ring', points: [{ x: 0, y: 0 }, { x: 0.3, y: 0.06 }, { x: 0.55, y: 1 }, { x: 0.8, y: 0.06 }, { x: 1, y: 0 }] },
  {
    name: 'Half Round',
    points: Array.from({ length: 9 }, (_, i) => {
      const x = i / 8;
      return { x, y: Math.sqrt(1 - (1 - x) * (1 - x)) };
    }),
  },
  { name: 'Rolling Slope', points: [{ x: 0, y: 0 }, { x: 0.22, y: 0.42 }, { x: 0.48, y: 0.38 }, { x: 0.74, y: 0.82 }, { x: 1, y: 1 }] },
  {
    name: 'Saw Teeth',
    points: [
      { x: 0, y: 0 }, { x: 0.32, y: 1, corner: true }, { x: 0.34, y: 0, corner: true },
      { x: 0.66, y: 1, corner: true }, { x: 0.68, y: 0, corner: true }, { x: 1, y: 1 },
    ],
  },
  { name: 'Cove', points: [{ x: 0, y: 0 }, { x: 0.45, y: 0.12 }, { x: 0.78, y: 0.45 }, { x: 1, y: 1 }] },
];
export function findContour(name: string): Contour | undefined {
  return contourPresets.find((c) => c.name === name);
}
