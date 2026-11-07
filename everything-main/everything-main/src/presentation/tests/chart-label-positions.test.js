import { describe, expect, it } from "vitest";
import { P, createDeck, parseDeck, preview } from "../src/model.js";
import { buildChartSpaceDoc } from "../lib/pptx/src/internal/chartml/chart-builder.ts";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  walkElements,
  firstChildElement,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

const positions = [
    "bestFit",
    "b",
    "ctr",
    "inBase",
    "inEnd",
    "l",
    "outEnd",
    "r",
    "t",
  ],
  kinds = ["bar", "column", "line", "area", "pie", "doughnut"],
  labels = {
    showValue: true,
    showCategory: false,
    showSeriesName: false,
    showPercent: false,
  },
  options = (spec) => ({
    x: P.inches(1),
    y: P.inches(1),
    w: P.inches(7),
    h: P.inches(4),
    spec,
  }),
  specFor = (kind, grouping = "clustered", scope, position) => ({
    kind,
    grouping,
    categories: ["One", "Two", "Three"],
    ...(scope === "group" ? { dataLabels: { ...labels, position } } : {}),
    series: [
      {
        name: "Values",
        values: [1, 3, 5],
        ...(scope === "series" ? { dataLabels: { ...labels, position } } : {}),
      },
    ],
  }),
  snapshot = (p) => ({
    parts: P._internalPackageOf(p).parts.map((x) => [
      x.name,
      x.contentType,
      x.data.slice(),
    ]),
    types: structuredClone(P._internalPackageOf(p).contentTypes),
    shapes: P.getSlides(p).map((s) => P.getSlideShapes(s).length),
  }),
  child = (e, n) => firstChildElement(e, qname("c", n, NS.chart)),
  attr = (e, n) => getAttrValue(e, qname("", n, ""));
function fixture(spec) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0],
    shape = P.addSlideChart(slide, options(spec));
  return { p, slide, shape };
}
function nativePositions(p, shape) {
  const nodes = [];
  walkElements(
    parseXml(
      new TextDecoder().decode(
        P._internalPackageOf(p).getPart(chartRoot(shape)).data,
      ),
    ).root,
    (e) => {
      if (e.name.namespaceURI === NS.chart && e.name.localName === "dLblPos")
        nodes.push(attr(e, "val"));
    },
  );
  return nodes;
}
function rejectsAtomically(spec, expected = /dataLabels\.position/) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0],
    before = snapshot(p);
  expect(() => P.addSlideChart(slide, options(spec))).toThrow(expected);
  expect(snapshot(p)).toEqual(before);
  const f = fixture(specFor(spec.kind, spec.grouping)),
    original = snapshot(f.p),
    beforePreview = preview(f.p, f.slide);
  expect(() => P.setChartSpec(P.getSlideCharts(f.slide)[0], spec)).toThrow(
    expected,
  );
  expect(snapshot(f.p)).toEqual(original);
  expect(preview(f.p, f.slide)).toBe(beforePreview);
}

describe("Chart label positions depend on scope and plot kind", () => {
  // Each scope is tested against an independently stated native compatibility
  // matrix; the public token union alone does not establish valid ChartML.
  const seriesCases = [
    ["bar", "clustered", ["inBase", "inEnd", "outEnd", "ctr"]],
    ["column", "clustered", ["inBase", "inEnd", "outEnd", "ctr"]],
    ...["bar", "column"].flatMap((kind) =>
      ["stacked", "percentStacked"].map((g) => [
        kind,
        g,
        ["inBase", "inEnd", "ctr"],
      ]),
    ),
    ["line", "clustered", ["l", "r", "b", "t", "ctr"]],
    ["pie", "clustered", ["bestFit", "outEnd", "inEnd", "ctr"]],
  ];
  for (const scope of ["group", "series"])
    for (const [kind, grouping, allowed] of seriesCases)
      for (const position of positions)
        if (allowed.includes(position))
          it(`${grouping} ${kind} ${scope} accepts ${position}`, async () => {
            const f = fixture(specFor(kind, grouping, scope, position)),
              q = await parseDeck(await P.savePresentation(f.p)),
              chart = P.getSlideCharts(P.getSlides(q)[0])[0];
            expect(
              (scope === "group"
                ? chart.spec.dataLabels
                : chart.spec.series[0].dataLabels
              ).position,
            ).toBe(position);
            expect(nativePositions(q, chart.shape)).toEqual([position]);
            P.setChartSpec(chart, {
              ...chart.spec,
              series: chart.spec.series.map((s) => ({
                ...s,
                values: [2, 4, 6],
              })),
            });
            expect(nativePositions(q, chart.shape)).toEqual([position]);
            expect(P.validatePresentation(q)).toEqual([]);
          });
        else
          it(`${grouping} ${kind} ${scope} rejects ${position} before add or edit mutates a package`, () =>
            rejectsAtomically(specFor(kind, grouping, scope, position)));

  for (const kind of ["area", "doughnut"])
    for (const scope of ["group", "series"])
      for (const position of positions)
        it(`${kind} ${scope} rejects explicit ${position}, including its automatic center`, () =>
          rejectsAtomically(specFor(kind, "clustered", scope, position)));

  for (const scope of ["group", "series"])
    for (const position of [null, "", "Top", "center", 0, {}, true])
      it(`${scope} rejects non-token ${JSON.stringify(position)} atomically`, () =>
        rejectsAtomically(
          specFor("line", "clustered", scope, position),
          /ST_DLblPos/,
        ));

  for (const kind of kinds)
    it(`${kind} preserves omitted positions, labels and editable workbooks`, async () => {
      const f = fixture({
          ...specFor(kind, "clustered", "series", undefined),
          dataLabels: labels,
        }),
        raw = P._internalPackageOf(f.p)
          .getPart(chartRoot(f.shape))
          .data.slice(),
        book = workbook(f.p, f.shape).data.slice(),
        q = await parseDeck(await P.savePresentation(f.p)),
        c = P.getSlideCharts(P.getSlides(q)[0])[0];
      expect(c.spec.dataLabels.position).toBeUndefined();
      expect(c.spec.series[0].dataLabels.position).toBeUndefined();
      expect(c.spec.dataLabels.showValue).toBe(true);
      expect(c.spec.series[0].dataLabels.showValue).toBe(true);
      expect(nativePositions(q, c.shape)).toEqual([]);
      expect(P._internalPackageOf(q).getPart(chartRoot(c.shape)).data).toEqual(
        raw,
      );
      expect(workbook(q, c.shape).data).toEqual(book);
    });

  it("uses each combination series' effective kind, allowing independent legal positions", () => {
    const f = fixture({
      ...specFor("column"),
      series: [
        {
          name: "Columns",
          values: [1, 3, 5],
          dataLabels: { ...labels, position: "inBase" },
        },
        {
          name: "Line",
          chartKind: "line",
          secondaryAxis: true,
          values: [2, 4, 6],
          dataLabels: { ...labels, position: "t" },
        },
        {
          name: "Area",
          chartKind: "area",
          values: [1, 2, 3],
          dataLabels: labels,
        },
      ],
    });
    expect(nativePositions(f.p, f.shape)).toEqual(["inBase", "t"]);
    const c = P.getSlideCharts(f.slide)[0],
      before = snapshot(f.p),
      lineIndex = c.spec.series.findIndex((s) => s.chartKind === "line");
    expect(() =>
      P.setChartSpec(c, {
        ...c.spec,
        dataLabels: { ...labels, position: "ctr" },
      }),
    ).toThrow(/area charts require omission/);
    expect(snapshot(f.p)).toEqual(before);
    expect(() =>
      P.setChartSpec(c, {
        ...c.spec,
        series: c.spec.series.map((s, i) =>
          i === lineIndex ? { ...s, chartKind: "column" } : s,
        ),
      }),
    ).toThrow(new RegExp(`series\\[${lineIndex}\\]`));
    expect(snapshot(f.p)).toEqual(before);
  });
  it("validates actual groups when every series overrides the nominal base kind", () => {
    const f = fixture({
      ...specFor("area", "clustered", "group", "t"),
      series: [{ name: "Only line", chartKind: "line", values: [1, 3, 5] }],
    });
    expect(nativePositions(f.p, f.shape)).toEqual(["t"]);
  });
  it("rejects a grouping change that invalidates an existing series label position", () => {
    const f = fixture(specFor("bar", "clustered", "series", "outEnd")),
      c = P.getSlideCharts(f.slide)[0],
      before = snapshot(f.p);
    expect(() => P.setChartSpec(c, { ...c.spec, grouping: "stacked" })).toThrow(
      /series\[0\]/,
    );
    expect(snapshot(f.p)).toEqual(before);
  });
  it("checks positions in direct internal authoring too", () => {
    expect(() =>
      buildChartSpaceDoc(specFor("area", "clustered", "group", "ctr")),
    ).toThrow(/require omission/);
    expect(() =>
      buildChartSpaceDoc(specFor("line", "clustered", "series", "outEnd")),
    ).toThrow(/unsupported position/);
  });
  it("preserves another producer's native position through an untouched save instead of rewriting it", async () => {
    const f = fixture(specFor("area", "clustered", "group", undefined)),
      part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
      doc = parseXml(new TextDecoder().decode(part.data)),
      group = child(child(doc.root, "chart"), "plotArea").children.find(
        (e) => e.kind === "element" && e.name.localName === "areaChart",
      ),
      dl = child(group, "dLbls");
    dl.children.unshift(
      parseXml(`<c:dLblPos xmlns:c="${NS.chart}" val="ctr"/>`).root,
    );
    part.data = new TextEncoder().encode(serializeXml(doc));
    const raw = part.data.slice(),
      q = await parseDeck(await P.savePresentation(f.p)),
      c = P.getSlideCharts(P.getSlides(q)[0])[0];
    expect(c.spec.dataLabels.position).toBe("ctr");
    expect(P._internalPackageOf(q).getPart(chartRoot(c.shape)).data).toEqual(
      raw,
    );
    const before = snapshot(q);
    expect(() => P.setChartSpec(c, c.spec)).toThrow(
      /area charts require omission/,
    );
    expect(snapshot(q)).toEqual(before);
  });
  it("keeps valid transferred positions and returned-copy data/workbooks independent", async () => {
    const f = fixture(specFor("line", "clustered", "series", "t")),
      before = P.getShapeChartSpec(f.shape),
      book = workbook(f.p, f.shape).data.slice(),
      dest = createDeck("blank"),
      imported = P.importSlide(dest, f.slide, P.getSlideLayouts(dest)[0]),
      c = P.getSlideCharts(imported)[0];
    P.setChartSpec(c, {
      ...c.spec,
      series: c.spec.series.map((s) => ({
        ...s,
        values: [2, 4, 6],
        dataLabels: { ...s.dataLabels, position: "r" },
      })),
    });
    P.importSlide(f.p, imported, P.getSlideLayouts(f.p)[0]);
    const q = await parseDeck(await P.savePresentation(f.p)),
      charts = P.getSlides(q).map((s) => P.getSlideCharts(s)[0]);
    expect(charts.map((c) => c.spec.series[0].dataLabels.position)).toEqual([
      "t",
      "r",
    ]);
    expect(charts.map((c) => c.spec.series[0].values)).toEqual([
      [1, 3, 5],
      [2, 4, 6],
    ]);
    expect(P.getShapeChartSpec(f.shape)).toEqual(before);
    expect(workbook(q, charts[0].shape).data).toEqual(book);
    expect(new Set(charts.map((c) => workbook(q, c.shape).name)).size).toBe(2);
    expect(P.validatePresentation(q)).toEqual([]);
  });
});
