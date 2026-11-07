import { describe, expect, it } from "vitest";
import native from "./data/diagram-text-height-fit-native.json";
import { fitDiagramTextHeightRule } from "../lib/pptx/src/internal/diagram/rule-fit.ts";

const plan = (current, limit = Infinity, mode = "value", factor = NaN) => ({
  current,
  limit,
  mode,
  rule: { factor },
});

describe("DiagramML text height rule fitting", () => {
  it.each([
    [0.5, 50, 26.796875],
    [0.5 - 1e-9, 50, (0.5 - 1e-9) * 52],
    [0.1, 25.6, 26.4],
    [0.1, 25.9, 26.4],
    [0.001, 20, 26.112],
  ])(
    "matches native interval and endpoint boundaries (%s to %s)",
    (h, limit, expected) => {
      const fitted = fitDiagramTextHeightRule(
        plan(h, limit),
        (value) => value >= 25.962239583333332,
      );
      expect(fitted.fits).toBe(true);
      expect(fitted.value).toBeCloseTo(expected, 10);
    },
  );

  it("measures a failed doubling before returning the strict finite endpoint", () => {
    const calls = [];
    expect(
      fitDiagramTextHeightRule(plan(0.1, 25.599999), (h) => {
        calls.push(h);
        return h >= 26;
      }),
    ).toEqual({ value: 25.599999, fits: false });
    expect(calls.at(-1)).toBe(25.6);
    expect(calls).not.toContain(25.599999);
  });

  it("restarts the full finite interval after 20 unsuccessful doubles", () => {
    const calls = [];
    const result = fitDiagramTextHeightRule(plan(0.00001, 50), (h) => {
      calls.push(h);
      return h >= 26;
    });
    expect(calls[20]).toBe(0.00001 * 2 ** 20);
    expect(calls[21]).toBe(50);
    expect(calls[22]).toBeCloseTo((50 + 0.00001) / 2, 12);
    expect(result.value).toBeCloseTo(26.5625046875, 10);
  });

  it.each(native.cases)("matches the native reference height search: $name", (row) => {
    const p = plan(
      row.current,
      row.limit === "INF" ? Infinity : Number(row.limit),
    );
    const before = structuredClone(p);
    const result = fitDiagramTextHeightRule(
      p,
      (height) => height >= row.minimumHeight,
    );
    expect(result.fits).toBe(true);
    expect(
      Math.abs(result.value * 36000 - row.expectedHeight),
    ).toBeLessThanOrEqual(1);
    expect(p).toEqual(before);
  });

  it("refines the last failed doubling interval, not the whole original interval", () => {
    const calls = [];
    const result = fitDiagramTextHeightRule(plan(3), (height) => {
      calls.push(height);
      return height >= 17;
    });
    expect(result).toEqual({ value: 17.25, fits: true });
    expect(calls).toEqual([3, 6, 12, 24, 18, 15, 16.5, 17.25, 16.875]);
  });

  it("reevaluates width-dependent wrapping on every trial", () => {
    const widths = [];
    const result = fitDiagramTextHeightRule(plan(2), (height) => {
      const width = 3 * height;
      widths.push(width);
      // A line can accommodate more content as its width grows. Treat this as
      // an independent layout predicate; the search must not cache the first
      // trial's line count or assume a constant required text height.
      const lineCount = Math.ceil(100 / width);
      return height >= lineCount * 4;
    });
    expect(result).toEqual({ value: 12, fits: true });
    expect(new Set(widths).size).toBe(widths.length);
    expect(widths).toContain(36);
  });

  it("keeps an already feasible height and honors finite, inactive and exhausted rules", () => {
    const calls = [];
    expect(
      fitDiagramTextHeightRule(plan(20), (h) => {
        calls.push(h);
        return true;
      }),
    ).toEqual({ value: 20, fits: true });
    expect(calls).toEqual([20]);
    expect(fitDiagramTextHeightRule(plan(3, 9), (h) => h >= 10)).toEqual({
      value: 9,
      fits: false,
    });
    expect(fitDiagramTextHeightRule(plan(3, 2), () => false)).toEqual({
      value: 3,
      fits: false,
    });
    expect(
      fitDiagramTextHeightRule(plan(3, Infinity, "maximum"), () => false),
    ).toEqual({ value: 3, fits: false });
    expect(
      fitDiagramTextHeightRule(plan(3, Infinity, "factor", 5e-10), () => false),
    ).toEqual({ value: 3, fits: false });
  });

  it.each([0, -1])(
    "requires automatic or nonpositive starting height %s to be resolved before unbounded growth",
    (height) => {
      expect(() => fitDiagramTextHeightRule(plan(height), () => false)).toThrow(
        "requires a positive height",
      );
    },
  );

  it("bounds expansion across the finite exponent range without infinite trials", () => {
    let probes = 0;
    expect(
      fitDiagramTextHeightRule(plan(Number.MIN_VALUE), (h) => {
        ++probes;
        expect(Number.isFinite(h)).toBe(true);
        return h >= 1;
      }),
    ).toEqual({ value: 0, fits: false });
    expect(probes).toBe(22);
    expect(
      fitDiagramTextHeightRule(
        plan(Number.MAX_VALUE / 2),
        (h) => h === Number.MAX_VALUE,
      ),
    ).toEqual({ value: Number.MAX_VALUE, fits: true });
  });

  it("terminates an infeasible unbounded search and propagates layout failures", () => {
    let probes = 0;
    expect(
      fitDiagramTextHeightRule(plan(Number.MIN_VALUE), (h) => {
        ++probes;
        expect(Number.isFinite(h)).toBe(true);
        return false;
      }),
    ).toEqual({ value: 0, fits: false });
    expect(probes).toBe(22);
    expect(() =>
      fitDiagramTextHeightRule(plan(1), () => {
        throw Error("layout failed");
      }),
    ).toThrow("layout failed");
  });
});
