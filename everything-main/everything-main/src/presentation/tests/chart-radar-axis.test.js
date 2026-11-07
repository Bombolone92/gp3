import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  chartRoot,
  workbook,
  chartLegendLayoutDeck,
} from "./chart-copy-fixture.js";
import { chartRadarLabelDeck } from "./chart-radar-label-fixture.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

import {
  chartRadarAxisDeck,
  radarAxisCases,
  radarAxisColor as color,
} from "./chart-radar-axis-fixture.js";
const attr = (e, name) => getAttrValue(e, qname("", name, ""));
function paint(p, slide) {
  const nodes = [];
  walkElements(
    parseXml(
      decodeURIComponent(preview(p, slide).split(",").slice(1).join(",")),
    ).root,
    (e) => nodes.push(e),
  );
  const lastData = nodes.findLastIndex(
    (e) =>
      e.name.localName === "polygon" &&
      (attr(e, "fill") === "#E85239" || attr(e, "stroke") === "#E85239"),
  );
  const texts = nodes.flatMap((e, i) =>
    e.name.localName === "text" && [color, "#604020"].includes(attr(e, "fill"))
      ? [i]
      : [],
  );
  return {
    allRadarTextAboveData:
      lastData >= 0 && texts.length >= 4 && texts.every((i) => i > lastData),
    labels: nodes
      .filter((e) => e.name.localName === "text" && attr(e, "fill") === color)
      .map((e) => ({
        text: e.children
          .filter((c) => c.kind === "text")
          .map((c) => c.data)
          .join(""),
        y: Number(attr(e, "y")),
      })),
    // A native radar ring consists of one independently stroked edge per
    // category. These numeric-axis controls explicitly author four categories.
    rings: nodes
      .filter(
        (e) => e.name.localName === "line" && attr(e, "stroke") === "#E5E7EB",
      )
      .filter((_, i) => i % 4 === 0)
      .map((e) => Number(attr(e, "y1"))),
  };
}

describe("radar value-axis major tick semantics", () => {
  for (const radarStyle of ["standard", "marker", "filled"])
    for (const c of radarAxisCases)
      it(`${radarStyle} retains ${c.name} through transfer and export`, async () => {
        const f = chartRadarAxisDeck(c, radarStyle);
        const spec = P.getShapeChartSpec(f.shape),
          chart = P._internalPackageOf(f.p)
            .getPart(chartRoot(f.shape))
            .data.slice(),
          book = workbook(f.p, f.shape).data.slice();
        const r = paint(f.p, f.slide);
        expect(r.labels.map((l) => l.text)).toEqual(c.labels);
        expect(r.rings).toHaveLength(c.ticks.length - 1);
        if (r.labels.length) {
          // The axis minimum is a real center label, without a degenerate ring.
          expect(r.rings).toEqual(r.labels.slice(1).map((l) => l.y));
          if (r.labels.length > 1) {
            const first = r.labels[0].y,
              last = r.labels.at(-1).y;
            const lastTick = c.ticks.at(-1);
            // SVG coordinates round independently to 0.01px.
            r.labels.forEach((l, i) =>
              expect(
                Math.abs(
                  l.y -
                    (first -
                      ((first - last) * (c.ticks[i] - c.axis.min)) /
                        (lastTick - c.axis.min)),
                ),
              ).toBeLessThanOrEqual(0.01),
            );
          }
        }
        expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
        expect(
          P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
        ).toEqual(chart);
        expect(workbook(f.p, f.shape).data).toEqual(book);
        const target = createDeck("blank"),
          slide = P.importSlide(target, f.slide, P.getSlideLayouts(target)[0], {
            preservePaintFormatting: true,
            preserveTextFormatting: true,
          }),
          copied = P.getSlideCharts(slide)[0];
        expect(copied.spec).toEqual(spec);
        expect(workbook(target, copied.shape).data).toEqual(book);
        expect(paint(target, slide)).toEqual(r);
        const round = await P.loadPresentation(
            await P.savePresentation(target),
          ),
          reloaded = P.getSlides(round).at(-1),
          saved = P.getSlideCharts(reloaded)[0];
        expect(saved.spec).toEqual(spec);
        expect(workbook(round, saved.shape).data).toEqual(book);
        expect(preview(round, reloaded)).toBe(preview(target, slide));
        expect(P.validatePresentation(round)).toEqual([]);
      });

  for (const radarStyle of ["standard", "marker", "filled"])
    it(`${radarStyle} keeps category and value labels above radar data`, () => {
      const f = chartRadarAxisDeck(radarAxisCases[0], radarStyle),
        r = paint(f.p, f.slide);
      expect(r.labels).toHaveLength(5);
      expect(r.allRadarTextAboveData).toBe(true);
    });

  for (const radarStyle of ["standard", "marker", "filled"])
    for (const [min, max, majorUnit, count] of [
      [0, 1, 1 / 251, 251],
      [0, 1, 1 / 500, 500],
      [-3, 5, 8 / 501, 500],
      [2, 2.5, 0.5 / 10000, 500],
      [0, 3e-10, Number.MIN_VALUE, 500],
    ])
      it(`${radarStyle} fits ${min}..${max} with unit ${majorUnit} to ${count} intervals`, () => {
        const c = {
            axis: {
              min,
              max,
              majorUnit,
              numberFormat: "0.0000",
              numberFormatSourceLinked: false,
            },
          },
          f = chartRadarAxisDeck(c, radarStyle),
          spec = P.getShapeChartSpec(f.shape),
          r = paint(f.p, f.slide);
        expect(r.labels).toHaveLength(count + 1);
        expect(r.rings).toHaveLength(count);
        expect(new Set(r.labels.map((l) => l.y)).size).toBe(count + 1);
        expect(r.rings).toEqual(r.labels.slice(1).map((l) => l.y));
        expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
        expect(spec.valueAxis.majorUnit).toBe(majorUnit);
      });

  it("retains distinct radii when an authored unit is below the minimum's ULP", () => {
    const f = chartRadarAxisDeck({
        axis: { min: 1e12, max: 1e12 + 0.0001220703125, majorUnit: 0.00002 },
      }),
      r = paint(f.p, f.slide);
    expect(r.labels).toHaveLength(7);
    expect(new Set(r.labels.map((l) => l.y)).size).toBe(7);
    expect(r.rings).toEqual(r.labels.slice(1).map((l) => l.y));
  });

  for (const radarStyle of ["standard", "marker", "filled"])
    it(`${radarStyle} hides deleted-axis labels while retaining grid geometry`, () => {
      const options = {
        radarStyle,
        valueAxis: { min: 0, max: 8, majorUnit: 2 },
        valueAxisMajorGridlines: true,
        valueAxisMajorGridlineColor: "#E5E7EB",
        valueAxisLabelStyle: { color },
      };
      const control = chartRadarLabelDeck(options),
        visible = paint(control.p, control.slide);
      const f = chartRadarLabelDeck({ ...options, valueAxisHidden: true }),
        r = paint(f.p, f.slide);
      expect(r.labels).toEqual([]);
      // Deleting the axis does not delete its independently retained gridlines.
      expect(r.rings).toEqual(visible.rings);
    });

  for (const majorUnit of [undefined, 0, -2])
    it(`retains automatic spacing for ${majorUnit} units`, () => {
      const f = chartRadarLabelDeck({
        valueAxis: { min: 0, max: 8, majorUnit },
        valueAxisMajorGridlines: true,
        valueAxisMajorGridlineColor: "#E5E7EB",
        valueAxisLabelStyle: { color },
      });
      const r = paint(f.p, f.slide);
      expect(r.labels.map((l) => l.text)).toEqual(["0", "2", "4", "6", "8"]);
      expect(r.rings).toHaveLength(4);
    });
});

// Prefix affixes share the ordinary numeric sign, including quoted currency.
// Native output emits -$3.00, rather than $-3.00, for a single-section code.
describe("axis format prefix signs", () => {
  for (const kind of ["bar", "column", "line", "area"])
    for (const [numberFormat, expected] of [
      ['"$"0.00', "-$3.00"],
      ["€0.0", "-€3.0"],
      ['"$"0.0%', "-$300.0%"],
    ])
      it(`${kind} places a negative sign before ${numberFormat}`, () => {
        const f = chartLegendLayoutDeck({
          kind,
          legend: undefined,
          valueAxis: {
            min: -3,
            max: 5,
            majorUnit: 2,
            numberFormat,
            numberFormatSourceLinked: false,
          },
          valueAxisLabelStyle: { font: "Arial", sizePt: 12, color },
        });
        expect(paint(f.p, f.slide).labels.map((l) => l.text)).toContain(
          expected,
        );
      });
});
