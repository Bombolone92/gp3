import { describe, expect, it } from "vitest";
import { P, parseDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  chartLegendLayoutDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";
import {
  getAttrValue,
  parseXml,
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";

const labelColor = "#17589B",
  gridColor = "#9152BD";
const attr = (e, name) => getAttrValue(e, qname("", name, ""));
const num = (e, name) => Number(attr(e, name));
const text = (e) =>
  e.children
    .filter((c) => c.kind === "text")
    .map((c) => c.data)
    .join("");
const measure = (text, font) => ({
  widthPx: [...text].length * font.sizePx * 0.6,
  ascentPx: font.sizePx * 0.8,
  descentPx: font.sizePx * 0.2,
});
function fixture(kind, valueAxis, extra = {}) {
  return chartLegendLayoutDeck({
    kind,
    legend: undefined,
    categories: ["A", "B", "C", "D"],
    series: [{ name: "Units", values: [2, 4, 3, 5], color: "#E85239" }],
    categoryAxisTickLabelPos: "none",
    // Isolate the tick lattice from grid exclusion at a painted crossing.
    categoryAxisLineColor: null,
    valueAxisTickLabelPos: "low",
    categoryAxisLabelRotationDeg: 0,
    valueAxisLabelRotationDeg: 0,
    valueAxisLabelStyle: { sizePt: 9, color: labelColor },
    valueAxisMajorGridlines: true,
    valueAxisMajorGridlineColor: gridColor,
    valueAxis: { numberFormat: "0.0000000000", ...valueAxis },
    ...extra,
  });
}
function paint(f) {
  const nodes = [];
  walkElements(
    parseXml(renderSlideToSvg(f.p, f.slide, { measureText: measure })).root,
    (e) => nodes.push(e),
  );
  const plot = nodes.find(
    (e) => e.name.localName === "rect" && attr(e, "fill") === "#ECF5E9",
  );
  return {
    plot,
    labels: nodes.filter(
      (e) => e.name.localName === "text" && attr(e, "fill") === labelColor,
    ),
    grids: nodes.filter(
      (e) => e.name.localName === "line" && attr(e, "stroke") === gridColor,
    ),
  };
}

describe("linear value-axis tick domains", () => {
  // Native reference controls: the first tick is the minimum, independent
  // of zero, data, axis direction and whether the upper bound is a tick.
  const cases = [
    [1.25, 5.5, 0.5, [1.25, 1.75, 2.25, 2.75, 3.25, 3.75, 4.25, 4.75, 5.25]],
    [-3.1, 6.9, 2, [-3.1, -1.1, 0.9, 2.9, 4.9, 6.9]],
    [0.003, 0.009, 0.002, [0.003, 0.005, 0.007, 0.009]],
    [0, 12, 5, [0, 5, 10]],
    [0, 3, 5, [0]],
    [2, 2.5, 1e20, [2]],
    [0, 3e-10, 1e-10, [0, 1e-10, 2e-10, 3e-10]],
    [1e12, 1e12 + 10, 1, Array.from({ length: 11 }, (_, i) => 1e12 + i)],
    [-0.3, 0.3, 0.1, [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]],
  ];
  for (const kind of ["column", "bar", "line", "area"])
    for (const direction of ["minMax", "maxMin"])
      for (const [min, max, majorUnit, values] of cases)
        it(`${kind} ${direction} starts ${min}..${max} at its minimum with unit ${majorUnit}`, () => {
          const f = fixture(
            kind,
            { min, max, majorUnit },
            { valueAxisOrientation: direction },
          );
          const r = paint(f);
          expect(
            r.labels.map((e) => Number(text(e).replaceAll(",", ""))),
          ).toEqual(values);
          expect(r.grids).toHaveLength(values.length);
          const horizontal = kind === "bar",
            start = num(r.plot, horizontal ? "x" : "y"),
            length = num(r.plot, horizontal ? "width" : "height");
          r.grids.forEach((grid, i) => {
            const fraction = (values[i] - min) / (max - min);
            const forward = horizontal ? fraction : 1 - fraction;
            expect(
              (num(grid, horizontal ? "x1" : "y1") - start) / length,
            ).toBeCloseTo(direction === "maxMin" ? 1 - forward : forward, 4);
          });
        });

  for (const kind of ["column", "bar", "line", "area"])
    for (const [min, max] of [
      [0, 1000],
      [0, 1e7],
      [-1e12, 1e12],
      [2, 2.5],
      [0, 1e-10],
    ])
      it(`${kind} chooses automatic spacing from the resolved ${min}..${max} domain`, () => {
        const small = fixture(kind, { min, max }),
          huge = fixture(
            kind,
            { min, max },
            {
              series: [
                { name: "Other units", values: [2e10, 4e10, 3e10, 5e10] },
              ],
            },
          );
        const a = paint(small),
          b = paint(huge);
        expect(a.labels.map(text)).toEqual(b.labels.map(text));
        expect(a.grids.length).toBeGreaterThan(1);
        expect(a.grids.length).toBeLessThan(15);
        for (const grid of a.grids) {
          const horizontal = kind === "bar",
            coordinate = num(grid, horizontal ? "x1" : "y1"),
            start = num(a.plot, horizontal ? "x" : "y");
          expect(coordinate).toBeGreaterThanOrEqual(start - 0.001);
          expect(coordinate).toBeLessThanOrEqual(
            start + num(a.plot, horizontal ? "width" : "height") + 0.001,
          );
        }
      });

  it.each([0, -2])(
    "ignores an invalid %s major unit without a non-advancing tick loop",
    (majorUnit) => {
      const f = fixture("bar", { min: 0, max: 10, majorUnit });
      expect(paint(f).labels.map((e) => Number(text(e)))).toEqual([
        0, 2, 4, 6, 8, 10,
      ]);
      expect(P.getShapeChartSpec(f.shape).valueAxis.majorUnit).toBe(majorUnit);
    },
  );

  it("keeps distinct tick positions when the unit is smaller than the ULP at the minimum", () => {
    const min = 1e12,
      max = min + 0.0001220703125;
    const r = paint(fixture("column", { min, max, majorUnit: 0.00002 }));
    expect(r.labels).toHaveLength(7);
    expect(new Set(r.grids.map((e) => num(e, "y1"))).size).toBe(7);
    r.grids.forEach((grid, i) =>
      expect(
        (num(grid, "y1") - num(r.plot, "y")) / num(r.plot, "height"),
      ).toBeCloseTo(1 - (i * 0.00002) / (max - min), 4),
    );
  });

  it("does not materialize preview defaults in editable charts or untouched exports", async () => {
    const f = fixture("bar", { min: 1.25, max: 5.5 }),
      part = chartRoot(f.shape),
      chart = P._internalPackageOf(f.p).getPart(part).data.slice(),
      book = workbook(f.p, f.shape).data.slice();
    const before = P.getShapeChartSpec(f.shape),
      rendered = paint(f).labels.map(text);
    expect(before.valueAxis.majorUnit).toBeUndefined();
    expect(P.getShapeChartSpec(f.shape)).toEqual(before);
    const loaded = await parseDeck(await P.savePresentation(f.p)),
      slide = P.getSlides(loaded)[0],
      shape = P.getSlideCharts(slide)[0].shape;
    expect(P.getShapeChartSpec(shape)).toEqual(before);
    expect(P._internalPackageOf(loaded).getPart(chartRoot(shape)).data).toEqual(
      chart,
    );
    expect(workbook(loaded, shape).data).toEqual(book);
    expect(paint({ p: loaded, slide }).labels.map(text)).toEqual(rendered);
  });
});
