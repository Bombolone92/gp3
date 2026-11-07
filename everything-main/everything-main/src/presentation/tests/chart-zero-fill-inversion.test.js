import { expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { chartRenderingView } from "../lib/pptx/src/api/fn/charts.ts";
import { chartZeroFillInversionDeck } from "./chart-zero-fill-inversion-fixture.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  walkElements,
  getAttrValue,
  firstChildElement,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { nativeChartSeriesHosts } from "../lib/pptx/src/internal/chartml/native-data.ts";
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const child = (e, n, ns = NS.chart) =>
  e && firstChildElement(e, qname("", n, ns));
function paint(f) {
  const svg = renderSlideToSvg(f.p, f.slide, { stableDefinitionIds: true }),
    bars = [];
  walkElements(parseXml(svg).root, (e) => {
    if (e.name.localName === "rect" && attr(e, "clip-path")) bars.push(e);
  });
  expect(bars).toHaveLength(3);
  return {
    svg,
    bars,
    black: bars.filter((e) => attr(e, "stroke") === "#000000"),
  };
}
for (const kind of ["bar", "column"])
  for (const negativeColor of [undefined, "#FFFFFF", "#00AA77"])
    for (const outline of ["none", "absent", "blue"])
      for (const opacity of [0, 0.35, 1])
        it(`${kind} ${negativeColor ?? "legacy"} alpha ${opacity} respects ${outline} outline and native inversion paint`, () => {
          const f = chartZeroFillInversionDeck({
              kind,
              negativeColor,
              outline,
              opacity,
            }),
            { bars, black, svg } = paint(f);
          const autoWhite =
            negativeColor === undefined ||
            (negativeColor === "#FFFFFF" && opacity !== 0);
          expect(black).toHaveLength(outline === "blue" || !autoWhite ? 0 : 2);
          for (const bar of bars) {
            expect(Number(attr(bar, "fill-opacity") ?? 1)).toBe(opacity);
            if (outline === "blue") {
              expect(attr(bar, "stroke")).toBe("#316BB0");
              expect(attr(bar, "stroke-opacity")).toBe("0.7");
            }
          }
          expect(chartRenderingView(f.shape).seriesOpacities[0].fill).toBe(
            opacity,
          );
          expect(P.getShapeChartSpec(f.shape).series[0].negativeColor).toBe(
            negativeColor,
          );
          expect(svg).not.toMatch(/NaN|Infinity/);
        });
for (const kind of ["bar", "column"])
  for (const negativeColor of ["#FFFFFF", "#00AA77"])
    for (const pointOpacity of [0, 0.25, 1])
      for (const pointIndex of [0, 1])
        it(`${kind} point ${pointIndex} alpha ${pointOpacity} keeps its own inversion outline over transparent ${negativeColor} series`, () => {
          const f = chartZeroFillInversionDeck({
              kind,
              negativeColor,
              pointOpacity,
              pointIndex,
            }),
            { bars, black } = paint(f);
          expect(black).toHaveLength(pointIndex === 0 ? 1 : 0);
          expect(Number(attr(bars[pointIndex], "fill-opacity") ?? 1)).toBe(
            pointOpacity,
          );
          for (const [i, bar] of bars.entries())
            if (i !== pointIndex) expect(attr(bar, "fill-opacity")).toBe("0");
          if (pointIndex === 0) {
            expect(attr(black[0], "fill")).toBe("#FFFFFF");
            expect(attr(black[0], "stroke-opacity")).toBeNull();
          }
        });
for (const kind of ["bar", "column"])
  for (const negativeColor of [undefined, "#FFFFFF"])
    it(`${kind} ${negativeColor ?? "legacy"} alpha-zero paint stays editable through transfer and save`, async () => {
      const f = chartZeroFillInversionDeck({ kind, negativeColor }),
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
for (const kind of ["bar", "column"])
  it(`${kind} independent data/title edits preserve zero alpha and explicit inversion edits switch native outline modes`, () => {
    const f = chartZeroFillInversionDeck({ kind }),
      spec = P.getShapeChartSpec(f.shape);
    expect(paint(f).black).toHaveLength(2);
    P.setChartSpec(P.getSlideCharts(f.slide)[0], {
      ...spec,
      title: "Edited",
      series: spec.series.map((s) => ({
        ...s,
        negativeColor: "#FFFFFF",
        values: [-3, 5, -4],
      })),
    });
    expect(paint(f).black).toHaveLength(0);
    expect(chartRenderingView(f.shape).seriesOpacities[0].fill).toBe(0);
    const chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, {
      ...chart.spec,
      series: chart.spec.series.map((s) => ({
        ...s,
        negativeColor: undefined,
      })),
    });
    expect(paint(f).black).toHaveLength(2);
    expect(chartRenderingView(f.shape).seriesOpacities[0].fill).toBe(0);
  });
for (const kind of ["bar", "column"])
  for (const crossing of ["min", "max", { at: 2 }])
    for (const orientation of ["minMax", "maxMin"])
      it(`${kind} ${JSON.stringify(crossing)} ${orientation} transparent explicit inversion does not invent outlines`, () => {
        const f = chartZeroFillInversionDeck({
          kind,
          negativeColor: "#FFFFFF",
          categoryAxisCrosses: crossing,
          valueAxisOrientation: orientation,
        });
        expect(paint(f).black).toHaveLength(0);
      });
it("ordered DrawingML alpha transforms resolving to zero use the same native inversion paint rule", () => {
  const f = chartZeroFillInversionDeck({
      negativeColor: "#FFFFFF",
      opacity: 0.35,
    }),
    part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data)),
    series = nativeChartSeriesHosts(doc.root)[0].series,
    color = child(child(series, "spPr"), "solidFill", NS.dml).children[0];
  color.children = parseXml(
    `<r xmlns:a="${NS.dml}"><a:alpha val="50000"/><a:alphaMod val="0"/></r>`,
  ).root.children;
  part.data = new TextEncoder().encode(serializeXml(doc));
  expect(paint(f).black).toHaveLength(0);
  expect(chartRenderingView(f.shape).seriesOpacities[0].fill).toBe(0);
});
