import { expect, it } from "vitest";
import { P } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { chartLegendLayoutDeck } from "./chart-copy-fixture.js";
import {
  getAttrValue,
  parseXml,
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";

const C = "#A3472B",
  V = "#9152BD";
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const num = (e, n) => +attr(e, n);
const systems = [
  ["column", "category"],
  ["column", "value"],
  ["bar", "category"],
  ["bar", "value"],
];
function fixture(kind, target, direction, crossing, mode, extra = {}) {
  return chartLegendLayoutDeck({
    kind,
    legend: undefined,
    categories: ["First", "Second", "Third", "Fourth"],
    series: [{ name: "Units", values: [2, 4, 3, 5], color: "#E85239" }],
    valueAxis: { min: -2, max: 10, majorUnit: 2 },
    valueAxisCrossBetween: "between",
    categoryAxisOrientation: target === "value" ? direction : "minMax",
    valueAxisOrientation: target === "category" ? direction : "minMax",
    categoryAxisCrosses: target === "category" ? crossing : "autoZero",
    valueAxisCrosses: target === "value" ? crossing : "autoZero",
    categoryAxisLineColor: C,
    valueAxisLineColor: V,
    categoryAxisMajorTickMark: "none",
    valueAxisMajorTickMark: "none",
    // These controls isolate major marks.
    categoryAxisMinorTickMark: "none",
    valueAxisMinorTickMark: "none",
    categoryAxisTickLabelPos: "none",
    valueAxisTickLabelPos: "none",
    categoryAxisLabelStyle: { font: "Independent Face", sizePt: 12.5 },
    valueAxisLabelStyle: { font: "Independent Face", sizePt: 12.5 },
    [`${target}AxisMajorTickMark`]: mode,
    [`${target}AxisTickLabelPos`]: "nextTo",
    ...extra,
  });
}
function paint(f, kind, target) {
  const svg = renderSlideToSvg(f.p, f.slide, {
    measureText: (text, font) => ({
      widthPx: text.length * font.sizePx * 0.5,
      ascentPx: font.sizePx * 0.9,
      descentPx: font.sizePx * 0.2,
    }),
    resolveFontFamily: (family) => family,
  });
  const horizontal = (kind !== "bar") === (target === "category");
  const normal = horizontal ? "y" : "x",
    along = horizontal ? "x" : "y",
    lines = [];
  walkElements(parseXml(svg).root, (e) => {
    if (
      e.name.localName === "line" &&
      attr(e, "stroke") === (target === "category" ? C : V)
    )
      lines.push(e);
  });
  const spine = lines.find((e) => num(e, along + "1") !== num(e, along + "2"));
  expect(spine).toBeDefined();
  const mode = P.getShapeChartSpec(f.shape)[`${target}AxisMajorTickMark`];
  const ticks = lines.filter((e) => e !== spine);
  expect(ticks.length).toBeGreaterThan(1);
  return ticks.map((e) => {
    // Returned nextTo marks use an independent rail. The first endpoint is
    // the in-mark rail, the second the out-mark rail. Absolute native rail
    // positions are asserted separately in chart-axis-layout/rails tests.
    const a = num(e, normal + "1"),
      b = num(e, normal + "2");
    const origin = mode === "in" ? a : b;
    return [a - origin, b - origin].sort((a, b) => a - b);
  });
}
function check(extents, side, mode, length = 5) {
  const effective = side * (mode === "in" ? -1 : 1);
  for (const [lo, hi] of extents) {
    expect(lo).toBeCloseTo(effective < 0 ? -length : 0, 1);
    expect(hi).toBeCloseTo(effective > 0 ? length : 0, 1);
  }
}
// Ninety-six native one-sided controls establish independent mark and label
// directions. These assertions isolate direction about the painter's own mark
// rail; the independent layout tests assert native absolute rail positions.
for (const [kind, target] of systems)
  for (const direction of ["minMax", "maxMin"])
    for (const crossingName of [
      "min",
      "max",
      "autoZero",
      "numericMin",
      "numericMiddle",
      "numericMax",
    ])
      for (const mode of ["in", "out"])
        it(`${kind} ${target} ${direction} ${crossingName} ${mode} follows native mark direction`, () => {
          const min = target === "category" ? -2 : 1,
            max = target === "category" ? 10 : 5;
          const crossing =
            crossingName === "numericMin"
              ? { at: min }
              : crossingName === "numericMiddle"
                ? { at: (min + max) / 2 }
                : crossingName === "numericMax"
                  ? { at: max }
                  : crossingName;
          const horizontal = (kind !== "bar") === (target === "category");
          const physical = horizontal ? 1 : -1;
          const expected =
            typeof crossing === "object"
              ? physical
              : physical *
                (direction === "maxMin" ? -1 : 1) *
                (crossing === "max" ? -1 : 1);
          check(
            paint(
              fixture(kind, target, direction, crossing, mode),
              kind,
              target,
            ),
            expected,
            mode,
          );
        });
for (const [kind, target] of systems)
  for (const labelPos of ["nextTo", "low", "high", "none"])
    it(`${kind} ${target} numeric marks stay independent of ${labelPos} labels and own-axis direction`, () => {
      const physical = (kind !== "bar") === (target === "category") ? 1 : -1;
      for (const ownDirection of ["minMax", "maxMin"])
        for (const mode of ["in", "out"])
          check(
            paint(
              fixture(kind, target, "maxMin", { at: 3 }, mode, {
                [`${target}AxisOrientation`]: ownDirection,
                [`${target}AxisTickLabelPos`]: labelPos,
              }),
              kind,
              target,
            ),
            physical,
            mode,
          );
    });
for (const [kind, target] of systems)
  it(`${kind} ${target} numeric direction survives independent font, stroke, rotation and chart-size changes`, () => {
    for (const size of [2, 5, 9])
      for (const mode of ["in", "out"]) {
        const f = fixture(kind, target, "maxMin", { at: 2.5 }, mode, {
          [`${target}AxisLabelStyle`]: {
            font: "Different Face",
            sizePt: 27.25,
          },
          [`${target}AxisLabelRotationDeg`]: -45,
          [`${target}AxisLineWidthEmu`]: 38100,
        });
        P.setShapeSize(f.shape, P.inches(size), P.inches(size));
        check(
          paint(f, kind, target),
          (kind !== "bar") === (target === "category") ? 1 : -1,
          mode,
          (((27.25 * 4) / 3) * 0.9) / 3,
        );
      }
  });
