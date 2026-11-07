import { describe, it, expect } from "vitest";
import { P, createDeck } from "../src/model.js";
import { chartRoot } from "./chart-copy-fixture.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
const child = (r, n, ns = NS.chart) => firstChildElement(r, qname("", n, ns));
const bytes = (s) => new TextEncoder().encode(s);
const baseSpec = {
  kind: "bar",
  categories: ["East", "West"],
  series: [{ name: "Units", values: [3, 8], color: "#FFFFFF" }],
};
function fixture(spec = {}) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0];
  const shape = P.addSlideChart(slide, {
    x: P.emu(110000),
    y: P.emu(270000),
    w: P.emu(3500000),
    h: P.emu(2100000),
    spec: { ...baseSpec, ...spec },
  });
  return { p, slide, shape, pkg: P._internalPackageOf(p) };
}
function native(f, xml) {
  const part = f.pkg.getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data));
  for (const parent of [
    doc.root,
    child(child(doc.root, "chart"), "plotArea"),
  ]) {
    parent.children = parent.children.filter(
      (c) =>
        c.kind !== "element" ||
        c.name.namespaceURI !== NS.chart ||
        c.name.localName !== "spPr",
    );
    const spPr = parseXml(
      `<c:spPr xmlns:c="${NS.chart}" xmlns:a="${NS.dml}">${xml}<a:ln>${xml}</a:ln></c:spPr>`,
    ).root;
    const index = parent.children.findIndex(
      (c) =>
        c.kind === "element" &&
        c.name.namespaceURI === NS.chart &&
        [
          "txPr",
          "externalData",
          "printSettings",
          "userShapes",
          "extLst",
        ].includes(c.name.localName),
    );
    parent.children.splice(index < 0 ? parent.children.length : index, 0, spPr);
  }
  part.data = bytes(serializeXml(doc));
  return part;
}
const paints = (s) => [
  s.chartAreaFill,
  s.chartAreaStrokeColor,
  s.plotAreaFill,
  s.plotAreaStrokeColor,
];
function chartRect(f) {
  const root = parseXml(renderSlideToSvg(f.p, f.slide)).root;
  let rect;
  const visit = (e) => {
    if (e.kind !== "element" || rect) return;
    if (e.name.localName === "g")
      rect = e.children.find(
        (c) => c.kind === "element" && c.name.localName === "rect",
      );
    e.children.forEach(visit);
  };
  visit(root);
  return rect;
}
describe("native chart and plot-area paint", () => {
  it("distinguishes authored noFill from omitted paint without changing source XML", () => {
    const f = fixture(),
      part = native(f, "<a:noFill/>"),
      original = part.data.slice();
    expect(paints(P.getShapeChartSpec(f.shape))).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(P.getSlideCharts(f.slide)[0].spec).toEqual(
      P.getShapeChartSpec(f.shape),
    );
    expect(part.data).toEqual(original);
    const rect = chartRect(f);
    expect(rect?.attrs.find((a) => a.name.localName === "fill")?.value).toBe(
      "none",
    );
  });
  it("keeps absent backgrounds distinct and uses the native transparent default", () => {
    const f = fixture();
    expect(paints(P.getShapeChartSpec(f.shape))).toEqual(
      Array(4).fill(undefined),
    );
    expect(
      chartRect(f)?.attrs.find((a) => a.name.localName === "fill")?.value,
    ).toBe("none");
  });
  it.each(["bar", "column", "line", "area", "pie", "doughnut"])(
    "authors native transparent areas for %s and preserves them through export",
    async (kind) => {
      const f = fixture({
        kind,
        chartAreaFill: null,
        chartAreaStrokeColor: null,
        plotAreaFill: null,
        plotAreaStrokeColor: null,
      });
      expect(paints(P.getShapeChartSpec(f.shape))).toEqual(Array(4).fill(null));
      const loaded = await P.loadPresentation(await P.savePresentation(f.p)),
        chart = P.getSlideCharts(P.getSlides(loaded)[0])[0];
      expect(paints(chart.spec)).toEqual(Array(4).fill(null));
      expect(P.validatePresentation(loaded)).toEqual([]);
      const doc = parseXml(
        new TextDecoder().decode(f.pkg.getPart(chartRoot(f.shape)).data),
      );
      expect(child(child(doc.root, "spPr"), "noFill", NS.dml)).not.toBeNull();
    },
  );
  it("keeps fill and outline choices independent when solid, absent and noFill paints are mixed", async () => {
    const f = fixture({
      chartAreaFill: null,
      chartAreaStrokeColor: "#19304D",
      plotAreaFill: "#245A87",
      plotAreaStrokeColor: null,
    });
    expect(paints(P.getShapeChartSpec(f.shape))).toEqual([
      null,
      "#19304D",
      "#245A87",
      null,
    ]);
    const loaded = await P.loadPresentation(await P.savePresentation(f.p));
    expect(paints(P.getSlideCharts(P.getSlides(loaded)[0])[0].spec)).toEqual([
      null,
      "#19304D",
      "#245A87",
      null,
    ]);
  });
  it("updates solid area paint to noFill and back through chart editing", () => {
    const f = fixture({
      chartAreaFill: "#19304D",
      chartAreaStrokeColor: "#FFFFFF",
      plotAreaFill: "#245A87",
      plotAreaStrokeColor: "#FF0000",
    });
    const first = P.getShapeChartSpec(f.shape);
    P.setChartSpec(
      { shape: f.shape, spec: first },
      {
        ...first,
        chartAreaFill: null,
        chartAreaStrokeColor: null,
        plotAreaFill: null,
        plotAreaStrokeColor: null,
      },
    );
    expect(paints(P.getShapeChartSpec(f.shape))).toEqual(Array(4).fill(null));
    P.setChartSpec(
      { shape: f.shape, spec: P.getShapeChartSpec(f.shape) },
      first,
    );
    expect(paints(P.getShapeChartSpec(f.shape))).toEqual(paints(first));
  });
  it("retains transparent paints through native transfer and return", async () => {
    const f = fixture(),
      part = native(f, "<a:noFill/>"),
      original = part.data.slice(),
      q = createDeck("blank");
    const to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0], {
        preservePaintFormatting: true,
      }),
      copied = P.getSlideCharts(to)[0];
    expect(paints(copied.spec)).toEqual(Array(4).fill(null));
    const saved = await P.loadPresentation(await P.savePresentation(q)),
      back = P.importSlide(
        f.p,
        P.getSlides(saved).at(-1),
        P.getSlideLayout(f.slide),
        { preservePaintFormatting: true },
      );
    expect(paints(P.getSlideCharts(back)[0].spec)).toEqual(Array(4).fill(null));
    expect(part.data).toEqual(original);
    expect(P.validatePresentation(saved)).toEqual([]);
  });
  it.each(["<a:gradFill/>", '<f:noFill xmlns:f="urn:foreign"/>'])(
    "does not misrepresent unsupported or foreign paint as explicit transparency: %s",
    (xml) => {
      const f = fixture(),
        part = native(f, xml),
        original = part.data.slice();
      expect(paints(P.getShapeChartSpec(f.shape))).toEqual(
        Array(4).fill(undefined),
      );
      expect(part.data).toEqual(original);
    },
  );
});
