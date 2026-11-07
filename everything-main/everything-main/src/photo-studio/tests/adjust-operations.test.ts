import { describe, expect, it } from 'vitest';
import { adjustmentOperations, applyAdjustment, colorRangeMask, luma, shadowsHighlights, DEFAULT_SHADOWS_HIGHLIGHTS } from '../src/imaging/adjust';
import { defaults, mask8, rgba8, type OperationContext, type RGBA8 } from '../src/imaging/types';
import { diffStats, randomImage, sampleAdjustment } from './adjust-fixtures';

const ctx: OperationContext = { foreground: [0, 0, 0], background: [255, 255, 255] };
const op = (id: string) => adjustmentOperations.find((o) => o.id === id)!;

describe('adjustment operations', () => {
  it('have unique ids, the Adjustments category and valid defaults', () => {
    const ids = adjustmentOperations.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of adjustmentOperations) {
      expect(o.category).toBe('Adjustments');
      for (const p of o.params) {
        if (p.type === 'number') {
          expect(p.default).toBeGreaterThanOrEqual(p.min);
          expect(p.default).toBeLessThanOrEqual(p.max);
        }
        if (p.type === 'select') expect(p.options.map((x) => x.value)).toContain(p.default);
      }
    }
    for (const id of ['adjust.invert', 'adjust.desaturate', 'adjust.auto-tone', 'adjust.auto-contrast', 'adjust.auto-color', 'adjust.equalize'])
      expect(op(id).immediate).toBe(true);
    for (const id of ['adjust.shadows-highlights', 'adjust.replace-color', 'adjust.vibrance', 'adjust.levels', 'adjust.curves', 'adjust.hue-saturation'])
      expect(op(id)).toBeDefined();
  });

  it('every operation runs with its defaults on small and 1x1 images and keeps alpha', async () => {
    for (const o of adjustmentOperations)
      for (const img of [randomImage(13, 7, 3, true), randomImage(1, 1, 4, true)]) {
        const out = (await o.apply(img, defaults(o), ctx)) as RGBA8;
        expect(out.width).toBe(img.width);
        for (let i = 3; i < img.data.length; i += 4) expect(out.data[i]).toBe(img.data[i]);
      }
  });

  it('kind operations with default sliders are identities where the model default is', async () => {
    const img = randomImage(20, 20, 9);
    for (const id of ['brightness-contrast', 'levels', 'curves', 'exposure', 'vibrance', 'hue-saturation', 'color-balance', 'channel-mixer', 'selective-color']) {
      const o = op(`adjust.${id}`);
      expect(diffStats((await o.apply(img, defaults(o), ctx)) as RGBA8, img).max).toBeLessThanOrEqual(1);
    }
  });

  it('sliders map to the typed parameters', async () => {
    const img = randomImage(20, 20, 9);
    const levels = op('adjust.levels');
    const viaOp = (await levels.apply(img, { ...defaults(levels), channel: 'g', gamma: 2 }, ctx)) as RGBA8;
    const expected = applyAdjustment(img, {
      kind: 'levels',
      params: {
        rgb: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
        r: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
        g: { inBlack: 0, inWhite: 255, gamma: 2, outBlack: 0, outWhite: 255 },
        b: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
      },
    });
    expect(diffStats(viaOp, expected).max).toBe(0);
    const hs = op('adjust.hue-saturation');
    const blueShift = (await hs.apply(rgba8(1, 1, [255, 0, 0, 255]), { ...defaults(hs), range: 'reds', hue: 120 }, ctx)) as RGBA8;
    expect([...blueShift.data]).toEqual([0, 255, 0, 255]);
  });

  it('a JSON adjustment parameter overrides the sliders', async () => {
    const img = randomImage(16, 16, 2);
    const adj = sampleAdjustment('curves');
    const out = (await op('adjust.curves').apply(img, { adjustment: JSON.stringify(adj) }, ctx)) as RGBA8;
    expect(diffStats(out, applyAdjustment(img, adj)).max).toBe(0);
    // A mismatched kind is ignored.
    const ignored = (await op('adjust.curves').apply(img, { adjustment: JSON.stringify(sampleAdjustment('invert')) }, ctx)) as RGBA8;
    expect(diffStats(ignored, img).max).toBe(0);
  });

  it('desaturate gives (max + min) / 2 gray', async () => {
    const out = (await op('adjust.desaturate').apply(rgba8(1, 1, [200, 100, 20, 255]), {}, ctx)) as RGBA8;
    expect([...out.data]).toEqual([110, 110, 110, 255]);
  });

  it('gradient map defaults to foreground-to-background', async () => {
    const o = op('adjust.gradient-map');
    const out = (await o.apply(rgba8(1, 1, [0, 0, 0, 255]), defaults(o), { foreground: [255, 0, 0], background: [0, 0, 255] })) as RGBA8;
    expect([...out.data]).toEqual([255, 0, 0, 255]);
  });

  it('operations respect the selection in the context', async () => {
    const img = randomImage(8, 8, 3);
    const selection = mask8(8, 8);
    selection.data.fill(255, 0, 32);
    const out = (await op('adjust.invert').apply(img, {}, { ...ctx, selection })) as RGBA8;
    expect(out.data[0]).toBe(255 - img.data[0]);
    expect(out.data[40 * 4]).toBe(img.data[40 * 4]);
  });
});

describe('shadows/highlights', () => {
  // Dark left half and bright right half, each with fine detail.
  function scene() {
    const img = rgba8(80, 40);
    for (let y = 0; y < 40; y++)
      for (let x = 0; x < 80; x++) {
        const base = x < 40 ? 30 : 225,
          detail = (x + y) % 2 ? 8 : -8;
        img.data.set([base + detail, base + detail, base + detail + 4, 255], (y * 80 + x) * 4);
      }
    return img;
  }
  const at = (img: RGBA8, x: number, y: number) => luma(img.data[(y * 80 + x) * 4], img.data[(y * 80 + x) * 4 + 1], img.data[(y * 80 + x) * 4 + 2]);

  it('lifts shadows and recovers highlights while keeping local detail', () => {
    const src = scene();
    const out = shadowsHighlights(src, { ...DEFAULT_SHADOWS_HIGHLIGHTS, shadowsAmount: 60, highlightsAmount: 60, shadowsRadius: 6, highlightsRadius: 6 });
    expect(at(out, 10, 10)).toBeGreaterThan(at(src, 10, 10) + 10);
    expect(at(out, 70, 10)).toBeLessThan(at(src, 70, 10) - 5);
    // Detail (checkerboard amplitude) survives in the lifted shadows.
    expect(Math.abs(at(out, 10, 10) - at(out, 11, 10))).toBeGreaterThan(10);
  });

  it('zero amounts are an identity and selection limits the change', () => {
    const src = scene();
    const none = shadowsHighlights(src, { ...DEFAULT_SHADOWS_HIGHLIGHTS, shadowsAmount: 0, highlightsAmount: 0 });
    expect(diffStats(none, src).max).toBe(0);
    const selection = mask8(80, 40);
    const out = shadowsHighlights(src, DEFAULT_SHADOWS_HIGHLIGHTS, selection);
    expect(diffStats(out, src).max).toBe(0);
  });
});

describe('replace color', () => {
  it('masks colors near the sample and shifts their hue', async () => {
    const img = rgba8(3, 1);
    img.data.set([200, 40, 40, 255, 205, 45, 38, 255, 40, 200, 40, 255]);
    const m = colorRangeMask(img, [200, 40, 40], 40);
    expect(m.data[0]).toBe(255);
    expect(m.data[1]).toBe(255);
    expect(m.data[2]).toBe(0);
    const o = op('adjust.replace-color');
    const out = (await o.apply(img, { ...defaults(o), color: '#c82828', hue: 120 }, ctx)) as RGBA8;
    expect(out.data[1]).toBeGreaterThan(out.data[0]); // red became green
    expect([...out.data.slice(8, 12)]).toEqual([40, 200, 40, 255]);
  });
});
