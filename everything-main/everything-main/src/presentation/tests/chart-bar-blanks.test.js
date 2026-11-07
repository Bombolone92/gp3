import { canonicalSvgDefinitionIds } from "./svg-definition-ids.js";
import { expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg as renderWithSharedIds } from "../lib/pptx-preview/src/index.ts";
import {
  chartLegendLayoutDeck,
  chartLineGapsDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";
import {
  NS,
  firstChildElement,
  getAttrValue,
  parseXml,
  qname,
  serializeXml,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readChartSeriesDisplays } from "../lib/pptx/src/internal/chartml/blank-display.ts";
import { chartRenderingView } from "../lib/pptx/src/api/fn/charts.ts";

const colors = ["#E85239", "#2F8541"],
  D = "#2051BB";
const values = [
  [2, null, 0, 5, null],
  [1, 3, null, 0, null],
];
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const child = (e, n) => firstChildElement(e, qname("c", n, NS.chart));
function options(kind, grouping, dispBlanksAs, extra = {}) {
  return {
    kind,
    grouping,
    dispBlanksAs,
    legend: undefined,
    sizePt: 14,
    categories: ["First", "Second", "Third", "Fourth", "Empty"],
    categoryAxisCrosses: { at: grouping === "percentStacked" ? 0.3 : 3 },
    valueAxis: { min: 0, max: grouping === "percentStacked" ? 1 : 8 },
    series: values.map((values, i) => ({
      name: `Series ${i}`,
      values,
      color: colors[i],
      lineColor: colors[i],
      lineWidthEmu: 38100,
      invertIfNegative: false,
    })),
    dataLabels: {
      showValue: true,
      ...(kind === "area" ? {} : { position: "ctr" }),
      textStyle: { color: D },
    },
    ...extra,
  };
}
function paint(f) {
  const svg = renderSlideToSvg(f.p, f.slide),
    nodes = [];
  walkElements(parseXml(svg).root, (e) => nodes.push(e));
  return {
    svg,
    nodes,
    bars: nodes.filter(
      (e) => e.name.localName === "rect" && colors.includes(attr(e, "fill")),
    ),
    labels: nodes
      .filter((e) => e.name.localName === "text" && attr(e, "fill") === D)
      .map((e) =>
        e.children
          .filter((n) => n.kind === "text")
          .map((n) => n.data)
          .join(""),
      ),
  };
}
const sorted = (a) => [...a].sort();
const geometry = (e) =>
  JSON.stringify(
    e.attrs.map((a) => [a.name.namespaceURI, a.name.localName, a.value]).sort(),
  );
function editXml(f, change) {
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data));
  change(doc.root);
  part.data = new TextEncoder().encode(serializeXml(doc));
}
function errorFixture(kind, grouping, mode, flag) {
  return chartLineGapsDeck({
    ...options(kind, grouping, mode),
    values: values[0],
    naIndices: [1, 4],
    dispNaAsBlank: flag,
    series: [
      {
        name: "Errors",
        values: values[0],
        color: colors[0],
        lineColor: colors[0],
        lineWidthEmu: 38100,
        invertIfNegative: false,
      },
    ],
  });
}

// Native references distinguish absent cache points from authored zero and
// #N/A, even where the numeric model represents both missing/error as null.
for (const kind of ["column", "bar"])
  for (const grouping of ["clustered", "stacked", "percentStacked"])
    for (const mode of ["gap", "span", "zero"])
      for (const direction of ["minMax", "maxMin"])
        it(`${kind} ${grouping} ${mode} ${direction} retains slots, zeros and source-value labels`, () => {
          const extra = {
              categoryAxisOrientation: direction,
              valueAxisOrientation: direction,
            },
            f = chartLegendLayoutDeck(options(kind, grouping, mode, extra)),
            zero = chartLegendLayoutDeck(
              options(kind, grouping, "zero", extra),
            ),
            zeroGeometry = paint(zero).bars.map(geometry),
            r = paint(f),
            expected =
              mode === "zero"
                ? values.flat().map((v) => String(v ?? 0))
                : values
                    .flat()
                    .filter((v) => v !== null)
                    .map(String);
          expect(r.bars).toHaveLength(
            grouping === "clustered" ? (mode === "zero" ? 9 : 5) : 4,
          );
          expect(sorted(r.labels)).toEqual(sorted(expected));
          expect(r.svg).not.toMatch(/NaN|Infinity/);
          for (const bar of r.bars) {
            expect(+attr(bar, "width")).toBeGreaterThan(0);
            expect(+attr(bar, "height")).toBeGreaterThan(0);
            expect(zeroGeometry).toContain(geometry(bar));
          }
          expect(
            P.getShapeChartSpec(f.shape).series.map((s) => s.values),
          ).toEqual(values);
          expect(P.getShapeChartSpec(f.shape).dispBlanksAs).toBe(mode);
        });

for (const kind of ["column", "bar", "line", "area"])
  for (const native of ["absent", "empty"])
    it(`${kind} resolves native ${native} blank display to zero without writing that default`, async () => {
      const f = chartLegendLayoutDeck(options(kind, "clustered", "zero")),
        zero = paint(f).svg;
      editXml(f, (root) => {
        const chart = child(root, "chart"),
          dba = child(chart, "dispBlanksAs");
        if (native === "absent")
          chart.children = chart.children.filter((e) => e !== dba);
        else dba.attrs = [];
      });
      const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
        bytes = part.data.slice(),
        book = workbook(f.p, f.shape).data.slice();
      expect(P.getShapeChartSpec(f.shape).dispBlanksAs).toBeUndefined();
      expect(
        chartRenderingView(f.shape).seriesDisplays.map((d) => d.blank),
      ).toEqual(["zero", "zero"]);
      expect(paint(f).svg).toBe(zero);
      const p = await P.loadPresentation(await P.savePresentation(f.p)),
        slide = P.getSlides(p)[0],
        c = P.getSlideCharts(slide)[0];
      expect(paint({ p, slide }).svg).toBe(zero);
      expect(P._internalPackageOf(p).getPart(chartRoot(c.shape)).data).toEqual(
        bytes,
      );
      expect(workbook(p, c.shape).data).toEqual(book);
      expect(c.spec.dispBlanksAs).toBeUndefined();
      expect(P.validatePresentation(p)).toEqual([]);
    });

for (const kind of ["column", "bar"])
  for (const grouping of ["clustered", "stacked", "percentStacked"])
    for (const mode of ["gap", "span", "zero"])
      for (const flag of [undefined, false, true])
        it(`${kind} ${grouping} ${mode} treats #N/A independently with dispNaAsBlank ${flag}`, () => {
          const f = errorFixture(kind, grouping, mode, flag),
            r = paint(f),
            blankZero = flag === true && mode === "zero",
            expectedLabels =
              flag === true
                ? mode === "zero"
                  ? ["2", "0", "0", "5", "0"]
                  : ["2", "0", "5"]
                : ["2", "#N/A", "0", "5", "#N/A"];
          expect(r.bars).toHaveLength(
            grouping === "clustered" ? (blankZero ? 5 : 3) : 2,
          );
          expect(r.labels).toEqual(expectedLabels);
          const view = chartRenderingView(f.shape);
          expect([...(view.seriesDisplays[0].naGaps ?? [])]).toEqual(
            flag === true ? [] : [1, 4],
          );
          expect(view.spec.series[0].values).toEqual(values[0]);
          expect(r.svg).not.toMatch(/NaN|Infinity/);
        });

for (const kind of ["column", "bar"])
  for (const grouping of ["stacked", "percentStacked"])
    it(`${kind} ${grouping} keeps labels for zero-only categories without painting zero-extent strokes`, () => {
      const f = chartLegendLayoutDeck(
          options(kind, grouping, "gap", {
            categories: ["A", "B"],
            series: colors.map((color, i) => ({
              name: String(i),
              values: [0, 0],
              color,
              lineWidthEmu: 76200,
            })),
          }),
        ),
        r = paint(f);
      expect(r.bars).toHaveLength(0);
      expect(r.labels).toEqual(["0", "0", "0", "0"]);
    });

for (const kind of ["column", "bar"])
  it(`${kind} percentage-stacked showValue formats source values rather than normalized geometry`, () => {
    const f = chartLegendLayoutDeck(
      options(kind, "percentStacked", "gap", {
        categories: ["A", "B"],
        series: colors.map((color, i) => ({
          name: String(i),
          values: i ? [0.8, 0.6] : [0.2, 0.4],
          color,
        })),
        dataLabels: {
          showValue: true,
          numberFormat: "0.0%",
          textStyle: { color: D },
        },
      }),
    );
    expect(paint(f).labels).toEqual(["20.0%", "80.0%", "40.0%", "60.0%"]);
  });

it("native #N/A metadata is sparse, per group and last-record-wins for cache and literal channels", () => {
  for (const channel of ["<c:numLit>", "<c:numRef><c:numCache>"]) {
    const close = channel.includes("numRef")
        ? "</c:numCache></c:numRef>"
        : "</c:numLit>",
      points = `${channel}<c:ptCount val="1"/><c:pt idx="0"><c:v>#N/A</c:v></c:pt><c:pt idx="0"><c:v></c:v></c:pt><c:pt idx="2000000000"><c:v>#N/A</c:v></c:pt><f:pt idx="8"><c:v>#N/A</c:v></f:pt>${close}`,
      root = parseXml(
        `<c:chartSpace xmlns:c="${NS.chart}" xmlns:f="urn:foreign"><c:chart><c:plotArea><f:barChart><c:ser/></f:barChart><c:barChart><c:ser><c:val>${points}</c:val></c:ser></c:barChart><c:lineChart><c:grouping val="standard"/><c:ser><c:val>${points}</c:val></c:ser></c:lineChart><c:areaChart><c:ser><c:val>${points}</c:val></c:ser></c:areaChart></c:plotArea><c:dispBlanksAs val="zero"/></c:chart></c:chartSpace>`,
      ).root,
      display = readChartSeriesDisplays(root);
    expect(display).toHaveLength(3);
    expect([...(display[0].naGaps ?? [])]).toEqual([2000000000]);
    expect(display[0].naSpans).toBeUndefined();
    expect([...(display[1].naSpans ?? [])]).toEqual([2000000000]);
    expect(display[1].naGaps).toBeUndefined();
    expect(display[2]).toEqual({ blank: "zero" });
  }
});

for (const kind of ["column", "bar"])
  for (const secondary of [false, true])
    it(`${kind} ${secondary ? "secondary" : "primary"} errors survive regrouping, independent edits and transfer both ways`, async () => {
      const f = errorFixture(kind, "clustered", "span", false),
        source = P.getSlideCharts(f.slide)[0];
      P.setChartSpec(source, {
        ...source.spec,
        secondaryCategoryAxisCrosses: { at: 3 },
        series: [
          { ...source.spec.series[0], secondaryAxis: secondary },
          {
            name: "Other",
            values: [1, null, 4, 3, null],
            color: colors[1],
            ...(kind === "column" && !secondary
              ? { chartKind: "line", markerSymbol: "circle" }
              : {}),
            dataLabels: { showValue: false },
          },
        ],
      });
      const before = paint(f),
        raw = P._internalPackageOf(f.p)
          .getPart(chartRoot(f.shape))
          .data.slice(),
        book = workbook(f.p, f.shape).data.slice(),
        q = createDeck("blank"),
        to = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
        back = P.importSlide(f.p, to, P.getSlideLayout(f.slide)),
        copy = P.getSlideCharts(back)[0];
      expect(paint({ p: f.p, slide: back }).svg).toBe(before.svg);
      P.setChartSpec(copy, {
        ...copy.spec,
        dispBlanksAs: "zero",
        series: copy.spec.series.map((s) => ({
          ...s,
          values: s.values.map((v) => (v === null ? null : v + 0.25)),
        })),
      });
      const p = await P.loadPresentation(await P.savePresentation(f.p)),
        slides = P.getSlides(p),
        original = P.getSlideCharts(slides[0])[0],
        edited = P.getSlideCharts(slides[1])[0];
      expect(paint({ p, slide: slides[0] }).svg).toBe(before.svg);
      expect(
        P._internalPackageOf(p).getPart(chartRoot(original.shape)).data,
      ).toEqual(raw);
      expect(workbook(p, original.shape).data).toEqual(book);
      expect(workbook(p, original.shape).name).not.toBe(
        workbook(p, edited.shape).name,
      );
      const i = edited.spec.series.findIndex((s) => s.name === "Errors");
      expect([
        ...chartRenderingView(edited.shape).seriesDisplays[i].naGaps,
      ]).toEqual([1, 4]);
      expect(edited.spec.series[i].values).toEqual([
        2.25,
        null,
        0.25,
        5.25,
        null,
      ]);
      expect(paint({ p, slide: slides[1] }).labels).toEqual([
        "2.25",
        "#N/A",
        "0.25",
        "5.25",
        "#N/A",
      ]);
      expect(P.validatePresentation(p)).toEqual([]);
    });

for (const kind of ["column", "bar", "line", "area"])
  for (const mode of ["gap", "zero"])
    it(`${kind} ${mode} preserves short and empty numeric extents through editable rebuilds`, async () => {
      const input = [[2, null], [1, 3, null, 0, null], []],
        f = chartLegendLayoutDeck(
          options(kind, "clustered", mode, {
            series: input.map((values, i) => ({
              name: `Extent ${i}`,
              // Keep this geometry-only override consistent with options().
              invertIfNegative: false,
              values,
              color: [...colors, "#376CA8"][i],
              markerSymbol: "circle",
              markerSizePt: 8,
              smooth: false,
            })),
          }),
        ),
        r = paint(f);
      expect(P.getShapeChartSpec(f.shape).series.map((s) => s.values)).toEqual(
        input,
      );
      if (kind === "bar" || kind === "column") {
        expect(r.bars).toHaveLength(mode === "zero" ? 6 : 3);
        expect(sorted(r.labels)).toEqual(
          sorted(
            mode === "zero"
              ? ["2", "0", "1", "3", "0", "0", "0"]
              : ["2", "1", "3", "0"],
          ),
        );
      } else {
        const paths = r.nodes.filter(
          (e) =>
            e.name.localName === "path" &&
            attr(e, "d") &&
            (attr(e, "fill") === colors[0] || attr(e, "stroke") === colors[0]),
        );
        for (const path of paths) {
          const coordinates = attr(path, "d")
              .match(/-?\d+(?:\.\d+)?/g)
              .map(Number),
            outline = r.nodes.find(
              (e) =>
                e.name.localName === "rect" && attr(e, "stroke") === "#23916F",
            );
          expect(
            Math.max(...coordinates.filter((_, i) => i % 2 === 0)),
          ).toBeLessThan(+attr(outline, "x") + +attr(outline, "width") / 2);
        }
        if (kind === "line")
          expect(
            r.nodes.filter(
              (e) =>
                e.name.localName === "circle" && attr(e, "fill") === colors[0],
            ),
          ).toHaveLength(mode === "zero" ? 2 : 1);
      }
      expect(
        r.nodes.filter(
          (e) =>
            (attr(e, "fill") === "#376CA8" ||
              attr(e, "stroke") === "#376CA8") &&
            (e.name.localName !== "path" || attr(e, "d")),
        ),
      ).toHaveLength(0);
      const chart = P.getSlideCharts(f.slide)[0];
      P.setChartSpec(chart, { ...chart.spec });
      const p = await P.loadPresentation(await P.savePresentation(f.p)),
        slide = P.getSlides(p)[0],
        c = P.getSlideCharts(slide)[0];
      expect(c.spec.series.map((s) => s.values)).toEqual(input);
      expect(paint({ p, slide }).svg).toBe(r.svg);
      const root = parseXml(
          new TextDecoder().decode(
            P._internalPackageOf(p).getPart(chartRoot(c.shape)).data,
          ),
        ).root,
        counts = [];
      walkElements(root, (e) => {
        if (
          e.name.namespaceURI === NS.chart &&
          ["numCache", "numLit"].includes(e.name.localName)
        )
          counts.push(+attr(child(e, "ptCount"), "val"));
      });
      expect(counts).toEqual([2, 5, 0]);
      expect(P.validatePresentation(p)).toEqual([]);
    });

function renderSlideToSvg(...args) {
  return canonicalSvgDefinitionIds(renderWithSharedIds(...args));
}
