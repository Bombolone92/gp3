import { expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { chartRenderingView } from "../lib/pptx/src/api/fn/charts.ts";
import { chartPercentageComboDeck } from "./chart-percentage-stacks-fixture.js";
import { chartSeriesOpacityDeck } from "./chart-series-opacity-fixture.js";
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
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const alpha = (e, channel) => Number(attr(e, channel + "-opacity") ?? 1);
const child = (e, n, ns = NS.chart) =>
  e && firstChildElement(e, qname("", n, ns));
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
for (const kind of kinds)
  for (const opacity of [0, 0.35, 1])
    it(`${kind} retains independent solid alpha ${opacity} on bodies, outlines and legend keys`, () => {
      const f = chartSeriesOpacityDeck({ kind, opacity, lineOpacity: opacity }),
        spec = P.getShapeChartSpec(f.shape),
        raw = P._internalPackageOf(f.p)
          .getPart(chartRoot(f.shape))
          .data.slice(),
        r = paint(f),
        colors = spec.series.map((s) => s.color),
        lines = spec.series.map((s) => s.lineColor ?? s.color);
      if (!["line", "scatter"].includes(kind)) {
        const fills = r.nodes.filter(
          (e) =>
            ["rect", "path", "circle", "polygon"].includes(e.name.localName) &&
            colors.includes(attr(e, "fill")),
        );
        expect(fills.length).toBeGreaterThan(spec.series.length);
        for (const e of fills) expect(alpha(e, "fill")).toBe(opacity);
      }
      const strokes = r.nodes.filter((e) => lines.includes(attr(e, "stroke")));
      expect(strokes.length).toBeGreaterThan(0);
      for (const e of strokes) expect(alpha(e, "stroke")).toBe(opacity);
      expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
      expect(
        P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
      ).toEqual(raw);
      expect(r.svg).not.toMatch(/NaN|Infinity/);
    });

for (const kind of ["line", "scatter"])
  it(`${kind} marker fill and outline alpha are independent of the series line and fill`, () => {
    const f = chartSeriesOpacityDeck({ kind }),
      spec = P.getShapeChartSpec(f.shape),
      r = paint(f);
    const first = spec.series[0],
      markers = r.nodes.filter(
        (e) =>
          attr(e, "fill") === first.markerFill &&
          attr(e, "stroke") === first.markerStrokeColor,
      );
    expect(markers).toHaveLength(4); // three data markers and one legend marker
    for (const e of markers) {
      expect(alpha(e, "fill")).toBe(0.2);
      expect(alpha(e, "stroke")).toBe(0.6);
    }
    const line = r.nodes.filter(
      (e) =>
        ["path", "line"].includes(e.name.localName) &&
        attr(e, "stroke") === first.lineColor,
    );
    expect(line.length).toBeGreaterThan(0);
    for (const e of line) expect(alpha(e, "stroke")).toBe(0.7);
  });

for (const kind of ["bar", "column", "pie", "doughnut", "bubble"])
  for (const pointOpacity of [0, 0.1, 1])
    it(`${kind} sparse point solid alpha ${pointOpacity} replaces the series fill alpha`, () => {
      const f = chartSeriesOpacityDeck({ kind, pointOpacity }),
        r = paint(f),
        points = r.nodes.filter((e) => attr(e, "fill") === "#CC55AA");
      expect(points.length).toBeGreaterThanOrEqual(kind === "bubble" ? 3 : 1);
      for (const point of points)
        expect(alpha(point, "fill")).toBe(pointOpacity);
      expect(P.getShapeChartSpec(f.shape).series[0].pointColors[1]).toBe(
        "#CC55AA",
      );
    });

for (const kind of ["bar", "column"])
  for (const negativeColor of ["#00AA77", "#FFFFFF"])
    for (const opacity of [0, 0.4, 1])
      it(`${kind} ${negativeColor} ignores inactive inverted alpha ${opacity} and uses ordinary fill alpha`, () => {
        const f = chartSeriesOpacityDeck({
            kind,
            opacity: 0.35,
            negativeOpacity: opacity,
            series: [
              {
                name: "Signed",
                values: [-2, 4, -3],
                color: "#E85239",
                negativeColor,
                invertIfNegative: true,
                lineColor: null,
              },
            ],
          }),
          r = paint(f),
          inverted = r.nodes.filter(
            (e) =>
              e.name.localName === "rect" && attr(e, "fill") === negativeColor,
          );
        expect(inverted).toHaveLength(2);
        for (const e of inverted) {
          expect(alpha(e, "fill")).toBe(0.35);
          if (negativeColor === "#FFFFFF") {
            expect(attr(e, "stroke")).toBe("#000000");
            expect(alpha(e, "stroke")).toBe(1);
          }
        }
        for (const e of r.nodes.filter((e) => attr(e, "fill") === "#E85239"))
          expect(alpha(e, "fill")).toBe(0.35);
      });

it("alpha transforms retain native order and exact zero through shared DrawingML resolution", () => {
  const f = chartSeriesOpacityDeck();
  changeXml(f, (doc) => {
    const series = nativeChartSeriesHosts(doc.root)[0].series,
      fill = child(child(series, "spPr"), "solidFill", NS.dml),
      color = fill.children[0];
    color.children = parseXml(
      `<r xmlns:a="${NS.dml}"><a:alpha val="75000"/><a:alphaMod val="40000"/><a:alphaOff val="5000"/></r>`,
    ).root.children;
  });
  for (const e of paint(f).nodes.filter((e) => attr(e, "fill") === "#E85239"))
    expect(alpha(e, "fill")).toBeCloseTo(0.35, 12);
});

it("out-of-cache native style indices do not allocate display-only sparse arrays", () => {
  const f = chartSeriesOpacityDeck({ pointOpacity: 0.1 });
  changeXml(f, (doc) => {
    const series = nativeChartSeriesHosts(doc.root)[0].series,
      point = child(series, "dPt");
    child(point, "idx").attrs[0].value = "4096";
  });
  const view = chartRenderingView(f.shape);
  expect(view.seriesOpacities[0].points).toBeUndefined();
  expect(view.seriesOpacities[0].fill).toBe(0.35);
  expect(paint(f).svg).not.toMatch(/NaN|Infinity/);
});

for (const kind of kinds)
  it(`${kind} transfer and save keep raw RGB, numeric data, native alpha and workbook bytes editable`, async () => {
    const f = chartSeriesOpacityDeck({ kind }),
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

for (const kind of ["bar", "column", "line", "area", "pie", "doughnut"])
  it(`${kind} independent data/title edits preserve alpha, while a deliberate RGB fill edit authors its new opaque paint`, async () => {
    const f = chartSeriesOpacityDeck({ kind }),
      spec = P.getShapeChartSpec(f.shape);
    P.setChartSpec(P.getSlideCharts(f.slide)[0], {
      ...spec,
      title: "Edited",
      series: spec.series.map((s) => ({
        ...s,
        values: s.values.map((v) => v + 1),
      })),
    });
    let view = chartRenderingView(f.shape);
    expect(view.seriesOpacities[0].fill).toBe(0.35);
    expect(view.seriesOpacities[0].line).toBe(0.7);
    P.setChartSpec(P.getSlideCharts(f.slide)[0], {
      ...P.getShapeChartSpec(f.shape),
      series: P.getShapeChartSpec(f.shape).series.map((s, i) =>
        i ? s : { ...s, color: "#889922" },
      ),
    });
    view = chartRenderingView(f.shape);
    expect(view.seriesOpacities[0].fill).toBe(1);
    expect(view.seriesOpacities[0].line).toBe(0.7);
    const saved = await P.loadPresentation(await P.savePresentation(f.p));
    expect(P.validatePresentation(saved)).toEqual([]);
  });

for (const secondary of [false, true])
  it(`independent combo plot groups retain their own solid alpha with secondary axis ${secondary}`, () => {
    const f = chartPercentageComboDeck({ secondary });
    changeXml(f, (doc) => {
      for (const [i, { series }] of nativeChartSeriesHosts(
        doc.root,
      ).entries()) {
        const sp = child(series, "spPr");
        for (const host of [sp, child(sp, "ln", NS.dml)]) {
          const color = child(host, "solidFill", NS.dml)?.children[0];
          if (color)
            color.children.push(
              parseXml(
                `<a:alpha xmlns:a="${NS.dml}" val="${(i + 1) * 20000}"/>`,
              ).root,
            );
        }
      }
    });
    const view = chartRenderingView(f.shape);
    expect(view.seriesOpacities.map((s) => s.fill ?? s.line)).toEqual([
      0.2, 0.4, 0.6, 0.8,
    ]);
    const r = paint(f);
    for (const [i, series] of view.spec.series.entries()) {
      const channel = series.chartKind === "line" ? "stroke" : "fill";
      const elements = r.nodes.filter(
        (e) =>
          attr(e, channel) ===
          (channel === "stroke" ? series.lineColor : series.color),
      );
      expect(elements.length).toBeGreaterThan(0);
      for (const e of elements) expect(alpha(e, channel)).toBe((i + 1) / 5);
    }
  });

it("bubble overrides retain their original cache indices after a skipped numeric cell", () => {
  const f = chartSeriesOpacityDeck({ kind: "bubble", pointOpacity: 0.1 });
  changeXml(f, (doc) => {
    const series = nativeChartSeriesHosts(doc.root)[0].series;
    const ref = child(child(series, "yVal"), "numRef"),
      cache = child(ref, "numCache");
    cache.children = cache.children.filter(
      (e) =>
        e.kind !== "element" ||
        e.name.localName !== "pt" ||
        attr(e, "idx") !== "0",
    );
  });
  const r = paint(f),
    points = r.nodes.filter(
      (e) => e.name.localName === "circle" && attr(e, "fill") === "#CC55AA",
    );
  expect(points).toHaveLength(3);
  // Every series authors the same x cache. Skipping the first y cell must
  // leave the overridden point on the same x position as the other series.
  expect(new Set(points.map((e) => attr(e, "cx"))).size).toBe(1);
  for (const e of points) expect(alpha(e, "fill")).toBe(0.1);
});

for (const kind of ["bar", "column"])
  for (const pointOpacity of [0, 0.1, 1])
    it(`${kind} inverted point alpha ${pointOpacity} uses its own ordinary point paint with native white inversion`, () => {
      const f = chartSeriesOpacityDeck({
          kind,
          pointOpacity,
          pointIndex: 0,
          series: [
            {
              name: "Signed",
              values: [-2, 4, -3],
              color: "#E85239",
              negativeColor: "#00AA77",
              invertIfNegative: true,
              lineColor: null,
            },
          ],
        }),
        r = paint(f);
      const inverted = r.nodes.filter(
        (e) => e.name.localName === "rect" && attr(e, "fill") === "#FFFFFF",
      );
      expect(inverted).toHaveLength(1);
      expect(alpha(inverted[0], "fill")).toBe(pointOpacity);
      expect(attr(inverted[0], "stroke")).toBe("#000000");
      expect(alpha(inverted[0], "stroke")).toBe(1);
      for (const e of r.nodes.filter((e) => attr(e, "fill") === "#00AA77"))
        expect(alpha(e, "fill")).toBe(0.35);
    });
for (const symbol of ["x", "plus", "dash"])
  it(`${symbol} markers keep independent filled body and open stroke alpha`, () => {
    const f = chartSeriesOpacityDeck({ kind: "line" }),
      c = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(c, {
      ...c.spec,
      series: c.spec.series.map((s) => ({ ...s, markerSymbol: symbol })),
    });
    const r = paint(f),
      body = r.nodes.filter((e) => attr(e, "fill") === "#AA6633"),
      outline = r.nodes.filter((e) => attr(e, "stroke") === "#226699");
    expect(body).toHaveLength(4);
    expect(outline).toHaveLength(4);
    for (const e of body) expect(alpha(e, "fill")).toBe(0.2);
    for (const e of outline) expect(alpha(e, "stroke")).toBe(0.6);
  });
