import { expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { chartRenderingView } from "../lib/pptx/src/api/fn/charts.ts";
import { chartNoFillDeck } from "./chart-no-fill-fixture.js";
import { chartPercentageComboDeck } from "./chart-percentage-stacks-fixture.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import { nativeChartSeriesHosts } from "../lib/pptx/src/internal/chartml/native-data.ts";
import {
  NS,
  parseXml,
  serializeXml,
  walkElements,
  getAttrValue,
  firstChildElement,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
const kinds = [
  "bar",
  "column",
  "line",
  "area",
  "pie",
  "doughnut",
  "scatter",
  "radar",
  "bubble",
];
const filled = kinds.filter((k) => !["line", "scatter"].includes(k));
const points = ["bar", "column", "pie", "doughnut", "bubble"];
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const child = (e, n, ns = NS.chart) =>
  e && firstChildElement(e, qname("", n, ns));
const shapes = new Set(["rect", "path", "circle", "polygon"]);
function paint(f) {
  const nodes = [],
    svg = renderSlideToSvg(f.p, f.slide, { stableDefinitionIds: true });
  walkElements(parseXml(svg).root, (e) => nodes.push(e));
  return { svg, nodes };
}
function changeXml(f, change) {
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data));
  change(doc);
  part.data = new TextEncoder().encode(serializeXml(doc));
}
for (const kind of filled)
  it(`${kind} explicit noFill preserves body geometry, independent outline and legend keys`, () => {
    const f = chartNoFillDeck({ kind }),
      spec = P.getShapeChartSpec(f.shape),
      raw = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data.slice(),
      r = paint(f);
    const lines = spec.series.map((s) => s.lineColor),
      bodies = r.nodes.filter(
        (e) =>
          shapes.has(e.name.localName) && lines.includes(attr(e, "stroke")),
      );
    expect(bodies.length).toBeGreaterThan(spec.series.length);
    for (const e of bodies) {
      expect(attr(e, "fill")).toBe("none");
      expect(attr(e, "stroke-opacity")).toBe("0.7");
    }
    expect(
      chartRenderingView(f.shape).seriesOpacities.every((s) => s.fill === null),
    ).toBe(true);
    expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
    expect(P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data).toEqual(
      raw,
    );
    expect(r.svg).not.toMatch(/NaN|Infinity|opacity="null"/);
  });
for (const kind of ["line", "scatter"])
  for (const markerFill of ["solid", "none"])
    it(`${kind} noFill body leaves its line and ${markerFill} marker channels independent`, () => {
      const f = chartNoFillDeck({ kind, markerFill }),
        spec = P.getShapeChartSpec(f.shape),
        r = paint(f),
        first = spec.series[0];
      const markers = r.nodes.filter(
        (e) => attr(e, "stroke") === first.markerStrokeColor,
      );
      expect(markers).toHaveLength(4);
      for (const e of markers) {
        expect(attr(e, "fill")).toBe(
          markerFill === "none" ? "none" : first.markerFill,
        );
        expect(attr(e, "stroke-opacity")).toBe("0.6");
      }
      expect(
        r.nodes.filter(
          (e) =>
            e.name.localName === "path" &&
            attr(e, "stroke") === first.lineColor &&
            attr(e, "stroke-opacity") === "0.7",
        ).length,
      ).toBeGreaterThan(0);
    });
for (const kind of filled)
  for (const fill of ["absent", "solid"])
    it(`${kind} ${fill} body paint remains distinct from explicit noFill and alpha zero`, () => {
      const f = chartNoFillDeck({ kind, fill, opacity: 0 }),
        r = paint(f),
        view = chartRenderingView(f.shape);
      expect(view.seriesOpacities[0].fill).toBe(
        fill === "solid" ? 0 : undefined,
      );
      const lines = P.getShapeChartSpec(f.shape).series.map((s) => s.lineColor);
      expect(
        r.nodes.some(
          (e) =>
            shapes.has(e.name.localName) &&
            lines.includes(attr(e, "stroke")) &&
            attr(e, "fill") !== "none",
        ),
      ).toBe(true);
      if (fill === "solid")
        expect(r.nodes.some((e) => attr(e, "fill-opacity") === "0")).toBe(true);
    });
for (const kind of points)
  for (const fill of ["solid", "none"])
    it(`${kind} sparse ${fill === "solid" ? "noFill" : "solid"} point overrides a ${fill} series`, () => {
      const f = chartNoFillDeck({
          kind,
          fill,
          pointFill: fill === "solid" ? "none" : "solid",
        }),
        r = paint(f),
        view = chartRenderingView(f.shape);
      expect(view.seriesOpacities[0].points.get(1)).toBe(
        fill === "solid" ? null : 0.25,
      );
      const targets = r.nodes.filter(
        (e) =>
          shapes.has(e.name.localName) &&
          // A point spPr owns its outline independently of the series.
          attr(e, "stroke") === "none" &&
          attr(e, "fill") === (fill === "solid" ? "none" : "#CC55AA"),
      );
      expect(targets.length).toBeGreaterThanOrEqual(
        ["pie", "doughnut"].includes(kind) ? 2 : 1,
      );
      if (fill === "none")
        for (const e of targets) expect(attr(e, "fill-opacity")).toBe("0.25");
    });
const signed = (negativeColor) => [
  {
    name: "Signed",
    values: [-2, 4, -3],
    color: "#E85239",
    negativeColor,
    invertIfNegative: true,
    lineColor: null,
  },
];
for (const kind of ["bar", "column"])
  for (const negativeColor of ["#00AA77", "#FFFFFF", undefined])
    it(`${kind} noFill suppresses ordinary and ${negativeColor ?? "default"} inverted bodies without inventing a legacy outline`, () => {
      const f = chartNoFillDeck({ kind, series: signed(negativeColor) }),
        r = paint(f),
        bars = r.nodes.filter(
          (e) => e.name.localName === "rect" && attr(e, "clip-path"),
        );
      expect(bars).toHaveLength(3);
      for (const e of bars) {
        expect(attr(e, "fill")).toBe("none");
        expect(attr(e, "stroke")).toBe("none");
      }
    });
for (const kind of ["bar", "column"])
  for (const pointIndex of [0, 1])
    for (const fill of ["solid", "none"])
      it(`${kind} signed point ${pointIndex} ${fill} series respects point paint before inversion`, () => {
        const f = chartNoFillDeck({
            kind,
            fill,
            pointFill: fill === "solid" ? "none" : "solid",
            pointIndex,
            series: signed("#00AA77"),
          }),
          bars = paint(f).nodes.filter(
            (e) => e.name.localName === "rect" && attr(e, "clip-path"),
          );
        expect(bars).toHaveLength(3);
        expect(bars.map((e) => attr(e, "fill"))).toEqual(
          fill === "solid"
            ? pointIndex === 0
              ? ["none", "#E85239", "#00AA77"]
              : ["#00AA77", "none", "#00AA77"]
            : pointIndex === 0
              ? ["#FFFFFF", "none", "none"]
              : ["none", "#CC55AA", "none"],
        );
        if (fill === "none" && pointIndex === 0) {
          expect(attr(bars[0], "fill-opacity")).toBe("0.25");
          expect(attr(bars[0], "stroke")).toBe("#000000");
          expect(attr(bars[0], "stroke-opacity")).toBeNull();
        }
      });
for (const kind of kinds)
  it(`${kind} noFill native XML, caches and workbook survive transfer and save/reimport`, async () => {
    const f = chartNoFillDeck({
        kind,
        pointFill: points.includes(kind) ? "solid" : undefined,
      }),
      spec = P.getShapeChartSpec(f.shape),
      raw = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data.slice(),
      book = workbook(f.p, f.shape).data.slice(),
      q = createDeck("blank"),
      slide = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      before = renderSlideToSvg(q, slide, { stableDefinitionIds: true }),
      saved = await P.loadPresentation(await P.savePresentation(q)),
      imported = P.getSlides(saved).at(-1),
      chart = P.getSlideCharts(imported)[0];
    expect(chart.spec).toEqual(spec);
    expect(
      P._internalPackageOf(saved).getPart(chartRoot(chart.shape)).data,
    ).toEqual(raw);
    expect(workbook(saved, chart.shape).data).toEqual(book);
    expect(
      renderSlideToSvg(saved, imported, { stableDefinitionIds: true }),
    ).toBe(before);
    expect(P.validatePresentation(saved)).toEqual([]);
  });
for (const kind of kinds.slice(0, 6))
  it(`${kind} data/title edits retain noFill while an explicit RGB edit replaces it`, () => {
    const f = chartNoFillDeck({ kind, pointFill: "none" }),
      spec = P.getShapeChartSpec(f.shape);
    P.setChartSpec(P.getSlideCharts(f.slide)[0], {
      ...spec,
      title: "Edited",
      series: spec.series.map((s) => ({
        ...s,
        values: s.values.map((v) => v + 2),
      })),
    });
    expect(chartRenderingView(f.shape).seriesOpacities[0].fill).toBeNull();
    expect(
      chartRenderingView(f.shape).seriesOpacities[0].points.get(1),
    ).toBeNull();
    P.setChartSpec(P.getSlideCharts(f.slide)[0], {
      ...P.getShapeChartSpec(f.shape),
      series: P.getShapeChartSpec(f.shape).series.map((s, i) =>
        i ? s : { ...s, color: "#889922" },
      ),
    });
    expect(chartRenderingView(f.shape).seriesOpacities[0].fill).toBe(1);
    expect(
      chartRenderingView(f.shape).seriesOpacities[0].points.get(1),
    ).toBeNull();
  });
for (const secondary of [false, true])
  it(`combo groups keep independent noFill with secondary axis ${secondary}`, () => {
    const f = chartPercentageComboDeck({ secondary });
    changeXml(f, (doc) => {
      for (const [i, { series }] of nativeChartSeriesHosts(
        doc.root,
      ).entries()) {
        if (i % 2) continue;
        const sp = child(series, "spPr");
        sp.children = sp.children.filter(
          (e) => e.kind !== "element" || e.name.localName !== "solidFill",
        );
        sp.children.unshift(parseXml(`<a:noFill xmlns:a="${NS.dml}"/>`).root);
      }
    });
    expect(
      chartRenderingView(f.shape).seriesOpacities.map((s) => s.fill),
    ).toEqual([null, 1, null, 1]);
    const r = paint(f);
    expect(
      r.nodes.some(
        (e) =>
          attr(e, "fill") === "none" &&
          e.name.localName === "rect" &&
          attr(e, "clip-path"),
      ),
    ).toBe(true);
    expect(r.svg).not.toMatch(/NaN|Infinity/);
  });
it("out-of-cache noFill points stay sparse and an outline noFill does not suppress a solid body", () => {
  const f = chartNoFillDeck({
      fill: "solid",
      pointFill: "none",
      pointIndex: 4096,
      series: signed("#00AA77"),
    }),
    view = chartRenderingView(f.shape);
  expect(view.seriesOpacities[0].points).toBeUndefined();
  expect(view.seriesOpacities[0].fill).toBe(0.35);
  expect(paint(f).svg).not.toMatch(/NaN|Infinity/);
});
it("bubble point noFill retains its native index when an earlier cache cell is missing", () => {
  const f = chartNoFillDeck({
    kind: "bubble",
    fill: "solid",
    pointFill: "none",
  });
  changeXml(f, (doc) => {
    const series = nativeChartSeriesHosts(doc.root)[0].series,
      cache = child(child(child(series, "yVal"), "numRef"), "numCache");
    cache.children = cache.children.filter(
      (e) =>
        e.kind !== "element" ||
        e.name.localName !== "pt" ||
        attr(e, "idx") !== "0",
    );
  });
  const nodes = paint(f).nodes.filter(
    (e) => e.name.localName === "circle" && attr(e, "fill") === "none",
  );
  expect(nodes).toHaveLength(3);
  expect(new Set(nodes.map((e) => attr(e, "cx"))).size).toBe(1);
});
