import { describe, expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { chartRenderingView } from "../lib/pptx/src/api/fn/charts.ts";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  chartAxisGridDeck,
  setChartAxisGridDeclarations,
} from "./chart-axis-grid-fixture.js";
import {
  chartMarkerPaintDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";
import { axisLineModes } from "./chart-axis-line-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  qname,
  walkElements,
  getAttrValue,
} from "../lib/pptx/src/internal/xml/index.ts";

const colors = {
  value: "#202020",
  category: "#604020",
  major: "#D02040",
  minor: "#2080C0",
  catMajor: "#20A040",
  catMinor: "#A040C0",
};
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const num = (e, n) => Number(attr(e, n));
const measure = (_, font) => ({
  widthPx: font.sizePx,
  ascentPx: font.sizePx * 0.8,
  descentPx: font.sizePx * 0.2,
});
export function gridFixture(options = {}) {
  return chartAxisGridDeck({
    kind: "column",
    plotAreaFill: "#ECF5E9",
    legend: undefined,
    title: undefined,
    categories: ["A", "B", "C", "D"],
    series: [{ name: "Data", values: [1, 4, 2, 3], color: "#E85239" }],
    valueAxis: { min: 0, max: 5, majorUnit: 1, minorUnit: 0.2 },
    valueAxisLineColor: colors.value,
    categoryAxisLineColor: colors.category,
    valueAxisMajorGridlines: true,
    valueAxisMinorGridlines: true,
    valueAxisMajorGridlineColor: colors.major,
    valueAxisMinorGridlineColor: colors.minor,
    categoryAxisMajorGridlineColor: colors.catMajor,
    categoryAxisMinorGridlineColor: colors.catMinor,
    valueAxisMajorTickMark: "none",
    categoryAxisMajorTickMark: "none",
    valueAxisLabelRotationDeg: 0,
    categoryAxisLabelRotationDeg: 0,
    ...options,
  });
}
function paint(f) {
  const nodes = [];
  walkElements(
    parseXml(renderSlideToSvg(f.p, f.slide, { measureText: measure })).root,
    (e) => nodes.push(e),
  );
  const plot = nodes.find(
    (e) => e.name.localName === "rect" && attr(e, "fill") === "#ECF5E9",
  );
  const lines = (color) =>
    nodes.filter(
      (e) => e.name.localName === "line" && attr(e, "stroke") === color,
    );
  const positions = (color, horizontal) =>
    lines(color).map((e) =>
      horizontal
        ? (num(e, "x1") - num(plot, "x")) / num(plot, "width")
        : 1 - (num(e, "y1") - num(plot, "y")) / num(plot, "height"),
    );
  return { nodes, plot, lines, positions };
}
const close = (actual, expected) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 4));
};

describe("native linear axis grid lattices", () => {
  for (const kind of ["column", "bar", "line", "area"])
    for (const reverse of [false, true])
      for (const [crossing, excluded] of [
        ["min", 0],
        ["max", 5],
        [{ at: 2 }, 2],
        [{ at: 2.4 }, 2.4],
      ])
        it(`${kind} reverse ${reverse} excludes only the painted crossing ${JSON.stringify(crossing)}`, () => {
          const r = paint(
            gridFixture({
              kind,
              categoryAxisCrosses: crossing,
              valueAxisOrientation: reverse ? "maxMin" : "minMax",
            }),
          );
          const project = (v) => (reverse ? 1 - v / 5 : v / 5);
          close(
            r.positions(colors.major, kind === "bar"),
            [0, 1, 2, 3, 4, 5].filter((v) => v !== excluded).map(project),
          );
          close(
            r.positions(colors.minor, kind === "bar"),
            Array.from({ length: 26 }, (_, i) => i / 5)
              .filter(
                (v) => !Number.isInteger(v) && Math.abs(v - excluded) > 1e-9,
              )
              .map(project),
          );
        });
  for (const mode of ["none", "zero", "transparent", "hidden"])
    it(`${mode} crossing paint controls grid occupancy independently of line width`, () => {
      const transparent =
        '<a:ln><a:solidFill><a:srgbClr val="000000"><a:alpha val="0"/></a:srgbClr></a:solidFill></a:ln>';
      const f = gridFixture({
          lines: {
            category:
              mode === "transparent" ? transparent : axisLineModes[mode],
          },
          axes: { category: { hidden: mode === "hidden" } },
        }),
        r = paint(f);
      expect(r.lines(colors.major)).toHaveLength(mode === "zero" ? 5 : 6);
      expect(r.lines(colors.minor)).toHaveLength(20);
    });
  it("retains grids on deleted axes without painting their labels, marks or spine", () => {
    const r = paint(
      gridFixture({ valueAxisHidden: true, valueAxisMinorTickMark: "cross" }),
    );
    expect(r.lines(colors.major)).toHaveLength(5);
    expect(r.lines(colors.minor)).toHaveLength(20);
    expect(r.lines(colors.value)).toHaveLength(0);
  });
  for (const major of [false, true, "<a:ln><a:noFill/></a:ln>"])
    it(`numeric minor overlap depends on authored major presence ${major}`, () => {
      const r = paint(
        gridFixture({
          axes: { value: { major } },
          categoryAxisLineColor: null,
        }),
      );
      expect(r.lines(colors.minor)).toHaveLength(major === false ? 26 : 20);
    });
  for (const minorUnit of [undefined, 0.5, 2, 10])
    it(`resolves independent minor unit ${minorUnit}`, () => {
      const r = paint(
        gridFixture({
          valueAxis: {
            min: -2.5,
            max: 4.3,
            majorUnit: 2,
            ...(minorUnit === undefined ? {} : { minorUnit }),
          },
          valueAxisMajorGridlines: false,
          categoryAxisLineColor: null,
        }),
      );
      const expected =
        minorUnit === undefined
          ? Array.from({ length: 18 }, (_, i) => (i * 0.4) / 6.8)
          : minorUnit === 0.5
            ? Array.from({ length: 14 }, (_, i) => (i * 0.5) / 6.8)
            : minorUnit === 2
              ? [0, 2 / 6.8, 4 / 6.8, 6 / 6.8]
              : [0];
      close(r.positions(colors.minor, false), expected);
    });
  for (const minorUnit of [0.001, 0.0001, Number.MIN_VALUE])
    it(`fits dense minor intervals before enumeration for unit ${minorUnit}`, () => {
      const r = paint(
        gridFixture({
          valueAxis: { min: 0, max: 1, majorUnit: 1, minorUnit },
          valueAxisMajorGridlines: false,
        }),
      );
      const values = r.positions(colors.minor, false);
      expect(values).toHaveLength(500);
      expect(values[0]).toBeCloseTo(0.002, 4);
      expect(values.at(-1)).toBe(1);
    });
});

describe("native category axis grids", () => {
  for (const kind of ["column", "bar", "line", "area"])
    for (const between of ["between", "midCat"])
      for (const skip of [1, 2, 3, 4])
        it(`${kind} ${between} skip ${skip} uses category spacing independently of labels`, () => {
          const span = between === "between" ? 4 : 3;
          const r = paint(
            gridFixture({
              kind,
              valueAxisCrossBetween: between,
              valueAxisLineColor: null,
              categoryAxisMajorGridlines: true,
              categoryAxisMinorGridlines: true,
              categoryAxisTickMarkSkip: skip,
              categoryAxisTickLabelSkip: 3,
            }),
          );
          const major = {
            between: { 1: [0, 1, 2, 3, 4], 2: [0, 2, 4], 3: [0, 3], 4: [0, 4] },
            midCat: { 1: [0, 1, 2, 3], 2: [0, 2], 3: [0, 3], 4: [0] },
          }[between][skip];
          const minor =
            skip % 2 === 0
              ? []
              : skip === 1
                ? between === "between"
                  ? [0.5, 1.5, 2.5, 3.5]
                  : [0.5, 1.5, 2.5]
                : [1.5];
          close(
            r.positions(colors.catMajor, kind !== "bar"),
            major.map((v) => v / span),
          );
          close(
            r.positions(colors.catMinor, kind !== "bar"),
            minor.map((v) => v / span),
          );
        });
  it("unpainted category major grids still exclude whole category minor positions", () => {
    const r = paint(
      gridFixture({
        categoryAxisMajorGridlines: true,
        categoryAxisMinorGridlines: true,
        categoryAxisTickMarkSkip: 3,
        axes: { category: { major: "<a:ln><a:noFill/></a:ln>" } },
        valueAxisLineColor: null,
      }),
    );
    close(r.positions(colors.catMinor, true), [1.5 / 4]);
  });
});

describe("independent minor tick marks", () => {
  for (const kind of ["column", "bar"])
    for (const mode of ["out", "in", "cross", "none"])
      for (const major of ["out", "none"])
        it(`${kind} minor ${mode} major ${major} retains overlapping tick positions`, () => {
          const r = paint(
            gridFixture({
              kind,
              valueAxisMajorTickMark: major,
              valueAxisMinorTickMark: mode,
              valueAxisLabelStyle: { sizePt: 15 },
              valueAxisMajorGridlines: false,
              valueAxisMinorGridlines: false,
            }),
          );
          const marks = r
            .lines(colors.value)
            .filter((e) =>
              kind === "bar"
                ? num(e, "x1") === num(e, "x2")
                : num(e, "y1") === num(e, "y2"),
            );
          expect(marks).toHaveLength(
            (mode === "none" ? 0 : 26) + (major === "none" ? 0 : 6),
          );
          const minorLength =
            ((((15 * 4) / 3) * 0.8) / 4) * (mode === "cross" ? 2 : 1);
          if (mode !== "none")
            marks
              .slice(0, 26)
              .forEach((e) =>
                expect(
                  Math.hypot(
                    num(e, "x2") - num(e, "x1"),
                    num(e, "y2") - num(e, "y1"),
                  ),
                ).toBeCloseTo(minorLength, 1),
              );
        });
  it("clamps the final category minor mark to its lattice rather than a plot edge", () => {
    const r = paint(
      gridFixture({
        categoryAxisMajorTickMark: "out",
        categoryAxisMinorTickMark: "out",
        categoryAxisTickMarkSkip: 3,
      }),
    );
    const marks = r
      .lines(colors.category)
      .filter((e) => num(e, "x1") === num(e, "x2"));
    close(
      marks
        .slice(0, 2)
        .map((e) => (num(e, "x1") - num(r.plot, "x")) / num(r.plot, "width")),
      [1.5 / 4, 3 / 4],
    );
  });
});

describe("independent secondary axis declarations", () => {
  const fixture = (kind, hidden, catHidden, crossing = "min") =>
    gridFixture({
      kind,
      categoryAxisTickLabelSkip: 3,
      categoryAxisLabelRotationDeg: 45,
      valueAxis: { min: 0, max: 60, majorUnit: 10 },
      valueAxisMajorGridlines: false,
      valueAxisMinorGridlines: false,
      secondaryCategoryAxisCrosses: crossing,
      secondaryValueAxisMajorGridlineColor: undefined,
      series: [
        { name: "Primary", values: [10, 40, 20, 30], color: "#E85239" },
        {
          name: "Secondary",
          chartKind: kind === "bar" ? "bar" : "line",
          secondaryAxis: true,
          values: [10, 40, 20, 30],
          color: "#376CA8",
        },
      ],
      axes: {
        secondaryValue: {
          min: 10,
          max: 50,
          majorUnit: 10,
          minorUnit: 2,
          hidden,
          major:
            '<a:ln><a:solidFill><a:srgbClr val="D02040"/></a:solidFill></a:ln>',
          minor:
            '<a:ln><a:solidFill><a:srgbClr val="2080C0"/></a:solidFill></a:ln>',
          majorTickMark: "out",
          minorTickMark: "out",
        },
        secondaryCategory: { hidden: catHidden },
      },
    });
  for (const kind of ["column", "bar"])
    for (const hidden of [false, true])
      for (const catHidden of [false, true])
        for (const [crossing, excluded] of [
          ["min", 10],
          ["max", 50],
          [{ at: 20 }, 20],
          [{ at: 30 }, 30],
        ])
          it(`${kind} deleted ${hidden} crossing-deleted ${catHidden} ${JSON.stringify(crossing)} retains its own units`, () => {
            const f = fixture(kind, hidden, catHidden, crossing),
              r = paint(f),
              min = hidden ? 0 : 10,
              max = hidden ? 60 : 50,
              expected = (
                hidden ? [0, 10, 20, 30, 40, 50, 60] : [10, 20, 30, 40, 50]
              )
                .filter((v) => catHidden || v !== excluded)
                .map((v) => (v - min) / (max - min));
            close(r.positions(colors.major, kind === "bar"), expected);
            expect(r.lines(colors.minor)).toHaveLength(hidden ? 24 : 16);
          });
  it("does not inherit primary category label stride or rotation into the secondary pair", () => {
    const f = fixture("column", false, false),
      r = paint(f),
      labels = r.nodes.filter(
        (e) =>
          e.name.localName === "text" &&
          ["A", "B", "C", "D"].includes(
            e.children
              .filter((c) => c.kind === "text")
              .map((c) => c.data)
              .join(""),
          ),
      );
    expect(labels).toHaveLength(6); // Two primary labels, four secondary labels.
    expect(
      labels.filter((e) => attr(e, "transform")?.startsWith("rotate(45")),
    ).toHaveLength(2);
  });
  it("keeps declared scales, minor paints and workbooks through clipboard both ways, data edits and export", async () => {
    const f = fixture("column", false, false),
      before = f.part.data.slice(),
      book = workbook(f.p, f.shape).data.slice(),
      expected = chartRenderingView(f.shape).axisLines,
      q = createDeck("blank"),
      copied = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      back = P.importSlide(f.p, copied, P.getSlideLayout(f.slide));
    for (const [p, slide] of [
      [q, copied],
      [f.p, back],
    ]) {
      const c = P.getSlideCharts(slide)[0];
      expect(chartRenderingView(c.shape).axisLines).toEqual(expected);
      P.setChartSpec(c, {
        ...c.spec,
        series: c.spec.series.map((s) => ({ ...s, values: [12, 38, 18, 28] })),
      });
      expect(chartRenderingView(c.shape).axisLines).toEqual(expected);
      const reopened = await P.loadPresentation(await P.savePresentation(p)),
        saved = P.getSlides(reopened).at(-1),
        shape = P.getSlideCharts(saved)[0].shape;
      expect(chartRenderingView(shape).axisLines).toEqual(expected);
      expect(P.getShapeChartSpec(shape).series[1].values).toEqual([
        12, 38, 18, 28,
      ]);
      expect(P.validatePresentation(reopened)).toEqual([]);
      close(
        paint({ p: reopened, slide: saved }).positions(colors.major, false),
        [0.25, 0.5, 0.75, 1],
      );
    }
    expect(f.part.data).toEqual(before);
    expect(workbook(f.p, f.shape).data).toEqual(book);
  });
});

describe("independent XY numeric axes", () => {
  function fixture(kind, xHidden, yHidden) {
    const f = chartMarkerPaintDeck(kind);
    f.part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape));
    const line = (color) =>
      `<a:ln><a:solidFill><a:srgbClr val="${color.slice(1)}"/></a:solidFill></a:ln>`;
    setChartAxisGridDeclarations(
      f,
      {
        category: {
          min: 0,
          max: 8,
          majorUnit: 2,
          minorUnit: 0.5,
          hidden: xHidden,
          major: line(colors.catMajor),
          minor: line(colors.catMinor),
          majorTickMark: "none",
          minorTickMark: "none",
        },
        value: {
          min: -3,
          max: 6,
          majorUnit: 2,
          minorUnit: 0.5,
          hidden: yHidden,
          major: line(colors.major),
          minor: line(colors.minor),
          majorTickMark: "none",
          minorTickMark: "none",
        },
      },
      true,
    );
    const doc = parseXml(new TextDecoder().decode(f.part.data));
    walkElements(doc.root, (e) => {
      if (e.name.namespaceURI === NS.chart && e.name.localName === "plotArea")
        e.children.push(
          parseXml(
            `<c:spPr xmlns:c="${NS.chart}" xmlns:a="${NS.dml}"><a:solidFill><a:srgbClr val="ECF5E9"/></a:solidFill></c:spPr>`,
          ).root,
        );
    });
    f.part.data = new TextEncoder().encode(serializeXml(doc));
    return f;
  }
  for (const kind of ["scatter", "bubble"])
    for (const xHidden of [false, true])
      for (const yHidden of [false, true])
        it(`${kind} x deleted ${xHidden} y deleted ${yHidden} retains both numeric lattices`, () => {
          const r = paint(fixture(kind, xHidden, yHidden));
          close(r.positions(colors.major, false), [
            0,
            2 / 9,
            4 / 9,
            6 / 9,
            8 / 9,
          ]);
          close(
            r.positions(colors.catMajor, true),
            yHidden ? [0, 0.25, 0.5, 0.75, 1] : [0.25, 0.5, 0.75, 1],
          );
          expect(r.lines(colors.minor)).toHaveLength(xHidden ? 14 : 13);
          expect(r.lines(colors.catMinor)).toHaveLength(12);
        });
  it("preserves authored XY axes and workbook through native copy both ways and untouched export", async () => {
    const f = fixture("scatter", false, false),
      before = chartRenderingView(f.shape).axisLines,
      xml = f.part.data.slice(),
      book = workbook(f.p, f.shape).data.slice(),
      q = createDeck("blank"),
      copy = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      back = P.importSlide(f.p, copy, P.getSlideLayout(f.slide));
    for (const [p, s] of [
      [q, copy],
      [f.p, back],
    ]) {
      const r = await P.loadPresentation(await P.savePresentation(p)),
        slide = P.getSlides(r).at(-1),
        shape = P.getSlideCharts(slide)[0].shape;
      expect(chartRenderingView(shape).axisLines).toEqual(before);
      expect(workbook(r, shape).data).toEqual(book);
      expect(P.validatePresentation(r)).toEqual([]);
      close(
        paint({ p: r, slide }).positions(colors.catMajor, true),
        [0.25, 0.5, 0.75, 1],
      );
    }
    expect(f.part.data).toEqual(xml);
  });
});
