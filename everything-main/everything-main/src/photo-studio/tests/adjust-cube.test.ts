import { describe, expect, it } from 'vitest';
import {
  adjustmentToCubeLut,
  applyAdjustment,
  bakeCubeLut,
  BUILTIN_LOOKS,
  CubeParseError,
  parseCubeLut,
  sampleCubeLut,
  serializeCubeLut,
  type Adjustment,
} from '../src/imaging/adjust';
import { diffStats, randomImage, sampleAdjustment } from './adjust-fixtures';

// An inverting 2x2x2 LUT, red fastest, with comments and blank lines.
const INVERT_CUBE = `# Hand-written test LUT
TITLE "Invert test"
LUT_3D_SIZE 2
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1

1 1 1   # black -> white
0 1 1
1 0 1
0 0 1
1 1 0
0 1 0
1 0 0
0 0 0
`;

describe('.cube parser', () => {
  it('reads keywords and data with red fastest', () => {
    const lut = parseCubeLut(INVERT_CUBE);
    expect(lut.title).toBe('Invert test');
    expect(lut.kind).toBe('3d');
    expect(lut.size).toBe(2);
    expect([...lut.data.slice(0, 6)]).toEqual([1, 1, 1, 0, 1, 1]);
    const o = [0, 0, 0];
    sampleCubeLut(lut, 0.25, 0.5, 1, o);
    expect(o.map((v) => +v.toFixed(9))).toEqual([0.75, 0.5, 0]);
  });

  it('round-trips through the serializer', () => {
    const lut = parseCubeLut(INVERT_CUBE);
    const again = parseCubeLut(serializeCubeLut(lut));
    expect(again).toEqual(lut);
    const baked = bakeCubeLut((r, g, b, o) => ((o[0] = r * r), (o[1] = Math.sqrt(g)), (o[2] = (r + b) / 2)), 9, 'Baked');
    const back = parseCubeLut(serializeCubeLut(baked, 7));
    expect(back.size).toBe(9);
    expect(back.title).toBe('Baked');
    for (let i = 0; i < baked.data.length; i++) expect(back.data[i]).toBeCloseTo(baked.data[i], 6);
  });

  it('applies as a Color Lookup source exactly like Invert', () => {
    const img = randomImage(32, 32, 8);
    const adj: Adjustment = { kind: 'color-lookup', params: { source: { type: 'cube', name: 'inv', text: INVERT_CUBE }, amount: 100 } };
    const inv = applyAdjustment(img, { kind: 'invert', params: {} });
    expect(diffStats(applyAdjustment(img, adj), inv).max).toBeLessThanOrEqual(1);
    // Amount blends with the original: 50 percent of an inversion is mid-gray.
    const half = applyAdjustment(img, { ...adj, params: { ...adj.params, amount: 50 } } as Adjustment);
    for (let i = 0; i < img.data.length; i += 4) expect(Math.abs(half.data[i] - 127.5)).toBeLessThanOrEqual(1);
  });

  it('supports 1D LUTs, input ranges and a 1D shaper', () => {
    const oneD = parseCubeLut('LUT_1D_SIZE 3\nLUT_1D_INPUT_RANGE 0 2\n0 0 0\n0.5 0.25 1\n1 1 1\n');
    expect(oneD.kind).toBe('1d');
    expect(oneD.domainMax).toEqual([2, 2, 2]);
    const o = [0, 0, 0];
    sampleCubeLut(oneD, 1, 1, 1, o);
    expect(o).toEqual([0.5, 0.25, 1]);
    expect(parseCubeLut(serializeCubeLut(oneD))).toEqual(oneD);
    const shaped = parseCubeLut(`LUT_1D_SIZE 2\nLUT_3D_SIZE 2\n1 1 1\n0 0 0\n${INVERT_CUBE.split('\n').slice(5).join('\n')}`);
    expect(shaped.shaper?.size).toBe(2);
    // Shaper inverts, the 3D table inverts again: identity.
    sampleCubeLut(shaped, 0.3, 0.6, 0.9, o);
    expect(o.map((v) => +v.toFixed(9))).toEqual([0.3, 0.6, 0.9]);
    const img = randomImage(8, 8, 1);
    const adj: Adjustment = { kind: 'color-lookup', params: { source: { type: 'lut', name: '1d', lut: parseCubeLut('LUT_1D_SIZE 2\n1 1 1\n0 0 0\n') }, amount: 100 } };
    expect(diffStats(applyAdjustment(img, adj), applyAdjustment(img, { kind: 'invert', params: {} })).max).toBeLessThanOrEqual(1);
  });

  it('rejects malformed files with useful errors', () => {
    expect(() => parseCubeLut('TITLE "x"\n0 0 0\n')).toThrow(CubeParseError);
    expect(() => parseCubeLut('LUT_3D_SIZE 2\n0 0 0\n')).toThrow(/Expected 8 table entries, found 1/);
    expect(() => parseCubeLut('LUT_3D_SIZE 1\n')).toThrow(/Invalid LUT_3D_SIZE/);
    expect(() => parseCubeLut('LUT_1D_SIZE 2\n0 0 zero\n1 1 1\n')).toThrow(/Line 2/);
    expect(() => parseCubeLut('LUT_1D_SIZE 2\nDOMAIN_MIN 1 1 1\nDOMAIN_MAX 0 0 0\n0 0 0\n1 1 1\n')).toThrow(/DOMAIN_MAX/);
    expect(() => parseCubeLut('LUT_1D_SIZE 2\n0 0 0\nTITLE "late"\n1 1 1\n')).toThrow(/before the table/);
  });

  it('tolerates CRLF, BOM and unknown keywords', () => {
    const text = '﻿' + INVERT_CUBE.replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 2\nLUT_IN_VIDEO_RANGE').replace(/\n/g, '\r\n');
    expect(parseCubeLut(text).data).toEqual(parseCubeLut(INVERT_CUBE).data);
  });
});

describe('looks and LUT export', () => {
  it('ships original looks that change the image', () => {
    expect(BUILTIN_LOOKS.length).toBeGreaterThanOrEqual(4);
    const img = randomImage(24, 24, 3);
    for (const look of BUILTIN_LOOKS) {
      const out = applyAdjustment(img, { kind: 'color-lookup', params: { source: { type: 'builtin', id: look.id }, amount: 100 } });
      expect(diffStats(out, img).mean).toBeGreaterThan(2);
    }
    const bw = applyAdjustment(img, { kind: 'color-lookup', params: { source: { type: 'builtin', id: 'high-key-bw' }, amount: 100 } });
    for (let i = 0; i < bw.data.length; i += 4) expect(bw.data[i]).toBe(bw.data[i + 2]);
  });

  it('bakes an adjustment into a .cube that reproduces it', () => {
    const adj = sampleAdjustment('curves');
    const lut = parseCubeLut(serializeCubeLut(adjustmentToCubeLut(adj, 33, 'Curves')));
    const img = randomImage(64, 64, 12);
    const viaLut = applyAdjustment(img, { kind: 'color-lookup', params: { source: { type: 'lut', name: 'x', lut }, amount: 100 } });
    const s = diffStats(viaLut, applyAdjustment(img, adj));
    expect(s.mean).toBeLessThan(0.5);
    expect(s.max).toBeLessThanOrEqual(3);
  });
});
