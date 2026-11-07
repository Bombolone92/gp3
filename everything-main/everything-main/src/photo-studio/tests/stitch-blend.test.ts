import { describe, expect, it } from 'vitest';
import { blendPanorama, blendStack, compositeMasked, sharpness, type Placed } from '../src/imaging/stitch/blend';
import { gaussianRGBA } from '../src/imaging/filters/common';
import { crop, gain, scene } from './stitch-fixtures';

/** Largest step of the composite/scene brightness ratio between neighbours along rows. */
function ratioStep(out: { width: number; height: number; data: Uint8ClampedArray }, truth: { data: Uint8ClampedArray }, x0: number, x1: number) {
  let worst = 0;
  for (let y = 10; y < out.height - 10; y += 7) {
    let prev = -1;
    for (let x = x0; x < x1; x++) {
      const o = (y * out.width + x) * 4;
      const a = out.data[o] + out.data[o + 1] + out.data[o + 2],
        b = truth.data[o] + truth.data[o + 1] + truth.data[o + 2];
      if (b < 120 || out.data[o] >= 254 || out.data[o + 1] >= 254 || out.data[o + 2] >= 254) {
        prev = -1;
        continue;
      }
      const r = a / b;
      if (prev >= 0) worst = Math.max(worst, Math.abs(r - prev));
      prev = r;
    }
  }
  return worst;
}

describe('panorama blending', () => {
  const big = scene(520, 200, 4);
  const left = crop(big, 0, 0, 320, 200);
  const right = gain(crop(big, 200, 0, 320, 200), 0.8);
  const items: Placed[] = [
    { image: left, x: 0, y: 0 },
    { image: right, x: 200, y: 0 },
  ];
  const canvas = { x: 0, y: 0, width: 520, height: 200 };

  it('assigns every covered pixel to exactly one image', () => {
    const { masks } = blendPanorama(items, canvas, { seamless: false });
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 520; x++) {
        let owners = 0;
        items.forEach((it, k) => {
          const lx = x - it.x;
          if (lx >= 0 && lx < it.image.width && masks[k].data[y * it.image.width + lx] === 255) owners++;
        });
        expect(owners).toBe(1);
      }
    // The seam lies inside the overlap.
    expect(masks[0].data[100 * 320 + 10]).toBe(255);
    expect(masks[1].data[100 * 320 + 310]).toBe(255);
  });

  it('makes tones continuous across the seam', () => {
    const hard = compositeMasked(items, blendPanorama(items, canvas, { seamless: false }).masks, canvas);
    const r = blendPanorama(items, canvas, { seamless: true });
    const soft = compositeMasked(items.map((it, k) => ({ ...it, image: r.images[k] })), r.masks, canvas);
    const jumpHard = ratioStep(hard, big, 150, 370);
    const jumpSoft = ratioStep(soft, big, 150, 370);
    expect(jumpHard).toBeGreaterThan(0.15);
    expect(jumpSoft).toBeLessThan(0.06);
  });
});

describe('focus stacking', () => {
  it('keeps the sharp half of each image', () => {
    const sharp = scene(240, 160, 8);
    const blurred = gaussianRGBA(sharp, 3);
    // Image 0 is sharp on the left, image 1 on the right.
    const a = { width: 240, height: 160, data: new Uint8ClampedArray(sharp.data) };
    const b = { width: 240, height: 160, data: new Uint8ClampedArray(sharp.data) };
    for (let y = 0; y < 160; y++)
      for (let x = 0; x < 240; x++) {
        const o = (y * 240 + x) * 4;
        for (let c = 0; c < 4; c++) {
          if (x >= 120) a.data[o + c] = blurred.data[o + c];
          else b.data[o + c] = blurred.data[o + c];
        }
      }
    expect(sharpness(sharp, 2)[80 * 240 + 60]).toBeGreaterThanOrEqual(0);
    const r = blendStack([a, b], { seamless: false });
    const out = compositeMasked([{ image: a, x: 0, y: 0 }, { image: b, x: 0, y: 0 }], r.masks, { x: 0, y: 0, width: 240, height: 160 });
    let err = 0,
      count = 0;
    for (let y = 10; y < 150; y++)
      for (let x = 10; x < 230; x++) {
        if (Math.abs(x - 120) < 12) continue;
        const o = (y * 240 + x) * 4;
        err += Math.abs(out.data[o] - sharp.data[o]);
        count++;
      }
    expect(err / count).toBeLessThan(3);
  });
});
