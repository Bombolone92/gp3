import { describe, expect, it } from 'vitest';
import {
  applyAdjustment,
  curveFunction,
  curveToValues,
  defaultParams,
  levelsFunction,
  monotoneSpline,
  smoothCurveValues,
  type Adjustment,
} from '../src/imaging/adjust';
import { rampImage } from './adjust-fixtures';

const gray = (adj: Adjustment) => {
  const out = applyAdjustment(rampImage(), adj);
  return Array.from({ length: 256 }, (_, x) => out.data[x * 4]);
};

describe('levels', () => {
  it('gamma maps mid input by the power 1/gamma', () => {
    const p = defaultParams('levels');
    p.rgb.gamma = 2;
    const g = gray({ kind: 'levels', params: p });
    expect(g[128]).toBe(Math.round(255 * Math.sqrt(128 / 255))); // 181
    expect(g[64]).toBe(128);
    expect(g[0]).toBe(0);
    expect(g[255]).toBe(255);
    p.rgb.gamma = 0.5;
    expect(gray({ kind: 'levels', params: p })[128]).toBe(Math.round(255 * (128 / 255) ** 2)); // 64
  });

  it('input and output ranges clip and rescale', () => {
    const p = defaultParams('levels');
    p.rgb = { inBlack: 50, inWhite: 200, gamma: 1, outBlack: 10, outWhite: 240 };
    const g = gray({ kind: 'levels', params: p });
    expect(g[0]).toBe(10);
    expect(g[50]).toBe(10);
    expect(g[125]).toBe(125);
    expect(g[200]).toBe(240);
    expect(g[255]).toBe(240);
    // Inverted output range is allowed (outBlack > outWhite).
    expect(levelsFunction({ inBlack: 0, inWhite: 255, gamma: 1, outBlack: 255, outWhite: 0 })(0.25)).toBeCloseTo(0.75, 9);
  });

  it('per-channel levels apply after the composite', () => {
    const p = defaultParams('levels');
    p.rgb.inWhite = 128; // doubles everything
    p.r.outWhite = 100; // then red is scaled down
    const out = applyAdjustment(rampImage(), { kind: 'levels', params: p });
    expect(out.data[64 * 4]).toBe(Math.round((128 / 255) * 100));
    expect(out.data[64 * 4 + 1]).toBe(128);
  });
});

describe('curves', () => {
  it('passes exactly through the control points', () => {
    const pts: [number, number][] = [[0, 20], [60, 40], [128, 170], [200, 210], [255, 250]];
    const f = monotoneSpline(pts);
    for (const [x, y] of pts) expect(f(x)).toBeCloseTo(y, 9);
    const p = defaultParams('curves');
    p.rgb.points = pts;
    const g = gray({ kind: 'curves', params: p });
    for (const [x, y] of pts) expect(g[x]).toBe(y);
  });

  it('is monotone without overshoot for monotone points', () => {
    const f = monotoneSpline([[0, 0], [10, 200], [20, 210], [255, 255]]);
    let prev = -Infinity;
    for (let x = 0; x <= 255; x += 0.25) {
      const y = f(x);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(y).toBeLessThanOrEqual(255 + 1e-9);
      prev = y;
    }
  });

  it('flattens at extrema and outside the end points', () => {
    const f = monotoneSpline([[30, 10], [128, 240], [220, 30]]);
    expect(f(0)).toBe(10);
    expect(f(255)).toBe(30);
    for (let x = 30; x <= 220; x++) expect(f(x)).toBeLessThanOrEqual(240 + 1e-9);
  });

  it('two points give a straight line and unsorted input is accepted', () => {
    const f = monotoneSpline([[255, 155], [0, 55]]);
    expect(f(127.5)).toBeCloseTo(105, 9);
    expect(monotoneSpline([[0, 0], [100, 50], [100, 80], [255, 255]])(100)).toBe(80);
  });

  it('pencil mode uses the drawn values', () => {
    const values = Array.from({ length: 256 }, (_, i) => (i < 128 ? 255 - i : i));
    const f = curveFunction({ mode: 'pencil', points: [], values });
    expect(f(0)).toBe(1);
    expect(f(100 / 255) * 255).toBeCloseTo(155, 6);
    const p = defaultParams('curves');
    p.g = { mode: 'pencil', points: p.g.points, values };
    const out = applyAdjustment(rampImage(), { kind: 'curves', params: p });
    expect(out.data[10 * 4 + 1]).toBe(245);
    expect(out.data[10 * 4]).toBe(10);
  });

  it('samples and smooths curves', () => {
    const v = curveToValues({ mode: 'points', points: [[0, 0], [255, 255]] });
    v.forEach((y, i) => expect(y).toBeCloseTo(i, 9));
    const s = smoothCurveValues([0, 0, 0, 255, 255, 255], 1);
    expect(s[0]).toBe(0);
    expect(s[5]).toBe(255);
    expect(s[2]).toBeGreaterThan(0);
    expect(s[3]).toBeLessThan(255);
  });
});
