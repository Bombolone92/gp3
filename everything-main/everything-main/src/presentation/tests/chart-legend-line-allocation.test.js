import { canonicalSvgDefinitionIds } from "./svg-definition-ids.js";
import { describe, expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg as renderWithSharedIds } from "../lib/pptx-preview/src/index.ts";
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

// Filled legend bounds measured from a PDF export of the controls, in CSS
// pixels. The native controls vary font, fractional point size,
// placement and explicit line count; Trebuchet controls use unmarked line keys.
// Font numbers are public OpenType metrics.
const fontMetrics = {
  Arial: [1854, 434],
  Verdana: [2059, 430],
  Georgia: [1878, 449],
  "Trebuchet MS": [1923, 455],
};
const nativeCases = [
  ["Arial", 7.25, "r", 1, 37.383867],
  ["Arial", 7.25, "r", 3, 80.1516],
  ["Arial", 7.25, "b", 1, 18.691867],
  ["Arial", 7.25, "b", 3, 40.0758],
  ["Arial", 14.5, "r", 1, 58.767867],
  ["Arial", 14.5, "r", 3, 144.3036],
  ["Arial", 14.5, "b", 1, 29.383827],
  ["Arial", 14.5, "b", 3, 72.151707],
  ["Arial", 25.5, "r", 1, 91.213467],
  ["Arial", 25.5, "r", 3, 241.640933],
  ["Arial", 25.5, "b", 1, 45.60672],
  ["Arial", 25.5, "b", 3, 120.820413],
  ["Arial", 48, "r", 1, 157.569867],
  ["Arial", 48, "r", 3, 440.709773],
  ["Arial", 48, "b", 1, 78.784933],
  ["Arial", 48, "b", 3, 220.354813],
  ["Verdana", 7.25, "r", 1, 39.258],
  ["Verdana", 7.25, "r", 3, 85.7744],
  ["Verdana", 7.25, "b", 1, 19.628973],
  ["Verdana", 7.25, "b", 3, 42.887133],
  ["Verdana", 14.5, "r", 1, 62.529867],
  ["Verdana", 14.5, "r", 3, 155.589733],
  ["Verdana", 14.5, "b", 1, 31.26488],
  ["Verdana", 14.5, "b", 3, 77.794813],
  ["Verdana", 25.5, "r", 1, 97.813467],
  ["Verdana", 25.5, "r", 3, 261.4404],
  ["Verdana", 25.5, "b", 1, 48.906667],
  ["Verdana", 25.5, "b", 3, 130.720147],
  ["Verdana", 48, "r", 1, 170.017333],
  ["Verdana", 48, "r", 3, 478.05216],
  ["Verdana", 48, "b", 1, 85.008547],
  ["Verdana", 48, "b", 3, 239.026027],
  ["Georgia", 7.25, "r", 1, 37.753467],
  ["Georgia", 7.25, "r", 3, 81.2604],
  ["Georgia", 7.25, "b", 1, 18.87664],
  ["Georgia", 7.25, "b", 3, 40.630133],
  ["Georgia", 14.5, "r", 1, 59.493733],
  ["Georgia", 14.5, "r", 3, 146.4812],
  ["Georgia", 14.5, "b", 1, 29.746773],
  ["Georgia", 14.5, "b", 3, 73.24052],
  ["Georgia", 25.5, "r", 1, 92.493733],
  ["Georgia", 25.5, "r", 3, 245.481467],
  ["Georgia", 25.5, "b", 1, 46.246827],
  ["Georgia", 25.5, "b", 3, 122.74068],
  ["Georgia", 48, "r", 1, 159.9856],
  ["Georgia", 48, "r", 3, 447.957],
  ["Georgia", 48, "b", 1, 79.992693],
  ["Georgia", 48, "b", 3, 223.978533],
  ["Trebuchet MS", 7.25, "r", 1, 38.215333],
  ["Trebuchet MS", 7.25, "r", 3, 82.646267],
  ["Trebuchet MS", 7.25, "b", 1, 19.107613],
  ["Trebuchet MS", 7.25, "b", 3, 41.32304],
  ["Trebuchet MS", 14.5, "r", 1, 60.444133],
  ["Trebuchet MS", 14.5, "r", 3, 149.3328],
  ["Trebuchet MS", 14.5, "b", 1, 30.22204],
  ["Trebuchet MS", 14.5, "b", 3, 74.666347],
  ["Trebuchet MS", 25.5, "r", 1, 94.1704],
  ["Trebuchet MS", 25.5, "r", 3, 250.511333],
  ["Trebuchet MS", 25.5, "b", 1, 47.085147],
  ["Trebuchet MS", 25.5, "b", 3, 125.255613],
  ["Trebuchet MS", 48, "r", 1, 163.140267],
  ["Trebuchet MS", 48, "r", 3, 457.420973],
  ["Trebuchet MS", 48, "b", 1, 81.570133],
  ["Trebuchet MS", 48, "b", 3, 228.710413],
];
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const measureText = (text, font) => {
  const family = font.family.split(",")[0].trim().replace(/^"|"$/g, "");
  const [a, d] = fontMetrics[family] ?? fontMetrics.Arial;
  return {
    widthPx: [...text].length * font.sizePx * 0.4,
    ascentPx: (font.sizePx * a) / 2048,
    descentPx: (font.sizePx * d) / 2048,
  };
};
function fixture(font, sizePt, position, lines, last = false) {
  const names = [
    Array.from({ length: lines }, (_, i) => `Line${i + 1}`).join("\n"),
    "Beta",
  ];
  if (last) names.reverse();
  const f = chartLegendLayoutDeck({
    kind: font === "Trebuchet MS" ? "line" : "column",
    sizePt,
    legend: {
      position,
      textStyle: { font, sizePt },
      fill: "#FFF0D1",
      strokeColor: "#845B20",
    },
    series: names.map((name, i) => ({
      name,
      values: [1 + i, 2, 4, 3],
      color: ["#E85239", "#2F8541"][i],
      markerSymbol: "none",
    })),
  });
  P.setShapeSize(f.shape, P.inches(9), P.inches(6));
  return f;
}
function render(p, slide) {
  const svg = renderSlideToSvg(p, slide, {
      measureText,
      resolveFontFamily: (family) => family,
    }),
    nodes = [];
  walkElements(parseXml(svg).root, (e) => nodes.push(e));
  return {
    svg,
    legend: nodes.find(
      (e) => e.name.localName === "rect" && attr(e, "fill") === "#FFF0D1",
    ),
    label: (text) =>
      nodes.find(
        (e) =>
          e.name.localName === "text" &&
          e.children.map((c) => c.data ?? "").join("") === text,
      ),
    keys: nodes.filter(
      (e) =>
        (e.name.localName === "rect" &&
          ["#E85239", "#2F8541"].includes(attr(e, "fill")) &&
          attr(e, "width") === attr(e, "height")) ||
        (e.name.localName === "line" &&
          ["#E85239", "#2F8541"].includes(attr(e, "stroke"))),
    ),
  };
}
describe("native automatic legend line allocation", () => {
  for (const [font, size, position, lines, height] of nativeCases)
    it(`${font} ${size}pt ${position} ${lines} lines reserves the native logical box`, () => {
      const f = fixture(font, size, position, lines),
        r = render(f.p, f.slide);
      expect(r.svg).not.toContain("scale(");
      // The SVG rectangle adds half the 0.6px outline outside each filled edge.
      expect(Math.abs(+attr(r.legend, "height") - 0.6 - height)).toBeLessThan(
        0.07,
      );
      const rows = position === "r" ? 2 : 1,
        rowHeight = height / rows;
      const first = +attr(r.label("Line1"), "y");
      expect(
        Math.abs(
          first -
            (+attr(r.legend, "y") + 0.3 + 4 + (rowHeight - 8) / lines / 2),
        ),
      ).toBeLessThan(0.06);
      for (const key of r.keys) {
        const center =
          key.name.localName === "line"
            ? +attr(key, "y1")
            : +attr(key, "y") + +attr(key, "height") / 2;
        expect(
          Math.min(
            Math.abs(center - first),
            Math.abs(center - (first + rowHeight)),
          ),
        ).toBeLessThan(0.07);
      }
    });
  for (const position of ["r", "b"])
    for (const last of [false, true])
      it(`${position}, long label last=${last}: glyph pitch and key body remain independent of row allocation`, () => {
        const f = fixture("Verdana", 48, position, 3, last),
          r = render(f.p, f.slide),
          height = ((2059 + 430) * 64) / 2048;
        expect(
          +attr(r.label("Line2"), "y") - +attr(r.label("Line1"), "y"),
        ).toBeCloseTo(height, 1);
        for (const key of r.keys)
          expect(+attr(key, "height")).toBeCloseTo(height * 0.45, 1);
        expect(
          Math.abs(
            +attr(r.legend, "height") -
              0.6 -
              (position === "r" ? 478.0522 : 239.026),
          ),
        ).toBeLessThan(0.07);
      });
  for (const position of ["r", "b"])
    it(`${position} copy, font/data edit, export and returned copy preserve independent editable charts`, async () => {
      const f = fixture("Arial", 14.5, position, 3),
        c = P.getSlideCharts(f.slide)[0],
        spec = c.spec,
        raw = P._internalPackageOf(f.p)
          .getPart(chartRoot(f.shape))
          .data.slice(),
        book = workbook(f.p, f.shape).data.slice(),
        q = createDeck("blank"),
        copy = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
        edited = P.getSlideCharts(copy)[0];
      P.setChartSpec(edited, {
        ...edited.spec,
        legend: {
          ...edited.spec.legend,
          textStyle: { font: "Georgia", sizePt: 25.5 },
        },
        series: edited.spec.series.map((s) => ({
          ...s,
          values: s.values.map((v) => v + 1),
        })),
      });
      const returned = P.importSlide(f.p, copy, P.getSlideLayouts(f.p)[0]);
      const before = render(f.p, returned).svg,
        reloaded = await P.loadPresentation(await P.savePresentation(f.p)),
        slides = P.getSlides(reloaded);
      expect(render(reloaded, slides[1]).svg).toBe(before);
      expect(P.getSlideCharts(slides[0])[0].spec).toEqual(spec);
      expect(
        P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
      ).toEqual(raw);
      expect(
        workbook(reloaded, P.getSlideCharts(slides[0])[0].shape).data,
      ).toEqual(book);
      expect(P.getSlideCharts(slides[1])[0].spec.series[0].values).toEqual([
        2, 3, 5, 4,
      ]);
      expect(
        Math.abs(
          +attr(render(reloaded, slides[1]).legend, "height") -
            0.6 -
            (position === "r" ? 245.4815 : 122.7407),
        ),
      ).toBeLessThan(0.07);
      expect(P.validatePresentation(reloaded)).toEqual([]);
    });
});

function renderSlideToSvg(...args) {
  return canonicalSvgDefinitionIds(renderWithSharedIds(...args));
}
