import { describe, expect, it } from "vitest";
import { Assets } from "../src/model/assets";
import {
  coverageHeader,
  decodeCoverage,
  encodeCoverage,
  floatCoverage,
} from "../src/model/coverage";
import {
  layer,
  newDocument,
  resizeDocument,
  cropDocument,
} from "../src/model/document";
import {
  identityMaskMatrix,
  pixelMaskCoverage,
  pixelMaskMatrix,
  sampleCoverage,
  setPixelMaskLinked,
} from "../src/model/pixel-mask";
import { exportPsdPixelMask } from "../src/model/psd-pixel-mask";
import {
  deserialize,
  serialize,
  validateDocument,
} from "../src/model/serialization";
import { transformSelection } from "../src/model/transform";

function masked(kind: "solid" | "group" = "solid") {
  const l = layer(kind, "Mask", 8, 6);
  l.transform.x = 4;
  l.transform.y = -3;
  l.pixelMask = {
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    reference: { ...l.transform },
    matrix: identityMaskMatrix(),
    defaultColor: 255,
    positionRelativeToLayer: false,
    fromVectorData: false,
  };
  return l;
}
describe("native scalar mask coverage", () => {
  for (const data of [
    new Uint8Array([0, 1, 127, 255]),
    new Uint16Array([0, 1, 32769, 65535]),
    new Float32Array([-0, 1.401298464324817e-45, 0.12345679, 1]),
  ])
    it(`copies and preserves ${data.constructor.name} mask samples in assets and projects`, async () => {
      const original = new Uint8Array(data.buffer).slice();
      const buffer = encodeCoverage({ width: 2, height: 2, data });
      const decoded = decodeCoverage(buffer);
      expect(new Uint8Array(decoded.data.buffer)).toEqual(original);
      expect(floatCoverage(decoded)[1]).toBe(
        Math.fround(
          data[1] /
            (data instanceof Float32Array
              ? 1
              : data instanceof Uint16Array
                ? 65535
                : 255),
        ),
      );
      const assets = new Assets(),
        l = masked(),
        doc = newDocument(12, 9);
      const asset = await assets.addCoverage(decoded);
      decoded.data.fill(0);
      l.pixelMask!.asset = asset;
      l.pixelMask!.bounds = { x: -2, y: 3, width: 2, height: 2 };
      doc.layers = [l];
      const project = await deserialize(await serialize(doc, assets));
      expect(project.document.layers[0].pixelMask).toEqual(l.pixelMask);
      expect(
        new Uint8Array(project.assets.coverage(asset).data.buffer),
      ).toEqual(original);
      const output = await exportPsdPixelMask(
        l,
        data instanceof Float32Array
          ? 32
          : data instanceof Uint16Array
            ? 16
            : 8,
        (id) => assets.blob(id),
        () => {},
      );
      expect([
        output!.left,
        output!.top,
        output!.right,
        output!.bottom,
      ]).toEqual([-2, 3, 0, 5]);
      const red = output!.imageData!.data.filter((_, i) => i % 4 === 0);
      expect(new Uint8Array(red.buffer)).toEqual(original);
      project.assets.clear();
      assets.clear();
    });
  it("rejects malformed or excessive allocations before decoding and invalid float coverage", () => {
    const valid = encodeCoverage({
      width: 2,
      height: 1,
      data: new Uint8Array([1, 2]),
    });
    expect(() => decodeCoverage(valid.slice(0, -1))).toThrow("length");
    const offset = new Uint8Array(21);
    offset.set(new Uint8Array(valid).slice(0, 16), 5);
    expect(coverageHeader(offset.subarray(5)).width).toBe(2);
    for (const at of [4, 6, 8, 12]) {
      const copy = valid.slice(0);
      new DataView(copy).setUint16(at, 65535, true);
      expect(() => decodeCoverage(copy)).toThrow();
    }
    for (const v of [NaN, Infinity, -1, 1.01])
      expect(() =>
        encodeCoverage({ width: 1, height: 1, data: new Float32Array([v]) }),
      ).toThrow("coverage");
  });
});
describe("PSD pixel mask coordinate and state semantics", () => {
  it("uses absolute bounds in both link states and samples default color on each bilinear edge tap", () => {
    const l = masked();
    l.pixelMask!.bounds = { x: 2, y: 3, width: 1, height: 1 };
    l.pixelMask!.asset = "coverage";
    const s = { width: 1, height: 1, data: new Uint8Array([0]) };
    for (const unlinked of [false, true]) {
      l.pixelMask!.positionRelativeToLayer = unlinked;
      expect(pixelMaskCoverage(l, s, 2.5, 3.5)).toBe(0);
      expect(pixelMaskCoverage(l, s, 2, 3.5)).toBe(0.5);
      expect(pixelMaskCoverage(l, s, 1.5, 3.5)).toBe(1);
    }
    l.pixelMask!.defaultColor = 0;
    expect(
      sampleCoverage(
        { width: 1, height: 1, data: new Uint16Array([65535]) },
        0,
        0.5,
        0,
      ),
    ).toBe(0.5);
    l.pixelMask!.userMaskDensity = 0.4;
    expect(pixelMaskCoverage(l, s, 2.5, 3.5)).toBe(0.6);
    l.maskInverted = true;
    expect(pixelMaskCoverage(l, s, 2.5, 3.5)).toBe(1);
    l.maskDisabled = true;
    expect(pixelMaskCoverage(l, s, 100, 100)).toBe(1);
  });
  it("preserves the visible mask when toggling linking and follows only subsequent linked layer transforms", () => {
    const l = masked();
    l.transform.x += 7;
    expect(pixelMaskMatrix(l)).toEqual([1, 0, 0, 1, 7, 0]);
    setPixelMaskLinked(l, false);
    l.transform.x += 5;
    expect(pixelMaskMatrix(l)).toEqual([1, 0, 0, 1, 7, 0]);
    setPixelMaskLinked(l, true);
    expect(pixelMaskMatrix(l)).toEqual([1, 0, 0, 1, 7, 0]);
    l.transform.y += 2;
    expect(pixelMaskMatrix(l)).toEqual([1, 0, 0, 1, 7, 2]);
  });
  it("transforms masks with document resize/crop in both link states, including groups", () => {
    for (const kind of ["solid", "group"] as const)
      for (const unlinked of [false, true]) {
        const l = masked(kind),
          doc = newDocument(20, 10);
        doc.layers = [l];
        l.pixelMask!.positionRelativeToLayer = unlinked;
        resizeDocument(doc, 40, 30);
        expect(pixelMaskMatrix(l)).toEqual([2, 0, 0, 3, 0, 0]);
        cropDocument(doc, { x: 5, y: 8, width: 20, height: 10 });
        expect(pixelMaskMatrix(l)).toEqual([2, 0, 0, 3, -5, -8]);
      }
    const group = masked("group"),
      child = layer("solid", "Child", 8, 6);
    group.children = [child];
    transformSelection(
      [group],
      { x: 0, y: 0, width: 8, height: 6, rotation: 0 },
      { x: 2, y: 3, width: 16, height: 12, rotation: 0 },
    );
    expect(pixelMaskMatrix(group)).toEqual([2, 0, 0, 2, 2, 3]);
  });
  it("rejects invalid geometry and rendering parameters instead of ignoring mask metadata", () => {
    const doc = newDocument(12, 9);
    doc.layers = [masked()];
    for (const change of [
      (m: (typeof doc.layers)[0]["pixelMask"]) => (m!.bounds.width = -1),
      (m: (typeof doc.layers)[0]["pixelMask"]) =>
        (m!.matrix = [0, 0, 0, 0, 0, 0]),
      (m: (typeof doc.layers)[0]["pixelMask"]) => (m!.userMaskDensity = 2),
      (m: (typeof doc.layers)[0]["pixelMask"]) => (m!.userMaskFeather = 2),
      (m: (typeof doc.layers)[0]["pixelMask"]) => (m!.fromVectorData = true),
    ]) {
      const copy = structuredClone(doc);
      change(copy.layers[0].pixelMask);
      expect(() => validateDocument(copy)).toThrow();
    }
  });
});
