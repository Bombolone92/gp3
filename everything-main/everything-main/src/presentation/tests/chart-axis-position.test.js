import { describe, expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { workbook } from "./chart-copy-fixture.js";
import {
  chartAxisPositionDeck as fixture,
  chartAxisPositions as positions,
} from "./chart-axis-position-fixture.js";
import {
  chartAxisRoles,
  chartPlotContext,
} from "../lib/pptx/src/internal/chartml/axis-context.ts";
import { parseXml } from "../lib/pptx/src/internal/xml/index.ts";

describe("native axis positions", () => {
  for (const kind of ["column", "bar", "line", "area"])
    for (const highCategory of [false, true])
      for (const highValue of [false, true])
        it(`${kind} retains category ${highCategory} and value ${highValue} edges through edits and transfers`, async () => {
          const f = fixture(kind, highCategory, highValue),
            initial = P.getShapeChartSpec(f.shape),
            expected = positions(f.p, f.shape),
            bytes = f.part.data.slice(),
            book = workbook(f.p, f.shape).data.slice();
          expect(expected).toEqual(
            kind === "bar"
              ? {
                  category: highCategory ? "r" : "l",
                  secondaryCategory: highCategory ? "r" : "l",
                  value: highValue ? "t" : "b",
                  secondaryValue: highValue ? "t" : "b",
                }
              : {
                  category: highCategory ? "t" : "b",
                  secondaryCategory: highCategory ? "t" : "b",
                  value: highValue ? "r" : "l",
                  secondaryValue: highValue ? "r" : "l",
                },
          );
          expect(initial.series.map((s) => !!s.secondaryAxis)).toEqual([
            false,
            true,
          ]);
          expect(f.part.data).toEqual(bytes);
          P.setChartSpec(P.getSlideCharts(f.slide)[0], {
            ...initial,
            title: "Independent title",
            categoryAxisCrosses: { at: 2 },
          });
          expect(positions(f.p, f.shape)).toEqual(expected);
          expect(workbook(f.p, f.shape).data).toEqual(book);
          const edited = {
            ...P.getShapeChartSpec(f.shape),
            series: initial.series.map((s, i) => ({
              ...s,
              values: s.values.map((v) => v + i + 1),
            })),
          };
          P.setChartSpec(P.getSlideCharts(f.slide)[0], edited);
          expect(positions(f.p, f.shape)).toEqual(expected);
          expect(workbook(f.p, f.shape).data).not.toEqual(book);
          const doc = parseXml(new TextDecoder().decode(f.part.data)),
            ctx = chartPlotContext(doc.root),
            axes = chartAxisRoles(ctx.area, ctx.axes);
          for (const axis of Object.values(axes)) {
            const names = axis.children
              .filter((e) => e.kind === "element")
              .map((e) => e.name.localName);
            expect(names.filter((n) => n === "axPos")).toHaveLength(1);
            expect(names.indexOf("axPos")).toBeGreaterThan(
              names.indexOf("scaling"),
            );
            expect(names.indexOf("axPos")).toBeLessThan(
              names.indexOf("crossAx"),
            );
          }
          const q = createDeck("blank"),
            copied = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]);
          expect(positions(q, P.getSlideCharts(copied)[0].shape)).toEqual(
            expected,
          );
          const back = P.importSlide(f.p, copied, P.getSlideLayout(f.slide));
          expect(positions(f.p, P.getSlideCharts(back)[0].shape)).toEqual(
            expected,
          );
          const loaded = await P.loadPresentation(await P.savePresentation(q));
          expect(
            positions(
              loaded,
              P.getSlideCharts(P.getSlides(loaded)[1])[0].shape,
            ),
          ).toEqual(expected);
          expect(P.validatePresentation(loaded)).toEqual([]);
        });

  for (const [from, to] of [
    ["column", "bar"],
    ["bar", "column"],
    ["line", "bar"],
    ["bar", "area"],
  ])
    it(`rotates axes when changing ${from} to ${to}`, () => {
      const f = fixture(from, true, false),
        spec = P.getShapeChartSpec(f.shape);
      P.setChartSpec(P.getSlideCharts(f.slide)[0], { ...spec, kind: to });
      expect(positions(f.p, f.shape)).toEqual(
        to === "bar"
          ? {
              category: "l",
              value: "b",
              secondaryCategory: "r",
              secondaryValue: "t",
            }
          : {
              category: "b",
              value: "l",
              secondaryCategory: "b",
              secondaryValue: "r",
            },
      );
    });

  it("keeps equivalent edges when changing between vertical chart kinds", () => {
    const f = fixture("line", true, false),
      expected = positions(f.p, f.shape);
    P.setChartSpec(P.getSlideCharts(f.slide)[0], {
      ...P.getShapeChartSpec(f.shape),
      kind: "area",
    });
    expect(positions(f.p, f.shape)).toEqual(expected);
  });

  it("removes secondary declarations with the secondary axis system", () => {
    const f = fixture("column", true, false),
      spec = P.getShapeChartSpec(f.shape);
    P.setChartSpec(P.getSlideCharts(f.slide)[0], {
      ...spec,
      series: spec.series.filter((s) => !s.secondaryAxis),
    });
    expect(positions(f.p, f.shape)).toEqual({
      category: "t",
      value: "l",
      secondaryCategory: null,
      secondaryValue: null,
    });
  });
});
