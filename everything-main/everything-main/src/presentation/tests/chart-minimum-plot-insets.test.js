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

const frames = [
  { x: 72, y: 72, w: 720, h: 360 },
  { x: 112, y: 128, w: 360, h: 240 },
  { x: 36, y: 32, w: 900, h: 500 },
];
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
function fixture(kind, frame, mode, strokeWidth = 12700) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0],
    shape = P.addSlideChart(slide, {
      ...Object.fromEntries(
        Object.entries(frame).map(([k, v]) => [k, P.pt(v * 0.75)]),
      ),
      spec: {
        kind,
        categories: ["Alpha", "Beta", "Gamma", "Delta"],
        series: [{ name: "First", values: [2, 4, 3, 5], color: "#E85239" }],
        textStyle: {
          font: frame.w === 900 ? "Times New Roman" : "Arial",
          sizePt: frame.w === 360 ? 32 : 9,
        },
        categoryAxisLabelStyle: { font: "Arial", sizePt: 12 },
        valueAxisLabelStyle: { font: "Arial", sizePt: 12 },
        categoryAxisLabelRotationDeg: 0,
        valueAxisLabelRotationDeg: 0,
        categoryAxisHidden: mode === "hidden",
        valueAxisHidden: mode === "hidden",
        ...(mode === "labels-none"
          ? { categoryAxisTickLabelPos: "none", valueAxisTickLabelPos: "none" }
          : {}),
        valueAxis: { min: 0, max: 6, majorUnit: 2 },
        categoryAxisMajorTickMark: "none",
        categoryAxisMinorTickMark: "none",
        valueAxisMajorTickMark: "none",
        valueAxisMinorTickMark: "none",
        valueAxisMajorGridlines: false,
        valueAxisMinorGridlines: false,
        chartAreaFill: "#F4F0E8",
        chartAreaStrokeColor: null,
        plotAreaFill: "#ECF5E9",
        plotAreaStrokeColor: "#23916F",
        plotAreaStrokeWidthEmu: strokeWidth,
      },
    });
  return { p, slide, shape };
}
function plot(p, slide, measureText) {
  const svg = renderSlideToSvg(p, slide, { measureText }),
    nodes = [];
  walkElements(parseXml(svg).root, (e) => nodes.push(e));
  const box = nodes.find(
    (e) => e.name.localName === "rect" && attr(e, "fill") === "#ECF5E9",
  );
  return {
    svg,
    ...Object.fromEntries(
      ["x", "y", "width", "height"].map((k) => [k, Number(attr(box, k))]),
    ),
  };
}
function checkNativeBox(p, slide, frame) {
  const box = plot(p, slide);
  // Independent PDF geometry from 48 native reference controls. All four
  // edges are inset 11pt (14.667 CSS px), including with 1pt/6pt plot strokes.
  for (const inset of [
    box.x - frame.x,
    box.y - frame.y,
    frame.x + frame.w - box.x - box.width,
    frame.y + frame.h - box.y - box.height,
  ])
    // SVG coordinates are rounded independently to hundredths of a pixel.
    expect(Math.abs(inset * 0.75 - 11)).toBeLessThan(0.01);
  return box.svg;
}
describe("native minimum insets of automatic Cartesian plots", () => {
  for (const kind of ["bar", "column", "line", "area"])
    for (const frame of frames)
      for (const width of [12700, 76200])
        for (const mode of ["hidden", "labels-none"])
          it(`${kind} ${frame.w}×${frame.h}, ${width} EMU border, ${mode}`, () => {
            const f = fixture(kind, frame, mode, width),
              part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
              bytes = part.data.slice(),
              book = workbook(f.p, f.shape).data.slice();
            checkNativeBox(f.p, f.slide, frame);
            expect(part.data).toEqual(bytes);
            expect(workbook(f.p, f.shape).data).toEqual(book);
          });
  for (const kind of ["bar", "column", "line", "area"])
    it(`${kind} keeps the inset through editable copy, data edit, save and return`, async () => {
      const frame = frames[1],
        f = fixture(kind, frame, "labels-none"),
        before = checkNativeBox(f.p, f.slide, frame),
        q = createDeck("blank"),
        copy = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0], {
          preservePaintFormatting: true,
        }),
        chart = P.getSlideCharts(copy)[0];
      checkNativeBox(q, copy, frame);
      P.setChartSpec(chart, {
        ...chart.spec,
        series: chart.spec.series.map((s) => ({
          ...s,
          values: s.values.map((v) => v + 1),
        })),
      });
      expect(plot(f.p, f.slide).svg).toBe(before);
      const r = await P.loadPresentation(await P.savePresentation(q)),
        saved = P.getSlides(r).at(-1);
      checkNativeBox(r, saved, frame);
      const returned = P.importSlide(f.p, saved, P.getSlideLayout(f.slide), {
        preservePaintFormatting: true,
      });
      checkNativeBox(f.p, returned, frame);
      expect(P.getSlideCharts(returned)[0].spec.series[0].values).toEqual([
        3, 5, 4, 6,
      ]);
      expect(workbook(f.p, f.shape).data).not.toEqual(
        workbook(r, P.getSlideCharts(saved)[0].shape).data,
      );
      expect(P.validatePresentation(r)).toEqual([]);
    });
});

function renderSlideToSvg(...args) {
  return canonicalSvgDefinitionIds(renderWithSharedIds(...args));
}
