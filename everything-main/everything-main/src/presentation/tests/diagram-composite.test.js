import { describe, expect, it } from "vitest";
import native from "./data/diagram-composite-native.json";
import { resolveDiagramCompositeRect } from "../lib/pptx/src/internal/diagram/composite.ts";
import { arrangeDiagramChildren } from "../lib/pptx/src/internal/diagram/arrange.ts";

const available = { w: 200, h: 100 };

describe("DiagramML composite coordinate derivation", () => {
  it.each(native.cases)("matches the native reference: $name", (row) => {
    const before = structuredClone(row);
    const rect = resolveDiagramCompositeRect(row.available, row.values);
    const [result] = arrangeDiagramChildren(row.available, [rect], {
      type: "composite",
      aspectRatio: 0,
      horizontal: row.alignment === "center" ? "ctr" : "none",
      vertical: row.alignment === "center" ? "mid" : "none",
    });
    for (const key of ["x", "y", "w", "h"])
      expect(
        Math.abs(Math.trunc(result[key] * 36000) - row.expected[key]),
      ).toBeLessThanOrEqual(1);
    expect(row).toEqual(before);
  });

  it("keeps absent coordinates distinct from explicit zero", () => {
    expect(resolveDiagramCompositeRect(available, {})).toEqual({
      x: 0,
      y: 0,
      w: 200,
      h: 100,
    });
    expect(resolveDiagramCompositeRect(available, { w: 0, h: 0 })).toEqual({
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
    expect(resolveDiagramCompositeRect(available, { l: 0, t: 0 })).toEqual({
      x: 0,
      y: 0,
      w: 200,
      h: 100,
    });
    expect(
      resolveDiagramCompositeRect(available, { ctrX: 45, ctrY: 25 }),
    ).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(
      resolveDiagramCompositeRect(available, {
        ctrX: 45,
        ctrY: 25,
        w: 0,
        h: 0,
      }),
    ).toEqual({ x: 45, y: 25, w: 0, h: 0 });
  });

  it("leaves group alignment and overflow fitting to the arrangement stage", () => {
    expect(
      resolveDiagramCompositeRect(available, { l: -30, t: 140, w: 500, h: 20 }),
    ).toEqual({ x: -30, y: 140, w: 500, h: 20 });
  });

  it("normalizes explicit extents before position, and derived extents after position", () => {
    expect(
      resolveDiagramCompositeRect(available, { r: 30, w: -20, b: 30, h: -20 }),
    ).toEqual({ x: 10, y: 10, w: 20, h: 20 });
    expect(
      resolveDiagramCompositeRect(available, {
        r: 10,
        ctrX: 30,
        b: 10,
        ctrY: 30,
      }),
    ).toEqual({ x: 50, y: 50, w: 40, h: 40 });
  });

  it("preserves sub-EMU precision for later dependent geometry", () => {
    const rect = resolveDiagramCompositeRect(available, {
      l: 1 / 7,
      r: 2 / 7,
      t: 1 / 13,
      b: 2 / 13,
    });
    expect(rect).toEqual({ x: 1 / 7, y: 1 / 13, w: 1 / 7, h: 1 / 13 });
    expect(rect.w * 36000).not.toBe(Math.trunc(rect.w * 36000));
  });

  it.each([0, 1e-9, 0.25, 3, 1e12])(
    "is scale invariant at scale %s",
    (factor) => {
      const values = { ctrX: 53, r: 71, t: 13, b: 77 };
      const initial = resolveDiagramCompositeRect(available, values);
      const scale = (record) =>
        Object.fromEntries(
          Object.entries(record).map(([k, v]) => [k, v * factor]),
        );
      const actual = resolveDiagramCompositeRect(
        scale(available),
        scale(values),
      );
      const expected = scale(initial);
      for (const key of ["x", "y", "w", "h"])
        expect(Math.abs(actual[key] - expected[key])).toBeLessThanOrEqual(
          Math.abs(expected[key]) * Number.EPSILON * 4,
        );
    },
  );

  it.each(["l", "ctrX", "r", "w", "t", "ctrY", "b", "h"])(
    "rejects nonfinite %s even when another coordinate takes precedence",
    (key) => {
      for (const value of [NaN, Infinity, -Infinity])
        expect(() =>
          resolveDiagramCompositeRect(available, {
            l: 0,
            r: 20,
            w: 20,
            t: 0,
            b: 20,
            h: 20,
            [key]: value,
          }),
        ).toThrow("non-finite diagram composite geometry");
    },
  );

  it("rejects invalid available dimensions and arithmetic overflow", () => {
    for (const value of [NaN, Infinity, -Infinity, -1])
      for (const key of ["w", "h"])
        expect(() =>
          resolveDiagramCompositeRect({ ...available, [key]: value }, {}),
        ).toThrow();
    expect(() =>
      resolveDiagramCompositeRect(available, {
        l: -Number.MAX_VALUE,
        r: Number.MAX_VALUE,
      }),
    ).toThrow("non-finite diagram composite geometry");
    expect(() =>
      resolveDiagramCompositeRect(available, {
        ctrY: Number.MAX_VALUE,
        b: -Number.MAX_VALUE,
      }),
    ).toThrow("non-finite diagram composite geometry");
  });
});
