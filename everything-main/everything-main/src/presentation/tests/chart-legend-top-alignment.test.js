import { describe, expect, it } from "vitest";
import { P, createDeck, parseDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import {
  chartLegendLayoutDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";

const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const measureText = (text, font) => ({
  widthPx: text.length * font.sizePx * 0.48,
  ascentPx: font.sizePx * 0.8,
  descentPx: font.sizePx * 0.3,
});
function fixture({
  names,
  position = "b",
  kind = "column",
  sizePt = 18,
  widthIn = 9,
}) {
  const f = chartLegendLayoutDeck({
    kind,
    sizePt,
    legend: { position, textStyle: { font: "Arial", sizePt }, fill: "#FFF0D1" },
    series: names.map((name, i) => ({
      name,
      values: [2 + i, 4, 3, 5],
      color: "#E85239",
      ...(kind === "line" ? { markerSymbol: "none" } : {}),
    })),
  });
  P.setShapeSize(f.shape, P.inches(widthIn), P.inches(6));
  return f;
}
function rendered(f, slide = f.slide, p = f.p) {
  const nodes = [],
    svg = renderSlideToSvg(p, slide, { measureText });
  walkElements(parseXml(svg).root, (e) => nodes.push(e));
  const labels = nodes.filter((e) => e.name.localName === "text");
  return {
    svg,
    legend: nodes.find(
      (e) => e.name.localName === "rect" && attr(e, "fill") === "#FFF0D1",
    ),
    label: (text) =>
      labels.find((e) => e.children.map((c) => c.data ?? "").join("") === text),
    keys: nodes.filter(
      (e) =>
        (e.name.localName === "line" && attr(e, "stroke") === "#E85239") ||
        (e.name.localName === "rect" &&
          attr(e, "fill") === "#E85239" &&
          attr(e, "width") === attr(e, "height")),
    ),
  };
}
const keyCenter = (e) =>
  e.name.localName === "line"
    ? +attr(e, "y1")
    : +attr(e, "y") + +attr(e, "height") / 2;

// Native controls establish alignment to the first line in a common row,
// independently of label length/order, top/bottom placement and key geometry.
describe("horizontal legend entries align at their first line", () => {
  for (const position of ["b", "t"])
    for (const kind of ["column", "line"])
      it(`${position} ${kind} retains single-line centering with tiny text and thick outlines`, () => {
        const f = fixture({
            names: ["Alpha", "Beta"],
            position,
            kind,
            sizePt: 1,
          }),
          chart = P.getSlideCharts(f.slide)[0];
        P.setChartSpec(chart, {
          ...chart.spec,
          series: chart.spec.series.map((s) => ({
            ...s,
            lineWidthEmu: 914400,
          })),
        });
        const r = rendered(f),
          center = +attr(r.legend, "y") + +attr(r.legend, "height") / 2;
        expect(+attr(r.label("Alpha"), "y")).toBeCloseTo(center, 1);
        expect(+attr(r.label("Beta"), "y")).toBeCloseTo(center, 1);
        for (const key of r.keys) expect(keyCenter(key)).toBeCloseTo(center, 1);
      });

  for (const position of ["b", "t"])
    for (const kind of ["column", "line"])
      for (const sizePt of [9, 18, 32])
        for (const longFirst of [true, false])
          it(`${position} ${kind} ${sizePt}pt, long entry ${longFirst ? "first" : "last"}`, () => {
            const names = ["Line1\nLine2\nLine3\nLine4", "Beta"];
            if (!longFirst) names.reverse();
            const r = rendered(fixture({ names, position, kind, sizePt }));
            expect(+attr(r.label("Beta"), "y")).toBe(
              +attr(r.label("Line1"), "y"),
            );
            expect(r.keys).toHaveLength(2);
            for (const key of r.keys)
              expect(keyCenter(key)).toBeCloseTo(
                +attr(r.label("Line1"), "y"),
                1,
              );
            expect(+attr(r.label("Line4"), "y")).toBeGreaterThan(
              +attr(r.label("Line1"), "y"),
            );
            expect(r.svg).not.toContain("scale(");
          });

  for (const position of ["b", "t"])
    for (const kind of ["column", "line"])
      it(`${position} ${kind} aligns each grid row independently`, () => {
        const names = [
            "Alpha",
            "Bravo",
            "Charlie",
            "Line1\nLine2\nLine3",
            "Delta",
            "Echo",
            "Foxtrot",
          ],
          r = rendered(fixture({ names, position, kind, widthIn: 5 })),
          first = +attr(r.label("Line1"), "y");
        // Filled keys allow four columns; wider line keys allow three.
        const peers =
          kind === "column" ? ["Alpha", "Bravo", "Charlie"] : ["Delta", "Echo"];
        for (const peer of peers) expect(+attr(r.label(peer), "y")).toBe(first);
        expect(+attr(r.label("Foxtrot"), "y")).toBeGreaterThan(
          +attr(r.label("Line3"), "y"),
        );
        expect(r.svg).not.toContain("scale(");
      });

  for (const position of ["b", "t"])
    for (const kind of ["column", "line"])
      it(`${position} ${kind} keeps an empty first line in the aligned entry`, () => {
        const r = rendered(
            fixture({ names: ["\nLine2\nLine3", "Beta"], position, kind }),
          ),
          first = +attr(r.label("Beta"), "y");
        expect(+attr(r.label("Line2"), "y")).toBeGreaterThan(first);
        expect(
          +attr(r.label("Line3"), "y") - +attr(r.label("Line2"), "y"),
        ).toBeCloseTo(+attr(r.label("Line2"), "y") - first, 1);
        for (const key of r.keys) expect(keyCenter(key)).toBeCloseTo(first, 1);
      });

  it("retains source bytes and independent returned names, fonts and data through export/reimport", async () => {
    const names = ["Line1\nLine2\nLine3\nLine4", "Beta"],
      f = fixture({ names }),
      before = P.getShapeChartSpec(f.shape),
      raw = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data.slice(),
      book = workbook(f.p, f.shape).data.slice();
    rendered(f);
    expect(P.getShapeChartSpec(f.shape)).toEqual(before);
    expect(P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data).toEqual(
      raw,
    );
    expect(workbook(f.p, f.shape).data).toEqual(book);
    const dest = createDeck("blank"),
      imported = P.importSlide(dest, f.slide, P.getSlideLayouts(dest)[0]),
      c = P.getSlideCharts(imported)[0];
    P.setChartSpec(c, {
      ...c.spec,
      legend: {
        ...c.spec.legend,
        position: "t",
        textStyle: { font: "Verdana", sizePt: 32 },
      },
      series: c.spec.series.map((s, i) => ({
        ...s,
        name: i ? "Beta\nTail" : s.name,
        values: s.values.map((v) => v + 1),
      })),
    });
    P.importSlide(f.p, imported, P.getSlideLayouts(f.p)[0]);
    const q = await parseDeck(await P.savePresentation(f.p)),
      slides = P.getSlides(q),
      charts = slides.map((s) => P.getSlideCharts(s)[0]);
    for (const slide of slides) {
      const r = rendered(f, slide, q);
      expect(+attr(r.label("Beta"), "y")).toBe(+attr(r.label("Line1"), "y"));
    }
    expect(charts.map((c) => c.spec.legend.position)).toEqual(["b", "t"]);
    expect(charts.map((c) => c.spec.series[1].name)).toEqual([
      "Beta",
      "Beta\nTail",
    ]);
    expect(charts.map((c) => c.spec.series[0].values)).toEqual([
      [2, 4, 3, 5],
      [3, 5, 4, 6],
    ]);
    expect(workbook(q, charts[0].shape).data).toEqual(book);
    expect(new Set(charts.map((c) => workbook(q, c.shape).name)).size).toBe(2);
    expect(P.validatePresentation(q)).toEqual([]);
  });
});
