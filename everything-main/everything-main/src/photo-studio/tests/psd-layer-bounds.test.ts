import { describe, it, expect } from "vitest";
import {
  createCanvas,
  createImageData,
  initializeCanvas,
} from "ag-psd/dist/helpers";
import type { Psd, Layer } from "ag-psd";
import { writePsdWithPreciseStrokes } from "../src/model/psd-stroke-writer";
import { writeHighDepthPsd } from "../src/model/psd-high-depth";
import { readPsdWithPatternResources } from "../src/model/psd-patterns";
import { readPsdLayerMaskRecords } from "../src/model/psd-metadata";
import { layer, newDocument } from "../src/model/document";
import { validateDocument } from "../src/model/serialization";
import {
  transformedVectorPsdBounds,
  vectorPaintMatrix,
} from "../src/model/vector";
import { psdLayerBounds } from "../src/model/psd-layer-bounds";

function encode(children: Layer[], depth: 8 | 16 | 32, psb: boolean) {
  const psd: Psd = {
    width: 7,
    height: 5,
    bitsPerChannel: depth,
    children,
    imageData: {
      width: 7,
      height: 5,
      data:
        depth === 8
          ? new Uint8ClampedArray(140)
          : depth === 16
            ? new Uint16Array(140)
            : new Float32Array(140),
    },
  };
  return new Uint8Array(
    depth === 8
      ? writePsdWithPreciseStrokes(psd, { psb, noBackground: true })
      : writeHighDepthPsd(psd, psb),
  );
}
function shape(name: string, bounds: Partial<Layer>): Layer {
  return {
    name,
    ...bounds,
    vectorFill: {
      type: "solid",
      name: "Independent Classic",
      style: "linear",
      angle: 37,
      align: true,
      dither: false,
      smoothness: 1,
      colorStops: [
        { location: 0, midpoint: 0.5, color: { r: 23, g: 71, b: 163 } },
        { location: 1, midpoint: 0.5, color: { r: 241, g: 31, b: 43 } },
      ],
      opacityStops: [
        { location: 0, midpoint: 0.5, opacity: 1 },
        { location: 1, midpoint: 0.5, opacity: 1 },
      ],
    },
    vectorMask: { paths: [], fillStartsWithAllPixels: true },
  };
}

describe("declarative PSD layer rectangles", () => {
  it("preserves cacheless fill and group rectangles through every depth and file version", () => {
    for (const depth of [8, 16, 32] as const)
      for (const psb of [false, true]) {
        const children: Layer[] = [
          shape("Outside", { left: -7, top: 3, right: 11, bottom: 29 }),
          {
            name: "Group",
            left: -13,
            top: -17,
            right: 31,
            bottom: 43,
            children: [
              shape("Partial", { left: 3, top: -2, right: 8 }),
              shape("Empty", {}),
            ],
          },
          shape("Hidden", {
            hidden: true,
            left: 8,
            top: 9,
            right: 10,
            bottom: 12,
          }),
        ];
        const original = structuredClone(children),
          bytes = encode(children, depth, psb);
        const decoded = readPsdWithPatternResources(bytes, {
          useRawData: true,
          skipCompositeImageData: true,
          skipLayerImageData: true,
        });
        const compare = (a: Layer[], b: Layer[]) => {
          expect(a.length).toBe(b.length);
          for (let i = 0; i < a.length; i++) {
            expect(psdLayerBounds(a[i])).toEqual(psdLayerBounds(b[i]));
            expect(a[i].name).toBe(b[i].name);
            if (b[i].vectorFill) expect(a[i].vectorFill?.type).toBe("solid");
            if (b[i].children) compare(a[i].children!, b[i].children!);
          }
        };
        compare(decoded.children!, original);
        // There are no rendered layer caches in these declarative records.
        expect(bytes.length).toBeLessThan(6000);
        compare(children, original);
      }
  });
  it("retains legal signed extremes without allocating a source-sized plane", () => {
    for (const depth of [8, 16, 32] as const)
      for (const psb of [false, true]) {
        const bytes = encode(
          [
            shape("Extreme", {
              left: -0x80000000,
              top: -0x80000000,
              right: 0x7fffffff,
              bottom: 0x7fffffff,
            }),
          ],
          depth,
          psb,
        );
        const [[record]] = readPsdLayerMaskRecords(bytes),
          view = new DataView(
            bytes.buffer,
            bytes.byteOffset + record.recordStart,
            16,
          );
        expect([0, 4, 8, 12].map((offset) => view.getInt32(offset))).toEqual([
          -0x80000000, -0x80000000, 0x7fffffff, 0x7fffffff,
        ]);
        expect(bytes.length).toBeLessThan(3000);
      }
  });
  it("does not invent cached pixels for empty color streams, preserving masks and caller bytes", () => {
    const previousCanvas = createCanvas,
      previousImageData = createImageData;
    initializeCanvas(previousCanvas, (width, height) => {
      if (width > 7 || height > 5)
        throw new Error("Unexpected source-sized allocation.");
      return {
        width,
        height,
        colorSpace: "srgb",
        data: new Uint8ClampedArray(width * height * 4),
      };
    });
    try {
      for (const psb of [false, true]) {
        const leaf = shape("No cache", {
          left: -0x80000000,
          top: -0x80000000,
          right: 0x7fffffff,
          bottom: 0x7fffffff,
        });
        leaf.mask = {
          left: -2,
          top: 3,
          defaultColor: 255,
          imageData: {
            width: 2,
            height: 1,
            data: new Uint8ClampedArray([13, 13, 13, 255, 241, 241, 241, 255]),
          },
        };
        const bytes = encode([leaf], 8, psb),
          source = bytes.slice();
        for (const shared of [false, true]) {
          const buffer = shared
              ? new SharedArrayBuffer(bytes.length + 11)
              : new ArrayBuffer(bytes.length + 11),
            input = new Uint8Array(buffer, 7, bytes.length);
          input.set(bytes);
          const decoded = readPsdWithPatternResources(input, {
            useImageData: true,
            skipCompositeImageData: true,
            totalMemoryLimit: 128,
          });
          const result = decoded.children![0];
          expect(result.imageData).toBeUndefined();
          expect(psdLayerBounds(result)).toEqual(psdLayerBounds(leaf));
          expect(Array.from(result.mask!.imageData!.data)).toEqual([
            13, 13, 13, 255, 241, 241, 241, 255,
          ]);
          expect(input).toEqual(source);
        }
        const broken = bytes.slice();
        // Mask allocation throws after temporary layer-record normalization.

        const [[record]] = readPsdLayerMaskRecords(broken);
        const original = broken.slice(
          record.recordStart,
          record.recordStart + 16,
        );
        expect(() =>
          readPsdWithPatternResources(broken, {
            useImageData: true,
            totalMemoryLimit: 0,
          }),
        ).toThrow();
        expect(
          broken.subarray(record.recordStart, record.recordStart + 16),
        ).toEqual(original);
      }
    } finally {
      initializeCanvas(previousCanvas, previousImageData);
    }
  });
  it("keeps declarative metadata through native validation and encloses affine edits", () => {
    const doc = newDocument(43, 31),
      l = layer("vector", "Bounds", 43, 31);
    l.vector = {
      reference: { x: 1.125, y: -3.875, width: 17.5, height: 11.25 },
      mask: { paths: [], fillStartsWithAllPixels: true },
      fill: { rgb: [0.1, 0.2, 0.3], space: "document" },
      psdBounds: { left: -17, top: -13, right: 51, bottom: 43 },
    };
    l.transform = { ...l.vector.reference, rotation: 0 };
    doc.layers = [l];
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toBeDefined();
    expect(transformedVectorPsdBounds(l)).toEqual(l.vector.psdBounds);
    l.transform.x += 5;
    l.transform.y -= 7;
    expect(transformedVectorPsdBounds(l)).toEqual({
      left: -12,
      top: -20,
      right: 56,
      bottom: 36,
    });
    l.transform.rotation = 37;
    l.transform.width *= 1.37;
    l.transform.height *= 0.73;
    const b = transformedVectorPsdBounds(l)!,
      m = vectorPaintMatrix(l);
    for (const x of [-17, 51])
      for (const y of [-13, 43]) {
        const xx = m[0] * x + m[2] * y + m[4],
          yy = m[1] * x + m[3] * y + m[5];
        expect(xx).toBeGreaterThanOrEqual(b.left);
        expect(xx).toBeLessThanOrEqual(b.right);
        expect(yy).toBeGreaterThanOrEqual(b.top);
        expect(yy).toBeLessThanOrEqual(b.bottom);
      }
    for (const invalid of [
      { right: -18 },
      { top: 0.5 },
      { bottom: Infinity },
      { left: -0x80000001 },
      { right: undefined },
    ]) {
      const copy = structuredClone(doc);
      Object.assign(copy.layers[0].vector!.psdBounds!, invalid);
      expect(() => validateDocument(copy)).toThrow(/bounds/);
    }
    l.vector.psdBounds = { left: 0, top: 0, right: 0, bottom: 0 };
    expect(transformedVectorPsdBounds(l)!.right).toBe(
      transformedVectorPsdBounds(l)!.left,
    );
    expect(transformedVectorPsdBounds(l)!.bottom).toBe(
      transformedVectorPsdBounds(l)!.top,
    );
    l.vector.psdBounds = {
      left: 0x7fffffff,
      top: 0,
      right: 0x7fffffff,
      bottom: 0,
    };
    l.transform = {
      ...l.vector.reference,
      x: l.vector.reference.x + 1,
      rotation: 0,
    };
    expect(() => transformedVectorPsdBounds(l)).toThrow(/bounds/);
  });
  it("uses cached plane dimensions rather than stale declared right/bottom fields", () => {
    const layer: Layer = {
      left: -4,
      top: 3,
      right: -100,
      bottom: -100,
      imageData: { width: 2, height: 1, data: new Uint8ClampedArray(8) },
    };
    expect(psdLayerBounds(layer)).toEqual({
      left: -4,
      top: 3,
      right: -2,
      bottom: 4,
    });
    for (const psb of [false, true]) {
      const output = readPsdWithPatternResources(encode([layer], 8, psb), {
        skipLayerImageData: true,
        skipCompositeImageData: true,
      });
      expect(psdLayerBounds(output.children![0])).toEqual({
        left: -4,
        top: 3,
        right: -2,
        bottom: 4,
      });
    }
  });
  it("rejects fractional, inverted and overflowing rectangles before encoding", () => {
    for (const change of [
      { left: 0.5 },
      { right: -1 },
      { bottom: -1 },
      { left: -0x80000001 },
      { top: 0x80000000 },
      { right: 0x80000000 },
      { bottom: Infinity },
      { bottom: NaN },
    ]) {
      const layers = [
        { name: "Nested", children: [shape("Malformed", change)] },
      ];
      for (const depth of [8, 16, 32] as const)
        for (const psb of [false, true])
          expect(() => encode(layers, depth, psb)).toThrow("PSD layer bounds");
    }
  });
});
