import { expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { chartRenderingView } from "../lib/pptx/src/api/fn/charts.ts";
import {
  chartAreaPaintDeck,
  areaGradient,
  areaPattern,
  areaImage,
  areaImageBytes,
} from "./chart-area-paint-fixture.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import { setNativeChartCache } from "./chart-cache-availability-fixture.js";
import {
  NS,
  parseXml,
  getAttrValue,
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const paint = (f) => chartRenderingView(f.shape).areaPaint;
function backdrop(f) {
  const nodes = [];
  walkElements(parseXml(renderSlideToSvg(f.p, f.slide)).root, (e) =>
    nodes.push(e),
  );
  return nodes.find(
    (e) =>
      e.name.localName === "rect" &&
      +attr(e, "x") === 96 &&
      +attr(e, "width") === 672,
  );
}
for (const variant of [undefined, "office2010"])
  for (let style = 1; style <= 48; style++)
    it(`${variant ?? "legacy"} preset ${style} uses native automatic chart-area paint without authoring a fill`, () => {
      const f = chartAreaPaintDeck({ style, variant }),
        native = P._internalPackageOf(f.p)
          .getPart(chartRoot(f.shape))
          .data.slice(),
        spec = P.getShapeChartSpec(f.shape);
      expect(paint(f)).toEqual(
        style <= 32
          ? { kind: "none" }
          : {
              kind: "solid",
              color: style <= 40 ? "#FFFFFF" : "#000000",
              opacity: 1,
            },
      );
      expect(attr(backdrop(f), "fill")).toBe(
        style <= 32 ? "none" : style <= 40 ? "#FFFFFF" : "#000000",
      );
      expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
      expect(spec.chartAreaFill).toBeUndefined();
      expect(
        P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
      ).toEqual(native);
    });
it("an omitted preset remains transparent and unspecified", () => {
  const f = chartAreaPaintDeck({ style: undefined });
  expect(paint(f)).toEqual({ kind: "none" });
  expect(P.getShapeChartSpec(f.shape).chartStyle).toBeUndefined();
});
for (const themeOwner of ["layout", "slide", "chart"])
  for (const style of [2, 33, 41])
    for (const [kind, themeFill] of [
      [
        "solid",
        '<a:solidFill><a:schemeClr val="phClr"><a:alpha val="25000"/></a:schemeClr></a:solidFill>',
      ],
      ["gradient", areaGradient],
      ["pattern", areaPattern],
    ])
      it(`${themeOwner} ${kind} theme subtle fill is bound to preset ${style} in the read-only view`, () => {
        const f = chartAreaPaintDeck({ style, themeOwner, themeFill }),
          p = paint(f);
        if (style === 2) {
          expect(p).toEqual({ kind: "none" });
          return;
        }
        expect(p.kind).toBe(kind);
        const color = style === 33 ? "#B4E57D" : "#182D73";
        if (kind === "solid") {
          expect(p).toEqual({ kind, color, opacity: 0.25 });
          expect(attr(backdrop(f), "fill-opacity")).toBe("0.25");
        }
        if (kind === "gradient") {
          expect(p.gradient.stops).toHaveLength(2);
          expect(p.gradient.stops[0].opacity).toBe(0.75);
          expect(p.gradient.angleDeg).toBe(90);
          expect(p.gradient.scaled).toBe(true);
          expect(renderSlideToSvg(f.p, f.slide)).toContain("<linearGradient");
        }
        if (kind === "pattern") {
          expect(p.pattern.foreground).toBe(color);
          expect(p.pattern.foregroundOpacity).toBe(0.6);
          expect(p.pattern.backgroundOpacity).toBe(0.3);
          expect(renderSlideToSvg(f.p, f.slide)).toContain("<pattern");
        }
        expect(P.getShapeChartSpec(f.shape).chartAreaFill).toBeUndefined();
      });
for (const style of [2, 33, 41])
  for (const [kind, fill] of [
    ["none", "<a:noFill/>"],
    [
      "solid",
      '<a:solidFill><a:srgbClr val="316A98"><a:alpha val="40000"/></a:srgbClr></a:solidFill>',
    ],
    ["gradient", areaGradient.replaceAll("phClr", "accent1")],
    ["pattern", areaPattern.replaceAll("phClr", "accent1")],
  ])
    it(`explicit ${kind} paint wins over preset ${style}`, () => {
      const f = chartAreaPaintDeck({ style, themeFill: areaGradient, fill }),
        p = paint(f);
      expect(p.kind).toBe(kind);
      if (kind === "solid")
        expect(p).toEqual({ kind, color: "#316A98", opacity: 0.4 });
    });
for (const style of [2, 33, 41])
  for (const kind of ["column", "pie"])
    it(`${kind} ${style} missing caches retain the correct paint inside the native frame`, () => {
      const f = chartAreaPaintDeck({ kind, style });
      setNativeChartCache(f, { indices: [0, 1, 2] });
      const e = backdrop(f);
      expect(e).toBeDefined();
      expect(["x", "y", "width", "height"].map((n) => +attr(e, n))).toEqual([
        96, 96, 672, 384,
      ]);
      expect(attr(e, "fill")).toBe(
        style === 2 ? "none" : style === 33 ? "#FFFFFF" : "#000000",
      );
    });
for (const themeFill of [areaGradient, areaPattern])
  it("themed chart-area paint survives cross-document copy, export, data edit and return with native style retained", async () => {
    const f = chartAreaPaintDeck({
        style: 41,
        variant: "office2010",
        themeFill,
      }),
      expected = paint(f),
      spec = P.getShapeChartSpec(f.shape),
      native = P._internalPackageOf(f.p)
        .getPart(chartRoot(f.shape))
        .data.slice(),
      book = workbook(f.p, f.shape).data.slice(),
      q = createDeck("blank"),
      slide = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      shape = P.getSlideCharts(slide)[0].shape;
    expect(paint({ shape })).toEqual(expected);
    expect(workbook(q, shape).data).toEqual(book);
    P.setChartSpec(
      { shape, spec: P.getShapeChartSpec(shape) },
      {
        ...P.getShapeChartSpec(shape),
        series: spec.series.map((s) => ({
          ...s,
          values: s.values.map((n) => n + 2),
        })),
      },
    );
    expect(paint({ shape })).toEqual(expected);
    const r = await P.loadPresentation(await P.savePresentation(q)),
      rs = P.getSlideCharts(P.getSlides(r).at(-1))[0].shape;
    expect(paint({ shape: rs })).toEqual(expected);
    const back = P.importSlide(
      f.p,
      P.getSlides(r).at(-1),
      P.getSlideLayout(f.slide),
    );
    expect(paint({ shape: P.getSlideCharts(back)[0].shape })).toEqual(expected);
    expect(P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data).toEqual(
      native,
    );
    expect(P.getShapeChartSpec(rs).chartAreaFill).toBeUndefined();
    expect(P.validatePresentation(r)).toEqual([]);
  });

for (const source of ["direct", "theme"])
  it(`${source} image fill resolves the declaration owner and retains image data across copy and edits`, async () => {
    const f = chartAreaPaintDeck({
        style: 41,
        ...(source === "direct"
          ? { fill: areaImage }
          : { themeFill: areaImage }),
      }),
      expected = paint(f);
    expect(expected.kind).toBe("image");
    expect(expected.image.bytes).toEqual(areaImageBytes);
    expect(expected.image.opacity).toBe(0.6);
    expect(expected.image.crop.left).toBe(0.125);
    expect(renderSlideToSvg(f.p, f.slide)).toContain("data:image/png;base64,");
    const p = createDeck("blank"),
      slide = P.importSlide(p, f.slide, P.getSlideLayouts(p)[0]),
      shape = P.getSlideCharts(slide)[0].shape;
    expect(paint({ shape }).image.bytes).toEqual(areaImageBytes);
    P.setChartSpec(
      { shape, spec: P.getShapeChartSpec(shape) },
      { ...P.getShapeChartSpec(shape), title: "Edited title" },
    );
    const r = await P.loadPresentation(await P.savePresentation(p)),
      rs = P.getSlideCharts(P.getSlides(r).at(-1))[0].shape;
    expect(paint({ shape: rs }).image.bytes).toEqual(areaImageBytes);
    expect(P.validatePresentation(r)).toEqual([]);
  });
