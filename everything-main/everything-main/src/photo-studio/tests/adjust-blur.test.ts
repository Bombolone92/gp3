import { describe, expect, it } from 'vitest';
import { blurChannel, boxRadiiForSigma } from '../src/imaging/adjust/blur';
import { localMean } from '../src/imaging/adjust/shadows-highlights';
import { rng } from './adjust-fixtures';

describe('box-cascade blur', () => {
  it('chooses box radii whose variance matches sigma', () => {
    for (const sigma of [1, 2.5, 7, 30]) {
      const radii = boxRadiiForSigma(sigma);
      // A box of width 2r + 1 has variance ((2r + 1)^2 - 1) / 12.
      const variance = radii.reduce((a, r) => a + ((2 * r + 1) ** 2 - 1) / 12, 0);
      expect(Math.abs(Math.sqrt(variance) - sigma)).toBeLessThan(0.6);
    }
  });

  it('keeps constants, preserves the mean of an impulse and spreads it by sigma', () => {
    const w = 101,
      h = 61;
    const flat = new Float32Array(w * h).fill(0.37);
    const fb = blurChannel(flat, w, h, 5);
    for (const v of fb) expect(v).toBeCloseTo(0.37, 5);
    const imp = new Float32Array(w * h);
    imp[30 * w + 50] = 1;
    const b = blurChannel(imp, w, h, 4);
    let sum = 0,
      mx = 0,
      vx = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        sum += b[y * w + x];
        mx += x * b[y * w + x];
      }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) vx += (x - 50) ** 2 * b[y * w + x];
    expect(sum).toBeCloseTo(1, 4);
    expect(mx).toBeCloseTo(50, 3);
    expect(Math.sqrt(vx)).toBeGreaterThan(3.4);
    expect(Math.sqrt(vx)).toBeLessThan(4.6);
    // Symmetric in x and y.
    expect(b[30 * w + 45]).toBeCloseTo(b[30 * w + 55], 6);
    expect(b[25 * w + 50]).toBeCloseTo(b[35 * w + 50], 6);
  });

  it('matches a direct separable box cascade, including the borders', () => {
    const w = 37,
      h = 23,
      r = rng(8);
    const img = Float32Array.from({ length: w * h }, () => r());
    const radii = boxRadiiForSigma(3);
    const box1d = (line: number[], rad: number) =>
      line.map((_, i) => {
        let s = 0;
        for (let k = -rad; k <= rad; k++) s += line[Math.min(line.length - 1, Math.max(0, i + k))];
        return s / (2 * rad + 1);
      });
    let ref = Array.from(img);
    for (const rad of radii) {
      for (let y = 0; y < h; y++) ref.splice(y * w, w, ...box1d(ref.slice(y * w, y * w + w), rad));
      const t = [...ref];
      for (let x = 0; x < w; x++) {
        const col = box1d(Array.from({ length: h }, (_, y) => t[y * w + x]), rad);
        for (let y = 0; y < h; y++) ref[y * w + x] = col[y];
      }
    }
    const got = blurChannel(img, w, h, 3);
    let worst = 0;
    for (let i = 0; i < w * h; i++) worst = Math.max(worst, Math.abs(got[i] - ref[i]));
    expect(worst).toBeLessThan(1e-5);
  });

  it('downsampled local mean approximates the full blur', () => {
    const w = 300,
      h = 200,
      r = rng(3);
    const img = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img[y * w + x] = 0.5 + 0.4 * Math.sin(x / 20) * Math.cos(y / 25) + (r() - 0.5) * 0.2;
    const full = blurChannel(img, w, h, 15),
      fast = localMean(img, w, h, 15);
    let worst = 0,
      interior = 0,
      mean = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const e = Math.abs(full[y * w + x] - fast[y * w + x]);
        mean += e / (w * h);
        worst = Math.max(worst, e);
        if (x >= 10 && y >= 10 && x < w - 10 && y < h - 10) interior = Math.max(interior, e);
      }
    // Borders differ slightly (clamped box versus clamped bilinear).
    expect(interior).toBeLessThan(0.02);
    expect(worst).toBeLessThan(0.05);
    expect(mean).toBeLessThan(0.006);
    expect(localMean(img, 5, 3, 40).length).toBe(15);
  });
});
