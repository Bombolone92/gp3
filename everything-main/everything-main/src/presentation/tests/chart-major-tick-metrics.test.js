import { canonicalSvgDefinitionIds } from "./svg-definition-ids.js";
import { describe, expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg as renderWithSharedIds } from "../lib/pptx-preview/src/index.ts";
import {
  chartLegendLayoutDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";
import {
  getAttrValue,
  parseXml,
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
import { setChartAxisGridDeclarations } from "./chart-axis-grid-fixture.js";
const C = "#326C18",
  V = "#A3472B",
  CL = "#D9276C",
  VL = "#17589B";
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const num = (e, n) => +attr(e, n);
const faces = [
  // Installed-font bounds and independently measured native PDF mark lengths
  // (points), across 92 native controls. These are evidence in tests only.
  ["Arial", 1854 / 2048, [2.7148, 5.4316, 8.1475]],
  ["Times New Roman", 1825 / 2048, [2.6733, 5.3467, 8.02]],
  ["Impact", 2066 / 2048, [3.0264, 6.0527, 9.0791]],
];
const measure = (text, font) => ({
  widthPx: [...text].length * font.sizePx * 0.5,
  ascentPx:
    font.sizePx * (faces.find(([name]) => name === font.family)?.[1] ?? 0.75),
  descentPx: font.sizePx * 0.25,
  lineGapPx: font.sizePx * 2,
});
function fixture(kind = "column", extra = {}) {
  return chartLegendLayoutDeck({
    kind,
    legend: undefined,
    categories: ["A", "B", "C"],
    series: [{ name: "Units", values: [1, 3, 5], color: "#E85239" }],
    valueAxis: { min: 0, max: 6, majorUnit: 2 },
    categoryAxisLabelStyle: { font: "Arial", sizePt: 18, color: CL },
    valueAxisLabelStyle: { font: "Arial", sizePt: 18, color: VL },
    categoryAxisLineColor: C,
    valueAxisLineColor: V,
    categoryAxisMajorTickMark: "out",
    valueAxisMajorTickMark: "out",
    // These controls isolate major marks.
    categoryAxisMinorTickMark: "none",
    valueAxisMinorTickMark: "none",
    categoryAxisLabelRotationDeg: 0,
    valueAxisLabelRotationDeg: 0,
    ...extra,
  });
}
function paint(f, measureText = measure, extra = {}) {
  const nodes = [];
  const svg = renderSlideToSvg(f.p, f.slide, {
    measureText,
    resolveFontFamily: (family) => family ?? "sans-serif",
    ...extra,
  });
  walkElements(parseXml(svg).root, (e) => nodes.push(e));
  const kind = P.getShapeChartSpec(f.shape).kind;
  const axis = (color, horizontal, labelColor) => {
    const lines = nodes.filter(
      (e) => e.name.localName === "line" && attr(e, "stroke") === color,
    );
    const spine = lines.find((e) =>
      horizontal
        ? num(e, "x1") !== num(e, "x2")
        : num(e, "y1") !== num(e, "y2"),
    );
    const origin = num(spine, horizontal ? "y1" : "x1");
    const ticks = lines.filter((e) => e !== spine);
    return {
      spine,
      origin,
      horizontal,
      ticks,
      extents: ticks.map((e) =>
        [
          num(e, horizontal ? "y1" : "x1") - origin,
          num(e, horizontal ? "y2" : "x2") - origin,
        ].sort((a, b) => a - b),
      ),
      labels: nodes.filter(
        (e) => e.name.localName === "text" && attr(e, "fill") === labelColor,
      ),
    };
  };
  return {
    svg,
    category: axis(C, kind !== "bar", CL),
    value: axis(V, kind === "bar", VL),
  };
}
function checkLength(axis, mode, length) {
  expect(axis.spine).toBeDefined();
  if (mode === "none") expect(axis.ticks).toHaveLength(0);
  else {
    expect(axis.ticks.length).toBeGreaterThan(1);
    for (const [lo, hi] of axis.extents) {
      expect(hi - lo).toBeCloseTo(length * (mode === "cross" ? 2 : 1), 1);
      if (mode === "cross") {
        expect(lo).toBeCloseTo(-length, 1);
        expect(hi).toBeCloseTo(length, 1);
      } else expect(Math.min(Math.abs(lo), Math.abs(hi))).toBe(0);
    }
  }
}
describe("font-sized major axis ticks", () => {
  for (const kind of ["column", "bar"])
    for (const [font, , nativeLengths] of faces)
      for (const [i, sizePt] of [9, 18, 27].entries())
        for (const mode of ["out", "in", "cross", "none"])
          it(`${kind} ${font} ${sizePt}pt ${mode} matches native lengths on both axes`, () => {
            const f = fixture(kind, {
              categoryAxisLabelStyle: { font, sizePt, color: CL },
              valueAxisLabelStyle: { font, sizePt, color: VL },
              categoryAxisMajorTickMark: mode,
              valueAxisMajorTickMark: mode,
            });
            const r = paint(f);
            for (const axis of [r.category, r.value]) {
              checkLength(axis, mode, (nativeLengths[i] * 4) / 3);
              expect(axis.labels).toHaveLength(axis === r.category ? 3 : 4);
            }
          });
  for (const kind of ["column", "bar"])
    for (const mode of ["out", "in", "cross", "none"])
      it(`${kind} ${mode} retains independent fonts with hidden labels and reports font use`, () => {
        const f = fixture(kind, {
          categoryAxisLabelStyle: {
            font: "Times New Roman",
            sizePt: 9,
            color: CL,
          },
          valueAxisLabelStyle: { font: "Impact", sizePt: 27, color: VL },
          categoryAxisMajorTickMark: mode,
          valueAxisMajorTickMark: mode,
          categoryAxisTickLabelPos: "none",
          valueAxisTickLabelPos: "none",
        });
        const fonts = [],
          r = paint(f, measure, {
            onFontUsed: (font) => fonts.push(font.family),
          });
        checkLength(r.category, mode, (2.6733 * 4) / 3);
        checkLength(r.value, mode, (9.0791 * 4) / 3);
        expect(r.category.labels).toHaveLength(0);
        expect(r.value.labels).toHaveLength(0);
        if (mode !== "none")
          expect(fonts).toEqual(
            expect.arrayContaining(["Times New Roman", "Impact"]),
          );
      });
  for (const kind of ["column", "bar"])
    for (const mode of ["out", "in", "cross"])
      it(`${kind} ${mode} keeps lengths through reversal, crossing, rotation and stroke width changes`, () => {
        for (const crossing of ["min", "max", { at: 3 }]) {
          const f = fixture(kind, {
            categoryAxisOrientation: "maxMin",
            valueAxisOrientation: "maxMin",
            categoryAxisCrosses: crossing,
            valueAxisCrosses: "max",
            categoryAxisLabelRotationDeg: 45,
            valueAxisLabelRotationDeg: 90,
            categoryAxisLineWidthEmu: 38100,
            valueAxisLineWidthEmu: 6350,
            categoryAxisMajorTickMark: mode,
            valueAxisMajorTickMark: mode,
          });
          const r = paint(f);
          checkLength(r.category, mode, (5.4316 * 4) / 3);
          checkLength(r.value, mode, (5.4316 * 4) / 3);
        }
      });
  for (const kind of ["column", "bar"])
    for (const mode of ["out", "in", "cross", "none"])
      it(`${kind} combo ${mode} keeps primary modes and secondary clearance independent`, () => {
        const SC = "#8B4513";
        const f = fixture(kind, {
          categoryAxisTickLabelPos: "none",
          valueAxisMajorTickMark: mode,
          secondaryValueAxisLineColor: SC,
          textStyle: { font: "Arial", sizePt: 18, color: VL },
          secondaryValueAxisTickLabelPos: "high",
          secondaryValueAxisCrosses: "max",
          series: [
            { name: "Primary", values: [1, 3, 5], color: "#E85239" },
            {
              name: "Secondary",
              values: [20, 40, 30],
              color: "#2F8541",
              chartKind: kind === "column" ? "line" : "bar",
              secondaryAxis: true,
            },
          ],
        });
        setChartAxisGridDeclarations(f, {
          secondaryValue: { majorTickMark: "out", minorTickMark: "none" },
        });
        const r = paint(f);
        checkLength(r.value, mode, (5.4316 * 4) / 3);
        const lines = [];
        walkElements(parseXml(r.svg).root, (e) => {
          if (
            e.name.localName === "line" &&
            attr(e, "stroke") === SC &&
            (kind === "bar"
              ? num(e, "x1") === num(e, "x2")
              : num(e, "y1") === num(e, "y2"))
          )
            lines.push(e);
        });
        expect(lines.length).toBeGreaterThan(1);
        // The secondary axis has its own native mode and inherits the chart
        // font, independently of the primary axis's in/cross/none choice.
        for (const line of lines)
          expect(
            Math.hypot(
              num(line, "x2") - num(line, "x1"),
              num(line, "y2") - num(line, "y1"),
            ),
          ).toBeCloseTo((5.4316 * 4) / 3, 1);
        const secondaryLabels = r.value.labels.filter(
          (e) =>
            Number(
              e.children
                .filter((n) => n.kind === "text")
                .map((n) => n.data)
                .join(""),
            ) > 6,
        );
        expect(secondaryLabels.length).toBeGreaterThan(1);
        for (const label of secondaryLabels) {
          if (kind === "column")
            expect(num(label, "x") + 24).toBeLessThanOrEqual(768);
          else
            expect(
              num(label, "y") - (24 * (1854 / 2048 + 0.25)) / 2,
            ).toBeGreaterThanOrEqual(96);
        }
      });
  for (const angle of [-45, 45])
    it(`keeps a shared horizontal label row at fixed ${angle} degrees with different word widths`, () => {
      const f = fixture("bar", {
        valueAxis: { min: 0, max: 100, majorUnit: 20 },
        valueAxisLabelRotationDeg: angle,
      });
      const r = paint(f);
      expect(r.value.labels).toHaveLength(6);
      expect(new Set(r.value.labels.map((e) => num(e, "y"))).size).toBe(1);
    });
  it("uses ascent rather than width, descent, leading, chart size or a font-name table", () => {
    const f = fixture("bar", {
      categoryAxisLabelStyle: {
        font: "Independent Face",
        sizePt: 13.5,
        color: CL,
      },
      valueAxisLabelStyle: {
        font: "Independent Face",
        sizePt: 13.5,
        color: VL,
      },
    });
    for (const size of [2, 5, 9]) {
      P.setShapeSize(f.shape, P.inches(size), P.inches(size));
      const r = paint(f, () => ({
        widthPx: size * 10,
        ascentPx: 21,
        descentPx: size,
        lineGapPx: size * 20,
      }));
      checkLength(r.category, "out", 7);
      checkLength(r.value, "out", 7);
    }
  });
  for (const ascentPx of [undefined, NaN, Infinity, -3, 0])
    it(`uses a finite font-relative fallback for unusable ascent ${ascentPx}`, () => {
      const f = fixture();
      const r = paint(f, () => ({ widthPx: 10, ascentPx }));
      checkLength(r.category, "out", 8);
      checkLength(r.value, "out", 8);
      expect(r.svg).not.toMatch(/NaN|Infinity/);
    });
  for (const kind of ["column", "bar"])
    for (const mode of ["out", "in", "cross", "none"])
      it(`${kind} ${mode} keeps next-to labels beyond painted ticks with explicit zero rotation`, () => {
        const f = fixture(kind, {
          categoryAxisLabelStyle: { font: "Arial", sizePt: 54, color: CL },
          valueAxisLabelStyle: { font: "Arial", sizePt: 54, color: VL },
          categoryAxisMajorTickMark: mode,
          valueAxisMajorTickMark: mode,
          categoryAxisTickLabelPos: "nextTo",
          valueAxisTickLabelPos: "nextTo",
        });
        const r = paint(f);
        for (const a of [r.category, r.value]) {
          const side = a.horizontal ? 1 : -1;
          const tickExtent = Math.max(
            0,
            ...a.extents.flat().map((x) => x * side),
          );
          const halfHeight = Math.max(72, 72 * (1854 / 2048 + 0.25)) / 2;
          for (const label of a.labels) {
            const near =
              (num(label, a.horizontal ? "y" : "x") - a.origin) * side -
              (a.horizontal ? halfHeight : 0);
            expect(near).toBeGreaterThanOrEqual(tickExtent + 3.98);
          }
        }
      });
  for (const kind of ["column", "bar"])
    for (const mode of ["out", "in", "cross", "none"])
      it(`${kind} ${mode} keeps large marks inside the chart even without labels`, () => {
        const f = fixture(kind, {
          categoryAxisLabelStyle: { font: "Arial", sizePt: 144, color: CL },
          valueAxisLabelStyle: { font: "Impact", sizePt: 144, color: VL },
          categoryAxisMajorTickMark: mode,
          valueAxisMajorTickMark: mode,
          categoryAxisTickLabelPos: "none",
          valueAxisTickLabelPos: "none",
        });
        const r = paint(f);
        // Chart fixture bounds: 1in,1in,7in,4in. Check painted endpoints,
        // rather than requiring a particular automatic plot rectangle.
        for (const a of [r.category, r.value])
          for (const tick of a.ticks)
            for (const end of ["1", "2"]) {
              expect(num(tick, "x" + end)).toBeGreaterThanOrEqual(96);
              expect(num(tick, "x" + end)).toBeLessThanOrEqual(768);
              expect(num(tick, "y" + end)).toBeGreaterThanOrEqual(96);
              expect(num(tick, "y" + end)).toBeLessThanOrEqual(480);
            }
      });
  it("leaves remote low labels independent of an opposite-edge spine's tick length", () => {
    const f = fixture("bar", {
      categoryAxisCrosses: "max",
      categoryAxisTickLabelPos: "low",
    });
    const a = paint(f);
    P.setChartSpec(P.getSlideCharts(f.slide)[0], {
      ...P.getShapeChartSpec(f.shape),
      categoryAxisMajorTickMark: "in",
    });
    const b = paint(f);
    expect(a.category.labels.map((e) => num(e, "x"))).toEqual(
      b.category.labels.map((e) => num(e, "x")),
    );
  });
  it("keeps font/tick semantics, native parts and editable workbooks through copy, return and save", async () => {
    const f = fixture("bar", {
      categoryAxisMajorTickMark: "cross",
      valueAxisMajorTickMark: "in",
    });
    const spec = P.getShapeChartSpec(f.shape),
      before = paint(f).svg;
    const part = P._internalPackageOf(f.p)
      .getPart(chartRoot(f.shape))
      .data.slice();
    const book = workbook(f.p, f.shape).data.slice();
    const q = createDeck("blank"),
      copied = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]);
    const reloaded = await P.loadPresentation(await P.savePresentation(q));
    const back = P.importSlide(
      f.p,
      P.getSlides(reloaded).at(-1),
      P.getSlideLayout(f.slide),
    );
    for (const [p, slide] of [
      [q, copied],
      [reloaded, P.getSlides(reloaded).at(-1)],
      [f.p, back],
    ]) {
      const shape = P.getSlideCharts(slide)[0].shape;
      expect(P.getShapeChartSpec(shape)).toEqual(spec);
      expect(P._internalPackageOf(p).getPart(chartRoot(shape)).data).toEqual(
        part,
      );
      expect(workbook(p, shape).data).toEqual(book);
      expect(paint({ p, slide, shape }).svg).toBe(before);
      expect(P.validatePresentation(p)).toEqual([]);
    }
  });
});

function renderSlideToSvg(...args) {
  return canonicalSvgDefinitionIds(renderWithSharedIds(...args));
}
