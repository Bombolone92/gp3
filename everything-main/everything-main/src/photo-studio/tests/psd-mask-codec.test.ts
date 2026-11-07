import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  createCanvas,
  createImageData,
  initializeCanvas,
} from "ag-psd/dist/helpers";
import {
  readPsd,
  writePsd,
  getLayerMaskImageData,
  getLayerRealMaskImageData,
  type Psd,
} from "ag-psd";
import {
  decodePsdMaskHeader,
  encodePsdMaskHeader,
  readPsdWithPixelMasks,
  type PsdPixelMask,
} from "../src/model/psd-mask-codec";
import { readPsdLayerMaskRecords } from "../src/model/psd-metadata";
import { writePsdWithPreciseStrokes } from "../src/model/psd-stroke-writer";
import { writeHighDepthPsd } from "../src/model/psd-high-depth";

const params = {
  userMaskDensity: 102 / 255,
  userMaskFeather: 2.375,
  vectorMaskDensity: 213 / 255,
  vectorMaskFeather: 7.125,
};
const mask: PsdPixelMask = {
  top: -3,
  left: 7,
  bottom: -3,
  right: 7,
  defaultColor: 255,
  disabled: false,
  positionRelativeToLayer: true,
  fromVectorData: false,
  inverted: true,
  flags: 0x80,
  ...params,
};
const real: PsdPixelMask = {
  top: 9,
  left: -4,
  bottom: 9,
  right: -4,
  defaultColor: 0,
  disabled: true,
  positionRelativeToLayer: false,
  fromVectorData: true,
  inverted: false,
  flags: 0x40,
};
const input = (psb = false, withReal = true): Uint8Array =>
  new Uint8Array(
    writePsd(
      {
        width: 7,
        height: 5,
        children: [
          {
            name: "Duplicate",
            id: 19,
            mask,
            ...(withReal ? { realMask: real } : {}),
          },
          {
            name: "Nested",
            children: [
              {
                name: "Duplicate",
                id: 19,
                mask: { ...mask, top: 2, left: 3, bottom: 2, right: 3 },
              },
            ],
          },
        ],
      },
      { psb, noBackground: true },
    ),
  );
// Use the independent dependency encoder's real-mask-first order, then
// inject the inversion/reserved flags it omits at their explicit byte positions.
function externalFixture(psb: boolean, withReal: boolean) {
  const bytes = input(psb, withReal);
  for (const block of readPsdLayerMaskRecords(bytes))
    for (const r of block) {
      if (r.end === r.start) continue;
      const hasReal = r.hasRealMask;
      expect(bytes[r.start + (hasReal ? 36 : 18)]).toBe(15);
      if (hasReal) bytes[r.start + 18] |= 0x40;
      bytes[r.start + 17] |= 0x84;
    }
  return bytes;
}
function expected(m: PsdPixelMask) {
  return {
    ...m,
    flags:
      (m.flags ?? 0) |
      (m.positionRelativeToLayer ? 1 : 0) |
      (m.disabled ? 2 : 0) |
      (m.inverted ? 4 : 0) |
      (m.fromVectorData ? 8 : 0) |
      (m.userMaskDensity !== undefined ? 16 : 0),
  };
}

describe("PSD pixel-mask metadata and channel planes", () => {
  it("decodes independently generated RLE/ZIP/predicted mask planes at native depth", () => {
    const previousCanvas = createCanvas,
      previousImageData = createImageData;
    // This decoder needs only allocation of straight RGBA byte storage.
    initializeCanvas(previousCanvas, (width, height) => ({
      width,
      height,
      colorSpace: "srgb",
      data: new Uint8ClampedArray(width * height * 4),
    }));
    try {
      for (const [depth, file] of [
        [8, "8.psd"],
        [16, "16.psb"],
        [32, "32.psd"],
      ] as const) {
        const source = new Uint8Array(
          readFileSync(
            new URL(`./fixtures/psd-masks/${file}`, import.meta.url),
          ),
        );
        const before = source.slice();
        const psd = readPsdWithPixelMasks(source, {
          useRawData: true,
          skipCompositeImageData: true,
        });
        expect(psd.bitsPerChannel).toBe(depth);
        const group = psd.children![0];
        expect(group.name).toBe("Group");
        expect(group.children).toHaveLength(2);
        const values =
          depth === 8
            ? [0, 1, 63, 128, 254, 255]
            : depth === 16
              ? [0, 1, 256, 32768, 65534, 65535]
              : [-0, Math.fround(1e-45), Math.fround(0.0000125), 0.625, 1, 0];
        for (const layer of group.children!) {
          const primary = getLayerMaskImageData(layer)!;
          expect(primary.width).toBe(2);
          expect(primary.height).toBe(3);
          expect(
            Array.from(primary.data.filter((_, i) => i % 4 === 0)),
          ).toEqual(values);
          expect(layer.mask).toMatchObject({
            ...expected(mask),
            bottom: 0,
            right: 9,
          });
          if (layer.name === "With real") {
            const combined = getLayerRealMaskImageData(layer)!;
            expect(combined.width).toBe(3);
            expect(combined.height).toBe(2);
            expect(
              Array.from(combined.data.filter((_, i) => i % 4 === 0)),
            ).toEqual(values);
            expect(layer.realMask).toMatchObject({
              ...expected(real),
              bottom: 11,
              right: -1,
            });
          } else expect(layer.realMask).toBeUndefined();
        }
        expect(source).toEqual(before);
      }
    } finally {
      initializeCanvas(previousCanvas, previousImageData);
    }
  });
  it("reads parameters after the optional real header, including long parameter-only blocks", () => {
    for (const psb of [false, true])
      for (const withReal of [false, true]) {
        const bytes = externalFixture(psb, withReal),
          before = bytes.slice();
        if (!withReal)
          expect(() =>
            readPsd(bytes, { useRawData: true, skipCompositeImageData: true }),
          ).toThrow();
        const decoded = readPsdWithPixelMasks(bytes, {
          useRawData: true,
          skipCompositeImageData: true,
        });
        expect(decoded.children![0].mask).toEqual(expected(mask));
        expect(decoded.children![0].realMask).toEqual(
          withReal ? { ...expected(real), flags: 0x4a } : undefined,
        );
        expect(decoded.children![1].children![0].mask).toEqual(
          expected({ ...mask, top: 2, left: 3, bottom: 2, right: 3 }),
        );
        expect(decoded.children![1].children![0].realMask).toBeUndefined();
        expect(bytes).toEqual(before);
      }
  });
  it("writes real-mask-first order and inversion/reserved flags without changing codec dispatch or mask bounds", () => {
    for (const psb of [false, true]) {
      const psd: Psd = {
        width: 7,
        height: 5,
        children: [
          { name: "Mask", mask, realMask: real },
          { name: "Long parameters", mask },
        ],
      };
      const bytes = new Uint8Array(
        writePsdWithPreciseStrokes(psd, { psb, noBackground: true }),
      );
      const spans = readPsdLayerMaskRecords(bytes)[0];
      expect(bytes[spans[0].start + 36]).toBe(15);
      expect(bytes[spans[0].start + 37]).toBe(102);
      expect(new DataView(bytes.buffer).getFloat64(spans[0].start + 38)).toBe(
        2.375,
      );
      expect(bytes[spans[0].start + 18]).toBe(0x4a);
      expect(
        decodePsdMaskHeader(bytes.subarray(spans[0].start, spans[0].end), true),
      ).toEqual({ mask: expected(mask), realMask: expected(real) });
      expect(
        readPsdWithPixelMasks(bytes, {
          useRawData: true,
          skipCompositeImageData: true,
        }).children![1].mask,
      ).toEqual(expected(mask));
    }
    expect(() =>
      writePsdWithPreciseStrokes({
        width: 3,
        height: 2,
        children: [{ mask: { userMaskFeather: NaN } }],
      }),
    ).toThrow();
  });
  it("rejects malformed parameters, truncated real bounds and invalid default colors before decoder allocation", () => {
    const full = encodePsdMaskHeader({ mask, realMask: real });
    const invalid = (at: number, value: number) => {
      const b = full.slice();
      b[at] = value;
      return b;
    };
    expect(() => decodePsdMaskHeader(full.subarray(0, 17), true)).toThrow(
      "length",
    );
    expect(() => decodePsdMaskHeader(full.subarray(0, 36), true)).toThrow();
    expect(() => decodePsdMaskHeader(full.subarray(0, 35), true)).toThrow(
      "Truncated",
    );
    expect(() => decodePsdMaskHeader(invalid(16, 73), true)).toThrow(
      "default color",
    );
    expect(() => decodePsdMaskHeader(invalid(36, 128), true)).toThrow(
      "parameter flags",
    );
    const nan = full.slice();
    new DataView(nan.buffer).setFloat64(38, NaN);
    expect(() => decodePsdMaskHeader(nan, true)).toThrow("feather");
    const bounds = full.slice();
    new DataView(bounds.buffer).setInt32(8, -4);
    expect(() => decodePsdMaskHeader(bounds, true)).toThrow("bounds");
    expect(() =>
      encodePsdMaskHeader({ mask: { ...mask, userMaskDensity: 1.1 } }),
    ).toThrow("parameter");
    const bytes = externalFixture(false, true),
      before = bytes.slice();
    // Force the decoder to fail after its mask metadata has been normalized.
    const root = readPsdWithPixelMasks(bytes, {
      useRawData: true,
      skipCompositeImageData: true,
    });
    expect(root.children).toHaveLength(2);
    const options = {
      useRawData: false,
      useImageData: true,
      totalMemoryLimit: 1,
    };
    expect(() => readPsdWithPixelMasks(bytes, options)).toThrow();
    expect(bytes).toEqual(before);
  });
  it("handles every parameter combination and both encoder padding conventions", () => {
    for (let bits = 0; bits < 16; bits++)
      for (const hasReal of [false, true]) {
        const primary = {
          ...mask,
          userMaskDensity: bits & 1 ? params.userMaskDensity : undefined,
          userMaskFeather: bits & 2 ? params.userMaskFeather : undefined,
          vectorMaskDensity: bits & 4 ? params.vectorMaskDensity : undefined,
          vectorMaskFeather: bits & 8 ? params.vectorMaskFeather : undefined,
        };
        const encoded = encodePsdMaskHeader({
          mask: primary,
          realMask: hasReal ? real : undefined,
        });
        const bodyLength = encoded.length - 2;
        const aligned = new Uint8Array(Math.ceil(bodyLength / 4) * 4);
        aligned.set(encoded.subarray(0, bodyLength));
        for (const body of [encoded, aligned]) {
          const decoded = decodePsdMaskHeader(body, hasReal);
          expect(decoded.mask).toEqual({
            ...Object.fromEntries(
              Object.entries(primary).filter(
                ([, value]) => value !== undefined,
              ),
            ),
            flags: 0x85 | (bits ? 16 : 0),
          });
          expect(decoded.realMask).toEqual(
            hasReal ? expected(real) : undefined,
          );
        }
      }
  });
  it("handles typed-array offsets and never alters shared input while decoding", () => {
    const source = externalFixture(true, true),
      storage = new Uint8Array(source.length + 13);
    storage.set(source, 7);
    const view = storage.subarray(7, 7 + source.length),
      before = storage.slice();
    expect(
      readPsdWithPixelMasks(view, {
        useRawData: true,
        skipCompositeImageData: true,
      }).children![0].mask,
    ).toEqual(expected(mask));
    expect(storage).toEqual(before);
    const shared = new Uint8Array(new SharedArrayBuffer(source.length));
    shared.set(source);
    readPsdWithPixelMasks(shared, {
      useRawData: true,
      skipCompositeImageData: true,
    });
    expect(shared).toEqual(source);
  });
  for (const depth of [16, 32] as const)
    for (const psb of [false, true])
      it(`keeps ${depth}-bit mask planes and metadata in ${psb ? "PSB" : "PSD"}`, () => {
        const values =
          depth === 16
            ? [0, 1, 256, 32768, 65534, 65535]
            : [-0, Math.fround(1e-45), 0.0000125, 0.625, 1, 0];
        const data = depth === 16 ? new Uint16Array(24) : new Float32Array(24);
        values.forEach((n, i) => {
          data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = n;
          data[i * 4 + 3] = depth === 16 ? 65535 : 1;
        });
        const composite = {
          width: 7,
          height: 5,
          data: depth === 16 ? new Uint16Array(140) : new Float32Array(140),
        };
        const m = {
          ...mask,
          bottom: 0,
          right: 9,
          imageData: { width: 2, height: 3, data },
        };
        const r = {
          ...real,
          bottom: 10,
          right: -2,
          imageData: { width: 2, height: 1, data: data.slice(0, 8) },
        };
        const source: Psd = {
          width: 7,
          height: 5,
          bitsPerChannel: depth,
          imageData: composite,
          children: [
            {
              name: "Group",
              mask: { ...mask },
              children: [
                { name: "Masked", imageData: composite, mask: m, realMask: r },
              ],
            },
          ],
        };
        const encoded = new Uint8Array(writeHighDepthPsd(source, psb));
        const decoded = readPsdWithPixelMasks(encoded, {
          useRawData: true,
          skipCompositeImageData: true,
        });
        const l = decoded.children![0].children![0];
        const a = getLayerMaskImageData(l)!,
          b = getLayerRealMaskImageData(l)!;
        expect(a.width).toBe(2);
        expect(a.height).toBe(3);
        expect(
          new Uint8Array(a.data.buffer, a.data.byteOffset, a.data.byteLength),
        ).toEqual(new Uint8Array(data.buffer));
        expect(
          new Uint8Array(b.data.buffer, b.data.byteOffset, b.data.byteLength),
        ).toEqual(new Uint8Array(data.slice(0, 8).buffer));
        expect(l.mask).toMatchObject({
          ...expected(mask),
          bottom: 0,
          right: 9,
        });
        expect(l.realMask).toMatchObject({
          ...expected(real),
          bottom: 10,
          right: -2,
        });
        expect(decoded.children![0].mask).toMatchObject(expected(mask));
        // Width/height and samples are validated before the writer allocates output.
        expect(() =>
          writeHighDepthPsd(
            {
              ...source,
              children: [
                {
                  mask: {
                    ...m,
                    imageData: {
                      width: 2,
                      height: 3,
                      data:
                        depth === 16
                          ? new Float32Array(24)
                          : new Uint16Array(24),
                    },
                  },
                },
              ],
            },
            psb,
          ),
        ).toThrow("match");
        if (depth === 32)
          for (const coverage of [NaN, Infinity, -0.01, 1.01]) {
            const invalid = data.slice();
            invalid[0] = coverage;
            expect(() =>
              writeHighDepthPsd(
                {
                  ...source,
                  children: [
                    {
                      mask: {
                        ...m,
                        imageData: { width: 2, height: 3, data: invalid },
                      },
                    },
                  ],
                },
                psb,
              ),
            ).toThrow();
          }
      });
});
