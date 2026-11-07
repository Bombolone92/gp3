import { describe, expect, it } from 'vitest';
import { deltaE2000, deltaE76 } from '../src/color/delta-e';
import {
  bradfordMatrix,
  D50,
  D65,
  decodeLab,
  encodeLab,
  labToXYZ,
  rgbToXYZMatrix,
  xyzToLab,
} from '../src/color/color-math';

// Sharma, Wu & Dalal (2005), Table 1: L1 a1 b1, L2 a2 b2, ΔE00.
const SHARMA: number[][] = [
  [50, 2.6772, -79.7751, 50, 0, -82.7485, 2.0425],
  [50, 3.1571, -77.2803, 50, 0, -82.7485, 2.8615],
  [50, 2.8361, -74.02, 50, 0, -82.7485, 3.4412],
  [50, -1.3802, -84.2814, 50, 0, -82.7485, 1.0],
  [50, -1.1848, -84.8006, 50, 0, -82.7485, 1.0],
  [50, -0.9009, -85.5211, 50, 0, -82.7485, 1.0],
  [50, 0, 0, 50, -1, 2, 2.3669],
  [50, -1, 2, 50, 0, 0, 2.3669],
  [50, 2.49, -0.001, 50, -2.49, 0.0009, 7.1792],
  [50, 2.49, -0.001, 50, -2.49, 0.001, 7.1792],
  [50, 2.49, -0.001, 50, -2.49, 0.0011, 7.2195],
  [50, 2.49, -0.001, 50, -2.49, 0.0012, 7.2195],
  [50, -0.001, 2.49, 50, 0.0009, -2.49, 4.8045],
  [50, -0.001, 2.49, 50, 0.001, -2.49, 4.8045],
  [50, -0.001, 2.49, 50, 0.0011, -2.49, 4.7461],
  [50, 2.5, 0, 50, 0, -2.5, 4.3065],
  [50, 2.5, 0, 73, 25, -18, 27.1492],
  [50, 2.5, 0, 61, -5, 29, 22.8977],
  [50, 2.5, 0, 56, -27, -3, 31.903],
  [50, 2.5, 0, 58, 24, 15, 19.4535],
  [50, 2.5, 0, 50, 3.1736, 0.5854, 1.0],
  [50, 2.5, 0, 50, 3.2972, 0, 1.0],
  [50, 2.5, 0, 50, 1.8634, 0.5757, 1.0],
  [50, 2.5, 0, 50, 3.2592, 0.335, 1.0],
  [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
  [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.263],
  [61.2901, 3.7196, -5.3901, 61.4292, 2.248, -4.962, 1.8731],
  [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
  [22.7233, 20.0904, -46.694, 23.0331, 14.973, -42.5619, 2.0373],
  [36.4612, 47.858, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
  [90.8027, -2.0831, 1.441, 91.1528, -1.6435, 0.0447, 1.4441],
  [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
  [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
  [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
];

describe('color math', () => {
  it('matches every CIEDE2000 test pair published by Sharma et al. 2005', () => {
    for (const row of SHARMA) {
      expect(deltaE2000(row.slice(0, 3), row.slice(3, 6))).toBeCloseTo(row[6], 4);
      // The formula is symmetric.
      expect(deltaE2000(row.slice(3, 6), row.slice(0, 3))).toBeCloseTo(row[6], 4);
    }
    expect(deltaE2000([50, 10, 10], [50, 10, 10])).toBe(0);
    expect(deltaE76([0, 0, 0], [3, 4, 0])).toBe(5);
  });

  it('derives the published Bradford D65 to D50 matrix', () => {
    // Lindbloom's tabulated Bradford matrix for these white points.
    const expected = [
      1.0478112, 0.0228866, -0.050127, 0.0295424, 0.9904844, -0.0170491, -0.0092345, 0.0150436,
      0.7521316,
    ];
    const m = bradfordMatrix(D65, [0.96422, 1, 0.82521]);
    m.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));
    // Adapting white to white is exact, and the inverse direction undoes it.
    const w = [0, 1, 2].map((r) => m[r * 3] * D65[0] + m[r * 3 + 1] * D65[1] + m[r * 3 + 2] * D65[2]);
    expect(w[0]).toBeCloseTo(0.96422, 10);
    expect(w[2]).toBeCloseTo(0.82521, 10);
  });

  it('builds D50-adapted colorant matrices whose columns sum to the PCS white', () => {
    const m = rgbToXYZMatrix([[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]], [0.3127, 0.329]);
    for (let r = 0; r < 3; r++) expect(m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2]).toBeCloseTo(D50[r], 10);
    // sRGB's red colorant after Bradford adaptation (ICC sRGB v4 rXYZ ≈ 0.4361 0.2225 0.0139).
    expect(m[0]).toBeCloseTo(0.4361, 3);
    expect(m[3]).toBeCloseTo(0.2225, 3);
    expect(m[6]).toBeCloseTo(0.0139, 3);
  });

  it('round-trips XYZ and Lab and encodes PCS Lab per ICC v2/v4', () => {
    for (const lab of [[0, 0, 0], [5, 3, -2], [50, 20, -40], [100, 0, 0], [72, -60, 80]]) {
      const back = xyzToLab(labToXYZ(lab));
      lab.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 9));
    }
    expect(xyzToLab(D50)).toEqual([100, 0, 0]);
    // v4: 0xFFFF is L = 100; legacy: 0xFF00 is L = 100 and 0x8000 is a = 0.
    expect(decodeLab([1, 0.5, 0.5], 'v4')[0]).toBe(100);
    expect(decodeLab([0xff00 / 65535, 0x8000 / 65535, 0x8000 / 65535], 'legacy')).toEqual([
      expect.closeTo(100, 9),
      expect.closeTo(0, 9),
      expect.closeTo(0, 9),
    ]);
    const n = encodeLab([50, -20, 30], 'legacy');
    expect(decodeLab(n, 'legacy')).toEqual([
      expect.closeTo(50, 9),
      expect.closeTo(-20, 9),
      expect.closeTo(30, 9),
    ]);
  });
});
