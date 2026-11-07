import { canonicalSvgDefinitionIds } from "./svg-definition-ids.js";
import { expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg as renderWithSharedIds } from "../lib/pptx-preview/src/index.ts";
import {
  chartCacheAvailabilityDeck,
  chartDoughnutExtentsDeck,
  setNativeChartCache,
} from "./chart-cache-availability-fixture.js";
import {
  chartLegendLayoutDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";
import { chartRenderingView } from "../lib/pptx/src/api/fn/charts.ts";
import { readChartSeriesDisplays } from "../lib/pptx/src/internal/chartml/blank-display.ts";
import {
  NS,
  firstChildElement,
  getAttrValue,
  parseXml,
  qname,
  serializeXml,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
const names = ["Alpha", "Beta", "Gamma"],
  colors = ["#E85239", "#2F8541", "#376CA8"],
  child = (e, n) => firstChildElement(e, qname("c", n, NS.chart)),
  attr = (e, n) => getAttrValue(e, qname("", n, ""));
function paint(f) {
  const svg = renderSlideToSvg(f.p, f.slide),
    nodes = [];
  walkElements(parseXml(svg).root, (e) => nodes.push(e));
  const texts = nodes
    .filter((e) => e.name.localName === "text")
    .map((e) =>
      e.children
        .filter((n) => n.kind === "text")
        .map((n) => n.data)
        .join(""),
    );
  return {
    svg,
    nodes,
    texts,
    legend: texts.filter((t) => names.includes(t)),
    bars: nodes
      .filter(
        (e) => e.name.localName === "rect" && colors.includes(attr(e, "fill")),
      )
      .map((e) =>
        JSON.stringify(e.attrs.map((a) => [a.name.localName, a.value]).sort()),
      ),
  };
}
const editXml = (f, fn) => {
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data));
  fn(doc.root);
  part.data = new TextEncoder().encode(serializeXml(doc));
};
for (const group of [
  "barChart",
  "lineChart",
  "areaChart",
  "pieChart",
  "doughnutChart",
  "scatterChart",
  "radarChart",
  "bubbleChart",
])
  it(`${group} distinguishes absent numeric value caches from present empty caches by namespace`, () => {
    const channel = ["scatterChart", "bubbleChart"].includes(group)
        ? "yVal"
        : "val",
      root =
        parseXml(`<c:chartSpace xmlns:c="${NS.chart}" xmlns:f="urn:foreign"><c:chart><c:plotArea><f:${group}><c:ser/></f:${group}><c:${group}>
      <c:ser><c:${channel}><c:numRef><c:f>Sheet1!B2:B4</c:f></c:numRef></c:${channel}></c:ser>
      <c:ser><c:${channel}><c:numRef><f:numCache/><c:numCache><c:ptCount val="0"/></c:numCache></c:numRef></c:${channel}></c:ser>
      <c:ser><c:${channel}><c:numLit><c:ptCount val="0"/></c:numLit></c:${channel}></c:ser>
      <c:ser><c:${channel}><c:numRef><f:numCache/></c:numRef></c:${channel}><f:val><c:numLit/></f:val></c:ser>
      <c:ser><c:xVal><c:numLit><c:ptCount val="3"/></c:numLit></c:xVal><c:bubbleSize><c:numLit/></c:bubbleSize></c:ser>
      </c:${group}></c:plotArea></c:chart></c:chartSpace>`).root,
      displays = readChartSeriesDisplays(root);
    expect(displays.map((d) => d.missingValueCache === true)).toEqual([
      true,
      false,
      false,
      true,
      true,
    ]);
    expect(
      displays.every((d) => d.naSpans === undefined && d.naGaps === undefined),
    ).toBe(true);
  });

for (const kind of ["column", "bar"])
  for (const grouping of ["clustered", "stacked", "percentStacked"])
    for (const mode of ["gap", "zero"])
      for (const index of [0, 1, 2])
        it(`${kind} ${grouping} ${mode} compacts missing cache ${index} while preserving original paint and editable series`, () => {
          const options = {
              kind,
              grouping,
              dispBlanksAs: mode,
              legend: undefined,
              gapWidthPct: 85,
              overlapPct: grouping === "clustered" ? -20 : 100,
            },
            f = chartCacheAvailabilityDeck({ ...options, indices: [index] }),
            spec = P.getShapeChartSpec(f.shape),
            expected = chartLegendLayoutDeck({
              sizePt: 14,
              title: "Cache availability",
              ...options,
              series: spec.series.filter((_, i) => i !== index),
            });
          expect(paint(f).bars).toEqual(paint(expected).bars);
          expect(spec.series).toHaveLength(3);
          expect(spec.series[index].values).toEqual([]);
          expect(
            chartRenderingView(f.shape).seriesDisplays[index].missingValueCache,
          ).toBe(true);
          expect(paint(f).svg).not.toMatch(/NaN|Infinity|unsupported|no data/);
        });

for (const kind of ["column", "bar"])
  for (const cache of ["referenceZero", "literalZero", "blank"])
    it(`${kind} retains a cluster slot and legend entry for ${cache}`, () => {
      const f = chartCacheAvailabilityDeck({
          kind,
          cache,
          dispBlanksAs: "gap",
        }),
        g = chartCacheAvailabilityDeck({
          kind,
          cache: "missing",
          dispBlanksAs: "gap",
        });
      expect(paint(f).legend).toEqual(
        kind === "bar" ? [...names].reverse() : names,
      );
      expect(paint(f).bars).not.toEqual(paint(g).bars);
      expect(
        chartRenderingView(f.shape).seriesDisplays[1].missingValueCache,
      ).toBeUndefined();
    });

for (const kind of ["column", "bar"])
  for (const grouping of ["clustered", "stacked", "percentStacked"])
    for (const hidden of [undefined, 0, 1, 2])
      it(`${kind} ${grouping} resolves hidden legend index ${hidden} after removing uncached series`, () => {
        const f = chartCacheAvailabilityDeck({
            kind,
            grouping,
            legend: {
              position: "r",
              ...(hidden === undefined ? {} : { hiddenIndices: [hidden] }),
            },
          }),
          reversed =
            kind === "bar"
              ? grouping === "clustered"
              : grouping !== "clustered",
          order = reversed ? ["Gamma", "Alpha"] : ["Alpha", "Gamma"];
        expect(paint(f).legend).toEqual(order.filter((_, i) => i !== hidden));
      });

for (const kind of ["line", "area", "scatter", "radar", "bubble"])
  for (const cache of ["missing", "literalZero", "blank"])
    it(`${kind} includes only value-cache-bearing series in the legend (${cache})`, () => {
      const f = chartCacheAvailabilityDeck({
        kind,
        cache,
        grouping: "standard",
      });
      expect(paint(f).legend).toEqual(
        cache === "missing" ? ["Alpha", "Gamma"] : names,
      );
      expect(P.getShapeChartSpec(f.shape).series).toHaveLength(3);
    });

for (const kind of ["scatter", "bubble"])
  for (const channel of kind === "bubble" ? ["xVal", "bubbleSize"] : ["xVal"])
    for (const cache of ["missing", "literalZero"])
      it(`${kind} ${channel} ${cache} does not remove value-bearing legend entries`, () => {
        const f = chartCacheAvailabilityDeck({
          kind,
          channel,
          cache,
          indices: [0, 1, 2],
        });
        expect(paint(f).legend).toEqual(names);
        expect(
          chartRenderingView(f.shape).seriesDisplays.some(
            (d) => d.missingValueCache,
          ),
        ).toBe(false);
      });

for (const kind of [
  "column",
  "bar",
  "line",
  "area",
  "scatter",
  "radar",
  "bubble",
  "pie",
  "doughnut",
])
  it(`${kind} missing caches retain authored surfaces and editable content without inventing chart contents`, async () => {
    const f = chartCacheAvailabilityDeck({
      kind,
      indices: [0, 1, 2],
      title: "Cache availability",
    });
    editXml(f, (root) =>
      root.children.splice(
        root.children.indexOf(child(root, "chart")) + 1,
        0,
        parseXml(
          `<c:spPr xmlns:c="${NS.chart}" xmlns:a="${NS.dml}"><a:solidFill><a:srgbClr val="F5CE6C"/></a:solidFill><a:ln w="38100"><a:solidFill><a:srgbClr val="845B20"/></a:solidFill></a:ln></c:spPr>`,
        ).root,
      ),
    );
    const before = paint(f);
    expect(before.texts).toEqual([]);
    expect(before.svg).not.toContain("#ECF5E9");
    const surface = before.nodes.find(
      (e) => e.name.localName === "rect" && attr(e, "fill") === "#F5CE6C",
    );
    expect(surface).toBeDefined();
    expect(attr(surface, "stroke")).toBe("#845B20");
    expect(before.svg).not.toMatch(/unsupported|no data|NaN|Infinity/);
    const p = await P.loadPresentation(await P.savePresentation(f.p)),
      slide = P.getSlides(p)[0];
    expect(paint({ p, slide }).svg).toBe(before.svg);
    expect(P.getSlideCharts(slide)[0].spec.series).toHaveLength(
      ["pie", "doughnut"].includes(kind) ? 1 : 3,
    );
    expect(P.validatePresentation(p)).toEqual([]);
  });

for (const fill of [undefined, null, "#C493D6"])
  it(`all missing caches preserve transparent/default/solid chart surface ${fill}`, () => {
    const f = chartCacheAvailabilityDeck({
      indices: [0, 1, 2],
      chartAreaFill: fill,
      chartAreaStrokeColor: "#675A24",
      roundedCorners: true,
    });
    const r = paint(f),
      surface = r.nodes.find(
        (e) => e.name.localName === "rect" && attr(e, "stroke") === "#675A24",
      );
    expect(attr(surface, "fill")).toBe(fill ?? "none");
    expect(attr(surface, "rx")).toBe("6");
    expect(r.texts).toEqual([]);
  });

for (const kind of [
  "column",
  "bar",
  "line",
  "area",
  "scatter",
  "radar",
  "bubble",
])
  it(`${kind} zero-point caches retain the chart body without a synthetic no-data message`, () => {
    const f = chartCacheAvailabilityDeck({
      kind,
      indices: [0, 1, 2],
      cache: "literalZero",
    });
    expect(paint(f).legend).toEqual(
      kind === "bar" ? [...names].reverse() : names,
    );
    expect(paint(f).svg).not.toMatch(/no data|unsupported/);
  });

for (const kind of ["pie", "doughnut"])
  for (const values of [
    [],
    [4],
    [null],
    [0, 0, 0],
    [null, null, null],
    [2, 4, 3, 1, 5],
  ])
    it(`${kind} uses numeric cache extent ${JSON.stringify(values)} for category legend membership`, () => {
      const f = chartLegendLayoutDeck({
          kind,
          title: "Points",
          categories: ["A", "B", "C"],
          series: [{ name: "Units", values }],
          sizePt: 14,
        }),
        r = paint(f),
        labels = r.texts.filter((t) => ["A", "B", "C", ""].includes(t));
      expect(labels).toEqual(
        Array.from(
          { length: values.length },
          (_, i) => ["A", "B", "C"][i] ?? "",
        ),
      );
      expect(r.texts).toContain("Points");
      expect(r.svg).not.toContain("no data");
    });

for (const legend of [undefined, { position: null }])
  it(`large sparse point caches keep compact output with ${legend ? "a deleted" : "no"} legend`, () => {
    const f = chartLegendLayoutDeck({
      kind: "doughnut",
      title: "Sparse values",
      categories: ["A", "B", "C"],
      series: [{ name: "Units", values: [] }],
      legend,
      sizePt: 14,
    });
    const setCount = (count) =>
      editXml(f, (root) => {
        const series = child(
          child(child(child(root, "chart"), "plotArea"), "doughnutChart"),
          "ser",
        );
        child(series, "val").children = [
          parseXml(
            `<c:numLit xmlns:c="${NS.chart}"><c:ptCount val="${count}"/></c:numLit>`,
          ).root,
        ];
      });
    setCount(0);
    const empty = paint(f);
    setCount(50_000);
    const sparse = paint(f);
    expect(P.getShapeChartSpec(f.shape).series[0].values).toHaveLength(50_000);
    expect(sparse.svg).toBe(empty.svg);
    expect(sparse.texts).toEqual(["Sparse values"]);
    expect(sparse.svg).not.toMatch(/no data|unsupported|NaN|Infinity/);
  });

for (const kind of ["column", "bar", "line", "area"])
  it(`${kind} roundtrips and transfers native cache availability; editing a copy restores its data independently`, async () => {
    const f = chartCacheAvailabilityDeck({ kind }),
      source = P.getSlideCharts(f.slide)[0],
      before = paint(f),
      raw = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data.slice(),
      book = workbook(f.p, f.shape).data.slice(),
      q = createDeck("blank"),
      to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      back = P.importSlide(f.p, to, P.getSlideLayout(f.slide)),
      copy = P.getSlideCharts(back)[0];
    expect(paint({ p: f.p, slide: back }).svg).toBe(before.svg);
    P.setChartSpec(copy, { ...copy.spec, title: "Changed", gapWidthPct: 70 });
    expect(
      chartRenderingView(copy.shape).seriesDisplays[1].missingValueCache,
    ).toBe(true);
    expect(workbook(f.p, copy.shape).data).toEqual(book);
    P.setChartSpec(copy, {
      ...copy.spec,
      series: copy.spec.series.map((s, i) =>
        i === 1 ? { ...s, values: [7, 3] } : s,
      ),
    });
    expect(
      chartRenderingView(copy.shape).seriesDisplays[1].missingValueCache,
    ).toBeUndefined();
    expect(paint({ p: f.p, slide: back }).legend).toContain("Beta");
    expect(paint(f).svg).toBe(before.svg);
    expect(
      P._internalPackageOf(f.p).getPart(chartRoot(source.shape)).data,
    ).toEqual(raw);
    expect(workbook(f.p, source.shape).data).toEqual(book);
    expect(workbook(f.p, copy.shape).name).not.toBe(
      workbook(f.p, source.shape).name,
    );
    const p = await P.loadPresentation(await P.savePresentation(f.p));
    expect(paint({ p, slide: P.getSlides(p)[0] }).svg).toBe(before.svg);
    expect(
      P.getSlideCharts(P.getSlides(p)[1])[0].spec.series[1].values,
    ).toEqual([7, 3]);
    expect(P.validatePresentation(p)).toEqual([]);
  });

for (const kind of ["column", "bar"])
  for (const secondary of [false, true])
    it(`${kind} ${secondary ? "secondary" : "primary"} combo group compacts only its own missing-cache slots`, () => {
      const f = chartLegendLayoutDeck({ kind, legend: undefined, sizePt: 14 }),
        c = P.getSlideCharts(f.slide)[0];
      P.setChartSpec(c, {
        ...c.spec,
        series: [
          ...c.spec.series.map((s) => ({ ...s, secondaryAxis: secondary })),
          {
            name: "Overlay",
            values: [3, 5, 2, 4],
            color: "#6D3BA8",
            ...(kind === "column" ? { chartKind: "line" } : {}),
            secondaryAxis: !secondary,
          },
        ],
      });
      setNativeChartCache(f, {
        indices: [
          P.getShapeChartSpec(f.shape).series.findIndex(
            (s) => s.name === "Beta",
          ),
        ],
      });
      const spec = P.getShapeChartSpec(f.shape),
        expected = chartLegendLayoutDeck({
          kind,
          legend: undefined,
          sizePt: 14,
          ...spec,
          series: spec.series.filter((s) => s.name !== "Beta"),
        });
      expect(paint(f).bars).toEqual(paint(expected).bars);
      expect(paint(f).svg).not.toMatch(/NaN|Infinity/);
    });

for (const counts of [
  [0, 3],
  [1, 3],
  [3, 1],
  [3, 5],
  [5, 3],
  [null, 3],
  [3, null],
  [0, 0],
  [null, 0],
  [0, null],
  [1, 5],
  [5, 1],
  [null, null],
  [3, 3],
])
  it(`native doughnut rings ${JSON.stringify(counts)} share the numeric point legend domain`, async () => {
    const values = counts.map((n) =>
        n === null ? null : Array.from({ length: n }, (_, i) => i + 2),
      ),
      f = chartDoughnutExtentsDeck(values),
      before = paint(f),
      n = Math.max(...counts.map((c) => c ?? 0));
    expect(before.texts.filter((t) => ["A", "B", "C", ""].includes(t))).toEqual(
      Array.from({ length: n }, (_, i) => ["A", "B", "C"][i] ?? ""),
    );
    expect(P.getShapeChartSpec(f.shape).series.map((s) => s.values)).toEqual(
      values.map((v) => v ?? []),
    );
    expect(before.svg).not.toMatch(/no data|NaN|Infinity/);
    expect(before.texts.includes("Rings")).toBe(
      !counts.every((n) => n === null),
    );
    expect(
      chartRenderingView(f.shape).seriesDisplays.map(
        (d) => !!d.missingValueCache,
      ),
    ).toEqual(counts.map((n) => n === null));
    const q = createDeck("blank"),
      to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      back = P.importSlide(f.p, to, P.getSlideLayout(f.slide));
    expect(paint({ p: f.p, slide: back }).svg).toBe(before.svg);
    const p = await P.loadPresentation(await P.savePresentation(f.p));
    expect(paint({ p, slide: P.getSlides(p)[1] }).svg).toBe(before.svg);
    expect(P.validatePresentation(p)).toEqual([]);
  });

function renderSlideToSvg(...args) {
  return canonicalSvgDefinitionIds(renderWithSharedIds(...args));
}
