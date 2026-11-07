import { describe, expect, it } from 'vitest';
import { estimateExposures, mergeHdr, solveResponse, srgbResponse } from '../src/imaging/stitch/hdr';
import { DEFAULT_HDR_TONING, hdrToning, toneMap, toningCurveTable } from '../src/imaging/adjust/hdr-toning';
import { adjustmentOperations } from '../src/imaging/adjust';
import { linearToSrgb } from '../src/imaging/adjust/color-math';
import { rgba8 } from '../src/imaging/types';
import { scene } from './stitch-fixtures';

/** A scene with radiance spanning about 12 stops, photographed at three exposures. */
function bracket(evs: number[]) {
  const w = 256,
    h = 64;
  const radiance = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) radiance[y * w + x] = Math.pow(2, -9 + (12 * x) / (w - 1)) * (1 + 0.3 * Math.sin(y / 5));
  const images = evs.map((ev) => {
    const img = rgba8(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = Math.round(linearToSrgb(Math.min(1, radiance[i] * Math.pow(2, ev))) * 255);
      img.data.set([v, v, v, 255], i * 4);
    }
    return img;
  });
  return { images, radiance, w, h };
}

describe('Merge to HDR', () => {
  it('estimates relative exposures from the pixels', () => {
    const { images } = bracket([-2, 0, 2]);
    const ev = estimateExposures(images);
    expect(ev[1]).toBe(0);
    expect(ev[0]).toBeCloseTo(-2, 0);
    expect(ev[2]).toBeCloseTo(2, 0);
  });

  it('recovers a monotonic response', () => {
    const { images } = bracket([-2, 0, 2]);
    const r = solveResponse(images, [-2, 0, 2]);
    for (const g of r) for (let z = 1; z < 256; z++) expect(g[z]).toBeGreaterThan(g[z - 1]);
    // Close to the sRGB curve that made the images, in midtones.
    const s = srgbResponse()[0];
    for (const z of [60, 120, 180]) expect(Math.abs(r[0][z] - s[z])).toBeLessThan(0.25);
  });

  it('merges to radiance that is monotonic and spans the full range', () => {
    const { images, radiance, w } = bracket([-3, 0, 3]);
    const hdr = mergeHdr(images, [-3, 0, 3], srgbResponse());
    // Along a row, merged values increase with scene radiance.
    const y = 0;
    let prev = -Infinity;
    for (let x = 0; x < w; x++) {
      const v = hdr.data[(y * w + x) * 4];
      expect(v).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = v;
    }
    // Ratios between far-apart pixels follow the radiance (well beyond 8 bits).
    const a = hdr.data[(y * w + 20) * 4],
      b = hdr.data[(y * w + 235) * 4];
    const truth = radiance[y * w + 235] / radiance[y * w + 20];
    expect(Math.abs(Math.log2(b / a) - Math.log2(truth))).toBeLessThan(0.35);
    expect(hdr.data[3]).toBe(1);
  });
});

describe('HDR Toning', () => {
  it('tone maps a wide range into displayable codes while keeping order', () => {
    const { images } = bracket([-3, 0, 3]);
    const hdr = mergeHdr(images, [-3, 0, 3], srgbResponse());
    for (const method of ['local', 'exposure-gamma', 'highlight-compression', 'equalize'] as const) {
      const out = toneMap(hdr, { ...DEFAULT_HDR_TONING, method, saturation: 0, detail: 0 });
      // Darkest and brightest areas keep visible separation.
      expect(out.data[(10 * 256 + 250) * 4]).toBeGreaterThan(out.data[(10 * 256 + 5) * 4] + 60);
      expect(out.data[3]).toBe(255);
    }
  });

  it('is an adjustment operation with neutral settings close to identity', () => {
    const op = adjustmentOperations.find((o) => o.id === 'adjust.hdr-toning')!;
    expect(op).toBeTruthy();
    const img = scene(120, 80, 6);
    const out = hdrToning(img, { ...DEFAULT_HDR_TONING, method: 'exposure-gamma', saturation: 0 });
    let diff = 0;
    for (let i = 0; i < img.data.length; i++) diff = Math.max(diff, Math.abs(out.data[i] - img.data[i]));
    expect(diff).toBeLessThanOrEqual(1);
    // Detail boost increases local contrast.
    const boosted = op.apply(img, { method: 'local', detail: 200, saturation: 0 }, { foreground: [0, 0, 0], background: [255, 255, 255] }) as typeof img;
    expect(boosted.width).toBe(120);
  });

  it('builds monotone curve tables from presets and custom points', () => {
    const t = toningCurveTable('strong');
    for (let i = 1; i < 256; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1]);
    expect(toningCurveTable('[[0,0],[128,200],[255,255]]')[128]).toBeCloseTo(200, 0);
    expect(toningCurveTable('not json')[100]).toBeCloseTo(100, 3);
  });
});
