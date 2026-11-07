import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  chartLegendOrderDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

const forward = ["Alpha", "Beta", "Gamma"],
  reverse = [...forward].reverse(),
  colors = { Alpha: "#E85239", Beta: "#2F8541", Gamma: "#376CA8" };
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
function legend(f) {
  const entries = [];
  walkElements(
    parseXml(
      decodeURIComponent(preview(f.p, f.slide).split(",").slice(1).join(",")),
    ).root,
    (parent) => {
      parent.children.forEach((e, i) => {
        if (e.kind !== "element" || e.name.localName !== "text") return;
        const text = e.children
          .filter((c) => c.kind === "text")
          .map((c) => c.data)
          .join("");
        if (!forward.includes(text)) return;
        const previous = parent.children
          .slice(0, i)
          .filter((c) => c.kind === "element")
          .at(-1);
        entries.push({ name: text, key: previous });
      });
    },
  );
  return entries;
}
const order = (f) => legend(f).map((e) => e.name);

describe("native automatic legend order", () => {
  // Expected rows come from independent native reference controls. Stacked
  // vertical legends reverse; horizontal stacked legends and stacked bars do not.
  const expected = {
    bar: {
      clustered: {
        minMax: [reverse, reverse, reverse, reverse, reverse],
        maxMin: [forward, forward, forward, forward, forward],
      },
      stacked: {
        minMax: [forward, forward, forward, forward, forward],
        maxMin: [forward, forward, forward, forward, forward],
      },
    },
    column: {
      clustered: {
        minMax: [forward, forward, forward, forward, forward],
        maxMin: [forward, forward, forward, forward, forward],
      },
      stacked: {
        minMax: [forward, forward, reverse, reverse, reverse],
        maxMin: [forward, forward, reverse, reverse, reverse],
      },
    },
    line: {
      clustered: {
        minMax: [forward, forward, forward, forward, forward],
        maxMin: [forward, forward, forward, forward, forward],
      },
      stacked: {
        minMax: [forward, forward, reverse, reverse, reverse],
        maxMin: [forward, forward, reverse, reverse, reverse],
      },
    },
    area: {
      clustered: {
        minMax: [forward, forward, forward, forward, forward],
        maxMin: [forward, forward, forward, forward, forward],
      },
      stacked: {
        minMax: [forward, forward, reverse, reverse, reverse],
        maxMin: [forward, forward, reverse, reverse, reverse],
      },
    },
  };
  for (const kind of Object.keys(expected))
    for (const grouping of ["clustered", "stacked", "percentStacked"])
      for (const direction of ["minMax", "maxMin"])
        for (const [i, position] of ["b", "t", "r", "l", "tr"].entries())
          it(`${kind} ${grouping} ${direction} ${position} uses native ordering without reordering data or paint`, () => {
            const f = chartLegendOrderDeck({
                kind,
                grouping,
                categoryAxisOrientation: direction,
                legend: { position },
              }),
              before = P.getShapeChartSpec(f.shape),
              part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
              bytes = part.data.slice();
            const entries = legend(f);
            expect(entries.map((e) => e.name)).toEqual(
              expected[kind][
                grouping === "percentStacked" ? "stacked" : grouping
              ][direction][i],
            );
            for (const entry of entries) {
              const paint =
                attr(entry.key, "fill") ?? attr(entry.key, "stroke");
              expect(paint).toBe(colors[entry.name]);
            }
            expect(P.getShapeChartSpec(f.shape)).toEqual(before);
            expect(part.data).toEqual(bytes);
          });
  for (const [index, result] of [
    [0, ["Beta", "Alpha"]],
    [1, ["Gamma", "Alpha"]],
    [2, ["Gamma", "Beta"]],
  ])
    it(`native legend-entry index ${index} hides the corresponding ordered entry and still plots every series`, () => {
      const f = chartLegendOrderDeck({
        legend: { position: "b", hiddenIndices: [index] },
      });
      expect(order(f)).toEqual(result);
      expect(P.getShapeChartSpec(f.shape).series.map((s) => s.name)).toEqual(
        forward,
      );
    });
  it("omitted grouping/direction use clustered/minMax behavior, while an omitted or deleted legend stays absent", () => {
    const f = chartLegendOrderDeck();
    expect(order(f)).toEqual(reverse);
    const c = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(c, { ...c.spec, legend: undefined });
    expect(order(f)).toEqual([]);
    P.setChartSpec(P.getSlideCharts(f.slide)[0], {
      ...c.spec,
      legend: { position: null },
    });
    expect(order(f)).toEqual([]);
  });
  for (const kind of ["pie", "doughnut"])
    it(`${kind} retains slice/category order and point-color association`, () => {
      const f = chartLegendOrderDeck({
        kind,
        categories: forward,
        series: [
          {
            name: "Units",
            values: [2, 4, 6],
            pointColors: [colors.Alpha, colors.Beta, colors.Gamma],
          },
        ],
        legend: { position: "r", hiddenIndices: [1] },
      });
      expect(order(f)).toEqual(["Alpha", "Gamma"]);
      for (const e of legend(f))
        expect(attr(e.key, "fill")).toBe(colors[e.name]);
    });
  it("reversed and hidden line legends retain automatic marker identities from the plotted series", () => {
    const f = chartLegendOrderDeck({
        kind: "line",
        grouping: "stacked",
        lineMarkers: true,
        legend: { position: "r", hiddenIndices: [0] },
      }),
      entries = legend(f);
    expect(entries.map((e) => e.name)).toEqual(["Beta", "Alpha"]);
    expect(entries[0].key.name.localName).toBe("rect");
    expect(entries[1].key.name.localName).toBe("polygon");
    expect(attr(entries[1].key, "points").split(" ")).toHaveLength(4);
    for (const e of entries) expect(attr(e.key, "fill")).toBe(colors[e.name]);
  });
  it("mixed native plot groups retain group order while ordering each group's entries independently", () => {
    const f = chartLegendOrderDeck({
      kind: "column",
      grouping: "stacked",
      legend: { position: "r" },
      series: [
        { name: "Alpha", values: [2, 4], color: colors.Alpha },
        { name: "Beta", values: [3, 2], color: colors.Beta },
        {
          name: "Gamma",
          values: [5, 3],
          color: colors.Gamma,
          chartKind: "line",
          markerSymbol: "circle",
        },
      ],
    });
    expect(order(f)).toEqual(["Beta", "Alpha", "Gamma"]);
  });
  it("export/reimport and independent transfers retain native metadata and editable data while preserving legend order", async () => {
    const f = chartLegendOrderDeck({
        legend: { position: "b", hiddenIndices: [0] },
      }),
      q = createDeck("blank"),
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
      expect(order({ p, slide })).toEqual(["Beta", "Alpha"]);
      const c = P.getSlideCharts(slide)[0];
      P.setChartSpec(c, {
        ...c.spec,
        categoryAxisOrientation: "maxMin",
        series: c.spec.series.map((s) => ({
          ...s,
          values: s.values.map((v) => v + 2),
        })),
      });
      const saved = await P.loadPresentation(await P.savePresentation(p)),
        loaded = { p: saved, slide: P.getSlides(saved).at(-1) };
      expect(order(loaded)).toEqual(["Beta", "Gamma"]);
      expect(P.validatePresentation(saved)).toEqual([]);
    }
    expect(order(f)).toEqual(["Beta", "Alpha"]);
    expect(P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data).toEqual(
      native,
    );
    expect(workbook(f.p, f.shape).data).toEqual(book);
  });
});
