import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
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
const attr = (e, n) => getAttrValue(e, qname("", n, "")),
  names = ["Alpha", "Beta", "Gamma"];
const box = (e) => ({
  x: +attr(e, "x"),
  y: +attr(e, "y"),
  w: +attr(e, "width"),
  h: +attr(e, "height"),
});
const measureText = (text, font) => ({
  widthPx: text.length * font.sizePx * 0.5,
  ascentPx: font.sizePx * 0.8,
  descentPx: font.sizePx * 0.3,
});
function render(f) {
  const elements = [],
    svg = renderSlideToSvg(f.p, f.slide, { measureText });
  walkElements(parseXml(svg).root, (e) => elements.push(e));
  return {
    svg,
    plot: box(
      elements.find(
        (e) => e.name.localName === "rect" && attr(e, "fill") === "#ECF5E9",
      ),
    ),
    legend: elements.find(
      (e) => e.name.localName === "rect" && attr(e, "fill") === "#FFF0D1",
    ),
    labels: elements.filter(
      (e) =>
        e.name.localName === "text" &&
        e.children.some((c) => c.kind === "text" && names.includes(c.data)),
    ),
  };
}
describe("chart legend layout shares its painted extents with the plot", () => {
  for (const sizePt of [9, 18, 32])
    for (const position of ["b", "t", "l", "r", "tr"])
      for (const overlay of [false, true])
        it(`${sizePt}pt ${position}, overlay=${overlay} spaces labels and reserves only the chosen edge`, () => {
          const f = chartLegendLayoutDeck({ sizePt, position }),
            chart = P.getSlideCharts(f.slide)[0];
          P.setChartSpec(chart, {
            ...chart.spec,
            legend: { ...chart.spec.legend, overlay },
          });
          const spec = P.getShapeChartSpec(f.shape),
            bytes = P._internalPackageOf(f.p)
              .getPart(chartRoot(f.shape))
              .data.slice(),
            book = workbook(f.p, f.shape).data.slice(),
            r = render(f),
            b = box(r.legend),
            baseline = render(
              chartLegendLayoutDeck({ sizePt, legend: undefined }),
            );
          expect(r.labels).toHaveLength(3);
          for (const text of r.labels)
            expect(+attr(text, "font-size")).toBeCloseTo((sizePt * 4) / 3, 1);
          if (["r", "l", "tr"].includes(position)) {
            const ys = r.labels.map((e) => +attr(e, "y")).sort((a, b) => a - b);
            for (let i = 1; i < ys.length; i++)
              expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(
                ((sizePt * 4) / 3) * 1.1,
              );
          }
          if (overlay) expect(r.plot).toEqual(baseline.plot);
          else if (position === "r" || position === "tr") {
            expect(r.plot.x + r.plot.w).toBeLessThan(b.x);
            expect(r.plot.h).toBe(baseline.plot.h);
          } else if (position === "l") {
            expect(b.x + b.w).toBeLessThan(r.plot.x);
            expect(r.plot.h).toBe(baseline.plot.h);
          } else if (position === "t") {
            expect(b.y + b.h).toBeLessThan(r.plot.y);
            expect(r.plot.w).toBe(baseline.plot.w);
          } else {
            expect(r.plot.y + r.plot.h).toBeLessThan(b.y);
            expect(r.plot.w).toBe(baseline.plot.w);
          }
          expect(r.svg).not.toMatch(/NaN|Infinity/);
          expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
          expect(
            P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
          ).toEqual(bytes);
          expect(workbook(f.p, f.shape).data).toEqual(book);
        });
  for (const kind of ["bar", "column", "line", "area", "pie", "doughnut"])
    it(`${kind} hides every legend entry without reserving an empty legend strip`, () => {
      const options = {
          kind,
          ...(["pie", "doughnut"].includes(kind)
            ? {
                series: [
                  { name: "Units", values: [2, 4, 3, 5], color: "#E85239" },
                ],
              }
            : {}),
        },
        f = chartLegendLayoutDeck(options),
        chart = P.getSlideCharts(f.slide)[0];
      P.setChartSpec(chart, {
        ...chart.spec,
        legend: { ...chart.spec.legend, hiddenIndices: [0, 1, 2, 3] },
      });
      const r = render(f),
        baseline = render(
          chartLegendLayoutDeck({ ...options, legend: undefined }),
        );
      expect(r.legend).toBeUndefined();
      expect(r.plot).toEqual(baseline.plot);
    });
  it("caps large legend key outlines before measuring row spacing and plot clearance", () => {
    const f = chartLegendLayoutDeck({
        sizePt: 9,
        series: names.map((name, i) => ({
          name,
          values: [1, 2, 3, 4],
          color: ["#E85239", "#2F8541", "#376CA8"][i],
          lineColor: "#713AC8",
          lineWidthEmu: 381000,
        })),
      }),
      r = render(f),
      b = box(r.legend),
      ys = r.labels.map((e) => +attr(e, "y")).sort((a, b) => a - b);
    expect(ys[1] - ys[0]).toBeCloseTo(21.07, 2);
    expect(r.plot.x + r.plot.w).toBeLessThan(b.x);
    const chart = P.getSlideCharts(f.slide)[0];
    P.setChartSpec(chart, {
      ...chart.spec,
      series: chart.spec.series.map((s) => ({ ...s, lineWidthEmu: 44450 })),
    });
    const capped = render(f);
    expect(box(capped.legend)).toEqual(b);
    expect(capped.plot).toEqual(r.plot);
    expect(capped.labels).toEqual(r.labels);
  });
  it("copied legend font, position and overlay edits stay independent through transfer and export", async () => {
    const f = chartLegendLayoutDeck(),
      q = createDeck("blank"),
      copied = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      returned = P.importSlide(f.p, copied, P.getSlideLayout(f.slide)),
      c = P.getSlideCharts(returned)[0],
      original = P.getShapeChartSpec(f.shape),
      book = workbook(f.p, f.shape).data.slice();
    P.setChartSpec(c, {
      ...c.spec,
      legend: {
        ...c.spec.legend,
        position: "l",
        textStyle: { font: "Arial", sizePt: 18 },
      },
      series: c.spec.series.map((s) => ({
        ...s,
        values: s.values.map((v) => v + 1),
      })),
    });
    expect(P.getShapeChartSpec(f.shape)).toEqual(original);
    expect(workbook(f.p, f.shape).data).toEqual(book);
    const p = await P.loadPresentation(await P.savePresentation(f.p)),
      slides = P.getSlides(p),
      charts = slides.map((s) => P.getSlideCharts(s)[0]);
    expect(charts.map((c) => c.spec.legend.position)).toEqual(["r", "l"]);
    expect(charts.map((c) => c.spec.legend.textStyle.sizePt)).toEqual([32, 18]);
    expect(new Set(charts.map((c) => workbook(p, c.shape).name)).size).toBe(2);
    expect(
      render({ p, slide: slides[0] }).plot.x +
        render({ p, slide: slides[0] }).plot.w,
    ).toBeLessThan(box(render({ p, slide: slides[0] }).legend).x);
    const r = render({ p, slide: slides[1] });
    expect(box(r.legend).x + box(r.legend).w).toBeLessThan(r.plot.x);
    expect(P.validatePresentation(p)).toEqual([]);
  });
});

// Read geometry after SVG transforms, so fitting is checked in slide space.
function fittedLegend(svg) {
  const result = { labels: [], keys: [], box: null };
  function visit(e, parent = (x, y) => [x, y]) {
    const commands = [
      ...(attr(e, "transform") ?? "").matchAll(/(translate|scale)\(([^)]+)\)/g),
    ];
    const point = (x, y) => {
      for (const [, kind, numbers] of [...commands].reverse()) {
        const [a, b] = numbers.trim().split(/[ ,]+/).map(Number);
        if (kind === "translate") {
          x += a;
          y += b ?? 0;
        } else {
          x *= a;
          y *= b ?? a;
        }
      }
      return parent(x, y);
    };
    const text = e.children
      .filter((c) => c.kind === "text")
      .map((c) => c.data)
      .join("");
    if (e.name.localName === "rect") {
      const [x, y] = point(+attr(e, "x"), +attr(e, "y"));
      const [right, bottom] = point(
        +attr(e, "x") + +attr(e, "width"),
        +attr(e, "y") + +attr(e, "height"),
      );
      const b = { x, y, right, bottom };
      if (attr(e, "fill") === "#FFF0D1") result.box = b;
      if (
        ["#E85239", "#2F8541", "#376CA8"].includes(attr(e, "fill")) &&
        attr(e, "width") === attr(e, "height")
      )
        result.keys.push(b);
    }
    if (e.name.localName === "text" && attr(e, "fill") === "#A37511") {
      const sizePx = +attr(e, "font-size"),
        width = measureText(text, { sizePx }).widthPx;
      const [x, y] = point(+attr(e, "x"), +attr(e, "y") - sizePx * 0.55);
      const [right, bottom] = point(
        +attr(e, "x") + width,
        +attr(e, "y") + sizePx * 0.55,
      );
      result.labels.push({ text, x, y, right, bottom });
    }
    for (const c of e.children) if (c.kind === "element") visit(c, point);
  }
  visit(parseXml(svg).root);
  return result;
}
describe("legend constraints keep oversized content and chart data visible", () => {
  const cases = {
    words: [
      "Revenue from established business customers",
      "Revenue from new business customers",
      "Revenue from recurring subscriptions",
    ],
    unbroken: ["ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(3), "Beta", "Gamma"],
    unicode: [
      "年間売上の詳しい説明と地域ごとの内訳".repeat(3),
      "Family 👩‍👩‍👧‍👦 and café ".repeat(5),
      "Gamma",
    ],
    crowded: Array.from({ length: 40 }, (_, i) => `Series ${i + 1}`),
  };
  for (const [caseName, labels] of Object.entries(cases))
    for (const position of ["l", "r", "tr", "b", "t"])
      for (const overlay of [false, true])
        it(`${caseName} ${position} overlay=${overlay} retains every label/key inside the chart`, () => {
          const f = chartLegendLayoutDeck({
            sizePt: 18,
            position,
            legend: {
              position,
              overlay,
              textStyle: { font: "Arial", sizePt: 18, color: "#A37511" },
              fill: "#FFF0D1",
            },
            series: labels.map((name, i) => ({
              name,
              values: [2, 4, 3, 5],
              color: ["#E85239", "#2F8541", "#376CA8"][i % 3],
            })),
          });
          if (caseName === "crowded")
            P.setShapeSize(f.shape, P.inches(4), P.inches(2.5));
          const original = P.getShapeChartSpec(f.shape),
            bytes = workbook(f.p, f.shape).data.slice();
          const r = render(f),
            legend = fittedLegend(r.svg),
            b = legend.box;
          expect(r.svg).not.toMatch(/NaN|Infinity/);
          expect(r.plot.w).toBeGreaterThan(0);
          expect(r.plot.h).toBeGreaterThan(0);
          expect(legend.keys).toHaveLength(labels.length);
          const allText = legend.labels
            .map((l) => l.text)
            .join("")
            .replace(/\s/g, "");
          for (const label of labels)
            expect(allText).toContain(label.replace(/\s/g, ""));
          expect(b.x).toBeGreaterThanOrEqual(96 - 0.02);
          expect(b.y).toBeGreaterThanOrEqual(96 - 0.02);
          expect(b.right).toBeLessThanOrEqual(
            96 + (caseName === "crowded" ? 4 : 7) * 96 + 0.02,
          );
          expect(b.bottom).toBeLessThanOrEqual(
            96 + (caseName === "crowded" ? 2.5 : 4) * 96 + 0.02,
          );
          for (const label of [...legend.labels, ...legend.keys]) {
            expect(label.x).toBeGreaterThanOrEqual(b.x - 0.03);
            expect(label.right).toBeLessThanOrEqual(b.right + 0.03);
            expect(label.y).toBeGreaterThanOrEqual(b.y - 0.03);
            expect(label.bottom).toBeLessThanOrEqual(b.bottom + 0.03);
          }
          if (!overlay) {
            if (position === "l") expect(b.right).toBeLessThan(r.plot.x);
            else if (["r", "tr"].includes(position))
              expect(r.plot.x + r.plot.w).toBeLessThan(b.x);
            else if (position === "b")
              expect(r.plot.y + r.plot.h).toBeLessThan(b.y);
            else expect(b.bottom).toBeLessThan(r.plot.y);
          }
          expect(P.getShapeChartSpec(f.shape)).toEqual(original);
          expect(workbook(f.p, f.shape).data).toEqual(bytes);
        });
});

describe("legend packing and asymmetric ink bounds", () => {
  for (const position of ["l", "r"])
    for (const sizePt of [9, 18, 32])
      it(`${position} ${sizePt}pt uses the native chart content bounds independently of plot insets`, () => {
        const f = chartLegendLayoutDeck({ sizePt, position }),
          b = fittedLegend(render(f).svg).box;
        // Native reference controls: the chart is at (96,96), 672×384px.
        // Side legends center at y=288 across all three native font sizes.
        expect((b.y + b.bottom) / 2).toBeCloseTo(288, 1);
      });
  for (const position of ["l", "r", "tr"])
    it(`${position} centers a single very thick line key within the available chart height`, () => {
      const f = chartLegendLayoutDeck({
          kind: "line",
          sizePt: 9,
          legend: {
            position,
            fill: "#FFF0D1",
            textStyle: { font: "Arial", sizePt: 9, color: "#A37511" },
          },
          series: [
            {
              name: "Alpha",
              values: [2, 4, 3, 5],
              color: "#E85239",
              markerSymbol: "none",
              lineWidthEmu: 1905000,
            },
          ],
        }),
        r = render(f),
        legend = fittedLegend(r.svg),
        b = legend.box;
      expect(b.y).toBeGreaterThanOrEqual(104 - 0.02);
      expect(b.bottom).toBeLessThanOrEqual(472 + 0.02);
      if (position !== "tr") expect((b.y + b.bottom) / 2).toBeCloseTo(288, 1);
      expect(r.plot.w).toBeGreaterThan(0);
      expect(r.plot.h).toBeGreaterThan(0);
    });
  for (const position of ["b", "t"])
    it(`${position} packs ordinary entries in multiple rows at their authored font size`, () => {
      const labels = Array.from({ length: 20 }, (_, i) => `Series ${i + 1}`),
        f = chartLegendLayoutDeck({
          sizePt: 18,
          legend: {
            position,
            fill: "#FFF0D1",
            textStyle: { font: "Arial", sizePt: 18, color: "#A37511" },
          },
          series: labels.map((name) => ({
            name,
            values: [2, 4, 3, 5],
            color: "#E85239",
          })),
        }),
        r = render(f),
        legend = fittedLegend(r.svg);
      expect(legend.labels).toHaveLength(20);
      expect(legend.keys).toHaveLength(20);
      expect(
        new Set(legend.labels.map((l) => Math.round(l.y))).size,
      ).toBeGreaterThan(1);
      for (const text of legend.labels)
        expect(text.bottom - text.y).toBeCloseTo(24 * 1.1, 1);
      expect(r.plot.h).toBeGreaterThan(0);
    });
});

describe("legend SVG advances follow measured font widths", () => {
  it("keeps real shaped advances consistent between measured layout and SVG painting", () => {
    const f = chartLegendLayoutDeck(),
      r = render(f);
    for (const text of r.labels) {
      const value = text.children
        .filter((c) => c.kind === "text")
        .map((c) => c.data)
        .join("");
      expect(+attr(text, "textLength")).toBeCloseTo(
        measureText(value, { sizePx: (32 * 4) / 3 }).widthPx,
        8,
      );
      expect(attr(text, "lengthAdjust")).toBe("spacingAndGlyphs");
    }
  });
  it("does not stretch glyphs to the default heuristic measurer", () => {
    const f = chartLegendLayoutDeck();
    expect(renderSlideToSvg(f.p, f.slide)).not.toContain("textLength=");
    expect(decodeURIComponent(preview(f.p, f.slide))).not.toContain(
      "textLength=",
    );
  });
  it("does not constrain glyphs to invalid injected width estimates", () => {
    const f = chartLegendLayoutDeck({
        kind: "pie",
        categories: ["Alpha", "Beta", "Gamma"],
        series: [{ name: "Units", values: [2, 4, 3] }],
      }),
      svg = renderSlideToSvg(f.p, f.slide, {
        measureText: () => ({ widthPx: NaN }),
      });
    expect(svg).not.toMatch(/NaN|Infinity|textLength=/);
  });
});
