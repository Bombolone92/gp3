import { describe, it, expect } from "vitest";
import {
  layoutAxis,
  measureAxisTextRow,
} from "../lib/pptx-preview/src/chart-axis-layout.ts";

const base = {
  origin: 100,
  end: 400,
  horizontal: true,
  min: 10,
  max: 50,
  rowDepth: 30,
};
const coordinates = (layout) => [
  layout.placement.coordinate,
  layout.placement.tickCoordinate,
  layout.placement.labelCoordinate,
  layout.placement.labelSide,
  layout.placement.tickSide,
];

describe("independent native axis rails", () => {
  it.each([
    [
      "enum maximum",
      { crossing: "max", position: "t" },
      [100, 100, 100, -1, -1],
    ],
    [
      "numeric maximum facing inward",
      { crossing: { at: 50 }, position: "b" },
      [100, 100, 100, 1, 1],
    ],
    [
      "numeric maximum returned row",
      { crossing: { at: 50 }, position: "t" },
      [100, 430, 400, 1, -1],
    ],
    [
      "numeric above maximum returned row",
      { crossing: { at: 85 }, position: "t" },
      [100, 430, 400, 1, -1],
    ],
    [
      "reversed numeric maximum returned row",
      { reversed: true, crossing: { at: 50 }, position: "b" },
      [400, 70, 100, -1, 1],
    ],
    [
      "fixed low retains crossing marks",
      { crossing: { at: 50 }, position: "t", labelPosition: "low" },
      [100, 100, 400, 1, -1],
    ],
    [
      "fixed high retains crossing marks",
      { crossing: { at: 10 }, position: "t", labelPosition: "high" },
      [400, 400, 100, -1, -1],
    ],
    [
      "hidden labels retain crossing marks",
      {
        crossing: { at: 50 },
        position: "t",
        labelPosition: "none",
        rowDepth: 4,
      },
      [100, 100, 400, 1, -1],
    ],
    [
      "interior numeric keeps physical direction",
      { crossing: { at: 20 }, position: "t" },
      [325, 325, 325, 1, -1],
    ],
  ])("%s", (_, options, expected) => {
    expect(coordinates(layoutAxis({ ...base, ...options }))).toEqual(expected);
  });
  it("allocates shared outward rows while interior/inward rows overlap", () => {
    const primary = layoutAxis({ ...base, crossing: "min" });
    expect(
      coordinates(
        layoutAxis({ ...base, crossing: "min", rowDepth: 42 }, primary),
      ),
    ).toEqual([430, 430, 430, 1, 1]);
    const returned = layoutAxis({
      ...base,
      crossing: { at: 50 },
      position: "t",
    });
    expect(
      coordinates(
        layoutAxis(
          { ...base, crossing: { at: 50 }, position: "t", rowDepth: 42 },
          returned,
        ),
      ),
    ).toEqual([100, 472, 430, 1, -1]);
    const interior = layoutAxis({ ...base, crossing: { at: 20 } });
    expect(
      coordinates(layoutAxis({ ...base, crossing: { at: 20 } }, interior)),
    ).toEqual([325, 325, 325, 1, 1]);
    const inward = layoutAxis({ ...base, crossing: { at: 50 }, position: "b" });
    expect(
      coordinates(
        layoutAxis({ ...base, crossing: { at: 50 }, position: "b" }, inward),
      ),
    ).toEqual([100, 100, 100, 1, 1]);
  });
  it("can move a spine while leaving fixed and hidden-label marks at the nominal crossing", () => {
    const primary = layoutAxis({ ...base, crossing: "min" });
    for (const labelPosition of ["low", "none"]) {
      expect(
        coordinates(
          layoutAxis({ ...base, crossing: "min", labelPosition }, primary),
        ),
      ).toEqual([430, 400, 430, 1, 1]);
    }
  });
  it("reserves no row for a deleted primary axis", () => {
    const deleted = layoutAxis({ ...base, hidden: true });
    expect(coordinates(layoutAxis(base, deleted))).toEqual([
      400, 400, 400, 1, 1,
    ]);
  });
  it("projects vertical axes and translated/scaled plots without changing the logical rows", () => {
    const input = {
      ...base,
      origin: -80,
      end: 520,
      horizontal: false,
      min: -15,
      max: 25,
      crossing: { at: 25 },
      position: "r",
      rowDepth: 60,
    };
    const p = layoutAxis(input);
    expect(coordinates(p)).toEqual([520, -140, -80, -1, 1]);
    expect(coordinates(layoutAxis({ ...input, rowDepth: 20 }, p))).toEqual([
      520, -160, -140, -1, 1,
    ]);
  });
});

describe("intrinsic axis text rows", () => {
  const font = {
    family: "Measured face",
    sizePx: 16,
    bold: false,
    italic: false,
    letterSpacingPx: 0,
  };
  const measure = (text) => ({
    widthPx: text === "wide" ? 60 : 8,
    ascentPx: 12,
    descentPx: 4,
    lineGapPx: 2,
  });
  const options = { horizontal: true, category: true, visible: true };
  const row = (labels, opts = {}, measurer = measure) =>
    measureAxisTextRow(labels, font, measurer, { ...options, ...opts });
  it("uses font bounds and advance rather than ink or family names", () => {
    expect(row(["wide"]).depth).toBe(26);
    expect(row(["wide"], { horizontal: false }).depth).toBe(74);
    expect(row(["j", "É", "g"]).depth).toBe(26);
    expect(row(["A"], { horizontal: false }).depth).toBe(22);
    expect(
      row(["wide"], {}, (text) => ({
        ...measure(text),
        ascentPx: 15,
        descentPx: 6,
      })).depth,
    ).toBe(33);
  });
  it("retains mark and distance spaces without allocating a text rectangle for blank labels", () => {
    for (const labels of [[], ["", ""]])
      for (const angle of [0, 37, 90]) {
        expect(row(labels, { angle }).depth).toBe(10);
        expect(row(labels, { angle, horizontal: false }).depth).toBe(14);
        expect(row(labels, { angle, distance: 200 }).depth).toBe(14);
      }
    expect(row(["", "wide"], { angle: 37 })).toEqual(
      row(["wide"], { angle: 37 }),
    );
  });
  it("measures only displayed labels and preserves sub-em paragraph spacing", () => {
    expect(row(["A", "C"], { horizontal: false }).depth).toBe(22);
    expect(
      row(["wide"], { lineSpacing: { kind: "pct", value: 1 } }).depth,
    ).toBe(28);
    expect(
      row(["wide"], { lineSpacing: { kind: "pct", value: 0.5 } }).depth,
    ).toBe(19);
    expect(
      row(["wide"], { lineSpacing: { kind: "pts", value: 3 } }).depth,
    ).toBe(14);
    expect(
      row(["wide"], {
        horizontal: false,
        lineSpacing: { kind: "pts", value: 3 },
      }).depth,
    ).toBe(74);
  });
  it("projects the text rectangle for rotation, retaining independent font spaces", () => {
    expect(row(["wide"], { angle: 90 }).depth).toBeCloseTo(70, 10);
    expect(row(["wide"], { horizontal: false, angle: 90 }).depth).toBeCloseTo(
      30,
      10,
    );
  });
  it("keeps distance independent of rotation/paragraph advance with a three-point minimum unit", () => {
    expect(row(["wide"], { distance: 0 }).depth).toBe(22);
    expect(row(["wide"], { distance: 200 }).depth).toBe(30);
    const large = (text) => ({ ...measure(text), ascentPx: 24, descentPx: 8 });
    expect(
      row(["wide"], { distance: 200 }, large).depth -
        row(["wide"], {}, large).depth,
    ).toBe(8);
    expect(row(["wide"], { visible: false, distance: 400 }).depth).toBe(4);
    expect(row(["wide"], { visible: false, category: false }).depth).toBe(0);
  });
  it("supports width-only measurers without NaN, preserving the one-em fallback", () => {
    expect(row(["wide"], {}, () => ({ widthPx: 60 })).depth).toBeCloseTo(
      16 + 32 / 3 + 2,
    );
  });
});
