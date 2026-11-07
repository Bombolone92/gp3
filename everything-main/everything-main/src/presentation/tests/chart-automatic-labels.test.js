import { describe, it, expect } from "vitest";
import { P, createDeck, parseDeck, preview } from "../src/model.js";
import {
  chartLegendLayoutDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
const labelColors = ["#123ABC", "#7B1269"],
  seriesColors = ["#E85239", "#2F8541"],
  attr = (e, n) => getAttrValue(e, qname("", n, ""));
function fixture(kind, options = {}) {
  return chartLegendLayoutDeck({
    kind,
    grouping: "clustered",
    categories: ["First", "Second", "Third"],
    legend: undefined,
    valueAxis: { min: 0, max: 12 },
    dataLabels: { showValue: true, textStyle: { color: labelColors[0] } },
    series: [
      [2, 4, 3],
      [1, 2, 5],
    ].map((values, i) => ({
      name: `Band ${i + 1}`,
      values,
      color: seriesColors[i],
      markerSymbol: "circle",
      markerFill: seriesColors[i],
      ...(i
        ? {
            dataLabels: {
              showValue: true,
              textStyle: { color: labelColors[i] },
            },
          }
        : {}),
    })),
    ...options,
  });
}
function paint(f) {
  const svg = decodeURIComponent(
      preview(f.p, f.slide).split(",").slice(1).join(","),
    ),
    elements = [];
  walkElements(parseXml(svg).root, (e) => elements.push(e));
  const plot = elements.find(
    (e) => e.name.localName === "rect" && attr(e, "fill") === "#ECF5E9",
  );
  return {
    svg,
    plot: Object.fromEntries(
      ["x", "y", "width", "height"].map((n) => [n, Number(attr(plot, n))]),
    ),
    labels: labelColors.map((color) =>
      elements
        .filter((e) => e.name.localName === "text" && attr(e, "fill") === color)
        .map((e) => ({
          x: Number(attr(e, "x")),
          y: Number(attr(e, "y")),
          anchor: attr(e, "text-anchor"),
          text: e.children
            .filter((n) => n.kind === "text")
            .map((n) => n.data)
            .join(""),
        })),
    ),
    markers: seriesColors.map((color) =>
      elements
        .filter(
          (e) => e.name.localName === "circle" && attr(e, "fill") === color,
        )
        .map((e) => ({ x: Number(attr(e, "cx")), y: Number(attr(e, "cy")) })),
    ),
    paths: elements
      .filter((e) => e.name.localName === "path")
      .map((e) => [attr(e, "d"), attr(e, "fill"), attr(e, "stroke")]),
  };
}
function checkArea(f) {
  const spec = P.getShapeChartSpec(f.shape),
    r = paint(f),
    { min, max } = spec.valueAxis,
    stacked = ["stacked", "percentStacked"].includes(spec.grouping),
    percent = spec.grouping === "percentStacked";
  for (const [s, series] of spec.series.entries()) {
    const finite = series.values
      .map((v, c) => ({ v, c }))
      .filter(({ v }) => v != null && Number.isFinite(v));
    expect(r.labels[s]).toHaveLength(finite.length);
    for (const [i, { v, c }] of finite.entries()) {
      const total = percent
          ? spec.series.reduce(
              (sum, other) => sum + Math.max(0, other.values[c] ?? 0),
              0,
            )
          : 1,
        base = stacked
          ? spec.series
              .slice(0, s)
              .reduce(
                (sum, other) =>
                  sum +
                  (percent
                    ? Math.max(0, other.values[c] ?? 0) / (total || 1)
                    : (other.values[c] ?? 0)),
                0,
              )
          : Math.max(min, Math.min(max, 0)),
        top =
          (stacked ? base : 0) + (percent ? Math.max(0, v) / (total || 1) : v),
        middle = (base + top) / 2,
        fraction = (middle - min) / (max - min),
        y =
          r.plot.y +
          (spec.valueAxisOrientation === "maxMin" ? fraction : 1 - fraction) *
            r.plot.height;
      expect(r.labels[s][i].anchor).toBe("middle");
      expect(r.labels[s][i].y).toBeCloseTo(y + 3, 1);
      expect(r.labels[s][i].text).toBe(String(v));
    }
  }
  return r;
}
function checkLine(f, position = "r") {
  const r = paint(f);
  for (const [s, labels] of r.labels.entries()) {
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).toHaveLength(r.markers[s].length);
    for (const [i, label] of labels.entries()) {
      const marker = r.markers[s][i];
      if (position === "r" || position === "l") {
        expect(label.anchor).toBe(position === "r" ? "start" : "end");
        expect(Math.sign(label.x - marker.x)).toBe(position === "r" ? 1 : -1);
        expect(label.y - marker.y).toBeCloseTo(3, 1);
      } else {
        expect(label.anchor).toBe("middle");
        expect(label.x).toBeCloseTo(marker.x, 1);
        if (position === "ctr") expect(label.y - marker.y).toBeCloseTo(3, 1);
        else
          expect(Math.sign(label.y - marker.y)).toBe(position === "t" ? -1 : 1);
      }
    }
  }
  return r;
}
const bytes = (p) =>
  P._internalPackageOf(p).parts.map((part) => [part.name, part.data.slice()]);
describe("automatic line and area data-label anchors", () => {
  for (const grouping of ["clustered", "stacked", "percentStacked"])
    for (const valueAxisOrientation of ["minMax", "maxMin"])
      for (const categoryAxisOrientation of ["minMax", "maxMin"]) {
        it(`${grouping} line defaults to Right with ${valueAxisOrientation}/${categoryAxisOrientation} axes`, () => {
          const f = fixture("line", {
            grouping,
            valueAxisOrientation,
            categoryAxisOrientation,
            valueAxis: { min: 0, max: grouping === "percentStacked" ? 1 : 12 },
          });
          checkLine(f);
          const before = paint(f).svg,
            c = P.getSlideCharts(f.slide)[0];
          P.setChartSpec(c, {
            ...c.spec,
            dataLabels: { ...c.spec.dataLabels, position: "r" },
          });
          expect(paint(f).svg).toBe(before);
        });
        for (const blank of [false, true])
          it(`${grouping} area centers each band with ${valueAxisOrientation}/${categoryAxisOrientation} axes and ${blank ? "missing" : "complete"} data`, () => {
            const f = fixture("area", {
              grouping,
              valueAxisOrientation,
              categoryAxisOrientation,
              valueAxis: {
                min: 0,
                max: grouping === "percentStacked" ? 1 : 12,
              },
            });
            if (blank) {
              const c = P.getSlideCharts(f.slide)[0];
              P.setChartSpec(c, {
                ...c.spec,
                series: c.spec.series.map((s, i) => ({
                  ...s,
                  values: i ? [1, null, 5] : s.values,
                })),
              });
            }
            checkArea(f);
          });
      }
  for (const grouping of ["clustered", "stacked"])
    for (const valueAxisOrientation of ["minMax", "maxMin"])
      it(`centers negative ${grouping} bands with ${valueAxisOrientation} axes`, () => {
        const f = fixture("area", {
            grouping,
            valueAxisOrientation,
            valueAxis: { min: -12, max: 0 },
          }),
          c = P.getSlideCharts(f.slide)[0];
        P.setChartSpec(c, {
          ...c.spec,
          series: c.spec.series.map((s) => ({
            ...s,
            values: s.values.map((v) => -v),
          })),
        });
        checkArea(f);
      });
  for (const valueAxisOrientation of ["minMax", "maxMin"])
    for (const [bounds, values] of [
      [{ min: 2, max: 6 }, [3, 4, 5]],
      [{ min: -6, max: -2 }, [-3, -4, -5]],
    ])
      it(`centers from the bounded zero baseline at ${bounds.min}..${bounds.max}, ${valueAxisOrientation}`, () => {
        const f = fixture("area", { valueAxisOrientation, valueAxis: bounds }),
          c = P.getSlideCharts(f.slide)[0];
        P.setChartSpec(c, {
          ...c.spec,
          series: c.spec.series.map((s) => ({ ...s, values })),
        });
        checkArea(f);
      });
  for (const valueAxisCrosses of ["min", "max", { at: 5 }])
    it(`does not move area label baselines with crossing ${JSON.stringify(valueAxisCrosses)}`, () =>
      checkArea(fixture("area", { valueAxisCrosses })));
  for (const position of ["l", "r", "t", "b", "ctr"])
    for (const valueAxisOrientation of ["minMax", "maxMin"])
      it(`retains explicit line ${position} with ${valueAxisOrientation} axes`, () =>
        checkLine(
          fixture("line", {
            valueAxisOrientation,
            dataLabels: {
              showValue: true,
              position,
              textStyle: { color: labelColors[0] },
            },
          }),
          position,
        ));
  it("keeps line series positions above the chart default", () => {
    const f = fixture("line"),
      c = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(c, {
      ...c.spec,
      dataLabels: { ...c.spec.dataLabels, position: "t" },
      series: c.spec.series.map((s) => ({
        ...s,
        dataLabels: { ...s.dataLabels, showValue: true, position: "r" },
      })),
    });
    checkLine(f);
  });
  it("does not label blank/zero-substituted cells or re-enable disabled series", () => {
    const f = fixture("line", { grouping: "stacked", dispBlanksAs: "zero" }),
      c = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(c, {
      ...c.spec,
      series: c.spec.series.map((s, i) => ({
        ...s,
        values: [2, null, 3],
        ...(i ? { dataLabels: { ...s.dataLabels, showValue: false } } : {}),
      })),
    });
    const r = paint(f);
    expect(r.labels[0].map((l) => l.text)).toEqual(["2", "3"]);
    expect(r.labels[1]).toEqual([]);
  });
  it("uses effective combination kinds for omitted positions", () => {
    const f = fixture("area"),
      c = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(c, {
      ...c.spec,
      series: c.spec.series.map((s, i) => ({
        ...s,
        ...(i ? { chartKind: "line" } : {}),
      })),
    });
    const r = paint(f);
    expect(r.labels[0].every((l) => l.anchor === "middle")).toBe(true);
    expect(r.labels[1].every((l) => l.anchor === "start")).toBe(true);
    const first = r.labels[0][0],
      fraction = (1 - 0) / (12 - 0);
    expect(first.y).toBeCloseTo(
      r.plot.y + (1 - fraction) * r.plot.height + 3,
      1,
    );
  });
  it("rendering is read-only and keeps omitted positions and all path geometry through save/reimport", async () => {
    const f = fixture("area", { grouping: "stacked" }),
      spec = P.getShapeChartSpec(f.shape),
      before = bytes(f.p),
      r = checkArea(f),
      q = await parseDeck(await P.savePresentation(f.p)),
      s = P.getSlides(q)[0],
      shape = P.getSlideCharts(s)[0].shape;
    expect(bytes(f.p)).toEqual(before);
    expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
    expect(P.getShapeChartSpec(shape)).toEqual(spec);
    expect(paint({ p: q, slide: s, shape }).svg).toBe(r.svg);
    expect(paint({ p: q, slide: s, shape }).paths).toEqual(r.paths);
    expect(
      new TextDecoder().decode(
        P._internalPackageOf(q).getPart(chartRoot(shape)).data,
      ),
    ).not.toContain("dLblPos");
    expect(workbook(q, shape).data).toEqual(workbook(f.p, f.shape).data);
  });
  it("transfers defaults both ways and changes the returned copy's kind/data independently", async () => {
    const f = fixture("area", { grouping: "stacked" }),
      original = paint(f).svg,
      book = workbook(f.p, f.shape).data.slice(),
      dest = createDeck("blank"),
      imported = P.importSlide(dest, f.slide, P.getSlideLayouts(dest)[0]),
      c = P.getSlideCharts(imported)[0];
    P.setChartSpec(c, {
      ...c.spec,
      kind: "line",
      valueAxisOrientation: "maxMin",
      series: c.spec.series.map((s, i) => ({
        ...s,
        values: s.values.map((v) => v + 0.25),
        markerSymbol: "circle",
        markerFill: seriesColors[i],
      })),
    });
    const returned = P.importSlide(f.p, imported, P.getSlideLayouts(f.p)[0]),
      shape = P.getSlideCharts(returned)[0].shape;
    checkLine({ p: f.p, slide: returned, shape });
    checkArea(f);
    expect(paint(f).svg).toBe(original);
    expect(workbook(f.p, f.shape).data).toEqual(book);
    const q = await parseDeck(await P.savePresentation(f.p)),
      charts = P.getSlides(q).map((s) => P.getSlideCharts(s)[0]);
    expect(charts.map((c) => c.spec.kind)).toEqual(["area", "line"]);
    expect(charts.every((c) => c.spec.dataLabels.position === undefined)).toBe(
      true,
    );
    expect(new Set(charts.map((c) => workbook(q, c.shape).name)).size).toBe(2);
    expect(P.validatePresentation(q)).toEqual([]);
  });
});
