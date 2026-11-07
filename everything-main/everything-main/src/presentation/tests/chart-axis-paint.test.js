import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
const child = (node, name, ns = NS.chart) =>
  firstChildElement(node, qname("", name, ns));
const keys = [
  "categoryAxisLineColor",
  "valueAxisLineColor",
  "categoryAxisMajorGridlineColor",
  "categoryAxisMinorGridlineColor",
  "valueAxisMajorGridlineColor",
  "valueAxisMinorGridlineColor",
];
const paint = (value) => Object.fromEntries(keys.map((key) => [key, value]));
const flags = {
  categoryAxisMajorGridlines: true,
  categoryAxisMinorGridlines: true,
  valueAxisMajorGridlines: true,
  valueAxisMinorGridlines: true,
};
function fixture(spec = {}) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0],
    shape = P.addSlideChart(slide, {
      x: P.inches(1),
      y: P.inches(1),
      w: P.inches(7),
      h: P.inches(4),
      spec: {
        kind: "column",
        categories: ["One", "Two", "Three"],
        series: [{ name: "Units", values: [3, 7, 2] }],
        ...spec,
      },
    });
  return {
    p,
    slide,
    shape,
    part: P._internalPackageOf(p).getPart(chartRoot(shape)),
  };
}
function nativePaint(f, xml) {
  const doc = parseXml(new TextDecoder().decode(f.part.data)),
    plot = child(child(doc.root, "chart"), "plotArea");
  for (const name of ["catAx", "valAx"]) {
    const axis = child(plot, name);
    for (const node of [
      axis,
      child(axis, "majorGridlines"),
      child(axis, "minorGridlines"),
    ].filter(Boolean)) {
      node.children = node.children.filter(
        (ch) =>
          ch.kind !== "element" ||
          ch.name.namespaceURI !== NS.chart ||
          ch.name.localName !== "spPr",
      );
      const next = node.children.findIndex(
        (ch) =>
          ch.kind === "element" &&
          ch.name.namespaceURI === NS.chart &&
          ["txPr", "crossAx", "crosses", "crossesAt"].includes(
            ch.name.localName,
          ),
      );
      node.children.splice(
        next < 0 ? node.children.length : next,
        0,
        parseXml(
          `<c:spPr xmlns:c="${NS.chart}" xmlns:a="${NS.dml}"><a:ln>${xml}</a:ln></c:spPr>`,
        ).root,
      );
    }
  }
  f.part.data = new TextEncoder().encode(serializeXml(doc));
}
const getPaint = (shape) => {
  const spec = P.getShapeChartSpec(shape);
  return Object.fromEntries(keys.map((key) => [key, spec[key]]));
};
const svgLines = (f) => {
  const lines = [];
  walkElements(parseXml(renderSlideToSvg(f.p, f.slide)).root, (node) => {
    if (node.name.localName === "line") lines.push(node);
  });
  return lines;
};
const attr = (node, name) =>
  node.attrs.find((a) => a.name.localName === name)?.value;
describe("native chart axis and gridline paint", () => {
  it("reads explicit noFill on all six stroke roles without changing native XML", () => {
    const f = fixture(flags);
    nativePaint(f, "<a:noFill/>");
    const original = f.part.data.slice();
    expect(getPaint(f.shape)).toEqual(paint(null));
    expect(f.part.data).toEqual(original);
  });
  it("keeps absent strokes distinct and retains their existing defaults", () => {
    const f = fixture(flags);
    expect(getPaint(f.shape)).toEqual(paint(undefined));
    const strokes = svgLines(f).map((line) => attr(line, "stroke"));
    expect(strokes).toContain("#000000");
    expect(strokes.some((stroke) => stroke !== "none")).toBe(true);
  });
  it.each(keys)(
    "keeps %s noFill independent of the other solid strokes",
    (key) => {
      const expected = { ...paint("#ABCDEF"), [key]: null },
        f = fixture({ ...flags, ...expected });
      expect(getPaint(f.shape)).toEqual(expected);
    },
  );
  it.each(["bar", "column", "line", "area"])(
    "authors and reopens all noFill %s axis strokes",
    async (kind) => {
      const f = fixture({ ...flags, ...paint(null), kind });
      expect(getPaint(f.shape)).toEqual(paint(null));
      expect(
        new TextDecoder().decode(f.part.data).match(/<a:ln><a:noFill\/>/g),
      ).toHaveLength(6);
      const p = await P.loadPresentation(await P.savePresentation(f.p)),
        shape = P.getSlideCharts(P.getSlides(p)[0])[0].shape;
      expect(getPaint(shape)).toEqual(paint(null));
      expect(P.validatePresentation(p)).toEqual([]);
    },
  );
  it.each(["bar", "column", "line", "area"])(
    "does not substitute visible %s spines, ticks or major grids for noFill",
    (kind) => {
      const f = fixture({ ...flags, kind });
      nativePaint(f, "<a:noFill/>");
      const lines = svgLines(f);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((line) => attr(line, "stroke") === "none")).toBe(true);
      expect(renderSlideToSvg(f.p, f.slide)).toContain("One");
    },
  );
  it("honors noFill on a shared primary axis in mixed column/line plots", () => {
    const f = fixture({
      ...flags,
      ...paint(null),
      series: [
        { name: "Columns", values: [3, 7, -2] },
        { name: "Line", chartKind: "line", values: [4, -1, 5] },
      ],
    });
    expect(getPaint(f.shape)).toEqual(paint(null));
    expect(svgLines(f).every((line) => attr(line, "stroke") === "none")).toBe(
      true,
    );
    expect(renderSlideToSvg(f.p, f.slide)).toContain("One");
  });
  it.each(["bar", "column", "line", "area"])(
    "does not invent a zero-reference stroke for deleted %s axes",
    (kind) => {
      const f = fixture({
        kind,
        categoryAxisHidden: true,
        valueAxisHidden: true,
      });
      expect(svgLines(f)).toEqual([]);
      const svg = renderSlideToSvg(f.p, f.slide);
      expect(svg).not.toContain("no data");
      expect(svg).toMatch(
        kind === "bar" || kind === "column" ? /<rect / : /<path /,
      );
    },
  );
  it("keeps visible grid paint when both spines have noFill", () => {
    const f = fixture({
      ...paint(null),
      valueAxisMajorGridlines: true,
      valueAxisMajorGridlineColor: "#123456",
    });
    const lines = svgLines(f);
    expect(
      lines.every((line) => ["none", "#123456"].includes(attr(line, "stroke"))),
    ).toBe(true);
    expect(lines.some((line) => attr(line, "stroke") === "none")).toBe(true);
    expect(lines.every((line) => attr(line, "stroke-width") === "1")).toBe(
      true,
    );
    expect(lines.some((line) => attr(line, "stroke") === "#123456")).toBe(true);
  });
  it("does not mistake foreign or unsupported stroke paints for noFill", () => {
    for (const xml of [
      '<foreign:noFill xmlns:foreign="urn:other"/>',
      "<a:gradFill/>",
    ]) {
      const f = fixture(flags);
      nativePaint(f, xml);
      const original = f.part.data.slice();
      expect(getPaint(f.shape)).toEqual(paint(undefined));
      expect(f.part.data).toEqual(original);
    }
  });
  it("preserves noFill through native transfer both ways and independent solid/noFill edits", async () => {
    const f = fixture({ ...flags, ...paint(null) }),
      original = f.part.data.slice(),
      q = createDeck("blank"),
      target = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      back = P.importSlide(f.p, target, P.getSlideLayout(f.slide));
    for (const slide of [f.slide, target, back])
      expect(getPaint(P.getSlideCharts(slide)[0].shape)).toEqual(paint(null));
    expect(preview(q, target)).toBe(preview(f.p, f.slide));
    const chart = P.getSlideCharts(back)[0],
      workbookBefore = workbook(f.p, f.shape).data.slice();
    P.setChartSpec(chart, { ...chart.spec, ...paint("#123456") });
    expect(getPaint(chart.shape)).toEqual(paint("#123456"));
    P.setChartSpec(chart, {
      ...P.getShapeChartSpec(chart.shape),
      ...paint(null),
    });
    expect(getPaint(chart.shape)).toEqual(paint(null));
    expect(f.part.data).toEqual(original);
    expect(workbook(f.p, f.shape).data).toEqual(workbookBefore);
    const p = await P.loadPresentation(await P.savePresentation(f.p));
    expect(getPaint(P.getSlideCharts(P.getSlides(p).at(-1))[0].shape)).toEqual(
      paint(null),
    );
    expect(P.validatePresentation(p)).toEqual([]);
    expect(P.validatePresentation(q)).toEqual([]);
  });
});
