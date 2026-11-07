import { canonicalSvgDefinitionIds } from "./svg-definition-ids.js";
import { describe, it, expect } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg as renderWithSharedIds } from "../lib/pptx-preview/src/index.ts";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

// Independent native PDF plot insets in points; fonts were read from the
// PDF's embedded font metadata. These are layout bounds, not glyph baselines.
const fonts = [
  {
    font: "Arial",
    ascent: 1854,
    descent: 434,
    insets: [21.98, 27.1534, 47.7934, 37.4734],
  },
  {
    font: "Times New Roman",
    ascent: 1825,
    descent: 443,
    insets: [21.8117, 26.92, 47.3317, 37.1283],
  },
  {
    font: "Verdana",
    ascent: 2059,
    descent: 430,
    insets: [23.4732, 29.1284, 51.7566, 40.4384],
  },
  {
    font: "Courier New",
    ascent: 1705,
    descent: 615,
    insets: [21.6968, 26.755, 47.005, 36.88],
  },
];
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const measureFor = (cfg) => (text, font) => ({
  widthPx: ([...text].length * font.sizePx) / 2,
  ascentPx: (font.sizePx * cfg.ascent) / 2048,
  descentPx: (font.sizePx * cfg.descent) / 2048,
  lineGapPx: 0,
});
function horizontalAxisRowFixture(kind, cfg, sizePt, high, mark = "none") {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0],
    bar = kind === "bar";
  const frame =
    sizePt === 12
      ? { x: 112, y: 128, w: 600, h: 400 }
      : { x: 72, y: 72, w: 720, h: 360 };
  const shape = P.addSlideChart(slide, {
    ...Object.fromEntries(
      Object.entries(frame).map(([k, v]) => [k, P.pt(v * 0.75)]),
    ),
    spec: {
      kind,
      textStyle: { font: "Arial", sizePt: sizePt === 12 ? 32 : 9 },
      categories: ["A", "B", "C", "D"],
      series: [{ name: "First", values: [2, 4, 3, 5], color: "#E85239" }],
      categoryAxisLabelStyle: { font: cfg.font, sizePt, color: "#604020" },
      valueAxisLabelStyle: { font: cfg.font, sizePt, color: "#604020" },
      categoryAxisLabelRotationDeg: 0,
      valueAxisLabelRotationDeg: 0,
      categoryAxisHidden: bar,
      valueAxisHidden: !bar,
      categoryAxisCrosses: high ? "max" : "min",
      valueAxisCrosses: high ? "max" : "min",
      categoryAxisTickLabelPos: high ? "high" : "low",
      valueAxisTickLabelPos: high ? "high" : "low",
      valueAxis: { min: 0, max: 6, majorUnit: 2 },
      categoryAxisMajorTickMark: mark,
      valueAxisMajorTickMark: mark,
      categoryAxisMinorTickMark: "none",
      valueAxisMinorTickMark: "none",
      valueAxisMajorGridlines: false,
      plotAreaFill: "#ECF5E9",
      chartAreaStrokeColor: null,
    },
  });
  return { p, slide, shape, frame };
}
function geometry(p, slide, cfg) {
  const svg = renderSlideToSvg(p, slide, { measureText: measureFor(cfg) }),
    nodes = [];
  walkElements(parseXml(svg).root, (e) => nodes.push(e));
  const plot = nodes.find(
    (e) => e.name.localName === "rect" && attr(e, "fill") === "#ECF5E9",
  );
  return {
    svg,
    top: +attr(plot, "y"),
    bottom: +attr(plot, "y") + +attr(plot, "height"),
    labels: nodes.filter(
      (e) => e.name.localName === "text" && attr(e, "fill") === "#604020",
    ),
  };
}
function check(f, kind, cfg, high, inset) {
  const g = geometry(f.p, f.slide, cfg);
  const actual = high ? g.top - f.frame.y : f.frame.y + f.frame.h - g.bottom;
  // Independent native extraction and SVG endpoint rounding each contribute
  // less than .01pt. Keep their combined budget explicit.
  expect(Math.abs(actual * 0.75 - inset)).toBeLessThan(0.02);
  expect(g.labels).toHaveLength(4);
  return g;
}
describe("font-derived horizontal Cartesian axis rows", () => {
  for (const kind of ["bar", "column", "line", "area"])
    for (const cfg of fonts)
      for (const sizePt of kind === "bar" || kind === "column"
        ? [9, 12, 24]
        : [18])
        for (const high of [false, true])
          it(`${kind}, ${cfg.font} ${sizePt}pt, ${high ? "above" : "below"}`, () => {
            const mark = ["none", "out", "cross"][
              [9, 12, 24, 18].indexOf(sizePt) % 3
            ];
            const f = horizontalAxisRowFixture(kind, cfg, sizePt, high, mark),
              part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape));
            const bytes = part.data.slice(),
              book = workbook(f.p, f.shape).data.slice();
            check(
              f,
              kind,
              cfg,
              high,
              cfg.insets[[9, 12, 24, 18].indexOf(sizePt)],
            );
            expect(part.data).toEqual(bytes);
            expect(workbook(f.p, f.shape).data).toEqual(book);
          });
  for (const kind of ["bar", "column", "line", "area"])
    it(`${kind} retains an editable row through copy, axis-font edit, save and return`, async () => {
      const cfg = fonts[0],
        f = horizontalAxisRowFixture(kind, cfg, 9, false),
        before = geometry(f.p, f.slide, cfg).svg;
      const q = createDeck("blank"),
        slide = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0], {
          preservePaintFormatting: true,
          preserveTextFormatting: true,
        });
      const chart = P.getSlideCharts(slide)[0],
        style = { font: "Times New Roman", sizePt: 24, color: "#604020" };
      P.setChartSpec(chart, {
        ...chart.spec,
        categoryAxisLabelStyle: style,
        valueAxisLabelStyle: style,
        series: chart.spec.series.map((s) => ({
          ...s,
          values: s.values.map((v) => v + 1),
        })),
      });
      const edited = { p: q, slide, shape: chart.shape, frame: f.frame };
      check(edited, kind, fonts[1], false, fonts[1].insets[2]);
      const loaded = await P.loadPresentation(await P.savePresentation(q)),
        restored = P.getSlides(loaded).at(-1),
        restoredChart = P.getSlideCharts(restored)[0];
      expect(restoredChart.spec).toEqual(P.getShapeChartSpec(chart.shape));
      expect(workbook(loaded, restoredChart.shape).data).toEqual(
        workbook(q, chart.shape).data,
      );
      expect(geometry(loaded, restored, fonts[1]).svg).toBe(
        geometry(q, slide, fonts[1]).svg,
      );
      const returned = P.importSlide(f.p, restored, P.getSlideLayouts(f.p)[0], {
        preservePaintFormatting: true,
        preserveTextFormatting: true,
      });
      check(
        { ...f, slide: returned },
        kind,
        fonts[1],
        false,
        fonts[1].insets[2],
      );
      expect(geometry(f.p, f.slide, cfg).svg).toBe(before);
    });
});

function renderSlideToSvg(...args) {
  return canonicalSvgDefinitionIds(renderWithSharedIds(...args));
}
