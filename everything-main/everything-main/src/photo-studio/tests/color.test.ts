import { describe, expect, it } from 'vitest';
import {
  colorTransform,
  convertRgb,
  curveValue,
  inverseMatrix,
  linearSrgbProfile,
  multiplyMatrix,
  packColorTransform,
  readRgbProfile,
  srgbProfile,
  type Curve,
} from '../src/color/profile';
import { makeRgbProfile, encodeCurve } from './color-fixtures';

describe('ICC matrix/TRC color conversion', () => {
  it('maps sRGB primaries to ICC D50 and converts linear RGB through the standard transfer function', () => {
    const m = srgbProfile.matrix;
    for (const [i, white] of [0.9642, 1, 0.8249].entries())
      expect(m[i * 3] + m[i * 3 + 1] + m[i * 3 + 2]).toBeCloseTo(white, 12);
    const t = colorTransform(linearSrgbProfile, srgbProfile);
    for (const x of [-2, -0.01, 0, 0.003, 0.18, 0.5, 1, 2.5]) {
      const expected =
        Math.sign(x) *
        (Math.abs(x) <= 0.0031308 ? 12.92 * Math.abs(x) : 1.055 * Math.abs(x) ** (1 / 2.4) - 0.055);
      for (const c of convertRgb(t, [x, x, x])) expect(c).toBeCloseTo(expected, 12);
    }
    const t2 = colorTransform(srgbProfile, linearSrgbProfile);
    expect(convertRgb(t2, convertRgb(t, [0.18, 0.003, 4]))).toEqual(
      expect.arrayContaining([
        expect.closeTo(0.18, 12),
        expect.closeTo(0.003, 12),
        expect.closeTo(4, 12),
      ]),
    );
  });

  it('parses colorant columns and every parametric TRC type at typed-array offsets', () => {
    const choices: Extract<Curve, { kind: 'parametric' }>[] = [
      { kind: 'parametric', type: 0, parameters: [2] },
      { kind: 'parametric', type: 1, parameters: [2, 1, -0.25] },
      { kind: 'parametric', type: 2, parameters: [2, 1, -0.25, 0.125] },
      { kind: 'parametric', type: 3, parameters: [2, 1, 0, 0.25, 0.25] },
      { kind: 'parametric', type: 4, parameters: [2, 1, 0, 0.25, 0.25, 0.0625, 0.03125] },
    ];
    for (const curve of choices) {
      const bytes = makeRgbProfile({ curves: [curve, curve, curve] });
      const padded = new Uint8Array(bytes.length + 7);
      padded.set(bytes, 7);
      const parsed = readRgbProfile(padded.subarray(7));
      expect(parsed.curves).toEqual([curve, curve, curve]);
      for (let i = 0; i < 9; i++)
        expect(parsed.matrix[i]).toBe(Math.round(srgbProfile.matrix[i] * 65536) / 65536);
      for (const x of [0, 0.1, 0.25, 0.7, 1]) {
        const type = curve.type;
        const expected =
          type === 0
            ? x * x
            : type === 1
              ? x >= 0.25
                ? (x - 0.25) ** 2
                : 0
              : type === 2
                ? x >= 0.25
                  ? (x - 0.25) ** 2 + 0.125
                  : 0.125
                : type === 3
                  ? x >= 0.25
                    ? x * x
                    : 0.25 * x
                  : x >= 0.25
                    ? x * x + 0.0625
                    : 0.25 * x + 0.03125;
        expect(curveValue(parsed.curves[0], x)).toBeCloseTo(Math.min(1, expected), 12);
      }
      for (const x of [0.3, 0.5, 0.75])
        expect(curveValue(curve, curveValue(curve, x), true)).toBeCloseTo(x, 12);
    }
  });

  it('decodes identity, u8Fixed8 gamma and table curves without resampling their samples', () => {
    for (const count of [0, 1]) {
      const rawCurve = new Uint8Array(12 + count * 2),
        v = new DataView(rawCurve.buffer);
      rawCurve.set(new TextEncoder().encode('curv'));
      v.setUint32(8, count);
      if (count) v.setUint16(12, 384);
      const parsed = readRgbProfile(makeRgbProfile({ rawCurve }));
      expect(curveValue(parsed.curves[0], 0.25)).toBe(count ? 0.125 : 0.25);
    }
    for (const n of [2, 7, 4096]) {
      const values = Array.from(
        { length: n },
        (_, i) => Math.round((i / (n - 1)) ** 2 * 65535) / 65535,
      );
      const curve: Curve = { kind: 'table', values };
      const parsed = readRgbProfile(makeRgbProfile({ curves: [curve, curve, curve] }));
      expect(parsed.curves[0]).toEqual(curve);
      for (const x of [0.17, 0.5, 0.73]) {
        const position = x * (n - 1),
          a = Math.floor(position),
          f = position - a;
        const expected = values[a] * (1 - f) + values[a + 1] * f;
        expect(curveValue(curve, x)).toBeCloseTo(expected, 12);
        expect(curveValue(curve, expected, true)).toBeCloseTo(x, 12);
      }
      const packed = packColorTransform(colorTransform(parsed, srgbProfile), n > 17 ? 64 : 17);
      expect(packed.width).toBe(n > 17 ? 64 : 17);
      const pointer = packed.data[20],
        length = packed.data[21];
      expect(length).toBe(n);
      for (let i = 0; i < n; i++) expect(packed.data[pointer + i]).toBeCloseTo(values[i], 7);
    }
  });

  it('preserves shared tag payloads and never applies a device chromatic adaptation twice', () => {
    const chad = new Uint8Array(44);
    chad.set(new TextEncoder().encode('sf32'));
    const a = makeRgbProfile(),
      b = makeRgbProfile({ extras: [{ name: 'chad', data: chad }] });
    expect(readRgbProfile(a)).toEqual(readRgbProfile(b));
    const v = new DataView(a.buffer),
      r = 132 + 4 * 12;
    for (const i of [5, 6]) {
      v.setUint32(132 + i * 12 + 4, v.getUint32(r + 4));
      v.setUint32(132 + i * 12 + 8, v.getUint32(r + 8));
    }
    expect(readRgbProfile(a).curves[0]).toEqual(readRgbProfile(a).curves[2]);
    const shared = readRgbProfile(a);
    expect(shared.curves[0]).toBe(shared.curves[2]);
  });

  it('rejects malformed boundaries, selected unsupported LUTs and undefined matrices/curves', () => {
    expect(() => readRgbProfile(new Uint8Array(131))).toThrow('header');
    for (const mutate of [
      (v: DataView) => v.setUint32(0, v.byteLength + 1),
      (v: DataView) => v.setUint32(128, 0xffffffff),
      (v: DataView) => v.setUint32(136, 20),
      (v: DataView) => v.setUint32(140, 0xffffffff),
      (v: DataView) => v.setUint32(148, v.getUint32(136) + 4),
    ]) {
      const bytes = makeRgbProfile();
      mutate(new DataView(bytes.buffer));
      expect(() => readRgbProfile(bytes)).toThrow();
    }
    expect(() => readRgbProfile(makeRgbProfile({ matrix: new Array(9).fill(0) }))).toThrow(
      'Singular',
    );
    for (const name of ['A2B0', 'A2B1', 'D2B1'])
      expect(() =>
        readRgbProfile(makeRgbProfile({ extras: [{ name, data: new Uint8Array(8) }] })),
      ).toThrow('LUT');
    for (const curve of [
      { kind: 'parametric' as const, type: 0, parameters: [0] },
      { kind: 'parametric' as const, type: 1, parameters: [2, 0, 0] },
      { kind: 'parametric' as const, type: 4, parameters: [2, 1, -0.5, 0.25, 0.1, 0, 0] },
      { kind: 'table' as const, values: [0, 0.9, 0.2, 1] },
    ])
      expect(() => readRgbProfile(makeRgbProfile({ rawCurve: encodeCurve(curve) }))).toThrow();
    const identity = multiplyMatrix(inverseMatrix(srgbProfile.matrix), srgbProfile.matrix);
    identity.forEach((n, i) => expect(n).toBeCloseTo(i % 4 === 0 ? 1 : 0, 12));
  });
  it('shares sampled TRCs in GPU storage and rejects invalid packing limits', () => {
    const values = Array.from({ length: 4096 }, (_, i) => i / 4095);
    const rawCurve = encodeCurve({ kind: 'table', values });
    const encoded = makeRgbProfile({ rawCurve }),
      view = new DataView(encoded.buffer);
    for (const i of [5, 6]) {
      view.setUint32(132 + i * 12 + 4, view.getUint32(132 + 4 * 12 + 4));
      view.setUint32(132 + i * 12 + 8, view.getUint32(132 + 4 * 12 + 8));
    }
    const profile = readRgbProfile(encoded);
    const packed = packColorTransform(colorTransform(profile, profile), 64);
    const pointers = [0, 1, 2, 3, 4, 5].map((i) => packed.data[20 + i * 12]);
    expect(new Set(pointers).size).toBe(1);
    expect(packed.data.length).toBeLessThan(4096 + 84 + 64 * 4);
    for (const limit of [0, -1, 1.5, Infinity])
      expect(() => packColorTransform(colorTransform(profile, profile), limit)).toThrow('limit');
    expect(() => packColorTransform(colorTransform(profile, profile), 1)).toThrow('limits');
  });
});
