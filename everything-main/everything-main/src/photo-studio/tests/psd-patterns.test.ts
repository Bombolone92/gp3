import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deflateSync as deflate } from "node:zlib";
import { writePsd } from "ag-psd";
import { infoHandlersMap } from "ag-psd/dist/additionalInfo";
import {
  indexPsdPatterns,
  decodePsdPattern,
  decodePsdPatternChannel,
  readPsdWithPatternResources,
} from "../src/model/psd-patterns";
import {
  encodePsdMetadata,
  decodePsdMetadata,
  restorePsdMetadata,
  readPsdMetadata,
} from "../src/model/psd-metadata";

function fixture(name: string) {
  return new Uint8Array(
    readFileSync(new URL(`fixtures/psd-patterns/${name}.bin`, import.meta.url)),
  );
}
const options = {
  useRawData: true,
  skipCompositeImageData: true,
  skipThumbnail: true,
};
const rgb = (depth: number) =>
  depth === 8
    ? [0, 1, 63, 128, 254, 255]
    : depth === 16
      ? [0, 1, 256, 32768, 65534, 65535]
      : [-0, 2 ** -149, -0.25, 0.625, 1, 2.75];
const alpha32 = [-0, 2 ** -149, Math.fround(0.0000125), 0.625, 1, 0];

describe("native PSD pattern resources", () => {
  it("decodes independently encoded RAW/RLE/ZIP/prediction at 8/16/32 bits with separate alpha", () => {
    for (const depth of [8, 16, 32])
      for (const compression of [0, 1, 2, 3]) {
        const bytes = fixture(`rgb-${depth}-${compression}`),
          before = bytes.slice(),
          [pattern] = indexPsdPatterns(bytes),
          pixels = decodePsdPattern(pattern);
        expect(pattern.name).toBe(`Independent rgb-${depth}-${compression} Ω`);
        expect(pattern.size).toEqual([2, 3]);
        expect(pattern.bounds).toEqual({
          top: 3,
          left: 7,
          bottom: 5,
          right: 10,
        });
        expect(pixels.width).toBe(3);
        expect(pixels.height).toBe(2);
        expect(pixels.data.constructor).toBe(
          depth === 8 ? Uint8Array : depth === 16 ? Uint16Array : Float32Array,
        );
        const colors = rgb(depth),
          alpha = depth === 32 ? alpha32 : colors;
        for (let i = 0; i < 6; i++) {
          for (let c = 0; c < 3; c++)
            expect(Object.is(pixels.data[i * 4 + c], colors[(i + c) % 6])).toBe(
              true,
            );
          expect(Object.is(pixels.data[i * 4 + 3], alpha[i])).toBe(true);
        }
        expect(bytes).toEqual(before);
        expect(decodePsdPattern(pattern).data).toEqual(pixels.data);
        expect(pattern.raw).toEqual(bytes);
      }
  });

  it("decodes grayscale and indexed RLE without treating alpha as palette indices", () => {
    const values = rgb(8),
      alpha = [255, 0, 1, 254, 128, 63];
    for (const mode of ["gray", "indexed"]) {
      const [pattern] = indexPsdPatterns(fixture(mode)),
        { data } = decodePsdPattern(pattern);
      for (let i = 0; i < 6; i++) {
        const expected =
          mode === "gray"
            ? [values[i], values[i], values[i]]
            : [values[i], 255 - values[i], (values[i] * 37) % 256];
        expect(Array.from(data.subarray(i * 4, i * 4 + 4))).toEqual([
          ...expected,
          alpha[i],
        ]);
      }
    }
  });

  it("respects typed-array offsets and keeps RAW samples unchanged on repeat decoding", () => {
    const original = fixture("rgb-32-0"),
      backing = new Uint8Array(original.length + 39);
    backing.set(original, 17);
    const bytes = backing.subarray(17, 17 + original.length),
      before = backing.slice(),
      [pattern] = indexPsdPatterns(bytes);
    expect(pattern.raw).toEqual(original);
    expect(decodePsdPattern(pattern).data).toEqual(
      decodePsdPattern(indexPsdPatterns(original)[0]).data,
    );
    expect(backing).toEqual(before);
  });

  it("streams multiple ZIP chunks with exact bounded output from an independent zlib encoder", () => {
    const [pattern] = indexPsdPatterns(fixture("rgb-8-0")),
      raw = new Uint8Array(512 * 129);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 73 + (i >> 7)) & 255;
    const channel = {
      ...pattern.channels[0],
      compression: 2,
      bounds: { top: 0, left: 0, bottom: 129, right: 512 },
      data: deflate(raw),
    };
    expect(decodePsdPatternChannel(channel).data).toEqual(raw);
    expect(() => decodePsdPatternChannel(channel, raw.length * 2 - 1)).toThrow(
      "budget",
    );
  });

  it("uses channel rectangles and distinguishes absent, empty and partial masks", () => {
    const [pattern] = indexPsdPatterns(fixture("partial"));
    expect(pattern.channels[10]).toEqual({ written: 1 });
    const { data } = decodePsdPattern(pattern);
    for (let i = 0; i < 6; i++) {
      expect(Array.from(data.subarray(i * 4, i * 4 + 3))).toEqual([
        21, 73, 161,
      ]);
      expect(data[i * 4 + 3]).toBe(i === 4 ? 128 : 0);
    }
    pattern.channels[25] = { written: 0 };
    const opaque = decodePsdPattern(pattern);
    expect(Array.from(opaque.data).filter((_, i) => i % 4 === 3)).toEqual(
      Array(6).fill(255),
    );
    // Intersect a wider channel without crossing rows or writing outside tile.
    pattern.channels[25] = {
      ...pattern.channels[0],
      bounds: { top: 3, left: 6, bottom: 5, right: 9 },
    };
    const clipped = decodePsdPattern(pattern);
    expect(Array.from(clipped.data).filter((_, i) => i % 4 === 3)).toEqual([
      21, 21, 0, 21, 21, 0,
    ]);
  });

  it("indexes unsupported color modes losslessly and rejects ambiguous tile conversions", () => {
    const bytes = fixture("rgb-8-0");
    new DataView(bytes.buffer).setUint32(8, 4); // CMYK, not an RGB approximation.
    const [pattern] = indexPsdPatterns(bytes);
    expect(pattern.raw).toEqual(bytes);
    expect(() => decodePsdPattern(pattern)).toThrow("color mode");
    const [rgb] = indexPsdPatterns(fixture("rgb-8-0"));
    rgb.channels[24] = rgb.channels[25];
    expect(() => decodePsdPattern(rgb)).toThrow("user masks");
    rgb.channels[24] = { written: 0 };
    rgb.channels[1] = { ...rgb.channels[1], depth: 16 };
    expect(() => decodePsdPattern(rgb)).toThrow("color depth");
  });

  it("bounds allocations and rejects truncated, overflowing and invalid compressed planes", () => {
    const [pattern] = indexPsdPatterns(fixture("rgb-8-0")),
      channel = pattern.channels[0];
    expect(() => decodePsdPattern(pattern, 35)).toThrow("budget"); // 24-byte tile + 12-byte plane workspace.
    expect(() => decodePsdPatternChannel(channel, 11)).toThrow("budget");
    expect(() =>
      decodePsdPatternChannel({ ...channel, pixelDepth: 16 }),
    ).toThrow("depth");
    expect(() =>
      decodePsdPatternChannel({ ...channel, data: new Uint8Array(5) }),
    ).toThrow("RAW");
    expect(
      Array.from(
        decodePsdPatternChannel({
          ...channel,
          compression: 1,
          data: new Uint8Array([0, 3, 0, 3, 128, 254, 21, 254, 73, 128]),
        }).data,
      ),
    ).toEqual([21, 21, 21, 73, 73, 73]);
    for (const data of [
      new Uint8Array([0, 2, 0, 2, 255, 17, 255, 18]), // short rows
      new Uint8Array([0, 2, 0, 2, 253, 17, 254, 18]), // long row
      new Uint8Array([0, 2, 0, 2, 254, 17, 254, 18, 0]), // trailing payload
      new Uint8Array([0, 1, 0, 1, 0, 0]),
    ])
      // missing literal
      expect(() =>
        decodePsdPatternChannel({ ...channel, compression: 1, data }),
      ).toThrow();
    const correct = deflate(new Uint8Array(6)),
      tooLong = deflate(new Uint8Array(2_000_000));
    expect(
      decodePsdPatternChannel({ ...channel, compression: 2, data: correct })
        .data.length,
    ).toBe(6);
    for (const data of [
      correct.subarray(0, correct.length - 1),
      deflate(new Uint8Array(5)),
      Uint8Array.from([...correct, 0]),
      tooLong,
      Uint8Array.from([
        ...deflate(new Uint8Array(3)),
        ...deflate(new Uint8Array(3)),
      ]),
    ])
      expect(() =>
        decodePsdPatternChannel({ ...channel, compression: 2, data }),
      ).toThrow();
    const [floats] = indexPsdPatterns(fixture("rgb-32-0"));
    const invalid = floats.channels[0].data!.slice();
    new DataView(invalid.buffer).setFloat32(0, Infinity);
    expect(() =>
      decodePsdPatternChannel({ ...floats.channels[0], data: invalid }),
    ).toThrow("sample");
    floats.channels[25] = floats.channels[2];
    expect(() => decodePsdPattern(floats)).toThrow("alpha");
    // Invalid alpha is invalid even when its rectangle lies outside the tile.
    floats.channels[25] = {
      ...floats.channels[2],
      bounds: { top: 100, left: 100, bottom: 102, right: 103 },
    };
    expect(() => decodePsdPattern(floats)).toThrow("alpha");
  });

  it("enforces nested lengths and index budgets before allocating pixel buffers", () => {
    const original = fixture("rgb-8-0");
    expect(indexPsdPatterns(new Uint8Array())).toEqual([]);
    for (let length = 1; length < original.length; length++)
      expect(() => indexPsdPatterns(original.subarray(0, length))).toThrow();
    const [pattern] = indexPsdPatterns(original),
      colorCountAt =
        pattern.channels[0].data!.byteOffset - original.byteOffset - 23 - 8 - 4;
    for (const corrupt of [
      (b: Uint8Array) => new DataView(b.buffer).setUint32(0, 0xffffffff),
      (b: Uint8Array) => new DataView(b.buffer).setUint32(16, 0xffffffff),
      (b: Uint8Array) => new DataView(b.buffer).setUint32(colorCountAt, 65),
      (b: Uint8Array) =>
        new DataView(b.buffer).setUint32(colorCountAt - 20, 20),
    ]) {
      const bytes = original.slice();
      corrupt(bytes);
      expect(() => indexPsdPatterns(bytes)).toThrow();
    }
    // A declared resource of a different size cannot consume the next record.
    const joined = Uint8Array.from([...original, ...original]);
    new DataView(joined.buffer).setUint32(0, 25);
    expect(() => indexPsdPatterns(joined)).toThrow();
    const many = new Uint8Array(original.length * 10000);
    for (let i = 0; i < 10000; i++) many.set(original, i * original.length);
    expect(() => indexPsdPatterns(many)).toThrow("budget");
  });

  it("indexes unreferenced oversized tiles without allocating or converting pixels", () => {
    const bytes = fixture("rgb-8-0"),
      [source] = indexPsdPatterns(bytes),
      firstPlaneAt = source.channels[0].data!.byteOffset - bytes.byteOffset,
      colorCountAt = firstPlaneAt - 23 - 8 - 4,
      view = new DataView(bytes.buffer);
    // Change only the VMAL tile rectangle; the plane still has its own bounds.
    view.setUint32(colorCountAt - 8, 100000);
    view.setUint32(colorCountAt - 4, 100000);
    const base = new Uint8Array(
        writePsd({ width: 5, height: 7, children: [] }),
      ),
      input = new Uint8Array(
        restorePsdMetadata(base, {
          globalMask: new Uint8Array(),
          tags: [{ key: "Patt", data: bytes }],
        }),
      ),
      decoded = readPsdWithPatternResources(input, {
        ...options,
        totalMemoryLimit: 1024,
      });
    expect(decoded.patternResources?.length).toBe(1);
    expect(decoded.patterns).toBeUndefined();
    expect(() => decodePsdPattern(decoded.patternResources![0])).toThrow(
      "dimensions",
    );
  });

  it("integrates Patt/Pat2/Pat3 lazily and preserves native resources through metadata and PSD/PSB", () => {
    const tags = ["Patt", "Pat2", "Pat3"].map((key, i) => ({
        key,
        data: fixture(`rgb-${[8, 16, 32][i]}-${i + 1}`),
      })),
      metadata = { globalMask: new Uint8Array(), tags },
      native = decodePsdMetadata(new Uint8Array(encodePsdMetadata(metadata)));
    for (const psb of [false, true]) {
      const base = new Uint8Array(
          writePsd({ width: 5, height: 7, children: [] }, { psb }),
        ),
        bytes = new Uint8Array(restorePsdMetadata(base, native)),
        before = bytes.slice(),
        decoded = readPsdWithPatternResources(bytes, options);
      expect(decoded.patterns).toBeUndefined(); // No eager, lossy ag-psd byte cache.
      expect(decoded.patternResources?.length).toBe(3);
      for (let i = 0; i < 3; i++) {
        const resource = decoded.patternResources![i];
        expect(resource.raw).toEqual(tags[i].data);
        expect(decodePsdPattern(resource).data.constructor).toBe(
          [Uint8Array, Uint16Array, Float32Array][i],
        );
      }
      expect(bytes).toEqual(before);
      const output = new Uint8Array(
        restorePsdMetadata(base, readPsdMetadata(bytes)),
      );
      expect(readPsdMetadata(output).tags).toEqual(tags);
      expect(
        readPsdWithPatternResources(output, options).patternResources?.map(
          (p) => p.raw,
        ),
      ).toEqual(tags.map((t) => t.data));
    }
  });

  it("reports malformed pattern blocks despite default decoder suppression and restores dispatch on all exits", () => {
    const previous = infoHandlersMap.Patt.read,
      base = new Uint8Array(writePsd({ width: 3, height: 2, children: [] })),
      bytes = new Uint8Array(
        restorePsdMetadata(base, {
          globalMask: new Uint8Array(),
          tags: [{ key: "Pat3", data: fixture("rgb-8-0").subarray(0, 70) }],
        }),
      );
    expect(() => readPsdWithPatternResources(bytes, options)).toThrow(
      "Truncated",
    );
    expect(infoHandlersMap.Patt.read).toBe(previous);
    expect(() =>
      readPsdWithPatternResources(new Uint8Array(2), options),
    ).toThrow();
    expect(infoHandlersMap.Patt.read).toBe(previous);
    expect(
      readPsdWithPatternResources(base, options).patternResources,
    ).toBeUndefined();
  });
});
