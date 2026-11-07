import { describe, expect, it } from 'vitest';
import { fillPatternRGBA8, findPatternPreset, patternPresets, renderPattern, type Pattern } from '../src/imaging/pattern';
import { mask8, rgba8, type RGBA8 } from '../src/imaging/types';

const at = (img: RGBA8, x: number, y: number) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
const diff = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);

describe('pattern presets', () => {
  it('ships 12 unique, deterministic tiles', () => {
    const list = patternPresets();
    expect(list).toHaveLength(12);
    expect(new Set(list.map((p) => p.id)).size).toBe(12);
    for (const id of ['checker', 'stripes', 'dots', 'grid', 'noise', 'wood', 'paper', 'canvas', 'bricks', 'hexagons', 'hatch', 'bubbles'])
      expect(findPatternPreset(id), id).toBeDefined();
    for (const p of list) {
      expect(p.tile.data.length).toBe(p.tile.width * p.tile.height * 4);
      expect(p.tile.data.some((v, i) => i % 4 === 3 && v > 0), p.id).toBe(true);
    }
  });
  it('tiles are continuous across their wrap seams', () => {
    for (const p of patternPresets()) {
      const { width: w, height: h } = p.tile;
      // The seam between the last and first column (row) must not be rougher
      // than the roughest column (row) boundary inside the tile.
      const colDiff = (x0: number, x1: number) => {
        let s = 0;
        for (let y = 0; y < h; y++) s += diff(at(p.tile, x0, y), at(p.tile, x1, y));
        return s / h;
      };
      const rowDiff = (y0: number, y1: number) => {
        let s = 0;
        for (let x = 0; x < w; x++) s += diff(at(p.tile, x, y0), at(p.tile, x, y1));
        return s / w;
      };
      let maxCol = 0, maxRow = 0;
      for (let x = 0; x + 1 < w; x++) maxCol = Math.max(maxCol, colDiff(x, x + 1));
      for (let y = 0; y + 1 < h; y++) maxRow = Math.max(maxRow, rowDiff(y, y + 1));
      // A real discontinuity spikes above its neighbouring boundaries too.
      const colLimit = Math.max(maxCol, 1.5 * Math.max(colDiff(w - 2, w - 1), colDiff(0, 1)));
      const rowLimit = Math.max(maxRow, 1.5 * Math.max(rowDiff(h - 2, h - 1), rowDiff(0, 1)));
      expect(colDiff(w - 1, 0), `${p.id} columns`).toBeLessThanOrEqual(colLimit + 1);
      expect(rowDiff(h - 1, 0), `${p.id} rows`).toBeLessThanOrEqual(rowLimit + 1);
    }
  });
});

describe('renderPattern', () => {
  const checker = () => findPatternPreset('checker')!;
  it('repeats the tile exactly at identity and honors integer offsets', () => {
    const p = findPatternPreset('bricks')!;
    const img = renderPattern(300, 200, p);
    for (const [x, y] of [[0, 0], [130, 99], [299, 199], [64, 48]])
      expect(at(img, x, y)).toEqual(at(p.tile, x % p.tile.width, y % p.tile.height));
    const shifted = renderPattern(50, 50, p, { offset: { x: 7, y: -3 } });
    expect(at(shifted, 7, 0)).toEqual(at(p.tile, 0, 3));
    const tileOff = renderPattern(50, 50, p, { offset: { x: p.tile.width, y: 0 } });
    expect(tileOff.data).toEqual(renderPattern(50, 50, p).data);
  });
  it('scales about the origin', () => {
    const img = renderPattern(128, 128, checker(), { scale: 2 });
    // cells become 32 px; sample cell interiors away from bilinear edges
    expect(at(img, 10, 10)).toEqual(at(checker().tile, 0, 0));
    expect(at(img, 42, 10)).toEqual(at(checker().tile, 20, 0));
    expect(at(img, 42, 42)).toEqual(at(checker().tile, 0, 0));
  });
  it('rotates counterclockwise: vertical stripes become horizontal at 90 degrees', () => {
    const p = findPatternPreset('stripes')!;
    const img = renderPattern(64, 64, p, { angle: 90 });
    for (let y = 0; y < 64; y++)
      for (let x = 1; x < 64; x++) expect(diff(at(img, x, y), at(img, 0, y))).toBeLessThanOrEqual(3);
    const variesDown = new Set(Array.from({ length: 32 }, (_, y) => at(img, 5, y)[0]));
    expect(variesDown.size).toBeGreaterThanOrEqual(2);
  });
  it('interpolates premultiplied so transparent texels do not darken edges', () => {
    const tile = rgba8(2, 1);
    tile.data.set([255, 0, 0, 255, 0, 255, 0, 0]);
    const p: Pattern = { id: 't', name: 't', tile };
    const img = renderPattern(8, 1, p, { scale: 4 });
    for (let x = 0; x < 8; x++) {
      const [r, g, , a] = at(img, x, 0);
      if (a > 0) {
        expect(r).toBe(255);
        expect(g).toBe(0);
      }
    }
  });
});

describe('fillPatternRGBA8', () => {
  it('composites within the rect and weights by mask coverage', () => {
    const dst = rgba8(10, 10, [0, 0, 255, 255]);
    const p = findPatternPreset('checker')!;
    const m = mask8(10, 10, 255);
    m.data[3 * 10 + 3] = 0;
    m.data[4 * 10 + 4] = 128;
    fillPatternRGBA8(dst, p, { rect: { x: 2, y: 2, width: 5, height: 5 }, mask: m });
    expect(at(dst, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(at(dst, 3, 3)).toEqual([0, 0, 255, 255]);
    expect(at(dst, 2, 2)).toEqual(at(p.tile, 2, 2));
    const half = at(dst, 4, 4);
    expect(Math.abs(half[0] - at(p.tile, 4, 4)[0] * (128 / 255))).toBeLessThanOrEqual(1);
    expect(half[2]).toBeGreaterThan(100);
  });
  it('replace mode overwrites including alpha', () => {
    const dst = rgba8(4, 4, [9, 9, 9, 255]);
    fillPatternRGBA8(dst, findPatternPreset('dots')!, { replace: true });
    expect(at(dst, 0, 0)[3]).toBe(at(findPatternPreset('dots')!.tile, 0, 0)[3]);
  });
});
