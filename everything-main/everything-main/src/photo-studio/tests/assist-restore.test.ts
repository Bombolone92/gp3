import { describe, expect, it } from 'vitest';
import { rgba8, type RGBA8 } from '../src/imaging/types';
import { gaussianPlane } from '../src/imaging/filters/common';
import { reduceNoise } from '../src/imaging/filters/noise';
import { deconvolve, denoise, denoiseOp, diskBlur, estimateNoise, nlMeans, sharpenDetailsOp } from '../src/imaging/filters/restore';
import { addNoise, gray, psnr, testCard } from './assist-fixtures';

const ctx = { foreground: [0, 0, 0] as [number, number, number], background: [255, 255, 255] as [number, number, number] };
function lumaOf(img: RGBA8) {
  const out = new Float32Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = gray(img, i % img.width, Math.floor(i / img.width));
  return out;
}
function blurImage(img: RGBA8, sigma: number): RGBA8 {
  const { width: w, height: h } = img, n = w * h, out = rgba8(w, h);
  for (let c = 0; c < 4; c++) {
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = img.data[i * 4 + c];
    gaussianPlane(p, new Float32Array(n), w, h, sigma);
    for (let i = 0; i < n; i++) out.data[i * 4 + c] = p[i];
  }
  return out;
}

describe('noise estimation', () => {
  it('measures added Gaussian noise and ignores edges', () => {
    const clean = testCard(160, 160);
    expect(estimateNoise(lumaOf(clean), 160, 160)).toBeLessThan(1);
    for (const s of [5, 12, 25]) {
      const est = estimateNoise(lumaOf(addNoise(clean, s, 3, false)), 160, 160);
      expect(est).toBeGreaterThan(s * 0.8);
      expect(est).toBeLessThan(s * 1.25);
    }
  });
});

describe('Denoise', () => {
  it('improves PSNR well beyond the input and the bilateral Reduce Noise filter', () => {
    const clean = testCard(160, 160);
    const noisy = addNoise(clean, 14, 11);
    const before = psnr(clean, noisy);
    const out = denoise(noisy, { strength: 0.5, color: 0.6, detail: 0.35 });
    const after = psnr(clean, out);
    const classic = psnr(clean, reduceNoise.apply(noisy, {}, ctx) as RGBA8);
    expect(after - before).toBeGreaterThan(5);
    expect(after).toBeGreaterThan(classic + 0.5);
    // Alpha is untouched.
    expect(out.data[3]).toBe(255);
  });
  it('keeps edges sharp while flattening noise', () => {
    const clean = testCard(160, 160);
    const out = denoise(addNoise(clean, 12, 5, false), { strength: 0.6, color: 0.5, detail: 0.3 });
    // The yellow square's left edge (x ~ 24) stays a step, not a ramp.
    const y = 56;
    const step = gray(out, 26, y) - gray(out, 22, y);
    const ref = gray(clean, 26, y) - gray(clean, 22, y);
    expect(step).toBeGreaterThan(ref * 0.8);
  });
  it('leaves a clean image nearly unchanged and runs through the operation', () => {
    const clean = testCard(96, 96);
    const out = denoiseOp.apply(clean, {}, ctx) as RGBA8;
    expect(psnr(clean, out)).toBeGreaterThan(38);
    const flat = new Float32Array(64).fill(100);
    expect([...nlMeans(flat, 8, 8, 5, 1)].every((v) => Math.abs(v - 100) < 1e-4)).toBe(true);
  });
  it('preserves transparent pixels', () => {
    const img = addNoise(testCard(48, 48), 10);
    for (let i = 3; i < img.data.length; i += 8) img.data[i] = 0;
    const out = denoise(img, { strength: 0.5, color: 0.5, detail: 0.3 });
    for (let i = 3; i < img.data.length; i += 4) expect(out.data[i]).toBe(img.data[i]);
  });
});

describe('Sharpen Details (deconvolution)', () => {
  it('restores a Gaussian-blurred image: higher PSNR and steeper edges', () => {
    const sharp = testCard(128, 128);
    const blurred = addNoise(blurImage(sharp, 1.5), 1, 2, false);
    const out = deconvolve(blurred, { model: 'gaussian', radius: 1.5, iterations: 20, noise: 0.2, amount: 1 });
    expect(psnr(sharp, out, 4)).toBeGreaterThan(psnr(sharp, blurred, 4) + 1.5);
    // 10–90% rise distance across the disc edge (a dark disc on a light ramp).
    const rise = (img: RGBA8) => {
      const y = 79, row = Array.from({ length: 30 }, (_, k) => gray(img, 100 + k, y));
      const lo = Math.min(...row), hi = Math.max(...row);
      const a = row.findIndex((v) => v > lo + 0.1 * (hi - lo)), b = row.findIndex((v) => v > lo + 0.9 * (hi - lo));
      return b - a;
    };
    expect(rise(out)).toBeLessThan(rise(blurred));
  });
  it('raises modulation (MTF) of fine detail without amplifying flat noise', () => {
    const w = 96, h = 32, img = rgba8(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = 128 + 80 * Math.sin(2 * Math.PI * 0.16 * x) * (y < 16 ? 1 : 0);
        img.data.set([v, v, v, 255], (y * w + x) * 4);
      }
    const blurred = addNoise(blurImage(img, 1.2), 2, 9, false);
    const out = deconvolve(blurred, { model: 'gaussian', radius: 1.2, iterations: 15, noise: 0.4, amount: 1 });
    const contrast = (im: RGBA8) => {
      const row = Array.from({ length: 60 }, (_, k) => gray(im, 18 + k, 8));
      return Math.max(...row) - Math.min(...row);
    };
    const flatStd = (im: RGBA8) => {
      const vals = Array.from({ length: 60 }, (_, k) => gray(im, 18 + k, 26));
      const m = vals.reduce((a, b) => a + b) / vals.length;
      return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
    };
    expect(contrast(out) / contrast(blurred)).toBeGreaterThan(1.3);
    expect(flatStd(out)).toBeLessThan(flatStd(blurred) * 1.6);
  });
  it('supports a lens (disk) blur model and the operation wrapper', () => {
    const p = new Float32Array(25);
    p[12] = 25;
    const b = diskBlur(p, 5, 5, 1);
    expect(b.reduce((a, v) => a + v, 0)).toBeCloseTo(25, 3);
    expect(b[12]).toBeCloseTo(b[7], 5);
    const sharp = testCard(64, 64);
    const out = sharpenDetailsOp.apply(sharp, { model: 'lens', radius: 1, iterations: 4 }, ctx) as RGBA8;
    expect(out.width).toBe(64);
    expect(psnr(sharp, out)).toBeGreaterThan(20);
  });
});
