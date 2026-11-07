import { describe, expect, it } from 'vitest';
import {
  applyAdjustment,
  clarityDehaze,
  compileAdjustment,
  applyCompiled,
  defaultAdjustment,
  grain,
  grainHash,
  grainNoise,
  isIdentityAdjustment,
  lightToneCurve,
  luma,
  spatialGeometry,
  srgbToLinear,
  whiteBalanceGains,
  SPATIAL_WORK,
  type Adjustment,
} from '../src/imaging/adjust';
import { rgba8, type RGBA8 } from '../src/imaging/types';
import { layer, newDocument } from '../src/model/document';
import { Assets } from '../src/model/assets';
import { deserialize, serialize } from '../src/model/serialization';
import { specAdjustment } from '../src/features/adjust/spec';
import { compileSpatial } from '../src/features/adjust/compile';
import { diffStats, randomImage } from './adjust-fixtures';

// A soft scene: a smooth horizontal gradient with fine stripes on top.
function scene(w: number, h: number, haze = 0): RGBA8 {
  const img = rgba8(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const base = 60 + (120 * x) / w + ((x >> 2) & 1 ? 12 : -12);
      const c = [base * 1.1, base, base * 0.8].map((v) => v + (230 - v) * haze);
      img.data.set([c[0], c[1], c[2], 255], i);
    }
  return img;
}
const stdLuma = (img: RGBA8) => {
  const v: number[] = [];
  for (let i = 0; i < img.data.length; i += 4) v.push(luma(img.data[i], img.data[i + 1], img.data[i + 2]));
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
};
// Mean absolute luma difference between neighboring stripes (4 px apart).
const detail = (img: RGBA8) => {
  let s = 0,
    n = 0;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x + 4 < img.width; x += 4) {
      const i = (y * img.width + x) * 4,
        j = i + 16;
      s += Math.abs(luma(img.data[i], img.data[i + 1], img.data[i + 2]) - luma(img.data[j], img.data[j + 1], img.data[j + 2]));
      n++;
    }
  return s / n;
};

describe('spatial geometry', () => {
  it('reduces large images by an integer factor to the working size', () => {
    expect(spatialGeometry(800, 600)).toMatchObject({ factor: 1, width: 800, height: 600 });
    const g = spatialGeometry(6000, 4000);
    expect(g.factor).toBe(Math.ceil(6000 / SPATIAL_WORK));
    expect(g.width).toBe(Math.ceil(6000 / g.factor));
    expect(g.height).toBe(Math.ceil(4000 / g.factor));
    // The full-resolution radius follows the document size.
    expect(g.sigmaC * g.factor).toBeCloseTo(0.008 * 6000, 5);
    expect(g.radiusC).toBe(Math.ceil(3 * g.sigmaC));
  });
});

describe('Clarity & Dehaze', () => {
  it('is an identity at zero and keeps alpha', () => {
    const img = randomImage(40, 30, 3, true);
    expect(diffStats(clarityDehaze(img, { clarity: 0, dehaze: 0 }), img).max).toBe(0);
    expect(isIdentityAdjustment(defaultAdjustment('clarity-dehaze'))).toBe(true);
    const out = clarityDehaze(img, { clarity: 60, dehaze: 40 });
    for (let i = 3; i < img.data.length; i += 4) expect(out.data[i]).toBe(img.data[i]);
  });
  it('clarity raises local contrast and negative clarity softens it', () => {
    const img = scene(160, 40);
    const d0 = detail(img);
    expect(detail(clarityDehaze(img, { clarity: 80, dehaze: 0 }))).toBeGreaterThan(d0 * 1.15);
    expect(detail(clarityDehaze(img, { clarity: -80, dehaze: 0 }))).toBeLessThan(d0 * 0.85);
  });
  it('dehaze restores contrast of a hazy image; negative dehaze adds haze', () => {
    const hazy = scene(120, 40, 0.5);
    const s0 = stdLuma(hazy);
    const clear = clarityDehaze(hazy, { clarity: 0, dehaze: 80 });
    expect(stdLuma(clear)).toBeGreaterThan(s0 * 1.3);
    // Darkest values move down (haze lifted the blacks).
    const minLuma = (img: RGBA8) => {
      let m = 255;
      for (let i = 0; i < img.data.length; i += 4) m = Math.min(m, luma(img.data[i], img.data[i + 1], img.data[i + 2]));
      return m;
    };
    expect(minLuma(clear)).toBeLessThan(minLuma(hazy) - 20);
    const foggy = clarityDehaze(scene(120, 40), { clarity: 0, dehaze: -80 });
    expect(stdLuma(foggy)).toBeLessThan(stdLuma(scene(120, 40)) * 0.7);
  });
  it('transparent pixels stay untouched', () => {
    const img = scene(64, 16);
    for (let i = 0; i < 64 * 4 * 4; i += 4) img.data.set([10, 20, 30, 0], i);
    const out = clarityDehaze(img, { clarity: 100, dehaze: 100 });
    for (let i = 0; i < 64 * 4 * 4; i += 4) expect([...out.data.subarray(i, i + 4)]).toEqual([10, 20, 30, 0]);
  });
});

describe('Grain', () => {
  it('hash is deterministic, in [-1, 1) and centered', () => {
    let sum = 0,
      lo = 1,
      hi = -1;
    for (let y = -50; y < 50; y++)
      for (let x = -50; x < 50; x++) {
        const v = grainHash(x, y, 1);
        expect(v).toBe(grainHash(x, y, 1));
        sum += v;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    expect(lo).toBeGreaterThanOrEqual(-1);
    expect(hi).toBeLessThan(1);
    expect(Math.abs(sum / 10000)).toBeLessThan(0.03);
    expect(grainHash(3, 4, 1)).not.toBe(grainHash(3, 4, 2));
  });
  it('noise interpolates the lattice values continuously', () => {
    expect(grainNoise(5, 7, 1)).toBeCloseTo(grainHash(5, 7, 1), 12);
    expect(Math.abs(grainNoise(5.999999, 7, 1) - grainNoise(6, 7, 1))).toBeLessThan(1e-4);
  });
  it('is anchored to the document: a crop matches the full result', () => {
    const img = randomImage(48, 40, 9);
    const p = { amount: 60, size: 40, roughness: 30, color: 50 };
    const full = grain(img, p);
    const crop = rgba8(20, 16);
    for (let y = 0; y < 16; y++) crop.data.set(img.data.subarray(((y + 10) * 48 + 12) * 4, ((y + 10) * 48 + 32) * 4), y * 20 * 4);
    const out = grain(crop, p, { x: 12, y: 10 });
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 20; x++)
        for (let c = 0; c < 4; c++) expect(out.data[(y * 20 + x) * 4 + c]).toBe(full.data[((y + 10) * 48 + x + 12) * 4 + c]);
  });
  it('amount 0 is the identity; color grain differs per channel; alpha is kept', () => {
    const img = randomImage(32, 32, 4, true);
    expect(diffStats(grain(img, { amount: 0, size: 50, roughness: 50, color: 50 }), img).max).toBe(0);
    const gray = rgba8(32, 32);
    gray.data.fill(128);
    const mono = grain(gray, { amount: 100, size: 20, roughness: 50, color: 0 });
    const tinted = grain(gray, { amount: 100, size: 20, roughness: 50, color: 100 });
    let monoChroma = 0,
      tintChroma = 0,
      changed = 0;
    for (let i = 0; i < mono.data.length; i += 4) {
      monoChroma += Math.abs(mono.data[i] - mono.data[i + 2]);
      tintChroma += Math.abs(tinted.data[i] - tinted.data[i + 2]);
      if (mono.data[i] !== 128) changed++;
      expect(mono.data[i + 3]).toBe(128);
    }
    expect(monoChroma).toBe(0);
    expect(tintChroma).toBeGreaterThan(1000);
    expect(changed).toBeGreaterThan(800);
  });
});

describe('Light & Tone', () => {
  it('exposure +1 doubles linear light and the curve is continuous', () => {
    const f = lightToneCurve({ exposure: 1, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 })!;
    expect(srgbToLinear(f(0.3))).toBeCloseTo(2 * srgbToLinear(0.3), 5);
    expect(lightToneCurve({ exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 })).toBeUndefined();
  });
  it('shadows lift darks more than lights, highlights the reverse; whites and blacks move the ends', () => {
    const z = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 };
    const sh = lightToneCurve({ ...z, shadows: 100 })!;
    expect(sh(0.25) - 0.25).toBeGreaterThan(sh(0.8) - 0.8);
    expect(sh(0)).toBe(0);
    expect(sh(1)).toBe(1);
    const hi = lightToneCurve({ ...z, highlights: -100 })!;
    expect(0.75 - hi(0.75)).toBeGreaterThan(0.25 - hi(0.25));
    expect(lightToneCurve({ ...z, whites: -100 })!(1)).toBeCloseTo(0.8, 6);
    expect(lightToneCurve({ ...z, blacks: 100 })!(0)).toBeCloseTo(0.2, 6);
    const con = lightToneCurve({ ...z, contrast: 60 })!;
    expect(con(0.25)).toBeLessThan(0.25);
    expect(con(0.75)).toBeGreaterThan(0.75);
    for (let x = 0; x < 1; x += 1 / 64) expect(con(x + 1 / 64)).toBeGreaterThanOrEqual(con(x));
  });
});

describe('Color & Vibrance', () => {
  it('white balance gains keep white luminance and warm or cool', () => {
    const [r, g, b] = whiteBalanceGains(50, 0);
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeCloseTo(1, 10);
    expect(r).toBeGreaterThan(b);
    const [, gt] = whiteBalanceGains(0, 60);
    expect(gt).toBeLessThan(1);
  });
  it('temperature warms gray; the compiled table matches the exact path', () => {
    const adj: Adjustment = { kind: 'color-vibrance', params: { temperature: 60, tint: 0, vibrance: 0, saturation: 0 } };
    const gray = rgba8(4, 4);
    gray.data.fill(128);
    const out = applyAdjustment(gray, adj);
    expect(out.data[0]).toBeGreaterThan(128);
    expect(out.data[2]).toBeLessThan(128);
    const img = randomImage(64, 64, 12);
    const full: Adjustment = { kind: 'color-vibrance', params: { temperature: -40, tint: 25, vibrance: 50, saturation: -20 } };
    expect(diffStats(applyCompiled(img, compileAdjustment(full)), applyAdjustment(img, full)).max).toBeLessThanOrEqual(4);
  });
});

describe('new adjustment layers in projects', () => {
  it('round-trip through .photo and compile to filter passes', async () => {
    const doc = newDocument(32, 32, 'Adjusted'),
      assets = new Assets();
    const specs = [
      { kind: 'light-tone', params: { exposure: 0.5, contrast: 10, highlights: -20, shadows: 30, whites: 0, blacks: -5 } },
      { kind: 'color-vibrance', params: { temperature: 20, tint: -10, vibrance: 30, saturation: 0 } },
      { kind: 'clarity-dehaze', params: { clarity: 40, dehaze: -20 } },
      { kind: 'grain', params: { amount: 30, size: 10, roughness: 70, color: 20 } },
    ];
    doc.layers = specs.map((spec, i) => ({ ...layer('adjustment', `A${i}`, 32, 32), adjustment: spec }));
    const restored = await deserialize(await serialize(doc, assets));
    expect(restored.document.layers.map((l) => l.adjustment)).toEqual(specs);
    for (const l of restored.document.layers) expect(specAdjustment(l.adjustment)?.params).toEqual(l.adjustment!.params);
    expect(compileSpatial(specs[2])).toEqual({ type: 'clarity-dehaze', clarity: 0.4, dehaze: -0.2 });
    expect(compileSpatial(specs[3])).toMatchObject({ type: 'grain', roughness: 0.7 });
    expect(compileSpatial(specs[0])).toBeNull();
    expect(compileSpatial({ kind: 'grain', params: { amount: 0 } })).toBeNull();
  });
});
