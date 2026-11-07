import { describe, expect, it } from 'vitest';
import { CancelledError, mask8, rgba8 } from '../src/imaging/types';
import { contextFill, contextFillSmall, heal, redEye, spotHeal } from '../src/imaging/retouch';
import {
  colorRange, contract, expand, feather, LiveWire, magicWand, maskToOutline, quickSelect, rasterizeEllipse, rasterizeRect, refineEdge,
  selectSky, selectSubject, smooth,
} from '../src/imaging/segment';
import { photoLike } from './retouch-fixtures';

describe('degenerate sizes', () => {
  it('1x1 images and masks', () => {
    const img = rgba8(1, 1, [10, 20, 30, 255]), full = mask8(1, 1, 255);
    expect([...contextFill(img, full).data]).toEqual([10, 20, 30, 255]); // no source: unchanged
    expect([...contextFillSmall(img, full).data]).toEqual([10, 20, 30, 255]);
    expect([...spotHeal(img, full, 'proximity').data]).toEqual([10, 20, 30, 255]);
    expect([...heal(img, rgba8(1, 1, [200, 0, 0, 255]), full, { x: 0, y: 0 }).data]).toEqual([200, 0, 0, 255]);
    expect([...redEye(img, { x: 0, y: 0 }).data]).toEqual([10, 20, 30, 255]);
    expect(colorRange(img, [[10, 20, 30]], 10).data[0]).toBe(255);
    expect(refineEdge(img, full, { radius: 4, feather: 2, decontaminate: 1 }).mask.data[0]).toBe(255);
    expect(selectSubject(img).data.length).toBe(1);
    expect(selectSky(img).data[0]).toBe(0);
    expect(quickSelect(img, [{ points: [[0, 0]], positive: true }], undefined, 5).data[0]).toBe(255);
    expect(feather(full, 3).data[0]).toBe(255);
    expect(expand(mask8(1, 1), 3).data[0]).toBe(0);
    // The canvas edge does not count as unselected, so a full selection survives.
    expect(contract(full, 3).data[0]).toBe(255);
    expect(smooth(full, 2).data[0]).toBe(255);
    const lw = new LiveWire(img);
    lw.setSeed(0, 0);
    expect(lw.pathTo(5, 5)).toEqual([[0, 0]]);
  });
  it('falls back to a smooth fill when no patch-sized source exists', () => {
    const img = rgba8(6, 6, [40, 80, 120, 255]);
    img.data.set([255, 0, 0, 255], (2 * 6 + 2) * 4);
    const hole = mask8(6, 6);
    hole.data[2 * 6 + 2] = 255;
    const out = contextFill(img, hole);
    expect(Array.from(out.data.subarray((2 * 6 + 2) * 4, (2 * 6 + 2) * 4 + 4))).toEqual([40, 80, 120, 255]);
  });
  it('odd-sized thin images', () => {
    const img = photoLike(37, 3, 1), hole = rasterizeRect(15, 0, 5, 3, 37, 3, { antiAlias: false });
    const out = contextFill(img, hole, { patchSize: 5 });
    expect(out.width).toBe(37);
    for (let x = 0; x < 15; x++) expect(out.data[(37 + x) * 4]).toBe(img.data[(37 + x) * 4]);
    const wand = magicWand(img, 0, 0, 255, { antiAlias: false });
    expect([...wand.data].every((v) => v === 255)).toBe(true);
    expect(maskToOutline(wand).length).toBe(1);
  });
});

describe('alpha handling', () => {
  it('context fill keeps transparent sources out when content is mostly opaque', () => {
    const img = rgba8(60, 40, [0, 0, 255, 255]);
    // A transparent stripe at the right with a red hidden color must not leak in.
    for (let y = 0; y < 40; y++) for (let x = 50; x < 60; x++) img.data.set([255, 0, 0, 0], (y * 60 + x) * 4);
    const hole = rasterizeRect(20, 10, 10, 10, 60, 40, { antiAlias: false });
    const out = contextFill(img, hole);
    for (let y = 10; y < 20; y++) for (let x = 20; x < 30; x++) {
      const o = (y * 60 + x) * 4;
      expect(out.data[o + 3]).toBe(255);
      expect(out.data[o]).toBeLessThan(20);
    }
  });
  it('heal blends straight-alpha patches without dark fringes', () => {
    const dst = rgba8(20, 20, [200, 200, 200, 128]), src = rgba8(10, 10, [200, 200, 200, 128]);
    const out = heal(dst, src, rasterizeEllipse(5, 5, 4, 4, 10, 10), { x: 5, y: 5 });
    for (let i = 0; i < out.data.length; i += 4) {
      expect(Math.abs(out.data[i] - 200)).toBeLessThanOrEqual(1);
      expect(Math.abs(out.data[i + 3] - 128)).toBeLessThanOrEqual(1);
    }
  });
  it('spot healing at the very corner of the image', () => {
    const img = photoLike(80, 60, 3), dab = rasterizeEllipse(1, 1, 6, 6, 80, 60);
    for (const mode of ['proximity', 'texture', 'context'] as const) {
      const out = spotHeal(img, dab, mode, 1);
      expect(out.data[(40 * 80 + 40) * 4]).toBe(img.data[(40 * 80 + 40) * 4]);
    }
    const inPlace = photoLike(80, 60, 3);
    expect(spotHeal(inPlace, dab, 'proximity', 1, { inPlace: true })).toBe(inPlace);
  });
});

describe('progress and cancellation', () => {
  it('context fill reports progress and can be cancelled', () => {
    const img = photoLike(200, 150, 4), hole = rasterizeEllipse(100, 75, 30, 30, 200, 150);
    const seen: number[] = [];
    contextFill(img, hole, {}, { report: (f) => seen.push(f) });
    expect(seen.length).toBeGreaterThan(2);
    expect(seen.every((f, i) => f >= 0 && f <= 1 && (i === 0 || f >= seen[i - 1]))).toBe(true);
    let calls = 0;
    expect(() => contextFill(img, hole, {}, { cancelled: () => ++calls > 3 })).toThrow(CancelledError);
  });
  it('select subject can be cancelled before it starts', () => {
    expect(() => selectSubject(photoLike(64, 48), { progress: { cancelled: () => true } })).toThrow(CancelledError);
  });
});
