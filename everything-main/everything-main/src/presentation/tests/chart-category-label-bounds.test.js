import { describe, it, expect } from "vitest";
import { P } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  chartLegendLayoutDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";
import { chartAxisRailDeck, railColors } from "./chart-axis-rail-fixture.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

const categories = [
  "International operating income after tax",
  'ABCDEFGHIJKLé👩‍👩‍👧‍👦 R&D <net> "quoted" totals',
  "Cost … projected annual operating income",
];
const frame = { x: 60, y: 50, w: 1140, h: 600 };
const color = "#604020";
const attr = (e, name) => getAttrValue(e, qname("", name, ""));
const measure = (text, font) => ({
  widthPx: [...text].length * font.sizePx * 0.6,
  ascentPx: font.sizePx * 0.8,
  descentPx: font.sizePx * 0.2,
});
const textOf = (e) =>
  e.children
    .filter((n) => n.kind === "text")
    .map((n) => n.data)
    .join("");
function bounds(e) {
  const sizePx = +attr(e, "font-size"),
    width = measure(textOf(e), { sizePx }).widthPx,
    anchor = attr(e, "text-anchor"),
    start = anchor === "end" ? -width : anchor === "middle" ? -width / 2 : 0,
    angle =
      (+(attr(e, "transform")?.match(/rotate\(([-.\d]+)/)?.[1] ?? 0) *
        Math.PI) /
      180,
    x = +attr(e, "x"),
    y = +attr(e, "y"),
    points = [start, start + width].flatMap((dx) =>
      [-sizePx / 2, sizePx / 2].map((dy) => [
        x + dx * Math.cos(angle) - dy * Math.sin(angle),
        y + dx * Math.sin(angle) + dy * Math.cos(angle),
      ]),
    );
  return {
    left: Math.min(...points.map((p) => p[0])),
    right: Math.max(...points.map((p) => p[0])),
    top: Math.min(...points.map((p) => p[1])),
    bottom: Math.max(...points.map((p) => p[1])),
  };
}
function position(f) {
  P.setShapePosition(f.shape, P.pt(frame.x * 0.75), P.pt(frame.y * 0.75));
  P.setShapeSize(f.shape, P.pt(frame.w * 0.75), P.pt(frame.h * 0.75));
}
function paint(f) {
  const nodes = [],
    measured = [];
  walkElements(
    parseXml(
      renderSlideToSvg(f.p, f.slide, {
        measureText: (text, font) => {
          measured.push(text);
          return measure(text, font);
        },
      }),
    ).root,
    (e) => {
      if (e.name.localName === "text") nodes.push(e);
    },
  );
  return { nodes, measured };
}
function fitsPerpendicular(labels, bar) {
  for (const label of labels) {
    const b = bounds(label);
    expect(bar ? b.left : b.top).toBeGreaterThanOrEqual(
      (bar ? frame.x : frame.y) - 0.02,
    );
    expect(bar ? b.right : b.bottom).toBeLessThanOrEqual(
      (bar ? frame.x + frame.w : frame.y + frame.h) + 0.02,
    );
  }
}
describe("complete category labels reserve their painted axis rows", () => {
  for (const kind of ["bar", "column", "line", "area"])
    for (const angle of [0, -30, 45, 90])
      for (const high of [false, true])
        it(`${kind} ${angle} degrees on the ${high ? "high" : "low"} edge measures complete text`, () => {
          const f = chartLegendLayoutDeck({
            kind,
            categories,
            legend: undefined,
            series: [{ name: "Units", values: [2, 4, 3] }],
            categoryAxisLabelRotationDeg: angle,
            categoryAxisTickLabelPos: high ? "high" : "low",
            categoryAxisCrosses: high ? "max" : "min",
            categoryAxisLabelStyle: { sizePt: high ? 14 : 12, color },
            categoryAxisMajorTickMark: "none",
            categoryAxisMinorTickMark: "none",
            valueAxisHidden: true,
          });
          position(f);
          const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
            before = part.data.slice(),
            book = workbook(f.p, f.shape).data.slice(),
            r = paint(f),
            labels = r.nodes.filter((e) => attr(e, "fill") === color);
          expect(labels.map(textOf)).toEqual(categories);
          // Caller-authored ellipses remain valid. Layout must not fabricate
          // shorter strings than those emitted by the label painter.
          expect(
            r.measured.filter(
              (s) => s.includes("…") && !categories.includes(s),
            ),
          ).toEqual([]);
          fitsPerpendicular(labels, kind === "bar");
          expect(part.data).toEqual(before);
          expect(workbook(f.p, f.shape).data).toEqual(book);
        });
  for (const kind of ["bar", "column"])
    for (const returned of [false, true])
      it(`${kind} ${returned ? "returned" : "outward"} independent rows reserve complete primary labels`, () => {
        const f = chartAxisRailDeck(kind, returned),
          chart = P.getSlideCharts(f.slide)[0];
        P.setChartSpec(chart, {
          ...chart.spec,
          categories: [...categories, "Additional operating market"],
          categoryAxisLabelRotationDeg: kind === "bar" ? 0 : 30,
        });
        position(f);
        const r = paint(f),
          primary = r.nodes.filter(
            (e) => attr(e, "fill") === railColors.category,
          ),
          secondary = r.nodes.filter(
            (e) => attr(e, "fill") === railColors.secondaryCategory,
          );
        expect(primary).toHaveLength(4);
        expect(secondary).toHaveLength(4);
        fitsPerpendicular([...primary, ...secondary], kind === "bar");
        const a = primary.map(bounds),
          b = secondary.map(bounds);
        expect(
          kind === "bar"
            ? Math.max(...b.map((v) => v.right))
            : Math.max(...a.map((v) => v.bottom)),
        ).toBeLessThanOrEqual(
          kind === "bar"
            ? Math.min(...a.map((v) => v.left))
            : Math.min(...b.map((v) => v.top)),
        );
      });
});
