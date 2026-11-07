import { describe, expect, it } from 'vitest';
import { autoLensParams, estimateStraighten, estimateVignette, fillScale } from '../src/imaging/filters/lens-auto';
import { lensCorrection } from '../src/imaging/filters/lens';
import { SRGB_TO_LINEAR, encodeSRGB } from '../src/imaging/filters/sampling';
import type { RGBA8 } from '../src/imaging/types';

const ctx = { foreground: [0, 0, 0] as [number, number, number], background: [255, 255, 255] as [number, number, number] };

/** Stripes and a horizon line turned by `deg` degrees (counterclockwise on screen for positive). */
function tilted(deg: number, w = 320, h = 240): RGBA8 {
  const data = new Uint8ClampedArray(w * h * 4);
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t),
    s = Math.sin(t);
  // 4×4 supersampling, as a camera's anti-aliased edges would be.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 4; i++) {
          // Rotate the sample point back into the upright pattern.
          const dx = x + (i + 0.5) / 4 - w / 2,
            dy = y + (j + 0.5) / 4 - h / 2;
          const ux = c * dx - s * dy,
            uy = s * dx + c * dy;
          sum += (Math.floor(ux / 24) % 2 === 0 ? 200 : 60) + (uy < 0 ? 40 : 0);
        }
      const o = (y * w + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = sum / 16;
      data[o + 3] = 255;
    }
  return { width: w, height: h, data };
}

/** A flat gray image darkened toward the corners as gain 1 + 1.5 a t² would undo. */
function vignetted(amount: number, w = 300, h = 200): RGBA8 {
  const data = new Uint8ClampedArray(w * h * 4);
  const cx = w / 2,
    cy = h / 2,
    rn = 1 / Math.hypot(cx, cy);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) * rn;
      const t = r <= 0.45 ? 0 : (r - 0.45) / 0.55;
      const lin = SRGB_TO_LINEAR[170] / (1 + 1.5 * (amount / 100) * t * t);
      const o = (y * w + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = encodeSRGB(lin);
      data[o + 3] = 255;
    }
  return { width: w, height: h, data };
}

describe('automatic lens correction settings', () => {
  it('finds no rotation in an upright image', () => {
    expect(Math.abs(estimateStraighten(tilted(0)))).toBeLessThan(0.2);
  });
  it('measures a tilt and the correction makes the image upright', async () => {
    for (const deg of [3, -4.5]) {
      const img = tilted(deg);
      const angle = estimateStraighten(img);
      expect(Math.abs(Math.abs(angle) - Math.abs(deg))).toBeLessThan(0.4);
      const fixed = await lensCorrection.apply(img, { angle, edge: 'edge-extension' }, ctx);
      expect(Math.abs(estimateStraighten(fixed))).toBeLessThan(0.4);
    }
  });
  it('ignores images without a dominant direction', () => {
    const w = 200,
      h = 160;
    const data = new Uint8ClampedArray(w * h * 4);
    let seed = 7;
    const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647) * 255;
    for (let i = 0; i < data.length; i += 4) ((data[i] = data[i + 1] = data[i + 2] = rnd()), (data[i + 3] = 255));
    expect(estimateStraighten({ width: w, height: h, data })).toBe(0);
  });
  it('estimates vignetting and undoes it', async () => {
    expect(estimateVignette(vignetted(0))).toBe(0);
    const img = vignetted(60);
    const amount = estimateVignette(img);
    expect(amount).toBeGreaterThan(48);
    expect(amount).toBeLessThan(72);
    const fixed = await lensCorrection.apply(img, { vignetteAmount: amount, vignetteMidpoint: 50 }, ctx);
    const at = (x: number, y: number) => fixed.data[(y * fixed.width + x) * 4];
    expect(Math.abs(at(2, 2) - at(150, 100))).toBeLessThan(8);
  });
  it('scales a rotation to fill the frame and combines with given settings', () => {
    expect(fillScale(400, 300, 0)).toBe(100);
    expect(fillScale(400, 300, 5)).toBeGreaterThan(105);
    const p = autoLensParams(tilted(4), { distortion: 10 }, { straighten: true, vignette: false, fill: true });
    expect(p.distortion).toBe(10);
    expect(Math.abs(p.angle!)).toBeGreaterThan(3);
    expect(p.scale).toBeGreaterThan(100);
  });
});
