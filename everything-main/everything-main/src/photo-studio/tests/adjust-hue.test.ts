import { describe, expect, it } from 'vitest';
import { DEFAULT_HUE_RANGES, defaultParams, HUE_RANGES, hslToRgb, hueRangeWeight, planFor, rgbToHsl, type Adjustment } from '../src/imaging/adjust';

describe('hue range falloff', () => {
  it('default ranges partition the hue circle', () => {
    let worst = 0;
    for (let h = 0; h < 360; h += 0.5)
      worst = Math.max(worst, Math.abs(HUE_RANGES.reduce((a, n) => a + hueRangeWeight(h, DEFAULT_HUE_RANGES[n]), 0) - 1));
    expect(worst).toBeLessThan(1e-9);
    expect(hueRangeWeight(0, DEFAULT_HUE_RANGES.reds)).toBe(1);
    expect(hueRangeWeight(30, DEFAULT_HUE_RANGES.reds)).toBeCloseTo(0.5, 9);
    expect(hueRangeWeight(180, DEFAULT_HUE_RANGES.reds)).toBe(0);
  });

  it('weights are continuous, including custom and wrapping falloffs', () => {
    for (const range of [DEFAULT_HUE_RANGES.reds, [350, 355, 5, 90], [100, 101, 102, 103]] as [number, number, number, number][]) {
      const width = Math.min(...[range[1] - range[0], range[3] - range[2]].map((v) => ((v % 360) + 360) % 360));
      let prev = hueRangeWeight(0, range),
        worst = 0;
      for (let h = 0.01; h <= 360; h += 0.01) {
        const w = hueRangeWeight(h, range);
        worst = Math.max(worst, Math.abs(w - prev));
        prev = w;
      }
      expect(worst).toBeLessThanOrEqual(0.01 / width + 1e-9);
    }
  });
});

describe('hue/saturation continuity', () => {
  const p = defaultParams('hue-saturation');
  p.ranges.reds = { ...p.ranges.reds, hue: 40, saturation: -60, lightness: 30 };
  p.ranges.greens = { ...p.ranges.greens, range: [80, 100, 140, 200], hue: -30, saturation: 50, lightness: -40 };
  p.master.saturation = 10;
  const plan = planFor({ kind: 'hue-saturation', params: p } as Adjustment).pixel!;
  const fn = (r: number, g: number, b: number, out: Float64Array) => plan(Float64Array.of(r, g, b), out, 1);
  const o = new Float64Array(3),
    q = new Float64Array(3);

  it('output changes smoothly as the input hue sweeps the circle', () => {
    const c = [0, 0, 0];
    let worst = 0;
    hslToRgb(0, 0.8, 0.5, c);
    fn(c[0], c[1], c[2], q);
    for (let h = 0.05; h <= 360; h += 0.05) {
      hslToRgb(h, 0.8, 0.5, c);
      fn(c[0], c[1], c[2], o);
      worst = Math.max(worst, Math.abs(o[0] - q[0]), Math.abs(o[1] - q[1]), Math.abs(o[2] - q[2]));
      q.set(o);
    }
    // 0.05 degree steps: a continuous result moves far less than one code value.
    expect(worst * 255).toBeLessThan(1);
  });

  it('colors converge as they approach gray from any hue', () => {
    const c = [0, 0, 0];
    const base = new Float64Array(3);
    fn(0.5, 0.5, 0.5, base);
    for (let h = 0; h < 360; h += 15) {
      hslToRgb(h, 0.004, 0.5, c);
      fn(c[0], c[1], c[2], o);
      for (let k = 0; k < 3; k++) expect(Math.abs(o[k] - base[k]) * 255).toBeLessThan(1);
    }
  });

  it('only the targeted range changes hue', () => {
    const blue = [0, 0, 0];
    hslToRgb(240, 0.8, 0.5, blue);
    fn(blue[0], blue[1], blue[2], o);
    const hsl = rgbToHsl(o[0], o[1], o[2]);
    expect(hsl[0]).toBeCloseTo(240, 6);
    const red = [0.8, 0.2, 0.2];
    fn(red[0], red[1], red[2], o);
    expect(rgbToHsl(o[0], o[1], o[2])[0]).toBeCloseTo(40, 3);
  });
});
