import { describe, it, expect } from "vitest";
import {
  patternSampler,
  patternReferencePoint,
  validateVectorPattern,
  type VectorPattern,
} from "../src/model/vector-pattern";
import type { PatternPixels } from "../src/model/psd-patterns";
import { Assets } from "../src/model/assets";
import {
  encodePsdMetadata,
  psdMetadataMimeType,
} from "../src/model/psd-metadata";
import { readFileSync } from "node:fs";
import { layer, newDocument, cropDocument } from "../src/model/document";
import { vectorPaintMatrix } from "../src/model/vector";
import { serialize, deserialize } from "../src/model/serialization";

const identity = [1, 0, 0, 1, 0, 0] as const;
const fill = (): VectorPattern => ({
  type: "pattern",
  asset: "definition",
  id: "tile",
  name: "Independent",
});
const tile: PatternPixels = {
  width: 3,
  height: 2,
  data: new Uint8Array([
    1, 2, 3, 255, 11, 12, 13, 128, 21, 22, 23, 0, 31, 32, 33, 255, 41, 42, 43,
    64, 51, 52, 53, 255,
  ]),
};

describe("native-grid pattern materials", () => {
  it("preserves remaining tile cells when cropping linked or document-anchored fills", () => {
    for (const align of [undefined, true, false]) {
      const doc = newDocument(19, 13),
        l = layer("vector", "Pattern", 19, 13);
      l.vector = {
        reference: { x: 0, y: 0, width: 19, height: 13 },
        mask: { paths: [], fillStartsWithAllPixels: true },
        fill: {
          ...fill(),
          align,
          phase: { x: 0.375, y: -0.125 },
          referencePoint: { x: 2.125, y: -1.375 },
        },
      };
      doc.layers = [l];
      const before = patternSampler(
        l.vector.fill as VectorPattern,
        tile,
        vectorPaintMatrix(l),
      );
      cropDocument(doc, { x: 2, y: 3, width: 9, height: 7 });
      const after = patternSampler(
        l.vector.fill as VectorPattern,
        tile,
        vectorPaintMatrix(l),
      );
      for (let y = 0; y < 7; y++)
        for (let x = 0; x < 9; x++)
          expect(after(x, y)).toEqual(before(x + 2, y + 3));
    }
  });
  it("wraps negative document positions and keeps straight RGB at zero alpha", () => {
    const sample = patternSampler(fill(), tile, [...identity]);
    expect(sample(0, 0)).toEqual([1 / 255, 2 / 255, 3 / 255, 1]);
    expect(sample(-1, -1)).toEqual([51 / 255, 52 / 255, 53 / 255, 1]);
    expect(sample(2, 0)).toEqual([21 / 255, 22 / 255, 23 / 255, 0]);
    expect(sample(19, 8)).toEqual(sample(1, 0));
  });
  it("uses pixel-center nearest sampling at positive and negative half-pixel phases", () => {
    const f = fill();
    for (const phase of [-3.5, -0.5, 0.5, 3.5]) {
      f.phase = { x: phase, y: 0 };
      const sample = patternSampler(f, tile, [...identity]);
      const column = ((Math.floor(0.5 - phase) % 3) + 3) % 3;
      expect(sample(0, 0)[0]).toBe(tile.data[column * 4] / 255);
      f.phase.x = phase + 0.0000001;
      expect(patternSampler(f, tile, [...identity])(0, 0)[0]).toBe(
        tile.data[((column + 2) % 3) * 4] / 255,
      );
    }
  });
  it("keeps huge finite offsets from losing low coordinate bits or overflowing", () => {
    const f = fill();
    f.phase = { x: Number.MAX_VALUE, y: -Number.MAX_VALUE };
    f.referencePoint = { ...f.phase };
    const small = fill();
    small.phase = {
      x: 2 * (Number.MAX_VALUE % 3),
      y: 2 * (-Number.MAX_VALUE % 2),
    };
    const sample = patternSampler(f, tile, [...identity]),
      expected = patternSampler(small, tile, [...identity]);
    for (let y = -4; y < 5; y++)
      for (let x = -6; x < 7; x++) expect(sample(x, y)).toEqual(expected(x, y));
  });
  it("links placement to the affine reference point independently of vector mask linking", () => {
    const f = fill();
    f.referencePoint = { x: 1.25, y: -2 };
    f.phase = { x: -0.75, y: 0 };
    const matrix = [1, 0, 0, 1, 2, 1] as const;
    expect(patternReferencePoint(f, [...matrix])).toEqual({ x: 3.25, y: -1 });
    expect(patternSampler(f, tile, [...matrix])(3, 0)).toEqual(
      patternSampler(f, tile, [...identity])(1, -1),
    );
    f.align = false;
    expect(patternSampler(f, tile, [...matrix])(3, 0)).toEqual(
      patternSampler(f, tile, [...identity])(3, 0),
    );
    expect(() =>
      patternReferencePoint(
        { ...f, referencePoint: { x: Number.MAX_VALUE, y: 0 } },
        [2, 0, 0, 1, 0, 0],
      ),
    ).toThrow("finite");
  });
  it("retains full integer precision, subnormal alpha and HDR float colors", () => {
    const f = fill();
    const integer: PatternPixels = {
      width: 1,
      height: 1,
      data: new Uint16Array([1, 32768, 65535, 3]),
    };
    expect(patternSampler(f, integer, [...identity])(0, 0)).toEqual([
      1 / 65535,
      32768 / 65535,
      1,
      3 / 65535,
    ]);
    const floating: PatternPixels = {
      width: 1,
      height: 1,
      data: new Float32Array([-0.25, 2.75, 0.625, 2 ** -149]),
    };
    expect(patternSampler(f, floating, [...identity])(0, 0)).toEqual([
      -0.25,
      2.75,
      0.625,
      2 ** -149,
    ]);
  });
  it("rejects unsupported sampling and malformed placement rather than approximating them", () => {
    for (const extra of [
      { scalePercent: 50 },
      { scalePercent: 200 },
      { angle: 0.125 },
      { linked: false },
      { phase: { x: Infinity, y: 0 } },
      { align: 1 },
      { asset: "" },
      { referencePoint: { x: 0, y: NaN } },
    ])
      expect(() =>
        validateVectorPattern({ ...fill(), ...extra } as VectorPattern),
      ).toThrow("pattern");
    validateVectorPattern({
      ...fill(),
      scalePercent: 100,
      angle: 360,
      align: false,
    });
  });
  it("bundles material assets even when they are independent of document metadata", async () => {
    const assets = new Assets(),
      doc = newDocument(9, 7);
    const raw = new Uint8Array(
      readFileSync(
        new URL("fixtures/psd-patterns/rgb-16-2.bin", import.meta.url),
      ),
    );
    const asset = await assets.add(
      new Blob(
        [
          encodePsdMetadata({
            globalMask: new Uint8Array(),
            tags: [{ key: "Patt", data: raw }],
          }),
        ],
        { type: psdMetadataMimeType },
      ),
    );
    const l = layer("vector", "Copied pattern", 9, 7);
    l.vector = {
      reference: { x: 0, y: 0, width: 9, height: 7 },
      mask: { paths: [], fillStartsWithAllPixels: true },
      fill: { ...fill(), asset, id: "rgb-16-2" },
    };
    doc.layers = [l];
    const loaded = await deserialize(await serialize(doc, assets));
    try {
      expect(loaded.document).toEqual(doc);
      expect(
        (await loaded.assets.patternResource(asset, "rgb-16-2")).raw,
      ).toEqual(raw);
      (l.vector.fill as VectorPattern).id = "missing";
      await expect(deserialize(await serialize(doc, assets))).rejects.toThrow(
        "Missing",
      );
    } finally {
      loaded.assets.clear();
      assets.clear();
    }
  });
});
