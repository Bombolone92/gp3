import { describe, expect, it, vi } from 'vitest';
import {
  decodeRaster,
  encodeRaster,
  floatRaster,
  rasterHeader,
  rasterMimeType,
} from '../src/model/raster';
import { Assets } from '../src/model/assets';
import { layer, newDocument, resizeDocument } from '../src/model/document';
import { deserialize, serialize, validateDocument } from '../src/model/serialization';
import { History } from '../src/history/history';

describe('native high-depth sources', () => {
  it('checks blob lengths before allocating pixels and honors header subarray offsets', async () => {
    const buffer = encodeRaster({
      width: 1,
      height: 1,
      data: new Uint16Array([1, 2, 3, 65535]),
    });
    const padded = new Uint8Array(32);
    padded.set(new Uint8Array(buffer, 0, 16), 7);
    expect(rasterHeader(padded.subarray(7, 23))).toEqual({
      width: 1,
      height: 1,
      depth: 16,
      byteLength: 24,
    });
    const invalid = new Blob([buffer, new Uint8Array(1)], { type: rasterMimeType });
    const allocate = vi.spyOn(invalid, 'arrayBuffer');
    const assets = new Assets();
    await expect(assets.add(invalid)).rejects.toThrow('length');
    expect(allocate).not.toHaveBeenCalled();
    const id = await assets.addRaster({ width: 1, height: 1, data: new Uint16Array(4) });
    await expect(
      assets.addRaster({ width: 1, height: 1, data: new Uint16Array(4) }, id),
    ).rejects.toThrow('Duplicate');
    assets.clear();
  });

  it('retains original samples and shared asset references through edits, history and project saves', async () => {
    for (const depth of [16, 32] as const)
      for (const [width, height] of [
        [1, 1],
        [3, 2],
        [17, 5],
      ]) {
        const data =
          depth === 16 ? new Uint16Array(width * height * 4) : new Float32Array(width * height * 4);
        for (let i = 0; i < data.length; i++)
          data[i] =
            depth === 16
              ? (i * 509 + 17) % 65536
              : i % 4 === 3
                ? (i % 7) / 6
                : ((i % 13) - 5) * 0.1234567;
        const expected = Array.from(data);
        const assets = new Assets();
        const id = await assets.addRaster({ width, height, data });
        const encoded = await assets.blob(id).arrayBuffer();
        data.fill(0);
        expect(Array.from(assets.raster(id)!.data)).toEqual(expected);
        const doc = newDocument(width + 4, height + 6);
        doc.bitsPerChannel = depth;
        const group = layer('group', 'Sources', doc.width, doc.height);
        const source = layer('image', 'Editable', width, height);
        source.asset = id;
        source.transform.x = -2;
        const copy = {
          ...structuredClone(source),
          id: crypto.randomUUID(),
          visible: false,
        };
        group.children.push(source, copy);
        doc.layers.push(group);
        const history = new History(doc);
        history.execute('Resize', (d) =>
          resizeDocument(d, doc.width * 2, doc.height * 2),
        );
        history.undo();
        history.redo();
        const saved = await serialize(history.document, assets);
        const restored = await deserialize(saved);
        try {
          expect(restored.document).toEqual(history.document);
          expect(restored.assets.dimensions(id)).toEqual({ width, height });
          expect(restored.assets.raster(id)!.data.constructor).toBe(data.constructor);
          expect(Array.from(restored.assets.raster(id)!.data)).toEqual(expected);
          expect(new Uint8Array(await restored.assets.blob(id).arrayBuffer())).toEqual(
            new Uint8Array(encoded),
          );
          expect(() => restored.assets.get(id)).toThrow('typed raster access');
          const savedAgain = await serialize(restored.document, restored.assets);
          expect(new Uint8Array(await savedAgain.arrayBuffer())).toEqual(
            new Uint8Array(await saved.arrayBuffer()),
          );
        } finally {
          restored.assets.clear();
          assets.clear();
        }
        expect(assets.raster(id)).toBeUndefined();
        expect(() => assets.dimensions(id)).toThrow('Missing');
      }
  });

  it('preserves 16-bit channel codes and float bits in bounded little-endian records', () => {
    const source16 = new Uint16Array([999, 0, 1, 32768, 65535, 65534, 83, 4097, 17, 999]);
    const source32 = new Float32Array([
      999, -0, -2.5, 1234.125, 1e-9, 1.000123, 0.1234567, 7, 0, 999,
    ]);
    for (const data of [source16.subarray(1, 9), source32.subarray(1, 9)]) {
      const encoded = encodeRaster({ width: 2, height: 1, data });
      const view = new DataView(encoded);
      expect(view.getUint16(6, true)).toBe(data.BYTES_PER_ELEMENT * 8);
      expect(view.getUint32(8, true)).toBe(2);
      expect(view.getUint32(12, true)).toBe(1);
      if (data instanceof Uint16Array) expect(view.getUint16(20, true)).toBe(32768);
      else expect(view.getFloat32(24, true)).toBe(1234.125);
      const pixels = decodeRaster(encoded);
      expect(pixels.data.constructor).toBe(data.constructor);
      expect(
        new Uint8Array(
          pixels.data.buffer,
          pixels.data.byteOffset,
          pixels.data.byteLength,
        ),
      ).toEqual(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      // Caller buffers, including sliced views, do not alias a saved asset.
      const original = data[1];
      data[1] = 0;
      expect(pixels.data[1]).toBe(original);
    }
  });

  it('normalizes full-range unsigned samples without quantizing to byte precision', () => {
    const pixels = {
      width: 1,
      height: 1,
      data: new Uint16Array([1, 32768, 65534, 65535]),
    };
    const floats = floatRaster(pixels);
    for (let i = 0; i < 4; i++) expect(floats[i]).toBeCloseTo(pixels.data[i] / 65535, 7);
    const hdr = {
      width: 1,
      height: 1,
      data: new Float32Array([-1, 7.25, 1.000123, 0.125]),
    };
    expect(floatRaster(hdr)).toBe(hdr.data);
  });

  it('rejects malformed lengths, versions, depths and dimensions before creating source views', () => {
    const valid = encodeRaster({ width: 1, height: 1, data: new Uint16Array(4) });
    for (const size of [0, 15, 16, valid.byteLength - 1])
      expect(() => decodeRaster(valid.slice(0, size))).toThrow();
    const trailing = new ArrayBuffer(valid.byteLength + 1);
    new Uint8Array(trailing).set(new Uint8Array(valid));
    expect(() => decodeRaster(trailing)).toThrow('length');
    for (const [offset, value] of [
      [4, 2],
      [6, 8],
      [6, 64],
    ]) {
      const copy = valid.slice(0);
      new DataView(copy).setUint16(offset, value, true);
      expect(() => decodeRaster(copy)).toThrow('format');
    }
    for (const [offset, value] of [
      [8, 0],
      [12, 8193],
      [8, 0xffffffff],
    ]) {
      const copy = valid.slice(0);
      new DataView(copy).setUint32(offset, value, true);
      expect(() => decodeRaster(copy)).toThrow();
    }
    const copy = valid.slice(0);
    new Uint8Array(copy)[0] = 0;
    expect(() => decodeRaster(copy)).toThrow('header');
    expect(() => encodeRaster({ width: 1, height: 1, data: new Uint16Array(3) })).toThrow(
      'source',
    );
  });

  it('validates explicit channel depth while preserving the default of older projects', () => {
    const doc = newDocument(1, 1);
    expect(doc.bitsPerChannel).toBeUndefined();
    for (const depth of [8, 16, 32] as const) {
      doc.bitsPerChannel = depth;
      expect(validateDocument(doc).bitsPerChannel).toBe(depth);
    }
    for (const invalid of [0, 1, 24, 64, '32', null, NaN])
      expect(() => validateDocument({ ...doc, bitsPerChannel: invalid })).toThrow(
        'depth',
      );
  });

  it('allows finite HDR RGB and rejects invalid float coverage and non-finite samples', () => {
    const valid = encodeRaster({
      width: 1,
      height: 1,
      data: new Float32Array([-100, 100, 0, 1]),
    });
    for (const [component, value] of [
      [0, Infinity],
      [1, NaN],
      [2, -Infinity],
      [3, -0.1],
      [3, 1.01],
    ]) {
      const copy = valid.slice(0);
      new DataView(copy).setFloat32(16 + component * 4, value, true);
      expect(() => decodeRaster(copy)).toThrow('sample');
    }
  });
});
