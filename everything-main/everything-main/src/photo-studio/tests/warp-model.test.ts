import { describe, expect, it } from 'vitest';
import { layer, newDocument } from '../src/model/document';
import { Assets } from '../src/model/assets';
import { deserialize, serialize, validateDocument } from '../src/model/serialization';
import { migratePinWarps, type PinWarpRecord } from '../src/model/pin-warp';

const raster = (w: number, h: number, v: number) => ({ width: w, height: h, data: new Uint16Array(w * h * 4).fill(v) });

describe('editable Pin Warp records', () => {
  const record = (source: string, result: string): PinWarpRecord => ({
    source,
    sourceWidth: 4,
    sourceHeight: 3,
    result,
    bounds: { x: -1, y: -1, width: 6, height: 5 },
    mode: 'rigid',
    density: 'normal',
    expansion: 2,
    pins: [
      { x: 1, y: 1, tx: 1.5, ty: 0.5, depth: 0 },
      { x: 3, y: 2, tx: 3, ty: 2, depth: 1, angle: 0.25 },
    ],
  });

  it('from older projects are validated', () => {
    const doc = newDocument(8, 8),
      l = layer('image', 'Photo', 6, 5);
    l.asset = 'result';
    l.pinWarp = record('source', 'result');
    doc.layers.push(l);
    expect(() => validateDocument(doc)).not.toThrow();
    for (const bad of [
      { ...record('source', 'result'), pins: [{ x: NaN, y: 0, tx: 0, ty: 0, depth: 0 }] },
      { ...record('source', 'result'), mode: 'wobbly' },
      { ...record('source', 'result'), bounds: { x: 0, y: 0, width: 0, height: 1 } },
      { ...record('', 'result') },
    ]) {
      l.pinWarp = bad as PinWarpRecord;
      expect(() => validateDocument(doc)).toThrow('Pin Warp');
    }
    // A layer converted to pixels drops its record.
    const p = layer('pixel', 'Pixels', 4, 4);
    p.pixels = { tiles: {}, channels: 4, x: 0, y: 0, bounds: null } as never;
    p.pinWarp = record('source', 'result');
    expect(() => validateDocument({ ...doc, layers: [p] })).not.toThrow();
    expect(p.pinWarp).toBeUndefined();
  });

  it('load as embedded objects whose frame holds the pins', async () => {
    const assets = new Assets();
    const source = await assets.addRaster(raster(4, 3, 1000));
    const result = await assets.addRaster(raster(6, 5, 2000));
    const doc = newDocument(8, 8),
      l = layer('image', 'Photo', 6, 5);
    l.asset = result;
    l.transform = { x: 1, y: 2, width: 6, height: 5, rotation: 0 };
    l.pinWarp = record(source, result);
    doc.layers.push(l);
    const restored = await deserialize(await serialize(doc, assets));
    const back = restored.document.layers[0];
    expect(back.pinWarp).toBeUndefined();
    const contents = restored.document.embeds![back.embed!.contents];
    expect(contents).toMatchObject({ width: 4, height: 3, composite: source });
    expect(restored.assets.raster(contents.composite)?.data[0]).toBe(1000);
    const f = back.embed!.frame!;
    // The cached render is the old result; source pixel (0, 0) sat at result (1, 1).
    expect(back.asset).toBe(result);
    expect(f.source).toBe(source);
    expect(f.rect).toEqual({ x: 1, y: 2, width: 6, height: 5 });
    expect(f.quad).toEqual([[2, 3], [6, 3], [6, 6], [2, 6]]);
    expect(f.pins).toMatchObject({ mode: 'rigid', width: 4, height: 3 });
    expect(f.pins!.pins[1].angle).toBe(0.25);
    // A record that no longer matches its layer is dropped.
    const stale = layer('image', 'Other', 6, 5);
    stale.asset = 'other';
    stale.pinWarp = record(source, result);
    const d2 = { ...newDocument(8, 8), layers: [stale] };
    migratePinWarps(d2);
    expect(stale.pinWarp).toBeUndefined();
    expect(stale.embed).toBeUndefined();
  });

  it('round-trip as pin frames of embedded objects and are validated', async () => {
    const assets = new Assets();
    const content = await assets.addRaster(raster(4, 3, 500));
    const cache = await assets.addRaster(raster(6, 5, 600));
    const doc = newDocument(8, 8),
      l = layer('image', 'Photo', 6, 5);
    doc.embeds = { c1: { id: 'c1', name: 'Photo', width: 4, height: 3, composite: content, colorSpace: 'document' } };
    l.asset = cache;
    l.embed = {
      contents: 'c1',
      frame: { quad: [[0, 0], [4, 0], [4, 3], [0, 3]], rect: { x: 0, y: 0, width: 6, height: 5 }, source: content, pins: { mode: 'normal', density: 'fewer', expansion: 2, width: 4, height: 3, pins: [{ x: 1, y: 1, tx: 2, ty: 1, depth: 0 }] } },
    };
    doc.layers.push(l);
    const back = (await deserialize(await serialize(doc, assets))).document.layers[0];
    expect(back.embed?.frame?.pins?.pins).toEqual([{ x: 1, y: 1, tx: 2, ty: 1, depth: 0 }]);
    l.embed.frame!.pins!.pins[0].tx = NaN;
    expect(() => validateDocument(doc)).toThrow('Pin Warp');
    l.embed.frame!.pins!.pins[0].tx = 2;
    l.embed.frame!.mesh = { cols: 2, rows: 2, points: [0, 0, 4, 0, 0, 3, 4, 3] };
    expect(() => validateDocument(doc)).toThrow('warp');
  });

  it('do not keep embedded contents on layers turned into pixels', async () => {
    const assets = new Assets();
    const content = await assets.addRaster(raster(4, 3, 500));
    const doc = newDocument(8, 8),
      l = layer('pixel', 'Was embedded', 8, 8);
    l.pixels = { tiles: {}, channels: 4, x: 0, y: 0, bounds: null } as never;
    doc.embeds = { c1: { id: 'c1', name: 'Photo', width: 4, height: 3, composite: content, colorSpace: 'document' } };
    l.embed = { contents: 'c1' };
    doc.layers.push(l);
    const back = await deserialize(await serialize(doc, assets));
    expect(back.document.layers[0].embed).toBeUndefined();
    expect(back.document.embeds).toBeUndefined();
  });

  it('store warped pixels as an asset right away', () => {
    const assets = new Assets();
    const rgba = new Uint8ClampedArray([255, 128, 0, 255, 10, 20, 30, 40]);
    const id = assets.addPixels(2, 1, rgba, () => new Blob([]));
    const r = assets.raster(id)!;
    expect(r.width).toBe(2);
    expect(Array.from(r.data, (v) => v / 257)).toEqual(Array.from(rgba));
    expect(assets.dimensions(id)).toEqual({ width: 2, height: 1 });
  });
});
