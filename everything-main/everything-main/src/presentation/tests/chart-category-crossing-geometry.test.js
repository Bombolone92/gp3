import { paintPlotGuides } from "./chart-plot-guides-fixture.js";
import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  chartLegendLayoutDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

const colors = ["#E85239", "#2F8541"],
  labels = ["#123ABC", "#7B1269"],
  catColor = "#A3472B";
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const text = (e) =>
  e.children
    .filter((n) => n.kind === "text")
    .map((n) => n.data)
    .join("");
function fixture(kind, overrides = {}) {
  return chartLegendLayoutDeck({
    kind,
    grouping: "clustered",
    legend: undefined,
    categories: ["First", "Second", "Third", "Fourth"],
    valueAxis: { min: -2, max: 10, majorUnit: 2 },
    categoryAxisCrosses: { at: 5 },
    valueAxisCrosses: "autoZero",
    categoryAxisLineColor: catColor,
    categoryAxisLabelRotationDeg: 0,
    valueAxisLabelRotationDeg: 0,
    categoryAxisTickLabelPos: "none",
    dataLabels: { showValue: true, textStyle: { color: labels[0] } },
    series: [
      [-2, 0, 5, 8],
      [1, 2, 1, 3],
    ].map((values, i) => ({
      name: `Band ${i + 1}`,
      values,
      color: colors[i],
      lineColor: colors[i],
      invertIfNegative: false,
      markerSymbol: "none",
      ...(i
        ? { dataLabels: { showValue: true, textStyle: { color: labels[i] } } }
        : {}),
    })),
    ...overrides,
  });
}
function paint(f) {
  paintPlotGuides(f);
  const elements = [],
    svg = decodeURIComponent(
      preview(f.p, f.slide).split(",").slice(1).join(","),
    );
  walkElements(parseXml(svg).root, (e) => elements.push(e));
  const plot = elements.find(
    (e) => e.name.localName === "rect" && attr(e, "fill") === "#ECF5E9",
  );
  return {
    svg,
    elements,
    plot: Object.fromEntries(
      ["x", "y", "width", "height"].map((n) => [n, Number(attr(plot, n))]),
    ),
  };
}
function coordinate(r, spec, value) {
  const fraction =
    (value - spec.valueAxis.min) / (spec.valueAxis.max - spec.valueAxis.min);
  const projected =
    spec.valueAxisOrientation === "maxMin" ? 1 - fraction : fraction;
  return spec.kind === "bar"
    ? r.plot.x + projected * r.plot.width
    : r.plot.y + (1 - projected) * r.plot.height;
}
const bars = (r, color) =>
  r.elements.filter(
    (e) => e.name.localName === "rect" && attr(e, "fill") === color,
  );
const dataLabels = (r, color) =>
  r.elements.filter(
    (e) => e.name.localName === "text" && attr(e, "fill") === color,
  );
const pathPoints = (e) =>
  [...attr(e, "d").matchAll(/[-+]?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
const bound = (v, min, max) => Math.max(min, Math.min(max, v));

describe("category-axis crossing fill geometry (native reference)", () => {
  // Native controls establish that c:catAx's crossing positions its own
  // spine on the value scale. c:valAx's independent crossing cannot alter it.
  for (const kind of ["column", "bar"])
    for (const direction of ["minMax", "maxMin"])
      for (const crossing of [
        "autoZero",
        "min",
        "max",
        { at: 5 },
        { at: -50 },
        { at: 30 },
      ])
        it(`${kind} ${direction} anchors clustered bars at ${JSON.stringify(crossing)}`, () => {
          const f = fixture(kind, {
              categoryAxisCrosses: crossing,
              valueAxisOrientation: direction,
            }),
            spec = P.getShapeChartSpec(f.shape),
            r = paint(f);
          const value =
            crossing === "min"
              ? -2
              : crossing === "max"
                ? 10
                : typeof crossing === "object"
                  ? bound(crossing.at, -2, 10)
                  : 0;
          const base = coordinate(r, spec, value),
            vertical = kind !== "bar",
            coord = vertical ? "y" : "x",
            extent = vertical ? "height" : "width";
          const axis = r.elements.find(
            (e) =>
              e.name.localName === "line" &&
              attr(e, "stroke") === catColor &&
              attr(e, coord + "1") === attr(e, coord + "2"),
          );
          expect(Number(attr(axis, coord + "1"))).toBeCloseTo(base, 1);
          for (const [i, s] of spec.series.entries()) {
            const visible = s.values.filter((v) => v !== value),
              shapes = bars(r, colors[i]);
            expect(shapes).toHaveLength(visible.length);
            visible.forEach((v, c) => {
              const tip = coordinate(r, spec, v);
              expect(Number(attr(shapes[c], coord))).toBeCloseTo(
                Math.min(tip, base),
                1,
              );
              expect(Number(attr(shapes[c], extent))).toBeCloseTo(
                Math.abs(tip - base),
                1,
              );
            });
            expect(dataLabels(r, labels[i]).map(text)).toEqual(
              s.values.map(String),
            );
          }
          // Data remains absolute, including values below a custom baseline.
          expect(spec.series.map((s) => s.values)).toEqual([
            [-2, 0, 5, 8],
            [1, 2, 1, 3],
          ]);
        });
  for (const kind of ["column", "bar"])
    for (const direction of ["minMax", "maxMin"])
      for (const position of ["ctr", "inEnd", "outEnd", "inBase"])
        it(`${kind} ${direction} places ${position} labels relative to the custom base`, () => {
          const f = fixture(kind, {
              valueAxisOrientation: direction,
              dataLabels: {
                showValue: true,
                position,
                textStyle: { color: labels[0] },
              },
              series: [
                {
                  name: "Values",
                  values: [0, 8],
                  color: colors[0],
                  invertIfNegative: false,
                },
              ],
            }),
            r = paint(f),
            spec = P.getShapeChartSpec(f.shape);
          const b = coordinate(r, spec, 5),
            coord = kind === "bar" ? "x" : "y",
            ls = dataLabels(r, labels[0]);
          expect(ls).toHaveLength(2);
          for (const [i, v] of [0, 8].entries()) {
            const tip = coordinate(r, spec, v),
              low = Math.min(tip, b),
              high = Math.max(tip, b),
              actual = Number(attr(ls[i], coord));
            if (position === "ctr")
              expect(actual).toBeCloseTo(
                (low + high) / 2 + (kind === "bar" ? 0 : 3),
                1,
              );
            else if (position === "outEnd")
              expect((actual - tip) * Math.sign(tip - b)).toBeGreaterThan(0);
            else {
              expect(actual).toBeGreaterThan(low);
              expect(actual).toBeLessThan(high);
              expect(
                Math.abs(actual - (position === "inEnd" ? tip : b)),
              ).toBeLessThan(Math.abs(tip - b) / 2);
            }
          }
        });
  for (const kind of ["column", "bar", "area"])
    for (const direction of ["minMax", "maxMin"])
      for (const bounds of [
        { min: 2, max: 10 },
        { min: -10, max: -2 },
      ])
        it(`${kind} ${direction} bounds automatic zero at ${bounds.min}..${bounds.max}`, () => {
          const values = bounds.min > 0 ? [3, 4, 5] : [-3, -4, -5];
          const f = fixture(kind, {
              categoryAxisCrosses: "autoZero",
              valueAxis: bounds,
              valueAxisOrientation: direction,
              series: [
                {
                  name: "Values",
                  values,
                  color: colors[0],
                  lineColor: colors[0],
                },
              ],
            }),
            r = paint(f),
            spec = P.getShapeChartSpec(f.shape),
            base = coordinate(r, spec, bound(0, bounds.min, bounds.max));
          if (kind === "area") {
            const path = r.elements.find(
                (e) =>
                  e.name.localName === "path" && attr(e, "fill") === colors[0],
              ),
              points = pathPoints(path);
            for (let i = 7; i < points.length; i += 2)
              expect(points[i]).toBeCloseTo(base, 1);
          } else
            for (const bar of bars(r, colors[0])) {
              const start = Number(attr(bar, kind === "bar" ? "x" : "y")),
                end =
                  start +
                  Number(attr(bar, kind === "bar" ? "width" : "height"));
              // Origin, span and crossing each round to 0.01 SVG pixels.
              expect(
                Math.min(Math.abs(start - base), Math.abs(end - base)),
              ).toBeLessThan(0.015);
            }
        });
  for (const kind of ["column", "bar", "area", "line"])
    it(`${kind} keeps fill and data geometry independent of value-axis crossings`, () => {
      const f = fixture(kind),
        before = paint(f),
        chart = P.getSlideCharts(f.slide)[0];
      // Moving axis labels can legitimately change automatic plot gutters.
      // The data projection within that plot remains independent of the value
      // axis crossing; compare normalized vertices rather than page pixels.
      const data = (r) =>
        r.elements
          .filter(
            (e) =>
              ["rect", "path"].includes(e.name.localName) &&
              colors.some((c) =>
                [attr(e, "fill"), attr(e, "stroke")].includes(c),
              ),
          )
          .map((e) => {
            const points =
              e.name.localName === "path"
                ? pathPoints(e)
                : [
                    Number(attr(e, "x")),
                    Number(attr(e, "y")),
                    Number(attr(e, "x")) + Number(attr(e, "width")),
                    Number(attr(e, "y")) + Number(attr(e, "height")),
                  ];
            return points.map(
              (v, i) =>
                (v - r.plot[i % 2 ? "y" : "x"]) /
                r.plot[i % 2 ? "height" : "width"],
            );
          });
      for (const crossing of ["min", "max", { at: 2 }]) {
        P.setChartSpec(chart, { ...chart.spec, valueAxisCrosses: crossing });
        const actual = data(paint(f)),
          expected = data(before);
        expect(actual).toHaveLength(expected.length);
        actual.forEach((points, i) => {
          expect(points).toHaveLength(expected[i].length);
          points.forEach((value, j) =>
            expect(value).toBeCloseTo(expected[i][j], 4),
          );
        });
      }
    });
  for (const kind of ["column", "bar"])
    for (const grouping of ["stacked", "percentStacked"])
      for (const direction of ["minMax", "maxMin"])
        it(`${kind} ${grouping} ${direction} keeps cumulative bar bases independent`, () => {
          const f = fixture(kind, {
              grouping,
              valueAxisOrientation: direction,
              valueAxis: {
                min: 0,
                max: grouping === "percentStacked" ? 1 : 12,
              },
              series: [
                [2, 4, 3, 5],
                [1, 2, 1, 3],
              ].map((values, i) => ({
                name: `Band ${i}`,
                // Crossing changes paint unless inversion is explicitly off.
                invertIfNegative: false,
                values,
                color: colors[i],
              })),
            }),
            before = paint(f),
            chart = P.getSlideCharts(f.slide)[0];
          P.setChartSpec(chart, { ...chart.spec, categoryAxisCrosses: "max" });
          for (const color of colors)
            expect(bars(paint(f), color)).toEqual(bars(before, color));
        });
  for (const grouping of ["clustered", "stacked", "percentStacked"])
    for (const direction of ["minMax", "maxMin"])
      for (const categoryDirection of ["minMax", "maxMin"])
        it(`${grouping} area ${direction}/${categoryDirection} returns only the first cumulative band to the crossing`, () => {
          const percent = grouping === "percentStacked",
            stacked = grouping !== "clustered",
            values = [
              [2, 4, 3, 5],
              [1, 2, 1, 3],
            ],
            cross = percent ? 0.5 : 5;
          const f = fixture("area", {
              grouping,
              valueAxis: { min: 0, max: percent ? 1 : 12 },
              categoryAxisCrosses: { at: cross },
              valueAxisOrientation: direction,
              categoryAxisOrientation: categoryDirection,
              series: values.map((v, i) => ({
                name: `Band ${i}`,
                values: v,
                color: colors[i],
                lineColor: colors[i],
                dataLabels: {
                  showValue: true,
                  textStyle: { color: labels[i] },
                },
              })),
            }),
            r = paint(f),
            spec = P.getShapeChartSpec(f.shape);
          for (const [s, vs] of values.entries()) {
            const path = r.elements.find(
                (e) =>
                  e.name.localName === "path" && attr(e, "fill") === colors[s],
              ),
              pts = pathPoints(path),
              ls = dataLabels(r, labels[s]);
            expect(pts).toHaveLength(16);
            for (let c = 0; c < 4; c++) {
              const total = percent ? values[0][c] + values[1][c] : 1,
                previous = stacked && s ? values[0][c] / total : 0;
              const top = previous + vs[c] / total,
                base = stacked && s ? previous : cross;
              expect(pts[c * 2 + 1]).toBeCloseTo(coordinate(r, spec, top), 1);
              expect(pts[(7 - c) * 2 + 1]).toBeCloseTo(
                coordinate(r, spec, base),
                1,
              );
              expect(Number(attr(ls[c], "y"))).toBeCloseTo(
                (coordinate(r, spec, top) + coordinate(r, spec, base)) / 2 + 3,
                1,
              );
            }
          }
        });
  for (const direction of ["minMax", "maxMin"])
    for (const spacing of ["between", "midCat"])
      it(`line drop guides ${direction}/${spacing} end at the category crossing without moving the line`, () => {
        const f = fixture("line", {
            dropLines: true,
            valueAxisCrossBetween: spacing,
            valueAxisOrientation: direction,
          }),
          before = paint(f),
          chart = P.getSlideCharts(f.slide)[0];
        const guides = (r) =>
            r.elements.filter(
              (e) =>
                e.name.localName === "line" && attr(e, "stroke") === "#9CA3AF",
            ),
          paths = (r) =>
            r.elements.filter(
              (e) =>
                e.name.localName === "path" &&
                colors.includes(attr(e, "stroke")),
            );
        expect(guides(before)).toHaveLength(4);
        for (const crossing of ["min", "max", { at: 3 }]) {
          P.setChartSpec(chart, {
            ...chart.spec,
            categoryAxisCrosses: crossing,
          });
          const r = paint(f),
            spec = chart.spec,
            base = crossing === "min" ? -2 : crossing === "max" ? 10 : 3;
          expect(paths(r)).toEqual(paths(before));
          guides(r).forEach((guide, c) => {
            const values = spec.series.map((s) => s.values[c]);
            const expected = [
              Math.min(base, ...values),
              Math.max(base, ...values),
            ]
              .map((v) => coordinate(r, spec, v))
              .sort((a, b) => a - b);
            expect(Number(attr(guide, "y1"))).toBeCloseTo(expected[0], 1);
            expect(Number(attr(guide, "y2"))).toBeCloseTo(expected[1], 1);
          });
        }
      });
  it("projects primary and secondary fill baselines on their own scales", () => {
    const f = fixture("column", {
        valueAxis: { min: 0, max: 10 },
        categoryAxisCrosses: { at: 3 },
        secondaryCategoryAxisCrosses: { at: 25 },
        series: [
          {
            name: "Primary",
            values: [2, 4, 3],
            color: colors[0],
            invertIfNegative: false,
          },
          {
            name: "Secondary",
            values: [20, 50, 30],
            color: colors[1],
            lineColor: colors[1],
            chartKind: "area",
            secondaryAxis: true,
          },
        ],
      }),
      r = paint(f),
      spec = P.getShapeChartSpec(f.shape);
    for (const bar of bars(r, colors[0])) {
      const start = Number(attr(bar, "y")),
        end = start + Number(attr(bar, "height"));
      expect(
        Math.min(
          Math.abs(start - coordinate(r, spec, 3)),
          Math.abs(end - coordinate(r, spec, 3)),
        ),
      ).toBeLessThan(0.01);
    }
    const path = r.elements.find(
        (e) => e.name.localName === "path" && attr(e, "fill") === colors[1],
      ),
      pts = pathPoints(path);
    // The secondary auto scale is read from its rendered numeric tick labels.
    // The secondary data at20/50 defines two known coordinates on that scale.
    const yAt25 = pts[1] + ((pts[3] - pts[1]) * (25 - 20)) / (50 - 20);
    for (let i = 7; i < pts.length; i += 2)
      expect(pts[i]).toBeCloseTo(yAt25, 1);
  });
  for (const kind of ["column", "bar", "line", "area"])
    it(`${kind} preserves editable baselines through transfer both ways, export and copy edits`, async () => {
      const f = fixture(kind),
        original = P.getShapeChartSpec(f.shape),
        raw = P._internalPackageOf(f.p)
          .getPart(chartRoot(f.shape))
          .data.slice(),
        book = workbook(f.p, f.shape).data.slice(),
        originalSvg = preview(f.p, f.slide),
        q = createDeck("blank"),
        to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
        back = P.importSlide(f.p, to, P.getSlideLayout(f.slide));
      for (const slide of [to, back])
        expect(P.getSlideCharts(slide)[0].spec).toEqual(original);
      const chart = P.getSlideCharts(back)[0];
      P.setChartSpec(chart, {
        ...chart.spec,
        categoryAxisCrosses: { at: 6.25 },
        series: chart.spec.series.map((s) => ({
          ...s,
          values: s.values.map((v) => v + 0.25),
        })),
      });
      const reopened = await P.loadPresentation(await P.savePresentation(f.p)),
        copy = P.getSlideCharts(P.getSlides(reopened).at(-1))[0];
      expect(copy.spec.categoryAxisCrosses).toEqual({ at: 6.25 });
      expect(copy.spec.series[0].values).toEqual([-1.75, 0.25, 5.25, 8.25]);
      expect(P.validatePresentation(reopened)).toEqual([]);
      expect(P.getShapeChartSpec(f.shape)).toEqual(original);
      expect(
        P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
      ).toEqual(raw);
      expect(workbook(f.p, f.shape).data).toEqual(book);
      expect(preview(f.p, f.slide)).toBe(originalSvg);
    });
});
