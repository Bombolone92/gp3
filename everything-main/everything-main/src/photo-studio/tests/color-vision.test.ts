import { describe, expect, it } from 'vitest';
import { linearToSrgb, mapLut, plateGray, simulateVision, srgbToLinear, VISION_MATRICES } from '../src/color/vision';

describe('color vision simulation', () => {
  it('keeps neutral grays unchanged (matrix rows sum to one)', () => {
    for (const m of Object.values(VISION_MATRICES))
      for (let row = 0; row < 3; row++) expect(m[row * 3] + m[row * 3 + 1] + m[row * 3 + 2]).toBeCloseTo(1, 5);
    for (const kind of ['protan', 'deutan'] as const)
      for (const v of [0, 0.18, 0.5, 1]) {
        const out = simulateVision(kind, [v, v, v]);
        for (const c of out) expect(c).toBeCloseTo(v, 4);
      }
  });
  it('makes classic red/green confusion colors similar', () => {
    const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    // A red and a green of similar lightness differ strongly for normal vision.
    const red = [0.8, 0.35, 0.2],
      green = [0.45, 0.55, 0.2];
    const normal = dist(red, green);
    for (const kind of ['protan', 'deutan'] as const) {
      const d = dist(simulateVision(kind, red) as number[], simulateVision(kind, green) as number[]);
      expect(d).toBeLessThan(normal * 0.5);
    }
  });
  it('leaves blue/yellow contrast visible', () => {
    for (const kind of ['protan', 'deutan'] as const) {
      const blue = simulateVision(kind, [0, 0, 1]),
        yellow = simulateVision(kind, [1, 1, 0]);
      expect(blue[2]).toBeGreaterThan(0.8);
      expect(yellow[2]).toBeLessThan(0.3);
    }
  });
  it('matches the published protanopia matrix on pure red (linear light)', () => {
    const out = simulateVision('protan', [1, 0, 0]);
    expect(srgbToLinear(out[0])).toBeCloseTo(0.152286, 4);
    expect(srgbToLinear(out[1])).toBeCloseTo(0.114503, 4);
    // Negative results clip to black.
    expect(out[2]).toBe(0);
  });
  it('round-trips the sRGB transfer function', () => {
    for (const v of [0, 0.001, 0.04, 0.2, 0.73, 1]) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6);
  });
});

describe('ink plates', () => {
  it('shows each ink as gray (white paper, black at full coverage)', () => {
    const ink = [0.25, 0.5, 0, 1];
    expect(plateGray(ink, 'c')).toBeCloseTo(0.75);
    expect(plateGray(ink, 'm')).toBeCloseTo(0.5);
    expect(plateGray(ink, 'y')).toBe(1);
    expect(plateGray(ink, 'k')).toBe(0);
    expect(plateGray([1.2, 0, 0, 0], 'c')).toBe(0);
  });
  it('maps LUT outputs through a function', () => {
    const lut = { size: 2, outChannels: 3, data: new Float32Array(8 * 4).map((_, i) => ((i % 4) === 3 ? 1 : 0.5)) };
    const out = mapLut(lut, (rgb, o) => {
      o[0] = rgb[0] * 2;
      o[1] = 0;
      o[2] = 1;
    });
    expect([...out.data.slice(0, 4)]).toEqual([1, 0, 1, 1]);
    expect(out.size).toBe(2);
  });
});
