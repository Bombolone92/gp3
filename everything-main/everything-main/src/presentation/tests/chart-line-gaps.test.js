import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { P, createDeck, preview } from "../src/model.js";
import {
  chartLineGapsDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  walkElements,
  firstChildElement,
  qname,
  getAttrValue,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readChartSeriesDisplays } from "../lib/pptx/src/internal/chartml/blank-display.ts";
const c = (e, n) => firstChildElement(e, qname("c", n, NS.chart)),
  attr = (e, n) => getAttrValue(e, qname("", n, "")),
  r3 = "http://schemas.microsoft.com/office/drawing/2017/03/chart",
  uri = "{56B9EC1D-385E-4148-901F-78D8002777C0}";
function render(f) {
  const svg = decodeURIComponent(
      preview(f.p, f.slide).split(",").slice(1).join(","),
    ),
    paths = [],
    markers = [];
  walkElements(parseXml(svg).root, (e) => {
    if (
      e.name.localName === "path" &&
      attr(e, "stroke") === "#376CA8" &&
      attr(e, "fill") === "none"
    )
      paths.push(attr(e, "d"));
    if (e.name.localName === "circle" && attr(e, "fill") === "#376CA8")
      markers.push(e);
  });
  return { svg, paths, markers };
}
function document(f, edit) {
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(strFromU8(part.data));
  edit(doc.root);
  part.data = new TextEncoder().encode(serializeXml(doc));
}
function nativeRoot({
  token,
  flagNamespace = r3,
  optionsNamespace = r3,
  host = "chart",
  extensionUri = uri,
  points = '<c:pt idx="1"><c:v>#N/A</c:v></c:pt>',
  cache = "numLit",
  grouping = "standard",
} = {}) {
  const flag = `<n:dataDisplayOptions16 xmlns:n="${optionsNamespace}"><f:dispNaAsBlank xmlns:f="${flagNamespace}"${token === undefined ? "" : ` val="${token}"`}/></n:dataDisplayOptions16>`,
    ext = `<c:extLst><c:ext uri="${extensionUri}">${flag}</c:ext></c:extLst>`,
    channel =
      cache === "numLit"
        ? `<c:numLit>${points}</c:numLit>`
        : `<c:numRef><c:numCache>${points}</c:numCache></c:numRef>`;
  return parseXml(
    `<c:chartSpace xmlns:c="${NS.chart}">${host === "root" ? ext : ""}<c:chart><c:plotArea><c:lineChart><c:grouping val="${grouping}"/><c:ser><c:val>${channel}</c:val></c:ser></c:lineChart></c:plotArea>${host === "chart" ? ext : ""}</c:chart></c:chartSpace>`,
  ).root;
}

describe("line gaps retain native point-display semantics", () => {
  for (const [name, values, edges, markers] of [
    ["separated curves", [2, 4, 3, null, 3, 1, 5], [4, 5, 6], [6, 6, 7]],
    ["two-point runs", [2, 4, null, 3, 1, null, 5, 2], [3, 5, 7], [6, 6, 8]],
    [
      "edge blanks and an isolated point",
      [null, 2, 4, 3, null, 1, null],
      [2, 3, 6],
      [4, 4, 7],
    ],
    ["all blank", [null, null, null, null], [0, 0, 3], [0, 0, 4]],
  ])
    for (const smooth of [true, false])
      for (const [modeIndex, dispBlanksAs] of ["gap", "span", "zero"].entries())
        it(`${name}, smooth=${smooth}, ${dispBlanksAs} has only the permitted connections`, () => {
          const f = chartLineGapsDeck({ values, smooth, dispBlanksAs }),
            before = P._internalPackageOf(f.p)
              .getPart(chartRoot(f.shape))
              .data.slice(),
            book = workbook(f.p, f.shape).data.slice(),
            r = render(f),
            path = r.paths.join(" ");
          expect((path.match(/[CL]/g) ?? []).length).toBe(edges[modeIndex]);
          expect(r.markers).toHaveLength(markers[modeIndex]);
          expect(r.svg).not.toMatch(/NaN|Infinity/);
          expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual(values);
          expect(
            P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
          ).toEqual(before);
          expect(workbook(f.p, f.shape).data).toEqual(book);
        });
  it("a curve on either side of a gap has the same neighbours as that isolated run", () => {
    const values = [2, 4, 3, null, 3, 1, 5],
      f = chartLineGapsDeck({ values }),
      r = render(f),
      left = render(
        chartLineGapsDeck({ values: [2, 4, 3, null, null, null, null] }),
      ),
      right = render(
        chartLineGapsDeck({ values: [null, null, null, null, 3, 1, 5] }),
      );
    expect(r.paths[0]).toBe(`${left.paths[0]} ${right.paths[0]}`);
    expect((r.paths[0].match(/M/g) ?? []).length).toBe(2);
  });
  for (const smooth of [true, false])
    for (const dispNaAsBlank of [undefined, false, true])
      for (const dispBlanksAs of ["gap", "span", "zero"])
        it(`native #N/A smooth=${smooth}, blank=${dispNaAsBlank}, ${dispBlanksAs} matches the native blank/span control`, () => {
          const f = chartLineGapsDeck({
              naIndices: [3],
              dispNaAsBlank,
              dispBlanksAs,
              smooth,
            }),
            control = chartLineGapsDeck({
              dispBlanksAs: dispNaAsBlank ? dispBlanksAs : "span",
              smooth,
            }),
            r = render(f);
          expect(r.paths).toEqual(render(control).paths);
          expect(r.markers.length).toBe(render(control).markers.length);
          expect(P.getShapeChartSpec(f.shape).dispBlanksAs).toBe(dispBlanksAs);
          expect(P.getShapeChartSpec(f.shape).series[0].values[3]).toBeNull();
          const sheet = strFromU8(
            unzipSync(workbook(f.p, f.shape).data)["xl/worksheets/sheet1.xml"],
          );
          expect(sheet).toContain('r="B5" t="e"');
          expect(sheet).toContain("<v>#N/A</v>");
        });
  for (const [token, asBlank] of [
    [undefined, false],
    ["", false],
    ["0", false],
    ["false", false],
    ["1", true],
    ["true", true],
    [" &#x9;true&#xA; ", true],
    ["2", false],
    ["True", false],
    ["future", false],
  ])
    it(`CT_BooleanFalse token ${token} controls the native error distinction`, () => {
      const d = readChartSeriesDisplays(nativeRoot({ token }))[0];
      expect(d.naSpans?.has(1) ?? false).toBe(!asBlank);
    });
  for (const options of [
    { flagNamespace: "urn:foreign", token: "1" },
    { optionsNamespace: "urn:foreign", token: "1" },
    { host: "root", token: "1" },
    { extensionUri: "urn:foreign", token: "1" },
  ])
    it(`foreign or misplaced display records do not enable blank treatment ${JSON.stringify(options)}`, () => {
      expect(
        readChartSeriesDisplays(nativeRoot(options))[0].naSpans?.has(1),
      ).toBe(true);
    });
  for (const cache of ["numRef", "numLit"])
    it(`${cache} uses native point indices and last-record-wins errors without confusing finite/empty values`, () => {
      const points =
        '<c:pt idx="3"><c:v>#N/A</c:v></c:pt><c:pt idx="1"><c:v>#N/A</c:v></c:pt><c:pt idx="3"><c:v>9</c:v></c:pt><c:pt idx="2"><c:v>#N/A</c:v></c:pt><c:pt idx="2"><c:v/></c:pt><c:pt idx="7"><c:v>#N/A</c:v></c:pt><c:pt idx="invalid"><c:v>#N/A</c:v></c:pt><f:pt xmlns:f="urn:foreign" idx="5"><c:v>#N/A</c:v></f:pt>';
      expect([
        ...readChartSeriesDisplays(nativeRoot({ points, cache }))[0].naSpans,
      ]).toEqual([1, 7]);
    });
  for (const grouping of ["stacked", "percentStacked"])
    it(`${grouping} errors retain zero vertices instead of standard-line span semantics`, () => {
      const f = chartLineGapsDeck({ grouping, naIndices: [3] }),
        blank = chartLineGapsDeck({ grouping });
      expect(render(f).paths).toEqual(render(blank).paths);
      expect(render(f).markers).toHaveLength(7);
      expect(
        readChartSeriesDisplays(nativeRoot({ grouping }))[0].naSpans,
      ).toBeUndefined();
    });
  it("a real gap breaks a run even when another missing point is a connecting error", () => {
    const f = chartLineGapsDeck({
        values: [2, 3, null, 1, 4, null, 3, 2],
        naIndices: [5],
      }),
      r = render(f);
    expect((r.paths[0].match(/M/g) ?? []).length).toBe(2);
    expect((r.paths[0].match(/[CL]/g) ?? []).length).toBe(4);
    expect(r.markers).toHaveLength(6);
  });
  it("native metadata stays aligned with primary column and secondary line series during renderer regrouping", () => {
    const f = chartLineGapsDeck({ naIndices: [3] }),
      chart = P.getSlideCharts(f.slide)[0],
      s = chart.spec.series[0];
    P.setChartSpec(chart, {
      ...chart.spec,
      kind: "column",
      series: [
        { name: "Bars", values: [2, 4, 3, null, 3, 1, 5], color: "#E85239" },
        { ...s, chartKind: "line", secondaryAxis: true },
      ],
    });
    document(f, (root) =>
      walkElements(root, (e) => {
        if (
          e.name.namespaceURI === NS.chart &&
          e.name.localName === "lineChart"
        ) {
          const cache = c(c(c(e, "ser"), "val"), "numRef");
          c(cache, "numCache").children.push(
            parseXml(
              `<c:pt xmlns:c="${NS.chart}" idx="3"><c:v>#N/A</c:v></c:pt>`,
            ).root,
          );
        }
      }),
    );
    const r = render(f);
    expect((r.paths[0].match(/M/g) ?? []).length).toBe(1);
    expect((r.paths[0].match(/[CL]/g) ?? []).length).toBe(5);
    expect(r.markers).toHaveLength(6);
  });
  it("editing an error to a finite number removes its native error state from cache, workbook and preview", async () => {
    const f = chartLineGapsDeck({ naIndices: [3], dispNaAsBlank: true }),
      chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, {
      ...chart.spec,
      series: chart.spec.series.map((s) => ({
        ...s,
        values: s.values.map((v, i) => (i === 3 ? 2 : v)),
      })),
    });
    const p = await P.loadPresentation(await P.savePresentation(f.p)),
      slide = P.getSlides(p)[0],
      edited = P.getSlideCharts(slide)[0];
    expect(edited.spec.series[0].values[3]).toBe(2);
    expect(render({ p, slide }).markers).toHaveLength(7);
    expect((render({ p, slide }).paths[0].match(/M/g) ?? []).length).toBe(1);
    expect(
      strFromU8(P._internalPackageOf(p).getPart(chartRoot(edited.shape)).data),
    ).not.toContain("#N/A");
    expect(
      strFromU8(
        unzipSync(workbook(p, edited.shape).data)["xl/worksheets/sheet1.xml"],
      ),
    ).not.toContain("#N/A");
    expect(P.validatePresentation(p)).toEqual([]);
  });

  it("native errors, flags and blank-mode settings survive both-way transfer, independent edits and save/reimport", async () => {
    const f = chartLineGapsDeck({ naIndices: [3], dispNaAsBlank: false }),
      q = createDeck("blank"),
      bytes = P._internalPackageOf(f.p)
        .getPart(chartRoot(f.shape))
        .data.slice(),
      book = workbook(f.p, f.shape).data.slice(),
      to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      back = P.importSlide(f.p, to, P.getSlideLayout(f.slide)),
      chart = P.getSlideCharts(back)[0];
    P.setChartSpec(chart, {
      ...chart.spec,
      series: chart.spec.series.map((s) => ({
        ...s,
        values: s.values.map((v) => (v === null ? null : v + 1)),
      })),
    });
    document({ p: f.p, shape: chart.shape }, (root) =>
      walkElements(root, (e) => {
        if (e.name.namespaceURI === r3 && e.name.localName === "dispNaAsBlank")
          e.attrs[0].value = "1";
      }),
    );
    const p = await P.loadPresentation(await P.savePresentation(f.p)),
      slides = P.getSlides(p),
      original = P.getSlideCharts(slides[0])[0],
      copied = P.getSlideCharts(slides[1])[0];
    expect(
      (render({ p, slide: slides[0] }).paths[0].match(/M/g) ?? []).length,
    ).toBe(1);
    expect(
      (render({ p, slide: slides[1] }).paths[0].match(/M/g) ?? []).length,
    ).toBe(2);
    expect(
      P._internalPackageOf(p).getPart(chartRoot(original.shape)).data,
    ).toEqual(bytes);
    expect(workbook(p, original.shape).data).toEqual(book);
    expect(copied.spec.series[0].values).toEqual([3, 5, 4, null, 4, 2, 6]);
    expect(
      strFromU8(
        unzipSync(workbook(p, copied.shape).data)["xl/worksheets/sheet1.xml"],
      ),
    ).toContain("<v>#N/A</v>");
    expect(workbook(p, original.shape).name).not.toBe(
      workbook(p, copied.shape).name,
    );
    expect(P.validatePresentation(p)).toEqual([]);
  });
});
