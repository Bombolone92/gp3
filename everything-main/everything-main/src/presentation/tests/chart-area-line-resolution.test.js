import { expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { chartRenderingView } from "../lib/pptx/src/api/fn/charts.ts";
import {
  chartAreaPaintDeck,
  chartLineTheme,
  areaGradient,
  areaPattern,
} from "./chart-area-paint-fixture.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import { setNativeChartCache } from "./chart-cache-availability-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  getAttrValue,
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const child = (e, n, ns = NS.chart) => firstChildElement(e, qname("", n, ns));
const color =
  '<a:solidFill><a:srgbClr val="1B7CA3"><a:alpha val="40000"/></a:srgbClr></a:solidFill>';
const modes = {
  automatic: undefined,
  empty: "<a:ln/>",
  width: '<a:ln w="76200"/>',
  color: `<a:ln>${color}</a:ln>`,
  dash: '<a:ln><a:prstDash val="dashDot"/></a:ln>',
  zero: `<a:ln w="0">${color}</a:ln>`,
  none: "<a:ln><a:noFill/></a:ln>",
  solidEmpty: "<a:ln><a:solidFill/></a:ln>",
};
const line = (f, area = "chart") =>
  chartRenderingView(f.shape)[area === "chart" ? "areaLine" : "plotAreaLine"];
const fixture = (area, xml, options = {}) =>
  chartAreaPaintDeck({
    [area === "chart" ? "line" : "plotLine"]: xml,
    ...options,
  });
function nodes(f) {
  const elements = [];
  walkElements(parseXml(renderSlideToSvg(f.p, f.slide)).root, (e) =>
    elements.push(e),
  );
  return elements;
}
function rect(f, area = "chart") {
  return nodes(f).find(
    (e) =>
      e.name.localName === "rect" &&
      (area === "chart"
        ? +attr(e, "width") === 672
        : attr(e, "fill") === "none" &&
          attr(e, "stroke") !== "none" &&
          +attr(e, "width") < 672),
  );
}
const native = (f) => P._internalPackageOf(f.p).getPart(chartRoot(f.shape));
function nativeLine(f, area) {
  const root = parseXml(new TextDecoder().decode(native(f).data)).root,
    host = area === "chart" ? root : child(child(root, "chart"), "plotArea"),
    sp = child(host, "spPr"),
    ln = sp && child(sp, "ln", NS.dml);
  return ln && serializeXml({ root: ln, prolog: [], epilog: [] });
}
for (const variant of [undefined, "office2010"])
  for (let style = 1; style <= 48; style++)
    it(`${variant ?? "legacy"} ${style} resolves automatic chart outlines without authoring settings`, () => {
      const f = chartAreaPaintDeck({ style, variant }),
        before = native(f).data.slice(),
        spec = P.getShapeChartSpec(f.shape),
        paint =
          style >= 33 && style <= 40
            ? { kind: "solid", color: "#868686", opacity: 1 }
            : { kind: "none" };
      expect(line(f).paint).toEqual(paint);
      expect(line(f).widthEmu).toBe(9525);
      expect(line(f, "plot").paint).toEqual({ kind: "none" });
      expect(attr(rect(f), "stroke")).toBe(paint.color ?? "none");
      expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
      expect(spec.chartAreaStrokeColor).toBeUndefined();
      expect(spec.chartAreaStrokeWidthEmu).toBeUndefined();
      expect(native(f).data).toEqual(before);
    });
it("an unspecified chart style retains no automatic outline", () => {
  const f = chartAreaPaintDeck();
  expect(line(f).paint.kind).toBe("none");
  expect(P.getShapeChartSpec(f.shape).chartStyle).toBeUndefined();
});
for (const area of ["chart", "plot"])
  for (const style of [2, 33, 41])
    for (const [mode, xml] of Object.entries(modes))
      it(`${area} ${style} ${mode} retains independent native paint and width`, () => {
        const f = fixture(area, xml, { style }),
          before = native(f).data.slice(),
          v = line(f, area),
          automatic = area === "chart" && style === 33;
        const paint =
          mode === "color" || mode === "zero"
            ? { kind: "solid", color: "#1B7CA3", opacity: 0.4 }
            : mode === "solidEmpty"
              ? {
                  kind: "solid",
                  color: automatic ? "#868686" : "#000000",
                  opacity: 1,
                }
              : mode === "none" || !automatic
                ? { kind: "none" }
                : { kind: "solid", color: "#868686", opacity: 1 };
        expect(v.paint).toEqual(paint);
        expect(v.widthEmu).toBe(
          mode === "width" ? 76200 : mode === "zero" ? 0 : 9525,
        );
        if (area === "chart" || paint.kind !== "none") {
          const r = rect(f, area);
          expect(attr(r, "stroke")).toBe(paint.color ?? "none");
          expect(+attr(r, "stroke-width")).toBe(v.widthEmu / 9525);
          if (mode === "color") expect(+attr(r, "stroke-opacity")).toBe(0.4);
          if (mode === "dash" && paint.kind !== "none")
            expect(attr(r, "stroke-dasharray")).toBe("4 3 1 3");
        }
        expect(native(f).data).toEqual(before);
      });
for (const themeOwner of ["layout", "slide", "chart"])
  for (const area of ["chart", "plot"])
    for (const style of [2, 33, 41])
      for (const mode of ["automatic", "empty", "width", "color"])
        it(`${themeOwner} theme ${area} ${style} ${mode} cascades each property independently`, () => {
          const f = fixture(area, modes[mode], {
              style,
              variant: "office2010",
              themeOwner,
              themeLine: chartLineTheme,
            }),
            v = line(f, area),
            themed = area === "chart" && style <= 40;
          expect(v.widthEmu).toBe(
            mode === "width" ? 76200 : themed ? 57150 : 9525,
          );
          expect(v.cap).toBe(themed ? "rnd" : "flat");
          expect(v.dash).toEqual(
            themed ? { kind: "preset", value: "sysDot" } : null,
          );
          expect(v.join).toEqual({ kind: themed ? "bevel" : "round" });
          expect(v.paint).toEqual(
            mode === "color"
              ? { kind: "solid", color: "#1B7CA3", opacity: 0.4 }
              : area === "chart" && style === 33
                ? { kind: "solid", color: "#76788D", opacity: 0.6 }
                : { kind: "none" },
          );
          if (v.paint.kind !== "none") {
            const r = rect(f, area);
            expect(+attr(r, "stroke-width")).toBe(v.widthEmu / 9525);
            if (themed) {
              expect(attr(r, "stroke-linecap")).toBe("round");
              expect(attr(r, "stroke-dasharray")).toBe(
                `0 ${(v.widthEmu / 9525) * 2}`,
              );
            }
          }
        });
for (const area of ["chart", "plot"])
  for (const [kind, paint] of [
    ["gradient", areaGradient],
    ["pattern", areaPattern],
  ])
    it(`${area} honors native ${kind} stroke paint and its alpha`, () => {
      const f = fixture(
        area,
        `<a:ln w="76200">${paint.replaceAll("phClr", "accent2")}</a:ln>`,
        { style: 33 },
      );
      expect(line(f, area).paint.kind).toBe(kind);
      const r = rect(f, area);
      expect(attr(r, "stroke")).toMatch(/^url\(#/);
      expect(+attr(r, "stroke-width")).toBe(8);
      expect(attr(r, "fill")).toBe(area === "chart" ? "#FFFFFF" : "none");
      expect(renderSlideToSvg(f.p, f.slide)).toContain(
        kind === "gradient" ? "<linearGradient" : "<pattern",
      );
    });
for (const [kind, paint] of [
  ["gradient", areaGradient],
  ["pattern", areaPattern],
])
  it(`binds a theme ${kind} line to the chart preset color before transforms`, () => {
    const f = chartAreaPaintDeck({
        style: 33,
        themeLine: `<a:ln w="28575">${paint}</a:ln>`,
      }),
      v = line(f);
    expect(v.paint.kind).toBe(kind);
    expect(v.widthEmu).toBe(28575);
    if (kind === "gradient")
      expect(v.paint.gradient.stops[0].opacity).toBe(0.75);
    else expect(v.paint.pattern.foregroundOpacity).toBe(0.6);
    expect(attr(rect(f), "stroke")).toMatch(/^url\(#/);
  });
it("uses explicit cap, dash, join and width over a themed line independently", () => {
  const f = fixture(
      "chart",
      `<a:ln w="31750" cap="sq">${color}<a:custDash><a:ds d="250%" sp="75%"/><a:ds d="50000" sp="200000"/></a:custDash><a:miter lim="350000"/></a:ln>`,
      { style: 33, themeLine: chartLineTheme },
    ),
    v = line(f),
    r = rect(f);
  expect(v).toMatchObject({
    widthEmu: 31750,
    cap: "sq",
    dash: {
      kind: "custom",
      stops: [
        { dash: 2.5, space: 0.75 },
        { dash: 0.5, space: 2 },
      ],
    },
    join: { kind: "miter", limit: 3.5 },
  });
  expect(attr(r, "stroke-linecap")).toBe("square");
  expect(attr(r, "stroke-linejoin")).toBe("miter");
  expect(+attr(r, "stroke-miterlimit")).toBe(3.5);
  expect(attr(r, "stroke-dasharray").split(" ").map(Number)).toEqual(
    [2.5, 0.75, 0.5, 2].map((n) => (n * 31750) / 9525),
  );
});
for (const raw of ["-1", "20116801", "1e4", "NaN", "9525.0"])
  it(`malformed width ${raw} inherits the theme without changing XML`, () => {
    const f = fixture(
        "chart",
        `<a:ln w="${raw}" cap="foreign"><a:prstDash val="unknown"/></a:ln>`,
        { style: 33, themeLine: chartLineTheme },
      ),
      before = native(f).data.slice();
    expect(line(f).widthEmu).toBe(57150);
    expect(line(f).cap).toBe("rnd");
    expect(line(f).dash).toEqual({ kind: "preset", value: "sysDot" });
    expect(native(f).data).toEqual(before);
  });
it("ignores foreign fill/line properties and keeps a qualified noFill atomic", () => {
  const f = fixture(
    "chart",
    '<a:ln xmlns:x="urn:foreign" x:w="76200" x:cap="sq"><x:solidFill/><x:prstDash val="dash"/><a:noFill/><x:round/></a:ln>',
    { style: 33, themeLine: chartLineTheme },
  );
  expect(line(f)).toMatchObject({
    paint: { kind: "none" },
    widthEmu: 57150,
    cap: "rnd",
    join: { kind: "bevel" },
  });
});
it("an absent subtle line does not invent an automatic outline", () => {
  const f = chartAreaPaintDeck({ style: 33, themeLine: chartLineTheme }),
    pkg = P._internalPackageOf(f.p),
    part = pkg.getPart("/ppt/theme/own-chart-paint.xml"),
    doc = parseXml(new TextDecoder().decode(part.data)),
    fmt = child(doc.root, "fmtScheme", NS.dml);
  child(fmt, "lnStyleLst", NS.dml).children = [];
  part.data = new TextEncoder().encode(serializeXml(doc));
  expect(line(f).paint.kind).toBe("none");
  expect(line(f).widthEmu).toBe(9525);
});
it("all missing caches retain the frame's resolved outline and suppress the independent plot", () => {
  const f = chartAreaPaintDeck({
    style: 33,
    themeLine: chartLineTheme,
    plotLine: `<a:ln>${color}</a:ln>`,
  });
  setNativeChartCache(f, { indices: [0, 1, 2], cache: "missing" });
  const r = rect(f);
  expect(attr(r, "stroke")).toBe("#76788D");
  expect(attr(r, "stroke-dasharray")).toBe("0 12");
  expect(nodes(f).filter((e) => attr(e, "stroke") === "#1B7CA3")).toEqual([]);
});
for (const area of ["chart", "plot"])
  for (const [mode, xml] of [
    ["automatic", undefined],
    ["none", modes.none],
    ["zero", modes.zero],
    ["alpha", modes.color],
    [
      "gradient",
      `<a:ln w="31750">${areaGradient.replaceAll("phClr", "accent2")}</a:ln>`,
    ],
    [
      "pattern",
      `<a:ln w="57150">${areaPattern.replaceAll("phClr", "accent2")}</a:ln>`,
    ],
  ])
    it(`${area} ${mode} stays editable through transfers both ways and a copied data edit`, async () => {
      const f = fixture(area, xml, { style: 33, themeLine: chartLineTheme }),
        expected = line(f, area),
        before = native(f).data.slice(),
        rawLine = nativeLine(f, area),
        book = workbook(f.p, f.shape).data.slice(),
        spec = P.getShapeChartSpec(f.shape),
        q = createDeck("blank"),
        to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
        back = P.importSlide(f.p, to, P.getSlideLayout(f.slide));
      for (const [p, slide] of [
        [q, to],
        [f.p, back],
      ]) {
        const c = P.getSlideCharts(slide)[0],
          copy = { p, slide, shape: c.shape };
        expect(line(copy, area)).toEqual(expected);
        expect(nativeLine(copy, area)).toBe(rawLine);
        expect(workbook(p, c.shape).data).toEqual(book);
        expect(c.spec).toEqual(spec);
      }
      const copied = P.getSlideCharts(back)[0];
      P.setChartSpec(copied, {
        ...copied.spec,
        title: "Edited copied data",
        series: copied.spec.series.map((s) => ({ ...s, values: [7, 5] })),
      });
      expect(native(f).data).toEqual(before);
      expect(workbook(f.p, f.shape).data).toEqual(book);
      const reopened = await P.loadPresentation(await P.savePresentation(f.p)),
        slide = P.getSlides(reopened).at(-1),
        edited = P.getSlideCharts(slide)[0],
        copy = { p: reopened, slide, shape: edited.shape };
      expect(line(copy, area)).toEqual(expected);
      expect(nativeLine(copy, area)).toBe(rawLine);
      expect(edited.spec.series[0].values).toEqual([7, 5]);
      expect(P.validatePresentation(reopened)).toEqual([]);
    });

for (const cap of ["flat", "rnd", "sq"])
  it(`projects native ${cap} custom-dash lengths without losing cap semantics`, () => {
    const f = fixture(
      "chart",
      `<a:ln w="38100" cap="${cap}">${color}<a:custDash><a:ds d="250000" sp="150000"/></a:custDash></a:ln>`,
    );
    expect(attr(rect(f), "stroke-dasharray")).toBe(
      cap === "rnd" ? "6 10" : "10 6",
    );
  });
