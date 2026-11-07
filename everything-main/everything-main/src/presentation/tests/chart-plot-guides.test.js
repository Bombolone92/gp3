import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  chartPlotGuidesDeck,
  guideLineModes,
  chartPlotGuideState,
} from "./chart-plot-guides-fixture.js";
import {
  parseXml,
  serializeXml,
  allChildElements,
  qname,
  NS,
} from "../lib/pptx/src/internal/xml/index.ts";
import { buildChartSpaceDoc } from "../lib/pptx/src/internal/chartml/chart-builder.ts";
import { chartPlotContext } from "../lib/pptx/src/internal/chartml/axis-context.ts";
const plotGuideState = chartPlotGuideState;
const decorations = (p, shape) =>
  plotGuideState(p, shape).map(({ members, order, ...state }) => state);
function edit(f, patch = {}) {
  const chart = P.getSlideCharts(f.slide)[0];
  P.setChartSpec(chart, { ...chart.spec, ...patch });
}
const combo = (kind, flag, mode) => [
  { kind: "column" },
  { kind, secondary: true, [flag]: mode },
];

describe("native plot-group guides survive editable rebuilds", () => {
  it("resolves guide ownership with linear work as the series count grows", async () => {
    const { preserveNativeChartPlotGuides } =
      await import("../lib/pptx/src/internal/chartml/native-plot-guides.ts");
    const work = (count) => {
      const spec = {
          kind: "line",
          dropLines: true,
          categories: ["A", "B"],
          series: Array.from({ length: count }, (_, i) => ({
            name: `Series ${i}`,
            values: [(i % 7) - 3, i % 11],
            secondaryAxis: i >= count / 2,
          })),
        },
        source = buildChartSpaceDoc(spec),
        target = buildChartSpaceDoc(spec);
      let reads = 0;
      // Count traversed group children, independently of elapsed time or the
      // choice of traversal helpers. Repeated scans of long groups are quadratic.
      for (const doc of [source, target])
        for (const { element } of chartPlotContext(doc.root).groups)
          element.children = new Proxy(element.children, {
            get(array, key, receiver) {
              if (typeof key === "string" && /^\d+$/.test(key)) reads++;
              return Reflect.get(array, key, receiver);
            },
          });
      preserveNativeChartPlotGuides(source.root, target.root, spec);
      const groups = chartPlotContext(target.root).groups;
      expect(
        groups.map(
          ({ element }) =>
            allChildElements(element, qname("", "ser", NS.chart)).length,
        ),
      ).toEqual([count / 2, count / 2]);
      return reads;
    };
    expect(work(900)).toBeLessThan(work(300) * 4);
  });

  for (const kind of ["line", "area"])
    for (const [mode] of Object.entries(guideLineModes))
      it(`${kind} retains secondary-only ${mode} guides through font and data edits`, async () => {
        const f = chartPlotGuidesDeck({
            groups: combo(kind, "dropLines", mode),
          }),
          before = decorations(f.p, f.shape),
          bytes = f.part.data.slice(),
          book = workbook(f.p, f.shape).data.slice(),
          spec = P.getShapeChartSpec(f.shape);
        expect(spec.dropLines).toBeUndefined();
        preview(f.p, f.slide);
        expect(f.part.data).toEqual(bytes);
        expect(workbook(f.p, f.shape).data).toEqual(book);
        edit(f, { textStyle: { font: "Arial", sizePt: 16 } });
        expect(decorations(f.p, f.shape)).toEqual(before);
        expect(workbook(f.p, f.shape).data).toEqual(book);
        edit(f, {
          series: spec.series.map((s, i) =>
            i === 2 ? { ...s, values: [18, null, 31, -4] } : s,
          ),
        });
        expect(decorations(f.p, f.shape)).toEqual(before);
        const q = await P.loadPresentation(await P.savePresentation(f.p)),
          chart = P.getSlideCharts(P.getSlides(q)[0])[0];
        expect(decorations(q, chart.shape)).toEqual(before);
        expect(chart.spec.series[2].values).toEqual([18, null, 31, -4]);
        expect(P.validatePresentation(q)).toEqual([]);
        for (const g of plotGuideState(q, chart.shape)) {
          if (g.dropLines) {
            expect(g.order.indexOf("dropLines")).toBeLessThan(
              g.order.indexOf("axId"),
            );
            expect(g.order.lastIndexOf("ser")).toBeLessThan(
              g.order.indexOf("dropLines"),
            );
          }
        }
      });

  for (const flag of ["dropLines", "hiLowLines"])
    for (const primary of [false, true])
      for (const secondary of [false, true])
        it(`${flag} keeps independent primary=${primary}, secondary=${secondary} presence`, () => {
          const f = chartPlotGuidesDeck({
              groups: [
                { kind: "line", [flag]: primary ? "gradient" : false },
                {
                  kind: "line",
                  secondary: true,
                  [flag]: secondary ? "pattern" : false,
                },
              ],
            }),
            before = decorations(f.p, f.shape);
          edit(f, { textStyle: { font: "Arial", sizePt: 13 } });
          expect(decorations(f.p, f.shape)).toEqual(before);
        });

  for (const flag of ["dropLines", "hiLowLines"])
    for (const enabled of [false, true, undefined])
      it(`explicit ${flag}=${enabled} respects the chart-wide edit`, () => {
        const f = chartPlotGuidesDeck({
            groups: [
              { kind: "line", [flag]: enabled === true ? false : "gradient" },
              { kind: "line", secondary: true, [flag]: "custom" },
            ],
          }),
          before = decorations(f.p, f.shape);
        edit(f, { [flag]: enabled });
        const after = decorations(f.p, f.shape);
        expect(after.map((g) => !!g[flag])).toEqual([!!enabled, !!enabled]);
        if (enabled) expect(after[1][flag]).toEqual(before[1][flag]);
      });

  it("an explicit false disables secondary-only guides even when the first plot omitted them", () => {
    const f = chartPlotGuidesDeck();
    edit(f, { dropLines: false, hiLowLines: false });
    expect(
      decorations(f.p, f.shape).every((g) => !g.dropLines && !g.hiLowLines),
    ).toBe(true);
  });

  for (const kind of ["line", "area"])
    it(`${kind} retains separate groups sharing the same kind and axes`, () => {
      const f = chartPlotGuidesDeck({
          groups: [
            { kind, dropLines: "gradient", grouping: "standard" },
            {
              kind,
              hiLowLines: kind === "line" ? "color" : false,
              grouping: "stacked",
            },
            { kind, dropLines: "none", grouping: "percentStacked" },
          ],
        }),
        before = decorations(f.p, f.shape);
      edit(f, { textStyle: { font: "Arial", sizePt: 15 } });
      expect(decorations(f.p, f.shape)).toEqual(before);
      expect(plotGuideState(f.p, f.shape).map((g) => g.members)).toEqual([
        [0, 1],
        [2, 3],
        [4, 5],
      ]);
      edit(f, { grouping: "stacked" });
      expect(plotGuideState(f.p, f.shape).map((g) => g.grouping)).toEqual([
        "stacked",
        "stacked",
        "stacked",
      ]);
      expect(decorations(f.p, f.shape).map((g) => g.dropLines)).toEqual(
        before.map((g) => g.dropLines),
      );
    });

  for (const kind of ["line", "area"])
    it(`${kind} retains guides while repairing invalid native groupings`, () => {
      for (const token of ["clustered", "malformed"]) {
        const f = chartPlotGuidesDeck({
            groups: combo(kind, "dropLines", "custom"),
          }),
          doc = parseXml(new TextDecoder().decode(f.part.data)),
          group = chartPlotContext(doc.root).groups[1].element,
          grouping = group.children.find(
            (n) => n.kind === "element" && n.name.localName === "grouping",
          ),
          before = decorations(f.p, f.shape)[1].dropLines;
        grouping.attrs[0].value = token;
        f.part.data = new TextEncoder().encode(serializeXml(doc));
        edit(f, { textStyle: { font: "Arial", sizePt: 14 } });
        const after = decorations(f.p, f.shape)[1];
        expect(after.grouping).toBe("standard");
        expect(after.dropLines).toEqual(before);
      }
    });

  for (const change of ["convert", "reassign", "append", "truncate", "clear"])
    it(`does not attach an obsolete group's guides after ${change}`, () => {
      const f = chartPlotGuidesDeck(),
        spec = P.getShapeChartSpec(f.shape),
        before = decorations(f.p, f.shape)[1];
      let series = spec.series;
      if (change === "convert")
        series = series.map((s) => ({ ...s, chartKind: "column" }));
      if (change === "reassign")
        series = series.map((s) => ({ ...s, secondaryAxis: false }));
      if (change === "append")
        series = [
          ...series,
          {
            name: "New line",
            chartKind: "line",
            secondaryAxis: true,
            values: [1, 2, 3, 4],
          },
        ];
      if (change === "truncate") series = series.slice(0, 3);
      if (change === "clear") series = series.slice(0, 2);
      edit(f, { series });
      const state = decorations(f.p, f.shape);
      if (["convert", "reassign", "clear"].includes(change))
        expect(state.every((g) => !g.dropLines && !g.hiLowLines)).toBe(true);
      else {
        expect(state[1]).toEqual(before);
        if (change === "append") {
          expect(state).toHaveLength(3);
          expect(state[2].dropLines).toBeNull();
          expect(state[2].hiLowLines).toBeNull();
        }
      }
      expect(P.validatePresentation(f.p)).toEqual([]);
    });

  it("keeps unique empty native groups when clearing their data", () => {
    const f = chartPlotGuidesDeck({
        groups: [{ kind: "line", dropLines: "custom", hiLowLines: "color" }],
      }),
      before = decorations(f.p, f.shape);
    edit(f, { series: [], categories: [] });
    expect(decorations(f.p, f.shape)).toEqual(before);
    expect(plotGuideState(f.p, f.shape)[0].members).toEqual([]);
  });

  for (const kind of ["line", "area"])
    it(`${kind} authors valid guide children without a native source`, () => {
      const p = createDeck("blank"),
        slide = P.getSlides(p)[0],
        shape = P.addSlideChart(slide, {
          x: 0,
          y: 0,
          w: P.inches(6),
          h: P.inches(4),
          spec: {
            kind,
            categories: ["A", "B"],
            series: [{ name: "Data", values: [2, 4] }],
            dropLines: true,
            hiLowLines: true,
          },
        }),
        state = plotGuideState(p, shape)[0];
      expect(state.dropLines).not.toBeNull();
      expect(!!state.hiLowLines).toBe(kind === "line");
      expect(state.order.indexOf("dropLines")).toBeLessThan(
        state.order.indexOf("axId"),
      );
    });

  it("preserves native guides through copies in both directions, independent edits, and reload", async () => {
    const f = chartPlotGuidesDeck(),
      before = decorations(f.p, f.shape),
      bytes = f.part.data.slice(),
      book = workbook(f.p, f.shape).data.slice(),
      destination = createDeck("blank"),
      slide = P.importSlide(
        destination,
        f.slide,
        P.getSlideLayouts(destination)[0],
      ),
      copied = P.getSlideCharts(slide)[0];
    expect(decorations(destination, copied.shape)).toEqual(before);
    const back = P.importSlide(f.p, slide, P.getSlideLayout(f.slide)),
      returned = P.getSlideCharts(back)[0];
    P.setChartSpec(returned, {
      ...returned.spec,
      textStyle: { font: "Arial", sizePt: 16 },
      series: returned.spec.series.map((s) => ({
        ...s,
        values: s.values.map((v) => v + 1),
      })),
    });
    const q = await P.loadPresentation(await P.savePresentation(f.p)),
      charts = P.getSlides(q).map((s) => P.getSlideCharts(s)[0]);
    expect(decorations(q, charts.at(-1).shape)).toEqual(before);
    expect(
      P._internalPackageOf(q).getPart(chartRoot(charts[0].shape)).data,
    ).toEqual(bytes);
    expect(workbook(q, charts[0].shape).data).toEqual(book);
    expect(P.validatePresentation(q)).toEqual([]);
    // Namespace bindings are retained even when they were declared above a guide.
    const xml = new TextDecoder().decode(
      P._internalPackageOf(q).getPart(chartRoot(charts.at(-1).shape)).data,
    );
    expect(() => serializeXml(parseXml(xml))).not.toThrow();
  });
});
