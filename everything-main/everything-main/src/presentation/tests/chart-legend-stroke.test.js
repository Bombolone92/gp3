import { describe, expect, it } from "vitest";
import { P, createDeck, parseDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  getAttrValue,
  parseXml,
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
import {
  chartLegendLayoutDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";

const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const outline = "#B63874";
function fixture({
  kind = "column",
  sizePt = 18,
  font = "Arial",
  position = "b",
  widthPt = 72,
  lineDash,
} = {}) {
  return chartLegendLayoutDeck({
    kind,
    sizePt,
    legend: { position, textStyle: { font, sizePt }, fill: "#FFF0D1" },
    series: [
      {
        name: "Units",
        values: [1, 2, 4, 3],
        color: "#E85239",
        lineColor: outline,
        lineWidthEmu: widthPt * 12700,
        markerSymbol: "none",
        ...(lineDash ? { lineDash } : {}),
      },
    ],
  });
}
function rendered(f, p = f.p, slide = f.slide) {
  const nodes = [];
  walkElements(
    parseXml(
      renderSlideToSvg(p, slide, {
        measureText: (text, font) => ({
          widthPx: (text.length * font.sizePx) / 2,
          ascentPx: font.sizePx * 0.8,
          descentPx: font.sizePx * 0.3171875,
        }),
      }),
    ).root,
    (e) => nodes.push(e),
  );
  const strokes = nodes.filter((e) => attr(e, "stroke") === outline);
  return { key: strokes.at(-1), plot: strokes.slice(0, -1), nodes };
}
function expectWidths(f, keyPt, plotPt = 72, p, slide) {
  const r = rendered(f, p, slide);
  expect(+attr(r.key, "stroke-width")).toBeCloseTo((keyPt * 4) / 3, 10);
  expect(r.plot.length).toBeGreaterThan(0);
  for (const e of r.plot)
    expect(+attr(e, "stroke-width")).toBeCloseTo((plotPt * 4) / 3, 10);
  return r;
}

describe("native legend series outline caps", () => {
  // Expected limits come from native PDF vector paint, independently of the
  // square body's font metrics. The plot retains the authored 72pt outline.
  for (const font of ["Arial", "Times New Roman", "Courier New", "Verdana"])
    for (const kind of ["column", "line"])
      for (const [sizePt, keyPt] of [
        [4, 1],
        [9, 3.5],
        [18, 8],
        [32, 15],
      ])
        it(`${font} ${sizePt}pt ${kind} caps only legend paint at ${keyPt}pt`, () => {
          const f = fixture({ font, kind, sizePt });
          const spec = P.getShapeChartSpec(f.shape),
            chart = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
            bytes = chart.data.slice(),
            book = workbook(f.p, f.shape).data.slice();
          expectWidths(f, keyPt);
          expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
          expect(chart.data).toEqual(bytes);
          expect(workbook(f.p, f.shape).data).toEqual(book);
        });

  for (const kind of ["column", "line"])
    for (const [sizePt, keyPt] of [
      [1, 1],
      [2.5, 1],
      [3.9, 1],
      [4.97, 1],
      [4.98, 1.5],
      [9.97, 3.5],
      [9.98, 4],
      [10.97, 4],
      [10.98, 4.5],
      [32.97, 15],
      [32.98, 15.5],
    ])
      it(`${kind} ${sizePt}pt uses the native font conversion boundary`, () => {
        expectWidths(fixture({ kind, sizePt }), keyPt);
      });

  for (const kind of ["column", "line"])
    for (const [widthPt, keyPt] of [
      [0, 0],
      [0.5, 0.5],
      [1, 1],
      [3, 3],
      [3.5, 3.5],
      [4, 3.5],
      [7.5, 3.5],
    ])
      it(`${kind} preserves ${widthPt}pt strokes below the 9pt-font cap`, () => {
        expectWidths(fixture({ kind, sizePt: 9, widthPt }), keyPt, widthPt);
      });

  for (const position of ["b", "t", "r", "l", "tr"])
    for (const kind of ["column", "line"])
      it(`${position} ${kind} shares its capped outline with measurement`, () => {
        const f = fixture({ position, kind, sizePt: 4 });
        const r = expectWidths(f, 1),
          box = r.nodes.find((e) => attr(e, "fill") === "#FFF0D1");
        expect(+attr(box, "height")).toBeLessThan(20);
      });

  it("scales legend dash lengths with the effective key stroke", () => {
    const r = expectWidths(
      fixture({ kind: "line", sizePt: 9, lineDash: "dash" }),
      3.5,
    );
    const dash = attr(r.key, "stroke-dasharray").split(" ").map(Number);
    expect(dash[0]).toBeCloseTo(56 / 3, 10);
    expect(dash[1]).toBeCloseTo(14, 10);
    expect(attr(r.plot[0], "stroke-dasharray").split(" ").map(Number)).toEqual([
      384, 288,
    ]);
  });

  it("retains authored strokes and independent font/data edits through transfer both ways and reimport", async () => {
    const f = fixture(),
      dest = createDeck("blank"),
      imported = P.importSlide(dest, f.slide, P.getSlideLayouts(dest)[0]),
      chart = P.getSlideCharts(imported)[0],
      book = workbook(f.p, f.shape).data.slice();
    P.setChartSpec(chart, {
      ...chart.spec,
      legend: {
        ...chart.spec.legend,
        position: "t",
        textStyle: { font: "Verdana", sizePt: 32 },
      },
      series: chart.spec.series.map((s) => ({
        ...s,
        values: s.values.map((v) => v + 1),
      })),
    });
    const back = P.importSlide(f.p, imported, P.getSlideLayouts(f.p)[0]),
      q = await parseDeck(await P.savePresentation(f.p)),
      slides = P.getSlides(q);
    expectWidths(f, 8, 72, q, slides[0]);
    expectWidths(f, 15, 72, q, slides[1]);
    const a = P.getSlideCharts(slides[0])[0],
      b = P.getSlideCharts(slides[1])[0];
    expect(a.spec.series[0].lineWidthEmu).toBe(914400);
    expect(b.spec.series[0].lineWidthEmu).toBe(914400);
    expect(a.spec.series[0].values).toEqual([1, 2, 4, 3]);
    expect(b.spec.series[0].values).toEqual([2, 3, 5, 4]);
    expect(workbook(q, a.shape).data).toEqual(book);
    expect(workbook(q, a.shape).name).not.toBe(workbook(q, b.shape).name);
    expect(P.validatePresentation(q)).toEqual([]);
    expect(back).toBeDefined();
  });
});
