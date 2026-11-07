import { describe, expect, it } from "vitest";
import { P } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  chartLegendLayoutDeck,
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
function keys(f, metrics) {
  const result = [];
  walkElements(
    parseXml(
      renderSlideToSvg(f.p, f.slide, {
        measureText: (text, font) => ({
          widthPx: (text.length * font.sizePx) / 2,
          ...metrics(font),
        }),
      }),
    ).root,
    (e) => {
      if (
        e.name.localName === "rect" &&
        colors.includes(attr(e, "fill")) &&
        attr(e, "width") === attr(e, "height")
      )
        result.push(e);
    },
  );
  return result;
}
const metrics = (ascent, descent) => (font) => ({
  ascentPx: font.sizePx * ascent,
  descentPx: font.sizePx * descent,
});
describe("filled legend keys follow font metrics", () => {
  // Independent native controls at 18pt. Font bounds are normalized from
  // the installed faces, not the current label's ink or CSS line gap.
  const faces = [
    ["Arial", 1854 / 2048, 434 / 2048, 12.0677],
    ["Times New Roman", 1825 / 2048, 443 / 2048, 11.9635],
    ["Courier New", 1705 / 2048, 615 / 2048, 12.2344],
    ["Verdana", 2059 / 2048, 430 / 2048, 13.125],
  ];
  for (const [font, ascent, descent, nativeSize] of faces)
    for (const position of ["r", "b"])
      it(`${font} ${position} uses the native filled-key size without changing chart or workbook bytes`, () => {
        const f = chartLegendLayoutDeck({
            sizePt: 18,
            legend: { position, textStyle: { font, sizePt: 18 } },
          }),
          before = P.getShapeChartSpec(f.shape),
          part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
          bytes = part.data.slice(),
          book = workbook(f.p, f.shape).data.slice(),
          result = keys(f, metrics(ascent, descent));
        expect(result).toHaveLength(3);
        for (const key of result)
          expect(Math.abs(+attr(key, "width") - nativeSize)).toBeLessThan(0.02);
        expect(P.getShapeChartSpec(f.shape)).toEqual(before);
        expect(part.data).toEqual(bytes);
        expect(workbook(f.p, f.shape).data).toEqual(book);
      });
  for (const kind of ["column", "area", "pie", "doughnut"])
    it(`${kind} uses the same font-sized filled key as bars`, () => {
      const f = chartLegendLayoutDeck({
          kind,
          sizePt: 18,
          ...(["pie", "doughnut"].includes(kind)
            ? {
                series: [
                  { name: "Units", values: [2, 4, 3, 5], color: colors[0] },
                ],
              }
            : {}),
        }),
        result = keys(f, metrics(1854 / 2048, 434 / 2048));
      expect(result).toHaveLength(["pie", "doughnut"].includes(kind) ? 4 : 3);
      for (const key of result)
        expect(+attr(key, "width")).toBeCloseTo(12.07, 2);
    });
  it("scales with fractional text sizes and font bounds, excluding line gap and chart dimensions", () => {
    const f = chartLegendLayoutDeck({ sizePt: 13.5 }),
      m = (font) => ({
        ...metrics(0.9, 0.3)(font),
        lineGapPx: font.sizePx * 2,
      }),
      small = keys(f, m).map((e) => +attr(e, "width"));
    P.setShapeSize(f.shape, P.inches(9), P.inches(6));
    expect(keys(f, m).map((e) => +attr(e, "width"))).toEqual(small);
    const c = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(c, {
      ...c.spec,
      legend: { ...c.spec.legend, textStyle: { font: "Arial", sizePt: 27 } },
    });
    for (const key of keys(f, m))
      expect(+attr(key, "width")).toBeCloseTo(small[0] * 2, 2);
  });
  it("uses valid font bounds below one em rather than a minimum pixel size", () => {
    const f = chartLegendLayoutDeck({ sizePt: 4 }),
      result = keys(f, metrics(0.5, 0.25));
    expect(result).toHaveLength(3);
    for (const key of result) expect(+attr(key, "width")).toBeCloseTo(1.8, 2);
  });
  for (const bad of [
    {},
    { ascentPx: NaN, descentPx: 1 },
    { ascentPx: Infinity, descentPx: 0 },
    { ascentPx: -2, descentPx: 30 },
    { ascentPx: 0, descentPx: 0 },
  ])
    it(`uses an em fallback for unusable metrics ${JSON.stringify(bad)}`, () => {
      const result = keys(chartLegendLayoutDeck({ sizePt: 18 }), () => bad);
      expect(result).toHaveLength(3);
      for (const key of result)
        expect(+attr(key, "width")).toBeCloseTo(10.8, 2);
    });
});
