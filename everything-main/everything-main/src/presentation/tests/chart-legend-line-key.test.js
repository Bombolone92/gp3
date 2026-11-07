import { describe, expect, it } from "vitest";
import { P, createDeck, parseDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  chartLegendLayoutDeck,
  chartMarkerPaintDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";
import {
  getAttrValue,
  parseXml,
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";

const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const colors = ["#E85239", "#2F8541", "#376CA8"];
function render(p, slide) {
  const nodes = [];
  walkElements(
    parseXml(
      renderSlideToSvg(p, slide, {
        measureText: (text, font) => ({
          widthPx: (text.length * font.sizePx) / 2,
          ascentPx: font.sizePx * 0.8,
          descentPx: font.sizePx * 0.2,
        }),
      }),
    ).root,
    (e) => nodes.push(e),
  );
  return {
    nodes,
    lines: nodes.filter(
      (e) =>
        e.name.localName === "line" &&
        colors.includes(attr(e, "stroke")) &&
        attr(e, "y1") === attr(e, "y2"),
    ),
  };
}
function lineDeck(options = {}) {
  return chartLegendLayoutDeck({
    kind: "line",
    series: colors.map((color, i) => ({
      name: ["Alpha", "Beta", "Gamma"][i],
      values: [2, 4, 3, 5],
      color,
      markerSymbol: "none",
    })),
    ...options,
  });
}
function expectSpan(lines) {
  expect(lines).toHaveLength(3);
  for (const line of lines)
    expect(+attr(line, "x2") - +attr(line, "x1")).toBeCloseTo(25.6, 2);
}

describe("automatic line legend key geometry", () => {
  // Independent native controls establish a 19.2pt span across fonts,
  // dimensions, placement, chart kinds and authored series/marker widths.
  for (const font of ["Arial", "Times New Roman", "Courier New", "Verdana"])
    for (const sizePt of [9, 18, 32])
      for (const position of ["r", "b"])
        it(`${font} ${sizePt}pt ${position} uses the native span without editing data`, () => {
          const f = lineDeck({
              sizePt,
              legend: { position, textStyle: { font, sizePt } },
            }),
            before = P.getShapeChartSpec(f.shape),
            chart = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
            chartBytes = chart.data.slice(),
            bookBytes = workbook(f.p, f.shape).data.slice();
          expectSpan(render(f.p, f.slide).lines);
          expect(P.getShapeChartSpec(f.shape)).toEqual(before);
          expect(chart.data).toEqual(chartBytes);
          expect(workbook(f.p, f.shape).data).toEqual(bookBytes);
        });

  for (const kind of ["scatter", "radar"])
    it(`${kind} centers each independently painted marker on its line key`, () => {
      const f = chartMarkerPaintDeck(kind),
        r = render(f.p, f.slide);
      expectSpan(r.lines);
      const circle = r.nodes.find(
        (e) =>
          e.name.localName === "circle" &&
          attr(e, "stroke") === "#EA7423" &&
          Math.abs(+attr(e, "cy") - +attr(r.lines[0], "y1")) < 0.02 &&
          Math.abs(
            +attr(e, "cx") -
              (+attr(r.lines[0], "x1") + +attr(r.lines[0], "x2")) / 2,
          ) < 0.02,
      );
      expect(circle).toBeDefined();
      expect(attr(circle, "fill")).toBe("#116699");
      expect(+attr(circle, "stroke-width")).toBe(1);
    });

  for (const markerSizePt of [2, 72])
    it(`centers ${markerSizePt}pt markers without changing their plotted sizes or the key span`, () => {
      const f = lineDeck({
          sizePt: 18,
          series: colors.map((color, i) => ({
            name: ["Alpha", "Beta", "Gamma"][i],
            values: [2, 4, 3, 5],
            color,
            markerSymbol: "circle",
            markerSizePt,
            markerFill: "#116699",
          })),
        }),
        r = render(f.p, f.slide),
        circles = r.nodes.filter((e) => e.name.localName === "circle");
      expectSpan(r.lines);
      const legendMarkers = r.lines.map((line) =>
        circles.find(
          (e) =>
            Math.abs(+attr(e, "cy") - +attr(line, "y1")) < 0.02 &&
            Math.abs(
              +attr(e, "cx") - (+attr(line, "x1") + +attr(line, "x2")) / 2,
            ) < 0.02,
        ),
      );
      expect(legendMarkers.every(Boolean)).toBe(true);
      const plotted = circles.filter((e) => !legendMarkers.includes(e));
      expect(plotted).toHaveLength(12);
      for (const circle of plotted)
        expect(+attr(circle, "r")).toBeCloseTo((markerSizePt * 96) / 72 / 2, 2);
    });

  it("shares non-square line and independent marker outline bounds with legend reservation", () => {
    const f = lineDeck({
        sizePt: 18,
        series: colors.map((color, i) => ({
          name: ["Alpha", "Beta", "Gamma"][i],
          values: [2, 4, 3, 5],
          color,
          lineWidthEmu: 228600,
          markerSymbol: "circle",
          markerStrokeColor: "#116699",
          markerStrokeWidthEmu: 381000,
        })),
      }),
      r = render(f.p, f.slide),
      box = r.nodes.find((e) => attr(e, "fill") === "#FFF0D1"),
      left = +attr(box, "x"),
      right = left + +attr(box, "width"),
      top = +attr(box, "y"),
      bottom = top + +attr(box, "height");
    expectSpan(r.lines);
    for (const line of r.lines) {
      const cx = (+attr(line, "x1") + +attr(line, "x2")) / 2,
        cy = +attr(line, "y1");
      // 9px marker body plus a 40px outline extends beyond the line ends.
      expect(cx - 24.5).toBeGreaterThanOrEqual(left);
      expect(cx + 24.5).toBeLessThanOrEqual(right);
      expect(cy - 24.5).toBeGreaterThanOrEqual(top);
      expect(cy + 24.5).toBeLessThanOrEqual(bottom);
      expect(+attr(line, "stroke-width")).toBeCloseTo(32 / 3, 10);
    }
  });

  for (const [widthIn, heightIn] of [
    [3, 2],
    [3, 6],
    [9, 2],
    [9, 6],
  ])
    it(`retains its span in a ${widthIn} × ${heightIn}in chart when entries fit`, () => {
      const f = lineDeck({ sizePt: 9 });
      P.setShapeSize(f.shape, P.inches(widthIn), P.inches(heightIn));
      expectSpan(render(f.p, f.slide).lines);
    });

  it("retains separate fonts, positions, line geometry and editable workbooks through transfer and export/reimport", async () => {
    const source = lineDeck({ sizePt: 32 }),
      dest = createDeck("blank"),
      imported = P.importSlide(dest, source.slide, P.getSlideLayouts(dest)[0]),
      copied = P.getSlideCharts(imported)[0];
    P.setChartSpec(copied, {
      ...copied.spec,
      legend: {
        ...copied.spec.legend,
        position: "b",
        textStyle: { font: "Verdana", sizePt: 18 },
      },
      series: copied.spec.series.map((s) => ({
        ...s,
        values: s.values.map((v) => v + 1),
        lineWidthEmu: 38100,
      })),
    });
    const returned = P.importSlide(
        source.p,
        imported,
        P.getSlideLayouts(source.p)[0],
      ),
      q = await parseDeck(await P.savePresentation(source.p));
    for (const slide of [source.slide, imported, returned])
      expectSpan(render(slide === imported ? dest : source.p, slide).lines);
    for (const slide of P.getSlides(q)) expectSpan(render(q, slide).lines);
    const charts = P.getSlides(q).map((s) => P.getSlideCharts(s)[0]);
    expect(charts.map((c) => c.spec.legend.textStyle.sizePt)).toEqual([32, 18]);
    expect(charts.map((c) => c.spec.legend.position)).toEqual(["r", "b"]);
    expect(charts.map((c) => c.spec.series[0].values)).toEqual([
      [2, 4, 3, 5],
      [3, 5, 4, 6],
    ]);
    expect(new Set(charts.map((c) => workbook(q, c.shape).name)).size).toBe(2);
    expect(P.validatePresentation(q)).toEqual([]);
  });
});
