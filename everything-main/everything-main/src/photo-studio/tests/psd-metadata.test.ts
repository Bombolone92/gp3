import { describe, expect, it } from 'vitest';
import { Assets } from '../src/model/assets';
import { newDocument, layer } from '../src/model/document';
import {
  serialize,
  deserialize,
  validateDocument,
} from '../src/model/serialization';
import { History } from '../src/history/history';
import {
  readPsdMetadata,
  encodePsdMetadata,
  decodePsdMetadata,
  restorePsdMetadata,
  type PsdMetadata,
  type PsdTag,
  psdMetadataMimeType,
} from '../src/model/psd-metadata';

const wideKeys = new Set([
  'LMsk',
  'FMsk',
  'Lr16',
  'Lr32',
  'Mt16',
  'Mt32',
  'Layr',
  'Mtrn',
  'Alph',
]);
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
// Independent section builder, including deliberately different core/merged data.
function file(
  psb: boolean,
  blocks: PsdTag[] = [],
  mask: Uint8Array = new Uint8Array(),
  padding = 4,
  empty = false,
) {
  const prefix = 26 + 4 + 3 + 4 + 5,
    lengthSize = psb ? 8 : 4;
  const layer = new Uint8Array([0, 0, 19, 27, 31, 43]);
  const coreSize = empty ? 0 : lengthSize + layer.length + 4 + mask.length;
  const tagSize = (t: PsdTag) =>
    (t.wideLength || (psb && wideKeys.has(t.key)) ? 16 : 12) +
    Math.ceil(t.data.length / padding) * padding;
  const sectionSize = coreSize + blocks.reduce((n, b) => n + tagSize(b), 0);
  const suffix = new Uint8Array([0, 0, 7, 9, 11, 13, 17, 23]);
  const out = new Uint8Array(prefix + lengthSize + sectionSize + suffix.length),
    v = new DataView(out.buffer);
  out.set(ascii('8BPS'));
  v.setUint16(4, psb ? 2 : 1);
  v.setUint16(12, 3);
  v.setUint32(14, 2);
  v.setUint32(18, 1);
  v.setUint16(22, 8);
  v.setUint16(24, 3);
  v.setUint32(26, 3);
  out.set([1, 2, 3], 30);
  v.setUint32(33, 5);
  out.set([5, 7, 9, 11, 13], 37);
  v.setUint32(prefix + (psb ? 4 : 0), sectionSize);
  let at = prefix + lengthSize;
  if (!empty) {
    v.setUint32(at + (psb ? 4 : 0), layer.length);
    at += lengthSize;
    out.set(layer, at);
    at += layer.length;
    v.setUint32(at, mask.length);
    at += 4;
    out.set(mask, at);
    at += mask.length;
  }
  for (const b of blocks) {
    const wide = b.wideLength || (psb && wideKeys.has(b.key));
    // Known PSB keys deliberately retain 8BIM; key/version define their width.
    out.set(ascii(b.wideLength ? '8B64' : '8BIM'), at);
    out.set(ascii(b.key), at + 4);
    v.setUint32(at + (wide ? 12 : 8), b.data.length);
    out.set(b.data, at + (wide ? 16 : 12));
    at += tagSize(b);
  }
  out.set(suffix, at);
  return { out, prefix, lengthSize, coreSize, layer, suffix };
}
const metadata: PsdMetadata = {
  globalMask: new Uint8Array([0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 50, 128]),
  tags: [
    {
      key: 'LMsk',
      data: new Uint8Array([0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 50, 128, 0]),
    },
    {
      key: 'FMsk',
      data: new Uint8Array([0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 0, 75]),
    },
    { key: 'z\x81\0Z', data: new Uint8Array([0, 255, 17]) },
    {
      key: 'wide',
      data: new Uint8Array([11, 13, 17, 19, 23]),
      wideLength: true,
    },
    { key: 'zero', data: new Uint8Array() },
  ],
};

describe('PSD document metadata', () => {
  it('preserves global masks and odd/empty/unknown/wide records across file versions and native assets', () => {
    for (const sourceVersion of [false, true])
      for (const destinationVersion of [false, true]) {
        const original = file(
          sourceVersion,
          metadata.tags,
          metadata.globalMask,
        );
        const wrapped = new Uint8Array(original.out.length + 7);
        wrapped.set(original.out, 7);
        const captured = readPsdMetadata(wrapped.subarray(7));
        const native = decodePsdMetadata(
          new Uint8Array(encodePsdMetadata(captured)),
        );
        expect(native).toEqual(captured);
        expect(native.globalMask).toEqual(metadata.globalMask);
        expect(native.tags.map((t) => [t.key, Array.from(t.data)])).toEqual(
          metadata.tags.map((t) => [t.key, Array.from(t.data)]),
        );
        const destination = file(destinationVersion);
        const output = new Uint8Array(
          restorePsdMetadata(destination.out, native),
        );
        expect(readPsdMetadata(output)).toEqual(native);
        expect(output.subarray(0, destination.prefix)).toEqual(
          destination.out.subarray(0, destination.prefix),
        );
        expect(
          output.subarray(
            destination.prefix + destination.lengthSize,
            destination.prefix +
              2 * destination.lengthSize +
              destination.layer.length,
          ),
        ).toEqual(
          destination.out.subarray(
            destination.prefix + destination.lengthSize,
            destination.prefix +
              2 * destination.lengthSize +
              destination.layer.length,
          ),
        );
        expect(output.subarray(-destination.suffix.length)).toEqual(
          destination.suffix,
        );
      }
  });
  it('regenerates layer/depth/transparency records and keeps current model-owned globals authoritative', () => {
    const structural = ['Layr', 'Lr16', 'Lr32', 'Mtrn', 'Mt16', 'Mt32'].map(
      (key) => ({ key, data: new Uint8Array([3, 5]) }),
    );
    const source = file(true, [...structural, ...metadata.tags]);
    expect(readPsdMetadata(source.out).tags.map((t) => t.key)).toEqual(
      metadata.tags.map((t) => t.key),
    );
    for (const key of structural.map((t) => t.key))
      expect(() =>
        encodePsdMetadata({
          globalMask: new Uint8Array(),
          tags: [{ key, data: new Uint8Array() }],
        }),
      ).toThrow('editable layer records');
    const current = { key: 'FMsk', data: new Uint8Array([29, 31, 37, 41]) };
    const updatedLayerRecord = { key: 'Lr32', data: new Uint8Array([61, 67]) };
    const destination = file(
      true,
      [updatedLayerRecord, current],
      new Uint8Array([47, 53]),
    );
    const output = new Uint8Array(
      restorePsdMetadata(destination.out, metadata),
    );
    const decoded = readPsdMetadata(output);
    expect(decoded.globalMask).toEqual(new Uint8Array([47, 53]));
    expect(decoded.tags.filter((t) => t.key === 'FMsk')).toEqual([
      { ...current, wideLength: undefined },
    ]);
    expect(output.length).toBeGreaterThan(destination.out.length);
    // Lr32 payload is from the new model, unchanged, and not the source's other layer variants.
    const layerDataOffset =
      destination.prefix + destination.lengthSize + destination.coreSize + 16;
    expect(output.subarray(layerDataOffset, layerDataOffset + 2)).toEqual(
      updatedLayerRecord.data,
    );
  });
  it('supports empty layer sections and recovers legacy two-byte global padding without scanning payloads', () => {
    for (const psb of [false, true]) {
      const legacy = file(psb, metadata.tags, metadata.globalMask, 2);
      const decoded = readPsdMetadata(legacy.out);
      expect(decoded.tags.map((t) => Array.from(t.data))).toEqual(
        metadata.tags.map((t) => Array.from(t.data)),
      );
      const empty = file(psb, [], new Uint8Array(), 4, true);
      const output = new Uint8Array(restorePsdMetadata(empty.out, decoded));
      expect(readPsdMetadata(output)).toEqual(decoded);
      expect(output.subarray(-empty.suffix.length)).toEqual(empty.suffix);
    }
  });
  it('rejects truncated/oversized sections, malformed native assets and invalid metadata keys', () => {
    const source = file(true, metadata.tags, metadata.globalMask);
    for (const length of [
      0,
      25,
      28,
      37,
      source.out.length - source.suffix.length - 1,
    ])
      expect(() => readPsdMetadata(source.out.slice(0, length))).toThrow();
    const oversized = source.out.slice();
    new DataView(oversized.buffer).setUint32(source.prefix, 1);
    expect(() => readPsdMetadata(oversized)).toThrow('budget');
    const native = new Uint8Array(encodePsdMetadata(metadata));
    for (const data of [
      native.slice(0, 10),
      native.slice(0, -1),
      new Uint8Array(native.length),
    ])
      expect(() => decodePsdMetadata(data)).toThrow();
    expect(() =>
      encodePsdMetadata({
        globalMask: new Uint8Array(),
        tags: [{ key: 'longer', data: new Uint8Array() }],
      }),
    ).toThrow('key');
    const injected = native.slice();
    injected.set(ascii('Lr32'), 12 + metadata.globalMask.length + 4);
    expect(() => decodePsdMetadata(injected)).toThrow('editable layer records');
    expect(() =>
      restorePsdMetadata(source.out, {
        globalMask: new Uint8Array(),
        tags: [{ key: 'Lr16', data: new Uint8Array() }],
      }),
    ).toThrow('editable layer records');
  });
  it('stores bulk opaque bytes outside JSON/history and validates asset references without treating metadata as an image', async () => {
    const opaque = Uint8Array.from(
      { length: 1024 * 1024 + 3 },
      (_, i) => i % 251,
    );
    const encoded = encodePsdMetadata({
      globalMask: new Uint8Array(),
      tags: [{ key: 'data', data: opaque }],
    });
    const assets = new Assets(),
      doc = newDocument(2, 3);
    let project: Awaited<ReturnType<typeof deserialize>> | undefined;
    try {
      const id = await assets.add(
        new Blob([encoded], { type: psdMetadataMimeType }),
      );
      doc.psdMetadataAsset = id;
      const l = layer('solid', 'Editable', 2, 3);
      l.psdId = 0xffffffff;
      doc.layers.push(l);
      const history = new History(doc);
      history.execute('Rename', (d) => {
        d.name = 'Edited';
      });
      history.undo();
      history.redo();
      expect(history.document.psdMetadataAsset).toBe(id);
      expect(history.document.layers[0].psdId).toBe(0xffffffff);
      const saved = await serialize(history.document, assets);
      const header = new DataView(await saved.slice(0, 12).arrayBuffer());
      expect(header.getUint32(8, true)).toBeLessThan(2048);
      project = await deserialize(saved);
      expect(project.document.psdMetadataAsset).toBe(id);
      const decoded = decodePsdMetadata(
        new Uint8Array(await project.assets.blob(id).arrayBuffer()),
      );
      expect(decoded.tags[0].data.length).toBe(opaque.length);
      expect(decoded.tags[0].data.every((v, i) => v === opaque[i])).toBe(true);
      expect(() => assets.dimensions(id)).toThrow('Missing image asset');
      expect(() => validateDocument({ ...doc, psdMetadataAsset: 7 })).toThrow(
        'metadata asset reference',
      );
      for (const badId of [-1, 1.5, 0x100000000, NaN])
        expect(() =>
          validateDocument({ ...doc, layers: [{ ...l, psdId: badId }] }),
        ).toThrow('layer identifier');
      await expect(
        assets.add(
          new Blob([new Uint8Array(12)], { type: psdMetadataMimeType }),
        ),
      ).rejects.toThrow('native PSD metadata');
      const rasterId = await assets.addRaster({
        width: 2,
        height: 3,
        data: new Uint16Array(2 * 3 * 4),
      });
      await expect(
        deserialize(
          await serialize({ ...doc, psdMetadataAsset: rasterId }, assets),
        ),
      ).rejects.toThrow('metadata asset type');
    } finally {
      assets.clear();
      project?.assets.clear();
    }
  });
});
