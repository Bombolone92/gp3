import { describe, expect, it } from 'vitest';
import { autoFocusRange, focusAreaMask, sharpnessMap } from '../src/imaging/segment/focus-area';
import { gaussianBlurF32 } from '../src/imaging/segment/filters';
import type { RGBA8 } from '../src/imaging/types';

// Left half: crisp checkerboard. Right half: the same pattern, defocused.
function scene(w = 120, h = 80): RGBA8 {
  const plane = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) plane[y * w + x] = ((x >> 2) + (y >> 2)) & 1 ? 220 : 30;
  const blurred = gaussianBlurF32(Float32Array.from(plane), w, h, 4);
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = x < w / 2 ? plane[y * w + x] : blurred[y * w + x];
      d.set([v, v, v, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data: d };
}
const coverage = (m: { width: number; data: Uint8Array }, x0: number, x1: number) => {
  let s = 0, n = 0;
  for (let i = 0; i < m.data.length; i++) {
    const x = i % m.width;
    if (x >= x0 && x < x1) {
      s += m.data[i];
      n++;
    }
  }
  return s / n / 255;
};

describe('focus area', () => {
  it('sharpness is higher on the crisp half', () => {
    const img = scene(), s = sharpnessMap(img, 0);
    expect(coverage({ width: 120, data: Uint8Array.from(s, (v) => v * 255) }, 5, 50)).toBeGreaterThan(0.5);
    expect(coverage({ width: 120, data: Uint8Array.from(s, (v) => v * 255) }, 75, 115)).toBeLessThan(0.1);
  });

  it('selects the in-focus half', () => {
    const img = scene();
    const range = autoFocusRange(img);
    expect(range).toBeGreaterThanOrEqual(0);
    expect(range).toBeLessThanOrEqual(100);
    for (const soften of [false, true]) {
      const m = focusAreaMask(img, { range, noise: 0, softenEdges: soften });
      expect(coverage(m, 5, 50)).toBeGreaterThan(0.9);
      expect(coverage(m, 75, 115)).toBeLessThan(0.1);
    }
  });

  it('a smaller range selects less, and a flat image selects nothing', () => {
    const img = scene();
    const tight = focusAreaMask(img, { range: 0, noise: 0 }), wide = focusAreaMask(img, { range: 100, noise: 0 });
    expect(coverage(tight, 0, 120)).toBeLessThanOrEqual(coverage(wide, 0, 120));
    const flat: RGBA8 = { width: 30, height: 20, data: new Uint8ClampedArray(30 * 20 * 4).fill(128) };
    expect(focusAreaMask(flat, { range: 50, noise: 0 }).data.every((v) => v === 0)).toBe(true);
  });
});
