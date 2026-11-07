import { paintPlotGuides } from "./chart-plot-guides-fixture.js";
import { describe, it, expect } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  chartFillBaselineDeck,
  baselineColors,
} from "./chart-fill-baseline-fixture.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

const attr = (e, n) => getAttrValue(e, qname("", n, ""));
function paint(f) {
  paintPlotGuides(f);
  const svg = decodeURIComponent(
      preview(f.p, f.slide).split(",").slice(1).join(","),
    ),
    elements = [];
  walkElements(parseXml(svg).root, (e) => elements.push(e));
  const plot = elements.find(
    (e) =>
      e.name.localName === "rect" && attr(e, "fill") === baselineColors.plot,
  );
  return {
    svg,
    elements,
    plot: Object.fromEntries(
      ["x", "y", "width", "height"].map((n) => [n, Number(attr(plot, n))]),
    ),
  };
}
function crossing(cross, scale) {
  return Math.max(
    scale.min,
    Math.min(
      scale.max,
      cross === "min"
        ? scale.min
        : cross === "max"
          ? scale.max
          : typeof cross === "object"
            ? cross.at
            : 0,
    ),
  );
}
function coordinate(r, kind, scale, direction, value) {
  const fraction = (value - scale.min) / (scale.max - scale.min),
    forward = direction === "maxMin" ? 1 - fraction : fraction;
  return kind === "bar"
    ? r.plot.x + forward * r.plot.width
    : r.plot.y + (1 - forward) * r.plot.height;
}
const points = (e) =>
  [...attr(e, "d").matchAll(/[-+]?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

describe("secondary plot fill crossing (native reference)", () => {
  // A deleted secondary value axis borrows the primary numeric range AND
  // crossing for data geometry. Its category spine still uses its own
  // declarations, and its value direction remains independent.
  for (const kind of ["column", "bar", "area", "line"])
    for (const hidden of [true, false])
      for (const secondaryDirection of ["minMax", "maxMin"])
        for (const primaryCrossing of ["autoZero", "min", "max", { at: 5 }])
          it(`${kind} ${hidden ? "deleted" : "visible"} secondary axis ${secondaryDirection}, primary ${JSON.stringify(primaryCrossing)}`, () => {
            const cfg = {
                kind,
                hidden,
                secondaryDirection,
                primaryDirection: "maxMin",
                primaryCrossing,
                secondaryCrossing: { at: 35 },
              },
              f = chartFillBaselineDeck(cfg),
              r = paint(f),
              scale = hidden ? { min: -10, max: 20 } : { min: 10, max: 50 },
              base = coordinate(
                r,
                kind,
                scale,
                secondaryDirection,
                crossing(
                  hidden ? primaryCrossing : cfg.secondaryCrossing,
                  scale,
                ),
              ),
              values = [15, 25, 40];
            if (kind === "line") {
              const guides = r.elements.filter(
                (e) =>
                  e.name.localName === "line" &&
                  attr(e, "stroke") === "#9CA3AF",
              );
              expect(guides).toHaveLength(6);
              values.forEach((v, i) => {
                const endpoints = [
                  coordinate(r, kind, scale, secondaryDirection, v),
                  base,
                ].sort((a, b) => a - b);
                expect(Number(attr(guides[i + 3], "y1"))).toBeCloseTo(
                  endpoints[0],
                  1,
                );
                expect(Number(attr(guides[i + 3], "y2"))).toBeCloseTo(
                  endpoints[1],
                  1,
                );
              });
            } else if (kind === "area") {
              const path = r.elements.find(
                  (e) =>
                    e.name.localName === "path" &&
                    attr(e, "fill") === baselineColors.target,
                ),
                pts = points(path);
              values.forEach((v, i) =>
                expect(pts[i * 2 + 1]).toBeCloseTo(
                  coordinate(r, kind, scale, secondaryDirection, v),
                  1,
                ),
              );
              for (let i = 7; i < pts.length; i += 2)
                expect(pts[i]).toBeCloseTo(base, 1);
            } else {
              const bars = r.elements.filter(
                  (e) =>
                    e.name.localName === "rect" &&
                    attr(e, "fill") === baselineColors.target,
                ),
                coord = kind === "bar" ? "x" : "y",
                extent = kind === "bar" ? "width" : "height";
              expect(bars).toHaveLength(3);
              values.forEach((v, i) => {
                const tip = coordinate(r, kind, scale, secondaryDirection, v);
                expect(Number(attr(bars[i], coord))).toBeCloseTo(
                  Math.min(base, tip),
                  1,
                );
                expect(Number(attr(bars[i], extent))).toBeCloseTo(
                  Math.abs(base - tip),
                  1,
                );
              });
            }
            const spine = r.elements.find(
                (e) =>
                  e.name.localName === "line" &&
                  attr(e, "stroke") === baselineColors.secondaryAxis,
              ),
              spineAt = coordinate(
                r,
                kind,
                { min: 10, max: 50 },
                secondaryDirection,
                35,
              );
            expect(
              Number(attr(spine, kind === "bar" ? "x1" : "y1")),
            ).toBeCloseTo(spineAt, 1);
            expect(
              P.getShapeChartSpec(f.shape).secondaryCategoryAxisCrosses,
            ).toEqual(cfg.secondaryCrossing);
          });

  for (const bounds of [
    { min: 12, max: 48 },
    { min: -55, max: -7 },
    { min: -24, max: 36 },
  ])
    for (const kind of ["column", "bar", "area"])
      for (const secondaryCrossing of ["min", "max", { at: -500 }, { at: 500 }])
        it(`${kind} clamps the borrowed auto crossing to ${JSON.stringify(bounds)} independently of secondary ${JSON.stringify(secondaryCrossing)}`, () => {
          const f = chartFillBaselineDeck({
              kind,
              primary: bounds,
              secondary: bounds,
              primaryCrossing: "autoZero",
              secondaryCrossing,
            }),
            r = paint(f),
            base = coordinate(
              r,
              kind,
              bounds,
              "minMax",
              crossing("autoZero", bounds),
            );
          if (kind === "area") {
            const path = r.elements.find(
                (e) =>
                  e.name.localName === "path" &&
                  attr(e, "fill") === baselineColors.target,
              ),
              pts = points(path);
            for (let i = 7; i < pts.length; i += 2)
              expect(pts[i]).toBeCloseTo(base, 1);
          } else {
            const bars = r.elements.filter(
                (e) =>
                  e.name.localName === "rect" &&
                  attr(e, "fill") === baselineColors.target,
              ),
              coord = kind === "bar" ? "x" : "y",
              extent = kind === "bar" ? "width" : "height";
            expect(bars).toHaveLength(3);
            for (const bar of bars) {
              const start = Number(attr(bar, coord)),
                end = start + Number(attr(bar, extent));
              expect(
                Math.min(Math.abs(start - base), Math.abs(end - base)),
              ).toBeLessThan(0.1);
            }
          }
        });

  for (const kind of ["column", "bar", "area"])
    it(`${kind} preserves both authored crossings through copy both ways, edits and export`, async () => {
      const f = chartFillBaselineDeck({ kind }),
        spec = P.getShapeChartSpec(f.shape),
        before = paint(f).svg,
        book = workbook(f.p, f.shape).data.slice(),
        native = P._internalPackageOf(f.p)
          .getPart(chartRoot(f.shape))
          .data.slice(),
        destination = createDeck("blank"),
        slide = P.importSlide(
          destination,
          f.slide,
          P.getSlideLayouts(destination)[0],
        );
      expect(paint({ p: destination, slide }).svg).toBe(before);
      const back = P.importSlide(f.p, slide, P.getSlideLayout(f.slide)),
        copied = P.getSlideCharts(back)[0];
      P.setChartSpec(copied, {
        ...copied.spec,
        textStyle: { font: "Arial", sizePt: 14 },
        series: copied.spec.series.map((s, i) =>
          i ? s : { ...s, values: [18, 27, 39] },
        ),
      });
      const reloaded = await P.loadPresentation(await P.savePresentation(f.p)),
        charts = [
          P.getSlideCharts(P.getSlides(reloaded)[0])[0],
          P.getSlideCharts(P.getSlides(reloaded).at(-1))[0],
        ];
      expect(charts[0].spec).toEqual(spec);
      expect(charts[1].spec.categoryAxisCrosses).toEqual(
        spec.categoryAxisCrosses,
      );
      expect(charts[1].spec.secondaryCategoryAxisCrosses).toEqual(
        spec.secondaryCategoryAxisCrosses,
      );
      expect(charts[1].spec.series[0].values).toEqual([18, 27, 39]);
      expect(workbook(reloaded, charts[0].shape).data).toEqual(book);
      expect(
        P._internalPackageOf(reloaded).getPart(chartRoot(charts[0].shape)).data,
      ).toEqual(native);
      expect(P.validatePresentation(reloaded)).toEqual([]);
    });
});
