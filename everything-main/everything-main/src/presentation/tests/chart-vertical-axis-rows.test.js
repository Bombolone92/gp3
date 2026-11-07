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
    font: "Georgia",
    ascent: 1878,
    descent: 449,
    advances: {
      A: 1374,
      B: 1339,
      C: 1315,
      D: 1534,
      0: 1257,
      2: 1144,
      4: 1157,
      6: 1159,
    },
    categoryInsets: [21.10669, 25.9758, 45.44661, 84.3967],
    valueInsets: [19.89173, 24.3509, 42.20157, 77.9016],
  },
  {
    font: "Trebuchet MS",
    ascent: 1923,
    descent: 455,
    advances: {
      A: 1208,
      B: 1159,
      C: 1225,
      D: 1256,
      0: 1074,
      2: 1074,
      4: 1074,
      6: 1074,
    },
    categoryInsets: [20.06158, 24.5841, 42.66417, 78.8308],
    valueInsets: [19.26157, 23.5191, 40.52921, 74.5608],
  },
];
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const measureFor = (cfg) => (text, font) => ({
  widthPx:
    ([...text].reduce((n, c) => n + (cfg.advances[c] ?? 1024), 0) *
      font.sizePx) /
    2048,
  ascentPx: (font.sizePx * cfg.ascent) / 2048,
  descentPx: (font.sizePx * cfg.descent) / 2048,
  lineGapPx: 0,
});
function verticalAxisRowFixture(kind, cfg, sizePt, high, mark = "none") {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0],
    bar = kind === "bar";
  const frame =
    sizePt === 12
      ? { x: 108, y: 129.3333333333333, w: 720, h: 360 }
      : { x: 72, y: 72, w: 864, h: 480 };
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
      categoryAxisHidden: !bar,
      valueAxisHidden: bar,
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
  const svg = renderSlideToSvg(p, slide, {
      measureText: measureFor(cfg),
      resolveFontFamily: (family) => family,
    }),
    nodes = [];
  walkElements(parseXml(svg).root, (e) => nodes.push(e));
  const plot = nodes.find(
    (e) => e.name.localName === "rect" && attr(e, "fill") === "#ECF5E9",
  );
  return {
    svg,
    left: +attr(plot, "x"),
    right: +attr(plot, "x") + +attr(plot, "width"),
    labels: nodes.filter(
      (e) => e.name.localName === "text" && attr(e, "fill") === "#604020",
    ),
  };
}
function check(f, kind, cfg, high, inset) {
  const g = geometry(f.p, f.slide, cfg);
  const actual = high ? f.frame.x + f.frame.w - g.right : g.left - f.frame.x;
  // Independent native extraction and SVG endpoint rounding each contribute
  // less than .01pt. Keep their combined budget explicit.
  expect(Math.abs(actual * 0.75 - inset)).toBeLessThan(0.02);
  expect(g.labels).toHaveLength(4);
  return g;
}
describe("measured vertical Cartesian axis rows", () => {
  for (const kind of ["bar", "column", "line", "area"])
    for (const cfg of fonts)
      for (const sizePt of [9, 12, 24, 48])
        for (const high of [false, true])
          it(`${kind}, ${cfg.font} ${sizePt}pt, ${high ? "right" : "left"}`, () => {
            const mark = ["none", "out", "cross", "in"][
              [9, 12, 24, 48].indexOf(sizePt)
            ];
            const f = verticalAxisRowFixture(kind, cfg, sizePt, high, mark),
              part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape));
            const bytes = part.data.slice(),
              book = workbook(f.p, f.shape).data.slice();
            check(
              f,
              kind,
              cfg,
              high,
              (kind === "bar" ? cfg.categoryInsets : cfg.valueInsets)[
                [9, 12, 24, 48].indexOf(sizePt)
              ],
            );
            expect(part.data).toEqual(bytes);
            expect(workbook(f.p, f.shape).data).toEqual(book);
          });
  for (const kind of ["bar", "column", "line", "area"])
    it(`${kind} retains an editable row through copy, axis-font edit, save and return`, async () => {
      const cfg = fonts[0],
        f = verticalAxisRowFixture(kind, cfg, 9, false),
        before = check(
          f,
          kind,
          cfg,
          false,
          (kind === "bar" ? cfg.categoryInsets : cfg.valueInsets)[0],
        ).svg;
      const q = createDeck("blank"),
        slide = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0], {
          preservePaintFormatting: true,
          preserveTextFormatting: true,
        });
      const chart = P.getSlideCharts(slide)[0],
        style = { font: "Trebuchet MS", sizePt: 24, color: "#604020" };
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
      check(
        edited,
        kind,
        fonts[1],
        false,
        (kind === "bar" ? fonts[1].categoryInsets : fonts[1].valueInsets)[2],
      );
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
        (kind === "bar" ? fonts[1].categoryInsets : fonts[1].valueInsets)[2],
      );
      expect(geometry(f.p, f.slide, cfg).svg).toBe(before);
    });
});

// A visible vertical row reduces the bands available to the perpendicular row.
// Inclinations must use that remaining width, including a side legend's area.
describe("perpendicular automatic rows share the measured plot width", () => {
  for (const kind of ["bar", "column", "line", "area"])
    for (const position of [undefined, "l", "r"])
      it(`${kind}, ${position ?? "no"} side legend`, () => {
        const p = createDeck("blank"),
          slide = P.getSlides(p)[0],
          bar = kind === "bar",
          shape = P.addSlideChart(slide, {
            x: P.pt(54),
            y: P.pt(54),
            w: P.pt(position ? 240 : 165),
            h: P.pt(300),
            spec: {
              kind,
              categories: ["ABCDEFGH", "IJKLMNOP", "QRSTUVWX"],
              series: [{ name: "Units", values: [250000, 500000, 1000000] }],
              title: position ? "Rates" : undefined,
              categoryAxisLabelStyle: {
                font: "Arial",
                sizePt: 12,
                color: bar ? "#604020" : "#1869A4",
              },
              valueAxisLabelStyle: {
                font: "Arial",
                sizePt: 12,
                color: bar ? "#1869A4" : "#604020",
              },
              categoryAxisLabelRotationDeg: null,
              valueAxisLabelRotationDeg: null,
              valueAxis: { min: 0, max: 1000000, majorUnit: 250000 },
              categoryAxisMajorTickMark: "none",
              valueAxisMajorTickMark: "none",
              ...(position
                ? {
                    legend: {
                      position,
                      textStyle: { font: "Arial", sizePt: 12 },
                    },
                  }
                : {}),
            },
          }),
          measureText = (text, font) => ({
            widthPx: (text.length * font.sizePx) / 2,
            ascentPx: font.sizePx * 0.8,
            descentPx: font.sizePx * 0.2,
          }),
          part = P._internalPackageOf(p).getPart(chartRoot(shape)),
          before = part.data.slice(),
          book = workbook(p, shape).data.slice(),
          nodes = [];
        walkElements(
          parseXml(renderSlideToSvg(p, slide, { measureText })).root,
          (e) => nodes.push(e),
        );
        const labels = nodes.filter(
            (e) => e.name.localName === "text" && attr(e, "fill") === "#1869A4",
          ),
          xs = labels.map((e) => +attr(e, "x")).sort((a, b) => a - b),
          step = Math.min(...xs.slice(1).map((x, i) => x - xs[i]));
        expect(labels).toHaveLength(bar ? 5 : 3);
        expect(step).toBeGreaterThan(16);
        for (const label of labels) {
          const text = label.children
              .filter((n) => n.kind === "text")
              .map((n) => n.data)
              .join(""),
            angle =
              (+(
                attr(label, "transform")?.match(/rotate\(([-.\d]+)/)?.[1] ?? 0
              ) *
                Math.PI) /
              180,
            projection =
              Math.abs(text.length * 8 * Math.cos(angle)) +
              Math.abs(16 * Math.sin(angle));
          expect(projection).toBeLessThanOrEqual(step + 0.03);
        }
        expect(part.data).toEqual(before);
        expect(workbook(p, shape).data).toEqual(book);
      });
});

function renderSlideToSvg(...args) {
  return canonicalSvgDefinitionIds(renderWithSharedIds(...args));
}
