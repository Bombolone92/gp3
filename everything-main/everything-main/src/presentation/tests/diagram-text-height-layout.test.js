import { describe, expect, it } from "vitest";
import native from "./data/diagram-text-height-layout-native.json";
import {
  fitDiagramTextHeightRule,
  fitDiagramTextHeightLayout,
} from "../lib/pptx/src/internal/diagram/rule-fit.ts";
const plan = (current, limit) => ({
  current,
  limit,
  mode: "value",
  rule: {},
  hasCrossPropertyDependents: false,
});
const nearEMU = (value, expected) =>
  expect(Math.abs(Math.trunc(value * 36000) - expected)).toBeLessThanOrEqual(1);

describe("TX preferred height and retained layout allocation", () => {
  it.each(native.cases)("matches native reflow: $name", (row) => {
    const original = fitDiagramTextHeightRule(
      plan(row.current, row.wideLimit),
      (h) => h >= row.wideRequired,
    );
    const result = fitDiagramTextHeightLayout(
      plan(row.current, row.limit),
      (h) => h >= row.required,
      row.retain ? original.value : undefined,
    );
    expect(result.fits).toBe(true);
    nearEMU(result.preferred.value, row.expected.preferred);
    nearEMU(result.extent, row.expected.extent);
    if (row.expected.allocation !== null)
      nearEMU(result.allocation.value, row.expected.allocation);
  });

  it("reports local failure even when an old allocation still holds the content", () => {
    const result = fitDiagramTextHeightLayout(plan(3, 6), (h) => h >= 8, 12);
    expect(result).toEqual({
      preferred: { value: 6, fits: false },
      allocation: { value: 12, fits: true },
      extent: 6,
      fits: false,
    });
  });

  it("keeps retained trials independent across repeated layout evaluations", () => {
    const input = Object.freeze(plan(2, 40));
    const first = fitDiagramTextHeightLayout(input, (h) => h >= 7, 11);
    const wrapped = fitDiagramTextHeightLayout(input, (h) => h >= 23, 11);
    expect(first.allocation).toEqual({ value: 11, fits: true });
    expect(wrapped.allocation.value).toBeGreaterThanOrEqual(23);
    expect(fitDiagramTextHeightLayout(input, (h) => h >= 7, 11)).toEqual(first);
    expect(input.current).toBe(2);
  });

  it("retains unbounded-rule bracketing for both independent searches", () => {
    const result = fitDiagramTextHeightLayout(
      plan(2, Infinity),
      (h) => h >= 19,
      7,
    );
    expect(result.fits).toBe(true);
    expect(result.preferred).toEqual(
      fitDiagramTextHeightRule(plan(2, Infinity), (h) => h >= 19),
    );
    expect(result.allocation).toEqual(
      fitDiagramTextHeightRule(plan(7, Infinity), (h) => h >= 19),
    );
    expect(result.extent).toBeGreaterThanOrEqual(19);
  });

  it("rejects nonfinite retained geometry before evaluating a trial", () => {
    for (const value of [NaN, Infinity, -Infinity])
      expect(() =>
        fitDiagramTextHeightLayout(
          plan(2, 40),
          () => {
            throw Error("unexpected measurement");
          },
          value,
        ),
      ).toThrow("invalid retained diagram text height");
  });
});
