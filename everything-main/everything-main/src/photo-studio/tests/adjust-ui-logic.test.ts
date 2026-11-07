import { describe, expect, it } from 'vitest';
import { applyAdjustment, curveFunction, defaultParams, levelsFunction, luma, rgbToLab, type Adjustment } from '../src/imaging/adjust';
import { eyedropLevels, gammaFromPosition, gammaPosition } from '../src/features/adjust/levels';
import { eyedropCurves, valuesToPoints } from '../src/features/adjust/curves';
import { centerRange } from '../src/features/adjust/hue-sat';
import { autoBlackWhite } from '../src/features/adjust/editors-basic';
import { labStats, matchColorLut, DEFAULT_MATCH } from '../src/features/adjust/match-color';
import { documentBelow } from '../src/features/adjust/source';
import { newDocument, layer } from '../src/model/document';
import { randomImage } from './adjust-fixtures';
import { rgba8 } from '../src/imaging/types';

describe('Levels editor math', () => {
  it('places the gamma handle where input maps to 50% and inverts it', () => {
    const c = { inBlack: 20, inWhite: 220, gamma: 1, outBlack: 0, outWhite: 255 };
    expect(gammaPosition(c)).toBeCloseTo(120);
    for (const g of [0.5, 1.7, 3]) {
      const pos = gammaPosition({ ...c, gamma: g });
      expect(levelsFunction({ ...c, gamma: g })(pos / 255)).toBeCloseTo(0.5, 5);
      expect(gammaFromPosition(c, pos)).toBeCloseTo(g, 1);
    }
    expect(gammaFromPosition(c, 20)).toBe(9.99);
  });
  it('eyedroppers send the sampled color to black, white and neutral gray', () => {
    const p = defaultParams('levels');
    p.rgb.inWhite = 200; // the composite channel applies first
    eyedropLevels(p, 'black', [20, 30, 40]);
    expect([p.r.inBlack, p.g.inBlack, p.b.inBlack]).toEqual([26, 38, 51]);
    eyedropLevels(p, 'white', [180, 170, 160]);
    expect([p.r.inWhite, p.g.inWhite, p.b.inWhite]).toEqual([230, 217, 204]);
    const q = defaultParams('levels');
    const sample: [number, number, number] = [140, 120, 90];
    eyedropLevels(q, 'gray', sample);
    const adj: Adjustment = { kind: 'levels', params: q };
    const out = applyAdjustment({ width: 1, height: 1, data: new Uint8ClampedArray([...sample, 255]) }, adj).data;
    expect(Math.max(Math.abs(out[0] - out[1]), Math.abs(out[1] - out[2]))).toBeLessThanOrEqual(2);
    expect(Math.abs(out[1] - luma(...sample))).toBeLessThanOrEqual(2);
  });
});

describe('Curves editor math', () => {
  it('turns free-form values into a point curve that follows them', () => {
    const values = Array.from({ length: 256 }, (_, i) => 255 * Math.pow(i / 255, 0.6));
    const pts = valuesToPoints(values);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts.at(-1)).toEqual([255, 255]);
    const f = curveFunction({ mode: 'points', points: pts });
    for (let x = 0; x < 256; x++) expect(Math.abs(f(x / 255) * 255 - values[x])).toBeLessThan(x < 3 ? 5 : 3);
    expect(pts.length).toBeLessThanOrEqual(16);
    // A straight line needs only its endpoints.
    expect(valuesToPoints(Array.from({ length: 256 }, (_, i) => i))).toEqual([[0, 0], [255, 255]]);
  });
  it('eyedroppers set per-channel endpoints and neutral points', () => {
    const p = defaultParams('curves');
    eyedropCurves(p, 'black', [30, 40, 50]);
    expect(p.r.points[0]).toEqual([30, 0]);
    expect(p.b.points[0]).toEqual([50, 0]);
    eyedropCurves(p, 'white', [200, 210, 220]);
    expect(p.g.points.at(-1)).toEqual([210, 255]);
    const q = defaultParams('curves');
    eyedropCurves(q, 'gray', [150, 120, 100]);
    const out = applyAdjustment({ width: 1, height: 1, data: new Uint8ClampedArray([150, 120, 100, 255]) }, { kind: 'curves', params: q }).data;
    expect(new Set([out[0], out[1], out[2]]).size).toBe(1);
  });
});

describe('Hue/Saturation and Black & White helpers', () => {
  it('centers a range on a hue keeping its widths, across 0 degrees', () => {
    expect(centerRange([315, 345, 15, 45], 120)).toEqual([75, 105, 135, 165]);
    expect(centerRange([195, 225, 255, 285], 10)).toEqual([325, 355, 25, 55]);
  });
  it('auto weights brighten hues that are brighter in the image', () => {
    const img = rgba8(2, 1);
    img.data.set([230, 200, 40, 255, 20, 30, 120, 255]); // bright yellow, dark blue
    const w = autoBlackWhite(img, { ...defaultParams('black-white') });
    expect(w.yellows).toBeGreaterThan(w.blues);
    expect(autoBlackWhite(rgba8(1, 1, [128, 128, 128, 255]), defaultParams('black-white')).greens).toBeCloseTo(71.52);
  });
});

describe('Match Color', () => {
  const img = randomImage(64, 48, 11);
  const meanLab = (data: Uint8ClampedArray) => {
    const s = [0, 0, 0],
      lab = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) {
      rgbToLab(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, lab);
      for (let k = 0; k < 3; k++) s[k] += lab[k];
    }
    return s.map((v) => v / (data.length / 4));
  };
  const apply = (lut: ReturnType<typeof matchColorLut>) => applyAdjustment(img, { kind: 'color-lookup', params: { source: { type: 'lut', name: 'm', lut }, amount: 100 } });
  it('is the identity against its own statistics and with full fade', () => {
    const own = labStats(img);
    const out = apply(matchColorLut(own, own, DEFAULT_MATCH, 33));
    let max = 0;
    for (let i = 0; i < out.data.length; i++) max = Math.max(max, Math.abs(out.data[i] - img.data[i]));
    expect(max).toBeLessThanOrEqual(3);
    const faded = apply(matchColorLut(own, { mean: [80, 40, -30], std: [5, 5, 5], count: 1 }, { ...DEFAULT_MATCH, fade: 100 }));
    for (let i = 0; i < faded.data.length; i++) expect(Math.abs(faded.data[i] - img.data[i])).toBeLessThanOrEqual(2);
  });
  it('moves the mean toward the source and neutralizes casts', () => {
    const warm = rgba8(8, 8, [200, 150, 90, 255]);
    const src = labStats(warm);
    const own = labStats(img);
    const out = apply(matchColorLut(own, src, DEFAULT_MATCH));
    const m = meanLab(out.data);
    expect(m[2]).toBeGreaterThan(meanLab(img.data)[2] + 10); // yellower
    const neutral = apply(matchColorLut(labStats(warm), null, { ...DEFAULT_MATCH, neutralize: true }));
    void neutral;
    const castImg = rgba8(4, 4, [180, 140, 100, 255]);
    const fixed = applyAdjustment(castImg, { kind: 'color-lookup', params: { source: { type: 'lut', name: 'm', lut: matchColorLut(labStats(castImg), null, { ...DEFAULT_MATCH, neutralize: true }) }, amount: 100 } });
    const [, a, b] = meanLab(fixed.data);
    expect(Math.abs(a)).toBeLessThan(2);
    expect(Math.abs(b)).toBeLessThan(2);
  });
  it('ignores transparent and unselected pixels in the statistics', () => {
    const im = rgba8(2, 1);
    im.data.set([255, 0, 0, 255, 0, 0, 255, 0]);
    expect(labStats(im).count).toBe(1);
    expect(labStats(im, new Uint8Array([0, 255])).count).toBe(0);
  });
});

describe('documentBelow', () => {
  it('hides the layer and everything composited after it', () => {
    const doc = newDocument(10, 10);
    const a = layer('pixel', 'a', 10, 10),
      g = layer('group', 'g', 10, 10),
      b = layer('pixel', 'b', 10, 10),
      adj = layer('adjustment', 'adj', 10, 10),
      c = layer('pixel', 'c', 10, 10),
      top = layer('pixel', 'top', 10, 10);
    g.children = [b, adj, c];
    doc.layers = [a, g, top];
    const below = documentBelow(doc, adj.id);
    expect(below.layers[0].visible).toBe(true);
    expect(below.layers[1].visible).toBe(true);
    expect(below.layers[1].children.map((l) => l.visible)).toEqual([true, false, false]);
    expect(below.layers[2].visible).toBe(false);
    expect(doc.layers[2].visible).toBe(true);
  });
});
