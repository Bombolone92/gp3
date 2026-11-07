import { describe, expect, it } from 'vitest';
import { readPsd } from 'ag-psd';
import {
  blendIfWeight, blendingFromPsd, blendingToPsd, blendingUniforms, cleanBlending, maskHidesEffects, moveRangeHandle,
  normalizeRange, rangeWeight, validateBlending, type AdvancedBlending, type BlendRange,
} from '../src/model/blending';
import { layer, newDocument } from '../src/model/document';
import { savePsd } from '../src/model/psd';
import { validateDocument } from '../src/model/serialization';
import { renderLayerStyle } from '../src/imaging/effects/render';
import { splitLayerStyle } from '../src/imaging/effects/split';
import { defaultColorOverlay, defaultDropShadow, type LayerStyle } from '../src/imaging/effects/types';
import type { RGBA8 } from '../src/imaging/types';

const square = (size = 24, inset = 6): RGBA8 => {
  const img = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
  for (let y = inset; y < size - inset; y++)
    for (let x = inset; x < size - inset; x++) img.data.set([200, 200, 200, 255], (y * size + x) * 4);
  return img;
};
const noPatterns = () => undefined;

describe('Blend If ranges', () => {
  it('hides levels outside a hard range and keeps the ends inclusive', () => {
    const r: BlendRange = [50, 50, 200, 200];
    expect(rangeWeight(49, r)).toBe(0);
    expect(rangeWeight(50, r)).toBe(1);
    expect(rangeWeight(200, r)).toBe(1);
    expect(rangeWeight(201, r)).toBe(0);
    expect(rangeWeight(0, [0, 0, 255, 255])).toBe(1);
    expect(rangeWeight(255, [0, 0, 255, 255])).toBe(1);
  });
  it('fades linearly across split handles', () => {
    const r: BlendRange = [0, 100, 155, 255];
    expect(rangeWeight(0, r)).toBe(0);
    expect(rangeWeight(50, r)).toBeCloseTo(0.5);
    expect(rangeWeight(100, r)).toBe(1);
    expect(rangeWeight(205, r)).toBeCloseTo(0.5);
    expect(rangeWeight(255, r)).toBe(0);
  });
  it('multiplies the gray and channel weights of this layer and the underlying pixels', () => {
    const b: AdvancedBlending = { ranges: { gray: { this: [0, 0, 255, 255], underlying: [128, 128, 255, 255] }, red: { this: [0, 0, 100, 200], underlying: [0, 0, 255, 255] } } };
    // Underlying gray 0.6 (153) passes; this red 150 is half way down the white fade.
    expect(blendIfWeight(b, [150 / 255, 0, 0], [0.6, 0.6, 0.6])).toBeCloseTo(0.5, 5);
    // Dark underlying pixels hide the layer.
    expect(blendIfWeight(b, [150 / 255, 0, 0], [0.2, 0.2, 0.2])).toBe(0);
    expect(blendIfWeight(undefined, [1, 1, 1], [0, 0, 0])).toBe(1);
  });
  it('normalizes ranges so handles stay ordered', () => {
    expect(normalizeRange([30, 10, 300, 250])).toEqual([10, 30, 250, 255]);
    expect(normalizeRange([240, 240, 20, 20])).toEqual([240, 240, 240, 240]);
    expect(normalizeRange([Number.NaN, 0, 255, Number.NaN])).toEqual([0, 0, 255, 255]);
  });
  it('moves joined pairs together and splits them with Alt', () => {
    const r: BlendRange = [0, 0, 255, 255];
    expect(moveRangeHandle(r, 1, 40, false)).toEqual([40, 40, 255, 255]);
    expect(moveRangeHandle(r, 1, 40, true)).toEqual([0, 40, 255, 255]);
    // A split half moves alone and cannot pass its partner or the other pair.
    expect(moveRangeHandle([0, 40, 255, 255], 0, 60, false)).toEqual([40, 40, 255, 255]);
    expect(moveRangeHandle([0, 40, 200, 255], 1, 230, false)).toEqual([0, 200, 200, 255]);
    expect(moveRangeHandle([10, 10, 200, 200], 3, 5, false)).toEqual([10, 10, 10, 10]);
  });
});

describe('advanced blending options', () => {
  it('drops defaults and keeps only what changes the result', () => {
    expect(cleanBlending({ ranges: { gray: { this: [0, 0, 255, 255], underlying: [0, 0, 255, 255] } }, exclude: { r: false }, clippedAsGroup: true })).toBeUndefined();
    expect(cleanBlending({ ranges: { blue: { this: [0, 0, 255, 255], underlying: [0, 9, 255, 255] } }, exclude: { g: true }, knockout: 'deep', clippedAsGroup: false })).toEqual({
      ranges: { blue: { this: [0, 0, 255, 255], underlying: [0, 9, 255, 255] } }, exclude: { g: true }, knockout: 'deep', clippedAsGroup: false,
    });
  });
  it('validates saved options', () => {
    expect(() => validateBlending({ ranges: { gray: { this: [0, 0, 255, 255], underlying: [0, 0, 255, 255] } }, knockout: 'shallow' })).not.toThrow();
    expect(() => validateBlending({ ranges: { alpha: { this: [0, 0, 255, 255], underlying: [0, 0, 255, 255] } } })).toThrow();
    expect(() => validateBlending({ ranges: { gray: { this: [9, 0, 255, 255], underlying: [0, 0, 255, 255] } } })).toThrow();
    expect(() => validateBlending({ knockout: 'full' })).toThrow();
    expect(() => validateBlending({ exclude: { a: true } })).toThrow();
    const doc = newDocument(10, 10);
    doc.layers.push(layer('solid', 'L', 10, 10));
    doc.layers[0].blending = { ranges: { gray: { this: [0, 0, 255, 255], underlying: [10, 20, 255, 255] } } };
    doc.globalLight = { angle: 90, altitude: 40 };
    expect(() => validateDocument(doc)).not.toThrow();
    doc.globalLight = { angle: 90, altitude: 120 };
    expect(() => validateDocument(doc)).toThrow();
  });
  it('packs ranges and channel flags into the compositor uniforms', () => {
    const u = new Float32Array(96);
    blendingUniforms({ blending: { ranges: { green: { this: [1, 2, 3, 4], underlying: [5, 6, 7, 8] } }, exclude: { b: true } } }, u);
    expect([...u.subarray(48, 56)]).toEqual([0, 0, 255, 255, 0, 0, 255, 255]);
    expect([...u.subarray(64, 72)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...u.subarray(80, 84)]).toEqual([1, 0, 0, 1]);
  });
  it('chooses the mask flag that matches the mask the layer has', () => {
    const l = layer('pixel', 'L', 4, 4);
    l.blending = { maskHidesEffects: true };
    expect(maskHidesEffects(l)).toBe(true);
    l.vectorMask = { mask: { paths: [], fillStartsWithAllPixels: true } } as never;
    expect(maskHidesEffects(l)).toBe(false);
    l.blending.vectorMaskHidesEffects = true;
    expect(maskHidesEffects(l)).toBe(true);
  });
});

describe('PSD interchange of advanced blending', () => {
  it('maps ranges both ways', () => {
    const ranges = { gray: { this: [0, 0, 255, 255] as BlendRange, underlying: [20, 60, 255, 255] as BlendRange }, red: { this: [0, 0, 200, 230] as BlendRange, underlying: [0, 0, 255, 255] as BlendRange } };
    const psd = blendingToPsd({ ranges })!;
    expect(psd.compositeGraphBlendDestinationRange).toEqual([20, 60, 255, 255]);
    expect(psd.ranges).toHaveLength(3);
    expect(blendingFromPsd(psd)).toEqual(ranges);
    expect(blendingFromPsd({ compositeGrayBlendSource: [0, 0, 255, 255], compositeGraphBlendDestinationRange: [0, 0, 255, 255], ranges: [] })).toBeUndefined();
  });
  it('writes ranges, channel restrictions and flags into layer records', async () => {
    const doc = newDocument(16, 16);
    const g = layer('group', 'Group', 16, 16);
    g.blend = 'normal';
    g.blending = { ranges: { gray: { this: [0, 0, 255, 255], underlying: [30, 90, 255, 255] } }, exclude: { r: true, b: true }, knockout: 'deep', interiorAsGroup: true, clippedAsGroup: false, maskHidesEffects: true };
    doc.layers.push(g);
    const blob = await savePsd(doc, async () => new Uint8Array(16 * 16 * 4));
    const psd = readPsd(new Uint8Array(await blob.arrayBuffer()), { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
    const out = psd.children!.find((c) => c.name === 'Group')!;
    expect(out.blendingRanges?.compositeGraphBlendDestinationRange).toEqual([30, 90, 255, 255]);
    expect(out.channelBlendingRestrictions).toEqual([0, 2]);
    expect(out.knockout).toBe(true);
    expect(out.blendInteriorElements).toBe(true);
    expect(out.blendClippendElements).toBe(false);
    expect(out.layerMaskAsGlobalMask).toBe(true);
  });
});

describe('layer style options', () => {
  const overlay: LayerStyle = { enabled: true, colorOverlay: [{ ...defaultColorOverlay(), color: [0, 0, 255] }] };
  it('fades interior effects with fill opacity when they blend as a group', () => {
    const at = (img: RGBA8, x: number, y: number, b: { x: number; y: number; width: number }) => img.data[((y - b.y) * b.width + (x - b.x)) * 4 + 3];
    const separate = renderLayerStyle(square(), overlay, { fillOpacity: 0, patterns: noPatterns });
    const grouped = renderLayerStyle(square(), overlay, { fillOpacity: 0, patterns: noPatterns, interiorAsGroup: true });
    expect(at(separate.layer, 12, 12, separate.bounds)).toBe(255);
    expect(at(grouped.layer, 12, 12, grouped.bounds)).toBe(0);
    const half = renderLayerStyle(square(), overlay, { fillOpacity: 0.5, patterns: noPatterns, interiorAsGroup: true });
    expect(at(half.layer, 12, 12, half.bounds)).toBeCloseTo(128, -1);
  });
  it('splits a style into effect images placed below, clipped to and above the layer', () => {
    const style: LayerStyle = { ...overlay, dropShadow: [{ ...defaultDropShadow(), distance: 3, size: 2, opacity: 1 }], stroke: [{ enabled: true, blendMode: 'normal', opacity: 1, size: 2, position: 'outside', fill: { type: 'color', color: [255, 0, 0] } }] };
    const pieces = splitLayerStyle(square(), style, { patterns: noPatterns, origin: { x: 100, y: 50 } });
    expect(pieces.map((p) => [p.effect, p.stage, p.mode])).toEqual([
      ['dropShadow', 'below', 'multiply'],
      ['colorOverlay', 'interior', 'normal'],
      ['stroke', 'above', 'normal'],
    ]);
    // Positions are in document space.
    expect(pieces[0].rect.x).toBeGreaterThanOrEqual(100);
    const overlayPiece = pieces[1];
    const i = ((62 - overlayPiece.rect.y) * overlayPiece.rect.width + (112 - overlayPiece.rect.x)) * 4;
    expect([...overlayPiece.image.data.subarray(i, i + 4)]).toEqual([0, 0, 255, 255]);
  });
});
