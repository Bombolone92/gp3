import { describe, expect, it } from "vitest";
import native from "./data/diagram-text-height-group-native.json";
import {
  fitDiagramTextHeightGroup,
  fitDiagramTextHeightLayout,
} from "../lib/pptx/src/internal/diagram/rule-fit.ts";

const plan = (current, limit) => ({ current, limit, mode: "value", rule: {} });
const predicates = (heights) =>
  heights.map((height) => (trial) => trial >= height);
const nearEMU = (value, expected) =>
  expect(Math.abs(Math.trunc(value * 36000) - expected)).toBeLessThanOrEqual(1);

describe("shared TX height allocation and drawing passes", () => {
  it.each(native.cases)("matches native ordered fitting: $name", (row) => {
    const initial = fitDiagramTextHeightGroup(
      plan(row.current, row.wideLimit),
      predicates(row.wideRequired),
    );
    const result = row.reflow
      ? fitDiagramTextHeightGroup(
          plan(row.current, row.limit),
          predicates(row.required),
          initial.allocation.value,
        )
      : initial;
    nearEMU(result.allocation.value, row.expected.allocation);
    expect(result.fits).toBe(!row.needsParentFallback);
    if (row.needsParentFallback) {
      // A failed height phase reports failure before its parent retries. The
      // new local rule limit still applies to the retained allocation.
      expect(result.drawing.fits).toBe(false);
      expect(result.allocation.fits).toBe(false);
      expect(row.required.some((height) => height > result.drawing.value)).toBe(
        true,
      );
      const retried = fitDiagramTextHeightGroup(
        plan(row.current, row.retry.limit),
        predicates(row.retry.required),
        result.allocation.value,
      );
      expect(retried.fits).toBe(false);
      nearEMU(retried.allocation.value, row.expected.allocation);
      nearEMU(retried.drawing.value, row.expected.finalDrawing);
    } else {
      nearEMU(result.drawing.value, row.expected.finalDrawing);
    }
  });

  it("does not hide an earlier failure when the final member is short", () => {
    const result = fitDiagramTextHeightGroup(
      plan(2, 10),
      predicates([3, 15, 4]),
    );
    expect(result).toEqual({
      allocation: { value: 10, fits: false },
      drawing: { value: 10, fits: false },
      fits: false,
    });
  });

  it("agrees with the local height phase for a one-member domain", () => {
    for (const retained of [undefined, 4, 11]) {
      const p = plan(2, 30),
        fits = (height) => height >= 7;
      const local = fitDiagramTextHeightLayout(p, fits, retained);
      const group = fitDiagramTextHeightGroup(p, [fits], retained);
      expect(group.allocation).toEqual(local.allocation);
      expect(group.drawing.value).toBe(local.extent);
      expect(group.fits).toBe(local.fits);
    }
  });

  it("keeps attempts independent and preserves their layout order", () => {
    const p = Object.freeze(plan(2, 56)),
      members = Object.freeze(predicates([5.1, 10.2]));
    const before = fitDiagramTextHeightGroup(p, members);
    expect(fitDiagramTextHeightGroup(p, [...members].reverse())).not.toEqual(
      before,
    );
    expect(fitDiagramTextHeightGroup(p, members)).toEqual(before);
    expect(p.current).toBe(2);
  });

  it("supports unbounded allocation while using the resulting finite drawing interval", () => {
    const needs = [5, 17, 41];
    const result = fitDiagramTextHeightGroup(
      plan(2, Infinity),
      predicates(needs),
    );
    expect(result.fits).toBe(true);
    expect(result.allocation.value).toBeGreaterThanOrEqual(41);
    expect(result.drawing.value).toBeGreaterThanOrEqual(41);
    expect(result.drawing.value).toBeLessThanOrEqual(result.allocation.value);
    expect(Number.isFinite(result.allocation.value)).toBe(true);
  });

  it("keeps a tighter current drawing bound distinct from retained space", () => {
    const result = fitDiagramTextHeightGroup(
      plan(2, 10),
      predicates([3, 15, 4]),
      20,
    );
    expect(result).toEqual({
      allocation: { value: 20, fits: true },
      drawing: { value: 10, fits: false },
      fits: false,
    });
  });

  it("rejects a missing member domain", () => {
    expect(() => fitDiagramTextHeightGroup(plan(2, 10), [])).toThrow(
      "empty diagram text height group",
    );
  });
});
