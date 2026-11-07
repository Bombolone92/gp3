import { describe, expect, it } from 'vitest';
import {
  deleteStop,
  distributeStops,
  gradientPresets,
  gradientRamp,
  gradientToCss,
  insertColorStop,
  insertOpacityStop,
  moveStop,
  renderGradient,
  reverseGradient,
  sampleGradient,
  segmentEase,
  setMidpoint,
  type NoiseGradient,
  type SolidGradient,
} from '../src/imaging/gradient';

const bw = (smoothness = 0, midpoint = 50): SolidGradient => ({
  kind: 'solid',
  colorStops: [
    { location: 0, color: [0, 0, 0], midpoint },
    { location: 1, color: [255, 255, 255] },
  ],
  opacityStops: [
    { location: 0, opacity: 1 },
    { location: 1, opacity: 1 },
  ],
  smoothness,
});
const px = (img: { width: number; data: Uint8ClampedArray }, x: number, y: number) =>
  [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

describe('solid gradient rendering', () => {
  it('hits exact endpoints and interpolates linearly at a 50% midpoint', () => {
    const w = 256;
    const img = renderGradient(w, 1, bw(), { type: 'linear', start: { x: 0.5, y: 0 }, end: { x: w - 0.5, y: 0 }, method: 'classic' });
    expect(px(img, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(img, w - 1, 0)).toEqual([255, 255, 255, 255]);
    for (let x = 0; x < w; x++) expect(Math.abs(img.data[x * 4] - x)).toBeLessThanOrEqual(1);
  });
  it('a midpoint moves the half-way point and smoothness eases the ends', () => {
    expect(segmentEase(0.25, 25)).toBeCloseTo(0.5, 9);
    expect(segmentEase(0.5, 50)).toBe(0.5);
    expect(segmentEase(0.1, 50, 1)).toBeCloseTo(0.028, 9);
    const g = bw(0, 25);
    expect(sampleGradient(g, 0.25, { method: 'classic' })[0]).toBeCloseTo(127.5, 6);
    expect(sampleGradient(bw(100), 0.1, { method: 'classic' })[0]).toBeCloseTo(0.028 * 255, 6);
  });
  it('orders the interpolation methods as expected at the middle of black to white', () => {
    const c = sampleGradient(bw(), 0.5, { method: 'classic' })[0];
    const l = sampleGradient(bw(), 0.5, { method: 'linear' })[0];
    const p = sampleGradient(bw(), 0.5, { method: 'perceptual' })[0];
    expect(c).toBeCloseTo(127.5, 6);
    expect(l).toBeCloseTo(187.5, 0); // sRGB encoding of 50% linear light
    expect(p).toBeGreaterThan(90);
    expect(p).toBeLessThan(c); // Oklab L = 0.5 is darker than encoded mid gray
    for (const m of ['classic', 'linear', 'perceptual'] as const) {
      expect(sampleGradient(bw(), 0, { method: m })[0]).toBeCloseTo(0, 6);
      expect(sampleGradient(bw(), 1, { method: m })[0]).toBeCloseTo(255, 3);
    }
  });
  it('reflected gradients are symmetric about the start point', () => {
    const img = renderGradient(101, 1, bw(), { type: 'reflected', start: { x: 50.5, y: 0 }, end: { x: 100.5, y: 0 }, method: 'classic' });
    for (let d = 0; d <= 50; d++) expect(px(img, 50 - d, 0)).toEqual(px(img, 50 + d, 0));
    expect(px(img, 50, 0)[0]).toBe(0);
    expect(px(img, 100, 0)[0]).toBe(255);
  });
  it('radial t is the distance from the start over the radius', () => {
    const img = renderGradient(201, 201, bw(), { type: 'radial', start: { x: 100.5, y: 100.5 }, end: { x: 200.5, y: 100.5 }, method: 'classic' });
    for (const [x, y] of [[130, 140], [100, 50], [20, 160], [100, 100]]) {
      const t = Math.min(1, Math.hypot(x - 100, y - 100) / 100);
      expect(Math.abs(px(img, x, y)[0] - t * 255)).toBeLessThanOrEqual(1);
    }
    // rotationally symmetric
    expect(px(img, 160, 100)).toEqual(px(img, 100, 160));
    expect(px(img, 40, 100)).toEqual(px(img, 100, 40));
  });
  it('diamond and angle geometry follow the documented conventions', () => {
    const d = renderGradient(201, 201, bw(), { type: 'diamond', start: { x: 100.5, y: 100.5 }, end: { x: 150.5, y: 100.5 }, method: 'classic' });
    expect(px(d, 125, 125)[0]).toBe(255); // |25| + |25| = 50
    expect(Math.abs(px(d, 120, 110)[0] - 0.6 * 255)).toBeLessThanOrEqual(1);
    expect(px(d, 100, 130)).toEqual(px(d, 130, 100));
    const a = renderGradient(201, 201, bw(), { type: 'angle', start: { x: 100.5, y: 100.5 }, end: { x: 200.5, y: 100.5 }, method: 'classic' });
    expect(Math.abs(px(a, 100, 40)[0] - 0.25 * 255)).toBeLessThanOrEqual(1); // straight up: a quarter turn counterclockwise
    expect(Math.abs(px(a, 40, 100)[0] - 0.5 * 255)).toBeLessThanOrEqual(1);
    expect(Math.abs(px(a, 100, 160)[0] - 0.75 * 255)).toBeLessThanOrEqual(1);
  });
  it('reverse and scale act on the parameter', () => {
    const opts = { type: 'linear' as const, start: { x: 0.5, y: 0 }, end: { x: 100.5, y: 0 }, method: 'classic' as const };
    const f = renderGradient(101, 1, bw(), opts);
    const r = renderGradient(101, 1, bw(), { ...opts, reverse: true });
    for (let x = 0; x <= 100; x++) expect(Math.abs(f.data[x * 4] + r.data[x * 4] - 255)).toBeLessThanOrEqual(1);
    const s = renderGradient(101, 1, bw(), { ...opts, scale: 0.5 });
    expect(s.data[50 * 4]).toBe(255);
    expect(Math.abs(s.data[25 * 4] - 127.5)).toBeLessThanOrEqual(1);
  });
  it('opacity stops fade alpha and foreground tokens resolve', () => {
    const g = gradientPresets[0].gradients[1];
    const img = renderGradient(3, 1, g, { type: 'linear', start: { x: 0.5, y: 0 }, end: { x: 2.5, y: 0 }, foreground: [200, 10, 20] });
    expect(px(img, 0, 0)).toEqual([200, 10, 20, 255]);
    expect(Math.abs(px(img, 1, 0)[3] - 127.5)).toBeLessThanOrEqual(1);
    expect(px(img, 2, 0)[3]).toBe(0);
  });
  it('dithering is deterministic, stays within a level and keeps the mean', () => {
    const g: SolidGradient = { ...bw(), colorStops: [{ location: 0, color: [100, 100, 100] }, { location: 1, color: [104, 104, 104] }] };
    const opts = { type: 'linear' as const, start: { x: 0, y: 0 }, end: { x: 512, y: 0 }, method: 'classic' as const };
    const plain = renderGradient(512, 16, g, opts);
    const a = renderGradient(512, 16, g, { ...opts, dither: true });
    const b = renderGradient(512, 16, g, { ...opts, dither: true });
    expect(a.data).toEqual(b.data);
    let sumA = 0, sumExact = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      expect(Math.abs(a.data[i] - plain.data[i])).toBeLessThanOrEqual(1);
      sumA += a.data[i];
      const x = (i / 4) % 512;
      sumExact += 100 + (4 * (x + 0.5)) / 512;
    }
    expect(Math.abs(sumA - sumExact) / (512 * 16)).toBeLessThan(0.05);
  });
  it('handles 1x1 output and a degenerate start == end', () => {
    const img = renderGradient(1, 1, bw(), { type: 'radial', start: { x: 0.5, y: 0.5 }, end: { x: 0.5, y: 0.5 } });
    expect(px(img, 0, 0)).toEqual([0, 0, 0, 255]);
  });
});

describe('noise gradients', () => {
  const noise = (seed: number, extra: Partial<NoiseGradient> = {}): NoiseGradient => ({
    kind: 'noise', roughness: 50, model: 'rgb', min: [0.2, 0, 0.5], max: [0.4, 1, 0.5],
    restrictColors: false, addTransparency: false, seed, ...extra,
  });
  it('is deterministic per seed and differs between seeds', () => {
    expect(gradientRamp(noise(1))).toEqual(gradientRamp(noise(1)));
    expect(gradientRamp(noise(1))).not.toEqual(gradientRamp(noise(2)));
  });
  it('respects channel ranges and transparency', () => {
    const r = gradientRamp(noise(5));
    for (let i = 0; i < r.length; i += 4) {
      expect(r[i]).toBeGreaterThanOrEqual(0.2 * 255 - 1e-3);
      expect(r[i]).toBeLessThanOrEqual(0.4 * 255 + 1e-3);
      expect(r[i + 2]).toBeCloseTo(127.5, 3);
      expect(r[i + 3]).toBe(255);
    }
    const t = gradientRamp(noise(5, { addTransparency: true }));
    expect(Math.min(...Array.from({ length: 4096 }, (_, i) => t[i * 4 + 3]))).toBeLessThan(255);
  });
  it('rougher gradients change faster', () => {
    const variation = (g: NoiseGradient) => {
      const r = gradientRamp(g);
      let v = 0;
      for (let i = 4; i < r.length; i += 4) v += Math.abs(r[i + 1] - r[i - 3]);
      return v;
    };
    expect(variation(noise(3, { roughness: 100 }))).toBeGreaterThan(variation(noise(3, { roughness: 0 })) * 2);
  });
  it('HSB and Lab models produce in-gamut colors, restricted colors cap saturation', () => {
    for (const model of ['hsb', 'lab'] as const) {
      const r = gradientRamp(noise(9, { model, min: [0, 0, 0], max: [1, 1, 1], restrictColors: true }));
      for (let i = 0; i < r.length; i += 4) {
        const mx = Math.max(r[i], r[i + 1], r[i + 2]), mn = Math.min(r[i], r[i + 1], r[i + 2]);
        expect(mn).toBeGreaterThanOrEqual(0);
        expect(mx).toBeLessThanOrEqual(255);
        if (mx > 0) expect((mx - mn) / mx).toBeLessThanOrEqual(0.851);
      }
    }
  });
});

describe('gradient editing', () => {
  it('inserting a stop keeps the gradient look', () => {
    const g = bw();
    const { gradient, index } = insertColorStop(g, 0.3, undefined, { method: 'classic' });
    expect(index).toBe(1);
    for (const t of [0.1, 0.3, 0.6])
      expect(Math.abs(sampleGradient(gradient, t, { method: 'classic' })[0] - sampleGradient(g, t, { method: 'classic' })[0])).toBeLessThanOrEqual(1);
    const o = insertOpacityStop(g, 0.5);
    expect(o.gradient.opacityStops).toHaveLength(3);
    expect(o.gradient.opacityStops[1].opacity).toBe(1);
  });
  it('moving re-sorts and deleting keeps at least two stops', () => {
    const { gradient } = insertColorStop(bw(), 0.3, [255, 0, 0]);
    const moved = moveStop(gradient, 'color', 1, 0.9);
    expect(moved.index).toBe(1);
    const past = moveStop(gradient, 'color', 0, 0.95);
    expect(past.index).toBe(1);
    expect(past.gradient.colorStops.map((s) => s.location)).toEqual([0.3, 0.95, 1]);
    const del = deleteStop(gradient, 'color', 1);
    expect(del.colorStops).toHaveLength(2);
    expect(deleteStop(del, 'color', 0)).toBe(del);
  });
  it('reversing mirrors the sampled colors including midpoints', () => {
    let g = insertColorStop(bw(), 0.3, [255, 0, 0]).gradient;
    g = setMidpoint(g, 'color', 0, 20);
    g = setMidpoint(g, 'color', 1, 70);
    const r = reverseGradient(g);
    for (let t = 0; t <= 1; t += 0.05) {
      const a = sampleGradient(g, t, { method: 'classic' }), b = sampleGradient(r, 1 - t, { method: 'classic' });
      for (let c = 0; c < 4; c++) expect(b[c]).toBeCloseTo(a[c], 6);
    }
    expect(setMidpoint(g, 'color', 0, 2).colorStops[0].midpoint).toBe(5);
  });
  it('distributes stops evenly and renders a CSS preview', () => {
    let g = insertColorStop(bw(), 0.1, [255, 0, 0]).gradient;
    g = insertColorStop(g, 0.2, [0, 255, 0]).gradient;
    expect(distributeStops(g, 'color').colorStops.map((s) => s.location)).toEqual([0, 1 / 3, 2 / 3, 1]);
    expect(gradientToCss(bw(), {}, 90, 2)).toMatch(/^linear-gradient\(90deg, rgba\(0, 0, 0, 1\) 0%/);
  });
});

describe('gradient presets', () => {
  it('ships basics plus at least 16 original presets with valid stops', () => {
    const all = gradientPresets.flatMap((f) => f.gradients);
    expect(all.length).toBeGreaterThanOrEqual(19);
    expect(new Set(all.map((g) => g.name)).size).toBe(all.length);
    for (const g of all) {
      expect(g.colorStops.length).toBeGreaterThanOrEqual(2);
      for (const s of g.colorStops) {
        expect(s.location).toBeGreaterThanOrEqual(0);
        expect(s.location).toBeLessThanOrEqual(1);
      }
      const r = gradientRamp(g, { foreground: [1, 2, 3], background: [4, 5, 6] });
      expect(r.every((v) => Number.isFinite(v) && v >= 0 && v <= 255.0001)).toBe(true);
    }
    expect(gradientPresets[0].gradients.map((g) => g.name)).toEqual(['Foreground to Background', 'Foreground to Transparent', 'Black, White']);
  });
});
