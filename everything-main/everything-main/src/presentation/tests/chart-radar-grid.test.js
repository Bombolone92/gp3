import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  chartRadarGridDeck,
  radarGridColors as colors,
  radarGridLine as line,
} from "./chart-radar-grid-fixture.js";
import { axisLineModes } from "./chart-axis-line-fixture.js";
import { chartRenderingView } from "../lib/pptx/src/api/fn/charts.ts";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

const attr = (e, n) => getAttrValue(e, qname("", n, ""));
function paint(p, slide) {
  const nodes = [];
  walkElements(
    parseXml(
      decodeURIComponent(preview(p, slide).split(",").slice(1).join(",")),
    ).root,
    (e) => nodes.push(e),
  );
  const paths = (color) =>
    nodes.filter(
      (e) =>
        e.name.localName === "line" &&
        attr(e, "stroke") === color &&
        Number(attr(e, "stroke-width")) > 0,
    );
  const value = paths(colors.value);
  // Radial spines are long; font-sized marks are short. Bounds below use
  // geometry, independently from the renderer's private layer channels.
  const length = (e) =>
    Math.hypot(
      Number(attr(e, "x2")) - Number(attr(e, "x1")),
      Number(attr(e, "y2")) - Number(attr(e, "y1")),
    );
  return {
    nodes,
    paths,
    value,
    spines: value.filter((e) => length(e) > 20),
    marks: value.filter((e) => length(e) < 20),
    length,
    labels: (color) =>
      nodes.filter(
        (e) => e.name.localName === "text" && attr(e, "fill") === color,
      ),
  };
}
const major = line(colors.major),
  minor = line(colors.minor, 9525);
// Counts are native reference controls: center has no ring or mark; minor
// rings omit major coincidences only when the major grids are also declared.
const cases = [
  ["absent grids", {}, 0, 0, 5, 0],
  ["major grids", { value: { major } }, 20, 0, 5, 0],
  ["minor grids", { value: { minor } }, 0, 80, 5, 0],
  ["both grids", { value: { major, minor } }, 20, 60, 5, 0],
  [
    "invisible major declaration replaces marks",
    { value: { major: axisLineModes.none, majorTickMark: "cross" } },
    0,
    0,
    5,
    0,
  ],
  [
    "zero-width major declaration replaces marks",
    { value: { major: line(colors.major, 0), majorTickMark: "cross" } },
    0,
    0,
    5,
    0,
  ],
  [
    "invisible minor declaration leaves major marks",
    {
      value: {
        minor: axisLineModes.none,
        majorTickMark: "cross",
        minorTickMark: "cross",
      },
    },
    0,
    0,
    5,
    40,
  ],
  ["ignored category grids", { category: { major, minor } }, 0, 0, 5, 0],
  ["deleted value", { value: { hidden: true, major, minor } }, 20, 60, 0, 0],
  ["deleted category", { category: { hidden: true } }, 0, 0, 5, 0],
  ["outward marks", { value: { majorTickMark: "out" } }, 0, 0, 5, 20],
  ["inward marks", { value: { majorTickMark: "in" } }, 0, 0, 5, 20],
  ["cross marks", { value: { majorTickMark: "cross" } }, 0, 0, 5, 40],
  ["minor cross marks", { value: { minorTickMark: "cross" } }, 0, 0, 5, 160],
  [
    "independent mark levels",
    { value: { majorTickMark: "cross", minorTickMark: "cross" } },
    0,
    0,
    5,
    200,
  ],
  [
    "major grid replaces major marks",
    { value: { major, majorTickMark: "cross", minorTickMark: "cross" } },
    20,
    0,
    5,
    160,
  ],
  [
    "both grids replace marks",
    { value: { major, minor, majorTickMark: "cross", minorTickMark: "cross" } },
    20,
    60,
    5,
    0,
  ],
  [
    "category marks do not paint",
    { category: { majorTickMark: "cross", minorTickMark: "cross" } },
    0,
    0,
    5,
    0,
  ],
  [
    "skip affects only spines",
    { category: { tickMarkSkip: 2 }, value: { majorTickMark: "out" } },
    0,
    0,
    3,
    20,
  ],
];
describe("native radar axis paths", () => {
  for (const radarStyle of ["standard", "marker", "filled"])
    for (const grid of [false, true])
      for (const mode of [
        "automatic",
        "empty",
        "width",
        "dash",
        "solidEmpty",
        "none",
        "red",
      ])
        it(`${radarStyle} resolves ${mode} spines independently from automatic ticks with grids=${grid}`, async () => {
          const f = chartRadarGridDeck({
            radarStyle,
            ...(mode === "automatic"
              ? {
                  valueAxisLineColor: undefined,
                  valueAxisLineWidthEmu: undefined,
                }
              : {}),
            valueLine:
              mode === "red" ? line(colors.value) : axisLineModes[mode],
            axes: {
              value: { major: grid ? major : false, majorTickMark: "cross" },
            },
          });
          const check = (p, slide, shape) => {
            const r = paint(p, slide),
              paths = r.paths(mode === "red" ? colors.value : "#000000"),
              spine = ["solidEmpty", "red"].includes(mode),
              ticks = !grid && mode !== "none";
            expect(paths.filter((e) => r.length(e) > 20)).toHaveLength(
              spine ? 5 : 0,
            );
            expect(paths.filter((e) => r.length(e) < 20)).toHaveLength(
              ticks ? 40 : 0,
            );
            expect(r.paths(colors.major)).toHaveLength(grid ? 20 : 0);
            const native = chartRenderingView(shape).axisLines.value;
            expect(native.spine.paint.kind).toBe(spine ? "solid" : "none");
            expect(native.line.paint.kind).toBe(
              mode === "none" ? "none" : "solid",
            );
            if (mode === "width") expect(native.line.widthEmu).toBe(76200);
            if (mode === "dash")
              expect(native.line.dash).toEqual({
                kind: "preset",
                value: "dashDot",
              });
          };
          const spec = P.getShapeChartSpec(f.shape),
            book = workbook(f.p, f.shape).data.slice(),
            target = createDeck("blank"),
            slide = P.importSlide(
              target,
              f.slide,
              P.getSlideLayouts(target)[0],
              {
                preservePaintFormatting: true,
                preserveTextFormatting: true,
              },
            ),
            shape = P.getSlideCharts(slide)[0].shape,
            xml = P._internalPackageOf(target)
              .getPart(chartRoot(shape))
              .data.slice();
          check(f.p, f.slide, f.shape);
          check(target, slide, shape);
          const round = await P.loadPresentation(
              await P.savePresentation(target),
            ),
            saved = P.getSlides(round).at(-1),
            savedShape = P.getSlideCharts(saved)[0].shape;
          check(round, saved, savedShape);
          expect(P.getShapeChartSpec(savedShape)).toEqual(spec);
          expect(workbook(round, savedShape).data).toEqual(book);
          expect(
            P._internalPackageOf(round).getPart(chartRoot(savedShape)).data,
          ).toEqual(xml);
          expect(P.validatePresentation(round)).toEqual([]);
        });

  for (const radarStyle of ["standard", "marker", "filled"])
    for (const [name, axes, majors, minors, spines, marks] of cases)
      it(`${radarStyle} retains ${name} through transfer and export`, async () => {
        const f = chartRadarGridDeck({ radarStyle, axes }),
          spec = P.getShapeChartSpec(f.shape),
          xml = P._internalPackageOf(f.p)
            .getPart(chartRoot(f.shape))
            .data.slice(),
          book = workbook(f.p, f.shape).data.slice();
        const check = (p, slide) => {
          const r = paint(p, slide);
          expect(r.paths(colors.major)).toHaveLength(majors);
          expect(r.paths(colors.minor)).toHaveLength(minors);
          expect(r.paths(colors.category)).toHaveLength(0);
          expect(r.spines).toHaveLength(spines);
          expect(r.marks).toHaveLength(marks);
          expect(r.labels("#2468AC")).toHaveLength(axes.value?.hidden ? 0 : 5);
          expect(r.labels("#604020")).toHaveLength(
            axes.category?.hidden ? 0 : 5,
          );
          const data = r.nodes.findIndex(
            (e) =>
              e.name.localName === "polygon" &&
              [attr(e, "fill"), attr(e, "stroke")].includes("#AA9988"),
          );
          expect(data).toBeGreaterThan(0);
          for (const e of [...r.paths(colors.major), ...r.paths(colors.minor)])
            expect(r.nodes.indexOf(e)).toBeLessThan(data);
          for (const e of r.value)
            expect(r.nodes.indexOf(e) > data).toBe(radarStyle === "filled");
          for (const e of [...r.labels("#2468AC"), ...r.labels("#604020")])
            expect(r.nodes.indexOf(e)).toBeGreaterThan(data);
          expect(preview(p, slide)).not.toMatch(/NaN|Infinity/);
        };
        check(f.p, f.slide);
        expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
        expect(
          P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
        ).toEqual(xml);
        const target = createDeck("blank"),
          slide = P.importSlide(target, f.slide, P.getSlideLayouts(target)[0], {
            preservePaintFormatting: true,
            preserveTextFormatting: true,
          }),
          chart = P.getSlideCharts(slide)[0];
        const copiedXml = P._internalPackageOf(target)
          .getPart(chartRoot(chart.shape))
          .data.slice();
        expect(chartRenderingView(chart.shape).axisLines).toEqual(
          chartRenderingView(f.shape).axisLines,
        );
        expect(chart.spec).toEqual(spec);
        expect(workbook(target, chart.shape).data).toEqual(book);
        check(target, slide);
        const round = await P.loadPresentation(
            await P.savePresentation(target),
          ),
          saved = P.getSlides(round).at(-1),
          shape = P.getSlideCharts(saved)[0].shape;
        expect(P.getShapeChartSpec(shape)).toEqual(spec);
        expect(workbook(round, shape).data).toEqual(book);
        expect(
          P._internalPackageOf(round).getPart(chartRoot(shape)).data,
        ).toEqual(copiedXml);
        expect(chartRenderingView(shape).axisLines).toEqual(
          chartRenderingView(chart.shape).axisLines,
        );
        check(round, saved);
        expect(P.validatePresentation(round)).toEqual([]);
      });

  for (const [n, min, max, majorUnit, minorUnit, majorRings, minorRings] of [
    [3, 1.3, 8, 2, 0.5, 3, 10],
    [7, -3, 5, 2, 0.5, 4, 12],
    [8, 2, 3, 5, 0.25, 0, 4],
    [4, 0, 1, Number.MIN_VALUE, Number.MIN_VALUE, 500, 0],
  ])
    it(`projects ${n} spokes on ${min}..${max} independently of the tick lattice`, () => {
      const f = chartRadarGridDeck({
          n,
          valueAxis: { min, max, majorUnit, minorUnit },
          axes: { value: { major, minor } },
        }),
        r = paint(f.p, f.slide);
      expect(r.spines).toHaveLength(n);
      expect(r.paths(colors.major)).toHaveLength(majorRings * n);
      expect(r.paths(colors.minor)).toHaveLength(minorRings * n);
      const [first] = r.spines,
        cx = Number(attr(first, "x1")),
        cy = Number(attr(first, "y1")),
        radius = r.length(first);
      for (const e of r.spines) {
        expect(Number(attr(e, "x1"))).toBe(cx);
        expect(Number(attr(e, "y1"))).toBe(cy);
        expect(r.length(e)).toBeCloseTo(radius, 1);
      }
      for (const [color, unit] of [
        [colors.major, Math.max(majorUnit, (max - min) / 500)],
        [colors.minor, Math.max(minorUnit, (max - min) / 500)],
      ])
        for (const e of r.paths(color).filter((_, i) => i % n === 0)) {
          const offset = ((cy - Number(attr(e, "y1"))) / radius) * (max - min),
            intervals = offset / unit;
          expect(Math.abs(intervals - Math.round(intervals))).toBeLessThan(
            0.02,
          );
        }
      expect(P.getShapeChartSpec(f.shape).valueAxis.majorUnit).toBe(majorUnit);
    });

  for (const [mode, side] of [
    ["out", -1],
    ["in", 1],
    ["cross", 0],
  ])
    it(`${mode} marks are perpendicular and font-sized`, () => {
      const radii = [];
      for (const sizePt of [12, 24]) {
        const f = chartRadarGridDeck({
            valueAxisLabelStyle: { font: "Arial", sizePt, color: "#2468AC" },
            axes: { value: { majorTickMark: mode } },
          }),
          r = paint(f.p, f.slide),
          first = r.spines[0],
          cx = Number(attr(first, "x1")),
          cy = Number(attr(first, "y1"));
        for (const e of r.marks) {
          const x = Number(attr(e, "x1")) - cx,
            y = Number(attr(e, "y1")) - cy,
            dx = Number(attr(e, "x2")) - Number(attr(e, "x1")),
            dy = Number(attr(e, "y2")) - Number(attr(e, "y1"));
          expect(
            Math.abs(
              (x * dx + y * dy) / (Math.hypot(x, y) * Math.hypot(dx, dy)),
            ),
          ).toBeLessThan(0.01);
        }
        const top = r.marks.filter((e) => Number(attr(e, "x1")) === cx);
        if (side)
          for (const e of top)
            expect(Math.sign(Number(attr(e, "x2")) - cx)).toBe(side);
        radii.push(r.length(top[0]));
      }
      expect(radii[1] / radii[0]).toBeCloseTo(2, 1);
    });

  it("paints major marks above coincident minor marks", () => {
    const f = chartRadarGridDeck({
        axes: { value: { majorTickMark: "cross", minorTickMark: "cross" } },
      }),
      r = paint(f.p, f.slide),
      max = Math.max(...r.marks.map(r.length));
    const major = r.marks.filter((e) => r.length(e) > max * 0.85),
      minor = r.marks.filter((e) => r.length(e) < max * 0.85);
    expect(major).toHaveLength(40);
    expect(minor).toHaveLength(160);
    expect(Math.max(...minor.map((e) => r.nodes.indexOf(e)))).toBeLessThan(
      Math.min(...major.map((e) => r.nodes.indexOf(e))),
    );
  });
  it("hides tick-label rows without deleting their radial paths", () => {
    const f = chartRadarGridDeck({
        valueAxisTickLabelPos: "none",
        categoryAxisTickLabelPos: "none",
        axes: { value: { majorTickMark: "out" } },
      }),
      r = paint(f.p, f.slide);
    expect(r.labels("#2468AC")).toHaveLength(0);
    expect(r.labels("#604020")).toHaveLength(0);
    expect(r.spines).toHaveLength(5);
    expect(r.marks).toHaveLength(20);
  });

  for (const mode of ["none", "zero", "color", "custom", "gradient", "pattern"])
    it(`uses the native ${mode} paint without changing document semantics`, () => {
      const f = chartRadarGridDeck({
          valueLine: axisLineModes[mode],
          axes: {
            value: { major: axisLineModes[mode], majorTickMark: "cross" },
          },
        }),
        spec = P.getShapeChartSpec(f.shape),
        view = chartRenderingView(f.shape),
        r = paint(f.p, f.slide);
      expect(view.axisLines.value.line.paint.kind).toBe(
        mode === "none"
          ? "none"
          : mode === "gradient"
            ? "gradient"
            : mode === "pattern"
              ? "pattern"
              : "solid",
      );
      const paths = r.nodes.filter((e) => e.name.localName === "line");
      expect(paths).toHaveLength(25);
      if (["none", "zero"].includes(mode))
        expect(
          paths.every(
            (e) =>
              attr(e, "stroke") === "none" ||
              Number(attr(e, "stroke-width")) === 0,
          ),
        ).toBe(true);
      if (mode === "custom")
        for (const e of paths) {
          expect(attr(e, "stroke-opacity")).toBe("0.4");
          expect(attr(e, "stroke-dasharray")).toBeTruthy();
          expect(attr(e, "stroke-linecap")).toBe("square");
        }
      if (["gradient", "pattern"].includes(mode)) {
        expect(paths.every((e) => attr(e, "stroke").startsWith("url(#"))).toBe(
          true,
        );
        expect(
          new Set(paths.slice(0, 20).map((e) => attr(e, "stroke"))).size,
        ).toBe(1);
      }
      expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
    });
});
