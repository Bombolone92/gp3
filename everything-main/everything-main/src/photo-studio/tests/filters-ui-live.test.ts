import { describe, expect, it } from 'vitest';
import { newDocument, type LiveFilter } from '../src/model/document';
import { Assets } from '../src/model/assets';
import { commitPixelResample, commitPixelTranslation, documentTileIds, newPixelLayer, setLayerPixels } from '../src/model/pixel-layer';
import { gridDocBounds, gridFromImage, readRGBA, type TileGrid } from '../src/model/tiles';
import { deserialize, serialize, validateDocument } from '../src/model/serialization';
import type { RGBA8 } from '../src/imaging/types';

function img(w: number, h: number, seed: number): RGBA8 {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    data[i] = i % 4 === 3 ? 255 : (s >>> 16) & 255;
  }
  return { width: w, height: h, data };
}
const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Buffer.compare(Buffer.from(a as Uint8Array), Buffer.from(b as Uint8Array)) === 0;
const filter = (over: Partial<LiveFilter> = {}): LiveFilter => ({ id: 'gaussian-blur', params: { radius: 3 }, enabled: true, opacity: 1, blend: 'normal', seed: 42, ...over });

function liveDoc() {
  const assets = new Assets();
  const doc = newDocument(300, 200, 'Live');
  const source = gridFromImage(assets.tiles, img(120, 80, 1), 20, 30);
  const result = gridFromImage(assets.tiles, img(120, 80, 2), 20, 30);
  const mask = gridFromImage(assets.tiles, { width: 50, height: 40, data: new Uint8Array(2000).fill(200) }, 0, 0);
  const l = newPixelLayer('L', doc, result);
  l.liveSource = source;
  l.liveFilters = [filter(), filter({ id: 'twirl', params: { angle: 90 }, opacity: 0.5, blend: 'multiply', enabled: false, seed: 7 })];
  l.liveMask = mask;
  doc.layers.push(l);
  return { doc, assets, l };
}

describe('Live Filter model', () => {
  it('round-trips the source, filter list and mask through a .photo project', async () => {
    const { doc, assets, l } = liveDoc();
    const back = await deserialize(await serialize(doc, assets));
    const r = back.document.layers[0];
    expect(r.liveFilters).toEqual(l.liveFilters);
    const rect = { x: 20, y: 30, width: 120, height: 80 };
    expect(same(readRGBA(back.assets.tiles, r.liveSource as TileGrid, rect).data, readRGBA(assets.tiles, l.liveSource!, rect).data)).toBe(true);
    expect(same(readRGBA(back.assets.tiles, r.pixels as TileGrid, rect).data, readRGBA(assets.tiles, l.pixels!, rect).data)).toBe(true);
    expect((r.liveMask as TileGrid).channels).toBe(1);
  });
  it('rejects malformed Live Filters', () => {
    const base = () => JSON.parse(JSON.stringify(liveDoc().doc));
    const withPacks = (d: ReturnType<typeof base>) => {
      d.layers[0].pixels = { pack: 'a' };
      d.layers[0].liveSource = { pack: 'b' };
      d.layers[0].liveMask = { pack: 'c' };
      return d;
    };
    expect(() => validateDocument(withPacks(base()))).not.toThrow();
    const bad: ((d: ReturnType<typeof base>) => void)[] = [
      (d) => (d.layers[0].liveFilters = 'x'),
      (d) => delete d.layers[0].liveSource,
      (d) => (d.layers[0].liveFilters[0].opacity = 2),
      (d) => (d.layers[0].liveFilters[0].blend = 'pass through'),
      (d) => (d.layers[0].liveFilters[0].seed = -1),
      (d) => (d.layers[0].liveFilters[0].params = null),
      (d) => (d.layers[0].liveFilters[0].enabled = 'yes'),
      (d) => (d.layers[0].liveFilters[0].id = ''),
      (d) => (d.layers[0].liveMask = 5),
      (d) => {
        d.layers[0].kind = 'solid';
        delete d.layers[0].pixels;
      },
    ];
    for (const f of bad) {
      const d = withPacks(base());
      f(d);
      expect(() => validateDocument(d)).toThrow();
    }
  });
  it('keeps source tiles alive for garbage collection', () => {
    const { doc, l } = liveDoc();
    const ids = documentTileIds(doc);
    for (const id of Object.values(l.liveSource!.tiles)) expect(ids.has(id)).toBe(true);
    for (const id of Object.values(l.liveMask!.tiles)) expect(ids.has(id)).toBe(true);
  });
  it('moves the source and mask with the layer', () => {
    const { l } = liveDoc();
    l.transform = { ...l.transform, x: l.transform.x + 15, y: l.transform.y - 4 };
    commitPixelTranslation(l);
    expect(gridDocBounds(l.liveSource!)).toEqual({ x: 35, y: 26, width: 120, height: 80 });
    expect(l.liveMask!.x).toBe(15);
    expect(gridDocBounds(l.pixels!)).toEqual(gridDocBounds(l.liveSource!));
  });
  it('resamples the source with the layer so an empty stack stays identical', () => {
    const assets = new Assets();
    const doc = newDocument(400, 300);
    const g = gridFromImage(assets.tiles, img(60, 40, 5), 10, 20);
    const l = newPixelLayer('L', doc, g);
    l.liveSource = g;
    l.liveFilters = [];
    l.transform = { x: 50, y: 40, width: 120, height: 60, rotation: 30 };
    commitPixelResample(l, assets.tiles, doc);
    const b = gridDocBounds(l.pixels!)!;
    expect(gridDocBounds(l.liveSource!)).toEqual(b);
    expect(same(readRGBA(assets.tiles, l.liveSource!, b).data, readRGBA(assets.tiles, l.pixels!, b).data)).toBe(true);
  });
  it('scales the Live Filter mask with the layer', () => {
    const assets = new Assets();
    const doc = newDocument(300, 200, 'Live');
    const g = gridFromImage(assets.tiles, img(60, 40, 5), 10, 20);
    const l = newPixelLayer('L', doc, g);
    l.liveSource = g;
    l.liveFilters = [filter()];
    // The mask covers the left half of the layer.
    l.liveMask = gridFromImage(assets.tiles, { width: 30, height: 40, data: new Uint8Array(1200).fill(255) }, 10, 20);
    l.transform = { x: 10, y: 20, width: 120, height: 80, rotation: 0 };
    commitPixelResample(l, assets.tiles, doc);
    expect(gridDocBounds(l.pixels!)).toEqual({ x: 10, y: 20, width: 120, height: 80 });
    const m = gridDocBounds(l.liveMask!)!;
    expect(m.x).toBe(10);
    expect(m.width).toBeGreaterThanOrEqual(60);
    expect(m.width).toBeLessThanOrEqual(62);
    expect(m.height).toBeGreaterThanOrEqual(80);
  });
  it('drops Live Filters when pixels are written destructively', () => {
    const { doc, assets, l } = liveDoc();
    setLayerPixels(l, gridFromImage(assets.tiles, img(10, 10, 3)), doc);
    expect(l.liveSource).toBeUndefined();
    expect(l.liveFilters).toBeUndefined();
    expect(l.liveMask).toBeUndefined();
  });
});
