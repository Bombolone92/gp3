import { describe, expect, it } from 'vitest';
import { mask8, rgba8, type RGBA8 } from '../src/imaging/types';
import { KNOWN, UNKNOWN, solveMembrane } from '../src/imaging/retouch/poisson';
import { cropRGBA, heal, spotHeal } from '../src/imaging/retouch/heal';
import { contextFill, contextFillSmall } from '../src/imaging/retouch/context-fill';
import { detectRedEye, redEye } from '../src/imaging/retouch/red-eye';
import { rasterizeEllipse, rasterizeRect } from '../src/imaging/segment/mask-ops';
import { photoLike, stripes } from './retouch-fixtures';

const px = (img: RGBA8, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

describe('membrane solver', () => {
  it('reproduces a linear (harmonic) function from its boundary values', () => {
    const w = 61, h = 47, type = new Uint8Array(w * h), val = new Float32Array(w * h * 2);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x, edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        type[i] = edge ? KNOWN : UNKNOWN;
        if (edge) {
          val[i * 2] = 3 * x + 2 * y;
          val[i * 2 + 1] = 100 - y;
        }
      }
    solveMembrane(val, type, w, h, 2);
    let err = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) err = Math.max(err, Math.abs(val[(y * w + x) * 2] - (3 * x + 2 * y)), Math.abs(val[(y * w + x) * 2 + 1] - (100 - y)));
    expect(err).toBeLessThan(0.5);
  });
  it('treats ignored cells as free (Neumann) edges', () => {
    // A 1D strip known at both ends with an ignored row beside it.
    const w = 20, h = 2, type = new Uint8Array(w * h), val = new Float32Array(w * h);
    for (let x = 0; x < w; x++) type[x] = UNKNOWN;
    type[0] = type[w - 1] = KNOWN;
    val[0] = 0;
    val[w - 1] = 19;
    solveMembrane(val, type, w, h, 1);
    for (let x = 0; x < w; x++) expect(val[x]).toBeCloseTo(x, 0);
    expect(val[w + 5]).toBe(0);
  });
});

describe('healing', () => {
  function gradient(w: number, h: number) {
    const img = rgba8(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set([40 + 2 * x, 60 + y, 200 - x, 255], (y * w + x) * 4);
    return img;
  }
  it('matches the destination at the boundary and keeps the source detail', () => {
    const dst = gradient(100, 80);
    // A bright textured patch: checkerboard detail on a very different base.
    const pw = 32, ph = 32, src = rgba8(pw, ph);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const v = (x + y) % 2 ? 230 : 210; src.data.set([v, v, v, 255], (y * pw + x) * 4); }
    const m = rasterizeEllipse(16, 16, 14, 14, pw, ph, { antiAlias: false });
    const out = heal(dst, src, m, { x: 30, y: 20 });
    // Continuity: just inside versus just outside the circle along a row.
    const y = 20 + 16;
    let inside = -1;
    for (let u = 0; u < pw; u++) if (m.data[16 * pw + u]) { inside = u; break; }
    const a = px(out, 30 + inside, y), b = px(out, 30 + inside - 1, y);
    for (let c = 0; c < 3; c++) expect(Math.abs(a[c] - b[c])).toBeLessThan(18);
    // Detail: neighboring centre pixels still differ by the checkerboard step.
    const c0 = px(out, 46, 36), c1 = px(out, 47, 36);
    expect(Math.abs(c0[0] - c1[0])).toBeGreaterThan(14);
    expect(Math.abs(c0[0] - c1[0])).toBeLessThan(26);
    // Outside the mask nothing changes.
    expect(px(out, 5, 5)).toEqual(px(dst, 5, 5));
    expect(px(dst, 46, 36)).not.toEqual(c0);
  });
  it('healing a patch from the same smooth image is (nearly) the identity', () => {
    const dst = gradient(80, 60);
    const src = cropRGBA(dst, { x: 10, y: 10, width: 20, height: 20 });
    const m = rasterizeRect(2, 2, 16, 16, 20, 20, { antiAlias: false });
    const out = heal(dst, src, m, { x: 40, y: 30 });
    for (let y = 32; y < 48; y++) for (let x = 42; x < 58; x++) for (let c = 0; c < 3; c++) expect(Math.abs(out.data[(y * 80 + x) * 4 + c] - dst.data[(y * 80 + x) * 4 + c])).toBeLessThanOrEqual(2);
  });
  it('clips patches hanging off the canvas and supports in-place use', () => {
    const dst = gradient(30, 30), src = rgba8(10, 10, [255, 0, 0, 255]), m = mask8(10, 10, 255);
    const out = heal(dst, src, m, { x: -5, y: 25 }, { inPlace: true });
    expect(out).toBe(dst);
  });
  it('spot healing removes a dark blemish from a smooth gradient in every mode', () => {
    for (const mode of ['proximity', 'texture', 'context'] as const) {
      const clean = gradient(120, 90), img = gradient(120, 90);
      const spot = rasterizeEllipse(60, 45, 6, 6, 120, 90);
      for (let i = 0; i < spot.data.length; i++) if (spot.data[i]) img.data.set([10, 10, 10, 255], i * 4);
      const dab = rasterizeEllipse(60, 45, 9, 9, 120, 90);
      const out = spotHeal(img, dab, mode, 3);
      let err = 0;
      for (let i = 0; i < spot.data.length; i++) if (spot.data[i]) for (let c = 0; c < 3; c++) err = Math.max(err, Math.abs(out.data[i * 4 + c] - clean.data[i * 4 + c]));
      expect(err, mode).toBeLessThan(25);
    }
  }, 60000);
});

describe('context fill', () => {
  it('reproduces a periodic stripe pattern inside the hole', () => {
    const w = 160, h = 120, img = stripes(w, h, 8, 3);
    const truth = stripes(w, h, 8, 3);
    const hole = rasterizeRect(64, 44, 30, 30, w, h, { antiAlias: false });
    for (let i = 0; i < hole.data.length; i++) if (hole.data[i]) img.data.set([255, 0, 255, 255], i * 4);
    const out = contextFill(img, hole, { seed: 1 });
    let good = 0, total = 0;
    for (let i = 0; i < hole.data.length; i++) {
      if (!hole.data[i]) continue;
      total++;
      let e = 0;
      for (let c = 0; c < 3; c++) e = Math.max(e, Math.abs(out.data[i * 4 + c] - truth.data[i * 4 + c]));
      if (e < 40) good++;
    }
    expect(good / total).toBeGreaterThan(0.9);
    // Pixels outside the hole are untouched.
    expect(px(out, 5, 5)).toEqual(px(truth, 5, 5));
  });
  it('the brush fast path also continues stripes', () => {
    const w = 200, h = 150, img = stripes(w, h, 8, 3), truth = stripes(w, h, 8, 3);
    const dab = rasterizeEllipse(100, 75, 14, 14, w, h);
    for (let i = 0; i < dab.data.length; i++) if (dab.data[i]) img.data.set([255, 0, 255, 255], i * 4);
    const out = contextFillSmall(img, dab, { seed: 2 });
    let good = 0, total = 0;
    for (let i = 0; i < dab.data.length; i++) {
      if (dab.data[i] < 255) continue;
      total++;
      if (Math.abs(out.data[i * 4] - truth.data[i * 4]) < 40 && Math.abs(out.data[i * 4 + 1] - truth.data[i * 4 + 1]) < 40) good++;
    }
    expect(good / total).toBeGreaterThan(0.85);
  });
  it('is deterministic for a seed and returns a copy for an empty hole', () => {
    const img = photoLike(120, 90, 2), hole = rasterizeEllipse(60, 45, 12, 10, 120, 90);
    const a = contextFill(img, hole, { seed: 9 }), b = contextFill(img, hole, { seed: 9 });
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    const c = contextFill(img, mask8(120, 90));
    expect(c).not.toBe(img);
    expect(Buffer.from(c.data).equals(Buffer.from(img.data))).toBe(true);
  });
  it('respects the sampling region and never copies from outside it', () => {
    // Left half red, right half green; hole on the boundary, sampling only green.
    const w = 100, h = 60, img = rgba8(w, h, [0, 200, 0, 255]);
    for (let y = 0; y < h; y++) for (let x = 0; x < 50; x++) img.data.set([200, 0, 0, 255], (y * w + x) * 4);
    const hole = rasterizeRect(40, 20, 20, 20, w, h, { antiAlias: false });
    const sampling = rasterizeRect(60, 0, 40, 60, w, h, { antiAlias: false });
    const out = contextFill(img, hole, { sampling, colorAdaptation: 'none' });
    for (let y = 22; y < 38; y++) for (let x = 42; x < 58; x++) expect(out.data[(y * w + x) * 4]).toBeLessThan(30);
  });
  it('mirror, scale and rotation variants still fill plausibly', () => {
    const w = 120, h = 90, img = stripes(w, h, 10, 4), hole = rasterizeRect(50, 35, 20, 20, w, h, { antiAlias: false });
    const out = contextFill(img, hole, { mirror: true, scale: true, rotationAdaptation: 'low', colorAdaptation: 'high' });
    let bad = 0;
    for (let i = 0; i < hole.data.length; i++) if (hole.data[i] && Math.abs(out.data[i * 4] - img.data[i * 4]) > 60) bad++;
    expect(bad / 400).toBeLessThan(0.2);
  });
  it('fills transparent surroundings with transparency', () => {
    const img = rgba8(60, 60, [0, 0, 0, 0]), hole = rasterizeRect(25, 25, 10, 10, 60, 60, { antiAlias: false });
    for (let i = 0; i < hole.data.length; i++) if (hole.data[i]) img.data.set([255, 0, 0, 255], i * 4);
    const out = contextFill(img, hole);
    expect(out.data[(30 * 60 + 30) * 4 + 3]).toBe(0);
  });
  it('fills a 200x200 hole in a 2000x1500 photo-like image', () => {
    const img = photoLike(2000, 1500), hole = rasterizeEllipse(1000, 700, 100, 100, 2000, 1500);
    const t0 = performance.now();
    const out = contextFill(img, hole, { seed: 1 });
    const t1 = performance.now();
    const small = rasterizeEllipse(600, 500, 30, 30, 2000, 1500);
    const t2 = performance.now();
    const out2 = contextFillSmall(img, small, { seed: 1 });
    const t3 = performance.now();
    process.stderr.write(`\n[timing] contextFill 200x200 hole in 2000x1500: ${(t1 - t0).toFixed(0)} ms; contextFillSmall 60 px dab: ${(t3 - t2).toFixed(0)} ms\n`);
    expect(out.data[(700 * 2000 + 1000) * 4 + 3]).toBe(255);
    expect(out2.width).toBe(2000);
    expect(t1 - t0).toBeLessThan(20000);
  }, 120000);
});

describe('red eye', () => {
  function eye() {
    const img = rgba8(80, 60, [200, 170, 150, 255]);
    const iris = rasterizeEllipse(40, 30, 14, 14, 80, 60), pupil = rasterizeEllipse(40, 30, 7, 7, 80, 60), glint = rasterizeEllipse(42, 28, 1.5, 1.5, 80, 60);
    for (let i = 0; i < iris.data.length; i++) {
      if (iris.data[i] > 128) img.data.set([90, 110, 120, 255], i * 4);
      if (pupil.data[i] > 128) img.data.set([200, 30, 35, 255], i * 4);
      if (glint.data[i] > 128) img.data.set([250, 250, 250, 255], i * 4);
    }
    return img;
  }
  it('detects the pupil and neutralizes it, keeping the catchlight and iris', () => {
    const img = eye(), p = detectRedEye(img, { x: 38, y: 31 });
    expect(p).not.toBeNull();
    expect(Math.abs(p!.cx - 40)).toBeLessThan(1.5);
    expect(Math.abs(p!.r - 7)).toBeLessThan(1.5);
    const out = redEye(img, { x: 38, y: 31 }, 50, 50);
    const c = px(out, 37, 33);
    expect(c[0] - Math.max(c[1], c[2])).toBeLessThan(10);
    expect(c[0]).toBeLessThan(60);
    expect(px(out, 42, 28)).toEqual(px(img, 42, 28));
    expect(px(out, 40, 19)).toEqual(px(img, 40, 19));
    expect(px(out, 5, 5)).toEqual(px(img, 5, 5));
  });
  it('accepts a rectangle and leaves images without red eyes unchanged', () => {
    const out = redEye(eye(), { x: 20, y: 10, width: 40, height: 40 });
    const c = px(out, 40, 32);
    expect(c[0] - c[1]).toBeLessThan(10);
    const plain = rgba8(40, 40, [90, 110, 120, 255]);
    expect(Buffer.from(redEye(plain, { x: 20, y: 20 }).data).equals(Buffer.from(plain.data))).toBe(true);
  });
});
