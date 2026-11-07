import { describe, expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { chartCopyDeck, chartRoot } from "./chart-copy-fixture.js";
import { SLIDE_DOCUMENT } from "../lib/pptx/src/api/_internal-symbols.ts";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

const bytes = (s) => new TextEncoder().encode(s);
const child = (r, n, ns = NS.chart) => firstChildElement(r, qname("", n, ns));
const fill = (color) => `<a:solidFill>${color}</a:solidFill>`;
const paint = (color) => `<c:spPr>${fill(color)}</c:spPr>`;
const stroke = (color) => `<c:spPr><a:ln>${fill(color)}</a:ln></c:spPr>`;
const text = (color) =>
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr>${fill(color)}</a:defRPr></a:pPr></a:p></c:txPr>`;
const xmlNode = (s) =>
  parseXml(
    `<c:wrapper xmlns:c="${NS.chart}" xmlns:a="${NS.dml}">${s}</c:wrapper>`,
  ).root.children[0];
function fixture(color) {
  const { p, slide } = chartCopyDeck(),
    shape = P.getSlideShapes(slide)[0],
    pkg = P._internalPackageOf(p),
    part = pkg.getPart(chartRoot(shape)),
    doc = parseXml(new TextDecoder().decode(part.data));
  const chart = child(doc.root, "chart"),
    plot = child(chart, "plotArea"),
    series = child(child(plot, "barChart"), "ser");
  const clear = (node, names) => {
    node.children = node.children.filter(
      (c) =>
        c.kind !== "element" ||
        c.name.namespaceURI !== NS.chart ||
        !names.includes(c.name.localName),
    );
  };
  clear(series, ["spPr", "dPt", "trendline", "dLbls"]);
  clear(chart, ["legend", "dLbls"]);
  clear(plot, ["spPr"]);
  clear(doc.root, ["spPr"]);
  series.children.push(
    xmlNode(paint(color)),
    xmlNode(`<c:dPt><c:idx val="1"/>${paint(color)}</c:dPt>`),
    xmlNode(
      `<c:trendline>${stroke(color)}<c:trendlineType val="linear"/></c:trendline>`,
    ),
    xmlNode(`<c:dLbls>${text(color)}<c:showVal val="1"/></c:dLbls>`),
  );
  for (const n of ["catAx", "valAx"]) {
    const axis = child(plot, n);
    clear(axis, ["spPr", "txPr", "majorGridlines", "minorGridlines"]);
    axis.children.push(
      xmlNode(stroke(color)),
      xmlNode(text(color)),
      xmlNode(`<c:minorGridlines>${stroke(color)}</c:minorGridlines>`),
    );
    const major = child(axis, "majorGridlines");
    if (major) major.children.push(xmlNode(stroke(color)));
    else
      axis.children.push(
        xmlNode(`<c:majorGridlines>${stroke(color)}</c:majorGridlines>`),
      );
  }
  plot.children.push(xmlNode(paint(color)));
  doc.root.children.push(xmlNode(paint(color)));
  chart.children.push(
    xmlNode(`<c:legend><c:legendPos val="b"/>${text(color)}</c:legend>`),
    xmlNode(`<c:dLbls>${text(color)}<c:showVal val="1"/></c:dLbls>`),
  );
  part.data = bytes(serializeXml(doc));
  return { p, slide, shape, pkg, part };
}
function colors(spec) {
  return [
    spec.series[0].color,
    spec.series[0].pointColors?.[1],
    spec.series[0].trendline?.color,
    spec.series[0].dataLabels?.textStyle?.color,
    spec.categoryAxisLineColor,
    spec.valueAxisLineColor,
    spec.categoryAxisLabelStyle?.color,
    spec.valueAxisLabelStyle?.color,
    spec.categoryAxisMajorGridlineColor,
    spec.valueAxisMajorGridlineColor,
    spec.categoryAxisMinorGridlineColor,
    spec.valueAxisMinorGridlineColor,
    spec.plotAreaFill,
    spec.chartAreaFill,
    spec.legend?.textStyle?.color,
  ];
}
function override(f, owner, value, name) {
  const theme = f.pkg.parts.find(
      (p) =>
        p.contentType ===
        "application/vnd.openxmlformats-officedocument.theme+xml",
    ),
    root = parseXml(new TextDecoder().decode(theme.data)).root,
    scheme = structuredClone(
      child(child(root, "themeElements", NS.dml), "clrScheme", NS.dml),
    );
  child(child(scheme, "accent1", NS.dml), "srgbClr", NS.dml).attrs.find(
    (a) => a.name.localName === "val",
  ).value = value;
  const doc = parseXml(`<a:themeOverride xmlns:a="${NS.dml}"/>`);
  doc.root.children.push(scheme);
  f.pkg.addPart(
    name,
    "application/vnd.openxmlformats-officedocument.themeOverride+xml",
    bytes(serializeXml(doc)),
  );
  const rels = f.pkg.getRels(owner);
  rels.items.push({
    id: "testTheme",
    type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/themeOverride",
    target: name,
    targetMode: "Internal",
  });
  f.pkg.setRels(owner, rels);
}
describe("native chart DrawingML colors", () => {
  it.each([
    ['<a:srgbClr val="245A87"/>', "#245A87"],
    ['<a:srgbClr val="FF0000"><a:inv/></a:srgbClr>', "#00FFFF"],
    ['<a:prstClr val="darkOrchid"/>', "#9932CC"],
    ['<a:sysClr val="windowText" lastClr="507090"/>', "#507090"],
    ['<a:hslClr hue="7200000" sat="100000" lum="50000"/>', "#00FF00"],
    ['<a:scrgbClr r="100000" g="0" b="0"><a:inv/></a:scrgbClr>', "#00FFFF"],
  ])(
    "reads color choices and transforms throughout the chart: %s",
    (xml, expected) => {
      const f = fixture(xml),
        original = f.part.data.slice();
      expect(colors(P.getShapeChartSpec(f.shape))).toEqual(
        Array(15).fill(expected),
      );
      expect(P.getSlideCharts(f.slide)[0].spec).toEqual(
        P.getShapeChartSpec(f.shape),
      );
      expect(f.part.data).toEqual(original);
      expect(renderSlideToSvg(f.p, f.slide)).toContain(expected);
    },
  );
  it("resolves the owning slide map and a chart override without modifying native XML", () => {
    const f = fixture('<a:schemeClr val="accent1"><a:inv/></a:schemeClr>');
    override(f, f.part.name, "FF0000", "/colors/owned.xml");
    const native = f.part.data.slice();
    expect(colors(P.getShapeChartSpec(f.shape))).toEqual(
      Array(15).fill("#00FFFF"),
    );
    f.pkg.getPart("/colors/owned.xml").data = bytes(
      new TextDecoder()
        .decode(f.pkg.getPart("/colors/owned.xml").data)
        .replace("FF0000", "00FF00"),
    );
    expect(colors(P.getShapeChartSpec(f.shape))).toEqual(
      Array(15).fill("#FF00FF"),
    );
    expect(f.part.data).toEqual(native);
  });
  it("honors chart-local mappings ahead of the host mapping, including foreign attributes", () => {
    const f = fixture('<a:schemeClr val="tx1"/>'),
      doc = parseXml(new TextDecoder().decode(f.part.data));
    doc.root.children.unshift(
      xmlNode('<c:clrMapOvr xmlns:f="urn:foreign" tx1="accent1" f:tx1="dk1"/>'),
    );
    f.part.data = bytes(serializeXml(doc));
    override(f, f.part.name, "123456", "/colors/map.xml");
    expect(colors(P.getShapeChartSpec(f.shape))).toEqual(
      Array(15).fill("#123456"),
    );
  });
  it("preserves mapped scheme paints through export and both transfer directions", async () => {
    const f = fixture('<a:schemeClr val="accent1"><a:inv/></a:schemeClr>');
    override(f, f.part.name, "FF0000", "/colors/transfer.xml");
    const spec = P.getShapeChartSpec(f.shape),
      q = createDeck("blank"),
      imported = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0], {
        preservePaintFormatting: true,
        preserveTextFormatting: true,
      });
    expect(colors(P.getShapeChartSpec(P.getSlideShapes(imported)[0]))).toEqual(
      Array(15).fill("#00FFFF"),
    );
    const saved = await P.loadPresentation(await P.savePresentation(q)),
      back = P.importSlide(
        f.p,
        P.getSlides(saved).at(-1),
        P.getSlideLayout(f.slide),
        { preservePaintFormatting: true, preserveTextFormatting: true },
      );
    expect(P.getShapeChartSpec(P.getSlideShapes(back)[0])).toEqual(spec);
    expect(P.validatePresentation(saved)).toEqual([]);
  });
  it("resolves one shared chart separately for each owning slide and refreshes map edits", () => {
    const f = fixture('<a:schemeClr val="tx1"/>'),
      other = P.addSlide(f.p, { layout: P.getSlideLayout(f.slide) }),
      copied = P.copyShape(other, f.shape);
    const rels = f.pkg.getRels(P.getSlidePartName(other));
    rels.items.find((r) => r.type.endsWith("/chart")).target = f.part.name;
    f.pkg.setRels(P.getSlidePartName(other), rels);
    const doc = parseXml(
      `<p:clrMapOvr xmlns:p="${NS.pml}" xmlns:a="${NS.dml}"><a:overrideClrMapping tx1="lt1"/></p:clrMapOvr>`,
    );
    other[SLIDE_DOCUMENT].root.children = other[
      SLIDE_DOCUMENT
    ].root.children.filter(
      (c) => c.kind !== "element" || c.name.localName !== "clrMapOvr",
    );
    other[SLIDE_DOCUMENT].root.children.push(doc.root);
    expect(colors(P.getShapeChartSpec(f.shape))).toEqual(
      Array(15).fill("#000000"),
    );
    expect(colors(P.getShapeChartSpec(copied))).toEqual(
      Array(15).fill("#FFFFFF"),
    );
    child(doc.root, "overrideClrMapping", NS.dml).attrs.find(
      (a) => a.name.localName === "tx1",
    ).value = "dk1";
    expect(colors(P.getShapeChartSpec(copied))).toEqual(
      Array(15).fill("#000000"),
    );
    expect(P.getSlideCharts(other)[0].spec).toEqual(
      P.getShapeChartSpec(copied),
    );
  });
  it.each([
    '<a:schemeClr val="unknown"/>',
    '<a:sysClr val="windowText"/>',
    '<a:hslClr hue="invalid" sat="100000" lum="50000"/>',
  ])(
    "retains unresolved authored colors without guessing an RGB value: %s",
    (xml) => {
      const f = fixture(xml),
        native = f.part.data.slice();
      expect(colors(P.getShapeChartSpec(f.shape))).toEqual(
        Array(15).fill(undefined),
      );
      expect(f.part.data).toEqual(native);
    },
  );
  it("does not treat foreign color elements as DrawingML", () => {
    const f = fixture('<f:schemeClr xmlns:f="urn:foreign" val="accent1"/>');
    expect(colors(P.getShapeChartSpec(f.shape))).toEqual(
      Array(15).fill(undefined),
    );
  });
});
