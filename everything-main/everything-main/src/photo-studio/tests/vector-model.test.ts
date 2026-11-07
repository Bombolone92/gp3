import { describe, it, expect } from "vitest";
import {
  layer,
  newDocument,
  resizeDocument,
  cropDocument,
} from "../src/model/document";
import {
  vectorBounds,
  vectorMatrix,
  transformedVectorMask,
  vectorUnbounded,
  type VectorColor,
} from "../src/model/vector";
import {
  validateDocument,
  serialize,
  deserialize,
} from "../src/model/serialization";
import { Assets } from "../src/model/assets";
import { History } from "../src/history/history";
import { savePsd } from "../src/model/psd";

function shape() {
  const l = layer("vector", "Cubic", 40, 30);
  l.vector = {
    reference: { x: 0, y: 0, width: 10, height: 7.5 },
    fill: { rgb: [-0.123456789, 3.25, 0.137], space: "document" },
    mask: {
      paths: [
        {
          operation: "combine",
          open: false,
          fillRule: "even-odd",
          knots: [
            { linked: false, points: [0, 0, 0, 0, 0, 10] },
            { linked: false, points: [10, 10, 10, 0, 10, 0] },
          ],
        },
      ],
    },
  };
  l.transform = { ...l.vector.reference, rotation: 0 };
  return l;
}
describe("editable vector document semantics", () => {
  it("rejects PSD coordinate overflow before requesting composite pixels", async () => {
    for (const [width, height] of [
      [40, 30],
      [127, 73],
    ]) {
      const doc = newDocument(width, height),
        l = shape();
      doc.layers = [l];
      const render = async () => {
        throw new Error("Composite requested");
      };
      for (const axis of ["x", "y"] as const) {
        const dimension = axis === "x" ? width : height;
        for (const value of [16 * dimension, -16 * dimension - 1]) {
          l.transform[axis] = value;
          await expect(savePsd(doc, render)).rejects.toThrow("signed 8.24");
        }
        l.transform[axis] = -16 * dimension;
        await expect(savePsd(doc, render)).rejects.toThrow(
          "Composite requested",
        );
        l.transform[axis] = 0;
      }
    }
  });
  it("computes cubic extrema and derives transforms without altering source knots", () => {
    const l = shape(),
      before = structuredClone(l.vector!);
    expect(vectorBounds(l.vector!.mask)).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 7.5,
    });
    l.transform = { x: 5, y: 2, width: 20, height: 15, rotation: 90 };
    const mask = transformedVectorMask(l);
    expect(mask.paths[0].knots[0].points[2]).toBeCloseTo(22.5, 12);
    expect(mask.paths[0].knots[0].points[3]).toBeCloseTo(-0.5, 12);
    expect(l.vector).toEqual(before);
    expect(vectorBounds(mask)!.width).toBeCloseTo(15, 12);
  });
  it("distinguishes unbounded fill from the geometry of its finite contours", () => {
    const mask = shape().vector!.mask;
    expect(vectorUnbounded(mask)).toBe(false);
    mask.invert = true;
    expect(vectorUnbounded(mask)).toBe(true);
    mask.disable = true;
    expect(vectorUnbounded(mask)).toBe(true);
    mask.disable = false;
    mask.invert = false;
    mask.paths[0].operation = "subtract";
    expect(vectorUnbounded(mask)).toBe(true);
    mask.paths.push({
      ...structuredClone(mask.paths[0]),
      operation: "intersect",
    });
    expect(vectorUnbounded(mask)).toBe(false);
  });
  it("preserves original geometry and HDR fill values through native save, history and document transforms", async () => {
    const doc = newDocument(40, 30);
    doc.bitsPerChannel = 32;
    doc.layers = [shape()];
    const before = structuredClone(doc.layers[0].vector!);
    const history = new History(doc);
    history.execute("Move", (d) => {
      d.layers[0].transform.x = -7.125;
    });
    history.undo();
    expect(history.document.layers[0].vector).toEqual(before);
    resizeDocument(doc, 80, 90);
    cropDocument(doc, { x: 2, y: 3, width: 50, height: 60 });
    expect(doc.layers[0].vector).toEqual(before);
    const result = await deserialize(await serialize(doc, new Assets()));
    expect(result.document).toEqual(doc);
    result.assets.clear();
  });
  it("keeps unlinked masks fixed during layer transforms and moves them with document coordinates", () => {
    const doc = newDocument(40, 30),
      l = shape();
    doc.layers = [l];
    l.vector!.mask.notLink = true;
    l.transform.x = 17;
    expect(vectorMatrix(l)).toEqual([1, 0, 0, 1, 0, 0]);
    resizeDocument(doc, 80, 60);
    cropDocument(doc, { x: 3, y: 4, width: 40, height: 30 });
    expect(transformedVectorMask(l).paths[0].knots[0].points[2]).toBe(-3);
    expect(transformedVectorMask(l).paths[0].knots[0].points[3]).toBe(-4);
  });
  it("rejects malformed vectors and preserves unsupported export combinations instead of flattening them", async () => {
    const doc = newDocument(40, 30),
      l = shape();
    doc.layers = [l];
    validateDocument(doc);
    (l.vector!.fill as VectorColor).rgb[0] = Infinity;
    expect(() => validateDocument(doc)).toThrow("vector");
    (l.vector!.fill as VectorColor).rgb[0] = 0.2;
    l.vector!.reference.width = 0;
    expect(() => validateDocument(doc)).toThrow("vector");
    l.vector!.reference.width = 10;
    l.asset = "cached-preview";
    expect(() => validateDocument(doc)).toThrow("raster");
    delete l.asset;
    l.mask = { x: 0, y: 0, width: 10, height: 10 };
    await expect(
      savePsd(doc, async () => {
        throw new Error("Flattened callback must not execute");
      }),
    ).rejects.toThrow("pixel masks or blur");
  });
});
