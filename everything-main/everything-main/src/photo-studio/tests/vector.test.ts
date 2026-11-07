import { describe, it, expect } from "vitest";
import {
  validateVectorMask,
  validateVectorViewport,
  vectorComponents,
  type VectorMask,
} from "../src/model/vector";

const contour = (operation?: VectorMask["paths"][number]["operation"]) => ({
  open: false,
  fillRule: "even-odd" as const,
  operation,
  knots: [{ linked: false, points: [0, 0, 0, 0, 1, 1] }],
});

describe("editable cubic vector records", () => {
  it("preserves merged contours, linked handles, fractional coordinates and flags", () => {
    const mask: VectorMask = {
      invert: true,
      disable: false,
      notLink: true,
      fillStartsWithAllPixels: false,
      clipboard: {
        top: -1,
        left: 0.5,
        right: 12.75,
        bottom: 33,
        resolution: 144,
      },
      paths: [contour("combine"), contour(), contour("subtract"), contour()],
    };
    mask.paths[1].knots[0] = {
      linked: true,
      points: [-100, 0.125, -50, 0.5, 0, 0.875],
    };
    const before = JSON.stringify(mask);
    validateVectorMask(mask);
    expect(
      vectorComponents(mask).map((c) => [c.operation, c.paths.length]),
    ).toEqual([
      ["combine", 2],
      ["subtract", 2],
    ]);
    expect(JSON.stringify(mask)).toBe(before);
    expect(
      vectorComponents({ paths: [contour(), contour()] })[0].operation,
    ).toBe("combine");
  });

  it("rejects malformed records before WASM or canvas allocation", () => {
    for (const change of [
      (m: any) => {
        m.paths = null;
      },
      (m: any) => {
        m.invert = 1;
      },
      (m: any) => {
        m.clipboard = {};
      },
      (m: any) => {
        m.paths[0].open = "yes";
      },
      (m: any) => {
        m.paths[0].operation = "xor";
      },
      (m: any) => {
        m.paths[0].fillRule = "none";
      },
      (m: any) => {
        m.paths[0].knots[0].linked = null;
      },
      (m: any) => {
        m.paths[0].knots[0].points.push(0);
      },
      (m: any) => {
        m.paths[0].knots[0].points[0] = NaN;
      },
      (m: any) => {
        m.paths[0].knots[0].points[0] = "2";
      },
      (m: any) => {
        m.paths[0].knots[0].points[0] = Infinity;
      },
    ]) {
      const mask = { paths: [contour("combine")] };
      change(mask);
      expect(() => validateVectorMask(mask)).toThrow(/vector|cubic/i);
    }
    expect(() =>
      validateVectorMask({ paths: Array(65536).fill(contour()) }),
    ).toThrow();
    const path = contour();
    path.knots = Array(50001).fill(path.knots[0]);
    expect(() => validateVectorMask({ paths: [path, path] })).toThrow(/budget/);
  });

  it("bounds render allocations independently of off-canvas source geometry", () => {
    validateVectorViewport(
      { x: -1e6, y: 0.25, width: 37, height: 23 },
      [1, 0, 0, 1, 0, 0],
    );
    for (const viewport of [
      { x: NaN, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: 1.5, height: 1 },
      { x: 0, y: 0, width: 0, height: 1 },
      { x: 0, y: 0, width: 8192, height: 8192 },
    ])
      expect(() =>
        validateVectorViewport(viewport, [1, 0, 0, 1, 0, 0]),
      ).toThrow();
    expect(() =>
      validateVectorViewport({ x: 0, y: 0, width: 1, height: 1 }, [
        1,
        0,
        0,
        Infinity,
        0,
        0,
      ]),
    ).toThrow();
  });
});
