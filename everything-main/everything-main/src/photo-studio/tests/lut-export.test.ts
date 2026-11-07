import { describe, expect, it } from 'vitest';
import { defaultAdjustment, evaluateAdjustment, parseCubeLut, sampleCubeLut, type Adjustment } from '../src/imaging/adjust';
import { meshPoints3dl, stackColorFn, write3dl, writeCsp, writeLut } from '../src/imaging/adjust/lut-formats';

const invert = defaultAdjustment('invert') as Adjustment;
const exposure: Adjustment = { kind: 'exposure', params: { exposure: 1, offset: 0, gamma: 1 } };
const levels = defaultAdjustment('levels');
levels.params.rgb.inWhite = 200;

describe('adjustment stack color function', () => {
  it('composes steps bottom first and mixes by opacity', () => {
    const o = new Float64Array(3);
    stackColorFn([{ adjustment: invert, opacity: 1 }])(0.2, 0.5, 1, o);
    expect([...o].map((v) => +v.toFixed(4))).toEqual([0.8, 0.5, 0]);
    stackColorFn([{ adjustment: invert, opacity: 0.5 }])(0.2, 0.6, 1, o);
    expect([...o].map((v) => +v.toFixed(4))).toEqual([0.5, 0.5, 0.5]);
    // Exposure then invert differs from invert then exposure.
    const a = new Float64Array(3), b = new Float64Array(3);
    stackColorFn([{ adjustment: exposure, opacity: 1 }, { adjustment: invert, opacity: 1 }])(0.3, 0.3, 0.3, a);
    const expected = evaluateAdjustment(exposure, 0.3 * 255, 0.3 * 255, 0.3 * 255).map((v) => 1 - v / 255);
    expect(a[0]).toBeCloseTo(expected[0], 5);
    stackColorFn([{ adjustment: invert, opacity: 1 }, { adjustment: exposure, opacity: 1 }])(0.3, 0.3, 0.3, b);
    expect(Math.abs(a[0] - b[0])).toBeGreaterThan(0.1);
  });
  it('applies the step blend mode', () => {
    const o = new Float64Array(3);
    // Invert in Multiply: c * (1 - c).
    stackColorFn([{ adjustment: invert, opacity: 1, blend: 'multiply' }])(0.5, 0.25, 1, o);
    expect(o[0]).toBeCloseTo(0.25, 6);
    expect(o[1]).toBeCloseTo(0.1875, 6);
    expect(o[2]).toBeCloseTo(0, 6);
  });
});

describe('LUT writers', () => {
  const fn = stackColorFn([{ adjustment: levels, opacity: 1 }, { adjustment: invert, opacity: 0.75 }]);
  it('round-trips a .cube through the parser', () => {
    const text = writeLut('cube', fn, 17, 'Look "one"');
    const lut = parseCubeLut(text);
    expect(lut.kind).toBe('3d');
    expect(lut.size).toBe(17);
    expect(lut.title).toContain('Look');
    const got = [0, 0, 0], want = new Float64Array(3);
    for (const [r, g, b] of [[0, 0, 0], [1, 1, 1], [0.25, 0.5, 0.75], [0.9, 0.1, 0.4]]) {
      sampleCubeLut(lut, r, g, b, got);
      fn(r, g, b, want);
      // Grid nodes are exact; between nodes trilinear interpolation stays close.
      for (let k = 0; k < 3; k++) expect(Math.abs(got[k] - want[k])).toBeLessThan(0.02);
    }
    sampleCubeLut(lut, 0.5, 0.5, 0.5, got);
    fn(0.5, 0.5, 0.5, want);
    expect(got[0]).toBeCloseTo(want[0], 5);
  });
  it('writes .3dl integer tables with blue fastest', () => {
    expect(meshPoints3dl(17)).toEqual([0, 64, 128, 192, 256, 320, 384, 448, 512, 575, 639, 703, 767, 831, 895, 959, 1023]);
    const text = write3dl(stackColorFn([{ adjustment: invert, opacity: 1 }]), 17);
    const lines = text.trim().split('\n');
    expect(lines.length).toBe(1 + 17 ** 3);
    expect(lines[0].split(' ').length).toBe(17);
    expect(lines[1]).toBe('4095 4095 4095');
    // Second row: r = g = 0, b = 64/1023.
    expect(lines[2]).toBe(`4095 4095 ${Math.round((1 - 64 / 1023) * 4095)}`);
    expect(lines.at(-1)).toBe('0 0 0');
    expect(() => write3dl(fn, 80)).toThrow();
  });
  it('writes .csp tables with preluts and red fastest', () => {
    const text = writeCsp(stackColorFn([{ adjustment: invert, opacity: 1 }]), 3, 'My table');
    const lines = text.trim().split('\n');
    expect(lines.slice(0, 2)).toEqual(['CSPLUTV100', '3D']);
    expect(text).toContain('BEGIN METADATA\nMy table\nEND METADATA');
    expect(lines.filter((l) => l === '2').length).toBe(3);
    const at = lines.indexOf('3 3 3');
    expect(at).toBeGreaterThan(0);
    const rows = lines.slice(at + 1);
    expect(rows.length).toBe(27);
    expect(rows[0]).toBe('1.0 1.0 1.0');
    expect(rows[1]).toBe('0.5 1.0 1.0');
    expect(rows[2]).toBe('0.0 1.0 1.0');
  });
});
