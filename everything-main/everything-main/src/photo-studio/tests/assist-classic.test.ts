import { describe, expect, it } from 'vitest';
import { mask8, rgba8, type RGBA8 } from '../src/imaging/types';
import { resize } from '../src/imaging/filters/resample';
import { enhancedUpscale, enhancedUpscaleMask } from '../src/imaging/filters/upscale';
import { detectObjects, objectLabels } from '../src/imaging/segment/objects';
import { labStats } from '../src/features/adjust/match-color';
import { DEFAULT_HARMONIZE, contextRect, harmonizeCube, harmonizeFunction, harmonizePixels } from '../src/features/assist/harmonize-math';
import { parseCubeLut, sampleCubeLut } from '../src/imaging/adjust';
import { gauss, gray, lcg, psnr } from './assist-fixtures';

// Supersampled rendering: a disc, a thin slanted line and slanted stripes.
function scene(w: number, h: number) {
  const img = rgba8(w, h), ss = 4;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / w, v = (y + (sy + 0.5) / ss) / h;
          let c = [200, 210, 220];
          if (Math.hypot(u - 0.35, v - 0.4) < 0.22) c = [180, 40, 40];
          if (Math.abs((u - 0.2) * 0.8 - (v - 0.7) * 0.6) < 0.015) c = [20, 20, 20];
          if (u > 0.6 && Math.sin((u * 3 + v) * 40) > 0) c = [40, 90, 200];
          for (let k = 0; k < 3; k++) acc[k] += c[k];
        }
      img.data.set([...acc.map((a) => a / (ss * ss)), 255], (y * w + x) * 4);
    }
  return img;
}
function boxDown(img: RGBA8, f: number) {
  const w = img.width / f, h = img.height / f, out = rgba8(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        let s = 0;
        for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += img.data[((y * f + dy) * img.width + x * f + dx) * 4 + c];
        out.data[(y * w + x) * 4 + c] = s / (f * f);
      }
  return out;
}

describe('Enhanced Upscale', () => {
  it('reconstructs edges better than bicubic and Lanczos at 2x and 4x', () => {
    const hi = scene(192, 192);
    for (const f of [2, 4]) {
      const lo = boxDown(hi, f);
      const enh = psnr(hi, enhancedUpscale(lo, 192, 192, { sharpen: 0.5 }), 4);
      expect(enh).toBeGreaterThan(psnr(hi, resize(lo, 192, 192, 'bicubic'), 4) + 0.3);
      expect(enh).toBeGreaterThan(psnr(hi, resize(lo, 192, 192, 'lanczos'), 4));
    }
  });
  it('keeps diagonal edges smooth (no stair steps)', () => {
    // A hard 45° edge: after 4x the edge position should advance one pixel per row.
    const lo = rgba8(32, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) lo.data.set(x > y ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * 32 + x) * 4);
    const out = enhancedUpscale(lo, 128, 128, { sharpen: 0 });
    const crossing = (y: number) => {
      for (let x = 1; x < 128; x++) if (gray(out, x, y) >= 128 && gray(out, x - 1, y) < 128) return x;
      return -1;
    };
    const steps = Array.from({ length: 60 }, (_, k) => crossing(30 + k + 1) - crossing(30 + k));
    // Each row moves by about one pixel; a nearest-like result would jump by 4 every 4 rows.
    expect(Math.max(...steps)).toBeLessThanOrEqual(2);
  });
  it('preserves flat colors, transparency and exact sizes', () => {
    const img = rgba8(10, 7, [40, 120, 200, 255]);
    for (let x = 0; x < 10; x++) img.data[(3 * 10 + x) * 4 + 3] = 0;
    const out = enhancedUpscale(img, 25, 21, { sharpen: 1 });
    expect([out.width, out.height]).toEqual([25, 21]);
    expect([...out.data.subarray(0, 4)]).toEqual([40, 120, 200, 255]);
    const row = Math.round((3 + 0.5) * 3 - 0.5);
    expect(out.data[(row * 25 + 12) * 4 + 3]).toBeLessThan(40);
    const m = mask8(8, 8, 200);
    const up = enhancedUpscaleMask(m, 16, 16);
    expect(up.data.every((v) => v === 200)).toBe(true);
  });
});

describe('Harmonize (color transfer statistics)', () => {
  function randomLab(n: number, base: [number, number, number], spread: number, seed: number): RGBA8 {
    const g = gauss(lcg(seed)), img = rgba8(n, n);
    for (let i = 0; i < n * n; i++) img.data.set([base[0] + g() * spread, base[1] + g() * spread * 0.6, base[2] + g() * spread * 0.4, 255], i * 4);
    return img;
  }
  it('moves the layer statistics onto the target statistics at full weight', () => {
    const layer = randomLab(64, [200, 150, 90], 30, 1), below = randomLab(64, [70, 90, 140], 15, 2);
    const ls = labStats(layer), ts = labStats(below);
    const out = harmonizePixels(layer, ls, ts, { strength: 100, luminance: 100, color: 100 });
    const os = labStats(out);
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(os.mean[k] - ts.mean[k])).toBeLessThan(2.5);
      expect(Math.abs(os.std[k] - ts.std[k])).toBeLessThan(Math.max(1.5, ts.std[k] * 0.15));
    }
  });
  it('weights luminance and color separately and is the identity at zero strength', () => {
    const layer = randomLab(32, [200, 150, 90], 20, 3), below = randomLab(32, [60, 90, 150], 20, 4);
    const ls = labStats(layer), ts = labStats(below);
    const lumOnly = labStats(harmonizePixels(layer, ls, ts, { strength: 100, luminance: 100, color: 0 }));
    expect(Math.abs(lumOnly.mean[0] - ts.mean[0])).toBeLessThan(2.5);
    expect(Math.abs(lumOnly.mean[2] - ls.mean[2])).toBeLessThan(3);
    const f = harmonizeFunction(ls, ts, { ...DEFAULT_HARMONIZE, strength: 0 }), v = [0, 0, 0];
    f(0.3, 0.5, 0.7, v);
    expect(v.map((x) => +x.toFixed(4))).toEqual([0.3, 0.5, 0.7]);
  });
  it('bakes a compact lookup table that matches the exact mapping', () => {
    const ls = labStats(randomLab(32, [200, 150, 90], 20, 5)), ts = labStats(randomLab(32, [60, 90, 150], 20, 6));
    const text = harmonizeCube(ls, ts, DEFAULT_HARMONIZE);
    expect(text.length).toBeLessThan(200_000);
    const lut = parseCubeLut(text), f = harmonizeFunction(ls, ts, DEFAULT_HARMONIZE);
    const a = [0, 0, 0], b = [0, 0, 0];
    let worst = 0;
    for (const [r, g, bl] of [[0.1, 0.2, 0.3], [0.5, 0.5, 0.5], [0.9, 0.4, 0.2], [0.33, 0.77, 0.61]]) {
      sampleCubeLut(lut, r, g, bl, a);
      f(r, g, bl, b);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(a[k] - b[k]));
    }
    expect(worst * 255).toBeLessThan(3);
    expect(contextRect({ x: 10, y: 10, width: 40, height: 20 }, 60, 100)).toEqual({ x: 0, y: 5, width: 60, height: 30 });
  });
});

describe('Mask All Objects (segmentation)', () => {
  function objectsScene(withSmall: boolean) {
    const w = 240, h = 180, img = rgba8(w, h), g = gauss(lcg(9));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let c = [150 + g() * 6, 150 + g() * 6, 145 + g() * 6];
        if (Math.hypot(x - 55, y - 60) < 30) c = [200, 40, 40];
        if (Math.hypot(x - 170, y - 55) < 26) c = [30, 160, 60];
        if (x > 90 && x < 150 && y > 110 && y < 160) c = [40, 60, 200];
        if (withSmall && x > 200 && x < 207 && y > 140 && y < 147) c = [250, 230, 30];
        img.data.set([...c, 255], (y * w + x) * 4);
      }
    return img;
  }
  it('finds each separate object and honors the minimum size', () => {
    const img = objectsScene(true);
    const all = detectObjects(img, { minSize: 0.0005 });
    expect(all.length).toBe(4);
    const big = detectObjects(img, { minSize: 0.01 });
    expect(big.length).toBe(3);
    // Masks cover their object and not the background.
    const red = big.find((o) => o.rect.x < 60 && o.rect.y < 60)!;
    const at = (o: (typeof big)[0], x: number, y: number) => o.mask.data[(y - o.rect.y) * o.rect.width + (x - o.rect.x)];
    expect(at(red, 55, 60)).toBeGreaterThan(200);
    expect(at(red, red.rect.x + 1, red.rect.y + 1)).toBeLessThan(40);
    // Largest first.
    expect(big[0].area).toBeGreaterThanOrEqual(big[1].area);
  });
  it('returns nothing for a featureless image and caps the count', () => {
    expect(detectObjects(rgba8(64, 48, [120, 120, 120, 255])).length).toBe(0);
    const small = objectsScene(false);
    const { count } = objectLabels(resize(small, 120, 90, 'bilinear'), 0.001, 2);
    expect(count).toBe(2);
  });
});

describe('Generate Image and Upscale helpers', async () => {
  const { aspectSize, fitImage, maxPercent, qualityFor, styledPrompt, upscaleSize } = await import('../src/features/assist/place');
  it('fits generated images to the target box', () => {
    const img = rgba8(200, 100, [10, 20, 30, 255]);
    const fill = fitImage(img, 100, 100, 'fill');
    expect([fill.width, fill.height]).toEqual([100, 100]);
    expect(fill.data[3]).toBe(255);
    const fit = fitImage(img, 100, 100, 'fit');
    // Letterboxed: transparent above and below, opaque in the middle.
    expect(fit.data[(5 * 100 + 50) * 4 + 3]).toBe(0);
    expect(fit.data[(50 * 100 + 50) * 4 + 3]).toBe(255);
  });
  it('maps presets to sizes, prompts and provider quality', () => {
    expect(aspectSize('target', 640, 480)).toEqual({ width: 640, height: 480 });
    const sq = aspectSize('1:1', 640, 360);
    expect(sq.width).toBe(sq.height);
    expect(Math.abs(sq.width * sq.height - 640 * 360)).toBeLessThan(1000);
    expect(styledPrompt('a kite.  ', 'ink')).toBe('a kite. Style: black ink line drawing, clean linework, white background.');
    expect(styledPrompt('a kite', 'none')).toBe('a kite');
    expect(qualityFor('', 'draft')).toBe('low');
    expect(qualityFor('gemini-3.1-flash-image', 'high')).toBe('2K');
    expect(qualityFor('@cf/black-forest-labs/flux-1-schnell', 'high')).toBeUndefined();
  });
  it('states honest size limits for upscaling', () => {
    expect(upscaleSize(4000, 3000, 200)).toEqual({ width: 8000, height: 6000, fits: false });
    expect(maxPercent(4000, 3000)).toBe(141);
    expect(upscaleSize(4000, 3000, 141).fits).toBe(true);
    expect(maxPercent(8192, 100)).toBe(100);
  });
});
