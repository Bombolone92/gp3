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
import {
  chartRoot,
  workbook,
  chartMarkerPaintDeck,
} from "./chart-copy-fixture.js";
import { setNativeChartCache } from "./chart-cache-availability-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  getAttrValue,
  firstChildElement,
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const child = (e, n) => firstChildElement(e, qname("", n, NS.chart));
const paint = (f) => chartRenderingView(f.shape).plotAreaPaint;
function mutate(f, edit) {
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data));
  edit(doc.root, child(child(doc.root, "chart"), "plotArea"));
  part.data = new TextEncoder().encode(serializeXml(doc));
}
const nodes = (f) => {
  const out = [];
  walkElements(parseXml(renderSlideToSvg(f.p, f.slide)).root, (e) =>
    out.push(e),
  );
  return out;
};
const normalized = (p) =>
  JSON.parse(
    JSON.stringify(p, (k, v) =>
      k === "partName" ? undefined : k === "bytes" ? Array.from(v) : v,
    ),
  );
// ST_Style table 3 against the independently authored blank theme.
// Tint is a linear-light color transform; 20% retains one fifth of the input.
const tint = (hex, t) =>
  "#" +
  hex
    .slice(1)
    .match(/../g)
    .map((c) => {
      const s = parseInt(c, 16) / 255,
        linear = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4,
        v = t * linear + 1 - t,
        result = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
      return Math.round(result * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")
    .toUpperCase();
const accents = [
  "#4F81BD",
  "#C0504D",
  "#9BBB59",
  "#8064A2",
  "#4BACC6",
  "#F79646",
];
for (const variant of [undefined, "office2010"])
  for (let style = 1; style <= 48; style++)
    it(`${variant ?? "legacy"} preset ${style} resolves independent automatic plot paint without authoring it`, () => {
      const f = chartAreaPaintDeck({ style, variant }),
        spec = P.getShapeChartSpec(f.shape),
        bytes = P._internalPackageOf(f.p)
          .getPart(chartRoot(f.shape))
          .data.slice();
      const color =
        style <= 34
          ? "#E7E7E7"
          : style <= 40
            ? variant
              ? tint(accents[style - 35], 0.2)
              : accents[style - 35]
            : "#3F3F3F";
      expect(paint(f)).toEqual(
        style <= 32 ? { kind: "none" } : { kind: "solid", color, opacity: 1 },
      );
      if (style > 32)
        expect(
          nodes(f).some(
            (e) =>
              e.name.localName === "rect" &&
              attr(e, "fill") === color &&
              +attr(e, "width") < 672,
          ),
        ).toBe(true);
      expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
      expect(spec.plotAreaFill).toBeUndefined();
      expect(
        P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
      ).toEqual(bytes);
    });
it("omitted styles have no automatic plot fill", () =>
  expect(paint(chartAreaPaintDeck())).toEqual({ kind: "none" }));
for (const kind of ["pie", "doughnut"])
  for (const style of [33, 40, 41])
    for (const plotFill of [
      undefined,
      '<a:solidFill><a:srgbClr val="19ACBE"/></a:solidFill>',
    ])
      it(`${kind} ${style} paints only an explicit plot surface`, () =>
        expect(paint(chartAreaPaintDeck({ kind, style, plotFill }))).toEqual(
          plotFill
            ? { kind: "solid", color: "#19ACBE", opacity: 1 }
            : { kind: "none" },
        ));
for (const kind of [
  "bar3DChart",
  "line3DChart",
  "area3DChart",
  "pie3DChart",
  "surfaceChart",
  "surface3DChart",
])
  for (const plotFill of [
    undefined,
    '<a:solidFill><a:srgbClr val="19ACBE"/></a:solidFill>',
  ])
    it(`${kind} keeps the automatic plot separate from its floor/walls`, () => {
      const f = chartAreaPaintDeck({ style: 33, plotFill });
      mutate(f, (_r, p) => {
        child(p, "barChart").name = qname("c", kind, NS.chart);
      });
      expect(paint(f)).toEqual(
        plotFill
          ? { kind: "solid", color: "#19ACBE", opacity: 1 }
          : { kind: "none" },
      );
    });
for (const kind of ["radar", "scatter"])
  it(`${kind} uses the same rectangular preset surface as the native reference`, () => {
    const f = chartMarkerPaintDeck(kind);
    mutate(f, (r) =>
      r.children.unshift(
        parseXml(`<c:style xmlns:c="${NS.chart}" val="33"/>`).root,
      ),
    );
    expect(paint(f)).toEqual({ kind: "solid", color: "#E7E7E7", opacity: 1 });
  });
for (const style of [2, 33, 40, 41])
  for (const [kind, plotFill] of [
    ["none", "<a:noFill/>"],
    [
      "solid",
      '<a:solidFill><a:srgbClr val="316A98"><a:alpha val="40000"/></a:srgbClr></a:solidFill>',
    ],
    ["gradient", areaGradient.replaceAll("phClr", "accent1")],
    ["pattern", areaPattern.replaceAll("phClr", "accent1")],
    ["image", areaImage],
  ])
    it(`explicit ${kind} plot paint overrides style ${style} independently of the frame`, () => {
      const f = chartAreaPaintDeck({
          style,
          plotFill,
          fill: '<a:solidFill><a:srgbClr val="A714C9"/></a:solidFill>',
          themeFill: areaPattern,
        }),
        p = paint(f);
      expect(p.kind).toBe(kind);
      expect(chartRenderingView(f.shape).areaPaint).toEqual({
        kind: "solid",
        color: "#A714C9",
        opacity: 1,
      });
      if (kind === "solid") {
        expect(p).toEqual({ kind, color: "#316A98", opacity: 0.4 });
        expect(
          nodes(f).some(
            (e) =>
              e.name.localName === "rect" &&
              attr(e, "fill") === "#316A98" &&
              attr(e, "fill-opacity") === "0.4",
          ),
        ).toBe(true);
      }
      if (kind === "gradient")
        expect(renderSlideToSvg(f.p, f.slide)).toContain("<linearGradient");
      if (kind === "pattern")
        expect(renderSlideToSvg(f.p, f.slide)).toContain("<pattern");
      if (kind === "image") {
        expect(p.image.bytes).toEqual(areaImageBytes);
        expect(nodes(f).some((e) => e.name.localName === "image")).toBe(true);
      }
    });
for (const themeOwner of ["layout", "slide", "chart"])
  for (const style of [33, 40, 41])
    for (const [kind, themeFill] of [
      [
        "solid",
        '<a:solidFill><a:schemeClr val="phClr"><a:alpha val="25000"/></a:schemeClr></a:solidFill>',
      ],
      ["gradient", areaGradient],
      ["pattern", areaPattern],
      ["image", areaImage],
    ])
      it(`${themeOwner} ${kind} subtle theme plot fill resolves preset ${style} in its owning scope`, () => {
        const f = chartAreaPaintDeck({ style, themeOwner, themeFill }),
          p = paint(f),
          base =
            style === 40
              ? accents[5]
              : tint("#182D73", style === 33 ? 0.2 : 0.95);
        expect(p.kind).toBe(kind);
        if (kind === "solid")
          expect(p).toEqual({ kind, color: base, opacity: 0.25 });
        if (kind === "gradient") {
          // Preserve transform precision until the final byte color.
          expect(p.gradient.stops[0].color).toBe(
            tint(
              style === 40 ? accents[5] : "#182D73",
              0.6 * (style === 40 ? 1 : style === 33 ? 0.2 : 0.95),
            ),
          );
          expect(p.gradient.stops[0].opacity).toBe(0.75);
        }
        if (kind === "pattern") expect(p.pattern.foreground).toBe(base);
        if (kind === "image") expect(p.image.bytes).toEqual(areaImageBytes);
      });
it("a foreign plot spPr cannot override a qualified automatic fill", () => {
  const f = chartAreaPaintDeck({ style: 41 });
  mutate(f, (_r, p) =>
    p.children.unshift(
      parseXml(
        `<foreign:spPr xmlns:foreign="urn:foreign" xmlns:a="${NS.dml}"><a:noFill/></foreign:spPr>`,
      ).root,
    ),
  );
  expect(paint(f)).toEqual({ kind: "solid", color: "#3F3F3F", opacity: 1 });
});
it("plot gradient/pattern/image do not round their corners when the chart frame is rounded", () => {
  for (const plotFill of [areaGradient, areaPattern, areaImage]) {
    const f = chartAreaPaintDeck({ style: 33, roundedCorners: true, plotFill }),
      rects = nodes(f).filter((e) => e.name.localName === "rect");
    expect(
      rects.some((e) => attr(e, "rx") === "6" && +attr(e, "width") === 672),
    ).toBe(true);
    expect(
      rects
        .filter((e) => +attr(e, "width") < 672)
        .every((e) => attr(e, "rx") === null),
    ).toBe(true);
  }
});
it("missing numeric caches retain the chart frame without drawing its explicit plot", () => {
  const f = chartAreaPaintDeck({
    style: 41,
    plotFill: '<a:solidFill><a:srgbClr val="19ACBE"/></a:solidFill>',
  });
  setNativeChartCache(f, { indices: [0, 1, 2] });
  expect(paint(f).kind).toBe("solid");
  expect(renderSlideToSvg(f.p, f.slide)).not.toContain("#19ACBE");
});
for (const [kind, options] of [
  ["automatic", { style: 40, variant: "office2010" }],
  ["gradient", { style: 33, themeFill: areaGradient }],
  [
    "pattern",
    { style: 41, plotFill: areaPattern.replaceAll("phClr", "accent2") },
  ],
  ["image", { style: 33, themeFill: areaImage }],
])
  it(`${kind} plot paint survives export, cross-document transfer both ways and copied data edit`, async () => {
    const f = chartAreaPaintDeck(options),
      expected = normalized(paint(f)),
      raw = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data.slice(),
      book = workbook(f.p, f.shape).data.slice(),
      q = createDeck("blank"),
      slide = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      chart = P.getSlideCharts(slide)[0];
    expect(normalized(chartRenderingView(chart.shape).plotAreaPaint)).toEqual(
      expected,
    );
    expect(
      P._internalPackageOf(q).getPart(chartRoot(chart.shape)).data,
    ).toEqual(raw);
    expect(workbook(q, chart.shape).data).toEqual(book);
    P.setChartSpec(chart, {
      ...chart.spec,
      title: "Editable plot",
      series: chart.spec.series.map((s) => ({ ...s, values: [7, 5] })),
    });
    const saved = await P.loadPresentation(await P.savePresentation(q)),
      edited = P.getSlideCharts(P.getSlides(saved)[1])[0];
    expect(normalized(chartRenderingView(edited.shape).plotAreaPaint)).toEqual(
      expected,
    );
    expect(edited.spec.series[0].values).toEqual([7, 5]);
    const returned = P.importSlide(
        f.p,
        P.getSlides(saved)[1],
        P.getSlideLayouts(f.p)[0],
      ),
      c = P.getSlideCharts(returned)[0];
    expect(normalized(chartRenderingView(c.shape).plotAreaPaint)).toEqual(
      expected,
    );
    expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([2, 4]);
    expect(P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data).toEqual(
      raw,
    );
    expect(workbook(f.p, f.shape).data).toEqual(book);
    expect(P.validatePresentation(f.p)).toEqual([]);
  });
