import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  chartLineMarkersDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
  NS,
  firstChildElement,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";

const colors = ["#E85239", "#2F8541", "#376CA8"],
  attr = (e, n) => getAttrValue(e, qname("", n, "")),
  child = (e, n) => firstChildElement(e, qname("", n, NS.chart));
function render(f) {
  const svg = decodeURIComponent(
      preview(f.p, f.slide).split(",").slice(1).join(","),
    ),
    nodes = [];
  walkElements(parseXml(svg).root, (e) => nodes.push(e));
  return {
    svg,
    nodes,
    markers: nodes.filter(
      (e) =>
        ["circle", "rect", "polygon"].includes(e.name.localName) &&
        colors.includes(attr(e, "fill")),
    ),
    lines: nodes.filter(
      (e) =>
        e.name.localName === "path" &&
        attr(e, "fill") === "none" &&
        colors.includes(attr(e, "stroke")),
    ),
  };
}
const points = (e) =>
  [...attr(e, "d").matchAll(/[ML]([-\d.]+),([-\d.]+)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
function expectMarkersOnPaths(r, count) {
  expect(r.markers).toHaveLength(count);
  for (const color of colors) {
    const marks = r.markers.filter((e) => attr(e, "fill") === color),
      line = r.lines.find((e) => attr(e, "stroke") === color),
      pp = points(line);
    expect(marks).toHaveLength(pp.length);
    for (const [i, e] of marks.entries()) {
      expect(Number(attr(e, "cx"))).toBe(pp[i][0]);
      expect(Number(attr(e, "cy"))).toBe(pp[i][1]);
    }
  }
  expect(r.svg).not.toMatch(/NaN|Infinity/);
}
describe("line marker visibility is independent of stacking", () => {
  for (const lineMarkers of [true, false, undefined])
    it(`raw chart flag ${lineMarkers} stays distinct through data edits without changing plot or legend visibility`, async () => {
      const f = chartLineMarkersDeck({
          lineMarkers,
          legend: { position: "r" },
        }),
        r = render(f),
        chart = P.getSlideCharts(f.slide)[0];
      expect(r.markers).toHaveLength(12);
      expect(chart.spec.lineMarkers).toBe(lineMarkers);
      P.setChartSpec(chart, {
        ...chart.spec,
        series: chart.spec.series.map((s) => ({
          ...s,
          values: s.values.map((v) => v + 1),
        })),
      });
      const p = await P.loadPresentation(await P.savePresentation(f.p)),
        slide = P.getSlides(p)[0],
        spec = P.getSlideCharts(slide)[0].spec;
      expect(spec.lineMarkers).toBe(lineMarkers);
      expect(render({ p, slide }).markers).toHaveLength(12);
      expect(P.validatePresentation(p)).toEqual([]);
      const part = P._internalPackageOf(p).getPart(
          chartRoot(P.getSlideCharts(slide)[0].shape),
        ),
        doc = parseXml(new TextDecoder().decode(part.data)),
        group = child(child(child(doc.root, "chart"), "plotArea"), "lineChart"),
        flag = child(group, "marker");
      if (lineMarkers === undefined) expect(flag).toBeNull();
      else expect(attr(flag, "val")).toBe(lineMarkers ? "1" : "0");
    });
  for (const [token, expected] of [
    ["0", false],
    ["false", false],
    ["1", true],
    ["true", true],
    [" true ", true],
    [null, true],
    ["invalid", undefined],
    ["", undefined],
  ])
    it(`reads raw CT_Boolean token ${JSON.stringify(token)} independently of automatic marker visibility`, () => {
      const f = chartLineMarkersDeck(),
        part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
        doc = parseXml(new TextDecoder().decode(part.data)),
        group = child(child(child(doc.root, "chart"), "plotArea"), "lineChart"),
        flag = child(group, "marker");
      const next = parseXml(
        `<c:marker xmlns:c="${NS.chart}"${token === null ? "" : ` val="${token}"`}/>`,
      ).root;
      group.children = group.children.map((e) => (e === flag ? next : e));
      part.data = new TextEncoder().encode(serializeXml(doc));
      expect(P.getShapeChartSpec(f.shape).lineMarkers).toBe(expected);
      expect(render(f).markers).toHaveLength(9);
    });
  for (const invalid of [0, 1, "false", null, {}])
    it(`rejects invalid raw flag ${JSON.stringify(invalid)} before mutating chart or workbook`, () => {
      const f = chartLineMarkersDeck(),
        pkg = P._internalPackageOf(f.p),
        before = pkg.parts.map((p) => [p.name, p.data.slice()]),
        c = P.getSlideCharts(f.slide)[0];
      expect(() =>
        P.setChartSpec(c, { ...c.spec, lineMarkers: invalid }),
      ).toThrow(/lineMarkers.*boolean/);
      expect(pkg.parts.map((p) => [p.name, p.data])).toEqual(before);
    });
  for (const grouping of ["clustered", "stacked", "percentStacked"])
    for (const categoryAxisOrientation of ["minMax", "maxMin"])
      for (const valueAxisOrientation of ["minMax", "maxMin"])
        it(`${grouping} ${categoryAxisOrientation}/${valueAxisOrientation} anchors markers on the plotted cumulative points without mutating native data`, () => {
          const f = chartLineMarkersDeck({
              grouping,
              categoryAxisOrientation,
              valueAxisOrientation,
              valueAxis: {
                min: 0,
                max: grouping === "percentStacked" ? 1 : 20,
              },
            }),
            spec = P.getShapeChartSpec(f.shape),
            part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
            bytes = part.data.slice(),
            book = workbook(f.p, f.shape).data.slice(),
            r = render(f);
          expectMarkersOnPaths(r, 9);
          // Three independently chosen categories distinguish raw, cumulative and
          // normalized values. Use the authored axis range to recover their values.
          const first = points(r.lines[0]),
            second = points(r.lines[1]),
            third = points(r.lines[2]);
          const scale =
            (first[0][1] - first[1][1]) /
            (grouping === "percentStacked" ? 2 / 6 - 4 / 9 : 2 - 4);
          const values =
            grouping === "percentStacked"
              ? [
                  [2 / 6, 4 / 9, 1 / 8],
                  [5 / 6, 6 / 9, 6 / 8],
                  [1, 1, 1],
                ]
              : grouping === "stacked"
                ? [
                    [2, 4, 1],
                    [5, 6, 6],
                    [6, 9, 8],
                  ]
                : [
                    [2, 4, 1],
                    [3, 2, 5],
                    [1, 3, 2],
                  ];
          for (const [s, pp] of [first, second, third].entries())
            for (let c = 0; c < 3; c++)
              expect(pp[c][1]).toBeCloseTo(
                first[0][1] + (values[s][c] - values[0][0]) * scale,
                1,
              );
          expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
          expect(part.data).toEqual(bytes);
          expect(workbook(f.p, f.shape).data).toEqual(book);
        });
  for (const grouping of ["clustered", "stacked", "percentStacked"])
    for (const [mode, symbols, lineMarkers, count] of [
      ["ignored false chart flag", [undefined, undefined, undefined], false, 9],
      ["automatic", [undefined, undefined, undefined], true, 9],
      [
        "explicit with false chart flag",
        ["circle", "circle", "circle"],
        false,
        9,
      ],
      ["none overrides marked subtype", ["none", "none", "none"], true, 0],
      ["mixed per-series", ["circle", "none", undefined], true, 6],
    ])
      it(`${grouping} honors ${mode}`, () => {
        const f = chartLineMarkersDeck(),
          spec = P.getShapeChartSpec(f.shape);
        P.setChartSpec(P.getSlideCharts(f.slide)[0], {
          ...spec,
          grouping,
          lineMarkers,
          series: spec.series.map((s, i) => ({
            ...s,
            markerSymbol: symbols[i],
          })),
        });
        const r = render(f);
        expect(r.markers).toHaveLength(count);
        if (mode === "automatic") {
          expect(
            r.markers
              .filter((e) => attr(e, "fill") === colors[0])
              .every(
                (e) =>
                  e.name.localName === "polygon" &&
                  attr(e, "points").split(" ").length === 4,
              ),
          ).toBe(true);
          expect(
            r.markers
              .filter((e) => attr(e, "fill") === colors[1])
              .every((e) => e.name.localName === "rect"),
          ).toBe(true);
          expect(
            r.markers
              .filter((e) => attr(e, "fill") === colors[2])
              .every(
                (e) =>
                  e.name.localName === "polygon" &&
                  attr(e, "points").split(" ").length === 3,
              ),
          ).toBe(true);
        }
        if (mode === "mixed per-series")
          expect(r.markers.some((e) => attr(e, "fill") === colors[1])).toBe(
            false,
          );
        expect(r.lines).toHaveLength(3);
      });
  for (const grouping of ["stacked", "percentStacked"])
    for (const dispBlanksAs of ["zero"])
      it(`${grouping} ${dispBlanksAs} marks only projected finite/zero-substituted cache slots`, () => {
        const f = chartLineMarkersDeck({ grouping, dispBlanksAs }),
          spec = P.getShapeChartSpec(f.shape);
        P.setChartSpec(P.getSlideCharts(f.slide)[0], {
          ...spec,
          series: spec.series.map((s) => ({
            ...s,
            values: [s.values[0], null, s.values[2]],
          })),
        });
        expectMarkersOnPaths(render(f), 9);
      });
  for (const grouping of ["stacked", "percentStacked"])
    it(`${grouping} keeps zero-valued points, singleton categories and an explicitly hidden line's markers`, () => {
      const f = chartLineMarkersDeck({
        grouping,
        categories: ["Only"],
        series: [
          {
            name: "Alpha",
            values: [0],
            color: colors[0],
            markerSymbol: "circle",
            lineColor: null,
          },
        ],
      });
      const r = render(f);
      expect(r.markers).toHaveLength(1);
      expect(r.lines).toHaveLength(0);
      expect(r.svg).not.toMatch(/NaN|Infinity/);
    });
  for (const grouping of ["clustered", "stacked", "percentStacked"])
    it(`${grouping} area charts remain marker-free`, () => {
      expect(
        render(chartLineMarkersDeck({ kind: "area", grouping })).markers,
      ).toHaveLength(0);
    });
  it("an imported omitted chart marker preserves absence and retains automatic series markers", () => {
    const f = chartLineMarkersDeck(),
      part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
      doc = parseXml(new TextDecoder().decode(part.data)),
      group = child(child(child(doc.root, "chart"), "plotArea"), "lineChart");
    group.children = group.children.filter(
      (e) => e.kind !== "element" || e.name.localName !== "marker",
    );
    for (const e of group.children)
      if (e.kind === "element" && e.name.localName === "ser")
        e.children = e.children.filter(
          (c) => c.kind !== "element" || c.name.localName !== "marker",
        );
    part.data = new TextEncoder().encode(serializeXml(doc));
    expect(P.getShapeChartSpec(f.shape).lineMarkers).toBeUndefined();
    expect(render(f).markers).toHaveLength(9);
  });
  it("export/reimport and transfers both ways retain editable stacked marker metadata and original-workbook isolation", async () => {
    const f = chartLineMarkersDeck(),
      q = createDeck("blank"),
      spec = P.getShapeChartSpec(f.shape),
      native = P._internalPackageOf(f.p)
        .getPart(chartRoot(f.shape))
        .data.slice(),
      book = workbook(f.p, f.shape).data.slice(),
      to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      back = P.importSlide(f.p, to, P.getSlideLayout(f.slide));
    for (const [p, slide] of [
      [q, to],
      [f.p, back],
    ]) {
      expectMarkersOnPaths(render({ p, slide }), 9);
      const c = P.getSlideCharts(slide)[0];
      P.setChartSpec(c, {
        ...c.spec,
        grouping: "percentStacked",
        series: c.spec.series.map((s) => ({
          ...s,
          values: s.values.map((v) => v + 1),
        })),
      });
      const loaded = await P.loadPresentation(await P.savePresentation(p));
      expectMarkersOnPaths(
        render({ p: loaded, slide: P.getSlides(loaded).at(-1) }),
        9,
      );
      expect(P.validatePresentation(loaded)).toEqual([]);
    }
    expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
    expect(P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data).toEqual(
      native,
    );
    expect(workbook(f.p, f.shape).data).toEqual(book);
  });
});
