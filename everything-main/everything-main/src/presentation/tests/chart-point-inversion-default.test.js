import { expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { chartRenderingView } from "../lib/pptx/src/api/fn/charts.ts";
import { chartPointInversionDefaultDeck } from "./chart-point-inversion-default-fixture.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
function paint(f) {
  const svg = renderSlideToSvg(f.p, f.slide, { stableDefinitionIds: true }),
    bars = [];
  walkElements(parseXml(svg).root, (e) => {
    if (e.name.localName === "rect" && attr(e, "clip-path")) bars.push(e);
  });
  expect(bars).toHaveLength(3);
  return { svg, bars };
}
for (const kind of ["bar", "column"])
  for (const format of ["solid", "idx"])
    it(`${kind} ${format} data/title edits preserve the native point default`, () => {
      const f = chartPointInversionDefaultDeck({ kind, format }),
        chart = P.getSlideCharts(f.slide)[0];
      P.setChartSpec(chart, {
        ...chart.spec,
        title: "Changed values",
        series: chart.spec.series.map((series) => ({
          ...series,
          values: [-3, 5, -4],
        })),
      });
      expect(paint(f).bars.map((e) => attr(e, "fill") === "#FFFFFF")).toEqual([
        true,
        false,
        false,
      ]);
      const updated = P.getShapeChartSpec(f.shape);
      expect(updated.title).toBe("Changed values");
      expect(updated.series[0].values).toEqual([-3, 5, -4]);
      expect(updated.series[0].pointInvertIfNegative).toBeUndefined();
      P.setChartSpec(P.getSlideCharts(f.slide)[0], {
        ...updated,
        series: updated.series.map((series) => ({
          ...series,
          values: [3, 5, -4],
        })),
      });
      expect(paint(f).bars.some((e) => attr(e, "fill") === "#FFFFFF")).toBe(
        false,
      );
    });
for (const kind of ["bar", "column"])
  for (const inversion of [false, true])
    for (const format of ["solid", "idx", "empty", "outline"])
      for (const pointSwitch of [undefined, false, true])
        it(`${kind} ${format} point switch ${pointSwitch} is independent of series ${inversion}`, () => {
          const f = chartPointInversionDefaultDeck({
              kind,
              format,
              inversion,
              pointSwitch,
            }),
            before = P.getShapeChartSpec(f.shape),
            { bars } = paint(f);
          expect(attr(bars[0], "fill") === "#FFFFFF").toBe(
            pointSwitch !== false,
          );
          expect(attr(bars[2], "fill") === "#FFFFFF").toBe(inversion);
          expect(attr(bars[1], "fill")).toBe("#E85239");
          expect(before.series[0].pointInvertIfNegative?.[0]).toBe(pointSwitch);
          expect(P.getShapeChartSpec(f.shape)).toEqual(before);
        });
for (const kind of ["bar", "column"])
  for (const inversion of [false, true])
    it(`${kind} a point with no native record still inherits series ${inversion}`, () => {
      const f = chartPointInversionDefaultDeck({
        kind,
        inversion,
        format: "absent",
      });
      expect(
        paint(f).bars.filter((e) => attr(e, "fill") === "#FFFFFF"),
      ).toHaveLength(inversion ? 2 : 0);
      expect(
        chartRenderingView(f.shape).seriesDisplays[0].pointInversionDefaults,
      ).toBeUndefined();
    });
for (const kind of ["bar", "column"])
  for (const grouping of ["clustered", "stacked", "percentStacked"])
    for (const direction of ["minMax", "maxMin"])
      it(`${kind} ${grouping} ${direction} uses the raw crossing for a defaulted point`, () => {
        const f = chartPointInversionDefaultDeck({
          kind,
          grouping,
          valueAxisOrientation: direction,
          categoryAxisCrosses: { at: 5 },
          valueAxis:
            grouping === "percentStacked"
              ? { min: -1, max: 1, majorUnit: 0.5 }
              : { min: -6, max: 6, majorUnit: 2 },
        });
        expect(paint(f).bars.map((e) => attr(e, "fill") === "#FFFFFF")).toEqual(
          [true, false, false],
        );
      });
for (const pointIndex of [-1, "1.5", "invalid", 4294967296])
  it(`ignores invalid native point index ${pointIndex} without inventing inversion defaults`, () => {
    const f = chartPointInversionDefaultDeck({ pointIndex, format: "idx" });
    expect(
      chartRenderingView(f.shape).seriesDisplays[0].pointInversionDefaults,
    ).toBeUndefined();
    expect(paint(f).bars.every((e) => attr(e, "fill") === "#E85239")).toBe(
      true,
    );
  });
it("native sparse indices remain a bounded set without dense allocation", () => {
  const f = chartPointInversionDefaultDeck({
    pointIndex: 4294967295,
    format: "idx",
  });
  expect([
    ...chartRenderingView(f.shape).seriesDisplays[0].pointInversionDefaults,
  ]).toEqual([4294967295]);
  expect(paint(f).bars.every((e) => attr(e, "fill") === "#E85239")).toBe(true);
});
for (const kind of ["bar", "column"])
  for (const format of ["solid", "idx"])
    it(`${kind} ${format} defaults survive transfer and save without authoring a switch`, async () => {
      const f = chartPointInversionDefaultDeck({ kind, format }),
        spec = P.getShapeChartSpec(f.shape),
        raw = P._internalPackageOf(f.p)
          .getPart(chartRoot(f.shape))
          .data.slice(),
        book = workbook(f.p, f.shape).data.slice(),
        q = createDeck("blank"),
        slide = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
        before = renderSlideToSvg(q, slide, { stableDefinitionIds: true }),
        saved = await P.loadPresentation(await P.savePresentation(q)),
        s = P.getSlides(saved).at(-1),
        chart = P.getSlideCharts(s)[0];
      expect(chart.spec).toEqual(spec);
      expect(
        P._internalPackageOf(saved).getPart(chartRoot(chart.shape)).data,
      ).toEqual(raw);
      expect(workbook(saved, chart.shape).data).toEqual(book);
      expect(renderSlideToSvg(saved, s, { stableDefinitionIds: true })).toBe(
        before,
      );
      expect(P.validatePresentation(saved)).toEqual([]);
    });
