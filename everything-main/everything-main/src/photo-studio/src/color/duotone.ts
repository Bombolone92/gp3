// Monotone, duotone, tritone and quadtone: one gray channel printed with up
// to four inks, each through its own monotone transfer curve. The preview
// overprints inks multiplicatively in the document's encoded RGB, so a single
// black ink with a straight curve reproduces the grayscale image exactly.
import type { RGBA8 } from '../imaging/types';

export type DuotoneInk = {
  name: string;
  // Ink color as 0-255 document RGB.
  color: [number, number, number];
  // Transfer curve points [input tone %, ink %], 0 = paper; straight if omitted.
  curve?: [number, number][];
};
export type DuotoneResult = {
  width: number;
  height: number;
  // The single channel: 0 = black (full tone), 255 = paper.
  gray: Uint8Array;
  alpha: Uint8Array;
  inks: DuotoneInk[];
};

// Monotone cubic interpolation (Fritsch & Carlson 1980) through curve points,
// sampled to a 256-entry table mapping tone 0..1 to ink 0..1.
export function curveTable(points: [number, number][] | undefined, size = 256): Float32Array {
  const pts = (points?.length ? [...points] : [[0, 0], [100, 100]] as [number, number][])
    .map(([x, y]) => [Math.max(0, Math.min(100, x)) / 100, Math.max(0, Math.min(100, y)) / 100])
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, a) => i === 0 || p[0] > a[i - 1][0]);
  if (pts[0][0] > 0) pts.unshift([0, pts[0][1]]);
  if (pts[pts.length - 1][0] < 1) pts.push([1, pts[pts.length - 1][1]]);
  const n = pts.length;
  const out = new Float32Array(size);
  if (n === 1) return out.fill(pts[0][1]);
  const dx: number[] = [],
    dy: number[] = [],
    m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    dy.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  m.push(dy[0]);
  for (let i = 1; i < n - 1; i++) m.push(dy[i - 1] * dy[i] <= 0 ? 0 : (dy[i - 1] + dy[i]) / 2);
  m.push(dy[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (dy[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / dy[i],
      b = m[i + 1] / dy[i],
      s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * dy[i];
      m[i + 1] = t * b * dy[i];
    }
  }
  let seg = 0;
  for (let k = 0; k < size; k++) {
    const x = k / (size - 1);
    while (seg < n - 2 && x > pts[seg + 1][0]) seg++;
    const h = dx[seg],
      t = (x - pts[seg][0]) / h;
    const t2 = t * t,
      t3 = t2 * t;
    const y =
      (2 * t3 - 3 * t2 + 1) * pts[seg][1] +
      (t3 - 2 * t2 + t) * h * m[seg] +
      (-2 * t3 + 3 * t2) * pts[seg + 1][1] +
      (t3 - t2) * h * m[seg + 1];
    out[k] = Math.max(0, Math.min(1, y));
  }
  return out;
}

// RGB of every gray level: tone t = 1 - gray/255 drives each ink's coverage.
export function duotoneTable(inks: DuotoneInk[]): Uint8Array {
  const table = new Uint8Array(256 * 3);
  const curves = inks.map((ink) => curveTable(ink.curve));
  for (let g = 0; g < 256; g++) {
    const tone = 255 - g;
    for (let c = 0; c < 3; c++) {
      let v = 1;
      inks.forEach((ink, i) => {
        v *= 1 - curves[i][tone] * (1 - ink.color[c] / 255);
      });
      table[g * 3 + c] = Math.round(v * 255);
    }
  }
  return table;
}

export function duotoneToRGBA(d: DuotoneResult): RGBA8 {
  const t = duotoneTable(d.inks);
  const px = d.width * d.height;
  const data = new Uint8ClampedArray(px * 4);
  for (let p = 0; p < px; p++) {
    const g = d.gray[p];
    data[p * 4] = t[g * 3];
    data[p * 4 + 1] = t[g * 3 + 1];
    data[p * 4 + 2] = t[g * 3 + 2];
    data[p * 4 + 3] = d.alpha[p];
  }
  return { width: d.width, height: d.height, data };
}
