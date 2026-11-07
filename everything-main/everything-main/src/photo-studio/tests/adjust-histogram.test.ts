import { describe, expect, it } from 'vitest';
import { applyAdjustment, autoLevels, clipRange, equalize, equalizeMap, histogram, histograms, luma8, percentile, stats } from '../src/imaging/adjust';
import { mask8, rgba8 } from '../src/imaging/types';
import { randomImage, rng } from './adjust-fixtures';

function bruteStats(samples: number[]) {
  const n = samples.length;
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const sorted = [...samples].sort((a, b) => a - b);
  return { mean, sd, median: sorted[Math.ceil(n / 2) - 1], n };
}

describe('histogram', () => {
  it('counts channels and luminosity and matches brute-force statistics', () => {
    const img = randomImage(37, 23, 5, true);
    const sel = mask8(37, 23);
    const r = rng(2);
    for (let i = 0; i < sel.data.length; i++) sel.data[i] = r() * 256;
    for (const selection of [undefined, sel]) {
      const h = histograms(img, selection);
      const samples: Record<string, number[]> = { r: [], g: [], b: [], luminosity: [] };
      for (let p = 0; p < 37 * 23; p++) {
        const i = p * 4;
        if (img.data[i + 3] === 0 || (selection && selection.data[p] < 128)) continue;
        samples.r.push(img.data[i]);
        samples.g.push(img.data[i + 1]);
        samples.b.push(img.data[i + 2]);
        samples.luminosity.push(luma8(img.data[i], img.data[i + 1], img.data[i + 2]));
      }
      for (const k of ['r', 'g', 'b', 'luminosity'] as const) {
        const s = stats(h[k]),
          b = bruteStats(samples[k]);
        expect(s.pixels).toBe(b.n);
        expect(s.mean).toBeCloseTo(b.mean, 9);
        expect(s.stdDev).toBeCloseTo(b.sd, 9);
        expect(s.median).toBe(b.median);
        expect(histogram(img, k, selection)).toEqual(h[k]);
      }
      expect(stats(h.rgb, 3).pixels).toBe(samples.r.length);
      expect(histogram(img, 'rgb', selection)[100]).toBe(h.r[100] + h.g[100] + h.b[100]);
    }
  });

  it('skips fully transparent pixels and handles empty input', () => {
    const img = rgba8(4, 1, [200, 200, 200, 0]);
    img.data.set([10, 20, 30, 1], 0);
    const h = histogram(img, 'r');
    expect(h[10]).toBe(1);
    expect(h[200]).toBe(0);
    expect(stats(new Uint32Array(256))).toEqual({ mean: 0, stdDev: 0, median: 0, pixels: 0 });
  });

  it('percentile and clip range', () => {
    const h = new Uint32Array(256);
    h[10] = 1;
    h[20] = 98;
    h[250] = 1;
    expect(percentile(h, 20)).toBeCloseTo(0.99, 9);
    expect(clipRange(h, 0, 0)).toEqual([10, 250]);
    expect(clipRange(h, 1, 1)).toEqual([20, 20]);
  });
});

describe('auto corrections', () => {
  // A low-contrast image with a blue cast.
  function castImage() {
    const img = rgba8(64, 64);
    const r = rng(4);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 60 + r() * 100;
      img.data.set([v * 0.9, v, v * 1.15 + 20, 255], i);
    }
    return img;
  }

  it('auto contrast uses one black/white point for all channels', () => {
    const p = autoLevels(castImage(), 'contrast', { shadowClip: 0, highlightClip: 0 });
    expect(p.rgb.inBlack).toBe(54);
    expect(p.rgb.inWhite).toBeGreaterThan(190);
    expect(p.r.inBlack).toBe(0);
  });

  it('auto tone stretches each channel to the full range', () => {
    const img = castImage();
    const p = autoLevels(img, 'tone', { shadowClip: 0, highlightClip: 0 });
    const out = applyAdjustment(img, { kind: 'levels', params: p });
    const h = histograms(out);
    for (const k of ['r', 'g', 'b'] as const) {
      expect(h[k][0]).toBeGreaterThan(0);
      expect(h[k][255]).toBeGreaterThan(0);
    }
  });

  it('auto color also neutralizes the midtone cast', () => {
    const img = castImage();
    const tone = applyAdjustment(img, { kind: 'levels', params: autoLevels(img, 'tone') });
    const color = applyAdjustment(img, { kind: 'levels', params: autoLevels(img, 'color') });
    const cast = (im: typeof img) => {
      const h = histograms(im);
      const m = [stats(h.r).mean, stats(h.g).mean, stats(h.b).mean];
      return Math.max(...m) - Math.min(...m);
    };
    expect(cast(color)).toBeLessThanOrEqual(cast(tone) + 0.5);
    expect(cast(color)).toBeLessThan(cast(img));
  });

  it('flat images get identity levels', () => {
    const p = autoLevels(rgba8(3, 3, [90, 90, 90, 255]), 'tone');
    expect(p.r).toEqual({ inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 });
  });
});

describe('equalize', () => {
  it('spreads a narrow histogram over the full range', () => {
    const h = new Uint32Array(256);
    for (let v = 100; v < 110; v++) h[v] = 10;
    const map = equalizeMap(h);
    expect(map[100]).toBe(0);
    expect(map[109]).toBe(255);
    for (let v = 101; v < 110; v++) expect(map[v]).toBeGreaterThan(map[v - 1]);
  });

  it('is selection aware', () => {
    const img = rgba8(10, 1);
    for (let x = 0; x < 10; x++) img.data.set([x < 5 ? 100 + x : 200, x < 5 ? 100 + x : 200, x < 5 ? 100 + x : 200, 255], x * 4);
    const sel = mask8(10, 1);
    sel.data.fill(255, 0, 5);
    const inside = equalize(img, sel, 'selection');
    expect(inside.data[0]).toBe(0);
    expect(inside.data[4 * 4]).toBe(255);
    expect(inside.data[5 * 4]).toBe(200); // outside the selection: unchanged
    const entire = equalize(img, sel, 'entire');
    expect(entire.data[5 * 4]).toBe(255); // mapped with the selection's histogram
  });
});
